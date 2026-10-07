import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const worker=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);

assert.ok(worker.includes('const AGENT_CORE_PROVIDER_ORDER=["groqfree","openrouter","gemini","openai","grok","claude"]'),"Agent Core prefers free controller providers");
assert.equal(mod.agentCoreModel({GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"}),"openai/gpt-oss-120b","status reports the actual free-first core model");
const concise=mod.searchOnlyAnswer({query:"What is the capital of France?",directAnswer:"",results:[
  {title:"Paris",url:"https://example.com/paris",snippet:"Paris is the capital of France. "+"A".repeat(700)},
  {title:"France",url:"https://example.org/france",snippet:"This second long snippet must not be copied into the answer. "+"B".repeat(700)}
]});
assert.ok(concise.includes("Paris is the capital of France."),"search-only answer leads with a concise factual summary");
assert.ok(!concise.includes("This second long snippet"),"search-only answer does not dump every result snippet");
assert.ok(concise.length<800,"search-only answer remains compact while retaining source links");

const originalFetch=globalThis.fetch;
try{
  const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(String(url).includes("groq"))return new Response(JSON.stringify({choices:[{message:{content:'{"action":"finish","answer":"free controller completed"}'}}]}),{status:200,headers:{"content-type":"application/json"}});
    return new Response(JSON.stringify({error:{message:"paid/quota provider must not be called after a valid free answer"}}),{status:429,headers:{"content-type":"application/json"}});
  };
  const env={GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r",OPENAI_API_KEY:"o",ANTHROPIC_API_KEY:"a",XAI_API_KEY:"x"};
  const thought=await mod.agentCoreThink(env,"goal","system",700);
  assert.equal(thought.ok,true);
  assert.equal(thought.provider,"groqfree");
  assert.equal(thought.text.includes("free controller completed"),true);
  assert.equal(calls.length,1,"a valid free controller answer stops expensive fallback calls");
  assert.ok(calls[0].includes("groq"));
} finally {
  globalThis.fetch=originalFetch;
}

console.log("AI Bridge v5.7.1 free-first Agent Core and concise Search First tests passed (9 assertions).");
