/* v5.11.57 — Лотерейний аналізатор, що навчається:
   1) lottoNextDrawDate: дата наступного тиражу за drawDays (YYYY-MM-DD).
   2) lottoSavePrediction: збереження прогнозу в KV, дедуп за sig, кільцевий буфер (max 20).
   3) lottoCheckPredictions: звірка з новим тиражем, EMA ваг стратегій (alpha 0.25).
   4) lottoAnalyze(draws, game, strategyStats): поле accuracy, сортування за ema, learning{totalChecked,bestStrategy}.
   5) UI/i18n: ключі lottoAccuracy/lottoAvgMatches/lottoCheckedN/lottoBestStrategy (uk/en). */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabConstObj(src,name){
  const marker="const "+name+"={";
  const i=src.indexOf(marker);
  if(i<0)throw new Error("FAIL: не знайдено const "+name);
  let depth=0,j=i+marker.length-1;
  for(;j<src.length;j++){
    const ch=src[j];
    if(ch==="{")depth++;
    else if(ch==="}"){
      depth--;
      if(depth===0&&src[j+1]===";")return src.slice(i,j+2);
    }
  }
  throw new Error("FAIL: не закрито const "+name);
}
function grabFn(src,name){
  const marker="function "+name+"(";
  const i=src.indexOf(marker);
  if(i<0)throw new Error("FAIL: не знайдено function "+name);
  let start=i;
  if(src.slice(i-6,i)==="async ")start=i-6;
  const bi=src.indexOf("{",i);
  let depth=0,j=bi;
  for(;j<src.length;j++){
    const ch=src[j];
    if(ch==="{")depth++;
    else if(ch==="}"){
      depth--;
      if(depth===0)return src.slice(start,j+1);
    }
  }
  throw new Error("FAIL: не закрито function "+name);
}
/* прості константи — звіряємо значення з кодом, щоб тест не розійшовся */
for(const [k,v] of [["LOTTO_PRED_PREFIX","\"lotto:predictions:\""],["LOTTO_STAT_PREFIX","\"lotto:strategy-stats:\""],["LOTTO_PRED_MAX","20"],["LOTTO_EMA_ALPHA","0.25"]])
  ok(worker.includes("const "+k+"="+v),"worker.js: const "+k+"="+v);

const prelude=[
  grabConstObj(worker,"LOTTO_GAMES"),
  'const LOTTO_DISCLAIMER="Тест.";',
  'const LOTTO_PRED_PREFIX="lotto:predictions:";',
  'const LOTTO_STAT_PREFIX="lotto:strategy-stats:";',
  'const LOTTO_PRED_MAX=20;',
  'const LOTTO_EMA_ALPHA=0.25;',
  grabFn(worker,"jobsKV"),
  grabFn(worker,"lottoNextDrawDate"),
  grabFn(worker,"lottoSavePrediction"),
  grabFn(worker,"lottoCheckPredictions"),
  grabFn(worker,"lottoAnalyze"),
].join("\n");
(0,eval)(prelude);

/* мок KV */
function mkEnv(){
  const store=new Map();
  return {store,AI_BRIDGE_JOBS:{
    get:async k=>store.has(k)?store.get(k):null,
    put:async (k,v)=>{store.set(k,v);},
  }};
}
function mkDraws(){
  const hot=[[1,2,3,4,5,6,7],[1,2,3,8,9,10,11],[2,3,4,5,12,13,14]];
  const out=[];
  for(let i=0;i<12;i++){
    const base=hot[i%hot.length];
    out.push({d:`2026-09-${String(28-i).padStart(2,"0")}`,n:[...base].sort((a,b)=>a-b),b:1});
  }
  return out;
}

/* --- 1. lottoNextDrawDate --- */
{
  const d=lottoNextDrawDate("lottomax");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d),"lottoNextDrawDate: формат YYYY-MM-DD ("+d+")");
  const today=new Date().toISOString().slice(0,10);
  ok(d>today,"lottoNextDrawDate: дата в майбутньому");
  ok(lottoNextDrawDate("unknown")==null||/^\d{4}-\d{2}-\d{2}$/.test(lottoNextDrawDate("unknown")),"lottoNextDrawDate: невідома гра — fallback");
}

