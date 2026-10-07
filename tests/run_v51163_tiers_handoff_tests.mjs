/* v5.11.63 — Цінові тири на кнопці вибору моделі + «Копіювати для ШІ»:
   1) providerCostTier: мапінг PROVIDER_EST_PRICE (in+out $/1M) → тир 0..3
      (0 — безкоштовно, 1 — ≤1$, 2 — ≤10$, 3 — дорожче).
   2) costTierDots / costTierNameKey: ○/●/●●/●●● і ключ назви тиру.
   3) buildHandoffText: машинно-читабельний транскрипт діалогу (ролі+текст+модель).
   4) Каркас: кнопка #handoffBtn у moreMenu, wiring у app.js, costTierHtml(id)
      в обох гілках renderProviders, i18n uk+en (V51163), CSS .costTier. */
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
const priceM=app.match(/^const PROVIDER_EST_PRICE=\{[\s\S]*?\n\};/m);
if(!priceM)throw new Error("FAIL: не знайдено PROVIDER_EST_PRICE");
(0,eval)(`${priceM[0]}\n${grabFn(app,"providerCostTier")}\n${grabFn(app,"costTierDots")}\n${grabFn(app,"costTierNameKey")}\n${grabFn(app,"buildHandoffText")}`);

/* --- 1. тири --- */
ok(providerCostTier("groqfree")===0,"groqfree → 0 (безкоштовно)");
ok(providerCostTier("openrouter")===0,"openrouter → 0 (безкоштовно)");
ok(providerCostTier("muse")===0,"muse (немає в таблиці) → 0");
ok(providerCostTier("nope")===0,"невідомий провайдер → 0");
ok(providerCostTier("gemini")===1,"gemini (0.5) → 1 (дешево)");
ok(providerCostTier("openai")===3,"openai (11.25) → 3 (дорого)");
ok(providerCostTier("claude")===3,"claude (18) → 3 (дорого)");
ok(providerCostTier("grok")===3,"grok (18) → 3 (дорого)");

/* --- 2. крапки й назви --- */
ok(costTierDots(0)==="○","тир 0 → ○");
ok(costTierDots(1)==="●","тир 1 → ●");
ok(costTierDots(2)==="●●","тир 2 → ●●");
ok(costTierDots(3)==="●●●","тир 3 → ●●●");
ok(costTierDots(9)==="●●●","тир 9 клампиться до ●●●");
ok(costTierDots(-2)==="○","від'ємний тир → ○");
ok(costTierDots("x")==="○","сміття → ○");
ok(costTierNameKey(0)==="tierFree","0 → tierFree");
ok(costTierNameKey(1)==="tierCheap","1 → tierCheap");
ok(costTierNameKey(2)==="tierMid","2 → tierMid");
ok(costTierNameKey(3)==="tierPricey","3 → tierPricey");

/* --- 3. handoff-текст --- */
{
  const t1=buildHandoffText({youLabel:"Запитання",aiLabel:"Відповідь",question:"Що таке сайдинг?",answer:"Панелі для фасаду.",model:"Gemini"});
  ok(t1==="Запитання: Що таке сайдинг?\n\nВідповідь (Gemini): Панелі для фасаду.","формат з моделлю");
  const t2=buildHandoffText({youLabel:"Question",aiLabel:"Answer",question:"  hi  ",answer:"  hello  ",model:""});
  ok(t2==="Question: hi\n\nAnswer: hello","без моделі — без дужок, trim");
  const t3=buildHandoffText({youLabel:"Запитання",aiLabel:"Відповідь",question:"q",answer:"a",model:null});
  ok(t3.includes("Відповідь: a")&&!t3.includes("("),"null-модель — без дужок");
}

/* --- 4. каркас --- */
ok(html.includes('id="handoffBtn"'),"index.html: кнопка #handoffBtn");
ok(html.includes('data-i18n="handoffBtn"'),"index.html: data-i18n=handoffBtn");
ok(app.includes('$("handoffBtn")?.addEventListener("click",copyAiHandoff)'),"app.js: wiring кліку handoffBtn");
ok((app.match(/costTierHtml\(id\)/g)||[]).length>=2,"app.js: costTierHtml(id) в обох гілках renderProviders");
ok(app.includes("function costTierHtml(id)"),"app.js: costTierHtml визначено");
ok(app.includes('"handoffBtn","exportMdBtn"')||app.includes('"exportMdBtn","handoffBtn"'),"app.js: handoffBtn у списку видимості кнопок відповіді");
{
  const blk=i18n.match(/const V51163=\{[\s\S]*?\n\};/);
  ok(!!blk,"i18n.js: блок V51163 існує");
  const enPart=blk[0].match(/en:\{[^}]*\}/)[0],ukPart=blk[0].match(/uk:\{[^}]*\}/)[0];
  for(const k of ["tierFree","tierCheap","tierMid","tierPricey","handoffBtn","handoffYou","handoffAi","handoffCopied"]){
    ok(enPart.includes(k+":"),"V51163 en має "+k);
    ok(ukPart.includes(k+":"),"V51163 uk має "+k);
  }
  ok(enPart.includes('continueBtn:"▶ Continue"'),"V51163 en лагоджує continueBtn (v5.11.61)");
}
ok(css.includes(".costTier"),"styles.css: .costTier");
ok(css.includes(".costTier.t0"),"styles.css: .costTier.t0 (безкоштовно)");

console.log(`\nPASS: ${passed} перевірок v5.11.63`);
