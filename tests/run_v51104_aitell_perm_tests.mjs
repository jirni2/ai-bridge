/* v5.11.104 — перевірка на ШІ-маркери (anti-AI-tell) + чесні стани дозволів.
   1) app.js: AI_TELL_DICT (локальний словник uk/en), aiTellEscape, findAiTells (чиста),
      checkAiTells (панель з esc-екрануванням), $("aiTellBtn").onclick, cmdk-запис.
   2) Чесні стани дозволів: PERM_STATE, queryPermState (Permissions API, try/catch),
      permEffective/permLabelKey/applyPermToButton/refreshPermissionStates/initPermissionStates,
      виклик на старті + перерахунок після зміни мови, data-perm бейджі в CSS.
   3) i18n uk/en/ru: aiTellBtn, aiTellTitle, aiTellNone, aiTellInstead, aiTellEmpty,
      permMicNotAsked/Denied/Unavailable, permCamNotAsked/Denied/Unavailable, permUnknown.
   4) index.html: #aiTellBtn у moreMenu, #aiTellBox під відповіддю. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* --- 1. словник: витягаємо й виконуємо --- */
const dictM=app.match(/const AI_TELL_DICT=\[[\s\S]*?\n\];/);
ok(dictM,"app.js: AI_TELL_DICT знайдено");
const dictSrc=dictM[0].replace(/^const AI_TELL_DICT=/,"").replace(/;$/,"");
(0,eval)("var __AI_DICT=("+dictSrc+");");
const DICT=globalThis.__AI_DICT;
ok(Array.isArray(DICT)&&DICT.length>=30,"словник: ≥30 записів (uk+en), зараз "+DICT.length);
{
  const seen=new Set();
  for(const e of DICT){
    ok(e&&typeof e.p==="string"&&e.p.length>1,"запис має непорожній p");
    ok(e.lang==="uk"||e.lang==="en","запис "+JSON.stringify(e.p)+" має lang uk|en");
    ok(e.alt&&typeof e.alt.uk==="string"&&typeof e.alt.en==="string"&&typeof e.alt.ru==="string",
      "запис "+JSON.stringify(e.p)+" має заміни uk/en/ru");
    const k=e.p.toLowerCase();
    ok(!seen.has(k),"без дублів: "+e.p);seen.add(k);
  }
  ok(DICT.some(e=>e.lang==="uk"),"є українські маркери");
  ok(DICT.some(e=>e.lang==="en"),"є англійські маркери");
}
(0,eval)("var AI_TELL_DICT=globalThis.__AI_DICT;");
(0,eval)(grabFn(app,"aiTellEscape"));
(0,eval)(grabFn(app,"findAiTells"));
const findAiTells=globalThis.findAiTells;

/* --- 2. поведінка findAiTells --- */
{
  const hits=findAiTells("Let's delve into the tapestry of this robust landscape and leverage it");
  const marks=hits.map(h=>h.marker);
  for(const w of ["delve","tapestry","robust","landscape","leverage"])
    ok(marks.includes(w),"EN-маркер знайдено: "+w);
}
{
  const hits=findAiTells("DELVE deeper");
  ok(hits.some(h=>h.marker==="delve"),"регістронезалежність: DELVE → delve");
}
{
  const hits=findAiTells("He delves into details"); // "delves" ≠ "delve" (межа слова)
  ok(!hits.some(h=>h.marker==="delve"),"межа слова: 'delves' не дає хибного 'delve'");
}
{
  const hits=findAiTells("Важливо зазначити, що у сучасному світі це безперечно так. Крім того, більше того.");
  const marks=hits.map(h=>h.marker);
  for(const w of ["важливо зазначити","у сучасному світі","безперечно","крім того","більше того"])
    ok(marks.includes(w),"UK-маркер знайдено: "+w);
}
{
  const hits=findAiTells("Простий текст про кота без жодних штампів.");
  ok(Array.isArray(hits)&&hits.length===0,"чистий текст → 0 маркерів");
}
{
  const hits=findAiTells("delve and delve again, delve!");
  const d=hits.find(h=>h.marker==="delve");
  ok(d&&d.count===3,"лічильник повторів: delve ×3");
}
{
  const hits=findAiTells("delve robust delve");
  ok(hits[0].marker==="delve"&&hits[0].count===2,"сортування: частіший маркер першим");
}
{
  const hits=findAiTells("");
  ok(Array.isArray(hits)&&hits.length===0,"порожній рядок → []");
}

/* --- 3. checkAiTells: панель, екранування, закриття --- */
{
  ok(/function checkAiTells\(\)/.test(app),"app.js: checkAiTells визначено");
  const body=grabFn(app,"checkAiTells");
  ok(body.includes('esc(h.marker)')&&body.includes('t("aiTellTitle",{n:hits.length})'),"панель екранує маркери й заголовок через esc()");
  ok(body.includes("data-aitell-close"),"панель має кнопку закриття");
  ok(body.includes('$("aiTellBox")'),"панель рендериться в #aiTellBox");
  ok(body.includes("scrollIntoView"),"панель прокручується до себе");
}
ok(/\$\("aiTellBtn"\)\.onclick=\(\)=>checkAiTells\(\)/.test(app),"прив'язка: aiTellBtn → checkAiTells()");
ok(/label:t\("aiTellBtn"\),run:\(\)=>\$\("aiTellBtn"\)\?\.click\(\)/.test(app),"cmdk: запис «Перевірити на ШІ-маркери»");

