/* v5.11.30: Закладки на діалоги + місячний бюджет витрат на моделі (ідеї scout).
   1) Чисті функції: spendGateState, spendUsdTotal, bookmarkTitleOf, bookmarkKeyOf.
   2) Функції зі сховищем (localStorage-шим): toggleBookmark, isBookmarked, spendCapUsd/setSpendCap, monthSpendUsd.
   3) Клієнт: гейт бюджету в sendTask ДО виклику моделі, кнопки закладок в історії
      й на відповіді, фільтр «Тільки закладки», картка бюджету в usageCard.
   4) i18n: 13 ключів en+uk+ru; CSS: тільки токени, без hex. */
import fs from "node:fs";
const root=new URL("../",import.meta.url).href;
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
let passed=0;const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)};

/* --- localStorage-шим для node --- */
function makeLS(){const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:k=>{m.delete(k)},clear:()=>m.clear()}}
globalThis.localStorage=makeLS();

function extractFn(src,name){
  const start=src.indexOf("function "+name+"(");
  if(start<0)throw new Error("no function "+name);
  const end=src.indexOf("\n}\n",start);
  if(end<0)throw new Error("no end for "+name);
  return src.slice(start,end+2);
}
function loadFn(name,extra={}){
  const code=extractFn(app,name);
  const names=Object.keys(extra),vals=Object.values(extra);
  return new Function(...names,code+`;return ${name};`)(...vals);
}
const dayKey=loadFn("dayKey");
const spendGateState=loadFn("spendGateState");
const spendUsdTotal=loadFn("spendUsdTotal",{dayKey,SPEND_DAYS:30});
const bookmarkTitleOf=loadFn("bookmarkTitleOf");
const bookmarkKeyOf=loadFn("bookmarkKeyOf");
const loadBookmarks=loadFn("loadBookmarks",{BOOKMARKS_KEY:"ai_bridge_bookmarks_v1",BOOKMARKS_MAX:200});
const saveBookmarks=loadFn("saveBookmarks",{BOOKMARKS_KEY:"ai_bridge_bookmarks_v1",BOOKMARKS_MAX:200});
const toggleBookmark=loadFn("toggleBookmark",{loadBookmarks,saveBookmarks});
const isBookmarked=loadFn("isBookmarked",{loadBookmarks});
const spendCapUsd=loadFn("spendCapUsd",{SPEND_CAP_KEY:"ai_bridge_spend_cap_v1"});
const setSpendCap=loadFn("setSpendCap",{SPEND_CAP_KEY:"ai_bridge_spend_cap_v1"});
const loadUsage=loadFn("loadUsage",{USAGE_KEY:"ai_bridge_usage_v1"});
const monthSpendUsd=loadFn("monthSpendUsd",{loadUsage,spendUsdTotal,dayKey,SPEND_DAYS:30});

/* --- 1. spendGateState: пороги 80% / 100% --- */
ok(spendGateState(0,5).state==="ok","гейт: 0/5 → ok");
ok(spendGateState(3.99,5).state==="ok","гейт: 3.99/5 → ok");
ok(spendGateState(4,5).state==="warn","гейт: 4/5 (80%) → warn");
ok(spendGateState(4.5,5).state==="warn","гейт: 4.5/5 → warn");
ok(spendGateState(5,5).state==="block","гейт: 5/5 (100%) → block");
ok(spendGateState(7,5).state==="block","гейт: 7/5 (перевищення) → block");
ok(spendGateState(4,5).pct===80,"гейт: pct округлюється до 80");
ok(spendGateState(0,0).state==="off","гейт: cap 0 → off");
ok(spendGateState(0,null).state==="off","гейт: cap null → off");
ok(spendGateState(0,-3).state==="off","гейт: від'ємний cap → off");

