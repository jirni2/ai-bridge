/* v5.11.42 — дві ідеї scout:
   1) «Згортальні групи дат в історії чатів»: чисті
      loadCollapsedHistSections/saveCollapsedHistSections/
      toggleCollapsedHistSection — стан у localStorage
      (ai_bridge_hist_sections_collapsed_v1), тільки валідні ключі секцій.
      renderHistory рендерить заголовок-секцію кнопкою з шевроном,
      лічильником, aria-expanded і data-hist-sec.
   2) «Прогноз вартості запиту ДО відправки»: estTokensIn (промпт/4 +
      вкладення.chars/4 + 1200 ток на фото), PROVIDER_EST_PRICE (всі 6
      провайдерів, вільні тири = 0), EST_OUT_TOKENS=700,
      computeCallPlan → {text,calls,providers}, costEstSuffix(plan) —
      верхня межа (найдорожчий кандидат × виклики), "" коли нема чого
      оцінювати (порожній композер, 0 викликів, невідомі ціни).
   i18n uk+en+ru: histSecToggle, costPreEst. CSS: histSecToggle,
   histSecChev, histSecCount, .histItems.collapsed, повага до
   prefers-reduced-motion. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

/* Витягнення чистої функції з сирця (баланс дужок). */
function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function not found: " + name);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces in " + name);
}
function extractConst(src, name) {
  const start = src.indexOf("const " + name + "=");
  if (start < 0) throw new Error("const not found: " + name);
  const open = src.indexOf("{", start);
  let depth = 0, inStr = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && src[i - 1] !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("unbalanced braces in const " + name);
}

/* Стаби: localStorage, $ з елементами композера, t з підставками,
   реальні fmtMoney/groupNum з app.js. */
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const els = {
  prompt: {value: ""},
  teamMode: {value: "auto"},
  synthesize: {checked: false},
  searchFirst: {checked: false},
};
globalThis.$ = id => els[id] || null;
globalThis.t = (k, vars) => {
  let s = "[" + k + "]";
  if (vars) for (const [kk, vv] of Object.entries(vars)) s = s.split("{" + kk + "}").join(String(vv));
  return s;
};
globalThis.HIST_SECTION_ORDER = ["today", "yesterday", "last7", "last30", "older"];
globalThis.HIST_SECTIONS_COLLAPSED_KEY = "ai_bridge_hist_sections_collapsed_v1";
globalThis.PROVIDERS = {gemini: {name: "Gemini"}, groqfree: {name: "Groq Free"}, openai: {name: "OpenAI"}, claude: {name: "Claude"}, grok: {name: "Grok"}, openrouter: {name: "OpenRouter Free"}};
globalThis.parseModelMention = () => null;
globalThis.selectedProviders = () => [];
globalThis.status = {providers: {}};
globalThis.attachments = [];
globalThis.imageAttachments = [];

const sandbox = [
  "globalThis.PROVIDER_EST_PRICE=" + extractConst(appSrc, "PROVIDER_EST_PRICE") + ";",
  "globalThis.IMAGE_EST_TOKENS=" + appSrc.match(/const IMAGE_EST_TOKENS=(\d+);/)[1] + ";",
  "globalThis.EST_OUT_TOKENS=" + appSrc.match(/const EST_OUT_TOKENS=(\d+);/)[1] + ";",
  extractFunction(appSrc, "loadCollapsedHistSections"),
  extractFunction(appSrc, "saveCollapsedHistSections"),
  extractFunction(appSrc, "toggleCollapsedHistSection"),
  extractFunction(appSrc, "estTokensIn"),
  extractFunction(appSrc, "computeCallPlan"),
  extractFunction(appSrc, "costEstSuffix"),
  extractFunction(appSrc, "fmtMoney"),
  extractFunction(appSrc, "groupNum"),
].join("\n");
(0, eval)(sandbox);

