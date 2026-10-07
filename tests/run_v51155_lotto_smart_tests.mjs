/* v5.11.55 — Розумний аналізатор лотереї:
   1) lottoAnalyze: smartScores (композитний бал 0..1), smartCombos (5 стратегій),
      smallWinPairs (топ-10 пар зони малих виграшів).
   2) app.js renderLotto: секція «Розумний підбір» + i18n ключі uk/en.
   3) Детермінованість: без Math.random — ті самі вхідні дають ті самі комбо. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabConst(src,name){
  const m=src.match(new RegExp(`^const ${name}=\\{[\\s\\S]*?\\};`,"m"));
  if(!m)throw new Error("FAIL: не знайдено const "+name);
  return m[0];
}
function grabFn(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
const prelude=[
  grabConst(worker,"LOTTO_GAMES"),
  'const LOTTO_DISCLAIMER="Тест.";'
].join("\n");
(0,eval)(prelude+"\n"+grabFn(worker,"lottoAnalyze"));

/* --- детермінований набір тиражів --- */
function mkDraws(){
  const out=[];
  // 20 тиражів, числа 1..10 часті, 40..50 рідкісні (для анти-тренду)
  const hot=[[1,2,3,4,5,6,7],[1,2,3,8,9,10,11],[2,3,4,5,12,13,14],[1,3,5,7,9,11,13],[2,4,6,8,10,12,14]];
  for(let i=0;i<20;i++){
    const base=hot[i%hot.length];
    const n=i%4===0?[40+i%5,41,42,43,44,45,46]:[...base];
    out.push({d:`2026-09-${String(29-i).padStart(2,"0")}`,n:[...n].sort((a,b)=>a-b),b:1});
  }
  return out;
}

/* --- 1. smartScores --- */
{
  const an=lottoAnalyze(mkDraws(),"lottomax");
  ok(Array.isArray(an.smartScores)&&an.smartScores.length===15,"smartScores: 15 чисел");
  ok(an.smartScores.every(s=>s.score>=0&&s.score<=1),"smartScores: бали в [0,1]");
  ok(an.smartScores[0].score>=an.smartScores[14].score,"smartScores: відсортовано за спаданням");
  ok(an.smartScores.some(s=>s.n<=10),"smartScores: гарячі числа (1..10) у топі");
}

/* --- 2. smartCombos: 5 стратегій, правильна кількість чисел --- */
{
  const an=lottoAnalyze(mkDraws(),"lottomax");
  ok(Array.isArray(an.smartCombos)&&an.smartCombos.length===5,"smartCombos: 5 комбінацій");
  const ids=an.smartCombos.map(c=>c.id);
  ok(JSON.stringify(ids)===JSON.stringify(["hot","ripe","balance","pairs","anti"]),"smartCombos: id стратегій");
  for(const c of an.smartCombos){
    ok(c.nums.length===7,`комбо ${c.id}: 7 чисел для Lotto Max`);
    ok(new Set(c.nums).size===7,`комбо ${c.id}: без дублів`);
    ok(c.nums.every(n=>n>=1&&n<=50),`комбо ${c.id}: діапазон 1..50`);
    ok(typeof c.reason==="string"&&c.reason.length>10,`комбо ${c.id}: є reason українською`);
  }
  const an649=lottoAnalyze(mkDraws().map(d=>({...d,n:d.n.slice(0,6)})),"lotto649");
  ok(an649.smartCombos.every(c=>c.nums.length===6),"6/49: по 6 чисел");
  const andg=lottoAnalyze(mkDraws().map(d=>({...d,n:d.n.slice(0,5)})),"dailygrand");
  ok(andg.smartCombos.every(c=>c.nums.length===5),"Daily Grand: по 5 чисел");
}

/* --- 3. детермінованість --- */
{
  const d=mkDraws();
  const a1=lottoAnalyze(d,"lottomax"),a2=lottoAnalyze(d,"lottomax");
  ok(JSON.stringify(a1.smartCombos)===JSON.stringify(a2.smartCombos),"двічі той самий вхід → ті самі комбо");
}

/* --- 4. smallWinPairs --- */
{
  const an=lottoAnalyze(mkDraws(),"lottomax");
  ok(Array.isArray(an.smallWinPairs),"smallWinPairs: масив");
  ok(an.smallWinPairs.length<=10,"smallWinPairs: ≤10");
  ok(an.smallWinPairs.every(p=>p.pair.length===2&&p.c>0),"smallWinPairs: пари з лічильником");
  // штучний кейс: два схожі тиражі
  const close=[
    {d:"2026-09-29",n:[1,2,3,4,5,6,7],b:1},
    {d:"2026-09-28",n:[1,2,3,4,5,8,9],b:1},
    {d:"2026-09-27",n:[10,11,12,13,14,15,16],b:1}
  ];
  const an2=lottoAnalyze(close,"lottomax");
  const has12=an2.smallWinPairs.some(p=>p.pair[0]===1&&p.pair[1]===2);
  ok(has12,"smallWinPairs: пара 1-2 зі спільних чисел знайдена");
}

/* --- 5. UI та i18n --- */
{
  ok(/lottoSmart/.test(app)&&/smartCombos/.test(app),"renderLotto: секція smartCombos");
  ok(/lottoSmallWins/.test(app),"renderLotto: секція smallWinPairs");
  ok(/lottoSmart:"Smart picks"/.test(i18n),"ключ lottoSmart в EN");
  ok(/lottoSmart:"Розумний підбір"/.test(i18n),"ключ lottoSmart в UK");
  ok(/lottoSmallWins:"Зона малих виграшів"/.test(i18n),"ключ lottoSmallWins в UK");
  ok(/LOTTO_DISCLAIMER/.test(worker)&&an_has_disclaimer(),"дисклеймер лишено");
  function an_has_disclaimer(){
    const d=mkDraws();
    const an=lottoAnalyze(d,"lottomax");
    return typeof an.note==="string"&&an.note.length>0;
  }
}

/* --- 6. зворотна сумісність: старі поля на місці --- */
{
  const an=lottoAnalyze(mkDraws(),"lottomax");
  ok(Array.isArray(an.numberFreq)&&Array.isArray(an.pairFreq),"старі поля збережено");
  ok(Array.isArray(an.fullRepeats)&&Array.isArray(an.partialOverlaps),"повтори/часткові збережено");
  ok(Array.isArray(an.longestGaps),"паузи збережено");
}

console.log(`\nPASS: ${passed} перевірок`);
