import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
const tmp=path.join(here,`worker-v490-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const originalFetch=globalThis.fetch;
const auth="bridge-stream-secret";
try{
  let providerResolved=false;
  globalThis.fetch=async url=>{
    if(!String(url).includes("generativelanguage.googleapis.com"))throw new Error("unexpected URL "+url);
    await new Promise(r=>setTimeout(r,90));
    providerResolved=true;
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Streaming result works."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",ASSETS:{fetch:async()=>new Response("asset")}};
  const req=new Request("https://bridge.example/api/run-stream",{
    method:"POST",
    headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json","Accept":"application/x-ndjson"},
    body:JSON.stringify({prompt:"Analyze this file briefly",displayPrompt:"Analyze this file briefly",fileContext:"<attached_files><file path=\"a.txt\">hello</file></attached_files>",mode:"single",providers:["gemini"],synthesize:false})
  });
  const res=await m.default.fetch(req,env);
  ok(res.status===200,"run-stream endpoint returns HTTP 200");
  ok((res.headers.get("content-type")||"").includes("application/x-ndjson"),"run-stream uses NDJSON streaming content type");
  const reader=res.body.getReader(),decoder=new TextDecoder();
  const first=await reader.read();
  const firstText=decoder.decode(first.value||new Uint8Array());
  ok(firstText.includes('"type":"start"'),"stream emits a start event before provider completion");
  ok(providerResolved===false,"start event is flushed while the AI provider is still working");
  let rest="";
  while(true){const x=await reader.read();if(x.done)break;rest+=decoder.decode(x.value,{stream:true})}
  rest+=decoder.decode();
  ok(rest.includes('"type":"result"')&&rest.includes("Streaming result works."),"stream finishes with the real AI result");

  ok(app.includes('fetch("/api/run-stream"'),"main UI uses the streaming run endpoint");
  ok(app.includes('r.body.getReader()'),"main UI consumes streamed response chunks");
  ok(app.includes('t("taskAnalyzing")')&&/taskAnalyzing:"[^"]*connection active/i.test(i18n),"UI exposes localized live-connection progress during long runs");
  ok(/load failed\|failed to fetch\|networkerror/i.test(app),"Safari generic network errors are translated into useful Bridge errors");
  ok(app.includes('return await legacyRunRequest(payload)'),"UI falls back to legacy /api/run when streaming is unavailable before execution starts");
} finally {
  globalThis.fetch=originalFetch;
  try{fs.unlinkSync(tmp)}catch(e){}
}
console.log("AI Bridge v4.9.0 mobile streaming regression tests passed");
