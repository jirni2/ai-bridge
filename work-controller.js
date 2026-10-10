(function(){"use strict";const $=id=>document.getElementById(id);const UI_VERSION="5.11.109";let mode="review",lastRun=null;const ACCESS_TOKEN_KEY="ai_bridge_access_token";const WORK_PENDING_KEY="ai_bridge_work_pending_v1",WORK_PENDING_MAX_AGE_MS=45*60*1000;
function loadWorkPending(){try{const rows=JSON.parse(localStorage.getItem(WORK_PENDING_KEY)||"[]"),now=Date.now();return Array.isArray(rows)?rows.filter(x=>x&&x.provider&&x.clientRequestId&&now-Number(x.createdAt||0)<WORK_PENDING_MAX_AGE_MS).slice(-6):[]}catch(e){return[]}}
function saveWorkPending(rows){try{const clean=(Array.isArray(rows)?rows:[]).slice(-6);if(clean.length)localStorage.setItem(WORK_PENDING_KEY,JSON.stringify(clean));else localStorage.removeItem(WORK_PENDING_KEY)}catch(e){}}
function upsertWorkPending(rec){const rows=loadWorkPending(),idx=rows.findIndex(x=>x.provider===rec.provider&&x.clientRequestId===rec.clientRequestId);if(idx>=0)rows[idx]={...rows[idx],...rec};else rows.push(rec);saveWorkPending(rows)}
function clearWorkPending(provider,clientRequestId){saveWorkPending(loadWorkPending().filter(x=>!(x.provider===provider&&x.clientRequestId===clientRequestId)))}
function clearLegacyWorkToken(){try{localStorage.removeItem(ACCESS_TOKEN_KEY)}catch(e){}try{sessionStorage.removeItem(ACCESS_TOKEN_KEY)}catch(e){}}function headers(){return {}}async function loginWorkSession(v){const r=await fetch("/api/session/login",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({token:v})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);clearLegacyWorkToken();return j}async function logoutWorkSession(){try{await fetch("/api/session/logout",{method:"POST",cache:"no-store"})}catch(e){}clearLegacyWorkToken()}function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}async function status(){$("workOverall").textContent="Перевіряю…";$("workOverall").className="badge";try{const r=await fetch("/api/status",{headers:headers(),cache:"no-store"}),j=await r.json();if(r.status===401){$("workOverall").textContent="Потрібен токен";$("workOverall").className="badge warn";return}const map=[["gemini","provGemini","modelGemini"],["groqfree","provGroq","modelGroq"],["openrouter","provOpenRouter","modelOpenRouter"]];let n=0;for(const [id,box,model] of map){const on=!!j.providers?.[id];if(on)n++;$(box).classList.toggle("ready",on);$(model).textContent=(j.models?.[id]||"—")+(on?" • KEY SET":" • NOT SET")}if(j.version&&j.version!==UI_VERSION){$("workOverall").textContent=`UI ${UI_VERSION} / Worker ${j.version}`;$("workOverall").className="badge warn"}else{$("workOverall").textContent=`${n}/3 keys configured • ${j.jobsPersistent?"KV job recovery (bounded)":"best-effort recovery"}`;$("workOverall").className="badge "+(n>=2&&j.jobsPersistent?"ok":"warn")}}catch(e){$("workOverall").textContent="Bridge offline";$("workOverall").className="badge warn"}}
async function testFreeProviders(){const btn=$("testFreeProvidersBtn"),out=$("providerHealthText"),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);if(btn)btn.disabled=true;out.textContent="Перевіряю Gemini, Groq Free та OpenRouter Free реальними API-викликами…";try{const r=await fetch("/api/diagnostics/providers",{method:"POST",headers:{...headers(),"Content-Type":"application/json"},cache:"no-store",signal:controller.signal,body:JSON.stringify({providers:["gemini","groqfree","openrouter"]})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);out.textContent=`${j.usable}/${j.total} реально відповідають. `+(j.tested||[]).map(x=>`${providerName(x.provider)}: ${x.ok?"OK":`HTTP ${x.status||"—"} ${shortError(x.message||"error")}`}`).join(" • ")}catch(e){out.textContent=e?.name==="AbortError"?"Provider diagnostics timed out after 20 seconds.":String(e.message||e)}finally{clearTimeout(timer);if(btn)btn.disabled=false}}
function setMode(v){mode=v;document.querySelectorAll("[data-work-mode]").forEach(b=>b.classList.toggle("active",b.dataset.workMode===v))}function taskPrompt(raw){const pre={review:"Perform an independent review of the user's task. Check assumptions, identify weaknesses, propose concrete improvements, and return an actionable recommendation.",code:"Perform a rigorous code and architecture review. Prioritize correctness, security, data flow, edge cases, regressions, and exact implementable fixes.",research:"Perform a deep independent check. Verify internal consistency, challenge assumptions, identify missing evidence, and clearly separate facts, uncertainty, and recommendations."}[mode]||"Review carefully.";return `${pre}\n\nUSER TASK:\n${raw}`}
const WORK_TEXT_EXT=/\.(txt|md|js|mjs|cjs|ts|tsx|jsx|json|html|css|py|go|rs|java|kt|swift|php|rb|xml|yaml|yml|toml|sql|sh|csv|ini|cfg|conf|env\.example)$/i;
const WORK_SKIP_PATH=/(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|Pods|DerivedData)(\/|$)/i;
const WORK_MAX_CONTEXT=350000;
const WORK_MAX_FILE=70000;
const WORK_MAX_ZIP_ENTRIES=512;
const WORK_MAX_ENTRY_DECOMPRESSED=2000000;
const WORK_MAX_TOTAL_DECOMPRESSED=16000000;
const WORK_MAX_COMPRESSION_RATIO=120;
function workIsTextPath(name){return WORK_TEXT_EXT.test(name)||/^(README|LICENSE|Dockerfile|Makefile|Procfile)(\.|$)/i.test((name.split("/").pop()||""))}
function workPriority(name){const n=name.toLowerCase();let p=0;if(/(?:^|\/)(?:_?worker|app|server|main|index|work-controller)\.(?:js|mjs|cjs|ts|tsx|jsx|py|html)$/.test(n))p+=90;if(/package\.json|manifest|wrangler|tsconfig|vite\.config|next\.config|cloudflare/.test(n))p+=70;if(/\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|php|rb|html|css|json|yaml|yml|toml|sql|sh)$/.test(n))p+=40;if(/(?:^|\/)(?:src|lib|server|api|functions|workers?)\//.test(n))p+=25;if(/(?:^|\/)(?:test|tests|spec|specs)\//.test(n)||/\.(?:test|spec)\./.test(n))p+=15;if(/readme|security|submission_checklist|review_findings/.test(n))p+=10;if(/changelog/.test(n))p-=20;if(WORK_SKIP_PATH.test(n))p-=1000;return p}
async function workInflateRaw(bytes,maxBytes=WORK_MAX_ENTRY_DECOMPRESSED){
  if(!globalThis.ZipSafetyCore)throw new Error("ZIP safety core is unavailable.");
  return globalThis.ZipSafetyCore.inflateRawBounded(bytes,maxBytes);
}
function workFindEOCD(u8){const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50)return i;return -1}
function workHeadTail(text,limit){
  const s=String(text||""),lines=s.split("\n"),totalLines=lines.length;
  if(s.length<=limit)return {text:s,truncated:false,totalLines,segments:[{kind:"full",startLine:1,endLine:totalLines,text:s}]};
  const headBudget=Math.max(200,Math.floor(limit*.56)),tailBudget=Math.max(200,limit-headBudget-320);
  let headChars=0,headCount=0;
  while(headCount<lines.length){
    const add=lines[headCount].length+(headCount?1:0);if(headChars+add>headBudget)break;
    headChars+=add;headCount++;
  }
  let tailChars=0,tailStart=lines.length;
  while(tailStart>headCount){
    const add=lines[tailStart-1].length+(tailStart<lines.length?1:0);if(tailChars+add>tailBudget)break;
    tailStart--;tailChars+=add;
  }
  const segments=[];
  if(headCount>0)segments.push({kind:"head",startLine:1,endLine:headCount,text:lines.slice(0,headCount).join("\n")});
  if(tailStart<lines.length)segments.push({kind:"tail",startLine:tailStart+1,endLine:totalLines,text:lines.slice(tailStart).join("\n")});
  return {text:"",truncated:true,totalLines,segments};
}
// BUG FIX (v4.5.9, forged file-boundary injection): raw file content from the
// ZIP was wrapped verbatim into <file path="...">...</file> blocks. If a
// file's own content contained a literal "</file>" followed by
// "<file path=\"...\">" it could forge a fake boundary for another (real)
// file in the same submission, poisoning server-side evidence verification
// (same bug class fixed for the MCP path in v4.5.8's zip-safety-core.js /
// buildFilesContext()). Neutralize here, before wrapping, mirroring the
// server-side fix.
function workNeutralizeFileTags(text){
  return String(text||"").replace(/<(\/?file\b)/gi,"<\u200b$1")
    .replace(/<(\/?(?:attached_files|user_task|user_goal|bridge_response_contract|system|assistant|user|developer|instructions?|im_start|im_end)\b)/gi,"<\u200b$1");
}
function renderFileSegments(sampled){
  return sampled.segments.map(seg=>`<segment kind="${seg.kind}" start_line="${seg.startLine}" end_line="${seg.endLine}">\n${seg.text}\n</segment>`).join("\n[MIDDLE OF FILE OMITTED BY BRIDGE]\n");
}
async function workUnzipText(file){
  const u8=new Uint8Array(await file.arrayBuffer());
  if(!globalThis.ZipSafetyCore)throw new Error("ZIP safety core is unavailable.");
  globalThis.ZipSafetyCore.scanZipMeta(u8,{maxEntries:WORK_MAX_ZIP_ENTRIES,maxEntryDeclared:WORK_MAX_ENTRY_DECOMPRESSED,maxTotalDeclared:WORK_MAX_TOTAL_DECOMPRESSED,maxCompressionRatio:WORK_MAX_COMPRESSION_RATIO});
  const dv=new DataView(u8.buffer),eocd=workFindEOCD(u8);
  if(eocd<0)throw new Error("ZIP structure not found.");
  const entries=dv.getUint16(eocd+10,true),cdOffset=dv.getUint32(eocd+16,true),rows=[],skipped=[];let p=cdOffset,totalDecompressed=0;if(entries>WORK_MAX_ZIP_ENTRIES)throw new Error(`ZIP has too many entries (${entries}). Max ${WORK_MAX_ZIP_ENTRIES}.`);
  for(let i=0;i<entries&&p+46<=u8.length;i++){
    if(dv.getUint32(p,true)!==0x02014b50)break;
    const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),uncomp=dv.getUint32(p+24,true);
    if(compSize>0&&uncomp/compSize>WORK_MAX_COMPRESSION_RATIO){
      const nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true);
      skipped.push(`entry-${i} (compression ratio too high)`);p+=46+nl+el+cl;continue;
    }
    const nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
    const rawName=new TextDecoder().decode(u8.slice(p+46,p+46+nameLen)),name=globalThis.ZipSafetyCore.normalizeEntryName?globalThis.ZipSafetyCore.normalizeEntryName(rawName):rawName;
    if(!name||name.endsWith("/")||WORK_SKIP_PATH.test(name)||!workIsTextPath(name)){p+=46+nameLen+extraLen+commentLen;continue}
    if((dv.getUint16(p+8,true)&1)===1){skipped.push(`${name} (encrypted)`);p+=46+nameLen+extraLen+commentLen;continue}
    if(uncomp>2_000_000){skipped.push(`${name} (too large)`);p+=46+nameLen+extraLen+commentLen;continue}
    if(local+30<=u8.length&&dv.getUint32(local,true)===0x04034b50){
      const ln=dv.getUint16(local+26,true),le=dv.getUint16(local+28,true),start=local+30+ln+le,end=start+compSize;
      if(end<=u8.length){
        try{
          const remaining=Math.max(0,WORK_MAX_TOTAL_DECOMPRESSED-totalDecompressed);
          if(!remaining){skipped.push(`${name} (total decompressed budget exhausted)`);p+=46+nameLen+extraLen+commentLen;continue}
          const perLimit=Math.min(WORK_MAX_ENTRY_DECOMPRESSED,remaining);
          const raw=method===0?(compSize<=perLimit?u8.slice(start,end):null):(method===8?await workInflateRaw(u8.slice(start,end),perLimit):null);
          if(raw){
            totalDecompressed+=raw.byteLength;
            const t=workNeutralizeFileTags(new TextDecoder("utf-8",{fatal:false}).decode(raw).replace(/\0/g,""));
            rows.push({name,text:t,priority:workPriority(name),originalChars:t.length});
          } else skipped.push(`${name} (unsupported compression)`);
        }catch(e){skipped.push(`${name} (decode failed)`)}
      }
    }
    p+=46+nameLen+extraLen+commentLen;
  }
  if(!rows.length)throw new Error("No readable code/text files found in ZIP.");
  rows.sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));
  const safeName=n=>n.replace(/[\u0000-\u001f\u007f<>]/g,"_").replace(/["\'`]/g,"_").slice(0,240);
  const manifestReserve=`<project_manifest>\nINCLUDED FILES (${rows.length}):\n${rows.map(r=>`- ${safeName(r.name)} (${r.originalChars} chars)`).join("\n")}\n</project_manifest>\n`;
  const budget=Math.max(12000,WORK_MAX_CONTEXT-manifestReserve.length);
  const per=Math.min(WORK_MAX_FILE,Math.max(1800,Math.floor(budget/rows.length)));
  let used=manifestReserve.length,out=[manifestReserve],included=0;
  for(const r of rows){
    if(used>=WORK_MAX_CONTEXT)break;
    const path=safeName(r.name),wrapperOverhead=`<file path="${path}" original_chars="${r.originalChars}" original_lines="999999" truncated="true">\n\n</file>\n`.length;
    const allowance=Math.min(per,WORK_MAX_CONTEXT-used-wrapperOverhead);
    if(allowance<500)break;
    const sampled=workHeadTail(r.text,allowance);
    const block=`<file path="${path}" original_chars="${r.originalChars}" original_lines="${sampled.totalLines}" truncated="${sampled.truncated}">\n${renderFileSegments(sampled)}\n</file>\n`;
    if(used+block.length>WORK_MAX_CONTEXT)break;
    out.push(block);used+=block.length;included++;
  }
  const includedRows=rows.slice(0,included);
  out[0]=`<project_manifest>\nINCLUDED FILES (${includedRows.length}):\n${includedRows.map(r=>`- ${safeName(r.name)} (${r.originalChars} chars)`).join("\n")}\n</project_manifest>\n`;
  if(included<rows.length||skipped.length)out.push(`\n<context_notice>${rows.length-included} readable and ${skipped.length} skipped file(s) are not present in verification context.</context_notice>`);
  return out.join("\n");
}
async function readSelectedWorkFile(){
  const input=$("workFile");
  if(!input||!input.files||!input.files[0])return {fileText:"",fileName:""};
  const f=input.files[0];
  if(f.size>20_000_000)throw new Error("ZIP/file is too large. Max 20 MB.");
  if(f.name.toLowerCase().endsWith(".zip"))return {fileText:await workUnzipText(f),fileName:f.name};
  let t=workNeutralizeFileTags(await f.text());
  if(t.length>WORK_MAX_CONTEXT)t=t.slice(0,WORK_MAX_CONTEXT)+"\n[TRUNCATED]";
  return {fileText:t,fileName:f.name};
}
function providerName(id){return {gemini:"Gemini",groqfree:"Groq Free",openrouter:"OpenRouter Free"}[id]||id}
function mergeResults(base,updates){
  const m=new Map((base||[]).map(x=>[x.provider,x]));
  for(const x of (updates||[]))if(x&&x.provider)m.set(x.provider,x);
  return ["gemini","groqfree","openrouter"].filter(id=>m.has(id)).map(id=>m.get(id));
}
function renderRun(data,{scroll=false}={}){
  lastRun=data;$("resultsWrap").classList.remove("hidden");
  $("finalText").textContent=data.final||"Чекаю результати / synthesis…";
  $("finalJudge").textContent=data.judge?"Judge: "+providerName(data.judge):(data.meta?.pending?"Providers running…":data.meta?.consensusFallback?"Consensus fallback":"Synthesis unavailable");
  const findings=data.structured?.findings||[],panel=$("judgeEvidencePanel");
  const codeContext=data.structured?.isCodeContext!==false;
  if(panel)panel.innerHTML=findings.length?findings.map(f=>`<div class="resultCard"><div class="resultHead"><b>${esc(codeContext?(f.file||"unknown"):"Advisory conclusion")}${codeContext&&f.start_line?`:${f.start_line}${f.end_line&&f.end_line!==f.start_line?`-${f.end_line}`:""}`:""}</b><span>${esc(f.confidence||"low")}</span></div><div class="smallNote">${esc(f.claim||"")}</div>${codeContext?`<div class="toolbar"><span class="statusChip ${f.quote_matched?"ok":"bad"}">Quote matched: ${f.quote_matched?"YES":"NO"}</span><span class="statusChip neutral">Claim manually confirmed: NO</span></div>`:""}</div>`).join(""):`<div class="smallNote">No structured Judge findings.</div>`;
  $("providerResults").innerHTML=(data.results||[]).map(r=>`<div class="resultCard ${r.ok?"":"err"}"><div class="resultHead"><b>${esc(providerName(r.provider))}</b><span>${r.ok?(r.outcome==="no_findings"?"NO FINDINGS":Math.round((r.ms||0)/100)/10+"s"):"ERROR "+(r.status||"")}</span></div><div class="resultBody">${esc(r.ok?r.text:shortError(r.error))}</div></div>`).join("");
  $("workDiag").textContent=JSON.stringify({selected:data.selectedProviders||[],judge:data.judge||null,meta:data.meta||{},providerAttempts:data.providerAttempts||[],judgeAttempts:data.judgeAttempts||[],structured:data.structured||null},null,2);
  if(scroll)setTimeout(()=>$("resultsWrap").scrollIntoView({behavior:"smooth",block:"start"}),50);
}
let lastFilePayload={fileText:"",fileName:""};
// v5.8.0 run controls. Pause detaches the browser from the provider streams
// (server jobs keep running and stay recoverable); Resume reconnects to them;
// Stop abandons the run and discards late results; Reconnect re-polls any
// pending job. Every wait is bounded, so no control can leave a spinner.
const WORK_STREAM_IDLE_MS=45000;
const runCtl={active:false,paused:false,stopped:false,controllers:new Set()};
function shortError(value){const s=String(value||"").replace(/\{[\s\S]{160,}\}/g,"{…}").replace(/\s+/g," ").trim();return s.length>220?s.slice(0,220)+"…":s||"Error"}
function updateRunControls(){
  const pending=loadWorkPending().length;
  const set=(id,on)=>{const b=$(id);if(b)b.disabled=!on};
  set("pauseBtn",runCtl.active&&!runCtl.paused);set("stopBtn",runCtl.active||runCtl.paused);set("resumeBtn",runCtl.paused||(!runCtl.active&&pending>0));set("reconnectBtn",!runCtl.active&&pending>0);
  $("runFreeTeam").disabled=runCtl.active;
}
function readWithIdleTimeout(reader,ms,signal){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Object.assign(new Error("Provider stream went silent; switching to status polling."),{idle:true})),ms);
    const onAbort=()=>{clearTimeout(timer);reject(Object.assign(new Error(String(signal.reason||"aborted")),{aborted:true}))};
    if(signal){if(signal.aborted)return onAbort();signal.addEventListener("abort",onAbort,{once:true})}
    reader.read().then(v=>{clearTimeout(timer);signal?.removeEventListener?.("abort",onAbort);resolve(v)},e=>{clearTimeout(timer);signal?.removeEventListener?.("abort",onAbort);reject(e)}).catch(()=>{});
  });
}
async function callWorkProvider(provider,raw,file,onProgress=null,signal=null){
  const clientRequestId=`work-${provider}-${globalThis.crypto?.randomUUID?.()||Date.now()+"-"+Math.random().toString(16).slice(2)}`;
  let jobId=null,lastError=null;
  const interrupted=()=>signal?.aborted?String(signal.reason||""):"";
  upsertWorkPending({provider,clientRequestId,jobId:null,createdAt:Date.now(),mode,taskPreview:String(raw||"").slice(0,2000),fileName:String(file?.fileName||"").slice(0,160)});
  const finish=result=>{clearWorkPending(provider,clientRequestId);return result};
  for(let connectionAttempt=1;connectionAttempt<=2;connectionAttempt++){
    if(interrupted())break;
    let reader=null;
    try{
      const r=await fetch("/api/work/provider-stream",{method:"POST",headers:{"Content-Type":"application/json",...headers(),"Accept":"application/x-ndjson"},cache:"no-store",signal,body:JSON.stringify({task:taskPrompt(raw),displayTask:raw,mode,provider,clientRequestId,...file})});
      if(!r.ok){const data=await r.json().catch(()=>({}));return finish({provider,ok:false,error:data.error||`HTTP ${r.status}`,status:r.status,ms:0})}
      if(!r.body?.getReader)throw new Error("Provider stream is unavailable.");
      reader=r.body.getReader();const decoder=new TextDecoder();let buffer="";
      while(true){
        const {value,done}=await readWithIdleTimeout(reader,WORK_STREAM_IDLE_MS,signal);if(done)break;
        buffer+=decoder.decode(value,{stream:true});let nl;
        while((nl=buffer.indexOf("\n"))>=0){
          const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;
          let evt;try{evt=JSON.parse(line)}catch(e){continue}
          if(evt.jobId){jobId=evt.jobId;upsertWorkPending({provider,clientRequestId,jobId})}
          if(onProgress)onProgress({...evt,connectionAttempt});
          if(evt.type==="provider_result")return finish(evt.result);
          if(evt.type==="provider_error")return finish({provider,ok:false,error:evt.error?.error||"Provider job failed.",status:evt.error?.status||500,ms:0});
        }
      }
      lastError=new Error("Provider stream ended before a terminal result.");
    }catch(e){lastError=e;try{reader?.cancel?.()?.catch?.(()=>{})}catch(_e){}if(e?.idle)break}
  }
  const why=interrupted();
  if(why==="stopped"){clearWorkPending(provider,clientRequestId);return {provider,ok:false,error:"Stopped by user.",status:499,ms:0,stopped:true}}
  if(why==="paused")return {provider,ok:false,error:"Paused — the server job keeps running and can be resumed.",status:0,ms:0,pending:true,paused:true,clientRequestId,jobId};
  try{
    const q=jobId?`jobId=${encodeURIComponent(jobId)}`:`provider=${encodeURIComponent(provider)}&clientRequestId=${encodeURIComponent(clientRequestId)}`;
    const r=await fetch(`/api/work/provider-status?${q}`,{headers:headers(),cache:"no-store"}),data=await r.json();
    if(data.jobId&&!jobId){jobId=data.jobId;upsertWorkPending({provider,clientRequestId,jobId})}
    if(data.status==="done"&&data.result)return finish(data.result);
    if(data.status==="error"||data.status==="stale")return finish({provider,ok:false,error:data.error?.error||"Provider job failed.",status:data.error?.status||500,ms:0});
  }catch(e){}
  return {provider,ok:false,error:String(lastError?.message||lastError||"Provider connection failed. The pending job will be recovered after reload if server-side job storage is available."),status:500,ms:0,pending:true,clientRequestId,jobId};
}
async function recoverOneWorkProvider(rec,windowMs=22000){
  const started=Date.now();
  while(Date.now()-started<windowMs){
    if(runCtl.stopped)return {terminal:false,rec};
    try{
      const q=rec.jobId?`jobId=${encodeURIComponent(rec.jobId)}`:`provider=${encodeURIComponent(rec.provider)}&clientRequestId=${encodeURIComponent(rec.clientRequestId)}`;
      const r=await fetch(`/api/work/provider-status?${q}`,{headers:headers(),cache:"no-store"}),data=await r.json().catch(()=>({}));
      if(data.jobId&&!rec.jobId){rec={...rec,jobId:data.jobId};upsertWorkPending(rec)}
      if(r.status===401)return {terminal:false,auth:true,rec};
      if(data.status==="done"&&data.result){clearWorkPending(rec.provider,rec.clientRequestId);return {terminal:true,result:data.result,rec}}
      if(data.status==="error"||data.status==="stale"){clearWorkPending(rec.provider,rec.clientRequestId);return {terminal:true,result:{provider:rec.provider,ok:false,error:data.error?.error||"Provider job failed.",status:data.error?.status||500,ms:0},rec}}
      if(r.status===404&&Date.now()-started>8000){clearWorkPending(rec.provider,rec.clientRequestId);return {terminal:true,result:{provider:rec.provider,ok:false,error:"The server no longer has this provider job (best-effort storage). Run it again.",status:404,ms:0},rec}}
    }catch(e){}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  return {terminal:false,rec};
}
async function recoverPendingWork(){
  const rows=loadWorkPending();if(!rows.length)return;
  $("resultsWrap")?.classList.remove("hidden");$("workProgress")?.classList.add("show");if($("progressText"))$("progressText").textContent=`Відновлюю ${rows.length} незавершений provider job…`;
  const recovered=[];let authBlocked=false;
  await Promise.all(rows.map(async rec=>{const x=await recoverOneWorkProvider(rec);if(x.auth)authBlocked=true;if(x.terminal&&x.result)recovered.push(x.result)}));
  if(recovered.length){
    const good=recovered.filter(x=>x.ok&&x.text),final=good[0]?.text||"Відновлені provider jobs завершилися помилкою.";
    renderRun({results:recovered,selectedProviders:recovered.map(x=>x.provider),final,judge:null,meta:{pending:loadWorkPending().length>0,recoveredAfterReload:true,synthesized:false}},{scroll:false});
  }
  const left=loadWorkPending().length;
  if($("progressText"))$("progressText").textContent=authBlocked?"Незавершений job збережено. Авторизуй Bridge, щоб продовжити відновлення.":left?`${left} provider job ще виконується; повторна перевірка відбудеться після reload/Refresh.`:recovered.length?"Незавершені provider jobs відновлено.":"Незавершені provider jobs ще не готові.";
  if(!left&&!authBlocked)setTimeout(()=>$("workProgress")?.classList.remove("show"),900);
}
function mergeProviderDiagnostic(list,evt){const provider=evt.provider;if(!provider)return list||[];const patch={provider,jobId:evt.jobId||undefined,durable:evt.durable,connectionAttempt:evt.connectionAttempt};if(evt.type==="provider_start")Object.assign(patch,{status:"running",resumed:!!evt.resumed});else if(evt.type==="provider_attempt")Object.assign(patch,{status:"running",attempt:evt.attempt,maxAttempts:evt.maxAttempts,elapsedMs:evt.elapsedMs});else if(evt.type==="provider_retry")Object.assign(patch,{status:"retry_wait",attempt:evt.attempt,maxAttempts:evt.maxAttempts,nextAttempt:evt.nextAttempt,httpStatus:evt.status,requestedWaitMs:evt.requestedWaitMs,actualWaitMs:evt.actualWaitMs,delaySource:evt.delaySource,elapsedMs:evt.elapsedMs});else if(evt.type==="provider_retry_skipped")Object.assign(patch,{status:"retry_skipped",attempt:evt.attempt,maxAttempts:evt.maxAttempts,httpStatus:evt.status,reason:evt.reason,requestedWaitMs:evt.requestedWaitMs,wouldHaveWaitedMs:evt.wouldHaveWaitedMs});else if(evt.type==="provider_result")patch.status="done";else if(evt.type==="provider_error")patch.status="error";const out=(list||[]).slice(),idx=out.findIndex(x=>x.provider===provider);if(idx>=0)out[idx]={...out[idx],...patch};else out.push(patch);return out}
function providerEventLabel(evt){const name=providerName(evt.provider||"");if(evt.type==="provider_retry")return `${name}: HTTP ${evt.status}, wait ${Math.round((evt.actualWaitMs||0)/100)/10}s (${evt.delaySource||"backoff"}), next ${evt.nextAttempt}/${evt.maxAttempts}`;if(evt.type==="provider_attempt")return `${name}: attempt ${evt.attempt}/${evt.maxAttempts}`;if(evt.type==="provider_start"&&evt.resumed)return `${name}: відновлюю незавершений job…`;return `${name}: працює…`}
function mergeJudgeDiagnostic(list,patch){
  const provider=patch.provider;if(!provider)return list||[];
  const out=(list||[]).slice(),idx=out.findIndex(x=>x.provider===provider);
  if(idx>=0)out[idx]={...out[idx],...patch};else out.push({...patch});
  return out;
}
function judgeEventLabel(evt){
  const name=providerName(evt.provider||"");
  if(globalThis.AIBridgeWorkUICore?.judgeEventLabel)return globalThis.AIBridgeWorkUICore.judgeEventLabel(evt,name);
  if(evt.type==="judge_network_attempt")return `${name} Judge: API attempt ${evt.attempt}/${evt.maxAttempts}`;
  return "Final Judge працює…";
}
async function synthesizeResults(raw,file,results,onProgress=null){
  const good=(results||[]).filter(x=>x.ok&&x.text);
  if(!good.length)return {final:"Усі провайдери завершилися помилкою.",judge:null,meta:{synthesized:false}};
  if(good.length===1)return {final:good[0].text,judge:null,meta:{synthesized:false,singleProvider:true}};
  // v5.9.1: synthesis can never hang the run — after 150s the best single
  // provider answer is shown and the Judge failure is reported.
  const synthCtl=new AbortController(),synthTimer=setTimeout(()=>{try{synthCtl.abort()}catch(e){}},150000);
  try{
    const r=await fetch("/api/work/synthesize-stream",{method:"POST",signal:synthCtl.signal,headers:{"Content-Type":"application/json",...headers()},body:JSON.stringify({task:taskPrompt(raw),displayTask:raw,mode,results,...file})});
    if(!r.ok){
      const data=await r.json().catch(()=>({}));
      return {final:good[0].text,judge:null,meta:{synthesized:false,synthesisError:data.error||`HTTP ${r.status}`}};
    }
    if(!r.body?.getReader){
      const fallback=await fetch("/api/work/synthesize",{method:"POST",signal:synthCtl.signal,headers:{"Content-Type":"application/json",...headers()},body:JSON.stringify({task:taskPrompt(raw),displayTask:raw,mode,results,...file})});
      const data=await fallback.json();
      return fallback.ok?data:{final:good[0].text,judge:null,meta:{synthesized:false,synthesisError:data.error||`HTTP ${fallback.status}`}};
    }
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="",finalData=null;
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      let nl;
      while((nl=buffer.indexOf("\n"))>=0){
        const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;
        let evt;try{evt=JSON.parse(line)}catch(e){continue}
        if(evt.type==="final")finalData=evt.data;else if(onProgress)onProgress(evt);
      }
    }
    if(finalData?.error)return {final:good[0].text,judge:null,meta:{synthesized:false,synthesisError:finalData.error}};
    return finalData||{final:good[0].text,judge:null,meta:{synthesized:false,synthesisError:"Synthesis stream ended without final result."}};
  }catch(e){return {final:good[0].text,judge:null,meta:{synthesized:false,synthesisError:e?.name==="AbortError"?"Final Judge timed out after 150s; showing the best single-provider answer.":String(e.message||e)}}}
  finally{clearTimeout(synthTimer)}
}
async function run(selected=null){
  const raw=$("workTask").value.trim();
  if(!raw){$("workProgress").classList.add("show");$("progressText").textContent="Введи завдання.";setTimeout(()=>$("workProgress").classList.remove("show"),2500);return}
  if(runCtl.active)return;
  runCtl.active=true;runCtl.paused=false;runCtl.stopped=false;runCtl.controllers.clear();updateRunControls();
  $("runFreeTeam").disabled=true;$("workProgress").classList.add("show");$("resultsWrap").classList.remove("hidden");
  const providers=selected?.length?selected:["gemini","groqfree","openrouter"];
  $("progressText").textContent=selected?.length?`Повторюю: ${selected.map(providerName).join(", ")}`:"Запускаю 3 провайдери паралельно; готові відповіді з'являтимуться одразу.";
  try{
    let file;
    if(selected?.length&&lastFilePayload.fileText)file=lastFilePayload;
    else{file=await readSelectedWorkFile();lastFilePayload=file}
    const preserved=selected?.length?(lastRun?.results||[]).filter(x=>!providers.includes(x.provider)):[];
    let live=preserved.slice(),liveProviderAttempts=[];renderRun({results:live,selectedProviders:["gemini","groqfree","openrouter"],final:selected?.length?(lastRun?.final||""):"",judge:selected?.length?(lastRun?.judge||null):null,providerAttempts:liveProviderAttempts,meta:{pending:true,retrying:!!selected?.length}});
    await Promise.all(providers.map(async provider=>{
      const ctl=new AbortController();runCtl.controllers.add(ctl);
      const result=await callWorkProvider(provider,raw,file,evt=>{liveProviderAttempts=mergeProviderDiagnostic(liveProviderAttempts,evt);$("progressText").textContent=providerEventLabel(evt);renderRun({results:live,selectedProviders:["gemini","groqfree","openrouter"],final:"",judge:null,providerAttempts:liveProviderAttempts,meta:{pending:true,retrying:!!selected?.length}})},ctl.signal);
      runCtl.controllers.delete(ctl);
      live=mergeResults(live,[result]);
      renderRun({results:live,selectedProviders:["gemini","groqfree","openrouter"],final:"",judge:null,providerAttempts:liveProviderAttempts,meta:{pending:true,lastFinished:provider}});
    }));
    const merged=mergeResults(preserved,live);
    if(runCtl.stopped){renderRun({results:merged,selectedProviders:["gemini","groqfree","openrouter"],final:"Зупинено користувачем. Результати, що прийдуть пізніше, відкинуто.",judge:null,meta:{pending:false,stopped:true}});return}
    if(runCtl.paused){lastRawTask=raw;lastRunFile=file;renderRun({results:merged,selectedProviders:["gemini","groqfree","openrouter"],final:"Пауза. Серверні jobs продовжують працювати; натисни Resume, щоб підключитися знову.",judge:null,meta:{pending:true,paused:true}});return}
    $("progressText").textContent="Провайдери завершилися. Роблю консервативний synthesis…";
    let liveJudgeAttempts=[];
    const syn=await synthesizeResults(raw,file,merged,evt=>{
      if(evt.type==="judge_start")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,{provider:evt.provider,status:"running",currentPhase:evt.currentPhase||"starting"});
      else if(evt.type==="judge_network_attempt")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,{provider:evt.provider,status:"running",currentPhase:evt.currentPhase||"request",networkAttempt:evt.attempt,maxNetworkAttempts:evt.maxAttempts});
      else if(evt.type==="judge_retry")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,{provider:evt.provider,status:"retry_wait",currentPhase:"retry_wait",retryCount:evt.retryCount,retryAfterMs:evt.retryDelayMs,retryDelaySource:evt.retryDelaySource,httpStatus:evt.status,currentAttempt:evt.attempt,nextAttempt:evt.nextAttempt,maxAttempts:evt.maxAttempts});
      else if(evt.type==="judge_phase")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,{provider:evt.provider,status:"running",currentPhase:evt.currentPhase,repairCalled:!!evt.repairCalled});
      else if(evt.type==="judge_context_ready")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,{provider:evt.provider,verificationContextMode:evt.verificationContextMode,verificationContextChars:evt.verificationContextChars,verificationExcerpts:evt.verificationExcerpts||[],verificationExcerptCount:evt.verificationExcerptCount||0});
      else if(evt.type==="judge_attempt")liveJudgeAttempts=mergeJudgeDiagnostic(liveJudgeAttempts,evt.attempt||{provider:evt.provider,status:evt.ok?"ok":"error"});
      $("progressText").textContent=judgeEventLabel(evt);
      renderRun({results:merged,selectedProviders:["gemini","groqfree","openrouter"],final:"",judge:null,structured:null,providerAttempts:liveProviderAttempts,judgeAttempts:liveJudgeAttempts,meta:{pending:true,synthesizing:true,retryMerged:!!selected?.length}});
    });
    renderRun({results:merged,selectedProviders:["gemini","groqfree","openrouter"],final:syn.final,judge:syn.judge,structured:syn.structured||null,providerAttempts:liveProviderAttempts,judgeAttempts:syn.judgeAttempts||liveJudgeAttempts,meta:{...(syn.meta||{}),pending:false,retryMerged:!!selected?.length}},{scroll:true});
  }catch(e){
    $("resultsWrap").classList.remove("hidden");$("finalText").textContent=shortError(e.message);$("finalJudge").textContent="ERROR";
  }finally{runCtl.active=false;runCtl.controllers.clear();$("runFreeTeam").disabled=false;if(!runCtl.paused)$("workProgress").classList.remove("show");updateRunControls()}
}
let lastRawTask="",lastRunFile=null;
function pauseRun(){if(!runCtl.active)return;runCtl.paused=true;for(const c of runCtl.controllers)try{c.abort("paused")}catch(e){}$("progressText").textContent="Пауза: від'єднуюсь від потоків. Серверні jobs продовжують працювати.";updateRunControls()}
function stopRun(){runCtl.stopped=true;const wasPaused=runCtl.paused;runCtl.paused=false;for(const c of runCtl.controllers)try{c.abort("stopped")}catch(e){}
  if(wasPaused&&!runCtl.active){saveWorkPending([]);renderRun({...(lastRun||{}),final:"Зупинено користувачем.",meta:{pending:false,stopped:true}})}
  $("progressText").textContent="Зупинено.";setTimeout(()=>$("workProgress").classList.remove("show"),900);updateRunControls()}
