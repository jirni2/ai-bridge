import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v42-test.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(m.meaningfulProviderText("OK")===false,"OK is not meaningful");
ok(m.meaningfulProviderText("yes")===false,"yes is not meaningful");
ok(m.meaningfulProviderText("Looks good.")===false,"Looks good is not meaningful");
ok(m.meaningfulProviderText("I cannot review this because I do not have the full file.")===false,"no-file refusal is not meaningful");
ok(m.meaningfulProviderText("In _worker.js, meaningfulProviderText accepts one-word answers and should reject them before synthesis because otherwise an empty review can be treated as success.")===true,"substantive review remains meaningful");
let d=m.parseRetryDelayFromErrorText(JSON.stringify({error:{details:[{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"53.123s"}]}}));
ok(Math.round(d.ms)===53123&&d.source==="google.rpc.RetryInfo","Google RetryInfo JSON is parsed");
d=m.parseRetryDelayFromErrorText("Quota exceeded. Please retry in 58.688587743s.");
ok(Math.round(d.ms)===58689&&d.source==="google-message","Google message fallback is parsed");
d=m.parseRetryDelayFromErrorText("Rate limit reached. Please try again in 24.599999999s.");
ok(Math.round(d.ms)===24600&&d.source==="provider-message","Groq try-again delay is parsed");
d=m.parseRetryDelayFromErrorText("Please retry in 120s.");
// v4.5.10: cap raised 60s -> 75s so a real ~60s Google RetryInfo has genuine
// headroom instead of clearing the old cap by only 423ms. Still capped.
ok(d.ms===75000,"Retry delay is capped at the configured cap (75s)");
ok(m.parseRetryDelayFromErrorText("Please retry in 59.577s.").ms===59577,"a real 59.577s RetryInfo is passed through uncapped and unrounded");
const project=`<project_manifest>
READABLE FILES (2):
- _worker.js
- other.js
</project_manifest>
<file path="_worker.js" original_lines="30" truncated="false">
<segment kind="full" start_line="1" end_line="30">
const unrelated = 1;
function alpha(){ return 1; }
function sanitizeJudgeFinding(raw){
  return {
    claim:String(raw.claim||""),
    code_evidence:stripOuterNewlines(String(raw.code_evidence??""))
  };
}
function withRetry(fn, opts){
  return fn();
}
function runJudgeCandidates(candidates, runner){
  return candidates;
}
const tail = 9;
</segment>
</file>
<file path="other.js" original_lines="5" truncated="false">
<segment kind="full" start_line="1" end_line="5">
function irrelevant(){ return "x"; }
</segment>
</file>`;
const reviews=[{ok:true,text:"The sanitizer bug is in sanitizeJudgeFinding() in _worker.js, and withRetry() / runJudgeCandidates() should also be checked."}];
const ctx=m.buildClaimDirectedVerificationContext(project,reviews,3000);
ok(ctx.includes("sanitizeJudgeFinding"),"directed context includes sanitizer");
ok(ctx.includes("withRetry"),"directed context includes retry helper");
ok(ctx.includes("runJudgeCandidates"),"directed context includes Judge helper");
ok(ctx.includes('path="_worker.js"'),"directed context is file scoped");
let retryEvent=null,calls=0;
const result=await m.withRetry(async()=>{calls++;if(calls===1){const e=new Error("quota");e.status=429;e.retryAfterMs=1;e.retryDelaySource="google.rpc.RetryInfo";throw e}return "ok"},
 {attempts:2,retryStatuses:[429],delays:[0],jitter:0,onRetry:info=>{retryEvent=info}});
ok(result==="ok"&&calls===2,"withRetry retries quota error");
ok(retryEvent?.status===429&&retryEvent?.delaySource==="google.rpc.RetryInfo","retry callback exposes delay source");
fs.unlinkSync(tmp);
console.log("All v4.2 behavior tests passed.");
