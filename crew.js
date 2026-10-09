/* AI Bridge — Agent Crew panel (page-crew). v5.11.0
 * Standalone logic for the "Команда агентів" page. Talks to /api/team/*.
 * Honesty rule: never claim "works/connected" unless the backend confirmed it;
 * on API failure show "unknown"/"no connection".
 */
(function(){
"use strict";

const $=(id)=>document.getElementById(id);
const I18N=window.AIBridgeI18n||null;
const t=(k,v)=>I18N?I18N.t(k,v):k;
const esc=(s)=>String(s??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* 24 roles (fallback labels; backend `name` wins). ids from TEAM_CONTRACT.md */
const ROLES=[
  ["coordinator","Координатор","Coordinator"],["architect","Архітектор","Architect"],
  ["chat","Chat","Chat"],["agentplan","Agent Plan/Team","Agent Plan/Team"],
  ["search","Пошук","Search"],["knowledge","Знання та пам'ять","Knowledge & Memory"],
  ["photo","Фото","Photo"],["video","Відео","Video"],
  ["voice","Голос та аудіо","Voice & Audio"],["files","Files/ZIP","Files/ZIP"],
  ["providers","AI-провайдери","AI Providers"],["jobs","Jobs/фон","Jobs/Background"],
  ["design","Дизайн","Design"],["iphone","iPhone/PWA","iPhone/PWA"],
  ["backend","Backend/дані","Backend/Data"],["security","Безпека","Security"],
  ["integrations","OAuth/MCP/Connect","OAuth/MCP/Connect"],["workcontroller","Work Controller","Work Controller"],
  ["binance","Binance","Binance"],["analytics","Аналітика та витрати","Analytics & Costs"],
  ["tester","Тестувальник","Tester"],["releases","Релізи та відновлення","Releases & Recovery"],
  ["research","Дослідження й розвиток","R&D"],["docs","Документація та переклади","Docs & Translations"]
];
const roleName=(id)=>{
  const r=ROLES.find((x)=>x[0]===id);
  const lang=I18N?I18N.getLanguage():"uk";
  return r?(lang==="uk"?r[1]:r[2]):String(id||"—");
};

/* v5.11.3 ORGANIZER: групування агентів за категоріями (Things-style headings) */
const ROLE_GROUPS=[
  {id:"mgmt",uk:"Керування",en:"Management",color:"#5e6ad2",roles:["coordinator","architect"]},
  {id:"content",uk:"Контент",en:"Content",color:"#7a86e0",roles:["chat","photo","video","voice","docs"]},
  {id:"data",uk:"Дані",en:"Data",color:"#56c8f5",roles:["search","knowledge","files","analytics"]},
  {id:"system",uk:"Система",en:"System",color:"#a1a1a6",roles:["backend","security","integrations","iphone","design","providers","jobs"]},
  {id:"delivery",uk:"Розробка",en:"Delivery",color:"#3ecf9a",roles:["agentplan","tester","releases","research","binance","workcontroller"]},
];
const roleGroupOf=(id)=>ROLE_GROUPS.find((g)=>g.roles.includes(id))||null;

const AGENT_STATUS=["idle","running","paused","stopped","error"];
const TASK_STATUS=["queued","running","paused","done","failed","cancelled"];
const agentStatusLabel=(s)=>t({idle:"crewStIdle",running:"crewStRunning",paused:"crewStPaused",stopped:"crewStStopped",error:"crewStError"}[s]||"crewStUnknown");
const taskStatusLabel=(s)=>t({queued:"crewTsQueued",running:"crewTsRunning",paused:"crewTsPaused",done:"crewTsDone",failed:"crewTsFailed",cancelled:"crewTsCancelled"}[s]||"crewStUnknown");
const relStatusLabel=(s)=>t({pending:"crewRelPending",approved:"crewRelApprovedSt",rejected:"crewRelRejectedSt",deployed:"crewRelDeployed"}[s]||"crewStUnknown");

const state={agents:null,tasks:null,events:null,chain:null,releases:null,config:null,media:null,taskFilter:"all",critEditId:null};

function crewToast(message,kind){
  try{
    const box=$("toasts");if(!box)return;
    const el=document.createElement("div");
    el.className="toast"+(kind==="bad"?" bad":kind==="good"?" good":"");
    el.textContent=message;box.appendChild(el);
    setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),300)},2600);
  }catch(e){}
}

async function api(path,opts){
  /* v5.11.81: таймаут 15с — індикатори не висять вічно */
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),15000);
  try{
    const r=await fetch("/api/team"+path,Object.assign({cache:"no-store",credentials:"same-origin",signal:ctrl.signal},opts||{}));
    let j=null;try{j=await r.json()}catch(e){}
    return{ok:r.ok,status:r.status,json:j};
  }finally{clearTimeout(timer)}
}

/* v5.11.81: стан останнього оновлення — розрізняємо 401, мережу, сервер */
let lastRefreshState="unknown";

