import fs from "node:fs";
import assert from "node:assert/strict";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v520-under-test.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
assert.equal(m.AGENT_MAX_STEPS,4);
assert.deepEqual(m.parseAgentAction('{"action":"finish","answer":"Done"}'),{action:"finish",answer:"Done"});
assert.deepEqual(m.parseAgentAction('```json\n{"action":"delegate","provider":"gemini","task":"check this"}\n```'),{action:"delegate",task:"check this",provider:"gemini"});
assert.deepEqual(m.parseAgentAction('{"action":"search_web","query":"Cloudflare Agents","purpose":"find docs"}'),{action:"search_web",query:"Cloudflare Agents",purpose:"find docs"});
assert.equal(m.parseAgentAction('{"action":"shell","command":"rm -rf /"}'),null,"Agent must not expose arbitrary shell actions");
await assert.rejects(()=>m.agentFetchPublicUrl("https://127.0.0.1/private"),/not allowed|blocked|unsafe/i);
await assert.rejects(()=>m.agentFetchPublicUrl("http://example.com"),/HTTPS|unsafe/i);
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8"),html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
assert.ok(html.includes('value="agent"'));
assert.ok(html.includes('id="page-agent"'));
assert.ok(html.includes('data-page="agent"'));
assert.ok(html.includes('id="agentStartBtn"'));
assert.ok(app.includes("runAgentPage"));
assert.ok(app.includes("agentContext"));
assert.ok(src.includes('progress:rec?.progress||null'));

const originalFetch=globalThis.fetch;
try{
  // Core -> helper -> Core finish.
  let coreSeq=0,geminiCalls=0;
  const env={AI:{run:async()=>{coreSeq++;const text=coreSeq===1?'{"action":"delegate","provider":"gemini","task":"verify the key fact"}':'{"action":"finish","answer":"Final agent answer after verification."}';return {choices:[{message:{content:text}}]};}},GOOGLE_API_KEY:"g"};
  globalThis.fetch=async(url)=>{if(String(url).includes("generativelanguage.googleapis.com")){geminiCalls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"The key fact is verified by the helper."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}})}throw new Error(`unexpected fetch ${url}`)};
  const out=await m.runAgent(env,{task:"Check then answer",providerPrompt:"Check then answer",providerIds:["gemini"],maxSteps:3});
  assert.equal(out.final,"Final agent answer after verification.");
  assert.equal(out.meta.delegations,1);
  assert.equal(coreSeq,2);
  assert.equal(geminiCalls,1);

  // Core -> read-only web page -> Core finish.
  coreSeq=0;
  const env2={AI:{run:async()=>{coreSeq++;const text=coreSeq===1?'{"action":"fetch_url","url":"https://example.com/agent-page","purpose":"read the observed value"}':'{"action":"finish","answer":"The observed value is 42."}';return {choices:[{message:{content:text}}]};}}};
  globalThis.fetch=async(url)=>{if(String(url)==="https://example.com/agent-page")return new Response('<html><body><p>Observed value: 42.</p></body></html>',{status:200,headers:{"Content-Type":"text/html"}});throw new Error(`unexpected fetch ${url}`)};
  const webOut=await m.runAgent(env2,{task:"Read the page",providerPrompt:"Read the page",providerIds:[],maxSteps:3});
  assert.equal(webOut.final,"The observed value is 42.");
  assert.equal(webOut.meta.webFetches,1);
} finally {globalThis.fetch=originalFetch;fs.unlinkSync(tmp);}
console.log("Agent regression tests passed with self-directed Core");
