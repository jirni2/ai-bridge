/* Тести v5.11.108: розумніше Ядро, чесна лотерея, коди авто, структура і дизайн.
   Запуск: node tests/run_v511108_improve_tests.mjs */
import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=f=>fs.readFileSync(path.join(root,f),"utf8");
const C=require("../core.js");
let pass=0,fail=0;
function ok(name,cond,extra){if(cond)pass++;else{fail++;console.log("FAIL: "+name+(extra!==undefined?" — "+JSON.stringify(extra).slice(0,220):""))}}
const ver=JSON.parse(R("bridge-version.json")).version;
ok("VERSION="+ver,C.VERSION===ver,C.VERSION);

/* ---------- 1. Ядро: нова математика і календар (3 мови) ---------- */
const fixed=new Date(2026,9,9,12,0,0);
const A=C.createAssistant({now:()=>fixed});
const ask=q=>A.respond(q);
const cases=[
  ["Розклади на множники 360",/360 = 2\^3 × 3\^2 × 5/,"math"],
  ["factorize 97",/97\*\* is a prime/,"math"],
  ["Чи є 97 простим?",/просте число/,"math"],
  ["Is 91 a prime?",/91 = 7 × 13/,"math"],
  ["Является ли 1 простым?",/не простое/,"math"],
  ["НСД 48 і 36",/НСД\(48, 36\) = 12/,"math"],
  ["НОК 4 и 6",/НОК\(4, 6\) = 12/,"math"],
  ["lcm of 21 and 6",/LCM\(21, 6\) = 42/,"math"],
  ["Скільки буде 1/3 + 1/4",/точно: \*\*7\/12\*\*/,"math"],
  ["Скільки буде 2/3*3/7",/2\/7/,"math"],
  ["Чому дорівнює 7*6",/= 42/,"math"],
  ["Що таке 0.5+0.25",/= 0\.75/,"math"],
  ["Скільки днів у лютому 2028?",/29 днів/,"date"],
  ["Сколько дней в феврале 2027",/28 дней/,"date"],
  ["How many days in February 2024?",/29 days/,"date"],
  ["Чи високосний 2100 рік?",/не високосний/,"date"],
  ["2024 високосний?",/високосний рік \(366/,"date"],
  ["Is 2000 a leap year",/is a leap year/,"date"],
  ["Який зараз рік?",/2026/,"date"],
  ["Як тебе звати?",/Ядро AI Bridge/,"identity"],
  ["What's your name?",/./,"identity"],
  ["Порахуй слова: мама мила раму",/слів: 3/,"text"],
];
for(const [q,re,intent] of cases){
  const r=ask(q);
  ok("Ядро: «"+q+"»",r&&r.handled!==false&&r.intent===intent&&re.test(String(r.text||"")),{intent:r&&r.intent,text:String(r&&r.text||"").slice(0,120)});
}
ok("10/4 — без зайвого «точно» (дріб скінченний)",!/точно/.test(ask("Скільки буде 10/4").text));
ok("ділення на нуль — як раніше",/нуль/.test(ask("Скільки буде 1/0").text));
ok("завеликі числа — чесна відмова",ask("Розклади на множники 99999999999999").handled===false);
ok("детермінізм",JSON.stringify(ask("Розклади на множники 360"))===JSON.stringify(ask("Розклади на множники 360")));
ok("нове не перехоплює звичайні питання",ask("Що таке любов?").intent==="unknown");
ok("стара математика не зламалась",/= 36/.test(ask("Скільки буде 15% від 240?").text));

/* ---------- 2. Лотерея: чесна точка відліку ---------- */
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css"),html=R("index.html");
ok("лотерея: без статистики — випадковий рівень, а не 0.5",/c\.accuracy=\(st&&typeof st\.ema==="number"\)\?\+st\.ema\.toFixed\(4\):lottoBaseline\(g\)/.test(worker));
ok("лотерея: EMA стартує з випадкового рівня",/stats\[id\]\|\|\{ema:lottoBaseline\(g\),count:0\}/.test(worker));
ok("лотерея: «успішна стратегія» = ≥1.5×випадкового і ≥10 перевірок",/c\.accuracy>=base\*1\.5&&c\.checks>=10/.test(worker));
ok("лотерея: odds/baseline/randomness у відповіді",/baseline:base,odds:lottoOdds\(gameId\),randomness:lottoRandomness\(freq,ds\.length,g\)/.test(worker));
ok("лотерея: картка «Чесні шанси» в UI",/lottoOddsTitle/.test(app)&&/lottoOddsJackpot/.test(app)&&/lottoRandomLevel/.test(app));
for(const k of ["lottoOddsTitle","lottoOddsJackpot","lottoOddsTicket","lottoOddsRandom","lottoRandOk","lottoRandOdd","lottoRandomLevel","lottoChecks"])
  ok("i18n "+k+" (en/uk/ru)",(i18n.match(new RegExp("\\b"+k+":","g"))||[]).length>=3);

/* ---------- 3. Коди помилок ---------- */
const data=R("dtc-data.js");
for(const c of ["P0011","P0016","P0087","P0299","P2096","P242F","P2463","P20EE","C0035","B0100"])
  ok("DTC: є поширений код "+c,data.includes('{c:"'+c+'"'));
const manu=(data.match(/,mk:"/g)||[]).length;
ok("DTC: коди виробника мають марку (mk) — "+manu,manu>=180);
ok("DTC: lookup повертає всі варіанти марок",/if\(hits\.length>1\)first\.variants=hits\.map\(dtcEntry\)/.test(worker));
ok("DTC: невідомий код правильного формату — розбір структури",/return dtcDecodeStructure\(c\)/.test(worker));
ok("DTC: марка з VIN передається в пошук",/&make="\+encodeURIComponent\(dtcLastMake\)/.test(app));
ok("DTC: inject-dtc працює повторно (маркери START/END)",/!worker\.includes\("\/\*__DTC_DATA_START__\*\/"\)/.test(R("tools/inject-dtc.mjs")));
{
  const a=worker.indexOf("/*__DTC_DATA_START__*/"),b=worker.indexOf("/*__DTC_DATA_END__*/");
  const f=worker.indexOf("const DTC_SYS="),e=worker.indexOf("function dtcSearch(q){");
  const L=new Function((worker.slice(a,b)+"\n"+worker.slice(f,e))+";return dtcLookup;")();
  const r=L("P1336");
  ok("DTC: P1336 — кілька марок",r&&Array.isArray(r.variants)&&r.variants.length>=3,r&&r.variants&&r.variants.map(v=>v.make));
  ok("DTC: make=Ford ставить Ford першим",/Ford/.test(L("P1336","Ford").make));
  const u=L("P0399");
  ok("DTC: P0399 — known:false, система й підсистема",u&&u.known===false&&/запалювання/.test(u.desc_uk));
  ok("DTC: код виробника без вигаданої підсистеми",L("P1999").subsystem==="");
  ok("DTC: сміття → null",L("XYZ")===null);
  ok("DTC: стандартний код однозначний",L("P0016").known===true&&!L("P0016").variants);
}

/* ---------- 4. Структура і дизайн ---------- */
ok("Дослідження: відповідь у #finalAnswer (елемента #answerHtml у розмітці немає)",!/\$\("answerHtml"\)/.test(app)&&/id="finalAnswer"/.test(html));
ok("CSS: клас .btn описано",/^\.btn\{/m.test(css));
ok("CSS: кнопка «Знайти» не забирає поле коду",/\.dtcSearch \.primary\{width:auto;flex:0 0 auto/.test(css));
ok("CSS: вибір моделей не ширшає за екран (minmax(0,1fr))",/\.providerSelector,\.connectionCards\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(css));
ok("HTML: фонова модель — у картці з відступами, без дубля заголовка",/<div class="card mcpCard">\s*<div class="mcpHead"><div><div class="eyebrow" data-i18n="bgModelEyebrow">/.test(html)&&/<span class="srOnly" data-i18n="bgModelTitle">/.test(html));
ok("i18n: підказка про ключі без суміші англійської (uk)",i18n.includes('addApiKey:"Додай хоча б один ключ AI у розділі «Зв’язок».'));

console.log(`\nrun_v511108: PASS ${pass}, FAIL ${fail}`);
if(fail)process.exit(1);