/* ---- 1. Згортання секцій: чиста логіка стану ---- */
ok(JSON.stringify(loadCollapsedHistSections()) === "[]", "loadCollapsedHistSections: порожньо на старті");
ok(toggleCollapsedHistSection("today") === true, "toggleCollapsedHistSection('today') → згорнуто");
ok(JSON.stringify(loadCollapsedHistSections()) === '["today"]', "стан 'today' зберігся в localStorage");
ok(toggleCollapsedHistSection("older") === true, "toggleCollapsedHistSection('older') → згорнуто");
ok(toggleCollapsedHistSection("today") === false, "повторний тогл 'today' → розгорнуто");
ok(JSON.stringify(loadCollapsedHistSections()) === '["older"]', "після розгортання лишився тільки 'older'");
ok(toggleCollapsedHistSection("bogus") === false, "невідомий ключ → false, стан не псується");
ok(JSON.stringify(loadCollapsedHistSections()) === '["older"]', "bogus-ключ не потрапив у сховище");
store.ai_bridge_hist_sections_collapsed_v1 = '["today","nope",5]';
ok(JSON.stringify(loadCollapsedHistSections()) === '["today"]', "завантаження фільтрує сміття зі сховища");
store.ai_bridge_hist_sections_collapsed_v1 = "not-json{{";
ok(JSON.stringify(loadCollapsedHistSections()) === "[]", "битий JSON у сховищі → []");

/* ---- 2. Таблиця цін: всі провайдери, вільні тири — 0 ---- */
for (const id of ["openai", "claude", "gemini", "grok", "groqfree", "openrouter"]) {
  ok(PROVIDER_EST_PRICE[id] && typeof PROVIDER_EST_PRICE[id].in === "number" && typeof PROVIDER_EST_PRICE[id].out === "number", "PROVIDER_EST_PRICE має " + id);
}
ok(PROVIDER_EST_PRICE.groqfree.in === 0 && PROVIDER_EST_PRICE.groqfree.out === 0, "groqfree — вільний тир (0/0)");
ok(PROVIDER_EST_PRICE.openrouter.in === 0 && PROVIDER_EST_PRICE.openrouter.out === 0, "openrouter — вільний тир (0/0)");
ok(PROVIDER_EST_PRICE.gemini.in > 0 && PROVIDER_EST_PRICE.claude.in > PROVIDER_EST_PRICE.gemini.in, "платні ціни додатні, claude дорожчий за gemini");
ok(IMAGE_EST_TOKENS === 1200 && EST_OUT_TOKENS === 700, "константи IMAGE_EST_TOKENS=1200, EST_OUT_TOKENS=700");

/* ---- 3. estTokensIn ---- */
globalThis.attachments = []; globalThis.imageAttachments = []; els.prompt.value = "";
ok(estTokensIn() === 0, "порожній композер → 0 токенів");
els.prompt.value = "x".repeat(400);
ok(estTokensIn() === 100, "400 символів промпта → 100 токенів");
globalThis.attachments = [{chars: 800}];
ok(estTokensIn() === 300, "400 символів + вкладення 800 → 300 токенів");
globalThis.imageAttachments = [{}, {}];
ok(estTokensIn() === 2700, "плюс 2 фото → 300 + 2×1200 = 2700 токенів");

/* ---- 4. computeCallPlan: структура плану ---- */
els.teamMode.value = "auto"; els.prompt.value = "привіт";
globalThis.attachments = []; globalThis.imageAttachments = [];
globalThis.status = {providers: {gemini: 1, groqfree: 1}};
let plan = computeCallPlan();
ok(plan && typeof plan.text === "string" && typeof plan.calls === "number" && Array.isArray(plan.providers), "computeCallPlan повертає {text,calls,providers}");
ok(plan.calls >= 1 && plan.providers.includes("gemini"), "auto: ≥1 виклик, gemini серед кандидатів");
els.teamMode.value = "single";
globalThis.selectedProviders = () => ["groqfree"];
plan = computeCallPlan();
ok(plan.calls === 1 && plan.providers.join() === "groqfree", "single: рівно 1 виклик, рівно 1 провайдер");
globalThis.selectedProviders = () => [];
plan = computeCallPlan();
ok(plan.calls === 0 && plan.providers.length === 0, "single без вибору: 0 викликів");
globalThis.selectedProviders = () => [];

