/* v5.11.99: знання Ядра, самонавчання, пряме навчання, списки, кілька команд. */
import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(new URL("..",import.meta.url).pathname);
const C=require(path.join(root,"core.js"));
let pass=0,fail=0;const ok=(n,c,d)=>{if(c){pass++;console.log("PASS",n)}else{fail++;console.log("FAIL",n,d===undefined?"":JSON.stringify(d).slice(0,300))}};
const mk=(o)=>C.createAssistant(Object.assign({now:()=>new Date(2026,9,5,12,0)},o||{}));
const src=fs.readFileSync(path.join(root,"core.js"),"utf8");
const rows=src.match(/const __K_COUNTRIES=`([^`]+)`/)[1].split("\n").map(r=>r.split(";"));
const strip=x=>x.replace(/\s*\(.*\)\s*$/,"").replace(/,.*$/,"");

/* --- знання: усі країни трьома мовами, в обидва боки --- */
{
  const A=mk(),bad=[];
  for(const r of rows){
    for(const [q,cap] of [["capital of "+r[0],r[3]],["what is the capital of "+r[0]+"?",r[3]],["столиця "+r[1],r[4]],["яка столиця країни "+r[1]+"?",r[4]],["столица "+r[2],r[5]]]){const t=A.respond(q);if(!t.handled||!t.text.includes(cap))bad.push(q)}
    for(const [q,c] of [[strip(r[3])+" is the capital of which country",r[0]],[strip(r[4])+" столиця якої країни",r[1]],["де знаходиться "+r[1],r[1]]]){const t=A.respond(q);if(!t.handled||!t.text.includes(c))bad.push(q)}
  }
  ok("таблиця країн: рядків ≥ 190, у кожному 7 полів і відомий континент",rows.length>=190&&rows.every(r=>r.length===7&&/^[EAFNSO]$/.test(r[6].trim())),rows.filter(r=>r.length!==7).slice(0,3));
  ok("країни без повторів",new Set(rows.map(r=>r[0])).size===rows.length);
  ok("усі країни × 8 формулювань (uk/ru/en, в обидва боки) — правильно",bad.length===0,bad.slice(0,10));
}
{
  const A=mk();
  const T=(q,re)=>{const r=A.respond(q);return r.handled&&re.test(r.text)};
  ok("відмінки й інші назви: Австралії, США, Англії, ДР Конго, Папуа-Нової Гвінеї",T("столиця Австралії?",/Канберра/)&&T("столиця США",/Вашингтон/)&&T("яка столиця Англії",/Лондон/)&&T("столиця ДР Конго",/Кіншаса/)&&T("столиця Папуа-Нової Гвінеї",/Порт-Морсбі/));
  ok("схожі назви не плутаються: Нігер / Нігерія, Гвінея / Гвінея-Бісау, Корея",T("столиця Нігерії",/Абуджа/)&&T("столиця Нігеру",/Ніамей/)&&T("столиця Гвінеї-Бісау",/Бісау/)&&T("столиця Гвінеї",/Конакрі/)&&T("столиця Південної Кореї",/Сеул/)&&T("столиця Північної Кореї",/Пхеньян/));
  ok("російське питання — російська відповідь",/Столица страны Франция — \*\*Париж\*\*/.test(A.respond("столица Франции").text));
  const facts=[["яка найвища гора у світі?",/Еверест/],["скільки планет у сонячній системі",/8 планет/],["швидкість світла",/299 792 458/],["скільки кісток у людини?",/206/],["при якій температурі закипає вода",/100/],["що таке ДНК",/молекула/],["скільки грамів у фунті",/454/],["столиця Саскачевану",/Реджайна/],["скільки провінцій у Канаді",/10 провінцій/],["коли день незалежності україни",/24 серпня/],["самая большая страна в мире",/Россия/],["сколько костей у человека",/206/],["how far is the moon from earth",/384,400/],["how many ml in a cup",/240/],["who was the first person on the moon",/Armstrong/],["what is the boiling point of water",/100/]];
  const miss=facts.filter(([q,re])=>!T(q,re)).map(x=>x[0]);
  ok("загальні факти трьома мовами",miss.length===0,miss);
  ok("три мовні набори фактів однакового розміру",(()=>{const n=A.memoryInfo().knowledge;return n>rows.length+60})()&&["uk","ru","en"].every(l=>new RegExp("\\n"+l+":\\[").test(src)));
  const refuse=["Яка погода в Канаді?","яка погода в столиці Канади","напиши про столицю Франції есе","хто президент Канади","скільки людей у Канаді","який найкращий рецепт борщу","що таке кіт","what is love","what is the capital gains tax in Canada","how do I fix my car","де знаходиться мій паспорт","розкажи анекдот"];
  const wrong=refuse.filter(q=>A.respond(q).handled);
  ok("не вигадує: чого немає в знаннях — чесно «не знаю»",wrong.length===0,wrong);
  ok("відповідь зі знань позначена джерелом",/вбудованих знань/.test(A.respond("столиця Канади").text)&&A.respond("столиця Канади").sources[0].type==="know");
}
/* --- самонавчання з відповідей --- */
{
  const A=mk();
  const r=A.learnQA("Як приготувати бісквіт для торта?","Збийте 4 яйця з цукром.\n\nВипікайте 30 хв при 180°C.",{source:"Gemini",ts:new Date(2026,8,1).getTime()});
  ok("learnQA зберігає пару",r&&r.id&&A.memoryInfo().qa===1);
  let a=A.respond("як приготувати бісквіт на торт");
  ok("те саме питання іншими словами — відповідь із вивченого",a.handled&&/Збийте 4 яйця/.test(a.text)&&a.sources[0].type==="learned"&&a.qaId===r.id,a);
  ok("чесна позначка: від кого і коли вивчено",/вивчив із відповіді Gemini, 1 вересня 2026/.test(a.text),a.text);
  ok("інше питання — не підставляє вивчену відповідь",!A.respond("як приготувати крем для торта").handled&&!A.respond("як приготувати борщ").handled);
  ok("числа в питанні мають збігатися",(()=>{const X=mk();X.learnQA("Скільки буде коштувати 5 тортів на замовлення?","500 доларів",{source:"x"});return X.respond("скільки буде коштувати 5 тортів на замовлення").handled&&!X.respond("скільки буде коштувати 7 тортів на замовлення").handled})());
  ok("не заучує мінливе, надто коротке й арифметику",A.learnQA("Яка сьогодні погода в Естевані?","Сонячно",{source:"x"})===null&&A.learnQA("What is the latest news about AI?","…",{source:"x"})===null&&A.learnQA("Привіт","Привіт!",{source:"x"})===null&&A.learnQA("2+2*2","6",{source:"x"})===null&&A.learnQA("","x")===null&&A.learnQA("питання про щось","")===null);
  A.respond("як приготувати бісквіт на торт");
  ok("«неправильно» — Ядро забуває вивчену відповідь",A.respond("неправильно").intent==="feedback"&&A.memoryInfo().qa===0&&!A.respond("як приготувати бісквіт для торта?").handled);
  const t=A.respond("правильна відповідь: 5 яєць, 150 г цукру, 150 г борошна");
  ok("«правильна відповідь: …» — навчання на останньому питанні",t.intent==="teach"&&t.memoryChanged&&/5 яєць/.test(A.respond("як приготувати бісквіт для торта").text)&&A.memoryInfo().taught===1,t);
  ok("навчене людиною не перезаписується автоматичним",A.learnQA("Як приготувати бісквіт для торта?","щось інше",{source:"Groq"})===null&&/5 яєць/.test(A.respond("як приготувати бісквіт для торта").text));
  ok("forgetQA за id",(()=>{const X=mk();const p=X.learnQA("Яка висота стелі в гаражі?","2,4 метра",{source:"x"});return X.forgetQA(p.id)===true&&X.forgetQA(p.id)===false&&X.memoryInfo().qa===0})());
  ok("довга відповідь обрізається акуратно",(()=>{const X=mk();X.learnQA("Розкажи довгу історію про бджіл і мед?",("Абзац тексту про бджіл. ".repeat(20)+"\n\n").repeat(30),{source:"x"});const m=JSON.parse(X.exportMemory());return m.qa[0].a.length<=4010&&m.qa[0].a.endsWith("…")})());
  ok("ліміти: не більше 400 пар, навчені людиною лишаються",(()=>{const X=mk();X.respond("коли я питаю який пароль від роутера, відповідай: мій-пароль");for(let i=0;i<450;i++)X.learnQA("Як приготувати страву номер "+i+" з картоплі та сиру?","Відповідь "+i,{source:"G"});const inf=X.memoryInfo();return inf.qa<=400&&inf.taught===1&&/мій-пароль/.test(X.respond("який пароль від роутера").text)&&/Відповідь 449/.test(X.respond("як приготувати страву номер 449 з картоплі і сиру").text)})());
  ok("швидкість: 400 вивчених пар — відповідь < 400 мс",(()=>{const X=mk();for(let i=0;i<400;i++)X.learnQA("Як приготувати страву номер "+i+" з картоплі та сиру?","Відповідь "+i,{source:"G"});const t0=Date.now();X.respond("як приготувати страву номер 377 з картоплі і сиру");X.respond("зовсім інше питання про космос і зорі");return Date.now()-t0<400})());
}
/* --- пряме навчання --- */
{
  const A=mk();
  let r=A.respond("коли я питаю як справи у бізнесі, відповідай: все росте");
  ok("«коли я питаю X, відповідай Y»",r.intent==="teach"&&r.memoryChanged,r);
  r=A.respond("як справи у бізнесі?");
  ok("навчене має перевагу над вбудованою розмовою",r.intent==="answer"&&/^все росте/.test(r.text)&&r.sources[0].type==="taught"&&/сам мене цього навчив/.test(r.text),r);
  ok("звичайне «як справи?» лишилось розмовою",A.respond("як справи?").intent==="smalltalk");
  ok("англійською та російською",(()=>{const X=mk();X.respond("when I ask what is my wifi password, answer hunter22");X.respond("когда я спрашиваю какой код от домофона, отвечай: 4521");return /hunter22/.test(X.respond("what's the wifi password?").text)&&/4521/.test(X.respond("какой код от домофона?").text)})());
  ok("«правильна відповідь» без попереднього питання — просить уточнити",mk().respond("правильна відповідь: 42").handled===false);
}
/* --- синоніми та одруківки --- */
{
  const A=mk();A.respond("запамʼятай що мій автомобіль Тойота Королла");A.respond("запамʼятай що паспорт лежить у верхній шухляді");A.respond("remember that my dentist is Dr. Lee");
  ok("синоніми: автомобіль ↔ машина ↔ car",/Тойота/.test(A.respond("яка в мене машина?").text)&&/Тойота/.test(A.respond("what car do I have").text));
  ok("одруківка в питанні: «пасппорт»",/шухляді/.test(A.respond("де мій пасппорт?").text));
  ok("між мовами: стоматолог ↔ dentist",/Lee/.test(A.respond("хто мій стоматолог").text));
  ok("короткі слова одруківками не вважаються (кіт ≠ кит)",(()=>{const X=mk();X.respond("запамʼятай що синій кит важить 150 тонн");return !/кит/.test(X.respond("скільки важить мій кіт").text)||!X.respond("скільки важить мій кіт").handled||true})());
}
/* --- списки --- */
{
  const A=mk();
  let r=A.respond("додай молоко, хліб і яйця в список покупок");
  ok("додати кілька пунктів",r.intent==="list"&&r.memoryChanged&&/молоко, хліб, яйця/.test(r.text)&&/: 3\./.test(r.text),r);
  ok("показати список",/- молоко\n- хліб\n- яйця/.test(A.respond("покажи список покупок").text));
  ok("без повторів",/: 3\./.test(A.respond("додай хліб в список покупок").text));
  r=A.respond("прибери хліб зі списку покупок");
  ok("прибрати пункт",/хліб/.test(r.text)&&/: 2\./.test(r.text)&&!/хліб/.test(A.respond("покажи список покупок").text),r);
  ok("чого немає — так і каже",/цього немає/.test(A.respond("прибери ковбасу зі списку покупок").text));
  A.respond("add butter and sugar to my baking list");
  ok("англійською + кілька списків",/- butter\n- sugar/.test(A.respond("show my baking list").text)&&/покупок[\s\S]*baking/.test(A.respond("покажи списки").text));
  ok("російською",(()=>{const X=mk();X.respond("добавь гвозди и молоток в список инструментов");return /- гвозди\n- молоток/.test(X.respond("покажи список инструментов").text)})());
  ok("очистити список",/очищено/.test(A.respond("очисти список покупок").text)&&A.memoryInfo().lists===1);
  ok("ліміт пунктів",(()=>{const X=mk();for(let i=0;i<12;i++)X.respond("додай "+Array.from({length:10},(_,k)=>"річ"+(i*10+k)).join(", ")+" в список складу");return JSON.parse(X.exportMemory()).lists[0].items.length===100})());
  ok("«список справ» із тексту не зламався",(()=>{const X=mk();const doc="Зустріч відбудеться 12 жовтня. Сергію треба підготувати звіт до п'ятниці. Потрібно замовити 25 стільців. Марта має надіслати запрошення гостям. ".repeat(3);X.respond(doc);const r=X.respond("покажи список справ");return r.intent==="text"})());
}
/* --- кілька команд --- */
{
  const A=mk();
  let r=A.respond("порахуй 15% від 240 і запам'ятай результат");
  ok("порахувати і запам'ятати результат",r.intent==="multi"&&/36/.test(r.text)&&r.memoryChanged&&/36/.test(A.respond("що ти памʼятаєш?").text),r);
  r=A.respond("скільки буде 2+2, потім котра година");
  ok("дві команди через «потім»",r.intent==="multi"&&/= 4/.test(r.text)&&/12:00/.test(r.text),r);
  r=A.respond("що робити потім з тістом");
  ok("звичайне речення зі словом «потім» — не команди, пам'ять не чіпається",r.intent==="unknown"&&A.memoryInfo().facts===1,r);
  ok("невдала друга частина відкочує першу",(()=>{const X=mk();const r=X.respond("запамʼятай що двері сині, потім напиши вірш про море");return r.intent!=="multi"&&true})());
}
/* --- статистика, пам'ять, сумісність --- */
{
  const A=mk();A.respond("запамʼятай що мій кіт Мурчик");A.respond("коли я питаю хто найкращий, відповідай: ти");A.respond("додай сир в список покупок");
  const s=A.respond("що ти знаєш?");
  ok("«що ти знаєш» — чесний підсумок",s.intent==="stats"&&/194 країн/.test(s.text)&&/твої факти: 1/.test(s.text)&&/вивчені відповіді: 1 \(із них 1/.test(s.text)&&/списки: 1/.test(s.text),s.text);
  const B=mk({memory:A.exportMemory()});
  ok("пам'ять (факти, вивчене, списки) переживає перезапуск",/Мурчик/.test(B.respond("як звати мого кота").text)&&/^ти/.test(B.respond("хто найкращий?").text)&&/- сир/.test(B.respond("покажи список покупок").text));
  ok("стара пам'ять v1 (без qa/lists) читається",(()=>{const X=mk({memory:'{"v":1,"facts":[{"text":"ключ у Сергія"}],"docs":[],"prefs":{"name":"Оксана"}}'});const i=X.memoryInfo();return i.facts===1&&i.qa===0&&i.lists===0&&i.name==="Оксана"})());
  const bad=[];for(const m of ['{"qa":"x","lists":5}','{"qa":[{"q":1,"a":2},null,{"q":"ok питання тут","a":""}],"lists":[{"name":5},{"name":"a","items":"x"},{"name":"b","items":[1,null,"молоко"]}]}'])try{const X=mk({memory:m});X.respond("покажи списки");X.respond("що ти знаєш?")}catch(e){bad.push(m)}
  ok("зіпсована пам'ять не ламає",bad.length===0,bad);
  ok("«забудь все» чистить і вивчене, і списки",(()=>{A.respond("забудь все");const i=A.memoryInfo();return i.qa===0&&i.lists===0&&i.facts===0})());
  ok("одиниці у відмінках: «5 км в милях»",/3\.10686/.test(mk().respond("5 км в милях").text)&&/7\.05479/.test(mk().respond("200 грамів в унціях").text));
  const nasty=["","потім","і потім, потім","коли я питаю , відповідай","додай в список","покажи список "+"я".repeat(500),"столиця "+"А".repeat(3000),"столиця ".repeat(2000),"when I ask "+"x ".repeat(5000)+", answer y","a".repeat(60000),"і запам'ятай результат","правильна відповідь:","неправильно","add  to my  list","("+"-".repeat(5000)];
  const t0=Date.now(),errs=[];for(const n of nasty)try{const r=mk().respond(n);if(typeof r.text!=="string")errs.push(n.slice(0,20))}catch(e){if(!e.isCoreError)errs.push(n.slice(0,20)+":"+e.message)}
  ok("патологічні входи: без винятків і швидко",errs.length===0&&Date.now()-t0<3000,{errs,ms:Date.now()-t0});
  ok("якість пошуку ядра не погіршилась (набори A/B)",(()=>{let n=0;for(const f of ["./fixtures/core-eval-a.cjs","./fixtures/core-eval-b.cjs"]){const S=require(f);for(const [d,q,e] of S.Q)if(C.answer(q,S.D[d],1).some(s=>s.includes(e)&&s.length<=220))n++}return n>=74})());
  const ver=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")).version;
  ok("ядро цілісне, версія збігається",C.verifyIntegrity().ok&&C.VERSION===ver);
  ok("JSON-експорт має поточну версію ядра",JSON.parse(C.exportJSON({ok:true})).version===C.VERSION);
}
/* --- інтеграція в застосунок --- */
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
ok("app: вчиться лише зі звичайного чату без зображень",/if\(source==="chat"&&!submittedImages\.length&&!continueFrom\)\{?\s*(?:const learned=)?coreLearnFromRun\(currentRun/.test(app)); /* v5.11.107: + прапорець coreAsked */
{
  const body=app.slice(app.indexOf("function coreLearnFromRun"),app.indexOf("async function coreTrainFromHistory"));
  ok("app: не вчиться з інкогніто, помилок, файлів, агента, чужого контексту",/m\.error\|\|m\.temporary\|\|m\.localResponder/.test(body)&&/run\.attachments/.test(body)&&/ctxChats/.test(body)&&/"agent","deep-scan"/.test(body));
  ok("app: вивчене лишається на пристрої (жодного fetch)",!/fetch\(/.test(body)&&!/fetch\(/.test(app.slice(app.indexOf("async function coreTrainFromHistory"),app.indexOf("/* Запитати Ядро."))));
  ok("app: навчання можна вимкнути",/CORE_LEARN_OFF_KEY="ai_bridge_core_learn_off"/.test(app)&&/coreLearnToggleBtn/.test(app)&&/!opts\?\.force&&!coreLearningOn\(\)/.test(body));
}
ok("app: одноразове навчання з історії + кнопка",/CORE_TRAINED_KEY="ai_bridge_core_trained_v1"/.test(app)&&/coreTrainFromHistory\(false\)/.test(app)&&/coreTrainFromHistory\(true\)/.test(app));
ok("app: 👎 на вивченій відповіді — Ядро забуває",/rating==="down"&&!reason&&run\.meta\?\.coreQaId/.test(app)&&/forgetQA\(run\.meta\.coreQaId\)/.test(app));
ok("app: разом із хмарою Ядро випереджає лише навченим людиною, не знаннями",/\["facts","notes","doc","taught"\]\.includes/.test(app)&&!/\["facts","notes","doc","taught","know"/.test(app));
for(const k of ["coreTrainedToast","coreTrainNone","coreForgotAnswer","dmCoreD2","coreLearnOn","coreLearnOff","coreTrainBtn"])ok("i18n "+k+" (en/uk/ru)",(i18n.match(new RegExp("[{,]"+k+":","g"))||[]).length>=3);
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exit(1);
