/* v5.11.69 — «Покращити запит» у композері + «Перекласти» відповідь одним тапом:
   1) improvePromptOf/translatePromptOf: чисті — склеюють префікс i18n + текст.
   2) cyrillicRatio: частка кирилиці серед літер; порожньо → 0.
   3) translateSig: стабільний підпис для кешу перекладу.
   4) Каркас: кнопки improveBtn/translateBtn і бокс translationBox в index.html,
      проводка в app.js (включно зі скиданням кешу в renderAnswer), i18n V51169
      uk+en, CSS-класи без хардкод-hex. */
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

/* Заглушка t для чистих функцій. */
const TP={
  improvePromptPrefix:"IMPROVE:\n\n",
  translatePromptPrefix:"TRANSLATE:\n\n"
};
globalThis.t=k=>TP[k]??k;
globalThis.esc=s=>String(s??"");

(0,eval)(grabFn(app,"improvePromptOf"));
(0,eval)(grabFn(app,"translatePromptOf"));
(0,eval)(grabFn(app,"cyrillicRatio"));
(0,eval)(grabFn(app,"translateSig"));

/* ---------- 1. improvePromptOf / translatePromptOf ---------- */
{
  ok(improvePromptOf("  що таке сайдинг?  ")==="IMPROVE:\n\nщо таке сайдинг?","improvePromptOf: префікс + обрізаний текст");
  ok(improvePromptOf("")==="IMPROVE:\n\n","improvePromptOf: порожній текст");
  ok(translatePromptOf("Hello world")==="TRANSLATE:\n\nHello world","translatePromptOf: префікс + текст");
}

/* ---------- 2. cyrillicRatio ---------- */
{
  ok(cyrillicRatio("")===0,"порожньо → 0");
  ok(cyrillicRatio("123 !!!")===0,"без літер → 0");
  ok(Math.abs(cyrillicRatio("Привіт, як справи")-1)<1e-9,"український текст → ~1");
  ok(Math.abs(cyrillicRatio("Hello, how are you")-0)<1e-9,"англійський текст → ~0");
  ok(cyrillicRatio("Привіт world")>0.4&&cyrillicRatio("Привіт world")<0.7,"змішаний текст — між 0 і 1");
  ok(cyrillicRatio("Ґанок і їжак")===1,"Ґ/ї входять у кириличний діапазон");
}

/* ---------- 3. translateSig ---------- */
{
  const a=translateSig("Hello"),b=translateSig("Hello"),c=translateSig("Hello!");
  ok(a===b,"той самий текст → той самий підпис");
  ok(a!==c,"різний текст → різний підпис");
  ok(translateSig("x".repeat(5000)).length<200,"довгий текст — короткий підпис");
}

/* ---------- 4. Каркас: index.html ---------- */
{
  ok(html.includes('id="improveBtn"'),"improveBtn у композері");
  ok(html.includes('id="translateBtn"'),"translateBtn у панелі дій відповіді");
  ok(html.includes('id="translationBox"'),"translationBox під відповіддю");
  ok(html.includes('data-i18n="improveBtn"'),"improveBtn має i18n-підпис");
  ok(html.includes('data-i18n="translateBtn"'),"translateBtn має i18n-підпис");
}

/* ---------- 5. Каркас: app.js ---------- */
{
  ok(/async function improvePrompt\(\)/.test(app),"improvePrompt визначено");
  ok(/async function translateAnswer\(\)/.test(app),"translateAnswer визначено");
  ok(/function renderTranslationBox\(\)/.test(app),"renderTranslationBox визначено");
  ok(app.includes('$("improveBtn")?.addEventListener("click"'),"проводка improveBtn");
  ok(app.includes('$("translateBtn")?.addEventListener("click",translateAnswer)'),"проводка translateBtn");
  ok(app.includes('translateCache={sig:"",target:"",text:""};try{renderTranslationBox()}catch(e){}'),"renderAnswer скидає кеш перекладу");
  ok(/mode:"auto"[^}]*effort:"fast"[^}]*synthesize:false/.test(app)||/effort:"fast"[^}]*synthesize:false/.test(app),"обидві дії — дешева фонова модель (fast, без synthesize)");
  ok(app.includes('spendGateState(monthSpendUsd(),spendCapUsd())'),"повага до бюджету витрат");
  ok(app.includes('translateCache.sig===sig&&translateCache.target===target'),"кеш перекладу не б'є модель повторно");
}

/* ---------- 6. i18n V51169 uk+en ---------- */
{
  ok(i18n.includes("const V51169="),"блок V51169 присутній");
  const keys=["improveBtn","improvePromptPrefix","improveEmpty","improveNoProvider","improveFail","improveDone",
    "translateBtn","translateTitle","translateClose","translatePromptPrefix","translateNoProvider",
    "translateFail","translateDone","translateAlreadyUa","translateAlreadyEn"];
  for(const k of keys){
    ok(new RegExp(`en:\\{[^}]*\\b${k}:`).test(i18n),`en має ключ ${k}`);
    ok(new RegExp(`uk:\\{[^}]*\\b${k}:`).test(i18n),`uk має ключ ${k}`);
  }
  ok(/Object\.assign\(EN,strings\)/.test(i18n),"V51169 зливається в EN/PACKS");
}

/* ---------- 7. CSS ---------- */
{
  ok(css.includes(".translationBox"),"клас .translationBox");
  ok(css.includes(".trHead")&&css.includes(".trBody"),"класи .trHead/.trBody");
  ok(css.includes(".composerToolBtn.busy"),"стан busy для кнопок композера");
  const myCss=css.slice(css.indexOf("/* v5.11.69:"));
  ok(!/#[0-9a-fA-F]{3,8}/.test(myCss),"мій CSS — без хардкод-hex, лише токени");
}

console.log(`\nУСЬОГО: ${passed} перевірок пройдено`);
