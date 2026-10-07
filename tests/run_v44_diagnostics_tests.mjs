import fs from "node:fs";
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),client=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(worker.includes("verificationExcerpts"),"Worker records verification excerpts");
ok(worker.includes("verificationExcerptCount"),"Worker records verification excerpt count");
ok(worker.includes('type:"judge_context_ready"'),"Worker streams context-ready");
ok(client.includes("verificationExcerpts:evt.verificationExcerpts||[]"),"Client keeps live excerpt list");
ok(client.includes("verificationExcerptCount:evt.verificationExcerptCount||0"),"Client keeps live excerpt count");
console.log("All v4.4 diagnostics tests passed.");
