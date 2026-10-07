import {candles,signal} from "../trade-core.mjs";
import {RISK_DEFAULTS,initialRisk,vetOrder,assessFinishedDay,utcDay,nextUtcMidnight} from "./risk.mjs";
import {computeMetrics,monthlyPnl} from "./metrics.mjs";
import {detectRegime,boundedGridPlan,trendFollowSignal,trailingStopPrice,dcaStep,dcaOnFill,validateStrategyConfig,TREND_SYMBOLS,DCA_SYMBOLS} from "./strategies.mjs";
import {atr} from "./indicators.mjs";

const SYMBOLS=new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT"]);
const INTERVALS=new Set(["1m","5m","15m","1h"]);
const TICK_MS=60_000,MAX_QUOTE=10,MAX_BUDGET=100;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// HMAC-SHA256 hex of a Binance query string. Exported for unit tests.
export async function signQuery(secret,queryString){
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(queryString)));
  return Array.from(mac,b=>b.toString(16).padStart(2,"0")).join("");
}

// Triple live gate: BINANCE_LIVE_ENABLED=1 + confirm==="LIVE" + separate
// live key pair. Any live call missing one of the three throws AND logs.
export function assertLiveGate(mode,env,confirm){
  if(mode!=="live")return true;
  const problems=[];
  if(String(env.BINANCE_LIVE_ENABLED)!=="1")problems.push("BINANCE_LIVE_ENABLED is not 1");
  if(confirm!=="LIVE")problems.push("typed LIVE confirmation missing");
  if(!env.BINANCE_LIVE_API_KEY||!env.BINANCE_LIVE_API_SECRET)problems.push("separate live API keys not configured");
  if(problems.length){console.error("[ai-bridge] LIVE gate blocked:",problems.join("; "));throw new Error("Live trading blocked: "+problems.join("; "))}
  return true;
}
export function botConfig(input,env){
  const mode=String(input?.mode||""),symbol=String(input?.symbol||""),interval=String(input?.interval||""),budget=Number(input?.budget);
  if(!["testnet","live"].includes(mode)||!SYMBOLS.has(symbol)||!INTERVALS.has(interval)||!Number.isFinite(budget)||budget<50||budget>MAX_BUDGET)throw new Error("Invalid bot configuration");
  assertLiveGate(mode,env,input?.confirm);
  const prefix=mode==="live"?"BINANCE_LIVE":"BINANCE_TESTNET";
  if(!env[`${prefix}_API_KEY`]||!env[`${prefix}_API_SECRET`])throw new Error(`${mode} API credentials are not configured`);
  return {mode,symbol,interval,budget,liveConfirmed:mode==="live"};
}
export function publicState(s,env){
  const r=s.risk||{};
  return {configured:!!env.BINANCE_TESTNET_API_KEY&&!!env.BINANCE_TESTNET_API_SECRET,liveAvailable:String(env.BINANCE_LIVE_ENABLED)==="1"&&!!env.BINANCE_LIVE_API_KEY&&!!env.BINANCE_LIVE_API_SECRET,
    status:s.status,mode:s.config?.mode||null,symbol:s.config?.symbol||null,interval:s.config?.interval||null,budget:s.config?.budget||null,
    lastTick:s.lastTick||null,lastCandle:s.lastCandle||null,lastPrice:s.lastPrice||null,lastSignal:s.lastSignal||null,
    position:s.position||null,pending:s.pending?{clientOrderId:s.pending.id,side:s.pending.side,at:s.pending.at}:null,
    day:s.day||null,dayTrades:s.dayTrades||0,daySpend:s.daySpend||0,dayPnl:s.dayPnl||0,
    strategy:s.strategy?.name||"signal",strategyParams:s.strategy?.params||{},
    risk:{halted:!!r.halted,haltReason:r.haltReason||null,manualReviewRequired:!!r.manualReviewRequired,haltedUntil:r.haltedUntil||0,pausedUntil:r.pausedUntil||0,pauseReason:r.pauseReason||null,tradesToday:r.tradesToday||0},
    equity:Number.isFinite(r.equity)?r.equity:null,
    dcaActive:!!(s.dca&&s.dca.qty>0),gridActive:!!s.grid,
    journal:(s.journal||[]).slice(-50),error:s.error||null,background:true};
}
export function initial(){return {status:"stopped",config:null,journal:[],position:null,pending:null,lastCandle:0,lastTick:null,day:"",dayTrades:0,daySpend:0,dayPnl:0,error:null,
  strategy:{name:"signal",params:{stopPct:0.03,takePct:0.06,stopLimitGapPct:0.005}},risk:initialRisk(),dca:null,grid:null,equityCurve:[],pausedBy:null}}
