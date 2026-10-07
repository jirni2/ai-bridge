/* v5.9.7: Gemini "model overloaded" (5xx) hops to another model; hints match the real error. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const tmp=path.join(root,"tests",`worker-v597-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const orig=globalThis.fetch,J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
try{
  const m=await import(pathToFileURL(tmp).href);let calls=[];
  globalThis.fetch=async u=>{const s=String(u);calls.push(s.match(/models\/([^:]+)/)?.[1]);return /gemini-3\.7-flash/.test(s)?J({candidates:[{content:{parts:[{text:"OK"}]}}]}):J({error:{code:503,status:"UNAVAILABLE",message:"The model is overloaded. Please try again later."}},503)};
  const t0=Date.now(),r=await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");
  ok(r.ok&&r.model==="gemini-3.7-flash","Gemini 503 'model overloaded' falls back to the next Gemini model");
  ok(Date.now()-t0<3000&&calls.filter(x=>x==="gemini-3.8-flash").length===1,"the overloaded model is not retried with a delay first");
  calls=[];await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");ok(calls[0]==="gemini-3.7-flash","the overloaded model is skipped for a short cooldown");
  ok(!m.isModelOverloadError({status:499,cancelled:true})&&!m.isModelOverloadError({status:401,message:"unavailable"})&&m.isModelOverloadError({status:503,message:"x"}),"only real 5xx overloads count (not cancellations or auth errors)");
  m.modelQuotaCooldown.clear();
  globalThis.fetch=async()=>J({error:{code:503,message:"The model is overloaded."}},503);
  const all=await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");ok(!all.ok&&all.errorKind==="provider_unavailable","when every model is overloaded the provider reports a clean temporary error");
}finally{globalThis.fetch=orig;fs.rmSync(tmp,{force:true})}
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),fn=app.slice(app.indexOf("function providerFixHint("),app.indexOf("async function runSiteSelfCheck("));
const out=vm.runInNewContext(`const t=k=>k;${fn};[providerFixHint({provider:"gemini",status:503,errorKind:"provider_unavailable"}),providerFixHint({provider:"gemini",status:429,errorKind:"rate_limited"}),providerFixHint({provider:"groqfree",status:401,errorKind:"invalid_api_key"}),providerFixHint({provider:"openrouter",errorKind:"timeout"})]`);
ok(out[0]==="scFixGeminiOverload"&&out[1]==="scFixGeminiQuota"&&out[2]==="scFixKey"&&out[3]==="scFixTimeout","the how-to-fix hint follows the real error type");
console.log("v5.9.7 overload fallback tests PASS");
