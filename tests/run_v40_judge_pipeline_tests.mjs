import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v40-judge.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const seen=[];
const out=await m.runJudgeCandidates(["openrouter","gemini"],async id=>{seen.push(id);return id==="openrouter"?{ok:false,error:"invalid JSON"}:{ok:true,text:"good",structured:{findings:[]}}});
ok(out.judge==="gemini"&&seen.join(",")==="openrouter,gemini","failed Judge candidate falls back to next successful reviewer");
let n=0;const p=await m.judgeJsonPipeline(async kind=>{n++;return kind==="initial"?"bad":"still bad"});
ok(!p.parsed&&n===2,"Judge repair is constrained to one retry");
fs.unlinkSync(tmp);console.log("All v4.0 Judge pipeline tests passed.");
