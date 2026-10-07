import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const workerSrc=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v461-${Date.now()}.mjs`);
fs.writeFileSync(tmp,workerSrc);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

ok(m.hasProviderText("Привіт! Чим можу допомогти?"),"short conversational provider text is transport-valid");
ok(!m.meaningfulProviderText("Привіт! Чим можу допомогти?"),"legacy strict review heuristic would reject the same greeting");
ok(!m.needsStrictProviderValidation("auto","привіт"),"plain Auto chat does not use code-review validation");
ok(m.needsStrictProviderValidation("code","привіт"),"Code mode keeps strict review validation");
ok(m.isGreetingLikePrompt("Привіт!"),"Ukrainian greeting is recognized");

const env={
  BRIDGE_ACCESS_TOKEN:"bridge-secret-token",
  GOOGLE_API_KEY:"gemini-key",
  GROQ_API_KEY:"groq-key",
  OPENROUTER_API_KEY:"router-key",
  ASSETS:{fetch:async()=>new Response("asset")}
};
const originalFetch=globalThis.fetch;

function req(body){return new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:"Bearer bridge-secret-token","Content-Type":"application/json"},body:JSON.stringify(body)});}

try{
  // Exact production regression: v4.6.0 returned 502 because this answer is <80 chars.
  let calls=[];
  globalThis.fetch=async(url,opts={})=>{
    calls.push(String(url));
    if(String(url).includes("generativelanguage.googleapis.com"))return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Привіт! Чим можу допомогти?"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected provider: "+url);
  };
  let res=await m.default.fetch(req({prompt:"привіт",displayPrompt:"привіт",mode:"auto",synthesize:true,judge:"auto"}),env);
  let body=await res.json();
  ok(res.status===200,"simple greeting no longer fails with HTTP 502");
  ok(/Привіт/.test(body.final),"simple greeting reaches the UI as a valid Bridge response");
  ok(body.meta?.localResponder!==true&&body.meta?.synthesized===false,"greeting is answered by a real provider without unnecessary synthesis");
  ok(calls.length>=1,"greeting traverses a real third-party AI call");

  // Concise factual answers are valid too; normal chat is not a code-review
  // benchmark. Since v5.9.10 elementary arithmetic is intentionally answered
  // by the deterministic local route before any provider/web request.
  calls=[];
  let geminiCount=0;
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url); calls.push(u);
    if(u.includes("generativelanguage.googleapis.com")){geminiCount++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"4"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});}
    if(u.includes("api.groq.com"))return new Response(JSON.stringify({choices:[{message:{content:"4"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected provider: "+u);
  };
  res=await m.default.fetch(req({prompt:"2+2?",displayPrompt:"2+2?",mode:"auto",synthesize:true,judge:"auto"}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="4","short factual answers are accepted");
  ok(body.meta?.route==="local"&&body.meta?.aiCalls===0&&calls.length===0,"elementary arithmetic avoids unnecessary provider/search calls");

  // Code mode intentionally remains strict.
  globalThis.fetch=async(url)=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:"OK"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  res=await m.default.fetch(req({prompt:"review this code",displayPrompt:"review this code",mode:"code",providers:["gemini"],synthesize:false}),env);
  body=await res.json();
  ok(res.status===502,"Code Review still rejects a useless one-word review");

  // If Gemini and Groq both fail, Auto must try configured OpenRouter before giving up.
  const fallbackCalls=[];
  globalThis.fetch=async(url)=>{
    const u=String(url); fallbackCalls.push(u);
    if(u.includes("generativelanguage.googleapis.com")||u.includes("api.groq.com"))return new Response(JSON.stringify({error:{message:"temporary unavailable"}}),{status:400,headers:{"Content-Type":"application/json"}});
    if(u.includes("openrouter.ai"))return new Response(JSON.stringify({choices:[{message:{content:"Fallback works."}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected provider: "+u);
  };
  res=await m.default.fetch(req({prompt:"Explain this briefly",displayPrompt:"Explain this briefly",mode:"auto",synthesize:false}),env);
  body=await res.json();
  ok(res.status===200&&body.final==="Fallback works.","Auto tries the remaining configured free provider before failing");
  ok(fallbackCalls.some(x=>x.includes("openrouter.ai")),"OpenRouter free fallback was actually called");
  ok(!fallbackCalls.some(x=>x.includes("api.openai.com")||x.includes("api.anthropic.com")||x.includes("api.x.ai")),"free fallback never spends paid providers silently");
} finally {
  globalThis.fetch=originalFetch;
  fs.unlinkSync(tmp);
}

console.log("All AI Bridge v4.6.1 conversational runtime regressions passed.");