function fmtTime(ts){
  if(!ts)return t("crewNever");
  try{return new Date(Number(ts)).toLocaleString(I18N?I18N.locale():"uk-UA",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
  catch(e){return String(ts)}
}
function fmtMoney(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(2):"—"}

/* ---------------- agents ---------------- */
function renderAgents(){
  const box=$("crewAgents");if(!box)return;
  const byId={};(state.agents||[]).forEach((a)=>{byId[a.id]=a});
  const running=state.agents?state.agents.filter((a)=>a.status==="running").length:0;
  const sum=$("crewAgentSummary");
  if(sum)sum.textContent=state.agents?`${state.agents.length} · ${t("crewActive",{n:running})}`:"";
  const lang=I18N?I18N.getLanguage():"uk";
  /* v5.11.56: органайзер — плоска сітка карток за макетом crew-organizer.html */
  const dotFor=(st)=>st==="running"?"busy":(st==="idle"?"on":"off");
  const taskFor=(a)=>{
    if(!a)return esc(t("crewStUnknown"));
    if(a.note)return esc(String(a.note).slice(0,60));
    if(a.activeTasks)return esc(t("crewActive",{n:a.activeTasks}));
    return esc(agentStatusLabel(a.status||"unknown"));
  };
  const cards=ROLES.map(([rid,uk,en])=>{
    const a=byId[rid];
    const st=a&&AGENT_STATUS.includes(a.status)?a.status:"unknown";
    const name=a&&a.name?String(a.name):(lang==="uk"?uk:en);
    const role=lang==="uk"?uk:en;
    /* v5.11.77: картка клікабельна — клік відкриває форму нового завдання з preselected роллю */
    return `<div class="crew-ocard" role="listitem" tabindex="0" data-role="${esc(rid)}" title="${esc(lang==="uk"?"Натисніть, щоб дати завдання":"Tap to assign a task")}"><div class="row"><span class="adot ${dotFor(st)}" aria-hidden="true"></span><span class="name">${esc(name)}</span></div><div class="role">${esc(role)}</div><div class="task">${taskFor(a)}</div></div>`;
  }).join("");
  box.innerHTML=cards;
  renderStats();
}

/* v5.11.56: три картки огляду органайзера */
function renderStats(){
  const sa=$("crewStatAgents"),st=$("crewStatTasks"),sb=$("crewStatBudget");
  const agents=state.agents||[];
  const online=agents.filter((a)=>a.status==="running"||a.status==="idle").length;
  if(sa)sa.textContent=agents.length?String(online):"–";
  const tasks=state.tasks||[];
  const active=tasks.filter((x)=>x.status==="running"||x.status==="queued"||x.status==="paused").length;
  if(st)st.textContent=state.tasks?String(active):"–";
  if(sb){
    const limit=state.config&&state.config.dailyBudgetUsd!=null?Number(state.config.dailyBudgetUsd):null;
    const spent=tasks.reduce((s,x)=>s+(Number(x.costUsd)||0),0);
    sb.textContent=limit!=null?`$${spent.toFixed(2)}/$${limit}`:(spent>0?`$${spent.toFixed(2)}`:"–");
  }
  const badge=$("crewRelBadge");
  if(badge){
    const pending=(state.releases||[]).filter((r)=>r.status==="pending").length;
    badge.hidden=pending===0;
    badge.textContent=String(pending);
  }
}

/* ---------------- tasks ---------------- */
const TASK_ACTIONS={queued:["start","cancel"],running:["pause","cancel"],paused:["resume","cancel"]};
/* v5.11.56: пігулка статусу для органайзера */
const taskPillClass=(s)=>s==="running"?"run":(s==="done"?"done":(s==="queued"||s==="paused"?"wait":"wait"));
function renderTasks(){
  const box=$("crewTasks");if(!box)return;
  const fbox=$("crewTaskFilters");
  if(fbox){
    fbox.innerHTML=["all",...TASK_STATUS].map((s)=>`<button type="button" class="chip${state.taskFilter===s?" on":""}" data-filter="${s}">${s==="all"?esc(t("crewAll")):esc(taskStatusLabel(s))}</button>`).join("");
  }
  let list=state.tasks||[];
  if(state.tasks&&state.taskFilter!=="all")list=list.filter((x)=>x.status===state.taskFilter);
  if(state.tasks&&!list.length){box.innerHTML=`<p class="crew-empty">${esc(t("crewNoTasks"))}</p>`;renderStats();return}
  if(!state.tasks){box.innerHTML=`<p class="crew-empty">${esc(t("crewLoading"))}</p>`;renderStats();return}
  box.innerHTML=list.slice(0,80).map((x)=>{
    const acts=(TASK_ACTIONS[x.status]||[]).map((a)=>`<button type="button" class="crew-btn" data-task="${esc(x.id)}" data-act="${a}">${esc(t({start:"crewStart",pause:"crewPause",resume:"crewResume",cancel:"crewCancel"}[a]))}</button>`).join("");
    const appr=(x.status==="done"&&!x.approver)?`<button type="button" class="crew-btn ok" data-task="${esc(x.id)}" data-act="approve">${esc(t("crewApprove"))}</button><button type="button" class="crew-btn bad" data-task="${esc(x.id)}" data-act="reject">${esc(t("crewReject"))}</button>`:"";
    const det=(x.input||x.result)?`<details class="crew-det"><summary>${esc(t("crewInput"))} / ${esc(t("crewResult"))}</summary><pre>${esc(typeof x.input==="string"?x.input:JSON.stringify(x.input??"",null,1))}</pre>${x.result?`<pre>${esc(typeof x.result==="string"?x.result:JSON.stringify(x.result,null,1))}</pre>`:""}</details>`:"";
    const ev=(x.evidence&&x.evidence.length)?`<div class="crew-ev">${x.evidence.slice(0,5).map((e)=>`<span>🔗 ${esc(String(e).slice(0,80))}</span>`).join("")}</div>`:"";
    const snz=(x.status==="blocked"&&Number(x.snoozedUntil))?`<span class="crew-snz">⏸ ${esc(t("crewSnoozedUntil",{d:fmtTime(x.snoozedUntil)}))}</span>`:"";
    /* v5.11.103: критерії прийняття + інлайн-редактор (тільки queued/paused). */
    const crit=critBlock(x);
    const critEd=critEditorBlock(x);
    const critBtn=(x.status==="queued"||x.status==="paused")?`<button type="button" class="crew-btn" data-crit-edit="${esc(x.id)}">${esc(t("crewCritEdit"))}</button>`:"";
    /* v5.11.86: обгортка для свайп-дій (вправо — дія, вліво — відкласти). */
    const sw=taskSwipeActions(x.status);
    const under=(sw.right||sw.left)?`<div class="crew-under crew-under-right">${sw.right?`<span>${esc(swipeActionLabel(sw.right))}</span>`:""}</div><div class="crew-under crew-under-left">${sw.left?`<span>${esc(swipeActionLabel(sw.left))}</span>`:""}</div>`:"";
    return `<div class="crew-swipe" data-id="${esc(x.id)}" data-status="${esc(x.status)}">${under}
      <div class="crew-otask st-${esc(x.status)}">
      <div class="t">${esc(x.title||"—")}</div>
      <div class="m"><span class="pill ${taskPillClass(x.status)}">${esc(taskStatusLabel(x.status))}</span><span>${esc(roleName(x.role))} · ${fmtTime(x.updatedAt||x.createdAt)}</span>${snz}</div>
      ${det}${ev}${crit}${critEd}
      <div class="crew-btns">${acts}${appr}${critBtn}</div>
    </div></div>`;
  }).join("");
  initTaskSwipe(box); // v5.11.86: свайп-дії
  renderStats();
}

/* v5.11.103: критерії прийняття завдань команди (acceptance checklist).
   Клієнтський аналог серверного teamEvaluateCriteria: вердикт раннера
   (result.criteriaChecks за id) → expectEvidence (підрядок у evidence) →
   інакше — не оцінено. */
function criteriaVerdicts(x){
  const list=Array.isArray(x.criteria)?x.criteria:[];
  const checks=(x.result&&Array.isArray(x.result.criteriaChecks))?x.result.criteriaChecks:[];
  const byId={};
  for(const c of checks){const id=String((c&&c.id)||"");if(id&&!byId[id])byId[id]=c}
  const ev=(x.result&&Array.isArray(x.result.evidence))?x.result.evidence.map((e)=>String(e).toLowerCase()):[];
  return list.map((c,i)=>{
    const text=typeof c==="string"?c:String((c&&c.text)||"");
    const id=String((c&&c.id)||("c"+(i+1)));
    const g=byId[id];
    if(g)return{text,id,st:g.verdict==="pass"?"pass":"fail",note:String((g&&g.note)||"")};
    const ee=(c&&typeof c==="object"&&c.expectEvidence!=null)?String(c.expectEvidence):"";
    if(ee){
      const hit=ev.some((e)=>e.includes(ee.toLowerCase()));
      return{text,id,st:hit?"pass":"fail",note:hit?("✓ "+ee):("✗ "+ee)};
    }
    return{text,id,st:"pending",note:""};
  });
}
function critBlock(x){
  const list=Array.isArray(x.criteria)?x.criteria:[];
  if(!list.length)return "";
  const v=criteriaVerdicts(x);
  const n=v.filter((c)=>c.st==="pass").length;
  const items=v.map((c)=>{
    const mark=c.st==="pass"?"✓":(c.st==="fail"?"✗":"·");
    const cls=c.st==="pass"?"pass":(c.st==="fail"?"fail":"pending");
    const stLabel=c.st==="pass"?t("crewCritPass"):(c.st==="fail"?t("crewCritFail"):t("crewCritUneval"));
    return `<li class="${cls}"><span class="mk" aria-hidden="true">${mark}</span><span class="tx">${esc(c.text)}<small>${esc(stLabel)}${c.note?": "+esc(c.note.slice(0,80)):""}</small></span></li>`;
  }).join("");
  return `<div class="crew-crit"><div class="ch"><span>${esc(t("crewCritTitle"))}</span><span class="cnt">${esc(t("crewCritPassed",{n,m:list.length}))}</span></div><ul>${items}</ul></div>`;
}
function critEditorBlock(x){
  if(state.critEditId!==x.id)return "";
  const cur=(Array.isArray(x.criteria)?x.criteria:[])
    .map((c)=>typeof c==="string"?c:String((c&&c.text)||"")).filter((s)=>s.trim()).join("\n");
  return `<div class="crew-crit-ed"><textarea rows="4" maxlength="4000" data-crit-text="${esc(x.id)}" placeholder="${esc(t("crewCritHint"))}">${esc(cur)}</textarea><div class="hint">${esc(t("crewCritHint"))}</div><div class="crew-btns"><button type="button" class="crew-btn ok" data-crit-save="${esc(x.id)}">${esc(t("save"))}</button><button type="button" class="crew-btn" data-crit-cancel="${esc(x.id)}">${esc(t("cancelBtn"))}</button></div></div>`;
}
async function saveCriteria(id){
  const ta=document.querySelector(`[data-crit-text="${CSS.escape(id)}"]`);
  const lines=String(ta&&ta.value||"").split("\n").map((s)=>s.trim()).filter(Boolean).slice(0,20);
  const ok=await mutate(api(`/tasks/${encodeURIComponent(id)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set-criteria",criteria:lines})}),t("crewCritSaved"));
  state.critEditId=null;
  if(ok)renderTasks();
}

/* ---------------- events ---------------- */
/* v5.11.31: рядок статусу хеш-ланцюга цілісності журналу подій. */
function chainRow(){
  const c=state.chain;
  if(!c)return "";
  let txt;
  if(c.ok){
    txt=t("crewChainOk",{n:c.chained});
    if(c.legacy>0)txt+=" "+t("crewChainLegacy",{legacy:c.legacy});
  }else{
    txt=t("crewChainBroken",{at:c.brokenAt});
  }
  return `<div class="crew-chain${c.ok?" ok":" bad"}">${esc(txt)}</div>`;
}
function renderEvents(){
  const box=$("crewEvents");if(!box)return;
  const ch=chainRow();
  const expBtn=`<button type="button" class="crew-btn" id="crewEventsExportBtn">${esc(t("crewEventsExport"))}</button>`;
  if(!state.events){box.innerHTML=ch+`<p class="crew-empty">${esc(t("crewLoading"))}</p>`;return}
  if(!state.events.length){box.innerHTML=ch+`<p class="crew-empty">${esc(t("crewEventsEmpty"))}</p>`;return}
  /* v5.11.56: органайзер — компактний таймлайн за макетом */
  box.innerHTML=ch+`<div class="crew-timeline">`+state.events.slice(0,50).map((e)=>`<div class="ev"><span class="time">${esc(fmtTime(e.ts))}</span><span class="txt">${e.actor?`<b>${esc(e.actor)}</b> `:""}${esc(e.msg||"")}</span></div>`).join("")+`</div>`+expBtn;
}

/* v5.11.31: експорт журналу подій у JSONL (один запис — один рядок JSON). */
function exportEventsJsonl(){
  const evs=state.events;
  if(!Array.isArray(evs)||!evs.length)return;
  const body=evs.map((e)=>JSON.stringify(e)).join("\n")+"\n";
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([body],{type:"application/jsonl"}));
  const d=new Date(),p=(n)=>String(n).padStart(2,"0");
  a.download=`ai-bridge-events-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.jsonl`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ---------------- releases ---------------- */
function renderReleases(){
  const box=$("crewReleases");if(!box)return;
  if(!state.releases){box.innerHTML=`<p class="crew-empty">${esc(t("crewLoading"))}</p>`;renderStats();return}
  if(!state.releases.length){box.innerHTML=`<p class="crew-empty">${esc(t("crewReleasesEmpty"))}</p>`;renderStats();return}
  box.innerHTML=state.releases.map((r)=>{
    const ch=(r.changes||[]).map((c)=>`<li>${esc(c)}</li>`).join("");
    const canDecide=r.status==="pending";
    const dline=[(r.changes||[]).length?`${r.changes.length} ${esc(t("crewChanges")).toLowerCase()}`:null,relStatusLabel(r.status)].filter(Boolean).join(" · ");
    return `<div class="crew-orel st-${esc(r.status)}">
      <div class="t">${esc(r.title||"—")}</div>
      <div class="d">${esc(dline)}${r.authorRole?` · ${esc(roleName(r.authorRole))}`:""}</div>
      ${ch?`<ul class="crew-changes">${ch}</ul>`:""}
      ${canDecide?`<div class="btns"><button type="button" class="btn ok" data-release="${esc(r.id)}" data-act="approve">${esc(t("crewApprove"))}</button><button type="button" class="btn no" data-release="${esc(r.id)}" data-act="reject">${esc(t("crewReject"))}</button></div>`:""}
    </div>`;
  }).join("");
  renderStats();
}

/* ---------------- config ---------------- */
function renderConfig(){
  const c=state.config;if(!c)return;
  const e=$("crewCfgEnabled"),a=$("crewCfgAuto"),b=$("crewCfgBudget"),n=$("crewCfgNote");
  if(e)e.checked=!!c.enabled;
  if(a)a.checked=!!c.autoApproveLowRisk;
  if(b&&document.activeElement!==b)b.value=c.dailyBudgetUsd??"";
  if(n)n.textContent=c.scheduleNote?`${t("crewSchedule")}: ${c.scheduleNote}`:"";
}

/* ---------------- media ---------------- */
function mediaStatus(m){
  if(!m)return t("crewMediaUnknown");
  const s=String(m.status||"");
  if(s==="not_connected")return t("crewMediaNotConnected");
  if(s==="connected"||s==="ok"||s==="ready")return s; /* backend-confirmed only */
  return s||t("crewMediaUnknown");
}
function renderMedia(){
  const box=$("crewMedia");if(!box)return;
  const m=state.media;
  if(!m){box.innerHTML=`<p class="crew-empty">${esc(t("crewMediaUnknown"))}</p>`;return}
  const card=(label,x)=>`<div class="crew-mediaCard"><b>${esc(label)}</b><span class="crew-st">${esc(mediaStatus(x))}</span>${x&&x.engine?`<small>${esc(x.engine)}</small>`:""}${x&&x.needs?`<small>${esc(x.needs)}</small>`:""}</div>`;
  box.innerHTML=card(t("crewMediaPhoto"),m.photo)+card(t("crewMediaVideo"),m.video);
}

/* ---------------- refresh ---------------- */
let refreshing=false;
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const[ag,tk,ev,rl,cfg,md]=await Promise.allSettled([
      api("/agents"),api("/tasks"),api("/events?limit=50"),
      api("/releases"),api("/config"),api("/media")
    ]);
    /* v5.11.81: розрізняємо причину невдачі — 401 це не "немає мережі" */
    const _st=[ag,tk,ev,rl,cfg,md].map(r=>r.status==="fulfilled"?r.value.status:"network");
    if(_st.includes(401))lastRefreshState="need-login";
    else if(_st.includes(403))lastRefreshState="forbidden";
    else if(_st.includes("network"))lastRefreshState="network-error";
    else if(_st.some(s=>typeof s==="number"&&s>=500))lastRefreshState="server-error";
    else lastRefreshState="ok";
    const ok=(r)=>r.status==="fulfilled"&&r.value.ok?r.value.json:null;
    const jAg=ok(ag),jTk=ok(tk),jEv=ok(ev),jRl=ok(rl),jCfg=ok(cfg),jMd=ok(md);
    state.agents=jAg&&Array.isArray(jAg.agents)?jAg.agents:(jAg?[]:null);
    state.tasks=jTk&&Array.isArray(jTk.tasks)?jTk.tasks:(jTk?[]:null);
    state.events=jEv&&Array.isArray(jEv.events)?jEv.events:(jEv?[]:null);
    state.chain=jEv&&jEv.chain?jEv.chain:null;
    state.releases=jRl&&Array.isArray(jRl.releases)?jRl.releases:(jRl?[]:null);
    state.config=jCfg&&jCfg.config?jCfg.config:null;
    state.media=jMd||null;
    const conn=$("crewConn");
    if(conn){
      /* v5.11.81: при 401 показуємо "потрібен вхід", а не "немає зв'язку" */
      if(lastRefreshState==="need-login"){
        conn.classList.remove("hidden");
        conn.innerHTML=`<span>${esc(t("crewNeedLogin"))}</span> <button type="button" class="crew-btn" data-goto-auth>${esc(t("crewGoToLogin"))}</button>`;
      }else{
        conn.classList.toggle("hidden",!!jAg);
        if(lastRefreshState!=="ok"&&!jAg)conn.innerHTML=`<span>${esc(t("crewNoConn"))}</span>`;
      }
    }
    renderAgents();renderTasks();renderEvents();renderReleases();renderConfig();renderMedia();
  }finally{refreshing=false}
}

const isActive=()=>{const p=$("page-crew");return!!(p&&p.classList.contains("active"))};

/* ---------------- actions ---------------- */
async function mutate(promise,okMsg){
  try{
    const r=await promise;
    if(r.ok){if(okMsg)crewToast(okMsg,"good");await refresh();return true}
    const raw=r.json&&r.json.error?String(r.json.error):"";
    if(r.status===401){crewToast(t("crewNeedLogin"),"bad");return false}
    if(r.status===409&&!raw)crewToast(t("crewTaskDup"),"bad");
    else if(r.status===403&&!raw)crewToast(t("crewApproveDenied"),"bad");
    else crewToast(raw||`HTTP ${r.status}`,"bad");
  }catch(e){crewToast(e&&e.name==="AbortError"?"timeout":t("crewNoConn"),"bad")}
  return false;
}

async function onTaskAction(id,act){
  if(act==="approve"||act==="reject"){
    await mutate(api(`/tasks/${encodeURIComponent(id)}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approve:act==="approve"})}),act==="approve"?t("crewApproved"):t("crewRejected"));
  }else{
    const action=act==="start"?"execute":act; // start = перейти в running І виконати раннер
    await mutate(api(`/tasks/${encodeURIComponent(id)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})}),null);
  }
}
/* v5.11.86: свайп-дії на картках завдань (мобайл 390px).
   Вправо: queued/waiting → старт (execute), paused → продовжити, running → готово, blocked → повернути.
   Вліво: відкласти (snooze) з вибором терміну. Патерн як свайп-відповідь у чаті. */
function crewVibrate(ms){try{if(navigator.vibrate)navigator.vibrate(ms||10)}catch(e){}}
function crewReducedMotion(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}}
function taskSwipeActions(st){
  const right={running:"complete",queued:"start",waiting:"start",paused:"resume",blocked:"unsnooze"}[st]||null;
  const left=(st==="queued"||st==="waiting"||st==="paused"||st==="running")?"snooze":null;
  return {right,left};
}
function swipeActionLabel(a){
  const m={complete:"✓ "+t("crewComplete"),start:"▶ "+t("crewStart"),resume:"▶ "+t("crewResume"),unsnooze:"↩ "+t("crewUnsnooze"),snooze:"⏸ "+t("crewSnooze")};
  return m[a]||a;
}
async function doTaskAction(id,action,extra){
  const act=action==="start"?"execute":action;
  const okMsg={complete:"crewCompleted",snooze:"crewSnoozed",unsnooze:"crewUnsnoozed"}[action]||null;
  await mutate(api(`/tasks/${encodeURIComponent(id)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({action:act},extra||{}))}),okMsg?t(okMsg):null);
}
function closeSnoozeSheet(){const d=document.getElementById("crewSnoozeSheet");if(d)d.remove()}
function openSnoozeSheet(id){
  closeSnoozeSheet();
  const opts=[["crewSnoozeToday",8*3600e3],["crewSnoozeTomorrow",24*3600e3],["crewSnoozeWeek",7*24*3600e3]];
  const d=document.createElement("div");d.id="crewSnoozeSheet";d.className="crew-sheet";
  d.innerHTML=`<div class="crew-sheet-box" role="dialog" aria-label="${esc(t("crewSnoozeTitle"))}"><div class="crew-sheet-title">${esc(t("crewSnoozeTitle"))}</div>${opts.map(([k,ms])=>`<button type="button" class="crew-sheet-btn" data-ms="${ms}">${esc(t(k))}</button>`).join("")}<button type="button" class="crew-sheet-btn cancel" data-ms="0">${esc(t("cancelBtn"))}</button></div>`;
  document.body.appendChild(d);
  d.addEventListener("click",(e)=>{
    const b=e.target.closest("[data-ms]");
    if(b){const ms=Number(b.dataset.ms);closeSnoozeSheet();if(ms>0)doTaskAction(id,"snooze",{until:Date.now()+ms});return}
    if(e.target===d)closeSnoozeSheet();
  });
}
function initTaskSwipe(box){
  box.querySelectorAll(".crew-swipe").forEach((w)=>{
    if(w.dataset.swipeInit)return;w.dataset.swipeInit="1";
    const card=w.querySelector(".crew-otask");if(!card)return;
    let sx=0,sy=0,active=false,passed=false,act=null;
    const actions=()=>taskSwipeActions(w.dataset.status);
    w.addEventListener("touchstart",(e)=>{
      if(e.touches.length!==1)return;
      const tg=e.touches[0];
      if(tg.target&&tg.target.closest&&tg.target.closest("button,a,details,summary,pre,input,textarea,select"))return;
      const a=actions();if(!a.right&&!a.left)return;
      sx=tg.clientX;sy=tg.clientY;active=true;passed=false;act=null;card.style.transition="";
    },{passive:true});
    w.addEventListener("touchmove",(e)=>{
      if(!active||e.touches.length!==1)return;
      const tg=e.touches[0],mx=tg.clientX-sx,my=tg.clientY-sy;
      if(Math.abs(my)>Math.abs(mx)*1.4){active=false;card.style.transform="";return}
      const a=actions(),th=64;
      let dx=mx;
      if(dx>0&&!a.right)dx=0;else if(dx<0&&!a.left)dx=0;
      if(!dx){card.style.transform="";passed=false;act=null;return}
      const tx=(dx>0?1:-1)*Math.min(Math.abs(dx),th+48);
      if(!crewReducedMotion())card.style.transform=`translateX(${tx}px)`;
      if(!passed&&Math.abs(mx)>=th){passed=true;act=dx>0?a.right:a.left;crewVibrate(10)}
    },{passive:true});
    const reset=()=>{active=false;passed=false;act=null;card.style.transition="";card.style.transform=""};
    w.addEventListener("touchend",()=>{
      if(!active)return;const wasPassed=passed,a=act,id=w.dataset.id;reset();
      if(!wasPassed||!a)return;
      crewVibrate(15);
      if(a==="snooze")openSnoozeSheet(id);else doTaskAction(id,a);
    },{passive:true});
    w.addEventListener("touchcancel",reset,{passive:true});
  });
}
async function onReleaseAction(id,act){
  await mutate(api(`/releases/${encodeURIComponent(id)}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approve:act==="approve"})}),act==="approve"?t("crewApproved"):t("crewRejected"));
}
async function createTask(){
  const role=$("crewTaskRole")?.value||"coordinator";
  const title=$("crewTaskTitle")?.value.trim()||"";
  const input=$("crewTaskInput")?.value.trim()||"";
  if(!title){crewToast(t("crewTaskNeedTitle"),"bad");return}
  const ok=await mutate(api("/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role,title,input:input||undefined})}),t("crewTaskCreated"));
  if(ok){if($("crewTaskTitle"))$("crewTaskTitle").value="";if($("crewTaskInput"))$("crewTaskInput").value=""}
}
async function saveConfig(){
  const body={
    enabled:!!$("crewCfgEnabled")?.checked,
    autoApproveLowRisk:!!$("crewCfgAuto")?.checked,
    dailyBudgetUsd:Number($("crewCfgBudget")?.value)
  };
  if(!Number.isFinite(body.dailyBudgetUsd)||body.dailyBudgetUsd<0)delete body.dailyBudgetUsd;
  await mutate(api("/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),t("crewCfgSaved"));
}
async function stopAll(){
  if(!confirm(t("crewStopConfirm")))return;
  try{
    const r=await api("/stop-all",{method:"POST"});
    if(r.ok)crewToast(t("crewStopped",{n:r.json&&r.json.stopped!=null?r.json.stopped:"?"}),"good");
    else crewToast(r.json&&r.json.error?String(r.json.error):`HTTP ${r.status}`,"bad");
    await refresh();
  }catch(e){crewToast(t("crewNoConn"),"bad")}
}

function fillRoleSelect(force){
  const s=$("crewTaskRole");if(!s||(!force&&s.dataset.filled))return;
  s.innerHTML=ROLES.map(([id,uk,en])=>`<option value="${esc(id)}">${esc(I18N&&I18N.getLanguage()==="uk"?uk:en)}</option>`).join("");
  s.dataset.filled="1";
}

function openTaskForm(role){
  fillRoleSelect();
  const sel=$("crewTaskRole");
  if(sel&&role){const ok=[...sel.options].some((o)=>o.value===role);if(ok)sel.value=role}
  renderRoleStarters(); /* v5.11.93: стартові запитання для ролі */
  const d=$("crewNewTaskDetails");
  if(d){d.open=true;d.scrollIntoView({behavior:"smooth",block:"center"});
    setTimeout(()=>$("crewTaskTitle")?.focus({preventScroll:true}),400)}
}

/* v5.11.93: стартові запитання для ролі команди — чипи-стартери у формі нового
   завдання. Зберігаються в localStorage (по ролі), фабричні — 3 загальні. */
const STARTERS_LS="bridge_role_starters_v1";
function loadStarters(){try{const j=JSON.parse(localStorage.getItem(STARTERS_LS)||"{}");return j&&typeof j==="object"?j:{}}catch(e){return{}}}
function saveStarters(o){try{localStorage.setItem(STARTERS_LS,JSON.stringify(o))}catch(e){}}
function defaultStarters(){return[t("crewStarter1"),t("crewStarter2"),t("crewStarter3")].map(String).filter((s)=>s.trim())}
function getRoleStarters(role){const all=loadStarters(),c=all[role];return Array.isArray(c)&&c.length?c.map(String).filter((s)=>s.trim()).slice(0,4):defaultStarters()}
function renderRoleStarters(){
  const box=$("crewStarters");if(!box)return;
  const role=$("crewTaskRole")?.value||"coordinator";
  const list=getRoleStarters(role);
  box.innerHTML=list.map((q,i)=>`<button type="button" class="chip" data-starter="${i}">${esc(q)}</button>`).join("")+
    `<button type="button" class="chip chipEdit" id="crewStartersEdit" title="${esc(t("crewStartersTitle"))}" aria-label="${esc(t("crewStartersTitle"))}">✎</button>`;
  box.querySelectorAll("[data-starter]").forEach((b)=>{b.onclick=()=>{const inp=$("crewTaskInput");if(inp){inp.value=list[Number(b.dataset.starter)]||"";inp.focus()}}});
  const eb=$("crewStartersEdit");if(eb)eb.onclick=()=>openStartersSheet(role);
}
function closeStartersSheet(){const d=document.getElementById("crewStartersSheet");if(d)d.remove()}
function openStartersSheet(role){
  closeStartersSheet();
  const cur=getRoleStarters(role);
  const d=document.createElement("div");d.id="crewStartersSheet";d.className="crew-sheet";
  d.innerHTML=`<div class="crew-sheet-box" role="dialog" aria-label="${esc(t("crewStartersTitle"))}"><div class="crew-sheet-title">${esc(t("crewStartersTitle"))}</div><textarea id="crewStartersText" rows="4" maxlength="600" placeholder="${esc(t("crewStartersHint"))}">${esc(cur.join("\n"))}</textarea><button type="button" class="crew-sheet-btn" data-act="save">${esc(t("crewSave"))}</button><button type="button" class="crew-sheet-btn cancel" data-act="cancel">${esc(t("cancelBtn"))}</button></div>`;
  document.body.appendChild(d);
  const ta=d.querySelector("#crewStartersText");
  setTimeout(()=>ta?.focus({preventScroll:true}),60);
  d.addEventListener("click",(e)=>{
    if(e.target===d||e.target.closest('[data-act="cancel"]')){closeStartersSheet();return}
    const b=e.target.closest('[data-act="save"]');if(!b)return;
    const vals=String(ta?.value||"").split("\n").map((s)=>s.trim()).filter(Boolean).slice(0,4);
    const all=loadStarters();
    if(vals.length)all[role]=vals;else delete all[role];
    saveStarters(all);closeStartersSheet();renderRoleStarters();
    crewToast(t("crewStartersSaved"),"good");
  });
}

function bind(){
  const page=$("page-crew");if(!page)return;
  page.addEventListener("click",(e)=>{
    const f=e.target.closest("[data-filter]");
    if(f){state.taskFilter=f.dataset.filter;renderTasks();return}
    const ex=e.target.closest("#crewEventsExportBtn");
    if(ex){exportEventsJsonl();return}
    const tb=e.target.closest("[data-task]");
    if(tb&&tb.dataset.act){onTaskAction(tb.dataset.task,tb.dataset.act);return}
    /* v5.11.103: редактор критеріїв прийняття */
    const ce=e.target.closest("[data-crit-edit]");
    if(ce){state.critEditId=ce.dataset.critEdit;renderTasks();return}
    const cs=e.target.closest("[data-crit-save]");
    if(cs){saveCriteria(cs.dataset.critSave);return}
    const cc=e.target.closest("[data-crit-cancel]");
    if(cc){state.critEditId=null;renderTasks();return}
    const rb=e.target.closest("[data-release]");
    if(rb&&rb.dataset.act){onReleaseAction(rb.dataset.release,rb.dataset.act);return}
    /* v5.11.77: клік по картці агента → форма нового завдання з його роллю (не при виділенні тексту) */
    const card=e.target.closest(".crew-ocard");
    if(card&&card.dataset.role){
      if(window.getSelection&&window.getSelection().toString())return;
      openTaskForm(card.dataset.role);return;
    }
    /* v5.11.81: кнопка "До авторизації" при 401 */
    const ga=e.target.closest("[data-goto-auth]");
    if(ga){/* v5.11.94: showPage живе всередині app.js і звідси недоступна — кнопка нічого не робила. Перемикаємо через справжню вкладку. */
      const tab=document.querySelector('.tab[data-page="connections"]')||document.querySelector('[data-more-page="connections"]');if(tab)tab.click();return}
  });
  page.addEventListener("keydown",(e)=>{
    if((e.key==="Enter"||e.key===" ")&&e.target&&e.target.classList&&e.target.classList.contains("crew-ocard")&&e.target.dataset.role){
      e.preventDefault();openTaskForm(e.target.dataset.role);
    }
  });
  $("crewTaskCreate")?.addEventListener("click",createTask);
  /* v5.11.93: стартові запитання оновлюються зі зміною ролі */
  $("crewTaskRole")?.addEventListener("change",renderRoleStarters);
  $("crewCfgSave")?.addEventListener("click",saveConfig);
  $("crewStopAll")?.addEventListener("click",stopAll);
  $("crewRetry")?.addEventListener("click",refresh);
  /* v5.11.56: FAB органайзера — відкрити форму нового завдання */
  $("crewFab")?.addEventListener("click",()=>openTaskForm());
  document.addEventListener("aibridge:languagechange",()=>{fillRoleSelect(true);renderRoleStarters();renderAgents();renderTasks();renderEvents();renderReleases();renderConfig();renderMedia()});
  const obs=new MutationObserver(()=>{if(isActive())refresh()});
  obs.observe(page,{attributes:true,attributeFilter:["class"]});
  setInterval(()=>{if(isActive())refresh()},30000);
}

fillRoleSelect();
bind();
renderAgents();renderTasks();renderEvents();renderReleases();renderMedia();
if(isActive())refresh();
})();