/* --- 2. lottoSavePrediction --- */
{
  const env=mkEnv();
  const combos=[{id:"hot",nums:[1,2,3,4,5,6,7]},{id:"anti",nums:[40,41,42,43,44,45,46]}];
  ok(await lottoSavePrediction(env,"lottomax",combos)===true,"lottoSavePrediction: збережено");
  const raw=env.store.get("lotto:predictions:lottomax:v1");
  const arr=JSON.parse(raw);
  ok(arr.length===1&&arr[0].combos.length===2,"lottoSavePrediction: 1 прогноз, 2 комбо");
  ok(arr[0].combos[0].strategy==="hot"&&arr[0].combos[0].numbers.join(",")==="1,2,3,4,5,6,7","lottoSavePrediction: структура комбо");
  ok(arr[0].checked===false&&/^\d{4}-\d{2}-\d{2}$/.test(arr[0].predictedFor),"lottoSavePrediction: checked=false, predictedFor дата");
  /* дедуп: той самий sig не дублюється */
  await lottoSavePrediction(env,"lottomax",combos);
  ok(JSON.parse(env.store.get("lotto:predictions:lottomax:v1")).length===1,"lottoSavePrediction: дедуп за sig");
  /* кільцевий буфер: 21 різний прогноз → лишилось 20 */
  for(let i=0;i<21;i++)
    await lottoSavePrediction(env,"lottomax",[{id:"hot",nums:[1,2,3,4,5,6,7+i]}]);
  ok(JSON.parse(env.store.get("lotto:predictions:lottomax:v1")).length===20,"lottoSavePrediction: кільцевий буфер max 20");
  ok(await lottoSavePrediction(null,"lottomax",combos)===false,"lottoSavePrediction: без KV → false");
}

/* --- 3. lottoCheckPredictions: EMA --- */
{
  const env=mkEnv();
  const combos=[{id:"hot",nums:[1,2,3,4,5,6,7]},{id:"anti",nums:[40,41,42,43,44,45,46]}];
  await lottoSavePrediction(env,"lottomax",combos);
  /* підміняємо predictedFor у минуле, щоб прогноз став «простроченим» */
  const arr=JSON.parse(env.store.get("lotto:predictions:lottomax:v1"));
  arr[0].predictedFor="2026-01-01";
  env.store.set("lotto:predictions:lottomax:v1",JSON.stringify(arr));
  const draw={d:"2026-10-02",n:[1,2,3,20,21,22,23],b:1}; /* hot: 3 збіги, anti: 0 */
  const r=await lottoCheckPredictions(env,"lottomax",draw);
  ok(r.checked===1,"lottoCheckPredictions: 1 прогноз перевірено");
  const stats=JSON.parse(env.store.get("lotto:strategy-stats:lottomax:v1"));
  const expHot=+(0.5*0.75+(3/7)*0.25).toFixed(4);
  ok(Math.abs(stats.hot.ema-expHot)<1e-9,`lottoCheckPredictions: EMA hot=${stats.hot.ema} (очікувалось ${expHot})`);
  ok(stats.hot.count===1&&stats.anti.count===1,"lottoCheckPredictions: лічильники");
  ok(stats.anti.ema===0.375,"lottoCheckPredictions: EMA anti=0.375 при 0 збігів");
  ok(stats.__totalChecked===1,"lottoCheckPredictions: __totalChecked=1");
  const arr2=JSON.parse(env.store.get("lotto:predictions:lottomax:v1"));
  ok(arr2[0].checked===true&&arr2[0].checkedAgainst==="2026-10-02","lottoCheckPredictions: прогноз позначено checked");
  ok(arr2[0].results.length===2&&arr2[0].results[0].matches===3,"lottoCheckPredictions: результати збігів");
  /* повторна перевірка — нічого нового */
  const r2=await lottoCheckPredictions(env,"lottomax",draw);
  ok(r2.checked===0,"lottoCheckPredictions: повтор — 0 (все checked)");
  /* прогноз «на майбутнє» не чіпається */
  const env2=mkEnv();
  await lottoSavePrediction(env2,"lottomax",combos);
  const r3=await lottoCheckPredictions(env2,"lottomax",{d:"2020-01-01",n:[1,2,3,4,5,6,7],b:1});
  ok(r3.checked===0,"lottoCheckPredictions: майбутній прогноз не перевіряється");
}

/* --- 4. lottoAnalyze зі статистикою навчання --- */
{
  const draws=mkDraws();
  const stats={hot:{ema:0.8,count:5},anti:{ema:0.2,count:3},__totalChecked:2};
  const an=lottoAnalyze(draws,"lottomax",stats);
  ok(an.smartCombos[0].id==="hot"&&an.smartCombos[0].accuracy===0.8,"lottoAnalyze: сортування за ema, hot перший");
  ok(an.smartCombos.every(c=>typeof c.accuracy==="number"),"lottoAnalyze: accuracy у всіх комбо");
  ok(an.learning.totalChecked===2&&an.learning.bestStrategy==="hot","lottoAnalyze: learning {2, hot}");
  /* без статистики — нейтрально */
  const an2=lottoAnalyze(draws,"lottomax");
  ok(an2.smartCombos.every(c=>c.accuracy===0.5),"lottoAnalyze: без stats accuracy=0.5");
  ok(an2.learning.totalChecked===0&&an2.learning.bestStrategy===null,"lottoAnalyze: без stats learning порожній");
  ok(an2.smartCombos.length===5,"lottoAnalyze: 5 комбо як і раніше");
}

