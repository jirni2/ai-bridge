import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL("./worker-v39-under-test.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

const source=`<project_manifest>
READABLE FILES (2):
- a.js
- b.js
</project_manifest>
<file path="a.js" original_chars="120" truncated="false">
const A = 1;
function alpha(){ return A; }
</file>
<file path="b.js" original_chars="140" truncated="false">
const B = 2;
function beta(){ return B; }
</file>`;

let v=m.verifyFindingEvidence({file:"a.js",code_evidence:"function alpha(){ return A; }"},source,"project.zip");
ok(v.quoteMatched===true&&v.startLine===2,"evidence matches complete line in stated file");

v=m.verifyFindingEvidence({file:"a.js",code_evidence:"function beta(){ return B; }"},source,"project.zip");
ok(v.quoteMatched===false&&v.reason==="evidence_not_found_as_complete_lines","evidence from b.js cannot verify a.js claim");

v=m.verifyFindingEvidence({file:"a.js",code_evidence:"function alpha(){"},source,"project.zip");
ok(v.quoteMatched===false,"partial source line is rejected");

v=m.verifyFindingEvidence({file:"a.js",code_evidence:"[FRAGMENT ENDS HERE — THIS IS NOT END OF FILE]"},source,"project.zip");
ok(v.quoteMatched===false,"fragment marker cannot be evidence");

const long=`first line
second line with complete syntax;
third line with complete syntax;
fourth line with complete syntax;
fifth line with complete syntax;
sixth line with complete syntax;`;
const sample=m.sampleHeadTail(long,100);
ok(sample.includes("FRAGMENT ENDS HERE — THIS IS NOT END OF FILE"),"partial sample marks non-EOF boundary");
ok(!sample.includes("synta")||sample.includes("syntax;"),"sampling keeps complete source lines when line boundaries exist");

ok(m.meaningfulProviderText("I cannot review this because I do not have the full file.")===false,"short no-file refusal is not a successful review");
ok(m.meaningfulProviderText("In _worker.js, withRetry can lose the original HTTP status when a timeout wrapper replaces the provider error. Preserve status 429, record Retry-After, and add a regression test that verifies the second network attempt without deleting successful peer results.")===true,"substantive review remains meaningful");

fs.unlinkSync(tmp);
console.log("All v3.9 behavior tests passed.");
