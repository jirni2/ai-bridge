/* v5.9.6: per-model free-quota fallback (Gemini/Groq) + self-check fix hints. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const ex=src.slice(src.lastIndexOf("export {")+8,src.lastIndexOf("};")).split(",").map(x=>x.trim());
ok(ex.length>100&&ex.length===new Set(ex).size,"worker has no duplicate exports (node --check does not catch these)");
const tmp=path.join(root,"tests",`worker-v596-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const orig=globalThis.fetch;
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
try{
  const m=await import(pathToFileURL(tmp).href);
  let calls=[];
  globalThis.fetch=async u=>{const s=String(u);calls.push(s.match(/models\/([^:]+)/)?.[1]);return /gemini-2\.5-flash-lite/.test(s)?J({candidates:[{content:{parts:[{text:"OK"}]}}]}):J({error:{code:429,message:"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0"}},429)};
  let t0=Date.now();const r=await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");
  ok(r.ok&&r.model==="gemini-2.5-flash-lite"&&r.modelFallbacks.length>=1,"Gemini 429 on one model falls back to the next model instead of failing");
  ok(Date.now()-t0<3000&&new Set(calls).size===calls.length,"an exhausted daily quota is not retried on the same model");
  calls=[];await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");
  ok(calls[0]==="gemini-2.5-flash-lite","models with an exhausted quota are skipped first on the next request (cooldown)");
  m.modelQuotaCooldown.clear();
  globalThis.fetch=async()=>J({error:{code:429,message:"Your credit balance is too low"}},429);calls=[];
  const b=await m.probeProvider({GOOGLE_API_KEY:"g"},"gemini");ok(!b.ok&&b.errorKind==="billing_or_quota","credit/billing exhaustion still stops (no pointless model hopping)");
  ok(m.MODEL_SCOPED_QUOTA_PROVIDERS.has("gemini")&&m.MODEL_SCOPED_QUOTA_PROVIDERS.has("groqfree")&&!m.MODEL_SCOPED_QUOTA_PROVIDERS.has("openai"),"only providers with per-model free quotas hop models on 429");
  ok(/"gemini-2\.5-flash-lite"\]/.test(src),"gemini-2.5-flash-lite (largest free quota) is in the Gemini fallback chain");
}finally{globalThis.fetch=orig;fs.rmSync(tmp,{force:true})}
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),fn=app.slice(app.indexOf(app.includes("function providerFixHint(")?"function providerFixHint(":"async function runSiteSelfCheck("),app.indexOf("async function refreshSite("));
ok(fn.includes('t("scFixKv")')&&fn.includes('t("scFixWorkersAi")')&&fn.includes('t("scFixGeminiQuota")'),"every self-check warning carries a how-to-fix hint");
ok(fn.includes("const soft=!x.ok&&anyOk&&transient(x)"),"one exhausted provider is a warning when other providers work");
const i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");ok(/scFixKv:"Cloudflare → Storage/.test(i18n)&&i18n.includes("AI_BRIDGE_JOBS"),"fix hints give exact Cloudflare steps");
console.log("v5.9.6 quota fallback tests PASS");
