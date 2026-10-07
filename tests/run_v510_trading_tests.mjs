import path from "node:path";import {fileURLToPath} from "node:url";
import {BotEngine,BinanceApi,botConfig,signQuery,assertLiveGate,floorStep,tradeMetrics} from "../binance-bot/engine.mjs";
import {vetOrder,validateAveraging,positionSize,assessFinishedDay,initialRisk,RISK_DEFAULTS,nextUtcMidnight} from "../binance-bot/risk.mjs";
import {ema,rsi,atr,adx,sma,stdev} from "../binance-bot/indicators.mjs";
import {detectRegime,boundedGridPlan,trendFollowSignal,dcaStep,dcaOnFill,validateStrategyConfig} from "../binance-bot/strategies.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),ok=(c,m)=>{if(!c)throw Error("FAIL "+m);console.log("PASS",m)};
const env={BINANCE_TESTNET_API_KEY:"mock-key",BINANCE_TESTNET_API_SECRET:"mock-secret"};
const NOW=Date.now();

// 1. HMAC-SHA256 known vector from the Binance spot docs
// (SIGNED endpoint security: HMAC example).
const docsSecret="NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
const docsPayload="symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
ok(await signQuery(docsSecret,docsPayload)==="c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71","HMAC matches the Binance docs vector");

// 2. Quantity rounding to the exchange lot step.
ok(floorStep(0.123456,"0.0001")==="0.1234","floorStep rounds down to step");
ok(floorStep(1.99999,"0.01")==="1.99","floorStep 0.01");
ok(floorStep(0.00001234,"0.00001")==="0.00001","floorStep tiny step");
ok(floorStep(100,"1")==="100","floorStep integer step");
let bad=false;try{floorStep(1,"0")}catch(e){bad=true}ok(bad,"floorStep rejects zero step");

// 3. Risk layer.
ok(Math.abs(positionSize(10000,100,97)-33.333333)<1e-6,"positionSize = 1% capital / stop distance");
ok(!validateAveraging(2.0,3).allowed&&validateAveraging(2.0,3).reason==="MARTINGALE_MULTIPLIER","martingale multiplier 2.0 vetoed");
ok(!validateAveraging(1.25,7).allowed&&validateAveraging(1.25,7).reason==="AVERAGING_COUNT","7 averaging steps vetoed");
ok(validateAveraging(1.25,5).allowed,"1.25x / 5 steps allowed");
const base={equity:100,peak:110,positions:[],halted:false,manualReviewRequired:false,pausedUntil:0,haltedUntil:0,lastOrderAt:0,lastLossAt:0,tradesToday:0};
ok(vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},base,undefined,NOW).allowed,"sane order passes");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:2,price:100},{...base,positions:[{symbol:"BTCUSDT",notional:9}]},undefined,NOW).allowed,"per-coin 10% cap enforced");
const vExp=vetOrder({side:"BUY",symbol:"BNBUSDT",notional:7,price:100},{...base,positions:[{symbol:"BTCUSDT",notional:8},{symbol:"ETHUSDT",notional:8},{symbol:"SOLUSDT",notional:8}]},undefined,NOW);
ok(!vExp.allowed&&vExp.reason==="TOTAL_EXPOSURE","total 30% exposure cap enforced");
const vDay=vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,haltedUntil:NOW+3600_000},undefined,NOW);
ok(!vDay.allowed&&vDay.reason==="DAILY_LOSS_HALT","-3% day halts new entries");
ok(vetOrder({side:"SELL",symbol:"BTCUSDT",qty:0.1,price:100},{...base,haltedUntil:NOW+3600_000},undefined,NOW).allowed,"exits stay allowed during daily halt");
const vDD=vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,equity:84},undefined,NOW);
ok(!vDD.allowed&&vDD.reason==="MAX_DRAWDOWN"&&vDD.manualReviewRequired,"-15% drawdown demands manual review");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,halted:true},undefined,NOW).allowed,"kill-switch blocks everything");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,lastOrderAt:NOW-30_000},undefined,NOW).allowed,"60s order cooldown");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,lastLossAt:NOW-5*60_000},undefined,NOW).allowed,"15min loss cooldown");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:5,price:100},{...base,tradesToday:20},undefined,NOW).allowed,"20 trades/day cap");
ok(!vetOrder({side:"BUY",symbol:"BTCUSDT",notional:50,price:100,stopPrice:97},{...base,equity:100},undefined,NOW).allowed,"oversized vs 1% risk vetoed");
let r2=assessFinishedDay(initialRisk(),"2026-09-26",-0.06,NOW);
r2=assessFinishedDay(r2,"2026-09-27",-0.055,NOW);
ok(r2.pausedUntil>NOW&&r2.pauseReason.includes("STREAK_LOSS"),"-5% two days in a row -> 7-day pause");
ok(nextUtcMidnight(NOW)>NOW&&new Date(nextUtcMidnight(NOW)).toISOString().endsWith("T00:00:00.000Z"),"halt lifts at 00:00 UTC");

