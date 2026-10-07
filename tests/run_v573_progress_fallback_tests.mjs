import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";

const root=path.resolve(new URL("..",import.meta.url).pathname);
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");

assert.ok(app.includes('if(!progress?.phase)return t("agentThinking")'),"Agent trace falls back when a progress frame has no phase");
assert.ok(app.includes('state==="processing"&&progress?.phase'),"Team/God progress renders a phase only when the server supplied one");
assert.ok(!app.includes('state==="processing"&&progress){\n      const phase=t(`agentPhase_${progress.phase}`)'),"raw agentPhase_undefined rendering path is removed");
assert.ok(app.includes('if(statusCode===404)return String(j?.error||t("errJobGone")).slice(0,500)'),"stale recovered jobs show a clear bounded explanation instead of raw HTTP 404");

console.log("AI Bridge v5.7.4 progress and stale-job fallback tests passed (4 assertions).");
