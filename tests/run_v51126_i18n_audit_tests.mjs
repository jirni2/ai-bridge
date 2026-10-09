/* v5.11.26 — Аудит перекладів (пряме прохання Сергія: "чому при виборі мови не все переводиться").
   1) app.js: жодних захардкоджених кириличних UI-рядків поза t()/коментарями (allowlist для технічних констант).
   2) index.html: жодних видимих текстових вузлів без data-i18n* (allowlist: бренд, власні назви провайдерів, <title>).
   3) Кожен t("key") в app.js має існувати в i18n.js (EN-база).
   4) Кожен data-i18n* в index.html має існувати в i18n.js.
   5) Нові ключі v5.11.26 мають переклади uk+en+ru.
*/
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = p => fs.readFileSync(path.join(root, p), "utf8");
const app = R("app.js"), html = R("index.html"), i18n = R("i18n.js");

let passed = 0;
function ok(v, msg){ if(!v) throw new Error("FAIL: " + msg); passed++; console.log("✓", msg); }

/* --- 0. витягуємо ключі i18n.js --- */
const i18nKeys = new Set([...i18n.matchAll(/([A-Za-z_][\w]*):"/g)].map(m => m[1]));
ok(i18nKeys.size > 100, `i18n.js має ключів: ${i18nKeys.size}`);

/* --- 1. app.js: кирилиця поза t() і коментарями --- */
const CYR = /[А-Яа-яЁёЇїІіЄєҐґ]/;
// знімаємо коментарі: /* */ блоки і // до кінця рядка (обережно з http://)
const appNoComments = app
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/([^:])\/\/[^\n]*/g, "$1");
const badApp = [];
// allowlist: технічні константи, що не показуються як UI-текст
const APP_ALLOW = [
  /agentTaskType/,                 // евристика визначення типу задачі (regex)
  /\{id:"(debate|agent|deep|fast)",re:\//, // v5.11.73: патерни наміру композера (regex, не UI-текст)
  /\.test\(q\)\)s\.(detail|example)/, // скоринг чипів продовження (regex)
  /MODE_BADGE_LABEL/,              // ідентифікатори режимів (Auto/Team/Code — власні назви)
  /FILE_TASK_STOPWORDS/,           // стоп-слова для файлів
  /^\s*\{p:"[^"]+",lang:"(uk|en)",alt:\{/, // v5.11.104: записи словника ШІ-маркерів (дані, не UI-текст)
  /name:"Ядро"/,                      // v5.11.70: власна назва провайдера «Ядро»
];
appNoComments.split("\n").forEach((ln, i) => {
  if (!CYR.test(ln)) return;
  if (APP_ALLOW.some(rx => rx.test(ln))) return;
  // дозволено: всередині t("...") або t(`...`)
  const stripped = ln.replace(/t\(\s*["'`][\s\S]*?["'`]\s*(,\{[^}]*\})?\)/g, "");
  if (CYR.test(stripped)) badApp.push(`${i + 1}: ${ln.trim().slice(0, 90)}`);
});
ok(badApp.length === 0, `app.js: 0 захардкоджених кириличних UI-рядків поза t()${badApp.length ? " → " + badApp.slice(0,5).join(" | ") : ""}`);

/* --- 2. index.html: текстові вузли без data-i18n* --- */
const ALLOW_HTML = new Set([
  "AI Bridge", "OpenAI (optional)", "Claude", "Gemini", "Grok (xAI)", "Groq Free", "OpenRouter Free",
  "AI Team", // бренд/продукт
  "Orchestrator", // динамічний JS-лейбл (finalTitle перезаписується)
  "Auto Team", // динамічний JS-лейбл (modeTitle)
  "Без ролі", // JS ставить t("roleNone") при ініціалізації
  "⚡ Auto", "⌘ Code", // ідентифікатори режимів (власні назви)
  "✓ Review", "◉ Ask All", "✦ Agent", "🔬 Дослідження", // режими
  "Enter", "Shift+Enter", "Ctrl+K", // клавіатурні підказки
  "ZIP", // формат файлу
  "BRIDGE ACCESS TOKEN", // технічний ідентифікатор
  "CHECK", "OFF", // статус-пігулки: JS оновлює через t(pillCheck/pillOff)
  "API", "MCP URL", "Copy", // технічні підписи
  "Grok / xAI", "OpenAI / Judge", // назви провайдерів
  "Cloudflare Account ID", "Workers AI API Token", "AI Studio / fal.ai", "AI Studio", "AI BRIDGE", // технічні назви
  "Bridge", // бренд
  "Word (.doc)", "PDF", "Esc", // формати і клавіші
]);
const badHtml = [];
const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>|([^<>]{3,})/g;
let m, stack = [];
// спрощений парсер: відстежуємо чи поточний елемент має data-i18n
const htmlSimple = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<!doctype[^>]*>/gi, "")
  .replace(/<title>[\s\S]*?<\/title>/gi, "")
  .replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
const tokens = htmlSimple.match(/<\/?[a-zA-Z][^>]*>|[^<>]+/g) || [];
for (const tok of tokens) {
  if (tok.startsWith("</")) { stack.pop(); continue; }
  if (tok.startsWith("<")) {
    const hasI18n = /data-i18n(-html|-placeholder|-title|-aria)?=/.test(tok);
    const selfClose = /\/>$/.test(tok) || /^<(meta|link|br|hr|img|input)/.test(tok);
    if (!selfClose) stack.push(hasI18n);
    continue;
  }
  const t = tok.trim().replace(/\s+/g, " ");
  if (t.length < 3) continue;
  if (!/[А-Яа-яЁёЇїІіЄєҐґA-Za-z]{3,}/.test(t)) continue;
  if (stack.some(Boolean)) continue;
  if (ALLOW_HTML.has(t)) continue;
  if (/^[0-9.,:;%—–\-+()«»"“”'’!? ]+$/.test(t)) continue;
  badHtml.push(t.slice(0, 70));
}
const uniqBad = [...new Set(badHtml)];
ok(uniqBad.length === 0, `index.html: 0 видимих вузлів без data-i18n${uniqBad.length ? " → " + uniqBad.slice(0,5).join(" | ") : ""}`);

/* --- 3. кожен t("key") з app.js існує в i18n.js --- */
const usedKeys = new Set([...app.matchAll(/(?<![A-Za-z_])t\(\s*["'`]([A-Za-z_][\w]*)["'`]/g)].map(x => x[1]));
// динамічні ключі виду t(`hint_${id}`) — шаблонні, пропускаємо
const missing = [...usedKeys].filter(k => !i18nKeys.has(k));
ok(missing.length === 0, `app.js: всі ${usedKeys.size} статичних t()-ключів є в i18n.js${missing.length ? " → " + missing.slice(0,5).join(",") : ""}`);

/* --- 4. кожен data-i18n* з index.html існує в i18n.js --- */
const htmlKeys = new Set([...html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria)?="([A-Za-z_][\w]*)"/g)].map(x => x[1]));
const missingH = [...htmlKeys].filter(k => !i18nKeys.has(k));
ok(missingH.length === 0, `index.html: всі ${htmlKeys.size} data-i18n ключів є в i18n.js${missingH.length ? " → " + missingH.slice(0,5).join(",") : ""}`);

/* --- 5. ключі v5.11.26 мають uk+en+ru --- */
const NEW_KEYS = ["installEyebrow","activitySummaryTitle","finalJudgeTitle","contextEyebrow","filesZipTitle",
  "mcpNeedDeploy","mcpCheckingOAuth","errOAuthMeta","errOAuthScope","errMcpResMeta","mcpReady","mcpNotReady",
  "errTokenMgmt","errTokenEmpty","msgTokenSaved","errTokenSave","confirmTokenDelete","msgTokenDeleted","errTokenDelete",
  "errPhotoTooBig","errCanvas","errConnLost","errConnFailed","errNetworkUnknown","errJobNotFound","errJobNoFinal",
  "errConnClosedEarly","errNoBridgeResponse","errPreviewDomain","errSessionInvalid","errJobGone","errNoServerToken",
  "errServerRestarted","errBadToken","errClipboardNoFile","errBadJson",
  "pillDeploy","pillReady","pillSetup","pillError","pillCheck","pillOff","pillOn","keySet","keyUnset","allOk","failWord","labEyebrow",
  "footerTagline","navBinanceBot","navAdvController","navReviewPanel","navPrivacy","navTerms","navSupport"];
for (const k of NEW_KEYS) {
  ok(i18nKeys.has(k), `ключ ${k} існує в i18n.js`);
}
// груба перевірка: ключ зустрічається ≥3 разів (EN+uk+ru)
for (const k of NEW_KEYS) {
  const c = (i18n.match(new RegExp(`\\b${k}:`, "g")) || []).length;
  ok(c >= 3, `ключ ${k}: переклади EN+uk+ru (${c})`);
}

console.log(`\nPASS: ${passed} перевірок`);
