import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/* v5.9.14 Deep Scan 404 fix: regression guard.
   runDeepScan previously never persisted its part payloads via
   savePendingPayload, so when pollJobStatus hit 404 (unknown job) after the
   grace window, resubmitPendingJob(clientRequestId) silently found nothing
   and the scan died with "Bridge не знайшов це завдання після повторних
   перевірок". This test statically verifies app.js keeps:
   1. savePendingPayload(payload.clientRequestId, payload) BEFORE every
      streamingRunRequest(payload, ...) inside runDeepScan (parts loop +
      final synthesis request), including the retry branch with a fresh id;
   2. deletePendingPayload(payload.clientRequestId) after each successful
      part and after the successful final request (no unbounded growth);
   3. 404 in the one-shot retry status list of the parts loop. */

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"app.js"),"utf8");

const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

// Extract the runDeepScan function body (from its declaration to the next
// top-level "async function" after it).
const start=src.indexOf("async function runDeepScan(prompt,plan){");
ok(start>=0,"runDeepScan exists in app.js");
const tail=src.slice(start);
const nextFn=tail.slice(1).search(/\nasync function |\nfunction /);
const body=nextFn>0?tail.slice(0,nextFn+1):tail;
ok(body.length>2000,"runDeepScan body extracted");

// 1a. parts loop: save BEFORE first streamingRunRequest
const saveIdx=body.indexOf("await savePendingPayload(payload.clientRequestId,payload);");
const reqIdx=body.indexOf("let run=await streamingRunRequest(payload,onState);");
ok(saveIdx>=0,"parts loop saves pending payload before streamingRunRequest");
ok(reqIdx>=0,"parts loop calls streamingRunRequest");
ok(saveIdx<reqIdx,"savePendingPayload comes before streamingRunRequest for parts");

// 1b. retry branch: save again under the fresh clientRequestId
const retryNewId=body.indexOf("payload.clientRequestId=newRequestId();");
const saveAfterRetry=body.indexOf("await savePendingPayload(payload.clientRequestId,payload);",retryNewId);
const retryReq=body.indexOf("run=await streamingRunRequest(payload,onState);",retryNewId);
ok(retryNewId>=0,"retry branch regenerates clientRequestId");
ok(saveAfterRetry>=0&&saveAfterRetry<retryReq,"retry branch saves payload under the new id before the retry request");
ok(retryReq>retryNewId,"retry request found after the new clientRequestId");

// 1c. final synthesis request: save before request
const finalReq=body.indexOf("const run=await streamingRunRequest(payload,onState);");
ok(finalReq>=0,"final synthesis request exists");
const saveBeforeFinal=body.lastIndexOf("await savePendingPayload(payload.clientRequestId,payload);",finalReq);
ok(saveBeforeFinal>=0&&saveBeforeFinal<finalReq,"final synthesis payload is saved before the request");

// 2. cleanup: deletePendingPayload after part success and after final success
const deleteCount=(body.match(/await deletePendingPayload\(payload\.clientRequestId\)/g)||[]).length;
ok(deleteCount>=2,"pending payload deleted after part success and after final success (found "+deleteCount+")");

// 3. 404 is part of the one-shot retry list
const retryList=body.match(/if\(!run\.ok&&\[([\d,]+)\]\.includes\(Number\(run\.status\)\)\)/);
ok(retryList,"parts-loop retry condition found");
const statuses=retryList[1].split(",").map(Number);
for(const s of [404,429,499,500,502,503,504])ok(statuses.includes(s),"retry list includes "+s);

// 4. checkpoint logic untouched: still saves notes per part and clears on success
ok(body.includes("saveDeepScanCheckpoint(checkpointSignature,notes,"),"per-part checkpoint save preserved");
ok(body.includes("clearDeepScanCheckpoint(checkpointSignature)"),"checkpoint cleared on final success");

console.log("\nAll v5.9.14 deep-scan resubmit checks passed.");
