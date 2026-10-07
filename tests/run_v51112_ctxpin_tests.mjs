/* v5.11.12 — індикатор контексту + закріплення (pin).
   1) contextUsage: чиста оцінка токенів (символи/4), pct обрізається на 999.
   2) pin-хелпери: load/save/toggle/isPinned/sortPinnedFirst на стабнутому localStorage.
   3) Статичні перевірки: #ctxMeter в index.html, ключі V51112 в i18n.js (uk+en),
      рендер-функції і data-атрибути в app.js, стилі в styles.css. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=R("index.html"),css=R("styles.css"),app=R("app.js"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. витягуємо чисті функції з app.js і виконуємо в пісочниці --- */
const store={};
globalThis.localStorage={
  getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,
  setItem:(k,v)=>{store[k]=String(v)},
  removeItem:k=>{delete store[k]},
};
function grab(src,name){
  // function name(...) {...} — беремо до кінця рядка закриваючої дужки на початку рядка
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
const sandbox=`
const CTX_METER_BUDGET=40000;
${grab(app,"contextUsage")}
${grab(app,"loadPinned")}
${grab(app,"savePinned")}
${grab(app,"togglePinned")}
${grab(app,"isPinned")}
${grab(app,"sortPinnedFirst")}
`;
(0,eval)(sandbox);

/* --- 2. contextUsage --- */
{
  const u0=contextUsage([]);
  ok(u0.tokens===0&&u0.pct===0&&u0.budget===40000,"порожній діалог: 0 токенів, 0%");
  const u1=contextUsage([{role:"user",text:"a".repeat(400)},{role:"assistant",text:"b".repeat(400)}]);
  ok(u1.tokens===200&&u1.pct===1,`800 символів = 200 токенів, 1% (отримано ${u1.tokens}/${u1.pct}%)`);
  const u2=contextUsage([{role:"user",text:"x".repeat(160000)}]);
  ok(u2.tokens===40000&&u2.pct===100,"160000 символів = 40000 токенів, 100%");
  const u3=contextUsage([{role:"user",text:"x".repeat(4000000)}]);
  ok(u3.pct===999,"pct обрізається на 999 при переповненні");
  const u4=contextUsage([{role:"user",text:"ok"},{role:"assistant",error:true,text:"boom".repeat(1000)}]);
  ok(u4.tokens===1,"повідомлення з error ігноруються");
  const u5=contextUsage(null);
  ok(u5.tokens===0,"null → 0 токенів");
}

/* --- 3. pin-хелпери --- */
{
  ok(JSON.stringify(loadPinned("k"))==="[]","порожнє сховище → []");
  togglePinned("k","a");togglePinned("k","b");
  const after2=loadPinned("k");
  ok(after2.length===2&&after2[0]==="b"&&after2[1]==="a","порядок закріплення: остання зверху");
  ok(isPinned(loadPinned("k"),"a")&&!isPinned(loadPinned("k"),"z"),"isPinned працює");
  togglePinned("k","a");
  ok(JSON.stringify(loadPinned("k"))==='["b"]',"повторний toggle знімає закріплення");
  const sorted=sortPinnedFirst([{id:"1"},{id:"2"},{id:"3"}],x=>x.id,["3","1"]);
  ok(sorted.map(x=>x.id).join(",")==="3,1,2","закріплені перші, решта зберігає порядок");
  const stable=sortPinnedFirst([{id:"a",c:3},{id:"b",c:2},{id:"c",c:1}],x=>x.id,[]);
  ok(stable.map(x=>x.id).join(",")==="a,b,c","без закріплень порядок не змінюється");
  store.k="not-json{{";
  ok(JSON.stringify(loadPinned("k"))==="[]","битий JSON → []");
}

/* --- 4. статика: HTML --- */
ok(html.includes('id="ctxMeter"'),"#ctxMeter в index.html");
ok(/id="ctxMeter"[^>]*class="ctxMeter"/.test(html),"#ctxMeter має клас .ctxMeter");

/* --- 5. статика: i18n uk+en --- */
{
  const m=i18n.match(/const V51112=\{([\s\S]*?)\n\};/);
  ok(!!m,"є словник V51112");
  const body=m?m[1]:"";
  ok(/en:\{[^}]*ctxMeter:"Context: \{p\}%/.test(body),"en: ctxMeter");
  ok(/uk:\{[^}]*ctxMeter:"Контекст: \{p\}%/.test(body),"uk: ctxMeter");
  ok(/pinBtn:"Pin"/.test(body)&&/unpinBtn:"Unpin"/.test(body),"en: pinBtn/unpinBtn");
  ok(/pinBtn:"Закріпити"/.test(body)&&/unpinBtn:"Відкріпити"/.test(body),"uk: pinBtn/unpinBtn");
  ok(!/ru:\{/.test(body),"російської в V51112 немає (правило власника)");
}

/* --- 6. статика: app.js --- */
ok(app.includes("function renderCtxMeter"),"є renderCtxMeter");
ok(app.includes('renderCtxMeter();'),"renderCtxMeter викликається");
ok(app.includes("aibridge:languagechange"),"перерендер індикатора при зміні мови");
ok(app.includes('PINNED_RUNS_KEY="ai_bridge_pinned_runs"'),"ключ закріплених діалогів");
ok(app.includes('PINNED_PROVIDERS_KEY="ai_bridge_pinned_providers"'),"ключ закріплених моделей");
ok(app.includes('data-history-pin'),"кнопка pin в історії");
ok(app.includes('data-provider-pin'),"кнопка pin у списку моделей");
ok(app.includes("providerPickWrap"),"обгортка providerPickWrap");

/* --- 7. статика: styles.css --- */
ok(/\.ctxMeter\{/.test(css),"стиль .ctxMeter");
ok(/\.ctxMeter\.warn/.test(css)&&/\.ctxMeter\.hot/.test(css),"стани .warn/.hot");
ok(/\.pinBtn\{/.test(css),"стиль .pinBtn");
ok(/\.historyPin\{/.test(css),"стиль .historyPin");
ok(/\.pinBtn[^{]*\{[^}]*min-width:44px/.test(css)&&/\.historyPin[^{]*\{[^}]*min-height:44px/.test(css),"тач-таргети ≥44px (мобайл)");

console.log(`\nУСЬОГО: ${passed} перевірок`);
