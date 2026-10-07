import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
const root=path.resolve(new URL("..",import.meta.url).pathname),tmp=path.join(root,"tests",`worker-v592-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(tmp,fs.readFileSync(path.join(root,"_worker.js")));
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(x,msg)=>{if(!x)throw Error(msg);console.log("PASS",msg)};
try{
  const html=`<main><h1>AI Bridge v5.9.2</h1><div hidden>Доступна нова версія</div><section aria-hidden="true">SECRET A</section><p style="display:none">SECRET B</p><div class="card hidden notice">SECRET C</div><p>Visible status</p></main>`;
  const text=m.htmlToAgentText(html);
  ok(text.includes("AI Bridge v5.9.2")&&text.includes("Visible status"),"visible HTML remains available to Agent evidence");
  ok(!/Доступна нова версія|SECRET [ABC]/.test(text),"hidden HTML is excluded from Agent evidence");
  const c=m.consensusProviderFallback([{provider:"groqfree",ok:true,text:"Чотири"},{provider:"openrouter",ok:true,text:"Чотири"},{provider:"gemini",ok:true,text:"A very long unrelated answer"}]);
  ok(c?.text==="Чотири"&&c.providers.length===2,"two-provider agreement becomes synthesis fallback");
  ok(m.consensusProviderFallback([{provider:"groqfree",ok:true,text:"4"},{provider:"openrouter",ok:true,text:"5"}])===null,"no false consensus is invented");
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),zw=fs.readFileSync(path.join(root,"zip-worker.js"),"utf8");
  ok(/ZIP_FILE_SAMPLE_CHARS=180000/.test(app)&&/ZIP_EXTRACT_MAX_CHARS=8_000_000/.test(app),"main-thread ZIP fallback retains broad source coverage");
  ok(/ZIP_FILE_SAMPLE_CHARS=180000/.test(zw)&&/ZIP_EXTRACT_MAX_CHARS=8000000/.test(zw),"ZIP worker retains broad source coverage");
  ok(/DEEP_SCAN_MAX_PARTS=10/.test(app)&&/const est=(?:String\(x\.f\.text\|\|""\)\.length\+200|Math\.min\(String\(x\.f\.text\|\|""\)\.length,ZIP_FILE_SAMPLE_CHARS\)\+300)/.test(app),"Deep Scan partitions by retained content size rather than obsolete 36k estimate");
}finally{fs.unlinkSync(tmp)}
