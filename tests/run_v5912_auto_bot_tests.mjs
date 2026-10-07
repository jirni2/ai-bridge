import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
import {BotEngine,BinanceApi,botConfig,publicState,floorStep} from "../binance-bot/engine.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),ok=(c,m)=>{if(!c)throw Error("FAIL "+m);console.log("PASS",m)};
const env={BINANCE_TESTNET_API_KEY:"mock-key",BINANCE_TESTNET_API_SECRET:"mock-secret",BINANCE_LIVE_API_KEY:"live-key",BINANCE_LIVE_API_SECRET:"live-secret"};
const store=new Map(),ctx={storage:{get:async k=>store.get(k),put:async(k,v)=>store.set(k,structuredClone(v)),setAlarm:async t=>store.set("alarm",t),deleteAlarm:async()=>store.delete("alarm")}};
const engine=new BotEngine(ctx,env);let state=await engine.state();ok(state.status==="stopped"&&!state.pending,"durable bot begins stopped");
let bad=false;try{botConfig({mode:"live",symbol:"BTCUSDT",interval:"1h",budget:100,confirm:"LIVE"},env)}catch(e){bad=true}ok(bad,"live cannot start without server feature flag");
bad=false;try{botConfig({mode:"live",symbol:"BTCUSDT",interval:"1h",budget:100}, {...env,BINANCE_LIVE_ENABLED:"1"})}catch(e){bad=true}ok(bad,"live also needs explicit typed confirmation");
ok(botConfig({mode:"live",symbol:"BTCUSDT",interval:"1h",budget:100,confirm:"LIVE"},{...env,BINANCE_LIVE_ENABLED:"1"}).mode==="live","live configuration is available behind both guards");
bad=false;try{botConfig({mode:"testnet",symbol:"BAD",interval:"1h",budget:100},env)}catch(e){bad=true}ok(bad,"allowlist rejects arbitrary symbols");
ok(floorStep(.123456,"0.0001")==="0.1234","sell quantity rounds down to exchange step");
const req=body=>new Request("https://internal/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({canTrade:true});
let res=await engine.fetch(req({action:"verify",mode:"testnet",symbol:"BTCUSDT",interval:"1h",budget:100}));ok(res.status===200&&(await res.json()).verified,"Verify makes real signed account request without placing order");
res=await engine.fetch(req({action:"start",mode:"testnet",symbol:"BTCUSDT",interval:"1h",budget:100}));ok(res.status===200&&store.has("alarm")&&(await res.json()).status==="running","Start schedules a server alarm and stores mode");
res=await engine.fetch(new Request("https://internal/status"));ok((await res.json()).configured,"status shows credentials present without exposing values");
const now=Date.now(),rows=[];let p=100,x=54;
for(let i=0;i<60;i++){x=(x*1664525+1013904223)>>>0;p+=(x%100)/60-.83;let t=now-(60-i)*3600000;rows.push([t,p,p+.5,p-.5,p,0,t+3599999])}
rows.push([now,p,p+.5,p-.5,p,0,now+3599999]);let buyPosts=0,stopPosts=0,query=0,seenBody="",stopBody="";
try{
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||"GET";
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()});
    if(u.includes("/klines")){ok(!new Headers(opts.headers).has("X-MBX-APIKEY"),"public candle request does not transmit Binance key");return Response.json(rows)}
    if(u.includes("/exchangeInfo"))return Response.json({symbols:[{status:"TRADING",isSpotTradingAllowed:true,filters:[{filterType:"NOTIONAL",minNotional:"5"},{filterType:"LOT_SIZE",stepSize:"0.00001",minQty:"0.00001"}]}]});
    if(u.includes("/account"))return Response.json({canTrade:true,balances:[{asset:"USDT",free:"100"},{asset:"BTC",free:"0.1"}]});
    if(u.includes("/api/v3/order")&&method==="POST"){const b=String(opts.body);if(b.includes("type=STOP_LOSS_LIMIT")){stopPosts++;stopBody=b}else{buyPosts++;seenBody=b}return Response.json({status:"FILLED"})}
    if(u.includes("/order")&&method==="GET"){query++;return Response.json({status:"FILLED",executedQty:"0.1",cummulativeQuoteQty:"10"})}
    throw Error("Unexpected endpoint "+u);
  };
  await engine.alarm();state=await engine.state();ok(buyPosts===1&&stopPosts===1&&query===1&&state.position?.qty===.1&&state.journal.length===1&&state.position?.stopOrderId,"alarm executes signed Binance testnet order, reconciles fill and arms a native protective stop");
  ok(seenBody.includes("newClientOrderId=ab")&&seenBody.includes("signature=")&&!seenBody.includes("mock-secret"),"HMAC and client ID are sent without exposing secret");
  ok(stopBody.includes("type=STOP_LOSS_LIMIT")&&stopBody.includes("stopPrice=")&&stopBody.includes("timeInForce=GTC"),"protective STOP_LOSS_LIMIT is native with stop and limit prices");
  await engine.alarm();ok(buyPosts===1&&stopPosts===1,"repeated alarm cannot duplicate order on same candle");
  res=await engine.fetch(req({action:"pause"}));ok((await res.json()).status==="paused"&&!store.has("alarm"),"Pause cancels future alarm");
  const before=buyPosts+stopPosts;await engine.alarm();ok(buyPosts+stopPosts===before,"paused bot places no orders");
  state=await engine.state();state.pending={id:"ambiguous-id",side:"BUY",at:now};state.status="reconciling";await engine.put(state);
  globalThis.fetch=async()=>Response.json({code:-2013}, {status:400});await engine.alarm();state=await engine.state();ok(state.pending?.id==="ambiguous-id"&&state.status==="reconciling","unknown exchange outcome fails closed and never repeats POST");
  res=await engine.fetch(req({action:"start",mode:"testnet",symbol:"BTCUSDT",interval:"1h",budget:100}));ok(res.status===409,"restart blocked while ambiguous order exists");
  const st2=new Map(),ctx2={storage:{get:async k=>st2.get(k),put:async(k,v)=>st2.set(k,structuredClone(v)),setAlarm:async t=>st2.set("alarm",t),deleteAlarm:async()=>st2.delete("alarm")}},bot2=new BotEngine(ctx2,env);
  await bot2.put({...await bot2.state(),status:"running",config:{mode:"testnet",symbol:"BTCUSDT",interval:"1h",budget:100}});
  let lostPosts=0,stopPosts2=0,queries=0;
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url),method=opts.method||"GET";
    if(u.includes("/api/v3/time"))return Response.json({serverTime:Date.now()});
    if(u.includes("/klines"))return Response.json(rows);
    if(u.includes("/exchangeInfo"))return Response.json({symbols:[{status:"TRADING",isSpotTradingAllowed:true,filters:[{filterType:"NOTIONAL",minNotional:"5"},{filterType:"LOT_SIZE",stepSize:"0.00001",minQty:"0.00001"}]}]});
    if(u.includes("/account"))return Response.json({canTrade:true,balances:[{asset:"USDT",free:"100"}]});
    if(u.includes("/api/v3/order")&&method==="POST"){if(String(opts.body).includes("type=STOP_LOSS_LIMIT")){stopPosts2++;return Response.json({status:"NEW"})}lostPosts++;throw Error("Connection lost after exchange accepted order")}
    if(u.includes("/order")&&method==="GET"){queries++;return Response.json({status:"FILLED",executedQty:"0.1",cummulativeQuoteQty:"10"})}
    throw Error("Unexpected request");
  };
  await bot2.alarm();ok(lostPosts===1&&(await bot2.state()).pending?.id,"lost POST response keeps durable pending intent");
  await bot2.alarm();const recovered=await bot2.state();ok(lostPosts===1&&stopPosts2===1&&queries===1&&recovered.pending===null&&recovered.position?.qty===.1&&recovered.position?.stopOrderId,"recovery queries exchange, never repeats the order POST, and arms the protective stop");
}finally{globalThis.fetch=originalFetch}
ok(!JSON.stringify(publicState(await engine.state(),env)).includes("mock-secret"),"status never returns API secret");

