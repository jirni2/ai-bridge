import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL(`./worker-v38-run-${process.pid}-${Date.now()}.mjs`,import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

const ctx=`<project_manifest>
READABLE FILES (2):
- a.js
- b.js
</project_manifest>
<file path="a.js" original_chars="120" truncated="false">
const A = 1;
function alpha(){ return A; }
</file>
<file path="b.js" original_chars="140" truncated="true">
const B = 2;
function beta(){ return B; }
</file>`;
const sampled=m.groqSampleContext(ctx,5000);
ok(sampled.includes("a.js")&&sampled.includes("function alpha"),"Groq sampling includes file A with attributes");
ok(sampled.includes("b.js")&&sampled.includes("function beta"),"Groq sampling includes file B with attributes");
ok(sampled.includes("PARTIAL GROQ REVIEW"),"Groq sampling labels partial review");

ok(m.meaningfulProviderText("Concrete review: _worker.js has a specific retry issue in withRetry(), and this explanation is long enough to be a substantive provider result.")===true,"substantive provider review is meaningful");
ok(m.meaningfulProviderText("")===false,"empty provider text is rejected");
ok(m.meaningfulProviderText("[OpenRouter returned no text]")===false,"placeholder provider text is rejected");

const source=`<file path="x.js" original_chars="99" truncated="false">
function safe(){ return 42; }
const route = "/api/work/provider";
</file>`;
let v=m.verifyFindingEvidence({file:"x.js",code_evidence:'const route = "/api/work/provider";'},source);
ok(v.quoteMatched===true,"exact code evidence verifies");
v=m.verifyFindingEvidence({file:"x.js",code_evidence:'const route = "/api/does-not-exist";'},source);
ok(v.quoteMatched===false,"invented code evidence is rejected");
v=m.verifyFindingEvidence({file:"missing.js",code_evidence:'function safe(){ return 42; }'},source);
ok(v.quoteMatched===false,"wrong file path downgrades evidence");

let calls=0;
const retryResult=await m.withRetry(async()=>{calls++;if(calls===1){const e=new Error("429");e.status=429;throw e}return "ok"},{attempts:2,delays:[0],jitter:0});
ok(retryResult==="ok"&&calls===2,"withRetry actually retries 429 then succeeds");

fs.unlinkSync(tmp);
console.log("All v3.8 behavioral tests passed.");
