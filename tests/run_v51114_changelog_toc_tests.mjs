/* v5.11.14 — Журнал «Що нового» + зміст діалогу агента.
   1) changelog-app.json: валідний JSON, схема записів, унікальні версії за спаданням,
      бекфіл v5.11.8–v5.11.13, запис v5.11.14 з обома фічами.
   2) whatsNewBullets: вибір мови uk/en, фолбек, фільтр сміття.
   3) chatTocItems: тільки user-повідомлення, мітки обрізаються, порожні пропускаються.
   4) Статичні перевірки: пункт меню, сторінка, хости, i18n-ключі uk+en,
      renderWhatsNew у showPage, renderChatToc у renderAgentThread, перемикач. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. витягуємо чисті функції з app.js --- */
function grab(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
const sandbox=`${grab(app,"whatsNewBullets")}\n${grab(app,"chatTocItems")}\n`;
(0,eval)(sandbox);

/* --- 2. changelog-app.json --- */
{
  const log=JSON.parse(R("changelog-app.json"));
  ok(Array.isArray(log)&&log.length>=7,"масив із ≥7 записами (бекфіл + новий)");
  for(const e of log){
    ok(typeof e.v==="string"&&/^\d+\.\d+\.\d+$/.test(e.v),"запис має версію: "+e.v);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date||""),"запис "+e.v+" має дату");
    ok(Array.isArray(e.uk)&&e.uk.length>0&&e.uk.every(x=>typeof x==="string"),"запис "+e.v+" має uk-пункти");
    ok(Array.isArray(e.en)&&e.en.length>0&&e.en.every(x=>typeof x==="string"),"запис "+e.v+" має en-пункти");
  }
  const vs=log.map(e=>e.v);
  ok(new Set(vs).size===vs.length,"версії унікальні");
  const nums=vs.map(v=>v.split(".").map(Number));
  ok(nums.every((n,i)=>i===0||n[0]*1e6+n[1]*1e3+n[2]<nums[i-1][0]*1e6+nums[i-1][1]*1e3+nums[i-1][2]),"версії за спаданням (новіша першою)");
  const bv=JSON.parse(R("bridge-version.json")).version;
  ok(vs[0]===bv,"перший запис — поточна версія "+bv);
  for(const v of ["5.11.8","5.11.9","5.11.10","5.11.11","5.11.12","5.11.13"])ok(vs.includes(v),"бекфіл містить "+v);
  const cur=log.find(e=>e.v==="5.11.14");
  ok(cur,"запис 5.11.14 існує");
  ok(cur.uk.some(x=>x.includes("Що нового")),"5.11.14 uk згадує «Що нового»");
  ok(cur.uk.some(x=>x.includes("Зміст")),"5.11.14 uk згадує «Зміст»");
}

/* --- 3. whatsNewBullets --- */
{
  const e={v:"5.11.14",uk:["Раз","Два"],en:["One"]};
  ok(JSON.stringify(whatsNewBullets(e,"uk"))===JSON.stringify(["Раз","Два"]),"uk → uk-пункти");
  ok(JSON.stringify(whatsNewBullets(e,"en"))===JSON.stringify(["One"]),"en → en-пункти");
  ok(JSON.stringify(whatsNewBullets({uk:["Тільки ук"]},"en"))===JSON.stringify(["Тільки ук"]),"фолбек на uk, якщо en немає");
  ok(JSON.stringify(whatsNewBullets({en:["Only en"]},"uk"))===JSON.stringify(["Only en"]),"фолбек на en, якщо uk немає");
  ok(whatsNewBullets(null,"uk").length===0,"null → []");
  ok(whatsNewBullets({uk:["ok","","  ",42,null]},"uk").length===1,"сміття фільтрується");
  ok(whatsNewBullets({uk:Array(9).fill("x")},"uk").length===6,"максимум 6 пунктів");
}

/* --- 4. chatTocItems --- */
{
  const msgs=[
    {role:"user",text:"Як налаштувати Gemini API ключ?"},
    {role:"assistant",text:"Ось інструкція…"},
    {role:"user",text:"  "},
    {role:"user",text:"А що з Groq — він безкоштовний? Розкажи детальніше про ліміти і як підключити."},
    {role:"assistant",text:"…",error:true},
  ];
  const items=chatTocItems(msgs);
  ok(items.length===2,"тільки непорожні user-повідомлення (2)");
  ok(items[0].index===0&&items[0].label==="Як налаштувати Gemini API ключ?","перший: індекс 0, повна мітка");
  ok(items[1].index===3,"другий: індекс 3");
  ok(items[1].label.length<=42,"довга мітка обрізана до 42");
  ok(!items[1].label.includes("  "),"зайві пробіли стиснуті");
  ok(chatTocItems([]).length===0,"порожній вхід → []");
  ok(chatTocItems(null).length===0,"null → []");
  ok(chatTocItems([{role:"assistant",text:"x"}]).length===0,"без user — порожньо");
}

/* --- 5. статичні перевірки: «Що нового» --- */
{
  ok(/data-more-page="whatsnew"/.test(html),"пункт меню whatsnew у колонці-меню");
  ok(/id="page-whatsnew"/.test(html),"секція page-whatsnew");
  ok(/id="whatsNewList"/.test(html),"хост whatsNewList");
  ok(/data-i18n="navWhatsNew"/.test(html)&&/data-i18n="whatsNewTitle"/.test(html),"i18n-атрибути в HTML");
  ok(/navWhatsNew:"What's new"/.test(i18n),"ключ navWhatsNew в en");
  ok(/navWhatsNew:"Що нового"/.test(i18n),"ключ navWhatsNew в uk");
  for(const k of ["moreWhatsNew","whatsNewTitle","whatsNewDesc","whatsNewEmpty"])ok(new RegExp(k+':"').test(i18n),"ключ "+k+" присутній");
  ok(/if\(name==="whatsnew"\)renderWhatsNew\(\)/.test(app),"showPage → renderWhatsNew");
  ok(/fetch\("changelog-app\.json"/.test(app),"renderWhatsNew читає changelog-app.json");
  ok(/cache:"no-store"/.test(app),"журнал не кешується (завжди свіжий)");
}

/* --- 6. статичні перевірки: зміст діалогу --- */
{
  ok(/id="tocWrap"/.test(html)&&/id="tocChips"/.test(html)&&/id="tocToggle"/.test(html),"розмітка TOC: tocWrap/tocChips/tocToggle");
  ok(/data-i18n="tocTitle"/.test(html),"i18n-атрибут tocTitle");
  ok(/tocTitle:"Contents"/.test(i18n),"ключ tocTitle в en");
  ok(/tocTitle:"Зміст"/.test(i18n),"ключ tocTitle в uk");
  ok(/renderChatToc\(\);?\s*\n?\}/.test(app)||/renderCtxMeter\(\);renderChatToc\(\)/.test(app),"renderAgentThread викликає renderChatToc");
  ok(/tocToggle/.test(app)&&/scrollIntoView/.test(app),"перемикач і стрибок до повідомлення");
  ok(/\.tocChip/.test(R("styles.css"))&&/\.wnCard/.test(R("styles.css")),"CSS-класи tocChip і wnCard");
}

console.log(`\nPASS: ${passed} перевірок`);
