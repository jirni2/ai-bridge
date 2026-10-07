import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v492-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
function ok(c,msg){if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const originalFetch=globalThis.fetch;
const AUTH="job-lifecycle-secret";

// ---- test doubles -------------------------------------------------------
class FakeKV{
  constructor(){this.store=new Map()}
  async get(key){const e=this.store.get(key);return e?e.value:null}
  async put(key,value,opts){this.store.set(key,{value,expirationTtl:opts?.expirationTtl})}
}
class FailingKV{
  async get(){throw new Error("simulated KV read failure")}
  async put(){throw new Error("simulated KV write failure")}
}
function makeCtx(){const promises=[];return {waitUntil:p=>promises.push(p),drain:()=>Promise.all(promises.map(p=>p.catch(()=>{})))}}
function req(pathAndQuery,{method="GET",body,auth=AUTH}={}){
  const headers={Authorization:`Bearer ${auth}`};
  if(body!==undefined)headers["Content-Type"]="application/json";
  return new Request(`https://bridge.example${pathAndQuery}`,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
}
function baseEnv(kv){
  return {BRIDGE_ACCESS_TOKEN:AUTH,GOOGLE_API_KEY:"g",ASSETS:{fetch:async()=>new Response("asset")},...(kv?{AI_BRIDGE_JOBS:kv}:{})};
}
async function readJson(res){return res.json()}

// Mocked Gemini provider: counts calls, and can be scripted per-call.
// M3 (v5.11.9 wave 2): поведінка навмисно змінилась — кожне виконання завдання
// тепер включає ОДИН обмежений виклик Judge з рубрикою (маркер answer_to_score
// у тілі запиту). Викликів Judge рахуємо окремо, щоб намір тестів («провайдер
// викликано рівно N разів для відповіді») залишився перевіреним.
function mockGemini(script){
  let calls=0,judges=0;
  globalThis.fetch=async (url,init={})=>{
    if(!String(url).includes("generativelanguage.googleapis.com"))throw new Error("unexpected URL "+url);
    if(String(init?.body||"").includes("answer_to_score")){
      judges++;
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"accuracy":5,"completeness":5,"language":5,"sources":5}'}]}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    calls++;
    const step=typeof script==="function"?script(calls):script;
    if(step.status&&step.status!==200){
      return new Response(JSON.stringify({error:{message:step.message||"error"}}),{status:step.status,headers:{"content-type":"application/json","retry-after":"0.001"}});
    }
    if(step.delayMs)await new Promise(r=>setTimeout(r,step.delayMs));
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:step.text||"OK from Gemini."}]}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  const fn=()=>calls;fn.judges=()=>judges;return fn;
}
function payload(overrides={}){
  return {prompt:"Review this briefly",displayPrompt:"Review this briefly",fileContext:"",mode:"single",providers:["gemini"],synthesize:false,...overrides};
}

