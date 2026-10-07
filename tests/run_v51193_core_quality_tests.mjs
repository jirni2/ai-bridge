/* v5.11.93 — якість і стійкість Ядра (BridgeCore). Набори питань: tests/fixtures/core-eval-{a,b}.cjs.
   Пороги — це досягнутий рівень; тест падає, якщо зміна ядра його ПОГІРШУЄ. */
import {createRequire} from "module";
const require=createRequire(import.meta.url);
const __PKG_VERSION=require("../bridge-version.json").version; /* v5.11.94: версія з одного джерела */
const C=require("../core.js"),A=require("./fixtures/core-eval-a.cjs"),B=require("./fixtures/core-eval-b.cjs");
let pass=0,fail=0;
const ok=(name,cond,extra)=>{if(cond){pass++;console.log("PASS: "+name)}else{fail++;console.log("FAIL: "+name+(extra!==undefined?" — "+JSON.stringify(extra).slice(0,200):""))}};
const score=(set)=>{let t1=0,t3=0;for(const [doc,q,exp] of set.Q){const fit=s=>s.includes(exp)&&s.length<=220;if(C.answer(q,set.D[doc],1).some(fit))t1++;if(C.answer(q,set.D[doc],3).some(fit))t3++}return {t1,t3,n:set.Q.length}};
const a=score(A),b=score(B);
ok(`answer: набір A топ-1 ≥ 40/42 (було 36)`,a.t1>=40,a);ok(`answer: набір A топ-3 = 42/42`,a.t3===42,a);
ok(`answer: набір B топ-1 ≥ 33/35 (було 26)`,b.t1>=33,b);ok(`answer: набір B топ-3 ≥ 34/35`,b.t3>=34,b);
const langBad=A.LANG.filter(([s,e])=>C.detectLang(s)!==e);ok("detectLang: усі 21 короткі фрази uk/ru/en",langBad.length===0,langBad);
const splitBad=A.SPLIT.filter(([s,n])=>C.splitSentences(s).length!==n);ok("splitSentences: усі контрольні випадки",splitBad.length===0,splitBad.map(x=>x[0]));
/* точкові властивості */
ok("коди й роки шукаються точно",C.answer("Що означає P0420?","Код P0171 означає бідну суміш. Код P0420 вказує на каталізатор.",1)[0].includes("P0420"));
ok("stemMatch через answer: торт/торта",C.answer("Скільки коштує торт?","Погода сьогодні гарна. Ціна торта становить 65 доларів.",1)[0].includes("65"));
ok("без повторів однакових речень",new Set(C.answer("оплата","Оплата готівкою. Оплата готівкою. Оплата готівкою. Доставка окремо.",3)).size===1);
ok("n не число → типові 3, а не порожньо",C.answer("оплата","Оплата готівкою. Оплата карткою. Оплата переказом. Інше речення.","x").length===3&&C.keywords("слово слово текст текст приклад","abc").length>0&&C.summarize("Перше речення тут. Друге речення там. Третє речення поруч. Четверте речення далі.",NaN).length===3);
ok("телефон знаходиться навіть без спільних слів",C.answer("What is the phone number?","We are open daily. Call 306-555-0142 for orders.",1)[0].includes("306-555-0142"));
const kw=C.keywords("Документ готовий. Документи в архіві. Документів багато. Клієнт задоволений.",3);
ok("keywords: форми слова зливаються",kw[0].word==="документ"&&kw[0].count===3,kw);
ok("stats.avgSentenceLen = слова/речення",C.stats("Один два три чотири. П'ять шість.").avgSentenceLen===3);
ok("списки й абзаци — окремі речення",C.splitSentences("Заголовок\n\n- пункт один\n- пункт два").length===3);
ok("перенесений рядок склеюється",C.splitSentences("Рядок який перенесено\nпосеред речення і він триває. Друге.").length===2);
ok("скорочення та ініціали не рвуть речення",C.splitSentences("Mr. Smith met Dr. Jones. Т. Г. Шевченко писав вірші. Див. рис. 5 на с. 10.").length===3);
const big=("Речення про тест номер один. ").repeat(15000);const r=C.analyze(big);
ok("analyze великого тексту: partial=true, truncated=false (оброблено весь)",r.partial===true&&r.truncated===false&&C.analyze("Короткий текст тут.").truncated===false);
const R=C.analyzeChunkRanges(big);ok("частини покривають текст без пропусків і ріжуть по пробілу",R[0][0]===0&&R[R.length-1][1]===big.length&&R.every((x,i)=>i===0||x[0]===R[i-1][1])&&R.slice(0,-1).every(([s,e])=>big[e-1]===" "));
/* стійкість до патологічних входів (раніше: 66 с і 6 с) */
const timed=(f)=>{const t0=Date.now();try{f()}catch(e){if(!e.isCoreError)throw e}return Date.now()-t0};
ok("splitSentencesSmart(60 000 літер без пробілів) < 1.5 с",timed(()=>C.splitSentencesSmart("а".repeat(60000)))<1500);
ok("splitSentences(50 000 крапок) < 1 с",timed(()=>C.splitSentences(".".repeat(50000)))<1000);
ok("analyze(50 000 крапок) < 1.5 с",timed(()=>C.analyze(".".repeat(50000)))<1500);
ok("findParaphrases на 4000 речень < 2.5 с",timed(()=>C.findParaphrases(("Це речення про тестування ядра системи. ").repeat(4000)))<2500);
ok("ядро цілісне після завантаження",C.verifyIntegrity().ok===true&&C.VERSION===__PKG_VERSION);
console.log(`\n${pass} passed, ${fail} failed`);
if(fail)process.exit(1);
