/* Тести v5.11.107: «Ядро питає хмару, коли не знає» і вчиться з відповіді.
   Запуск: node tests/run_v511107_core_ask_tests.mjs */
import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const C=require("../core.js");
let pass=0,fail=0;
function ok(name,cond,extra){if(cond)pass++;else{fail++;console.log("FAIL: "+name+(extra!==undefined?" — "+JSON.stringify(extra).slice(0,200):""))}}
const ver=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")).version;
ok("VERSION="+ver,C.VERSION===ver,C.VERSION);

/* 1. Цикл навчання на рівні Ядра: не знало → вивчило відповідь хмари → відповідає саме. */
const A=C.createAssistant();
const q="Хто написав Кобзар?";
const r1=A.respond(q);
ok("до навчання Ядро чесно не знає і просить хмару",r1.handled===false&&r1.escalate===true,r1);
const L=A.learnQA(q,"«Кобзар» написав Тарас Шевченко (перше видання — 1840).",{source:"Groq Free",ts:1});
ok("learnQA приймає відповідь хмари",L&&typeof L.id==="string",L);
const r2=A.respond(q);
ok("після навчання Ядро відповідає саме",r2.handled===true&&/Шевченко/.test(r2.text||""),r2);
ok("відповідь має qaId (щоб 👎 міг змусити забути)",!!r2.qaId,r2.qaId);
const r3=A.respond("хто написав кобзар");
ok("перефразоване (регістр/знаки) теж впізнає",r3.handled===true&&/Шевченко/.test(r3.text||""),r3.text);
ok("forgetQA прибирає вивчене",A.forgetQA(r2.qaId)===true&&A.respond(q).handled===false);

/* 2. Застосунок: Ядро саме питає хмару лише зі згоди людини. */
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
ok("типово вимкнено (лише значення \"1\" вмикає)",/function coreAskCloudOn\(\)\{try\{return localStorage\.getItem\(CORE_ASK_KEY\)==="1"\}catch\(e\)\{return false\}\}/.test(app));
const lc=app.slice(app.indexOf("function runLocalCore"),app.indexOf("async function sendTask"));
ok("питає лише коли Ядро не впоралось, у звичайному чаті, без файлу, зі згодою",/if\(r&&!r\.handled&&r\.escalate&&source==="chat"&&!context&&coreAskCloudOn\(\)\)/.test(lc));
ok("питання йде одній моделі (forceProvider) з позначкою coreAsked",/sendTask\(\{source:"chat",promptText:clean,forceProvider:teacher,coreAsked:true\}\)/.test(lc));
ok("без хмарних ключів — звичайна чесна відповідь Ядра",/if\(teacher\)\{sendTask/.test(lc));
const order=(app.match(/CORE_TEACHER_ORDER=\[([^\]]+)\]/)||[])[1]||"";
ok("спершу безкоштовні моделі",/^"groqfree","openrouter"/.test(order),order);
ok("Muse і Ядро не можуть бути вчителем (лише apiProviderIds)",/const ready=apiProviderIds\(\);/.test(app));
ok("відповідь вчителя вивчається навіть якщо загальне самонавчання вимкнене",/coreLearnFromRun\(currentRun,options\.coreAsked\?\{force:true\}:undefined\)/.test(app));
ok("інкогніто не вчиться (coreLearnFromRun відкидає temporary)",/if\(m\.error\|\|m\.temporary/.test(app));
ok("run позначено coreAsked",/if\(options\.coreAsked\)currentRun\.meta\.coreAsked=true/.test(app));
ok("перемикач у «Карті даних»",/id="coreAskToggleBtn"/.test(app)&&/\$\("coreAskToggleBtn"\)\.onclick/.test(app));
for(const k of ["coreAskOn","coreAskOff","coreAskOnToast","coreAskOffToast","coreAskedToast"]){
  const n=(i18n.match(new RegExp("\\b"+k+":","g"))||[]).length;
  ok("i18n "+k+" (en/uk/ru)",n>=3,n);
}
console.log(`\nrun_v511107: PASS ${pass}, FAIL ${fail}`);
if(fail)process.exit(1);
