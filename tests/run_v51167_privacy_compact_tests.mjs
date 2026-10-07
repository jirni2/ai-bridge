/* v5.11.67 — Центр приватності (путівник) + видиме стиснення (маркер,
   прогноз, чесна вартість):
   1) countAgentPairs: чиста — рахує ходи користувача.
   2) compactMarkHtml: банер маркера (details), цифри «N → ~ch», вартість,
      старі маркери без цифр — той самий вигляд; digest ескейпиться.
   3) privacyStatus: статуси рядків (пам'ять/тимчасовий/історія).
   4) Каркас: функції в app.js, проводка сторінки, DOM в index.html,
      класи в styles.css, i18n uk+en (V51167). */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* ---------- 1. countAgentPairs ---------- */
globalThis.t=(k,v)=>k; // заглушка до eval нижче
(0,eval)(`${grabFn(app,"countAgentPairs")}`);
ok(countAgentPairs([])===0,"порожньо → 0");
ok(countAgentPairs(null)===0,"null → 0");
ok(countAgentPairs([{role:"user",text:"a"}])===1,"1 user → 1");
ok(countAgentPairs([{role:"user",text:"a"},{role:"assistant",text:"b"},{role:"user",text:"c"},{role:"assistant",text:"d"}])===2,"2 пари → 2");
ok(countAgentPairs([{role:"user",text:"a"},{role:"user",text:""}])===2,"user без тексту? — текст є, 2");
ok(countAgentPairs([{role:"user",text:null},{role:"assistant",text:"x"}])===0,"user без тексту не рахується");
{
  const msgs=[];for(let i=0;i<7;i++){msgs.push({role:"user",text:"q"+i},{role:"assistant",text:"a"+i})}
  ok(countAgentPairs(msgs)===7,"7 ходів → 7 (прогноз: need=5-7<0 → підказка ховається)");
}
{
  const msgs=[];for(let i=0;i<3;i++){msgs.push({role:"user",text:"q"+i},{role:"assistant",text:"a"+i})}
  const need=5-countAgentPairs(msgs);
  ok(need===2,"3 ходи → ще 2 до доступного стиснення");
}