/* ---- 5. costEstSuffix: верхня межа, формати, крайні випадки ---- */
els.teamMode.value = "auto"; els.prompt.value = "x".repeat(400);
globalThis.status = {providers: {gemini: 1}};
globalThis.attachments = []; globalThis.imageAttachments = [];
let s = costEstSuffix(computeCallPlan());
// 100 ток вхід × 0.1 + 700 × 0.4 = 290 / 1e6 = 0.00029 → $<0.01
ok(s === " · [costPreEst]", "суфікс викликає t('costPreEst') — перевіряємо через реальну підставку нижче");
// реальна підставка без заглушки t
globalThis.t = (k, vars) => (k === "costPreEst" ? `≈${vars.cost} · ~${vars.tok} ток` : k === "costFree" ? "безкоштовно" : "[" + k + "]");
s = costEstSuffix(computeCallPlan());
ok(s.includes("≈$<0.01") && s.includes("~100 ток"), "gemini: «" + s + "» — верхня межа з токенами");
globalThis.status = {providers: {groqfree: 1}};
s = costEstSuffix(computeCallPlan());
ok(s.includes("безкоштовно"), "вільний тир → «безкоштовно»: " + s);
globalThis.status = {providers: {unknown_provider: 1}};
ok(costEstSuffix(computeCallPlan()) === "", "невідома ціна провайдера → порожній суфікс");
globalThis.status = {providers: {gemini: 1}};
els.prompt.value = "   "; globalThis.attachments = []; globalThis.imageAttachments = [];
ok(costEstSuffix(computeCallPlan()) === "", "порожній композер → порожній суфікс");
els.teamMode.value = "single"; globalThis.selectedProviders = () => [];
ok(costEstSuffix(computeCallPlan()) === "", "0 викликів → порожній суфікс");
// верхня межа по кандидатах: gemini + claude → береться claude
els.teamMode.value = "auto"; els.prompt.value = "x".repeat(400);
globalThis.status = {providers: {gemini: 1, claude: 1}};
globalThis.selectedProviders = () => [];
const mixed = costEstSuffix(computeCallPlan());
globalThis.status = {providers: {gemini: 1}};
const gemOnly = costEstSuffix(computeCallPlan());
ok(mixed !== gemOnly, "суміш gemini+claude дає вищу верхню межу, ніж gemini сам: " + mixed + " vs " + gemOnly);

/* ---- 6. renderHistory: кнопка-секція з шевроном ---- */
ok(appSrc.includes('class="histSection histSecToggle'), "renderHistory рендерить кнопку .histSection.histSecToggle");
ok(appSrc.includes("data-hist-sec="), "секції мають data-hist-sec");
ok(appSrc.includes("histSecChev") && appSrc.includes("histSecCount"), "шеврон і лічильник у заголовку секції");
ok(appSrc.includes('class="histItems'), "елементи групи — в .histItems");
ok(appSrc.includes('aria-expanded="${c?"false":"true"}"'), "aria-expanded відображає стан згортання");
ok(appSrc.includes("toggleCollapsedHistSection(b.dataset.histSec)"), "клік по секції викликає toggleCollapsedHistSection");

/* ---- 7. i18n uk+en+ru ---- */
for (const key of ["histSecToggle", "costPreEst"]) {
  ok(i18nSrc.includes(key + ":\"") || i18nSrc.includes(key + ": '") || new RegExp(key + '\\s*:\\s*"').test(i18nSrc), "i18n містить ключ " + key);
}
ok(/en:\{[^}]*histSecToggle:"Collapse \/ expand group"/.test(i18nSrc), "en: histSecToggle");
ok(/uk:\{[^}]*histSecToggle:"Згорнути \/ розгорнути групу"/.test(i18nSrc), "uk: histSecToggle");
ok(/ru:\{[^}]*histSecToggle:"Свернуть \/ развернуть группу"/.test(i18nSrc), "ru: histSecToggle");
ok(/uk:\{[^}]*costPreEst:"≈\{cost\} · ~\{tok\} ток"/.test(i18nSrc), "uk: costPreEst з плейсхолдерами {cost},{tok}");

/* ---- 8. CSS ---- */
ok(cssSrc.includes("button.histSection"), "CSS: кнопка-заголовок секції");
ok(cssSrc.includes(".histSecChev"), "CSS: .histSecChev");
ok(cssSrc.includes(".histSecCount"), "CSS: .histSecCount");
ok(cssSrc.includes(".histItems.collapsed"), "CSS: .histItems.collapsed ховає групу");
ok(cssSrc.includes("prefers-reduced-motion") && /prefers-reduced-motion:reduce\)\{[^}]*histSecChev/.test(cssSrc), "повага до prefers-reduced-motion для шеврона");

/* ---- 9. updateCallEstimate: живий рядок з прогнозом ---- */
ok(appSrc.includes('el.textContent=plan.text+costEstSuffix(plan)'), "updateCallEstimate дописує прогноз вартості до рядка оцінки");
ok(appSrc.includes('$("prompt").addEventListener("input",updateCallEstimate)'), "оцінка оновлюється при вводі в композер");

console.log(`\n${passed} checks passed (v5.11.42: collapsible history sections + pre-send cost estimate).`);
