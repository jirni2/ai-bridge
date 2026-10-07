/* v5.9.10 regression: deterministic arithmetic and honest volatile learning. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const tmp=path.join(root,"tests",`worker-v5910-${process.pid}-${Date.now()}.mjs`);
fs.copyFileSync(path.join(root,"_worker.js"),tmp);
try{
  const m=await import(pathToFileURL(tmp).href);
  ok(m.safeArithmeticAnswer("What is 2+2? Answer with only the number.")==="4","English arithmetic is answered locally");
  ok(m.safeArithmeticAnswer("Скільки буде 7 × 6?")==="42","Ukrainian multiplication is answered locally");
  ok(m.safeArithmeticAnswer("чому дорівнює 10 ÷ 4?")==="2.5","Unicode division is supported without eval");
  ok(m.safeArithmeticAnswer("What happened on 2026-09-26?")===null,"dates are not misread as arithmetic");
  ok(m.safeArithmeticAnswer("What is 1/0?")===null,"division by zero falls back safely");
  ok(m.safeArithmeticAnswer("calculate 2+2 and 3+3")===null,"multiple expressions fall back instead of guessing");
  const collapsed='<main><h1>Visible</h1><details><summary>Advanced</summary><p>Secret collapsed limitation</p></details><details open><summary>Open section</summary><p>Visible open detail</p></details></main>';
  const visible=m.htmlToAgentText(collapsed);
  ok(visible.includes("Visible")&&visible.includes("Advanced")&&!visible.includes("Secret collapsed limitation"),"Agent page text excludes collapsed details body");
  ok(visible.includes("Visible open detail"),"Agent page text preserves open details body");
  const route=m.decideRoute({}, {mode:"auto",prompt:"What is 2+2?",searchFirst:true});
  ok(route.route==="local"&&route.reason==="deterministic_arithmetic","Auto routes elementary arithmetic before web search");
  let calls=0;const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error("network must not be used")};
  try{
    const out=await m.runTeam({}, {mode:"auto",prompt:"What is 2+2?",displayPrompt:"What is 2+2?",searchFirst:true});
    ok(out.final==="4"&&out.meta.route==="local"&&out.meta.aiCalls===0&&calls===0,"local arithmetic uses neither search nor AI");
  }finally{globalThis.fetch=oldFetch}
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
  ok(app.includes('local:["routeSearchOnly","noai"]'),"UI labels the local route as no-AI");
  ok(app.includes('isolate memory — resets after Worker restart'),"self-check warns that unbound learning is volatile");
  console.log("v5.9.10 audit fixes tests PASS");
}finally{fs.rmSync(tmp,{force:true})}