/* ---------- 2. compactMarkHtml ---------- */
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function groupNum(n){return String(Math.max(0,Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g," ")}
globalThis.esc=esc;globalThis.groupNum=groupNum;
const T=(k,vars)=>{const s={compactMarkTitle:"Стиснення контексту",compactMarkStats:"{n} повідомлень → ~{ch} символів",compactMarkCost:"Стиснення виконано локально — 0 токенів, без звернень до моделей.",privMemSt:"маркерів стиснення в діалозі агента: {n}",privHistSt:"записів: {n}",privGuardSt:"Завжди ввімкнено",privOn:"Увімкнено",privOff:"Вимкнено"}[k]||k;
  return String(s).replace(/\{(\w+)\}/g,(_,x)=>vars&&vars[x]!==undefined?String(vars[x]):`{${x}}`)};
globalThis.t=T;
(0,eval)(`${grabFn(app,"compactMarkHtml")}`);
{
  const h=compactMarkHtml({text:"ПЕРЕКАЗ\n\nuser a; assistant b",compacted:true,compactedCount:14,compactedChars:790});
  ok(h.startsWith("<details class=\"compactMark\""),"банер — <details class=\"compactMark\">");
  ok(h.includes("14 повідомлень → ~790 символів"),"цифри «N повідомлень → ~ch символів»");
  ok(h.includes("0 токенів"),"чесна вартість: локально, 0 токенів");
  ok(h.includes("user a; assistant b"),"дайджест у тілі details");
}
{
  const h=compactMarkHtml({text:"ПЕРЕКАЗ\n\n<b>хай</b>",compacted:true}); // старий маркер без цифр
  ok(h.includes("Стиснення контексту"),"старий маркер — лише заголовок без цифр");
  ok(h.includes("&lt;b&gt;хай&lt;/b&gt;"),"дайджест ескейпиться (XSS-захист)");
  ok(!h.includes("<b>хай</b>")||h.includes("&lt;b&gt;"),"сирий HTML не проходить");
}
{
  const h=compactMarkHtml({text:"лише заголовок",compacted:true,compactedCount:0});
  ok(h.includes("Стиснення контексту"),"без \\n\\n — тіло = весь текст");
}

/* ---------- 3. privacyStatus ---------- */
globalThis.agentMessages=[{compacted:true},{compacted:true},{role:"user",text:"x"}];
globalThis.tempChatOn=()=>"";
globalThis.promptHistory=()=>["a","b","c"];
(0,eval)(`${grabFn(app,"privacyStatus")}`);
ok(privacyStatus({act:"ctx",st:"privMemSt"}).includes("2"),"пам'ять: 2 маркери стиснення");
globalThis.tempChatOn=()=>true;
ok(privacyStatus({act:"temp"})==="Увімкнено","тимчасовий: увімкнено → privOn");
globalThis.tempChatOn=()=>false;
ok(privacyStatus({act:"temp"})==="Вимкнено","тимчасовий: вимкнено → privOff");
ok(privacyStatus({act:"hist",st:"privHistSt"}).includes("3"),"історія: 3 записи");
ok(privacyStatus({st:"privGuardSt"})==="Завжди ввімкнено","вартовий: завжди ввімкнено (без кнопки дії)");

/* ---------- 4. каркас ---------- */
ok(app.includes("function renderPrivacy()"),"app.js: renderPrivacy");
ok(app.includes("function privacyAction("),"app.js: privacyAction");
ok(app.includes("if(m&&m.compacted)return compactMarkHtml(m)"),"renderAgentThread: маркери → compactMarkHtml");
ok(app.includes('if(name==="privacy")renderPrivacy()'),"showPage: проводка privacy");
ok(app.includes("compactedCount:parts.older.length"),"маркер несе compactedCount");
ok(app.includes("ctxCompactedStats"),"тост зі статистикою стиснення");
ok(app.includes("ctxCompactSoon"),"прогноз під кнопкою стиснення");
ok(html.includes('id="page-privacy"'),"index.html: секція page-privacy");
ok(html.includes('id="privacyList"'),"index.html: #privacyList");
ok(html.includes('data-more-page="privacy"'),"index.html: пункт меню Приватність");
ok(html.includes('id="ctxCompactHint"'),"index.html: #ctxCompactHint");
ok(css.includes(".compactMark"),"styles.css: .compactMark");
ok(css.includes(".privRow")||css.includes(".privBody"),"styles.css: стилі приватності");
ok(css.includes(".ctxCompactHint"),"styles.css: .ctxCompactHint");
for(const k of ["navPrivacy","morePrivacy","privacyDesc","privManage","privAlwaysOn","privMemT","privMemD","privMemSt","privTempT","privTempD","privTempToggled","privGuardT","privGuardD","privHistT","privHistD","privHistSt","privHistConfirm","privDataT","privDataD","privExportT","privExportD","privBudgetT","privBudgetD","compactMarkTitle","compactMarkStats","compactMarkCost","ctxCompactedStats","ctxCompactSoon"]){
  ok(i18n.includes(k+":"),"i18n.js: ключ "+k);
}
{
  const m=i18n.match(/const V51167=\{\s*en:\{([\s\S]*?)\},\s*uk:\{([\s\S]*?)\}\s*\};/);
  ok(!!m,"i18n.js: блок V51167 en+uk");
  if(m){ok(m[1].length>200&&m[2].length>200,"V51167: обидва паки непорожні")}
}
/* CSS без хардкод-hex поза :root (правило гейту) */
{
  const lines=css.split("\n");let inRoot=false,brace=0,bad=[];
  lines.forEach((ln,i)=>{
    if(/^\s*:root/.test(ln))inRoot=true;
    brace+=(ln.match(/\{/g)||[]).length-(ln.match(/\}/g)||[]).length;
    if(inRoot&&brace===0)inRoot=false;
    if(!inRoot&&/#[0-9a-fA-F]{3,8}\b/.test(ln)&&!ln.trim().startsWith("/*"))bad.push(i+1);
  });
  ok(bad.length===0,"CSS: хардкод-hex лише в :root (рядки: "+bad.join(",")+")");
}

console.log("\nALL PASS:",passed);
