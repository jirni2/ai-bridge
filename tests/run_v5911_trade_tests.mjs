import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
import {DEFAULTS,candles,signal,newPaper,paperStep,backtest,rsi} from "../trade-core.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(x,m)=>{if(!x)throw new Error("FAIL: "+m);console.log("PASS",m)};
const seq=Array.from({length:100},(_,i)=>{const p=100+(i<45?45-i:i-45)*.5;return [i*3600000,p,p+1,p-1,p,0,i*3600000+3599999]});
const c=candles(seq);ok(c.length===100&&rsi(c.map(x=>x.close))>=0,"validated candles and RSI");
ok(candles([[0,"NaN",1,1,1,0,1]]).length===0,"bad candles are discarded");
ok(signal(c.slice(0,21))==="hold","strategy waits for enough closed candles");
let paper=newPaper();paper=paperStep(paper,c.slice(0,60),c[60].open);const once=paperStep(paper,c.slice(0,60),c[60].open);ok(JSON.stringify(once)===JSON.stringify(paper),"duplicate candle cannot execute twice");
const entered={...newPaper(),position:{entry:100,qty:0.1,cost:10},cash:90};const stop=paperStep(entered,c.slice(0,60),96);ok(stop.position===null&&stop.trades[0].reason==="stop"&&stop.trades[0].pnl<0,"paper stop closes position and charges fee");
const bt=backtest(seq);ok(bt.candles===100&&bt.validation===30&&Number.isFinite(bt.equity),"backtest uses next open and reports holdout period");
let bad=false;try{newPaper({capital:0})}catch(e){bad=true}ok(bad,"invalid capital rejected");
const tmp=path.join(root,"tests",`worker-v5911-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);const originalFetch=globalThis.fetch;
try{
  const module=await import(pathToFileURL(tmp).href),worker=module.default,env={BRIDGE_ACCESS_TOKEN:"test-secret"},uri="https://bridge.test/api/trade/klines?symbol=BTCUSDT&interval=1h&limit=100";
  const old=await module.issueSessionToken({BRIDGE_ACCESS_TOKEN:"test-secret",SESSION_SIGNING_SECRET:"old-key"});
  ok(await module.verifySessionToken({BRIDGE_ACCESS_TOKEN:"test-secret",SESSION_SIGNING_SECRET:"new-key",SESSION_SIGNING_SECRET_PREVIOUS:"old-key"},old),"session secret can rotate with previous key during transition");
  ok(!await module.verifySessionToken({BRIDGE_ACCESS_TOKEN:"test-secret",SESSION_SIGNING_SECRET:"new-key"},old),"old session is rejected after previous key removed");
  ok(module.providerVaultSecrets({BRIDGE_ACCESS_TOKEN:"test-secret",SESSION_SIGNING_SECRET:"new-key",SESSION_SIGNING_SECRET_PREVIOUS:"old-key"}).includes("old-key"),"rotating session key retains mobile token vault decryption during transition");
  const call=(url,headers={})=>worker.fetch(new Request(url,{headers}),env,{});
  let res=await call(uri);ok(res.status===401,"market data requires Bridge authorization");
  res=await call(uri.replace("BTCUSDT","BADPAIR"),{authorization:"Bearer test-secret"});ok(res.status===400,"symbol allowlist prevents arbitrary upstream requests");
  res=await call(uri.replace("limit=100","limit=9999"),{authorization:"Bearer test-secret"});ok(res.status===400,"market response size is bounded");
  let upstream="";globalThis.fetch=async url=>{upstream=String(url);return new Response(JSON.stringify(seq),{status:200})};
  res=await call(uri,{authorization:"Bearer test-secret"});const j=await res.json();ok(res.status===200&&j.candles.length===100&&upstream.startsWith("https://data-api.binance.vision/api/v3/klines?"),"authenticated route fetches fixed Binance public endpoint");
  globalThis.fetch=async()=>new Response("rate",{status:429});res=await call(uri,{authorization:"Bearer test-secret"});ok(res.status===429&&(await res.json()).retryable,"Binance 429 is clear and retryable");
  globalThis.fetch=async()=>{throw Error("SECRET_VALUE")};res=await call(uri,{authorization:"Bearer test-secret"});ok(res.status===502&&!JSON.stringify(await res.json()).includes("SECRET_VALUE"),"upstream failure never leaks exception or credentials");
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");ok(html.includes('href="/trade/"')&&fs.existsSync(path.join(root,"trade/index.html")),"trade module is reachable in AI Bridge navigation");
}finally{globalThis.fetch=originalFetch;fs.rmSync(tmp,{force:true})}
