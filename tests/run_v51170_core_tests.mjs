/* v5.11.70 — Ядро (локальний движок core.js, zero dependencies, офлайн):
   1) core.js експортує detectLang/stats/keywords/summarize/answer/analyze;
   2) детерміновані перевірки кожної функції;
   3) інтеграція: PROVIDERS.core, i18n uk/en, _worker providers.core=true,
      sendTask перехоплює core, runLocalCore без fetch, index.html+sw.js. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),worker=R("_worker.js"),html=R("index.html"),sw=R("sw.js"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

const require=createRequire(import.meta.url);
const Core=require(path.join(root,"core.js"));

// 1. API поверхня
for(const fn of ["detectLang","stats","keywords","summarize","answer","analyze","tokenize","splitSentences"])
  ok(typeof Core[fn]==="function","core.js: експортує "+fn);

// 2. detectLang — детерміновано
ok(Core.detectLang("Мрій. Бо мрії витягують тебе з ями, коли ти впав.")==="uk","detectLang: uk");
ok(Core.detectLang("Не делай добра — не получишь зла. Важный принцип жизни.")==="ru","detectLang: ru");
ok(Core.detectLang("Humor helps overcome obstacles in life every single day.")==="en","detectLang: en");
ok(Core.detectLang("")==="en","detectLang: порожній → en");

// 3. stats — детерміновано
{
  const s=Core.stats("Раз. Два три. Чотири п'ять шість.");
  ok(s.sentences===3,"stats: 3 речення");
  ok(s.words===6,"stats: 6 слів");
  ok(s.chars>0&&s.complexity>=0&&s.complexity<=100,"stats: chars/complexity в межах");
  const e=Core.stats("");
  ok(e.words===0&&e.sentences===0,"stats: порожній текст → нулі");
}

// 4. keywords — топ за частотою, без стоп-слів
{
  const k=Core.keywords("Мрії мрії мрії. Плани плани. І слово.",5);
  ok(k[0].word==="мрії"&&k[0].count===3,"keywords: топ «мрії» ×3");
  ok(k[1].word==="плани"&&k[1].count===2,"keywords: друге «плани» ×2");
  ok(!k.some(x=>x.word==="і"),"keywords: стоп-слово «і» відсіяно");
}

// 5. summarize — повертає топ-N у порядку оригіналу
{
  const t="Мрій. Бо мрії витягують тебе з ями, коли ти впав. Які б ти плани не будував, але Бог завжди будує інші плани для тебе. Вір у себе і в тебе все вийде. Мрії дають сили рухатися вперед навіть у найтемніші часи життя.";
  const s2=Core.summarize(t,2);
  ok(s2.length===2,"summarize: рівно 2 речення");
  ok(t.indexOf(s2[0])<t.indexOf(s2[1]),"summarize: порядок оригіналу збережено");
  ok(s2.every(x=>t.includes(x)),"summarize: речення з оригіналу (екстрактивне)");
  ok(Core.summarize("",3).length===0,"summarize: порожній → []");
  ok(Core.summarize("Одне речення.",5).length===1,"summarize: коротший за N → все");
}

// 6. answer — релевантні речення з контексту
{
  const ctx="Мрій. Бо мрії витягують тебе з ями, коли ти впав. Не роби добра — не отримаєш зла. Гумор допомагає долати перешкоди в житті.";
  const a=Core.answer("що робити коли впав?",ctx,2);
  ok(a.length>=1&&a[0].includes("ями"),"answer: знаходить речення про яму");
  ok(Core.answer("щось невідоме",ctx,2).length===0||true,"answer: не падає на нерелевантному");
  ok(Core.answer("",ctx,2).length===0,"answer: порожнє питання → []");
}

// 7. analyze — комбінований звіт
{
  const r=Core.analyze("Мрій. Бо мрії витягують тебе з ями. Мрії дають сили.");
  ok(r.lang==="uk"&&r.stats.words>0&&r.keywords.length>0&&r.summary.length>0,"analyze: повний звіт uk");
}

// 8. Жодних мережевих викликів у core.js
ok(!/fetch\(|XMLHttpRequest|WebSocket|import\(/.test(R("core.js")),"core.js: нуль мережевих викликів");

// 9. Інтеграція: PROVIDERS
ok(/core:\{name:"Ядро",logo:"⚙"/.test(app),"app.js: PROVIDERS містить core");
ok(/local:true/.test(app),"app.js: core позначено local:true");
ok(!/core/.test(worker.match(/const PROVIDER_META=\{([\s\S]*?)\n\};/)[1]),"_worker.js: core НЕ в PROVIDER_META");

// 10. i18n uk/en
for(const k of ["coreProviderSub","coreBadge","coreNeedText","coreReportTitle","coreAnswerTitle","coreLang","coreStats","coreKeywords","coreSummary","coreLocalNote"])
  ok(i18n.includes(k+":"),"i18n.js: ключ "+k+" присутній");
ok(i18n.includes('coreProviderSub:"Локальний движок"'),"i18n.js: uk coreProviderSub");
ok(i18n.includes('coreProviderSub:"Local engine"'),"i18n.js: en coreProviderSub");
ok(i18n.includes('coreBadge:"Офлайн"'),"i18n.js: uk coreBadge");

// 11. _worker.js: providers.core=true
ok(/providers\.core=true/.test(worker),"_worker.js: /api/status встановлює providers.core=true");

// 12. sendTask перехоплює core
ok(/providers\.filter\(id=>id!=="muse"&&id!=="core"\)/.test(app),"app.js: sendTask виключає core з API-викликів");
ok(/function runLocalCore\(/.test(app),"app.js: runLocalCore визначено");
ok(/runLocalCore\(rawPrompt,source,coreCtx\)/.test(app),"app.js: runLocalCore викликається з контекстом файлів");
{
  const i=app.indexOf("function runLocalCore(");
  const body=app.slice(i,i+1500);
  ok(!/fetch\(/.test(body),"runLocalCore: без мережевих викликів (не імітує AI)");
  ok(body.includes("BridgeCore.analyze")&&body.includes("BridgeCore.answer"),"runLocalCore: використовує analyze/answer");
}
ok(/coreReportMd\(/.test(app),"app.js: форматер звіту ядра");

// 13. Чесність: не називаємо LLM
ok(i18n.includes("аналізатор тексту, а не чат-бот"),"i18n.js: чесно — аналізатор, не чат-бот");
ok(!/coreProviderSub:"[^"]*(LLM|нейромережа|штучний інтелект)/i.test(i18n),"i18n.js: Ядро не названо LLM");

// 14. Підключення: index.html + sw.js + бейдж
ok(html.includes('<script defer src="core.js"></script>'),"index.html: core.js підключено");
ok(sw.includes('"./core.js"'),"sw.js: core.js у precache");
ok(/\.coreBadge\{/.test(css),"styles.css: стиль .coreBadge");
ok(/localBadgeHtml\(id\)/.test(app),"app.js: localBadgeHtml для бейджів");

console.log(`\nPASS: ${passed} перевірок v5.11.70 (Ядро)`);
