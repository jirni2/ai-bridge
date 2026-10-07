/* v5.9.1: Agent Plan can never hang in "Planning • 1/4". Reproduces the
   production symptom with providers that never answer (and ignore abort),
   then checks invalid-JSON fallback and the job hard deadline. */
import fs from "node:fs";import path from "node:path";import assert from "node:assert/strict";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const tmp=path.join(root,"tests",`worker-v591-deadline-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const ok=(c,m)=>{assert.ok(c,m);console.log("✓",m)};
const originalFetch=globalThis.fetch;
try{
  const mod=await import(pathToFileURL(tmp).href);
  const env={GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r",GOOGLE_API_KEY:"g"};
  // 1) Every provider hangs and ignores the abort signal.
  let calls=0;globalThis.fetch=()=>{calls++;return new Promise(()=>{})};
  const t0=Date.now();let err=null,out=null;
  try{out=await mod.runAgent(env,{task:"Plan a trip",providerPrompt:"Plan a trip",providerIds:["groqfree"],maxSteps:4,runBudgetMs:20000})}catch(e){err=e}
  const took=Date.now()-t0;
  ok(took<26000,`hung providers end within the run budget (${Math.round(took/1000)}s)`);
  ok(err&&/Agent Core failed/.test(err.message),"a first-step planner failure is a clear terminal error, not endless processing");
  ok(calls>=1,"planner actually attempted a provider");
  // v5.9.5: budget exhausted before the first step must also be a terminal error.
  globalThis.fetch=()=>new Promise(()=>{});let edge=null;
  try{await mod.runAgent(env,{task:"x",providerPrompt:"x",providerIds:[],maxSteps:1,runBudgetMs:15000})}catch(e){edge=e}
  ok(edge&&/Agent Core failed/.test(edge.message),"a run with no answer and no evidence is always an error, never a fake success");
  // 2) Providers answer with prose instead of the JSON action schema.
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:"Here is a plain answer without JSON."}}],candidates:[{content:{parts:[{text:"Here is a plain answer without JSON."}]}}]}),{status:200,headers:{"content-type":"application/json"}});
  const r=await mod.runAgent(env,{task:"Say hi",providerPrompt:"Say hi",providerIds:[],maxSteps:2,runBudgetMs:30000});
  ok(r&&/plain answer/.test(r.final),"invalid planner JSON falls back to the readable answer instead of failing");
  ok(r.meta.agentFallbackFinal===true,"fallback answers are labelled as such");
  // 3) Jobs cannot stay "processing" forever.
  const now=Date.now();
  ok(mod.jobIsStale({status:"processing",startedAt:now-10*60*1000,heartbeatAt:now},now),"a job processing longer than the hard ceiling is stale even with a fresh heartbeat");
  ok(!mod.jobIsStale({status:"processing",startedAt:now-30000,heartbeatAt:now},now),"a normal running job is not stale");
  const w=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
  ok(w.includes("await withDeadline(runTeam(env,payload")&&w.includes("jobPutTerminal(env,jobId,{status:\"done\""),"job runs under a hard deadline and terminal states are retried");
}finally{globalThis.fetch=originalFetch;fs.rmSync(tmp,{force:true})}
console.log("v5.9.1 agent deadline tests PASS");
setTimeout(()=>process.exit(0),50);
