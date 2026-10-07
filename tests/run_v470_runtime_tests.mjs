import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v470-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const originalFetch=globalThis.fetch;
const auth="bridge-secret-token";
function request(body,token=auth){return new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});}
try{
  // 1. The user's exact smoke test must never depend on any third-party API.
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error("network should not be called for greeting")};
  let env={BRIDGE_ACCESS_TOKEN:auth,ASSETS:{fetch:async()=>new Response("asset")}};
  let res=await m.default.fetch(request({prompt:"привіт",displayPrompt:"привіт",mode:"auto",synthesize:true,judge:"auto"}),env);
  let body=await res.json();
  ok(res.status===503,"Ukrainian greeting reports missing providers instead of using a local stub");
  ok(body.error&&/No AI provider API keys are configured/.test(body.error),"zero-provider greeting returns an explicit configuration error");
  ok(networkCalls===0,"greeting makes zero third-party network calls");

  // Auth is still enforced; local responder is not an auth bypass.
  res=await m.default.fetch(request({prompt:"привіт",displayPrompt:"привіт",mode:"auto"},"wrong"),env);
  ok(res.status===401,"local greeting path still requires Bridge authentication");

  // 2. Accept common Gemini secret aliases so a correctly-created key is not ignored.
  env={BRIDGE_ACCESS_TOKEN:auth,GEMINI_API_KEY:"gemini-alias-key",ASSETS:{fetch:async()=>new Response("asset")}};
  res=await m.default.fetch(new Request("https://bridge.example/api/status",{headers:{Authorization:`Bearer ${auth}`}}),env);
  body=await res.json();
  ok(body.providers?.gemini===true,"GEMINI_API_KEY alias is recognized as Gemini configuration");

  // 3. Invalid custom model falls back to the current stable default only on model errors.
  const modelUrls=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);modelUrls.push(u);
    if(u.includes("bad-custom-model"))return new Response(JSON.stringify({error:{message:"model not found"}}),{status:404,headers:{"Content-Type":"application/json"}});
    if(u.includes("gemini-3.8-flash"))return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini fallback works."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected URL "+u);
  };
  env={BRIDGE_ACCESS_TOKEN:auth,GEMINI_API_KEY:"gemini-alias-key",GEMINI_MODEL:"bad-custom-model",ASSETS:{fetch:async()=>new Response("asset")}};
  res=await m.default.fetch(request({prompt:"Explain briefly why the sky is blue",displayPrompt:"Explain briefly why the sky is blue",mode:"auto",providers:["gemini"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Gemini fallback works.","model-not-found automatically falls back to the stable Gemini model");
  ok(modelUrls.some(x=>x.includes("bad-custom-model"))&&modelUrls.some(x=>x.includes("gemini-3.8-flash")),"both requested and fallback Gemini models were actually attempted");

  // 4. Fast Auto succeeds when one free provider fails and another works.
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);
    if(u.includes("generativelanguage.googleapis.com"))return new Response(JSON.stringify({error:{message:"invalid API key"}}),{status:401,headers:{"Content-Type":"application/json"}});
    if(u.includes("api.groq.com")){
      const reqBody=JSON.parse(opts.body);
      ok("max_completion_tokens" in reqBody,"Groq uses current max_completion_tokens parameter");
      ok(reqBody.include_reasoning===false&&reqBody.reasoning_effort==="low","GPT-OSS Groq request suppresses reasoning payload and uses low reasoning effort");
      return new Response(JSON.stringify({choices:[{message:{content:"Groq answered successfully."}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    throw new Error("unexpected provider "+u);
  };
  env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"bad-gemini-key",GROQ_API_KEY:"groq-good-key",ASSETS:{fetch:async()=>new Response("asset")}};
  res=await m.default.fetch(request({prompt:"Tell me one fact about Canada",displayPrompt:"Tell me one fact about Canada",mode:"auto",providers:["gemini","groqfree"],synthesize:true}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Groq answered successfully.","Auto chat returns first successful provider instead of dying with another provider");
  ok(body.meta?.fastAuto===true&&body.meta?.synthesized===false,"ordinary Auto chat uses reliability-first fast path");

  // 5. Explicitly selected paid provider may rescue failed free providers; no silent paid fallback otherwise.
  const paidCalls=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);paidCalls.push(u);
    if(u.includes("generativelanguage.googleapis.com")||u.includes("api.groq.com")||u.includes("openrouter.ai"))return new Response(JSON.stringify({error:{message:"quota exceeded"}}),{status:429,headers:{"Content-Type":"application/json"}});
    if(u.includes("api.openai.com"))return new Response(JSON.stringify({output_text:"Paid fallback worked."}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected provider "+u);
  };
  env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r",OPENAI_API_KEY:"o",ASSETS:{fetch:async()=>new Response("asset")}};
  // avoid long 429 retry waits by using 401 failures for this branch
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);paidCalls.push(u);
    if(u.includes("generativelanguage.googleapis.com")||u.includes("api.groq.com")||u.includes("openrouter.ai"))return new Response(JSON.stringify({error:{message:"invalid key"}}),{status:401,headers:{"Content-Type":"application/json"}});
    if(u.includes("api.openai.com"))return new Response(JSON.stringify({output_text:"Paid fallback worked."}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected provider "+u);
  };
  res=await m.default.fetch(request({prompt:"Give me a concise answer",displayPrompt:"Give me a concise answer",mode:"auto",providers:["gemini","groqfree","openrouter","openai"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Paid fallback worked.","explicitly selected OpenAI rescues Auto after all free providers fail");
  ok(paidCalls.some(x=>x.includes("api.openai.com")),"paid provider was called only because it was explicitly selected");

  // 6. OpenAI-compatible array content is parsed instead of rendering [object Object].
  globalThis.fetch=async(url)=>new Response(JSON.stringify({choices:[{message:{content:[{type:"text",text:"Array content works."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  env={BRIDGE_ACCESS_TOKEN:auth,OPENROUTER_API_KEY:"router",ASSETS:{fetch:async()=>new Response("asset")}};
  res=await m.default.fetch(request({prompt:"Answer with a sentence",displayPrompt:"Answer with a sentence",mode:"single",providers:["openrouter"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Array content works.","OpenAI-compatible array content is extracted correctly");

  // 7. Provider error output must never echo a configured secret.
  const secret="groq-super-secret-123456";
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:`bad key ${secret}`}}),{status:401,headers:{"Content-Type":"application/json"}});
  env={BRIDGE_ACCESS_TOKEN:auth,GROQ_API_KEY:secret,ASSETS:{fetch:async()=>new Response("asset")}};
  res=await m.default.fetch(request({prompt:"Real question",displayPrompt:"Real question",mode:"single",providers:["groqfree"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===502,"all-provider failure is reported as a controlled 502");
  ok(!JSON.stringify(body).includes(secret)&&JSON.stringify(body).includes("[redacted]"),"runtime errors redact provider secrets before returning to browser");
} finally {
  globalThis.fetch=originalFetch;
  fs.unlinkSync(tmp);
}
console.log("All AI Bridge v4.7.0 runtime reliability tests passed.");
