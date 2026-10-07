/* v5.9.5: in-browser site self-check never touches secrets. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const fn=app.slice(app.indexOf("async function runSiteSelfCheck("),app.indexOf("async function refreshSite("));
ok(html.includes('id="selfCheckBtn"')&&html.includes('id="selfCheckResults"')&&html.includes('id="selfCheckCopyBtn"'),"self-check panel exists on the Connect page");
ok(fn.length>1000&&!/accessToken|BRIDGE_ACCESS_TOKEN|providerToken-/.test(fn.replace(/scNeedLogin/g,"")),"self-check never reads the access token or provider token inputs");
ok(fn.includes('credentials:"same-origin"')&&!/https?:\/\//.test(fn),"self-check only calls this same site (no external URLs)");
ok(fn.includes('"/tests/worker-v38-under-test.mjs"')&&fn.includes("→ 404"),"self-check verifies internal files are hidden");
ok(fn.includes("if(withAi)"),"live AI calls are opt-in");
ok(/selfCheckReport=\[/.test(fn)&&!/\.text\(\)\s*\)\s*;?\s*selfCheckReport/.test(fn),"report is built from check names, statuses and details only");
console.log("v5.9.5 self-check tests PASS");
