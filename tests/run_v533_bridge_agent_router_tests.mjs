import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);

assert.equal(mod.agentCoreTransport({GOOGLE_API_KEY:"g"}),"provider");
assert.equal(mod.agentCoreAvailable({GROQ_API_KEY:"q"}),true);
assert.equal(mod.agentCoreAvailable({}),false);

const originalFetch=globalThis.fetch;
try{
  const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(String(url).includes("groq")){
      return new Response(JSON.stringify({choices:[{message:{content:"not valid action json"}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(String(url).includes("generativelanguage")){
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"action":"finish","answer":"Bridge fallback worked"}'}]}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(String(url).includes("openrouter")){
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"not valid action json"}]}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    return new Response(JSON.stringify({choices:[{message:{content:'{"action":"finish","answer":"Bridge fallback worked"}'}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  const env={GOOGLE_API_KEY:"g",GROQ_API_KEY:"q"};
  const thought=await mod.agentCoreThink(env,"goal","system",700);
  assert.equal(thought.ok,true);
  assert.equal(thought.provider,"gemini");
  assert.equal(thought.transport,"provider");
  assert.ok(calls.some(x=>x.includes("generativelanguage"))&&calls.some(x=>x.includes("groq")),"invalid free planner JSON triggers provider fallback");
  const run=await mod.runAgent(env,{task:"finish",providerPrompt:"finish",providerIds:["gemini","groqfree"],maxSteps:2});
  assert.equal(run.final,"Bridge fallback worked");
  assert.equal(run.meta.coreTransport,"provider");
  assert.equal(run.meta.selfDirected,true);
} finally {
  globalThis.fetch=originalFetch;
}

console.log("AI Bridge v5.3.3 provider-routed Agent regression tests passed.");
