import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v43-context.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const lines=[];for(let i=1;i<=100;i++)lines.push(i===71?"function criticalTailHandler(){ return 71; }":`const line${i} = ${i};`);
const project=`<file path="a.js" original_lines="100" truncated="false">
<segment kind="full" start_line="1" end_line="100">
${lines.join("\n")}
</segment>
</file>`;
const ctx=m.buildClaimDirectedVerificationContext(project,[{ok:true,text:"There may be a problem somewhere in a.js. Please inspect that file carefully."}],6000);
ok(ctx.includes("criticalTailHandler"),"file-only context reaches function on line 71");
ok(ctx.includes('reason="file-only-uniform"'),"file-only fallback uses uniform windows");
const lits=m.reviewerHintLiterals([{ok:true,text:"Check `/api/work/synthesize-stream`, `#judgeEvidencePanel`, and work-controller.js."}]);
ok(lits.includes("/api/work/synthesize-stream"),"endpoint hint extracted");
ok(lits.includes("#judgeEvidencePanel"),"selector hint extracted");
ok(lits.some(x=>x.includes("work-controller.js")),"file hint extracted");
fs.unlinkSync(tmp);console.log("All v4.3 context tests passed.");
