import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v40-test.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const source=`<file path="x.js" original_chars="200" original_lines="105" truncated="true">
<segment kind="head" start_line="1" end_line="2">
const top = 1;
if (top) {
</segment>
[MIDDLE OF FILE OMITTED BY BRIDGE]
<segment kind="tail" start_line="103" end_line="105">
        if (authorized) {
          return 42;
        }
</segment>
</file>`;
let v=m.verifyFindingEvidence({file:"x.js",code_evidence:"        if (authorized) {"},source,"p.zip");
ok(v.quoteMatched&&v.startLine===103&&v.endLine===103,"tail evidence maps to original line 103");
v=m.verifyFindingEvidence({file:"x.js",code_evidence:"if (authorized) {"},source,"p.zip");
ok(!v.quoteMatched,"indentation mismatch fails exact quote match");
v=m.verifyFindingEvidence({file:"x.js",code_evidence:"          return 42;\n        }"},source,"p.zip");
ok(v.quoteMatched&&v.startLine===104&&v.endLine===105,"multi-line evidence maps to original absolute range");
const cross=`<file path="a.js" truncated="false">
<segment kind="full" start_line="1" end_line="1">
const AAAAAAAAAAAAAAAAAAAA = 1;
</segment>
</file>
<file path="b.js" truncated="false">
<segment kind="full" start_line="1" end_line="1">
const BBBBBBBBBBBBBBBBBBBB = 2;
</segment>
</file>`;
v=m.verifyFindingEvidence({file:"a.js",code_evidence:"const BBBBBBBBBBBBBBBBBBBB = 2;"},cross,"p.zip");
ok(!v.quoteMatched,"evidence cannot cross file boundary");
ok(!m.meaningfulProviderText("I cannot review this because I do not have the full file."),"short no-file response is not meaningful");
let calls=0;const repaired=await m.judgeJsonPipeline(async kind=>{calls++;return kind==="initial"?"not json":'{"summary":"ok","findings":[]}';});
ok(calls===2&&repaired.parsed&&repaired.repaired,"invalid Judge JSON gets one repair attempt");
ok(m.parseJudgePayload('text ```json\\n{"summary":"ok","findings":[]}\\n```')?.findings,"local deterministic JSON extraction works");
fs.unlinkSync(tmp);console.log("All v4.0 behavior tests passed.");
