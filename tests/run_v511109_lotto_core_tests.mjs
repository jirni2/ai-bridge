/* Тести v5.11.109: «Ядро лотереї», правила Lotto Max 7/52, рівні виграшу, автооновлення.
   Запуск: node tests/run_v511109_lotto_core_tests.mjs */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=f=>fs.readFileSync(path.join(root,f),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js");
let pass=0,fail=0;
function ok(name,cond,extra){if(cond)pass++;else{fail++;console.log("FAIL: "+name+(extra!==undefined?" — "+JSON.stringify(extra).slice(0,240):""))}}
function grabFn(n){const i=worker.indexOf("function "+n+"(");if(i<0)throw new Error("no fn "+n);let d=0,j=worker.indexOf("{",i);for(;;j++){if(worker[j]==="{")d++;else if(worker[j]==="}"){d--;if(!d)return worker.slice(worker.slice(i-6,i)==="async "?i-6:i,j+1)}}}
function grabConst(n){const i=worker.indexOf("const "+n+"=");if(i<0)throw new Error("no const "+n);let j=i+("const "+n+"=").length;if("{[".includes(worker[j])){let d=0;for(;;j++){if("{[".includes(worker[j]))d++;else if("}]".includes(worker[j])){d--;if(!d)return worker.slice(i,j+1)+";"}}}return worker.slice(i,worker.indexOf(";",i)+1)}
const src=["LOTTO_GAMES","LOTTO_TIERS","LOTTO_STRATS","LOTTO_WARMUP","LOTTO_SEED"].map(grabConst).join("\n")+"\n"+
  ["lottoLimitsFor","lottoEraDraws","lottoValidDraw","lottoComb","lottoPrizeTier","lottoAnyPrizeProb","lottoMulberry","lottoHash","lottoWilson","lottoStratPick","lottoScoreLine","lottoEngine","lottoLastExpectedDraw","lottoCheckCombos","lottoMaybeRefresh"].map(grabFn).join("\n");
const L=new Function("lottoRefreshGame","lottoLoad","lottoSave",src+";return {LOTTO_GAMES,LOTTO_SEED,lottoLimitsFor,lottoEraDraws,lottoValidDraw,lottoPrizeTier,lottoAnyPrizeProb,lottoEngine,lottoLastExpectedDraw,lottoCheckCombos,lottoMaybeRefresh};");
let refreshCalls=0;
const E=L(async()=>{refreshCalls++;return {ok:true,added:2}},async()=>({source:"wclc",draws:[{d:"2026-10-09",n:[1,2,3,4,5,6,7],b:8}]}),async()=>true);

/* 1. Правила Lotto Max 7/52 з квітня 2026 */
const g=E.LOTTO_GAMES.lottomax;
ok("Lotto Max: 7 з 52, бонус до 52, 4 лінії, $6",g.mainCount===7&&g.mainMax===52&&g.bonusMax===52&&g.linesPerPlay===4&&g.price===6);
ok("до квітня 2026 — межі 7/50",E.lottoLimitsFor("lottomax","2026-03-31").mainMax===50);
ok("з 14.04.2026 — межі 7/52",E.lottoLimitsFor("lottomax","2026-04-14").mainMax===52);
ok("тираж з 52 після зміни — валідний",E.lottoValidDraw("lottomax",{d:"2026-09-25",n:[8,24,38,41,43,50,52],b:7}));
ok("тираж з 52 до зміни — ні",!E.lottoValidDraw("lottomax",{d:"2026-02-03",n:[8,24,38,41,43,50,52],b:7}));
ok("аналіз Lotto Max — лише тиражі нових правил",E.lottoEraDraws("lottomax",[{d:"2026-03-01",n:[1,2,3,4,5,6,7],b:9},{d:"2026-05-01",n:[1,2,3,4,5,6,52],b:9}]).length===1);
ok("6/49 і Daily Grand — без епох",E.lottoEraDraws("lotto649",[{d:"2020-01-01",n:[1,2,3,4,5,6],b:9}]).length===1);
ok("KV-ключ оновлено (старий кеш без тиражів з 51/52 не використовується)",/const LOTTO_KV_SUFFIX=":v3";/.test(worker));
ok("парсер WCLC перевіряє межі за датою",/if\(!lottoValidDraw\(gameId,\{d:iso,n:nums,b:bonus\}\)\)continue;/.test(worker));

/* 2. Рівні виграшу (офіційні таблиці) */
const T=(id,m,b)=>{const t=E.lottoPrizeTier(id,m,b);return t?t.id:null};
ok("Lotto Max: 3/7 — безкоштовний квиток",T("lottomax",3,false)==="3");
ok("Lotto Max: 3/7+B — $20",T("lottomax",3,true)==="3+B"&&E.lottoPrizeTier("lottomax",3,true).prize==="$20");
ok("Lotto Max: 2/7 — нічого",T("lottomax",2,true)===null);
ok("Lotto Max: 7/7 — джекпот",T("lottomax",7,false)==="7");
ok("6/49: 2/6 — безкоштовний квиток, 2/6+B — $5, 1/6 — нічого",T("lotto649",2,false)==="2"&&T("lotto649",2,true)==="2+B"&&T("lotto649",1,true)===null);
ok("Daily Grand: лише Grand Number — безкоштовний квиток; 1+GN $4; 2 без GN — нічого",T("dailygrand",0,true)==="0+GN"&&T("dailygrand",1,true)==="1+GN"&&T("dailygrand",2,false)===null);
const one=id=>1/E.lottoAnyPrizeProb(id);
ok("Шанс будь-якого виграшу 6/49 ≈ 1 до 6.6 (офіційно)",Math.abs(one("lotto649")-6.6)<0.1,one("lotto649"));
ok("Шанс будь-якого виграшу Daily Grand ≈ 1 до 6.8 (офіційно)",Math.abs(one("dailygrand")-6.8)<0.1,one("dailygrand"));
{const p=E.lottoAnyPrizeProb("lottomax"),play=1/(1-Math.pow(1-p,4));ok("Lotto Max: лінія ≈ 1 до 23.3, квиток (4 лінії) ≈ 1 до 6.2",Math.abs(1/p-23.34)<0.1&&Math.abs(play-6.22)<0.1,[1/p,play]);}

/* 3. Ядро лотереї: без підглядання, детерміновано, чесний вердикт */
for(const id of ["lottomax","lotto649","dailygrand"]){
  const e=E.lottoEngine(E.LOTTO_SEED[id],id);
  ok(id+": двигун повертає 6 стратегій з контролем «випадкові»",e&&e.strategies.length===6&&e.strategies.some(s=>s.id==="random"));
  ok(id+": перевірено = тиражі − розігрів",e.tested===Math.max(0,e.draws-8));
  ok(id+": детермінізм",JSON.stringify(e)===JSON.stringify(E.lottoEngine(E.LOTTO_SEED[id],id)));
  ok(id+": лінія на наступний тираж — правильна кількість і межі",e.strategies.every(s=>s.next.nums.length===E.LOTTO_GAMES[id].mainCount&&new Set(s.next.nums).size===s.next.nums.length&&s.next.nums.every(n=>n>=1&&n<=E.LOTTO_GAMES[id].mainMax)));
  ok(id+": вердикти лише з дозволених",e.strategies.every(s=>["better","same","worse","few"].includes(s.verdict)));
  ok(id+": інтервал містить частку виграшів",e.strategies.every(s=>s.ci90[0]<=s.winRate+1e-9&&s.winRate<=s.ci90[1]+1e-9));
}
{
  /* без підглядання: стратегія «гарячі» перед тиражем t не знає тиражу t. Тест: 20 однакових тиражів,
     потім один зовсім інший — «гарячі» на останньому не можуть вгадати жодного числа. */
  const ds=[];for(let i=0;i<20;i++)ds.push({d:`2026-0${5+Math.floor(i/10)}-${String(10+i%10).padStart(2,"0")}`,n:[1,2,3,4,5,6],b:7});
  ds.push({d:"2026-08-01",n:[40,41,42,43,44,45],b:46});
  const e=E.lottoEngine(ds,"lotto649"),hot=e.strategies.find(s=>s.id==="hot");
  ok("без підглядання: «гарячі» вгадали 12 повторів і не вгадали новий тираж",hot.tested===13&&hot.wins===12&&hot.tiers["6"]===12,hot);
  ok("менше 20 перевірок — вердикт «замало даних», навіть якщо 12 з 13 виграшні",hot.verdict==="few");
}
{
  const draws=E.LOTTO_SEED.lotto649;
  const r=E.lottoCheckCombos(draws,[[1,2,3,4,5,6]],"lotto649")[0];
  ok("Свої комбінації: рахує, скільки разів виграла б хоч щось",typeof r.wins==="number"&&r.wins>=0&&r.wins<=r.drawsChecked);
}

/* 4. Автооновлення */
ok("остання очікувана дата: пт 09.10 вже доступна в сб 12:00 UTC",E.lottoLastExpectedDraw("lottomax",new Date("2026-10-10T12:00:00Z"))==="2026-10-09");
ok("тираж того ж вечора ще не очікується",E.lottoLastExpectedDraw("lottomax",new Date("2026-10-10T03:00:00Z"))==="2026-10-06");
await (async()=>{
  refreshCalls=0;
  const stale={source:"seed",draws:[{d:"2026-09-29",n:[1,2,3,4,5,6,7],b:8}]};
  const r1=await E.lottoMaybeRefresh({},"lottomax",stale,new Date("2026-10-10T12:00:00Z"));
  ok("застарілі дані → сам підтягує",refreshCalls===1&&r1.refreshed===true&&r1.added===2);
  const r2=await E.lottoMaybeRefresh({},"lottomax",stale,new Date("2026-10-10T12:00:00Z"));
  ok("не частіше ніж раз на 20 хв",refreshCalls===1&&r2.refreshed===false);
  refreshCalls=0;
  const fresh={source:"wclc",draws:[{d:"2026-10-09",n:[1,2,3,4,5,6,7],b:8}]};
  await E.lottoMaybeRefresh({},"lottomax",fresh,new Date("2026-10-10T12:00:00Z"));
  ok("свіжі дані → мережу не чіпає",refreshCalls===0);
})();
ok("маршрути draws/analyze викликають автооновлення",(worker.match(/lottoMaybeRefresh\(env,game,rec\)/g)||[]).length===2);
ok("analyze віддає engine і autoRefresh",/analysis\.engine=lottoEngine\(rec\.draws,game\)/.test(worker)&&/analysis\.autoRefresh=/.test(worker));

/* 5. Інтерфейс */
ok("UI: картка «Ядро лотереї»",/lcTitle/.test(app)&&/an\.engine&&an\.engine\.strategies/.test(app));
for(const k of ["lcTitle","lcIntro","lcEra","lcWins","lcRecent","lcNext","lcBetter","lcSame","lcWorse","lcFew","lcVerdictNone","lcVerdictMaybe","lcAuto","lcAutoAdded","lcUserWins"])
  ok("i18n "+k+" (en/uk/ru)",(i18n.match(new RegExp("\\b"+k+":","g"))||[]).length>=3);
ok("UI без обіцянок виграшу",!/гарант|точно виграє|guaranteed|наверняка/i.test(i18n.slice(i18n.indexOf("const V511109"),i18n.indexOf("Object.entries(V511109)"))));

console.log(`\nrun_v511109: PASS ${pass}, FAIL ${fail}`);
if(fail)process.exit(1);
