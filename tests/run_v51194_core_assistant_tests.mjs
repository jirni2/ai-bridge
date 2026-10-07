/* v5.11.94 — Асистент Ядра (BridgeCore.createAssistant): наміри, рахунок, одиниці, дати, текст,
   пам'ять, розмова, чесна відмова й сигнал escalate, стійкість, інтеграція в застосунок. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {createRequire} from "module";
const require=createRequire(import.meta.url);const C=require("../core.js");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let pass=0,fail=0;const ok=(n,c,x)=>{if(c){pass++;console.log("PASS: "+n)}else{fail++;console.log("FAIL: "+n+(x!==undefined?" — "+JSON.stringify(x).slice(0,220):""))}};
const NOW=()=>new Date(2026,9,5,11,52); /* понеділок, 5 жовтня 2026 */
const mk=(o)=>C.createAssistant(Object.assign({lang:"uk",now:NOW},o||{}));
let A=mk();const R=(q,ctx)=>A.respond(q,ctx);
/* рахунок */
for(const [q,v] of [["скільки буде 15% від 240?",36],["(12+8)*3",60],["200 + 10%",220],["корінь з 144",12],["2^10",1024],["1 000 * 1,5",1500],["1,000,000 * 2",2000000],["What is 15% of 80?",12],["сколько будет 12*12",144],["Привіт, скільки буде 7*8?",56],["10 мінус 4 помножити на 2",2],["100 поділити на 8",12.5]]){const r=R(q);ok("рахунок: "+q,r.intent==="math"&&Math.abs(r.value-v)<1e-9,r)}
ok("ділення на нуль — пояснення, а не Infinity",R("10 поділити на 0").intent==="math"&&!/Infinity|NaN/.test(R("10/0").text));
ok("час 10:30 не вважається діленням",R("10:30 + 5").intent!=="math");
ok("без eval: текст із кодом не виконується",R("constructor.constructor('return 1')()").intent!=="math");
/* одиниці */
for(const [q,v] of [["5 миль у км",8.04672],["70 кг у фунти",154.324],["20 C у F",68],["-40 C у F",-40],["100 км/год у mph",62.1371],["10 kg to lb",22.0462]]){const r=R(q);ok("одиниці: "+q,r.intent==="units"&&Math.abs(r.value-v)<0.001,r)}
ok("несумісні одиниці не переводяться",R("5 км у кг").intent!=="units");
/* дати */
ok("сьогодні",/понеділок, 5 жовтня 2026/.test(R("яке сьогодні число?").text));
ok("час",R("котра година?").text.includes("11:52"));
ok("днів до дати",R("скільки днів до 25 грудня?").value===81);
ok("день тижня",/п'ятниця/.test(R("який день тижня 1 січня 2027?").text));
ok("через 2 тижні",/19 жовтня 2026/.test(R("яке число буде через 2 тижні?").text));
ok("неіснуюча дата → чесно",R("скільки днів до 31 лютого").handled===false);
ok("англійською",/Monday, October 5, 2026/.test(mk({lang:"en"}).respond("what's the date today?").text));
/* розмова */
ok("привітання",R("Привіт!").intent==="greeting");
ok("ім'я запам'ятовується і вживається",R("Мене звати Олена").intent==="name"&&/Олена/.test(R("привіт").text));
ok("хто ти — чесно не нейромережа",/не нейромережа/.test(R("хто ти?").text));
ok("довідка",R("що ти вмієш?").intent==="help"&&R("як справи?").intent==="smalltalk"&&R("дякую").intent==="smalltalk");
ok("мова відповіді = мова питання",mk().respond("Как дела?").lang==="ru"&&mk().respond("How are you?").lang==="en");
/* пам'ять */
A=mk();
ok("запам'ятати факт",R("запам'ятай, що пароль від Wi-Fi лежить у шухляді на кухні").memoryChanged===true);
R("запам'ятай що день народження Марти 3 березня");
let r=R("де пароль від wifi?");ok("відповідь із пам'яті (wifi ↔ Wi-Fi)",r.intent==="answer"&&r.confidence>=0.8&&/шухляді/.test(r.text)&&r.sources[0].type==="facts",r);
ok("питання з датою з пам'яті",/3 березня/.test(R("коли день народження Марти?").text));
ok("список пам'яті",/Факти \(2\)/.test(R("що ти пам'ятаєш?").text));
ok("забути один факт",R("забудь про wi-fi").memoryChanged===true&&R("де пароль від wifi?").handled===false);
/* текст + контекст розмови */
const doc="Зустріч відбудеться 12 жовтня 2026 о 15:00 в офісі на вулиці Садовій. Сергію треба підготувати звіт до п'ятниці. Потрібно замовити 25 стільців за 1200 доларів. Марта має надіслати запрошення гостям. Бюджет заходу зріс на 15% порівняно з минулим роком. Наступний етап — оренда залу, договір підписують 20 жовтня. Відповідальна за кейтеринг — Оксана, її телефон 306-555-0199.";
A=mk();
r=R("підсумуй: "+doc);ok("«підсумуй: текст»",r.intent==="text"&&/Коротко/.test(r.text));
ok("наступне «які дати?» — по тому ж тексту",/12 жовтня 2026/.test(R("а які дати?").text));
r=R("що треба зробити?");ok("завдання з тексту",/\[ \] Сергію треба/.test(r.text)&&/замовити 25 стільців/.test(r.text)&&!/Бюджет заходу зріс/.test(r.text),r.text);
ok("ключові слова і статистика разом",/Ключові слова[\s\S]+Статистика/.test(R("ключові слова і статистика").text));
r=R("який телефон Оксани?");ok("питання за текстом розмови",r.intent==="answer"&&/306-555-0199/.test(r.text)&&r.sources[0].type==="last");
ok("«докладніше» і «коротше»",R("докладніше").intent==="refine"&&R("коротше").intent==="refine");
r=mk().respond(doc+" "+doc.replace(/жовтня/g,"листопада"));ok("вставлений довгий текст без команди → звіт (двокрапка в «15:00» не плутає)",r.intent==="text.report"&&/Коротко[\s\S]+Ключові слова[\s\S]+Статистика/.test(r.text),r.intent);
r=mk().respond("Коли підписують договір?",{context:doc});ok("питання за доданим файлом",/20 жовтня/.test(r.text)&&r.sources[0].type==="context");
/* вивчити документ і згадати в НОВІЙ розмові */
A=mk();R("підсумуй: "+doc);ok("«запам'ятай цей документ»",R("запам'ятай цей документ").intent==="memory.learn");
const saved=A.exportMemory();const B=mk({memory:saved});
r=B.respond("Скільки стільців треба замовити?");ok("пам'ять переживає перезапуск",r.intent==="answer"&&/25 стільців/.test(r.text)&&r.sources[0].type==="doc",r);
ok("забути все",B.respond("забудь все").memoryChanged===true&&B.memoryInfo().docs===0&&B.memoryInfo().facts===0);
/* нотатки застосунку */
r=mk({notes:["Код домофона 4821, під'їзд 2","Лікар приймає у вівторок о 10:00"]}).respond("який код домофона?");ok("відповідь із нотаток",/4821/.test(r.text)&&r.sources[0].type==="notes",r);
/* довідка про AI Bridge */
r=mk().respond("як додати ключ?");ok("вбудована довідка",r.intent==="answer"&&r.sources[0].type==="help"&&/Зв'язок/.test(r.text));
/* чесність: не знає → не вигадує, а сигналить */
for(const q of ["Хто виграв учорашній матч?","напиши вірш про осінь","Explain quantum physics","Почему небо голубое?"]){r=mk().respond(q);ok("не вигадує: "+q,r.handled===false&&r.escalate===true&&r.confidence===0,r)}
r=mk().respond("Що вирішили щодо зарплати?",{context:doc});ok("слабкий збіг → escalate, а не впевнена відповідь",r.escalate===true,r);
/* стійкість */
const bad=[];A=mk();const big=("Це речення про тестування ядра системи номер. ").repeat(4000);
for(const inp of ["",null,undefined,123,{},[],"(".repeat(300),"1+".repeat(95)+"1","2^9999","√-4","а".repeat(60000),".".repeat(50000),"запам'ятай "+"а".repeat(100000),"забудь","підсумуй","<script>alert(1)</script>","my name is constructor","запам'ятай, що __proto__",big]){
  const t0=Date.now();try{const x=A.respond(inp,{context:Math.random()<2?undefined:big});if(typeof x.text!=="string"||/NaN|Infinity|undefined|\[object/.test(x.text))bad.push("text:"+String(inp).slice(0,20))}catch(e){if(!e.isCoreError)bad.push("throw:"+String(inp).slice(0,20)+":"+e.message)}
  if(Date.now()-t0>1500)bad.push("slow:"+String(inp).slice(0,20));
}
ok("патологічні входи: без винятків, без NaN, швидко",bad.length===0,bad);
for(const m of ['{"facts":"x"}',"null","[]","not json",'{"facts":[{"text":123}],"docs":[{"text":"a"}],"prefs":{"name":{}}}'])try{mk({memory:m}).respond("привіт")}catch(e){bad.push("mem:"+m)}
ok("зіпсована збережена пам'ять не ламає асистента",bad.length===0,bad);
ok("ліміти пам'яті",(()=>{const X=mk();for(let i=0;i<400;i++)X.remember("факт номер "+i);for(let i=0;i<50;i++)X.learn(("Документ "+i+" має довгий текст. ").repeat(900),"doc"+i);const inf=X.memoryInfo();return inf.facts<=300&&inf.docs<=40&&inf.docChars<=600000})());
ok("якість пошуку ядра не погіршилась (набори A/B)",(()=>{let n=0;for(const f of ["./fixtures/core-eval-a.cjs","./fixtures/core-eval-b.cjs"]){const S=require(f);for(const [d,q,e] of S.Q)if(C.answer(q,S.D[d],1).some(s=>s.includes(e)&&s.length<=220))n++}return n>=74})());
ok("пам'ять: питання іншими формами слів (кіт→кота, «мого», «звати»)",(()=>{const X=mk();X.respond("запамʼятай що мій кіт Мурчик");X.respond("запомни что моя машина Тойота Королла");X.respond("remember that my dentist is Dr. Lee");const a=X.respond("як звати мого кота?"),b=X.respond("какая у меня машина?"),c=X.respond("who is my dentist?"),d=X.respond("як звати мою собаку?");return a.intent==="answer"&&/Мурчик/.test(a.text)&&/Тойота/.test(b.text)&&/Lee/.test(c.text)&&d.intent==="unknown"})());
const __PKG_VERSION=require("../bridge-version.json").version; /* v5.11.97: версія з одного джерела */
ok("ядро цілісне, версія "+__PKG_VERSION,C.verifyIntegrity().ok&&C.VERSION===__PKG_VERSION&&typeof C.createAssistant==="function");
/* інтеграція в застосунок */
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
ok("app: Ядро вибирається без статусу сервера (офлайн, без входу)",/filter\(id=>PROVIDERS\[id\]\?\.local\|\|status\.providers\?\.\[id\]\)/.test(app));
ok("app: офлайн спершу питає Ядро, решта — в чергу",/if\(!navigator\.onLine&&!options\.fromQueue\)\{[\s\S]{0,900}askCore\([\s\S]{0,700}queueOfflineMessage\(source,prompt,submittedImages\);return\}/.test(app));
ok("app: Ядро разом із хмарою відповідає першим лише на те, що вміє саме",/coreChosen&&providers\.length&&[\s\S]{0,300}coreCanHandleAlone\(r\)/.test(app)&&/CORE_INSTANT_INTENTS=new Set\(\["math","units","date","time"/.test(app));
ok("app: Ядро НЕ відправляє питання в хмару саме — лише підказує",!/escalate[\s\S]{0,200}sendTask\(/.test(app.slice(app.indexOf("function renderCoreReply"),app.indexOf("function runLocalCore")))&&/coreAskCloud/.test(app));
ok("app: пам'ять Ядра — лише localStorage цього пристрою, з кнопкою очищення",/CORE_MEMORY_KEY="ai_bridge_core_memory_v1"/.test(app)&&/clearCoreMemoryBtn/.test(app)&&!/fetch\([^)]*CORE_MEMORY_KEY/.test(app));
for(const k of ["coreAskCloud","coreOfflineNote","coreFirstNote","coreMemoryFull","dmCoreT","dmCoreD","dmCoreCleared"])ok("i18n "+k+" (en/uk/ru)",(i18n.match(new RegExp("[{,]"+k+":","g"))||[]).length>=3);
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exit(1);