/* --- 2. spendUsdTotal: вікно 30 днів --- */
function dk(offset,base){const d=new Date(base-offset*86400000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
const nowT=Date.now(),u={};
u[dk(0,nowT)]={groq:{n:2,ok:2,err:0,ms:100,usd:0.0042}};
u[dk(5,nowT)]={gemini:{n:1,ok:1,err:0,ms:200,usd:0.01}};
u[dk(40,nowT)]={groq:{n:9,ok:9,err:0,ms:100,usd:9.99}};
ok(Math.abs(spendUsdTotal(u,nowT)-0.0142)<1e-9,"spendUsdTotal: сумує 30 днів, старше 30 днів відсікає");
ok(spendUsdTotal({},nowT)===0,"spendUsdTotal: порожнє сховище → 0");
ok(spendUsdTotal(null,nowT)===0,"spendUsdTotal: null → 0");

/* --- 3. закладки: чисті функції --- */
ok(bookmarkKeyOf({uid:"abc",id:7})==="abc","bookmarkKeyOf: uid у пріоритеті");
ok(bookmarkKeyOf({id:7})==="7","bookmarkKeyOf: без uid бере id");
ok(bookmarkKeyOf({})==="","bookmarkKeyOf: без ключів → порожньо");
ok(bookmarkTitleOf({title:"Заголовок"})==="Заголовок","bookmarkTitleOf: бере title");
ok(bookmarkTitleOf({prompt:"Питання\nдругий рядок"})==="Питання","bookmarkTitleOf: перший рядок промпта");
ok(bookmarkTitleOf({}).length===0,"bookmarkTitleOf: порожній run → порожньо");

/* --- 4. закладки: сховище --- */
ok(toggleBookmark("u1","Заголовок")===true,"toggleBookmark: додавання → true");
ok(isBookmarked("u1")===true,"isBookmarked: знаходить додане");
ok(toggleBookmark("u1","Заголовок")===false,"toggleBookmark: повторний виклик прибирає → false");
ok(isBookmarked("u1")===false,"isBookmarked: після прибирання → false");
ok(toggleBookmark("","x")===false,"toggleBookmark: порожній id → false");
toggleBookmark("u2","Другий");toggleBookmark("u3","Третій");
const bl=JSON.parse(localStorage.getItem("ai_bridge_bookmarks_v1"));
ok(bl.length===2&&bl[0].id==="u3","закладки: нові — нагорі списку (u3 перша)");

/* --- 5. бюджет: сховище + monthSpendUsd наскрізно --- */
ok(spendCapUsd()===null,"spendCapUsd: без ліміту → null");
setSpendCap(5);ok(spendCapUsd()===5,"setSpendCap(5) → 5");
setSpendCap(2.345);ok(spendCapUsd()===2.35,"setSpendCap округлює до центів");
setSpendCap(0);ok(spendCapUsd()===null,"setSpendCap(0) → null (вимкнено)");
setSpendCap(null);ok(spendCapUsd()===null,"setSpendCap(null) → null");
localStorage.setItem("ai_bridge_usage_v1",JSON.stringify(u));
ok(Math.abs(monthSpendUsd(nowT)-0.0142)<1e-9,"monthSpendUsd: читає usage з localStorage");

/* --- 6. клієнтський код: гейт у sendTask --- */
ok(/spendGateState\(monthSpendUsd\(\),spendCapUsd\(\)\)/.test(app),"sendTask: гейт бюджету викликається");
ok(/gate\.state==="block"[\s\S]{0,80}toast\(t\("spendCapBlocked"\)/.test(app),"гейт: block → тост spendCapBlocked");
ok(/gate\.state==="warn"[\s\S]{0,200}SPEND_WARN_KEY/.test(app),"гейт: warn → одноразове попередження на день");
ok(/e\.usd=Math\.round/.test(app),"recordUsage: акумулює usd з r.costUsd");
ok(!/«Закладки|Місячний бюджет|Додано в закладки/.test(app),"app.js: український UI-текст не захардкоджено");

/* --- 7. клієнтський код: закладки в UI --- */
ok(/data-history-bm=/.test(app),"історія: кнопка data-history-bm");
ok(/class="historyPin historyBm/.test(app),"історія: кнопка-зірочка наслідує historyPin");
ok(/bookmarksOnly\?all\.filter/.test(app),"історія: фільтр bookmarksOnly");
ok(/id="bookmarkBtn"/.test(html),"тулбар відповіді: кнопка bookmarkBtn");
ok(/data-i18n-aria="bookmarkAdd"/.test(html),"bookmarkBtn: aria через i18n");
ok(/id="bookmarksFilterBtn"/.test(html),"історія: кнопка фільтра bookmarksFilterBtn");
ok(/data-i18n="bookmarksFilter"/.test(html),"фільтр: підпис через i18n");
ok(/syncBookmarkBtn\(currentRun\)/.test(app),"клік по зірочці синхронізує стан кнопки");
ok(/function syncBookmarkBtn\(/.test(app),"syncBookmarkBtn визначено");

/* --- 8. клієнтський код: картка бюджету --- */
ok(/id="spendCapInput"/.test(html),"usageCard: поле spendCapInput");
ok(/id="spendCapSave"/.test(html),"usageCard: кнопка spendCapSave");
ok(/id="spendCapBar"/.test(html)&&/id="spendCapBarFill"/.test(html),"usageCard: прогрес-бар бюджету");
ok(/id="spendCapStatus"/.test(html),"usageCard: рядок статусу spendCapStatus");
ok(/data-i18n="spendCapTitle"/.test(html)&&/data-i18n="spendCapHint"/.test(html),"бюджет: підписи через i18n");
ok(/renderSpendCap\(\)/.test(app),"renderUsage оновлює картку бюджету");

/* --- 9. i18n: 13 ключів × 3 мови --- */
for(const k of ["bookmarkAdd","bookmarkRemove","bookmarkSaved","bookmarkRemoved","bookmarksFilter","spendCapTitle","spendCapLabel","spendCapSaved","spendCapSpent","spendCapNoCap","spendCapHint","spendCapWarn","spendCapBlocked"]){
  ok(i18n.includes(k+':"'),`i18n: ключ ${k} присутній`);
}
ok(/uk:\{[^}]*bookmarkAdd:"Додати в закладки"/.test(i18n),"i18n uk: bookmarkAdd");
ok(/ru:\{[^}]*bookmarkAdd:"В закладки"/.test(i18n),"i18n ru: bookmarkAdd");
const v30=i18n.slice(i18n.indexOf("const V51130="));
ok(/^\s*en:\{[\s\S]*?spendCapBlocked:"Monthly budget exhausted/m.test(v30),"i18n en: spendCapBlocked");
ok(/^\s*uk:\{[\s\S]*?spendCapWarn:"Увага: витрачено \{pct\}/m.test(v30),"i18n uk: spendCapWarn з плейсхолдером");

/* --- 10. CSS: тільки токени --- */
const cssBlock=css.slice(css.indexOf("/* v5.11.30:"));
ok(cssBlock.length>200,"styles.css: блок v5.11.30 присутній");
ok(/\.historyBm\.on\{/.test(cssBlock),"CSS: .historyBm.on");
ok(/\.spendCapBlock\{/.test(cssBlock),"CSS: .spendCapBlock");
ok(/\.spendCapBar i\{/.test(cssBlock),"CSS: .spendCapBar i");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(cssBlock),"CSS: жодних hex-кольорів у новому блоці");
ok(!/style=/.test(cssBlock),"CSS: жодних інлайн-стилів у новому блоці");

console.log(`\n${passed} checks passed`);
