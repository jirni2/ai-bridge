import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const tmp=path.join(here,`worker-v514-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const AUTH="v514-secret";
function ok(c,msg){if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)}
function req(pathAndQuery,{method="GET",body}={}){const h={Authorization:`Bearer ${AUTH}`};if(body!==undefined)h["Content-Type"]="application/json";return new Request(`https://bridge.example${pathAndQuery}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)})}
function env(kv){return {BRIDGE_ACCESS_TOKEN:AUTH,GOOGLE_API_KEY:"g",...(kv?{AI_BRIDGE_JOBS:kv}:{})}}
class FakeKV{constructor(){this.store=new Map()}async get(k){return this.store.get(k)||null}async put(k,v){this.store.set(k,v)}}
class FailingKV{async get(){throw new Error("read down")}async put(){throw new Error("write down")}}
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async url=>{
    if(!String(url).includes("generativelanguage.googleapis.com"))throw new Error("unexpected "+url);
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Recovered result"}]}}]}),{status:200,headers:{"content-type":"application/json"}})
  };
  const payload={prompt:"hi",displayPrompt:"hi",fileContext:"",mode:"single",providers:["gemini"],synthesize:false,clientRequestId:"recover-without-start-frame"};
  const e=env(new FakeKV());
  const ctx={promises:[],waitUntil(p){this.promises.push(p)}};
  const submit=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload}),e,ctx);
  const sj=await submit.json();
  ok(submit.status===202&&!!sj.jobId,"job submit returns processing + jobId");
  await Promise.all(ctx.promises);
  m.memoryJobs.clear(); // emulate a reconnect landing in a fresh isolate
  const byClient=await m.handleJobStatus(req(`/api/job/status?clientRequestId=${encodeURIComponent(payload.clientRequestId)}`),e);
  const bj=await byClient.json();
  ok(byClient.status===200&&bj.status==="done"&&bj.result?.final==="Recovered result","status can recover a job from clientRequestId when the start frame/jobId was never saved");

  const badEnv=env(new FailingKV());
  const bad=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:{...payload,clientRequestId:"storage-down"}}),badEnv,{waitUntil(){}});
  const badj=await bad.json();
  ok(bad.status===503&&badj.status==="storage_unavailable"&&badj.retryable===true,"KV failure is an explicit retryable 503, not fake processing");

  const failPut=new FailingKV();
  await m.jobPut(env(failPut),"shadow-result",{status:"done",result:{final:"still here"},updatedAt:Date.now()});
  const shadow=await m.jobGet(env(failPut),"shadow-result");
  ok(shadow?.status==="done"&&shadow.result?.final==="still here","computed result survives a transient KV write/read failure in the same isolate");

  const emoji="😀".repeat(6*1024*1024); // ~24 MiB UTF-8 but only ~12M UTF-16 code units
  await m.jobPut(env(null),"utf8-cap",{status:"done",result:{final:emoji},updatedAt:Date.now()});
  const capped=await m.jobGet(env(null),"utf8-cap");
  ok(capped?.status==="error"&&/too large/i.test(capped.error?.error||""),"job storage cap is enforced in UTF-8 bytes, not JS string length");

  ok(/r\.status===202&&j\?\.jobId/.test(app)&&/return pollJobStatus\(j\.jobId/.test(app),"legacy /api/run 202 is polled instead of treated as a completed answer");
  ok(/clientRequestId:pending\.clientRequestId/.test(app)&&!/if\(!pending\.jobId\|\|/.test(app),"reload recovery works even when Safari died before the first stream frame saved jobId");
  ok(/unknownGraceMs=20000/.test(app)&&/r\.status===404/.test(app),"client retries fresh 404 job-status reads to tolerate KV propagation");
  ok(/if\(run\.terminal\|\|run\.status===404\)clearPendingJob\(\)/.test(app),"non-terminal auth/network failures keep the pending-job marker for later recovery");

  console.log("AI Bridge v5.1.4 job recovery regression tests passed");
} finally {
  globalThis.fetch=originalFetch;
  try{fs.unlinkSync(tmp)}catch{}
}