// 4. Live triple gate.
bad=false;try{botConfig({mode:"live",symbol:"BTCUSDT",interval:"1h",budget:100,confirm:"LIVE"},env)}catch(e){bad=true}
ok(bad,"live blocked without BINANCE_LIVE_ENABLED");
bad=false;try{botConfig({mode:"live",symbol:"BTCUSDT",interval:"1h",budget:100},{...env,BINANCE_LIVE_ENABLED:"1"})}catch(e){bad=true}
ok(bad,"live blocked without typed LIVE confirm");
bad=false;try{new BinanceApi("live",env)}catch(e){bad=true}
ok(bad,"BinanceApi refuses live without the full gate");
bad=false;try{assertLiveGate("live",env,"LIVE")}catch(e){bad=true}
ok(bad,"assertLiveGate throws and logs on missing conditions");

// 5. Indicators on known values.
const e3=ema([1,2,3,4,5,6,7,8,9,10],3);
ok(Math.abs(e3.at(-1)-9)<1e-9,"EMA(3) of 1..10 ends at 9");
ok(e3[0]===null&&e3[1]===null&&Math.abs(e3[2]-2)<1e-9,"EMA warms up with SMA seed");
const r2v=rsi([10,12,11],2).at(-1);
ok(Math.abs(r2v-66.6666667)<1e-4,"RSI(2) hand-computed = 66.67");
ok(rsi([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],14).at(-1)===100,"all gains -> RSI 100");
ok(rsi([16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],14).at(-1)===0,"all losses -> RSI 0");
const atrCs=[{high:10,low:8,close:9},{high:11,low:9,close:10},{high:12,low:10,close:11}];
ok(Math.abs(atr(atrCs,2).at(-1)-2)<1e-9,"ATR(2) hand-computed = 2");
const adxCs=[{high:10,low:9,close:9.5},{high:11,low:10,close:10.5},{high:12,low:11,close:11.5},{high:13,low:12,close:12.5},{high:14,low:13,close:13.5}];
ok(Math.abs(adx(adxCs,2).at(-1)-100)<1e-9,"ADX(2) of a clean trend hand-computed = 100");
const flat=Array.from({length:60},(_,i)=>({high:100.1,low:99.9,close:100+((i*37)%5-2)*0.01}));
const trend=Array.from({length:60},(_,i)=>({high:i+10.5,low:i+9.5,close:i+10}));
ok(adx(flat,14).at(-1)<20,"flat market -> low ADX");
ok(adx(trend,14).at(-1)>25,"strong trend -> high ADX");
ok(Math.abs(sma([1,2,3,4],2).at(-1)-3.5)<1e-9,"SMA sanity");
ok(stdev([2,4,4,4,5,5,7,9])!==null&&Math.abs(stdev([2,4,4,4,5,5,7,9])-2)<1e-9,"stdev known value = 2");

