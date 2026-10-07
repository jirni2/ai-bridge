import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v485-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const auth="bridge-secret-token";
const req=body=>new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
const attached=(task,text)=>`${task}\n\n<attached_files>\n<file path="project/app.js">\n${text}\n</file>\n</attached_files>`;
const originalFetch=globalThis.fetch;
try{
  // 1. A brief, valid answer to a file task must NOT be rejected by code-review heuristics.
  globalThis.fetch=async url=>{
    const u=String(url);
    if(u.includes("generativelanguage.googleapis.com"))return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"v4.8.4"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected URL "+u);
  };
  let env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",ASSETS:{fetch:async()=>new Response("asset")}};
  let prompt=attached("Яка версія в цьому файлі?",'const VERSION="4.8.4";');
  let res=await m.default.fetch(req({prompt,displayPrompt:"Яка версія в цьому файлі?",mode:"auto",synthesize:true,judge:"auto"}),env);
  let body=await res.json();
  ok(res.status===200&&body.final==="v4.8.4","brief valid file answer returns 200 instead of false 502");
  ok(body.meta?.fastAutoFile===true&&body.meta?.synthesized===false,"Auto file task uses reliability-first path without unnecessary synthesis");

  // 2. Large file tasks prefer Gemini/OpenRouter. If Gemini fails, OpenRouter can win without Groq killing the request.
  const calls=[];
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);calls.push(u);
    if(u.includes("generativelanguage.googleapis.com"))return new Response(JSON.stringify({error:{message:"temporary unavailable"}}),{status:503,headers:{"Content-Type":"application/json"}});
    if(u.includes("openrouter.ai"))return new Response(JSON.stringify({choices:[{message:{content:"File task completed successfully."}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    if(u.includes("api.groq.com"))return new Response(JSON.stringify({error:{message:"should not be needed"}}),{status:429,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected URL "+u);
  };
  env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",OPENROUTER_API_KEY:"r",GROQ_API_KEY:"q",ASSETS:{fetch:async()=>new Response("asset")}};
  prompt=attached("Проаналізуй файл і дай короткий висновок.","x".repeat(140000));
  res=await m.default.fetch(req({prompt,displayPrompt:"Проаналізуй файл і дай короткий висновок.",mode:"auto",providers:["gemini","openrouter","groqfree"],synthesize:true,judge:"auto"}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="File task completed successfully.","large file task survives one long-context provider failure");
  ok(calls.some(x=>x.includes("openrouter.ai")),"OpenRouter long-context fallback was called");

  // 3. Groq-only must receive a bounded sample, not the entire project (important for free-plan TPM limits).
  let groqPrompt="",groqMax=0;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);
    if(u.includes("api.groq.com")){
      const b=JSON.parse(opts.body);groqPrompt=b.messages?.find(x=>x.role==="user")?.content||"";groqMax=b.max_completion_tokens||0;
      return new Response(JSON.stringify({choices:[{message:{content:"Processed the sampled project."}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    throw new Error("unexpected URL "+u);
  };
  env={BRIDGE_ACCESS_TOKEN:auth,GROQ_API_KEY:"q",ASSETS:{fetch:async()=>new Response("asset")}};
  prompt=attached("Знайди основну помилку.","const x = 1;\n".repeat(16000));
  res=await m.default.fetch(req({prompt,displayPrompt:"Знайди основну помилку.",mode:"auto",providers:["groqfree"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Processed the sampled project.","Groq-only file task still executes");
  ok(groqPrompt.length<22000&&groqPrompt.length>1000,"Groq file input is safely sampled instead of sending the whole project");
  ok(groqMax<=1200,"Groq file completion budget is reduced to stay within free-tier token budget");
  ok(body.results?.[0]?.inputSampled===true,"response metadata records that Groq saw a bounded sample");
} finally {
  globalThis.fetch=originalFetch;
  fs.unlinkSync(tmp);
}
console.log("AI Bridge v4.8.5 file execution tests passed");
