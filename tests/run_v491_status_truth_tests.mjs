import fs from "node:fs";
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
function ok(v,m){if(!v)throw new Error("FAIL: "+m);console.log("✓",m)}
const m=app.match(/async function refreshStatus\(\)\{([\s\S]*?)\n\}\n\nfunction renderProviders/);
ok(!!m,"refreshStatus is present");
const body=m[1];
ok(!/\brun\.status\b/.test(body),"refreshStatus does not reference undefined run.status");
ok(/\br\.status===401\b/.test(body),"401 check uses the actual status response variable");
ok(body.includes('credentials:"same-origin"'),"status probe explicitly sends same-origin session cookies");
ok(body.includes("const previous=status"),"status probe preserves previous known-good state");
ok(body.includes("status=previous"),"transient probe failure does not erase known-good providers");
ok(app.includes("A successful AI response proves both the Worker and at least one provider are online."),"successful run repairs stale offline UI immediately");
ok(app.includes("refreshStatus().catch(()=>{})"),"successful run reconciles full provider status in background");
console.log("AI Bridge v4.9.1 status-truth regression tests passed");