/* --- 5. UI + i18n --- */
{
  for(const k of ["lottoAccuracy","lottoAvgMatches","lottoCheckedN","lottoBestStrategy"]){
    ok(app.includes(k),`app.js: використовує ключ ${k}`);
    ok(i18n.includes(k+":"),`i18n.js: ключ ${k} присутній`);
  }
  ok(i18n.includes('lottoAccuracy:"Точність стратегії"'),"i18n uk: lottoAccuracy");
  ok(i18n.includes('lottoAccuracy:"Strategy accuracy"'),"i18n en: lottoAccuracy");
  ok(i18n.includes('lottoCheckedN:"Перевірено прогнозів"'),"i18n uk: lottoCheckedN");
  ok(i18n.includes('lottoBestStrategy:"Найкраща стратегія"'),"i18n uk: lottoBestStrategy");
}


/* --- 6. Еволюція успішних стратегій (доповнення Сергія) --- */
{
  const draws=mkDraws();
  /* hot ema 0.8, pairs ema 0.65 → обидві кваліфікуються; ripe ema 0.5 → ні */
  const stats={hot:{ema:0.8,count:5},pairs:{ema:0.65,count:4},ripe:{ema:0.5,count:2},__totalChecked:3};
  const an=lottoAnalyze(draws,"lottomax",stats);
  const ids=an.smartCombos.map(c=>c.id);
  ok(ids.includes("hot+"),"evolution: похідне hot+ згенеровано (ema 0.8 ≥ 0.6)");
  ok(ids.includes("pairs+"),"evolution: похідне pairs+ згенеровано (ema 0.65 ≥ 0.6)");
  ok(!ids.includes("ripe+"),"evolution: ripe+ НЕ згенеровано (ema 0.5 < 0.6)");
  ok(an.smartCombos.length<=8,"evolution: максимум 8 комбо");
  const hp=an.smartCombos.find(c=>c.id==="hot+");
  ok(hp&&hp.nums.length===7&&new Set(hp.nums).size===7,"evolution: hot+ — 7 унікальних чисел");
  ok(hp.reason.includes("Гарячі")&&hp.reason.includes("точність"),"evolution: hot+ reason з точністю");
  ok(typeof hp.accuracy==="number","evolution: hot+ має accuracy (окрема EMA)");
  const pp=an.smartCombos.find(c=>c.id==="pairs+");
  ok(pp&&pp.nums.length===7,"evolution: pairs+ — 7 чисел");
  /* hot+ відрізняється від базового hot */
  const h0=an.smartCombos.find(c=>c.id==="hot");
  ok(hp.nums.join(",")!==h0.nums.join(","),"evolution: hot+ відрізняється від hot");
  /* ліміт 3 похідних: 4 кваліфіковані → тільки 3 */
  const stats2={hot:{ema:0.9,count:1},ripe:{ema:0.8,count:1},balance:{ema:0.7,count:1},pairs:{ema:0.65,count:1},anti:{ema:0.61,count:1},__totalChecked:5};
  const an2=lottoAnalyze(draws,"lottomax",stats2);
  const derived2=an2.smartCombos.filter(c=>c.id.endsWith("+"));
  ok(derived2.length===3,"evolution: максимум 3 похідні при 5 кваліфікованих");
  ok(an2.smartCombos.length===8,"evolution: 5 базових + 3 похідні = 8");
  /* без кваліфікованих — тільки 5 базових */
  const an3=lottoAnalyze(draws,"lottomax",{__totalChecked:1});
  ok(an3.smartCombos.length===5&&!an3.smartCombos.some(c=>c.id.endsWith("+")),"evolution: без ema ≥ 0.6 похідних немає");
  /* похідні зберігаються в прогнози з окремою стратегією */
  const env=mkEnv();
  await lottoSavePrediction(env,"lottomax",an.smartCombos);
  const saved=JSON.parse(env.store.get("lotto:predictions:lottomax:v1"))[0];
  ok(saved.combos.some(c=>c.strategy==="hot+"),"evolution: hot+ зберігається в прогнозі");
}

console.log(`\nУСІ ТЕСТИ ПРОЙДЕНО: ${passed}`);

