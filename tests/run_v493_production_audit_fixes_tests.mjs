import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.join(here,"..");
const tmp=path.join(here,`worker-v493-${Date.now()}.mjs`);
fs.writeFileSync(tmp,fs.readFileSync(path.join(root,"_worker.js"),"utf8"));
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const AUTH="v493-secret";
class FakeKV{constructor(){this.store=new Map()}async get(k){return this.store.get(k)?.value||null}async put(k,value){this.store.set(k,{value})}}
const ctx=()=>{const pending=[];return {waitUntil:p=>pending.push(p),drain:()=>Promise.all(pending)}};
const req=(pathName,body)=>new Request("https://bridge.example"+pathName,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${AUTH}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
const meaningful="Concrete review: _worker.js function withRetry handles the upstream status and preserves the provider result. This response is intentionally substantive.";

try{
  ok(m.isNoVerifiedFindingsText("NO VERIFIED FINDINGS"),"exact no-findings sentinel is recognized");
  ok(m.meaningfulProviderText("NO VERIFIED FINDINGS"),"no-findings sentinel passes strict review validation");
  ok(!m.isNoVerifiedFindingsText("NO VERIFIED FINDINGS BUT MAYBE"),"lookalike text is not treated as the sentinel");
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:"NO VERIFIED FINDINGS"}]}}]}),{status:200,headers:{"content-type":"application/json"}});
  const sentinelResult=await m.runOne({GOOGLE_API_KEY:"g"},"gemini","code","Review attached code");
  ok(sentinelResult.ok&&sentinelResult.outcome==="no_findings","provider result exposes outcome:no_findings instead of false 502");

  const general=m.formatEvidenceSynthesis([{claim:"Run tests before deploy",verdict:"supported",verification_reason:"Peer consensus"}],"Review the release plan",false);
  ok(general.startsWith("CONSERVATIVE TEAM SUMMARY"),"non-code synthesis uses a neutral heading");
  ok(!general.includes("CODE REVIEW"),"non-code synthesis does not claim to be a code audit");
  const code=m.formatEvidenceSynthesis([],"Перевір код",true);
  ok(code.startsWith("ПЕРЕВІРЕНИЙ АУДИТ КОДУ"),"real code context retains the evidence-audit heading");

  let schema=null;
  globalThis.fetch=async(_url,opts)=>{schema=JSON.parse(opts.body).generationConfig.responseSchema;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"summary":"ok","findings":[]}' }]}}]}),{status:200,headers:{"content-type":"application/json"}})};
  await m.callJudgeStructuredNative({GOOGLE_API_KEY:"g"},"gemini","sys","prompt",{},null,false);
  ok(!schema.properties.findings.items.required.includes("file"),"general Judge schema does not require fake file/evidence fields");
  await m.callJudgeStructuredNative({GOOGLE_API_KEY:"g"},"gemini","sys","prompt",{},null,true);
  ok(schema.properties.findings.items.required.includes("file"),"code Judge schema still requires file-scoped evidence");

  // Live Work provider stream: RetryInfo event must be visible before result.
  const kv=new FakeKV(),env={BRIDGE_ACCESS_TOKEN:AUTH,GOOGLE_API_KEY:"g",AI_BRIDGE_JOBS:kv},c=ctx();let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response(JSON.stringify({error:{details:[{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"0.02s"}]}}),{status:429,headers:{"content-type":"application/json"}});return new Response(JSON.stringify({candidates:[{content:{parts:[{text:meaningful}]}}]}),{status:200,headers:{"content-type":"application/json"}})};
  const body={clientRequestId:"stream-retry-1",provider:"gemini",mode:"code",task:"Review",fileText:'<file path="a.js">\nconst x = 1;\n</file>',fileName:"a.js"};
  const res=await m.handleWorkProviderStream(req("/api/work/provider-stream",body),env,c);
  const text=await res.text();await c.drain();
  const frames=text.trim().split("\n").map(x=>JSON.parse(x));
  const retryIndex=frames.findIndex(x=>x.type==="provider_retry"),resultIndex=frames.findIndex(x=>x.type==="provider_result");
  ok(retryIndex>=0&&resultIndex>retryIndex,"provider retry diagnostic streams before the terminal result");
  const retry=frames[retryIndex];
  ok(retry.status===429&&retry.nextAttempt===2&&retry.maxAttempts===2,"retry event carries status, next attempt, and max attempts");
  ok(retry.requestedWaitMs===20&&retry.actualWaitMs>=20&&retry.delaySource==="google.rpc.RetryInfo","RetryInfo controls the streamed wait diagnostics");
  ok(frames[resultIndex].result.ok&&calls===2,"stream returns the successful automatic retry result");
  ok(frames[0].durable===false,"stream does not claim durable execution from KV alone");

  // Disconnect after the start frame: waitUntil job continues and same id resumes.
  const kv2=new FakeKV(),env2={BRIDGE_ACCESS_TOKEN:AUTH,GOOGLE_API_KEY:"g",AI_BRIDGE_JOBS:kv2},c2=ctx();let resolveFetch;
  globalThis.fetch=()=>new Promise(resolve=>{resolveFetch=()=>resolve(new Response(JSON.stringify({candidates:[{content:{parts:[{text:meaningful}]}}]}),{status:200,headers:{"content-type":"application/json"}}))});
  const body2={...body,clientRequestId:"stream-resume-1"};
  const firstRes=await m.handleWorkProviderStream(req("/api/work/provider-stream",body2),env2,c2),reader=firstRes.body.getReader();
  const firstFrame=JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());await reader.cancel();resolveFetch();await c2.drain();
  const status=await (await m.handleWorkProviderStatus(req(`/api/work/provider-status?jobId=${firstFrame.jobId}`),env2)).json();
  ok(status.status==="done"&&status.result?.ok,"background Work provider job survives a dropped stream");
  const resumed=await m.handleWorkProviderStream(req("/api/work/provider-stream",body2),env2,ctx()),resumedFrames=(await resumed.text()).trim().split("\n").map(x=>JSON.parse(x));
  ok(resumedFrames[0].resumed===true&&resumedFrames.some(x=>x.type==="provider_result"),"same clientRequestId resumes the completed Work provider job without rerun");
  const changed=await m.handleWorkProviderStream(req("/api/work/provider-stream",{...body2,task:"Different task"}),env2,ctx());
  ok(changed.status===409&&(await changed.json()).errorKind==="job_request_conflict","Work provider rejects a reused id with a different task");
  const brokenKV={get:async()=>{throw new Error("temporary KV outage")},put:async()=>{throw new Error("temporary KV outage")}};
  const unavailable=await m.handleWorkProviderStream(req("/api/work/provider-stream",{...body2,clientRequestId:"work-kv-outage"}),{...env2,AI_BRIDGE_JOBS:brokenKV},ctx());
  ok(unavailable.status===503&&(await unavailable.json()).status==="storage_unavailable","Work provider reports a retryable storage outage instead of streaming forever");

  const unauthorized=await m.handleWorkProviderStream(new Request("https://bridge.example/api/work/provider-stream",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer wrong"},body:JSON.stringify(body)}),env,ctx());
  ok(unauthorized.status===401,"Work provider stream remains protected by Bridge authentication");
  const missingId=await m.handleWorkProviderStream(req("/api/work/provider-stream",{...body,clientRequestId:""}),env,ctx());
  ok(missingId.status===400,"stream rejects a missing idempotency key instead of starting an unresumable job");
  const mainJobId=await m.jobIdFor(env,"ordinary-main-job");await m.jobPut(env,mainJobId,{status:"done",result:{ok:true}});
  const wrongKind=await m.handleWorkProviderStatus(req(`/api/work/provider-status?jobId=${mainJobId}`),env);
  ok(wrongKind.status===404,"Work status endpoint does not expose records from the unrelated main-job namespace");
  const statusRoute=await m.default.fetch(req("/api/status"),env,ctx()),statusJson=await statusRoute.json();
  const currentVersion=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")).version;
  ok(statusJson.version===currentVersion&&/^[a-f0-9]{64}$/.test(statusJson.buildSha256||""),"status exposes current semantic version and a concrete build fingerprint");

  const ui=fs.readFileSync(path.join(root,"work-controller.js"),"utf8");
  ok(ui.includes("/api/work/provider-stream")&&ui.includes("providerAttempts"),"Work UI consumes provider stream and exposes providerAttempts diagnostics");
  ok(ui.includes('r.outcome==="no_findings"?"NO FINDINGS"'),"Work UI renders no-findings as neutral success");
}finally{
  try{fs.unlinkSync(tmp)}catch(e){}
}
console.log("v4.9.5 inherited production-audit regression tests passed.");
