import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v488-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const auth="bridge-secret-token";
const request=body=>new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},body:JSON.stringify(body)});

const source=`async function encodeProviderVault(tokens,env){
  const packed=new Uint8Array(16);
  return b64urlBytes(packed);
}

function unrelated(){ return true; }

function b64urlBytes(bytes){
  return "encoded";
}`;
const fileContext=`<attached_files>\n<file path="_worker.js">\n${source}\n</file>\n</attached_files>`;
const task="Проведи аудит коду, знайди критичні помилки та вразливості.";
const falseClaim="`b64urlBytes` is not defined, so encodeProviderVault can throw ReferenceError.";
const originalFetch=globalThis.fetch;
try{
  let normalGemini=0,normalOpenRouter=0,judgeCalls=0;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url),body=JSON.parse(opts.body||"{}");
    if(u.includes("generativelanguage.googleapis.com")){
      const judge=body.generationConfig?.responseMimeType==="application/json";
      if(judge){
        judgeCalls++;
        const payload={summary:"review",findings:[{
          claim:falseClaim,file:"_worker.js",symbol:"encodeProviderVault",
          code_evidence:"  return b64urlBytes(packed);",confidence:"high",verdict:"supported",
          verification_reason:"The call appears before the helper declaration."
        }]};
        return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(payload)}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      normalGemini++;
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:`Критична проблема: ${falseClaim}`}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(u.includes("openrouter.ai")){
      normalOpenRouter++;
      return new Response(JSON.stringify({choices:[{message:{content:`Можлива проблема: ${falseClaim}`}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    throw new Error("unexpected URL "+u);
  };
  const env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",OPENROUTER_API_KEY:"r",ASSETS:{fetch:async()=>new Response("asset")}};
  const res=await m.default.fetch(request({prompt:task,displayPrompt:task,fileContext,mode:"auto",synthesize:true,judge:"auto"}),env);
  const body=await res.json();
  assert.equal(res.status,200);
  assert.equal(body.meta?.verifiedFileAudit,true,"Auto code audit should use evidence-guarded synthesis");
  assert.ok(normalGemini>=1&&normalOpenRouter>=1&&judgeCalls>=1,"two reviewers plus a Judge must run");
  assert.equal(body.structured?.findings?.[0]?.deterministically_rejected,true,"undefined-symbol hallucination must be rejected when a hoisted declaration exists");
  assert.match(body.final,/Підтверджених дефектів або вразливостей[^]*не знайдено/i);
  assert.match(body.final,/НЕ показується як дефект/i);
  assert.doesNotMatch(body.final,/`b64urlBytes` is not defined/i,"rejected/unverified hallucination should not be echoed in the user-facing findings");
  assert.doesNotMatch(body.final,/Підтверджені знахідки[^]*- `b64urlBytes` is not defined[^]*Код:/i,"false ReferenceError must not be presented as a supported defect");

  // Client self-audit regression: v4.8.7's _worker.js is ~150k chars. The old
  // 70k head-only cap hid later declarations and caused exactly this false positive.
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
  assert.match(app,/const MAX_FILE_CHARS=180000;/,"large primary source files should no longer be chopped at 70k chars");
  assert.ok(app.includes("sampleLargeFileText"),"oversized files must preserve head + middle + tail instead of head-only truncation");
  assert.ok(app.includes("LARGE FILE SAMPLE"),"large-file sampling should make omissions explicit to reviewers");
} finally {
  globalThis.fetch=originalFetch;
  try{fs.unlinkSync(tmp)}catch{}
}
console.log("AI Bridge v4.8.8 verified-audit regression tests passed");
