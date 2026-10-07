/* v5.10.0 backend tests: login rate limiting, atomic jobClaim fencing,
   error sanitization, neutralizeEmbeddedFileTags parity with app.js,
   schedules CRUD + validation, research contract + helpers, project KB
   (RAG-lite), vision parsing, dead-job reaping.
   Style follows tests/run_v596_features_tests.mjs. No network is used.
   Run: node tests/test_v510_backend.mjs */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

const m=await import("../_worker.js");
const need=["handleSessionLogin","LOGIN_MAX_ATTEMPTS","LOGIN_WINDOW_TTL_SEC","loginBackoffSec",
  "checkLoginBlocked","noteLoginFailure","loginAttemptClear","claimToken","jobClaim",
  "neutralizeEmbeddedFileTags","publicErrorMessage","publicProviderResults",
  "reapDeadJobs","runDueSchedules","schedulePut","scheduleGet","scheduleDelete",
  "sanitizeSchedule","validTimezone","nextRunTimestamp","handleSchedules",
  "handleResearch","researchPlanPrompt","parseResearchPlan","dedupeResearchSources",
  "handleProjects","handleKbQuery","kbChunks","kbQueryTerms","kbRankChunks","sanitizeProjectFiles",
  "handleVisionAnalyze","parseVisionImage","notifyJobComplete"];
for(const n of need)ok(m[n]!==undefined,"exported "+n);

const env0={BRIDGE_ACCESS_TOKEN:"secret-token-test"};
const auth={headers:{authorization:"Bearer secret-token-test","content-type":"application/json"}};
const post=(p,body,hdrs=auth.headers,extra={})=>new Request("https://x"+p,{method:"POST",headers:hdrs,body:JSON.stringify(body),...extra});
const get=(p,hdrs=auth.headers)=>new Request("https://x"+p,{method:"GET",headers:hdrs});
const loginReq=(ip,token)=>new Request("https://x/api/session/login",{method:"POST",
  headers:{"content-type":"application/json","CF-Connecting-IP":ip},body:JSON.stringify({token})});
const j=async r=>{const t=await r.text();try{return JSON.parse(t)}catch(e){return {__raw:t}}};

/* --- 1. loginBackoffSec: exponential, capped --- */
ok(m.loginBackoffSec(5)===60,"loginBackoffSec(5)=60s");
ok(m.loginBackoffSec(6)===120,"loginBackoffSec(6)=120s");
ok(m.loginBackoffSec(7)===240,"loginBackoffSec(7)=240s");
ok(m.loginBackoffSec(20)===600,"loginBackoffSec caps at 600s");
ok(m.LOGIN_MAX_ATTEMPTS===5&&m.LOGIN_WINDOW_TTL_SEC===600,"login limits: 5 attempts / 600s window");

/* --- 1. login rate limit: 5 fails -> 429 --- */
{
  const ip="10.200.0.11";
  for(let i=0;i<4;i++){const r=await m.handleSessionLogin(loginReq(ip,"wrong"),env0);ok(r.status===401,`bad login ${i+1}/4 -> 401`)}
  const r5=await m.handleSessionLogin(loginReq(ip,"wrong"),env0);
  ok(r5.status===429,"5th bad login -> 429");
  ok(Number(r5.headers.get("Retry-After"))>0,"429 carries Retry-After");
  const r6=await m.handleSessionLogin(loginReq(ip,"wrong"),env0);
  ok(r6.status===429,"still blocked on 6th attempt");
  const body=await j(r6);ok(body.error&&body.retryAfterSec>0,"429 body has error + retryAfterSec");
}
/* --- 1. success resets the counter --- */
{
  const ip="10.200.0.12";
  for(let i=0;i<3;i++){const r=await m.handleSessionLogin(loginReq(ip,"wrong"),env0);ok(r.status===401,"bad login -> 401")}
  const good=await m.handleSessionLogin(loginReq(ip,"secret-token-test"),env0);
  ok(good.status===200,"good login -> 200");
  const gb=await j(good);ok(gb.ok===true,"good login body ok");
  const after=await m.handleSessionLogin(loginReq(ip,"wrong"),env0);
  ok(after.status===401,"after success the counter is reset (401, not 429)");
  const gate=await m.checkLoginBlocked(env0,ip);ok(gate.blocked===false,"checkLoginBlocked false after reset");
}
/* --- 1. helpers --- */
{
  const ip="10.200.0.13";
  const f1=await m.noteLoginFailure(env0,ip);ok(f1.fails===1&&f1.blocked===false,"noteLoginFailure counts");
  await m.loginAttemptClear(env0,ip);
  const gate=await m.checkLoginBlocked(env0,ip);ok(gate.blocked===false,"loginAttemptClear resets");
}

