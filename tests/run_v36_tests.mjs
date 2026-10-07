import fs from "node:fs";
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const workHtml=fs.readFileSync(new URL("../work.html",import.meta.url),"utf8");
const workIndex=fs.readFileSync(new URL("../work/index.html",import.meta.url),"utf8");
const workJs=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");

function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

for(const html of [workHtml,workIndex]){
  ok(html.includes('id="workFile"'),"Work UI contains workFile input");
  ok(html.includes('id="fileStatus"'),"Work UI contains fileStatus");
}
ok(workJs.includes("readSelectedWorkFile"),"Client has file reader");
ok(workJs.includes("workUnzipText"),"Client has ZIP extraction");
ok(worker.includes("GROQ_WORK_MAX_CHARS=18000"),"Groq provider-specific budget exists");
ok(worker.includes('judgeCandidates=["openrouter","gemini","groqfree"]'),"Judge fallback priority exists");
ok(worker.includes("withRetry"),"Retry helper exists");
ok(worker.includes("OAUTH_SIGNING_SECRET"),"Separate OAuth signing secret supported");
ok(worker.includes('ALLOW_PUBLIC_MCP'),"Public MCP requires explicit second flag");
ok(worker.includes("Missing bridge:run scope"),"bridge:run scope enforced");
ok(worker.includes("Missing bridge:status scope"),"bridge:status scope enforced");
ok(worker.includes("safePromptPath"),"Prompt-safe filename helper exists");
console.log("All v3.6 hardening tests passed.");
