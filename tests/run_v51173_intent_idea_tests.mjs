/* v5.11.73 — розумне поле вводу (intent-aware composer) + «Запропонувати ідею» з «Що нового»:
   1) detectComposerIntents: чисті евристики — порівняння → debate, довге доручення → agent,
      глибина → deep, стислість → fast; «коротко» сильніше за «детально»; коротке — нічого.
   2) intentNameKey / intentIcon: мапінг ідентифікаторів.
   3) Каркас: #intentChips, #suggestIdeaBtn, #ideaSheet (+поля) в index.html; проводка в app.js;
      V51173 uk+en в i18n.js; стилі без хардкод-hex.
   4) Сервер: маршрут POST /api/idea + handleIdea (KV idea:v1) у _worker.js. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css"),worker=R("_worker.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
function grabConstArray(src,name){
  const m=src.match(new RegExp("^const "+name+"=\\[([\\s\\S]*?)\\n\\];","m"));
  if(!m)throw new Error("FAIL: не знайдено const "+name);
  return "const "+name+"=["+m[1]+"\n];";
}

(0,eval)(
  grabConstArray(app,"INTENT_PATTERNS")+"\n"+
  grabFn(app,"detectComposerIntents")+"\n"+
  grabFn(app,"intentNameKey")+"\n"+
  grabFn(app,"intentIcon")
);

/* ---------- 1. detectComposerIntents ---------- */
{
  ok(JSON.stringify(detectComposerIntents("порівняй iPhone і Samsung, що краще?"))==JSON.stringify(["debate"]),"порівняння → debate");
  ok(JSON.stringify(detectComposerIntents("vs code чи sublime: плюси і мінуси?"))==JSON.stringify(["debate"]),"англійське vs → debate");
  const task="зроби повний аналіз цін на вініловий сайдинг у Вінніпезі, підготуй таблицю з маржею і доставкою";
  ok(task.length>=60&&detectComposerIntents(task).includes("agent"),"довге доручення → agent");
  ok(JSON.stringify(detectComposerIntents("детально поясни покроково"))==JSON.stringify(["deep"]),"детально → deep");
  ok(JSON.stringify(detectComposerIntents("коротко: що таке сайдинг"))==JSON.stringify(["fast"]),"коротко → fast");
  ok(JSON.stringify(detectComposerIntents("write a short summary"))==JSON.stringify(["fast"]),"англійське short → fast");
  const conflict=detectComposerIntents("коротко і детально поясни різницю");
  ok(conflict.includes("fast")&&!conflict.includes("deep"),"«коротко» сильніше за «детально»");
  ok(JSON.stringify(detectComposerIntents("привіт"))==JSON.stringify([]),"короткий текст → нічого");
  ok(JSON.stringify(detectComposerIntents(""))==JSON.stringify([]),"порожньо → нічого");
  ok(detectComposerIntents("порівняй, детально і коротко, що краще vs проти, зроби і підготуй довгий текст "+ "x".repeat(80)).length<=3,"не більше 3 чипів");
}

/* ---------- 2. intentNameKey / intentIcon ---------- */
{
  ok(intentNameKey("debate")==="intentDebate"&&intentNameKey("deep")==="intentDeep"&&intentNameKey("fast")==="intentFast"&&intentNameKey("agent")==="intentAgent","intentNameKey: мапінг");
  ok(intentIcon("debate")==="⚖"&&intentIcon("deep")==="🧠"&&intentIcon("fast")==="⚡"&&intentIcon("agent")==="✦","intentIcon: мапінг");
}

/* ---------- 3. Каркас ---------- */
{
  ok(html.includes('id="intentChips"'),"index.html: #intentChips");
  ok(html.includes('id="suggestIdeaBtn"'),"index.html: #suggestIdeaBtn");
  ok(html.includes('id="ideaSheet"'),"index.html: #ideaSheet");
  ok(html.includes('id="ideaTitle"')&&html.includes('id="ideaDesc"')&&html.includes('id="ideaSendBtn"'),"index.html: поля форми ідеї");
  ok(html.includes('data-i18n="ideaSuggest"'),"index.html: data-i18n ideaSuggest");
  ok(app.includes("wireIntentChips();wireIdeaSheet();"),"app.js: проводка в init");
  ok(app.includes('ta.addEventListener("input"')&&app.includes("refreshIntentChips"),"app.js: intent на події input");
  ok(app.includes('fetch("/api/idea"')&&app.includes('credentials:"same-origin"'),"app.js: POST /api/idea з сесійною авторизацією");
  ok(app.includes("applyComposerIntent")&&app.includes('[data-modechip="${q}"]')&&app.includes('const q=id==="debate"?"debate"')&&app.includes('#effortChips [data-effort="${id}"]'),"app.js: чипи натискають СПРАВЖНІ кнопки");
  ok(i18n.includes("const V51173="),"i18n.js: блок V51173");
  for(const k of ["intentDebate","intentDeep","intentFast","intentAgent","intentDismiss","intentApplied","ideaSuggest","ideaSheetTitle","ideaSheetHint","ideaName","ideaNamePh","ideaText","ideaTextPh","ideaSend","ideaNeedTitle","ideaSent","ideaFail"]){
    const ukRe=new RegExp('uk:\\{[^]*?'+k+':"');
    ok(i18n.includes("en:{" )&&ukRe.test(i18n),"i18n.js: ключ "+k+" у uk+en");
  }
  ok(css.includes(".intentChips")&&css.includes(".intentChip")&&css.includes(".ideaForm"),"styles.css: стилі intent/idea");
  const newCss=css.slice(css.indexOf("v5.11.73"));
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(newCss),"styles.css: новий блок без хардкод-hex (тільки токени)");
}

/* ---------- 4. Сервер ---------- */
{
  ok(worker.includes('url.pathname==="/api/idea"&&["GET","POST"].includes(req.method)'),"_worker.js: маршрут GET/POST /api/idea");
  ok(worker.includes("function handleIdea(req,env)"),"_worker.js: handleIdea");
  ok(worker.includes('const IDEA_KV_KEY="idea:v1"'),"_worker.js: KV-ключ idea:v1");
  ok(worker.includes("containsSecretLike(title"),"_worker.js: секретоподібний текст не зберігається");
  ok(worker.includes("cleanIdeaText"),"_worker.js: санітизація вводу");
}

console.log("\nPASS:",passed,"перевірок");
