import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const work=fs.readFileSync(path.join(root,"work-controller.js"),"utf8");
const tmp=path.join(here,`worker-v570-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const AUTH="v570-secret";
class FakeKV{constructor(){this.store=new Map()}async get(k){return this.store.get(k)||null}async put(k,v){this.store.set(k,v)}}
function req(url){return new Request(`https://bridge.example${url}`,{headers:{Authorization:`Bearer ${AUTH}`}})}
try{
  // Runtime health is advisory only, but repeated hard failures must stop a
  // broken provider from being selected first on the next request.
  m.providerHealth.clear();
  ok(m.orderProvidersByHealth(["gemini","groqfree","openrouter"]).join(",")==="gemini,groqfree,openrouter","healthy providers preserve deterministic preference order");
  m.noteProviderHealth("gemini",{ok:false,errorKind:"billing_or_quota",status:429});
  const degraded=m.orderProvidersByHealth(["gemini","groqfree","openrouter"]);
  ok(degraded[0]!=="gemini"&&degraded.at(-1)==="gemini","quota-exhausted provider is temporarily deprioritized");
  const envRoute={GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"};
  const selected=m.autoSelect(envRoute,"simple factual question");
  ok(!selected.includes("gemini")&&selected.includes("groqfree"),"Auto routing uses runtime health instead of retrying the known-bad provider first");
  m.noteProviderHealth("gemini",{ok:true,status:200});
  ok(m.orderProvidersByHealth(["gemini","groqfree"])[0]==="gemini","a later success immediately rehabilitates the provider");
  const health=m.providerHealthSnapshot(["gemini"]);
  ok(health.gemini.successes===1&&health.gemini.coolingDown===false,"provider health snapshot exposes non-secret recovery state");

  // Work Controller recovery by clientRequestId closes the reload-before-first-
  // frame gap. Emulate a fresh isolate by clearing the in-memory shadow and
  // recovering the completed record from KV only.
  const kv=new FakeKV(),env={BRIDGE_ACCESS_TOKEN:AUTH,AI_BRIDGE_JOBS:kv};
  const clientRequestId="reload-before-first-provider-frame";
  const provider="groqfree";
  const jobId=await m.jobIdFor(env,`work-provider|${provider}|${clientRequestId}`);
  await m.jobPut(env,jobId,{kind:"work_provider",provider,status:"done",result:{provider,ok:true,text:"Recovered Work result",status:200,ms:10},updatedAt:Date.now()});
  m.memoryJobs.clear();
  const recovered=await m.handleWorkProviderStatus(req(`/api/work/provider-status?provider=${provider}&clientRequestId=${encodeURIComponent(clientRequestId)}`),env);
  const rj=await recovered.json();
  ok(recovered.status===200&&rj.jobId===jobId&&rj.status==="done"&&rj.result?.text==="Recovered Work result","Work provider job recovers across a fresh isolate using clientRequestId only");
  ok(rj.durable===false,"Work recovery does not claim durable execution from KV records");

  const missingProvider=await m.handleWorkProviderStatus(req(`/api/work/provider-status?clientRequestId=x`),env);
  ok(missingProvider.status===400,"clientRequestId recovery requires an explicit free provider id");

  // Client-side persistence must happen before the request leaves, update once
  // the start frame exposes jobId, and recover automatically after reload.
  ok(work.includes('WORK_PENDING_KEY="ai_bridge_work_pending_v1"'),"Work Controller has a dedicated pending-job store");
  ok(work.includes("upsertWorkPending({provider,clientRequestId,jobId:null,createdAt:Date.now()"),"Work pending marker is persisted before provider-stream fetch");
  ok(work.includes("provider=${encodeURIComponent(provider)}&clientRequestId=${encodeURIComponent(clientRequestId)}"),"Work Controller can recover even when first stream frame/jobId was missed");
  ok(work.includes("async function recoverPendingWork()")&&work.includes("recoverPendingWork().catch"),"Work Controller automatically resumes pending provider jobs after reload");
  ok(work.includes('j.jobsPersistent?"KV job recovery (bounded)":"best-effort recovery"'),"Work UI labels KV recovery as bounded");

  // Main Connections UI must expose the same truth instead of implying that
  // waitUntil/in-memory state is durable when KV is absent.
  ok(app.includes("Background job recovery")&&app.includes('persistent?"KV RECOVERY":"BEST EFFORT"'),"Connections UI surfaces KV recovery without a durable claim");

  // Status route publishes provider-health and recovery architecture, but no
  // prompt/response/token content is stored in health records.
  ok(src.includes("providerHealth:providerHealthSnapshot")&&src.includes('jobRecovery:jobsPersistent(reqEnv)?"kv-records-best-effort":"same-isolate-best-effort"'),"/api/status exposes provider health + honest recovery mode");
  ok(!/prompt\s*:|text\s*:|token\s*:/.test(JSON.stringify(m.providerHealthSnapshot(["gemini"]))),"provider health snapshot contains no prompts, model text, or tokens");

  console.log("AI Bridge v5.7.0 unfinished Work hardening tests passed.");
} finally { try{fs.unlinkSync(tmp)}catch{} }
