import fs from "node:fs";import vm from "node:vm";
vm.runInThisContext(fs.readFileSync(new URL("../work-ui-core.js",import.meta.url),"utf8"));
const text=globalThis.AIBridgeWorkUICore.judgeEventLabel({type:"judge_retry",attempt:1,nextAttempt:2,maxAttempts:2,status:429,retryDelayMs:53123,retryDelaySource:"google.rpc.RetryInfo"},"Gemini");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(text.includes("attempt 1/2"),"label contains attempt 1/2");ok(text.includes("429"),"label contains status");ok(text.includes("53s"),"label contains wait");ok(text.includes("google.rpc.RetryInfo"),"label contains delay source");ok(text.includes("next 2/2"),"label contains next attempt");
console.log("All v4.3 UI behavior tests passed.");