// 6. Regime filter + strategies (synthetic).
const rangeCs=Array.from({length:800},(_,i)=>{const c=100+Math.sin(i/20)*3+((i*53)%7-3)*0.1;return{high:c+0.4,low:c-0.4,close:c,volume:10}});
const reg=detectRegime(rangeCs);
ok(reg.regime==="range"&&reg.adx<20,"sine market detected as range, ADX<20");
const plan=boundedGridPlan(rangeCs,100,10000);
ok(plan.allowed&&plan.levels.length>=6&&plan.levels.length<=12,"grid plan: up to 12 levels within range");
ok(plan.levels.every(l=>Math.abs(l.notional-10000*0.10/12)<1e-6),"grid levels are equal-sized (multiplier 1.0, no martingale)");
ok(plan.stepPct>=0.015&&plan.stepPct<=0.03,"grid step adapted from ATR into 1.5-3%");
ok(plan.levels.every((l,i,arr)=>i===0||l.price<arr[i-1].price),"grid levels descend");
ok(plan.levels.every(l=>l.tpPrice>l.price),"each level has a take-profit");
const chaosCs=rangeCs.map((c,i)=>i>780?{...c,high:c.high*1.5,low:c.low*0.5,close:c.close*1.3}:c);
ok(detectRegime(chaosCs).regime==="chaos","volatility spike -> chaos, entries paused");
const tfCs=Array.from({length:120},(_,i)=>{const c=i<60?100:100+(i-60)*0.8;return{open:c,high:c+0.3,low:c-0.3,close:c,volume:i<60?10:40}});
const tf=trendFollowSignal(tfCs);
ok(["buy","hold"].includes(tf.signal)&&tf.rsi>0,"trend-follow signal computed");
let d=dcaStep({price:100,dca:null,capital:10000,now:NOW,regime:"range"});
ok(d.action==="buy"&&Math.abs(d.notional-700)<1e-9,"DCA base = 7% of capital");
d.dca=dcaOnFill(d.dca,{side:"buy",price:100,qty:7});
let d2=dcaStep({price:97.9,dca:d.dca,capital:10000,now:NOW,regime:"range"});
ok(d2.action==="buy"&&d2.reason==="DCA_SAFETY"&&Math.abs(d2.notional-700*1.25)<1e-6,"DCA safety order 1.25x at -2%");
d2.dca=dcaOnFill(d2.dca,{side:"buy",price:97.9,qty:d2.notional/97.9});
ok(Math.abs(d2.dca.avgPrice-(700+875)/(7+875/97.9))<1e-6,"DCA average price tracked");
const d3=dcaStep({price:d2.dca.avgPrice*1.03,dca:d2.dca,capital:10000,now:NOW,regime:"range"});
ok(d3.action==="sell-all"&&d3.reason==="DCA_TAKE","DCA takes profit at +2.5% avg");
const d4=dcaStep({price:79,dca:d2.dca,capital:10000,now:NOW,regime:"range"});
ok(d4.action==="sell-all"&&d4.reason==="DCA_HARD_STOP","DCA hard stop at -20% from first entry");
ok(!validateStrategyConfig("nope").ok,"unknown strategy rejected");
ok(validateStrategyConfig("conservative-dca",{stopPct:0.2}).ok&&validateStrategyConfig("conservative-dca",{stopPct:99}).error,"strategy params validated");

