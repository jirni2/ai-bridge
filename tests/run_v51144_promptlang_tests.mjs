/* v5.11.44 — дві ідеї scout:
   1) «Історія відправлених промптів: ↑/↓ у композері» — останні 30 запитів
      у localStorage; стрілка ↑ у порожньому полі підтягує попередній,
      ↓ — наступний/очищає; запис лише після реальної відправки (sendTask,
      включно з research-гілкою); очищення — кнопка на сторінці
      «Де живуть твої дані» (окремий рядок, DATA_MAP_ROWS лишається 8).
   2) «Вибір мови на екрані входу (до авторизації)» — селектор мови в картці
      токена (accessCard), дзеркало глобального вибору через
      aibridge:languagechange, працює до авторизації.
   i18n uk+en+ru: promptHistCleared, dmRow9t, dmRow9d, authLangLabel. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = p => fs.readFileSync(path.join(root, p), "utf8");
const app = R("app.js"), i18n = R("i18n.js"), html = R("index.html"), css = R("styles.css");

let passed = 0;
function ok(v, msg) { if (!v) throw new Error("FAIL: " + msg); passed++; console.log("✓", msg); }

/* --- 1. i18n: блок V51144 --- */
const vBlock = i18n.match(/const V51144=\{([\s\S]*?)\n\};/);
ok(!!vBlock, "i18n: блок V51144 існує");
for (const key of ["promptHistCleared", "dmRow9t", "dmRow9d", "authLangLabel"]) {
  ok(vBlock[1].includes(key + ":"), "i18n V51144: ключ " + key);
}
for (const lang of ["en", "uk", "ru"]) {
  ok(new RegExp("\\b" + lang + ":\\{[^}]*authLangLabel").test(vBlock[1]), "i18n V51144: мова " + lang + " має ключі");
}
ok(i18n.includes('promptHistCleared:"Історію запитів очищено"'), "i18n uk: promptHistCleared українською");
ok(i18n.includes('authLangLabel:"Interface language"'), "i18n en: authLangLabel англійською");
ok(/for\(const \[lang,strings\] of Object\.entries\(V51144\)\)/.test(i18n), "i18n: V51144 застосовується через Object.assign");

/* --- 2. index.html: селектор мови в картці токена --- */
ok(/id="authLangSelect"/.test(html), "index.html: #authLangSelect існує");
ok(/id="authLangSelect"[^>]*data-i18n-aria="authLangLabel"/.test(html), "#authLangSelect: data-i18n-aria=authLangLabel");
{
  const start = html.indexOf('<div class="card accessCard">');
  const end = html.indexOf('<div class="card selfCheckCard"');
  const cardHtml = start >= 0 && end > start ? html.slice(start, end) : "";
  ok(cardHtml.length > 0, "accessCard знайдено в index.html");
  ok(cardHtml.includes('id="authLangSelect"'), "#authLangSelect всередині accessCard");
  ok(cardHtml.includes('data-i18n="authLangLabel"'), "підпис селектора має data-i18n=authLangLabel");
}

/* --- 3. app.js: історія промптів --- */
ok(app.includes('const PROMPT_HIST_KEY="ai_bridge_prompt_history_v1"'), "app.js: PROMPT_HIST_KEY");
ok(app.includes("function promptHistory()"), "app.js: promptHistory()");
ok(app.includes("function pushPromptHistory(text)"), "app.js: pushPromptHistory()");
ok(app.includes("function stepPromptHistory(dir)"), "app.js: stepPromptHistory()");
ok(app.includes("function clearPromptHistory()"), "app.js: clearPromptHistory()");
ok(/e\.key==="ArrowUp"\?-1:1/.test(app), "keydown: ↑→-1, ↓→+1");
ok(app.includes('$("prompt").value===""'), "keydown: гортання лише в порожньому полі");
ok(app.includes('!e.isComposing') , "keydown: повага до IME");
ok(app.includes("if(e.isTrusted)promptHistIdx=-1"), "input: скидання індексу лише на довірений ввід");
{ // push лише при реальній відправці, всі гілки sendTask
  const n = (app.match(/pushPromptHistory\(rawPrompt\)/g) || []).length;
  ok(n === 7, "sendTask: pushPromptHistory у 7 місцях (research + звичайна + Muse-картка v5.11.62 + Ядро v5.11.70 + Ядро-офлайн v5.11.95 + Ядро-першим v5.11.95 + Ядро-детерміноване v5.11.101), знайдено " + n);
}

