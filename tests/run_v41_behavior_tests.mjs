import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL(`./worker-v41-run-${process.pid}-${Date.now()}.mjs`,import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const raw={claim:"indent test",file:"x.js",symbol:"x",code_evidence:"\n        if (authorized) {\n",confidence:"high"};
const sanitized=m.sanitizeJudgeFinding(raw);
ok(sanitized.code_evidence==="        if (authorized) {","sanitizer preserves indentation");
const source=`<file path="x.js" original_lines="1" truncated="false">
<segment kind="full" start_line="1" end_line="1">
        if (authorized) {
</segment>
</file>`;
const v=m.verifyFindingEvidence(sanitized,source,"p.zip");
ok(v.quoteMatched===true&&v.startLine===1,"sanitized indented evidence verifies through sanitizer -> verifier pipeline");
let calls=0;const res=await m.withRetry(async()=>{calls++;if(calls===1){const e=new Error("empty");e.status=502;throw e}return "meaningful"},{attempts:2,retryStatuses:[429,502,503,504],delays:[0],jitter:0});
ok(res==="meaningful"&&calls===2,"retry helper retries retryable 502");
const judged=await m.runJudgeCandidates(["gemini","groqfree"],async(id,diag)=>{if(id==="gemini"){diag.initialCalled=true;diag.repairCalled=true;return {ok:false,error:"invalid json",diagnostic:diag}}diag.initialCalled=true;return {ok:true,text:"ok",structured:{findings:[]},diagnostic:diag};});
ok(judged.judge==="groqfree"&&judged.attempts.length===2,"Judge diagnostics preserve failed candidate and successful fallback");
ok(judged.attempts[0].repairCalled===true&&judged.attempts[1].provider==="groqfree","repair status is retained per Judge candidate");
fs.unlinkSync(tmp);console.log("All v4.1 behavior tests passed.");
