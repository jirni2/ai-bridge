import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const workerSrc=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const appSrc=fs.readFileSync(path.join(root,"app.js"),"utf8");
const workSrc=fs.readFileSync(path.join(root,"work-controller.js"),"utf8");
const indexSrc=fs.readFileSync(path.join(root,"index.html"),"utf8");
const swSrc=fs.readFileSync(path.join(root,"sw.js"),"utf8");
const version=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")).version;
const tmp=path.join(here,`worker-v460-${Date.now()}.mjs`);
fs.writeFileSync(tmp,workerSrc);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

ok(/^(?:4\.(?:[6-9]|[1-9]\d)\.|[5-9]\.\d+\.)/.test(version),"central version is v4.6+");
ok(appSrc.includes(`const UI_VERSION="${version}"`),"main UI has an explicit worker-version guard");
ok(workSrc.includes(`const UI_VERSION="${version}"`),"Work UI has an explicit worker-version guard");
ok(appSrc.includes('updateViaCache:"none"')&&appSrc.includes('await reg.update()'),"service worker bypasses script cache and forces an update check");
ok(workerSrc.includes('url.pathname==="/sw.js"?"no-store, max-age=0"'),"sw.js is served no-store by the Worker");
ok(workerSrc.includes('"X-AI-Bridge-Version",VERSION'),"critical static assets carry the deployed Bridge version");
ok(indexSrc.includes('id="testProvidersBtn"')&&indexSrc.includes('реальним API-викликом'),"Connections UI exposes a live provider test");
ok(workSrc.includes('keys configured')&&!workSrc.includes('Free AI ready'),"Work status no longer confuses KEY SET with live provider health");
ok(indexSrc.includes('Business')&&indexSrc.includes('Enterprise/Edu')&&indexSrc.includes('На Plus'),"Connector instructions state the current custom-MCP plan limitation");
ok(workerSrc.includes('max_output_tokens:4200'),"OpenAI production call has an output cap");
ok(/callOpenAI\(env,system,prompt,onEvent=null,signal=null(?:,images=\[\])?(?:,effort="standard")?\)[\s\S]*?withRetry/.test(workerSrc),"OpenAI uses transient retry handling");
ok(/callClaude\(env,system,prompt,onEvent=null,signal=null(?:,images=\[\])?\)[\s\S]*?withRetry/.test(workerSrc),"Claude uses transient retry handling");
ok(/callGrok\(env,system,prompt,onEvent=null,signal=null(?:,images=\[\])?(?:,effort="standard")?\)[\s\S]*?withRetry/.test(workerSrc),"Grok uses transient retry handling");

const env={
  BRIDGE_ACCESS_TOKEN:"bridge-secret-token",
  GOOGLE_API_KEY:"gemini-secret-123456",
  GROQ_API_KEY:"groq-secret-12345678",
  OPENROUTER_API_KEY:"router-secret-123456",
  OPENAI_API_KEY:"openai-paid-secret",
  ANTHROPIC_API_KEY:"claude-paid-secret",
  XAI_API_KEY:"xai-paid-secret",
  ASSETS:{fetch:async req=>new Response("asset",{status:200,headers:{"Content-Type":"text/plain","Cache-Control":"public, max-age=86400"}})}
};

const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async (url,opts={})=>{
  const u=String(url);calls.push(u);
  if(u.includes("generativelanguage.googleapis.com"))return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"OK"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  if(u.includes("api.groq.com"))return new Response(JSON.stringify({choices:[{message:{content:"OK"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  if(u.includes("openrouter.ai"))return new Response(JSON.stringify({choices:[{message:{content:"OK"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  throw new Error("Unexpected paid provider call: "+u);
};

try{
  const req=new Request("https://bridge.example/api/diagnostics/providers",{method:"POST",headers:{Authorization:"Bearer bridge-secret-token","Content-Type":"application/json"},body:"{}"});
  const res=await m.default.fetch(req,env),body=await res.json();
  ok(res.status===200,"live-provider diagnostics route is reachable with Bridge auth");
  ok(body.total===3&&body.usable===3,"default diagnostics test exactly the three free providers");
  ok(calls.length===3&&calls.some(x=>x.includes("generativelanguage.googleapis.com"))&&calls.some(x=>x.includes("api.groq.com"))&&calls.some(x=>x.includes("openrouter.ai")),"default diagnostics exercise Gemini, Groq and OpenRouter");
  ok(!calls.some(x=>x.includes("api.openai.com")||x.includes("api.anthropic.com")||x.includes("api.x.ai")),"default diagnostics do not spend paid-provider quota");

  const unauth=await m.default.fetch(new Request("https://bridge.example/api/diagnostics/providers",{method:"POST"}),env);
  ok(unauth.status===401,"live-provider diagnostics require Bridge authentication");

  const swRes=await m.default.fetch(new Request("https://bridge.example/sw.js"),env);
  ok(/no-store/i.test(swRes.headers.get("Cache-Control")||""),"deployed sw.js response prevents stale HTTP caching");
  ok(swRes.headers.get("X-AI-Bridge-Version")===version,"critical static response identifies deployed version");

  const unknown=await m.probeProvider(env,"not-a-provider");
  ok(unknown.status===400&&!unknown.ok,"unknown diagnostic provider is rejected safely");

  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:`bad key ${env.GROQ_API_KEY}`}}),{status:401,headers:{"Content-Type":"application/json"}});
  const redacted=await m.probeProvider(env,"groqfree");
  ok(!redacted.message.includes(env.GROQ_API_KEY)&&redacted.message.includes("[redacted]"),"diagnostic errors redact configured provider secrets");
} finally {
  globalThis.fetch=originalFetch;
  fs.unlinkSync(tmp);
}

console.log("All AI Bridge production reliability tests passed.");