// 7. Engine: reconcile clears a phantom pending; stop-all; metrics; set-strategy.
const store=new Map(),ctx={storage:{get:async k=>store.get(k),put:async(k,v)=>store.set(k,structuredClone(v)),setAlarm:async t=>store.set("alarm",t),deleteAlarm:async()=>store.delete("alarm")}};
const engine=new BotEngine(ctx,env);
const req=body=>new Request("https://internal/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||"GET";
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()});
    if(u.includes("/api/v3/openOrders")&&method==="GET")return Response.json([]);
    if(u.includes("/api/v3/order")&&method==="GET")return Response.json({code:-2013},{status:400});
    if(u.includes("/api/v3/account"))return Response.json({canTrade:true,balances:[{asset:"USDT",free:"100",locked:"0"},{asset:"BTC",free:"0",locked:"0"}]});
    throw Error("Unexpected endpoint "+u);
  };
  await engine.put({status:"reconciling",config:{mode:"testnet",symbol:"BTCUSDT",interval:"1h",budget:100},journal:[],position:null,
    pending:{id:"ghost-1",side:"BUY",at:NOW},lastCandle:0,lastTick:null,day:"",dayTrades:0,daySpend:0,dayPnl:0,error:null,
    strategy:{name:"signal",params:{}},risk:initialRisk(),dca:null,grid:null,equityCurve:[],pausedBy:"error"});
  let res=await engine.fetch(req({action:"reconcile"}));
  let out=await res.json();
  ok(res.status===200&&out.report.clearedPending===true,"reconcile clears pending missing from the exchange");
  let st=await engine.state();
  ok(st.pending===null&&st.status==="running","reconcile unpauses when the position is closed");
  // user pause is respected by reconcile
  st.pausedBy="user";st.status="paused";await engine.put(st);
  res=await engine.fetch(req({action:"reconcile"}));
  st=await engine.state();
  ok(st.status==="paused","deliberate user pause survives reconcile");

  // stop-all kill switch
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||"GET";
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()});
    if(u.includes("/api/v3/openOrders")&&method==="DELETE")return Response.json([{symbol:"BTCUSDT"}]);
    if(u.includes("/exchangeInfo"))return Response.json({symbols:[{status:"TRADING",isSpotTradingAllowed:true,filters:[{filterType:"LOT_SIZE",stepSize:"0.00001",minQty:"0.00001"}]}]});
    if(u.includes("/api/v3/account"))return Response.json({canTrade:true,balances:[{asset:"USDT",free:"100",locked:"0"},{asset:"BTC",free:"0.1",locked:"0"}]});
    if(u.includes("/api/v3/order")&&method==="POST"){const b=String(opts.body);if(!b.includes("side=SELL")||!b.includes("type=MARKET"))throw Error("stop-all must market-sell");return Response.json({status:"FILLED",executedQty:"0.1",cummulativeQuoteQty:"10"})}
    throw Error("Unexpected endpoint "+u);
  };
  st=await engine.state();
  st.status="running";st.position={qty:0.1,entry:100,cost:10};st.risk.halted=false;await engine.put(st);
  res=await engine.fetch(req({action:"stop-all"}));
  out=await res.json();
  st=await engine.state();
  ok(res.status===200&&out.ok&&st.risk.halted===true&&st.risk.haltReason==="STOP_ALL"&&st.position===null&&st.status==="stopped","stop-all cancels, market-closes and halts");
  // live stop-all needs typed confirm
  st.config.mode="live";await engine.put(st);
  res=await engine.fetch(req({action:"stop-all"}));
  ok(res.status===400,"live stop-all without confirm is refused");
  st.config.mode="testnet";st.risk.halted=false;await engine.put(st);

  // set-strategy
  res=await engine.fetch(req({action:"set-strategy",strategy:"conservative-dca",params:{stopPct:0.2}}));
  ok(res.status===200&&(await res.json()).strategy==="conservative-dca","set-strategy switches");
  res=await engine.fetch(req({action:"set-strategy",strategy:"nope"}));
  ok(res.status===400,"set-strategy rejects unknown names");
  st=await engine.state();st.position={qty:0.1,entry:100,cost:10};await engine.put(st);
  res=await engine.fetch(req({action:"set-strategy",strategy:"signal"}));
  ok(res.status===409,"set-strategy blocked with open position");

  // metrics contract
  st=await engine.state();st.position=null;
  st.journal=[{id:"a",at:Date.parse("2026-09-20T10:00:00Z"),side:"BUY",qty:1,quote:100,price:100},
    {id:"a",at:Date.parse("2026-09-21T10:00:00Z"),side:"SELL",qty:1,quote:110,price:110,pnl:10},
    {id:"b",at:Date.parse("2026-09-22T10:00:00Z"),side:"BUY",qty:1,quote:100,price:100},
    {id:"b",at:Date.parse("2026-09-23T10:00:00Z"),side:"SELL",qty:1,quote:95,price:95,pnl:-5}];
  st.equityCurve=[{day:"2026-09-20",equity:100},{day:"2026-09-21",equity:110},{day:"2026-09-22",equity:110},{day:"2026-09-23",equity:105}];
  st.risk.equity=105;st.risk.peak=110;st.dayPnl=5;st.dayTrades=2;st.config.budget=100;st.lastPrice=105;
  await engine.put(st);
  res=await engine.fetch(new Request("https://internal/metrics"));
  const m=(await res.json()).metrics;
  const keys=["winRate","profitFactor","sharpe","maxDrawdown","calmar","avgWin","avgLoss","currentDrawdown","dailyPnl","dailyPnlLimit","tradesToday","monthlyPnl","equityCurve","openPositions"];
  ok(res.status===200&&keys.every(k=>k in m),"metrics contract has every dashboard field");
  ok(Math.abs(m.winRate-0.5)<1e-9&&m.avgWin===10&&m.avgLoss===5,"metrics computed from journal");
  ok(m.monthlyPnl["2026-09"]===5,"monthly PnL aggregated");
  ok(Math.abs(m.dailyPnlLimit-(-3))<1e-9,"daily PnL limit = -3% of budget");

  // rate-limit backoff then halt
  let calls=0;
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()});
    if(u.includes("/api/v3/account")){calls++;return new Response(JSON.stringify({code:-1003}),{status:429,headers:{"retry-after":"0"}})}
    throw Error("Unexpected "+u);
  };
  const api=new BinanceApi("testnet",env);api.maxAttempts=2;
  bad=false;try{await api.account()}catch(e){bad=e.haltRisk===true}
  ok(bad&&calls===3,"429 backoff retries then halts with reason");

  // time sync offset is applied to signed requests
  let seenTs=0;
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||"GET";
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()+8000});
    if(u.includes("/api/v3/account")){seenTs=Number(new URL(u).searchParams.get("timestamp"));return Response.json({canTrade:true,balances:[]})}
    throw Error("Unexpected "+u);
  };
  const api2=new BinanceApi("testnet",env);
  await api2.account();
  ok(Math.abs(seenTs-(Date.now()+8000))<3000,"signed requests use the exchange time offset");
}finally{globalThis.fetch=originalFetch}
console.log("v5.10 trading suite complete");
