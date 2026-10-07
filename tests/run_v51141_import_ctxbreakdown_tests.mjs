/* v5.11.41 — дві ідеї scout:
   1) «Імпорт діалогів»: parseImportDialogText розбирає Bridge JSON (один run
      або масив) і ChatGPT conversations.json; importDialogsFromFile зберігає
      кожен діалог як звичайний запис історії.
   2) «Детальний розбір контексту»: тап по #ctxMeter відкриває #ctxSheet,
      contextBreakdown рахує токени за категоріями (запити/відповіді/
      перекази пам'яті/інше) + топ-5 найбільших повідомлень.
   i18n — ключі uk+en; CSS мінімальний, на токенах. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

/* 1. i18n: усі ключі присутні в uk і en (fallback t() покриє решту мов). */
const keys = [
  "importDialog","importDialogDesc","importDone","importEmpty","importErrRead","importErrFormat",
  "ctxSheetTitle","ctxTotal","ctxCatUser","ctxCatAssistant","ctxCatMemory","ctxCatOther",
  "ctxTop","ctxTapHint","ctxNote"
];
for (const k of keys) {
  ok(new RegExp("\\b" + k + ":").test(i18nSrc), "i18n has key " + k);
}
ok(/V51141/.test(i18nSrc), "i18n version block V51141 present");
ok(/exportTitle:"Експорт та імпорт діалогу"/.test(i18nSrc), "uk: exportTitle reworded to export & import");
ok(/exportTitle:"Export & import dialog"/.test(i18nSrc), "en: exportTitle reworded to export & import");

/* 2. index.html: кнопка імпорту, file input, лист розбору. */
ok(/id="importDialogBtn"/.test(htmlSrc), "html: #importDialogBtn");
ok(/id="importDialogFile"/.test(htmlSrc), "html: #importDialogFile hidden input");
ok(/data-i18n="importDialog"/.test(htmlSrc), "html: import button uses data-i18n");
ok(/id="ctxSheet"/.test(htmlSrc), "html: #ctxSheet sheet");
ok(/id="ctxTotal"/.test(htmlSrc) && /id="ctxBreakdownList"/.test(htmlSrc), "html: ctxTotal + ctxBreakdownList hosts");
ok(/data-i18n="ctxSheetTitle"/.test(htmlSrc), "html: ctx sheet title via i18n");

/* 3. app.js: логіка імпорту. */
ok(/function parseImportDialogText\(text\)/.test(appSrc), "app: parseImportDialogText defined");
ok(/function importDialogsFromFile\(file\)/.test(appSrc), "app: importDialogsFromFile defined");
ok(/importDialogBtn/.test(appSrc) && /importDialogFile/.test(appSrc), "app: import button wired to file input");
ok(/importDone/.test(appSrc), "app: success toast importDone");

function grab(src, name) {
  const m = src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error("FAIL: не знайдено function " + name + " в app.js");
  return m[0];
}
const prelude = `
const CTX_METER_BUDGET=40000;
const IMPORT_MAX_DIALOGS=50,IMPORT_MAX_CHARS=200000;
`;
(0, eval)(prelude + grab(appSrc, "importCapText") + grab(appSrc, "chatGptPartsText") +
  grab(appSrc, "importFromBridgeRun") + grab(appSrc, "importFromChatGptConv") +
  grab(appSrc, "parseImportDialogText") + grab(appSrc, "ctxTokensOf") +
  grab(appSrc, "contextBreakdown"));

