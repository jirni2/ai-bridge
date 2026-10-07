/* v5.11.46 — вибір моделі з пошуком і групуванням за провайдером
   + індикатори непрочитаного в історії чатів.
   1) MODEL_CATALOG: 6 провайдерів, [ім'я, ключ сили], ключі сили в i18n (uk+en).
   2) Поле #modelSearch в index.html з i18n-плейсхолдером; renderProviders фільтрує.
   3) Хелпери непрочитаного: mark/clear/load/save з лімітом 200 (localStorage-стаб).
   4) Хуки: saveRun позначає, renderAnswer/newTask знімають, renderHistory малює крапку.
   5) styles.css: .modelRow/.modelList/.unreadDot. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. MODEL_CATALOG --- */
const catM=app.match(/const MODEL_CATALOG=\{[\s\S]*?\n\};/);
ok(!!catM,"MODEL_CATALOG присутній в app.js");
const MODEL_CATALOG=new Function("return ("+catM[0].replace(/^const MODEL_CATALOG=/,"").replace(/;$/,"")+")")();
const provIds=["openai","claude","gemini","grok","groqfree","openrouter"];
for(const id of provIds){
  ok(Array.isArray(MODEL_CATALOG[id])&&MODEL_CATALOG[id].length>0,`каталог: ${id} має моделі`);
  for(const [m,s] of MODEL_CATALOG[id]){
    ok(typeof m==="string"&&m.length>0&&typeof s==="string"&&s.startsWith("strength"),`каталог ${id}: [${m}, ${s}]`);
    ok(new RegExp(s+':"[^"]*[а-яіїєґ]','i').test(i18n),`ключ ${s} є в uk`);
    ok(new RegExp(s+':"[A-Za-z]').test(i18n),`ключ ${s} є в en`);
  }
}
ok(/modelSearchPh:"Пошук моделі/.test(i18n),"ключ modelSearchPh в uk");
ok(/modelSearchPh:"Search models/.test(i18n),"ключ modelSearchPh в en");
ok(/modelActive:"налаштовано/.test(i18n),"ключ modelActive в uk");
ok(/modelActive:"configured/.test(i18n),"ключ modelActive в en");
ok(/histUnread:"Непрочитане/.test(i18n),"ключ histUnread в uk");
ok(/histUnread:"Unread/.test(i18n),"ключ histUnread в en");

/* --- 2. Поле пошуку + фільтр --- */
ok(/id="modelSearch"/.test(html),"index.html: поле #modelSearch");
ok(/data-i18n-placeholder="modelSearchPh"/.test(html),"#modelSearch з i18n-плейсхолдером");
ok(/modelSearchWrap/.test(html),"обгортка modelSearchWrap в index.html");
ok(/\$\("modelSearch"\)/.test(app),"renderProviders читає #modelSearch");
ok(/data-model-provider/.test(app),"рядки моделей з data-model-provider (тап = вибір)");
ok(/provGroup/.test(app),"групи провайдерів provGroup");

/* --- 3. Хелпери непрочитаного (чисті, зі стабом localStorage) --- */
const stub=(()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}})();
const helpersM=app.match(/const HIST_UNREAD_KEY="ai_bridge_hist_unread_v1";[\s\S]*?function clearHistUnread\(uid\)\{[\s\S]*?\n\}/);
ok(!!helpersM,"хелпери непрочитаного знайдено в app.js");
const factory=new Function("localStorage",helpersM[0]+"\nreturn {loadHistUnread,saveHistUnread,markHistUnread,clearHistUnread};");
const {loadHistUnread,markHistUnread,clearHistUnread}=factory(stub);
ok(Object.keys(loadHistUnread()).length===0,"порожнє сховище → {}");
markHistUnread("uid-1");markHistUnread("uid-2");
ok(!!loadHistUnread()["uid-1"]&&!!loadHistUnread()["uid-2"],"mark ставить дві мітки");
clearHistUnread("uid-1");
ok(!("uid-1" in loadHistUnread())&&("uid-2" in loadHistUnread()),"clear знімає лише свою");
clearHistUnread("uid-nope");
ok(Object.keys(loadHistUnread()).length===1,"clear неіснуючого — без змін");
markHistUnread("");markHistUnread(null);
ok(Object.keys(loadHistUnread()).length===1,"порожній uid ігнорується");
stub.setItem("ai_bridge_hist_unread_v1","{broken");
ok(Object.keys(loadHistUnread()).length===0,"бите сховище → {}");
for(let i=0;i<250;i++)markHistUnread("u"+i);
ok(Object.keys(loadHistUnread()).length<=200,"ліміт 200 записів");

/* --- 4. Хуки в потоці --- */
ok(/run\.uid&&run\.uid!==viewedRunUid\)markHistUnread\(run\.uid\)/.test(app),"saveRun позначає непрочитане (не показане)");
ok(/viewedRunUid=run\?\.uid\|\|null;clearHistUnread\(run\?\.uid\)/.test(app),"renderAnswer показує діалог і знімає мітку");
ok(/function newTask\(\)\{\s*\n?\s*viewedRunUid=null/.test(app),"newTask скидає показаний діалог");
ok(/unreadMap=loadHistUnread\(\)/.test(app),"renderHistory читає мітки");
ok(/unreadDot/.test(app)&&/histUnread/.test(app),"renderHistory малює крапку з aria-підписом");
ok(/hasUnread/.test(app),"клас hasUnread на картці діалогу");

/* --- 5. Стилі --- */
ok(/\.modelList/.test(css),"styles.css: .modelList");
ok(/\.modelRow/.test(css),"styles.css: .modelRow");
ok(/\.modelActiveTag/.test(css),"styles.css: .modelActiveTag");
ok(/\.unreadDot/.test(css),"styles.css: .unreadDot");
ok(/#modelSearch/.test(css),"styles.css: #modelSearch");

console.log(`\n${passed} checks passed`);
