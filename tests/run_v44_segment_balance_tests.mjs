import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v44-segment.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const head=[];for(let i=1;i<=100;i++)head.push(`const head${i} = ${i};`);
const tail=[];for(let i=901;i<=1000;i++)tail.push(i===950?"function criticalTailHandler(){ return 950; }":`const tail${i} = ${i};`);
const project=`<file path="a.js" original_lines="1000" truncated="true">
<segment kind="head" start_line="1" end_line="100">
${head.join("\n")}
</segment>
[MIDDLE OF FILE OMITTED BY BRIDGE]
<segment kind="tail" start_line="901" end_line="1000">
${tail.join("\n")}
</segment>
</file>`;
const file=m.extractSourceFile(project,"a.js","p.zip"),wins=m.evenlySpacedFileWindows(file,18,5);
ok(wins.some(x=>x.segmentKind==="head"),"windows include head segment");
ok(wins.some(x=>x.segmentKind==="tail"),"windows include tail segment");
ok(wins.some(x=>x.start<=950&&x.end>=950),"tail primary window reaches line 950");
const meta={};
const ctx=m.buildClaimDirectedVerificationContext(project,[{ok:true,text:"There may be a problem somewhere in a.js. Inspect that file carefully."}],6000,meta);
ok(ctx.includes("criticalTailHandler"),"file-only Judge context contains tail function");
ok(meta.excerpts.some(x=>x.path==="a.js"&&x.start_line<=950&&x.end_line>=950),"diagnostics list tail excerpt covering line 950");
ok(meta.excerptCount===meta.excerpts.length&&meta.excerptCount>1,"diagnostics expose excerpt count/list");
fs.unlinkSync(tmp);console.log("All v4.4 segment-balance tests passed.");