/* --- 4. чесні стани дозволів --- */
{
  ok(/const PERM_STATE=\{mic:"unknown",cam:"unknown"\}/.test(app),"PERM_STATE ініціалізовано як unknown");
  const q=grabFn(app,"queryPermState");
  ok(q.includes("navigator.permissions")&&q.includes(".query({name})"),"queryPermState: читає Permissions API");
  ok(/catch\(e\)\{return "unknown"\}/.test(q),"queryPermState: помилка → unknown (iOS)");
  ok(!/\.request\(/.test(q),"queryPermState: НЕ запитує дозвіл, лише читає стан");
  const pe=grabFn(app,"permEffective");
  ok(pe.includes("window.SpeechRecognition")&&pe.includes("unavailable"),"permEffective: немає SpeechRecognition → unavailable");
  ok(pe.includes('getElementById("cameraInput")'),"permEffective: немає cameraInput → unavailable");
  const pk=grabFn(app,"permLabelKey");
  ok(pk.includes('base+"Denied"')&&pk.includes('base+"NotAsked"')&&pk.includes('base+"Unavailable"'),
    "permLabelKey: denied/prompt/unavailable → свої ключі");
  ok(/return null;/.test(pk),"permLabelKey: granted/unknown → звичайний підпис");
  const ap=grabFn(app,"applyPermToButton");
  ok(ap.includes("dataset.perm"),"applyPermToButton: виставляє data-perm для CSS-бейджа");
  ok(ap.includes('setAttribute("title"')&&ap.includes('setAttribute("aria-label"'),"applyPermToButton: чесний title + aria-label");
  const rp=grabFn(app,"refreshPermissionStates");
  ok(rp.includes('"voiceBtn"')&&rp.includes('"fileVoiceBtn"')&&rp.includes('"cameraBtn"'),
    "refreshPermissionStates: голос (чат+файли) і камера");
  ok(/initPermissionStates\(\);/.test(app),"initPermissionStates викликається на старті");
  ok(/addEventListener\("aibridge:languagechange",\(\)=>refreshPermissionStates\(\)\)/.test(app),
    "після зміни мови підписи дозволів перераховуються");
}

/* --- 5. i18n: усі ключі в трьох мовах --- */
{
  const keys=["aiTellBtn","aiTellTitle","aiTellNone","aiTellInstead","aiTellEmpty",
    "permMicNotAsked","permMicDenied","permMicUnavailable",
    "permCamNotAsked","permCamDenied","permCamUnavailable","permUnknown"];
  const blocks={};
  for(const [name,re] of [["V51104",/const V51104=\{([\s\S]*?)\n\};/]]){
    const m=i18n.match(re);ok(m,"i18n.js: блок "+name+" знайдено");blocks[name]=m[1];
  }
  for(const k of keys){
    ok(new RegExp(`${k}:"[^"]+"`).test(blocks.V51104),"i18n: ключ "+k+" присутній у V51104");
  }
  ok(/ru:\{aiTellBtn:"Проверить на ИИ-маркеры"/.test(blocks.V51104),"i18n: російський пакет у V51104");
}

/* --- 6. index.html --- */
ok(/<button id="aiTellBtn" class="actBtn"[^>]*>/.test(html),"index.html: кнопка #aiTellBtn");
ok(html.indexOf('id="aiTellBtn"')>html.indexOf('id="quoteCardBtn"'),"#aiTellBtn — у меню «•••» поруч із контент-діями");
ok(/<div id="aiTellBox" class="translationBox hidden" aria-live="polite"><\/div>/.test(html),"index.html: #aiTellBox під відповіддю");
ok(/data-i18n="aiTellBtn"/.test(html),"кнопка локалізується через data-i18n");

/* --- 7. styles.css --- */
ok(/\.aiTellList\{/.test(css),"CSS: .aiTellList");
ok(/\.aiTellMark\{/.test(css),"CSS: .aiTellMark (підсвітка маркера)");
ok(/\.composerToolBtn\[data-perm="denied"\]::after/.test(css),"CSS: червона крапка для denied");
ok(/\.composerToolBtn\[data-perm="prompt"\]::after/.test(css),"CSS: бурштинова крапка для prompt");
ok(/\.composerToolBtn\[data-perm="unavailable"\]\{opacity/.test(css),"CSS: приглушення для unavailable");

/* --- 8. безпека: жодних нових зовнішніх викликів --- */
{
  const aiTellSection=app.slice(app.indexOf("v5.11.104: перевірка тексту"),app.indexOf("v5.11.65: long-press"));
  ok(!/fetch\s*\(\s*["']https?:/.test(aiTellSection),"AI-tell: жодних мережевих викликів — локально");
  ok(!/innerHTML\s*=\s*[^;]*h\.marker[^;]*\+/.test(aiTellSection)||/esc\(h\.marker\)/.test(aiTellSection),
    "AI-tell: маркери вставляються лише через esc()");
}

console.log(`\nPASS: ${passed} перевірок`);
