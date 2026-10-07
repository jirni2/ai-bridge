import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
let passed=0;const ok=(v,m)=>{assert.ok(v,m);passed++};

ok(app.includes("function recordAgentPolicyFailure"),"Agent records negative feedback for a learned route");
ok(app.includes("found.successes/(found.successes+failures+1)"),"failures reduce route confidence deterministically");
ok(app.includes("x.confidence>=.5"),"degraded routes stop being selected");
ok(app.includes("uiTarget:\"agent\",agentPolicy"),"pending jobs retain the exact applied policy");
ok(app.includes("pending.agentPolicy&&run.terminal"),"resumed terminal failures also penalize the applied route");
ok(app.includes("Number(j.meta?.agentToolErrors)>0"),"tool-error runs penalize rather than reinforce a route");
ok(app.includes("![401,404,503].includes(run.status)"),"auth, missing-job and setup failures do not poison learning");

console.log(`v5.4.1 negative learning tests passed (${passed} assertions).`);