const tmp=path.join(root,"tests",`worker-v5912-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
try{const w=(await import(pathToFileURL(tmp).href)).default,base="https://bridge.test/api/trade/bot",bridge={BRIDGE_ACCESS_TOKEN:"tok"};
  res=await w.fetch(new Request(base),bridge,{});ok(res.status===401,"Pages bot route requires Bridge login");
  res=await w.fetch(new Request(base,{headers:{Authorization:"Bearer tok"}}),bridge,{});ok(res.status===503,"missing Durable Object binding is explicit");
  const bound={...bridge,TRADE_BOT:{idFromName:()=>"one",get:()=>({fetch:r=>engine.fetch(r)})}};
  res=await w.fetch(new Request(base+"/command",{method:"POST",headers:{Authorization:"Bearer tok","Content-Type":"application/json"},body:'{"action":"stop"}'}),bound,{});ok(res.status===403,"trading command refuses missing Origin even with bearer token");
  res=await w.fetch(new Request(base+"/command",{method:"POST",headers:{Authorization:"Bearer tok",Origin:"https://bridge.test","Content-Type":"application/json"},body:'{"action":"stop"}'}),bound,{});ok(res.status===200,"same-origin authenticated command reaches coordinator");
  ok((await w.fetch(new Request("https://bridge.test/binance-bot/worker.mjs"),{ASSETS:{fetch:()=>new Response("leak")}},{})).status===404,"bot source and Wrangler config blocked from public Pages assets");
}finally{fs.rmSync(tmp,{force:true})}
