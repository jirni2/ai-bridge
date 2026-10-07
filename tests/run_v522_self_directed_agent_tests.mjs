import fs from "node:fs";
import assert from "node:assert/strict";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v522-under-test.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
assert.equal(m.AGENT_CORE_DEFAULT_MODEL,"@cf/zai-org/glm-4.7-flash");
assert.deepEqual(m.agentControllerOrder(["gemini","groqfree","openrouter"]),["gemini","groqfree","openrouter"],"Compatibility helper order must not secretly reorder Gemini to the front");
assert.equal(m.agentCoreAvailable({AI:{run(){}}}),true);
assert.equal(m.agentCoreAvailable({GOOGLE_API_KEY:"g"}),true,"Gemini can supply decisions while AI Bridge retains runtime control");

// 1) Core finishes by itself: no external AI should be called merely because it exists.
let coreCalls=0,externalCalls=0;
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async()=>{externalCalls++;throw new Error("external provider should not be called")};
  const env={
    AI:{run:async(model,payload)=>{coreCalls++;assert.equal(model,"@cf/zai-org/glm-4.7-flash");return {choices:[{message:{content:'{"action":"finish","answer":"Core-only answer."}'}}]};}},
    GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"
  };
  const out=await m.runAgent(env,{task:"Answer directly",providerPrompt:"Answer directly",providerIds:["gemini","groqfree","openrouter"],maxSteps:3});
  assert.equal(out.final,"Core-only answer.");
  assert.equal(coreCalls,1);
  assert.equal(externalCalls,0,"Connected AIs are helpers, not automatic controllers/verifiers");
  assert.equal(out.meta.selfDirected,true);
  assert.equal(out.meta.agentCore,true);
  assert.equal(out.meta.delegations,0);
  assert.equal(out.meta.coreModel,"@cf/zai-org/glm-4.7-flash");

  // 2) Core explicitly decides it needs a Gemini specialist, then resumes control itself.
  coreCalls=0;externalCalls=0;let geminiCalls=0;
  globalThis.fetch=async(url,opts={})=>{
    externalCalls++;
    const u=String(url);
    if(!u.includes("generativelanguage.googleapis.com"))throw new Error(`unexpected external ${u}`);
    geminiCalls++;
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Specialist observation: the checked value is 42."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const env2={AI:{run:async()=>{coreCalls++;const text=coreCalls===1?'{"action":"delegate","provider":"gemini","task":"Check the supplied value independently."}':'{"action":"finish","answer":"Final answer: 42."}';return {choices:[{message:{content:text}}]};}},GOOGLE_API_KEY:"g"};
  const out2=await m.runAgent(env2,{task:"Check the value and answer",providerPrompt:"Known value may be 42",providerIds:["gemini"],maxSteps:3});
  assert.equal(out2.final,"Final answer: 42.");
  assert.equal(coreCalls,2,"Agent Core controls both decision steps");
  assert.equal(geminiCalls,1,"Gemini is used exactly once as a helper when Core requests it");
  assert.equal(out2.meta.delegations,1);
  assert.deepEqual(out2.meta.helperProviders,["gemini"]);
  assert.ok(out2.meta.agentTrace.some(x=>x.provider==="agent-core"&&x.action==="delegate"));

  // 3) Strict architecture: without AI binding, an external provider cannot silently become the brain.
  assert.equal(m.agentCoreTransport({GOOGLE_API_KEY:"g"}),"provider");
} finally {globalThis.fetch=originalFetch;fs.unlinkSync(tmp);}

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8"),i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8"),html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
assert.ok(!i18n.includes("Gemini Brain"),"UI must not describe Gemini as the brain");
assert.ok(i18n.includes("AI помічники"),"Ukrainian UI labels external models as helpers");
assert.ok(html.includes('data-i18n="agentBrain">AI помічники'),"Agent page shows helper semantics");
assert.ok(app.includes("ai_bridge_agent_helper_v522"),"New helper preference key avoids stale Gemini-brain selection");
console.log("Self-directed Agent Core v5.2.2 tests passed");
