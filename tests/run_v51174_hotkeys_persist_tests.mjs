/* v5.11.74 — захист сховища (storage.persist) + гарячі клавіші:
   1) ensureStoragePersist: викликає navigator.storage.persist(), стани
      pending/granted/denied/unsupported, виклик при завантаженні.
   2) renderDataMap додає окремий рядок 💾 з живим статусом
      (id="persistStatusLine", ключі dmPersistT/dmPersistD/dmPersistOn/
      dmPersistOff/dmPersistUnknown) — поза DATA_MAP_ROWS (той тест рахує 8).
   3) HOTKEY_ROWS (5 записів) + renderHotkeys() у #hotkeysList;
      showPage("hotkeys"); пункт меню data-more-page="hotkeys" і
      <section id="page-hotkeys"> в index.html.
   4) Глобальний keydown: Ctrl/Cmd+Enter у #agentPrompt → клік agentStartBtn.
   5) V51174 uk+en в i18n.js: усі ключі в обох мовах.
   6) Стиль .hkKeys у styles.css. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^(?:async )?function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* ---------- 1. storage.persist ---------- */
{
  const fn=grabFn(app,"ensureStoragePersist");
  ok(fn.includes("navigator.storage.persist"),"ensureStoragePersist викликає navigator.storage.persist()");
  ok(fn.includes('"granted"')&&fn.includes('"denied"')&&fn.includes('"unsupported"')&&fn.includes('"pending"'),
    "стани pending/granted/denied/unsupported");
  ok(app.includes("persistState")&&/let persistState=/.test(app),"змінна persistState");
  // Виклик при завантаженні: окремий рядок ensureStoragePersist(); у головному IIFE
  const bootCalls=(app.match(/^\s*ensureStoragePersist\(\);$/gm)||[]).length;
  ok(bootCalls>=1,"ensureStoragePersist() викликається при завантаженні");
  const status=grabFn(app,"persistStatusText");
  ok(status.includes("dmPersistOn")&&status.includes("dmPersistOff")&&status.includes("dmPersistUnknown"),
    "persistStatusText мапить стани на ключі");
}

/* ---------- 2. рядок у renderDataMap ---------- */
{
  const dm=grabFn(app,"renderDataMap");
  ok(dm.includes("persistStatusLine"),"рядок зі статусом має id persistStatusLine");
  ok(dm.includes("dmPersistT")&&dm.includes("dmPersistD"),"рядок використовує ключі dmPersistT/dmPersistD");
  ok(dm.includes("ensureStoragePersist().then"),"статус оновлюється після відповіді persist()");
  // Не в DATA_MAP_ROWS: тест v5.11.40 рахує рівно 8 рядків у константі
  const rowsM=app.match(/^const DATA_MAP_ROWS=\[([\s\S]*?)\n\];/m);
  ok(rowsM&&!rowsM[1].includes("dmPersist"),"persist-рядок НЕ в DATA_MAP_ROWS");
}

/* ---------- 3. гарячі клавіші: дані, рендер, сторінка ---------- */
{
  const rowsM=app.match(/^const HOTKEY_ROWS=\[([\s\S]*?)\n\];/m);
  ok(rowsM,"HOTKEY_ROWS існує");
  const n=(rowsM[1].match(/\{keys:/g)||[]).length;
  ok(n>=4,`HOTKEY_ROWS має ${n} записи (очікувалось ≥4)`);
  const hk=grabFn(app,"renderHotkeys");
  ok(hk.includes("hotkeysList")&&hk.includes("HOTKEY_ROWS"),"renderHotkeys рендерить HOTKEY_ROWS у #hotkeysList");
  ok(/if\(name==="hotkeys"\)renderHotkeys\(\);/.test(app),'showPage("hotkeys") викликає renderHotkeys()');
  ok(html.includes('data-more-page="hotkeys"'),"пункт меню data-more-page=hotkeys");
  ok(html.includes('id="page-hotkeys"'),"секція page-hotkeys в index.html");
  ok(html.includes('id="hotkeysList"'),"контейнер hotkeysList в index.html");
  ok(html.includes('data-i18n="navHotkeys"')&&html.includes('data-i18n="moreHotkeys"')&&html.includes('data-i18n="hotkeysDesc"'),
    "i18n-атрибути гарячих клавіш в HTML");
}

/* ---------- 4. Ctrl/Cmd+Enter для агента ---------- */
{
  ok(/activeElement[\s\S]{0,80}\.id==="agentPrompt"/.test(app)&&app.includes('ae.id==="agentPrompt"'),
    "глобальний keydown обробляє Ctrl+Enter у #agentPrompt");
  ok(/\$\("agentStartBtn"\)\?\.click\(\)/.test(app),"Ctrl+Enter в агенті клікає agentStartBtn");
}

/* ---------- 5. V51174 uk+en ---------- */
{
  const keys=["navHotkeys","moreHotkeys","hotkeysDesc","dmPersistT","dmPersistD","dmPersistOn","dmPersistOff","dmPersistUnknown","hkSendD","hkFocusD","hkEscD","hkCmdkD","hkHistD"];
  const vM=i18n.match(/const V51174=\{([\s\S]*?)\n\};/);
  ok(vM,"V51174 існує в i18n.js");
  const enM=vM[1].match(/en:\{([\s\S]*?)\},\s*\n\s*uk:/);
  const ukM=vM[1].match(/uk:\{([\s\S]*?)\}\s*$/);
  for(const k of keys){
    ok(enM&&enM[1].includes(k+":"),`en має ключ ${k}`);
    ok(ukM&&ukM[1].includes(k+":"),`uk має ключ ${k}`);
  }
  // Жодного рядка українською в коді без ключа: hk/dmPersist/navHotkeys рядки — лише в i18n
  ok(!/Сховище захищено|Гарячі клавіші|Командна палітра/.test(app.replace(/\/\*[\s\S]*?\*\//g,"")),
    "в app.js немає захардкоджених українських рядків фічі (лише коментарі)");
}

/* ---------- 6. стилі ---------- */
{
  ok(css.includes(".hkKeys"),".hkKeys у styles.css");
  ok(css.includes(".privStatus"),".privStatus існує (використовується для статусу)");
}

console.log(`\nv5.11.74: ${passed} перевірок пройдено`);
