/* AI Bridge v5.10.0 — Trade Metrics tab (same-origin /api/trade/*). */
const $=id=>document.getElementById(id);
const fmtUSD=v=>v==null||!Number.isFinite(Number(v))?"—":"$"+Number(v).toFixed(2);
const fmtPct=v=>v==null||!Number.isFinite(Number(v))?"—":Number(v).toFixed(1)+"%";
const fmt2=v=>v==null||!Number.isFinite(Number(v))?"—":Number(v).toFixed(2);
const CARDS=[
  {k:"winRate",label:"Win Rate",fmt:fmtPct},
  {k:"profitFactor",label:"Profit Factor",fmt:fmt2},
  {k:"sharpe",label:"Sharpe",fmt:fmt2},
  {k:"maxDrawdown",label:"Max Drawdown",fmt:fmtPct},
  {k:"calmar",label:"Calmar",fmt:fmt2},
  {k:"avgWin",label:"Середній виграш",fmt:fmtUSD},
  {k:"avgLoss",label:"Середній програш",fmt:fmtUSD},
  {k:"currentDrawdown",label:"Просадка зараз",fmt:fmtPct},
  {k:"dailyPnl",label:"Денний P&L",fmt:fmtUSD,sub:m=>m.dailyLimit!=null?`ліміт $${Number(m.dailyLimit).toFixed(2)}`:""},
  {k:"tradesToday",label:"Угод сьогодні",fmt:v=>v==null?"—":String(v)},
];
async function api(path,body){
  const r=await fetch(path,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",
    headers:body?{"Content-Type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}
function cardHTML(c,m){
  const v=m[c.k];
  return `<article class="mCard"><small>${c.label}</small><strong class="${c.k==="dailyPnl"&&v<0?"neg":c.k==="dailyPnl"&&v>0?"pos":""}">${c.fmt(v)}</strong>${c.sub?`<span>${c.sub(m)}</span>`:""}</article>`;
}
function equitySVG(equity){
  const W=600,H=170,P=10;
  if(!equity||equity.length<2)return `<div class="mEmpty">📈 Недостатньо точок для графіка equity.</div>`;
  const pts=equity.map(p=>Array.isArray(p)?p[1]:(p.v??p.value));
  const min=Math.min(...pts),max=Math.max(...pts),span=(max-min)||1;
  const xy=pts.map((v,i)=>[P+i*(W-2*P)/(pts.length-1),H-P-(v-min)/span*(H-2*P)]);
  const line=xy.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last=xy[xy.length-1];
  return `<svg class="mEquity" viewBox="0 0 ${W} ${H}" role="img" aria-label="Графік equity">
    <polygon points="${P},${H-P} ${line} ${last[0].toFixed(1)},${H-P}" fill="rgba(98,212,187,.15)"/>
    <polyline points="${line}" fill="none" stroke="#62d4bb" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="#62d4bb"/>
  </svg>`;
}
function monthlyHTML(monthly){
  if(!monthly||!monthly.length)return `<div class="mEmpty">📊 Місячних даних поки немає.</div>`;
  const max=Math.max(...monthly.map(x=>Math.abs(Number(x.pnl??x.value??0))))||1;
  return `<div class="mBars">`+monthly.map(x=>{
    const v=Number(x.pnl??x.value??0),h=Math.max(4,Math.abs(v)/max*90);
    return `<div class="mBarWrap"><div class="mBar ${v>=0?"pos":"neg"}" style="height:${h.toFixed(0)}px" title="${v>=0?"+":""}${v.toFixed(2)} USDT"></div><span>${String(x.m??x.month??"").slice(0,7)}</span></div>`;
  }).join("")+`</div>`;
}
function emptyHTML(){
  return `<div class="mEmpty">📊 Поки що немає даних метрик.<br><span>Запусти серверного бота або дочекайся перших угод.</span></div>`;
}
/* --- inline confirm bottom sheet (standalone page, no app.js) --- */
function confirmUI(text){
  return new Promise(res=>{
    const old=$("mConfirm");if(old)old.remove();
    const d=document.createElement("div");
    d.id="mConfirm";d.className="mConfirm";
    d.innerHTML=`<div class="mConfirmBox" role="dialog" aria-modal="true"><p>${text.replace(/</g,"&lt;")}</p>
      <div class="mConfirmBtns"><button id="mConfirmNo">Скасувати</button><button id="mConfirmYes" class="danger">Підтвердити</button></div></div>`;
    document.body.append(d);
    const done=v=>{d.remove();res(v)};
    $("mConfirmNo").onclick=()=>done(false);
    $("mConfirmYes").onclick=()=>done(true);
    d.addEventListener("click",e=>{if(e.target===d)done(false)});
  });
}
async function botCommand(action){
  return api("/api/trade/bot/command",{action});
}
async function refresh(){
  const grid=$("mCards"),eq=$("mEquity"),mo=$("mMonthly"),st=$("mBotStatus");
  try{
    const [mj,bj]=await Promise.all([
      api("/api/trade/metrics").catch(e=>({error:String(e.message||e)})),
      api("/api/trade/bot").catch(()=>null),
    ]);
    const m=mj&&mj.ok===false?null:(mj.metrics||mj);
    if(!m||mj.error){grid.innerHTML="";eq.innerHTML=emptyHTML();mo.innerHTML="";}
    else{
      grid.innerHTML=CARDS.map(c=>cardHTML(c,m)).join("");
      eq.innerHTML=equitySVG(m.equity);
      mo.innerHTML=monthlyHTML(m.monthly);
    }
    if(bj){
      const s=bj.status||"—";
      st.textContent=`Бот: ${s==="running"?"● працює":s==="paused"?"⏸ на паузі":"○ "+s} · ${bj.symbol||""} ${bj.interval||""}`;
      $("mPause").textContent=s==="running"?"⏸ Пауза":"▶ Продовжити";
      $("mPause").dataset.mode=s==="running"?"pause":"resume";
    }
    $("mUpdated").textContent="Оновлено "+new Date().toLocaleTimeString("uk-UA");
  }catch(e){
    grid.innerHTML="";eq.innerHTML=`<div class="mEmpty">⚠️ ${String(e.message||e).replace(/</g,"&lt;")}</div>`;
  }
}
async function onPause(){
  const mode=$("mPause").dataset.mode||"pause";
  try{
    if(mode==="resume"){const b=$("autoStart");if(b)b.click();else await botCommand("start");}
    else{const b=$("autoPause");if(b)b.click();else await botCommand("pause");}
    setTimeout(refresh,1200);
  }catch(e){alert(e.message)}
}
async function onStopAll(){
  if(!await confirmUI("Зупинити серверного бота? Відкрита позиція <b>не</b> продається автоматично — перевір її на Binance."))return;
  const b=$("autoStop");if(b)b.click();else{try{await botCommand("stop")}catch(e){alert(e.message)}}
  setTimeout(refresh,1200);
}
async function onReconcile(){
  $("mReconcile").disabled=true;
  try{await botCommand("reconcile");$("mUpdated").textContent="Звірку запитано…";setTimeout(refresh,2500)}
  catch(e){alert(e.message)}
  finally{$("mReconcile").disabled=false}
}
$("mRefresh").onclick=refresh;
$("mPause").onclick=onPause;
$("mStopAll").onclick=onStopAll;
$("mReconcile").onclick=onReconcile;
refresh();
setInterval(refresh,30000);