export function floorStep(value,step){const n=Number(step);if(!Number.isFinite(n)||n<=0)throw new Error("Invalid Binance step size");const precision=(String(step).split(".")[1]||"").replace(/0+$/,"").length;return (Math.floor((value+1e-12)/n)*n).toFixed(Math.min(precision,12))}
function safeError(code){return `Binance request failed (${Number.isInteger(code)?code:"network"}). Check bot status and exchange account.`}
export class BinanceApi{
  constructor(mode,env,opts={}){this.mode=mode;assertLiveGate(mode,env,opts.liveConfirm?"LIVE":undefined);this.base=mode==="live"?"https://api.binance.com":"https://testnet.binance.vision";const p=mode==="live"?"BINANCE_LIVE":"BINANCE_TESTNET";this.key=env[`${p}_API_KEY`];this.secret=env[`${p}_API_SECRET`];if(!this.key||!this.secret)throw new Error("Exchange credentials unavailable");this.timeOffset=0;this.timeSyncAt=0;this.maxAttempts=RISK_DEFAULTS.maxBackoffAttempts}
  async syncTime(){const now=Date.now();if(now-this.timeSyncAt<60_000)return;try{const res=await this.raw("/api/v3/time",{},"GET",false);const t=await res.json();if(Number.isFinite(t?.serverTime)){this.timeOffset=t.serverTime-Date.now();this.timeSyncAt=now}}catch(e){/* keep previous offset; recvWindow tolerates drift */}}
  async raw(path,params={},method="GET",signed=false){
    const search=new URLSearchParams(params);
    if(signed){await this.syncTime();search.set("recvWindow",String(RISK_DEFAULTS.recvWindow));search.set("timestamp",String(Date.now()+this.timeOffset));search.set("signature",await signQuery(this.secret,search.toString()))}
    const url=this.base+path+(method==="GET"?"?"+search:"");
    return fetch(url,{method,headers:{...(signed?{"X-MBX-APIKEY":this.key}:{}),...(method==="POST"||method==="DELETE"?{"Content-Type":"application/x-www-form-urlencoded"}:{})},body:method==="GET"?undefined:search.toString(),signal:AbortSignal.timeout(9000)});
  }
  async request(path,params={},method="GET",signed=false){
    let attempt=0;
    for(;;){
      const res=await this.raw(path,params,method,signed);
      if((res.status===429||res.status===418)&&attempt<this.maxAttempts){
        const retryAfter=Number(res.headers.get("retry-after"));
        await sleep(Math.min(30_000,(Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:0)+500*2**attempt));
        attempt++;continue;
      }
      const body=await res.text();if(body.length>100_000)throw new Error("Binance response too large");let data;try{data=JSON.parse(body)}catch(e){throw new Error("Invalid Binance response")}
      if(!res.ok){
        if((res.status===429||res.status===418)&&attempt>=this.maxAttempts){const e=new Error(`Exchange rate limit exhausted after ${this.maxAttempts} backoff attempts; risk halt engaged.`);e.code=res.status;e.status=res.status;e.haltRisk=true;e.reason="RATE_LIMIT";throw e}
        const e=new Error(safeError(data?.code));e.code=Number(data?.code)||res.status;e.status=res.status;throw e;
      }
      return data;
    }
  }
  klines(symbol,interval,limit="100"){return this.request("/api/v3/klines",{symbol,interval,limit})}
  exchangeInfo(symbol){return this.request("/api/v3/exchangeInfo",{symbol})}
  account(){return this.request("/api/v3/account",{},"GET",true)}
  query(symbol,id){return this.request("/api/v3/order",{symbol,origClientOrderId:id},"GET",true)}
  order(params){return this.request("/api/v3/order",params,"POST",true)}
  cancel(symbol,origClientOrderId){return this.request("/api/v3/order",{symbol,origClientOrderId},"DELETE",true)}
  cancelAll(symbol){return this.request("/api/v3/openOrders",{symbol},"DELETE",true)}
  openOrders(symbol){return this.request("/api/v3/openOrders",{symbol},"GET",true)}
}
// Dashboard metrics contract: GET /api/trade/metrics -> {ok, metrics:{...}}.
export function tradeMetrics(s){
  const journal=s.journal||[],r=s.risk||{};
  const trades=journal.filter(j=>Number.isFinite(j.pnl)).map(j=>({pnl:j.pnl,time:j.at}));
  const m=computeMetrics({trades,equityCurve:s.equityCurve||[],currentEquity:Number.isFinite(r.equity)?r.equity:null});
  const pos=s.position;
  return {winRate:m.winRate,profitFactor:m.profitFactor,sharpe:m.sharpe,maxDrawdown:m.maxDrawdown,calmar:m.calmar,
    avgWin:m.avgWin,avgLoss:m.avgLoss,currentDrawdown:m.currentDrawdown,
    dailyPnl:s.dayPnl||0,dailyPnlLimit:-((s.config?.budget||0)*RISK_DEFAULTS.dailyLossHaltPct),tradesToday:s.dayTrades||0,
    monthlyPnl:monthlyPnl(journal.filter(j=>Number.isFinite(j.pnl)).map(j=>({pnl:j.pnl,time:j.at}))),
    equityCurve:(s.equityCurve||[]).slice(-90),
    openPositions:pos?[{symbol:s.config?.symbol||null,qty:pos.qty,entry:pos.entry,price:s.lastPrice??null,pnl:s.lastPrice!=null?(s.lastPrice-pos.entry)*pos.qty:null,stopOrderId:pos.stopOrderId||null}]:[]};
}
export class BotEngine{
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.busy=false}
  async state(){return await this.ctx.storage.get("bot")||initial()}
  async put(s){await this.ctx.storage.put("bot",s)}
  apiFor(s){return new BinanceApi(s.config.mode,this.env,{liveConfirm:s.config.liveConfirmed===true})}
  riskView(s,price){
    const r=s.risk||{};
    return {equity:r.equity||0,peak:r.peak||0,
      positions:s.position?[{symbol:s.config.symbol,notional:s.position.qty*(price||s.position.entry)}]:[],
      halted:!!r.halted,manualReviewRequired:!!r.manualReviewRequired,
      pausedUntil:r.pausedUntil||0,haltedUntil:r.haltedUntil||0,
      lastOrderAt:r.lastOrderAt||0,lastLossAt:r.lastLossAt||0,tradesToday:r.tradesToday||0};
  }
  equityOf(account,s,price){
    const asset=s.config.symbol.replace("USDT","");
    let eq=0;
    for(const b of account.balances||[]){
      const total=Number(b.free||0)+Number(b.locked||0);
      if(b.asset==="USDT")eq+=total;else if(b.asset===asset)eq+=total*price;
    }
    return eq;
  }
  updateRiskAccounting(s,equity){
    const now=Date.now(),day=utcDay(now),r=s.risk||(s.risk=initialRisk());
    if(!Number.isFinite(r.dayStartEquity)||r.dayStartEquity<=0)r.dayStartEquity=equity;
    if(s.day&&s.day!==day){
      const prevPct=r.dayStartEquity>0?s.dayPnl/r.dayStartEquity:0;
      Object.assign(r,assessFinishedDay(r,s.day,prevPct,now));
    }
    if(s.day!==day){s.day=day;s.dayTrades=0;s.daySpend=0;s.dayPnl=0;r.tradesToday=0;r.tradesTodayDay=day;r.dayStartEquity=equity;r.haltedUntil=0}
    r.equity=equity;
    if(equity>r.peak)r.peak=equity;
    if(r.peak>0&&(r.peak-equity)/r.peak>=RISK_DEFAULTS.maxDrawdownPct&&!r.manualReviewRequired){
      r.manualReviewRequired=true;s.error="Portfolio drawdown -15% from peak: full stop, manual review required.";
    }
    if(r.dayStartEquity>0&&(equity-r.dayStartEquity)/r.dayStartEquity<=-RISK_DEFAULTS.dailyLossHaltPct)
      r.haltedUntil=nextUtcMidnight(now);
    const curve=s.equityCurve||(s.equityCurve=[]);
    if(curve.at(-1)?.day!==day)curve.push({day,equity});else curve.at(-1).equity=equity;
    s.equityCurve=curve.slice(-365);
  }
  async fetch(req){
    const u=new URL(req.url),s=await this.state();
    if(u.pathname==="/status")return Response.json(publicState(s,this.env));
    if(u.pathname==="/metrics")return Response.json({ok:true,metrics:tradeMetrics(s)});
    if(u.pathname!=="/command"||req.method!=="POST")return new Response("Not found",{status:404});
    if(this.busy)return Response.json({error:"Bot tick is in progress; retry after status refresh."},{status:409});
    let body;try{body=await req.json()}catch(e){return Response.json({error:"Invalid JSON"},{status:400})}
    const action=String(body?.action||"");
    if(action==="start"){
      if(s.pending)return Response.json({error:"Unresolved exchange order. Reconcile before restart."},{status:409});
      if(s.status==="running")return Response.json(publicState(s,this.env));
      let config;try{config=botConfig(body,this.env)}catch(e){return Response.json({error:e.message},{status:400})}
      try{const account=await new BinanceApi(config.mode,this.env,{liveConfirm:config.liveConfirmed}).account();if(account.canTrade!==true)throw new Error("Trade permission missing")}catch(e){return Response.json({error:"Binance credentials, trade permission, or account endpoint unavailable. No bot was started."},{status:503})}
      if(s.position&&JSON.stringify({...s.config,liveConfirmed:undefined})!==JSON.stringify({...config,liveConfirmed:undefined}))return Response.json({error:"Open position belongs to previous configuration."},{status:409});
      if(s.config&&JSON.stringify(s.config)!==JSON.stringify(config)&&s.position===null){s.day="";s.dayTrades=0;s.daySpend=0;s.dayPnl=0;s.lastCandle=0}
      s.config=config;s.status="running";s.error=null;s.pausedBy=null;await this.put(s);await this.ctx.storage.setAlarm(Date.now()+1000);
    }else if(action==="verify"){
      let config;try{config=botConfig({...body,confirm:body.mode==="live"?body.confirm:undefined},this.env)}catch(e){return Response.json({error:e.message},{status:400})}
      try{const account=await new BinanceApi(config.mode,this.env,{liveConfirm:config.liveConfirmed}).account();return Response.json({verified:true,mode:config.mode,accountCanTrade:account.canTrade===true})}catch(e){return Response.json({error:"Binance credentials invalid or account endpoint unavailable."},{status:503})}
    }else if(action==="pause"||action==="stop"){
      s.status=s.pending?"reconciling":action==="pause"?"paused":"stopped";
      if(action==="pause"&&!s.pending)s.pausedBy="user";
      await this.put(s);
      if(s.pending)await this.ctx.storage.setAlarm(Date.now()+TICK_MS);else await this.ctx.storage.deleteAlarm();
    }else if(action==="resume"){
      if(s.status!=="paused")return Response.json({error:"Only a paused bot can resume."},{status:400});
      if(s.pending)return Response.json({error:"Unresolved exchange order. Reconcile before resume."},{status:409});
      if(s.risk?.halted||s.risk?.manualReviewRequired)return Response.json({error:"Risk halt active; manual review required."},{status:409});
      if((s.risk?.pausedUntil||0)>Date.now())return Response.json({error:"Risk pause active."},{status:409});
      s.status="running";s.error=null;s.pausedBy=null;await this.put(s);await this.ctx.storage.setAlarm(Date.now()+1000);
    }else if(action==="reconcile"){
      if(!s.config)return Response.json({error:"Bot is not configured."},{status:400});
      const {rep,state}=await this.commandReconcile(s);
      return Response.json({ok:true,report:rep,state:publicState(state,this.env)});
    }else if(action==="stop-all"){
      if(!s.config)return Response.json({error:"Bot is not configured."},{status:400});
      if(s.config.mode==="live"&&body.confirm!=="LIVE")return Response.json({error:"Live stop-all requires explicit confirm \"LIVE\". All orders and positions stay untouched."},{status:400});
      const out=await this.stopAll(s);
      return Response.json({ok:true,...out,state:publicState(await this.state(),this.env)});
    }else if(action==="set-strategy"){
      const name=String(body?.strategy||"");
      if(s.position||s.pending||s.grid)return Response.json({error:"Close the position and clear pending/grid orders before switching strategy."},{status:409});
      const v=validateStrategyConfig(name,body?.params||{});
      if(!v.ok)return Response.json({error:v.error},{status:400});
      if((name==="trend-follow"||name==="conservative-dca")&&s.config&&!(TREND_SYMBOLS.includes(s.config.symbol)||DCA_SYMBOLS.includes(s.config.symbol)))
        return Response.json({error:`${name} supports BTC/ETH only.`},{status:400});
      s.strategy={name,params:v.params};s.dca=null;s.grid=null;await this.put(s);
    }else return Response.json({error:"Unknown action"},{status:400});
    return Response.json(publicState(s,this.env));
  }
  // P1(c): manual reconcile — cross-check local state against the exchange.
  async commandReconcile(s){
    const api=this.apiFor(s);
    const rep={clearedPending:false,closedPosition:false,resumed:false,openOrders:0,note:null};
    let openOrders=[];
    try{openOrders=await api.openOrders(s.config.symbol)}catch(e){rep.note="openOrders unavailable: "+e.message}
    rep.openOrders=openOrders.length;
    const ids=new Set(openOrders.map(o=>o.clientOrderId||o.origClientOrderId).filter(Boolean));
    if(s.pending){
      let order=null,unknown=false;
      try{order=await api.query(s.config.symbol,s.pending.id)}catch(e){unknown=true}
      if(order&&order.status==="FILLED"){await this.applyFill(s,api,order,s.pending);rep.note="Pending order was filled on the exchange; fill booked."}
      else if(order&&["CANCELED","REJECTED","EXPIRED"].includes(order.status)){s.pending=null;rep.clearedPending=true;rep.note=`Pending order was ${order.status} on the exchange.`}
      else if(unknown||!order){
        if(!ids.has(s.pending.id)){s.pending=null;rep.clearedPending=true;rep.note="Pending order no longer exists on the exchange; local pending cleared."}
        else rep.note="Pending order is still open on the exchange; kept.";
      }else rep.note=`Pending order status on exchange: ${order.status}.`;
    }
    try{
      const account=await api.account(),asset=s.config.symbol.replace("USDT",""),b=account.balances?.find(x=>x.asset===asset);
      const total=Number(b?.free||0)+Number(b?.locked||0);
      if(s.position&&total<s.position.qty*0.01){s.position=null;s.dca=null;rep.closedPosition=true}
      if(s.position?.stopOrderId&&!ids.has(s.position.stopOrderId))s.position.stopOrderId=null;
    }catch(e){rep.note=(rep.note?rep.note+"; ":"")+"balances unavailable: "+e.message}
    if(!s.pending&&!s.position&&(s.status==="paused"||s.status==="reconciling")&&s.pausedBy!=="user"&&!s.risk?.halted&&!s.risk?.manualReviewRequired){
      s.status="running";s.error=null;s.pausedBy=null;rep.resumed=true;
      await this.ctx.storage.setAlarm(Date.now()+1000);
    }
    await this.put(s);
    return {rep,state:s};
  }
  // Kill-switch: cancel everything, market-close the position, halt.
  async stopAll(s){
    const api=this.apiFor(s);
    let cancelled=0,closed=null;
    try{const r=await api.cancelAll(s.config.symbol);cancelled=Array.isArray(r)?r.length:0}catch(e){closed={error:"cancel-all failed: "+e.message}}
    if(s.position){
      try{
        const info=await api.exchangeInfo(s.config.symbol),symbol=info.symbols?.[0];
        const lot=symbol.filters?.find(x=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0)||symbol.filters?.find(x=>x.filterType==="LOT_SIZE");
        const account=await api.account(),asset=s.config.symbol.replace("USDT",""),free=Number(account.balances?.find(x=>x.asset===asset)?.free||0);
        const qty=floorStep(Math.min(s.position.qty,free),lot.stepSize);
        if(Number(qty)>=Number(lot.minQty)){
          const id=`ab${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g,"").slice(0,12)}`;
          await api.order({symbol:s.config.symbol,side:"SELL",type:"MARKET",quantity:qty,newClientOrderId:id,newOrderRespType:"FULL"});
          closed={qty};
        }else closed={error:"Position below sellable lot size; manual review needed."};
      }catch(e){closed={error:e.message}}
      s.position=null;
    }
    s.pending=null;s.grid=null;s.dca=null;
    s.risk.halted=true;s.risk.haltReason="STOP_ALL";
    s.status="stopped";s.error=null;s.pausedBy=null;
    await this.put(s);await this.ctx.storage.deleteAlarm();
    return {cancelled,closed};
  }
  async alarm(){
    if(this.busy)return;this.busy=true;
    try{let s=await this.state();if(!s.config||!["running","reconciling"].includes(s.status))return;
      if(s.pending){s=await this.reconcile(s);if(s.pending||s.status!=="running"){await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return}}
      await this.tick(s);
    }catch(e){
      // P1(b): never drop the alarm while a position is open or an order is
      // pending — the bot must keep monitoring. The alarm is deleted only
      // when the position is closed AND there are no pending orders.
      const s=await this.state(),hasWork=!!(s.position||s.pending);
      if(e&&e.haltRisk===true){s.risk.halted=true;s.risk.haltReason=e.reason||"RATE_LIMIT"}
      s.error=e&&e.haltRisk===true?`Exchange rate limit; risk halt engaged: ${e.reason||"RATE_LIMIT"}`:"Market, account or exchange filter check failed. Bot paused; inspect Binance account.";
      s.pausedBy="error";
      if(hasWork){s.status="running";await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS)}
      else{s.status="paused";await this.put(s);await this.ctx.storage.deleteAlarm()}
    }
    finally{this.busy=false}
  }
  // P1(a): after every BUY fill, (re)place ONE native STOP_LOSS_LIMIT that
  // protects the whole position. Cancel/replace keeps exactly one live.
  async placeProtectiveStop(s,api,fillPrice){
    const strat=s.strategy?.name||"signal",params=s.strategy?.params||{};
    const stopPct=strat==="conservative-dca"?(params.stopPct??0.20):(params.stopPct??0.03);
    const gapPct=params.stopLimitGapPct??0.005;
    const base=strat==="conservative-dca"&&s.dca?.firstEntry?s.dca.firstEntry:fillPrice;
    const info=await api.exchangeInfo(s.config.symbol),symbol=info.symbols?.[0];
    const lot=symbol.filters?.find(x=>x.filterType==="LOT_SIZE")||symbol.filters?.find(x=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0);
    const tickF=symbol.filters?.find(x=>x.filterType==="PRICE_FILTER");
    const tick=tickF?.tickSize||"0.00000001";
    const qty=floorStep(s.position?.qty||0,lot.stepSize);
    if(s.position?.stopOrderId){try{await api.cancel(s.config.symbol,s.position.stopOrderId)}catch(e){}s.position.stopOrderId=null}
    const stopPrice=floorStep(base*(1-stopPct),tick),limitPrice=floorStep(base*(1-stopPct-gapPct),tick);
    const id=`ab${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g,"").slice(0,12)}`;
    try{
      await api.order({symbol:s.config.symbol,side:"SELL",type:"STOP_LOSS_LIMIT",quantity:qty,stopPrice,price:limitPrice,timeInForce:"GTC",newClientOrderId:id});
      if(s.position)s.position.stopOrderId=id;
    }catch(e){
      if(s.position)s.position.stopUncertain=id;
      s.error="Protective stop placement uncertain; reconcile manually.";
    }
  }
  async bookStopFill(s,so,reason){
    const qty=Number(so.executedQty),quote=Number(so.cummulativeQuoteQty),price=quote/qty;
    const cost=s.position?.cost||0,tradePnl=quote-cost;
    s.dayPnl+=tradePnl;if(tradePnl<0)s.risk.lastLossAt=Date.now();s.risk.tradesToday++;
    if((s.strategy?.name||"signal")==="conservative-dca")s.dca=dcaOnFill(s.dca,{side:"sell-all",price,qty});
    s.journal=[...(s.journal||[]),{id:so.clientOrderId||s.position.stopOrderId,at:Date.now(),side:"SELL",reason,qty,quote,price,pnl:tradePnl}].slice(-200);
    s.position=null;await this.put(s);
  }
  async applyFill(s,api,order,p){
    const qty=Number(order.executedQty),quote=Number(order.cummulativeQuoteQty),price=quote/qty;
    if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(quote)||quote<=0)throw new Error("Invalid exchange fill; manual review needed");
    let tradePnl;
    const strat=s.strategy?.name||"signal";
    if(p.side==="BUY"){
      const prev=s.position;
      if(prev&&prev.qty>0){
        // Aggregate: a second buy (e.g. DCA safety order) averages into the
        // existing position instead of silently overwriting its cost basis.
        const nqty=prev.qty+qty,ncost=prev.cost+quote;
        s.position={qty:nqty,entry:ncost/nqty,cost:ncost,trailHigh:prev.trailHigh};
      }else{
        s.position={qty,entry:price,cost:quote};
      }
      if(strat==="conservative-dca")s.dca=dcaOnFill(s.dca,{side:"buy",price,qty});
      if(strat==="trend-follow")s.position.trailHigh=price;
      s.dayTrades++;s.daySpend+=quote;s.risk.tradesToday++;
      await this.placeProtectiveStop(s,api,price);
    }else{
      const cost=s.position?.cost||0;tradePnl=quote-cost;s.dayPnl+=tradePnl;
      if(strat==="conservative-dca")s.dca=dcaOnFill(s.dca,{side:"sell-all",price,qty});
      if(s.position?.stopOrderId){try{await api.cancel(s.config.symbol,s.position.stopOrderId)}catch(e){}}
      if(tradePnl<0)s.risk.lastLossAt=Date.now();
      s.risk.tradesToday++;s.position=null;
    }
    s.journal=[...(s.journal||[]),{id:p.id,at:Date.now(),side:p.side,reason:p.reason,qty,quote,price,pnl:p.side==="SELL"?tradePnl:undefined}].slice(-200);
    s.pending=null;s.error=null;if(s.status==="reconciling")s.status="paused";await this.put(s);return s;
  }
  async reconcile(s){
    const api=this.apiFor(s),p=s.pending;if(!p)return s;
    let order;try{order=await api.query(s.config.symbol,p.id)}catch(e){
      s.status="reconciling";s.error="Order status unknown. Bot stopped opening new orders; inspect Binance and reconcile manually.";await this.put(s);return s;
    }
    if(!["FILLED","CANCELED","REJECTED","EXPIRED"].includes(order.status)){s.status="reconciling";s.error="Order is pending on Binance; new orders blocked.";await this.put(s);return s}
    if(order.status!=="FILLED"){s.pending=null;s.status="paused";s.pausedBy="error";s.error=`Order ${order.status}; inspect exchange account.`;await this.put(s);return s}
    return this.applyFill(s,api,order,p);
  }
  async tick(s){
    const api=this.apiFor(s),strat=s.strategy?.name||"signal",params=s.strategy?.params||{};
    const rows=await api.klines(s.config.symbol,s.config.interval),all=candles(rows),closed=all.filter(c=>c.closedAt<Date.now());
    if(closed.length<23)throw new Error("Insufficient closed market candles");
    const price=all.at(-1).close;
    const account=await api.account();
    const equity=this.equityOf(account,s,price);
    this.updateRiskAccounting(s,equity);
    const candle=closed.at(-1),newCandle=candle.time>s.lastCandle,now=Date.now();
    s.lastTick=now;s.lastPrice=price;
    if(strat==="bounded-grid"){await this.gridTick(s,api,price,all);return}
    let rows1h=all;
    if(strat!=="signal"&&s.config.interval!=="1h"){
      const r1h=await api.klines(s.config.symbol,"1h","200");
      rows1h=candles(r1h);
    }
    let side=null,reason="",orderOpts={};
    if(strat==="signal"){
      const decision=signal(closed);s.lastSignal=decision;
      const stopPct=params.stopPct??0.03,takePct=params.takePct??0.06;
      if(s.position){if(price<=s.position.entry*(1-stopPct)){side="SELL";reason="stop"}else if(price>=s.position.entry*(1+takePct)){side="SELL";reason="take"}else if(newCandle&&decision==="sell"){side="SELL";reason="signal"}}
      else if(newCandle&&decision==="buy"&&s.dayTrades<5&&s.daySpend+MAX_QUOTE<=s.config.budget*.2&&s.dayPnl>-s.config.budget*.03){side="BUY";reason="signal"}
    }else if(strat==="trend-follow"){
      const tf=trendFollowSignal(rows1h);s.lastSignal="trend:"+tf.signal;
      if(s.position){
        const th=Math.max(s.position.trailHigh||0,candle.high);s.position.trailHigh=th;
        const trail=trailingStopPrice(th,tf.atr??price*0.01,params.trailAtrMult??2.5);
        if(price<=trail){side="SELL";reason="trail"}else if(tf.signal==="sell"){side="SELL";reason="ema-cross"}
      }else if(newCandle&&tf.signal==="buy"){side="BUY";reason="trend-breakout"}
    }else if(strat==="conservative-dca"){
      let regime="range";
      try{regime=detectRegime(rows1h).regime}catch(e){regime="range"}
      const step=dcaStep({price,dca:s.dca,capital:equity,now,regime,overrides:{basePct:params.basePct,stopPct:params.stopPct,takePct:params.takePct}});
      s.lastSignal="dca:"+step.action+":"+step.reason;s.dca=step.dca;
      if(step.action==="buy"){side="BUY";reason=step.reason;orderOpts.notional=step.notional}
      else if(step.action==="sell-all"){side="SELL";reason=step.reason}
    }
    if(newCandle)s.lastCandle=candle.time;await this.put(s);
    if(!side){await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return}
    const current=await this.state();
    if(current.status!=="running")return;
    if(current.pending){await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return}
    const info=await api.exchangeInfo(s.config.symbol),symbol=info.symbols?.[0];if(symbol?.status!=="TRADING"||!symbol?.isSpotTradingAllowed)throw new Error("Spot symbol is unavailable");
    const asset=s.config.symbol.replace("USDT",""),free=key=>Number(account.balances?.find(x=>x.asset===key)?.free||0);
    const notionalF=symbol.filters?.find(x=>x.filterType==="NOTIONAL"||x.filterType==="MIN_NOTIONAL"),minNotional=Number(notionalF?.minNotional||5);
    // If the native protective stop already filled on the exchange, book it
    // instead of sending a duplicate SELL.
    if(side==="SELL"&&s.position?.stopOrderId){
      const so=await api.query(s.config.symbol,s.position.stopOrderId).catch(()=>null);
      if(so?.status==="FILLED"){await this.bookStopFill(s,so,"stop-exchange");await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return}
      try{await api.cancel(s.config.symbol,s.position.stopOrderId)}catch(e){}
      s.position.stopOrderId=null;
    }
    let order={symbol:s.config.symbol,side,type:"MARKET",newOrderRespType:"FULL"};
    if(side==="BUY"){
      const spend=orderOpts.notional??Math.min(MAX_QUOTE,s.config.budget*.1,free("USDT")*.99);
      if(spend<Math.max(5,minNotional))throw new Error("Insufficient USDT or below Binance minimum notional");
      order.quoteOrderQty=spend.toFixed(2);
    }else{
      const lot=symbol.filters?.find(x=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0)||symbol.filters?.find(x=>x.filterType==="LOT_SIZE");
      if(!lot)throw new Error("Binance lot filter missing");
      const qty=floorStep(Math.min(s.position.qty,free(asset)),lot.stepSize);
      // P1(d): SELL minimum comes from exchange filters, not a hardcoded 5.
      if(Number(qty)<Number(lot.minQty)||Number(qty)*price<minNotional)throw new Error("Position below sellable Binance lot size; manual review needed");
      order.quantity=qty;
    }
    // Risk layer: no order leaves without vetOrder() allowing it.
    const stopPct=params.stopPct??0.03;
    const vet=vetOrder({side,symbol:s.config.symbol,
      notional:side==="BUY"?Number(order.quoteOrderQty):undefined,
      qty:side==="SELL"?Number(order.quantity):undefined,
      price,stopPrice:side==="BUY"?price*(1-stopPct):undefined},this.riskView(s,price));
    if(!vet.allowed){s.error=`Risk veto (${vet.reason}); order blocked.`;if(vet.manualReviewRequired)s.risk.manualReviewRequired=true;await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return}
    const id=`ab${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g,"").slice(0,12)}`;
    order.newClientOrderId=id;
    s.pending={id,side,at:Date.now(),reason,price,quote:side==="BUY"?Number(order.quoteOrderQty):null,quantity:side==="SELL"?Number(order.quantity):null};await this.put(s);
    s.risk.lastOrderAt=Date.now();
    try{await api.order(order)}catch(e){
      s.error="Order outcome uncertain; checking Binance by client order ID.";await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return;
    }
    await this.reconcile(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);
  }
  // Bounded-grid execution: one LIMIT order per level, per-level TP on fill,
  // global stop closes everything when the range breaks.
  async gridTick(s,api,price,all){
    const plan=boundedGridPlan(all,price,s.risk.equity||s.config.budget);
    const info=await api.exchangeInfo(s.config.symbol),symbol=info.symbols?.[0];
    if(symbol?.status!=="TRADING"||!symbol?.isSpotTradingAllowed)throw new Error("Spot symbol is unavailable");
    const lot=symbol.filters?.find(x=>x.filterType==="LOT_SIZE")||symbol.filters?.find(x=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0);
    const tickF=symbol.filters?.find(x=>x.filterType==="PRICE_FILTER"),tick=tickF?.tickSize||"0.00000001";
    const g=s.grid;
    const newId=()=>`ab${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g,"").slice(0,12)}`;
    if(g){
      if(price<g.globalStopLow||price>g.globalStopHigh){
        s.lastSignal="grid:range-break";
        await this.closeGrid(s,api,lot);
        await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return;
      }
      for(const lv of g.levels){
        if(!lv.buyFilled&&!lv.dead){
          const oid=lv.buyOrderId||lv.buyUncertain;
          if(oid){
            const o=await api.query(s.config.symbol,oid).catch(()=>null);
            if(o?.status==="FILLED"){
              lv.buyFilled=true;lv.fillPrice=Number(o.cummulativeQuoteQty)/Number(o.executedQty);
              const tpQty=floorStep(Number(o.executedQty),lot.stepSize),tpId=newId();
              const vet=vetOrder({side:"SELL",symbol:s.config.symbol,qty:Number(tpQty),price:lv.tpPrice},this.riskView(s,price));
              if(vet.allowed){
                try{await api.order({symbol:s.config.symbol,side:"SELL",type:"LIMIT",quantity:tpQty,price:floorStep(lv.tpPrice,tick),timeInForce:"GTC",newClientOrderId:tpId});lv.tpOrderId=tpId;s.risk.lastOrderAt=Date.now()}
                catch(e){lv.tpUncertain=tpId}
              }
            }else if(o&&["CANCELED","REJECTED","EXPIRED"].includes(o.status))lv.dead=true;
          }
        }
        if(lv.buyFilled&&!lv.tpFilled){
          const oid=lv.tpOrderId||lv.tpUncertain;
          if(oid){
            const o=await api.query(s.config.symbol,oid).catch(()=>null);
            if(o?.status==="FILLED"){
              lv.tpFilled=true;
              const pnl=(Number(o.cummulativeQuoteQty)-lv.fillPrice*Number(o.executedQty));
              s.dayPnl+=pnl;if(pnl<0)s.risk.lastLossAt=Date.now();s.risk.tradesToday++;
              s.journal=[...(s.journal||[]),
                {id:lv.buyOrderId,at:Date.now(),side:"BUY",reason:"grid-level",qty:Number(o.executedQty),quote:lv.fillPrice*Number(o.executedQty),price:lv.fillPrice},
                {id:oid,at:Date.now(),side:"SELL",reason:"grid-tp",qty:Number(o.executedQty),quote:Number(o.cummulativeQuoteQty),price:Number(o.cummulativeQuoteQty)/Number(o.executedQty),pnl}].slice(-200);
            }
          }
        }
      }
      s.lastSignal=`grid:active ${g.levels.filter(l=>l.tpFilled).length}/${g.levels.length} closed`;
      await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);return;
    }
    if(plan.allowed&&!s.position&&!s.pending){
      const levels=[];
      for(const L of plan.levels){
        const qty=floorStep(L.notional/L.price,lot.stepSize);
        if(Number(qty)<Number(lot.minQty))continue;
        const vet=vetOrder({side:"BUY",symbol:s.config.symbol,notional:L.notional,price:L.price,stopPrice:L.price*0.95},this.riskView(s,price));
        if(!vet.allowed){s.error=`Grid level blocked by risk (${vet.reason}).`;continue}
        const id=newId();
        try{
          await api.order({symbol:s.config.symbol,side:"BUY",type:"LIMIT",quantity:qty,price:floorStep(L.price,tick),timeInForce:"GTC",newClientOrderId:id});
          levels.push({...L,qty:Number(qty),buyOrderId:id,buyFilled:false,tpOrderId:null,tpFilled:false});
          s.risk.lastOrderAt=Date.now();
        }catch(e){levels.push({...L,qty:Number(qty),buyUncertain:id,buyFilled:false});s.error="Grid order outcome uncertain; reconcile."}
      }
      if(levels.length)s.grid={levels,globalStopLow:plan.globalStopLow,globalStopHigh:plan.globalStopHigh,createdAt:Date.now(),stepPct:plan.stepPct};
      s.lastSignal=`grid:placed ${levels.length} levels`;
      await this.put(s);
    }else s.lastSignal="grid:"+plan.reason;
    await this.put(s);await this.ctx.storage.setAlarm(Date.now()+TICK_MS);
  }
  async closeGrid(s,api,lot){
    const g=s.grid;if(!g)return;
    for(const lv of g.levels){
      if(!lv.buyFilled&&!lv.dead&&(lv.buyOrderId||lv.buyUncertain)){try{await api.cancel(s.config.symbol,lv.buyOrderId||lv.buyUncertain)}catch(e){}}
      if(lv.buyFilled&&!lv.tpFilled&&(lv.tpOrderId||lv.tpUncertain)){try{await api.cancel(s.config.symbol,lv.tpOrderId||lv.tpUncertain)}catch(e){}}
      if(lv.buyFilled&&!lv.tpFilled){
        try{
          const account=await api.account(),asset=s.config.symbol.replace("USDT",""),free=Number(account.balances?.find(x=>x.asset===asset)?.free||0);
          const qty=floorStep(Math.min(lv.qty,free),lot.stepSize);
          if(Number(qty)>=Number(lot.minQty)){
            const id=`ab${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g,"").slice(0,12)}`;
            const r=await api.order({symbol:s.config.symbol,side:"SELL",type:"MARKET",quantity:qty,newClientOrderId:id,newOrderRespType:"FULL"});
            const q=Number(r.executedQty||qty),qq=Number(r.cummulativeQuoteQty||q*lv.fillPrice),pnl=qq-lv.fillPrice*q;
            s.dayPnl+=pnl;
            s.journal=[...(s.journal||[]),{id,at:Date.now(),side:"SELL",reason:"grid-range-break",qty:q,quote:qq,price:qq/q,pnl}].slice(-200);
          }
        }catch(e){s.error="Grid close failed for a level; reconcile manually."}
      }
    }
    s.grid=null;
  }
}
