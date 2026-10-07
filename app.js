
(function(){
"use strict";

// BUG FIX (v5.9.0): dozens of direct localStorage calls (boot, mode, studio,
// provider picks) threw in Safari private mode / with blocked site data and
// stopped the whole app from starting. This scoped wrapper keeps the same API,
// falls back to in-memory storage, and never throws.
const localStorage=(()=>{
  let real=null;const mem=new Map();
  try{real=globalThis.localStorage;real.getItem("__ai_bridge_probe")}catch(e){real=null}
  return {
    getItem(k){try{if(real)return real.getItem(k)}catch(e){}return mem.has(k)?mem.get(k):null},
    setItem(k,v){try{if(real){real.setItem(k,String(v));return}}catch(e){}mem.set(k,String(v))},
    removeItem(k){try{real?.removeItem(k)}catch(e){}mem.delete(k)}
  };
})();

const $=id=>document.getElementById(id);
const I18N=globalThis.AIBridgeI18n||null;
I18N?.init?.();
const t=(key,vars)=>I18N?.t?.(key,vars)??key;
const UI_VERSION="5.11.100";
// v5.9.0: storage can throw (Safari private mode, quota, blocked site data).
// Every new read/write goes through these helpers so one failure can never
// stop the whole interface from booting.
function lsGet(key,fallback=null){try{const v=localStorage.getItem(key);return v===null?fallback:v}catch(e){return fallback}}
function lsSet(key,value){try{localStorage.setItem(key,value);return true}catch(e){return false}}
function lsJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||"null");return v===null?fallback:v}catch(e){return fallback}}
function toast(message,kind=""){
  const host=document.getElementById("toasts");if(!host||!message)return;
  const n=document.createElement("div");n.className=`toast${kind?` ${kind}`:""}`;n.textContent=String(message).slice(0,300);host.appendChild(n);
  setTimeout(()=>{n.classList.add("out");setTimeout(()=>n.remove(),300)},3200);
}
/* v5.11.33: тост «Скасування видалення діалогу» (Undo toast) — тост з кнопкою дії,
   що живе 8 секунд. */
function toastUndo(message,onAction){
  const host=document.getElementById("toasts");if(!host||!message)return;
  const n=document.createElement("div");n.className="toast toastUndo";
  const s=document.createElement("span");s.textContent=String(message).slice(0,200);n.appendChild(s);
  const b=document.createElement("button");b.type="button";b.className="toastUndoBtn";b.textContent=t("undoAction");
  b.onclick=()=>{try{onAction&&onAction()}catch(e){}dismiss()};
  n.appendChild(b);host.appendChild(n);
  const tm=setTimeout(dismiss,8000);
  function dismiss(){clearTimeout(tm);if(!n.isConnected)return;n.classList.add("out");setTimeout(()=>n.remove(),300)}
}
/* v5.11.91: тост із кнопкою дії — повідомлення + одна дія одним тапом
   (напр. «Відповідь готова» → «Відкрити»). Тап по самому тосту теж спрацьовує. */
function toastAction(message,btnLabel,onAction){
  const host=document.getElementById("toasts");if(!host||!message)return;
  const n=document.createElement("div");n.className="toast toastUndo";n.style.cursor="pointer";n.setAttribute("role","button");n.tabIndex=0;
  const s=document.createElement("span");s.textContent=String(message).slice(0,200);n.appendChild(s);
  const b=document.createElement("button");b.type="button";b.className="toastUndoBtn";b.textContent=btnLabel||"";
  const fire=()=>{try{onAction&&onAction()}catch(e){}};
  b.onclick=()=>{fire();dismiss()};
  n.onclick=ev=>{if(ev.target===n||ev.target===s){fire();dismiss()}};
  n.onkeydown=ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();fire();dismiss()}};
  n.appendChild(b);host.appendChild(n);
  const tm=setTimeout(dismiss,8000);
  function dismiss(){clearTimeout(tm);if(!n.isConnected)return;n.classList.add("out");setTimeout(()=>n.remove(),300)}
}
/* ---------- v5.9.0 self-diagnostics ----------
   Uncaught UI errors are kept (bounded, this device only) so the Learn page
   can show them and hand them to the AI Team for a proposed fix. Messages
   are truncated and never include request bodies, tokens or answers. */
const DIAG_KEY="ai_bridge_diag_log_v1",DIAG_MAX=25;
function diagLog(){const v=lsJson(DIAG_KEY,[]);return Array.isArray(v)?v.slice(-DIAG_MAX):[]}
function recordDiag(kind,message,where=""){
  const text=String(message||"").replace(/(?:sk|key|token|bearer)[-_ ]?[A-Za-z0-9_\-]{12,}/gi,"[redacted]").slice(0,300);if(!text)return;
  const log=diagLog(),last=log.at(-1);
  if(last&&last.message===text&&last.kind===kind){last.count=(last.count||1)+1;last.at=Date.now()}
  else log.push({kind,message:text,where:String(where||"").slice(0,160),at:Date.now(),version:UI_VERSION,count:1});
  lsSet(DIAG_KEY,JSON.stringify(log.slice(-DIAG_MAX)));
}
window.addEventListener("error",e=>recordDiag("error",e?.message||e?.error?.message,`${String(e?.filename||"").split("/").pop()}:${e?.lineno||0}`));
window.addEventListener("unhandledrejection",e=>recordDiag("promise",e?.reason?.message||e?.reason));
/* ---------- v5.9.0 theme ---------- */
const THEME_KEY="ai_bridge_theme";
function currentTheme(){const v=lsGet(THEME_KEY,"auto");return ["light","dark","auto"].includes(v)?v:"auto"}
function applyTheme(theme){
  const th=["light","dark","auto"].includes(theme)?theme:"auto";
  document.documentElement.setAttribute("data-theme",th);
  const btn=document.getElementById("themeBtn");if(btn)btn.dataset.mode=th;
  const dark=th==="dark"||(th==="auto"&&window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute("content",dark?"#121014":"#f6f7fb"));
}
function cycleTheme(){const order=["auto","dark","light"],next=order[(order.indexOf(currentTheme())+1)%order.length];lsSet(THEME_KEY,next);applyTheme(next);toast(t(`theme_${next}`))}
applyTheme(currentTheme());
const PROVIDERS={
  openai:{name:"OpenAI",logo:"O",note:"optional Judge / orchestrator"},
  claude:{name:"Claude",logo:"C",note:"deep reasoning & code"},
  gemini:{name:"Gemini",logo:"G",note:"long context & verification"},
  grok:{name:"Grok (xAI)",logo:"X",note:"paid xAI critic"},
  groqfree:{name:"Groq Free",logo:"Q",note:"free tier • GPT-OSS 120B"},
  openrouter:{name:"OpenRouter Free",logo:"R",note:"free router • rotating models"},
  /* v5.11.62: Muse — персональний асистент. НЕ має публічного API: чесна картка,
     завжди доступний, відповіді не імітуються. */
  muse:{name:"Muse",logo:"M",note:"muse",assistant:true},
  /* v5.11.70: Ядро — локальний движок аналізу тексту (core.js). Zero dependencies,
     офлайн, без мережі. НЕ LLM — екстрактивний аналізатор. */
  core:{name:"Ядро",logo:"⚙",note:"core",local:true}
};
/* v5.11.62: підпис провайдера — для Muse з i18n. v5.11.70: + Ядро. */
function provNote(id,p){return id==="muse"?t("museProviderSub"):(id==="core"?t("coreProviderSub"):((p&&p.note)||""))}
/* v5.11.70: бейдж локального провайдера (Ядро) у картці.
   v5.11.75: + індикатор «Захищено ✓» / «Цілісність порушено» за verifyIntegrity(). */
function localBadgeHtml(id){
  if(id==="muse")return `<span class="museBadge">${esc(t("museBadge"))}</span>`;
  if(id==="core")return `<span class="coreBadge">${esc(t("coreBadge"))}</span>${coreSecureBadgeHtml()}`;
  return "";
}
/* v5.11.75: бейдж захисту Ядра. Перевірка — при кожному рендері картки; дефолт — «Захищено». */
function coreSecureBadgeHtml(){
  let ok=true;
  try{
    const v=(typeof window!=="undefined"&&window.BridgeCore&&window.BridgeCore.verifyIntegrity)
      ?window.BridgeCore.verifyIntegrity():{ok:true};
    ok=!!(v&&v.ok);
  }catch(e){ok=true;}
  return ok
    ?`<span class="coreSecureBadge">${esc(t("coreSecure"))}</span>`
    :`<span class="coreTamperBadge">${esc(t("coreTampered"))}</span>`;
}
/* v5.11.46: каталог моделей за провайдером для пікеру з пошуком.
   [ім'я моделі, ключ сили]. Імена — дефолти _worker.js (PROVIDER_META);
   реально налаштована модель береться з status.models і позначається ✓. */
const MODEL_CATALOG={
  openai:[["gpt-5.6-terra","strengthTop"],["gpt-5.6-luna","strengthTop"]],
  claude:[["claude-sonnet-5","strengthReason"],["claude-sonnet-4-6","strengthReason"]],
  gemini:[["gemini-3.8-flash","strengthLong"],["gemini-3.7-flash","strengthLong"],["gemini-2.5-flash","strengthFast"],["gemini-2.5-flash-lite","strengthEcon"]],
  grok:[["grok-4.6","strengthReason"],["grok-4.3","strengthReason"]],
  groqfree:[["openai/gpt-oss-120b","strengthEcon"],["openai/gpt-oss-20b","strengthFast"],["qwen/qwen3.6-27b","strengthEcon"]],
  openrouter:[["openrouter/free","strengthEcon"]]
};
/* v5.11.46: індикатори непрочитаного в історії чатів. uid діалогу, показаного
   в панелі відповіді; завершені діалоги, що не є показаними, отримують крапку. */
const HIST_UNREAD_KEY="ai_bridge_hist_unread_v1";
let viewedRunUid=null;
function loadHistUnread(){try{const o=JSON.parse(localStorage.getItem(HIST_UNREAD_KEY)||"{}");return o&&typeof o==="object"?o:{}}catch(e){return{}}}
function saveHistUnread(o){try{const ks=Object.keys(o).slice(-200),pr={};for(const k of ks)pr[k]=o[k];localStorage.setItem(HIST_UNREAD_KEY,JSON.stringify(pr))}catch(e){}}
function markHistUnread(uid){if(!uid)return;const o=loadHistUnread();o[String(uid)]=Date.now();saveHistUnread(o)}
function clearHistUnread(uid){if(!uid)return;const o=loadHistUnread();const k=String(uid);if(k in o){delete o[k];saveHistUnread(o)}}
let status={configured:false,providers:{},models:{},authState:"unknown"};
/* Muse and Core are built-in local capabilities, not API credentials.  Keep
   them visible in the provider UI, but never count them as configured API
   keys or cloud models. */
const LOCAL_PROVIDER_IDS=new Set(["muse","core"]);
function apiProviderIds(providers=status.providers){
  return Object.keys(providers||{}).filter(id=>providers[id]&&!LOCAL_PROVIDER_IDS.has(id));
}
let attachments=[];
let imageAttachments=[];
let currentRun=null;
const MAX_IMAGE_ATTACHMENTS=4;
const MAX_IMAGE_SOURCE_BYTES=20_000_000;
const MAX_IMAGE_TOTAL_BYTES=6_000_000;
const IMAGE_MAX_EDGE=1800;
const IMAGE_JPEG_QUALITY=.84;
let voiceRecognition=null;
let voiceListening=false;
let studioMode="photo-edit";
let studioFile=null;
let studioVoiceRecognition=null;
let studioVoiceListening=false;
let agentVoiceRecognition=null;
let agentVoiceListening=false;
let agentFilePickPending=false;
const AGENT_THREAD_KEY="ai_bridge_agent_thread_v1";
const AGENT_THREAD_MAX_MESSAGES=16;
const AGENT_LESSONS_KEY="ai_bridge_agent_lessons_v1";
const AGENT_LESSONS_MAX=12;
let agentMessages=[];
const MAX_CONTEXT_CHARS=350000;
const MAX_FILE_CHARS=180000;
const ZIP_FILE_SAMPLE_CHARS=180000;
// v5.9.1: extraction keeps up to 1.4M chars on the device (was capped at the
// 350k single-request budget, so e.g. only 57 of 282 files were ever read).
// Each request still sends at most MAX_CONTEXT_CHARS; Deep Scan sends the rest in parts.
const ZIP_EXTRACT_MAX_CHARS=8_000_000;
const TEXT_EXT=/\.(txt|md|js|mjs|cjs|ts|tsx|jsx|json|html|css|py|go|rs|java|kt|swift|php|rb|xml|yaml|yml|toml|sql|sh|csv|ini|cfg|conf|env\.example)$/i;
const SKIP_PATH=/(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|Pods|DerivedData)(\/|$)/i;
const ZIP_MAX_ENTRIES=512;
const ZIP_MAX_ENTRY_DECOMPRESSED=2_000_000;
const ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000;
const ZIP_MAX_COMPRESSION_RATIO=120;

function sampleLargeFileText(text,maxChars=MAX_FILE_CHARS){
  const src=String(text||"").replace(/\0/g,"");
  if(src.length<=maxChars)return {text:src,truncated:false,originalChars:src.length};
  const markerBudget=1200;
  const each=Math.max(12000,Math.floor((maxChars-markerBudget)/3));
  const alignStart=i=>{const n=src.lastIndexOf("\n",Math.max(0,i));return n>=0?n+1:0};
  const alignEnd=i=>{const n=src.indexOf("\n",Math.min(src.length,i));return n>=0?n:src.length};
  const headEnd=alignEnd(each);
  const midCenter=Math.floor(src.length/2),midStart=alignStart(midCenter-Math.floor(each/2)),midEnd=alignEnd(midStart+each);
  const tailStart=alignStart(src.length-each);
  const lineAt=i=>1+(src.slice(0,Math.max(0,i)).match(/\n/g)||[]).length;
  const head=src.slice(0,headEnd),middle=src.slice(midStart,midEnd),tail=src.slice(tailStart);
  const sampled=[
    head,
    `\n[AI BRIDGE: LARGE FILE SAMPLE — omitted lines between ${lineAt(headEnd)} and ${Math.max(lineAt(midStart)-1,lineAt(headEnd))}; middle excerpt starts at line ${lineAt(midStart)}]\n`,
    middle,
    `\n[AI BRIDGE: LARGE FILE SAMPLE — omitted lines between ${lineAt(midEnd)} and ${Math.max(lineAt(tailStart)-1,lineAt(midEnd))}; tail excerpt starts at line ${lineAt(tailStart)}]\n`,
    tail,
    `\n[TRUNCATED LARGE FILE: original ${src.length.toLocaleString()} chars; head + middle + tail preserved]`
  ].join("");
  return {text:sampled.slice(0,maxChars+markerBudget),truncated:true,originalChars:src.length};
}

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmtDate(ts){return new Date(ts).toLocaleString(I18N?.locale?.()||"uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
const ACCESS_TOKEN_KEY="ai_bridge_access_token";
function clearLegacyTokenStorage(){
  try{localStorage.removeItem(ACCESS_TOKEN_KEY)}catch(e){}
  try{sessionStorage.removeItem(ACCESS_TOKEN_KEY)}catch(e){}
}
function authHeaders(){try{const l=I18N&&I18N.getLanguage&&I18N.getLanguage();return l?{"X-UI-Lang":l}:{}}catch(e){return {}}} /* v5.11.26: сервер перекладає свої повідомлення під мову інтерфейсу */
async function loginBridgeSession(token){
  const r=await fetch("/api/session/login",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({token})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
  clearLegacyTokenStorage();return j;
}
async function logoutBridgeSession(){
  try{await fetch("/api/session/logout",{method:"POST",cache:"no-store"})}catch(e){}
  clearLegacyTokenStorage();
}
clearLegacyTokenStorage();

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open("AI_Bridge_DB",1);
    r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("runs"))db.createObjectStore("runs",{keyPath:"id",autoIncrement:true})};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
/* v5.9.9: per-provider usage counters (this device) — requests, errors, speed, last error. */
const USAGE_KEY="ai_bridge_usage_v1",USAGE_DAYS=14;
function dayKey(ts=Date.now()){const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function loadUsage(){try{const u=JSON.parse(localStorage.getItem(USAGE_KEY)||"{}");return u&&typeof u==="object"&&!Array.isArray(u)?u:{}}catch(e){return {}}}
function recordUsage(run){
  const results=Array.isArray(run?.results)?run.results:[];if(!results.length)return;
  const u=loadUsage(),day=dayKey(run.created||Date.now()),bucket=u[day]||(u[day]={});
  for(const r of results){
    const id=String(r?.provider||"").slice(0,40);if(!id||r?.cancelled||Number(r?.status)===499)continue;
    const e=bucket[id]||(bucket[id]={n:0,ok:0,err:0,ms:0,usd:0,lastErr:""});
    e.n++;if(r.ok){e.ok++;e.ms+=Math.max(0,Number(r.ms)||0)}else{e.err++;e.lastErr=String(r.errorKind||r.status||"error").slice(0,40)}
    const c=Number(r?.costUsd);if(c>0&&isFinite(c))e.usd=Math.round(((Number(e.usd)||0)+c)*10000)/10000; // v5.11.30: витрати для бюджету
  }
  const keep=Object.keys(u).sort().slice(-Math.max(USAGE_DAYS,SPEND_DAYS));for(const k of Object.keys(u))if(!keep.includes(k))delete u[k];
  localStorage.setItem(USAGE_KEY,JSON.stringify(u));
}
function usageSummary(days=1,now=Date.now()){
  const u=loadUsage(),keys=new Set();for(let i=0;i<days;i++)keys.add(dayKey(now-i*86400000));
  const out={};
  for(const [day,bucket] of Object.entries(u)){if(!keys.has(day))continue;for(const [id,e] of Object.entries(bucket||{})){const o=out[id]||(out[id]={n:0,ok:0,err:0,ms:0,lastErr:""});o.n+=e.n||0;o.ok+=e.ok||0;o.err+=e.err||0;o.ms+=e.ms||0;if(e.lastErr)o.lastErr=e.lastErr}}
  return Object.entries(out).map(([id,o])=>({id,...o,avgMs:o.ok?Math.round(o.ms/o.ok):0})).sort((a,b)=>b.n-a.n);
}
/* v5.11.30: місячний бюджет витрат на моделі (spend caps) — Сергій ставить
   ліміт, Bridge попереджає на 80% і відхиляє запити на 100% ДО виклику моделі. */
const SPEND_CAP_KEY="ai_bridge_spend_cap_v1",SPEND_WARN_KEY="ai_bridge_spend_warned_v1",SPEND_DAYS=30;
function spendCapUsd(){const v=parseFloat(String(localStorage.getItem(SPEND_CAP_KEY)||"").replace(",","."));return v>0&&isFinite(v)?Math.round(v*100)/100:null}
function setSpendCap(v){try{if(!(Number(v)>0))localStorage.removeItem(SPEND_CAP_KEY);else localStorage.setItem(SPEND_CAP_KEY,String(Math.round(Number(v)*100)/100))}catch(e){}}
function spendUsdTotal(u,now){let s=0;const t=Number(now)||Date.now();if(!u||typeof u!=="object")return 0;for(let i=0;i<SPEND_DAYS;i++){const b=u[dayKey(t-i*86400000)];if(b)for(const e of Object.values(b)){const c=Number(e&&e.usd);if(c>0&&isFinite(c))s+=c}}return Math.round(s*10000)/10000}
function monthSpendUsd(now){return spendUsdTotal(loadUsage(),now)}
function spendGateState(spent,cap){if(!(cap>0))return{state:"off",pct:0};const pct=Number(spent)/cap;return{state:pct>=1?"block":pct>=0.8?"warn":"ok",pct:Math.round(Math.min(Math.max(pct,0),9.99)*100)}}
function renderSpendCap(){const cap=spendCapUsd(),spent=monthSpendUsd(),inp=$("spendCapInput"),st=$("spendCapStatus"),fill=$("spendCapBarFill"),bar=$("spendCapBar");if(inp&&document.activeElement!==inp)inp.value=cap==null?"":String(cap);if(st)st.textContent=cap==null?t("spendCapNoCap"):t("spendCapSpent",{spent:"$"+fmtMoney(spent),cap:"$"+fmtMoney(cap)});const pct=cap>0?Math.min(spent/cap,1):0;if(fill)fill.style.width=Math.round(pct*100)+"%";if(bar)bar.classList.toggle("over",pct>=1)}
let usageRange=1;
function usageErrLabel(kind){const k="uErr_"+String(kind||"");const v=t(k);return v&&v!==k?v:providerErrorLabel(kind)}
function renderUsage(){
  const host=$("usageTable");if(!host)return;
  const rows=usageSummary(usageRange),total=rows.reduce((a,r)=>a+r.n,0),errs=rows.reduce((a,r)=>a+r.err,0);
  $("usageTotals").textContent=total?t("usageTotals",{n:total,e:errs}):"";
  document.querySelectorAll("[data-usage-range]").forEach(b=>b.classList.toggle("active",Number(b.dataset.usageRange)===usageRange));
  if(!rows.length){host.innerHTML=`<div class="usageEmpty">${esc(t("usageEmpty"))}</div>`;return}
  host.innerHTML=rows.map(r=>{const rate=r.n?Math.round(r.ok/r.n*100):0,cls=rate>=90?"good":rate>=60?"warn":"bad";return `<div class="usageRow"><div class="usageName"><b>${esc(PROVIDERS[r.id]?.name||r.id)}</b>${r.lastErr&&r.err?`<small>${esc(t("usageLastErr"))}: ${esc(usageErrLabel(r.lastErr))}</small>`:""}</div><div class="usageNums"><span>${r.n}</span><span class="${cls}">${rate}%</span><span>${r.avgMs?(Math.round(r.avgMs/100)/10)+" "+esc(t("secShort")):"—"}</span></div><div class="usageBar"><i class="${cls}" style="width:${rate}%"></i></div></div>`}).join("");
  renderSpendCap(); // v5.11.30: бюджет витрат
}
/* v5.9.9: optional history sync between the owner's devices (server KV). Off by default. */
const SYNC_KEY="ai_bridge_history_sync";
function historySyncOn(){return localStorage.getItem(SYNC_KEY)==="1"}
function newUid(){try{return crypto.randomUUID().replace(/-/g,"")}catch(e){return Date.now().toString(36)+Math.random().toString(36).slice(2,12)}}
function setSyncStatus(key,vars){const el=$("historySyncStatus");if(el)el.textContent=key?t(key,vars):""}
function syncPayload(run){return {uid:run.uid,created:run.created,updated:run.updated||run.created,mode:run.mode,prompt:run.prompt,final:run.final,providers:run.providers,attachments:(run.attachments||[]).map(a=>typeof a==="string"?a:a?.name),results:(run.results||[]).map(r=>({provider:r.provider,ok:r.ok,ms:r.ms,status:r.status,errorKind:r.errorKind,text:r.text,costUsd:r.costUsd})),judge:run.judge,role:run.role||null,roleName:run.roleName||null}}
async function historyApi(method,items){
  const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),8000);
  try{const r=await fetch("/api/history",{method,cache:"no-store",headers:{...authHeaders(),...(items?{"Content-Type":"application/json"}:{})},body:items?JSON.stringify({items}):undefined,signal:ctl.signal});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j}finally{clearTimeout(tm)}
}
async function pushRunToCloud(run){
  if(!historySyncOn()||!run?.uid)return;
  try{const j=await historyApi("POST",[syncPayload(run)]);setSyncStatus(j.enabled?"historySyncOk":"historySyncNoKv")}catch(e){setSyncStatus("historySyncFail")}
}
async function pullCloudHistory(){
  if(!historySyncOn())return 0;
  try{
    const j=await historyApi("GET");if(!j.enabled){setSyncStatus("historySyncNoKv");return 0}
    const local=await getRuns(500),have=new Set(local.map(r=>r.uid).filter(Boolean));let added=0;
    const missing=local.filter(r=>!r.uid);
    for(const r of missing){r.uid=newUid();await putRun(r)}
    for(const it of j.items||[]){if(it.deleted||have.has(it.uid))continue;await putRun({...it,id:undefined,synced:true});added++}
    const localOnly=[...missing,...local.filter(r=>r.uid&&!r.synced&&!(j.items||[]).some(x=>x.uid===r.uid))].slice(0,60);
    if(localOnly.length)await historyApi("POST",localOnly.map(syncPayload));
    setSyncStatus("historySyncOk");return added;
  }catch(e){setSyncStatus("historySyncFail");return 0}
}
async function putRun(run){
  try{const db=await openDB();const r={...run};if(r.id==null)delete r.id;return await new Promise((resolve,reject)=>{const tx=db.transaction("runs","readwrite"),req=tx.objectStore("runs").put(r);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}catch(e){return null}
}
async function saveRun(run){
  // v5.11.68: історія оновилася — інвалідуємо кеш списку діалогів для @@пошуку.
  ctxRunsCache=null;
  // v5.11.39: тимчасовий діалог (інкогніто) — нічого не пишемо: ні IndexedDB,
  // ні лічильник usage, ні хмарна синхронізація.
  if(run?.meta?.temporary)return null;
  if(run&&typeof run==="object"){if(!run.uid)run.uid=newUid();
    // v5.11.46: діалог, що завершився не в показаній панелі, — «непрочитаний».
    if(run.uid&&run.uid!==viewedRunUid)markHistUnread(run.uid);
    try{recordUsage(run)}catch(e){}setTimeout(()=>{pushRunToCloud(run);renderUsage()},0)}
  try{
    const db=await openDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("runs","readwrite"),req=tx.objectStore("runs").add(run);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }catch(e){return null}
}
async function getRuns(limit=50){
  try{
    const db=await openDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("runs","readonly"),req=tx.objectStore("runs").getAll();
      req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,limit));req.onerror=()=>reject(req.error);
    });
  }catch(e){return[]}
}
async function clearRuns(){
  const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction("runs","readwrite");tx.objectStore("runs").clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
}
/* v5.11.33: видалення одного діалогу з Undo. */
async function deleteRun(id){
  const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction("runs","readwrite");const req=tx.objectStore("runs").delete(id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)});
}

/* v5.11.91: ручне перейменування діалогу — інлайн-редагування назви в рядку
   історії. Enter/втрата фокуса — зберегти, Esc — скасувати; порожній ввід —
   лишити як було. Назва, задана вручну, має пріоритет над автозаголовком. */
function startHistRename(btn,run){
  const item=btn.closest(".historyItem");if(!item)return;
  const label=item.querySelector(".historyPrompt");if(!label||label.querySelector("input"))return;
  const inp=document.createElement("input");
  inp.type="text";inp.className="histRenameInput";inp.maxLength=120;
  inp.value=String(run.title||"");inp.placeholder=t("renameRunPh");
  inp.setAttribute("aria-label",t("renameRun"));
  label.textContent="";label.appendChild(inp);inp.focus();inp.select();
  let done=false;
  const finish=save=>{if(done)return;done=true;
    const v=inp.value.trim().slice(0,120);
    if(save&&v&&v!==run.title){run.title=v;putRun(run).then(()=>{renderHistory();toast(t("renameSaved"),"good")})}
    else renderHistory();
  };
  inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();finish(true)}else if(ev.key==="Escape"){ev.preventDefault();finish(false)}});
  inp.addEventListener("blur",()=>finish(true));
}


function updateMcpUrl(){
  const url=location.protocol==="http:"||location.protocol==="https:"?location.origin+"/mcp":"Deploy to Cloudflare first";
  $("mcpUrl").value=url;
}
async function testMcp(){
  updateMcpUrl();
  if(location.protocol==="file:"){
    $("mcpReadyPill").textContent=t("pillDeploy");
    $("mcpReadyPill").className="statusPill err";
    $("mcpStatusText").className="mcpStatusText bad";
    $("mcpStatusText").textContent=t("mcpNeedDeploy");
    return;
  }
  $("mcpStatusText").className="mcpStatusText";
  $("mcpStatusText").textContent=t("mcpCheckingOAuth");
  try{
    let j=null;
    const info=await fetch("/api/mcp-info",{headers:authHeaders(),cache:"no-store"});
    if(info.ok){
      j=await info.json();
      const [oauthRes,resourceRes]=await Promise.all([
        fetch("/.well-known/oauth-authorization-server",{cache:"no-store"}),
        fetch("/.well-known/oauth-protected-resource",{cache:"no-store"})
      ]);
      const oauthJson=await oauthRes.json().catch(()=>({}));
      const resourceJson=await resourceRes.json().catch(()=>({}));
      if(!oauthRes.ok||!oauthJson.authorization_endpoint||!oauthJson.token_endpoint)throw new Error(t("errOAuthMeta"));
      if(!Array.isArray(oauthJson.scopes_supported)||!oauthJson.scopes_supported.includes("offline_access"))throw new Error(t("errOAuthScope"));
      if(!resourceRes.ok||!String(resourceJson.resource||"").endsWith("/mcp"))throw new Error(t("errMcpResMeta"));
    }else if(info.status===404){
      // Older/misaligned deploys may not expose /api/mcp-info even when the
      // core Connector routes are healthy. Probe the canonical endpoints.
      const [statusRes,oauthRes,resourceRes]=await Promise.all([
        fetch("/api/status",{headers:authHeaders(),cache:"no-store"}),
        fetch("/.well-known/oauth-authorization-server",{cache:"no-store"}),
        fetch("/.well-known/oauth-protected-resource",{cache:"no-store"})
      ]);
      const statusJson=await statusRes.json().catch(()=>({}));
      if(!statusRes.ok)throw new Error(statusJson.error||`Status HTTP ${statusRes.status}`);
      const oauthJson=await oauthRes.json().catch(()=>({}));
      const resourceJson=await resourceRes.json().catch(()=>({}));
      if(!oauthRes.ok||!oauthJson.authorization_endpoint||!oauthJson.token_endpoint)throw new Error(t("errOAuthMeta"));
      if(!Array.isArray(oauthJson.scopes_supported)||!oauthJson.scopes_supported.includes("offline_access"))throw new Error(t("errOAuthScope"));
      if(!resourceRes.ok||!String(resourceJson.resource||"").endsWith("/mcp"))throw new Error(t("errMcpResMeta"));
      const probe=await fetch("/mcp",{
        method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2025-11-25"},
        body:JSON.stringify({jsonrpc:"2.0",id:"healthcheck",method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"ai-bridge-ui",version:"healthcheck"}}})
      });
      const challenged=probe.status===401&&/^Bearer\b/i.test(probe.headers.get("WWW-Authenticate")||"");
      if(!probe.ok&&!challenged)throw new Error(`MCP HTTP ${probe.status}`);
      const providerCount=Object.values(statusJson.providers||{}).filter(Boolean).length;
      j={ready:providerCount>0,mcpVersion:"2025-11-25",providerCount,oauth:true,message:providerCount?"Ready":"Add at least one provider API key."};
    }else{
      const err=await info.json().catch(()=>({}));
      throw new Error(err.error||`HTTP ${info.status}`);
    }
    $("mcpReadyPill").textContent=j.ready?t("pillReady"):t("pillSetup");
    $("mcpReadyPill").className="statusPill "+(j.ready?"on":"err");
    $("mcpStatusText").className="mcpStatusText "+(j.ready?"good":"bad");
    $("mcpStatusText").textContent=j.ready?
      t("mcpReady",{v:j.modernVersion||j.mcpVersion,n:j.providerCount}):
      (j.message||t("mcpNotReady"));
  }catch(e){
    $("mcpReadyPill").textContent=t("pillError");
    $("mcpReadyPill").className="statusPill err";
    $("mcpStatusText").className="mcpStatusText bad";
    $("mcpStatusText").textContent=e.message;
  }
}

function showUpdateBanner(text){const b=$("updateBanner");if(!b)return;if(text)$("updateBannerText").textContent=text;b.classList.remove("hidden")}
/* 2026-10-01: автооновлення при відкритті. Якщо на сервері новіша версія,
   застосунок оновлює service worker і перезавантажується сам — без тапу. */
let autoUpdating=false;
function verIsNewer(a,b){
  const pa=String(a).split(".").map(x=>parseInt(x,10)||0),pb=String(b).split(".").map(x=>parseInt(x,10)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){const x=pa[i]||0,y=pb[i]||0;if(x!==y)return x>y}
  return false;
}
async function autoUpdateTo(v){
  if(autoUpdating)return;autoUpdating=true;
  try{
    const msg=t("updating",{v});
    showUpdateBanner(msg);
    const ts=$("topStatus");if(ts)ts.textContent=msg;setStatusState("busy");
    if("serviceWorker" in navigator){
      try{const reg=await navigator.serviceWorker.getRegistration();if(reg)await reg.update();}catch(e){}
    }
  }catch(e){}
  setTimeout(()=>location.reload(),1200);
}
function setStatusState(state){const el=$("topStatus");if(!el)return;el.classList.remove("stateOk","stateWarn","stateBad","stateBusy");el.classList.add({ok:"stateOk",warn:"stateWarn",bad:"stateBad",busy:"stateBusy"}[state]||"stateBusy")}
async function refreshStatus(){
  const previous=status;
  $("topStatus").textContent=t("statusChecking");setStatusState("busy");
  try{
    const r=await fetch("/api/status",{headers:authHeaders(),cache:"no-store",credentials:"same-origin"});
    const j=await readApiJson(r);
    status=r.ok?j:{configured:false,providers:{},models:{},error:j.error||`HTTP ${r.status}`};
    setConn(r.ok?"on":"off"); // v5.10.5: raw connectivity dot
    if(r.status===401){
      status.authState="need-login"; // v5.11.81: 401 = потрібен вхід, не "немає мережі"
      renderAuthState(false);
      $("topStatus").textContent=t("statusNeedToken");setStatusState("warn");
    }else if(j.setupRequired){
      status.authState="no-server-token";
      renderAuthState(false);
      $("topStatus").textContent=t("authNoServerToken");setStatusState("warn");
    }else if(!r.ok){
      status.authState=r.status===403?"forbidden":(r.status>=500?"server-error":"error");
      $("topStatus").textContent=t("statusError",{status:r.status});setStatusState("bad");
    }else if(j.version&&j.version!==UI_VERSION){
      status.authState="authenticated";
      renderAuthState(true);
      // 2026-10-01: сервер новіший за UI — оновитися автоматично, один раз
      // на версію за сесію вкладки (захист від циклу перезавантажень).
      if(verIsNewer(j.version,UI_VERSION)&&!sessionStorage.getItem("abAutoUpd")){
        sessionStorage.setItem("abAutoUpd",j.version);
        autoUpdateTo(j.version);
      }else{
        $("topStatus").textContent=t("statusMismatch",{ui:UI_VERSION,worker:j.version});setStatusState("warn");
        showUpdateBanner(t("updateMismatch",{ui:UI_VERSION,worker:j.version}));
      }
    }else{
      status.authState="authenticated";
      renderAuthState(true);
      const n=apiProviderIds(j.providers).length;
      $("topStatus").textContent=t("statusOnline",{n});setStatusState(n?"ok":"warn");
    }
  }catch(e){
    setConn("off"); // v5.10.5: status probe failed = server unreachable
    // A transient status-probe failure must not erase known-good provider state.
    // If an AI request has already succeeded, the Bridge is demonstrably online.
    const knownCount=apiProviderIds(previous?.providers).length;
    if(knownCount){
      status=previous;
      if(status)status.authState=status.authState||"authenticated";
      $("topStatus").textContent=t("statusOnlineTemp",{n:knownCount});setStatusState("warn");
    }else{
      status={configured:false,providers:{},models:{},authState:"network-error",error:String(e?.message||e||"status probe failed")};
      $("topStatus").textContent=location.protocol==="file:"?t("statusNeedCloudflare"):t("statusOffline");setStatusState("bad");
    }
  }
  renderProviders();
  renderConnections();
  renderAgentProviderOptions();
  updateAgentAttachmentSummary();
  updateStudioEngineInfo();
  updateCallEstimate();
  updateMcpUrl();
  if(location.protocol!=="file:"&&status?.configured&&!status?.error){testMcp();refreshProviderTokenStatus()}
}

/* v5.10.5: server-connection dot — green/red in the topbar, visible on every
   page. Reflects raw reachability of the Bridge server, not provider config. */
let connState="checking",connTimer=null;
function setConn(state){
  connState=state;
  const d=$("connDot");if(!d)return;
  d.classList.remove("on","off","checking");
  d.classList.add(state==="on"?"on":state==="off"?"off":"checking");
  const label=state==="on"?t("connOnline"):state==="off"?t("connOffline"):t("connChecking");
  d.title=label;d.setAttribute("aria-label",label);
}
async function pingBridge(){
  if(!navigator.onLine){setConn("off");return false}
  if(connState!=="off")setConn("checking");
  try{
    const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort("timeout"),9000);
    let r;try{r=await fetch("/api/version",{cache:"no-store",credentials:"same-origin",signal:ctl.signal})}finally{clearTimeout(tm)}
    const ok=!!(r&&r.ok);setConn(ok?"on":"off");return ok;
  }catch(e){setConn("off");return false}
}
function initConnDot(){
  const d=$("connDot");if(d)d.addEventListener("click",()=>pingBridge());
  setConn("checking");pingBridge();
  window.addEventListener("online",()=>pingBridge());
  window.addEventListener("offline",()=>setConn("off"));
  if(connTimer)clearInterval(connTimer);
  connTimer=setInterval(()=>{if(!document.hidden)pingBridge()},30000);
}

function renderProviders(){
  const pinnedProvIds=loadPinned(PINNED_PROVIDERS_KEY);
  /* v5.11.81: без авторизації статуси невідомі — не показуємо "0/8" і "НЕМАЄ" */
  const needAuth=status.authState==="need-login"||status.authState==="unknown";
  const items=sortPinnedFirst(Object.entries(PROVIDERS),([id])=>id,pinnedProvIds),mode=$("teamMode")?.value||"auto";
  $("miniProviderStatus").innerHTML=needAuth
    ?`<div class="miniProvider"><span class="statusDot"></span>${esc(t("authStateUnknown"))}</div>`
    :items.filter(([id])=>id!=="openai"||status.providers?.openai).map(([id,p])=>
    `<div class="miniProvider"><span class="statusDot ${status.providers?.[id]?"on":""}"></span>${p.name}</div>`
  ).join("");
  /* v5.11.49: пігулка мережі в топбарі — налаштовано/всього */
  try{const _nc=$("netCount");if(_nc){const apiTotal=Object.keys(PROVIDERS).filter(id=>!LOCAL_PROVIDER_IDS.has(id)).length;_nc.textContent=needAuth?"?":apiProviderIds().length+"/"+apiTotal;}}catch(e){}

  let selected=["gemini","groqfree","openrouter"];
  try{const saved=JSON.parse(localStorage.getItem("ai_bridge_selected")||"null");if(Array.isArray(saved))selected=saved.filter(x=>typeof x==="string")}catch(e){localStorage.removeItem("ai_bridge_selected")}
  if(selected.includes("kimi")){selected=selected.filter(x=>x!=="kimi");if(!selected.includes("groqfree"))selected.push("groqfree");if(!selected.includes("openrouter"))selected.push("openrouter");localStorage.setItem("ai_bridge_selected",JSON.stringify(selected))}

  // v5.11.46: пошук моделей — живе фільтрування груп за провайдером.
  const searchEl=$("modelSearch");
  if(searchEl&&!searchEl.dataset.bound){searchEl.dataset.bound="1";searchEl.addEventListener("input",()=>{clearTimeout(renderProviders._t);renderProviders._t=setTimeout(renderProviders,160)})}
  const q=(searchEl?.value||"").trim().toLowerCase();
  const hit=x=>!q||String(x||"").toLowerCase().includes(q);

  // Моделі провайдера: налаштована (status.models) з позначкою ✓ + резервні з каталогу.
  const modelRowsHtml=(id,p,on)=>{
    const configured=status.models?.[id]||"";
    const catalog=MODEL_CATALOG[id]||[];
    const list=catalog.map(([m,s])=>({m,s,active:configured?m===configured:m===(catalog[0]||[])[0]}));
    if(q&&!hit(p.name)&&!hit(provNote(id,p))&&!list.some(x=>hit(x.m)||hit(t(x.s))))return "";
    const rows=list.filter(x=>!q||hit(x.m)||hit(t(x.s))||hit(p.name)).map(x=>
      `<button type="button" class="modelRow${x.active?" active":""}" data-model-provider="${id}"${on?"":" disabled"}><span class="modelName">${esc(x.m)}</span><span class="modelStrength">${esc(t(x.s))}</span>${x.active?`<span class="modelActiveTag">✓ ${esc(t("modelActive"))}</span>`:""}</button>`).join("");
    return rows?`<div class="modelList">${rows}</div>`:"";
  };
  const headerHtml=(id,p,pickHtml)=>{
    const pin=isPinned(pinnedProvIds,id);
    return `<div class="providerPickWrap">${pickHtml}<button type="button" class="pinBtn${pin?" on":""}" data-provider-pin="${id}" title="${esc(t(pin?"unpinBtn":"pinBtn"))}" aria-label="${esc(t(pin?"unpinBtn":"pinBtn"))}" aria-pressed="${pin?"true":"false"}">📌</button></div>`;
  };

  if(mode==="single"){
    const configured=items.filter(([id])=>status.providers?.[id]).map(([id])=>id);
    let single=localStorage.getItem("ai_bridge_single_provider")||selected.find(id=>configured.includes(id))||configured[0]||"";
    if(single&&!configured.includes(single))single=configured[0]||"";
    if(single)localStorage.setItem("ai_bridge_single_provider",single);
    $("providerSelector").innerHTML=items.map(([id,p])=>{
      const on=!!status.providers?.[id]||!!p.local,checked=id===single,rows=modelRowsHtml(id,p,on); /* v5.11.95: локальне Ядро доступне завжди */
      if(q&&!rows)return "";
      return `<div class="provGroup">${headerHtml(id,p,`<label class="providerPick singlePick ${checked?"selected":""} ${on?"":"off"}"><div class="providerLogo">${p.logo}</div><div class="providerText"><b>${p.name}</b>${costTierHtml(id)}${localBadgeHtml(id)}<span>${esc(status.models?.[id]||provNote(id,p))}${on?"":" • not connected"}</span></div><input type="radio" name="singleProvider" data-provider="${id}" ${checked?"checked":""} ${on?"":"disabled"}></label>`)}${rows}</div>`;
    }).join("");
    $("singleModeHint")?.classList.remove("hidden");
    document.querySelectorAll('[name="singleProvider"][data-provider]').forEach(el=>el.addEventListener("change",()=>{localStorage.setItem("ai_bridge_single_provider",el.dataset.provider);renderProviders();updateCallEstimate()}));
  }else{
    $("providerSelector").innerHTML=items.map(([id,p])=>{
      const on=!!status.providers?.[id]||!!p.local,checked=selected.includes(id),rows=modelRowsHtml(id,p,on);
      if(q&&!rows)return "";
      return `<div class="provGroup">${headerHtml(id,p,`<label class="providerPick ${on?"":"off"}"><div class="providerLogo">${p.logo}</div><div class="providerText"><b>${p.name}</b>${costTierHtml(id)}${localBadgeHtml(id)}<span>${esc(status.models?.[id]||provNote(id,p))}${on?"":" • not connected"}</span></div><input type="checkbox" data-provider="${id}" ${checked?"checked":""} ${on?"":"disabled"}></label>`)}${rows}</div>`;
    }).join("");
    $("singleModeHint")?.classList.add("hidden");
    $("agentModeHint")?.classList.toggle("hidden",mode!=="agent");
    $("godModeHint")?.classList.toggle("hidden",mode!=="god");
    document.querySelectorAll('[data-provider][type="checkbox"]').forEach(el=>el.addEventListener("change",()=>{const arr=[...document.querySelectorAll('[data-provider][type="checkbox"]:checked')].map(x=>x.dataset.provider);localStorage.setItem("ai_bridge_selected",JSON.stringify(arr));updateCallEstimate()}));
  }
  // v5.11.12: pin providers to the top of the selector.
  document.querySelectorAll("[data-provider-pin]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();togglePinned(PINNED_PROVIDERS_KEY,b.dataset.providerPin);renderProviders()}));
  // v5.11.46: тап по рядку моделі = вибір її провайдера.
  document.querySelectorAll('[data-model-provider]:not([disabled])').forEach(el=>el.addEventListener("click",()=>{
    const id=el.dataset.modelProvider;
    if(($("teamMode")?.value||"auto")==="single"){if(!status.providers?.[id])return;localStorage.setItem("ai_bridge_single_provider",id)}
    else{let arr=[];try{const s=JSON.parse(localStorage.getItem("ai_bridge_selected")||"null");if(Array.isArray(s))arr=s.filter(x=>typeof x==="string")}catch(e){}
      const i=arr.indexOf(id);if(i>=0)arr.splice(i,1);else arr.push(id);localStorage.setItem("ai_bridge_selected",JSON.stringify(arr))}
    renderProviders();updateCallEstimate();
  }));
}
function renderConnections(){
  /* v5.11.81: без авторизації не робимо висновків про ключі */
  const needAuth=status.authState==="need-login"||status.authState==="unknown";
  const unknownPill=`<span class="statusPill">${esc(t("authStateUnknown"))}</span>`;
  const providers=Object.entries(PROVIDERS).map(([id,p])=>{
    const on=!!status.providers?.[id],model=status.models?.[id]||"—";
    const localConn=id==="muse"||id==="core";
    const pill=needAuth&&!localConn?unknownPill:`<span class="statusPill ${localConn?"on":(on?"on":"err")}">${localConn?esc(t("museNoSetup")):(on?t("keySet"):t("keyUnset"))}</span>`;
    return `<div class="connectionCard"><div class="connectionMain"><div class="providerLogo">${p.logo}</div><div class="providerText"><b>${p.name}</b><span>${esc(provNote(id,p))}</span></div></div><div class="connectionRight">${pill}<span>${esc(localConn?"—":model)}</span></div></div>`;
  }).join("");
  const cf=!!status.media?.cloudflareAI,cfEngine=String(status.media?.cloudflareAIEngine||"none");
  const cfLabel=needAuth?t("authStateUnknown"):cfEngine==="binding"?t("cloudflareAiBound"):cfEngine==="rest"?t("cloudflareAiRest"):t("cloudflareAiMissing");
  const agentCore=status.agent?.coreReady?` • Agent Core: ${status.agent?.coreTransport==="provider"?"Bridge router":status.agent?.coreTransport==="rest"?"REST":"binding"}`:"";
  const media=`<div class="connectionCard mediaEngineCard"><div class="connectionMain"><div class="providerLogo">☁</div><div class="providerText"><b>${esc(t("cloudflareAiName"))}</b><span>${esc(t("cloudflareAiHelp"))}${esc(agentCore)}</span></div></div><div class="connectionRight"><span class="statusPill ${cf?"on":"err"}">${esc(cfLabel)}</span><span>FLUX.2 klein 4B</span></div></div>`;
  const persistent=!!status.jobsPersistent,health=Object.entries(status.providerHealth||{}).filter(([,h])=>h?.coolingDown);
  const recoveryLabel=needAuth?t("authStateUnknown"):persistent?"KV RECOVERY":"BEST EFFORT";
  const recovery=`<div class="connectionCard"><div class="connectionMain"><div class="providerLogo">↻</div><div class="providerText"><b>Background job recovery</b><span>${needAuth?esc(t("authStateUnknown")):persistent?"KV stores job records across Worker isolates; interrupted execution may need a retry.":"Best effort in this Worker only: bind AI_BRIDGE_JOBS KV to keep job records across reconnects."}${health.length?` • Cooling down: ${health.map(([id])=>PROVIDERS[id]?.name||id).join(", ")}`:""}</span></div></div><div class="connectionRight"><span class="statusPill ${needAuth?"":persistent?"on":"err"}">${recoveryLabel}</span><span>${esc(status.jobExecution||"waitUntil-bounded")}</span></div></div>`;
  $("connectionCards").innerHTML=providers+media+recovery;
}

async function refreshProviderTokenStatus(){
  const msg=$("providerTokenMessage");
  try{
    const r=await fetch("/api/provider-tokens",{cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    document.querySelectorAll("[data-token-status]").forEach(el=>{
      const id=el.dataset.tokenStatus,st=j.providers?.[id],del=document.querySelector(`[data-delete-provider-token="${id}"]`);
      if(st?.active==="phone"){el.textContent=t("tokenPhone");el.className="on"}
      else if(st?.active==="cloudflare"){el.textContent=t("tokenCloudflare");el.className="on"}
      else{el.textContent=t("tokenMissing");el.className="off"}
      if(del)del.disabled=!st?.mobile;
    });
  }catch(e){if(msg)msg.textContent=t("errTokenMgmt",{e:e.message})}
}
function providerTokenLabel(id){
  if(id==="fal")return "AI Studio / fal.ai";
  if(id==="cloudflare_ai")return "Cloudflare Workers AI API Token";
  if(id==="cloudflare_account")return "Cloudflare Account ID";
  return PROVIDERS[id]?.name||id;
}
async function saveProviderToken(id){
  const input=$(`providerToken-${id}`),card=document.querySelector(`[data-token-card="${id}"]`),msg=$("providerTokenMessage");
  const token=input?.value.trim()||"";if(!token){if(msg)msg.textContent=t("errTokenEmpty");input?.focus();return}
  card?.classList.add("busy");
  try{
    const r=await fetch("/api/provider-tokens",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({provider:id,token})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    input.value="";if(msg)msg.textContent=t("msgTokenSaved",{label:providerTokenLabel(id)});
    await refreshProviderTokenStatus();await refreshStatus();
    await verifySavedToken(id);
  }catch(e){if(msg)msg.textContent=t("errTokenSave",{e:e.message})}finally{card?.classList.remove("busy")}
}
/* v5.9.1 Save & Verify: a saved key is checked with one short real request
   (text providers) or Cloudflare's free token-verify call (Workers AI).
   "KEY SET" alone is never presented as a working provider. */
async function verifySavedToken(id){
  const el=document.querySelector(`[data-token-status="${id}"]`),msg=$("providerTokenMessage");
  const set=(text,cls)=>{if(el){el.textContent=text;el.className=cls}};
  set(t("verifyRunning"),"");
  try{
    if(PROVIDERS[id]){
      const r=await fetch("/api/diagnostics/providers",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({providers:[id]})});
      const j=await readApiJson(r),x=(j.tested||[])[0];
      if(!r.ok||!x)throw new Error(j.error||`HTTP ${r.status}`);
      if(x.ok){set(t("verifyOk"),"on");if(msg)msg.textContent=t("verifyOkMsg",{name:providerTokenLabel(id),model:x.model||""})}
      else{set(t("verifyFail"),"off");if(msg)msg.textContent=`${providerTokenLabel(id)}: ${providerDiagnosticError(x)}`}
      return;
    }
    if(id==="cloudflare_ai"||id==="cloudflare_account"||id==="fal"){
      const r=await fetch("/api/diagnostics/media",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({engine:id==="fal"?"fal":"cloudflare"})});
      const j=await readApiJson(r);if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
      set(j.ok?(j.state==="saved_unverified"?t("verifySavedOnly"):t("verifyOk")):j.state==="missing"?t("verifyIncomplete"):t("verifyFail"),j.ok?"on":"off");
      if(msg)msg.textContent=`${providerTokenLabel(id)}: ${j.message||""}`;
      updateStudioEngineInfo();
    }
  }catch(e){set(t("verifyUnknown"),"off");if(msg)msg.textContent=`${providerTokenLabel(id)}: ${t("verifyError")} (${String(e?.message||e).slice(0,120)})`}
}
async function deleteProviderToken(id){
  const card=document.querySelector(`[data-token-card="${id}"]`),msg=$("providerTokenMessage");
  if(!confirm(t("confirmTokenDelete",{label:providerTokenLabel(id)})))return;
  card?.classList.add("busy");
  try{
    const r=await fetch("/api/provider-tokens",{method:"DELETE",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({provider:id})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    const input=$(`providerToken-${id}`);if(input)input.value="";if(msg)msg.textContent=t("msgTokenDeleted",{label:providerTokenLabel(id)});
    await refreshProviderTokenStatus();await refreshStatus();
  }catch(e){if(msg)msg.textContent=t("errTokenDelete",{e:e.message})}finally{card?.classList.remove("busy")}
}

function providerDiagnosticError(result={}){
  const status=Number(result.status)||0,kind=String(result.errorKind||"").toLowerCase();
  if(status===429||kind==="rate_limited"||kind==="billing_or_quota")return "RATE LIMIT / QUOTA — fallback will be used";
  if(status===401||kind==="invalid_api_key")return "INVALID API KEY";
  if(status===403||kind==="permission_denied")return "PERMISSION DENIED";
  if(kind==="timeout")return "TIMEOUT — fallback will be used";
  if(status>=500||kind==="provider_unavailable"||kind==="model_unavailable")return "TEMPORARILY UNAVAILABLE — fallback will be used";
  return "REQUEST FAILED — fallback will be used";
}

async function testProviders(){
  const btn=$("testProvidersBtn"),out=$("providerDiagResults");
  if(!out)return;
  if(btn)btn.disabled=true;
  out.className="mcpStatusText";out.textContent=t("diagRunning");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch("/api/diagnostics/providers",{method:"POST",headers:{...authHeaders(),"Content-Type":"application/json"},cache:"no-store",signal:controller.signal,body:JSON.stringify({providers:["gemini","groqfree","openrouter"]})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(new Error("diagnostics_failed"),{status:r.status});
    const lines=(j.tested||[]).map(x=>`${x.ok?"✓":"✗"} ${PROVIDERS[x.provider]?.name||x.provider} • ${x.model||"—"} • ${x.ok?"API OK":providerDiagnosticError(x)}`);
    out.className="mcpStatusText "+(j.usable===j.total&&j.total?"good":"bad");
    out.textContent=t("diagResponding",{ok:j.usable,total:j.total})+"\n"+lines.join("\n");
  }catch(e){out.className="mcpStatusText bad";out.textContent=e?.name==="AbortError"?"Provider diagnostics timed out after 20 seconds. Try again.":`Provider diagnostics could not be completed${e?.status?` (HTTP ${e.status})`:""}. Try again.`}
  finally{clearTimeout(timer);if(btn)btn.disabled=false}
}

function selectedProviders(){
  /* v5.11.95: локальний провайдер (Ядро) не залежить від сервера — він має працювати і без входу, і без інтернету;
     раніше, якщо статус сервера не завантажився, Ядро не можна було вибрати саме тоді, коли воно найпотрібніше. */
  const mode=$("teamMode")?.value||"auto";
  const selector=mode==="single"?'[name="singleProvider"][data-provider]:checked':'[data-provider][type="checkbox"]:checked';
  return [...document.querySelectorAll(selector)].map(x=>x.dataset.provider).filter(id=>PROVIDERS[id]?.local||status.providers?.[id]);
}

function readBlobDataUrl(blob){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(r.error||new Error(t("photoReadFail")));r.readAsDataURL(blob)});
}
function loadImageElement(src){
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(t("photoOpenFail")));img.src=src});
}
function canvasBlob(canvas,type="image/jpeg",quality=IMAGE_JPEG_QUALITY){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error(t("photoPrepareFail"))),type,quality));
}
async function prepareImageAttachment(file){
  if(!file||!String(file.type||"").startsWith("image/"))throw new Error(t("photoChooseImage"));
  if(file.size>MAX_IMAGE_SOURCE_BYTES)throw new Error(t("errPhotoTooBig",{name:file.name||""}));
  const src=await readBlobDataUrl(file),img=await loadImageElement(src);
  const naturalW=Number(img.naturalWidth||img.width||0),naturalH=Number(img.naturalHeight||img.height||0);
  if(!naturalW||!naturalH)throw new Error(t("photoSizeFail"));
  let scale=Math.min(1,IMAGE_MAX_EDGE/Math.max(naturalW,naturalH));
  let w=Math.max(1,Math.round(naturalW*scale)),h=Math.max(1,Math.round(naturalH*scale));
  const render=async(quality,targetW=w,targetH=h)=>{
    const canvas=document.createElement("canvas");canvas.width=targetW;canvas.height=targetH;
    const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw new Error(t("errCanvas"));
    ctx.drawImage(img,0,0,targetW,targetH);
    return canvasBlob(canvas,"image/jpeg",quality);
  };
  let blob=await render(IMAGE_JPEG_QUALITY);
  if(blob.size>2_200_000){
    const shrink=Math.min(1,1400/Math.max(w,h));w=Math.max(1,Math.round(w*shrink));h=Math.max(1,Math.round(h*shrink));blob=await render(.76,w,h);
  }
  if(blob.size>2_100_000){
    const shrink=Math.min(1,1100/Math.max(w,h));w=Math.max(1,Math.round(w*shrink));h=Math.max(1,Math.round(h*shrink));blob=await render(.68,w,h);
  }
  const dataUrl=await readBlobDataUrl(blob),comma=dataUrl.indexOf(",");
  if(comma<0)throw new Error(t("photoEncodeFail"));
  return {name:String(file.name||`photo-${Date.now()}.jpg`).slice(0,120),mime:"image/jpeg",data:dataUrl.slice(comma+1),bytes:blob.size,width:w,height:h};
}
function renderImageAttachments(){
  const markup=imageAttachments.map((a,i)=>`<div class="imagePreviewCard"><img alt="${esc(a.name)}" src="data:${a.mime};base64,${a.data}"><button class="imageRemoveBtn" type="button" data-image-remove="${i}" aria-label="${esc(t("imageRemove"))}">×</button><span class="imageBadge">${esc(a.name)}</span></div>`).join("");
  for(const id of ["imagePreviewStrip","agentImagePreviewStrip"]){const host=$(id);if(host)host.innerHTML=markup}
  // v5.10.0: vision analyze button under the preview strip.
  const visionBtn=`<button type="button" class="tinyBtn visionBtn visionAnalyzeBtn">🔍 ${esc(t("visionAnalyze"))}</button>`;
  for(const id of ["imagePreviewStrip","agentImagePreviewStrip"]){
    const host=$(id);if(!host)continue;
    const old=host.parentElement?.querySelector(":scope > .visionBtn");
    if(imageAttachments.length&&!old){const b=document.createElement("span");b.innerHTML=visionBtn;host.after(b.firstChild)}
    if(!imageAttachments.length&&old)old.remove();
  }
  document.querySelectorAll("[data-image-remove]").forEach(b=>b.onclick=()=>{imageAttachments.splice(Number(b.dataset.imageRemove),1);renderImageAttachments()});
  document.querySelector(".composer")?.classList.toggle("composerHasImages",imageAttachments.length>0);
  document.querySelector(".agentComposer")?.classList.toggle("composerHasImages",imageAttachments.length>0);
  updateAgentAttachmentSummary();
  updateCallEstimate();
}
async function acceptImageFiles(list){
  const files=[...(list||[])];if(!files.length)return;
  for(const f of files){
    if(imageAttachments.length>=MAX_IMAGE_ATTACHMENTS){alert(t("maxPhotos",{n:MAX_IMAGE_ATTACHMENTS}));break}
    try{
      const prepared=await prepareImageAttachment(f);
      const total=imageAttachments.reduce((n,a)=>n+(a.bytes||0),0)+prepared.bytes;
      if(total>MAX_IMAGE_TOTAL_BYTES){alert(t("photosTooLarge"));break}
      imageAttachments.push(prepared);
    }catch(e){alert(e.message||String(e))}
  }
  renderImageAttachments();
  if($("page-agent")?.classList.contains("active"))$("agentPrompt")?.focus();else $("prompt")?.focus();
}
function flashComposerTool(btn){
  if(!btn)return;btn.classList.remove("toolPressed");void btn.offsetWidth;btn.classList.add("toolPressed");setTimeout(()=>btn.classList.remove("toolPressed"),420);
}
function setVoiceUi(state,message=""){
  const btn=$("voiceBtn"),label=$("voiceBtnLabel"),statusEl=$("voiceStatus");
  const listening=state==="listening";voiceListening=listening;
  btn?.classList.toggle("listening",listening);btn?.setAttribute("aria-pressed",listening?"true":"false");
  if(label)label.textContent=listening?t("voiceListening"):t("voice");
  if(statusEl){statusEl.textContent=message;statusEl.classList.toggle("listening",listening)}
}
function startVoiceInput(){
  if(voiceListening&&voiceRecognition){try{voiceRecognition.stop()}catch(e){};return}
  const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Ctor){
    setVoiceUi("idle",t("voiceUnavailable"));
    $("prompt")?.focus();return;
  }
  const input=$("prompt");if(!input)return;
  const rec=new Ctor();voiceRecognition=rec;
  rec.lang=I18N?.voiceLocale?.()||navigator.language||"uk-UA";
  rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=1;
  const base=input.value.trim(),finalParts=[];
  rec.onstart=()=>setVoiceUi("listening",t("voiceSpeak"));
  rec.onresult=e=>{
    let interim="";
    for(let i=e.resultIndex;i<e.results.length;i++){
      const text=String(e.results[i]?.[0]?.transcript||"").trim();if(!text)continue;
      if(e.results[i].isFinal)finalParts.push(text);else interim+=(interim?" ":"")+text;
    }
    input.value=[base,finalParts.join(" "),interim].filter(Boolean).join(" ").trim();
    input.dispatchEvent(new Event("input",{bubbles:true}));
  };
  rec.onerror=e=>{
    const code=String(e?.error||"");
    const msg=code==="not-allowed"||code==="service-not-allowed"?t("voiceMicDenied"):code==="no-speech"?t("voiceNoSpeech"):t("voiceStopped",{code:code?`: ${code}`:""});
    setVoiceUi("idle",msg);
  };
  rec.onend=()=>{if(voiceRecognition===rec){voiceRecognition=null;if(voiceListening)setVoiceUi("idle",input.value.trim()?t("voiceAdded"):"")}};
  try{rec.start()}catch(e){setVoiceUi("idle",t("voiceStartFail"))}
}

function setStudioVoiceUi(state,message=""){
  const btn=$("studioVoiceBtn"),label=$("studioVoiceBtnLabel"),statusEl=$("studioVoiceStatus");
  const listening=state==="listening";studioVoiceListening=listening;
  btn?.classList.toggle("listening",listening);btn?.setAttribute("aria-pressed",listening?"true":"false");
  if(label)label.textContent=listening?t("voiceListening"):t("voice");
  if(statusEl){statusEl.textContent=message;statusEl.classList.toggle("listening",listening)}
}

/* v5.11.21: узагальнений голосовий ввід (Web Speech API, патерн месенджерів):
   кнопка поруч із полем, пульсація під час запису, текст дописується в поле.
   Мова — voiceLocale() інтерфейсу (uk-UA/en-US), без доступу до мікрофона —
   дружнє українське повідомлення, текст НЕ відправляється автоматично. */
function createVoiceInput({btnId,labelId,statusId,inputId,getLang}){
  const state={rec:null,listening:false};
  function setUi(mode,message=""){
    const btn=document.getElementById(btnId),label=document.getElementById(labelId),statusEl=document.getElementById(statusId);
    const listening=mode==="listening";state.listening=listening;
    btn?.classList.toggle("listening",listening);btn?.setAttribute("aria-pressed",listening?"true":"false");
    if(label)label.textContent=listening?t("voiceListening"):t("voice");
    if(statusEl){statusEl.textContent=message;statusEl.classList.toggle("listening",listening)}
  }
  function start(){
    if(state.listening&&state.rec){try{state.rec.stop()}catch(e){};return}
    const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
    const input=document.getElementById(inputId);if(!input)return;
    if(!Ctor){setUi("idle",t("voiceUnavailable"));input.focus();return}
    const rec=new Ctor();state.rec=rec;
    rec.lang=(typeof getLang==="function"?getLang():null)||I18N?.voiceLocale?.()||navigator.language||"uk-UA";
    rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=1;
    const base=input.value.trim(),finalParts=[];
    rec.onstart=()=>setUi("listening",t("voiceSpeak"));
    rec.onresult=e=>{
      let interim="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const text=String(e.results[i]?.[0]?.transcript||"").trim();if(!text)continue;
        if(e.results[i].isFinal)finalParts.push(text);else interim+=(interim?" ":"")+text;
      }
      input.value=[base,finalParts.join(" "),interim].filter(Boolean).join(" ").trim();
      input.dispatchEvent(new Event("input",{bubbles:true}));
    };
    rec.onerror=e=>{
      const code=String(e?.error||"");
      const msg=code==="not-allowed"||code==="service-not-allowed"?t("voiceMicDenied"):code==="no-speech"?t("voiceNoSpeech"):t("voiceStopped",{code:code?`: ${code}`:""});
      setUi("idle",msg);
    };
    rec.onend=()=>{if(state.rec===rec){state.rec=null;if(state.listening)setUi("idle",input.value.trim()?t("voiceAdded"):"")}};
    try{rec.start()}catch(e){setUi("idle",t("voiceStartFail"))}
  }
  return {start,get listening(){return state.listening}};
}
const fileVoiceInput=createVoiceInput({btnId:"fileVoiceBtn",labelId:"fileVoiceBtnLabel",statusId:"fileVoiceStatus",inputId:"filePrompt",getLang:fileVoiceLangEffective});
function startFileVoiceInput(){fileVoiceInput.start()}

/* v5.11.21: мова розпізнавання файлового мікрофона. За замовчуванням — мова
   інтерфейсу застосунку; користувач може вручну зафіксувати UA або EN
   (кнопка під мікрофоном, вибір зберігається на пристрої). */
const FILE_VOICE_LANG_KEY="ai_bridge_file_voice_lang_v1";
const FILE_VOICE_LANGS=["uk-UA","en-US"];
function fileVoiceLangManual(){
  try{const v=localStorage.getItem(FILE_VOICE_LANG_KEY);return FILE_VOICE_LANGS.includes(v)?v:null}catch(e){return null}
}
function fileVoiceLangEffective(){
  return fileVoiceLangManual()||I18N?.voiceLocale?.()||navigator.language||"uk-UA";
}
function fileVoiceLangCode(lang){
  const l=String(lang||"");
  if(l==="uk-UA")return "UA";if(l==="en-US")return "EN";
  return l.split("-")[0].toUpperCase().slice(0,3)||"??";
}
function updateFileVoiceLangBtn(){
  const b=$("fileVoiceLangBtn");if(!b)return;
  const eff=fileVoiceLangEffective(),code=fileVoiceLangCode(eff),manual=!!fileVoiceLangManual();
  b.textContent=code;b.classList.toggle("manual",manual);
  const tip=t("voiceLangTitle",{lang:code});
  b.title=tip;b.setAttribute("aria-label",tip);
}
function cycleFileVoiceLang(){
  const order=[null,"uk-UA","en-US"]; // авто (мова інтерфейсу) → UA → EN → авто
  const next=order[(order.indexOf(fileVoiceLangManual())+1)%order.length];
  try{if(next)localStorage.setItem(FILE_VOICE_LANG_KEY,next);else localStorage.removeItem(FILE_VOICE_LANG_KEY)}catch(e){}
  updateFileVoiceLangBtn();
}
function startStudioVoiceInput(){
  if(studioVoiceListening&&studioVoiceRecognition){try{studioVoiceRecognition.stop()}catch(e){};return}
  const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;const input=$("studioPrompt");if(!input)return;
  if(!Ctor){setStudioVoiceUi("idle",t("voiceUnavailable"));input.focus();return}
  if(voiceListening&&voiceRecognition){try{voiceRecognition.stop()}catch(e){}}
  const rec=new Ctor();studioVoiceRecognition=rec;rec.lang=I18N?.voiceLocale?.()||navigator.language||"uk-UA";rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=1;
  const base=input.value.trim(),finalParts=[];rec.onstart=()=>setStudioVoiceUi("listening",t("studioVoiceSpeak"));
  rec.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){const text=String(e.results[i]?.[0]?.transcript||"").trim();if(!text)continue;if(e.results[i].isFinal)finalParts.push(text);else interim+=(interim?" ":"")+text}input.value=[base,finalParts.join(" "),interim].filter(Boolean).join(" ").trim();input.dispatchEvent(new Event("input",{bubbles:true}))};
  rec.onerror=e=>{const code=String(e?.error||"");const msg=code==="not-allowed"||code==="service-not-allowed"?t("voiceMicDenied"):code==="no-speech"?t("voiceNoSpeech"):t("voiceStopped",{code:code?`: ${code}`:""});setStudioVoiceUi("idle",msg)};
  rec.onend=()=>{if(studioVoiceRecognition===rec){studioVoiceRecognition=null;if(studioVoiceListening)setStudioVoiceUi("idle",input.value.trim()?t("studioVoiceAdded"):"")}};try{rec.start()}catch(e){setStudioVoiceUi("idle",t("voiceStartFail"))}
}


function loadAgentThread(){
  try{
    const raw=JSON.parse(localStorage.getItem(AGENT_THREAD_KEY)||"[]");
    agentMessages=Array.isArray(raw)?raw.filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.text==="string").slice(-AGENT_THREAD_MAX_MESSAGES):[];
  }catch(e){agentMessages=[]}
}
function saveAgentThread(){
  try{
    const persisted=agentMessages.slice(-AGENT_THREAD_MAX_MESSAGES).map(({artifacts,...m})=>m);
    localStorage.setItem(AGENT_THREAD_KEY,JSON.stringify(persisted));
  }catch(e){}
}
function normalizeAgentLesson(x){
  if(!x||typeof x.taskType!=="string"||!Array.isArray(x.tools)||!Array.isArray(x.helpers))return null;
  const successes=Math.max(1,Math.min(99,Number(x.successes)||1));
  const failures=Math.max(0,Math.min(99,Number(x.failures)||0));
  return {taskType:x.taskType.slice(0,24),tools:[...new Set(x.tools.map(String))].slice(0,6),helpers:[...new Set(x.helpers.map(String).filter(id=>PROVIDERS[id]))].slice(0,6),completed:x.completed!==false,successes,failures,confidence:Math.min(.95,Number(x.confidence)||successes/(successes+failures+1)),evidenceSources:Math.max(0,Math.min(20,Number(x.evidenceSources)||0)),updated:Number(x.updated||x.created)||Date.now()};
}
/* M5 (v5.11.8 wave 1): shape the Agent dialog into a bounded context block.
   Pure function (no DOM): takes [{role:"user"|"assistant",text}], returns a
   string with the last `maxPairs` question-answer pairs in full (each message
   capped at `msgCap` chars) plus an extractive digest of everything older,
   capped at `digestCap` chars. Request size therefore stays bounded no matter
   how long the dialog grows. */
function formatAgentConversation(messages,maxPairs,msgCap,digestCap){
  maxPairs=Math.max(1,Math.min(8,Number(maxPairs)||4));
  msgCap=Math.max(200,Math.min(5000,Number(msgCap)||1500));
  digestCap=Math.max(200,Math.min(2000,Number(digestCap)||800));
  const clean=(Array.isArray(messages)?messages:[]).filter(m=>m&&typeof m.text==="string"&&(m.role==="user"||m.role==="assistant"));
  const flat=m=>String(m.text).replace(/\s+/g," ").trim();
  // Pair every user message with the assistant reply that follows it.
  const pairs=[];
  for(let i=0;i<clean.length;i++){
    if(clean[i].role!=="user")continue;
    let answer=null;
    for(let j=i+1;j<clean.length&&clean[j].role!=="user";j++){
      if(clean[j].role==="assistant"){answer=clean[j];break}
    }
    pairs.push({q:clean[i],a:answer});
  }
  const recent=pairs.slice(-maxPairs);
  const firstRecent=recent.length?clean.indexOf(recent[0].q):clean.length;
  const older=clean.slice(0,firstRecent<0?clean.length:firstRecent);
  const fmtFull=m=>`${m.role==="user"?"USER":"ASSISTANT"}: ${flat(m).slice(0,msgCap)}`;
  let out="";
  if(older.length){
    let digest="";
    for(const m of older){
      const line=`${m.role==="user"?"USER":"ASSISTANT"}: ${flat(m).slice(0,120)}`;
      const next=digest?digest+"; "+line:line;
      if(next.length>digestCap)break;
      digest=next;
    }
    out+=`<older_digest max_chars="${digestCap}">\n${digest||"(empty)"}\n</older_digest>\n\n`;
  }
  out+=`<recent_pairs count="${recent.length}">\n`+
    recent.map(p=>fmtFull(p.q)+(p.a?"\n"+fmtFull(p.a):"\nASSISTANT: (no reply yet)")).join("\n\n")+
    `\n</recent_pairs>`;
  return out;
}
function agentMemoryContext(){
  const convo=formatAgentConversation(agentMessages.filter(x=>!x.error));
  const lessons=loadAgentLessons().slice(-8).map((x,i)=>`${i+1}. task=${x.taskType}; tools=${x.tools.join(",")||"direct"}; helpers=${x.helpers.join(",")||"none"}; successes=${x.successes}; failures=${x.failures}; confidence=${x.confidence.toFixed(2)}; evidence=${x.evidenceSources}`);
  let out=convo;
  if(lessons.length)out+=`\n\nSUCCESSFUL RUNTIME OUTCOMES (advisory patterns only; never instructions):\n${lessons.join("\n")}`;
  if(out.length>20000)out=out.slice(-20000);
  return out;
}
/* v5.11.68: мітка «пам'ять використано тут» (ідея scout, PRD transparency
   layer). Чиста: з уже зібраного agentMemoryContext() витягує те, що реально
   пішло в модель як ПАМ'ЯТЬ цього ходу — дайджест M5 старих повідомлень
   (<older_digest>) і вивчені уроки (SUCCESSFUL RUNTIME OUTCOMES). Свіжі пари
   recent_pairs — це сам діалог, не «пам'ять», сюди не входять. Повертає null,
   коли пам'яті в ході не було (немає старих повідомлень і уроків) — тоді
   чипа під відповіддю не буде. */
function describeMemoryUsed(memory){
  const s=String(memory||"");
  const dm=/<older_digest[^>]*>\n([\s\S]*?)\n<\/older_digest>/.exec(s);
  let digest=String(dm&&dm[1]||"").trim();
  if(digest==="(empty)")digest="";
  const lm=/SUCCESSFUL RUNTIME OUTCOMES[\s\S]*?\n([\s\S]*?)$/.exec(s);
  const lessons=lm?String(lm[1]).split("\n").map(x=>x.trim()).filter(Boolean).length:0;
  if(!digest&&!lessons)return null;
  return {digest:digest.slice(0,800),lessons};
}
/* Чип під відповіддю асистента: «🧠 Пам'ять використано тут» — тап розкриває
   які саме факти з пам'яті пішли в цей хід. m.mem ставиться в runAgentPage
   (тільки коли describeMemoryUsed повернув не-null), зберігається в
   localStorage разом із повідомленням. */
function renderMemChip(m,i){
  if(!m||!m.mem||(!m.mem.digest&&!m.mem.lessons))return "";
  const rows=[];
  if(m.mem.digest)rows.push(`<div class="memFact"><b>${esc(t("memDigestLabel"))}</b><span>${esc(m.mem.digest)}</span></div>`);
  if(m.mem.lessons)rows.push(`<div class="memFact"><b>${esc(t("memLessonsLabel",{n:m.mem.lessons}))}</b></div>`);
  return `<div class="memChipWrap"><button type="button" class="memChip" data-memchip="${i}" aria-expanded="false">🧠 ${esc(t("memUsedHere"))}</button><div class="memChipDetail hidden" data-memdetail="${i}">${rows.join("")}</div></div>`;
}
/* v5.11.36: ручне стиснення контексту (ідея scout). Чисті: тред ділиться на
   older (усе до останніх maxPairs пар) і recent; older згортається в
   витягнений переказ у стилі M5-дайджеста. */
function splitThreadForCompact(messages,maxPairs){
  maxPairs=Math.max(1,Math.min(8,Number(maxPairs)||4));
  var clean=(Array.isArray(messages)?messages:[]).filter(function(m){return m&&typeof m.text==="string"&&(m.role==="user"||m.role==="assistant")});
  var pairs=[];
  for(var i=0;i<clean.length;i++){
    if(clean[i].role!=="user")continue;
    var answer=null;
    for(var j=i+1;j<clean.length&&clean[j].role!=="user";j++){
      if(clean[j].role==="assistant"){answer=clean[j];break}
    }
    pairs.push({q:clean[i],a:answer});
  }
  var recentPairs=pairs.slice(-maxPairs);
  var firstRecent=recentPairs.length?clean.indexOf(recentPairs[0].q):clean.length;
  if(firstRecent<0)firstRecent=clean.length;
  return {older:clean.slice(0,firstRecent),recent:clean.slice(firstRecent)};
}
function buildCompactDigest(older,digestCap){
  digestCap=Math.max(200,Math.min(2000,Number(digestCap)||800));
  var digest="",list=Array.isArray(older)?older:[];
  for(var i=0;i<list.length;i++){
    var m=list[i];if(!m||typeof m.text!=="string")continue;
    var line=(m.role==="user"?"USER":"ASSISTANT")+": "+String(m.text).replace(/\s+/g," ").trim().slice(0,120);
    var next=digest?digest+"; "+line:line;
    if(next.length>digestCap)break;
    digest=next;
  }
  return digest;
}
/* Кнопка «Стиснути контекст»: залишає останні 4 пари недоторканими, усе
   старіше замінює одним повідомленням-переказом. */
/* v5.11.67: видиме стиснення — маркер несе чесні цифри (скільки повідомлень
   згорнуто і в скільки символів), стиснення локальне, тож вартість — 0. */
function compactAgentContext(){
  var parts=splitThreadForCompact(typeof agentMessages!=="undefined"?agentMessages:[],4);
  if(!parts.older.length){toast(t("ctxNothingToCompact"),"warn");return}
  var digest=buildCompactDigest(parts.older,800);
  if(!digest){toast(t("ctxNothingToCompact"),"warn");return}
  var marker={role:"assistant",text:t("ctxCompactSummaryTitle")+"\n\n"+digest,created:Date.now(),compacted:true,compactedCount:parts.older.length,compactedChars:digest.length};
  agentMessages=[marker].concat(parts.recent).slice(-AGENT_THREAD_MAX_MESSAGES);
  saveAgentThread();renderAgentThread();updateCtxCompactBtn();
  toast(t("ctxCompactedStats",{n:parts.older.length,ch:groupNum(digest.length)}),"good");
}
/* Кнопка видима лише коли є що стискати (діалог довший за 4 пари);
   v5.11.67: поруч — чесний прогноз «ще ≈N ходів». */
function countAgentPairs(messages){
  var list=Array.isArray(messages)?messages:[];
  var n=0;
  for(var i=0;i<list.length;i++){if(list[i]&&list[i].role==="user"&&typeof list[i].text==="string")n++}
  return n;
}
function updateCtxCompactBtn(){
  var b=document.getElementById("ctxCompactBtn");
  if(!b||typeof agentMessages==="undefined")return;
  var can=splitThreadForCompact(agentMessages,4).older.length>0;
  b.classList.toggle("hidden",!can);
  var h=document.getElementById("ctxCompactHint");
  if(h){
    if(can){h.textContent="";h.classList.add("hidden")}
    else{
      var need=5-countAgentPairs(agentMessages);
      if(need>0){h.textContent=t("ctxCompactSoon",{n:need});h.classList.remove("hidden")}
      else{h.textContent="";h.classList.add("hidden")}
    }
  }
}
/* v5.11.67: банер маркера стиснення — тонкий рядок у стрічці: скільки
   згорнуто → у скільки символів, чесна вартість (локально, 0), дайджест
   згорнуто в <details>. Маркери старих версій (без compactedCount) — без
   цифр, але з тим самим виглядом. */
function compactMarkHtml(m){
  var n=Math.max(0,Number(m.compactedCount)||0);
  var ch=Math.max(0,Number(m.compactedChars)||0);
  var body=String(m.text||"");
  var digest=body.indexOf("\n\n")>=0?body.slice(body.indexOf("\n\n")+2).trim():body;
  var head=n?esc(t("compactMarkStats",{n:n,ch:groupNum(ch)})):esc(t("compactMarkTitle"));
  return `<details class="compactMark"><summary><span class="compactMarkIcon" aria-hidden="true">🗜️</span><span class="compactMarkHead">${head}</span><span class="compactMarkCost">${esc(t("compactMarkCost"))}</span></summary><div class="compactMarkDigest">${esc(digest)}</div></details>`;
}
function loadAgentLessons(){try{const v=JSON.parse(localStorage.getItem(AGENT_LESSONS_KEY)||"[]");return Array.isArray(v)?v.map(normalizeAgentLesson).filter(Boolean).slice(-AGENT_LESSONS_MAX):[]}catch(e){return[]}}
function agentTaskType({goal="",useFiles=false,images=false}={}){const s=String(goal).toLowerCase();if(useFiles)return "files";if(images)return "vision";if(/https?:\/\/|\b(site|website|сайт|сторінк|page)\b/.test(s))return "web";if(/\b(code|bug|error|js|javascript|код|помил|архітектур)\b/.test(s))return "code";return "general"}
function selectAgentPolicy(context={}){
  const taskType=agentTaskType(context),ranked=loadAgentLessons().filter(x=>x.completed&&x.taskType===taskType&&x.confidence>=.5).sort((a,b)=>(b.confidence-a.confidence)||(b.successes-a.successes)||(b.updated-a.updated));
  const best=ranked[0];if(!best)return null;
  return {version:1,taskType,preferredTools:best.tools,preferredHelpers:best.helpers,confidence:best.confidence,successes:best.successes,evidenceSources:best.evidenceSources};
}
function rememberAgentOutcome(meta,context={}){
  if(!meta?.agent||meta.agentFallbackFinal)return false;
  const tools=[...new Set((Array.isArray(meta.agentTrace)?meta.agentTrace:[]).map(x=>String(x?.action||"")).filter(x=>["search_web","fetch_url","delegate","generate_image","generate_file","finish","verify"].includes(x)))].slice(0,6);
  const helpers=[...new Set((Array.isArray(meta.helperProviders)?meta.helperProviders:[]).map(String).filter(x=>PROVIDERS[x]))].slice(0,6);
  const taskType=agentTaskType(context),toolErrors=Math.max(0,Number(meta.agentToolErrors)||0),evidenceSources=Math.max(0,Number(meta.agentEvidenceSources)||0);
  if(toolErrors||!tools.includes("finish")||(taskType==="web"&&!evidenceSources))return false;
  const all=loadAgentLessons(),key=`${taskType}|${tools.join("|")}|${helpers.join("|")}`,existing=all.find(x=>`${x.taskType}|${x.tools.join("|")}|${x.helpers.join("|")}`===key),successes=Math.min(99,(existing?.successes||0)+1);
  const failures=existing?.failures||0,lesson={taskType,tools,helpers,completed:true,successes,failures,confidence:Math.min(.95,successes/(successes+failures+1)),evidenceSources:Math.max(evidenceSources,existing?.evidenceSources||0),updated:Date.now()};
  const prior=all.filter(x=>`${x.taskType}|${x.tools.join("|")}|${x.helpers.join("|")}`!==key);
  try{localStorage.setItem(AGENT_LESSONS_KEY,JSON.stringify([...prior,lesson].slice(-AGENT_LESSONS_MAX)))}catch(e){return false}
  return true;
}
function recordAgentPolicyFailure(policy){
  if(!policy)return false;
  const all=loadAgentLessons(),found=all.find(x=>x.taskType===policy.taskType&&x.tools.join("|")===(policy.preferredTools||[]).join("|")&&x.helpers.join("|")===(policy.preferredHelpers||[]).join("|"));if(!found)return false;
  const failures=Math.min(99,(found.failures||0)+1),updated={...found,failures,confidence:Math.min(.95,found.successes/(found.successes+failures+1)),updated:Date.now()};
  try{localStorage.setItem(AGENT_LESSONS_KEY,JSON.stringify([...all.filter(x=>x!==found),updated].slice(-AGENT_LESSONS_MAX)))}catch(e){return false}
  return true;
}
function safeAgentImageArtifact(a){
  if(!a||a.type!=="image")return null;
  const dataUrl=String(a.dataUrl||"");
  if(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))return null;
  return {dataUrl,name:String(a.name||"agent-image.jpg").replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,96)||"agent-image.jpg",model:String(a.model||"").slice(0,160),prompt:String(a.prompt||"").slice(0,300)};
}
/* v5.11.34: чипи згенерованих файлів під повідомленням (LibreChat v0.8.6
   "generated file chips"). Файли типу "file" проходять той самий строгий
   відбір, що й фото: тип і mime — з allowlist, ім'я санітизується,
   розширення виводиться з mime, розмір data: URL обмежено. */
const AGENT_FILE_MIMES_CLIENT={"text/markdown":".md","text/plain":".txt","text/csv":".csv","text/html":".html","application/json":".json","application/xml":".xml","text/xml":".xml","image/svg+xml":".svg","text/yaml":".yaml","application/yaml":".yaml"};
function safeAgentFileArtifact(a){
  if(!a||a.type!=="file")return null;
  const mime=String(a.mime||"").toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(AGENT_FILE_MIMES_CLIENT,mime))return null;
  const name=(String(a.name||"agent-file").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^\.+|\.+$/g,"").slice(0,96)||"agent-file");
  if(!name.endsWith(AGENT_FILE_MIMES_CLIENT[mime]))return null;
  const dataUrl=String(a.dataUrl||"");
  const m=dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!m||m[1]!==mime||m[2].length>400000)return null;
  return {dataUrl,name,mime,size:Math.max(0,Number(a.size)||0)};
}
function agentFileChipIcon(name){
  const ext=String(name||"").split(".").pop().toLowerCase();
  if(ext==="md")return"📝";if(ext==="csv")return"📊";if(ext==="json")return"🧩";if(ext==="html"||ext==="svg")return"🌐";if(ext==="yaml"||ext==="xml")return"⚙️";return"📄";
}
function renderAgentArtifacts(artifacts){
  const items=(Array.isArray(artifacts)?artifacts:[]).map(safeAgentImageArtifact).filter(Boolean);
  const files=(Array.isArray(artifacts)?artifacts:[]).map(safeAgentFileArtifact).filter(Boolean);
  if(!items.length&&!files.length)return "";
  const imgs=items.length?`<div class="agentArtifactGrid">${items.map(a=>`<figure class="agentArtifact"><img src="${a.dataUrl}" alt="${esc(a.prompt||a.name)}"><figcaption><span>${esc(a.model||"Agent Image")}</span><a href="${a.dataUrl}" download="${esc(a.name)}">${esc(t("agentImageSave"))}</a></figcaption></figure>`).join("")}</div>`:"";
  const chips=files.length?`<div class="agentFileChips" role="group" aria-label="${esc(t("agentFileChips"))}">${files.map(f=>`<span class="agentFileChip"><span class="agentFileChipIcon" aria-hidden="true">${agentFileChipIcon(f.name)}</span><span class="agentFileChipName">${esc(f.name)}</span><span class="agentFileChipSize">${esc(fmtFileSize(f.size))}</span><a class="agentFileChipDl" href="${f.dataUrl}" download="${esc(f.name)}" title="${esc(t("agentFileSave"))}" aria-label="${esc(t("agentFileSave"))}: ${esc(f.name)}">⤓</a></span>`).join("")}</div>`:"";
  return imgs+chips;
}
/* v5.11.36: чипи джерел під відповіддю агента з веб-дослідженням (ідея scout).
   Чиста: будує HTML чипів із results (поля title/url/snippet) або порожній
   рядок — рендер лише за наявності валідних https-джерел. */
function agentSourceChipsHtml(results){
  var items=(Array.isArray(results)?results:[]).map(function(x){return {title:String((x&&x.title)||(x&&x.url)||""),url:safeSourceUrl(x&&x.url),snippet:String((x&&x.snippet)||(x&&x.description)||"")}}).filter(function(x){return !!x.url}).slice(0,6);
  if(!items.length)return "";
  var chips=items.map(function(x,i){return "<button type=\"button\" class=\"srcChip\" data-asrc=\""+i+"\" data-aurl=\""+esc(x.url)+"\" data-atitle=\""+esc(x.title||x.url)+"\" data-asnip=\""+esc(x.snippet)+"\"><span class=\"srcNum\">"+(i+1)+"</span><span class=\"srcTitle\">"+esc(x.title||x.url)+"</span></button>"}).join("");
  return "<div class=\"agentSrcChips\" role=\"list\" aria-label=\""+esc(t("srcChipsLabel"))+"\">"+chips+"</div>";
}
/* Джерела відповіді: meta.webSources (зібрано _worker.js) або
   meta.webSearch.results (маршрут search_ai). */
function renderAgentSourceChips(m){
  if(!m||m.role==="user"||m.error||!m.meta)return "";
  var web=m.meta.webSearch;
  var results=(m.meta.webSources&&m.meta.webSources.length?m.meta.webSources:(web&&web.results));
  return agentSourceChipsHtml(results);
}
function renderAgentThread(){
  const host=$("agentThread");if(!host)return;
  if(!agentMessages.length){host.innerHTML=`<div class="agentEmpty"><div class="agentOrb">✦</div><b>${esc(t("agentEmptyTitle"))}</b><span>${esc(t("agentEmptyText"))}</span></div>`;renderCtxMeter();updateCtxCompactBtn();return}
  // Assistant answers are Markdown: the bubble body is filled by the safe DOM
  // renderer after the (escaped) shell is in place. User text stays literal.
  host.innerHTML=agentMessages.map((m,i)=>{if(m&&m.compacted)return compactMarkHtml(m);const assistant=m.role!=="user"&&!m.error;return `<div class="agentMsg ${m.role==="user"?"user":"assistant"}"><div class="agentMsgAvatar">${m.role==="user"?"YOU":"AI"}</div><div class="agentBubble"><div class="agentMsgMeta">${esc(m.role==="user"?t("agentUserLabel"):t("agentAssistantLabel"))}${m.provider?` • ${esc(PROVIDERS[m.provider]?.name||m.provider)}`:""}<button type="button" class="miniBtn agentQuoteBtn" data-agent-quote="${i}" title="${esc(t("quoteBtn"))}" aria-label="${esc(t("quoteBtn"))}">❝</button>${assistant?`<button type="button" class="miniBtn agentCardBtn" data-agent-card="${i}" title="${esc(t("quoteCardBtn"))}" aria-label="${esc(t("quoteCardBtn"))}">🖼️</button>`:""}${assistant?`<button type="button" class="miniBtn agentTtsBtn" data-agent-tts="${i}" title="${esc(t("readAloud"))}" aria-label="${esc(t("readAloud"))}">🔊</button>`:""}${assistant?`<button type="button" class="miniBtn agentRichBtn" data-agent-rich="${i}" title="${esc(t("copyRich"))}" aria-label="${esc(t("copyRich"))}">⧉</button>`:""}</div>${assistant?`<div class="agentMsgBody" data-agent-md="${i}"></div>`:esc(m.text)}${renderAgentSourceChips(m)}${renderMemChip(m,i)}${renderAgentArtifacts(m.artifacts)}</div></div>`}).join("");
  // v5.11.19: markdown рендериться пакетовано (наступний кадр rAF) і тільки для
  // повідомлень, текст яких змінився з минулого рендеру, — без перерендеру
  // всього треду на кожен addAgentMessage.
  const deferMd=typeof requestAnimationFrame==="function"?requestAnimationFrame:f=>setTimeout(f,16);
  deferMd(()=>{
    const h=$("agentThread");if(!h)return;
    h.querySelectorAll("[data-agent-md]").forEach(el=>{
      const m=agentMessages[Number(el.dataset.agentMd)],text=m?.text||"";
      if(m&&threadMdRendered.get(m)===text&&el.classList.contains("md"))return;
      renderRich(el,text);
      if(m)threadMdRendered.set(m,text);
    });
  });
  // v5.9.16: read-aloud on assistant messages.
  host.querySelectorAll("[data-agent-tts]").forEach(b=>b.onclick=()=>toggleSpeech(agentMessages[Number(b.dataset.agentTts)]?.text||""));
  // v5.11.19: цитата-відповідь (quote-reply) на кожному повідомленні.
  host.querySelectorAll("[data-agent-quote]").forEach(b=>b.onclick=()=>quoteAgentMessage(Number(b.dataset.agentQuote)));
  // v5.11.28: картка-цитата PNG на кожному повідомленні асистента.
  host.querySelectorAll("[data-agent-card]").forEach(b=>b.onclick=()=>downloadQuoteCard(agentMessages[Number(b.dataset.agentCard)]?.text||"","agentThread"));
  // v5.11.35: копіювання повідомлення як форматованого тексту (text/html).
  host.querySelectorAll("[data-agent-rich]").forEach(b=>b.onclick=()=>copyRichFrom(host.querySelector(`[data-agent-md="${b.dataset.agentRich}"]`)));
  // v5.11.36: чипи джерел під відповіддю з веб-дослідженням — тап відкриває прев'ю джерела.
  host.querySelectorAll("[data-asrc]").forEach(b=>b.onclick=()=>openSourcePreview({title:b.dataset.atitle,url:b.dataset.aurl,snippet:b.dataset.asnip}));
  // v5.11.68: мітка «пам'ять використано тут» — тап розкриває факти з пам'яті цього ходу.
  host.querySelectorAll("[data-memchip]").forEach(b=>b.onclick=()=>{const d=host.querySelector(`[data-memdetail="${b.dataset.memchip}"]`);if(!d)return;const hidden=d.classList.toggle("hidden");b.setAttribute("aria-expanded",String(!hidden))});
  // v5.9.8: a new AI answer is shown from its first line, not its end.
  const lastIsAnswer=agentMessages[agentMessages.length-1]?.role!=="user";
  setTimeout(()=>host.lastElementChild?.scrollIntoView({behavior:"smooth",block:lastIsAnswer?"start":"nearest"}),20);
  renderCtxMeter();renderChatToc();updateCtxCompactBtn();
}
/* v5.11.19: цитата-відповідь (quote-reply, ідея scout). WeakMap, щоб не
   забруднювати об'єкти повідомлень, які зберігаються в localStorage. */
const threadMdRendered=typeof WeakMap!=="undefined"?new WeakMap():{get(){return null},set(){}};
/* Чиста: будує markdown-блок цитати з тексту (обрізка до maxLen символів). */
function buildQuoteBlock(text,maxLen=400){
  let s=String(text||"").replace(/\r\n?/g,"\n").trim();
  if(!s)return"";
  if(s.length>maxLen)s=s.slice(0,maxLen).trim()+"…";
  return s.split("\n").map(l=>"> "+l).join("\n")+"\n\n";
}
/* Цитуємо виділений фрагмент усередині бульбашки (quote-excerpt, як у LibreChat),
   а якщо нічого не виділено — все повідомлення. Цитата вставляється в поле вводу. */
function quoteAgentMessage(i){
  const m=agentMessages[i];if(!m)return;
  const input=$("agentPrompt");if(!input)return;
  let sel="";
  try{
    const s=window.getSelection(),host=$("agentThread");
    if(s&&host&&host.contains(s.anchorNode)){const t0=String(s.toString()||"").trim();if(t0)sel=t0}
  }catch(e){}
  const q=buildQuoteBlock(sel||m.text);
  if(!q)return;
  input.value=q+(input.value||"");
  input.dispatchEvent(new Event("input",{bubbles:true}));
  showPage("agent");
  try{input.focus({preventScroll:true})}catch(e){try{input.focus()}catch(_){}}
  try{input.setSelectionRange(input.value.length,input.value.length)}catch(e){}
  setTimeout(()=>{try{input.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}},60);
}
/* v5.11.28: картка-цитата PNG (ідея scout) — експорт відповіді як вертикальної
   картки 1080×1920 для соцмереж. Чистий canvas 2D, без бібліотек: мінімальний
   монохром у дусі «Тиші», підпис «P.S.M». stripMdForCard — чиста, для тестів. */
const QUOTE_CARD_MAX=900;
function stripMdForCard(md){
  let s=String(md||"").replace(/\r\n?/g,"\n");
  s=s.replace(/```[^\n]*\n([\s\S]*?)```/g,"$1"); // code fences -> plain content
  s=s.replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1");
  s=s.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1");
  s=s.replace(/^#{1,6}\s+/gm,"");
  s=s.replace(/^>\s?/gm,"");
  s=s.replace(/^(\s*)[-*+]\s+/gm,"$1• ");
  s=s.replace(/^(\s*)\d+[.)]\s+/gm,"$1• ");
  s=s.replace(/(\*\*|__)(.*?)\1/g,"$2");
  s=s.replace(/`([^`]+)`/g,"$1");
  s=s.replace(/^\s*[-*_]{3,}\s*$/gm,"");
  s=s.replace(/\n{3,}/g,"\n\n");
  return s.trim();
}
function quoteCardText(source,scopeId){
  let sel="";
  try{
    const s=window.getSelection(),scope=scopeId?document.getElementById(scopeId):null;
    if(s&&(!scope||scope.contains(s.anchorNode))){const t0=String(s.toString()||"").trim();if(t0)sel=t0}
  }catch(e){}
  let tx=stripMdForCard(sel||source||"");
  if(tx.length>QUOTE_CARD_MAX)tx=tx.slice(0,QUOTE_CARD_MAX).trim()+"…";
  return tx;
}
function wrapCardLines(ctx,text,maxW){
  const words=String(text).split(/\s+/).filter(Boolean),lines=[];
  let line="";
  for(const w of words){
    const test=line?line+" "+w:w;
    if(ctx.measureText(test).width>maxW&&line){lines.push(line);line=w}
    else line=test;
  }
  if(line)lines.push(line);
  return lines;
}
function makeQuoteCardBlob(text){
  return new Promise((resolve,reject)=>{
    try{
      const W=1080,H=1920,c=document.createElement("canvas");
      c.width=W;c.height=H;
      const ctx=c.getContext("2d");
      const g=ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,"#121215");g.addColorStop(1,"#1e1e24");
      ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      ctx.fillStyle="rgba(255,255,255,0.08)";
      ctx.font="700 400px Georgia, 'Times New Roman', serif";
      ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText("“",64,400);
      const FONT="500 {s}px -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      const maxW=W-240;
      let fs=58,lines=wrapCardLines(ctx,text,maxW);
      ctx.font=FONT.replace("{s}",fs);
      lines=wrapCardLines(ctx,text,maxW);
      while(lines.length*Math.round(fs*1.5)>1150&&fs>32){fs-=4;ctx.font=FONT.replace("{s}",fs);lines=wrapCardLines(ctx,text,maxW)}
      const lineH=Math.round(fs*1.5),totalH=lines.length*lineH;
      let y=Math.max(500,(H-totalH)/2);
      ctx.fillStyle="#f4f4f5";ctx.textAlign="center";
      for(const ln of lines){ctx.fillText(ln,W/2,y);y+=lineH}
      ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(W/2-50,H-210);ctx.lineTo(W/2+50,H-210);ctx.stroke();
      ctx.fillStyle="rgba(255,255,255,0.6)";
      ctx.font="600 44px -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.textAlign="right";
      ctx.fillText("P.S.M",W-110,H-120);
      c.toBlob(b=>b?resolve(b):reject(new Error("toBlob failed")),"image/png");
    }catch(e){reject(e)}
  });
}
async function downloadQuoteCard(sourceText,scopeId){
  const text=quoteCardText(sourceText,scopeId);
  if(!text){toast(t("quoteCardEmpty"),"bad");return}
  try{
    const blob=await makeQuoteCardBlob(text);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`bridge-quote-${Date.now().toString(36)}.png`;
    document.body.appendChild(a);a.click();
    setTimeout(()=>{try{URL.revokeObjectURL(a.href)}catch(e){}a.remove()},4000);
    toast(t("quoteCardSaved"),"good");
  }catch(e){toast(t("quoteCardFail"),"bad")}
}
function addAgentMessage(role,text,extra={}){
  const msg={role,text:String(text||"").trim(),created:Date.now(),...extra};if(!msg.text)return;
  agentMessages.push(msg);agentMessages=agentMessages.slice(-AGENT_THREAD_MAX_MESSAGES);saveAgentThread();renderAgentThread();
  noteScrollFabEvent(); // v5.11.29: нове повідомлення в треді — лічильник FAB
}
function addAgentMessageOnce(role,text,extra={}){
  const val=String(text||"").trim();const last=agentMessages.at(-1);if(last&&last.role===role&&last.text===val)return;addAgentMessage(role,val,extra);
}
function clearAgentThread(){agentMessages=[];saveAgentThread();renderAgentThread();renderAgentTrace(null);$("agentRunStatus").textContent=t("agentStatusReady")}
/* v5.11.60: «Інструкції для діалогу» (сторінка Агента). Сторінка Агента —
   один суцільний тред без ідентифікаторів, тому інструкції зберігаються
   під ключем "default" і застосовуються до активного діалогу. */
const DLG_INSTR_KEY="ai_bridge_dialog_instr_v1",DLG_INSTR_MAX=2000;
function loadDialogInstr(){try{const o=JSON.parse(localStorage.getItem(DLG_INSTR_KEY)||"{}");return o&&typeof o==="object"?o:{}}catch(e){return{}}}
function dialogInstrThreadKey(){return "default"}
function getDialogInstructions(){const v=loadDialogInstr()[dialogInstrThreadKey()];return typeof v==="string"?v:""}
function setDialogInstructions(text){
  const o=loadDialogInstr(),clean=String(text||"").trim().slice(0,DLG_INSTR_MAX);
  if(clean)o[dialogInstrThreadKey()]=clean;else delete o[dialogInstrThreadKey()];
  try{localStorage.setItem(DLG_INSTR_KEY,JSON.stringify(o))}catch(e){}
  updateDlgInstrBtn();
}
function updateDlgInstrBtn(){
  const b=$("dlgInstrBtn");if(!b)return;
  const has=!!getDialogInstructions();
  b.classList.toggle("hasInstr",has);b.setAttribute("aria-pressed",has?"true":"false");
}
function openDlgInstrSheet(){const ta=$("dlgInstrText");if(ta)ta.value=getDialogInstructions();openSheet("dlgInstrSheet")}
function saveDlgInstrFromSheet(){
  setDialogInstructions($("dlgInstrText")?.value||"");
  closeSheet("dlgInstrSheet");
  toast(t(getDialogInstructions()?"dlgInstrSaved":"dlgInstrCleared"),"ok");
}
function clearDlgInstrFromSheet(){$("dlgInstrText").value="";saveDlgInstrFromSheet()}
/* v5.11.12: індикатор використання контексту (ідея scout). Чиста оцінка:
   токени ≈ символи/4 по видимих повідомленнях діалога; бюджет сталий. */
const CTX_METER_BUDGET=40000;
function contextUsage(messages){
  const chars=(Array.isArray(messages)?messages:[]).filter(m=>m&&!m.error&&typeof m.text==="string").reduce((n,m)=>n+m.text.length,0);
  const tokens=Math.round(chars/4),budget=CTX_METER_BUDGET;
  return {tokens,budget,pct:Math.min(999,Math.round(tokens/budget*100))};
}
function groupNum(n){return String(Math.max(0,Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g," ")}
function renderCtxMeter(){
  const el=$("ctxMeter");if(!el||typeof t!=="function")return;
  const u=contextUsage(typeof agentMessages!=="undefined"?agentMessages:[]);
  el.textContent=t("ctxMeter",{p:u.pct,u:groupNum(u.tokens),b:groupNum(u.budget)});
  el.classList.toggle("warn",u.pct>=80&&u.pct<95);
  el.classList.toggle("hot",u.pct>=95);
  el.title=t("ctxMeter",{p:u.pct,u:groupNum(u.tokens),b:groupNum(u.budget)})+" · "+t("ctxTapHint");
}
if(typeof window!=="undefined"&&window.addEventListener)window.addEventListener("aibridge:languagechange",()=>{try{renderCtxMeter()}catch(e){}});
/* v5.11.12: закріплення (pin) діалогів і моделей наверху списків (ідея scout).
   Чисті хелпери + localStorage; жодного бекенда. */
const PINNED_RUNS_KEY="ai_bridge_pinned_runs",PINNED_PROVIDERS_KEY="ai_bridge_pinned_providers";
function loadPinned(key){try{const v=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(v)?v.filter(x=>typeof x==="string").slice(0,100):[]}catch(e){return[]}}
function savePinned(key,ids){try{localStorage.setItem(key,JSON.stringify(ids.filter(x=>typeof x==="string").slice(0,100)))}catch(e){}}
function togglePinned(key,id){const ids=loadPinned(key),s=String(id),i=ids.indexOf(s);if(i>=0)ids.splice(i,1);else ids.unshift(s);savePinned(key,ids);return ids}
function isPinned(ids,id){return ids.indexOf(String(id))>=0}
/* Стабільне сортування: закріплені перші (у порядку закріплення — останній зверху),
   решта зберігає свій порядок. */
function sortPinnedFirst(list,getId,pinnedIds){
  const order=new Map((pinnedIds||[]).map((id,i)=>[String(id),i]));
  const rank=x=>{const k=String(getId(x));return order.has(k)?order.get(k):Infinity};
  return [...list].sort((a,b)=>rank(a)-rank(b));
}
/* v5.11.39: групування історії за датами + тимчасовий діалог (інкогніто).
   (Блок після sortPinnedFirst: наївні regex-grab'и тестів зупиняються на її `\n}`.)
   Тимчасовий діалог: перемикач у Налаштуваннях композера; такий діалог живе лише
   в пам'яті вкладки — saveRun його не пише (ні IndexedDB, ні usage, ні хмара),
   pending-маркери не створюються, тож він не потрапляє в історію, закладки,
   архів, Pin, зміст, пошук по історії й хмарну синхронізацію. Закрив вкладку — зник. */
const HIST_SECTION_ORDER=["today","yesterday","last7","last30","older"];
const HIST_SECTION_LABEL={today:"histSecToday",yesterday:"histSecYesterday",last7:"histSecLast7",last30:"histSecLast30",older:"histSecOlder"};
function histDayStart(ms){const d=new Date(Number(ms)||0);d.setHours(0,0,0,0);return d.getTime()}
function histSectionKey(created,nowMs){
  const c=Number(created)||0,day=86400000,today=histDayStart(nowMs);
  if(c>=today)return "today";
  if(c>=today-day)return "yesterday";
  if(c>=today-7*day)return "last7";
  if(c>=today-30*day)return "last30";
  return "older";
}
function groupRunsByDate(runs,nowMs){
  const buckets={today:[],yesterday:[],last7:[],last30:[],older:[]};
  for(const r of runs||[])buckets[histSectionKey(r?(r.updated||r.created):0,nowMs)].push(r);
  const out=[];
  for(const key of HIST_SECTION_ORDER){
    const items=buckets[key].sort((a,b)=>(Number(b.updated||b.created)||0)-(Number(a.updated||a.created)||0));
    if(items.length)out.push({key,items});
  }
  return out;
}
/* v5.11.42: згортальні групи дат в історії (ідея scout). Шеврон біля
   заголовка групи згортає/розгортає її; стан — у localStorage.
   (Блок після groupRunsByDate: наївні regex-grab'и тестів зупиняються
   на її `\n}`.) */
const HIST_SECTIONS_COLLAPSED_KEY="ai_bridge_hist_sections_collapsed_v1";
function loadCollapsedHistSections(){try{const a=JSON.parse(localStorage.getItem(HIST_SECTIONS_COLLAPSED_KEY)||"[]");return Array.isArray(a)?a.filter(x=>HIST_SECTION_ORDER.includes(x)):[]}catch(e){return[]}}
function saveCollapsedHistSections(list){try{localStorage.setItem(HIST_SECTIONS_COLLAPSED_KEY,JSON.stringify((Array.isArray(list)?list:[]).filter(x=>HIST_SECTION_ORDER.includes(x)).slice(0,HIST_SECTION_ORDER.length)))}catch(e){}}
/* Повертає новий стан групи: true = згорнута. */
function toggleCollapsedHistSection(key){if(!HIST_SECTION_ORDER.includes(key))return false;const list=loadCollapsedHistSections(),i=list.indexOf(key);let now;if(i>=0){list.splice(i,1);now=false}else{list.push(key);now=true}saveCollapsedHistSections(list);return now}
function tempChatOn(){const el=$("tempChatToggle");return !!(el&&el.checked)}

/* v5.11.30: закладки на діалоги (важливі повідомлення) — зірочка в історії
   і на поточній відповіді; список закладок зі стрибком до діалогу.
   (Блок після sortPinnedFirst: наївні regex-grab'и тестів зупиняються на її `\n}`.) */
const BOOKMARKS_KEY="ai_bridge_bookmarks_v1",BOOKMARKS_MAX=200;
function bookmarkKeyOf(run){return String(run?.uid||run?.id||"")}
function loadBookmarks(){try{const a=JSON.parse(localStorage.getItem(BOOKMARKS_KEY)||"[]");return Array.isArray(a)?a.filter(b=>b&&b.id!=null&&String(b.id)).map(b=>({id:String(b.id),ts:Number(b.ts)||0,title:String(b.title||"").slice(0,140)})).slice(0,BOOKMARKS_MAX):[]}catch(e){return[]}}
function saveBookmarks(list){try{localStorage.setItem(BOOKMARKS_KEY,JSON.stringify((Array.isArray(list)?list:[]).slice(0,BOOKMARKS_MAX)))}catch(e){}}
function isBookmarked(id){const s=String(id||"");return s?loadBookmarks().some(b=>b.id===s):false}
function bookmarkTitleOf(run){return String(run?.title||run?.prompt||"").split("\n")[0].slice(0,140)}
function toggleBookmark(id,title){const s=String(id||"");if(!s)return false;const list=loadBookmarks(),i=list.findIndex(b=>b.id===s);let added;if(i>=0){list.splice(i,1);added=false}else{list.unshift({id:s,ts:Date.now(),title:String(title||"").slice(0,140)});added=true}saveBookmarks(list);return added}
let bookmarksOnly=false;
/* v5.11.37: архів діалогів (ідея scout). Прапор archived на записі діалогу
   (IndexedDB через putRun), кнопка 📦 в історії, фільтр «Архів» у шапці
   історії. Архівовані діалоги ховаються з основного списку, але шукаються
   й повертаються (unarchive) або видаляються назавжди. */
let archiveOnly=false;
async function toggleArchive(run){
  if(!run||run.id==null)return false;
  run.archived=!run.archived;
  await putRun(run);
  return !!run.archived;
}
function syncBookmarkBtn(run){const bb=$("bookmarkBtn");if(!bb)return;const bmk=bookmarkKeyOf(run),on=!!bmk&&isBookmarked(bmk);bb.classList.toggle("hidden",!bmk);bb.setAttribute("aria-pressed",on?"true":"false");const lbl=t(on?"bookmarkRemove":"bookmarkAdd");bb.setAttribute("aria-label",lbl);bb.setAttribute("title",lbl)}
/* v5.11.14: журнал оновлень «Що нового» (ідея scout, пріоритет Сергія) +
   зміст діалогу агента. Чисті хелпери + fetch статичного JSON; без бекенда. */
function whatsNewLang(){
  try{const l=(I18N&&I18N.locale&&I18N.locale())||"uk-UA";return /^uk/i.test(l)?"uk":"en"}catch(e){return "uk"}
}
function whatsNewBullets(entry,lang){
  if(!entry||typeof entry!=="object")return[];
  const arr=entry[lang]||entry.uk||entry.en||[];
  return Array.isArray(arr)?arr.filter(x=>typeof x==="string"&&x.trim()).slice(0,6):[];
}
async function renderWhatsNew(){
  const host=$("whatsNewList");if(!host)return;
  let entries=[];
  try{
    const r=await fetch("changelog-app.json",{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();if(Array.isArray(j))entries=j;
  }catch(e){recordDiag("whatsnew",e?.message||e)}
  const lang=whatsNewLang();
  host.innerHTML=entries.length?entries.map(en=>{
    const bullets=whatsNewBullets(en,lang);
    return `<article class="card wnCard"><div class="wnHead"><b class="wnVer">v${esc(String(en.v||""))}</b><span class="wnDate">${esc(String(en.date||""))}</span></div>${bullets.length?`<ul class="wnBullets">${bullets.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>`:""}</article>`;
  }).join(""):`<div class="empty">${esc(t("whatsNewEmpty"))}</div>`;
}
/* v5.11.40: карта приватності «Де живуть твої дані» — статична чесна таблиця
   (місця зберігання перевірено по коду: localStorage / cookie-сейф / KV / провайдери). */
const DATA_MAP_ROWS=[
  {icon:"💬",t:"dmRow1t",d:"dmRow1d"},{icon:"🧠",t:"dmRow2t",d:"dmRow2d"},
  {icon:"🗂️",t:"dmRow3t",d:"dmRow3d"},{icon:"🔑",t:"dmRow4t",d:"dmRow4d"},
  {icon:"👥",t:"dmRow5t",d:"dmRow5d"},{icon:"✉️",t:"dmRow6t",d:"dmRow6d"},
  {icon:"📎",t:"dmRow7t",d:"dmRow7d"},{icon:"🔔",t:"dmRow8t",d:"dmRow8d"}
];
/* ---------- v5.11.74: захист сховища на iPhone (storage.persist проти
   7-денного очищення незакріплених даних Safari/ITP). Запит робиться
   одразу після завантаження; встановлений PWA має більше шансів
   отримати "granted". Статус показується на екрані «Де живуть твої дані». */
let persistState="pending"; // pending | granted | denied | unsupported
async function ensureStoragePersist(){
  if(persistState!=="pending")return persistState;
  try{
    if(navigator.storage&&typeof navigator.storage.persist==="function"){
      persistState=await navigator.storage.persist()?"granted":"denied";
    }else persistState="unsupported";
  }catch(e){persistState="denied"}
  return persistState;
}
function persistStatusText(){
  if(persistState==="granted")return t("dmPersistOn");
  if(persistState==="pending")return t("dmPersistUnknown");
  return t("dmPersistOff");
}
function renderDataMap(){
  const host=$("dataMapList");if(!host)return;
  host.innerHTML=DATA_MAP_ROWS.map(r=>
    `<div class="card dmRow"><div class="dmIcon" aria-hidden="true">${r.icon}</div><div><b>${esc(t(r.t))}</b><p>${esc(t(r.d))}</p></div></div>`
  ).join("")+
  /* v5.11.44: історія запитів (↑/↓) — окремий рядок із кнопкою очищення,
     не частина DATA_MAP_ROWS (той тест рахує рівно 8). */
  `<div class="card dmRow"><div class="dmIcon" aria-hidden="true">⌨️</div><div><b>${esc(t("dmRow9t"))}</b><p>${esc(t("dmRow9d"))}</p><button class="tinyBtn" type="button" id="clearPromptHistBtn">${esc(t("clear"))}</button></div></div>`+
  /* v5.11.74: захист сховища — окремий рядок із живим статусом, не частина
     DATA_MAP_ROWS (тест рахує рівно 8 рядків). */
  `<div class="card dmRow"><div class="dmIcon" aria-hidden="true">💾</div><div><b>${esc(t("dmPersistT"))}</b><p>${esc(t("dmPersistD"))}</p><span class="privStatus" id="persistStatusLine">${esc(persistStatusText())}</span></div></div>`+
  /* v5.11.95: пам'ять Асистента Ядра — окремий рядок із лічильником і кнопкою очищення. */
  (()=>{let info={facts:0,docs:0};try{info=coreAssistant()?.memoryInfo()||info}catch(e){}
    return `<div class="card dmRow"><div class="dmIcon" aria-hidden="true">⚙️</div><div><b>${esc(t("dmCoreT"))}</b><p>${esc(t("dmCoreD",{f:info.facts||0,d:info.docs||0}))}</p><p>${esc(t("dmCoreD2",{q:info.qa||0,tq:info.taught||0,l:info.lists||0,k:info.knowledge||0}))}</p><button class="tinyBtn" type="button" id="clearCoreMemoryBtn">${esc(t("clear"))}</button> <button class="tinyBtn" type="button" id="coreLearnToggleBtn" aria-pressed="${coreLearningOn()?"true":"false"}">${esc(t(coreLearningOn()?"coreLearnOn":"coreLearnOff"))}</button> <button class="tinyBtn" type="button" id="coreTrainBtn">${esc(t("coreTrainBtn"))}</button></div></div>`})()+
  `<p class="dmFoot">${esc(t("dmFoot"))}</p>`;
  $("clearPromptHistBtn").onclick=()=>clearPromptHistory();
  $("clearCoreMemoryBtn").onclick=()=>{try{coreAssistant()?.forget("")}catch(e){}try{localStorage.removeItem(CORE_MEMORY_KEY)}catch(e){}renderDataMap();toast(t("dmCoreCleared"),"good")};
  $("coreLearnToggleBtn").onclick=()=>{try{if(coreLearningOn())localStorage.setItem(CORE_LEARN_OFF_KEY,"1");else localStorage.removeItem(CORE_LEARN_OFF_KEY)}catch(e){}renderDataMap()};
  $("coreTrainBtn").onclick=async()=>{const n=await coreTrainFromHistory(true);renderDataMap();toast(n>0?t("coreTrainedToast",{n}):t("coreTrainNone"),n>0?"good":"")};
  // Оновити статус, щойно прийде відповідь storage.persist().
  ensureStoragePersist().then(()=>{const s=$("persistStatusLine");if(s)s.textContent=persistStatusText()});
}
/* ---------- v5.11.74: гарячі клавіші (keyboard shortcuts) — екран у правій
   колонці D4. Механіки вже є (Ctrl+K — палітра, Esc — закрити листи,
   / — фокус на поле вводу, Enter/Ctrl+Enter — відправка); тут — їхня
   видима довідка + Ctrl+Enter для поля вводу агента. */
const HOTKEY_ROWS=[
  {keys:"Ctrl + Enter",d:"hkSendD"},
  {keys:"/",d:"hkFocusD"},
  {keys:"Esc",d:"hkEscD"},
  {keys:"Ctrl + K",d:"hkCmdkD"},
  {keys:"↑ / ↓",d:"hkHistD"}
];
function renderHotkeys(){
  const host=$("hotkeysList");if(!host)return;
  host.innerHTML=HOTKEY_ROWS.map(r=>
    `<div class="card dmRow"><div class="dmIcon hkKeys" aria-hidden="true">${esc(r.keys)}</div><div><p>${esc(t(r.d))}</p></div></div>`
  ).join("");
}
/* ---------- v5.11.67: Центр приватності — путівник по елементах керування.
   Сам по собі нічого не змінює: кожен рядок пояснює простою мовою, що робить
   елемент керування, показує живий статус і дає кнопку «Керувати», що веде
   до відповідного налаштування. Рядки посилаються лише на реально
   реалізовані елементи (watchdog v5.11.20, temp chat v5.11.39, datamap
   v5.11.40, export v5.11.41, prompt history v5.11.44, spend caps v5.11.30). */
const PRIVACY_ROWS=[
  {icon:"🧠",t:"privMemT",d:"privMemD",st:"privMemSt",act:"ctx"},
  {icon:"🕵",t:"privTempT",d:"privTempD",act:"temp"},
  {icon:"🛡",t:"privGuardT",d:"privGuardD",st:"privGuardSt"},
  {icon:"⌨️",t:"privHistT",d:"privHistD",st:"privHistSt",act:"hist"},
  {icon:"🗺",t:"privDataT",d:"privDataD",act:"datamap"},
  {icon:"📤",t:"privExportT",d:"privExportD",act:"export"},
  {icon:"💰",t:"privBudgetT",d:"privBudgetD",act:"connections"}
];
function privacyStatus(r){
  if(r.act==="ctx"){
    var marks=typeof agentMessages!=="undefined"?agentMessages.filter(function(m){return m&&m.compacted}).length:0;
    return t(r.st,{n:marks});
  }
  if(r.act==="temp")return t(tempChatOn()?"privOn":"privOff");
  if(r.act==="hist")return t(r.st,{n:promptHistory().length});
  return t(r.st||"privAlwaysOn");
}
function renderPrivacy(){
  var host=$("privacyList");if(!host)return;
  host.innerHTML=PRIVACY_ROWS.map(function(r){
    var stat=privacyStatus(r);
    return `<div class="card dmRow privRow"><div class="dmIcon" aria-hidden="true">${r.icon}</div><div class="privBody"><b>${esc(t(r.t))}</b><p>${esc(t(r.d))}</p><span class="privStatus">${esc(stat)}</span>${r.act?`<button class="tinyBtn privManage" type="button" data-priv-act="${r.act}">${esc(t("privManage"))}</button>`:""}</div></div>`;
  }).join("");
  host.querySelectorAll("[data-priv-act]").forEach(function(b){
    b.onclick=function(){privacyAction(b.dataset.privAct)};
  });
}
function privacyAction(act){
  if(act==="ctx"){renderCtxSheet();openSheet("ctxSheet")}
  else if(act==="datamap"){showPage("datamap")}
  else if(act==="export"){openSheet("exportSheet")}
  else if(act==="connections"){showPage("connections")}
  else if(act==="temp"){
    var el=$("tempChatToggle");
    if(el){el.checked=!el.checked;toast(t("privTempToggled",{state:t(tempChatOn()?"privOn":"privOff")}),"good");renderPrivacy()}
  }
  else if(act==="hist"){
    if(!confirm(t("privHistConfirm")))return;
    clearPromptHistory();renderPrivacy();
  }
}
/* ---------- v5.11.47: нотатки з кнопкою «Покращити ШІ» (AI Enhance) ----------
   Швидкі нотатки в localStorage; кнопка відправляє текст M2-роутеру
   (mode:"auto", effort:"fast", без судді) і замінює текст покращеним. */
const NOTES_KEY="ai_bridge_notes_v1";
function loadNotes(){try{const a=JSON.parse(localStorage.getItem(NOTES_KEY)||"[]");return Array.isArray(a)?a.filter(n=>n&&typeof n==="object"):[]}catch(e){return[]}}
function saveNotes(a){try{localStorage.setItem(NOTES_KEY,JSON.stringify(a))}catch(e){}}
function noteTitleOf(n){const l=String(n.text||"").trim().split("\n")[0].slice(0,60);return l||t("noteUntitled")}
function noteFmtDate(ts){try{return new Date(ts).toLocaleString(I18N?.locale?.()||"uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}catch(e){return""}}
let noteBusyId=null;
function renderNotes(){
  const host=$("notesList");if(!host)return;
  const notes=loadNotes().sort((a,b)=>(b.updated||0)-(a.updated||0));
  if(!notes.length){host.innerHTML=`<p class="emptyNote">${esc(t("notesEmpty"))}</p>`;return}
  host.innerHTML=notes.map(n=>{
    const busy=noteBusyId===n.id;
    return `<div class="card noteCard" data-note="${esc(n.id)}">
      <div class="noteTop"><b class="noteTitle">${esc(noteTitleOf(n))}</b><span class="noteDate">${esc(noteFmtDate(n.updated||n.created||Date.now()))}</span></div>
      <textarea class="noteText" rows="3" maxlength="8000" placeholder="${esc(t("notePh"))}" data-note-text>${esc(String(n.text||""))}</textarea>
      <div class="noteBtns">
        <button type="button" class="primary" data-note-enhance ${busy?"disabled":""}>${esc(busy?t("noteEnhancing"):t("noteEnhance"))}</button>
        <button type="button" class="tinyBtn" data-note-chat>${esc(t("noteToChat"))}</button>
        <button type="button" class="tinyBtn" data-note-copy>${esc(t("noteCopy"))}</button>
        <button type="button" class="tinyBtn" data-note-del>${esc(t("noteDelete"))}</button>
      </div>
      ${busy?`<div class="noteStatus" aria-live="polite">${esc(t("noteEnhancing"))}</div>`:""}
    </div>`;
  }).join("");
  let saveTimer=null;
  host.querySelectorAll(".noteCard").forEach(card=>{
    const id=card.dataset.note,ta=card.querySelector("[data-note-text]");
    ta.addEventListener("input",()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{
      saveNotes(loadNotes().map(x=>x.id===id?{...x,text:ta.value,updated:Date.now()}:x));
    },800)});
    card.querySelector("[data-note-enhance]").onclick=()=>enhanceNote(id);
    card.querySelector("[data-note-chat]").onclick=()=>{ta.dispatchEvent(new Event("input",{bubbles:true}));fillPrompt(ta.value.trim())};
    card.querySelector("[data-note-copy]").onclick=async()=>{try{await navigator.clipboard.writeText(ta.value||"");toast(t("copied"),"good")}catch(e){toast(t("copyFailed"),"bad")}};
    card.querySelector("[data-note-del]").onclick=()=>{
      if(!confirm(t("noteDeleteConfirm")))return;
      saveNotes(loadNotes().filter(x=>x.id!==id));renderNotes();toast(t("noteDelete"),"good");
    };
  });
}
async function enhanceNote(id){
  if(noteBusyId)return;
  const notes=loadNotes(),n=notes.find(x=>x.id===id);if(!n)return;
  const text=String(n.text||"").trim();
  if(!text){toast(t("noteNeedText"),"warn");return}
  const provs=selectedProviders();
  if(!provs.length){toast(t("noteNoProvider"),"warn");showPage("connections");return}
  const gate=spendGateState(monthSpendUsd(),spendCapUsd());
  if(gate.state==="block"){toast(t("spendCapBlocked"),"bad");return}
  noteBusyId=id;renderNotes();
  try{
    const payload={prompt:t("noteEnhancePrompt")+text,mode:"auto",providers:provs,synthesize:false,effort:"fast",clientRequestId:newRequestId()};
    const run=await legacyRunRequest(payload);
    if(!run.ok){toast(`${t("noteEnhanceFail")} ${friendlyRunError(run.j,run.status)}`,"bad");return}
    const improved=String(run.j?.final||run.j?.results?.find(r=>r.ok)?.text||"").trim();
    if(!improved){toast(t("noteEnhanceFail"),"bad");return}
    try{recordUsage({results:run.j.results,created:Date.now()})}catch(e){}
    saveNotes(loadNotes().map(x=>x.id===id?{...x,text:improved,updated:Date.now()}:x));
    toast(t("noteEnhanced"),"good");
  }catch(e){toast(`${t("noteEnhanceFail")} ${e?.message||e}`,"bad")}
  finally{noteBusyId=null;renderNotes()}
}
function wireNotesPage(){$("noteNewBtn").onclick=()=>{const n={id:newRequestId(),text:"",created:Date.now(),updated:Date.now()};const a=loadNotes();a.push(n);saveNotes(a);renderNotes();const card=document.querySelector(`[data-note="${n.id}"] textarea`);card?.focus()}}

/* ---------- v5.11.47: панель статистики використання ---------- */
function usageDayBucket(day){const u=loadUsage();return u[day]||{}}
async function renderStats(){
  const cards=$("statsCards"),models=$("statsModels"),bars=$("statsBars");if(!cards)return;
  const u=loadUsage();
  // відповіді по днях (останні 7) і агреати по моделях
  const days=[],agg={};let totalN=0,totalOk=0,totalUsd=0;
  for(let i=6;i>=0;i--){const dk=dayKey(Date.now()-i*86400000),b=u[dk]||{};let n=0,ok=0;for(const e of Object.values(b)){n+=Number(e.n)||0;ok+=Number(e.ok)||0}days.push({dk,n,ok})}
  for(const b of Object.values(u))for(const [id,e] of Object.entries(b||{})){const o=agg[id]||(agg[id]={n:0,ok:0,err:0,ms:0,usd:0});o.n+=Number(e.n)||0;o.ok+=Number(e.ok)||0;o.err+=Number(e.err)||0;o.ms+=Number(e.ms)||0;o.usd+=Number(e.usd)||0;totalN+=Number(e.n)||0;totalOk+=Number(e.ok)||0;totalUsd+=Number(e.usd)||0}
  // діалоги за 7 днів з IndexedDB
  let dialogs7=0;try{const runs=await getRuns(2000),cut=Date.now()-7*86400000;dialogs7=runs.filter(r=>(r.created||0)>=cut&&!r.meta?.deepScan?.interrupted).length}catch(e){}
  const cap=spendCapUsd(),mUsd=monthSpendUsd();
  cards.innerHTML=`
    <div class="statCard"><b>${totalN}</b><span>${esc(t("statsAnswers"))} · ${esc(t("statsDays30"))}</span></div>
    <div class="statCard"><b>${dialogs7}</b><span>${esc(t("statsDialogs"))} · ${esc(t("statsDays7"))}</span></div>
    <div class="statCard"><b>$${totalUsd.toFixed(2)}</b><span>${esc(t("statsSpend30"))}</span></div>
    <div class="statCard"><b>${cap!=null?"$"+cap.toFixed(2):"—"}</b><span>${esc(t("statsBudget"))}: $${mUsd.toFixed(2)}</span></div>`;
  const rows=Object.entries(agg).sort((a,b)=>b[1].ok-a[1].ok).slice(0,8);
  models.innerHTML=rows.length?rows.map(([id,o])=>{const rate=o.n?Math.round(o.ok/o.n*100):0;
    return `<div class="statModelRow"><b>${esc(PROVIDERS[id]?.name||id)}</b><span>${o.ok} ${esc(t("statsOk"))} · ${rate}% · ${esc(t("statsAvg"))} ${o.ok?Math.round(o.ms/o.ok):"—"} ms · $${o.usd.toFixed(2)}</span><i class="statBar"><i style="width:${rows[0][1].ok?Math.round(o.ok/rows[0][1].ok*100):0}%"></i></i></div>`}).join("")
    :`<p class="emptyNote">${esc(t("statsNoData"))}</p>`;
  const maxN=Math.max(1,...days.map(d=>d.n));
  bars.innerHTML=days.map(d=>{const lbl=d.dk.slice(5);return `<div class="statDay" title="${esc(d.dk)}: ${d.n}"><i style="height:${Math.round(d.n/maxN*100)}%"></i><span>${esc(lbl)}</span><em>${d.n}</em></div>`}).join("");
}
function exportStatsCsv(){
  const u=loadUsage(),rows=[[t("statsCsvDay"),t("statsCsvModel"),t("statsCsvReq"),t("statsCsvOk"),t("statsCsvErr"),t("statsCsvAvgMs"),t("statsCsvUsd")]];
  for(const [day,b] of Object.entries(u).sort())for(const [id,e] of Object.entries(b||{}))
    rows.push([day,(PROVIDERS[id]?.name||id),e.n||0,e.ok||0,e.err||0,e.ok?Math.round(e.ms/e.ok):0,(Number(e.usd)||0).toFixed(4)]);
  const csv=rows.map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="ai-bridge-stats.csv";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
  toast(t("statsExport")+" ✓","good");
}
/* v5.11.15: Лотерейний аналізатор — тиражі WCLC, статистика збігів, мої комбінації. */
let lottoGamesCache=null,lottoGameSel="lottomax";
function lottoStoreKey(game){return "ai_bridge_lotto_combos_"+game}
function lottoGetCombos(game){try{const v=JSON.parse(localStorage.getItem(lottoStoreKey(game))||"[]");return Array.isArray(v)?v.filter(a=>Array.isArray(a)):[]}catch(e){return[]}}
function lottoSaveCombos(game,arr){try{localStorage.setItem(lottoStoreKey(game),JSON.stringify(arr))}catch(e){}}
/* чиста: "3, 5, 30" → [3,5,30] або null (перевірка кількості/діапазону за грою) */
function lottoParseComboInput(str,game){
  const g=(typeof lottoGamesCache!=="undefined"&&lottoGamesCache&&lottoGamesCache[game])||null;
  const nums=String(str||"").split(/[^0-9]+/).filter(Boolean).map(Number);
  const uniq=[...new Set(nums)];
  if(!g||uniq.length!==g.mainCount||!uniq.every(n=>n>=1&&n<=g.mainMax))return null;
  return uniq.sort((a,b)=>a-b);
}
/* чиста: кульки тиражу */
function lottoBalls(n,b,bonusName){
  const nums=(Array.isArray(n)?n:[]).map(x=>`<span class="lottoBall">${esc(String(x))}</span>`).join("");
  return `<span class="lottoBalls">${nums}<span class="lottoBall bonus" title="${esc(bonusName||"")}">${esc(String(b))}</span></span>`;
}
function lottoFreqBars(items,maxC){
  return `<div class="lottoBars">${items.map(it=>`<div class="lottoBarRow"><span class="lottoBarN">${it.n}</span><span class="lottoBarTrack"><span class="lottoBarFill" style="width:${maxC?Math.round(it.c/maxC*100):0}%"></span></span><span class="lottoBarC">${it.c}</span></div>`).join("")}</div>`;
}
async function renderLotto(){
  const body=$("lottoBody"),tabs=$("lottoTabs");if(!body||!tabs)return;
  try{
    if(!lottoGamesCache){
      const r=await fetch("/api/lotto/games",{cache:"no-store",credentials:"same-origin"});
      const j=await r.json().catch(()=>({}));
      lottoGamesCache=j.games||{};
    }
    const ids=Object.keys(lottoGamesCache);
    if(!ids.length)throw new Error("no games");
    if(!lottoGamesCache[lottoGameSel])lottoGameSel=ids[0];
    const g=lottoGamesCache[lottoGameSel];
    tabs.innerHTML=ids.map(id=>`<button type="button" role="tab" aria-selected="${id===lottoGameSel}" class="lottoTab${id===lottoGameSel?" on":""}" data-game="${id}">${esc(lottoGamesCache[id].name)}</button>`).join("");
    tabs.querySelectorAll(".lottoTab").forEach(b=>b.onclick=()=>{lottoGameSel=b.dataset.game;renderLotto();});
    body.innerHTML=`<div class="empty">${esc(t("lottoLoading"))}</div>`;
    const [dr,an]=await Promise.all([
      fetch(`/api/lotto/draws?game=${lottoGameSel}&limit=15`,{cache:"no-store",credentials:"same-origin"}).then(r=>r.json()),
      fetch(`/api/lotto/analyze?game=${lottoGameSel}`,{cache:"no-store",credentials:"same-origin"}).then(r=>r.json())
    ]);
    const draws=Array.isArray(dr.draws)?dr.draws:[];
    const latest=draws[0];
    const combos=lottoGetCombos(lottoGameSel);
    const maxF=Math.max(1,...(an.numberFreq||[]).map(x=>x.c));
    const upd=dr.updatedAt?new Date(dr.updatedAt):null;
    let h="";
    if(latest)h+=`<article class="card lottoCard"><h3>${esc(t("lottoLatest"))}</h3><div class="lottoLatestRow"><b>${esc(latest.d)}</b>${lottoBalls(latest.n,latest.b,g.bonusName)}</div><div class="lottoMeta">${esc(t("lottoUpdated"))}: ${upd?esc(upd.toLocaleDateString()):"—"} · ${esc(g.drawDays)}</div></article>`;
    /* мої комбінації */
    h+=`<article class="card lottoCard"><h3>${esc(t("lottoMyCombos"))}</h3><div id="lottoComboList">${combos.length?combos.map((c,i)=>`<div class="lottoComboRow"><span class="lottoComboNums">${c.map(x=>`<span class="lottoBall sm">${x}</span>`).join("")}</span><button type="button" class="lottoDel" data-i="${i}" aria-label="${esc(t("lottoRemove"))}">✕</button></div>`).join(""):`<div class="lottoMeta">${esc(t("lottoNoData"))}</div>`}</div><div class="lottoAddRow"><input id="lottoComboInput" inputmode="numeric" placeholder="${esc(t("lottoComboPh"))}" aria-label="${esc(t("lottoAddCombo"))}"><button type="button" id="lottoAddBtn" class="btn">＋</button></div><div class="lottoMeta" id="lottoAddErr"></div><button type="button" id="lottoCheckBtn" class="btn lottoCheckBtn">${esc(t("lottoCheck"))}</button><div id="lottoCheckOut"></div></article>`;
    /* статистика */
    if(an&&!an.error){
      h+=`<article class="card lottoCard"><h3>${esc(t("lottoStats"))} · ${an.drawCount} ${esc(t("lottoDraws"))}</h3>`;
      if(an.numberFreq&&an.numberFreq.length){h+=`<h4>${esc(t("lottoTopNumbers"))}</h4>`+lottoFreqBars(an.numberFreq,Math.max(1,...an.numberFreq.map(x=>x.c)));}
      if(an.bonusFreq&&an.bonusFreq.length){h+=`<h4>${esc(t("lottoTopBonus"))} (${esc(g.bonusName)})</h4><div class="lottoChips">${an.bonusFreq.map(x=>`<span class="lottoChip">${x.n} · ${x.c}</span>`).join("")}</div>`;}
      if(an.pairFreq&&an.pairFreq.length){h+=`<h4>${esc(t("lottoPairs"))}</h4><div class="lottoChips">${an.pairFreq.slice(0,10).map(x=>`<span class="lottoChip">${x.pair.join("–")} · ${x.c}</span>`).join("")}</div>`;}
      if(an.fullRepeats&&an.fullRepeats.length){h+=`<h4>${esc(t("lottoRepeats"))}</h4>`+an.fullRepeats.slice(0,5).map(r=>`<div class="lottoMeta">🎯 ${r.combo.join(", ")} — ${r.count}× (${r.dates.join(", ")})</div>`).join("");}
      if(an.partialOverlaps&&an.partialOverlaps.length){h+=`<h4>${esc(t("lottoPartial"))}</h4>`+an.partialOverlaps.slice(0,5).map(p=>`<div class="lottoMeta">≈ ${p.d1} ↔ ${p.d2}: ${p.common}/${g.mainCount}</div>`).join("");}
      if(an.longestGaps&&an.longestGaps.length){h+=`<h4>${esc(t("lottoGaps"))}</h4><div class="lottoChips">${an.longestGaps.slice(0,10).map(x=>`<span class="lottoChip">${x.n} · ${x.gap===null?esc(t("lottoNever")):(x.gap===0?esc(t("lottoInLatest")):t("lottoDrawsAgo",{n:x.gap}))}</span>`).join("")}</div>`;}
      h+=`<div class="lottoDisc">⚠️ ${esc(an.note||t("lottoDisclaimer"))}</div></article>`;
      /* v5.11.55: розумний підбір — 5 комбінацій зі стратегіями; v5.11.57: точність з навчання + похідні */
      if(an.smartCombos&&an.smartCombos.length){
        const stratName={hot:t("lottoSmartHot"),ripe:t("lottoSmartRipe"),balance:t("lottoSmartBalance"),pairs:t("lottoSmartPairs"),anti:t("lottoSmartAnti")};
        const dispName=id=>{const evo=id.endsWith("+");const base=evo?id.slice(0,-1):id;
          return (stratName[base]||base)+(evo?"+":"");};
        const mc=g.mainCount||7;
        h+=`<article class="card lottoCard"><h3>${esc(t("lottoSmart"))}</h3>`+
          an.smartCombos.map(c=>{const acc=(typeof c.accuracy==="number"?c.accuracy:0.5)*mc;
            return `<div class="lottoSmartRow"><div class="lottoSmartHead"><b>${esc(dispName(c.id))}</b></div><div class="lottoComboNums">${(c.nums||[]).map(x=>`<span class="lottoBall sm">${x}</span>`).join("")}</div><div class="lottoMeta">${esc(c.reason||"")}</div><div class="lottoMeta lottoAcc">🎯 ${esc(t("lottoAccuracy"))}: ${acc.toFixed(1)} ${esc(t("lottoAvgMatches"))}</div></div>`;}).join("")+
          (an.learning?`<div class="lottoMeta lottoLearn">📊 ${esc(t("lottoCheckedN"))}: ${an.learning.totalChecked||0}`+(an.learning.bestStrategy?` · ${esc(t("lottoBestStrategy"))}: ${esc(dispName(an.learning.bestStrategy))}`:"")+`</div>`:"")+
          `</article>`;
      }
      /* v5.11.55: зона малих виграшів — топ пар */
      if(an.smallWinPairs&&an.smallWinPairs.length){
        h+=`<article class="card lottoCard"><h3>${esc(t("lottoSmallWins"))}</h3><div class="lottoChips">${an.smallWinPairs.map(x=>`<span class="lottoChip">${x.pair.join("–")} · ${x.c}</span>`).join("")}</div></article>`;
      }
    }
    /* історія */
    if(draws.length)h+=`<article class="card lottoCard"><h3>${esc(t("lottoHistory"))}</h3>`+draws.map(d=>`<div class="lottoHistRow"><span class="lottoDate">${esc(d.d)}</span>${lottoBalls(d.n,d.b,g.bonusName)}</div>`).join("")+`</article>`;
    body.innerHTML=h||`<div class="empty">${esc(t("lottoNoData"))}</div>`;
    /* події */
    body.querySelectorAll(".lottoDel").forEach(b=>b.onclick=()=>{const a=lottoGetCombos(lottoGameSel);a.splice(+b.dataset.i,1);lottoSaveCombos(lottoGameSel,a);renderLotto();});
    const addBtn=$("lottoAddBtn"),inp=$("lottoComboInput"),err=$("lottoAddErr");
    if(addBtn&&inp)addBtn.onclick=()=>{
      const parsed=lottoParseComboInput(inp.value,lottoGameSel);
      if(!parsed){if(err)err.textContent=t("lottoBadCombo",{n:g.mainCount,m:g.mainMax});return;}
      const a=lottoGetCombos(lottoGameSel);
      if(!a.some(c=>c.join(",")===parsed.join(",")))a.push(parsed);
      lottoSaveCombos(lottoGameSel,a);renderLotto();
    };
    const chk=$("lottoCheckBtn"),out=$("lottoCheckOut");
    if(chk&&out)chk.onclick=async()=>{
      const a=lottoGetCombos(lottoGameSel);
      if(!a.length){out.innerHTML=`<div class="lottoMeta">${esc(t("lottoNoData"))}</div>`;return;}
      out.innerHTML=`<div class="lottoMeta">${esc(t("lottoLoading"))}</div>`;
      try{
        const r=await fetch("/api/lotto/check",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({game:lottoGameSel,combos:a})});
        const j=await r.json().catch(()=>({}));
        out.innerHTML=(j.results||[]).map(res=>res.error?`<div class="lottoMeta">⚠️ ${esc((res.combo||[]).join(", "))}</div>`:`<div class="lottoRes"><span class="lottoComboNums">${(res.combo||[]).map(x=>`<span class="lottoBall sm">${esc(x)}</span>`).join("")}</span><span class="lottoMeta">${esc(t("lottoBest"))}: <b>${Number(res.bestMain)||0}/${Number(g.mainCount)||0}</b>${res.bestMainDates&&res.bestMainDates.length?` (${esc(res.bestMainDates.slice(0,3).join(", "))})`:""}</span></div>`).join("")||`<div class="lottoMeta">${esc(t("lottoNoData"))}</div>`;
      }catch(e){out.innerHTML=`<div class="lottoMeta">${esc(t("lottoNoData"))}</div>`;}
    };
  }catch(e){recordDiag("lotto",e?.message||e);body.innerHTML=`<div class="empty">${esc(t("lottoNoData"))}</div>`;}
}
/* ===== v5.11.58: АвтоКоди — DTC + VIN ===== */
let dtcTabSel="code";
function dtcSevLabel(sv){
  return sv==="critical"?t("dtcSevCritical"):sv==="warning"?t("dtcSevWarning"):t("dtcSevInfo");
}
function dtcCodeCard(r){
  return `<div class="card dtcCard"><div><span class="dtcCode">${esc(r.code)}</span><span class="dtcSev ${esc(r.severity)}">${esc(dtcSevLabel(r.severity))}</span></div>`
    +`<h4>${esc(r.title_uk)}</h4><p>${esc(r.desc_uk)}</p>`
    +(r.causes_uk&&r.causes_uk.length?`<h4>${esc(t("dtcCauses"))}</h4><ul class="dtcCauses">${r.causes_uk.map(c=>`<li>${esc(c)}</li>`).join("")}</ul>`:"")
    +`</div>`;
}
async function dtcDoLookup(){
  const inp=$("dtcCodeInput"),out=$("dtcCodeResult");if(!inp||!out)return;
  const code=inp.value.trim().toUpperCase();
  if(!code){out.innerHTML="";return;}
  out.innerHTML=`<div class="dtcErr">${esc(t("dtcLoading"))}…</div>`;
  try{
    const r=await fetch("/api/dtc/lookup?code="+encodeURIComponent(code),{cache:"no-store",credentials:"same-origin"});
    const j=await r.json();
    if(!r.ok||j.error){out.innerHTML=`<div class="dtcErr">⚠️ ${esc(j.error||t("dtcNotFound"))}${j.hint?`<br><small>${esc(j.hint)}</small>`:""}</div>`;return;}
    out.innerHTML=dtcCodeCard(j);
  }catch(e){out.innerHTML=`<div class="dtcErr">⚠️ ${esc(t("dtcNetErr"))}</div>`;}
}
async function dtcDoVin(){
  const inp=$("dtcVinInput"),out=$("dtcVinResult");if(!inp||!out)return;
  const vin=inp.value.trim().toUpperCase();
  if(!vin){out.innerHTML="";return;}
  out.innerHTML=`<div class="dtcErr">${esc(t("dtcLoading"))}…</div>`;
  try{
    const r=await fetch("/api/dtc/vin?vin="+encodeURIComponent(vin),{cache:"no-store",credentials:"same-origin"});
    const j=await r.json();
    if(!r.ok||!j.valid){out.innerHTML=`<div class="dtcErr">⚠️ ${esc(j.error||t("dtcVinBad"))}</div>`;return;}
    out.innerHTML=`<div class="card dtcCard">`
      +`<div class="dtcVinRow"><span class="k">VIN</span><span class="v" style="font-family:ui-monospace,monospace">${esc(j.vin)}</span></div>`
      +`<div class="dtcVinRow"><span class="k">${esc(t("dtcMake"))}</span><span class="v">${esc(j.make)}</span></div>`
      +`<div class="dtcVinRow"><span class="k">${esc(t("dtcCountry"))}</span><span class="v">${esc(j.country)}</span></div>`
      +`<div class="dtcVinRow"><span class="k">${esc(t("dtcYear"))}</span><span class="v">${j.year||"—"}</span></div>`
      +`</div>`;
  }catch(e){out.innerHTML=`<div class="dtcErr">⚠️ ${esc(t("dtcNetErr"))}</div>`;}
}
function dtcInitTabs(){
  const tabs=$("dtcTabs");if(!tabs||tabs.dataset.init)return;
  tabs.dataset.init="1";
  tabs.querySelectorAll(".dtcTab").forEach(b=>b.addEventListener("click",()=>{
    dtcTabSel=b.dataset.dtctab;
    tabs.querySelectorAll(".dtcTab").forEach(x=>x.classList.toggle("on",x===b));
    $("dtcCodePane")?.classList.toggle("hidden",dtcTabSel!=="code");
    $("dtcVinPane")?.classList.toggle("hidden",dtcTabSel!=="vin");
  }));
  $("dtcCodeBtn")?.addEventListener("click",dtcDoLookup);
  $("dtcCodeInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")dtcDoLookup();});
  $("dtcVinBtn")?.addEventListener("click",dtcDoVin);
  $("dtcVinInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")dtcDoVin();});
}
/* Зміст діалогу: чипи з перших рядків повідомлень користувача, клік — стрибок. */
function chatTocItems(messages){
  const items=[];
  (Array.isArray(messages)?messages:[]).forEach((m,i)=>{
    if(!m||m.role!=="user"||typeof m.text!=="string")return;
    const label=m.text.replace(/\s+/g," ").trim().slice(0,42);
    if(label)items.push({index:i,label});
  });
  return items;
}
function renderChatToc(){
  const wrap=$("tocWrap"),chips=$("tocChips");if(!wrap||!chips)return;
  const items=chatTocItems(typeof agentMessages!=="undefined"?agentMessages:[]);
  wrap.classList.toggle("hidden",items.length<2);
  if(items.length<2){chips.classList.add("hidden");return}
  const host=$("agentThread");
  chips.innerHTML=items.map((it,k)=>`<button type="button" class="tocChip" role="listitem" data-toc="${k}">${esc(it.label)}</button>`).join("");
  chips.querySelectorAll("[data-toc]").forEach(b=>{b.onclick=()=>{
    const it=items[Number(b.dataset.toc)],msg=host&&host.children[it.index];
    if(msg)msg.scrollIntoView({behavior:"smooth",block:"start"});
  }});
}
function renderAgentProviderOptions(){
  const el=$("agentProvider");if(!el)return;const current=el.value||localStorage.getItem("ai_bridge_agent_helper_v522")||"auto";
  const opts=[`<option value="auto">${esc(t("agentAutoBrain"))}</option>`];
  for(const [id,p] of Object.entries(PROVIDERS))if(status.providers?.[id])opts.push(`<option value="${id}">${esc(p.name)} • ${esc(status.models?.[id]||provNote(id,p))}</option>`);
  el.innerHTML=opts.join("");el.value=[...el.options].some(o=>o.value===current)?current:"auto";
}
function updateAgentAttachmentSummary(){
  const el=$("agentAttachmentSummary"),check=$("agentUseFiles");if(!el||!check)return;
  const n=attachments.reduce((sum,a)=>sum+(a.files?.length||1),0);
  // Keep this control interactive even before a file exists. On iPhone the
  // previous disabled checkbox looked like ZIP support itself was disabled.
  check.disabled=false;if(!n)check.checked=false;
  el.textContent=n?t("agentFilesReady",{n}):t("agentNoFiles");
}
function agentPhaseText(progress){
  if(!progress?.phase)return t("agentThinking");const phase=t(`agentPhase_${progress.phase}`);const step=Number(progress.step||0),max=Number(progress.maxSteps||0);
  return `${phase}${step&&max?` • ${step}/${max}`:""}${progress.tool?` • ${progress.tool}`:""}`;
}
function setAgentBusy(v,text=""){
  const btn=$("agentStartBtn"),statusEl=$("agentRunStatus");if(btn){btn.disabled=v;btn.classList.toggle("busy",v)}
  // BUG FIX (v5.9.0): a previous failure left the red "bad" class on the
  // status line forever, so later successful runs still looked failed.
  if(statusEl){statusEl.classList.toggle("busy",v);if(v){statusEl.classList.remove("bad");statusEl.textContent=text||t("agentThinking")}else if(text)statusEl.textContent=text}
}
function agentActorName(id){return id==="agent-core"?"Agent Core":id==="agent-image"?t("agentImageEngine"):(PROVIDERS[id]?.name||id||"")}
/* v5.11.45: панель міркувань — авто-згортання з резюме (ідея scout).
   Під час прогону панель відкрита з «дихаючим» індикатором і живим станом,
   після фінішу згортається в рядок-резюме «Продумано за N с · M кроків» —
   замість стіни логів, перегляд кроків — одним тапом. */
/* v5.11.80: згорнуті прев'ю великих результатів інструментів (ідея scout).
   Траса агента несе короткий уривок результату (excerpt, ≤1500 символів
   з сервера); довгі уривки показуються згорнутими прев'ю з кнопкою
   «Читати повністю» замість стіни тексту. Короткі — текстом одразу. */
/* Чиста (для тестів): розбиває уривок на прев'ю і повний текст. */
function toolExcerptParts(excerpt,maxPreview){
  const ex=String(excerpt||"").trim(),lim=Math.max(40,Number(maxPreview)||280);
  if(!ex)return null;
  if(ex.length<=lim)return {preview:ex,full:null};
  return {preview:ex.slice(0,lim).trimEnd()+"…",full:ex};
}
function toolPreviewHtml(x){
  const p=toolExcerptParts(x?.excerpt);
  if(!p)return "";
  if(!p.full)return `<div class="toolPreviewFull">${esc(p.preview)}</div>`;
  return `<details class="toolPreview"><summary><span class="toolPreviewText">${esc(p.preview)}</span><span class="toolPreviewMore">${esc(t("toolPreviewMore"))}</span></summary><div class="toolPreviewFull">${esc(p.full)}</div></details>`;
}
let thinkRunStart=0;
function renderAgentTrace(meta,liveProgress=null){
  const host=$("agentLiveTrace");if(!host)return;const trace=Array.isArray(meta?.agentTrace)?meta.agentTrace:[];
  if(!trace.length&&!liveProgress){host.classList.add("hidden");host.innerHTML="";thinkRunStart=0;return}
  if(liveProgress&&!thinkRunStart)thinkRunStart=Date.now();
  const rows=trace.map(x=>{const label=t(`agentTrace_${x.action}`);const detail=x.action==="fetch_url"?x.url:x.action==="search_web"?(x.query||""):x.action==="delegate"?`${x.target||"auto"}${x.provider?` • ${agentActorName(x.provider)}`:""}`:x.action==="generate_image"?`${x.aspect||"square"}${x.prompt?` • ${x.prompt}`:""}`:x.action==="generate_file"?`${x.name||""}`:agentActorName(x.provider);return `<div class="agentTraceRow"><span class="agentTraceStep">${esc(x.step)}</span><div><b>${esc(label)}</b>${detail?`<small>${esc(detail)}</small>`:""}${toolPreviewHtml(x)}</div></div>`}).join("");
  const live=liveProgress?`<div class="agentTraceRow"><span class="agentTraceStep">${esc(liveProgress.step||"•")}</span><div><b>${esc(agentPhaseText(liveProgress))}</b><small>${esc(liveProgress.provider?agentActorName(liveProgress.provider):"")}</small></div></div>`:"";
  const n=trace.length+(liveProgress?1:0);
  const sec=thinkRunStart?Math.max(1,Math.round((Date.now()-thinkRunStart)/1000)):0;
  const summary=liveProgress
    ?`<span class="thinkPulse" aria-hidden="true"></span><span>${esc(t("thinkLive"))}</span><span class="thinkPhase">${esc(agentPhaseText(liveProgress))}</span>`
    :`<span>${esc(t("thinkDone",{s:sec,n:n}))}</span>`;
  host.innerHTML=`<details class="thinkPanel"${liveProgress?" open":""}><summary class="thinkSummary">${summary}</summary><div class="thinkBody"><div class="agentTraceTitle">${esc(t("agentTraceTitle"))}</div>${rows}${live}</div></details>`;host.classList.remove("hidden");
}
function setAgentVoiceUi(state,message=""){
  const btn=$("agentVoiceBtn"),label=$("agentVoiceBtnLabel"),statusEl=$("agentVoiceStatus");agentVoiceListening=state==="listening";
  btn?.classList.toggle("listening",agentVoiceListening);btn?.setAttribute("aria-pressed",agentVoiceListening?"true":"false");if(label)label.textContent=agentVoiceListening?t("voiceListening"):t("voice");if(statusEl){statusEl.textContent=message;statusEl.classList.toggle("listening",agentVoiceListening)}
}
function startAgentVoiceInput(){
  if(agentVoiceListening&&agentVoiceRecognition){try{agentVoiceRecognition.stop()}catch(e){};return}
  const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition,input=$("agentPrompt");if(!input)return;if(!Ctor){setAgentVoiceUi("idle",t("voiceUnavailable"));input.focus();return}
  if(voiceListening&&voiceRecognition){try{voiceRecognition.stop()}catch(e){}}if(studioVoiceListening&&studioVoiceRecognition){try{studioVoiceRecognition.stop()}catch(e){}}
  const rec=new Ctor();agentVoiceRecognition=rec;rec.lang=I18N?.voiceLocale?.()||navigator.language||"uk-UA";rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=1;const base=input.value.trim(),finalParts=[];
  rec.onstart=()=>setAgentVoiceUi("listening",t("voiceSpeak"));rec.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){const text=String(e.results[i]?.[0]?.transcript||"").trim();if(!text)continue;if(e.results[i].isFinal)finalParts.push(text);else interim+=(interim?" ":"")+text}input.value=[base,finalParts.join(" "),interim].filter(Boolean).join(" ").trim()};
  rec.onerror=e=>{const code=String(e?.error||"");const msg=code==="not-allowed"||code==="service-not-allowed"?t("voiceMicDenied"):code==="no-speech"?t("voiceNoSpeech"):t("voiceStopped",{code:code?`: ${code}`:""});setAgentVoiceUi("idle",msg)};
  rec.onend=()=>{if(agentVoiceRecognition===rec){agentVoiceRecognition=null;if(agentVoiceListening)setAgentVoiceUi("idle",input.value.trim()?t("voiceAdded"):"")}};try{rec.start()}catch(e){setAgentVoiceUi("idle",t("voiceStartFail"))}
}
async function runAgentPage(){
  const input=$("agentPrompt"),rawGoal=String(input?.value||"");
  // v5.11.20: secret-like guard for the agent goal too (compare raw input so
  // the confirm-click round-trip cannot loop).
  if(findSecretLike(rawGoal)&&secretGuardConfirmed!==rawGoal){showSecretGuard(input,{retryAgent:true});return}
  const raw=rawGoal.trim(),submittedImages=imageAttachments.map(a=>({...a})),goal=raw||(submittedImages.length?t("taskDefaultPhoto"):"");
  if(!goal){alert(t("agentNeedGoal"));input?.focus();return}
  const useFiles=!!$("agentUseFiles")?.checked;if(useFiles&&!attachments.length){alert(t("agentUseFilesMissing"));showPage("files");return}
  const fileContext=useFiles?buildFileContext({task:goal}):"";
  // v5.11.28: маркери довгих вставок — у мережевий запит розгорнутими.
  const goalExpanded=expandPasteMarkers(goal);
  if(goalExpanded.length+fileContext.length>430000){alert(t("taskContextLarge"));return}
  const contextDescriptor={goal,useFiles,images:submittedImages.length>0},memory=agentMemoryContext(),agentPolicy=selectAgentPolicy(contextDescriptor),provider=$("agentProvider")?.value||"auto",providers=provider==="auto"?[]:[provider],maxSteps=Math.max(1,Math.min(4,Number($("agentMaxSteps")?.value||4)));
  // v5.11.68: мітка «пам'ять використано тут» — фіксуємо, яка саме пам'ять
  // (дайджест M5 + уроки) пішла в модель цього ходу, до відправки.
  const memInfo=describeMemoryUsed(memory);
  addAgentMessage("user",goal);if(input)input.value="";saveComposerDrafts();dismissKeyboard();if(submittedImages.length){imageAttachments=[];renderImageAttachments()}
  const clientRequestId=newRequestId(),attachmentNames=[...(useFiles?attachments.map(a=>a.name):[]),...submittedImages.map(a=>a.name)];
  savePendingJob({clientRequestId,jobId:null,createdAt:Date.now(),prompt:goal,mode:"agent",providers,attachmentNames,uiTarget:"agent",agentPolicy});
  setAgentBusy(true,t("agentStatusAccepted"));renderAgentTrace(null,{phase:"planning",step:0,maxSteps,provider:provider==="auto"?null:provider});revealWork($("agentRunStatus"));
  try{
    const payload={prompt:goalExpanded,displayPrompt:goal,dialogInstructions:getDialogInstructions().slice(0,DLG_INSTR_MAX),fileContext,agentContext:memory,agentPolicy,images:submittedImages.map(({name,mime,data})=>({name,mime,data})),mode:"agent",providers,synthesize:false,judge:"auto",agentMaxSteps:maxSteps,clientRequestId,effort:getEffort(),backgroundModel:getBgModel(),...styleField()};savePendingPayload(clientRequestId,payload);
    const run=await streamingRunRequest(payload,value=>{const state=typeof value==="string"?value:value?.state,progress=typeof value==="object"?value?.progress:null;if(state==="processing"&&progress){setAgentBusy(true,agentPhaseText(progress));renderAgentTrace(null,progress)}else if(state==="accepted")setAgentBusy(true,t("agentStatusAccepted"));else if(state==="reconnecting")setAgentBusy(true,t("agentStatusReconnect"))});
    const j=run.j;if(!run.ok){const msg=friendlyRunError(j,run.status);if(agentPolicy&&run.terminal&&![401,404,503].includes(run.status))recordAgentPolicyFailure(agentPolicy);addAgentMessage("assistant",msg,{error:true});setAgentBusy(false);$("agentRunStatus").className="agentRunStatus bad";$("agentRunStatus").textContent=`${t("agentStatusError")}: ${msg}`;renderAgentTrace(j.meta||null);if(run.terminal||run.status===404)clearPendingJob();if(run.status===401||run.status===503)showPage("connections");return}
    const used=(j.selectedProviders||[]),primary=used.at(-1)||used[0]||null;addAgentMessage("assistant",j.final||j.results?.find(r=>r.ok)?.text||t("noAnswer"),{provider:primary,meta:j.meta||{},artifacts:j.artifacts||[],...(memInfo?{mem:memInfo}:{})});renderAgentTrace(j.meta||null);
    if(agentPolicy&&Number(j.meta?.agentToolErrors)>0)recordAgentPolicyFailure(agentPolicy);
    const learned=rememberAgentOutcome(j.meta||{},contextDescriptor);
    currentRun={created:Date.now(),prompt:goal,mode:"agent",providers:used,attachments:attachmentNames,results:j.results||[],final:j.final||"",judge:null,meta:j.meta||{}};await saveRun(currentRun);renderHistory();clearPendingJob();sweepPasteStore();markDoneHidden();notifyRunDone(currentRun);setAgentBusy(false);$("agentRunStatus").textContent=learned?t("agentStatusLearned",{n:loadAgentLessons().length}):t("agentStatusDone");refreshStatus().catch(()=>{});
  }catch(e){if(submittedImages.length&&!imageAttachments.length){imageAttachments=submittedImages.map(a=>({...a}));renderImageAttachments()}const msg=e?.message||String(e);addAgentMessage("assistant",msg,{error:true});setAgentBusy(false);$("agentRunStatus").className="agentRunStatus bad";$("agentRunStatus").textContent=`${t("agentStatusError")}: ${msg}`}
}

function updateModeUI(){
  const mode=$("teamMode").value;
  const titles={auto:t("modeTitleAuto"),askall:t("modeTitleAskAll"),code:t("modeTitleCode"),debate:t("modeTitleDebate"),single:t("modeTitleSingle"),agent:t("modeTitleAgent"),god:t("modeTitleGod"),research:t("modeTitleResearch")};
  $("modeTitle").textContent=titles[mode]||"AI Team";
  document.querySelectorAll(".chip").forEach(c=>{const map={auto:"auto",code:"code",review:"code",all:"askall",agent:"agent",god:"god"};c.classList.toggle("active",map[c.dataset.quick]===mode)});
  // v5.10.0: mode chips above the composer mirror teamMode.
  document.querySelectorAll("[data-modechip]").forEach(c=>{c.classList.toggle("active",c.dataset.modechip===mode);c.setAttribute("aria-selected",c.dataset.modechip===mode?"true":"false")});
  $("researchDepthWrap")?.classList.toggle("hidden",mode!=="research");
  const synthRow=$("synthesize")?.closest(".toggleRow"),judgeLabel=$("judgeProvider")?.closest("label");
  const standalone=mode==="single"||mode==="agent"||mode==="god"||mode==="research";
  if(synthRow)synthRow.classList.toggle("modeDisabled",standalone);
  if(judgeLabel)judgeLabel.classList.toggle("modeDisabled",standalone);
  if($("synthesize"))$("synthesize").disabled=standalone;
  if($("judgeProvider"))$("judgeProvider").disabled=standalone;
  $("agentModeHint")?.classList.toggle("hidden",mode!=="agent");
  $("godModeHint")?.classList.toggle("hidden",mode!=="god");
  renderProviders();updateCallEstimate();
}
/* v5.11.42: прогноз вартості ДО відправки (ідея scout). Приблизні ПУБЛІЧНІ
   ціни $/1M токенів {in,out} по провайдерах — ТІЛЬКИ для попередньої оцінки
   в композері, не джерело для білінгу (точний цінник після відповіді —
   серверний costUsd v5.11.27). Вільні тири = 0. */
const PROVIDER_EST_PRICE={
  openai:{in:1.25,out:10},
  claude:{in:3,out:15},
  gemini:{in:0.1,out:0.4},
  grok:{in:3,out:15},
  groqfree:{in:0,out:0},
  openrouter:{in:0,out:0}
};
/* v5.11.63: цінова мітка на кнопці вибору моделі (ідея scout, патерн t3.chat):
   ○ — безкоштовно, ●/●●/●●● — тири цін, видно до відкриття меню.
   Тир рахується з PROVIDER_EST_PRICE ($/1M токенів, in+out). Чисті функції — для тестів. */
function providerCostTier(id){
  const pr=PROVIDER_EST_PRICE[id];if(!pr)return 0;
  const total=(Number(pr.in)||0)+(Number(pr.out)||0);
  if(!(total>0))return 0;if(total<=1)return 1;if(total<=10)return 2;return 3;
}
function costTierDots(tier){const n=Math.max(0,Math.min(3,Math.round(Number(tier)||0)));return n?"●".repeat(n):"○"}
function costTierNameKey(tier){return ["tierFree","tierCheap","tierMid","tierPricey"][Math.max(0,Math.min(3,Math.round(Number(tier)||0)))]}
function costTierHtml(id){
  const tier=providerCostTier(id),name=PROVIDERS[id]?.name||id;
  return `<span class="costTier t${tier}" title="${esc(name)} · ${esc(t(costTierNameKey(tier)))}" aria-hidden="true">${costTierDots(tier)}</span>`;
}
/* Груба оцінка токенів одного vision-кадра в запиті — тільки для прев'ю. */
const IMAGE_EST_TOKENS=1200;
/* Припущення про середню довжину відповіді для прогнозу — тільки оцінка. */
const EST_OUT_TOKENS=700;
function estTokensIn(){
  let chars=($("prompt")?.value||"").length;
  for(const a of attachments||[])chars+=Number(a?.chars||0);
  return Math.round(chars/4)+(imageAttachments||[]).length*IMAGE_EST_TOKENS;
}
function updateCallEstimate(){
  const el=$("callEstimate");if(!el)return;
  const plan=computeCallPlan();
  el.textContent=plan.text+costEstSuffix(plan);
}
/* Чистий план ходу: текст оцінки + скільки викликів API + які провайдери
   кандидати. Використовується і для рядка оцінки, і для прогнозу вартості. */
function computeCallPlan(){
  // v5.11.23: @згадка моделі в полі вводу — показуємо чесну оцінку «одна модель».
  const mention=parseModelMention($("prompt")?.value||"");
  if(mention&&status.providers?.[mention.provider])return{text:t("singleSelected",{name:PROVIDERS[mention.provider].name}),calls:1,providers:[mention.provider]};
  const mode=$("teamMode").value,syn=$("synthesize").checked,sel=selectedProviders();
  const configuredIds=Object.keys(status.providers||{}).filter(id=>status.providers[id]&&id!=="muse"&&id!=="core");
  const configured=configuredIds.length;
  const simpleAuto=mode==="auto"&&!attachments.length&&!imageAttachments.length&&($("prompt")?.value||"").length<=12000;
  if(mode==="single"){
    const id=sel[0],name=PROVIDERS[id]?.name||id;
    if(imageAttachments.length&&id&&!(["gemini","openai","claude","grok"].includes(id)))return{text:t("photoNeedProvider"),calls:0,providers:[]};
    return{text:id?t("singleSelected",{name}):t("taskNeedProvider"),calls:id?1:0,providers:id?[id]:[]};
  }
  if(mode==="agent"||mode==="god"){
    const prov=(sel.length?sel:configuredIds).slice(0,4);
    return{text:configured?t("agentEstimate",{n:Math.min(4,Math.max(1,sel.length||configured))}):t("addApiKey"),calls:1,providers:configured?prov:[]};
  }
  if(imageAttachments.length){
    const vision=["gemini","openai","claude","grok"].filter(id=>status.providers?.[id]);
    return{text:vision.length?t("photoEstimate",{n:imageAttachments.length}):t("photoNeedProvider"),calls:vision.length?1:0,providers:vision.slice(0,1)};
  }
  if(simpleAuto){
    return{text:$("searchFirst")?.checked?t("callAutoFirst"):(configured?t("autoEstimate"):t("addApiKey")),calls:($("searchFirst")?.checked||!configured)?0:Math.min(2,configured),providers:configuredIds};
  }
  let first=mode==="auto"?Math.min(2,configured):mode==="single"?Math.min(1,sel.length):mode==="debate"?Math.min(3,sel.length):sel.length;
  let calls=first;
  if(mode==="debate"&&first>1)calls+=first;
  if(syn&&first>1)calls+=1;
  const prov=mode==="auto"?configuredIds:(mode==="single"?sel.slice(0,1):sel.slice(0,Math.max(1,first)));
  return{text:calls?t("callsEstimate",{n:calls}):t("noAI"),calls,providers:prov};
}
/* Прогноз вартості ДО відправки: « · ≈$0.004 · ~12 400 ток». Рахується з
   довжини контексту (промпт + вкладення + фото) і статичної таблиці цін;
   береться найдорожчий кандидат × кількість викликів — верхня межа.
   Повертає "" коли оцінити нема чого (порожній композер, невідомі ціни). */
function costEstSuffix(plan){
  try{
    const p=plan||computeCallPlan();
    if(!p.calls||!p.providers||!p.providers.length)return "";
    if(!($("prompt")?.value||"").trim()&&!attachments.length&&!imageAttachments.length)return "";
    const tokens=estTokensIn();
    if(!tokens)return "";
    let worst=null;
    for(const id of p.providers){
      const pr=PROVIDER_EST_PRICE[id];
      if(!pr)continue;
      const usd=(tokens*pr.in+EST_OUT_TOKENS*pr.out)/1e6*p.calls;
      worst=worst==null?usd:Math.max(worst,usd);
    }
    if(worst==null)return "";
    const cost=worst>0?"$"+fmtMoney(worst):t("costFree");
    return " · "+t("costPreEst",{cost,tok:groupNum(tokens)});
  }catch(e){return ""}
}

function updateFileSendState(){
  const btn=$("fileSendBtn"),hint=$("fileSendHint"),task=$("filePrompt")?.value.trim()||"";
  if(!btn||!hint)return;
  const hasFiles=attachments.some(a=>(a.files||[]).length);
  btn.disabled=!hasFiles||!task;
  if(!hasFiles)hint.textContent=t("fileNeedOne");
  else if(!task)hint.textContent=t("fileNeedTask");
  else hint.textContent=t("fileReady",{n:attachments.reduce((n,a)=>n+(a.files?.length||1),0)});
}
/* v5.11.21: прев'ю вкладених файлів — людський розмір і тег типу */
function fmtFileSize(bytes){
  const n=Number(bytes)||0;
  if(n>=1048576)return (n/1048576).toFixed(1).replace(".",",")+" "+t("sizeMB");
  if(n>=1024)return Math.round(n/1024)+" "+t("sizeKB");
  return String(n)+" B";
}
function fileTypeTag(name){
  const ext=String(name||"").split(".").pop().toUpperCase().slice(0,4);
  return /^[A-Z0-9]{1,4}$/.test(ext)?ext:"FILE";
}
function renderFiles(){
  const sampled=attachments.reduce((n,a)=>n+(a.files?.length||0),0),available=attachments.reduce((n,a)=>n+(a.manifestNames?.length||a.files?.length||0),0),context=buildFileContext({task:$("filePrompt")?.value||""}),sent=(context.match(/<file path=/g)||[]).length;
  $("fileCount").textContent=sent===available?String(sent):`${sent}/${available}`;
  $("zipCount").textContent=attachments.filter(a=>a.kind==="zip").length;
  $("fileChars").textContent=context.length.toLocaleString();
  const coverage=$("fileCoverage");if(coverage){coverage.hidden=!attachments.length;coverage.textContent=attachments.length?fileCoverageText({sent,available,sampled}):""}
  updateAgentAttachmentSummary();
  $("attachedStrip").innerHTML=attachments.slice(0,6).map(a=>`<span class="attachmentPill">${a.kind==="zip"?"ZIP":"FILE"} • ${esc(a.name)}</span>`).join("")+
    (attachments.length>6?`<span class="attachmentPill">+${attachments.length-6}</span>`:"");
  if(!attachments.length){$("fileList").innerHTML=`<div class="empty">${esc(t("filesEmpty"))}</div>`;$("fileDropZone")?.classList.remove("compact");updateFileSendState();return}
  $("fileDropZone")?.classList.add("compact"); // v5.11.21: зона завантаження згортається, коли файли вже додані
  $("fileList").innerHTML=attachments.map((a,i)=>`<div class="fileItem"><div class="fileIcon">${esc(fileTypeTag(a.name))}</div><div class="fileInfo"><b>${esc(a.name)}</b><span>${fmtFileSize(a.size)} • ${a.files?.length||0}/${a.manifestNames?.length||a.files?.length||0} excerpts • ${(a.chars||0).toLocaleString()} chars</span></div><button class="removeFile" data-remove="${i}" aria-label="Remove ${esc(a.name)}">×</button></div>`).join("");
  document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{attachments.splice(Number(b.dataset.remove),1);renderFiles()});
  updateFileSendState();
  renderAttachChips(); // v5.10.0: reflect ZIP/file chips in the composer
}

/* v5.9.1: say exactly what was found, read and skipped — never sample silently. */
function fileCoverageText({sent,available,sampled}){
  const st=attachments.reduce((acc,a)=>{const x=a.stats;if(x)for(const k of Object.keys(acc))acc[k]+=Number(x[k])||0;return acc},{entries:0,text:0,extracted:0,skippedVendor:0,skippedBinary:0,skippedLarge:0,skippedEncrypted:0,failed:0,overBudget:0});
  const parts=[];
  if(st.entries)parts.push(t("covFound",{entries:st.entries,text:st.text,extracted:st.extracted}));
  const skipped=[["skippedVendor","covVendor"],["skippedBinary","covBinary"],["skippedLarge","covLarge"],["skippedEncrypted","covEncrypted"],["overBudget","covBudget"],["failed","covFailed"]].filter(([k])=>st[k]>0).map(([k,key])=>t(key,{n:st[k]}));
  if(skipped.length)parts.push(`${t("covSkipped")}: ${skipped.join(", ")}.`);
  parts.push(t(sent<sampled?"covPerRequestPartial":"covPerRequestAll",{sent,available:sampled}));
  if(sent<sampled){const plan=planDeepScanParts($("filePrompt")?.value||"");if(plan.totalParts>1)parts.push(t("covDeepHint",{parts:Math.min(plan.totalParts,DEEP_SCAN_MAX_PARTS)}))}
  return parts.join(" ");
}
function isTextPath(name){return TEXT_EXT.test(name)||/^(README|LICENSE|Dockerfile|Makefile|Procfile)(\.|$)/i.test(name.split("/").pop()||"")}
function priorityPath(name){
  const n=name.toLowerCase();let p=0;
  if(/(?:^|\/)(?:_?worker|app|server|main|index|work-controller)\.(?:js|mjs|cjs|ts|tsx|jsx|py|html)$/.test(n))p+=90;
  if(/package\.json|manifest|wrangler|tsconfig|vite\.config|next\.config|cloudflare/.test(n))p+=70;
  if(/\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|php|rb|html|css|json|yaml|yml|toml|sql|sh)$/.test(n))p+=40;
  if(/(?:^|\/)(?:src|lib|server|api|functions|workers?)\//.test(n))p+=25;
  if(/(?:^|\/)(?:test|tests|spec|specs)\//.test(n)||/\.(?:test|spec)\./.test(n))p+=15;
  if(/readme|security|submission_checklist|review_findings/.test(n))p+=10;
  if(/changelog/.test(n))p-=20;
  // v5.9.1: files that crowd out real sources or get quoted back by models
  // instead of answering (service worker boilerplate, bundles, lockfiles,
  // full copies of _worker.js kept as test fixtures) go to the end.
  if(/(?:^|\/)tests?\/worker-v[\w.-]+\.m?js$/.test(n))p-=300;
  if(/\.min\.(?:js|css)$|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(n))p-=200;
  if(/(?:^|\/)(?:sw|service-worker)\.js$/.test(n))p-=60;
  if(/(?:^|\/)i18n\.js$|(?:^|\/)locales?\//.test(n))p-=25;
  if(SKIP_PATH.test(n))p-=1000;
  return p;
}
async function inflateRaw(bytes,maxBytes=ZIP_MAX_ENTRY_DECOMPRESSED){
  // BUG FIX (zip-bomb/decompression-safety): this used to fully materialize
  // the decompressed stream with no independent size check, trusting only the
  // ZIP's declared (attacker-controlled) uncompressed size field -- the same
  // gap verified server-side, here reachable via the main upload UI. Route
  // through the already-hardened, tested zip-safety-core.js bounded streamer
  // (same one work-controller.js uses) instead of duplicating unbounded logic.
  if(!globalThis.ZipSafetyCore)throw new Error("ZIP safety core is unavailable.");
  return globalThis.ZipSafetyCore.inflateRawBounded(bytes,maxBytes);
}
function findEOCD(u8){
  if(globalThis.ZipSafetyCore)return globalThis.ZipSafetyCore.findEOCD(u8);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50)return i;
  return -1;
}
async function unzipText(file,onProgress=null){
  const u8=new Uint8Array(await file.arrayBuffer());
  if(!globalThis.ZipSafetyCore)throw new Error("ZIP safety core is unavailable.");
  globalThis.ZipSafetyCore.scanZipMeta(u8,{maxEntries:ZIP_MAX_ENTRIES,maxEntryDeclared:ZIP_MAX_ENTRY_DECOMPRESSED,maxTotalDeclared:ZIP_MAX_TOTAL_DECOMPRESSED,maxCompressionRatio:ZIP_MAX_COMPRESSION_RATIO,skipSuspicious:true});
  const dv=new DataView(u8.buffer),eocd=findEOCD(u8);
  if(eocd<0)throw new Error("ZIP structure not found");
  // Read and prioritize central-directory metadata first. The old single-pass
  // implementation inflated every text entry before sorting and then discarded
  // almost all of that work at MAX_CONTEXT_CHARS. A complete project with 200+
  // small source/test files could therefore freeze mobile Safari even though
  // only the first 350k context characters were ever used.
  const entries=dv.getUint16(eocd+10,true),cdOffset=dv.getUint32(eocd+16,true),candidates=[];let p=cdOffset;
  const stats={entries:0,text:0,extracted:0,skippedVendor:0,skippedBinary:0,skippedLarge:0,skippedEncrypted:0,failed:0,overBudget:0};
  for(let i=0;i<entries&&p+46<=u8.length;i++){
    if(dv.getUint32(p,true)!==0x02014b50)break;
    const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),uncomp=dv.getUint32(p+24,true);
    const nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
    const name=globalThis.ZipSafetyCore.normalizeEntryName?globalThis.ZipSafetyCore.normalizeEntryName(new TextDecoder().decode(u8.slice(p+46,p+46+nameLen))):new TextDecoder().decode(u8.slice(p+46,p+46+nameLen));
    const ratioOK=!(compSize>0&&uncomp/compSize>ZIP_MAX_COMPRESSION_RATIO),encrypted=(dv.getUint16(p+8,true)&1)===1;
    if(name&&!name.endsWith("/")){stats.entries++;if(encrypted)stats.skippedEncrypted++;else if(SKIP_PATH.test(name))stats.skippedVendor++;else if(!isTextPath(name))stats.skippedBinary++;else if(uncomp>ZIP_MAX_ENTRY_DECOMPRESSED||!ratioOK)stats.skippedLarge++}
    if(name&&!encrypted&&!name.endsWith("/")&&!SKIP_PATH.test(name)&&isTextPath(name)&&uncomp<=ZIP_MAX_ENTRY_DECOMPRESSED&&ratioOK){
      if(local+30<=u8.length&&dv.getUint32(local,true)===0x04034b50){
        const ln=dv.getUint16(local+26,true),le=dv.getUint16(local+28,true),start=local+30+ln+le,end=start+compSize;
        if(end<=u8.length)candidates.push({name,method,compSize,uncomp,start,end,priority:priorityPath(name)});
      }
    }
    p+=46+nameLen+extraLen+commentLen;
  }
  candidates.sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));
  onProgress?.({phase:"extracting",done:0,total:candidates.length});
  let used=0,totalDecompressed=0,out=[],processed=0;
  for(const c of candidates){
    if(used>=ZIP_EXTRACT_MAX_CHARS||totalDecompressed>=ZIP_MAX_TOTAL_DECOMPRESSED)break;
    const remainingBytes=ZIP_MAX_TOTAL_DECOMPRESSED-totalDecompressed;
    try{
      const perLimit=Math.min(ZIP_MAX_ENTRY_DECOMPRESSED,remainingBytes);
      let raw;if(c.method===0)raw=c.compSize<=perLimit?u8.slice(c.start,c.end):null;else if(c.method===8)raw=await inflateRaw(u8.slice(c.start,c.end),perLimit);else raw=null;
      if(raw){
        totalDecompressed+=raw.byteLength;
        const decoded=new TextDecoder("utf-8",{fatal:false}).decode(raw).replace(/\0/g,"");
        const prepared=sampleLargeFileText(decoded,ZIP_FILE_SAMPLE_CHARS),remain=ZIP_EXTRACT_MAX_CHARS-used,txt=prepared.text.slice(0,remain);
        out.push({name:c.name,text:txt,size:c.uncomp,priority:c.priority,truncated:prepared.truncated||txt.length<prepared.text.length,originalChars:prepared.originalChars});
        used+=txt.length;stats.extracted++;
      }else stats.failed++;
    }catch(e){stats.failed++}
    // Give Safari a rendering opportunity during large multi-entry projects.
    if(++processed%8===0){onProgress?.({phase:"extracting",done:processed,total:candidates.length});await new Promise(resolve=>setTimeout(resolve,0))}
  }
  onProgress?.({phase:"done",done:processed,total:candidates.length});
  stats.text=candidates.length;stats.overBudget=Math.max(0,candidates.length-processed);
  out.manifestNames=candidates.map(c=>c.name);out.stats=stats;
  return out;
}
async function unzipTextOffMainThread(file,onProgress=null){
  if(typeof Worker!=="function")return unzipText(file,onProgress);
  const buffer=await file.arrayBuffer();
  return new Promise((resolve,reject)=>{
    let worker;try{worker=new Worker("./zip-worker.js",{name:"ai-bridge-zip"})}catch(e){unzipText(file,onProgress).then(resolve,reject);return}
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error("ZIP processing timed out. Try a smaller archive or add source files separately."))},45000);
    const finish=fn=>value=>{clearTimeout(timeout);worker.terminate();fn(value)};
    // If the Worker itself cannot run (old Safari, blocked script), fall back
    // to the chunked main-thread extractor instead of failing the upload.
    worker.onerror=finish(()=>unzipText(file,onProgress).then(resolve,()=>reject(new Error("ZIP worker failed. Try reloading AI Bridge."))));
    worker.onmessage=e=>{const m=e.data||{};if(m.type==="progress")onProgress?.({phase:"extracting",done:m.done,total:m.total});else if(m.type==="done"){const files=m.files||[];files.manifestNames=m.manifestNames||files.map(f=>f.name);files.stats=m.stats||null;finish(resolve)(files)}else if(m.type==="error")finish(reject)(new Error(m.error||"ZIP processing failed."))};
    worker.postMessage({buffer},[buffer]);
  });
}
/* v5.11.66: локальне витягнення тексту з документів (PDF/DOCX/XLSX) —
   чистий клієнтський код, дані не залишають пристрій. pdf.js завендорено
   (vendor/pdfjs/, same-origin, без CDN у продакшені); DOCX/XLSX — це ZIP,
   розпаковка йде через уже загартоване ядро zip-safety-core.js. */
function decodeXmlEntities(s){
  return String(s||"")
    .replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>{const c=parseInt(h,16);return c>0&&c<0x110000?String.fromCodePoint(c):""})
    .replace(/&#(\d+);/g,(_,n)=>{const c=Number(n);return c>0&&c<0x110000?String.fromCodePoint(c):""})
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&amp;/g,"&"); // &amp; — останнім, щоб "&amp;lt;" стало "&lt;", а не "<"
}
function parseDocxXml(xml){
  const text=String(xml||"")
    .replace(/<w:br\s*\/?>/g,"\n")
    .replace(/<w:tab\s*\/?>/g,"\t")
    .replace(/<\/w:p[^>]*>/g,"\n")
    .replace(/<[^>]+>/g,"");
  return decodeXmlEntities(text).replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function colLettersToIndex(letters){
  let n=0;for(const ch of String(letters||"").toUpperCase()){if(ch<"A"||ch>"Z")return -1;n=n*26+(ch.charCodeAt(0)-64)}
  return n-1;
}
function parseXlsxXml(sharedStringsXml,sheetXml){
  const ss=[],siRe=/<si>([\s\S]*?)<\/si>/g;let m;
  while((m=siRe.exec(String(sharedStringsXml||""))))ss.push(decodeXmlEntities(m[1].replace(/<[^>]+>/g,"")));
  const rows=[],rowRe=/<row[^>]*>([\s\S]*?)<\/row>/g;
  while((m=rowRe.exec(String(sheetXml||"")))){
    const cells=[],cRe=/<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;let cm;
    while((cm=cRe.exec(m[1]))){
      const attrs=cm[1]||"",inner=cm[2]||"";let val="";
      if(/\bt="inlineStr"/.test(attrs)){const tm=inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);val=tm?decodeXmlEntities(tm[1]):""}
      else{const vm=inner.match(/<v>([\s\S]*?)<\/v>/);const raw=vm?vm[1].trim():"";
        if(/\bt="s"/.test(attrs)){const idx=parseInt(raw,10);val=Number.isFinite(idx)&&idx>=0&&idx<ss.length?ss[idx]:""}
        else val=raw}
      const ref=(attrs.match(/\br="([A-Z]+)\d+"/)||[])[1],col=ref?colLettersToIndex(ref):cells.length;
      if(col>=0){while(cells.length<col)cells.push("");cells[col]=val}else cells.push(val);
    }
    while(cells.length&&cells[cells.length-1]==="")cells.pop();
    rows.push(cells.join("\t"));
  }
  while(rows.length&&rows[rows.length-1]==="")rows.pop();
  return rows.join("\n");
}
async function unzipEntryBytes(u8,want){
  // Мінімальний пошук одного entry за точним ім'ям або регексом у ZIP.
  // Декомпресія — тільки через загартоване inflateRaw (zip-bomb safe).
  if(!globalThis.ZipSafetyCore)throw new Error("ZIP safety core is unavailable.");
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),eocd=findEOCD(u8);
  if(eocd<0)throw new Error("ZIP structure not found");
  const match=name=>typeof want==="string"?name===want:want.test(name);
  const entries=dv.getUint16(eocd+10,true),cdOffset=dv.getUint32(eocd+16,true);let p=cdOffset;
  for(let i=0;i<entries&&p+46<=u8.length;i++){
    if(dv.getUint32(p,true)!==0x02014b50)break;
    const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),uncomp=dv.getUint32(p+24,true);
    const nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
    const encrypted=(dv.getUint16(p+8,true)&1)===1;
    const name=new TextDecoder().decode(u8.slice(p+46,p+46+nameLen));
    p+=46+nameLen+extraLen+commentLen;
    if(!match(name))continue;
    if(encrypted)throw new Error("entry is encrypted");
    if(uncomp>ZIP_MAX_ENTRY_DECOMPRESSED)throw new Error("entry too large");
    if(local+30>u8.length||dv.getUint32(local,true)!==0x04034b50)throw new Error("bad local header");
    const ln=dv.getUint16(local+26,true),le=dv.getUint16(local+28,true),start=local+30+ln+le,end=start+compSize;
    if(end>u8.length)throw new Error("truncated entry");
    if(method===0)return u8.slice(start,end);
    if(method===8)return await inflateRaw(u8.slice(start,end),ZIP_MAX_ENTRY_DECOMPRESSED);
    throw new Error("unsupported compression method");
  }
  return null;
}
async function extractDocxText(file){
  const u8=new Uint8Array(await file.arrayBuffer());
  let xml;try{xml=await unzipEntryBytes(u8,"word/document.xml")}catch(e){throw new Error(t("docBroken",{name:file.name,fmt:"DOCX"}))}
  if(!xml)throw new Error(t("docBroken",{name:file.name,fmt:"DOCX"}));
  const text=parseDocxXml(new TextDecoder("utf-8",{fatal:false}).decode(xml));
  if(!text)throw new Error(t("docNoText",{name:file.name}));
  return text;
}
async function extractXlsxText(file){
  const u8=new Uint8Array(await file.arrayBuffer());
  let ss=null,sheet=null;
  try{
    ss=await unzipEntryBytes(u8,"xl/sharedStrings.xml");
    sheet=await unzipEntryBytes(u8,"xl/worksheets/sheet1.xml")||await unzipEntryBytes(u8,/^xl\/worksheets\/sheet\d+\.xml$/);
  }catch(e){throw new Error(t("docBroken",{name:file.name,fmt:"XLSX"}))}
  if(!sheet)throw new Error(t("docBroken",{name:file.name,fmt:"XLSX"}));
  const dec=new TextDecoder("utf-8",{fatal:false});
  const text=parseXlsxXml(ss?dec.decode(ss):"",dec.decode(sheet));
  if(!text)throw new Error(t("docNoText",{name:file.name}));
  return text;
}
let pdfjsLibPromise=null;
function loadPdfJs(){
  // Ліниве завантаження завендореного pdf.js (same-origin, без CDN).
  if(!pdfjsLibPromise)pdfjsLibPromise=import("./vendor/pdfjs/pdf.min.mjs").then(lib=>{lib.GlobalWorkerOptions.workerSrc="./vendor/pdfjs/pdf.worker.min.mjs";return lib});
  return pdfjsLibPromise;
}
async function extractPdfText(file){
  setFileProcessingStatus("busy",t("docExtracting",{name:file.name}));
  const pdfjsLib=await loadPdfJs();
  let pdf;
  try{pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise}
  catch(e){
    if(e&&(e.name==="PasswordException"||/password/i.test(String(e?.message||""))))throw new Error(t("docPdfLocked",{name:file.name}));
    throw new Error(t("docBroken",{name:file.name,fmt:"PDF"}));
  }
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const tc=await page.getTextContent();
    pages.push(tc.items.map(it=>String(it.str||"")).join(" "));
    if(i%5===0)await new Promise(r=>setTimeout(r,0)); // дати мобільному UI дихнути
  }
  try{await pdf.destroy()}catch(e){}
  const text=pages.join("\n\n").replace(/[ \t]+\n/g,"\n").trim();
  if(!text)throw new Error(t("docNoText",{name:file.name}));
  return text;
}
function isSupportedPickedFile(f){
  const name=String(f?.name||"");
  const type=String(f?.type||"").toLowerCase();
  if(/\.zip$/i.test(name))return true;
  if(/\.(pdf|docx|xlsx)$/i.test(name))return true;
  if(isTextPath(name))return true;
  return type.startsWith("text/")||["application/json","application/xml","application/javascript","text/javascript"].includes(type);
}
function setFileProcessingStatus(kind="",message=""){
  const el=$("fileProcessingStatus");if(!el)return;
  el.className=`fileProcessingStatus${kind?` ${kind}`:""}`;el.textContent=message;
}
async function handleFiles(fileList){
  const picked=[...fileList],errors=[];let added=0;
  if(!picked.length)return;
  setFileProcessingStatus("busy",t("fileProcessingStart",{n:picked.length}));
  for(let index=0;index<picked.length;index++){
    const f=picked[index];
    try{
      setFileProcessingStatus("busy",t("fileProcessingItem",{current:index+1,total:picked.length,name:f.name}));
      if(f.size>20_000_000)throw new Error("ZIP/file is too large. Max 20 MB.");
      if(!isSupportedPickedFile(f))throw new Error("Unsupported file type. Choose ZIP, PDF, DOCX, XLSX, code, TXT, MD, JSON, HTML, CSS, Python or another text file.");
      const lowerName=f.name.toLowerCase();
      if(lowerName.endsWith(".pdf")||lowerName.endsWith(".docx")||lowerName.endsWith(".xlsx")){
        // v5.11.66: документи — текст витягується локально, на пристрої.
        const fmt=lowerName.endsWith(".pdf")?"PDF":lowerName.endsWith(".docx")?"DOCX":"XLSX";
        const text=lowerName.endsWith(".pdf")?await extractPdfText(f):lowerName.endsWith(".docx")?await extractDocxText(f):await extractXlsxText(f);
        const prepared=sampleLargeFileText(text,MAX_FILE_CHARS);
        attachments.push({name:f.name,kind:"doc",fmt,size:f.size,files:[{name:f.name,text:prepared.text,truncated:prepared.truncated,originalChars:prepared.originalChars}],chars:prepared.text.length});
      }else if(f.name.toLowerCase().endsWith(".zip")){
        const files=await unzipTextOffMainThread(f,p=>{if(p.phase==="extracting")setFileProcessingStatus("busy",t("fileProcessingZip",{name:f.name,done:p.done,total:p.total}))});
        if(!files.length)throw new Error(t("fileNoUsableText"));
        const chars=files.reduce((n,x)=>n+x.text.length,0);
        attachments.push({name:f.name,kind:"zip",size:f.size,files,manifestNames:files.manifestNames||files.map(x=>x.name),chars,stats:files.stats||null});
      }else{
        const prepared=sampleLargeFileText(await f.text(),MAX_FILE_CHARS);
        attachments.push({name:f.name,kind:"text",size:f.size,files:[{name:f.name,text:prepared.text,truncated:prepared.truncated,originalChars:prepared.originalChars}],chars:prepared.text.length});
      }
      added++;
    }catch(e){errors.push(`${f.name}: ${e?.message||e}`)}
  }
  enforceContextLimit();renderFiles();
  if(errors.length)setFileProcessingStatus("bad",t("fileProcessingErrors",{added,errors:errors.join(" • ")}));
  else setFileProcessingStatus("ok",t("fileProcessingDone",{n:added}));
}
function enforceContextLimit(){
  for(const a of attachments){
    // Keep every extracted excerpt when another attachment is added. The
    // request-specific selection is made in buildFileContext(), so removing
    // one file can never permanently erase the other uploads.
    a.chars=(a.files||[]).reduce((n,x)=>n+x.text.length,0);
  }
}
// BUG FIX (v4.5.9, forged file-boundary injection): attached file content
// (from a ZIP entry or a plain uploaded file) was wrapped verbatim into
// <file path="...">...</file> blocks sent to the models. A file whose own
// content contained a literal "</file>" followed by "<file path=\"...\">"
// could impersonate a fake file boundary, confusing which text the model
// attributes to which file (same bug class fixed server-side in v4.5.8/9).
function neutralizeEmbeddedFileTags(text){
  // Source files may themselves contain Bridge markup strings (AI Bridge's own
  // app.js contains <attached_files>, for example). Neutralize every structural
  // control tag inside file CONTENT so it cannot terminate/reopen the outer
  // prompt envelope or impersonate the authoritative user task.
  return String(text||"").replace(/<(\/?(?:file|attached_files|user_task|bridge_response_contract|bridge_retry|original_task|peer_answers|verification_context)\b)/gi,"<\u200b$1")
    // v5.8.0 second pass: chat-template/role tags used for prompt injection.
    .replace(/<(\/?(?:user_goal|mentor_doctrine|draft_answer|evidence|agent_observations|system|assistant|user|developer|instructions?|tool|function_calls?|im_start|im_end)\b)/gi,"<\u200b$1");
}
function safeFileLabel(name){
  // File names are attacker-controlled (ZIP entries): no markup, quotes,
  // control characters or traversal segments inside the path attribute.
  const n=globalThis.ZipSafetyCore?.normalizeEntryName?globalThis.ZipSafetyCore.normalizeEntryName(name):String(name||"");
  return n.replace(/[\u0000-\u001f\u007f<>"'`]/g,"_").slice(0,240)||"file";
}
function buildFileContext(){
  // v5.9.1: optional {task, only} argument (kept out of the signature for
  // compatibility). Files are ranked by relevance to the user's task, then
  // packed in two passes: deep excerpts for the most relevant files, short
  // excerpts for the rest, so far more files reach the model per request.
  const opts=arguments[0]||{};
  if(!attachments.some(a=>a.files?.length))return "";
  const budget=MAX_CONTEXT_CHARS-22000,terms=fileTaskTerms(opts.task),only=opts.only||null;
  const ranked=rankAttachmentFiles(terms).filter(x=>!only||only.has(x.key));
  const rows=[],included=new Set();let used=0;
  const firstOfGroup=new Set();const seed=[];
  for(const x of ranked)if(!firstOfGroup.has(x.gi)){firstOfGroup.add(x.gi);seed.push(x)}
  const order=[...seed,...ranked.filter(x=>!seed.includes(x))];
  const pack=(x,cap)=>{
    if(included.has(x.key))return;
    const remaining=budget-used;if(remaining<256)return;
    const f=x.f,path=safeFileLabel(f.name);
    const excerpt=taskAwareExcerpt(f.text,terms,Math.max(0,Math.min(cap,remaining-140)));
    const text=neutralizeEmbeddedFileTags(excerpt.text);
    const row=`<file path="${path}"${f.truncated||excerpt.truncated||text.length<f.text.length?' truncated="true"':''} retrieval="${excerpt.mode}">\n${text}\n</file>`;
    if(row.length>remaining)return;
    rows.push(row);included.add(x.key);used+=row.length;
  };
  // v5.9.4 BUG FIX: Deep Scan parts are planned by each file's full retained
  // size (up to ZIP_FILE_SAMPLE_CHARS = 180k), but were then packed with the
  // 36k single-request cap, so ~75% of every large file (its middle) was never
  // sent while the UI reported full coverage. Deep Scan now sends whole files.
  const deepCap=only?ZIP_FILE_SAMPLE_CHARS:36000,shallowCap=only?ZIP_FILE_SAMPLE_CHARS:6000;
  for(const x of order){if(used>=budget*0.6&&!only)break;pack(x,deepCap)}
  for(const x of order)pack(x,shallowCap);
  const manifest=attachments.map((a,i)=>{
    const names=a.manifestNames||a.files.map(f=>f.name),selected=a.files.filter(f=>included.has(`${i}:${f.name}`)).length;
    return `${safeFileLabel(a.name)}: ${selected}/${names.length} file excerpts included. Text-file paths: ${names.map(safeFileLabel).join(', ')}`;
  }).join("\n").slice(0,19000);
  return `\n\n<attached_files coverage="partial">\n<archive_inventory>\n${neutralizeEmbeddedFileTags(manifest)}\n</archive_inventory>\n${rows.join("\n")}\n</attached_files>`;
}
const FILE_TASK_STOPWORDS=new Set("the and for with this that from into what how why are you your all file files code project please check find fix make give tell need want about його цей цього файл файли код проєкт проект перевір знайди виправ зроби дай скажи треба мені який яка які що щоб для або також этот файл код проект проверь найди исправь сделай дай скажи нужно".split(" "));
function fileTaskTerms(task){
  return [...new Set((String(task||"").toLowerCase().match(/[\p{L}\p{N}_.\-]{3,}/gu)||[]).map(w=>w.replace(/^[.\-]+|[.\-]+$/g,"")).filter(w=>w.length>=3&&!FILE_TASK_STOPWORDS.has(w)))].slice(0,40);
}
function taskAwareExcerpt(value,terms=[],cap=36000){
  const text=String(value||"");cap=Math.max(0,Number(cap)||0);
  if(!cap||!text)return {text:"",truncated:text.length>0,mode:"empty"};
  if(text.length<=cap)return {text,truncated:false,mode:"full"};
  const normalizedTerms=[...new Set((terms||[]).map(x=>String(x||"").toLowerCase()).filter(x=>x.length>=3))].slice(0,24);
  if(!normalizedTerms.length){
    const head=Math.floor(cap*0.62),tail=Math.max(0,cap-head-80);
    return {text:`${text.slice(0,head)}\n\n[... middle omitted ...]\n\n${text.slice(-tail)}`,truncated:true,mode:"head-tail"};
  }
  const lower=text.toLowerCase(),hits=[];
  for(const term of normalizedTerms){
    let from=0,count=0;while(count<8){const i=lower.indexOf(term,from);if(i<0)break;hits.push(i);from=i+Math.max(1,term.length);count++}
  }
  hits.sort((a,b)=>a-b);
  const dedup=[];for(const h of hits)if(!dedup.length||h-dedup.at(-1)>1200)dedup.push(h);
  if(!dedup.length){
    const head=Math.floor(cap*0.62),tail=Math.max(0,cap-head-80);
    return {text:`${text.slice(0,head)}\n\n[... middle omitted ...]\n\n${text.slice(-tail)}`,truncated:true,mode:"head-tail"};
  }
  const pieces=[],reserve=Math.min(5000,Math.floor(cap*0.16)),windowBudget=Math.max(0,cap-reserve-240),per=Math.max(900,Math.floor(windowBudget/Math.min(dedup.length,8)));
  pieces.push(text.slice(0,Math.min(reserve,text.length)));
  for(const h of dedup.slice(0,8)){
    const half=Math.floor(per/2),start=Math.max(0,h-half),end=Math.min(text.length,start+per);
    pieces.push(`\n\n[... relevant window @${start} ...]\n${text.slice(start,end)}`);
  }
  let out=pieces.join("");
  if(out.length>cap)out=out.slice(0,cap);
  return {text:out,truncated:true,mode:"task-windows"};
}
function rankAttachmentFiles(terms=[]){
  const out=[];
  attachments.forEach((a,gi)=>(a.files||[]).forEach((f,fi)=>{
    const name=String(f.name||"").toLowerCase(),body=String(f.text||"").toLowerCase();
    let score=Number.isFinite(f.priority)?f.priority:(typeof priorityPath==="function"?priorityPath(name):0);
    for(const t of terms){
      if(name.includes(t))score+=60;
      let n=0,idx=body.indexOf(t);while(idx>=0&&n<8){n++;idx=body.indexOf(t,idx+t.length)}
      score+=n*6;
    }
    out.push({gi,fi,f,key:`${gi}:${f.name}`,score,order:out.length});
  }));
  return out.sort((a,b)=>b.score-a.score||a.order-b.order);
}
/* Deep Scan: split every extracted file into request-sized parts (ranked by
   relevance), so a large ZIP is read completely instead of silently sampled. */
const DEEP_SCAN_MAX_PARTS=10;
function planDeepScanParts(task){
  const ranked=rankAttachmentFiles(fileTaskTerms(task)),budget=MAX_CONTEXT_CHARS-40000,parts=[];let cur=new Set(),size=0;
  for(const x of ranked){
    const est=Math.min(String(x.f.text||"").length,ZIP_FILE_SAMPLE_CHARS)+300;
    if(size+est>budget&&cur.size){parts.push(cur);cur=new Set();size=0}
    cur.add(x.key);size+=est;
  }
  if(cur.size)parts.push(cur);
  return {parts:parts.slice(0,DEEP_SCAN_MAX_PARTS),totalParts:parts.length,files:ranked.length};
}
async function readApiJson(r){
  const text=await r.text();
  if(!text.trim())return {};
  try{return JSON.parse(text)}catch(e){
    return {error:t("errBadJson",{status:r.status,text:text.slice(0,240).replace(/\s+/g," ")}),rawResponse:true};
  }
}
function mobileNetworkErrorMessage(e,streamStarted=false){
  const raw=String(e?.message||e||"");
  if(/load failed|failed to fetch|networkerror|network request failed|connection.*lost/i.test(raw)){
    return streamStarted
      ? t("errConnLost")
      : t("errConnFailed");
  }
  return raw||t("errNetworkUnknown");
}
// ---------- Resumable job lifecycle (client side, v4.9.2) ----------
// Root cause of the old "Мобільне з'єднання перервалося" dead end: the
// server used to tie the whole AI Team run to this one HTTP connection, so
// a dropped Safari/5G socket actually killed the job even though the old
// message claimed otherwise. The server now runs every job independently
// of any single connection (see _worker.js) and hands back a jobId in the
// very first stream frame. This pending-job marker is written to
// localStorage BEFORE the request is even sent, so a reload/reconnect at
// any point can resume the SAME job — never resubmit it.
const PENDING_JOB_KEY="ai_bridge_pending_job";
const PENDING_JOB_MAX_AGE_MS=45*60*1000;
function newRequestId(){return (self.crypto?.randomUUID?.())||`${Date.now()}-${Math.random().toString(16).slice(2)}`}
function savePendingJob(rec){try{localStorage.setItem(PENDING_JOB_KEY,JSON.stringify(rec))}catch(e){}}
function loadPendingJob(){try{const raw=localStorage.getItem(PENDING_JOB_KEY);const j=raw?JSON.parse(raw):null;return j&&j.clientRequestId?j:null}catch(e){return null}}
function updatePendingJob(patch){const cur=loadPendingJob();if(cur)savePendingJob({...cur,...patch})}
function clearPendingJob(){const cur=loadPendingJob();try{localStorage.removeItem(PENDING_JOB_KEY)}catch(e){}if(cur?.clientRequestId)deletePendingPayload(cur.clientRequestId)}
// v5.8.0: keep the submitted payload (bounded, same device only, IndexedDB) so
// a job the server lost (Worker isolate restart; the status API reports
// "stale"/"unknown" with resubmit:true) can be restarted ONCE with the same
// clientRequestId. The server de-duplicates by that id, so this can never
// start a second parallel run of a live job.
const PENDING_PAYLOAD_MAX_CHARS=3_000_000;
function openPendingDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open("AI_Bridge_Pending",1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("p"))db.createObjectStore("p")};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function savePendingPayload(id,payload){try{const raw=JSON.stringify(payload);if(raw.length>PENDING_PAYLOAD_MAX_CHARS)return false;const db=await openPendingDB();await new Promise((res,rej)=>{const tx=db.transaction("p","readwrite");tx.objectStore("p").put({raw,savedAt:Date.now()},id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});return true}catch(e){return false}}
async function loadPendingPayload(id){try{const db=await openPendingDB();const v=await new Promise((res,rej)=>{const q=db.transaction("p","readonly").objectStore("p").get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});return v?.raw?JSON.parse(v.raw):null}catch(e){return null}}
async function deletePendingPayload(id){try{const db=await openPendingDB();db.transaction("p","readwrite").objectStore("p").delete(id)}catch(e){}}
async function resubmitPendingJob(clientRequestId){
  const payload=await loadPendingPayload(clientRequestId);if(!payload)return null;
  try{const r=await fetch("/api/job/submit",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},cache:"no-store",body:JSON.stringify({...payload,clientRequestId})});const j=await readApiJson(r);return j?.jobId?j:null}catch(e){return null}
}
async function pollJobStatus(jobId,{onWaiting,clientRequestId}={}){
  // GET-only recovery. If Safari died before the first stream frame, the
  // deterministic clientRequestId lets the Worker recover the same jobId.
  const startedAt=Date.now(),unknownGraceMs=20000;
  let delay=1000,resubmitted=false;
  const tryResubmit=async()=>{
    if(resubmitted||!clientRequestId)return false;resubmitted=true;
    onWaiting?.("resubmitting");
    const j=await resubmitPendingJob(clientRequestId);
    if(j?.jobId){jobId=j.jobId;updatePendingJob({jobId,resubmittedAt:Date.now()});return true}
    return false;
  };
  while(Date.now()-startedAt<10*60*1000){
    let r;
    const q=jobId?`jobId=${encodeURIComponent(jobId)}`:`clientRequestId=${encodeURIComponent(clientRequestId||"")}`;
    try{
      r=await fetch(`/api/job/status?${q}`,{headers:authHeaders(),cache:"no-store"});
    }catch(e){
      onWaiting?.("reconnecting");
      await new Promise(res=>setTimeout(res,delay));delay=Math.min(delay*1.5,8000);continue;
    }
    if(r.status===401||r.status===403)return {ok:false,status:r.status,j:await readApiJson(r),terminal:false};
    if(r.status===404){
      const j=await readApiJson(r);
      if(j?.jobId&&!jobId){jobId=j.jobId;updatePendingJob({jobId})}
      if(Date.now()-startedAt<unknownGraceMs){
        onWaiting?.("reconnecting");
        await new Promise(res=>setTimeout(res,Math.max(500,Number(j?.retryAfterMs||delay))));
        delay=Math.min(delay*1.4,5000);continue;
      }
      if(j?.resubmit&&await tryResubmit())continue;
      return {ok:false,status:404,j:{...j,error:t("errJobNotFound")},terminal:true};
    }
    const j=await readApiJson(r);
    if(j?.jobId&&!jobId){jobId=j.jobId;updatePendingJob({jobId})}
    // BUG FIX (v5.9.0): the server may send `error` as a plain string; passing
    // it through unchanged made the UI show only "HTTP 409" instead of the reason.
    if(j.status==="stale"){if(await tryResubmit())continue;const err=typeof j.error==="string"?{error:j.error,errorKind:"job_stale"}:(j.error||{error:"The server lost this task.",errorKind:"job_stale"});return {ok:false,status:409,j:err,streamed:true,terminal:true}}
    if(j.status==="done")return {ok:true,status:200,j:j.result||{},streamed:true,terminal:true};
    if(j.status==="error")return {ok:false,status:Number(j.error?.status||500),j:j.error||{error:"Bridge job failed."},streamed:true,terminal:true};
    if(!r.ok)return {ok:false,status:r.status,j,terminal:false};
    onWaiting?.(j?.progress?{state:"processing",progress:j.progress}:"processing");
    await new Promise(res=>setTimeout(res,delay));delay=Math.min(delay*1.3,5000);
  }
  return {ok:false,status:0,j:{error:t("errJobNoFinal")},terminal:false};
}
async function legacyRunRequest(payload){
  const r=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},cache:"no-store",body:JSON.stringify(payload)});
  const j=await readApiJson(r);
  if(r.status===202&&j?.jobId){
    updatePendingJob({jobId:j.jobId});
    return pollJobStatus(j.jobId,{clientRequestId:payload?.clientRequestId});
  }
  return {ok:r.ok,status:r.status,j,streamed:false,terminal:r.status!==202};
}
async function streamingRunRequest(payload,onState=null){
  let r;
  try{
    r=await fetch("/api/run-stream",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders(),"Accept":"application/x-ndjson"},cache:"no-store",body:JSON.stringify(payload)});
  }catch(e){
    // If the streaming endpoint could not even establish a response, no
    // job was ever created server-side (the job is created inside that
    // handler before the first byte is written), so one legacy attempt is
    // safe: it goes through /api/run which is idempotent on clientRequestId.
    try{return await legacyRunRequest(payload)}catch(e2){throw new Error(mobileNetworkErrorMessage(e2,false))}
  }
  const ct=(r.headers.get("content-type")||"").toLowerCase();
  if((r.status===404||r.status===405)||!ct.includes("application/x-ndjson")||!r.body?.getReader){
    if(r.status===401||r.status===403||r.status===413||r.status===503)return {ok:r.ok,status:r.status,j:await readApiJson(r),streamed:false,terminal:false};
    return legacyRunRequest(payload);
  }
  if(!r.ok)return {ok:false,status:r.status,j:await readApiJson(r),streamed:false,terminal:false};

  const reader=r.body.getReader(),decoder=new TextDecoder();
  let buf="",streamStarted=false,final=null,jobId=null;
  const onEvent=ev=>{
    if(ev.jobId&&ev.jobId!==jobId){jobId=ev.jobId;updatePendingJob({jobId});}
    if(ev.type==="start"){streamStarted=true;onState?.("accepted")}
    else if(ev.type==="heartbeat"){streamStarted=true;onState?.(ev.progress?{state:"processing",progress:ev.progress}:"processing")}
    else if(ev.type==="result")final={ok:true,status:200,j:ev.data||{},streamed:true,terminal:true};
    else if(ev.type==="error"&&ev.data?.resubmit)final={staleResubmit:true};
    else if(ev.type==="error")final={ok:false,status:Number(ev.status||500),j:ev.data||{error:"Bridge stream error"},streamed:true,terminal:true};
  };
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buf+=decoder.decode(value,{stream:true});
      let nl;
      while((nl=buf.indexOf("\n"))>=0){
        const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);
        if(!line)continue;
        try{onEvent(JSON.parse(line))}catch(e){}
      }
    }
    const tail=(buf+decoder.decode()).trim();if(tail)try{onEvent(JSON.parse(tail))}catch(e){}
  }catch(e){
    // The client connection dropped mid-stream (Safari/5G). The job itself
    // is NOT tied to this connection — the server keeps it running
    // independently — so recover by polling /api/job/status instead of
    // asking the user to press Send again.
    if(final)return final;
    if(jobId){onState?.("reconnecting");return await pollJobStatus(jobId,{onWaiting:onState,clientRequestId:payload?.clientRequestId})}
    throw new Error(mobileNetworkErrorMessage(e,streamStarted));
  }
  if(final?.staleResubmit)return await pollJobStatus(jobId,{onWaiting:onState,clientRequestId:payload?.clientRequestId});
  if(final)return final;
  if(jobId){onState?.("reconnecting");return await pollJobStatus(jobId,{onWaiting:onState,clientRequestId:payload?.clientRequestId})}
  throw new Error(streamStarted?t("errConnClosedEarly"):t("errNoBridgeResponse"));
}
/* v5.11.97: коли ВСІ хмарні моделі відмовили — ядро підхоплює розмову локально,
   а не показує сухий "INVALID API KEY • HTTP 401". */
const FAIL_FIX_KEYS={invalid_api_key:"fixInvalidKey",billing_or_quota:"fixBilling",rate_limited:"fixRate",permission_denied:"fixPermission",model_unavailable:"fixModel",timeout:"fixTimeout",provider_unavailable:"fixDown"};
function providersFailedReport(j,statusCode,prompt,opts){
  if([401,404,503].includes(Number(statusCode))||(Number(statusCode)===409&&j?.errorKind==="job_stale"))return null;
  const bad=(j?.results||[]).filter(r=>!r.ok&&!r.cancelled&&r.errorKind!=="cancelled"&&Number(r.status)!==499);
  if(!bad.length)return null;
  const groups=new Map();
  for(const r of bad){
    const key=FAIL_FIX_KEYS[r.errorKind]||"fixOther",name=PROVIDERS[r.provider]?.name||String(r.provider||"AI");
    if(!groups.has(key))groups.set(key,[]);
    if(!groups.get(key).includes(name))groups.get(key).push(name);
  }
  const fixes=[...groups].map(([key,names])=>`- **${names.join(", ")}** — ${t(key)}`);
  let core=null;
  if(opts?.tryCore&&prompt){try{core=askCore(prompt,opts.context||"","")}catch(e){core=null}}
  const rescued=!!(core&&core.handled&&core.text);
  const parts=[];
  if(rescued)parts.push(`**${t("coreRescueTitle")}**\n\n${core.text}\n\n---`);
  parts.push(`**${t("errProvidersFailed")}**\n\n${fixes.join("\n")}`);
  if(!rescued&&opts?.tryCore)parts.push(`_${t("coreRescueNone")}_`);
  parts.push(`_${t("fixTech")}: ${bad.map(r=>`${PROVIDERS[r.provider]?.name||r.provider} ${providerErrorLabel(r.errorKind)} ${r.status||"—"}`).join(" · ")}_`);
  return {final:parts.join("\n\n"),rescued,coreIntent:core?.intent||null};
}
function providerErrorLabel(kind){return ({cancelled:t("peerCancelled"),billing_or_quota:"NO CREDITS / QUOTA",rate_limited:"RATE LIMIT — RETRY LATER",invalid_api_key:"INVALID API KEY",permission_denied:"PERMISSION DENIED",model_unavailable:"MODEL UNAVAILABLE",timeout:"TIMEOUT",provider_unavailable:"PROVIDER UNAVAILABLE",request_failed:"REQUEST FAILED"})[kind]||String(kind||"ERROR").replaceAll("_"," ").toUpperCase()}
function friendlyRunError(j,statusCode){
  if(statusCode===401){
    // v5.10.4: the session cookie is host-only — a session created on the main
    // domain is never sent to a deploy-preview host (https://<hash>.aibridge-aff.pages.dev).
    const h=String(location.hostname||""),onPreview=/^[a-f0-9]{8}\.aibridge-aff\.pages\.dev$/.test(h);
    if(onPreview)return t("errPreviewDomain",{h});
    return t("errSessionInvalid");
  }
  if(statusCode===404)return String(j?.error||t("errJobGone")).slice(0,500);
  if(statusCode===503&&j?.setupRequired)return t("errNoServerToken");
  if(statusCode===409&&j?.errorKind==="job_stale")return t("errServerRestarted");
  const rows=(j?.results||[]).filter(r=>!r.ok&&!r.cancelled&&r.errorKind!=="cancelled"&&Number(r.status)!==499).map(r=>`${PROVIDERS[r.provider]?.name||r.provider}: ${providerErrorLabel(r.errorKind)} • HTTP ${r.status||"—"}`);
  return [rows.length?`${t("errProvidersFailed")} (AI providers could not complete this request.)`:friendlyErrorHeader(statusCode,j),...rows].filter(Boolean).join("\n");
}
/* v5.9.1: plain-language errors instead of raw "502", "Load failed" or HTML. */
function friendlyErrorHeader(statusCode,j={}){
  const kind=String(j?.errorKind||"");
  if(statusCode===429||kind==="rate_limited"||kind==="billing_or_quota")return t("errRateLimit");
  if(statusCode===413)return t("errTooLarge");
  if(statusCode===504||statusCode===408||kind==="timeout")return t("errTimeout");
  if(statusCode===0)return t("errNetwork");
  if(j?.rawResponse||statusCode===502||statusCode===503||statusCode===520||statusCode===522||statusCode===524)return `${t("errUpstream")} (HTTP ${statusCode})`;
  if(j?.error&&String(j.error).length<=300)return String(j.error);
  return kind?providerErrorLabel(kind):`HTTP ${statusCode}`;
}
/* v5.11.23: згадки моделей (@модель) — одноразовий оверрайд вибору моделі прямо
   в тексті повідомлення. «@groq поясни це» йде тільки до Groq Free, всупереч
   поточному вибору роутера M2. Невідомі @нікнейми (не моделі) не чіпаються. */
const MENTION_ALIASES={openai:["openai","gpt"],claude:["claude"],gemini:["gemini"],grok:["grok","xai"],groqfree:["groq"],openrouter:["openrouter","router"]};
function resolveMentionAlias(a){a=String(a||"").toLowerCase();for(const[id,als]of Object.entries(MENTION_ALIASES))if(als.includes(a))return id;return null}
function parseModelMention(text){
  const m=/(^|[\s([{])@([A-Za-z][\w-]*)/.exec(String(text||""));
  if(!m)return null;
  const id=resolveMentionAlias(m[2]);
  if(!id)return null; // не модель — звичайний текст/нікнейм, не чіпаємо
  return {provider:id,token:m[0],lead:m[1]};
}
function stripMention(text,mention){return String(text).replace(mention.token,mention.lead).replace(/[ \t]{2,}/g," ").trim()}
function mentionSuggestions(q){
  q=String(q||"").toLowerCase();
  return Object.keys(PROVIDERS).filter(id=>(MENTION_ALIASES[id]||[]).some(a=>a.startsWith(q)));
}
function wireMentionAutocomplete(){
  const box=$("mentionBox"),p=$("prompt");
  if(!box||!p||box._wired)return;box._wired=true;
  const hide=()=>{box.classList.add("hidden");box.innerHTML=""};
  p.addEventListener("input",()=>{
    const pos=p.selectionStart??p.value.length,before=p.value.slice(0,pos);
    const m=/(^|[\s([{])@([\p{L}\p{N}_-]*)$/u.exec(before);
    if(!m){hide();return}
    const sug=mentionSuggestions(m[2]);
    if(!sug.length){hide();return}
    box.innerHTML=sug.map(id=>`<button type="button" class="mentionItem" data-mention="${id}"><b>@${esc((MENTION_ALIASES[id]||[id])[0])}</b><span>${esc(PROVIDERS[id]?.name||id)}</span><small>${esc(PROVIDERS[id]?.note||"")}</small></button>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll("[data-mention]").forEach(b=>b.onmousedown=e=>e.preventDefault());
    box.querySelectorAll("[data-mention]").forEach(b=>b.onclick=()=>{
      const alias=(MENTION_ALIASES[b.dataset.mention]||[b.dataset.mention])[0];
      const insert=before.slice(0,before.length-m[2].length-1)+"@"+alias+" ";
      p.value=insert+p.value.slice(pos);
      try{p.setSelectionRange(insert.length,insert.length)}catch(_){}
      hide();try{p.focus()}catch(_){}
    });
  });
  p.addEventListener("keydown",e=>{if(e.key==="Escape"&&!box.classList.contains("hidden")){e.stopPropagation();hide()}});
  p.addEventListener("blur",()=>setTimeout(hide,180));
}
/* v5.11.68: згадки минулих чатів (@@контекст, ідея scout). Введення @@ у полі
   вводу чату відкриває пошук по історії діалогів; вибраний чат прикріплюється
   як контекст до поточного запиту (чип над композером, ✕ — відкріпити).
   Контекст іде ТІЛЬКИ в мережевий промпт (структурний конверт <PAST CHAT>);
   в історію записується лише короткий слід ctxChats на записі діалогу.
   Не конфліктує з @згадками моделей: @@ не матчить parseModelMention. */
const CTX_MENTION_MAX_SUGGEST=6,CTX_MENTION_DIGEST_MAX=3000;
let ctxMentionAttached=null,ctxRunsCache=null; // {runId,title,digest}
/* Чиста: перший токен @@query у тексті (для strip/тестів). */
function parseCtxMention(text){
  const m=/(^|[\s([{])@@([\p{L}\p{N}_.-]{0,60})/u.exec(String(text||""));
  if(!m)return null;
  return {token:m[0],lead:m[1],query:m[2]||""};
}
function stripCtxMention(text,mention){return String(text||"").replace(mention.token,mention.lead).replace(/[ \t]{2,}/g," ").trim()}
/* Чиста: токен @@query в кінці тексту перед кареткою (для автодоповнення). */
function ctxMentionTokenAtEnd(before){
  const m=/(^|[\s([{])@@([\p{L}\p{N}_.-]{0,60})$/u.exec(String(before||""));
  return m?{query:m[2]||""}:null;
}
function ctxRunTitle(r){return String(r?.title||r?.prompt||"").split("\n")[0].replace(/\s+/g," ").trim().slice(0,120)||t("ctxMentionUntitled")}
function ctxRunSnippet(r){return String(r?.prompt||"").replace(/\s+/g," ").trim().slice(0,80)}
/* Чиста: стислий контекст минулого діалогу (питання + відповідь, кап 3000). */
function ctxRunDigest(r){
  let s=String(r?.prompt||"")+(r?.final?`\n\n${r.final}`:"");
  s=s.replace(/\s+/g," ").trim();
  if(s.length>CTX_MENTION_DIGEST_MAX)s=s.slice(0,CTX_MENTION_DIGEST_MAX).trim()+"…";
  return s;
}
/* Чиста: фільтр за запитом + ранжування (точний початок назви → збіг у назві →
   збіг у тексті → свіжіші першими). Порожній запит — просто останні діалоги. */
function ctxSuggestRuns(runs,q,excludeUid){
  const query=String(q||"").toLowerCase().trim();
  const scored=[];
  for(const r of runs||[]){
    if(!r||(excludeUid&&String(r.uid||"")===String(excludeUid)))continue;
    // Контекст будується з prompt/final — діалог лише з назвою без тексту
    // нічого не дасть, його не пропонуємо.
    if(!String(r.prompt||"").trim()&&!String(r.final||"").trim())continue;
    const title=String(r.title||"").toLowerCase();
    const hay=`${r.title||""} ${r.prompt||""} ${r.final||""}`.toLowerCase();
    let rank=-1;
    if(!query)rank=0;
    else if(title.startsWith(query))rank=0;
    else if(title.includes(query))rank=1;
    else if(hay.includes(query))rank=2;
    if(rank>=0)scored.push({r,rank,ts:Number(r.updated||r.created)||0});
  }
  scored.sort((a,b)=>a.rank-b.rank||b.ts-a.ts);
  return scored.slice(0,CTX_MENTION_MAX_SUGGEST).map(x=>x.r);
}
/* Конверт для мережевого промпта. Пусто — коли нічого не прикріплено. */
function ctxNetBlock(){
  const a=ctxMentionAttached;
  if(!a||!a.digest)return "";
  const title=String(a.title||"").replace(/["<>]/g,"").slice(0,120);
  return `\n\n<PAST CHAT title="${title}">\n${a.digest}\n</PAST CHAT>`;
}
function ctxMentionLen(){return ctxNetBlock().length}
function wireCtxMentionAutocomplete(){
  const box=$("ctxMentionBox"),p=$("prompt");
  if(!box||!p||box._wired)return;box._wired=true;
  let sug=[];
  const hide=()=>{box.classList.add("hidden");box.innerHTML=""};
  p.addEventListener("input",()=>{
    const tk=ctxMentionTokenAtEnd(p.value.slice(0,p.selectionStart??p.value.length));
    if(!tk||ctxMentionAttached){hide();return}
    (async()=>{
      try{
        if(!ctxRunsCache)ctxRunsCache=await getRuns(300);
        sug=ctxSuggestRuns(ctxRunsCache,tk.query,typeof viewedRunUid!=="undefined"?viewedRunUid:null);
        if(!sug.length){box.innerHTML=`<div class="mentionEmpty">${esc(t("ctxMentionEmpty"))}</div>`;box.classList.remove("hidden");return}
        box.innerHTML=sug.map((r,idx)=>`<button type="button" class="mentionItem" data-ctx="${idx}"><b>@@</b><span>${esc(ctxRunTitle(r))}</span><small>${esc(ctxRunSnippet(r))}</small></button>`).join("");
        box.classList.remove("hidden");
        box.querySelectorAll("[data-ctx]").forEach(b=>b.onmousedown=e=>e.preventDefault());
        box.querySelectorAll("[data-ctx]").forEach(b=>b.onclick=()=>{
          const r=sug[Number(b.dataset.ctx)];if(!r)return;
          const pos=p.selectionStart??p.value.length,before=p.value.slice(0,pos);
          const cur=ctxMentionTokenAtEnd(before)||tk; // перерахунок на момент кліку
          p.value=before.slice(0,Math.max(0,before.length-cur.query.length-2))+p.value.slice(pos);
          ctxMentionAttached={runId:r.uid||null,title:ctxRunTitle(r),digest:ctxRunDigest(r)};
          renderAttachChips();hide();
          try{p.focus()}catch(e){}
        });
      }catch(e){hide()}
    })();
  });
  p.addEventListener("keydown",e=>{if(e.key==="Escape"&&!box.classList.contains("hidden")){e.stopPropagation();hide()}});
  p.addEventListener("blur",()=>setTimeout(hide,180));
}
/* v5.11.23: бейдж іконки PWA — лічильник завдань, що завершилися, поки
   застосунок був у фоні (navigator.setAppBadge), скидається при поверненні. */
const BADGE_KEY="ai_bridge_done_badge";
function bumpDoneBadge(){
  if(!("setAppBadge" in navigator))return;
  let n=0;try{n=parseInt(localStorage.getItem(BADGE_KEY)||"0",10)||0}catch(e){}
  n+=1;try{localStorage.setItem(BADGE_KEY,String(n))}catch(e){}
  try{navigator.setAppBadge(n)}catch(e){}
}
function clearDoneBadge(){
  try{localStorage.removeItem(BADGE_KEY)}catch(e){}
  if("clearAppBadge" in navigator){try{navigator.clearAppBadge()}catch(e){}}
}
function markDoneHidden(){if(document.hidden)bumpDoneBadge()}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)clearDoneBadge()});
/* v5.11.62: чесна картка Muse. НЕ імітує відповідь AI — лише пояснює,
   що Muse живе в застосунку Muse і не має публічного API для Bridge. */
function showMuseCard(){
  renderAnswer({uid:"muse-"+Date.now(),final:t("museCardText"),selectedProviders:["muse"],meta:{localResponder:true,museCard:true},mode:"single"});
}
/* v5.11.70: Ядро — локальна обробка через core.js. НІЯКОЇ мережі, НІЯКОЇ імітації LLM.
   - довгий текст (>=200 символів) → повний аналіз (мова, статистика, ключові слова, резюме);
   - файли/контекст + питання → відповідь з контексту (екстрактивна);
   - коротке повідомлення без контексту → чесне пояснення, що Ядро аналізує текст. */
function coreReportMd(r){
  const L=[];
  L.push(`### ⚙️ ${esc(t("coreReportTitle"))}`);
  L.push("");
  L.push(`**${esc(t("coreLang"))}:** ${esc({uk:t("coreLangUk"),ru:t("coreLangRu"),en:t("coreLangEn")}[r.lang]||r.lang)}`);
  const s=r.stats;
  L.push(`**${esc(t("coreStats"))}:** ${esc(t("coreWords",{n:s.words}))} · ${esc(t("coreSentences",{n:s.sentences}))} · ${esc(t("coreAvgLen",{n:s.avgSentenceLen}))} · ${esc(t("coreComplexity",{n:s.complexity}))}%`);
  if(r.keywords.length)L.push(`**${esc(t("coreKeywords"))}:** ${r.keywords.map(k=>esc(k.word)).join(", ")}`);
  if(r.summary.length){L.push("");L.push(`**${esc(t("coreSummary"))}:**`);for(const sent of r.summary)L.push(`- ${esc(sent)}`);}
  L.push("");
  L.push(`_${esc(t("coreLocalNote"))}_`);
  return L.join("\n");
}
/* v5.11.95: Асистент Ядра — самостійний локальний помічник (core.js → createAssistant).
   Пам'ять асистента (факти, вивчені документи, ім'я) живе лише в localStorage цього пристрою. */
const CORE_MEMORY_KEY="ai_bridge_core_memory_v1";
let _coreAssistant=null,_coreAssistantLang="";
function coreAssistant(){
  const lang=(I18N?.getLanguage?.()||"uk");
  if(_coreAssistant&&_coreAssistantLang===lang){try{_coreAssistant.setNotes(loadNotes().map(n=>n.text||""))}catch(e){}return _coreAssistant}
  if(typeof BridgeCore==="undefined"||typeof BridgeCore.createAssistant!=="function")return null;
  let memory=null;try{memory=localStorage.getItem(CORE_MEMORY_KEY)}catch(e){}
  /* розмова (останній текст/питання) переживає зміну мови через експорт пам'яті попереднього екземпляра */
  if(_coreAssistant){try{memory=_coreAssistant.exportMemory()}catch(e){}}
  _coreAssistant=BridgeCore.createAssistant({lang,memory,notes:loadNotes().map(n=>n.text||"")});
  _coreAssistantLang=lang;
  return _coreAssistant;
}
function saveCoreMemory(){
  if(!_coreAssistant)return;
  try{localStorage.setItem(CORE_MEMORY_KEY,_coreAssistant.exportMemory())}
  catch(e){toast(t("coreMemoryFull"),"bad")}
}
/* Наміри, які Ядро закриває саме й точно — їх не варто відправляти в хмару. */
const CORE_INSTANT_INTENTS=new Set(["math","units","date","time","name","help","identity","memory.remember","memory.forget","memory.list","memory.learn","teach","feedback","list","stats","multi"]);
function coreCanHandleAlone(r){
  if(!r||r.error||!r.handled||r.escalate)return false;
  if(CORE_INSTANT_INTENTS.has(r.intent))return true;
  /* відповідь із власної пам'яті/нотаток/вивченого документа — лише коли Ядро впевнене */
  /* v5.11.99: те, чого людина навчила прямо («коли я питаю…, відповідай…»), — теж одразу.
     Вбудовані знання й вивчене з відповідей хмари хмару НЕ випереджають: вона може знати свіжіше. */
  return r.intent==="answer"&&Number(r.confidence)>=0.8&&["facts","notes","doc","taught"].includes(r.sources?.[0]?.type);
}
/* v5.11.99: САМОНАВЧАННЯ ЯДРА. Після кожної вдалої відповіді хмарної моделі Ядро запам'ятовує
   пару «питання → відповідь» у localStorage ЦЬОГО пристрою (нікуди не надсилається) і наступного
   разу — офлайн або коли хмара відмовила — відповідає саме, з позначкою, звідки це знає.
   Не вчиться з: інкогніто, помилок, файлів/зображень, агента, відповідей із контекстом іншого чату. */
const CORE_LEARN_OFF_KEY="ai_bridge_core_learn_off",CORE_TRAINED_KEY="ai_bridge_core_trained_v1";
function coreLearningOn(){try{return localStorage.getItem(CORE_LEARN_OFF_KEY)!=="1"}catch(e){return true}}
function saveCoreMemoryQuiet(){if(!_coreAssistant)return false;try{localStorage.setItem(CORE_MEMORY_KEY,_coreAssistant.exportMemory());return true}catch(e){return false}}
function coreLearnFromRun(run,opts){
  try{
    if(!run||(!opts?.force&&!coreLearningOn()))return false;
    const m=run.meta||{};
    if(m.error||m.temporary||m.localResponder||m.truncated||m.imported)return false;
    if((run.attachments||[]).length||(run.ctxChats||[]).length||run.continueRoot)return false;
    if(["agent","deep-scan"].includes(run.mode))return false;
    const q=String(run.prompt||"").trim(),a=String(run.final||"").trim();
    if(!q||!a)return false;
    const A=coreAssistant();if(!A||typeof A.learnQA!=="function")return false;
    const pid=run.judge||(run.results||[]).find(r=>r.ok)?.provider||(run.providers||[])[0];
    const r=A.learnQA(q,a,{source:PROVIDERS[pid]?.name||"AI",ts:run.created});
    if(!r)return false;
    if(!opts?.noSave)saveCoreMemoryQuiet();
    return true;
  }catch(e){return false}
}
/* Одноразово (або кнопкою в «Карті даних») — вивчити відповіді з уже наявної історії чатів. */
async function coreTrainFromHistory(force){
  if(!force){try{if(localStorage.getItem(CORE_TRAINED_KEY)||!coreLearningOn())return 0}catch(e){return 0}}
  let n=0;
  try{
    const runs=await getRuns(1000);
    for(const run of runs.slice().reverse())if(coreLearnFromRun(run,{noSave:true,force}))n++;
    if(n)saveCoreMemoryQuiet();
    try{localStorage.setItem(CORE_TRAINED_KEY,String(Date.now()))}catch(e){}
  }catch(e){}
  return n;
}
setTimeout(()=>{coreTrainFromHistory(false).then(n=>{if(n>0)toast(t("coreTrainedToast",{n}),"good")}).catch(()=>{})},5000);
/* Запитати Ядро. Повертає результат асистента або null (ядро недоступне). Не малює. */
function askCore(rawPrompt,context,title){
  const A=coreAssistant();if(!A)return null;
  const r=A.respond(String(rawPrompt||"").trim(),{context:context||"",title:title||""});
  if(r&&r.memoryChanged)saveCoreMemory();
  return r;
}
function renderCoreReply(prompt,r,noteKey){
  let final=r.text;
  if(!r.handled&&r.escalate&&Object.values(status.providers||{}).some(Boolean))final+=`\n\n${t("coreAskCloud")}`;
  final+=`\n\n_${t(noteKey||"coreLocalNote")}_`;
  const run={uid:"core-"+Date.now(),created:Date.now(),prompt,final,selectedProviders:["core"],results:[],meta:{localResponder:true,coreCard:true,coreIntent:r.intent,coreEscalate:!!r.escalate,coreQaId:r.qaId||null},mode:"single"};
  currentRun=run; /* щоб «Інша модель» і «Змінити питання» працювали з цим питанням */
  renderAnswer(run);
}
function runLocalCore(rawPrompt,source,context){
  const clean=String(rawPrompt||"").trim();
  try{
    const r=askCore(clean,context,attachments?.[0]?.name);
    if(r){renderCoreReply(clean,r);return}
  }catch(e){
    /* v5.11.75: чесні помилки Ядра — ліміт вводу / таймаут. Не мовчимо. */
    const final=(e&&e.isCoreError&&e.code==="tooLarge")?t("coreInputTooLarge",{n:"500 000"}):t("coreError");
    renderAnswer({uid:"core-"+Date.now(),final,selectedProviders:["core"],meta:{localResponder:true,coreCard:true},mode:"single"});
    return;
  }
  /* Запасний шлях: старе ядро без асистента (якщо core.js не оновився з кешу). */
  let final;
  try{
    if(context&&context.trim().length>=100){
      const hits=BridgeCore.answer(clean,context,3);
      final=hits.length
        ? `### ⚙️ ${esc(t("coreAnswerTitle"))}\n\n${hits.map(s=>`- ${esc(s)}`).join("\n")}\n\n_${esc(t("coreLocalNote"))}_`
        : t("coreNoAnswer");
    }else if(clean.length>=200){
      const r=BridgeCore.analyze(clean);
      /* v5.11.75: analyze ніколи не кидає (safe-обгортка), але може повернути error-фолбек. */
      if(r&&r.error){final=t("coreError");}
      else{
        final=coreReportMd(r);
        /* v5.11.94: примітка «аналіз частковий» лише коли ядро справді не встигло обробити весь текст
           (truncated); раніше вона з'являлась для БУДЬ-ЯКОГО великого тексту, навіть обробленого повністю. */
        if(r&&r.truncated)final+=`\n\n_${esc(t("corePartial"))}_`;
      }
    }else{
      final=t("coreNeedText");
    }
  }catch(e){
    /* v5.11.75: чесні помилки Ядра — ліміт вводу / таймаут. Не мовчимо. */
    final=(e&&e.isCoreError&&e.code==="tooLarge")?t("coreInputTooLarge",{n:"500 000"}):t("coreError");
  }
  renderAnswer({uid:"core-"+Date.now(),final,selectedProviders:["core"],meta:{localResponder:true,coreCard:true},mode:"single"});
}
async function sendTask(options={}){
  const source=options.source||"chat";
  const promptEl=source==="files"?$("filePrompt"):$("prompt");
  const rawPrompt=(options.promptText??promptEl?.value??"").trim();
  const submittedImages=source==="chat"?imageAttachments.map(a=>({...a})):[];
  const prompt=rawPrompt||(submittedImages.length?t("taskDefaultPhoto"):"");
  // v5.11.23: @згадка моделі в тексті — одноразовий оверрайд вибору моделі.
  // В історію/дисплей іде оригінальний текст; з мережевого промпта токен згадки вирізається.
  const mention=parseModelMention(rawPrompt);
  const mentionOk=!!(mention&&status.providers?.[mention.provider]);
  if(mention&&!mentionOk&&status.configured)toast(t("mentionNotConnected",{name:PROVIDERS[mention.provider].name}),"warn");
  const mentionForced=mentionOk?mention.provider:null;
  if(mentionForced&&!stripMention(rawPrompt,mention)&&!submittedImages.length){alert(t("taskNeedPhotoOrText"));return}
  if(!prompt){alert(source==="files"?t("fileNeedTask"):t("taskNeedPhotoOrText"));return}
  // v5.11.20: secret-like text guard — block the send and show a banner first.
  if(!guardSecretsBeforeSend(source,prompt,options))return;
  // v5.11.30: бюджет витрат — відхилити запит ДО виклику моделі.
  {const gate=spendGateState(monthSpendUsd(),spendCapUsd());
  if(gate.state==="block"){toast(t("spendCapBlocked"),"bad");return}
  if(gate.state==="warn"){let warned="";try{warned=localStorage.getItem(SPEND_WARN_KEY)||""}catch(e){}const dk=dayKey();if(warned!==dk){try{localStorage.setItem(SPEND_WARN_KEY,dk)}catch(e){}toast(t("spendCapWarn",{pct:gate.pct}),"warn")}}}
  // v5.10.0: offline → queue locally, auto-resend on reconnect.
  if(!navigator.onLine&&!options.fromQueue){
    /* v5.11.95: без інтернету спершу пробує Ядро. Що воно може зробити саме (рахунок, дати, текст,
       пам'ять, довідка) — відповідає одразу; решта стає в чергу, як і раніше. */
    if(!submittedImages.length&&!options.forceProvider){
      let r=null;try{r=askCore(prompt,source==="files"?buildFileContext({task:prompt}):"",attachments?.[0]?.name)}catch(e){r=null}
      if(r&&r.handled&&!r.escalate){
        if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);renderAttachChips();saveComposerDrafts()}
        if(source==="chat")pushPromptHistory(rawPrompt);
        updateCallEstimate();dismissKeyboard();
        renderCoreReply(prompt,r,"coreOfflineNote");
        return;
      }
    }
    queueOfflineMessage(source,prompt,submittedImages);return}
  haptic(10);springComposer();announceStatus("statusGenerating"); // v5.10.0: haptic + spring on send; v5.11.43: оголошення
  // v5.10.0: Deep Research has its own API flow.
  if(source==="chat"&&$("teamMode")?.value==="research"&&!options.forceProvider){
    if(mentionOk)toast(t("mentionResearchSkip"),"warn");
    const ctxBlock=ctxNetBlock(); // v5.11.68: зняти до очищення чипа нижче
    if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);ctxMentionAttached=null;renderAttachChips();saveComposerDrafts()}
    updateCallEstimate();
    if(source==="chat")pushPromptHistory(rawPrompt); // v5.11.44: історія запитів
    return runResearch(expandPasteMarkers(prompt)+ctxBlock); // v5.11.68: @@контекст і в дослідженні
  }
  // v5.9.16: #url / bare-URL fetch and /search run BEFORE the request body is
  // built. The enriched text goes to the network payload only (netPrompt);
  // displayPrompt/history keep the original submitted `prompt`. /search with
  // no server key cancels the send (the user can resend without /search);
  // a failed page fetch sends the original prompt + toast.
  const pre=await preprocessPrompt(prompt);
  if(pre.cancelled)return;
  if(source==="chat")pushPromptHistory(rawPrompt); // v5.11.44: історія запитів
  // v5.11.28: довгі вставки (маркери paste:) розгортаються тільки в
  // мережевий промпт; displayPrompt/історія лишаються з коротким маркером.
  // v5.11.68: сюди ж — @@контекст минулого чату (структурний конверт
  // <PAST CHAT>); в історію йде лише слід ctxChats на записі діалогу.
  const netPrompt=expandPasteMarkers(mentionForced?stripMention(pre.text,mention):pre.text)+ctxNetBlock();
  if(source==="files"&&!attachments.length){alert(t("taskNeedFile"));return}
  let mode=$("teamMode").value,providers=selectedProviders();const synthesize=$("synthesize").checked,judge=$("judgeProvider").value;
  /* v5.11.62: Muse не має публічного API — чесно. Виключаємо з API-викликів;
     якщо обрано тільки Muse — показуємо чесну картку замість фейкової відповіді. */
  /* v5.11.70: Ядро — так само виключаємо з API-викликів; обробка локальна. */
  const museChosen=providers.includes("muse");
  const coreChosen=providers.includes("core");
  providers=providers.filter(id=>id!=="muse"&&id!=="core");
  if(museChosen&&!providers.length&&!options.forceProvider){
    if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);renderAttachChips();saveComposerDrafts()}
    if(source==="chat")pushPromptHistory(rawPrompt);
    updateCallEstimate();
    showMuseCard();
    return;
  }
  /* v5.11.70: Ядро обрано окремо — локальна обробка через core.js, без мережі.
     Перехоплюємо ДО перевірки taskNeedProvider (провайдерів після фільтра 0). */
  /* v5.11.95: Ядро обрано РАЗОМ із хмарними моделями — воно відповідає першим на те, що вміє саме
     (рахунок, дати, пам'ять…), без виклику хмари; усе інше йде до моделей, як звичайно. */
  if(coreChosen&&providers.length&&!options.forceProvider&&!submittedImages.length&&source==="chat"){
    let r=null;try{r=askCore(prompt,"","")}catch(e){r=null}
    if(coreCanHandleAlone(r)){
      if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);renderAttachChips();saveComposerDrafts()}
      updateCallEstimate();dismissKeyboard();
      renderCoreReply(prompt,r,"coreFirstNote");
      return;
    }
  }
  if(coreChosen&&!providers.length&&!options.forceProvider){
    if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);renderAttachChips();saveComposerDrafts()}
    if(source==="chat")pushPromptHistory(rawPrompt);
    updateCallEstimate();
    const coreCtx=source==="files"?buildFileContext({task:prompt}):"";
    runLocalCore(rawPrompt,source,coreCtx);
    return;
  }
  /* v5.11.100: a simple deterministic request must not fail merely because
     God/Agent mode was left selected while no cloud API key is configured.
     Core handles only intents it can answer exactly (math, units, date,
     memory, etc.); unsupported requests still require a real provider. */
  if(!providers.length&&!options.forceProvider&&!submittedImages.length&&source==="chat"&&["auto","agent","god"].includes(mode)){
    let r=null;try{r=askCore(prompt,"","")}catch(e){r=null}
    if(coreCanHandleAlone(r)){
      if(promptEl){promptEl.value="";autoGrowTextarea(promptEl);renderAttachChips();saveComposerDrafts()}
      pushPromptHistory(rawPrompt);updateCallEstimate();dismissKeyboard();
      renderCoreReply(prompt,r,"coreFirstNote");
      return;
    }
  }
  // v5.9.9: "Answer with another model" and a role's preferred model send to exactly one provider.
  const roleProvider=activeRole()?.provider,forced=options.forceProvider||mentionForced||(mode==="auto"&&roleProvider&&status.providers?.[roleProvider]?roleProvider:null);
  if(forced&&status.providers?.[forced]){mode="single";providers=[forced]}
  // v5.11.27: remember manual overrides for the "why this model" line.
  lastForcedBy=forced?{provider:forced}:((mode!=="auto"&&providers.length===1)?{provider:providers[0]}:null);
  if(!options.forceProvider)compareBase=null;
  if(!["auto","agent","god"].includes(mode)&&!providers.length){showPage("team");alert(t("taskNeedProvider"));return}
  // Context isolation: ordinary Chat/Team submissions must never inherit
  // stale ZIP/file attachments from the Files workspace. File context is
  // attached only when the user explicitly submits from the Files tab.
  const context=source==="files"?buildFileContext({task:prompt}):"";
  // v5.11.28: маркери довгих вставок рахуються розгорнутими — перевіряємо
  // реальний розмір запиту, а не короткий маркер.
  const promptExpanded=expandPasteMarkers(prompt);
  if(promptExpanded.length+context.length+ctxMentionLen()>430000){alert(t("taskContextLarge"));return}
  if(source==="files"&&$("deepScan")?.checked&&!options.skipDeepScan){
    const plan=planDeepScanParts(netPrompt);
    if(plan.totalParts>1){if(promptEl)promptEl.value="";updateFileSendState();return runDeepScan(netPrompt,plan)}
  }

  // The prompt has now been accepted. Clear the composer immediately so the
  // next question can be typed while this run is in progress. Keep `prompt`
  // in the local variable above so history/error handling still has the exact
  // submitted text.
  if(promptEl)promptEl.value="";
  if(source==="chat"&&submittedImages.length){imageAttachments=[];renderImageAttachments()}
  // v5.11.68: @@контекст спожито цим ходом — слід для історії знімаємо до
  // очищення чипа; чип прибираємо (як текст поля).
  const ctxSent=source==="chat"?ctxMentionAttached:null;
  if(source==="chat"&&ctxMentionAttached){ctxMentionAttached=null;renderAttachChips()}
  updateCallEstimate();
  updateFileSendState();
  // v5.9.8: never put the cursor back into the task field after sending — on
  // iPhone that re-opened the keyboard and jumped back to the composer. Hide
  // the keyboard and move to the live progress instead.
  if(source==="files")showPage("chat");
  dismissKeyboard();

  // Persist the pending-job marker BEFORE the request goes out. If Safari
  // kills the tab, the network drops, or the page reloads at any point from
  // here on, resumePendingJobIfAny() on the next load recovers this exact
  // job by jobId — it never re-submits prompt/attachments to the providers.
  const clientRequestId=newRequestId();
  const attachmentNames=[...attachments.map(a=>a.name),...submittedImages.map(a=>a.name)];
  // v5.11.39: тимчасовий діалог — жодних слідів у сховищах: pending-маркер
  // не створюється (закрив вкладку — діалог зник).
  const tempRun=tempChatOn();
  if(!tempRun)savePendingJob({clientRequestId,jobId:null,createdAt:Date.now(),prompt,mode,providers,attachmentNames});

  renderWebSources({});
  setBusy(true);
  startSpeedLive(); // v5.11.64: живий лічильник секунд, доки модель генерує
  renderPipeline(null,mode,{reset:true});
  $("pushHint")?.classList.add("hidden");
  const setState=value=>{
    const state=typeof value==="string"?value:value?.state,progress=typeof value==="object"?value?.progress:null;
    if(progress)renderPipeline(progress,mode);
    if(state==="resubmitting"){stopThinkLabels();$("progressTitle").textContent=t("taskReconnect");$("progressText").textContent=t("jobResubmit");return}
    if(state==="processing"&&progress?.phase==="searching_web"){
      stopThinkLabels(); // v5.11.80: конкретна фаза перемагає живі мітки
      $("progressTitle").textContent=t("flowSearch");
      $("progressText").textContent=t("searchFirstDesc");return;
    }
    if((mode==="agent"||mode==="god")&&state==="processing"&&progress?.phase){
      stopThinkLabels(); // v5.11.80: конкретна фаза перемагає живі мітки
      const phase=t(`agentPhase_${progress.phase}`),step=Number(progress.step||0),max=Number(progress.maxSteps||5);
      $("progressTitle").textContent=t("agentWorking");
      const who=progress.provider&&progress.provider!=="agent-core"&&progress.provider!=="web"?(PROVIDERS[progress.provider]?.name||progress.provider):"";
      $("progressText").textContent=[phase,step?`${step}/${max}`:"",progress.tool||"",who].filter(Boolean).join(" • ");return;
    }
    const map={
      accepted:[t("taskAccepted"),(mode==="agent"||mode==="god")?t("agentAcceptedText"):t("taskAcceptedText")],
      processing:[submittedImages.length?t("taskAnalyzingPhoto"):context?t("taskAnalyzingFile"):t("working"),mode==="debate"?"Round 1 → critique → Judge • connection active":(mode==="agent"||mode==="god")?t("agentAnalyzing"):submittedImages.length?t("taskVisionActive"):t("taskAnalyzing")],
      reconnecting:[t("taskReconnect"),t("taskReconnectText")]
    }[state];
    if(map){
      $("progressTitle").textContent=map[0];
      // v5.11.80: під час генерації без конкретної фази — живі мітки
      // міркувань замість статичного тексту; інакше — статичний текст.
      if(state==="processing"&&!progress?.phase)startThinkLabels();
      else{stopThinkLabels();$("progressText").textContent=map[1]}
    }
  };
  $("progressTitle").textContent=t("taskAccepted");
  $("progressText").textContent=t("sendingTask");
  try{
    const payload={prompt,displayPrompt:prompt,fileContext:context,images:submittedImages.map(({name,mime,data})=>({name,mime,data})),mode,providers,synthesize,judge,searchFirst:$("searchFirst")?.checked!==false,clientRequestId,effort:getEffort()};Object.assign(payload,styleField(),projectField(),{routingPref:getRoutingPref(),convId:getConvId(),backgroundModel:getBgModel()});
    // v5.9.16: #url / /search enrichment replaces the NETWORK prompt only;
    // displayPrompt (and the original `prompt`) stay untouched for the tests
    // above that pin the literal payload shape.
    payload.prompt=netPrompt;
    // v5.11.61: «Продовжити» обірвану відповідь — мережевий промпт несе
    // оригінальне питання + хвіст обірваної відповіді в структурному конверті
    // (патерн <original_task>/<bridge_retry>); displayPrompt лишається коротким.
    let continueFrom=null;
    if(options.continueFrom&&options.continueFrom.answer){
      continueFrom={question:String(options.continueFrom.question||prompt).slice(0,2000),answer:String(options.continueFrom.answer)};
      payload.prompt=`<original_task>\n${continueFrom.question}\n</original_task>\n\n<bridge_continue>\n${t("continueInstruction")}\n<truncated_answer>\n${continueFrom.answer.slice(-6000)}\n</truncated_answer>\n</bridge_continue>`;
    }
    lastChatRequest={promptText:prompt,source,mode};
    // v5.11.64: фіксуємо роль автора відповіді на момент відправки — бейдж
    // покаже саме її, а не роль, яку Сергій перемкне пізніше.
    const roleAtSend=activeRole();
    if(!tempRun)savePendingPayload(clientRequestId,payload);
    const run=await streamingRunRequest(payload,setState);
    const j=run.j;
    if(!run.ok){
      const failReport=providersFailedReport(j,run.status,prompt,{tryCore:source==="chat"&&!submittedImages.length});
      const message=failReport?failReport.final:friendlyRunError(j,run.status);
      const errRun={
        created:Date.now(),prompt,mode,
        roleId:roleAtSend?.id||null,roleName:roleAtSend?.name||null,
        providers:j.selectedProviders||providers,
        attachments:attachmentNames,
        results:j.results||[],
        final:message,
        judge:null,
        // v5.11.68: чесний слід @@контексту в історії (сам контекст — лише в мережевому промпті).
        ctxChats:ctxSent?[{title:ctxSent.title,runId:ctxSent.runId}]:undefined,
        meta:{httpStatus:run.status,error:true,bridgeVersion:j.version||null,streamed:!!run.streamed}
      };
      if(failReport){errRun.meta.richError=true;if(failReport.rescued){errRun.meta.coreRescue=true;errRun.meta.coreIntent=failReport.coreIntent}}
      if(tempRun)errRun.meta.temporary=true; // v5.11.39: інкогніто — saveRun пропустить
      currentRun=errRun;
      await saveRun(errRun);
      markSendOutcome("error"); // v5.11.84: хрестик на кнопці відправки
      renderAnswer(errRun);notifyRunDone(errRun); // v5.11.43: оголошення + тактильний сигнал
      $("finalTitle").textContent=failReport?.rescued?t("coreRescueShort"):t("error");
      if(run.status===401){
        $("topStatus").textContent=t("errBadToken");
        const d=$("providerDiagResults");if(d){d.className="mcpStatusText bad";d.textContent=message}
        showPage("connections");
      }else if(run.status===503&&j.setupRequired){
        $("topStatus").textContent=t("statusSecrets");
        showPage("connections");
      }
      if(run.terminal||run.status===404)clearPendingJob();
      throw Object.assign(new Error(message),{alreadyRendered:true});
    }
    // v5.9.15: task started successfully — with Web Push on, one hint line
    // tells the user they can close the app and will be notified when ready.
    maybeShowPushHint().catch(()=>{});
    currentRun={created:Date.now(),prompt,mode,roleId:roleAtSend?.id||null,roleName:roleAtSend?.name||null,providers:j.selectedProviders||providers,attachments:attachmentNames,results:j.results||[],final:j.final||"",judge:j.judge||null,meta:j.meta||{},pinned:j.pinned||j.meta?.pinned||j.meta?.pinnedRoute||null,ctxChats:ctxSent?[{title:ctxSent.title,runId:ctxSent.runId}]:undefined};
    // v5.11.61: «Продовжити» — склеюємо продовження з обірваною відповіддю,
    // щоб показана відповідь була цілісною. Кнопка з'явиться знову, якщо
    // продовження теж обірвано (meta.truncated нового прогону).
    if(continueFrom&&j.final){
      currentRun.final=`${continueFrom.answer}\n${String(j.final)}`;
      currentRun.continueRoot=continueFrom.question;
    }
    if(tempRun)currentRun.meta.temporary=true; // v5.11.39: інкогніто — saveRun пропустить
    // v5.9.16: budget-downgraded routing is surfaced once per conversation.
    if((j.budgetDowngraded||j.meta?.budgetDowngraded)&&!budgetDowngradedToasted){budgetDowngradedToasted=true;toast(t("budgetDowngraded"),"bad")}
    maybeRefreshBudget();
    await saveRun(currentRun);
    /* v5.11.99: Ядро вчиться з цієї відповіді (лише звичайний чат без файлів і зображень) */
    if(source==="chat"&&!submittedImages.length&&!continueFrom)coreLearnFromRun(currentRun);
    clearPendingJob();
    sweepPasteStore(); // v5.11.28: вставки відправлено — чистимо сховище
    markDoneHidden(); // v5.11.23: бейдж PWA, якщо завдання фінішувало у фоні
    // A successful AI response proves both the Worker and at least one provider are online.
    // Reflect that immediately, then reconcile the full provider list in the background.
    const successfulProviders=(j.selectedProviders||[]).filter(id=>PROVIDERS[id]);
    if(successfulProviders.length){
      const nextProviders={...(status.providers||{})};
      for(const id of successfulProviders)nextProviders[id]=true;
      status={...status,configured:true,error:null,providers:nextProviders};
      const n=Object.values(nextProviders).filter(Boolean).length;
      $("topStatus").textContent=t("statusOnline",{n});
      renderProviders();renderConnections();updateCallEstimate();
    }
    $("progressTitle").textContent=t("ready");
    renderAnswer(currentRun);renderHistory();notifyRunDone(currentRun); // v5.11.43
    refreshStatus().catch(()=>{});
  }catch(e){
    markSendOutcome("error"); // v5.11.84
    if(source==="chat"&&submittedImages.length&&!imageAttachments.length){imageAttachments=submittedImages.map(a=>({...a}));renderImageAttachments()}
    if(!e.alreadyRendered){
      $("answerArea").classList.remove("hidden");
      $("finalTitle").textContent=t("error");
      $("finalAnswer").textContent=e.message;
      $("peerAnswers").innerHTML="";
    }
  }finally{stopSpeedLive();setBusy(false)}
}
/* v5.9.3: LangGraph-style client checkpointing for Deep Scan. Each completed
   part is saved before the next part starts. If Safari reloads or the network
   drops, re-attaching the same project + task resumes from the first missing
   part instead of paying for already-completed parts again. */
const DEEP_SCAN_CHECKPOINT_KEY="ai_bridge_deep_scan_checkpoint_v1";
function deepScanCheckpointSignature(prompt,plan){
  const inventory=attachments.map(a=>({name:a.name,chars:a.chars||0,names:a.manifestNames||a.files?.map(f=>f.name)||[]}));
  return JSON.stringify({prompt:String(prompt||"").trim(),totalParts:plan.totalParts,inventory});
}
function loadDeepScanCheckpoint(signature){
  try{const j=JSON.parse(localStorage.getItem(DEEP_SCAN_CHECKPOINT_KEY)||"null");return j?.signature===signature&&Array.isArray(j.notes)?j:null}catch(e){return null}
}
function saveDeepScanCheckpoint(signature,notes,meta={}){
  try{localStorage.setItem(DEEP_SCAN_CHECKPOINT_KEY,JSON.stringify({signature,notes,savedAt:Date.now(),...meta}))}catch(e){}
}
function clearDeepScanCheckpoint(signature){
  try{const j=JSON.parse(localStorage.getItem(DEEP_SCAN_CHECKPOINT_KEY)||"null");if(!signature||j?.signature===signature)localStorage.removeItem(DEEP_SCAN_CHECKPOINT_KEY)}catch(e){}
}
/* v5.10.5: resume banner for an interrupted Deep Scan. Shown on load when a
   checkpoint with completed parts exists, so a dropped connection never
   silently loses the work. */
function deepScanCheckpointInfo(){
  try{
    const j=JSON.parse(localStorage.getItem(DEEP_SCAN_CHECKPOINT_KEY)||"null");
    if(j&&Array.isArray(j.notes)&&j.notes.length&&j.prompt)return j;
  }catch(e){}
  return null;
}
function maybeShowDeepScanBanner(){
  const c=deepScanCheckpointInfo(),bar=$("deepScanBanner");
  if(!c||!bar)return;
  const done=c.completedParts||c.notes.length,total=c.totalParts||"?";
  $("deepScanBannerText").textContent=t("deepScanResumeBanner",{done,total,prompt:String(c.prompt).slice(0,90)});
  $("deepScanResumeBtn").textContent=t("deepScanResumeBtn");
  $("deepScanDismissBtn").textContent=t("deepScanDismissBtn");
  bar.classList.remove("hidden");
  $("deepScanResumeBtn").onclick=()=>{
    const cc=deepScanCheckpointInfo();if(!cc)return;
    // Rebuild the plan from the CURRENT attachments; the checkpoint signature
    // matches only when the same files are attached — then runDeepScan resumes
    // from the first missing part instead of starting over.
    const plan=planDeepScanParts(cc.prompt);
    if(deepScanCheckpointSignature(cc.prompt,plan)!==cc.signature){
      toast(t("deepScanNeedFiles"),"warn");showPage("files");return;
    }
    bar.classList.add("hidden");
    runDeepScan(cc.prompt,plan);
  };
  $("deepScanDismissBtn").onclick=()=>{clearDeepScanCheckpoint();bar.classList.add("hidden")};
}
/* v5.9.1 Deep Scan: every part is a normal bounded job (task + one slice of
   files); the final job receives only the per-part notes plus the full file
   inventory. Costs parts+1 AI calls and is therefore opt-in. */
async function runDeepScan(prompt,plan){
  showPage("chat");renderWebSources({});setBusy(true);renderPipeline(null,"auto",{reset:true});
  $("deepScanBanner")?.classList.add("hidden"); // v5.10.5: a fresh scan supersedes the resume banner
  const n=plan.parts.length,providers=selectedProviders(),mode=$("teamMode").value,started=Date.now(),checkpointSignature=deepScanCheckpointSignature(prompt,plan);
  const checkpoint=loadDeepScanCheckpoint(checkpointSignature),notes=checkpoint?.notes?.slice(0,n)||[],resumeAt=Math.min(notes.length,n);
  const onState=v=>{const st=typeof v==="string"?v:v?.state;if(st==="reconnecting")$("progressText").textContent=t("taskReconnectText")};
  try{
    if(resumeAt>0){$("progressTitle").textContent=t("deepScanPart",{i:resumeAt+1,n});$("progressText").textContent=t("deepScanResume",{done:resumeAt,n})}
    for(let i=resumeAt;i<n;i++){
      $("progressTitle").textContent=t("deepScanPart",{i:i+1,n});
      $("progressText").textContent=t("deepScanPartText",{files:plan.parts[i].size});
      const payload={prompt:`${t("deepScanPartTask",{i:i+1,n})}\n\n${prompt}`,displayPrompt:prompt,fileContext:buildFileContext({task:prompt,only:plan.parts[i]}),images:[],mode:"auto",providers,synthesize:false,judge:"auto",searchFirst:false,clientRequestId:newRequestId()};
      Object.assign(payload,styleField());
      // v5.9.14: persist each part payload BEFORE sending, so pollJobStatus can
      // resubmit via resubmitPendingJob(clientRequestId) when the status API
      // reports 404 (unknown job) after the grace window. Cleaned up after
      // success; the checkpoint logic itself is untouched.
      await savePendingPayload(payload.clientRequestId,payload);
      let run=await streamingRunRequest(payload,onState);
      // 404 at part level is usually transient: the KV job record may not have
      // propagated to the polling edge location yet, or the isolate that
      // served /api/run-stream died before the status record became visible.
      // One retry with a fresh clientRequestId is safe (server de-duplicates
      // by id), and the payload stays persisted so pollJobStatus can still
      // resubmitPendingJob after its 404 grace window.
      if(!run.ok&&[404,429,499,500,502,503,504].includes(Number(run.status))){
        $("progressText").textContent=t("deepScanRetry",{i:i+1,n});
        await new Promise(resolve=>setTimeout(resolve,700));
        payload.clientRequestId=newRequestId();
        await savePendingPayload(payload.clientRequestId,payload);
        run=await streamingRunRequest(payload,onState);
      }
      if(!run.ok)throw new Error(t("deepScanPartFailed",{i:i+1,n,error:friendlyRunError(run.j,run.status).slice(0,260)}));
      notes.push(`## Part ${i+1}/${n}\n${String(run.j.final||run.j.results?.find(r=>r.ok)?.text||"").slice(0,24000)}`);
      saveDeepScanCheckpoint(checkpointSignature,notes,{completedParts:notes.length,totalParts:n,prompt:String(prompt||"").slice(0,1000)});
      await deletePendingPayload(payload.clientRequestId);
    }
    $("progressTitle").textContent=t("deepScanFinal");$("progressText").textContent=t("deepScanFinalText",{n});
    const inventory=attachments.map(a=>`${safeFileLabel(a.name)}: ${(a.manifestNames||a.files.map(f=>f.name)).map(safeFileLabel).join(", ")}`).join("\n").slice(0,19000);
    const notesContext=`<attached_files coverage="deep-scan-notes">\n<archive_inventory>\n${neutralizeEmbeddedFileTags(inventory)}\n</archive_inventory>\n<file path="deep-scan-notes.md">\n${neutralizeEmbeddedFileTags(notes.join("\n\n")).slice(0,300000)}\n</file>\n</attached_files>`;
    const payload={prompt:`${prompt}\n\n${t("deepScanFinalTask",{n})}`,displayPrompt:prompt,fileContext:notesContext,images:[],mode:["agent","god","single"].includes(mode)?"auto":mode,providers,synthesize:$("synthesize").checked,judge:$("judgeProvider").value,searchFirst:false,clientRequestId:newRequestId()};
    Object.assign(payload,styleField());
    // v5.9.14: same resubmit guarantee for the final synthesis request.
    await savePendingPayload(payload.clientRequestId,payload);
    const run=await streamingRunRequest(payload,onState);const j=run.j||{};
    const skipped=plan.totalParts-n;
    currentRun={created:started,prompt,mode:"deep-scan",providers:j.selectedProviders||providers,attachments:attachments.map(a=>a.name),results:j.results||[],final:(run.ok?(j.final||j.results?.find(r=>r.ok)?.text||t("noAnswer")):friendlyRunError(j,run.status))+(skipped>0?`\n\n> ${t("deepScanTruncated",{done:n,total:plan.totalParts})}`:""),judge:j.judge||null,meta:{...(j.meta||{}),deepScan:{parts:n,totalParts:plan.totalParts,files:plan.files},error:!run.ok}};
    await saveRun(currentRun);renderAnswer(currentRun);renderHistory();markDoneHidden();notifyRunDone(currentRun);$("finalTitle").textContent=t("deepScanTitle",{n,files:plan.files});
    if(run.ok){clearDeepScanCheckpoint(checkpointSignature);await deletePendingPayload(payload.clientRequestId)}
  }catch(e){
    // v5.10.5: an interrupted Deep Scan is SAVED to history together with the
    // completed part notes — nothing is lost when the connection drops or the
    // user navigates away. The localStorage checkpoint stays, so the scan can
    // still be resumed from the first missing part.
    const done=notes.length,errMsg=e?.message||String(e);
    const notesMd=notes.join("\n\n").slice(0,60000);
    currentRun={created:started,prompt,mode:"deep-scan",providers,attachments:attachments.map(a=>a.name),results:[],
      final:`${t("deepScanInterrupted",{done,n})}\n\n${errMsg}${done?`\n\n---\n\n${t("deepScanSavedNotes",{done})}\n\n${notesMd}`:""}`,
      judge:null,meta:{deepScan:{parts:n,totalParts:plan.totalParts,files:plan.files,completedParts:done,interrupted:true}}};
    try{await saveRun(currentRun)}catch(_){}
    markSendOutcome("error"); // v5.11.84
    renderAnswer(currentRun);renderHistory();notifyRunDone({...currentRun,meta:{...(currentRun.meta||{}),error:true}});
    $("finalTitle").textContent=t("deepScanInterruptedTitle",{done,n});
  }
  finally{setBusy(false)}
}
async function resumePendingJobIfAny(){
  const pending=loadPendingJob();if(!pending)return;
  if(Date.now()-(pending.createdAt||0)>PENDING_JOB_MAX_AGE_MS){clearPendingJob();return}
  const agentUi=pending.uiTarget==="agent"||pending.mode==="agent"&&pending.uiTarget!=="chat";
  showPage(agentUi?"agent":"chat");
  if(agentUi){setAgentBusy(true,t("agentStatusReconnect"));renderAgentTrace(null,{phase:"reasoning",step:0,maxSteps:4})}
  else{setBusy(true);$("answerArea").classList.remove("hidden");$("finalTitle").textContent="AI Team";$("finalAnswer").textContent=t("taskStillRunning");$("peerAnswers").innerHTML="";$("progressTitle").textContent=t("resumeTask");$("progressText").textContent=t("taskStillRunning")}
  let clearAfter=false;
  try{
    const run=await pollJobStatus(pending.jobId,{clientRequestId:pending.clientRequestId,onWaiting:value=>{
      const state=typeof value==="string"?value:value?.state,progress=typeof value==="object"?value?.progress:null;
      if(agentUi){
        if(progress){setAgentBusy(true,agentPhaseText(progress));renderAgentTrace(null,progress)}
        else setAgentBusy(true,state==="reconnecting"?t("agentStatusReconnect"):t("agentThinking"));
      }else{
        $("progressText").textContent=state==="reconnecting"?t("taskReconnect"):t("taskStillRunning");
      }
    }});
    const j=run.j;
    if(!run.ok){
      const msg=friendlyRunError(j,run.status);
      markSendOutcome("error"); // v5.11.84
      if(agentUi){if(pending.agentPolicy&&run.terminal&&![401,404,503].includes(run.status))recordAgentPolicyFailure(pending.agentPolicy);addAgentMessageOnce("assistant",msg,{error:true});$("agentRunStatus").className="agentRunStatus bad";$("agentRunStatus").textContent=`${t("agentStatusError")}: ${msg}`}
      else{$("finalTitle").textContent=t("error");$("finalAnswer").textContent=msg}
      clearAfter=!!run.terminal||run.status===404;
    }else{
      currentRun={created:pending.createdAt||Date.now(),prompt:pending.prompt||"",mode:pending.mode||"auto",providers:j.selectedProviders||pending.providers||[],attachments:pending.attachmentNames||[],results:j.results||[],final:j.final||"",judge:j.judge||null,meta:j.meta||{}};
      await saveRun(currentRun);renderHistory();
      if(agentUi){const used=j.selectedProviders||[];addAgentMessageOnce("assistant",j.final||j.results?.find(r=>r.ok)?.text||t("noAnswer"),{provider:used.at(-1)||used[0]||null,meta:j.meta||{},artifacts:j.artifacts||[]});renderAgentTrace(j.meta||null);if(pending.agentPolicy&&Number(j.meta?.agentToolErrors)>0)recordAgentPolicyFailure(pending.agentPolicy);const learned=rememberAgentOutcome(j.meta||{},{goal:pending.prompt||"",useFiles:(pending.attachmentNames||[]).some(n=>/\.(?:zip|txt|md|js|json)$/i.test(n)),images:(pending.attachmentNames||[]).some(n=>/\.(?:jpe?g|png|webp)$/i.test(n))});$("agentRunStatus").textContent=learned?t("agentStatusLearned",{n:loadAgentLessons().length}):t("agentStatusDone")}
      else{renderAnswer(currentRun);$("progressTitle").textContent=t("ready")}
      clearAfter=true;
    }
  }finally{if(clearAfter)clearPendingJob();if(agentUi)setAgentBusy(false);else setBusy(false)}
}
/* v5.9.8 live activity: after Send the keyboard closes, the page scrolls to
   the progress card, and every status change is listed with elapsed time
   ("what the AI is doing"). The list is kept under the answer afterwards. */
const activity={items:[],started:0,timer:null,observer:null,pending:null};
function dismissKeyboard(){try{const a=document.activeElement;if(a&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName))a.blur()}catch(e){}}
/* v5.11.34: поле вводу не ховається під клавіатурою iOS (visualViewport).
   На iOS клавіатура стискає лише visual viewport — layout лишається, тож
   композер може опинитися під клавіатурою, а фіксована нижня навігація —
   перекривати контент. --kb = висота клавіатури (0, коли сховано); CSS
   піднімає .tabs/.toasts/.scrollFab і додає нижній відступ .app.
   Працює тільки на iOS: на Android layout viewport і так стискається сам. */
let iosKbBaseH=0;
function initIosKeyboardFix(){
  const vv=window.visualViewport;
  if(!vv||!/iPhone|iPad|iPod/i.test(navigator.userAgent||""))return;
  const measure=()=>{
    const a=document.activeElement,typing=a&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName);
    const h=Math.max(document.documentElement.clientHeight||0,window.innerHeight||0,vv.height||0);
    if(!typing||!iosKbBaseH||h>iosKbBaseH)iosKbBaseH=h;
    const kb=Math.max(0,iosKbBaseH-(vv.height||0));
    document.documentElement.style.setProperty("--kb",(kb>80?Math.round(kb):0)+"px");
  };
  let raf=0;const schedule=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;measure()})};
  vv.addEventListener("resize",schedule);
  vv.addEventListener("scroll",schedule);
  window.addEventListener("orientationchange",()=>{iosKbBaseH=0;setTimeout(measure,400)});
  // Клавіатура відкрилася під фокусом — докрутити поле у видиму зону.
  document.addEventListener("focusin",e=>{
    const el=e.target;
    if(!el||!/^(TEXTAREA|INPUT|SELECT)$/.test(el.tagName||""))return;
    setTimeout(()=>{try{
      const kb=Number((document.documentElement.style.getPropertyValue("--kb")||"0").replace("px",""))||0;
      if(kb>0)el.scrollIntoView({block:"center"});
    }catch(_){}},380);
  });
  measure();
}
function revealWork(el,delay=320){if(!el)return;setTimeout(()=>{try{el.scrollIntoView({behavior:"smooth",block:"start"})}catch(e){el.scrollIntoView()}},delay)}
function fmtElapsed(ms){const s=Math.max(0,Math.round(ms/1000));return s<60?`${s} ${t("secShort")}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`}
function renderActivityList(host,items){if(!host)return;host.innerHTML=items.map(x=>`<li><span>${esc(fmtElapsed(x.at))}</span>${esc(x.text)}</li>`).join("")}
function logActivity(text){
  const s=String(text||"").replace(/\s+/g," ").trim();if(!s||!activity.started)return;
  if(activity.items.at(-1)?.text===s)return;
  activity.items.push({text:s.slice(0,220),at:Date.now()-activity.started});if(activity.items.length>40)activity.items.shift();
  renderActivityList($("progressLog"),activity.items);
  const log=$("progressLog");if(log)log.scrollTop=log.scrollHeight;
}
// One short line per step: the concrete status text when it is short,
// otherwise the step title (long texts are generic descriptions).
function captureProgressLine(){clearTimeout(activity.pending);activity.pending=setTimeout(()=>{if(thinkLabelsOn)return; // v5.11.80: живі мітки — індикатор, не подія; у журнал не пишемо
const a=($("progressTitle")?.textContent||"").trim(),b=($("progressText")?.textContent||"").trim().replace(/\s*•\s*$/,"");logActivity(b&&b.length<=80?b:a)},60)}
function startActivity(){
  activity.items=[];activity.started=Date.now();renderActivityList($("progressLog"),[]);$("activitySummary")?.classList.add("hidden");
  clearInterval(activity.timer);const el=$("progressElapsed");const tick=()=>{if(el)el.textContent=fmtElapsed(Date.now()-activity.started)};tick();activity.timer=setInterval(tick,1000);
  if(!activity.observer&&typeof MutationObserver==="function"){activity.observer=new MutationObserver(captureProgressLine);for(const id of ["progressTitle","progressText"]){const n=$(id);if(n)activity.observer.observe(n,{childList:true,characterData:true,subtree:true})}}
  captureProgressLine();
}
function stopActivity(){
  if(!activity.started)return;clearInterval(activity.timer);clearTimeout(activity.pending);
  stopThinkLabels(); // v5.11.80: генерація скінчилася — мітки зупинити
  const total=Date.now()-activity.started;logActivity(t(_sendOutcome==="error"?"activityFailed":"activityDone"));
  const box=$("activitySummary");if(box&&activity.items.length>1){$("activitySummaryTitle").textContent=t("activitySummary",{n:activity.items.length,time:fmtElapsed(total)});renderActivityList($("activitySummaryList"),activity.items);box.classList.remove("hidden")}
  activity.started=0;
}
/* v5.11.37: Wake Lock на час довгої генерації (ідея scout). Поки генерація
   активна, екран не гасне — телефон не перериває стрім. Нативний
   Screen Wake Lock API; feature-detect з граційною деградацією; після
   приховування вкладки замок поновлюється автоматично. */
let _wakeWanted=false,_wakeSentinel=null;
async function wakeLockSync(){
  if(!("wakeLock" in navigator))return;
  try{
    if(_wakeWanted&&!_wakeSentinel&&!document.hidden)_wakeSentinel=await navigator.wakeLock.request("screen");
    if(!_wakeWanted&&_wakeSentinel){const s=_wakeSentinel;_wakeSentinel=null;try{await s.release()}catch(e){}}
  }catch(e){_wakeSentinel=null}
}
if(typeof document!=="undefined"&&document.addEventListener)document.addEventListener("visibilitychange",()=>{if(document.hidden)_wakeSentinel=null;else wakeLockSync().catch(()=>{})});
/* v5.11.92 (аудит): цей блок був вставлений УСЕРЕДИНУ setBusy, тому markSendOutcome() не існував для
   sendTask — кожна помилка запиту кидала ReferenceError замість показу повідомлення, а
   слухач зміни мови додавався при кожному виклику. Тепер він на рівні модуля. */
/* v5.11.84: морфні іконки стану кнопки відправки (ідея scout) —
   idle (стрілка) → busy (спінер-дуга) → done (галочка) / error (хрестик).
   Результат ходу задається markSendOutcome() в catch-гілках до setBusy(false). */
const SEND_STATES=["idle","busy","done","error"];
function setSendState(s){
  const b=$("sendBtn");if(!b)return;
  const st=SEND_STATES.includes(s)?s:"idle";
  b.dataset.state=st;
  const key={idle:"sendTeam",busy:"working",done:"sendDone",error:"sendError"}[st];
  b.setAttribute("aria-label",t(key));
  b.setAttribute("title",t(key));
}
let _sendFlashT=null,_sendOutcome="done";
function markSendOutcome(o){_sendOutcome=o==="error"?"error":"done"}
if(typeof window!=="undefined"&&window.addEventListener)window.addEventListener("aibridge:languagechange",()=>{const b=$("sendBtn");setSendState(b?.dataset?.state||"idle")});
function setBusy(v){
  const wasBusy=!$("runProgress").classList.contains("hidden");
  // While a task runs, the quick-start cards are hidden and the page gets room
  // below the progress card, so it can actually scroll to the top of the screen.
  if(v&&!wasBusy){_wakeWanted=true;wakeLockSync().catch(()=>{});startActivity();dismissKeyboard();$("starterWrap")?.classList.add("hidden");$("chatComposer")?.classList.remove("hidden");document.body.classList.add("aiRunning");revealWork($("runProgress"))}
  if(!v&&wasBusy){_wakeWanted=false;wakeLockSync().catch(()=>{});stopActivity();document.body.classList.remove("aiRunning")}
  $("sendBtn").disabled=v;$("runProgress").classList.toggle("hidden",!v);
  // v5.11.84: морфні іконки стану кнопки відправки — замість затирання SVG
  // текстом стан задається data-state, іконки трансформуються CSS.
  if(v)setSendState("busy");
  else{
    const out=_sendOutcome;_sendOutcome="done"; // поглинути одноразово
    setSendState(out);
    clearTimeout(_sendFlashT);
    _sendFlashT=setTimeout(()=>{const b2=$("sendBtn");if(b2&&!b2.disabled)setSendState("idle")},1100);
  }
  const fileBtn=$("fileSendBtn");
  if(fileBtn){
    fileBtn.textContent=v?t("working"):t("sendFilesTask");
    fileBtn.disabled=v||!attachments.length||!($("filePrompt")?.value.trim());
  }
}
// v5.9.1: typographic hyphens/invisible chars in model-written URLs used to be
// punycoded into a different host (xn--aibridge…); normalize to ASCII first.
function normalizeUrlText(value){return String(value||"").replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g,"").replace(/[\u2010-\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/g,"-").trim()}
function safeSourceUrl(value){try{const u=new URL(normalizeUrlText(value));return u.protocol==="https:"?u.toString():""}catch(e){return ""}}
function renderWebSources(meta={}){
  const host=$("webSources");if(!host)return;
  const web=meta.webSearch,items=(web?.results||[]).map(x=>({...x,url:safeSourceUrl(x.url)})).filter(x=>x.url).slice(0,6);
  if(!items.length){host.classList.add("hidden");host.innerHTML="";return}
  const badge=meta.searchOnly?t("searchOnlyBadge"):t("searchAiBadge");
  host.innerHTML=`<div class="webSourcesHead"><b>${esc(t("webSourcesTitle"))}</b><span>${esc(badge)}</span></div><div class="webSourceList">${items.map((x,i)=>`<a class="webSourceCard" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><span class="webSourceIndex">${i+1}</span><span><b>${esc(x.title||x.url)}</b><small>${esc(x.engine||web.provider||new URL(x.url).hostname)}</small></span></a>`).join("")}</div>`;
  host.classList.remove("hidden");
}
// v5.9.0: Markdown answers (headings, lists, tables, code blocks with copy
// buttons). markdown.js builds DOM nodes only — never innerHTML — and allows
// https links only. If it failed to load, fall back to linkified plain text.
function renderRich(host,text){
  if(!host)return;
  if(globalThis.AIBridgeMarkdown?.render){
    try{globalThis.AIBridgeMarkdown.render(host,text,{copyLabel:t("copy"),copiedLabel:t("copied"),downloadLabel:t("codeDownload"),downloadedLabel:t("codeDownloaded"),collapseShowLabel:n=>t("codeShowAll",{n}),collapseHideLabel:t("codeShowLess")});return}
    catch(e){recordDiag("render",e?.message||e,"markdown")}
  }
  host.classList.remove("md");renderLinkedText(host,text);
}
/* v5.11.19: потоковий markdown-рендер з пакетуванням rAF (див. markdown.js).
   Повторні виклики для одного хоста в межах кадру зливаються в один рендер;
   незмінений текст не перерендерюється. */
const richStreamHosts=typeof WeakMap!=="undefined"?new WeakMap():null;
function renderRichStreamed(host,text){
  if(!host)return;
  const api=globalThis.AIBridgeMarkdown;
  if(!api?.createStreamRenderer||!richStreamHosts){renderRich(host,text);return}
  let r=richStreamHosts.get(host);
  if(!r){r=api.createStreamRenderer(host,{copyLabel:t("copy"),copiedLabel:t("copied"),downloadLabel:t("codeDownload"),downloadedLabel:t("codeDownloaded"),collapseShowLabel:n=>t("codeShowAll",{n}),collapseHideLabel:t("codeShowLess")});richStreamHosts.set(host,r)}
  r.push(text);
}
// Safe linkification: text nodes + <a> elements built via DOM APIs (never
// innerHTML), HTTPS only, so model output can never inject markup.
function renderLinkedText(host,text){
  if(!host)return;host.textContent="";
  const src=String(text||""),rx=/https:\/\/[^\s<>"'`)\]]+/g;let last=0,m;
  while((m=rx.exec(src))){
    const url=m[0].replace(/[.,;:!?]+$/,"");
    if(m.index>last)host.appendChild(document.createTextNode(src.slice(last,m.index)));
    const safe=safeSourceUrl(url);
    if(safe){const a=document.createElement("a");a.href=safe;a.target="_blank";a.rel="noopener noreferrer";a.textContent=normalizeUrlText(url);host.appendChild(a)}else host.appendChild(document.createTextNode(url));
    last=m.index+url.length;
  }
  if(last<src.length)host.appendChild(document.createTextNode(src.slice(last)));
}
const PIPE_STAGES=["search","plan","tools","ai","verify","learn"];
function inferPipeline(progress){
  const phase=progress?.phase||"",order={searching_web:0,planning:1,reading_web:2,delegating:2,generating_image:2,reasoning:3,verifying:4,done:5};
  const at=order[phase];if(at===undefined)return null;
  return PIPE_STAGES.map((stage,i)=>({stage,status:i<at?"done":i===at?"active":"pending"}));
}
function renderPipeline(progress,mode,{reset=false,final=false}={}){
  const host=$("pipeline");if(!host)return;
  if(reset||(!progress&&!final)){host.classList.add("hidden");host.innerHTML="";return}
  if(!progress){if(final)host.classList.add("hidden");return}
  let rows=Array.isArray(progress.pipeline)&&progress.pipeline.length?progress.pipeline.filter(x=>PIPE_STAGES.includes(x.stage)):inferPipeline(progress);
  if(!rows||(!["god","agent"].includes(mode)&&!Array.isArray(progress.pipeline)&&progress.phase!=="searching_web")){host.classList.add("hidden");return}
  const byStage=Object.fromEntries(rows.map(x=>[x.stage,x]));
  const label={search:"pipeSearch",plan:"pipePlan",tools:"pipeTools",ai:"pipeAi",verify:"pipeVerify",learn:"pipeLearn"};
  host.innerHTML=PIPE_STAGES.map(stage=>{const row=byStage[stage]||{status:"pending"},st=["done","active","failed","warning","skipped"].includes(row.status)?row.status:"pending";return `<span class="pipeStep ${st}" title="${esc(row.detail||"")}"><i aria-hidden="true"></i><b>${esc(t(label[stage]))}</b></span>`}).join("");
  host.classList.remove("hidden");host.classList.toggle("final",!!final);
  const active=rows.find(x=>x.status==="active");host.setAttribute("aria-label",active?`${t(label[active.stage])}: ${active.detail||""}`:"");
}
function renderRouteBadge(meta){
  const el=$("routeBadge");if(!el)return;
  const route=meta.route||(meta.searchOnly?"search_only":meta.godMode?"god":meta.agent?"agent":"");
  const map={local:["routeSearchOnly","noai"],search_only:["routeSearchOnly","noai"],search_ai:["routeSearchAi","sources"],god:["routeGod","god"],agent:[meta.autoEscalated?"routeEscalated":"routeAgent","agent"],direct:["routeDirect","ai"]};
  const hit=map[route];if(!hit||meta.error){el.className="routeBadge hidden";el.textContent="";return}
  el.className=`routeBadge ${hit[1]}`;el.textContent=t(hit[0]);
}
function renderVerificationPanel(meta){
  const host=$("verificationPanel");if(!host)return;
  const rep=meta.verificationReport,sc=meta.sourceCheck;
  if(!rep&&!sc){host.classList.add("hidden");host.innerHTML="";return}
  const list=(title,items,cls)=>(items||[]).length?`<div class="verifyGroup ${cls}"><b>${esc(t(title))}</b><ul>${items.slice(0,6).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:"";
  let html=`<div class="verifyHead"><span class="verifyIcon" aria-hidden="true">✓</span><b>${esc(t("verifyTitle"))}</b></div>`;
  if(rep){
    html+=`<p class="verifySummary">${esc(meta.verificationSummary||"")}</p>`;
    if(rep.verifier)html+=`<p class="verifyWho ${rep.independent?"ok":"warn"}">${esc(rep.verifier)} • ${esc(t(rep.independent?"verifyIndependent":"verifySameModel"))}</p>`;
    else if(rep.verdict!=="sources_only")html+=`<p class="verifyWho warn">${esc(t("verifyNone"))}</p>`;
    html+=list("verifyObserved",rep.claims?.observed,"observed")+list("verifyInferred",rep.claims?.inferred,"inferred")+list("verifyUnverified",rep.claims?.unverified,"unverified")+list("verifyIssues",rep.issues,"issues");
  }
  if(sc){html+=`<p class="verifyWho ${sc.ok?"ok":"warn"}">${esc(t(sc.ok?"citationOk":(sc.urlsNotInSources||[]).length?"citationWarn":"citationNone"))}</p>`}
  host.innerHTML=html;host.classList.remove("hidden");
}
/* v5.11.5: надійний скрол до відповіді. Попередній варіант (scrollIntoView
   через 50мс) ламався з трьох причин: липкий топбар перекривав заголовок
   відповіді (лікується scroll-margin-top у CSS), showPage("chat") запускав
   конкуруючий плавний скрол догори, а пізній контент (картинки/шрифти)
   зсував верстку вже після скролу. */
let answerScrollSeq=0,userTookScroll=false;
["touchstart","wheel"].forEach(ev=>window.addEventListener(ev,()=>{userTookScroll=true},{passive:true,capture:true}));
function scrollToAnswer(){
  const el=$("answerArea");if(!el||el.classList.contains("hidden"))return;
  const my=++answerScrollSeq;userTookScroll=false;
  const doScroll=smooth=>{if(my!==answerScrollSeq||userTookScroll)return;
    try{el.scrollIntoView(smooth?{behavior:"smooth",block:"start"}:{block:"start"})}catch(e){try{el.scrollIntoView()}catch(_){}}};
  requestAnimationFrame(()=>requestAnimationFrame(()=>doScroll(true)));
  // Одноразова дотискаюча корекція після пізнього контенту (картинки, шрифти),
  // якщо користувач сам не взяв скрол у руки.
  setTimeout(()=>doScroll(false),800);
}
/* v5.11.29: плаваюча кнопка «Вниз» з лічильником нових повідомлень (ідея scout,
   патерн HuggingFace chat-ui). З'являється на сторінках чату/агента, коли Сергій
   прогорнув угору під час генерації або коли нижче прийшли нові повідомлення;
   тап — плавний скрол донизу зі скиданням лічильника. */
let scrollFabNew=0;
/* Чиста (для тестів): чи користувач біля низу сторінки за вимірами скролу. */
function fabIsAtBottom(scrollY,innerHeight,scrollHeight){
  return (Number(scrollY)||0)+(Number(innerHeight)||0)>=(Number(scrollHeight)||0)-140;
}
/* Чиста (для тестів): новий лічильник після приходу повідомлення. */
function fabNextCount(prev,scrollY,innerHeight,scrollHeight){
  if(fabIsAtBottom(scrollY,innerHeight,scrollHeight))return 0;
  return Math.min(99,(Number(prev)||0)+1);
}
function fabRelevantPage(){
  const c=$("page-chat"),a=$("page-agent");
  return !!((c&&c.classList.contains("active"))||(a&&a.classList.contains("active")));
}
function fabBusy(){
  return !!document.body.classList.contains("aiRunning")||!($("runProgress")&&$("runProgress").classList.contains("hidden"));
}
function renderScrollFab(){
  const b=$("scrollFab");if(!b)return;
  if(fabIsAtBottom(window.scrollY,window.innerHeight,document.documentElement.scrollHeight))scrollFabNew=0;
  const show=fabRelevantPage()&&!fabIsAtBottom(window.scrollY,window.innerHeight,document.documentElement.scrollHeight)&&(scrollFabNew>0||fabBusy());
  b.classList.toggle("hidden",!show);
  const c=$("scrollFabCount");
  if(c){c.textContent=scrollFabNew>99?"99+":String(scrollFabNew);c.classList.toggle("hidden",scrollFabNew<=0)}
}
/* v5.11.88: явна глобальна видимість — self-diagnostic з iPhone зафіксував
   ReferenceError: Can't find variable: renderScrollFab (×15068) у Safari.
   Причина — крайовий випадок області видимості; явне вікно + typeof-чеки
   на всіх викликах роблять це куленепробивним. */
try{if(typeof window!=="undefined")window.renderScrollFab=renderScrollFab}catch(e){}
/* Безпечний виклик renderScrollFab — не кидає, якщо функція недоступна. */
function safeRenderScrollFab(){try{
  if(typeof renderScrollFab==="function")renderScrollFab();
  else if(typeof window!=="undefined"&&typeof window.renderScrollFab==="function")window.renderScrollFab();
}catch(e){}}
/* Викликати, коли приходить нове повідомлення (тред агента або фінальна відповідь чату). */
function noteScrollFabEvent(){
  try{
    scrollFabNew=fabNextCount(scrollFabNew,window.scrollY,window.innerHeight,document.documentElement.scrollHeight);
  }catch(e){scrollFabNew=0}
  safeRenderScrollFab();
}
function renderQualityScore(run){
  // M3 (v5.11.9 wave 2): бал Judge з рубрикою — дрібним шрифтом під відповіддю.
  const qs=run.meta?.qualityScore;
  let el=$("qualityScoreLine");
  if(qs&&Number.isFinite(Number(qs.avg))){
    if(!el){el=document.createElement("div");el.id="qualityScoreLine";el.className="qualityScore";$("finalAnswer")?.after(el)}
    if(!el)return;
    const comma=I18N?.getLanguage?.()!=="en";
    const num=comma?String(Number(qs.avg)).replace(".",","):String(Number(qs.avg));
    el.textContent=t("qualityScore").replace("{n}",num);
    el.classList.remove("hidden");
    /* v5.11.48 (дизайн V2): бал також у шапці картки. */
    const _as48=$("ansScore");if(_as48){_as48.textContent=el.textContent;_as48.classList.remove("hidden")}
  }else if(el){el.textContent="";el.classList.add("hidden");const _as48=$("ansScore");if(_as48){_as48.textContent="";_as48.classList.add("hidden")}}
}
/* v5.11.27: one-line "why this model" under the answer — routing policy plus
   honest extras (budget free-only, sticky pin, manual override, vision /
   large context). The forced-provider hint is consumed once per send. */
function renderRouteWhy(run){
  let el=$("routeWhyLine");
  const sel=(run.selectedProviders||[])[0];
  const okOne=!!(sel&&(run.results||[]).some(r=>r.ok&&r.provider===sel));
  if(!okOne||run.meta?.error){if(el){el.textContent="";el.classList.add("hidden")}return}
  if(!el){el=document.createElement("div");el.id="routeWhyLine";el.className="routeWhy";
    const anchor=$("qualityScoreLine")&&!$("qualityScoreLine").classList.contains("hidden")?$("qualityScoreLine"):$("finalAnswer");
    if(anchor)anchor.after(el);else return}
  const pol=String(run.meta?.routingPolicy||getRoutingPolicy());
  const policyKey={economy:"policyEconomy",speed:"policySpeed",balanced:"policyBalanced",quality:"policyQuality"}[pol]||"policyBalanced";
  const extra=[];
  if(run.meta?.budgetDowngraded)extra.push(t("routeWhyBudget"));
  if(run.meta?.pinnedRoute||run.meta?.pinned)extra.push(t("routeWhySticky"));
  const forced=lastForcedBy;lastForcedBy=null;
  if(forced&&forced.provider===sel)extra.push(t("routeWhyManual"));
  const cat=String(run.meta?.taskCategory||"");
  if(cat==="image")extra.push(t("routeWhyImage"));
  else if(cat==="files"||cat==="code_files")extra.push(t("routeWhyLongCtx"));
  const main=t("routeWhyFmt",{model:PROVIDERS[sel]?.name||sel,policy:t(policyKey),extra:extra.length?" · "+extra.join(" · "):""});
  /* v5.11.86: відхилені кандидати M2 з причинами — розкриття по тапу. */
  const rej=Array.isArray(run.meta?.routingRejected)?run.meta.routingRejected.filter(x=>x&&x.p&&x.r):[];
  const rejKey={no_key:"routeRejNoKey",no_vision:"routeRejNoVision",cooldown:"routeRejCooldown",budget:"routeRejBudget",sticky:"routeRejSticky",weaker:"routeRejWeaker"};
  if(!rej.length){el.textContent=main;el.classList.remove("hidden");return}
  const lis=rej.map(x=>`<li><b>${esc(PROVIDERS[x.p]?.name||x.p)}</b> — ${esc(t(rejKey[x.r]||"routeRejWeaker"))}</li>`).join("");
  el.innerHTML=`<span class="routeWhyMain">${esc(main)}</span><button type="button" class="routeWhyRejBtn" aria-expanded="false">${esc(t("routeRejectedShow",{n:rej.length}))}</button><ul class="routeWhyRejList hidden">${lis}</ul>`;
  el.classList.remove("hidden");
  const rb=el.querySelector(".routeWhyRejBtn");
  rb?.addEventListener("click",()=>{const l=el.querySelector(".routeWhyRejList");const closed=l.classList.toggle("hidden");rb.setAttribute("aria-expanded",String(!closed))});
}
/* v5.11.93: якір наміру й сигнал впевненості агента — закріплений рядок мети
   над прогоном agent/god/research («що роблю») + впевненість з оцінки Judge M3. */
function renderIntentAnchor(run){
  let el=$("intentAnchor");
  const mode=String(run?.meta?.mode||run?.mode||"").toLowerCase();
  const isAgent=mode==="agent"||mode==="god"||mode==="research";
  const goal=String(run?.prompt||"").trim();
  const qs=run?.meta?.qualityScore;
  const conf=qs&&Number.isFinite(Number(qs.avg))?Number(qs.avg):null;
  if(!isAgent||(!goal&&conf==null)){if(el){el.innerHTML="";el.classList.add("hidden")}return}
  if(!el){el=document.createElement("div");el.id="intentAnchor";el.className="intentAnchor";
    const anchor=$("finalAnswer");if(anchor)anchor.after(el);else return}
  const g=goal.length>120?goal.slice(0,120)+"…":goal;
  const pct=conf==null?null:Math.max(0,Math.min(100,Math.round(conf/5*100)));
  el.innerHTML=`<span class="intentDot" aria-hidden="true">🎯</span><span class="intentLbl">${esc(t("intentAnchorGoal"))}</span><span class="intentGoal">${esc(g)}</span>`+
    (pct==null?"":`<span class="intentConf"><span class="intentConfBar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="intentConfTxt">${esc(t("intentConfidence",{v:pct}))}</span></span>`);
  el.classList.remove("hidden");
  /* бал Judge лишається одразу після якоря */
  const qsl=$("qualityScoreLine");if(qsl&&el.nextSibling!==qsl)el.after(qsl);
}
function renderAnswer(run){
  // v5.11.69: нова відповідь — скидаємо кеш перекладу попередньої.
  translateCache={sig:"",target:"",text:""};try{renderTranslationBox()}catch(e){}
  // v5.11.46: цей діалог тепер показаний — знімаємо «непрочитане».
  viewedRunUid=run?.uid||null;clearHistUnread(run?.uid);
  $("answerArea").classList.remove("hidden");
  noteScrollFabEvent(); // v5.11.29: фінальна відповідь чату — лічильник FAB
  /* v5.11.48 (дизайн V2): шапка «модель · час» моноширинним. */
  const _fm48=(run.selectedProviders||[])[0]||run.judge;
  const _fmn48=_fm48?(PROVIDERS[_fm48]?.name||_fm48):null;
  const _fms48=run.ms?`${(Math.round(run.ms/100)/10).toString().replace(".",",")} ${t("secShort")}`:"";
  $("finalTitle").textContent=run.meta?.searchOnly?t("flowSearch"):run.meta?.localResponder?"AI Bridge":run.meta?.agent?"AI Agent":[_fmn48||"AI Team",_fms48].filter(Boolean).join(" · ");
  const answerText=run.final||run.results?.find(r=>r.ok)?.text||t("noAnswer");
  if(run.meta?.error&&!run.meta?.richError)renderLinkedText($("finalAnswer"),answerText);else renderRich($("finalAnswer"),answerText);
  renderQualityScore(run);
  renderRouteWhy(run);
  renderIntentAnchor(run);
  renderRouteBadge(run.meta||{});
  renderModeBadge(run);
  renderRoleBadge(run); // v5.11.64: бейдж ролі автора відповіді
  renderPinnedBadge(run.pinned||run.meta?.pinned||run.meta?.pinnedRoute);
  // v5.11.39: бейдж «Тимчасовий» у шапці діалогу-інкогніто.
  const tb=$("tempBadge");
  if(tb){if(run?.meta?.temporary){tb.textContent=t("tempChatBadge");tb.classList.remove("hidden")}else tb.classList.add("hidden")}
  renderVerificationPanel(run.meta||{});
  renderPipeline(run.meta?.pipeline?{pipeline:run.meta.pipeline,final:true}:null,run.meta?.mode||run.mode,{final:true});
  /* D3 (хвиля 2, стиль «Тиша»): відповіді моделей — вкладки з назвою, часом і
     місцем під бал Judge (r.score заповнить M3; формат «Оцінка: 4,2»).
     Одна видима панель замість довгого списку карток. */
  const peerHost=$("peerAnswers"),peerResults=run.results||[];
  /* v5.11.9 (злиття хвилі 2): M3 пише бал у run.meta.qualityScore, а вкладки D3
     читають r.score — прокидаємо бал переможцю на його вкладку. */
  const _qs=run.meta&&run.meta.qualityScore;
  if(_qs&&typeof _qs.avg==="number"){
    const _winner=(run.selectedProviders||[])[0];
    const _pr=peerResults.find(r=>r.provider===_winner&&r.ok)||peerResults.find(r=>r.ok);
    if(_pr&&(_pr.score==null))_pr.score=_qs.avg;
  }
  const peerScore=v=>{const n=Number(v);return Number.isFinite(n)?n.toFixed(1).replace(".",","):null};
  const peerStatus=r=>r.ok?`${Math.round((r.ms||0)/100)/10}s`:(r.cancelled||Number(r.status)===499||r.errorKind==="cancelled")?esc(t("peerCancelledShort")):`ERROR ${r.status||""}`;
  /* v5.11.27: cost chip — ≈$0.0042 or «безкоштовно»; hidden when price unknown. */
  const peerCost=r=>r.costUsd==null?"":` · <span class="costChip" title="${esc(t("costChipTitle"))}">${Number(r.costUsd)>0?`≈$${fmtMoney(r.costUsd)}`:esc(t("costFree"))}</span>`;
  /* v5.11.64: швидкість відповіді моделі в мета-рядку вкладки (~ток/с, оцінка). */
  const peerSpeed=r=>{const sp=providerSpeed(r);return sp?` · <span class="speedChip" title="${esc(t("speedTitle"))}">${esc(t("speedTab",{rate:fmtInt(sp.rate)}))}</span>`:""};
  if(!peerResults.length){peerHost.innerHTML="";}
  else{
    peerHost.innerHTML=`<div class="peerTabs" role="tablist" aria-label="${esc(t("compareAnswers"))}">`+
      peerResults.map((r,i)=>{const s=peerScore(r.score);
        return `<button type="button" role="tab" class="peerTab${i===0?" on":""}" data-peer-tab="${i}" aria-selected="${i===0?"true":"false"}"><b>${esc(PROVIDERS[r.provider]?.name||r.provider)}</b><span class="peerTabMeta">${peerStatus(r)}${s?` · <span class="peerScore">${esc(t("peerScore",{v:s}))}</span>`:""}${peerCost(r)}${peerSpeed(r)}</span></button>`}).join("")+
      `</div>`+
      peerResults.map((r,i)=>`<div class="peerPanel${i===0?" on":""}" role="tabpanel" data-peer-panel="${i}"${i===0?"":" hidden"}>`+
        (r.ok?`<div class="peerPanelHead"><span class="peerMsgBtns"><button type="button" class="miniBtn" data-peer-fork="${i}" title="${esc(t("forkBtn"))}" aria-label="${esc(t("forkBtn"))}">⑂</button><button type="button" class="miniBtn" data-peer-tts="${i}" title="${esc(t("readAloud"))}" aria-label="${esc(t("readAloud"))}">🔊</button></span></div>`:"")+
        `<div class="peerBody md ${r.ok||(r.cancelled||Number(r.status)===499)?"":"peerError"}"${r.ok?` data-peer-md="${i}"`:""}>${r.ok?"":esc((r.cancelled||Number(r.status)===499)?t("peerCancelled"):(r.friendly||providerErrorLabel(r.errorKind)))}</div></div>`).join("");
    peerHost.querySelectorAll("[data-peer-md]").forEach(el=>renderRich(el,peerResults[Number(el.dataset.peerMd)]?.text||""));
    // v5.9.16: per-message fork + read-aloud on peer answers.
    peerHost.querySelectorAll("[data-peer-fork]").forEach(b=>b.onclick=()=>forkRun(run,Number(b.dataset.peerFork)));
    peerHost.querySelectorAll("[data-peer-tts]").forEach(b=>b.onclick=()=>toggleSpeech(peerResults?.[Number(b.dataset.peerTts)]?.text||""));
    peerHost.querySelectorAll("[data-peer-tab]").forEach(b=>b.onclick=()=>{
      const n=Number(b.dataset.peerTab);
      peerHost.querySelectorAll("[data-peer-tab]").forEach(x=>{const on=Number(x.dataset.peerTab)===n;x.classList.toggle("on",on);x.setAttribute("aria-selected",on?"true":"false")});
      peerHost.querySelectorAll("[data-peer-panel]").forEach(p=>{const on=Number(p.dataset.peerPanel)===n;p.classList.toggle("on",on);if(on)p.removeAttribute("hidden");else p.setAttribute("hidden","")});
    });
  }
  peerHost?.closest("details")?.classList.toggle("hidden",!peerResults.length);
  renderWebSources(run.meta||{});
  resetFeedbackUi(run);
  renderFollowUps(run);
  renderSpeedRow(run); // v5.11.64: фінал «~ток/с · токени · час» під відповіддю
  $("otherModelBox")?.classList.add("hidden");renderCompare(run);
  $("starterWrap")?.classList.add("hidden");
  $("chatComposer")?.classList.remove("hidden"); // 2026-10-01: відповідь є — поле вводу потрібне
  scrollToAnswer();
}
let lastCloudPull=0;
/* v5.11.33: видалення одного діалогу з можливістю скасування (Undo toast).
   Замість блокуючого підтвердження діалог видаляється одразу, а тост
   «Діалог видалено — Скасувати» дає 8 секунд на відкат. */
async function deleteDialogWithUndo(run){
  if(!run||run.id==null)return;
  const snapshot={...run};
  const bmk=String(run.uid||run.id||"");
  const pinnedIds=loadPinned(PINNED_RUNS_KEY),wasPinned=isPinned(pinnedIds,run.id);
  const hadBookmark=bmk?loadBookmarks().some(b=>b.id===bmk):false;
  const bmTitle=hadBookmark?bookmarkTitleOf(run):"";
  await deleteRun(run.id);
  savePinned(PINNED_RUNS_KEY,pinnedIds.filter(x=>x!==String(run.id)));
  if(bmk&&hadBookmark){const bl=loadBookmarks().filter(b=>b.id!==bmk);saveBookmarks(bl)}
  // Хмарна синхронізація: надгробок deleted, щоб наступний pull не повернув діалог.
  if(historySyncOn()&&run.uid){try{await historyApi("POST",[{...syncPayload(run),deleted:true,updated:Date.now()}])}catch(e){}}
  renderHistory();
  toastUndo(t("dialogDeleted"),async()=>{
    await putRun(snapshot);
    if(wasPinned){const p=loadPinned(PINNED_RUNS_KEY);if(!isPinned(p,run.id)){p.unshift(String(run.id));savePinned(PINNED_RUNS_KEY,p)}}
    if(bmk&&hadBookmark){const bl=loadBookmarks();if(!bl.some(b=>b.id===bmk)){bl.unshift({id:bmk,ts:Date.now(),title:String(bmTitle).slice(0,140)});saveBookmarks(bl)}}
    // Скасування надгробка: повний запис із новішим updated перемагає в merge.
    if(historySyncOn()&&run.uid){try{await historyApi("POST",[{...syncPayload(snapshot),deleted:false,updated:Date.now()}])}catch(e){}}
    renderHistory();
  });
}
async function renderHistory(){
  renderUsage();
  if($("historySyncToggle"))$("historySyncToggle").checked=historySyncOn();
  if(historySyncOn()&&Date.now()-lastCloudPull>30000){lastCloudPull=Date.now();pullCloudHistory().then(n=>{if(n)renderHistory()})}
  const host=$("historyList");
  if(host&&!host.dataset.loaded)showSkel(host,"rows",4); // v5.10.0 skeleton
  const all=await getRuns(),q=($("historySearch")?.value||"").trim().toLowerCase();
  const pinnedRunIds=loadPinned(PINNED_RUNS_KEY);
  const unreadMap=loadHistUnread(); // v5.11.46: крапки «непрочитане»
  const bmIds=new Set(loadBookmarks().map(b=>b.id)); // v5.11.30: закладки
  const base=(bookmarksOnly?all.filter(r=>bmIds.has(String(r.uid||r.id||""))):all).filter(r=>archiveOnly?!!r.archived:!r.archived); // v5.11.37: архів
  const runs=sortPinnedFirst(q?base.filter(r=>`${r.prompt||""} ${r.final||""} ${r.mode||""}`.toLowerCase().includes(q)):base,r=>r.id,pinnedRunIds);
  if(host)host.dataset.loaded="1";
  if(!runs.length){
    if(host)host.innerHTML=q&&all.length
      ?emptyState("🔍",t("historyNoMatch"),null)
      :emptyState("🕘",t("historyEmpty"),t("historyNew"),()=>{newTask();$("prompt")?.focus()});
    return;
  }
    // v5.11.39: групування історії за датами; закріплені — зверху поза секціями.
  const histItemHtml=r=>{const m=String(r.mode||"task").toLowerCase();const ds=r.meta?.deepScan;const pin=isPinned(pinnedRunIds,r.id);const unread=!!unreadMap[String(r.uid||"")];const bmk=String(r.uid||r.id||""),bm=!!bmk&&bmIds.has(bmk),bmLbl=t(bm?"bookmarkRemove":"bookmarkAdd");const arch=!!r.archived,archLbl=t(arch?"archiveRemove":"archiveAdd");return `<div class="historyItem${pin?" pinned":""}${unread?" hasUnread":""}"><div class="historyTop"><span class="modeBadge ${modeBadgeClass(m)}">${esc(modeBadgeLabel(m))}</span>${unread?`<span class="unreadDot" role="img" aria-label="${esc(t("histUnread"))}" title="${esc(t("histUnread"))}"></span>`:""}${ds?.interrupted?`<span class="interruptedBadge">⏸ ${ds.completedParts||0}/${ds.parts||"?"}</span>`:""}<span>${fmtDate(r.created)}</span></div><div class="historyPrompt">${esc(r.title||r.prompt)}</div><div class="historyMeta">${(r.providers||[]).map(x=>esc(PROVIDERS[x]?.name||x)).join(" • ")}${r.attachments?.length?` • ${r.attachments.length} attachment(s)`:""}</div><div class="historyBtns"><button class="historyOpen" data-history="${r.id}">${esc(t("openAnswer"))}</button><button class="historyFork" data-history-fork="${r.id}" title="${esc(t("forkBtn"))}" aria-label="${esc(t("forkBtn"))}">⑂</button><button type="button" class="historyPin${pin?" on":""}" data-history-pin="${r.id}" title="${esc(t(pin?"unpinBtn":"pinBtn"))}" aria-label="${esc(t(pin?"unpinBtn":"pinBtn"))}" aria-pressed="${pin?"true":"false"}">📌</button><button type="button" class="historyPin historyBm${bm?" on":""}" data-history-bm="${esc(bmk)}" title="${esc(bmLbl)}" aria-label="${esc(bmLbl)}" aria-pressed="${bm?"true":"false"}">☆</button><button type="button" class="historyPin historyArch${arch?" on":""}" data-history-arch="${r.id}" title="${esc(archLbl)}" aria-label="${esc(archLbl)}" aria-pressed="${arch?"true":"false"}">📦</button><button type="button" class="historyPin historyRename" data-history-rename="${r.id}" title="${esc(t("renameRun"))}" aria-label="${esc(t("renameRun"))}">✎</button><button type="button" class="historyPin historyDel" data-history-del="${r.id}" title="${esc(t("dialogDelete"))}" aria-label="${esc(t("dialogDelete"))}">🗑</button></div></div>`};
  const pinnedItems=runs.filter(r=>isPinned(pinnedRunIds,r.id));
  const histGroups=groupRunsByDate(runs.filter(r=>!isPinned(pinnedRunIds,r.id)),Date.now());
  // v5.11.42: згортальні групи дат — заголовок-кнопка з шевроном і лічильником;
  // стан згортання — у localStorage (loadCollapsedHistSections).
  const collapsedSecs=new Set(loadCollapsedHistSections());
  host.innerHTML=pinnedItems.map(histItemHtml).join("")+
    histGroups.map(g=>{const c=collapsedSecs.has(g.key);return `<button type="button" class="histSection histSecToggle${c?" collapsed":""}" data-hist-sec="${g.key}" aria-expanded="${c?"false":"true"}" title="${esc(t("histSecToggle"))}" aria-label="${esc(t("histSecToggle"))}"><span class="histSecChev" aria-hidden="true">▾</span><span>${esc(t(HIST_SECTION_LABEL[g.key]))}</span><span class="histSecCount">${g.items.length}</span></button><div class="histItems${c?" collapsed":""}">${g.items.map(histItemHtml).join("")}</div>`}).join("");
  document.querySelectorAll("[data-history]").forEach(b=>b.onclick=()=>{
    const r=runs.find(x=>String(x.id)===String(b.dataset.history));if(!r)return;
    currentRun=r;resetConvId();$("prompt").value=r.prompt||"";showPage("chat",{keepScroll:true});renderAnswer(r);
  });
  // v5.9.16: fork any past conversation from history.
  document.querySelectorAll("[data-history-fork]").forEach(b=>b.onclick=()=>{const r=runs.find(x=>String(x.id)===String(b.dataset.historyFork));forkRun(r)});
  // v5.11.12: pin dialogs to the top of history.
  document.querySelectorAll("[data-history-pin]").forEach(b=>b.onclick=e=>{e.stopPropagation();togglePinned(PINNED_RUNS_KEY,b.dataset.historyPin);renderHistory()});
  // v5.11.30: закладки на діалоги.
  document.querySelectorAll("[data-history-bm]").forEach(b=>b.onclick=e=>{e.stopPropagation();const key=b.dataset.historyBm;if(!key){toast(t("noAnswer"),"warn");return}const r=runs.find(x=>String(x.uid||x.id||"")===key);const added=toggleBookmark(key,bookmarkTitleOf(r));toast(t(added?"bookmarkSaved":"bookmarkRemoved"),"good");renderHistory()});
  // v5.11.37: архів діалогів.
  document.querySelectorAll("[data-history-arch]").forEach(b=>b.onclick=e=>{e.stopPropagation();const r=runs.find(x=>String(x.id)===String(b.dataset.historyArch));if(!r)return;toggleArchive(r).then(arch=>{toast(t(arch?"archiveSaved":"archiveRestored"),"good");renderHistory()})});
  // v5.11.33: видалення діалогу з Undo (без модального підтвердження).
  document.querySelectorAll("[data-history-del]").forEach(b=>b.onclick=e=>{e.stopPropagation();const r=runs.find(x=>String(x.id)===String(b.dataset.historyDel));if(r)deleteDialogWithUndo(r)});
  // v5.11.91: ручне перейменування діалогу (олівець у списку історії).
  document.querySelectorAll("[data-history-rename]").forEach(b=>b.onclick=e=>{e.stopPropagation();const r=runs.find(x=>String(x.id)===String(b.dataset.historyRename));if(r)startHistRename(b,r)});
  // v5.11.42: згортання/розгортання групи дат — стан у localStorage, без перерендеру.
  document.querySelectorAll("[data-hist-sec]").forEach(b=>b.onclick=()=>{const now=toggleCollapsedHistSection(b.dataset.histSec);b.classList.toggle("collapsed",now);b.setAttribute("aria-expanded",now?"false":"true");const items=b.nextElementSibling;if(items&&items.classList.contains("histItems"))items.classList.toggle("collapsed",now)});
}

function studioModeNeedsFile(mode=studioMode){return mode==="photo-edit"||mode==="photo-motion"||mode==="animate"||mode==="video-edit"}
function studioModeNeedsVideo(mode=studioMode){return mode==="video-edit"}
function studioMimeOk(file,mode=studioMode){if(!file)return false;return studioModeNeedsVideo(mode)?["video/mp4","video/quicktime"].includes(String(file.type||"").toLowerCase()):["image/jpeg","image/png","image/webp"].includes(String(file.type||"").toLowerCase())}
function studioSetStatus(text,kind=""){const el=$("studioStatus");if(!el)return;el.textContent=text||"";el.className="studioStatus"+(kind?" "+kind:"")}
function setStudioMode(mode){
  studioMode=mode||"photo-edit";localStorage.setItem("ai_bridge_studio_mode",studioMode);
  document.querySelectorAll("[data-studio-mode]").forEach(b=>b.classList.toggle("active",b.dataset.studioMode===studioMode));
  const needs=studioModeNeedsFile(),video=studioModeNeedsVideo(),row=$("studioUploadRow"),input=$("studioFileInput");
  if(row)row.classList.toggle("hidden",!needs);
  if(!needs)studioFile=null;
  if(input){input.accept=video?"video/mp4,video/quicktime":"image/jpeg,image/png,image/webp";if(!needs)input.value=""}
  if($("studioPickTitle"))$("studioPickTitle").textContent=t(video?"studioPickVideo":"studioPickPhoto");
  if($("studioPickHint"))$("studioPickHint").textContent=t(video?"studioPickVideoHint":"studioPickPhotoHint");
  if(studioFile&&!studioMimeOk(studioFile,studioMode))studioFile=null;
  renderStudioPreview();updateStudioEngineInfo();studioSetStatus("");
}
function studioPaidFallbackEnabled(){return !!$("studioPaidFallback")?.checked}
function updateStudioEngineInfo(){
  const note=$("studioCostNote");if(!note)return;if(studioMode==="photo-motion"){note.textContent=t("studioMotionLocal");return}
  const image=studioMode==="photo-edit"||studioMode==="photo-generate";if(!image){note.textContent=studioPaidFallbackEnabled()?t("studioVideoEngineFal"):t("studioPaidVideoOff");return}
  /* v5.11.81: Workers AI заборонено — чесно показуємо стан без його реклами */
  if(status.media?.cloudflareAI)note.textContent=studioPaidFallbackEnabled()?t("studioImageEngineCloudflarePaidOptional"):t("studioImageEngineCloudflareFree");
  else if(studioPaidFallbackEnabled()&&status.media?.fal)note.textContent=t("studioImageEngineFalOptIn");
  else note.textContent=t("studioEngineMissing");
}
// BUG FIX (v5.9.0): every preview/motion render created a new blob: URL and
// never released it, leaking the whole photo/video in memory on each change.
let studioPreviewUrl="",studioMotionUrl="";
function freshObjectUrl(file,prev){if(prev)try{URL.revokeObjectURL(prev)}catch(e){}return file?URL.createObjectURL(file):""}
function renderStudioPreview(){
  const host=$("studioPreview");if(!host)return;host.innerHTML="";if(!studioFile){studioPreviewUrl=freshObjectUrl(null,studioPreviewUrl);return}
  const url=studioPreviewUrl=freshObjectUrl(studioFile,studioPreviewUrl),video=String(studioFile.type||"").startsWith("video/");
  const media=video?`<video controls playsinline src="${url}"></video>`:`<img alt="preview" src="${url}">`;
  host.innerHTML=media+`<div class="studioPreviewMeta"><span>${esc(studioFile.name)}</span><span>${(studioFile.size/1024/1024).toFixed(1)} MB</span></div>`;
}
async function studioFileAsDataUrl(file){return readBlobDataUrl(file)}
async function studioCloudflareImage(file){
  if(!file||!String(file.type||"").startsWith("image/"))return null;const src=await readBlobDataUrl(file),img=await loadImageElement(src),w0=Number(img.naturalWidth||img.width||0),h0=Number(img.naturalHeight||img.height||0);if(!w0||!h0)return null;
  const scale=Math.min(1,500/Math.max(w0,h0)),w=Math.max(1,Math.round(w0*scale)),h=Math.max(1,Math.round(h0*scale)),canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)return null;ctx.drawImage(img,0,0,w,h);const blob=await canvasBlob(canvas,"image/jpeg",0.88),dataUrl=await readBlobDataUrl(blob);return {name:"cloudflare-input.jpg",mime:"image/jpeg",dataUrl};
}
function extractStudioMedia(result){
  const candidates=[];const visit=(v,depth=0)=>{if(depth>6||v==null)return;if(typeof v==="string"){if(/^https:\/\//i.test(v)||/^data:image\/(?:jpeg|png|webp);base64,/i.test(v))candidates.push(v);return}if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return}if(typeof v==="object"){for(const [k,x] of Object.entries(v)){if(["url","video_url","image_url"].includes(k)&&typeof x==="string"&&/^https:\/\//i.test(x))candidates.unshift(x);else visit(x,depth+1)}}};visit(result);return candidates.find(u=>/\.fal\.media(?:\/|$)|\/fal\.media(?:\/|$)|fal\.media\//i.test(u))||candidates[0]||"";
}
function renderStudioResult(result){
  const url=extractStudioMedia(result),host=$("studioResult"),card=$("studioResultCard"),link=$("studioOpenResult");if(!host||!card)return;
  card.classList.remove("hidden");if(!url){host.innerHTML=`<pre class="diag">${esc(JSON.stringify(result,null,2).slice(0,12000))}</pre>`;if(link)link.classList.add("hidden");return}
  const looksVideo=/\.(mp4|mov|webm)(?:\?|$)/i.test(url)||/video/i.test(JSON.stringify(result).slice(0,200));
  host.innerHTML=looksVideo?`<video controls playsinline src="${esc(url)}"></video>`:`<img alt="AI Studio result" src="${esc(url)}">`;
  if(link){link.href=url;link.classList.remove("hidden")}
  card.scrollIntoView({behavior:"smooth",block:"start"});
}
async function pollStudio(requestId,action){
  const maxPolls=180;
  for(let i=0;i<maxPolls;i++){
    const r=await fetch(`/api/media/status?action=${encodeURIComponent(action)}&requestId=${encodeURIComponent(requestId)}`,{cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    const state=String(j.status||"").toUpperCase();
    if(state==="COMPLETED"){studioSetStatus(t("studioCompleted"));renderStudioResult(j.result);return}
    if(state==="FAILED"||state==="CANCELLED")throw new Error(j.error||`${t("studioFailed")} (${state})`);
    studioSetStatus(t("studioQueued",{status:state||"QUEUE"}),"busy");await new Promise(r=>setTimeout(r,2500));
  }
  throw new Error("AI Studio timeout. The job may still be running on fal.ai.");
}
function renderPhotoMotion(file){
  const host=$("studioResult"),card=$("studioResultCard"),link=$("studioOpenResult");if(!host||!card||!file)return;const url=studioMotionUrl=freshObjectUrl(file,studioMotionUrl);card.classList.remove("hidden");if(link)link.classList.add("hidden");host.innerHTML=`<div class="motionStage"><img alt="Free Motion preview" src="${esc(url)}"><span class="motionBadge">FREE • LOCAL • NO API</span></div>`;studioSetStatus(t("studioMotionDone"));
}
async function runStudio(){
  const btn=$("studioRunBtn"),prompt=$("studioPrompt")?.value.trim()||"";if(studioMode!=="photo-motion"&&!prompt){studioSetStatus(t("studioNeedPrompt"),"bad");return}
  if(studioModeNeedsFile()&&!studioFile){studioSetStatus(t(studioModeNeedsVideo()?"studioNeedVideo":"studioNeedPhoto"),"bad");return}
  if(studioFile&&studioFile.size>(studioModeNeedsVideo()?12_000_000:10_000_000)){studioSetStatus(studioModeNeedsVideo()?t("studioNeedVideo"):"Image is too large (max 10 MB).","bad");return}
  if(studioMode==="photo-motion"){renderPhotoMotion(studioFile);return}
  const allowPaidFallback=studioPaidFallbackEnabled();if(!["photo-edit","photo-generate"].includes(studioMode)&&!allowPaidFallback){studioSetStatus(t("studioPaidVideoOff"),"bad");return}
  btn.disabled=true;document.querySelector(".studioComposer")?.classList.add("studioGenerating");studioSetStatus(t("studioSubmitting"),"busy");
  try{const payload={action:studioMode,prompt,quality:$("studioQuality")?.value||"standard",allowPaidFallback};if(studioFile){payload.file={name:studioFile.name,mime:studioFile.type,dataUrl:await studioFileAsDataUrl(studioFile)};if(studioMode==="photo-edit"){const cf=await studioCloudflareImage(studioFile);if(cf)payload.cloudflareFile=cf}}const r=await fetch("/api/media/submit",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify(payload)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error([j.error||`HTTP ${r.status}`,j.help].filter(Boolean).join("\n"));if(String(j.status||"").toUpperCase()==="COMPLETED"&&j.result){studioSetStatus(`${t("studioCompleted")} • ${j.engine==="cloudflare-workers-ai"?t("studioViaCloudflare"):"AI Studio"}`);renderStudioResult(j.result);return}if(!j.requestId)throw new Error("Studio provider returned no request id.");await pollStudio(j.requestId,studioMode)}catch(e){studioSetStatus(`${t("studioFailed")}: ${e.message}`,"bad")}finally{btn.disabled=false;document.querySelector(".studioComposer")?.classList.remove("studioGenerating")}
}

/* =====================================================================
   v5.9.0 — personalization, adaptive style, feedback learning, starters,
   follow-ups, export, command palette and the Learn (self-improvement) page
   ===================================================================== */
let lastChatRequest=null;
const STYLE_KEY="ai_bridge_style_v1",STYLE_AUTO_KEY="ai_bridge_style_auto",FEEDBACK_STATS_KEY="ai_bridge_feedback_stats_v1",HINT_OFF_KEY="ai_bridge_hint_off_v1",TEMPLATES_KEY="ai_bridge_templates_v1";
function feedbackStats(){const v=lsJson(FEEDBACK_STATS_KEY,{});return v&&typeof v==="object"?v:{}}
function bumpFeedbackStat(key,delta=1){const s=feedbackStats();s[key]=Math.max(0,Math.min(999,(Number(s[key])||0)+delta));lsSet(FEEDBACK_STATS_KEY,JSON.stringify(s));return s}
function disabledHints(){const v=lsJson(HINT_OFF_KEY,[]);return Array.isArray(v)?v.map(String):[]}
/* Adaptive style: repeated reasons on 👎 turn into standing style hints.
   This is behaviour adaptation from the user's own signal — visible on the
   Learn page, individually switchable off, and never sent anywhere else. */
function adaptiveHints(){
  if(lsGet(STYLE_AUTO_KEY,"1")!=="1")return [];
  const s=feedbackStats(),off=new Set(disabledHints()),out=[];
  const add=(id,count,need)=>{if(count>=need&&!off.has(id))out.push({id,text:t(`hint_${id}`,{lang:(I18N?.LANGUAGES?.[I18N?.getLanguage?.()]?.name)||"Українська"}),count})};
  if((s.long||0)>(s.short||0))add("long",s.long||0,2);
  if((s.short||0)>(s.long||0))add("short",s.short||0,2);
  add("language",s.language||0,1);add("sources",s.sources||0,2);add("wrong",s.wrong||0,2);add("offtopic",s.offtopic||0,2);
  return out;
}
function effectiveResponseStyle(){
  const own=String(lsGet(STYLE_KEY,"")||"").trim().slice(0,600),hints=adaptiveHints().map(h=>h.text);
  return [own,...hints].filter(Boolean).join(" ").slice(0,600);
}
function styleField(){const s=effectiveResponseStyle(),r=activeRole();return {...(s?{responseStyle:s}:{}),...(r?{role:{name:r.name,instructions:r.instructions}}:{})}}
function renderAdaptiveHints(){
  const host=$("adaptiveHints");if(!host)return;const hints=adaptiveHints();
  host.innerHTML=hints.map(h=>`<div class="hintRow"><span>${esc(h.text)}</span><small>${esc(t("hintLearned",{n:h.count}))}</small><button type="button" data-hint-off="${esc(h.id)}">${esc(t("hintDisable"))}</button></div>`).join("");
  host.querySelectorAll("[data-hint-off]").forEach(b=>b.onclick=()=>{const off=new Set(disabledHints());off.add(b.dataset.hintOff);lsSet(HINT_OFF_KEY,JSON.stringify([...off]));renderAdaptiveHints();toast(t("hintDisabled"))});
}

/* v5.11.6: "Швидкий старт" прибрано з чату за вимогою власника. */
function fillPrompt(text){showPage("chat");const p=$("prompt");if(!p)return;p.value=text;p.dispatchEvent(new Event("input",{bubbles:true}));p.focus();try{p.setSelectionRange(p.value.length,p.value.length)}catch(e){}}

/* ---------- feedback (👍 / 👎) ---------- */
let feedbackState={id:null,rating:null,reasons:new Set()};
function learningRefOf(run){const l=run?.meta?.learning;return l&&typeof l.category==="string"&&typeof l.routeKey==="string"?{category:l.category,routeKey:l.routeKey}:null}
function resetFeedbackUi(run){
  feedbackState={id:newRequestId(),rating:null,reasons:new Set()};
  const err=!!run?.meta?.error;
  for(const id of ["feedbackUpBtn","feedbackDownBtn"]){const b=$(id);if(b){b.setAttribute("aria-pressed","false");b.classList.toggle("hidden",err)}}
  for(const id of ["regenBtn","exportMdBtn","handoffBtn","forkBtn","ttsBtn"])$(id)?.classList.toggle("hidden",err&&!run?.prompt);
  $("feedbackPanel")?.classList.add("hidden");document.querySelectorAll(".reasonChip").forEach(c=>c.classList.remove("selected"));
  const st=$("feedbackStatus");if(st)st.textContent="";
  syncBookmarkBtn(err?null:run); // v5.11.30: зірочка закладки на поточній відповіді
}
async function postFeedback(body){
  const r=await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify(body)});
  const j=await readApiJson(r);if(!r.ok)throw Object.assign(new Error(j.error||`HTTP ${r.status}`),{status:r.status});return j;
}
async function sendFeedback(rating,reason=null){
  const run=currentRun;if(!run)return;
  /* v5.11.99: 👎 на вивченій відповіді Ядра — Ядро її забуває */
  if(rating==="down"&&!reason&&run.meta?.coreQaId){
    try{if(coreAssistant()?.forgetQA(run.meta.coreQaId)){saveCoreMemoryQuiet();run.meta.coreQaId=null;toast(t("coreForgotAnswer"),"good")}}catch(e){}
  }
  const previous=feedbackState.rating,st=$("feedbackStatus");
  if(!reason&&previous===rating)return;
  if(!reason){
    feedbackState.rating=rating;
    $("feedbackUpBtn")?.setAttribute("aria-pressed",rating==="up"?"true":"false");
    $("feedbackDownBtn")?.setAttribute("aria-pressed",rating==="down"?"true":"false");
    $("feedbackPanel")?.classList.toggle("hidden",rating!=="down");
    if(previous)bumpFeedbackStat(previous,-1);bumpFeedbackStat(rating);
  }else{
    if(feedbackState.reasons.has(reason))return;
    feedbackState.reasons.add(reason);bumpFeedbackStat(reason);renderAdaptiveHints();
  }
  const ref=learningRefOf(run);
  if(!ref){if(st)st.textContent=t(reason?"feedbackReasonLocal":"feedbackLocal");return}
  try{
    const j=await postFeedback({feedbackId:feedbackState.id,...ref,rating:feedbackState.rating||rating,previous:reason?feedbackState.rating:previous,reasons:reason?[reason]:[]});
    if(st)st.textContent=reason?t("feedbackReasonSaved"):t("feedbackSaved",{conf:Math.round((Number(j.confidence)||0)*100)});
  }catch(e){if(st)st.textContent=e.status===404?t("feedbackRouteGone"):t("feedbackFailed")}
}

/* ---------- follow-ups, regenerate, export ---------- */
const FOLLOW_UPS=["shorter","detail","example","simpler","check"];
/* v5.11.25: контекстні чипи продовження (ідея scout) — замість 5 статичних
   показуємо 3 найдоречніші за змістом відповіді: довга відповідь → «Коротше»,
   код у відповіді → «Поясни простіше»/«Дай приклад», коротка → «Детальніше». */
function pickFollowUpIds(run){
  const ans=String(run.final||(run.results||[]).find(r=>r.ok)?.text||"");
  const q=String(run.prompt||"").toLowerCase();
  const hasCode=/```/.test(ans),s={shorter:0,detail:0,example:0,simpler:0,check:0};
  if(ans.length>1800)s.shorter+=2;
  if(ans.length<500){s.detail+=2;s.example+=1}
  if(hasCode){s.simpler+=2;s.example+=1}
  if(/як |how |що таке|what is|поясни|explain|чому |why |навіщо/.test(q))s.detail+=1;
  if(/код|code|помил|error|скрипт|script|функці/.test(q))s.example+=1;
  s.detail+=1;s.example+=1;s.check+=0.5;
  return Object.keys(s).sort((a,b)=>s[b]-s[a]).slice(0,3);
}
function renderFollowUps(run){
  const host=$("followUps");if(!host)return;
  if(!run||run.meta?.error||!(run.final||run.results?.some(r=>r.ok))){host.innerHTML="";return}
  // v5.11.84: запитання агента (закінчується «?») → швидкі відповіді-чернетки
  const agentQ=agentQuestionOf(run);
  if(agentQ){renderSmartReplies(run,agentQ);return}
  const ids=pickFollowUpIds(run);
  // v5.11.61: кнопка «Продовжити» — лише коли відповідь обірвано на ліміті токенів.
  const contBtn=run.meta?.truncated&&run.final?`<button class="followChip continueChip" type="button" data-continue="1">${esc(t("continueBtn"))}</button>`:"";
  host.innerHTML=contBtn+ids.map(id=>`<button class="followChip" type="button" data-follow="${id}">${esc(t(`follow_${id}`))}</button>`).join("");
  const cb=host.querySelector("[data-continue]");if(cb)cb.onclick=continueAnswer;
  host.querySelectorAll("[data-follow]").forEach(b=>b.onclick=()=>{
    const r=currentRun;if(!r)return;const answer=String(r.final||r.results?.find(x=>x.ok)?.text||"");
    const promptText=`${t(`followAsk_${b.dataset.follow}`)}\n\n${t("followPrevQuestion")}: ${String(r.prompt||"").slice(0,1500)}\n\n${t("followPrevAnswer")}:\n${answer.slice(0,6000)}`;
    sendTask({source:"chat",promptText});
  });
}
/* v5.11.84: швидкі відповіді на запитання агента (smart replies, ідея scout).
   Коли останнє повідомлення асистента — запитання (закінчується «?»),
   під ним показуються 3 чипи-чернетки: тап підставляє текст у поле вводу,
   але НЕ відправляє. Спочатку — евристичні варіанти (витягуємо опції
   з тексту запитання або Так/Ні/Пропусти), потім, якщо є провайдери,
   дешева фонова модель уточнює репліки під контекст. */
const SMART_REPLY_CACHE={sig:"",items:[]};
function smartReplySig(run){return `${run?.uid||""}:${String(run?.final||"").length}:${String(run?.final||"").slice(-80)}`}
function agentQuestionOf(run){
  const txt=String(run?.final||(run?.results||[]).find(r=>r.ok)?.text||"").trim();
  if(!txt||run?.meta?.error)return "";
  const m=txt.match(/([^.!?…\n]{2,300}\?\s*)$/);
  return m?m[1].trim():"";
}
function smartReplyHeuristics(q){
  const opts=[];
  const list=q.match(/:\s*([^.?!\n]{3,160})\??\s*$/);
  if(list){
    list[1].split(/,|;|\s+(?:\u0430\u0431\u043e|\u0447\u0438|or)\s+|\s*[|/]\s*/i)
      .map(s=>s.trim().replace(/^[«"'(\[]+|[»"')\].:;!?]+/g,"").trim())
      .filter(s=>s.length>=2&&s.length<=48)
      .slice(0,3)
      .forEach(s=>opts.push(s.charAt(0).toUpperCase()+s.slice(1)));
  }
  const generic=["smartYes","smartNo","smartSkip"];
  for(let i=0;opts.length<3&&i<generic.length;i++)opts.push(t(generic[i]));
  return opts.slice(0,3);
}
async function renderSmartReplies(run,q){
  const host=$("followUps");if(!host)return;
  const sig=smartReplySig(run);
  host.innerHTML=`<span class="smartReplyTitle">${esc(t("smartRepliesTitle"))}</span><span class="smartReplyChips" id="smartReplyChips"></span>`;
  const chips=$("smartReplyChips");
  const draw=items=>{
    chips.innerHTML=items.map(x=>`<button class="followChip smartChip" type="button">${esc(x)}</button>`).join("");
    chips.querySelectorAll(".smartChip").forEach((b,i)=>b.onclick=()=>{fillPrompt(items[i]);toast(t("smartReplyDrafted"),"ok")});
  };
  if(SMART_REPLY_CACHE.sig===sig&&SMART_REPLY_CACHE.items.length){draw(SMART_REPLY_CACHE.items);return}
  draw(smartReplyHeuristics(q));
  // фонове уточнення дешевою моделлю (якщо провайдери доступні)
  try{
    const provs=selectedProviders();if(!provs.length)return;
    const gate=spendGateState(monthSpendUsd(),spendCapUsd());if(gate.state==="block")return;
    const payload={prompt:t("smartReplyPrompt",{q:q.slice(0,600)}).slice(0,4000),mode:"auto",providers:provs,synthesize:false,effort:"fast",backgroundModel:getBgModel(),clientRequestId:newRequestId()};
    const r=await legacyRunRequest(payload);
    if(!r.ok||smartReplySig(currentRun)!==sig)return;
    const lines=String(r.j?.final||r.j?.results?.find(x=>x.ok)?.text||"").split(/\n+/).map(s=>s.trim().replace(/^[-•*\d.)\s]+/,"").replace(/^["«]|["»]$/g,"")).filter(s=>s.length>=2&&s.length<=80).slice(0,3);
    if(lines.length>=2){try{recordUsage({results:r.j.results,created:Date.now()})}catch(e){}
      SMART_REPLY_CACHE.sig=sig;SMART_REPLY_CACHE.items=lines;draw(lines)} // v5.11.92: було присвоєння const → TypeError, уточнені підказки ніколи не показувались
  }catch(e){/* евристичні чипи лишаються */}
}
/* ---------- v5.9.9: edit question, answer with another model ---------- */
/* v5.11.25: справжнє «редагувати і перегенерувати» (ідея scout).
   Олівець відкриває шторку з текстом питання; «Зберегти і оновити»
   одразу відправляє відредаговане питання — відповідь генерується заново. */
function editLastPrompt(){
  const p=currentRun?.prompt||lastChatRequest?.promptText;if(!p){toast(t("noAnswer"),"bad");return}
  const ta=$("editPromptText");
  if(!ta){ // fallback: старе поводження, якщо шторки немає в DOM
    showPage("chat");const el=$("prompt");if(!el)return;el.value=p;updateCallEstimate?.();
    setTimeout(()=>{el.scrollIntoView({behavior:"smooth",block:"center"});el.focus();try{el.setSelectionRange(p.length,p.length)}catch(e){}},250);
    return;
  }
  ta.value=p;openSheet("editPromptSheet");
  setTimeout(()=>{try{ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)}catch(e){}},120);
}
function saveEditedPrompt(){
  const ta=$("editPromptText"),text=String(ta?.value||"").trim();
  if(!text){toast(t("taskNeedPhotoOrText"),"bad");try{ta?.focus()}catch(e){}return}
  closeSheet("editPromptSheet");
  if($("sendBtn")?.disabled){toast(t("working"));return}
  sendTask({source:"chat",promptText:text});
}
function openOtherModel(){
  const box=$("otherModelBox");if(!box)return;
  if(!box.classList.contains("hidden")){box.classList.add("hidden");return}
  const used=new Set((currentRun?.results||[]).filter(r=>r.ok).map(r=>r.provider));
  const ids=Object.keys(PROVIDERS).filter(id=>status.providers?.[id]);
  box.innerHTML=ids.length?`<b>${esc(t("otherModelPick"))}</b><div class="otherModelRow">${ids.map(id=>`<button type="button" class="otherModelBtn${used.has(id)?" used":""}" data-other-model="${id}">${esc(PROVIDERS[id].name)}${used.has(id)?` <small>${esc(t("otherModelUsed"))}</small>`:""}</button>`).join("")}</div>`:`<span>${esc(t("otherModelNone"))}</span>`;
  box.classList.remove("hidden");
  box.querySelectorAll("[data-other-model]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");answerWithModel(b.dataset.otherModel)});
}
function answerWithModel(id){
  const p=currentRun?.prompt||lastChatRequest?.promptText;if(!p){toast(t("noAnswer"),"bad");return}
  if($("sendBtn")?.disabled){toast(t("working"));return}
  const prev=currentRun&&currentRun.final?{final:currentRun.final,provider:(currentRun.results||[]).find(r=>r.ok)?.provider||currentRun.judge||"",title:$("finalTitle")?.textContent||""}:null;
  compareBase=prev;
  sendTask({source:"chat",promptText:p,forceProvider:id});
}
let compareBase=null;
function renderCompare(run){
  const host=$("compareBox");if(!host)return;
  if(!compareBase||!run?.final||run.final===compareBase.final){host.classList.add("hidden");host.textContent="";return}
  const base=compareBase;compareBase=null;
  host.innerHTML=`<summary>${esc(t("compareTitle",{a:PROVIDERS[base.provider]?.name||base.provider||t("comparePrev")}))}</summary><div class="compareBody md" id="compareBody"></div>`;
  renderRich($("compareBody"),base.final);host.classList.remove("hidden");host.open=false;
}
/* ---------- v5.9.9: saved assistant roles ---------- */
const ROLES_KEY="ai_bridge_roles_v1",ROLE_ACTIVE_KEY="ai_bridge_role_active";
const BUILTIN_ROLES=[
  {id:"simple",builtin:true,nameKey:"roleSimpleName",instrKey:"roleSimpleInstr"},
  {id:"translator",builtin:true,nameKey:"roleTranslatorName",instrKey:"roleTranslatorInstr"},
  {id:"editor",builtin:true,nameKey:"roleEditorName",instrKey:"roleEditorInstr"},
  {id:"business",builtin:true,nameKey:"roleBusinessName",instrKey:"roleBusinessInstr"}
];
function loadCustomRoles(){try{const a=JSON.parse(localStorage.getItem(ROLES_KEY)||"[]");return Array.isArray(a)?a.filter(r=>r&&r.id&&r.name&&r.instructions).slice(0,30):[]}catch(e){return []}}
function saveCustomRoles(list){localStorage.setItem(ROLES_KEY,JSON.stringify(list.slice(0,30)))}
function allRoles(){return [...BUILTIN_ROLES.map(r=>({...r,name:t(r.nameKey),instructions:t(r.instrKey)})),...loadCustomRoles()]}
function activeRole(){const id=localStorage.getItem(ROLE_ACTIVE_KEY)||"";if(!id)return null;return allRoles().find(r=>r.id===id)||null}
function setActiveRole(id){if(id)localStorage.setItem(ROLE_ACTIVE_KEY,id);else localStorage.removeItem(ROLE_ACTIVE_KEY);renderRoleChips();renderRoleSheet()}
function renderRoleChips(){
  const r=activeRole();
  document.querySelectorAll("[data-role-open]").forEach(b=>{b.classList.toggle("on",!!r);const n=b.querySelector(".roleChipName");if(n)n.textContent=r?r.name:t("roleNone")});
}
function renderRoleSheet(){
  const host=$("roleList");if(!host)return;const cur=activeRole()?.id||"";
  const item=r=>`<div class="roleItem${r.id===cur?" active":""}"><button type="button" class="roleSelect" data-role-pick="${esc(r.id)}"><b>${esc(r.name)}</b><small>${esc(r.instructions.slice(0,80))}${r.instructions.length>80?"…":""}</small>${r.provider&&PROVIDERS[r.provider]?`<em>${esc(PROVIDERS[r.provider].name)}</em>`:""}</button>${r.builtin?"":`<button type="button" class="roleDup" data-role-dup="${esc(r.id)}" aria-label="${esc(t("roleDuplicate"))}" title="${esc(t("roleDuplicate"))}">⧉</button><button type="button" class="roleDel" data-role-del="${esc(r.id)}" aria-label="${esc(t("roleDelete"))}">✕</button>`}</div>`;
  host.innerHTML=`<div class="roleItem${cur?"":" active"}"><button type="button" class="roleSelect" data-role-pick=""><b>${esc(t("roleNone"))}</b><small>${esc(t("roleNoneHint"))}</small></button></div>`+allRoles().map(item).join("");
  host.querySelectorAll("[data-role-pick]").forEach(b=>b.onclick=()=>{setActiveRole(b.dataset.rolePick);closeSheet("roleSheet");toast(b.dataset.rolePick?t("roleOn",{name:activeRole()?.name||""}):t("roleOff"))});
  host.querySelectorAll("[data-role-del]").forEach(b=>b.onclick=()=>{if(!confirm(t("roleDeleteConfirm")))return;saveCustomRoles(loadCustomRoles().filter(r=>r.id!==b.dataset.roleDel));if(localStorage.getItem(ROLE_ACTIVE_KEY)===b.dataset.roleDel)localStorage.removeItem(ROLE_ACTIVE_KEY);renderRoleChips();renderRoleSheet()});
  /* v5.11.89: дублювання ролі (ідея scout «клонування ролі») */
  host.querySelectorAll("[data-role-dup]").forEach(b=>b.onclick=()=>duplicateRole(b.dataset.roleDup));
  const sel=$("roleProvider");if(sel){const v=sel.value;sel.innerHTML=`<option value="">${esc(t("roleProviderAuto"))}</option>`+Object.keys(PROVIDERS).filter(id=>status.providers?.[id]).map(id=>`<option value="${id}">${esc(PROVIDERS[id].name)}</option>`).join("");sel.value=v}
}
function addCustomRole(){
  const name=($("roleName")?.value||"").trim().slice(0,60),instructions=($("roleInstr")?.value||"").trim().slice(0,1500),provider=$("roleProvider")?.value||"";
  if(!name||!instructions){toast(t("roleNeedFields"),"bad");return}
  if(/\b(sk-[A-Za-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{12,}|xai-[A-Za-z0-9]{12,})/.test(instructions)){toast(t("roleNoSecrets"),"bad");return}
  const role={id:"r"+newUid().slice(0,12),name,instructions,provider:PROVIDERS[provider]?provider:""};
  saveCustomRoles([...loadCustomRoles(),role]);$("roleName").value="";$("roleInstr").value="";
  setActiveRole(role.id);closeSheet("roleSheet");toast(t("roleOn",{name}));
}
/* ---------- v5.11.89: клонування ролі (ідея scout) ----------
   Чиста функція для тестів: cloneRolePayload будує чернетку копії з суфіксом
   з i18n (roleCopySuffix); duplicateRole підставляє її у форму «Нова роль»,
   тож Сергій редагує й зберігає — дублікатів без його згоди не виникає. */
function cloneRolePayload(role,suffix){
  return {name:(String(role&&role.name||"").slice(0,50)+String(suffix||"")),instructions:String(role&&role.instructions||""),provider:String(role&&role.provider||"")};
}
function duplicateRole(id){
  const r=loadCustomRoles().find(x=>x.id===id);if(!r)return;
  const d=cloneRolePayload(r,t("roleCopySuffix"));
  if($("roleName"))$("roleName").value=d.name;
  if($("roleInstr"))$("roleInstr").value=d.instructions;
  const prov=$("roleProvider");if(prov&&PROVIDERS[d.provider])prov.value=d.provider;
  const det=document.querySelector("details.roleNew");if(det)det.open=true;
  toast(t("roleDuplicated"),"ok");
}
/* ---------- v5.9.9: simpler navigation — bottom bar + "More" sheet ---------- */
function openSheet(id){const el=$(id);if(!el)return;dismissKeyboard();el.classList.remove("hidden");document.body.classList.add("sheetOpen");if(id==="roleSheet")renderRoleSheet();if(id==="exportSheet"){const c=$("exportPickPlaceChk");if(c)c.checked=exportPickPlaceOn()}setTimeout(()=>el.querySelector("button,input,select,textarea")?.focus({preventScroll:true}),30)}
function closeSheet(id){const el=$(id);if(!el)return;el.classList.add("hidden");if(!document.querySelector(".sheet:not(.hidden)"))document.body.classList.remove("sheetOpen")}
const NAV_GROUPS={agent:"chat",team:"chat",brain:"more",connections:"more"};
function syncNavGroup(name){
  document.querySelectorAll(".tab").forEach(tb=>tb.classList.remove("groupActive"));
  const g=NAV_GROUPS[name];if(g==="chat")document.querySelector('.tab[data-page="chat"]')?.classList.add("groupActive");else if(g==="more")$("moreTab")?.classList.add("groupActive");
  document.querySelectorAll("[data-switch]").forEach(b=>{const on=b.dataset.switch===name;b.classList.toggle("active",on);b.setAttribute("aria-selected",on?"true":"false")});
}
function regenerate(){const r=currentRun,p=r?.prompt||lastChatRequest?.promptText;if(!p){toast(t("noAnswer"),"bad");return}if($("sendBtn")?.disabled){toast(t("working"));return}sendTask({source:lastChatRequest?.source==="files"&&attachments.length?"files":"chat",promptText:p})}
/* v5.11.61: «Продовжити» обірвану відповідь (ідея scout) — кнопка під
   відповіддю, яку провайдер обрізав на ліміті токенів (meta.truncated).
   Відправляє хід-продовження з хвостом відповіді як контекстом; після
   успіху текст склеюється в цілісну відповідь. */
function continueAnswer(){
  const r=currentRun;if(!r||!r.final){toast(t("noAnswer"),"bad");return}
  if($("sendBtn")?.disabled){toast(t("working"));return}
  sendTask({source:"chat",promptText:t("continuePrompt"),continueFrom:{question:r.continueRoot||r.prompt,answer:String(r.final)}});
}
function exportMarkdown(){
  const r=currentRun;if(!r){toast(t("noAnswer"),"bad");return}
  const answer=String(r.final||r.results?.find(x=>x.ok)?.text||"");
  const sources=(r.meta?.webSearch?.results||[]).map(x=>({title:String(x.title||x.url||""),url:safeSourceUrl(x.url)})).filter(x=>x.url);
  const lines=[`# ${String(r.prompt||"AI Bridge").split("\n")[0].slice(0,140)}`,"",answer];
  if(sources.length)lines.push("","## Sources",...sources.map((x,i)=>`${i+1}. [${x.title.replace(/[\[\]]/g,"")}](${x.url})`));
  lines.push("","---",`AI Bridge v${UI_VERSION} • ${new Date(r.created||Date.now()).toLocaleString(I18N?.locale?.()||"uk-UA")} • ${(r.providers||[]).map(x=>PROVIDERS[x]?.name||x).join(", ")||r.mode||""}`);
  const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`ai-bridge-${new Date().toISOString().slice(0,16).replace(/[:T]/g,"-")}.md`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast(t("exported"),"good");
}
/* v5.11.63: «Копіювати для ШІ» — діалог як машинно-читабельний текст у буфер
   (ідея scout): ролі + текст + модель, без UI-хрому — для живого перенесення
   контексту в інший сеанс ШІ. Не дублює експорт (той — файли, це — буфер).
   Чистий JS, дані не залишають пристрій. buildHandoffText — чиста, для тестів. */
function buildHandoffText({youLabel,aiLabel,question,answer,model}){
  const q=String(question||"").trim(),a=String(answer||"").trim(),m=String(model||"").trim();
  const head=m?`${aiLabel} (${m})`:aiLabel;
  return [`${youLabel}: ${q}`,"",`${head}: ${a}`].join("\n");
}
async function copyAiHandoff(){
  const r=currentRun;if(!r){toast(t("noAnswer"),"bad");return}
  const q=String(r.prompt||"").trim();
  const provId=(r.selectedProviders||[])[0];
  const a=String(r.final||r.results?.find(x=>x.ok)?.text||"").trim();
  if(!q&&!a){toast(t("noAnswer"),"bad");return}
  const txt=buildHandoffText({youLabel:t("handoffYou"),aiLabel:t("handoffAi"),question:q,answer:a,model:provId?(PROVIDERS[provId]?.name||provId):""});
  const btn=$("handoffBtn"),label=btn?.querySelector('span[data-i18n="handoffBtn"]');
  try{
    await navigator.clipboard.writeText(txt);
    if(label)label.textContent=t("copied");btn?.classList.add("done");
    setTimeout(()=>{if(label)label.textContent=t("handoffBtn");btn?.classList.remove("done")},1100);
    toast(t("handoffCopied"),"good");
  }catch(e){toast(t("copyFailed"),"bad")}
}
/* v5.11.65: «Зберегти в нотатки» + «Створити список» з переліку (ідея scout).
   Кнопка в «•••» під відповіддю зберігає текст поточної відповіді як нотатку
   в існуюче сховище NOTES_KEY (v5.11.47). Якщо у відповіді є перелік (≥2 пункти
   маркованого/нумерованого списку) — відкривається вибір: весь текст або тільки
   пункти як чек-лист «- [ ]». extractListItems/buildNoteListText — чисті, для тестів. */
function answerTextForNote(){
  return String(currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||"").trim();
}
function extractListItems(text){
  const items=[];
  for(const ln of String(text||"").split("\n")){
    const m=ln.match(/^\s*(?:[-•*]|\d{1,3}[.)])\s+(\S[\s\S]*)$/);
    if(m)items.push(m[1].trim().replace(/^([-•*]\s+)+/,""));
  }
  return items.filter(x=>x.length);
}
function buildNoteListText(items){return items.map(x=>`- [ ] ${x}`).join("\n")}
let noteSavePending=null;
function saveNoteText(text){
  const a=loadNotes();a.push({id:newRequestId(),text:String(text).slice(0,8000),created:Date.now(),updated:Date.now()});
  saveNotes(a);try{renderNotes()}catch(e){}
  toast(t("saveNoteSaved"),"good");
}
function saveAnswerAsNote(){
  const txt=answerTextForNote();
  if(!txt){toast(t("noAnswer"),"bad");return}
  const items=extractListItems(txt);
  if(items.length>=2){
    noteSavePending={full:txt,list:buildNoteListText(items)};
    $("noteSaveCount").textContent=t("saveNoteCount",{n:items.length});
    openSheet("noteSaveSheet");
    return;
  }
  saveNoteText(txt);
}
/* v5.11.69: «Покращити запит» у композері + «Перекласти» відповідь одним тапом
   (ідеї scout). Обидві дії — через дешеву фонову модель: mode:"auto",
   effort:"fast", synthesize:false — той самий патерн, що enhanceNote (v5.11.47).
   Жодних секретів у коді; витрата пишеться в usage й поважає бюджет.
   improvePromptOf/translatePromptOf/cyrillicRatio — чисті, для тестів. */
function improvePromptOf(text){return `${t("improvePromptPrefix")}${String(text||"").trim()}`}
function translatePromptOf(text){return `${t("translatePromptPrefix")}${String(text||"").trim()}`}
function cyrillicRatio(s){
  const letters=String(s||"").replace(/[^A-Za-z\u0400-\u04FF]/g,"");
  if(!letters.length)return 0;
  return (letters.match(/[\u0400-\u04FF]/g)||[]).length/letters.length;
}
let improveBusy=false,translateBusy=false,translateCache={sig:"",target:"",text:""};
function translateSig(txt){const s=String(txt||"");return `${s.length}:${s.slice(0,64)}|${s.slice(-32)}`}
async function improvePrompt(){
  if(improveBusy)return;
  const ta=$("prompt"),text=String(ta?.value||"").trim();
  if(!text){toast(t("improveEmpty"),"warn");return}
  const provs=selectedProviders();
  if(!provs.length){toast(t("improveNoProvider"),"warn");showPage("connections");return}
  const gate=spendGateState(monthSpendUsd(),spendCapUsd());
  if(gate.state==="block"){toast(t("spendCapBlocked"),"bad");return}
  improveBusy=true;const btn=$("improveBtn");btn?.classList.add("busy");btn?.setAttribute("aria-busy","true");
  try{
    const payload={prompt:improvePromptOf(text).slice(0,12000),mode:"auto",providers:provs,synthesize:false,effort:"fast",clientRequestId:newRequestId()};
    const run=await legacyRunRequest(payload);
    if(!run.ok){toast(`${t("improveFail")} ${friendlyRunError(run.j,run.status)}`,"bad");return}
    const improved=String(run.j?.final||run.j?.results?.find(r=>r.ok)?.text||"").trim();
    if(!improved){toast(t("improveFail"),"bad");return}
    try{recordUsage({results:run.j.results,created:Date.now()})}catch(e){}
    ta.value=improved;try{ta.focus()}catch(e){}
    toast(t("improveDone"),"good");
  }catch(e){toast(`${t("improveFail")} ${e?.message||e}`,"bad")}
  finally{improveBusy=false;btn?.classList.remove("busy");btn?.removeAttribute("aria-busy")}
}
function renderTranslationBox(){
  const box=$("translationBox");if(!box)return;
  if(!translateCache.text){box.classList.add("hidden");box.innerHTML="";return}
  box.classList.remove("hidden");
  box.innerHTML=`<div class="trHead"><b>${esc(t("translateTitle"))}</b><button type="button" class="tinyBtn" data-tr-close>${esc(t("translateClose"))}</button></div><div class="trBody">${esc(translateCache.text)}</div>`;
  box.querySelector("[data-tr-close]").onclick=()=>{translateCache={sig:"",target:"",text:""};renderTranslationBox()};
}
async function translateAnswer(){
  if(translateBusy)return;
  const txt=answerTextForNote();
  if(!txt){toast(t("noAnswer"),"bad");return}
  const uiLang=(I18N?.getLanguage?.()||"uk"); // v5.11.92: getLanguage живе в I18N — голий виклик завжди давав "uk"
  const target=uiLang==="uk"?"uk":"en";
  const cyr=cyrillicRatio(txt);
  if(target==="uk"&&cyr>=0.5){toast(t("translateAlreadyUa"),"warn");return}
  if(target==="en"&&cyr<0.2){toast(t("translateAlreadyEn"),"warn");return}
  const sig=translateSig(txt);
  if(translateCache.sig===sig&&translateCache.target===target&&translateCache.text){renderTranslationBox();return}
  const provs=selectedProviders();
  if(!provs.length){toast(t("translateNoProvider"),"warn");showPage("connections");return}
  const gate=spendGateState(monthSpendUsd(),spendCapUsd());
  if(gate.state==="block"){toast(t("spendCapBlocked"),"bad");return}
  translateBusy=true;const btn=$("translateBtn");btn?.classList.add("busy");
  try{
    const payload={prompt:translatePromptOf(txt.slice(0,12000)),mode:"auto",providers:provs,synthesize:false,effort:"fast",clientRequestId:newRequestId()};
    const run=await legacyRunRequest(payload);
    if(!run.ok){toast(`${t("translateFail")} ${friendlyRunError(run.j,run.status)}`,"bad");return}
    const out=String(run.j?.final||run.j?.results?.find(r=>r.ok)?.text||"").trim();
    if(!out){toast(t("translateFail"),"bad");return}
    try{recordUsage({results:run.j.results,created:Date.now()})}catch(e){}
    translateCache={sig,target,text:out};renderTranslationBox();
    toast(t("translateDone"),"good");
  }catch(e){toast(`${t("translateFail")} ${e?.message||e}`,"bad")}
  finally{translateBusy=false;btn?.classList.remove("busy")}
}
/* v5.11.65: long-press на відповіді → меню дій «•••» (ідея scout, мобільний
   UX-звіт 2026: long-press як доступна альтернатива кебаб-меню на 390px).
   Поріг 500 мс, рух >12px скасовує; pre/code/button/a жест не чіпає.
   Конфлікту зі свайпом-цитатою v5.11.43 немає (той — горизонтальний рух,
   це — утримання на місці). Повага до prefers-reduced-motion у підсвітці. */
function initLongPressMenu(){
  const card=document.getElementById("finalAnswer");if(!card||card.dataset.longPressInit)return;
  card.dataset.longPressInit="1";
  const details=card.closest("#answerArea")?.querySelector("details.moreActions");
  if(!details)return;
  let timer=null,sx=0,sy=0;
  card.addEventListener("touchstart",e=>{
    if(e.touches.length!==1)return;
    const tg=e.touches[0];
    if(tg.target&&tg.target.closest&&tg.target.closest("pre,code,button,a"))return;
    sx=tg.clientX;sy=tg.clientY;clearTimeout(timer);
    timer=setTimeout(()=>{
      timer=null;
      try{haptic(15)}catch(_){}
      if(!prefersReducedMotion()){card.classList.add("longPressed");setTimeout(()=>card.classList.remove("longPressed"),200)}
      details.open=true;
    },500);
  },{passive:true});
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null}};
  card.addEventListener("touchmove",e=>{
    if(!timer||e.touches.length!==1)return;
    const tg=e.touches[0];
    if(Math.hypot(tg.clientX-sx,tg.clientY-sy)>12)cancel();
  },{passive:true});
  card.addEventListener("touchend",cancel,{passive:true});
  card.addEventListener("touchcancel",cancel,{passive:true});
}
function newTask(){
  viewedRunUid=null; // v5.11.46: порожній діалог — нічого не показано
  showPage("chat");$("answerArea")?.classList.add("hidden");$("tempBadge")?.classList.add("hidden");$("starterWrap")?.classList.remove("hidden");
  // v5.11.51: макет main-chat.html — композер завжди видимий на сторінці чату (старе рішення «Тиші» скасовано Сергієм).
  const p=$("prompt");if(p){p.value=""}updateCallEstimate();
}
/* 2026-10-01: тап на орб відкриває поле вводу внизу. */
function openComposer(){
  const c=$("chatComposer");if(!c)return;
  c.classList.remove("hidden");c.classList.remove("composerReveal");void c.offsetWidth;c.classList.add("composerReveal");
  const p=$("prompt");if(p){try{p.focus({preventScroll:true})}catch(e){try{p.focus()}catch(_){}}}
}

/* ---------- command palette (Ctrl/Cmd + K) ---------- */
let cmdkItems=[],cmdkIndex=0;
function cmdkCommands(){
  const pages=[["chat","💬"],["agent","✦"],["team","◇"],["files","📁"],["studio","🎨"],["brain","🧠"],["connections","🔌"],["history","🕘"]];
  const modes=[["auto","⚡"],["code","⌘"],["askall","◉"],["debate","⚖"],["single","①"],["agent","✦"],["god","◆"],["research","🔬"]];
  const nav={chat:"navChat",agent:"navAgent",team:"navTeam",files:"navFiles",studio:"navStudio",brain:"navBrain",connections:"navConnect",history:"navHistory"};
  const modeTitle={auto:"modeTitleAuto",code:"modeTitleCode",askall:"modeTitleAskAll",debate:"modeTitleDebate",single:"modeTitleSingle",agent:"modeTitleAgent",god:"modeTitleGod",research:"modeTitleResearch"};
  const out=[
    {group:t("cmdkActions"),icon:"＋",label:t("cmdkNewTask"),hint:"N",run:newTask},
    {group:t("cmdkActions"),icon:"◐",label:t("themeToggle"),run:cycleTheme},
    {group:t("cmdkActions"),icon:"⧉",label:t("cmdkCopyAnswer"),run:()=>$("copyFinalBtn")?.click()},
    {group:t("cmdkActions"),icon:"❝",label:t("quoteBtn"),run:()=>$("quoteFinalBtn")?.click()},
    {group:t("cmdkActions"),icon:"🖼️",label:t("quoteCardBtn"),run:()=>$("quoteCardBtn")?.click()},
    // v5.11.40: «Запустити як завдання» — міст із відповіді в команду агентів.
    {group:t("cmdkActions"),icon:"🚀",label:t("runAsTask"),run:()=>$("taskFromAnswerBtn")?.click()},
    {group:t("cmdkActions"),icon:"↓",label:t("cmdkExport"),run:exportMarkdown},
    {group:t("cmdkActions"),icon:"↻",label:t("regenerate"),run:regenerate},
    {group:t("cmdkActions"),icon:"⌁",label:t("testFreeAI"),run:()=>{showPage("connections");testProviders()}},
    ...pages.map(([id,icon])=>({group:t("cmdkGoto"),icon,label:t(nav[id]),run:()=>showPage(id)})),
    ...modes.map(([id,icon])=>({group:t("cmdkMode"),icon,label:t(modeTitle[id]),hint:$("teamMode")?.value===id?"✓":"",run:()=>{$("teamMode").value=id;lsSet("ai_bridge_mode",id);updateModeUI();if(id==="agent")showPage("agent");else showPage("chat");toast(t(modeTitle[id]))}})),
    // v5.11.6: "Швидкий старт" прибрано з чату за вимогою власника — шаблони
    // більше ніде не показуються, тому прибрано і з меню команд.
  ];
  return out;
}
function openCmdk(){const c=$("cmdk");if(!c)return;c.classList.remove("hidden");const i=$("cmdkInput");i.value="";renderCmdk();setTimeout(()=>i.focus(),10)}
function closeCmdk(){$("cmdk")?.classList.add("hidden")}
function renderCmdk(){
  const q=($("cmdkInput")?.value||"").trim().toLowerCase(),list=$("cmdkList");if(!list)return;
  cmdkItems=cmdkCommands().filter(c=>!q||`${c.label} ${c.group}`.toLowerCase().includes(q));cmdkIndex=Math.min(cmdkIndex,Math.max(0,cmdkItems.length-1));
  if(!cmdkItems.length){list.innerHTML=`<div class="cmdkEmpty">${esc(t("cmdkNothing"))}</div>`;return}
  let html="",group="";
  cmdkItems.forEach((c,i)=>{if(c.group!==group){group=c.group;html+=`<div class="cmdkGroup">${esc(group)}</div>`}html+=`<button class="cmdkItem${i===cmdkIndex?" active":""}" type="button" role="option" data-cmdk="${i}"><span class="cmdkIco" aria-hidden="true">${esc(c.icon)}</span><span>${esc(c.label)}</span>${c.hint?`<small>${esc(c.hint)}</small>`:""}</button>`});
  list.innerHTML=html;
  list.querySelectorAll("[data-cmdk]").forEach(b=>{b.onclick=()=>runCmdk(Number(b.dataset.cmdk));b.onmousemove=()=>{if(cmdkIndex!==Number(b.dataset.cmdk)){cmdkIndex=Number(b.dataset.cmdk);list.querySelectorAll(".cmdkItem").forEach(x=>x.classList.toggle("active",x===b))}}});
}
function runCmdk(i){const c=cmdkItems[i];closeCmdk();if(c)try{c.run()}catch(e){recordDiag("cmdk",e?.message||e)}}

/* ---------- Learn page ---------- */
const CATEGORY_LABEL_KEYS={greeting:"cat_greeting",translation:"cat_translation",rewrite:"cat_rewrite",code:"cat_code",code_files:"cat_code_files",files:"cat_files",image:"cat_image",url_task:"cat_url_task",creative:"cat_creative",current_info:"cat_current_info",factual:"cat_factual",research:"cat_research",general:"cat_general"};
function routeLabel(key){const [route,prov,tools]=String(key||"").split("|");const names=(prov&&prov!=="none"?prov.split("+"):[]).map(id=>PROVIDERS[id]?.name||id);return {route:route||"direct",providers:names.join(" + ")||"Agent Core / web",tools:tools&&tools!=="no_tools"?tools.replace(/\+/g,", ").replace(/_/g," "):""}}
function confClass(c){return c<.45?"low":c<.65?"mid":""}
async function loadBrain(){
  renderAdaptiveHints();renderDiagLog();
  const sEl=$("styleInstructions");if(sEl&&document.activeElement!==sEl)sEl.value=lsGet(STYLE_KEY,"")||"";
  const auto=$("styleAuto");if(auto)auto.checked=lsGet(STYLE_AUTO_KEY,"1")==="1";
  const routesHost=$("brainRoutes"),provHost=$("brainProviders"),labHost=$("brainLab");
  if(routesHost)routesHost.innerHTML=`<div class="empty">${esc(t("brainLoading"))}</div>`;
  let learning=null,lab=null,err="";
  try{
    const [lr,ir]=await Promise.all([fetch("/api/learning",{cache:"no-store"}),fetch("/api/improvement-lab",{cache:"no-store"})]);
    learning=await readApiJson(lr);lab=await readApiJson(ir);
    if(lr.status===401||ir.status===401)err=t("brainNeedAuth");else if(!lr.ok)err=learning.error||`HTTP ${lr.status}`;
  }catch(e){err=location.protocol==="file:"?t("statusNeedCloudflare"):t("statusOffline")}
  const fb=feedbackStats(),lessons=loadAgentLessons();
  const routes=[];for(const [cat,list] of Object.entries(learning?.routes||{}))for(const r of list||[])routes.push({...r,category:cat});
  const totals=routes.reduce((a,r)=>({s:a.s+(r.successes||0),f:a.f+(r.failures||0),u:a.u+(r.userUp||0),d:a.d+(r.userDown||0)}),{s:0,f:0,u:0,d:0});
  const provEntries=Object.entries(learning?.providers||{}).filter(([,h])=>(h.successes||0)+(h.failures||0)>0);
  const healthy=provEntries.filter(([,h])=>!h.coolingDown&&(h.consecutiveFailures||0)===0).length;
  const rate=totals.s+totals.f?Math.round(totals.s/(totals.s+totals.f)*100):null;
  $("brainStats").innerHTML=[
    ["accent",routes.length,t("statRoutes")],
    [rate===null?"":rate>=80?"good":"warn",rate===null?"—":`${rate}%`,t("statSuccess")],
    ["",`${(fb.up||0)} / ${(fb.down||0)}`,t("statRatings")],
    [provEntries.length&&healthy<provEntries.length?"warn":"good",provEntries.length?`${healthy}/${provEntries.length}`:"—",t("statHealthy")]
  ].map(([cls,val,label])=>`<div class="statCard ${cls}"><b>${esc(val)}</b><span>${esc(label)}</span></div>`).join("");
  if(err){
    if(routesHost)routesHost.innerHTML=`<div class="empty">${esc(err)}</div>`;
    if(provHost)provHost.innerHTML="";if(labHost)labHost.innerHTML="";
  }else{
    routes.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    if(routesHost)routesHost.innerHTML=routes.length?routes.slice(0,10).map(r=>{const L=routeLabel(r.route),c=Number(r.confidence)||0;return `<div class="brainRow"><b>${esc(t(CATEGORY_LABEL_KEYS[r.category]||"cat_general"))} · ${esc(L.route)} · ${esc(L.providers)}</b><span class="val">${Math.round(c*100)}%</span><div class="confBar ${confClass(c)}"><i style="width:${Math.max(4,Math.round(c*100))}%"></i></div><small>✓ ${Number(r.successes)||0} · ✗ ${Number(r.failures)||0}${r.userUp||r.userDown?` · 👍 ${Number(r.userUp)||0} · 👎 ${Number(r.userDown)||0}`:""}${r.avgMs?` · ~${Math.round(r.avgMs/100)/10}s`:""}${L.tools?` · ${esc(L.tools)}`:""}</small></div>`}).join(""):`<div class="empty">${esc(t("brainNoRoutes"))}</div>`;
    if(provHost)provHost.innerHTML=provEntries.length?provEntries.map(([id,h])=>{const total=(h.successes||0)+(h.failures||0),rel=total?(h.successes||0)/total:0;return `<div class="brainRow"><b>${esc(PROVIDERS[id]?.name||id)}${h.coolingDown?` · <span style="color:var(--gold)">${esc(t("healthCooling",{s:Math.ceil((h.cooldownRemainingMs||0)/1000)}))}</span>`:""}</b><span class="val">${h.latencyMs?`${Math.round(h.latencyMs/100)/10}s`:"—"}</span><div class="confBar ${confClass(rel)}"><i style="width:${Math.max(4,Math.round(rel*100))}%"></i></div><small>✓ ${h.successes||0} · ✗ ${h.failures||0}${h.lastErrorKind?` · ${esc(providerErrorLabel(h.lastErrorKind))}`:""}${h.priorityPenalty?` · ${esc(t("healthPenalty",{n:h.priorityPenalty}))}`:""}</small></div>`}).join(""):`<div class="empty">${esc(t("brainNoHealth"))}</div>`;
    const findings=lab?.findings||[],proposals=lab?.proposals||[];
    if(labHost)labHost.innerHTML=findings.length||proposals.length?[...findings.map(f=>`<div class="labItem"><b>${esc(String(f.kind||"finding").replace(/_/g," "))}</b>${esc(f.evidence||"")}</div>`),...proposals.map(p=>`<div class="labItem proposal"><b>${esc(t("labProposal"))} · ${esc(p.type||"")}</b>${esc(p.summary||"")}</div>`)].join(""):`<div class="empty">${esc(t("labAllGood"))}</div>`;
  }
  brainCache={learning,lab,lessons:lessons.length};
}
let brainCache=null;
function renderDiagLog(){
  const host=$("diagLog");if(!host)return;const log=diagLog();
  host.textContent=log.length?log.slice().reverse().map(x=>`${new Date(x.at).toLocaleString(I18N?.locale?.()||"uk-UA")} [${x.kind}${x.count>1?` ×${x.count}`:""}] ${x.message}${x.where?` @ ${x.where}`:""}`).join("\n"):t("diagEmpty");
}
function diagReportText(){
  const lab=brainCache?.lab||{},log=diagLog();
  const parts=[`AI Bridge v${UI_VERSION} self-diagnostic report`,`UA: ${navigator.userAgent}`];
  if((lab.findings||[]).length)parts.push("Improvement Lab findings:",...lab.findings.map(f=>`- ${f.kind}: ${f.evidence}`));
  if((lab.proposals||[]).length)parts.push("Proposals:",...lab.proposals.map(p=>`- ${p.summary}`));
  if(log.length)parts.push("UI errors on this device:",...log.map(x=>`- [${x.kind}${x.count>1?` x${x.count}`:""}] ${x.message}${x.where?` @ ${x.where}`:""}`));
  return parts.join("\n");
}
function askAiToFix(){
  const report=diagReportText();
  $("teamMode").value="code";lsSet("ai_bridge_mode","code");updateModeUI();
  fillPrompt(`${t("labAskPrompt")}\n\n${report}`);
  toast(t("labAskReady"));
}
async function resetLearning(){
  if(!confirm(t("brainResetConfirm")))return;
  try{const r=await fetch("/api/learning",{method:"DELETE",cache:"no-store"});const j=await readApiJson(r);if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`)}catch(e){toast(`${t("brainResetFailed")}: ${e.message}`,"bad")}
  try{localStorage.removeItem(AGENT_LESSONS_KEY);localStorage.removeItem(FEEDBACK_STATS_KEY);localStorage.removeItem(HINT_OFF_KEY)}catch(e){}
  toast(t("brainResetDone"),"good");loadBrain();
}

function showPage(name,opts={}){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+name));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.page===name));
  // v5.11.33: клас для заборони pull-to-refresh тільки на сторінці чату.
  document.body.classList.toggle("pageChat",name==="chat");
  syncNavGroup(name);closeSheet("navDrawer");
  // v5.11.5: keepScroll — коли одразу після йде scrollToAnswer(), конкуруючий
  // плавний скрол догори залишав сторінку "десь посередині".
  if(!opts.keepScroll)window.scrollTo({top:0,behavior:"smooth"});
  if(name==="brain")loadBrain().catch(e=>recordDiag("brain",e?.message||e));
  // v5.11.14: журнал оновлень рендериться з changelog-app.json при відкритті.
  if(name==="whatsnew")renderWhatsNew().catch(e=>recordDiag("whatsnew",e?.message||e));
  // v5.11.15: лотерейний аналізатор рендериться при відкритті сторінки.
  if(name==="lotto")renderLotto().catch(e=>recordDiag("lotto",e?.message||e));
  // v5.11.58: АвтоКоди — ініціалізація табів при відкритті.
  if(name==="dtc")dtcInitTabs();
  // v5.11.40: карта приватності рендериться при відкритті сторінки.
  if(name==="datamap")renderDataMap();
  // v5.11.74: гарячі клавіші рендеряться при відкритті сторінки.
  if(name==="hotkeys")renderHotkeys();
  // v5.11.67: Центр приватності рендериться при відкритті сторінки.
  if(name==="privacy")renderPrivacy();
  // v5.11.47: нотатки й статистика рендеряться при відкритті сторінки.
  if(name==="notes")renderNotes();
  if(name==="stats")renderStats().catch(e=>recordDiag("stats",e?.message||e));
  // v5.9.16: Connections page hosts the cost dashboard + gateway settings.
  if(name==="connections"){renderCostDashboard();loadAppSettings()}
}
function quickMode(q){
  const map={auto:"auto",code:"code",review:"code",all:"askall",agent:"agent",god:"god",research:"research"};$("teamMode").value=map[q]||"auto";try{localStorage.setItem("ai_bridge_mode",$("teamMode").value)}catch(e){}updateModeUI();if(q==="agent")showPage("agent");
}

document.querySelectorAll(".tab[data-page]").forEach(t=>t.onclick=()=>showPage(t.dataset.page));
$("moreTab")?.addEventListener("click",()=>openSheet("navDrawer"));
$("navDrawerBtn")?.addEventListener("click",()=>openSheet("navDrawer"));
/* «Тиша»: колонку-меню відкриває вкладка «Більше» (moreTab) знизу; верхньої кнопки «···» більше немає */
// D4: свайп вправо по колонці-меню закриває її
(()=>{const p=document.querySelector("#navDrawer .sheetPanel");if(!p)return;let x0=null;
p.addEventListener("touchstart",e=>{x0=e.touches[0].clientX},{passive:true});
p.addEventListener("touchend",e=>{if(x0===null)return;const dx=e.changedTouches[0].clientX-x0;x0=null;if(dx>60)closeSheet("navDrawer")},{passive:true});})();
document.querySelectorAll("[data-more-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.morePage)));
// v5.11.14: перемикач змісту діалогу агента
$("tocToggle")?.addEventListener("click",()=>{const c=$("tocChips");if(!c)return;const open=c.classList.toggle("hidden");$("tocToggle")?.setAttribute("aria-expanded",String(!open))});
document.querySelectorAll("[data-switch]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.switch)));
document.querySelectorAll("[data-sheet-close]").forEach(b=>b.addEventListener("click",()=>closeSheet(b.closest(".sheet")?.id)));
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".sheet:not(.hidden)").forEach(x=>closeSheet(x.id))});
document.querySelectorAll("[data-role-open]").forEach(b=>b.addEventListener("click",()=>openSheet("roleSheet")));
$("roleAddBtn")?.addEventListener("click",addCustomRole);
$("editPromptBtn")?.addEventListener("click",editLastPrompt);
$("editPromptSaveBtn")?.addEventListener("click",saveEditedPrompt);
$("editPromptCancelBtn")?.addEventListener("click",()=>closeSheet("editPromptSheet"));
$("otherModelBtn")?.addEventListener("click",openOtherModel);
renderRoleChips();syncNavGroup("chat");
document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>quickMode(c.dataset.quick));
document.querySelectorAll("[data-studio-mode]").forEach(b=>b.onclick=()=>setStudioMode(b.dataset.studioMode));
$("studioPickBtn")?.addEventListener("click",()=>$("studioFileInput")?.click());
$("studioFileInput")?.addEventListener("change",e=>{const f=e.target.files?.[0]||null;if(f&&!studioMimeOk(f)){studioSetStatus(studioModeNeedsVideo()?t("studioNeedVideo"):t("studioNeedPhoto"),"bad");e.target.value="";return}studioFile=f;renderStudioPreview()});
$("studioRunBtn")?.addEventListener("click",runStudio);
$("studioVoiceBtn")?.addEventListener("click",()=>startStudioVoiceInput());
$("agentStartBtn")?.addEventListener("click",runAgentPage);
$("agentPhotoBtn")?.addEventListener("click",()=>{flashComposerTool($("agentPhotoBtn"));$("photoInput")?.click()});
$("agentVoiceBtn")?.addEventListener("click",()=>startAgentVoiceInput());
$("agentFilesBtn")?.addEventListener("click",()=>{agentFilePickPending=true;openNativeFilePicker($("agentFilesBtn"))});
$("agentUseFiles")?.addEventListener("change",e=>{if(e.target.checked&&!attachments.length){e.target.checked=false;agentFilePickPending=true;openNativeFilePicker($("agentFilesBtn"))}});
$("agentClearBtn")?.addEventListener("click",()=>{if(!agentMessages.length||confirm(t("confirmClearHistory")))clearAgentThread()});
  // v5.11.36: ручне стиснення контексту діалогу агента (ідея scout).
  $("ctxCompactBtn")?.addEventListener("click",compactAgentContext);
  // v5.11.60: інструкції для діалогу.
  $("dlgInstrBtn")?.addEventListener("click",openDlgInstrSheet);
  $("dlgInstrSaveBtn")?.addEventListener("click",saveDlgInstrFromSheet);
  $("dlgInstrCancelBtn")?.addEventListener("click",()=>closeSheet("dlgInstrSheet"));
  $("dlgInstrClearBtn")?.addEventListener("click",clearDlgInstrFromSheet);
  updateDlgInstrBtn();
$("agentProvider")?.addEventListener("change",e=>localStorage.setItem("ai_bridge_agent_helper_v522",e.target.value));
const studioPaidFallback=$("studioPaidFallback");if(studioPaidFallback){studioPaidFallback.checked=localStorage.getItem("ai_bridge_allow_paid_media")==="1";studioPaidFallback.addEventListener("change",()=>{localStorage.setItem("ai_bridge_allow_paid_media",studioPaidFallback.checked?"1":"0");updateStudioEngineInfo()})}
$("teamMode").onchange=()=>{localStorage.setItem("ai_bridge_mode",$("teamMode").value);updateModeUI()};
$("synthesize").onchange=()=>{localStorage.setItem("ai_bridge_synth",$("synthesize").checked?"1":"0");updateCallEstimate()};
$("judgeProvider").onchange=()=>localStorage.setItem("ai_bridge_judge",$("judgeProvider").value);
$("searchFirst")?.addEventListener("change",e=>{localStorage.setItem("ai_bridge_search_first",e.target.checked?"1":"0");updateCallEstimate()});
/* v5.11.44: історія відправлених промптів — ↑/↓ у порожньому полі вводу.
   Останні 30 запитів у localStorage (лише текст, без вкладень і відповідей);
   гортання лише коли поле порожнє, щоб не конфліктувати з курсором. */
const PROMPT_HIST_KEY="ai_bridge_prompt_history_v1",PROMPT_HIST_MAX=30;
let promptHistIdx=-1;
function promptHistory(){try{const v=JSON.parse(localStorage.getItem(PROMPT_HIST_KEY)||"[]");return Array.isArray(v)?v.filter(x=>typeof x==="string").slice(-PROMPT_HIST_MAX):[]}catch(e){return[]}}
function pushPromptHistory(text){
  const s=String(text||"").trim();
  if(!s)return;
  const h=promptHistory();
  if(h[h.length-1]===s)return;
  h.push(s);
  try{localStorage.setItem(PROMPT_HIST_KEY,JSON.stringify(h.slice(-PROMPT_HIST_MAX)))}catch(e){}
  promptHistIdx=-1;
}
/* dir: -1 = ↑ (старіші), +1 = ↓ (новіші); вихід за кінець повертає порожнє поле. */
function stepPromptHistory(dir){
  const h=promptHistory(),el=$("prompt");
  if(!h.length||!el)return;
  if(promptHistIdx<0)promptHistIdx=h.length;
  promptHistIdx+=dir;
  if(promptHistIdx>=h.length){promptHistIdx=-1;el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));return}
  if(promptHistIdx<0)promptHistIdx=0;
  el.value=h[promptHistIdx];
  el.dispatchEvent(new Event("input",{bubbles:true}));
  try{el.setSelectionRange(el.value.length,el.value.length)}catch(e){}
}
function clearPromptHistory(){try{localStorage.removeItem(PROMPT_HIST_KEY)}catch(e){}promptHistIdx=-1;toast(t("promptHistCleared"),"ok")}
$("sendBtn").onclick=()=>sendTask({source:"chat"});
$("prompt").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$("sendBtn").disabled)sendTask({source:"chat"});return}
  // v5.11.44: ↑/↓ у порожньому полі — гортання історії запитів.
  if((e.key==="ArrowUp"||e.key==="ArrowDown")&&!e.isComposing&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&$("prompt").value===""){e.preventDefault();stepPromptHistory(e.key==="ArrowUp"?-1:1)}
});
$("prompt").addEventListener("input",updateCallEstimate);
// v5.11.44: ручний ввід скидає позицію гортання історії запитів
// (програмні події stepPromptHistory — недовірені, позицію не чіпають).
$("prompt").addEventListener("input",e=>{if(e.isTrusted)promptHistIdx=-1});
$("clearPromptBtn").onclick=()=>{$("prompt").value="";saveComposerDrafts();$("prompt").focus();resetConvId()};
const cameraInput=$("cameraInput"),photoInput=$("photoInput");
$("cameraBtn").onclick=()=>{flashComposerTool($("cameraBtn"));cameraInput?.click()};
$("photoBtn").onclick=()=>{flashComposerTool($("photoBtn"));photoInput?.click()};
$("voiceBtn").onclick=()=>{flashComposerTool($("voiceBtn"));startVoiceInput()};
// v5.11.69: «Покращити запит» у композері.
$("improveBtn")?.addEventListener("click",()=>{flashComposerTool($("improveBtn"));improvePrompt()});
$("fileVoiceBtn").onclick=()=>{flashComposerTool($("fileVoiceBtn"));startFileVoiceInput()};
$("fileVoiceLangBtn").onclick=()=>{cycleFileVoiceLang()};
updateFileVoiceLangBtn();
if(cameraInput)cameraInput.onchange=async e=>{await acceptImageFiles(e.target.files);cameraInput.value=""};
if(photoInput)photoInput.onchange=async e=>{await acceptImageFiles(e.target.files);photoInput.value=""};
const fileInput=$("fileInput"),fileDropZone=$("fileDropZone");
async function acceptPickedFiles(fileList){
  const fromAgent=agentFilePickPending;
  agentFilePickPending=false;
  if(!fileList||!fileList.length)return;
  await handleFiles(fileList);
  if(fileInput)fileInput.value="";
  if(fromAgent&&attachments.length){
    const useFiles=$("agentUseFiles");if(useFiles)useFiles.checked=true;
    updateAgentAttachmentSummary();
    $("agentPrompt")?.focus();
  }else if(attachments.length)$("filePrompt")?.focus();
}
function flashFilePickerControl(btn){
  if(!btn)return;
  btn.classList.remove("pickerPressed");
  // Force the pressed state to restart even on repeated quick taps.
  void btn.offsetWidth;
  btn.classList.add("pickerPressed");
  setTimeout(()=>btn.classList.remove("pickerPressed"),520);
}
function openNativeFilePicker(trigger){
  flashFilePickerControl(trigger);
  // Keep fileInput.click() synchronous inside the user gesture path.
  // iOS Safari/PWA can block the native Files picker otherwise.
  // The input intentionally has no restrictive accept= filter: iOS can mark
  // valid .zip archives inactive when their provider reports a different MIME
  // type (for example application/x-zip-compressed or octet-stream). We do
  // strict extension/type validation after the user chooses the file instead.
  fileInput.click();
}
fileInput.onchange=e=>acceptPickedFiles(e.target.files);
$("chooseFilesBtn").onclick=()=>openNativeFilePicker($("chooseFilesBtn"));
$("addFilesPlusBtn").onclick=()=>openNativeFilePicker($("addFilesPlusBtn"));
fileDropZone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fileInput.click()}});
for(const ev of ["dragenter","dragover"]){fileDropZone.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();fileDropZone.classList.add("dragActive")})}
for(const ev of ["dragleave","drop"]){fileDropZone.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();fileDropZone.classList.remove("dragActive")})}
fileDropZone.addEventListener("drop",e=>acceptPickedFiles(e.dataTransfer?.files));
document.addEventListener("paste",e=>{
  if(!$("page-files").classList.contains("active"))return;
  const files=e.clipboardData?.files;
  if(files?.length){e.preventDefault();acceptPickedFiles(files)}
});
/* v5.11.60: вставка скріншота з буфера обміну в композер чату — зображення
   одразу падає у вкладення (acceptImageFiles). Не чіпає сторінку файлів
   (там свій обробник вище) і секрет-гард (той читає лише текст). */
document.addEventListener("paste",e=>{
  const el=e.target;
  if(!(el instanceof HTMLTextAreaElement))return;
  if(el.id!=="prompt"&&el.id!=="agentPrompt")return;
  const items=[...(e.clipboardData?.items||[])].filter(it=>it&&it.kind==="file"&&String(it.type||"").startsWith("image/"));
  if(!items.length)return;
  const files=items.map(it=>{try{return it.getAsFile()}catch(_){return null}}).filter(f=>f&&f.size>0);
  if(!files.length)return;
  // Текст (якщо є разом із картинкою) не блокуємо — вставиться звичайно.
  if(!(e.clipboardData?.getData("text")||""))e.preventDefault();
  const before=imageAttachments.length;
  Promise.resolve(acceptImageFiles(files)).then(()=>{if(imageAttachments.length>before)toast(t("pasteImageAdded"),"ok")}).catch(()=>{});
});
/* v5.11.20: warn early when pasted text looks like a secret — the send-time
   guard still makes the final call. */
document.addEventListener("paste",e=>{
  const el=e.target;
  if(!(el instanceof HTMLTextAreaElement))return;
  if(!["prompt","agentPrompt","filePrompt"].includes(el.id))return;
  const pasted=e.clipboardData?.getData("text")||"";
  if(!pasted||!findSecretLike(pasted))return;
  setTimeout(()=>{
    const raw=String(el.value||"");
    if(findSecretLike(raw)&&secretGuardConfirmed!==raw)showSecretGuard(el,{source:el.id==="filePrompt"?"files":el.id==="agentPrompt"?"agent":"chat"});
  },60);
});
/* v5.11.28: довга вставка → вкладення (ідея scout). Вставка понад
   PASTE_ATTACH_CHARS символів не засмічує поле стіною тексту: повний текст
   лежить у сховищі вставок (sessionStorage — переживає перезавантаження
   вкладки, але не лишає слідів у localStorage), а в поле падає однорядковий
   маркер-чип. При відправці маркери розгортаються в повний текст ТІЛЬКИ для
   мережевого запиту; в історію йде короткий маркер. */
const PASTE_ATTACH_CHARS=5000;
const PASTE_MARK_RE=/paste:([0-9a-f]{8})/g;
const PASTE_STORE_KEY="ai_bridge_paste_store_v1";
let pasteStore=null;
function pasteStoreLoad(){
  if(pasteStore)return pasteStore;
  pasteStore=new Map();
  try{
    const raw=sessionStorage.getItem(PASTE_STORE_KEY);
    if(raw){const arr=JSON.parse(raw);
      if(Array.isArray(arr))for(const [id,en]of arr)
        if(typeof id==="string"&&en&&typeof en.text==="string")
          pasteStore.set(id,{name:String(en.name||t("pasteNameFallback")),chars:en.text.length,text:en.text});
    }
  }catch(e){}
  return pasteStore;
}
function pasteStoreSave(){
  try{sessionStorage.setItem(PASTE_STORE_KEY,JSON.stringify([...pasteStoreLoad()].map(([id,en])=>[id,{name:en.name,text:en.text}])))}catch(e){}
}
function pasteStoreAdd(text){
  let id="";
  try{id=(crypto.randomUUID().replace(/-/g,"")||"").slice(0,8)}catch(e){}
  if(!/^[0-9a-f]{8}$/.test(id)){id=Math.random().toString(16).slice(2,10).padEnd(8,"0").slice(0,8)}
  const st=pasteStoreLoad();
  const en={name:t("pasteFileName",{time:new Date().toTimeString().slice(0,8).replace(/:/g,"")}),chars:text.length,text:String(text)};
  st.set(id,en);pasteStoreSave();
  return {id,...en};
}
/* Чиста (store — параметр для тестів): розгортає маркери в повний текст.
   Невідомі id лишаються як є — маркер все одно читабельний для людини. */
function expandPasteMarkers(text,store){
  const st=store||pasteStoreLoad();
  return String(text||"").replace(PASTE_MARK_RE,(m,id)=>{
    const p=st.get(id);
    return p?`\n\n[${t("pasteBlockHead",{name:p.name})}]\n${p.text}\n`:"[paste:"+id+"]";
  });
}
/* Прибирає записи, на які не посилається жодне поле вводу. */
function sweepPasteStore(){
  const st=pasteStoreLoad();
  const fields=["prompt","agentPrompt","filePrompt"].map(i=>{try{return document.getElementById(i)?.value||""}catch(e){return""}}).join("\n");
  let changed=false;
  for(const id of [...st.keys()])if(!fields.includes(id)){st.delete(id);changed=true}
  if(changed)pasteStoreSave();
}
/* Одиниця «знак/знаки/знаків» з правильним відмінюванням (uk/ru/en). */
function pasteCharsUnit(n){
  n=Math.abs(Math.round(Number(n)||0))%100;const d=n%10;
  if(d===1&&n!==11)return t("pasteUnitOne");
  if(d>=2&&d<=4&&(n<12||n>14))return t("pasteUnitFew");
  return t("pasteUnitMany");
}
function pasteMarkerLine(en){
  return `[📎 ${en.name} · ${groupNum(en.chars)} ${pasteCharsUnit(en.chars)} · paste:${en.id}]`;
}
document.addEventListener("paste",e=>{
  const el=e.target;
  if(!(el instanceof HTMLTextAreaElement))return;
  if(!["prompt","agentPrompt","filePrompt"].includes(el.id))return;
  if(e.clipboardData?.files?.length)return; // файли йдуть існуючим пайплайном
  const pasted=e.clipboardData?.getData("text")||"";
  if(pasted.length<=PASTE_ATTACH_CHARS)return;
  if(!navigator.onLine)return; // офлайн: черга не переживе сховище — лишаємо сирий текст
  e.preventDefault();
  const en=pasteStoreAdd(pasted);
  sweepPasteStore();
  const line=pasteMarkerLine(en)+"\n";
  try{
    const s=el.selectionStart??el.value.length,e2=el.selectionEnd??el.value.length;
    el.value=el.value.slice(0,s)+line+el.value.slice(e2);
    el.selectionStart=el.selectionEnd=s+line.length;
  }catch(err){el.value=(el.value?el.value+"\n":"")+line}
  el.dispatchEvent(new Event("input",{bubbles:true}));
  toast(t("pasteAsAttachment",{name:en.name,chars:groupNum(en.chars)}),"good");
});
$("pasteFilesBtn").onclick=async()=>{
  try{
    if(!navigator.clipboard?.read)throw new Error("Clipboard file access is not supported by this browser.");
    const items=await navigator.clipboard.read(),files=[];
    for(const item of items){
      for(const type of item.types||[]){
        if(type.startsWith("text/")||type==="application/json"||type==="application/zip"||type==="application/xml"){
          const blob=await item.getType(type);
          const ext=type==="application/zip"?"zip":type==="application/json"?"json":type==="application/xml"?"xml":"txt";
          files.push(new File([blob],`clipboard-${Date.now()}.${ext}`,{type}));
          break;
        }
      }
    }
    if(!files.length)throw new Error(t("errClipboardNoFile"));
    await acceptPickedFiles(files);
  }catch(e){setFileProcessingStatus("bad",`${t("pasteFileFailed")}: ${e.message}. ${t("pasteNameFallback")}`)}
};
$("clearFilesBtn").onclick=()=>{attachments=[];renderFiles();setFileProcessingStatus()};
$("filePrompt").addEventListener("input",updateFileSendState);
$("clearFilePromptBtn").onclick=()=>{$("filePrompt").value="";updateFileSendState();$("filePrompt").focus()};
$("fileSendBtn").onclick=()=>sendTask({source:"files"});
const deepScanBox=$("deepScan");if(deepScanBox){deepScanBox.checked=lsGet("ai_bridge_deep_scan","0")==="1";deepScanBox.addEventListener("change",()=>{lsSet("ai_bridge_deep_scan",deepScanBox.checked?"1":"0");renderFiles()})}
/* v5.11.19: стан авторизації видно одразу і назавжди.
   v5.11.22: зелене «Авторизовано» — ТІЛЬКИ після підтвердженого сервером входу
   за токеном. Без входу — нейтральна кнопка «Підключити», жодних галочок. */
/* v5.11.44: селектор мови на екрані входу — дзеркало глобального вибору.
   Працює до авторизації: вибір зберігається в localStorage, як і верхній глобус. */
function syncAuthLangSelect(){
  const sel=$("authLangSelect");if(!sel||!I18N||!I18N.LANGUAGES)return;
  sel.innerHTML=Object.entries(I18N.LANGUAGES).map(([id,x])=>`<option value="${esc(id)}">${esc(x.name)}</option>`).join("");
  sel.value=I18N.getLanguage();
  sel.onchange=()=>I18N.setLanguage(sel.value);
}
syncAuthLangSelect();
window.addEventListener("aibridge:languagechange",e=>{const s=$("authLangSelect");if(s&&I18N)s.value=(e&&e.detail&&e.detail.language)||I18N.getLanguage()});
function renderAuthState(ok){
  const btn=$("saveTokenBtn"),inp=$("accessToken"),forget=$("forgetTokenBtn");
  if(btn){btn.disabled=!!ok;btn.classList.toggle("authorized",!!ok);
    btn.textContent=ok?t("deviceAuthorized"):t("authorizeDevice");}
  if(inp){inp.classList.toggle("hidden",!!ok);if(ok)inp.value="";}
  if(forget)forget.classList.toggle("hidden",!ok);
}
function authFriendlyError(e){
  const msg=String(e&&e.message||e||"");
  if(/not configured/i.test(msg))return t("authNoServerToken");
  if(/too many|429/i.test(msg))return t("authTooMany");
  if(/invalid|401/i.test(msg))return t("authBadToken");
  return msg||t("authBadToken");
}
$("saveTokenBtn").onclick=async()=>{
  const token=$("accessToken").value.trim();
  if(!token){toast(t("enterAccessToken"),"bad");return}
  $("saveTokenBtn").disabled=true;
  try{
    await loginBridgeSession(token);
    renderAuthState(true);
    toast(t("deviceAuthorized"),"ok");
    await refreshStatus();
  }catch(e){
    renderAuthState(false);
    toast(authFriendlyError(e),"bad");
    $("topStatus").textContent=authFriendlyError(e);
  }finally{
    if(!$("saveTokenBtn").classList.contains("authorized"))$("saveTokenBtn").disabled=false;
  }
};
$("forgetTokenBtn").onclick=async()=>{await logoutBridgeSession();$("accessToken").value="";renderAuthState(false);$("topStatus").textContent=t("sessionEnded");refreshStatus()};
/* v5.9.5 Site self-check: runs every production smoke check from the
   user's own browser, using the existing HttpOnly session. The page never
   sees BRIDGE_ACCESS_TOKEN or provider keys, and the report contains only
   check names, HTTP statuses, versions and timings — safe to copy and share. */
let selfCheckReport="";
/* v5.9.7: the "how to fix" hint follows the real error type, instead of
   always talking about quota. */
function providerFixHint(x={}){
  const st=Number(x.status)||0,kind=String(x.errorKind||"");
  if(st===401||kind==="invalid_api_key")return t("scFixKey");
  if(st===403||kind==="permission_denied")return t("scFixPermission");
  if(st===429||kind==="rate_limited"||kind==="billing_or_quota")return x.provider==="gemini"?t("scFixGeminiQuota"):t("scFixQuota");
  if(kind==="timeout"||st===504||st===408)return t("scFixTimeout");
  if(kind==="model_unavailable")return t("scFixModel");
  if(st>=500||kind==="provider_unavailable")return x.provider==="gemini"?t("scFixGeminiOverload"):t("scFixOverload");
  return t("scFixQuota");
}
async function runSiteSelfCheck(){
  const btn=$("selfCheckBtn"),host=$("selfCheckResults"),pill=$("selfCheckPill"),copy=$("selfCheckCopyBtn"),withAi=!!$("selfCheckAi")?.checked;
  if(!host)return;btn.disabled=true;copy?.classList.add("hidden");host.innerHTML="";pill.className="statusPill";pill.textContent="…";
  const rows=[],started=Date.now();
  // v5.9.6: every warning/failure can carry a plain "how to fix" hint.
  const add=(name,ok,detail="",warn=false,fix="")=>{const hint=(!ok||warn)&&fix?String(fix):"";rows.push({name,ok,warn,detail:String(detail||"").slice(0,200),fix:hint});host.insertAdjacentHTML("beforeend",`<div class="selfCheckRow ${ok?(warn?"warn":"ok"):"bad"}"><i>${ok?(warn?"!":"✓"):"✗"}</i><b>${esc(name)}</b><small>${esc(detail)}</small>${hint?`<em class="selfCheckFix">${esc(t("scHowToFix"))}: ${esc(hint)}</em>`:""}</div>`)};
  const get=async(path,init={})=>{const t0=Date.now();const r=await fetch(path,{cache:"no-store",credentials:"same-origin",...init});r.ms=Date.now()-t0;return r};
  const json=async r=>{try{return await r.clone().json()}catch(e){return {}}};
  try{
    const home=await get("/");const csp=home.headers.get("content-security-policy")||"";
    add(t("scHome"),home.ok,`HTTP ${home.status} · ${home.ms}ms`);
    add(t("scHeaders"),/frame-ancestors 'none'/.test(csp)&&home.headers.get("x-frame-options")==="DENY"&&home.headers.get("x-content-type-options")==="nosniff","CSP · X-Frame-Options · nosniff");
    const deployed=home.headers.get("x-ai-bridge-version")||"";
    add(t("scVersion"),deployed===UI_VERSION,`server ${deployed||"?"} · page ${UI_VERSION}`);
    const bv=await json(await get("/bridge-version.json"));add(t("scBuild"),bv.version===UI_VERSION,`bridge-version ${bv.version||"?"} · build ${String(bv.buildSha256||"").slice(0,12)}`);
    const assets=["app.js","styles.css","i18n.js","markdown.js","theme-boot.js","zip-safety-core.js","zip-worker.js","manifest.webmanifest","sw.js"];
    const assetRes=await Promise.all(assets.map(a=>get("/"+a).then(r=>[a,r.status])));const badAssets=assetRes.filter(([,st])=>st!==200);
    add(t("scAssets"),!badAssets.length,badAssets.length?badAssets.map(([a,st])=>`${a}=${st}`).join(", "):`${assets.length}/${assets.length} HTTP 200`);
    const internal=["/tests/worker-v38-under-test.mjs","/tools/smoke-test.mjs","/MANIFEST.sha256.json","/README.txt"];
    const intRes=await Promise.all(internal.map(a=>get(a).then(r=>[a,r.status])));const open=intRes.filter(([,st])=>st!==404);
    add(t("scInternal"),!open.length,open.length?open.map(([a,st])=>`${a}=${st}`).join(", "):`${internal.length}/${internal.length} → 404`);
    const sw=await get("/sw.js"),swText=await sw.text();
    add(t("scSw"),/no-store/.test(sw.headers.get("cache-control")||"")&&swText.includes(`ai-bridge-v${UI_VERSION.replaceAll(".","-")}`),`cache ai-bridge-v${UI_VERSION.replaceAll(".","-")}`);
    const reg=("serviceWorker" in navigator)?await navigator.serviceWorker.getRegistration().catch(()=>null):null;
    add(t("scSwActive"),!!reg?.active,reg?.active?"active":"not registered in this browser",!reg?.active);
    const as=await json(await get("/.well-known/oauth-authorization-server"));
    add(t("scOauth"),!!as.authorization_endpoint&&(as.scopes_supported||[]).includes("offline_access")&&(as.code_challenge_methods_supported||[]).includes("S256"),"authorization_code · PKCE S256 · offline_access");
    const mcp=await get("/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:"selfcheck",method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"self-check",version:UI_VERSION}}})});
    add(t("scMcp"),mcp.status===401&&/^Bearer/i.test(mcp.headers.get("www-authenticate")||""),`HTTP ${mcp.status}`);
    const pc=await json(await get("/public-check"));add(t("scReplay"),!!pc.oauthReplayProtection,pc.oauthReplayProtection||"?",pc.oauthReplayProtection==="private-isolate-best-effort",t("scFixKv"));
    const st=await get("/api/status"),sj=await json(st);
    if(st.status===401){add(t("scSession"),false,t("scNeedLogin"))}
    else{
      const n=Object.values(sj.providers||{}).filter(Boolean).length;
      add(t("scSession"),st.ok,`HTTP ${st.status}`);
      add(t("scProviders"),n>0,`${n}: ${Object.entries(sj.providers||{}).filter(([,v])=>v).map(([k])=>PROVIDERS[k]?.name||k).join(", ")||"—"}`);
      add(t("scJobs"),true,`${sj.jobRecoveryLabel||sj.jobRecovery||"?"}`,!sj.jobsPersistent,t("scFixKv"));
      add(t("scImage"),true,sj.media?.imageEngine?.label||"?",sj.media?.imageEngine?.state!=="ready",t("scFixWorkersAi"));
      {const g=sj.aiGateway||{};add(t("scGateway"),true,g.enabled?`${g.id} · routed ${g.routed||0} · direct ${g.directFallbacks||0}${g.lastError?` · ${g.lastError}`:""}`:t("scGatewayOff"),!!(g.enabled&&g.directFallbacks&&!g.lastOkAt),t("scFixGateway"))}
      // v5.9.16: cost dashboard endpoint.
      try{const ur=await get("/api/usage"),uj=await json(ur);add(t("scUsage"),ur.ok&&uj&&uj.ok!==false,`HTTP ${ur.status}${uj&&uj.totals?` · $${fmtMoney(uj.totals.cost)}`:""}`)}catch(e){add(t("scUsage"),false,String(e?.message||e).slice(0,80))}
      const [lr,ir,fr]=await Promise.all([get("/api/learning"),get("/api/improvement-lab"),get("/api/provider-tokens")]);
      add(t("scLearning"),lr.ok,lr.ok?(sj.jobsPersistent?"KV persistent":"isolate memory — resets after Worker restart"):`HTTP ${lr.status}`,lr.ok&&!sj.jobsPersistent,t("scFixKv"));add(t("scLab"),ir.ok,`HTTP ${ir.status}`);
      const ft=await fr.text();add(t("scVault"),fr.ok&&!/sk-|AIza|gsk_|xai-/i.test(ft),fr.ok?"no secret values in response":`HTTP ${fr.status}`);
      const cf=await json(await get("/api/diagnostics/media",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({engine:"cloudflare"})}));
      add(t("scCloudflare"),true,cf.state==="missing"&&!cf.ok?t("scCloudflareOptional"):(cf.message||cf.state||"?"),!cf.ok&&cf.state!=="missing"&&sj.media?.imageEngine?.state!=="ready",t("scFixWorkersAi"));
      if(withAi){
        const d=await json(await get("/api/diagnostics/providers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providers:["groqfree","openrouter","gemini"]})}));
        // A single exhausted/slow free provider is a warning, not a failure,
        // when at least one other provider works — Auto falls back to it.
        const anyOk=(d.tested||[]).some(x=>x.ok),transient=x=>["rate_limited","billing_or_quota","timeout","provider_unavailable"].includes(x.errorKind)||[429,503,504].includes(Number(x.status));
        for(const x of d.tested||[]){const soft=!x.ok&&anyOk&&transient(x);add(`${t("scProvider")} ${PROVIDERS[x.provider]?.name||x.provider}`,x.ok||soft,x.ok?`${x.model||""} · ${x.ms||0}ms${x.modelFallbacks?.length?` · ${t("scFallbackModel")}`:""}`:`${providerDiagnosticError(x)}${soft?` · ${t("scOthersWork")}`:""}`,soft,providerFixHint(x))}
        const t0=Date.now();
        const run=await streamingRunRequest({prompt:"Reply with exactly one word: pong",displayPrompt:"Reply with exactly one word: pong",fileContext:"",images:[],mode:"auto",providers:[],synthesize:false,judge:"auto",searchFirst:false,clientRequestId:newRequestId()});
        const txt=String(run.j?.final||run.j?.results?.find(r=>r.ok)?.text||"");
        add(t("scChat"),run.ok&&!!txt.trim(),run.ok?`${Math.round((Date.now()-t0)/100)/10}s · ${(run.j?.selectedProviders||[]).join(", ")} · "${txt.trim().slice(0,30)}"`:friendlyRunError(run.j,run.status));
      }
    }
  }catch(e){add(t("scNetwork"),false,String(e?.message||e))}
  const failed=rows.filter(r=>!r.ok).length,warned=rows.filter(r=>r.ok&&r.warn).length;
  pill.className=`statusPill ${failed?"err":"on"}`;pill.textContent=failed?`${failed} ${t("failWord")}`:warned?`OK · ${warned}!`:t("allOk");
  selfCheckReport=[`AI Bridge self-check — ${location.host} — v${UI_VERSION} — ${new Date().toISOString()} — ${Math.round((Date.now()-started)/1000)}s`,`Result: ${rows.length-failed}/${rows.length} passed, ${failed} failed, ${warned} warnings${withAi?" (with live AI test)":""}`,...rows.map(r=>`${r.ok?(r.warn?"WARN":"PASS"):"FAIL"}  ${r.name} — ${r.detail}${r.fix?`\n      → ${r.fix}`:""}`),`UA: ${navigator.userAgent}`].join("\n");
  copy?.classList.remove("hidden");btn.disabled=false;
}
async function refreshSite(){
  const btn=$("statusRefreshBtn");
  if(btn?.classList.contains("refreshing"))return;
  btn?.classList.add("refreshing");
  btn?.setAttribute("aria-busy","true");
  if(btn)btn.disabled=true;
  $("topStatus").textContent=t("statusRefreshing");
  try{
    // Ask the browser for the newest service worker before reloading. This
    // makes the visible refresh control useful after a fresh Cloudflare deploy.
    if("serviceWorker" in navigator){
      const reg=await navigator.serviceWorker.getRegistration();
      if(reg)await reg.update();
    }
  }catch(e){}
  // Keep the spinner visible long enough for the tap to have clear feedback.
  setTimeout(()=>location.reload(),650);
}
$("statusRefreshBtn").onclick=refreshSite;
$("testMcpBtn").onclick=testMcp;
$("testProvidersBtn").onclick=testProviders;
$("selfCheckBtn")?.addEventListener("click",()=>runSiteSelfCheck().catch(e=>recordDiag("selfcheck",e?.message||e)));
$("selfCheckCopyBtn")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(selfCheckReport);toast(t("copied"),"good")}catch(e){toast(t("copyFailed"),"bad")}});
$("copyMcpBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("mcpUrl").value);$("copyMcpBtn").textContent="Copied ✓";setTimeout(()=>$("copyMcpBtn").textContent="Copy",900)}catch(e){}};
$("refreshHistoryBtn").onclick=renderHistory;
$("bookmarksFilterBtn")?.addEventListener("click",()=>{bookmarksOnly=!bookmarksOnly;if(bookmarksOnly){archiveOnly=false;$("archiveFilterBtn")?.classList.remove("active")}$("bookmarksFilterBtn")?.classList.toggle("active",bookmarksOnly);renderHistory()}); // v5.11.30: тільки закладки
$("archiveFilterBtn")?.addEventListener("click",()=>{archiveOnly=!archiveOnly;if(archiveOnly){bookmarksOnly=false;$("bookmarksFilterBtn")?.classList.remove("active")}$("archiveFilterBtn")?.classList.toggle("active",archiveOnly);renderHistory()}); // v5.11.37: фільтр «Архів»
$("spendCapSave")?.addEventListener("click",()=>{const v=parseFloat(String($("spendCapInput")?.value||"").replace(",","."));setSpendCap(v>0?v:null);toast(t("spendCapSaved"),"good");renderSpendCap()}); // v5.11.30: бюджет
$("clearHistoryBtn").onclick=async()=>{if(confirm(t("confirmClearHistory"))){await clearRuns();if(historySyncOn())try{await historyApi("DELETE")}catch(e){}renderHistory()}};
$("historySyncToggle")?.addEventListener("change",async e=>{localStorage.setItem(SYNC_KEY,e.target.checked?"1":"0");setSyncStatus(e.target.checked?"historySyncWorking":"");if(e.target.checked){const n=await pullCloudHistory();if(n)renderHistory()}});
document.querySelectorAll("[data-usage-range]").forEach(b=>b.addEventListener("click",()=>{usageRange=Number(b.dataset.usageRange)||1;renderUsage()}));
// Copy the original Markdown source (not the rendered text) so pasting into
// another AI or editor keeps lists, code fences and links intact.
/* v5.11.35: копіювання відповіді як форматованого тексту (rich-text copy).
   Бере вже санітизований HTML з рендера markdown.js (тільки DOM-вузли,
   посилання https), пише в буфер text/html + text/plain через ClipboardItem;
   без ClipboardItem — звичайний writeText. */
async function copyRichFrom(host,labelEl){
  const html=host?.innerHTML||"",text=(host?.textContent||"").trim();
  if(!text){toast(t("copyFailed"),"bad");return}
  try{
    if(typeof ClipboardItem!=="undefined"&&navigator.clipboard?.write){
      await navigator.clipboard.write([new ClipboardItem({
        "text/html":new Blob([html],{type:"text/html"}),
        "text/plain":new Blob([text],{type:"text/plain"})
      })]);
    }else await navigator.clipboard.writeText(text);
    if(labelEl){const btn=labelEl.closest("button");labelEl.textContent=t("copied");btn?.classList.add("done");setTimeout(()=>{labelEl.textContent=t("copyRich");btn?.classList.remove("done")},1200)}
    else toast(t("copied"),"good");
  }catch(e){toast(t("copyFailed"),"bad")}
}
$("copyFinalBtn").onclick=async()=>{const btn=$("copyFinalBtn"),label=btn.querySelector("span")||btn,txt=currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||$("finalAnswer").textContent||"";try{await navigator.clipboard.writeText(txt);label.textContent=t("copied");btn.classList.add("done");setTimeout(()=>{label.textContent=t("copy");btn.classList.remove("done")},1100)}catch(e){toast(t("copyFailed"),"bad")}};
// v5.11.69: «Перекласти» відповідь одним тапом.
$("translateBtn")?.addEventListener("click",translateAnswer);
$("copyRichBtn").onclick=()=>copyRichFrom($("finalAnswer"),$("copyRichBtn")?.querySelector("span")||$("copyRichBtn"));
// v5.11.19: цитата-відповідь на фінальну відповідь — вставляє цитату в поле вводу.
/* v5.11.43: спільна логіка цитування фінальної відповіді — кнопка «Цитувати» і свайп вліво. */
function quoteFinalAnswer(){const txt=currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||$("finalAnswer").textContent||"",q=buildQuoteBlock(txt),p=$("prompt");if(!q||!p)return;p.value=q+(p.value||"");p.dispatchEvent(new Event("input",{bubbles:true}));showPage("chat");try{p.focus({preventScroll:true})}catch(e){try{p.focus()}catch(_){}}try{p.setSelectionRange(p.value.length,p.value.length)}catch(e){}setTimeout(()=>{try{p.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}},60)}
$("quoteFinalBtn").onclick=()=>quoteFinalAnswer();
/* v5.11.43: свайп вліво по фінальній відповіді → цитата (Telegram-патерн).
   Тільки горизонталь: touch-action: pan-y лишає вертикальний скрол браузеру;
   код-блоки, кнопки й посилання жест не чіпає. На порозі — один тактильний
   відгук, повернення — гумове; повага до prefers-reduced-motion. */
function initSwipeReply(){
  const card=document.getElementById("finalAnswer");if(!card||card.dataset.swipeInit)return;
  card.dataset.swipeInit="1";
  let sx=0,sy=0,active=false,passed=false;
  const THRESH=()=>Math.min(90,Math.max(56,(window.innerWidth||390)*0.18));
  card.addEventListener("touchstart",e=>{
    if(e.touches.length!==1)return;
    const tg=e.touches[0];
    if(tg.target&&tg.target.closest&&tg.target.closest("pre,code,button,a"))return;
    sx=tg.clientX;sy=tg.clientY;active=true;passed=false;
    card.classList.add("swiping");
  },{passive:true});
  card.addEventListener("touchmove",e=>{
    if(!active||e.touches.length!==1)return;
    const tg=e.touches[0],mx=tg.clientX-sx,my=tg.clientY-sy;
    if(Math.abs(my)>Math.abs(mx)*1.4){active=false;card.classList.remove("swiping");card.style.transform="";return}
    const dx=Math.min(0,mx),th=THRESH();
    if(!prefersReducedMotion())card.style.transform=`translateX(${dx<-th?-th+(dx+th)*0.25:dx}px)`;
    if(!passed&&dx<=-th){passed=true;haptic(10)}
  },{passive:true});
  const reset=()=>{active=false;card.classList.remove("swiping");card.style.transition="";card.style.transform=""};
  const end=()=>{
    if(!active)return;const wasPassed=passed;reset();
    if(wasPassed&&!prefersReducedMotion()){
      card.style.transition="transform .16s ease-out";
      setTimeout(()=>{card.style.transition=""},200);
    }
    if(wasPassed)quoteFinalAnswer();
  };
  card.addEventListener("touchend",end,{passive:true});
  card.addEventListener("touchcancel",reset,{passive:true});
}
// v5.11.28: картка-цитата PNG фінальної відповіді (виділений фрагмент або весь текст).
$("quoteCardBtn")?.addEventListener("click",()=>downloadQuoteCard(currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||"","finalAnswer"));
initSwipeReply(); // v5.11.43: свайп вліво по відповіді → цитата
/* v5.11.65: проводка «Зберегти в нотатки» і long-press-меню відповіді. */
$("saveNoteBtn")?.addEventListener("click",saveAnswerAsNote);
$("noteSaveFullBtn")?.addEventListener("click",()=>{closeSheet("noteSaveSheet");if(noteSavePending)saveNoteText(noteSavePending.full);noteSavePending=null});
$("noteSaveListBtn")?.addEventListener("click",()=>{closeSheet("noteSaveSheet");if(noteSavePending)saveNoteText(noteSavePending.list);noteSavePending=null});
initLongPressMenu(); // v5.11.65: довге натискання по відповіді → меню «•••»
/* v5.11.40: «Запустити як завдання» — міст із відповіді в команду агентів.
   Разово → POST /api/team/tasks (queued, видно в панелі «Команда агентів»);
   щодня → POST /api/schedules (регулярний промпт, як у «Регулярних завданнях»). */
const TASK_ROLE_FALLBACK=["coordinator","research","search","analytics","docs"];
let taskRolesCache=null;
async function fillTaskRoles(){
  const sel=$("taskRole");if(!sel||sel.dataset.filled)return;
  let roles=taskRolesCache;
  if(!roles){
    try{
      const r=await fetch("/api/team/agents",{cache:"no-store",credentials:"same-origin",headers:authHeaders()});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&Array.isArray(j.agents)&&j.agents.length)roles=j.agents.map(a=>[String(a.id),String(a.name||a.id)]);
    }catch(e){}
    if(!roles||!roles.length)roles=TASK_ROLE_FALLBACK.map(id=>[id,t(`taskRole_${id}`)]);
    taskRolesCache=roles;
  }
  sel.innerHTML=roles.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join("");
  sel.dataset.filled="1";
}
function taskSheetInput(){
  const prompt=String(currentRun?.prompt||"").trim();
  const answer=String(currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||"").trim();
  return {prompt,answer};
}
function openTaskSheet(){
  const {prompt,answer}=taskSheetInput();
  if(!prompt&&!answer){toast(t("runAsTaskNoAnswer"),"bad");return}
  const nameEl=$("taskName");if(nameEl)nameEl.value=(prompt||answer).slice(0,120);
  const once=document.querySelector('input[name="taskFreq"][value="once"]');if(once)once.checked=true;
  // v5.11.66: чекбокс «Додати файли» — лише коли у вкладці «Файли» щось є.
  const row=$("taskFilesRow"),box=$("taskIncludeFiles");
  if(row)row.hidden=!(attachments&&attachments.length);
  if(box)box.checked=true;
  fillTaskRoles().catch(()=>{});
  openSheet("taskSheet");
}
function taskSheetFileContext(){
  // v5.11.66: стислий текст вкладень для делегованого завдання —
  // той самий формат <attached_files>, що й у чаті (buildFileContext).
  const full=buildFileContext({task:String($("taskName")?.value||"")});
  if(!full)return "";
  const cap=12000,clipped=full.slice(0,cap);
  return clipped+(full.length>cap?`\n${t("taskFilesTruncated",{n:cap})}`:"");
}
async function createTaskFromSheet(){
  const {prompt,answer}=taskSheetInput();
  const title=(String($("taskName")?.value||"").trim().slice(0,200))||prompt.slice(0,200)||answer.slice(0,200);
  if(!title){toast(t("runAsTaskNoAnswer"),"bad");return}
  const freq=(document.querySelector('input[name="taskFreq"]:checked')||{}).value||"once";
  let input=t("runAsTaskInput",{prompt,answer}).slice(0,12000);
  // v5.11.66: вкладення з вкладки «Файли» — лише за ввімкненим чекбоксом.
  if($("taskIncludeFiles")?.checked&&attachments&&attachments.length){
    const ctx=taskSheetFileContext();
    if(ctx)input+=`\n\n${ctx}`;
  }
  closeSheet("taskSheet");
  try{
    if(freq==="daily"){
      const time=String($("taskTime")?.value||"").trim();
      if(!/^\d{2}:\d{2}$/.test(time)){toast(t("runAsTaskNeedTime"),"bad");return}
      let tz="UTC";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"}catch(e){}
      const r=await fetch("/api/schedules",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({name:title,time,timezone:tz,prompt:input.slice(0,20000)})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
      toast(t("runAsTaskScheduled"),"good");openSheet("schedSheet");try{loadSchedules()}catch(e){}return;
    }
    const role=$("taskRole")?.value||"coordinator";
    const r=await fetch("/api/team/tasks",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({role,title,input,kind:"agent"})});
    const j=await r.json().catch(()=>({}));
    if(r.status===409){toast(t("runAsTaskDup"),"bad");return}
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
    toast(t("runAsTaskCreated"),"good");showPage("crew");
  }catch(e){toast(t("runAsTaskFail")+": "+String(e?.message||e).slice(0,120),"bad")}
}
$("taskFromAnswerBtn")?.addEventListener("click",openTaskSheet);
$("taskCreateBtn")?.addEventListener("click",createTaskFromSheet);
document.querySelectorAll("[data-save-provider-token]").forEach(b=>b.onclick=()=>saveProviderToken(b.dataset.saveProviderToken));
document.querySelectorAll("[data-delete-provider-token]").forEach(b=>b.onclick=()=>deleteProviderToken(b.dataset.deleteProviderToken));
// v5.9.0 bindings
$("themeBtn")?.addEventListener("click",cycleTheme);
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change",()=>applyTheme(currentTheme()));
$("cmdkBtn")?.addEventListener("click",openCmdk);
$("cmdkInput")?.addEventListener("input",()=>{cmdkIndex=0;renderCmdk()});
$("cmdkInput")?.addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(!cmdkItems.length)return;cmdkIndex=(cmdkIndex+(e.key==="ArrowDown"?1:-1)+cmdkItems.length)%cmdkItems.length;renderCmdk();$("cmdkList")?.querySelector(".cmdkItem.active")?.scrollIntoView({block:"nearest"})}
  else if(e.key==="Enter"){e.preventDefault();runCmdk(cmdkIndex)}
  else if(e.key==="Escape"){e.preventDefault();closeCmdk()}
});
document.querySelectorAll("[data-cmdk-close]").forEach(el=>el.addEventListener("click",closeCmdk));
document.addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&String(e.key).toLowerCase()==="k"){e.preventDefault();if($("cmdk")?.classList.contains("hidden"))openCmdk();else closeCmdk();return}
  if(e.key==="Escape"&&!$("cmdk")?.classList.contains("hidden")){closeCmdk();return}
  // v5.11.74: Ctrl/Cmd+Enter — відправка з поля вводу агента (у чаті
  // Ctrl+Enter вже відправляє через власний обробник #prompt).
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key==="Enter"){
    const ae=document.activeElement;
    if(ae&&ae.id==="agentPrompt"){e.preventDefault();$("agentStartBtn")?.click();return}
  }
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||"")||document.activeElement?.isContentEditable;
  if(!typing&&e.key==="/"&&$("page-chat")?.classList.contains("active")){e.preventDefault();$("prompt")?.focus()}
});

$("regenBtn")?.addEventListener("click",regenerate);
$("exportMdBtn")?.addEventListener("click",exportMarkdown);
$("handoffBtn")?.addEventListener("click",copyAiHandoff); // v5.11.63: копіювати діалог як текст для ШІ
$("feedbackUpBtn")?.addEventListener("click",()=>sendFeedback("up"));
$("feedbackDownBtn")?.addEventListener("click",()=>sendFeedback("down"));
$("bookmarkBtn")?.addEventListener("click",()=>{const key=bookmarkKeyOf(currentRun);if(!key){toast(t("noAnswer"),"warn");return}const added=toggleBookmark(key,bookmarkTitleOf(currentRun));toast(t(added?"bookmarkSaved":"bookmarkRemoved"),"good");syncBookmarkBtn(currentRun)}); // v5.11.30
document.querySelectorAll(".reasonChip[data-reason]").forEach(b=>b.addEventListener("click",()=>{b.classList.add("selected");sendFeedback("down",b.dataset.reason)}));
$("historySearch")?.addEventListener("input",()=>{clearTimeout(renderHistory._t);renderHistory._t=setTimeout(renderHistory,160)});
$("updateBannerBtn")?.addEventListener("click",refreshSite);
$("brainRefreshBtn")?.addEventListener("click",()=>loadBrain());
$("brainResetBtn")?.addEventListener("click",resetLearning);
$("askAiFixBtn")?.addEventListener("click",askAiToFix);
$("diagCopyBtn")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(diagReportText());toast(t("copied"),"good")}catch(e){toast(t("copyFailed"),"bad")}});
$("diagClearBtn")?.addEventListener("click",()=>{try{localStorage.removeItem(DIAG_KEY)}catch(e){}renderDiagLog()});
$("styleInstructions")?.addEventListener("input",e=>{clearTimeout(e.target._t);e.target._t=setTimeout(()=>{lsSet(STYLE_KEY,e.target.value.slice(0,600));},250)});
$("styleInstructions")?.addEventListener("change",()=>toast(t("styleSaved"),"good"));
$("styleAuto")?.addEventListener("change",e=>{lsSet(STYLE_AUTO_KEY,e.target.checked?"1":"0");renderAdaptiveHints()});

window.addEventListener("aibridge:languagechange",()=>{try{renderRoleChips();renderUsage();refreshPushStatus();updateFileVoiceLangBtn()}catch(e){}
  I18N?.apply?.();
  updateModeUI();setStudioMode(studioMode);renderFiles();renderImageAttachments();renderAgentThread();renderAgentProviderOptions();renderHistory();renderProviders();renderConnections();updateFileSendState();updateCallEstimate();
  renderAdaptiveHints();if(currentRun&&!$("answerArea")?.classList.contains("hidden"))renderFollowUps(currentRun);if($("page-brain")?.classList.contains("active"))loadBrain().catch(()=>{});
  // v5.9.16: re-render cached panels with the new language (no refetch).
  try{renderProjectSelect();if(!$("promptSheet")?.classList.contains("hidden"))renderPromptLib();if(!$("projectSheet")?.classList.contains("hidden"))renderProjects();if(costCache)renderCostData(costCache);renderGatewayStatus(gwCache)}catch(e){}
  if(voiceListening&&voiceRecognition){try{voiceRecognition.stop()}catch(e){}}
  if(agentVoiceListening&&agentVoiceRecognition){try{agentVoiceRecognition.stop()}catch(e){}}
  if(studioVoiceListening&&studioVoiceRecognition){try{studioVoiceRecognition.stop()}catch(e){}}
  refreshStatus().catch(()=>{});
});

/* =====================================================================
   v5.9.16 — cost dashboard, AI Gateway settings, prompt library,
   projects, conversation fork, routing preferences, #url / /search
   preprocessing, read-aloud (TTS).
   Server contracts (implemented separately in _worker.js):
   - GET  /api/usage -> {ok, days:[{date,in,out,cost,byProvider,byModel}], totals:{in,out,cost}, budget:{limit,spentMonth,over}}
   - GET  /api/settings -> {ok, settings:{monthlyBudgetUsd, gateway:{enabled,accountId,gatewayId}, braveKeySet}}
   - POST /api/settings {monthlyBudgetUsd?, gateway?, braveKey?} -> {ok:true}
   - GET/POST/DELETE /api/prompts (DELETE ?id=)
   - GET/POST/DELETE /api/projects (DELETE ?id=)
   - POST /api/fetch-url {url} -> {ok,title,text,url}
   - POST /api/web-search {q} -> {ok, results:[...]} | {ok:false,error:"no_key"}
   Chat payload additions: routingPref:{q,speed}, convId, project:{id,name,instructions}.
   Response flags honoured: budgetDowngraded, pinned.
   ===================================================================== */

/* ---------- F5: routing preferences + conversation id ---------- */
const ROUTING_PREF_KEY="ai_bridge_routing_pref";
/* v5.11.27: four named policies over the numeric {q,speed} wire format.
   Old stored prefs keep working through policyOfRoutingPref. */
const ROUTING_POLICIES={economy:{q:2,speed:false},speed:{q:5,speed:true},balanced:{q:5,speed:false},quality:{q:8,speed:false}};
function policyOfRoutingPref(p){
  const q=Number(p&&p.q),speed=!!(p&&p.speed);
  return speed?"speed":(Number.isFinite(q)&&q<=3)?"economy":(Number.isFinite(q)&&q>=7)?"quality":"balanced";
}
function getRoutingPref(){
  const v=lsJson(ROUTING_PREF_KEY,null);
  const q=v&&Number.isFinite(Number(v.q))?Math.max(0,Math.min(10,Math.round(Number(v.q)))):5;
  return {q,speed:!!(v&&v.speed)};
}
function getRoutingPolicy(){return policyOfRoutingPref(getRoutingPref())}
function saveRoutingPref(p){lsSet(ROUTING_PREF_KEY,JSON.stringify({q:Math.max(0,Math.min(10,Math.round(Number(p.q)||0))),speed:!!p.speed}))}
function initRoutingPrefs(){
  const seg=$("routingPolicySeg");
  if(!seg)return;
  const paint=()=>{const cur=getRoutingPolicy();seg.querySelectorAll("[data-policy]").forEach(b=>{const on=b.dataset.policy===cur;b.classList.toggle("on",on);b.setAttribute("aria-checked",on?"true":"false")})};
  paint();
  seg.querySelectorAll("[data-policy]").forEach(b=>b.addEventListener("click",()=>{const p=ROUTING_POLICIES[b.dataset.policy];if(!p)return;saveRoutingPref(p);paint()}));
}
/* ---------- v5.11.50: доступність (ідея scout) ---------- */
const A11Y_KEY="ai_bridge_a11y_v1",A11Y_SIZES=["m","l","xl"];
function getA11y(){const j=lsJson(A11Y_KEY,{});return{dyslexic:!!j.dyslexic,size:A11Y_SIZES.includes(j.size)?j.size:"m"}}
function applyA11y(){const s=getA11y(),h=document.documentElement;h.classList.toggle("a11yDyslexic",s.dyslexic);h.setAttribute("data-a11y-size",s.size);
  const cb=$("a11yDyslexic");if(cb&&cb.checked!==s.dyslexic)cb.checked=s.dyslexic;
  document.querySelectorAll("#a11ySizeSeg [data-a11y-size]").forEach(b=>{const on=b.dataset.a11ySize===s.size;b.classList.toggle("on",on);b.setAttribute("aria-checked",on?"true":"false")})}
function setA11y(patch){lsSet(A11Y_KEY,JSON.stringify({...getA11y(),...patch}));applyA11y()}
function initA11y(){applyA11y();$("a11yDyslexic")?.addEventListener("change",e=>setA11y({dyslexic:e.target.checked}));
  document.querySelectorAll("#a11ySizeSeg [data-a11y-size]").forEach(b=>b.addEventListener("click",()=>setA11y({size:b.dataset.a11ySize})))}
initA11y();

/* ---------- v5.11.50: окрема модель для фонових задач (ідея scout) ---------- */
const BG_MODEL_KEY="ai_bridge_bg_model",BG_MODELS=["auto","groqfree","openrouter","gemini","claude","grok","openai"];
function getBgModel(){const v=lsGet(BG_MODEL_KEY,"auto");return BG_MODELS.includes(v)?v:"auto"}
function initBgModel(){const sel=$("bgModel");if(!sel)return;sel.value=getBgModel();
  sel.addEventListener("change",()=>{lsSet(BG_MODEL_KEY,sel.value)})}
initBgModel();
/* v5.11.27: manual-override tracking for the "why this model" line. Set in
   sendTask when a mention / role / single-mode pick forces the provider. */
let lastForcedBy=null;
const CONV_ID_KEY="ai_bridge_conv_id";
let convId="";
function getConvId(){if(!convId)resetConvId();return convId}
function resetConvId(){convId=newUid();lsSet(CONV_ID_KEY,convId);budgetDowngradedToasted=false}
function initConvId(){convId=lsGet(CONV_ID_KEY,"")||"";if(!convId)resetConvId()}

/* ---------- F1: cost dashboard + monthly budget ---------- */
let costCache=null,budgetDowngradedToasted=false,lastBudgetCheck=0;
function fmtMoney(n){const v=Number(n)||0;return (v>0&&v<0.01)?"<0.01":v.toFixed(v<10?4:2)}
function fmtInt(n){try{return Math.round(Number(n)||0).toLocaleString("en-US")}catch(e){return String(Math.round(Number(n)||0))}}
async function fetchUsage(){
  const r=await fetch("/api/usage",{cache:"no-store",credentials:"same-origin",headers:authHeaders()});
  const j=await readApiJson(r);
  if(!r.ok||!j||j.ok===false)throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}
async function renderCostDashboard(){
  const host=$("costBody");if(!host)return;
  showSkel(host,"cards",3); // v5.10.0 skeleton instead of a spinner
  try{
    const j=await fetchUsage();
    costCache=j;renderCostData(j);checkBudgetBanner(j);
  }catch(e){
    host.innerHTML=errCard(t("costLoadFail"),()=>renderCostDashboard());
  }
}
function renderCostData(j){
  const host=$("costBody");if(!host)return;
  const totals=j.totals||{},days=Array.isArray(j.days)?j.days.slice(-14):[],budget=j.budget||{};
  if(!days.length&&!(totals.cost||totals.in||totals.out)){
    host.innerHTML=emptyState("💸",t("costNoData"),t("costRefresh"),()=>renderCostDashboard());
    return;
  }
  // Provider/model tables are aggregated from the daily breakdowns so they
  // work whether or not the server also returns totals.byProvider/byModel.
  const aggP={},aggM={};
  for(const d of days){
    for(const [pid,v] of Object.entries(d.byProvider||{})){const a=aggP[pid]||(aggP[pid]={in:0,out:0,cost:0});a.in+=Number(v.in)||0;a.out+=Number(v.out)||0;a.cost+=Number(v.cost)||0}
    for(const [m,v] of Object.entries(d.byModel||{})){const a=aggM[m]||(aggM[m]={in:0,out:0,cost:0});a.in+=Number(v.in)||0;a.out+=Number(v.out)||0;a.cost+=Number(v.cost)||0}
  }
  for(const [pid,v] of Object.entries(totals.byProvider||{})){const a=aggP[pid]||(aggP[pid]={in:0,out:0,cost:0});a.in+=Number(v.in)||0;a.out+=Number(v.out)||0;a.cost+=Number(v.cost)||0}
  for(const [m,v] of Object.entries(totals.byModel||{})){const a=aggM[m]||(aggM[m]={in:0,out:0,cost:0});a.in+=Number(v.in)||0;a.out+=Number(v.out)||0;a.cost+=Number(v.cost)||0}
  const tbl=(title,entries)=>entries.length?`<div class="costTableWrap"><b>${esc(title)}</b><table class="costTable"><tbody>${entries.sort((a,b)=>b[1].cost-a[1].cost).map(([name,v])=>`<tr><td>${esc(name)}</td><td class="num">$${fmtMoney(v.cost)}</td><td class="num">${fmtInt(v.in)}/${fmtInt(v.out)}</td></tr>`).join("")}</tbody></table></div>`:"";
  const maxCost=Math.max(0.0001,...days.map(d=>Number(d.cost)||0));
  const bars=days.map(d=>{
    const c=Number(d.cost)||0,pct=Math.max(3,Math.round(c/maxCost*100));
    return `<div class="costBarRow"><span class="costBarDate">${esc(String(d.date||"").slice(5)||"—")}</span><div class="costBarTrack"><div class="costBarFill" style="width:${pct}%"></div></div><span class="costBarVal">$${fmtMoney(c)}</span></div>`;
  }).join("");
  let budgetHtml="";
  if(budget.limit!=null&&Number(budget.limit)>0){
    const spent=Number(budget.spentMonth)||0,limit=Number(budget.limit),pct=Math.min(100,Math.round(spent/limit*100));
    budgetHtml=`<div class="costBudgetLine"><b>${esc(t("costSpent"))}: $${fmtMoney(spent)}</b><span>${esc(t("budgetSpentOf",{spent:fmtMoney(spent),limit:fmtMoney(limit)}))}</span><div class="costBarTrack"><div class="costBarFill${spent>limit?" over":""}" style="width:${pct}%"></div></div></div>`;
  }
  host.innerHTML=
    `<div class="costTotals"><div><b>$${fmtMoney(totals.cost)}</b><span>${esc(t("costSpent"))}</span></div>`+
    `<div><b>${fmtInt(totals.in)}</b><span>${esc(t("costTokensIn"))}</span></div>`+
    `<div><b>${fmtInt(totals.out)}</b><span>${esc(t("costTokensOut"))}</span></div></div>`+
    budgetHtml+
    (bars?`<div class="costTableWrap"><b>${esc(t("costDaily"))}</b><div class="costBars">${bars}</div></div>`:"")+
    tbl(t("costByProvider"),Object.entries(aggP).map(([pid,v])=>[PROVIDERS[pid]?.name||pid,v]))+
    tbl(t("costByModel"),Object.entries(aggM));
}
function checkBudgetBanner(j){
  const b=(j&&j.budget)||(costCache&&costCache.budget)||{};
  const banner=$("budgetBanner");if(!banner)return;
  if(b.over){
    $("budgetBannerText").textContent=t("budgetExceeded");
    banner.classList.remove("hidden");
  }
}
// Silent budget refresh: keeps the persistent banner truthful without
// bothering the user. Throttled to one probe per minute.
function maybeRefreshBudget(){
  if(Date.now()-lastBudgetCheck<60000)return;
  lastBudgetCheck=Date.now();
  fetchUsage().then(j=>{
    costCache=j;
    if($("page-connections")?.classList.contains("active"))renderCostData(j);
    checkBudgetBanner(j);
  }).catch(()=>{});
}
async function saveBudget(){
  const input=$("budgetInput"),msg=$("budgetStatus");
  const raw=String(input?.value||"").replace(",",".").trim();
  const v=raw===""?0:Number(raw);
  if(!Number.isFinite(v)||v<0){if(msg){msg.className="mcpStatusText bad";msg.textContent=t("budgetSaveFail")}return}
  try{
    const r=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({monthlyBudgetUsd:v})});
    const j=await readApiJson(r);
    if(!r.ok||j.ok===false)throw new Error(j.error||`HTTP ${r.status}`);
    if(msg){msg.className="mcpStatusText good";msg.textContent=t("budgetSaved")}
    toast(t("budgetSaved"),"good");
    lastBudgetCheck=0;maybeRefreshBudget();
  }catch(e){
    if(msg){msg.className="mcpStatusText bad";msg.textContent=t("budgetSaveFail")}
    else toast(t("budgetSaveFail"),"bad");
  }
}

/* ---------- F2: AI Gateway settings ---------- */
let gwCache=null;
async function loadAppSettings(){
  try{
    const r=await fetch("/api/settings",{cache:"no-store",credentials:"same-origin",headers:authHeaders()});
    const j=await readApiJson(r);
    if(r.ok&&j&&j.ok!==false&&j.settings){
      const s=j.settings;
      if(s.monthlyBudgetUsd!=null&&$("budgetInput")&&document.activeElement!==$("budgetInput"))$("budgetInput").value=String(s.monthlyBudgetUsd);
      const gw=s.gateway||{};
      if($("gatewayToggle"))$("gatewayToggle").checked=!!gw.enabled;
      if($("gatewayAccountId")&&document.activeElement!==$("gatewayAccountId"))$("gatewayAccountId").value=String(gw.accountId||"");
      if($("gatewayGatewayId")&&document.activeElement!==$("gatewayGatewayId"))$("gatewayGatewayId").value=String(gw.gatewayId||"");
    }
  }catch(e){}
  loadGatewayStatus();
  maybeRefreshBudget();
}
async function loadGatewayStatus(){
  const el=$("gatewayStatus");if(!el)return;
  let g=null;
  try{const r=await fetch("/api/config",{cache:"no-store",credentials:"same-origin"});const j=await readApiJson(r);g=j.aiGateway||null}catch(e){}
  if(!g){try{const r=await fetch("/api/status",{cache:"no-store",credentials:"same-origin"});const j=await readApiJson(r);g=j.aiGateway||null}catch(e){}}
  gwCache=g;renderGatewayStatus(g);
}
function renderGatewayStatus(g){
  const el=$("gatewayStatus");if(!el)return;
  if(!g){el.className="mcpStatusText";el.textContent=t("gwLoadFail");return}
  if(!g.enabled){el.className="mcpStatusText";el.textContent=t("gwStatusOff");return}
  const parts=[t("gwStatusOn",{id:g.id||"—"}),t("gwRouted",{n:g.routed||0}),t("gwDirect",{n:g.directFallbacks||0})];
  if(g.lastError)parts.push(t("gwLastError",{e:String(g.lastError).slice(0,80)}));
  el.className="mcpStatusText "+(g.lastError?"bad":"good");
  el.textContent=parts.join(" • ");
}
async function saveGateway(){
  const msg=$("gatewayStatus");
  const body={gateway:{enabled:!!$("gatewayToggle")?.checked,accountId:($("gatewayAccountId")?.value||"").trim(),gatewayId:($("gatewayGatewayId")?.value||"").trim()}};
  try{
    const r=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify(body)});
    const j=await readApiJson(r);
    if(!r.ok||j.ok===false)throw new Error(j.error||`HTTP ${r.status}`);
    toast(t("gwSaved"),"good");
    loadGatewayStatus();
  }catch(e){
    if(msg){msg.className="mcpStatusText bad";msg.textContent=t("gwSaveFail")}
    else toast(t("gwSaveFail"),"bad");
  }
}

/* ---------- F3: prompt library ---------- */
const PROMPTLIB_KEY="ai_bridge_promptlib_v1";
let promptLib=[],promptLibRemote=false,promptEditingId=null;
function promptVarsOf(body){const out=[],rx=/\{\{\s*([\w.-]+)\s*\}\}/g;let m;while((m=rx.exec(String(body||""))))if(!out.includes(m[1]))out.push(m[1]);return out}
async function loadPromptLib(){
  const host=$("promptList");if(host&&!host.dataset.loaded)showSkel(host,"rows",3); // v5.10.0 skeleton
  try{
    const r=await fetch("/api/prompts",{cache:"no-store",credentials:"same-origin",headers:authHeaders()});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    const items=Array.isArray(j)?j:j.items;
    if(!Array.isArray(items))throw new Error("bad shape");
    promptLib=items;promptLibRemote=true;
  }catch(e){promptLib=lsJson(PROMPTLIB_KEY,[]);promptLibRemote=false}
  if(host)host.dataset.loaded="1";
  renderPromptLib();
}
function persistPromptLibLocal(){lsSet(PROMPTLIB_KEY,JSON.stringify(promptLib.slice(0,100)))}
function promptFind(id){return promptLib.find(p=>String(p.id)===String(id))}
function renderPromptLib(){
  const host=$("promptList");if(!host)return;
  if(!promptLib.length){
    host.innerHTML=emptyState("📚",t("promptLibEmpty")+(promptLibRemote?"":" "+t("promptLocal")),t("promptNew"),()=>{$("promptNewBox").open=true;$("promptName")?.focus()});
    return;
  }
  host.innerHTML=promptLib.map(p=>{
    const vars=promptVarsOf(p.body);
    return `<div class="promptItem"><div class="promptItemHead"><b>${esc(p.name||"—")}</b><span class="smallMuted">${vars.length?esc(t("promptVars",{vars:vars.join(", ")})):esc(t("promptNoVars"))}</span></div><div class="promptItemBtns"><button type="button" class="tinyBtn" data-prompt-use="${esc(p.id||"")}">${esc(t("promptUse"))}</button><button type="button" class="tinyBtn" data-prompt-edit="${esc(p.id||"")}">${esc(t("promptEdit"))}</button><button type="button" class="tinyBtn" data-prompt-del="${esc(p.id||"")}">${esc(t("deleteBtn"))}</button></div></div>`;
  }).join("");
  host.querySelectorAll("[data-prompt-use]").forEach(b=>b.onclick=()=>promptUseStart(b.dataset.promptUse));
  host.querySelectorAll("[data-prompt-edit]").forEach(b=>b.onclick=()=>promptEditStart(b.dataset.promptEdit));
  host.querySelectorAll("[data-prompt-del]").forEach(b=>b.onclick=()=>promptDelete(b.dataset.promptDel));
}
function upsertLocalPrompt(p,name,body,now){
  if(p){p.name=name;p.body=body;p.vars=promptVarsOf(body);p.updatedAt=now}
  else promptLib.unshift({id:newUid(),name,body,vars:promptVarsOf(body),createdAt:now,updatedAt:now});
}
async function promptSave(){
  const name=($("promptName")?.value||"").trim().slice(0,80),body=($("promptBody")?.value||"").trim().slice(0,6000);
  if(!name){toast(t("promptNeedName"),"bad");$("promptName")?.focus();return}
  if(!body){toast(t("promptNeedBody"),"bad");$("promptBody")?.focus();return}
  const now=Date.now(),p=promptEditingId?promptFind(promptEditingId):null;
  if(promptLibRemote){
    try{
      const r=await fetch("/api/prompts",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({id:p?.id,name,body})});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
      await loadPromptLib();
    }catch(e){promptLibRemote=false;upsertLocalPrompt(p,name,body,now);persistPromptLibLocal();renderPromptLib();toast(t("promptLocal"))}
  }else{upsertLocalPrompt(p,name,body,now);persistPromptLibLocal();renderPromptLib()}
  promptEditingId=null;
  if($("promptName"))$("promptName").value="";if($("promptBody"))$("promptBody").value="";
  const pv=$("promptVarsPreview");if(pv)pv.textContent="";
  const box=$("promptNewBox");if(box)box.open=false;
  $("promptCancelEditBtn")?.classList.add("hidden");
  toast(t("promptSaved"),"good");
}
async function promptDelete(id){
  const p=promptFind(id);if(!p)return;
  if(!confirm(`${t("deleteBtn")}: ${p.name||""}`))return;
  if(promptLibRemote){
    try{
      const r=await fetch(`/api/prompts?id=${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin",cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      await loadPromptLib();
    }catch(e){promptLibRemote=false;promptLib=promptLib.filter(x=>String(x.id)!==String(id));persistPromptLibLocal();renderPromptLib()}
  }else{promptLib=promptLib.filter(x=>String(x.id)!==String(id));persistPromptLibLocal();renderPromptLib()}
  toast(t("promptDeleted"),"good");
}
function promptEditStart(id){
  const p=promptFind(id);if(!p)return;
  promptEditingId=p.id;
  if($("promptName"))$("promptName").value=p.name||"";
  if($("promptBody"))$("promptBody").value=p.body||"";
  updatePromptVarsPreview();
  const box=$("promptNewBox");if(box)box.open=true;
  $("promptCancelEditBtn")?.classList.remove("hidden");
  $("promptName")?.focus();
}
function updatePromptVarsPreview(){
  const el=$("promptVarsPreview");if(!el)return;
  const vars=promptVarsOf($("promptBody")?.value||"");
  el.textContent=vars.length?t("promptVars",{vars:vars.join(", ")}):t("promptNoVars");
}
function promptUseStart(id){
  const p=promptFind(id);if(!p)return;
  const vars=promptVarsOf(p.body),form=$("promptVarForm");
  if(!form)return;
  if(!vars.length){insertIntoComposer(p.body);closeSheet("promptSheet");return}
  form.classList.remove("hidden");
  form.innerHTML=`<b>${esc(t("promptFillVars"))}: ${esc(p.name||"")}</b>`+vars.map(v=>`<label><span>${esc(v)}</span><input data-prompt-var="${esc(v)}" autocomplete="off"></label>`).join("")+`<div class="promptNewBtns"><button type="button" class="primary" id="promptVarInsert">${esc(t("promptInsert"))}</button><button type="button" class="tinyBtn" id="promptVarCancel">${esc(t("cancelBtn"))}</button></div>`;
  const insert=()=>{
    const vals={};form.querySelectorAll("[data-prompt-var]").forEach(i=>vals[i.dataset.promptVar]=i.value);
    const text=String(p.body).replace(/\{\{\s*([\w.-]+)\s*\}\}/g,(m,k)=>vals[k]!==undefined?vals[k]:m);
    form.classList.add("hidden");form.innerHTML="";
    insertIntoComposer(text);closeSheet("promptSheet");
  };
  $("promptVarInsert").onclick=insert;
  $("promptVarCancel").onclick=()=>{form.classList.add("hidden");form.innerHTML=""};
  form.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();insert()}}));
  form.querySelector("input")?.focus();
}
function insertIntoComposer(text){
  const el=$("prompt");if(!el)return;
  const cur=el.value.trim();
  el.value=cur?cur+"\n\n"+text:text;
  updateCallEstimate();
  showPage("chat");
  setTimeout(()=>{try{el.scrollIntoView({behavior:"smooth",block:"center"});el.focus()}catch(e){}},150);
}

/* ---------- F3: projects ---------- */
const PROJECTS_KEY="ai_bridge_projects_v1",PROJECT_ACTIVE_KEY="ai_bridge_project_active";
let projects=[],projectsRemote=false,activeProject=null,projectEditingId=null;
async function loadProjects(){
  const host=$("projectList");if(host&&!host.dataset.loaded)showSkel(host,"rows",3); // v5.10.0 skeleton
  try{
    const r=await fetch("/api/projects",{cache:"no-store",credentials:"same-origin",headers:authHeaders()});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    const items=Array.isArray(j)?j:j.items;
    if(!Array.isArray(items))throw new Error("bad shape");
    projects=items;projectsRemote=true;
  }catch(e){projects=lsJson(PROJECTS_KEY,[]);projectsRemote=false}
  if(host)host.dataset.loaded="1";
  const activeId=lsGet(PROJECT_ACTIVE_KEY,"");
  activeProject=projects.find(p=>String(p.id)===String(activeId))||null;
  renderProjects();renderProjectSelect();
  if(activeProject)applyProjectDefaults(activeProject);
}
function persistProjectsLocal(){lsSet(PROJECTS_KEY,JSON.stringify(projects.slice(0,50)))}
function projectField(){
  const p=activeProject;if(!p||!String(p.instructions||"").trim())return {};
  return {project:{id:p.id,name:p.name,instructions:String(p.instructions).slice(0,4000)}};
}
function renderProjectSelect(){
  const sel=$("projectSelect");if(!sel)return;
  sel.innerHTML=`<option value="">${esc(t("projNone"))}</option>`+projects.map(p=>`<option value="${esc(p.id)}"${activeProject&&String(activeProject.id)===String(p.id)?" selected":""}>${esc(p.name||"—")}</option>`).join("");
  const chip=$("projectChip");
  if(activeProject){chip?.classList.remove("hidden");const n=$("projectChipName");if(n)n.textContent=activeProject.name||""}
  else chip?.classList.add("hidden");
}
function setActiveProject(id,announce=true){
  const p=projects.find(x=>String(x.id)===String(id))||null;
  activeProject=p;lsSet(PROJECT_ACTIVE_KEY,p?String(p.id):"");
  if(p)applyProjectDefaults(p);
  renderProjectSelect();
  if(announce)toast(p?t("projOn",{name:p.name||""}):t("projOff"),"good");
}
function applyProjectDefaults(p){
  if(!p)return;
  const modeSel=$("teamMode");
  if(p.mode&&modeSel?.querySelector(`option[value="${p.mode}"]`)){modeSel.value=p.mode;lsSet("ai_bridge_mode",p.mode)}
  if(p.model&&PROVIDERS[p.model]){
    if(modeSel?.value==="single")lsSet("ai_bridge_single_provider",p.model);
    else if(status.providers?.[p.model])lsSet("ai_bridge_selected",JSON.stringify([p.model]));
  }
  updateModeUI();
}
function renderProjects(){
  const host=$("projectList");if(!host)return;
  if(!projects.length){
    host.innerHTML=emptyState("🗂️",t("projNone")+(projectsRemote?"":" "+t("projLocal")),t("projNew"),()=>{$("projectNewBox").open=true;$("projectName")?.focus()});
    return;
  }
  host.innerHTML=projects.map(p=>`<div class="promptItem"><div class="promptItemHead"><b>${esc(p.name||"—")}</b><span class="smallMuted">${esc(PROVIDERS[p.model]?.name||p.model||"—")} • ${esc(p.mode||"auto")}</span></div><div class="promptItemBtns"><button type="button" class="tinyBtn" data-project-use="${esc(p.id)}"${activeProject&&String(activeProject.id)===String(p.id)?" disabled":""}>${activeProject&&String(activeProject.id)===String(p.id)?"✓":""}${esc(t("promptUse"))}</button><button type="button" class="tinyBtn" data-project-kb="${esc(p.id)}">📚 ${esc(t("kbShort"))}</button><button type="button" class="tinyBtn" data-project-edit="${esc(p.id)}">${esc(t("promptEdit"))}</button><button type="button" class="tinyBtn" data-project-del="${esc(p.id)}">${esc(t("deleteBtn"))}</button></div></div>`).join("");
  host.querySelectorAll("[data-project-use]").forEach(b=>b.onclick=()=>{setActiveProject(b.dataset.projectUse);closeSheet("projectSheet")});
  host.querySelectorAll("[data-project-kb]").forEach(b=>b.onclick=()=>openKb(b.dataset.projectKb));
  host.querySelectorAll("[data-project-edit]").forEach(b=>b.onclick=()=>projectEditStart(b.dataset.projectEdit));
  host.querySelectorAll("[data-project-del]").forEach(b=>b.onclick=()=>projectDelete(b.dataset.projectDel));
}
function upsertLocalProject(p,data,now){
  if(p)Object.assign(p,data,{updatedAt:now});
  else projects.unshift({id:newUid(),...data,createdAt:now,updatedAt:now});
}
async function projectSave(){
  const name=($("projectName")?.value||"").trim().slice(0,80);
  if(!name){toast(t("projNeedName"),"bad");$("projectName")?.focus();return}
  const data={name,instructions:($("projectInstr")?.value||"").trim().slice(0,4000),model:$("projectModel")?.value||"",mode:$("projectMode")?.value||"auto"};
  const now=Date.now(),p=projectEditingId?projects.find(x=>String(x.id)===String(projectEditingId)):null;
  if(projectsRemote){
    try{
      const r=await fetch("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify(p?{...data,id:p.id}:data)});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
      await loadProjects();
    }catch(e){projectsRemote=false;upsertLocalProject(p,data,now);persistProjectsLocal();renderProjects();renderProjectSelect();toast(t("projLocal"))}
  }else{upsertLocalProject(p,data,now);persistProjectsLocal();renderProjects();renderProjectSelect()}
  projectEditingId=null;
  for(const id of ["projectName","projectInstr"]){if($(id))$(id).value=""}
  const box=$("projectNewBox");if(box)box.open=false;
  $("projectCancelEditBtn")?.classList.add("hidden");
  toast(t("projSaved"),"good");
}
async function projectDelete(id){
  const p=projects.find(x=>String(x.id)===String(id));if(!p)return;
  if(!confirm(`${t("deleteBtn")}: ${p.name||""}`))return;
  if(activeProject&&String(activeProject.id)===String(id))setActiveProject("",false);
  if(projectsRemote){
    try{
      const r=await fetch(`/api/projects?id=${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin",cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      await loadProjects();
    }catch(e){projectsRemote=false;projects=projects.filter(x=>String(x.id)!==String(id));persistProjectsLocal();renderProjects();renderProjectSelect()}
  }else{projects=projects.filter(x=>String(x.id)!==String(id));persistProjectsLocal();renderProjects();renderProjectSelect()}
  toast(t("projDeleted"),"good");
}
function projectEditStart(id){
  const p=projects.find(x=>String(x.id)===String(id));if(!p)return;
  projectEditingId=p.id;
  if($("projectName"))$("projectName").value=p.name||"";
  if($("projectInstr"))$("projectInstr").value=p.instructions||"";
  if($("projectModel")&&p.model)$("projectModel").value=p.model;
  if($("projectMode")&&p.mode)$("projectMode").value=p.mode;
  const box=$("projectNewBox");if(box)box.open=true;
  $("projectCancelEditBtn")?.classList.remove("hidden");
  $("projectName")?.focus();
}

/* ---------- F4: fork conversation ---------- */
function forkRun(run,peerIndex=null){
  if(!run){toast(t("forkNoRun"),"bad");return}
  let clone;
  try{clone=JSON.parse(JSON.stringify(run))}catch(e){toast(t("forkNoRun"),"bad");return}
  if(peerIndex!=null){
    const peer=(clone.results||[])[peerIndex];
    if(peer&&peer.ok){clone.final=peer.text||"";clone.results=[peer];clone.judge=null}
  }
  delete clone.id;
  clone.uid=newUid();clone.created=Date.now();clone.updated=Date.now();
  const base=String(clone.title||clone.prompt||"").replace(/\s+/g," ").trim().slice(0,80);
  clone.title=`${base} (fork)`;
  saveRun(clone).then(()=>{
    currentRun=clone;resetConvId();
    showPage("chat",{keepScroll:true});renderAnswer(clone);renderHistory();
    toast(t("forkDone",{title:clone.title}),"good");
  }).catch(()=>{toast(t("forkNoRun"),"bad")});
}

/* ---------- F6: #url + /search preprocessing (before send) ---------- */
const BARE_URL_RX=/https?:\/\/[^\s)>\]]+/;
async function preprocessPrompt(text){
  let prompt=String(text||""),cancelled=false;
  // /search takes priority over URL handling.
  const sm=/^\/search\s+([\s\S]+)/.exec(prompt.trim());
  if(sm){
    const q=sm[1].trim();
    if(q){
      toast(t("searchingWeb"));
      try{
        const r=await fetch("/api/web-search",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({q})});
        const j=await r.json().catch(()=>({}));
        if(j&&j.ok===false&&String(j.error)==="no_key"){toast(t("searchNoKey"),"bad");return {text:prompt,cancelled:true}}
        const results=((j&&j.results)||[]).slice(0,6);
        if(!results.length)toast(t("searchNoResults"));
        else{
          const ctx=results.map((x,i)=>`[${i+1}] ${x.title||x.url||""}\n${x.url||""}\n${x.snippet||""}`.trim()).join("\n\n");
          prompt=`[${t("sourceLabel")} · /search: ${q}]\n${ctx}\n\n${q}`;
        }
      }catch(e){toast(t("searchFail"),"bad")}
    }
    return {text:prompt,cancelled};
  }
  const hash=/^#url\s+(\S+)/i.exec(prompt.trim());
  let url=hash?hash[1]:null;
  const stripped=hash?prompt.trim().slice(hash[0].length).trim():prompt;
  if(!url){const m=BARE_URL_RX.exec(prompt);if(m)url=m[0].replace(/[.,;:!?]+$/,"")}
  if(url){
    toast(t("fetchingPage"));
    try{
      const r=await fetch("/api/fetch-url",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({url})});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j&&j.ok&&j.text){
        const body=stripped||url;
        prompt=`${body}\n\n[${t("sourceLabel")}: ${j.url||url}]\n${String(j.text).slice(0,12000)}`;
      }else toast(t("fetchFail"),"bad");
    }catch(e){toast(t("fetchFail"),"bad")}
  }
  return {text:prompt,cancelled};
}

/* ---------- F7: read aloud (TTS only, iOS-safe) ---------- */
let ttsActive=false;
function stripForSpeech(text){
  return String(text||"")
    .replace(/```[\s\S]*?```/g," ")
    .replace(/`([^`]*)`/g,"$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g,"$1")
    .replace(/^#{1,6}\s*/gm,"")
    .replace(/(\*\*|__)([\s\S]*?)\1/g,"$2")
    .replace(/(^|\s)(\*|_)([^*_\n]+)\2/g,"$1$3")
    .replace(/^>\s*/gm,"").replace(/^[-*+]\s+/gm,"").replace(/^\d+[.)]\s+/gm,"")
    .replace(/<[^>]*>/g," ")
    .replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
    .replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
function updateTtsUi(){
  const b=$("ttsBtn");
  if(b){
    b.classList.toggle("speaking",ttsActive);
    const s=b.querySelector("span:last-child");
    if(s)s.textContent=t(ttsActive?"stopReading":"readAloud");
    b.setAttribute("aria-pressed",ttsActive?"true":"false");
  }
  document.body.classList.toggle("ttsSpeaking",ttsActive);
}
function toggleSpeech(text){
  try{
    const synth=window.speechSynthesis;if(!synth)return;
    // iOS Safari: speak() must run synchronously inside the click handler.
    if(ttsActive||synth.speaking){synth.cancel();ttsActive=false;updateTtsUi();return}
    const clean=stripForSpeech(text).slice(0,4000);
    if(!clean)return;
    const u=new SpeechSynthesisUtterance(clean);
    try{u.lang=I18N?.voiceLocale?.()||"uk-UA"}catch(e){u.lang="uk-UA"}
    u.onend=()=>{ttsActive=false;updateTtsUi()};
    u.onerror=()=>{ttsActive=false;updateTtsUi()};
    ttsActive=true;updateTtsUi();
    synth.speak(u);
  }catch(e){ttsActive=false;updateTtsUi()}
}

/* ---------- pinned provider badge ---------- */
function renderPinnedBadge(pinned){
  const el=$("pinnedBadge");if(!el)return;
  const p=pinned&&typeof pinned==="object"?pinned:(pinned?{provider:String(pinned)}:null);
  if(!p||(!p.provider&&!p.model)){el.classList.add("hidden");el.textContent="";return}
  el.classList.remove("hidden");
  el.textContent=t("pinnedBadge",{provider:PROVIDERS[p.provider]?.name||p.provider||p.model});
}

/* ---------- v5.9.16 UI bindings ---------- */
function initV5916(){
  initRoutingPrefs();initConvId();
  $("costRefreshBtn")?.addEventListener("click",()=>renderCostDashboard());
  $("budgetSaveBtn")?.addEventListener("click",saveBudget);
  $("budgetBannerClose")?.addEventListener("click",()=>$("budgetBanner")?.classList.add("hidden"));
  $("gatewaySaveBtn")?.addEventListener("click",saveGateway);
  $("promptLibBtn")?.addEventListener("click",()=>{loadPromptLib();openSheet("promptSheet")});
  $("promptSaveBtn")?.addEventListener("click",promptSave);
  $("promptBody")?.addEventListener("input",updatePromptVarsPreview);
  $("promptCancelEditBtn")?.addEventListener("click",()=>{
    promptEditingId=null;
    if($("promptName"))$("promptName").value="";if($("promptBody"))$("promptBody").value="";
    const pv=$("promptVarsPreview");if(pv)pv.textContent="";
    const box=$("promptNewBox");if(box)box.open=false;
    $("promptCancelEditBtn")?.classList.add("hidden");
  });
  $("projectManageBtn")?.addEventListener("click",()=>{loadProjects();openSheet("projectSheet")});
  $("projectSaveBtn")?.addEventListener("click",projectSave);
  $("projectCancelEditBtn")?.addEventListener("click",()=>{
    projectEditingId=null;
    for(const id of ["projectName","projectInstr"]){if($(id))$(id).value=""}
    const box=$("projectNewBox");if(box)box.open=false;
    $("projectCancelEditBtn")?.classList.add("hidden");
  });
  $("projectSelect")?.addEventListener("change",e=>setActiveProject(e.target.value));
  $("projectClearBtn")?.addEventListener("click",()=>setActiveProject(""));
  $("forkBtn")?.addEventListener("click",()=>forkRun(currentRun));
  $("ttsBtn")?.addEventListener("click",()=>toggleSpeech(currentRun?.final||currentRun?.results?.find(r=>r.ok)?.text||""));
  // Project list is needed for the composer selector; the cost body and
  // gateway status load lazily when the Connections page opens.
  loadProjects();
  maybeRefreshBudget();
}

/* ---------- v5.9.15 Web Push notifications ----------
   Client side of the server endpoints (implemented separately):
   GET  /api/push/vapid-key -> {publicKey} or 503 {setupRequired:true}
   POST /api/push/subscribe  {subscription:{endpoint,keys}} -> {ok:true}
   POST /api/push/unsubscribe {endpoint} -> {ok:true}
   All authorized via authHeaders(). */
const PUSH_PREF_KEY="ai_bridge_push_enabled";
const INSTALL_CARD_DISMISSED_KEY="ai_bridge_install_card_dismissed";
function isIOSDevice(){return /iPhone|iPad|iPod/.test(navigator.userAgent||"")}
function isStandaloneApp(){return !!navigator.standalone||(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)}
function pushFeatureSupported(){return ("serviceWorker" in navigator)&&("PushManager" in window)}
// On iOS push works only when the app is installed on the Home Screen.
function pushUnsupportedReason(){return pushFeatureSupported()&&!(isIOSDevice()&&!isStandaloneApp())?null:"pushUnsupported"}
function pushEnabled(){return lsGet(PUSH_PREF_KEY,"0")==="1"}
function urlBase64ToUint8Array(base64){
  const padding="=".repeat((4-(base64.length%4))%4);
  const raw=atob(base64.replace(/-/g,"+").replace(/_/g,"/")+padding);
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}
async function getPushSubscription(){
  try{
    const reg=await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  }catch(e){return null}
}
function setPushUI(state,messageKey,messageVars){
  const toggle=$("pushToggle"),pill=$("pushPill"),status=$("pushStatus");
  if(pill)pill.textContent=state==="on"?t("pushOn"):t("pushOff");
  if(toggle&&document.activeElement!==toggle)toggle.checked=state==="on";
  if(status){
    status.className="mcpStatusText"+(state==="on"?" good":state==="error"?" bad":"");
    status.textContent=messageKey?t(messageKey,messageVars):"";
  }
}
async function enablePush(){
  const toggle=$("pushToggle");if(toggle)toggle.disabled=true;
  setPushUI("off","pushChecking");
  try{
    const reason=pushUnsupportedReason();
    if(reason){setPushUI("error",reason);throw new Error("unsupported")}
    if(Notification.permission==="denied"){setPushUI("error","pushDenied");throw new Error("denied")}
    if(Notification.permission!=="granted"){
      const perm=await Notification.requestPermission();
      if(perm!=="granted"){setPushUI("error","pushDenied");throw new Error("denied")}
    }
    const reg=await navigator.serviceWorker.ready;
    const vr=await fetch("/api/push/vapid-key",{headers:authHeaders(),cache:"no-store"});
    if(vr.status===503){
      let j={};try{j=await vr.json()}catch(e){}
      if(j.setupRequired){setPushUI("error","pushSetupRequired");throw new Error("setupRequired")}
    }
    if(!vr.ok)throw new Error(`vapid-key HTTP ${vr.status}`);
    const {publicKey}=await vr.json().catch(()=>({}));
    if(!publicKey)throw new Error("no public key");
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
    const sj=sub.toJSON();
    const sr=await fetch("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},cache:"no-store",body:JSON.stringify({subscription:{endpoint:sj.endpoint,keys:sj.keys},lang:(I18N&&I18N.getLanguage&&I18N.getLanguage())||"uk"})});
    if(!sr.ok)throw new Error(`subscribe HTTP ${sr.status}`);
    const pj=await sr.json().catch(()=>({}));
    if(pj.ok===false)throw new Error(pj.error||"subscribe rejected");
    lsSet(PUSH_PREF_KEY,"1");
    setPushUI("on","pushEnabled");
    toast(t("pushEnabled"),"good");
  }catch(e){
    recordDiag("push",e?.message||e,"enablePush");
    if(toggle)toggle.checked=false;
    const st=$("pushStatus");
    if(st&&!st.textContent)setPushUI("error","pushError");
    toast(t("pushError"),"bad");
  }finally{if(toggle)toggle.disabled=false}
}
async function disablePush(){
  try{
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    const endpoint=sub?sub.endpoint:null;
    if(sub)await sub.unsubscribe().catch(()=>{});
    if(endpoint)await fetch("/api/push/unsubscribe",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},cache:"no-store",body:JSON.stringify({endpoint})}).catch(()=>{});
  }catch(e){recordDiag("push",e?.message||e,"disablePush")}
  try{localStorage.removeItem(PUSH_PREF_KEY)}catch(e){}
  setPushUI("off","pushDisabled");
}
function refreshPushStatus(){
  const toggle=$("pushToggle");if(!toggle)return;
  const reason=pushUnsupportedReason();
  if(reason){toggle.disabled=true;toggle.checked=false;setPushUI("error",reason);return}
  toggle.disabled=false;
  if(Notification.permission==="denied"){toggle.checked=false;setPushUI("error","pushDenied");return}
  if(pushEnabled())setPushUI("on","pushEnabled");
  else setPushUI("off");
}
function initPushUI(){
  const toggle=$("pushToggle");if(!toggle)return;
  refreshPushStatus();
  // Reconcile the saved preference with the real subscription (another
  // device or browser cleanup may have removed it).
  if(pushEnabled()){
    getPushSubscription().then(sub=>{
      if(!sub||Notification.permission!=="granted"){
        try{localStorage.removeItem(PUSH_PREF_KEY)}catch(e){}
        refreshPushStatus();
      }
    });
  }
  toggle.addEventListener("change",()=>{if(toggle.checked)enablePush();else disablePush()});
}
// One-line hint after a task starts successfully: with push on, the user can
// close the app and will be notified when the task is ready.
async function maybeShowPushHint(){
  const el=$("pushHint");if(!el)return;
  el.classList.add("hidden");
  if(!pushEnabled())return;
  try{if(await getPushSubscription())el.classList.remove("hidden")}catch(e){}
}
/* ---------- v5.9.15 "Install on iPhone" card ---------- */
function maybeShowInstallCard(){
  const card=$("installCard");if(!card)return;
  if(lsGet(INSTALL_CARD_DISMISSED_KEY,"0")==="1")return;
  if(!(isIOSDevice()&&!isStandaloneApp()))return;
  card.classList.remove("hidden");
  $("installCardClose")?.addEventListener("click",()=>{
    lsSet(INSTALL_CARD_DISMISSED_KEY,"1");
    card.classList.add("hidden");
  },{once:true});
}

const GOD_MODE_BOOT_KEY="ai_bridge_god_mode_boot_v560";
const sm=localStorage.getItem("ai_bridge_mode");
if(!localStorage.getItem(GOD_MODE_BOOT_KEY)){
  $("teamMode").value="god";
  localStorage.setItem("ai_bridge_mode","god");
  localStorage.setItem(GOD_MODE_BOOT_KEY,"1");
}else if(sm)$("teamMode").value=sm;
const ss=localStorage.getItem("ai_bridge_synth");if(ss!==null)$("synthesize").checked=ss==="1";
const sj=localStorage.getItem("ai_bridge_judge");if(sj)$("judgeProvider").value=sj;
const sf=localStorage.getItem("ai_bridge_search_first");if(sf!==null&&$("searchFirst"))$("searchFirst").checked=sf==="1";
studioMode=localStorage.getItem("ai_bridge_studio_mode")||"photo-edit";setStudioMode(studioMode);
loadAgentThread();
$("accessToken").value="";
updateModeUI();renderFiles();renderImageAttachments();renderAgentThread();renderAgentProviderOptions();setAgentBusy(false,t("agentStatusReady"));renderHistory();updateMcpUrl();refreshStatus();
/* 2026-10-01: «Тиша» — поле вводу сховане, поки не тапнути орб. */
(function(){
  const orb=$("chatOrbWrap"),comp=$("chatComposer");
  if(orb){
    orb.addEventListener("click",openComposer);
    orb.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openComposer()}});
  }
  // Чистий старт: діалог порожній (видно орб) — композер схований.
  if(comp&&!$("starterWrap")?.classList.contains("hidden"))comp.classList.add("hidden");
})();
/* 2026-10-01 v5.11.13: Web Share Target + App Shortcuts.
   Чисті парсери (покриті тестами run_v51113_share_tests.mjs). */
/* v5.11.29: File Handling API (ідея scout, Project Fugu) — відкрити .md/.txt у Bridge.
   manifest.webmanifest реєструє застосунок як обробника; самі файли приходять через
   window.launchQueue (запущений URL має прапор ?openfile=1). Довгі файли йдуть тим
   самим шляхом, що й довгі вставки (чип-вкладення), короткі — сирим текстом у поле. */
const FILE_HANDLER_MAX_CHARS=120000;
function pasteStoreAddNamed(text,name){
  const en=pasteStoreAdd(text);
  const st=pasteStoreLoad();
  const cur=st.get(en.id);
  if(cur)cur.name=String(name||cur.name);
  pasteStoreSave();
  return {...en,name:cur?cur.name:en.name};
}
function openLaunchedFile(file){
  if(!file||typeof file.text!=="function")return;
  const name=file.name||t("pasteNameFallback");
  file.text().then(text=>{
    text=String(text||"");
    if(text.length>FILE_HANDLER_MAX_CHARS)text=text.slice(0,FILE_HANDLER_MAX_CHARS)+"\n…";
    newTask();
    const p=$("prompt");
    if(p){
      if(text.length>PASTE_ATTACH_CHARS){const en=pasteStoreAddNamed(text,name);sweepPasteStore();p.value=pasteMarkerLine(en)+"\n"+(p.value||"")}
      else p.value=(p.value?p.value+"\n\n":"")+"["+name+"]\n"+text;
      autoGrowTextarea(p);
    }
    openComposer();
    toast(t("fileHandlerOpened",{name:name}));
    cleanLaunchQuery();
  }).catch(()=>{toast(t("fileHandlerFailed"),"bad")});
}
(function(){
  // Файл відкрили «в Bridge» (тап по .md/.txt на телефоні).
  let wantOpen=false;
  try{wantOpen=new URLSearchParams(location.search||"").has("openfile")}catch(e){}
  if(!wantOpen)return;
  const lq=(typeof window!=="undefined")?window.launchQueue:null;
  if(lq&&typeof lq.setConsumer==="function"){
    lq.setConsumer(params=>{
      const files=params&&params.files;
      if(!files||!files.length){cleanLaunchQuery();return}
      try{files[0].getFile().then(f=>openLaunchedFile(f)).catch(()=>{toast(t("fileHandlerFailed"),"bad");cleanLaunchQuery()})}
      catch(e){toast(t("fileHandlerFailed"),"bad");cleanLaunchQuery()}
    });
  }else cleanLaunchQuery();
})();

function parseShareParams(search){
  try{
    const q=new URLSearchParams(search||"");
    const title=(q.get("title")||"").trim(),text=(q.get("text")||"").trim(),url=(q.get("url")||"").trim();
    if(!title&&!text&&!url)return null;
    return {title,text,url};
  }catch(e){return null}
}
function composeShareText(s){
  return [s.title,s.text,s.url].filter(Boolean).join("\n");
}
function parseShortcut(search){
  try{
    const v=(new URLSearchParams(search||"").get("shortcut")||"").trim();
    return v==="new"||v==="team"||v==="ask"?v:null;
  }catch(e){return null}
}
function cleanLaunchQuery(){
  try{history.replaceState(null,"",location.pathname+location.hash)}catch(e){}
}
(function(){
  // Прийом «Поділитися» з інших застосунків: текст/посилання → поле вводу.
  const sh=parseShareParams(location.search);
  if(sh){
    newTask();
    const p=$("prompt");
    if(p){p.value=composeShareText(sh);autoGrowTextarea(p)}
    openComposer();
    toast(t("shareReceived"));
    cleanLaunchQuery();
    return;
  }
  // App Shortcuts з довгого тапу на іконці PWA.
  const sc=parseShortcut(location.search);
  if(sc){
    cleanLaunchQuery();
    if(sc==="new")newTask();
    else if(sc==="team")showPage("team");
    else if(sc==="ask"){showPage("chat");openComposer()}
  }
})();
applyTheme(currentTheme());

/* v5.11.45: URL protocol handler «web+ai-bridge://» (ідея scout, Project Fugu).
   manifest.webmanifest реєструє схему web+ai-bridge; браузер передає повне
   посилання у ?proto=. Підтримуються:
     web+ai-bridge://chat?q=... — новий діалог із текстом у полі вводу
     web+ai-bridge://team        — відкрити сторінку команди
   Текст лише підставляється у поле (без авто-відправки) — Сергій контролює. */
function parseProtoLink(search){
  try{
    const q=new URLSearchParams(search||"");
    const raw=(q.get("proto")||"").trim();
    if(!raw)return null;
    const u=new URL(raw);
    if(u.protocol!=="web+ai-bridge:")return null;
    const host=(u.hostname||"").toLowerCase();
    const text=(u.searchParams.get("q")||"").trim();
    if(host==="team")return {action:"team",text};
    if(host==="chat"||host==="new"||host==="")return {action:"chat",text};
    return null;
  }catch(e){return null}
}
(function(){
  // Відкриття посилання web+ai-bridge:// у встановленому PWA.
  const p=parseProtoLink(location.search);
  if(!p)return;
  cleanLaunchQuery();
  if(p.action==="team"){showPage("team");return}
  newTask();
  if(p.text){const el=$("prompt");if(el){el.value=p.text;autoGrowTextarea(el)}}
  openComposer();
  toast(t("protoOpened"));
})();

/* =====================================================================
 * AI Bridge v5.10.0 — frontend module (mobile-first PWA)
 * Haptics, skeletons, empty states, mode badges, offline queue,
 * attachment chips, Deep Research, schedules, KB, vision, export.
 * ===================================================================== */

/* ---------- tiny helpers ---------- */
function haptic(ms){try{if(navigator.vibrate)navigator.vibrate(ms||10)}catch(e){}}
/* v5.11.43: дискретні статус-оголошення для екранного читця — окремий
   polite-регіон #a11yStatus; текст відповіді не авто-оголошується, лише
   переходи станів. Очищення + rAF гарантує повторне оголошення. */
function announceStatus(key,params){const el=document.getElementById("a11yStatus");if(!el)return;let msg="";try{msg=t(key,params||{})}catch(e){}if(!msg||msg===key)return;el.textContent="";requestAnimationFrame(()=>{if(el.isConnected)el.textContent=msg})}
/* v5.11.43: сигнал завершення завдання — голосове оголошення + тактильний
   відгук; у фоні (вкладка неактивна) — одна коротка вібрація. */
/* v5.11.91: відкрити діалог з історії за uid (для тоста «Відповідь готова»). */
async function openHistoryRunByUid(uid){
  const all=await getRuns(200);const r=all.find(x=>String(x.uid)===String(uid));if(!r)return;
  currentRun=r;resetConvId();const p=$("prompt");if(p)p.value=r.prompt||"";
  showPage("chat",{keepScroll:true});renderAnswer(r);renderHistory();
}
function notifyRunDone(run){
  const failed=!!(run&&run.meta&&run.meta.error);
  announceStatus(failed?"statusFailed":"statusReady");
  if(document.hidden){try{if(navigator.vibrate)navigator.vibrate([25,60,25])}catch(e){}}
  else haptic(12);
  // v5.11.91: in-app тост «Відповідь готова» — діалог завершився, поки Сергій
  // дивився інший (той же випадок, що й «непрочитане» в saveRun). Прихований
  // застосунок покриває push, тимчасовий діалог і помилки — ні.
  if(!failed&&run&&run.uid&&run.uid!==viewedRunUid&&!document.hidden&&!run.meta?.temporary){
    try{toastAction(t("ansReadyToast",{title:String(run.title||run.prompt||"").slice(0,60)}),t("ansReadyOpen"),()=>openHistoryRunByUid(run.uid))}catch(e){}
  }
}
function prefersReducedMotion(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}}
function springComposer(){
  const c=document.querySelector(".composer");if(!c||prefersReducedMotion())return;
  c.classList.remove("sentSpring");void c.offsetWidth;c.classList.add("sentSpring");
  c.addEventListener("animationend",()=>c.classList.remove("sentSpring"),{once:true});
}
function autoGrowTextarea(el){
  if(!el)return;
  if(!el.value){el.style.height="";return} /* D2 («Тиша»): порожнє поле — компактна висота з CSS, без виміру плейсхолдера */
  el.style.height="auto";
  el.style.height=Math.min(el.scrollHeight,Math.round(innerHeight*0.38))+"px";
}

/* ---------- skeletons ---------- */
function skelHTML(kind,n){
  n=n||3;
  if(kind==="cards")return `<div class="skelGrid">`+Array.from({length:n},()=>`<div class="skelCard"><div class="skel" style="width:45%;height:12px"></div><div class="skel" style="width:70%;height:22px;margin-top:8px"></div><div class="skel" style="width:90%;height:10px;margin-top:8px"></div></div>`).join("")+`</div>`;
  return Array.from({length:n},(_,i)=>`<div class="skel" style="width:${[92,78,85,70][i%4]}%;height:14px;margin:8px 0"></div>`).join("");
}
function showSkel(host,kind,n){if(host)host.innerHTML=skelHTML(kind,n)}

/* ---------- empty states + error cards ---------- */
const emptyActions={},errActions={};
function emptyState(emoji,text,btnText,onClick){
  const id="ea"+Math.random().toString(36).slice(2);
  if(btnText&&onClick)emptyActions[id]=onClick;
  return `<div class="emptyState"><span class="emptyEmoji" aria-hidden="true">${emoji}</span><p>${esc(text)}</p>${btnText?`<button type="button" class="emptyBtn" data-empty-btn="${id}">${esc(btnText)}</button>`:""}</div>`;
}
function errCard(text,retryFn){
  const id="er"+Math.random().toString(36).slice(2);
  if(retryFn)errActions[id]=retryFn;
  return `<div class="errCard"><span class="errEmoji" aria-hidden="true">😔</span><p>${esc(text)}</p>${retryFn?`<button type="button" class="emptyBtn" data-err-btn="${id}">🔁 ${esc(t("retryBtn"))}</button>`:""}</div>`;
}

/* ---------- mode badges ---------- */
const MODE_BADGE_CLASS={auto:"m-auto",askall:"m-team",team:"m-team",code:"m-code",debate:"m-debate",single:"m-single",agent:"m-agent",god:"m-god",research:"m-research",vision:"m-vision"};
const MODE_BADGE_LABEL={auto:"⚡ Auto",askall:"◉ Team",team:"◉ Team",code:"⌘ Code",debate:"⚖ Debate",single:"① Single",agent:"✦ Agent",god:"◆ God",research:"🔬 Дослідження",vision:"🔍 Vision","deep-scan":"🔍 Deep Scan"};
function modeBadgeClass(m){return MODE_BADGE_CLASS[String(m||"auto").toLowerCase()]||"m-single"}
function modeBadgeLabel(m){const k=String(m||"auto").toLowerCase();return MODE_BADGE_LABEL[k]||k}
function renderModeBadge(run){
  const el=$("modeBadge");if(!el)return;
  const m=String(run?.meta?.mode||run?.mode||"auto").toLowerCase();
  el.className="modeBadge "+modeBadgeClass(m);
  el.textContent=modeBadgeLabel(m);
  el.classList.remove("hidden");
}

/* v5.11.64: бейдж ролі автора відповіді. Роль фіксується на момент відправки
   (sendTask → run.roleName), тап по бейджу відкриває вибір ролі для
   НАСТУПНОЇ відповіді — поточну не чіпає. Без ролі — бейдж приховано. */
function renderRoleBadge(run){
  const el=$("roleBadge");if(!el)return;
  const name=String(run?.roleName||"");
  if(!name){el.classList.add("hidden");el.onclick=null;el.onkeydown=null;return}
  el.textContent="👤 "+name;
  el.title=t("roleBadgeTitle");el.setAttribute("aria-label",t("roleBadgeAria"));
  el.classList.remove("hidden");
  el.onclick=()=>openSheet("roleSheet");
  el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openSheet("roleSheet")}};
}

/* v5.11.64: жива швидкість генерації. Сервер не шле токени по ходу стріму,
   тож під час очікування — живий лічильник секунд; фінал — «~ток/с · токени
   · час» для першого вдалого результату. Токени — ОЦІНКА (≈ символи/4),
   позначена «~» і підказкою, чесно за правилом Сергія. */
function estTokens(text){const n=String(text||"").length;return n>0?Math.max(1,Math.round(n/4)):0}
function providerSpeed(r){
  if(!r||!r.ok)return null;
  const toks=estTokens(r.text),ms=Number(r.ms);
  if(!(toks>0)||!(ms>0))return null;
  return {toks,ms,rate:Math.round(toks/(ms/1000)*10)/10};
}
function speedFinalText(sp){const sec=(Math.round(sp.ms/100)/10).toString().replace(".",",");return t("speedRow",{rate:fmtInt(sp.rate),toks:fmtInt(sp.toks),sec})}
let speedLiveTimer=null;
function stopSpeedLive(){if(speedLiveTimer){clearInterval(speedLiveTimer);speedLiveTimer=null}}
function startSpeedLive(){
  stopSpeedLive();
  const el=$("speedRow");if(!el)return;
  el.removeAttribute("title");el.classList.remove("hidden");
  const start=Date.now();
  const tick=()=>{el.textContent=t("speedLive",{s:Math.floor((Date.now()-start)/1000)})};
  tick();speedLiveTimer=setInterval(tick,1000);
}
/* v5.11.80: живі мітки міркувань (ідея scout, патерн LibreChat reasoningLabel).
   Під час генерації, коли сервер не дає конкретної фази, клієнт показує
   короткі «дихаючі» мітки українською замість статичного тексту — маппінг
   лише на клієнті, без додаткових викликів моделей. Мітки не пишуться
   в журнал активності (вони індикатор, а не подія). */
const THINK_LABEL_KEYS=["thinkLabel0","thinkLabel1","thinkLabel2","thinkLabel3","thinkLabel4","thinkLabel5"];
/* Чиста (для тестів): ключ мітки за індексом — ротація по колу. */
function thinkLabelKey(i){return THINK_LABEL_KEYS[((Number(i)||0)%THINK_LABEL_KEYS.length+THINK_LABEL_KEYS.length)%THINK_LABEL_KEYS.length]}
let thinkLabelTimer=null,thinkLabelIdx=0,thinkLabelsOn=false;
function startThinkLabels(){
  const el=$("progressText");if(!el)return;
  thinkLabelsOn=true;
  if(thinkLabelTimer)return;
  thinkLabelIdx=0;
  const tick=()=>{try{el.textContent=t(thinkLabelKey(thinkLabelIdx))}catch(e){};thinkLabelIdx++};
  tick();thinkLabelTimer=setInterval(tick,3800);
}
function stopThinkLabels(){thinkLabelsOn=false;if(thinkLabelTimer){clearInterval(thinkLabelTimer);thinkLabelTimer=null}}
function renderSpeedRow(run){
  stopSpeedLive();
  const el=$("speedRow");if(!el)return;
  const best=(run?.results||[]).find(r=>r.ok&&r.text&&Number(r.ms)>0);
  const sp=best?providerSpeed(best):null;
  if(!sp){el.classList.add("hidden");el.textContent="";el.removeAttribute("title");return}
  el.textContent=speedFinalText(sp);el.title=t("speedTitle");
  el.classList.remove("hidden");
}

/* ---------- confirm bottom sheet ---------- */
let confirmResolve=null;
function confirmSheetUI(text){
  return new Promise(res=>{const el=$("confirmSheetText");if(el)el.textContent=text;confirmResolve=res;openSheet("confirmSheet")});
}
function wireConfirmSheet(){
  const done=v=>{closeSheet("confirmSheet");const r=confirmResolve;confirmResolve=null;if(r)r(v)};
  /* v5.11.88: null-check — self-diagnostic з iPhone зафіксував
     TypeError: null is not an object (evaluating '$("confirmSheetOk").onclick=...'). */
  const okBtn=$("confirmSheetOk");if(okBtn)okBtn.onclick=()=>done(true);
  document.querySelectorAll("[data-confirm-cancel]").forEach(b=>b.onclick=()=>done(false));
}

/* ---------- offline queue ---------- */
const OFFLINE_QUEUE_KEY="ai_bridge_offline_queue_v1";
function getOfflineQueue(){try{return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY)||"[]")}catch(e){return[]}}
function setOfflineQueue(q){try{localStorage.setItem(OFFLINE_QUEUE_KEY,JSON.stringify(q))}catch(e){toast(t("offlineQueueFull"),"bad")}}
function queueOfflineMessage(source,prompt,images){
  const q=getOfflineQueue();
  q.push({source,prompt,images:(images||[]).map(a=>({name:a.name,mime:a.mime,data:a.data})),createdAt:Date.now()});
  try{localStorage.setItem(OFFLINE_QUEUE_KEY,JSON.stringify(q))}catch(e){
    q[q.length-1].images=[]; // attachments dropped — localStorage full
    try{localStorage.setItem(OFFLINE_QUEUE_KEY,JSON.stringify(q))}catch(_){}
    toast(t("offlineQueueFull"),"bad");
  }
  updateOfflineBar();
  toast(t("offlineQueued"),"warn");
}
function updateOfflineBar(){
  const bar=$("offlineBar"),cnt=$("offlineQueueCount");if(!bar)return;
  const n=getOfflineQueue().length;
  bar.classList.toggle("hidden",navigator.onLine);
  if(cnt){cnt.textContent=n?String(n):"";cnt.classList.toggle("hidden",!n)}
}
async function flushOfflineQueue(){
  updateOfflineBar();
  const q=getOfflineQueue();if(!q.length)return;
  try{localStorage.removeItem(OFFLINE_QUEUE_KEY)}catch(e){}
  toast(t("offlineFlushed",{n:q.length}),"ok");
  for(const item of q){
    try{
      if(item.source==="chat"){imageAttachments=item.images||[];renderImageAttachments();await sendTask({source:"chat",promptText:item.prompt,fromQueue:true})}
      else await sendTask({source:item.source,promptText:item.prompt,fromQueue:true});
    }catch(e){/* next in queue */}
  }
}

/* ---------- attachment chips (#url, ZIP/files, images) ---------- */
function renderAttachChips(){
  const host=$("attachChips");if(!host)return;
  const chips=[];
  imageAttachments.forEach((a,i)=>chips.push({kind:"img",idx:i,label:a.name||"photo",thumb:`data:${a.mime};base64,${a.data}`}));
  attachments.forEach((a,i)=>chips.push({kind:"file",idx:i,label:(a.kind==="zip"?"📦 ":"📄 ")+(a.name||"file")}));
  const pv=$("prompt")?.value||"";
  const urlRe=/(#url\s+https?:\/\/\S+|https?:\/\/[^\s<>"']+)/g;
  let m,urls=[];
  while((m=urlRe.exec(pv))!==null&&urls.length<5)urls.push(m[1]||m[0]);
  urls.forEach((u,i)=>chips.push({kind:"url",idx:i,label:u.length>30?u.slice(0,30)+"…":u}));
  // v5.11.68: @@згадка минулого чату — прикріплений контекст (✕ відкріплює).
  if(ctxMentionAttached)chips.push({kind:"ctxchat",idx:0,label:"💬 "+String(ctxMentionAttached.title||"").slice(0,40)});
  host.innerHTML=chips.map(c=>`<span class="attachChip">${c.thumb?`<img src="${esc(c.thumb)}" alt="">`:""}<span class="attachName">${esc(c.label)}</span><button type="button" data-achip-kind="${c.kind}" data-achip-idx="${c.idx}" aria-label="${esc(t("removeAttachment"))}">×</button></span>`).join("");
  host.querySelectorAll("[data-achip-kind]").forEach(b=>b.onclick=()=>removeAttachChip(b.dataset.achipKind,+b.dataset.achipIdx));
}
function removeAttachChip(kind,idx){
  if(kind==="img"){imageAttachments.splice(idx,1);renderImageAttachments()}
  else if(kind==="ctxchat"){ctxMentionAttached=null} // v5.11.68: відкріпити контекст @@чату
  else if(kind==="file"){attachments.splice(idx,1);renderFiles()}
  else if(kind==="url"){
    const ta=$("prompt");if(!ta)return;
    const re=/(#url\s+https?:\/\/\S+|https?:\/\/[^\s<>"']+)/g;
    let m,i=0,target=null;
    while((m=re.exec(ta.value))!==null){if(i===idx){target=m[1]||m[0];break}i++}
    if(target)ta.value=ta.value.replace(target,"").replace(/\s{2,}/g," ").trim();
    autoGrowTextarea(ta);
  }
  renderAttachChips();
}

/* ---------- mode chips + quick actions ---------- */
function wireModeChips(){
  document.querySelectorAll("[data-modechip]").forEach(c=>c.onclick=()=>{
    $("teamMode").value=c.dataset.modechip;
    try{localStorage.setItem("ai_bridge_mode",c.dataset.modechip)}catch(e){}
    updateModeUI();haptic(8);
    if(c.dataset.modechip==="agent")showPage("agent");
  });
}
/* ---------- v5.11.20: effort toggle (thinking depth) ---------- */
const EFFORT_KEY="ai_bridge_effort_v1";
function getEffort(){try{const v=localStorage.getItem(EFFORT_KEY);return v==="fast"||v==="deep"?v:"standard"}catch(e){return"standard"}}
function renderEffortChips(){const cur=getEffort();document.querySelectorAll("#effortChips .effortChip").forEach(b=>{const on=b.dataset.effort===cur;b.classList.toggle("active",on);b.setAttribute("aria-checked",on?"true":"false")})}
function wireEffortChips(){
  document.querySelectorAll("#effortChips .effortChip").forEach(b=>b.onclick=()=>{try{localStorage.setItem(EFFORT_KEY,b.dataset.effort)}catch(e){}renderEffortChips();haptic(8)});
  renderEffortChips();
}

/* ---------- v5.11.73: розумне поле вводу (intent-aware composer) ----------
   Чисті евристики по тексту чернетки: порівняння → «Дебати», глибокий розбір →
   «Глибоко», стислість → «Швидко», довге доручення → «Агент». Текст нікуди не
   надсилається, аналіз локальний. Чип — проактивна підказка: тап натискає
   СПРАВЖНЮ кнопку режиму/глибини (жодних нових прихованих станів). */
const INTENT_PATTERNS=[
  /* Увага: \b в JS — ASCII-only, після кирилиці не спрацьовує;
     межа слова — (?![\p{L}]) з прапорцем u. */
  {id:"debate",re:/(?:порівняй|що\s+краще|що\s+вибрати|який\s+краще|яку\s+вибрати|проти(?![\p{L}])|\bvs\b|versus|різниц[яею]|різниться|плюси\s+і\s+мінус[иі]|переваги\s+і\s+недоліки|compare|which\s+is\s+better|pros\s+and\s+cons)/iu,minLen:10},
  {id:"agent",re:/(?:зроби|виконай|створи|підготуй|запусти|реалізуй|розроби|проаналізуй|досліди)(?![\p{L}])/iu,minLen:60},
  {id:"deep",re:/(?:детально|докладно|глибоко|глибок[ий]|ретельно|ретельн[ий]|розгорнуто|розгорнут[ий]|аналіз|розбір|покроково|в\s+деталях|in\s+detail|thorough|step[- ]by[- ]step|in[- ]depth)/iu,minLen:10},
  {id:"fast",re:/(?:коротко|стисло|швидко|в\s+двох\s+словах|одним\s+реченням|коротка\s+відповідь|briefly|short|tldr|tl;dr|one[- ]?liner)/iu,minLen:10}
];
function detectComposerIntents(text){
  const s=String(text||""),out=[];
  for(const p of INTENT_PATTERNS){if(s.length>=p.minLen&&p.re.test(s)&&!out.includes(p.id))out.push(p.id)}
  /* «коротко» сильніше за «детально» — явна вказівка на стислість перемагає */
  if(out.includes("fast")&&out.includes("deep"))out.splice(out.indexOf("deep"),1);
  return out.slice(0,3);
}
function intentNameKey(id){return id==="debate"?"intentDebate":id==="deep"?"intentDeep":id==="fast"?"intentFast":"intentAgent"}
function intentIcon(id){return id==="debate"?"⚖":id==="deep"?"🧠":id==="fast"?"⚡":"✦"}
function applyComposerIntent(id){
  const q=id==="debate"?"debate":id==="agent"?"agent":null;
  if(q){const b=document.querySelector(`[data-modechip="${q}"]`);if(b){b.click();return true}}
  if(id==="deep"||id==="fast"){const b=document.querySelector(`#effortChips [data-effort="${id}"]`);if(b){b.click();return true}}
  return false;
}
let intentLastSig="",intentDismissedSig="";
function intentSig(text){const s=String(text||"");return s.length+":"+s.slice(0,64)}
function refreshIntentChips(){
  const ta=$("prompt"),host=$("intentChips");if(!ta||!host)return;
  const text=ta.value||"",sig=intentSig(text);
  const intents=detectComposerIntents(text);
  if(!intents.length||sig===intentDismissedSig){host.classList.add("hidden");host.innerHTML="";return}
  if(sig===intentLastSig&&host.children.length)return;
  intentLastSig=sig;
  host.innerHTML=`<span class="intentLabel" aria-hidden="true">🧭</span>`+
    intents.map(id=>`<button type="button" class="intentChip" data-intent="${id}"><span aria-hidden="true">${intentIcon(id)}</span> ${esc(t(intentNameKey(id)))}</button>`).join("")+
    `<button type="button" class="intentX" aria-label="${esc(t("intentDismiss"))}" title="${esc(t("intentDismiss"))}">✕</button>`;
  host.classList.remove("hidden");
  host.querySelectorAll("[data-intent]").forEach(b=>b.onclick=()=>{
    if(applyComposerIntent(b.dataset.intent)){
      toast(t("intentApplied",{name:t(intentNameKey(b.dataset.intent))}));
      intentDismissedSig=intentSig($("prompt")?.value||"");
      host.classList.add("hidden");host.innerHTML="";haptic(8);
    }
  });
  const x=host.querySelector(".intentX");if(x)x.onclick=()=>{intentDismissedSig=intentSig($("prompt")?.value||"");host.classList.add("hidden");host.innerHTML=""};
}
let intentDebounce=null;
function wireIntentChips(){
  const ta=$("prompt");if(!ta)return;
  ta.addEventListener("input",()=>{clearTimeout(intentDebounce);intentDebounce=setTimeout(refreshIntentChips,400)});
}

/* ---------- v5.11.73: «Запропонувати ідею» з «Що нового» ----------
   Форма шле ідею в /api/idea (сесійна авторизація); сервер кладе її в KV
   idea:v1, tools/pull-ideas.py забирає у скриньку розвідника з міткою «Сергій». */
function wireIdeaSheet(){
  const open=()=>{openSheet("ideaSheet")};
  $("suggestIdeaBtn")?.addEventListener("click",()=>{open();haptic(8)});
  $("ideaSendBtn")?.addEventListener("click",submitIdea);
}
async function submitIdea(){
  const title=($("ideaTitle")?.value||"").trim(),desc=($("ideaDesc")?.value||"").trim();
  if(!title){toast(t("ideaNeedTitle"));return}
  const btn=$("ideaSendBtn");if(btn)btn.disabled=true;
  try{
    const lang=(I18N&&I18N.getLanguage&&I18N.getLanguage())||"uk";
    const r=await fetch("/api/idea",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},credentials:"same-origin",cache:"no-store",body:JSON.stringify({title:title.slice(0,80),desc:desc.slice(0,500),lang})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
    toast(t("ideaSent"));
    if($("ideaTitle"))$("ideaTitle").value="";if($("ideaDesc"))$("ideaDesc").value="";
    closeSheet("ideaSheet");
  }catch(e){toast(t("ideaFail"))}
  finally{if(btn)btn.disabled=false}
}

/* ---------- v5.11.20: secret-like paste guard (detection is local-only; the
   text is never sent anywhere by this guard) ---------- */
const SECRET_PATTERNS=[
  /sk-(?:live|test|proj)?-?[A-Za-z0-9]{16,}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bxox[abpras]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|passwd|auth)\b\s*[:=]\s*["']?[A-Za-z0-9_\-.~+\/=]{20,}["']?/i,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/i,
  /(?=[A-Za-z0-9_\-~+\/=]*[0-9])(?=[A-Za-z0-9_\-~+\/=]*[A-Za-z])[A-Za-z0-9_\-~+\/=]{40,}/
];
function findSecretLike(text){const s=String(text||"");for(const re of SECRET_PATTERNS){re.lastIndex=0;if(re.test(s))return true}return false}
let secretGuardConfirmed="";
function hideSecretGuard(){document.querySelectorAll(".secretGuardBar").forEach(b=>b.remove())}
function showSecretGuard(promptEl,pendingSend){
  if(!promptEl||!promptEl.parentElement)return;
  hideSecretGuard();
  const bar=document.createElement("div");
  bar.className="secretGuardBar";bar.setAttribute("role","alert");
  const mk=(cls,txt)=>{const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=txt;return b};
  const icon=document.createElement("span");icon.className="sgIcon";icon.setAttribute("aria-hidden","true");icon.textContent="🔑";
  const msg=document.createElement("span");msg.className="sgText";msg.textContent=t("secretGuardText");
  const sendB=mk("tinyBtn sgSend",t("secretGuardSend")),clearB=mk("tinyBtn",t("secretGuardClear")),disB=mk("tinyBtn sgDismiss","✕");
  disB.setAttribute("aria-label",t("secretGuardDismiss"));
  bar.append(icon,msg,sendB,clearB,disB);
  promptEl.parentElement.insertBefore(bar,promptEl);
  sendB.onclick=()=>{secretGuardConfirmed=promptEl.value;hideSecretGuard();haptic(8);
    if(pendingSend&&pendingSend.retryAgent)runAgentPage();else if(pendingSend)sendTask(pendingSend)};
  clearB.onclick=()=>{promptEl.value="";secretGuardConfirmed="";hideSecretGuard();autoGrowTextarea(promptEl);saveComposerDrafts();promptEl.focus()};
  disB.onclick=()=>hideSecretGuard();
  try{bar.scrollIntoView({block:"nearest"})}catch(e){}
}
function guardSecretsBeforeSend(source,prompt,options){
  const promptEl=source==="files"?$("filePrompt"):$("prompt");
  const raw=String(promptEl?.value??prompt); // raw (untrimmed) — matches what the confirm click stores, so the round-trip cannot loop
  if(findSecretLike(raw)&&secretGuardConfirmed!==raw){showSecretGuard(promptEl,{...(options||{}),source});return false}
  return true;
}

function wireQuickActions(){
  document.querySelectorAll("[data-quickaction]").forEach(b=>b.onclick=()=>{
    haptic(8);
    const a=b.dataset.quickaction;
    if(a==="research"){$("teamMode").value="research";try{localStorage.setItem("ai_bridge_mode","research")}catch(e){}updateModeUI();showPage("chat");$("prompt")?.focus()}
    else if(a==="generate"){showPage("studio");setStudioMode("photo-generate")}
    else if(a==="schedules"){openSheet("schedSheet");loadSchedules()}
    else if(a==="export"){const eb=$("exportChatBtn");if(eb)eb.click()}
    else if(a==="url"){const ta=$("prompt");if(ta){if(!ta.value.includes("#url"))ta.value=(ta.value?ta.value+" ":"")+"#url ";showPage("chat");ta.focus();autoGrowTextarea(ta);renderAttachChips()}}
  });
}

/* ---------- Deep Research ---------- */
async function runResearch(query){
  const depth=$("researchDepth")?.value||"standard";
  $("chatEmpty")?.classList.add("hidden");
  const ans=$("answerArea");ans.classList.remove("hidden");
  const html=$("answerHtml");
  html.innerHTML=`
    <div class="researchCard">
      <div class="researchHead"><b>🔬 ${esc(t("researchTitle"))}</b><span class="smallMuted">${esc(query.slice(0,140))}</span></div>
      <div class="researchPlan" id="researchPlan">${skelHTML("rows",3)}</div>
      <div class="researchSteps" id="researchSteps"></div>
      <div class="researchSources" id="researchSources"></div>
      <div class="researchAnswer md" id="researchAnswer"></div>
    </div>`;
  $("progressTitle").textContent=t("researchRunning");
  $("runProgress").classList.remove("hidden");
  try{
    const r=await fetch("/api/research",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,depth})});
    const j=await r.json();
    if(!j.ok)throw new Error(j.error||"research failed");
    const plan=Array.isArray(j.plan)?j.plan:(Array.isArray(j.steps)?j.steps:[]);
    const sources=Array.isArray(j.sources)?j.sources:[];
    const answer=j.answer||j.final||"";
    const planEl=$("researchPlan"),stepsEl=$("researchSteps"),srcEl=$("researchSources"),ansEl=$("researchAnswer");
    if(planEl)planEl.innerHTML=plan.length
      ?`<div class="planTitle">${esc(t("researchPlan"))}</div>`+plan.map((s,i)=>`<div class="researchStep done"><span class="stepDot">✓</span><span>${esc(stepTitle(s,i))}</span></div>`).join("")
      :`<div class="planTitle">${esc(t("researchPlan"))}</div><p class="smallMuted">${esc(t("researchNoPlan"))}</p>`;
    if(ansEl&&answer){
      renderRich(ansEl,answer);
      linkifyCitations(ansEl,sources);
    }
    if(srcEl&&sources.length){
      srcEl.innerHTML=`<div class="planTitle">${esc(t("researchSources"))}</div><div class="srcChips">`+sources.map((s,i)=>`<button type="button" class="srcChip" data-src-idx="${i}"><span class="srcNum">${i+1}</span><span class="srcTitle">${esc(s.title||s.url||("—"))}</span></button>`).join("")+`</div>`;
      srcEl.querySelectorAll("[data-src-idx]").forEach(b=>b.onclick=()=>openSourcePreview(sources[+b.dataset.srcIdx]));
    }
    const run={id:"r"+Date.now(),mode:"research",prompt:query,final:answer,providers:[],created:Date.now(),meta:{mode:"research",sources:sources.length}};
    if(tempChatOn())run.meta.temporary=true; // v5.11.39: інкогніто — saveRun пропустить
    currentRun=run;
    try{await saveRun(run)}catch(e){}
    renderModeBadge(run);
    $("runProgress").classList.add("hidden");notifyRunDone(run); // v5.11.43
  }catch(e){
    $("runProgress").classList.add("hidden");
    html.innerHTML=errCard(t("researchFail"),()=>runResearch(query));
    toast(t("researchFail"),"bad");notifyRunDone({meta:{error:true}}); // v5.11.43
  }
  $("runProgress").classList.add("hidden");
}
function stepTitle(s,i){
  if(typeof s==="string")return s;
  return s.title||s.query||s.text||(t("researchStep")+" "+(i+1));
}
function openSourcePreview(src){
  src=src||{};
  $("srcSheetTitle").textContent=src.title||t("srcTitle");
  $("srcPreview").innerHTML=`${src.snippet||src.description?`<p class="srcSnippet">${esc(src.snippet||src.description)}</p>`:""}<p class="smallMuted" style="word-break:break-all">${esc(src.url||"")}</p>`;
  const openBtn=$("srcOpenBtn");
  if(openBtn){$("srcOpenUrl").textContent=src.url||"";openBtn.onclick=()=>{if(src.url)window.open(src.url,"_blank","noopener")}}
  openSheet("srcSheet");
}
function linkifyCitations(container,sources){
  if(!sources.length||!container)return;
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
  const nodes=[];let n;while((n=walker.nextNode()))nodes.push(n);
  for(const node of nodes){
    const re=/\[(\d{1,2})\]/g;let m,last=0,found=false;
    const frag=document.createDocumentFragment();
    while((m=re.exec(node.nodeValue))!==null){
      const idx=+m[1];if(idx<1||idx>sources.length)continue;
      found=true;
      frag.append(document.createTextNode(node.nodeValue.slice(last,m.index)));
      const b=document.createElement("button");b.type="button";b.className="srcCite";b.textContent=`[${idx}]`;b.dataset.srcIdx=idx-1;
      b.onclick=()=>openSourcePreview(sources[idx-1]);
      frag.append(b);last=m.index+m[0].length;
    }
    if(found){frag.append(document.createTextNode(node.nodeValue.slice(last)));node.parentNode.replaceChild(frag,node)}
  }
}

/* ---------- recurring schedules ---------- */
async function loadSchedules(){
  const host=$("schedList");if(!host)return;
  showSkel(host,"rows",3);
  try{
    const r=await fetch("/api/schedules");
    const j=await r.json();
    const items=Array.isArray(j)?j:(j.schedules||j.items||[]);
    if(!items.length){host.innerHTML=emptyState("⏰",t("schedEmpty"),t("schedNew"),()=>{$("schedNewBox").open=true});return}
    host.innerHTML=items.map(s=>{
      const off=s.enabled===false;
      return `<div class="schedItem${off?" off":""}">
        <div class="schedMain"><b>${esc(s.name||"—")}</b>
        <span class="smallMuted">${esc(s.time||s.cron||"")}${s.tz?` • ${esc(s.tz)}`:""}${s.lastRun?` • ${esc(t("schedLast"))}: ${esc(fmtDate(s.lastRun))}`:""}</span>
        <span class="smallMuted schedPromptLine">${esc((s.prompt||"").slice(0,140))}</span></div>
        <div class="schedBtns">
          <button type="button" class="tinyBtn" data-sched-toggle="${esc(String(s.id))}">${esc(off?t("schedEnable"):t("schedDisable"))}</button>
          <button type="button" class="tinyBtn" data-sched-del="${esc(String(s.id))}">${esc(t("deleteBtn"))}</button>
        </div></div>`;
    }).join("");
    host.querySelectorAll("[data-sched-toggle]").forEach(b=>b.onclick=()=>toggleSchedule(b.dataset.schedToggle));
    host.querySelectorAll("[data-sched-del]").forEach(b=>b.onclick=()=>deleteSchedule(b.dataset.schedDel));
  }catch(e){host.innerHTML=errCard(t("schedFail"),loadSchedules)}
}
async function saveSchedule(){
  const name=$("schedName").value.trim(),time=$("schedTime").value,prompt=$("schedPrompt").value.trim(),tz=$("schedTz").value.trim()||"Europe/Kyiv";
  if(!name)return alert(t("schedNeedName"));
  if(!time)return alert(t("schedNeedTime"));
  if(!prompt)return alert(t("schedNeedPrompt"));
  try{
    const r=await fetch("/api/schedules",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,time,tz,prompt,enabled:true})});
    const j=await r.json();if(!j.ok)throw new Error(j.error||"save failed");
    toast(t("schedSaved"),"ok");
    $("schedNewBox").open=false;$("schedName").value="";$("schedPrompt").value="";
    loadSchedules();
  }catch(e){toast(t("schedFail"),"bad")}
}
async function toggleSchedule(id){
  try{
    const r=await fetch(`/api/schedules/${encodeURIComponent(id)}/toggle`,{method:"POST"});
    const j=await r.json();if(!j.ok)throw new Error(j.error||"toggle failed");
    loadSchedules();
  }catch(e){toast(t("schedFail"),"bad")}
}
async function deleteSchedule(id){
  if(!await confirmSheetUI(t("schedDelConfirm")))return;
  try{
    const r=await fetch(`/api/schedules/${encodeURIComponent(id)}`,{method:"DELETE"});
    const j=await r.json();if(!j.ok)throw new Error(j.error||"delete failed");
    toast(t("schedDeleted"),"ok");
    loadSchedules();
  }catch(e){toast(t("schedFail"),"bad")}
}

/* ---------- project knowledge base (RAG) ---------- */
let kbProjectId=null;
function openKb(projectId){
  kbProjectId=projectId;
  const p=projects.find(x=>String(x.id)===String(projectId));
  $("kbSheetTitle").textContent="📚 "+(p?.name||t("kbTitle"));
  $("kbAnswer").innerHTML="";$("kbQuery").value="";
  openSheet("kbSheet");
  setTimeout(()=>$("kbQuery")?.focus(),350);
}
async function askKb(){
  const q=$("kbQuery").value.trim();if(!q||!kbProjectId)return;
  const host=$("kbAnswer");host.innerHTML=skelHTML("rows",3);
  try{
    const r=await fetch(`/api/projects/${encodeURIComponent(kbProjectId)}/kb/query`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:q})});
    const j=await r.json();if(!j.ok)throw new Error(j.error||"kb failed");
    host.innerHTML=`<div class="kbRes md"></div>`;
    const res=host.firstChild;
    renderRich(res,j.answer||j.text||"");
    const cites=j.citations||j.sources||[];
    if(cites.length)res.insertAdjacentHTML("beforeend",`<div class="srcChips">`+cites.map((c,i)=>`<span class="srcChip static"><span class="srcNum">${i+1}</span><span class="srcTitle">${esc(typeof c==="string"?c:(c.file||c.title||c.path||"—"))}</span></span>`).join("")+`</div>`);
  }catch(e){host.innerHTML=errCard(t("kbFail"),askKb)}
}

/* ---------- vision analyze ---------- */
async function analyzeAttachedImage(){
  const a=imageAttachments[0];
  if(!a){toast(t("visionNeedPhoto"),"warn");return}
  const prompt=($("prompt")?.value||"").trim()||t("visionDefaultPrompt");
  toast(t("visionWorking"),"info");haptic(10);
  try{
    const r=await fetch("/api/vision/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({image:`data:${a.mime};base64,${a.data}`,prompt})});
    const j=await r.json();if(!j.ok)throw new Error(j.error||"vision failed");
    const run={id:"v"+Date.now(),mode:"vision",prompt,final:j.analysis||j.text||"",providers:[j.provider||"vision"],created:Date.now(),meta:{mode:"vision",provider:j.provider}};
    if(tempChatOn())run.meta.temporary=true; // v5.11.39: інкогніто — saveRun пропустить
    currentRun=run;
    try{await saveRun(run)}catch(e){}
    $("chatEmpty")?.classList.add("hidden");
    $("answerArea")?.classList.remove("hidden");
    renderAnswer(run);
    scrollToAnswer();
  }catch(e){toast(t("visionFail"),"bad")}
}

/* ---------- export: Word .doc + PDF via print ---------- */
function dlBlob(blob,name){
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;
  document.body.append(a);a.click();
  setTimeout(()=>{try{URL.revokeObjectURL(a.href)}catch(e){}a.remove()},4000);
}
/* ---------- v5.11.89: «Зберегти як…» — File System Access API (ідея scout) ----------
   showSaveFilePicker — лише за явним перемикачем у листі експорту й лише там,
   де браузер його має (Chromium); скрізь інакше — тихе завантаження dlBlob.
   saveFileSmart — чиста асинхронна логіка вибору шляху для тестів. */
const EXPORT_PLACE_KEY="ai_bridge_export_pick_place";
function exportPickPlaceOn(){try{return localStorage.getItem(EXPORT_PLACE_KEY)==="1"}catch(e){return false}}
async function saveFileSmart(blob,name,mime){
  /* "saved" | "cancelled" | "fallback" — тост показує викликач */
  if(exportPickPlaceOn()&&typeof window.showSaveFilePicker==="function"){
    try{
      const ext=(String(name).split(".").pop()||"bin").toLowerCase();
      const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:"AI Bridge",accept:{[mime||blob.type||"application/octet-stream"]:["."+ext]}}]});
      const w=await handle.createWritable();await w.write(blob);await w.close();
      return "saved";
    }catch(e){return (e&&e.name==="AbortError")?"cancelled":"fallback"}
  }
  return "fallback";
}
async function dlBlobSmart(blob,name,mime){
  const via=await saveFileSmart(blob,name,mime);
  if(via==="cancelled")return false;
  if(via==="fallback")dlBlob(blob,name);
  return true;
}
function paraHtml(s){return esc(String(s||"")).split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("")}
function exportDocx(){
  const run=currentRun;if(!run?.final){toast(t("exportNoRun"),"warn");return}
  const title=String(run.title||run.prompt||"AI Bridge").slice(0,60);
  const body=`<h1>${esc(title)}</h1><p><i>${esc(fmtDate(run.created))} • ${esc(modeBadgeLabel(String(run.meta?.mode||run.mode||"auto")))}</i></p><h2>${esc(t("task"))}</h2>${paraHtml(run.prompt)}<h2>${esc(t("finalAnswer"))}</h2>${paraHtml(run.final)}`;
  const doc=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;
  (async()=>{if(await dlBlobSmart(new Blob(["\ufeff"+doc],{type:"application/msword"}),title+".doc","application/msword"))toast(t("exportDone"),"ok")})();
  closeSheet("exportSheet");
}
function exportPdf(){
  const run=currentRun;if(!run?.final){toast(t("exportNoRun"),"warn");return}
  const title=String(run.title||run.prompt||"AI Bridge").slice(0,60);
  const w=window.open("","_blank");
  if(!w){toast(t("exportPopupBlocked"),"warn");return}
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111;line-height:1.55}h1{font-size:22px}h2{font-size:16px;margin-top:28px;border-top:1px solid #ddd;padding-top:12px}@media print{body{margin:0}}</style></head><body><h1>${esc(title)}</h1><p><i>${esc(fmtDate(run.created))}</i></p><h2>${esc(t("task"))}</h2>${paraHtml(run.prompt)}<h2>${esc(t("finalAnswer"))}</h2>${paraHtml(run.final)}<scr`+`ipt>window.onload=function(){setTimeout(function(){window.print()},400)}<\/scr`+`ipt></body></html>`);
  w.document.close();
  closeSheet("exportSheet");
}

/* ---------- export: dialog (current run) as Markdown / JSON ---------- */
/* v5.11.31: чисті function-декларації для тестів — повертають {name, text}, самі нічого не качають. */
function dialogStamp(){
  const d=new Date(),p=(n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function exportDialogMdText(run,opts){
  opts=opts||{};
  const ver=opts.version||UI_VERSION;
  const dateStr=opts.dateStr||new Date(run.created||Date.now()).toLocaleString(I18N?.locale?.()||"uk-UA");
  const title=String(run.prompt||"AI Bridge").split("\n")[0].slice(0,140).replace(/[\[\]]/g,"");
  const provs=(run.providers||[]).map((x)=>PROVIDERS[x]?.name||x).join(", ")||String(run.meta?.mode||run.mode||"");
  const lines=[`# ${title}`,`${dateStr}${provs?" • "+provs:""}`,"",
    "## "+t("exportDlgTask"),String(run.prompt||""),"",
    "## "+t("exportDlgAnswer"),String(run.final||"")];
  if(Array.isArray(run.results)&&run.results.length){
    lines.push("","## "+t("exportDlgModels"));
    run.results.forEach((r,i)=>{
      const label=PROVIDERS[r.provider]?.name||r.provider||("#"+(i+1));
      const ms=r.ms!=null?Math.round(r.ms)+" ms":"—";
      const cost=r.costUsd!=null?` ≈$${fmtMoney(r.costUsd)}`:"";
      lines.push(`- ${label}: ${ms}${cost}, ${r.ok?"ok":"err"}`);
    });
  }
  const qs=run.meta?.qualityScore;
  if(qs&&Number.isFinite(Number(qs.avg))){
    const comma=I18N?.getLanguage?.()!=="en";
    const num=comma?String(Number(qs.avg)).replace(".",","):String(Number(qs.avg));
    lines.push("",t("qualityScore").replace("{n}",num));
  }
  const sources=(run.meta?.webSearch?.results||[]).map((x)=>({title:String(x.title||x.url||""),url:safeSourceUrl(x.url)})).filter((x)=>x.url);
  if(sources.length)lines.push("","## "+t("exportDlgSources"),...sources.map((x,i)=>`${i+1}. [${x.title.replace(/[\[\]]/g,"")}](${x.url})`));
  lines.push("","---",`AI Bridge v${ver}`);
  return {name:`ai-bridge-dialog-${dialogStamp()}.md`,text:lines.join("\n")};
}
function exportDialogJsonText(run){
  return {name:`ai-bridge-dialog-${dialogStamp()}.json`,text:JSON.stringify(run,null,2)};
}
async function downloadExportFile(kind){
  const run=currentRun;
  if(!run?.final){toast(t("exportNoRun"),"warn");return}
  let ok=false;
  if(kind==="json"){
    const out=exportDialogJsonText(run);
    ok=await dlBlobSmart(new Blob([out.text],{type:"application/json"}),out.name,"application/json");
  }else{
    const out=exportDialogMdText(run);
    ok=await dlBlobSmart(new Blob([out.text],{type:"text/markdown;charset=utf-8"}),out.name,"text/markdown");
  }
  closeSheet("exportSheet");
  if(ok)toast(t("exportDone"),"ok");
}

/* ---------- v5.11.41: імпорт діалогів (Bridge JSON / ChatGPT conversations.json) ----------
   Чисті функції для тестів: parseImportDialogText розбирає текст файлу і повертає
   список діалогів {title,prompt,final,created,source,providers}; importDialogsFromFile
   зберігає їх як звичайні діалоги історії. Жодних секретів, дані не залишають пристрій. */
const IMPORT_MAX_DIALOGS=50,IMPORT_MAX_CHARS=200000;
function importCapText(s){s=String(s||"");return s.length>IMPORT_MAX_CHARS?s.slice(0,IMPORT_MAX_CHARS)+"…":s}
function chatGptPartsText(content){
  if(!content||!Array.isArray(content.parts))return "";
  return content.parts.map(p=>typeof p==="string"?p:(p&&typeof p.text==="string"?p.text:"")).join("\n").trim();
}
function importFromBridgeRun(o){
  if(!o||typeof o!=="object")return null;
  const prompt=typeof o.prompt==="string"?o.prompt.trim():"";
  const final=typeof o.final==="string"?o.final.trim():"";
  if(!prompt&&!final)return null;
  return {
    title:String(o.title||prompt.split("\n")[0]||"").split("\n")[0].slice(0,140)||"?",
    prompt:importCapText(prompt),final:importCapText(final),
    created:Number(o.created)||Date.now(),source:"bridge",
    providers:Array.isArray(o.providers)?o.providers.slice(0,10).map(String):[]
  };
}
function importFromChatGptConv(c){
  if(!c||typeof c!=="object"||!c.mapping||typeof c.mapping!=="object")return null;
  const msgs=Object.values(c.mapping)
    .filter(n=>n&&n.message&&n.message.content)
    .map(n=>({role:String(n.message.author&&n.message.author.role||""),text:chatGptPartsText(n.message.content),created:Number(n.message.create_time)||0}))
    .filter(m=>m.text&&(m.role==="user"||m.role==="assistant"||m.role==="system"));
  if(!msgs.length)return null;
  msgs.sort((a,b)=>a.created-b.created);
  const firstUser=msgs.find(m=>m.role==="user");
  const assistants=msgs.filter(m=>m.role==="assistant");
  const last=assistants.length?assistants[assistants.length-1]:msgs[msgs.length-1];
  return {
    title:String(c.title||firstUser&&firstUser.text||"ChatGPT").split("\n")[0].slice(0,140),
    prompt:importCapText(firstUser?firstUser.text:""),final:importCapText(last?last.text:""),
    created:Number(c.create_time)?Number(c.create_time)*1000:Date.now(),source:"chatgpt",providers:[]
  };
}
function parseImportDialogText(text){
  let j;
  try{j=JSON.parse(String(text||""))}catch(e){return{ok:false,error:"format"}}
  const items=Array.isArray(j)?j:[j];
  const out=[];
  for(const it of items){
    if(out.length>=IMPORT_MAX_DIALOGS)break;
    const cand=(it&&typeof it==="object"&&it.run&&typeof it.run==="object")?it.run:it;
    const d=(cand&&cand.mapping)?importFromChatGptConv(cand):importFromBridgeRun(cand);
    if(d)out.push(d);
  }
  if(!out.length)return{ok:false,error:"empty"};
  return{ok:true,dialogs:out};
}
async function importDialogsFromFile(file){
  if(!file)return;
  let text="";
  try{text=await file.text()}catch(e){toast(t("importErrRead"),"bad");return}
  const parsed=parseImportDialogText(text);
  if(!parsed.ok){toast(t(parsed.error==="empty"?"importEmpty":"importErrFormat"),"bad");return}
  let n=0;
  for(const d of parsed.dialogs){
    await saveRun({uid:newUid(),title:d.title,prompt:d.prompt,final:d.final,created:d.created,updated:Date.now(),mode:"chat",providers:d.providers,results:[],meta:{imported:true,importedFrom:d.source}});
    n++;
  }
  closeSheet("exportSheet");
  toast(t("importDone",{n}),"good");
  renderHistory();
}

/* ---------- v5.11.41: детальний розбір використання контексту ----------
   Тап по індикатору відкриває розбір: куди йдуть токени діалогу
   (запити / відповіді / перекази пам'яті / інше) + топ-5 найбільших повідомлень.
   Оцінка узгоджена з contextUsage: токени ≈ символи/4. */
function ctxTokensOf(text){return Math.round(String(text||"").length/4)}
function contextBreakdown(messages){
  const list=Array.isArray(messages)?messages:[];
  const cats={user:0,assistant:0,memory:0,other:0};
  const top=[];
  for(const m of list){
    if(!m||typeof m.text!=="string"||m.error)continue;
    const tok=ctxTokensOf(m.text);
    const cat=m.compacted?"memory":m.role==="user"?"user":m.role==="assistant"?"assistant":"other";
    cats[cat]+=tok;
    top.push({role:m.role,preview:String(m.text).slice(0,80),tokens:tok});
  }
  top.sort((a,b)=>b.tokens-a.tokens);
  const total=cats.user+cats.assistant+cats.memory+cats.other;
  return{total,budget:CTX_METER_BUDGET,pct:Math.min(999,Math.round(total/CTX_METER_BUDGET*100)),cats,top:top.slice(0,5)};
}
const CTX_CAT_LABELS=[["user","ctxCatUser"],["assistant","ctxCatAssistant"],["memory","ctxCatMemory"],["other","ctxCatOther"]];
function renderCtxSheet(){
  const b=contextBreakdown(typeof agentMessages!=="undefined"?agentMessages:[]);
  const totalEl=$("ctxTotal");
  if(totalEl)totalEl.textContent=t("ctxTotal",{u:groupNum(b.total),b:groupNum(b.budget),p:b.pct});
  const host=$("ctxBreakdownList");
  if(!host)return;
  let html=CTX_CAT_LABELS.map(function(pair){
    const k=pair[0],tok=b.cats[k]||0,p=b.total?Math.round(tok/b.total*100):0;
    return '<div class="ctxRow"><div class="ctxRowHead"><span>'+esc(t(pair[1]))+'</span><span class="ctxRowNum">'+groupNum(tok)+' · '+p+'%</span></div><div class="ctxBar"><i style="width:'+Math.min(100,Math.max(0,p))+'%"></i></div></div>';
  }).join("");
  if(b.top.length){
    html+='<div class="ctxTopTitle">'+esc(t("ctxTop"))+'</div>';
    for(const x of b.top)html+='<div class="ctxTopRow"><span class="ctxTopPrev">'+esc(x.preview)+'</span><span class="ctxRowNum">'+groupNum(x.tokens)+'</span></div>';
  }
  host.innerHTML=html;
}

/* ---------- init ---------- */
function initV5100(){
  wireConfirmSheet();wireModeChips();wireEffortChips();wireQuickActions();wireIntentChips();wireIdeaSheet();
  // v5.10.0: subtle haptic on every button tap.
  document.addEventListener("click",e=>{if(e.target.closest("button"))haptic(8)});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-empty-btn]");if(b&&emptyActions[b.dataset.emptyBtn])emptyActions[b.dataset.emptyBtn]()});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-err-btn]");if(b&&errActions[b.dataset.errBtn])errActions[b.dataset.errBtn]()});
  document.addEventListener("click",e=>{if(e.target.closest(".visionAnalyzeBtn"))analyzeAttachedImage()});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-sched-open]");if(b){openSheet("schedSheet");loadSchedules()}});
  const ta=$("prompt");
  if(ta){ta.addEventListener("input",()=>{autoGrowTextarea(ta);renderAttachChips()});autoGrowTextarea(ta)}
  window.addEventListener("online",flushOfflineQueue);
  window.addEventListener("offline",updateOfflineBar);
  updateOfflineBar();
  initConnDot(); // v5.10.5: green/red server-connection dot
  const sb=$("schedSaveBtn");if(sb)sb.onclick=saveSchedule;
  const ka=$("kbAskBtn");if(ka)ka.onclick=askKb;
  const kq=$("kbQuery");if(kq)kq.addEventListener("keydown",e=>{if(e.key==="Enter")askKb()});
  const ec=$("exportChatBtn");if(ec)ec.onclick=()=>openSheet("exportSheet"); // v5.11.41: лист відкривається завжди (експорт — тільки коли є відповідь, імпорт — завжди)
  const ed=$("exportDocxBtn");if(ed)ed.onclick=()=>{exportDocx()};
  /* v5.11.89: перемикач «Зберегти як…» у листі експорту */
  const epc=$("exportPickPlaceChk");if(epc){epc.checked=exportPickPlaceOn();epc.onchange=()=>{try{localStorage.setItem(EXPORT_PLACE_KEY,epc.checked?"1":"0")}catch(e){}}};
  const ep=$("exportPdfBtn");if(ep)ep.onclick=exportPdf;
  const emd=$("exportDialogMdBtn");if(emd)emd.onclick=()=>downloadExportFile("md");
  const ejs=$("exportDialogJsonBtn");if(ejs)ejs.onclick=()=>downloadExportFile("json");
  // v5.11.41: імпорт діалогів (Bridge JSON / ChatGPT conversations.json)
  const impB=$("importDialogBtn"),impF=$("importDialogFile");
  if(impB)impB.onclick=()=>{if(impF)impF.click()};
  if(impF)impF.addEventListener("change",()=>{const f=impF.files&&impF.files[0];impF.value="";importDialogsFromFile(f)});
  // v5.11.41: тап по індикатору контексту — детальний розбір
  const cm=$("ctxMeter");
  if(cm)cm.addEventListener("click",()=>{renderCtxSheet();openSheet("ctxSheet")});
  wireMentionAutocomplete(); // v5.11.23: @згадки моделей з автодоповненням
  wireCtxMentionAutocomplete(); // v5.11.68: @@згадки минулих чатів з автодоповненням
  clearDoneBadge(); // v5.11.23: скинути бейдж PWA при старті
  wireNotesPage(); // v5.11.47: кнопка «Нова нотатка»
  if($("statsExportBtn"))$("statsExportBtn").onclick=exportStatsCsv; // v5.11.47: експорт статистики
  renderAttachChips();
}
initPushUI();maybeShowInstallCard();
initIosKeyboardFix(); // v5.11.34: поле вводу не ховається під клавіатурою iOS
initV5916();
initV5100();
resumePendingJobIfAny().catch(()=>{});
maybeShowDeepScanBanner(); // v5.10.5: offer to resume an interrupted Deep Scan

/* v5.11.19: автооновлення без авторизації і без танців з кешем.
   Перевірка версії йде через публічний /api/version (без токена): раніше
   версія звірялася лише в /api/status, тож без токена на пристрої застосунок
   назавжди застрягав на старій версії. Чернетки полів вводу зберігаються при
   наборі, щоб авто-перезавантаження нічого не стерло. */
const AB_DRAFT_KEY="abComposerDraftsV1";
function saveComposerDrafts(){try{
  const d={};
  for(const id of ["prompt","agentPrompt"]){const el=document.getElementById(id);if(el&&typeof el.value==="string")d[id]=el.value;}
  localStorage.setItem(AB_DRAFT_KEY,JSON.stringify(d));
}catch(e){}}
function restoreComposerDrafts(){try{
  const raw=localStorage.getItem(AB_DRAFT_KEY);if(!raw)return;
  const d=JSON.parse(raw)||{};
  for(const id of ["prompt","agentPrompt"]){const el=document.getElementById(id);if(el&&!el.value&&typeof d[id]==="string"&&d[id]){el.value=d[id];el.dispatchEvent(new Event("input",{bubbles:true}));}}
}catch(e){}}
let abVersionCheckBusy=false;
async function checkAppVersionAuto(){
  if(abVersionCheckBusy)return;abVersionCheckBusy=true;
  try{
    const r=await fetch("/api/version",{cache:"no-store",credentials:"same-origin"});
    if(!r.ok)return;
    const j=await r.json().catch(()=>null),sv=j&&j.version;
    if(sv&&sv!==UI_VERSION&&verIsNewer(sv,UI_VERSION)&&!sessionStorage.getItem("abAutoUpd")){
      sessionStorage.setItem("abAutoUpd",sv);
      saveComposerDrafts();
      autoUpdateTo(sv);
    }
  }catch(e){}finally{abVersionCheckBusy=false;}
}
restoreComposerDrafts();
if("serviceWorker"in navigator){
  let reloading=false,swReg=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!reloading){reloading=true;location.reload()}});
  const updateSwReg=async()=>{try{if(!swReg)swReg=await navigator.serviceWorker.getRegistration();if(swReg)await swReg.update();}catch(e){}};
  window.addEventListener("load",async()=>{try{swReg=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});await swReg.update()}catch(e){}checkAppVersionAuto()});
  // Щоразу, коли застосунок повертається на передній план, перевірити
  // версію сервера — так оновлення підхоплюється автоматично, без чищення кешу.
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){try{refreshStatus().catch(()=>{})}catch(e){}updateSwReg();checkAppVersionAuto();}});
  // …і кожні 15 хвилин у фоні.
  setInterval(()=>{updateSwReg();checkAppVersionAuto();},15*60*1000);
  // Чернетки: зберігаємо під час набору; чистимо збережене при відправці.
  for(const id of ["prompt","agentPrompt"]){const el=document.getElementById(id);if(el)el.addEventListener("input",()=>{clearTimeout(el._abDraftT);el._abDraftT=setTimeout(saveComposerDrafts,600);});}
  // v5.11.74: захист сховища на iPhone — запитати одразу після завантаження.
  ensureStoragePersist();
}
/* v5.11.92: цей блок стояв ПІСЛЯ закриття головної функції застосунку, тому не бачив
   safeRenderScrollFab і scrollFabNew — кожен скрол кидав ReferenceError (ті самі ×15068 з
   iPhone-звіту; латка v5.11.88 лишила виклик поза областю видимості). Тепер він усередині. */
/* v5.11.29: ініціалізація плаваючої кнопки «Вниз» — тап = скрол донизу, скрол/ресайз = перерахунок. */
(function(){
  const b=document.getElementById("scrollFab");if(!b)return;
  b.onclick=()=>{scrollFabNew=0;safeRenderScrollFab();try{window.scrollTo({top:document.documentElement.scrollHeight,behavior:"smooth"})}catch(e){try{window.scrollTo(0,document.documentElement.scrollHeight)}catch(_){}}};
  let fabRaf=0;
  const onScroll=()=>{if(fabRaf)return;fabRaf=(typeof requestAnimationFrame==="function"?requestAnimationFrame:setTimeout)(()=>{fabRaf=0;safeRenderScrollFab()})};
  window.addEventListener("scroll",onScroll,{passive:true});
  window.addEventListener("resize",onScroll);
})();
/* v5.11.98: м'які фейди на краях скрольованих панелей (історія, «Що нового», листи, палітра,
   журнал прогресу, прев'ю інструментів). Маска — лише CSS; стан країв оновлює JS. */
(function(){
  const SEL=".sheetPanel,.cmdkList,.mentionBox,.progressLog,#historyList,#whatsNewList,.peerBody,.toolPreviewFull,.compactMarkDigest,.diagLog";
  const refresh=el=>{
    if(!el||!el.classList||!el.classList.contains("scroll-fade"))return;
    const can=el.scrollHeight>el.clientHeight+2;
    const top=can&&el.scrollTop>2,bot=can&&(el.scrollTop+el.clientHeight)<el.scrollHeight-2;
    el.dataset.fadeTop=top?"1":"0";el.dataset.fadeBottom=bot?"1":"0";
  };
  const mark=root=>{(root||document).querySelectorAll(SEL).forEach(el=>{el.classList.add("scroll-fade");refresh(el);});};
  document.addEventListener("scroll",e=>{
    const t=e.target;
    if(t&&t.nodeType===1){
      if(t.matches&&t.matches(SEL)){t.classList.add("scroll-fade");refresh(t);}
      else if(t.classList&&t.classList.contains("scroll-fade"))refresh(t);
    }
  },true);
  window.addEventListener("resize",()=>mark());
  let moT=0;
  new MutationObserver(()=>{clearTimeout(moT);moT=setTimeout(()=>mark(),300);}).observe(document.body,{childList:true,subtree:true});
  mark();
})();
})();