try{
  // 1) Normal job completes end-to-end via submit -> waitUntil -> status.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini({text:"All good."});
    const clientRequestId="job-normal-1";
    const submitRes=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx);
    const submitJson=await readJson(submitRes);
    ok(submitRes.status===202&&submitJson.status==="processing","submit accepts a normal job and returns 202/processing");
    ok(!!submitJson.jobId,"submit returns a jobId");
    ok(submitJson.durable===false,"KV does not claim durable execution without step checkpoints");
    await ctx.drain();
    const statusRes=await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env);
    const statusJson=await readJson(statusRes);
    ok(statusJson.status==="done"&&statusJson.result?.final==="All good.","status endpoint returns the completed result");
    ok(callCount()===1&&callCount.judges()===1,"exactly one provider call for a normal single-run job (+ one bounded M3 quality-judge call)");
  }

  // 2) Client disconnect mid-stream: job keeps running (via ctx.waitUntil)
  //    and completes even though nobody kept reading the stream.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({text:"Finished after disconnect.",delayMs:30});
    const clientRequestId="job-disconnect-1";
    const streamRes=await m.handleRunStream(req("/api/run-stream",{method:"POST",body:payload({clientRequestId})}),env,ctx);
    const reader=streamRes.body.getReader(),decoder=new TextDecoder();
    const first=await reader.read();
    const startFrame=JSON.parse(decoder.decode(first.value).trim().split("\n")[0]);
    ok(startFrame.type==="start"&&!!startFrame.jobId,"stream sends a start frame carrying the jobId");
    // Simulate the client vanishing here: stop reading, drop the reference.
    // The job must not be tied to this reader at all.
    await ctx.drain(); // this is what keeps the job alive server-side after disconnect
    const rec=await m.jobGet(env,startFrame.jobId);
    ok(rec?.status==="done"&&rec.result?.final==="Finished after disconnect.","job reaches 'done' purely via ctx.waitUntil, independent of the dropped stream reader");
  }

  // 3) Reconnect: submitting again with the SAME clientRequestId resolves to
  //    the SAME jobId and does not run the provider a second time.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini({text:"Reconnected result."});
    const clientRequestId="job-reconnect-1";
    const first=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    await ctx.drain();
    const second=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    ok(first.jobId===second.jobId,"reconnect submit resolves to the same jobId");
    ok(second.status==="done"&&second.result?.final==="Reconnected result.","reconnect submit immediately returns the already-finished result");
    ok(callCount()===1&&callCount.judges()===1,"provider was called exactly once across the original submit + the reconnect retry (+ one bounded M3 quality-judge call)");
  }

  // 4) Reload mid-job: status can be polled while still processing, and
  //    later reflects completion once the background task finishes.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({text:"Reloaded and recovered.",delayMs:25});
    const clientRequestId="job-reload-1";
    const submitJson=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    // "Page reload" here = a fresh status poll before the background task settles.
    const midJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
    ok(midJson.status==="processing","a status poll issued right after reload sees 'processing', not a lost job");
    await ctx.drain();
    const doneJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
    ok(doneJson.status==="done"&&doneJson.result?.final==="Reloaded and recovered.","the same jobId resolves to the finished result after the job completes");
  }

  // 4b) Reusing an id for different content must not leak the earlier answer
  // or start a second provider call. Compare both the task and attachments.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini({text:"First task only."});
    const clientRequestId="job-payload-conflict-1";
    const original=payload({clientRequestId,prompt:"Analyze alpha",displayPrompt:"Analyze alpha",fileContext:"alpha.js"});
    const first=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:original}),env,ctx);
    ok(first.status===202,"first submission starts normally");
    const changedTask=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:{...original,prompt:"Analyze beta",displayPrompt:"Analyze beta"}}),env,ctx);
    const changedFile=await m.handleRunStream(req("/api/run-stream",{method:"POST",body:{...original,fileContext:"beta.js"}}),env,ctx);
    ok(changedTask.status===409&&(await changedTask.json()).errorKind==="job_request_conflict","same id with a different task is rejected while processing");
    ok(changedFile.status===409&&(await changedFile.json()).errorKind==="job_request_conflict","same id with a different attachment is rejected across endpoints");
    await ctx.drain();
    const afterDone=await m.handleRun(req("/api/run",{method:"POST",body:{...original,prompt:"Analyze gamma"}}),env,ctx);
    ok(afterDone.status===409,"same id with a different task is rejected after completion");
    const same=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:original}),env,ctx);
    ok(same.status===200&&(await same.json()).result?.final==="First task only.","same id and exact payload still recovers the finished result");
    const reordered=Object.fromEntries(Object.entries(original).reverse());
    const sameReordered=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:reordered}),env,ctx);
    ok(sameReordered.status===200,"reordered JSON properties do not create a false conflict");
    ok(callCount()===1&&callCount.judges()===1,"conflicting retries do not call the provider or return the old answer (+ one bounded M3 quality-judge call)");
  }

  // 5) Duplicate Send fired truly concurrently with the same clientRequestId
  //    must still only invoke the provider once (tests jobClaim(), not just
  //    the sequential retry path already covered above).
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini({text:"Only once."});
    const clientRequestId="job-duplicate-race-1";
    const [a,b]=await Promise.all([
      m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx),
      m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx)
    ]);
    const [aj,bj]=await Promise.all([readJson(a),readJson(b)]);
    ok(aj.jobId===bj.jobId,"two concurrent duplicate submits resolve to the same jobId");
    await ctx.drain();
    ok(callCount()===1&&callCount.judges()===1,"two truly concurrent duplicate submits still only call the provider once (in-memory jobClaim race is closed) (+ one bounded M3 quality-judge call)");
  }

  // 5b) Same race, but through /api/run-stream + /api/job/submit hitting the
  //     same clientRequestId from two different entry points at once.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini({text:"Cross-endpoint once."});
    const clientRequestId="job-duplicate-race-2";
    const [streamRes,submitRes]=await Promise.all([
      m.handleRunStream(req("/api/run-stream",{method:"POST",body:payload({clientRequestId})}),env,ctx),
      m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx)
    ]);
    // Drain the stream so it isn't left half-read.
    const reader=streamRes.body.getReader();while(!(await reader.read()).done){}
    const submitJson=await readJson(submitRes);
    await ctx.drain();
    ok(!!submitJson.jobId,"cross-endpoint duplicate submit still returns a jobId");
    ok(callCount()===1&&callCount.judges()===1,"the provider is called exactly once even when the duplicate arrives via a different endpoint (+ one bounded M3 quality-judge call)");
  }

  // 6) Result is ready, but the stream is abandoned before the final frame
  //    is ever read: a fresh status poll must still recover the real result.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({text:"Recovered after missed final frame."});
    const clientRequestId="job-missed-final-1";
    const streamRes=await m.handleRunStream(req("/api/run-stream",{method:"POST",body:payload({clientRequestId})}),env,ctx);
    const reader=streamRes.body.getReader(),decoder=new TextDecoder();
    const first=await reader.read();
    const startFrame=JSON.parse(decoder.decode(first.value).trim().split("\n")[0]);
    // Deliberately never read the "result" frame -- simulate the socket
    // closing right before it would have arrived.
    await ctx.drain();
    const statusJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${startFrame.jobId}`),env));
    ok(statusJson.status==="done"&&statusJson.result?.final==="Recovered after missed final frame.","polling job status recovers a result whose final stream frame was never received");
  }

  // 7) Provider timeout (504) surfaces as errorKind "timeout" on the job record.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({status:504,message:"upstream timeout"});
    const clientRequestId="job-timeout-1";
    const submitJson=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    await ctx.drain();
    const statusJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
    ok(statusJson.status==="error","a provider timeout resolves the job to status 'error', never leaves it stuck 'processing'");
    ok(statusJson.error?.results?.some(r=>r.errorKind==="timeout"),"the underlying provider result is tagged errorKind:'timeout'");
  }

  // 8) Provider 429 surfaces as errorKind "rate_limited".
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({status:429,message:"rate limited"});
    const clientRequestId="job-429-1";
    const submitJson=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    await ctx.drain();
    const statusJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
    ok(statusJson.status==="error","a 429 from the only selected provider resolves the job to status 'error'");
    ok(statusJson.error?.results?.some(r=>r.errorKind==="rate_limited"),"the underlying provider result is tagged errorKind:'rate_limited'");
  }

  // 9) Session expiry: both submit and status require a valid Bridge session.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    mockGemini({text:"unused"});
    const badSubmit=await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId:"job-401-1"}),auth:"wrong-token"}),env,ctx);
    ok(badSubmit.status===401,"job submit with an invalid/expired session returns 401");
    const badStatus=await m.handleJobStatus(req("/api/job/status?jobId=whatever",{auth:"wrong-token"}),env);
    ok(badStatus.status===401,"job status with an invalid/expired session returns 401");
  }

  // 10) Large ZIP-sized context, small TXT/JS context, and a plain chat
  //     message with no attachments all move through the same job lifecycle.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const callCount=mockGemini(n=>({text:`Result #${n}`}));
    const bigZipContext="\n\n<attached_files>\n"+"x".repeat(300000)+"\n</attached_files>";
    const smallFileContext='\n\n<attached_files>\n<file path="a.js">console.log(1)</file>\n</attached_files>';
    const cases=[
      {clientRequestId:"job-large-zip-1",fileContext:bigZipContext},
      {clientRequestId:"job-small-file-1",fileContext:smallFileContext},
      {clientRequestId:"job-plain-chat-1",fileContext:""}
    ];
    for(const c of cases){
      const submitJson=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload(c)}),env,ctx));
      await ctx.drain();
      const statusJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
      ok(statusJson.status==="done",`job completes normally for case ${c.clientRequestId}`);
    }
    ok(callCount()===3&&callCount.judges()===3,"large ZIP, small file, and plain chat each triggered exactly one provider call (+ one bounded M3 quality-judge call each)");
  }

  // 11) Honest durability signal: no AI_BRIDGE_JOBS binding -> in-memory
  //     fallback, jobsDurable reports false everywhere, /api/status agrees.
  {
    const env=baseEnv(null),ctx=makeCtx(); // no KV bound at all
    mockGemini({text:"In-memory fallback result."});
    ok(m.jobsDurable(env)===false,"jobsDurable() is false with no AI_BRIDGE_JOBS binding");
    const clientRequestId="job-no-kv-1";
    const submitJson=await readJson(await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId})}),env,ctx));
    ok(submitJson.durable===false,"submit response honestly reports durable:false without a KV binding");
    await ctx.drain();
    const statusJson=await readJson(await m.handleJobStatus(req(`/api/job/status?jobId=${submitJson.jobId}`),env));
    ok(statusJson.durable===false&&statusJson.status==="done","in-memory fallback still completes the job within the same isolate");
    const statusRouteRes=await m.default.fetch(req("/api/status"),env,ctx);
    const statusRouteJson=await readJson(statusRouteRes);
    ok(statusRouteJson.jobsDurable===false,"/api/status also reports jobsDurable:false consistently");
  }

  // 11b) With a KV binding, /api/status and job responses report true.
  {
    const kv=new FakeKV(),env=baseEnv(kv),ctx=makeCtx();
    const statusRouteJson=await readJson(await m.default.fetch(req("/api/status"),env,ctx));
    ok(statusRouteJson.jobsPersistent===true&&statusRouteJson.jobsDurable===false,"/api/status distinguishes persistent KV records from durable execution");
  }

  // 12) KV read/write failures degrade gracefully -- never throw, never
  //     silently claim success. jobClaim() must not crash on a failing KV.
  {
    const env=baseEnv(new FailingKV()),ctx=makeCtx();
    mockGemini({text:"should not matter"});
    const jobId=await m.jobIdFor(env,"job-kv-failure-1");
    let threw=false,won=null;
    try{won=await m.jobClaim(env,jobId)}catch(e){threw=true}
    ok(!threw,"jobClaim() does not throw when the KV binding itself is failing");
    ok(won===false,"jobClaim() treats a KV failure as 'did not win' rather than silently proceeding");
    const rec=await m.jobGet(env,jobId);
    ok(rec===null,"jobGet() returns null (not a thrown error) when the KV binding is failing");
    let submitThrew=false;
    try{await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId:"job-kv-failure-2"})}),env,ctx)}
    catch(e){submitThrew=true}
    ok(!submitThrew,"the /api/job/submit route itself never throws even when KV is completely broken");
  }

  // 13) Oversized result never breaks storage -- it degrades to a stored
  //     error record instead of failing the write or exceeding KV's limit.
  {
    const kv=new FakeKV(),env=baseEnv(kv);
    const hugeJobId="job-oversized-1";
    await m.jobPut(env,hugeJobId,{status:"done",result:{final:"x".repeat(21*1024*1024)},updatedAt:Date.now()});
    const rec=await m.jobGet(env,hugeJobId);
    ok(rec.status==="error"&&/too large/i.test(rec.error?.error||""),"an oversized job value is stored as a bounded error record instead of a 21MB+ write");
  }

  // 14) TTL is actually applied to KV writes (so completed/abandoned jobs
  //     expire instead of accumulating forever).
  {
    const kv=new FakeKV(),env=baseEnv(kv);
    const jobId="job-ttl-1";
    await m.jobPut(env,jobId,{status:"done",result:{final:"ok"},updatedAt:Date.now()});
    const stored=kv.store.get("job:"+jobId);
    ok(stored?.expirationTtl===45*60,"job records are written to KV with the documented 45-minute expirationTtl");
  }

  // 15) ExecutionContext plumbing: ctx.waitUntil is actually invoked by both
  //     entry points that create jobs, not just accepted as an unused arg.
  {
    const kv=new FakeKV(),env=baseEnv(kv);
    mockGemini({text:"ctx check"});
    let waited=0;const ctx={waitUntil:p=>{waited++;p.catch(()=>{})}};
    await m.handleJobSubmit(req("/api/job/submit",{method:"POST",body:payload({clientRequestId:"job-ctx-submit-1"})}),env,ctx);
    ok(waited===1,"handleJobSubmit registers the run with ctx.waitUntil");
    const streamRes=await m.handleRunStream(req("/api/run-stream",{method:"POST",body:payload({clientRequestId:"job-ctx-stream-1"})}),env,ctx);
    const reader=streamRes.body.getReader();while(!(await reader.read()).done){}
    ok(waited===2,"handleRunStream also registers its job with ctx.waitUntil, not just the ReadableStream lifetime");
  }

  // 16) Existing baseline flows are untouched: plain chat with no
  //     clientRequestId still works exactly as the pre-v4.9.2 synchronous
  //     /api/run contract (no job wrapper involved at all).
  {
    const env=baseEnv(null);
    mockGemini({text:"Plain synchronous reply."});
    const res=await m.handleRun(req("/api/run",{method:"POST",body:{prompt:"hi",displayPrompt:"hi",fileContext:"",mode:"single",providers:["gemini"],synthesize:false}}),env);
    const j=await readJson(res);
    ok(res.status===200&&j.final==="Plain synchronous reply.","legacy /api/run without clientRequestId is unchanged: synchronous, no job wrapper");
  }

  console.log("All v4.9.2 resumable job lifecycle regression tests passed.");
}finally{
  globalThis.fetch=originalFetch;
  try{fs.unlinkSync(tmp)}catch(e){}
}