/* 3a. Bridge JSON: один run. */
{
  const run = {prompt: "Що таке контекст?", final: "Це вікно пам'яті.", created: 1728000000000, title: "про контекст", providers: ["gemini"]};
  const p = parseImportDialogText(JSON.stringify(run));
  ok(p.ok && p.dialogs.length === 1, "bridge: single run parsed");
  ok(p.dialogs[0].prompt === run.prompt && p.dialogs[0].final === run.final, "bridge: prompt/final preserved");
  ok(p.dialogs[0].source === "bridge" && p.dialogs[0].created === 1728000000000, "bridge: source+created preserved");
  ok(p.dialogs[0].providers.length === 1 && p.dialogs[0].providers[0] === "gemini", "bridge: providers preserved");
}
/* 3b. Bridge JSON: масив діалогів. */
{
  const arr = [{prompt: "а", final: "б"}, {prompt: "в", final: "г"}];
  const p = parseImportDialogText(JSON.stringify(arr));
  ok(p.ok && p.dialogs.length === 2, "bridge: array of 2 runs parsed");
}
/* 3c. ChatGPT conversations.json. */
{
  const conv = [{
    title: "Тестова розмова", create_time: 1728000000,
    mapping: {
      a: {parent: null, children: ["b"], message: null},
      b: {parent: "a", children: ["c"], message: {author: {role: "user"}, content: {content_type: "text", parts: ["Привіт, хто ти?"]}, create_time: 1728000001}},
      c: {parent: "b", children: [], message: {author: {role: "assistant"}, content: {content_type: "text", parts: ["Я асистент."]}, create_time: 1728000002}}
    }
  }];
  const p = parseImportDialogText(JSON.stringify(conv));
  ok(p.ok && p.dialogs.length === 1, "chatgpt: conversation parsed");
  ok(p.dialogs[0].source === "chatgpt", "chatgpt: source marked");
  ok(p.dialogs[0].prompt === "Привіт, хто ти?", "chatgpt: first user message is prompt");
  ok(p.dialogs[0].final === "Я асистент.", "chatgpt: last assistant message is final");
  ok(p.dialogs[0].created === 1728000000000, "chatgpt: create_time converted to ms");
  ok(p.dialogs[0].title === "Тестова розмова", "chatgpt: title preserved");
}
/* 3d. Погані вхідні дані. */
ok(parseImportDialogText("не json").ok === false && parseImportDialogText("не json").error === "format", "import: invalid JSON -> format error");
ok(parseImportDialogText("{}").ok === false && parseImportDialogText("{}").error === "empty", "import: empty object -> empty error");
ok(parseImportDialogText("[]").ok === false, "import: empty array -> fail");
ok(parseImportDialogText(JSON.stringify([{prompt: "", final: ""}])).ok === false, "import: blank dialog skipped -> fail");
/* 3e. Обмеження кількості. */
{
  const arr = Array.from({length: 60}, (_, i) => ({prompt: "q" + i, final: "a" + i}));
  const p = parseImportDialogText(JSON.stringify(arr));
  ok(p.ok && p.dialogs.length === 50, "import: capped at 50 dialogs");
}

/* 4. app.js: логіка розбору контексту. */
ok(/function contextBreakdown\(messages\)/.test(appSrc), "app: contextBreakdown defined");
ok(/function renderCtxSheet\(\)/.test(appSrc), "app: renderCtxSheet defined");
ok(/id="ctxSheet"/.test(htmlSrc) && /openSheet\("ctxSheet"\)/.test(appSrc), "app: ctxMeter tap opens ctxSheet");
ok(/ctxTapHint/.test(appSrc), "app: meter title hints the tap");
ok(/ctxBar/.test(cssSrc), "css: .ctxBar");

/* 4a. Категорії й топ. */
{
  const msgs = [
    {role: "user", text: "x".repeat(400)},        // 100 токенів
    {role: "assistant", text: "y".repeat(800)},   // 200 токенів
    {role: "assistant", text: "переказ", compacted: true}, // ~2 токени, пам'ять
    {role: "tool", text: "z".repeat(40)},         // 10 токенів, інше
    {role: "assistant", text: "err", error: true} // пропускається
  ];
  const b = contextBreakdown(msgs);
  ok(b.cats.user === 100, "ctx: user category = 100");
  ok(b.cats.assistant === 200, "ctx: assistant category = 200");
  ok(b.cats.memory === 2, "ctx: memory (compacted) = 2");
  ok(b.cats.other === 10, "ctx: other (tool) = 10");
  ok(b.total === 312, "ctx: total sums categories");
  ok(b.pct === Math.round(312 / 40000 * 100), "ctx: pct vs budget");
  ok(b.top.length === 4 && b.top[0].tokens === 200, "ctx: top sorted desc, error skipped");
  ok(contextBreakdown(null).total === 0 && contextBreakdown(null).pct === 0, "ctx: null input safe");
  ok(contextBreakdown([]).top.length === 0, "ctx: empty input safe");
}

/* 5. styles.css: мінімальні стилі на токенах, без захардкоджених кольорів у новому блоці. */
ok(/\.ctxRows/.test(cssSrc) && /\.ctxRow/.test(cssSrc) && /\.ctxTopTitle/.test(cssSrc), "css: ctx sheet rows");
ok(!/#[0-9a-fA-F]{3,6}\b/.test(cssSrc.split("v5.11.41")[1] || ""), "css: no hardcoded colors in new block");

console.log(`\nAll ${passed} checks passed.`);
