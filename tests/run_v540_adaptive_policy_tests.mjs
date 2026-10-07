import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const mod=await import(new URL(`../_worker.js?adaptive=${Date.now()}`,import.meta.url));
let passed=0;const ok=(v,m)=>{assert.ok(v,m);passed++};

ok(app.includes("function selectAgentPolicy"),"client selects a task-specific learned policy");
ok(app.includes("agentPolicy,images:"),"structured policy is sent separately from raw memory");
ok(app.includes('taskType==="web"&&!evidenceSources'),"unverified web runs are not learned");
ok(app.includes("successes/(successes+failures+1)"),"successes and failures update bounded confidence");
ok(worker.includes("function safeAgentPolicy"),"server validates learned policy");
ok(worker.includes('confidence<.5'),"low-confidence policy is rejected");
ok(worker.includes('trust="advisory-only"'),"policy cannot override the current user goal");
ok(worker.includes("policy?.preferredHelpers"),"validated policy influences helper ordering");
ok(worker.includes("agentPolicyApplied:!!policy"),"runtime reports whether learning affected the run");
ok(!app.includes("localStorage.setItem(AGENT_LESSONS_KEY,JSON.stringify({prompt"),"raw prompt is not stored as a lesson");
const accepted=mod.safeAgentPolicy({taskType:"web",preferredTools:["search_web","finish","unknown"],preferredHelpers:["gemini","evil"],confidence:.8,successes:3,evidenceSources:2});
ok(accepted?.preferredTools.join(",")==="search_web,finish"&&accepted?.preferredHelpers.join(",")==="gemini","policy validation strips unknown tools and providers");
ok(mod.safeAgentPolicy({taskType:"web",confidence:.2,successes:4})===null,"low-confidence policy is rejected at runtime");
ok(mod.agentDelegateOrder(["groqfree","gemini"],"auto","",["gemini"])[0]==="gemini","learned helper preference changes the deterministic order");

console.log(`v5.4.0 adaptive policy tests passed (${passed} assertions).`);