/* --- 2. jobClaim: no double execution --- */
const fakeStore=()=>{const map=new Map();return{map,
  get:async k=>map.has(k)?map.get(k):null,
  put:async(k,v)=>{map.set(k,v)},
  delete:async k=>{map.delete(k)},
  list:async({prefix="",limit=1000}={})=>({keys:[...map.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true,cursor:null})}};
{
  const kv=fakeStore(),env={BRIDGE_ACCESS_TOKEN:"x",AI_BRIDGE_JOBS:kv};
  const won1=await m.jobClaim(env,"v510job1","fp1");
  ok(won1===true,"first claim wins");
  m.memoryJobs.delete("v510job1"); // simulate a second isolate
  const won2=await m.jobClaim(env,"v510job1","fp1");
  ok(won2===false,"second claim with same clientRequestId loses (no double run)");
  const won3=await m.jobClaim(env,"v510job1","other-fp");
  ok(won3===false,"conflicting fingerprint on a live job loses");
}
/* --- 2. owner-token re-verification: a concurrent winner at the KV store beats us --- */
{
  const kv=fakeStore(),env={BRIDGE_ACCESS_TOKEN:"x",AI_BRIDGE_JOBS:kv};
  const now=Date.now();
  await kv.put("job:racejob",JSON.stringify({status:"processing",startedAt:now,heartbeatAt:now,requestFingerprint:"fpX",claimOwner:"other-token-1"}));
  const won=await m.jobClaim(env,"racejob","fpX");
  ok(won===false,"claim loses when the KV store already holds another owner's token");
  const back=JSON.parse(await kv.get("job:racejob"));
  ok(back.claimOwner==="other-token-1","loser's write did not clobber the winner's record");
}
/* --- 2. stale takeover still works and is fenced --- */
{
  const kv=fakeStore(),env={BRIDGE_ACCESS_TOKEN:"x",AI_BRIDGE_JOBS:kv};
  const old=Date.now()-10*60*1000;
  await kv.put("job:stalejob",JSON.stringify({status:"processing",startedAt:old,heartbeatAt:old,requestFingerprint:"fpS"}));
  const won=await m.jobClaim(env,"stalejob","fpS");
  ok(won===true,"stale job with same fingerprint can be taken over");
  const rec=JSON.parse(await kv.get("job:stalejob"));
  ok(rec.restartedAfterStale===true&&typeof rec.claimOwner==="string"&&rec.claimOwner.length>0,"takeover marker carries claimOwner + restartedAfterStale");
}

/* --- 3. error sanitization: no raw URLs with keys, no key-like tokens --- */
{
  const e=new Error("OpenAI failed: https://api.openai.com/v1/chat/completions?api_key=sk-abc123XYZ789qwertyQWERTY+timeout");
  const msg=m.publicErrorMessage(e,{});
  ok(!msg.includes("sk-abc123")&&!msg.includes("api_key="),"key in URL is redacted");
  ok(msg.includes("[redacted]"),"redaction marker present");
  const e2=new Error("boom https://generativelanguage.googleapis.com/v1beta?key=AIzaSyD1234567890abcdefghij");
  ok(!m.publicErrorMessage(e2,{}).includes("AIzaSyD"),"google-style key redacted");
  const e3=new Error("plain failure without secrets");
  ok(m.publicErrorMessage(e3,{})==="plain failure without secrets","clean messages pass through");
  const rs=m.publicProviderResults([{ok:false,error:"bad https://x.ai/v1?token=tok999aaa"}],{});
  ok(!JSON.stringify(rs).includes("tok999aaa"),"provider results are sanitized too");
}

/* --- 4. neutralizeEmbeddedFileTags parity with the strong app.js version --- */
{
  const appSrc=fs.readFileSync(path.join(root,"app.js"),"utf8");
  const start=appSrc.indexOf("function neutralizeEmbeddedFileTags(text){");
  ok(start>=0,"app.js contains the canonical function");
  let depth=0,end=-1;
  for(let i=start;i<appSrc.length;i++){const c=appSrc[i];if(c==="{")depth++;else if(c==="}"){depth--;if(depth===0){end=i+1;break}}}
  const fnSrc=appSrc.slice(start,end);
  const appNeutralize=new Function("text",fnSrc.slice(fnSrc.indexOf("{")+1,fnSrc.lastIndexOf("}")));
  const samples=["<file>","</file>",'<file path="a">',"<attached_files>","</attached_files>",
    "<user_task>","<bridge_response_contract>","<bridge_retry>","<original_task>","<peer_answers>",
    "<verification_context>","<system>","</system>","<assistant>","<user>","<developer>",
    "<instructions>","<instruction>","<tool>","<function_call>","<function_calls>","<im_start>","<im_end>",
    "<user_goal>","<mentor_doctrine>","<draft_answer>","<evidence>","<agent_observations>",
    "plain text","<b>bold</b> is kept","<filesystem> kept?","a<b","x < file > y"];
  for(const s of samples)ok(m.neutralizeEmbeddedFileTags(s)===appNeutralize(s),`parity for ${JSON.stringify(s.slice(0,40))}`);
  ok(m.neutralizeEmbeddedFileTags("<system>")!=="<system>","strong version neutralizes <system> (the old weak one did not)");
}

/* --- 5. schedules: validation --- */
{
  const badTime=await m.handleSchedules(post("/api/schedules",{name:"n",time:"25:00",timezone:"UTC",prompt:"p"}),env0,new URL("https://x/api/schedules"));
  ok(badTime.status===400,"bad time HH:MM rejected");
  const badTz=await m.handleSchedules(post("/api/schedules",{name:"n",time:"09:00",timezone:"Nope/Zone",prompt:"p"}),env0,new URL("https://x/api/schedules"));
  ok(badTz.status===400,"bad timezone rejected");
  const noPrompt=await m.handleSchedules(post("/api/schedules",{name:"n",time:"09:00",timezone:"UTC",prompt:""}),env0,new URL("https://x/api/schedules"));
  ok(noPrompt.status===400,"empty prompt rejected");
  const unauth=await m.handleSchedules(post("/api/schedules",{name:"n",time:"09:00",prompt:"p"},{authorization:"Bearer nope","content-type":"application/json"}),env0,new URL("https://x/api/schedules"));
  ok(unauth.status===401,"schedules require auth");
}
/* --- 5. schedules: CRUD --- */
{
  const created=await m.handleSchedules(post("/api/schedules",{name:"Morning brief",time:"09:30",timezone:"Europe/Kyiv",prompt:"Summarize the news."}),env0,new URL("https://x/api/schedules"));
  ok(created.status===200,"POST /api/schedules -> 200");
  const cj=await j(created);
  ok(cj.ok&&cj.schedule.id&&cj.schedule.time==="09:30"&&cj.schedule.timezone==="Europe/Kyiv","schedule stored with fields");
  ok(cj.schedule.nextRun>Date.now(),"nextRun computed in the future");
  ok(cj.schedule.enabled===true&&cj.schedule.lastRun===null,"defaults: enabled, no lastRun");
  const id=cj.schedule.id;
  const listed=await m.handleSchedules(get("/api/schedules"),env0,new URL("https://x/api/schedules"));
  const lj=await j(listed);
  ok(lj.ok&&Array.isArray(lj.schedules)&&lj.schedules.some(s=>s.id===id),"GET /api/schedules lists it");
  const del=await m.handleSchedules(new Request("https://x/api/schedules/"+id,{method:"DELETE",headers:auth.headers}),env0,new URL("https://x/api/schedules/"+id));
  const dj=await j(del);ok(del.status===200&&dj.ok===true,"DELETE /api/schedules/:id -> {ok:true}");
  ok(await m.scheduleGet(env0,id)===null,"schedule gone from the store");
}
/* --- 5. timezone helpers --- */
{
  ok(m.validTimezone("Europe/Kyiv")===true,"Europe/Kyiv valid");
  ok(m.validTimezone("Nope/Zone")===false,"Nope/Zone invalid");
  ok(m.nextRunTimestamp("UTC","00:00")>Date.now(),"nextRunTimestamp always in the future");
  const clean=m.sanitizeSchedule({name:"t",time:"08:15",prompt:"do it"});
  ok(clean.ok&&clean.value.timezone==="UTC"&&clean.value.enabled===true,"timezone defaults to UTC");
}
/* --- 5. runDueSchedules skips future/disabled schedules --- */
{
  const now=Date.now();
  await m.schedulePut(env0,{id:"sch_future",name:"f",time:"00:00",timezone:"UTC",prompt:"p",enabled:true,createdAt:now,lastRun:null,nextRun:now+3600e3});
  await m.schedulePut(env0,{id:"sch_disabled",name:"d",time:"00:00",timezone:"UTC",prompt:"p",enabled:false,createdAt:now,lastRun:null,nextRun:now-1000});
  const fired=await m.runDueSchedules(env0,null);
  ok(fired===0,"nothing due -> 0 fired");
  await m.scheduleDelete(env0,"sch_future");await m.scheduleDelete(env0,"sch_disabled");
}

/* --- 6. research contract --- */
{
  const noQ=await m.handleResearch(post("/api/research",{}),env0);
  ok(noQ.status===400,"missing query -> 400");
  const secretQ=await m.handleResearch(post("/api/research",{query:"my key is sk-abcdefghijklmnop1234"}),env0);
  ok(secretQ.status===400,"credential-like query rejected");
  const plan=m.parseResearchPlan('Here are queries:\n["best llm 2026","openai vs anthropic pricing"]\nDone.');
  ok(JSON.stringify(plan)===JSON.stringify(["best llm 2026","openai vs anthropic pricing"]),"parseResearchPlan extracts the JSON array");
  ok(m.parseResearchPlan("no json here").length===0,"parseResearchPlan empty on garbage");
  const pr=m.researchPlanPrompt("quantum dots");
  ok(pr.includes("quantum dots")&&pr.includes("JSON array"),"researchPlanPrompt embeds the query");
  const srcs=m.dedupeResearchSources([{title:"t1",url:"https://a/1",snippet:"s1"},{title:"t1b",url:"https://a/1",snippet:"s1b"},{title:"t2",url:"https://b/2",snippet:"s2"}],10);
  ok(srcs.length===2&&srcs[0].n===1&&srcs[1].n===2,"dedupeResearchSources dedupes by URL and numbers sources");
}

/* --- 7. project KB (RAG-lite) --- */
{
  const noQ=await m.handleKbQuery(post("/api/projects/prj_x/kb/query",{}),env0,"prj_x");
  ok(noQ.status===400,"KB: missing query -> 400");
  const noPrj=await m.handleKbQuery(post("/api/projects/nope/kb/query",{query:"x"}),env0,"nope");
  ok(noPrj.status===404,"KB: unknown project -> 404");
  const pRes=await m.handleProjects(post("/api/projects",{name:"KB test",instructions:"kb",files:[]}),env0);
  const pj=await j(pRes),pid=pj.item.id;
  const noFiles=await m.handleKbQuery(post(`/api/projects/${pid}/kb/query`,{query:"x"}),env0,pid);
  ok(noFiles.status===400,"KB: project without files -> 400");
  const chunks=m.kbChunks(new Array(1201).join("word "));
  ok(chunks.length===3,"kbChunks splits ~1200 words into 3 chunks of ~500");
  ok(m.kbQueryTerms("The Quick, brown fox!").includes("quick"),"kbQueryTerms tokenizes");
  const ranked=m.kbRankChunks([{name:"a.md",text:"nothing relevant here at all"},{name:"b.md",text:"kubernetes deployment scales pods across nodes"}], "kubernetes deployment pods");
  ok(ranked.length&&ranked[0].file==="b.md","kbRankChunks ranks the relevant file first");
  const withFiles=await m.handleProjects(post("/api/projects",{name:"KB files",instructions:"kb",files:[{name:"guide.md",text:"The bridge session token expires after fourteen days of inactivity."}]}),env0);
  const wj=await j(withFiles),wid=wj.item.id;
  ok(wj.item.fileCount===1,"project stores KB files (fileCount=1)");
  const kbRes=await m.handleKbQuery(post(`/api/projects/${wid}/kb/query`,{query:"how long until the session token expires"}),env0,wid);
  ok(kbRes.status===503,"KB: no provider configured -> 503 (deterministic, no network)");
  const badFiles=await m.handleProjects(post("/api/projects",{name:"bad",instructions:"x",files:"nope"}),env0);
  ok(badFiles.status===400,"KB: non-array files rejected");
  let threw=false;try{m.sanitizeProjectFiles([{name:"s",text:"api_key=sk-abcdefghijklmnop"}])}catch(e){threw=true}
  ok(threw,"KB: credential-like file content rejected");
}

/* --- 8. vision --- */
{
  const tinyPng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const parsed=m.parseVisionImage(tinyPng);
  ok(parsed.mime==="image/png"&&parsed.data.length>0,"parseVisionImage accepts a data URL");
  const rawB64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  ok(m.parseVisionImage(rawB64).mime==="image/png","parseVisionImage sniffs PNG magic bytes");
  let tooBig=false;try{m.parseVisionImage("iVBORw0KGgo"+"A".repeat(7_000_000))}catch(e){tooBig=e.status===413}
  ok(tooBig,"parseVisionImage rejects >5MB with 413");
  let bad=false;try{m.parseVisionImage("not-an-image")}catch(e){bad=e.status===400}
  ok(bad,"parseVisionImage rejects garbage with 400");
  const noImg=await m.handleVisionAnalyze(post("/api/vision/analyze",{}),env0);
  ok(noImg.status===400,"vision: missing image -> 400");
  const noProv=await m.handleVisionAnalyze(post("/api/vision/analyze",{image:tinyPng}),env0);
  ok(noProv.status===503,"vision: no vision provider -> 503");
  const nj=await j(noProv);ok(nj.ok===false,"vision 503 body has ok:false");
}

/* --- 9. reapDeadJobs --- */
{
  const kv=fakeStore(),env={BRIDGE_ACCESS_TOKEN:"x",AI_BRIDGE_JOBS:kv};
  const old=Date.now()-20*60*1000,now=Date.now();
  await kv.put("job:old1",JSON.stringify({status:"processing",startedAt:old,heartbeatAt:old,updatedAt:old,requestFingerprint:"a"}));
  await kv.put("job:fresh1",JSON.stringify({status:"processing",startedAt:now,heartbeatAt:now,updatedAt:now,requestFingerprint:"b"}));
  await kv.put("job:done1",JSON.stringify({status:"done",updatedAt:old}));
  const n=await m.reapDeadJobs(env);
  ok(n===1,"reapDeadJobs failed exactly the dead job");
  const dead=JSON.parse(await kv.get("job:old1"));
  ok(dead.status==="failed"&&dead.error&&dead.error.error==="timeout: worker restarted","dead job marked failed with the timeout error");
  const fresh=JSON.parse(await kv.get("job:fresh1"));
  ok(fresh.status==="processing","live job untouched");
  const done=JSON.parse(await kv.get("job:done1"));
  ok(done.status==="done","finished job untouched");
  const pushed=await m.notifyJobComplete(env,"old1","",false);
  ok(pushed===0,"notifyJobComplete without VAPID keys is a safe no-op");
}

console.log("\nAll v5.10.0 backend tests passed.");