/* --- 4. app.js: синхронізація селектора мови входу --- */
ok(app.includes("function syncAuthLangSelect()"), "app.js: syncAuthLangSelect()");
ok(app.includes("syncAuthLangSelect();"), "syncAuthLangSelect() викликається при ініціалізації");
ok(app.includes('window.addEventListener("aibridge:languagechange"'), "слухач aibridge:languagechange для селектора входу");
ok(app.includes("sel.onchange=()=>I18N.setLanguage(sel.value)"), "зміна селектора входу → I18N.setLanguage");

/* --- 5. app.js: рядок очищення на сторінці даних --- */
ok(app.includes('id="clearPromptHistBtn"'), "dataMap: кнопка очищення історії");
ok(app.includes('$("clearPromptHistBtn").onclick=()=>clearPromptHistory()'), "кнопка очищення викликає clearPromptHistory()");
ok(app.includes('esc(t("clear"))'), "кнопка очищення — через існуючий ключ t(\"clear\")");
{ // DATA_MAP_ROWS лишається рівно 8 (тест v5.11.40)
  const m = app.match(/const DATA_MAP_ROWS=\[([\s\S]*?)\];/);
  ok(m && (m[1].match(/icon:/g) || []).length === 8, "DATA_MAP_ROWS: рівно 8 рядків");
}

/* --- 6. styles.css --- */
ok(/\.authLangRow/.test(css), "css: .authLangRow");
ok(/\.authLangSelect/.test(css), "css: .authLangSelect");
ok(/\.authLangSelect\{[^}]*min-height:44px/.test(css), ".authLangSelect: тач-ціль ≥44px");

/* --- 7. функціонально: логіка історії (пісочниця) --- */
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function not found: " + name);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces in " + name);
}
{
  const store = {};
  const sandbox = `
    const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
    let promptHistIdx=-1;
    const PROMPT_HIST_MAX=30,PROMPT_HIST_KEY="k";
    ${grab(app, "promptHistory")}
    ${grab(app, "pushPromptHistory")}
  `;
  const fn = new Function("store", sandbox + ";return {promptHistory,pushPromptHistory,getIdx:()=>promptHistIdx}");
  const api = fn(store);
  ok(api.promptHistory().length === 0, "порожня історія → []");
  api.pushPromptHistory("  "); ok(api.promptHistory().length === 0, "порожній текст не пишеться");
  api.pushPromptHistory("перший"); api.pushPromptHistory("другий");
  ok(JSON.stringify(api.promptHistory()) === JSON.stringify(["перший", "другий"]), "порядок збереження хронологічний");
  api.pushPromptHistory("другий"); ok(api.promptHistory().length === 2, "дублікат підряд не пишеться");
  for (let i = 0; i < 40; i++) api.pushPromptHistory("q" + i);
  const h = api.promptHistory();
  ok(h.length === 30 && h[0] === "q10" && h[29] === "q39", "обмеження 30, найстаріші витісняються");
  ok(typeof store.k === "string", "зберігається як JSON у localStorage");
}

/* --- 8. changelog-app.json --- */
{
  const log = JSON.parse(R("changelog-app.json"));
  const cur = log.find(e => e.v === "5.11.44");
  ok(!!cur, "changelog: запис 5.11.44 існує");
  ok(cur.uk.some(x => /↑\/↓|історія запитів/i.test(x)), "5.11.44 uk: історія запитів ↑/↓");
  ok(cur.uk.some(x => /мов/i.test(x)), "5.11.44 uk: вибір мови на вході");
  ok(cur.en.length > 0, "5.11.44: en-пункти є");
}

console.log(`\nPASS: ${passed} checks`);