async function resumeRun(){
  const rows=loadWorkPending();if(!rows.length){runCtl.paused=false;updateRunControls();return}
  runCtl.paused=false;runCtl.stopped=false;runCtl.active=true;updateRunControls();
  $("workProgress").classList.add("show");$("progressText").textContent=`Resume: підключаюсь до ${rows.length} provider job…`;
  try{
    const recovered=[];await Promise.all(rows.map(async rec=>{const x=await recoverOneWorkProvider(rec,90000);if(x.terminal&&x.result)recovered.push(x.result)}));
    if(runCtl.stopped)return;
    const merged=mergeResults(lastRun?.results||[],recovered);
    if(loadWorkPending().length){renderRun({...(lastRun||{}),results:merged,meta:{pending:true,paused:true}});$("progressText").textContent="Частина jobs ще працює. Натисни Resume ще раз пізніше.";return}
    $("progressText").textContent="Провайдери завершилися. Роблю консервативний synthesis…";
    const syn=await synthesizeResults(lastRawTask||$("workTask").value.trim(),lastRunFile||lastFilePayload,merged);
    renderRun({results:merged,selectedProviders:["gemini","groqfree","openrouter"],final:syn.final,judge:syn.judge,structured:syn.structured||null,judgeAttempts:syn.judgeAttempts||[],meta:{...(syn.meta||{}),pending:false,resumed:true}},{scroll:true});
  }finally{runCtl.active=false;if(!runCtl.paused)setTimeout(()=>$("workProgress").classList.remove("show"),600);updateRunControls()}
}
async function reconnectRun(){if(runCtl.active)return;runCtl.active=true;updateRunControls();try{await recoverPendingWork()}finally{runCtl.active=false;updateRunControls()}}
clearLegacyWorkToken();
$("saveWorkToken").onclick=async()=>{const v=$("workToken").value.trim();if(!v)return;$("saveWorkToken").disabled=true;try{await loginWorkSession(v);$("workToken").value="";$("saveWorkToken").textContent="Авторизовано ✓";await status()}catch(e){$("workOverall").textContent=e.message;$("workOverall").className="badge warn"}finally{$("saveWorkToken").disabled=false;setTimeout(()=>$("saveWorkToken").textContent="Авторизувати",1000)}};
$("clearWorkToken").onclick=async()=>{await logoutWorkSession();$("workToken").value="";status()};
$("workToken").value="";
document.querySelectorAll("[data-work-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.workMode));
$("runFreeTeam").onclick=()=>run();
if($("pauseBtn"))$("pauseBtn").onclick=pauseRun;if($("resumeBtn"))$("resumeBtn").onclick=()=>resumeRun();if($("stopBtn"))$("stopBtn").onclick=stopRun;if($("reconnectBtn"))$("reconnectBtn").onclick=()=>reconnectRun();$("refreshBtn").onclick=status;$("testFreeProvidersBtn").onclick=testFreeProviders;
$("clearBtn").onclick=()=>{$("workTask").value="";$("workTask").focus()};
$("pasteBtn").onclick=async()=>{try{$("workTask").value=await navigator.clipboard.readText()}catch(e){alert("Встав текст вручну.")}};
$("copyFinalWork").onclick=async()=>{try{await navigator.clipboard.writeText($("finalText").textContent||"")}catch(e){}};
$("retryFailedBtn").onclick=()=>{
  const failed=(lastRun?.results||[]).filter(x=>!x.ok).map(x=>x.provider).filter(x=>["gemini","groqfree","openrouter"].includes(x));
  if(!failed.length){alert("Немає провайдерів з помилкою.");return}
  run(failed)
};
if($("workFile"))$("workFile").onchange=()=>{
  const f=$("workFile").files?.[0];lastFilePayload={fileText:"",fileName:""};
  // BUG FIX (retry-merge consistency): previously only lastFilePayload was
  // reset here, so clicking "retry failed providers" after swapping the
  // attached file would silently merge already-succeeded results computed
  // against the OLD file with newly retried results computed against the NEW
  // file into one "merged" set, with no indication the context changed.
  // Invalidating lastRun forces a fresh full run (retry becomes a no-op with
  // a clear message) whenever the attachment changes.
  lastRun=null;
  $("fileStatus").textContent=f?`${f.name} • ${(f.size/1024).toFixed(1)} KB`:"Файл не вибрано"
};
status();updateRunControls();recoverPendingWork().catch(()=>{}).finally(updateRunControls)})();
