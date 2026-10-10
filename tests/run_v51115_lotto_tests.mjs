/* v5.11.15 — Лотерейний аналізатор (Lotto Max, Lotto 6/49, Daily Grand).
   1) lottoParseWclc: парсинг офіційних print-сторінок WCLC (3 формати бонусів),
      відсів битого (не та кількість, поза діапазоном, дубли).
   2) lottoMergeDraws: дедуп за датою, сортування, кап.
   3) lottoAnalyze: частоти, повні повтори, розриви; дисклеймер без прогнозів.
   4) lottoCheckCombos: звірка комбінацій з історією.
   5) app.js: lottoParseComboInput, lottoBalls (чисті).
   6) Статичні перевірки: пункт меню, сторінка, i18n uk+en, роут, KV-ключ, сід. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- витягуємо чисті функції з _worker.js --- */
function grabConst(src,name){
  const m=src.match(new RegExp(`^const ${name}=\\{[\\s\\S]*?\\};`,"m"));
  if(!m)throw new Error("FAIL: не знайдено const "+name+" в _worker.js");
  return m[0];
}
function grabFn(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
function grabAppFn(name){
  const m=app.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
const prelude=[
  grabConst(worker,"LOTTO_GAMES"),
  grabConst(worker,"LOTTO_MON"),
  grabConst(worker,"LOTTO_TIERS"), /* v5.11.109: рівні виграшу для lottoCheckCombos */
  "const LOTTO_MAX_DRAWS=400;",
  'const LOTTO_DISCLAIMER="Описова статистика.";'
].join("\n");
(0,eval)(prelude+"\n"+grabFn(worker,"lottoLimitsFor")+"\n"+grabFn(worker,"lottoPrizeTier")+"\n"+grabFn(worker,"lottoScoreLine")+"\n"+grabFn(worker,"lottoValidDraw")+"\n"+grabFn(worker,"lottoParseWclc")+"\n"+grabFn(worker,"lottoMergeDraws")+"\n"+grabFn(worker,"lottoBaseline")+"\n"+grabFn(worker,"lottoComb")+"\n"+grabFn(worker,"lottoOdds")+"\n"+grabFn(worker,"lottoRandomness")+"\n"+grabFn(worker,"erfcApprox")+"\n"+grabFn(worker,"lottoAnalyze")+"\n"+grabFn(worker,"lottoCheckCombos"));

/* --- 1. парсер --- */
const maxHtml=`<div class="pastWinNumGroup"><div class="pastWinNumDate"><strong>Tuesday, September 29, 2026</strong></div><ul class="pastWinNumbers"><li class="pastWinNumber">6</li><li class="pastWinNumber">10</li><li class="pastWinNumber">13</li><li class="pastWinNumber">22</li><li class="pastWinNumber">23</li><li class="pastWinNumber">43</li><li class="pastWinNumber">49</li><li class="pastWinNumberBonus"><span class="pastWinNumberBonusText">Bonus</span>17</li></ul></div>`;
const s49Html=`<div class="pastWinNumGroup"><div class="pastWinNumDate"><strong>Wednesday, September 30, 2026</strong></div><ul class="pastWinNumbers"><li class="pastWinNumber">4</li><li class="pastWinNumber">9</li><li class="pastWinNumber">12</li><li class="pastWinNumber">39</li><li class="pastWinNumber">43</li><li class="pastWinNumber">46</li><li class="pastWinNumberBonus"><span class="pastWinNumberBonusText">Bonus</span>28</li></ul></div>`;
const dgHtml=`<div class="pastWinNumGroup"><div class="pastWinNumDate"><strong>Monday, September 28, 2026</strong></div><ul class="pastWinNumbers"><li class="pastWinNumber">3</li><li class="pastWinNumber">5</li><li class="pastWinNumber">30</li><li class="pastWinNumber">32</li><li class="pastWinNumber">48</li><li class="pastWinNumberBonusDG"><span class="pastWinNumberBonusText">Grand<br/>Number</span>7</li></ul></div>`;
{
  const r=lottoParseWclc(maxHtml,"lottomax");
  ok(r.length===1&&r[0].d==="2026-09-29","Lotto Max: дата ISO");
  ok(JSON.stringify(r[0].n)===JSON.stringify([6,10,13,22,23,43,49])&&r[0].b===17,"Lotto Max: 7 чисел + бонус");
  const r2=lottoParseWclc(s49Html,"lotto649");
  ok(r2.length===1&&r2[0].d==="2026-09-30"&&r2[0].n.length===6&&r2[0].b===28,"6/49: 6 чисел + бонус");
  const r3=lottoParseWclc(dgHtml,"dailygrand");
  ok(r3.length===1&&r3[0].d==="2026-09-28"&&r3[0].n.length===5&&r3[0].b===7,"Daily Grand: 5 чисел + Grand Number");
  ok(lottoParseWclc(maxHtml,"lotto649").length===0,"чужа кількість чисел для гри → пропуск");
  const bad=maxHtml.replace(">49</li>",">77</li>");
  ok(lottoParseWclc(bad,"lottomax").length===0,"число поза діапазоном → пропуск");
  const dup=maxHtml.replace(">10</li>",">6</li>");
  ok(lottoParseWclc(dup,"lottomax").length===0,"дубль числа → пропуск");
  ok(lottoParseWclc("","lottomax").length===0&&lottoParseWclc(maxHtml,"nope").length===0,"порожнє/сміття → []");
}

/* --- 2. злиття --- */
{
  const a=[{d:"2026-09-29",n:[1],b:1},{d:"2026-09-25",n:[2],b:2}];
  const b=[{d:"2026-09-29",n:[9],b:9},{d:"2026-10-02",n:[3],b:3}];
  const m=lottoMergeDraws(a,b,400);
  ok(m.length===3&&m[0].d==="2026-10-02"&&m[2].d==="2026-09-25","дедуп за датою + новіші перші");
  ok(m.find(x=>x.d==="2026-09-29").n[0]===9,"нова запис перекриває стару за тією ж датою");
  const capped=lottoMergeDraws(a,b,2);
  ok(capped.length===2,"кап працює");
}

/* --- 3. аналітика --- */
{
  const draws=[
    {d:"2026-09-29",n:[6,10,13,22,23,43,49],b:17},
    {d:"2026-09-25",n:[8,24,38,41,43,50,52],b:7},
    {d:"2026-09-22",n:[6,10,13,22,23,43,49],b:8}
  ];
  const an=lottoAnalyze(draws,"lottomax");
  ok(an.drawCount===3,"drawCount");
  const f43=an.numberFreq.find(x=>x.n===43);
  ok(f43&&f43.c===3,"частота числа 43 = 3");
  ok(an.fullRepeats.length===1&&an.fullRepeats[0].count===2,"повний повтор комбінації знайдено");
  ok(JSON.stringify(an.fullRepeats[0].dates)===JSON.stringify(["2026-09-29","2026-09-22"]),"дати повтору за спаданням");
  const g1=an.longestGaps.find(x=>x.n===1);
  ok(g1&&g1.gap===null,"число, що не випадало: gap null (найдовший розрив)");
  ok(an.longestGaps.length<=15,"longestGaps обрізано до 15");
  ok(typeof an.note==="string"&&an.note.length>10,"дисклеймер присутній");
  ok(!/виграє|прогноз|рекоменд|став/i.test(JSON.stringify(an)),"жодних прогнозних заяв у відповіді");
  const p=an.pairFreq.find(x=>x.pair[0]===6&&x.pair[1]===10);
  ok(p&&p.c===2,"частота пари 6-10 = 2");
}

/* --- 4. перевірка комбінацій --- */
{
  const draws=[
    {d:"2026-09-29",n:[6,10,13,22,23,43,49],b:17},
    {d:"2026-09-25",n:[8,24,38,41,43,50,52],b:7}
  ];
  const res=lottoCheckCombos(draws,[[6,10,13,22,23,43,49],[1,2,3,4,5,6,7]],"lottomax");
  ok(res[0].bestMain===7&&res[0].bestMainDates[0]==="2026-09-29","ідеальний збіг: 7/7");
  ok(res[1].bestMain===1,"частковий збіг: 1/7");
  const bad=lottoCheckCombos(draws,[["a"]],"lottomax");
  ok(bad[0].error==="bad","бита комбінація → error");
}

/* --- 5. app.js чисті функції --- */
(0,eval)("var lottoGamesCache=null;\n"+grabAppFn("esc")+"\n"+grabAppFn("lottoParseComboInput")+"\n"+grabAppFn("lottoBalls"));
{
  lottoGamesCache={lottomax:{mainCount:7,mainMax:50},dailygrand:{mainCount:5,mainMax:49}};
  const p=lottoParseComboInput("3, 5, 30, 32, 48","dailygrand");
  ok(JSON.stringify(p)===JSON.stringify([3,5,30,32,48]),"парсинг введення комбінації");
  ok(lottoParseComboInput("3,5,30","dailygrand")===null,"не та кількість → null");
  ok(lottoParseComboInput("3,5,30,32,99","dailygrand")===null,"поза діапазоном → null");
  ok(JSON.stringify(lottoParseComboInput("3,3,5,30,32,48","dailygrand"))===JSON.stringify([3,5,30,32,48]),"дублі схлопуються");
  const ballsHtml=lottoBalls([3,5],7,"Бонус");
  ok(ballsHtml.includes('class="lottoBall bonus"')&&ballsHtml.includes(">7<"),"кульки з бонусом");
  const xss=lottoBalls(["<img>"],1,"<b>");
  ok(!xss.includes("<img>")&&!xss.includes("<b>"),"екранування в кульках");
}

/* --- 6. статичні перевірки --- */
{
  ok(html.includes('data-more-page="lotto"'),"пункт меню в колонці");
  ok(html.includes('id="page-lotto"'),"секція сторінки");
  ok(html.includes('id="lottoTabs"')&&html.includes('id="lottoBody"'),"хости табів і тіла");
  ok(app.includes('if(name==="lotto")renderLotto()'),"хук showPage");
  ok(worker.includes('"/api/lotto"')&&worker.includes("handleLotto"),"роут у воркері");
  ok(worker.includes("lotto:history:"),"KV-префікс історії");
  ok(worker.includes("LOTTO_DISCLAIMER"),"дисклеймер у коді");
  const seedM=worker.match(/const LOTTO_SEED=(\{[\s\S]*?\});\nfunction lottoGameIds/);
  ok(seedM,"сід вбудовано у воркер");
  const seed=JSON.parse(seedM[1]);
  for(const g of ["lottomax","lotto649","dailygrand"]){
    ok(Array.isArray(seed[g])&&seed[g].length>=80,`сід ${g}: ${seed[g]?seed[g].length:0} тиражів`);
    ok(seed[g][0].d>seed[g][seed[g].length-1].d,"сортування за спаданням");
    ok(seed[g].every(d=>lottoValidDraw(g,d)),`кожен запис сіду ${g} валідний за правилами гри (v5.11.16)`);
  }
  const src=i18n;
  const ukBlock=src.split("  uk:{",1)[0]; // not used; direct region check below
  const packsUk=src.slice(src.indexOf("const PACKS="));
  const ukRegion=packsUk.split("  uk:{")[1].split("  ru:{")[0];
  for(const k of ["navLotto","lottoTitle","lottoCheck","lottoDisclaimer","lottoMyCombos","lottoGaps"]){
    ok(new RegExp(`\\b${k}:"[^"]+"`).test(src),"ключ "+k+" в EN");
    ok(new RegExp(`\\b${k}:"[^"]+"`).test(ukRegion),"ключ "+k+" в UK");
  }
  ok(/Лотерейний аналізатор/.test(ukRegion),"український текст у UK-паці");
  ok(!/for\s*\(\s*;\s*;\s*\)/.test(worker.slice(worker.indexOf("v5.11.15: Лотерейний"),worker.indexOf("v5.11.15: Лотерейний")+12000)),"немає підозрілих циклів у модулі");
}

/* --- 7. v5.11.16: строга валідація тиражу (баг сіда Lotto Max 51/52) --- */
{
  const goodMax={d:"2026-09-29",n:[6,10,13,22,23,43,49],b:17};
  ok(lottoValidDraw("lottomax",goodMax),"валідний тираж Lotto Max проходить");
  /* v5.11.109: «баг сіда 51/52» насправді був зміною правил — з квітня 2026 Lotto Max = 7 з 52.
     Ці тиражі справжні; відкидати їх — означало втратити 19 з 49 тиражів нової гри. */
  ok(lottoValidDraw("lottomax",{d:"2026-09-25",n:[8,24,38,41,43,50,52],b:7}),"Lotto Max 7/52: число 52 після квітня 2026 — валідне");
  ok(lottoValidDraw("lottomax",{d:"2026-09-11",n:[1,38,41,44,45,49,51],b:47}),"Lotto Max 7/52: число 51 — валідне");
  ok(lottoValidDraw("lottomax",{d:"2026-06-02",n:[6,7,23,28,34,40,43],b:52}),"Lotto Max 7/52: бонус 52 — валідний");
  ok(!lottoValidDraw("lottomax",{d:"2026-01-16",n:[1,2,3,4,5,6,52],b:7}),"Lotto Max до квітня 2026 (7/50): число 52 → відхилено");
  ok(!lottoValidDraw("lottomax",{d:"2026-09-25",n:[1,2,3,4,5,6,53],b:7}),"Lotto Max: число 53 → відхилено");
  ok(!lottoValidDraw("lotto649",{d:"2026-09-30",n:[4,9,12,39,43,46,50],b:28}),"6/49: 7 чисел замість 6 → відхилено");
  ok(!lottoValidDraw("lotto649",{d:"2026-09-30",n:[4,9,12,39,43,50],b:28}),"6/49: число 50 поза 1–49 → відхилено");
  ok(!lottoValidDraw("dailygrand",{d:"2026-09-28",n:[3,5,30,32,48],b:8}),"Daily Grand: Grand Number 8 поза 1–7 → відхилено");
  ok(lottoValidDraw("dailygrand",{d:"2026-09-28",n:[3,5,30,32,48],b:7}),"валідний Daily Grand проходить");
  ok(!lottoValidDraw("lottomax",{d:"2026-09-29",n:[6,10,13,22,23,43,43],b:17}),"дубль числа → відхилено");
  ok(!lottoValidDraw("lottomax",{d:"29.09.2026",n:[6,10,13,22,23,43,49],b:17}),"не-ISO дата → відхилено");
  ok(!lottoValidDraw("nope",goodMax),"невідома гра → відхилено");
  ok(!lottoValidDraw("lottomax",null),"null → відхилено");
}

console.log(`\nPASS: ${passed} перевірок`);
