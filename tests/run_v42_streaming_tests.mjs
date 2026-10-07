import fs from "node:fs";
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const client=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(worker.includes('"/api/work/synthesize-stream"'),"streaming synthesis route exists");
ok(worker.includes('application/x-ndjson; charset=utf-8'),"stream endpoint uses NDJSON");
ok(worker.includes('type:"judge_retry"'),"Worker emits retry progress");
ok(worker.includes('type:"judge_network_attempt"'),"Worker emits network-attempt progress");
ok(worker.includes('type:"judge_context_ready"'),"Worker emits context-ready progress");
ok(client.includes('fetch("/api/work/synthesize-stream"'),"Client consumes stream endpoint");
ok(client.includes("judgeEventLabel"),"Client renders Judge phase labels");
ok(client.includes("retryDelaySource"),"Client exposes retry delay source");
ok(client.includes("liveJudgeAttempts"),"Client keeps live Judge attempts");
console.log("All v4.2 streaming tests passed.");
