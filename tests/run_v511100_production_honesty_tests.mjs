/* v5.11.100: regressions found by a real production browser test. */
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname);
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
let passed=0;
function ok(value,message){if(!value)throw new Error("FAIL: "+message);passed++;console.log("PASS:",message)}
const app=read("app.js"),i18n=read("i18n.js");

ok(app.includes('const LOCAL_PROVIDER_IDS=new Set(["muse","core"])'),"Muse/Core are explicitly classified as local capabilities");
ok(app.includes("const n=apiProviderIds(j.providers).length"),"top status counts only real API providers");
ok(app.includes("apiProviderIds().length+\"/\"+apiTotal"),"provider badge excludes local capabilities from its API-key ratio");
ok(app.includes('source==="chat"&&["auto","agent","god"].includes(mode)')&&app.includes("coreCanHandleAlone(r)"),"simple Chat questions can use deterministic Core in Auto/Agent/God without cloud keys");
ok(app.includes('t(_sendOutcome==="error"?"activityFailed":"activityDone")'),"activity summary reports failure instead of unconditional success");
for(const lang of ["en","uk","ru"])ok(new RegExp(`${lang}:\\{[^}]*activityFailed:`).test(i18n),`${lang} has an activity failure label`);
console.log(`AI Bridge v5.11.100 production honesty tests passed (${passed} assertions).`);
