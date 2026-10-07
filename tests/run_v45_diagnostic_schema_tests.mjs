import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL("./worker-v45-schema.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
function valid(x){
  return x && typeof x.path==="string" && x.path.length>0 &&
    (x.start_line===null||Number.isInteger(x.start_line)) &&
    (x.end_line===null||Number.isInteger(x.end_line)) &&
    typeof x.reason==="string" && x.reason.length>0 &&
    typeof x.segment_kind==="string" && x.segment_kind.length>0;
}
const cases=[
 {kind:"head",path:"head.js",review:"Check targetHead() in head.js.",project:`<file path="head.js" original_lines="1000" truncated="true">
<segment kind="head" start_line="1" end_line="3">
const a = 1;
function targetHead(){ return 2; }
const b = 3;
</segment>
[MIDDLE OF FILE OMITTED BY BRIDGE]
<segment kind="tail" start_line="901" end_line="903">
const x = 1;
const y = 2;
const z = 3;
</segment>
</file>`},
 {kind:"tail",path:"tail.js",review:"Check targetTail() in tail.js.",project:`<file path="tail.js" original_lines="1000" truncated="true">
<segment kind="head" start_line="1" end_line="3">
const a = 1;
const b = 2;
const c = 3;
</segment>
[MIDDLE OF FILE OMITTED BY BRIDGE]
<segment kind="tail" start_line="949" end_line="952">
const x = 1;
function targetTail(){ return 950; }
const y = 3;
const z = 4;
</segment>
</file>`},
 {kind:"full",path:"full.js",review:"Check targetFull() in full.js.",project:`<file path="full.js" original_lines="4" truncated="false">
<segment kind="full" start_line="1" end_line="4">
const a = 1;
function targetFull(){ return 2; }
const b = 3;
const c = 4;
</segment>
</file>`}
];
for(const tc of cases){
  const meta={};
  m.buildClaimDirectedVerificationContext(tc.project,[{ok:true,text:tc.review}],5000,meta);
  const hit=meta.excerpts.find(x=>x.path===tc.path&&x.reason==="symbol/literal");
  ok(!!hit,`${tc.kind}: symbol/literal excerpt exists`);
  ok(hit.segment_kind===tc.kind,`${tc.kind}: segment_kind preserved`);
  ok(hit.sample_kind==="symbol-literal-hit",`${tc.kind}: sample_kind preserved`);
  ok(valid(hit),`${tc.kind}: schema valid`);
}
const meta={};
m.buildClaimDirectedVerificationContext(cases[2].project,[{ok:true,text:cases[2].review}],5000,meta);
ok(meta.excerpts.every(valid),"all diagnostics excerpts satisfy schema");
ok(meta.excerptCount===meta.excerpts.length,"excerptCount matches list length");
fs.unlinkSync(tmp);
console.log("All v4.5 diagnostic schema tests passed.");
