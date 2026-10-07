/* v5.11.43 — дві ідеї scout:
   1) «Свайп-відповідь і тактильний відгук (haptics)»: свайп вліво по
      #finalAnswer → та сама quoteFinalAnswer(), що й кнопка «Цитувати»;
      поріг ~18% ширини екрана (56–90px), гумове повернення, один haptic(10)
      на порозі; вертикальний скрол не ламається (touch-action: pan-y);
      pre/code/button/a жест ігнорує; prefers-reduced-motion — без анімації.
   2) «Статус-оголошення «Відповідь готова» і вібрація при фоні»: окремий
      #a11yStatus (role=status, aria-live=polite) оголошує лише дискретні
      переходи («Генерація…» → «Відповідь готова» / «Помилка»); текст
      відповіді не авто-оголошується. notifyRunDone: у фоні — одна коротка
      вібрація-патерн, на екрані — м'який haptic(12).
   i18n uk+en+ru: statusGenerating, statusReady, statusFailed. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

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

/* ---- 1. i18n: ключі в усіх трьох мовах ---- */
const vBlock = i18nSrc.match(/const V51143=\{([\s\S]*?)\n\};/);
ok(!!vBlock, "i18n: блок V51143 існує");
for (const key of ["statusGenerating", "statusReady", "statusFailed"]) {
  ok(vBlock[1].includes(key + ":"), "i18n V51143: ключ " + key);
}
for (const lang of ["en", "uk", "ru"]) {
  ok(new RegExp("\\b" + lang + ":\\{[^}]*statusReady").test(vBlock[1]), "i18n V51143: мова " + lang + " має ключі");
}
ok(i18nSrc.includes('statusGenerating:"Генерація…"'), "i18n uk: statusGenerating українською");
ok(i18nSrc.includes('statusReady:"Answer ready"'), "i18n en: statusReady англійською");
ok(i18nSrc.includes('statusFailed:"Ошибка"'), "i18n ru: statusFailed російською");
ok(/for\(const \[lang,strings\] of Object\.entries\(V51143\)\)/.test(i18nSrc), "i18n: V51143 застосовується через Object.assign");

/* ---- 2. index.html: статус-регіон ---- */
ok(/id="a11yStatus"/.test(htmlSrc), "index.html: #a11yStatus існує");
ok(/id="a11yStatus"[^>]*role="status"/.test(htmlSrc), "#a11yStatus: role=status");
ok(/id="a11yStatus"[^>]*aria-live="polite"/.test(htmlSrc), "#a11yStatus: aria-live=polite");
ok(/id="a11yStatus"[^>]*class="srOnly"/.test(htmlSrc), "#a11yStatus: візуально прихований (srOnly)");

/* ---- 3. app.js: quoteFinalAnswer спільна для кнопки й свайпа ---- */
ok(appSrc.includes("function quoteFinalAnswer()"), "app.js: quoteFinalAnswer() існує");
ok(appSrc.includes('buildQuoteBlock(txt)'), "quoteFinalAnswer: будує цитату через buildQuoteBlock");
ok(appSrc.includes('$("quoteFinalBtn").onclick=()=>quoteFinalAnswer();'), "кнопка «Цитувати» делегує quoteFinalAnswer()");
ok(appSrc.includes("initSwipeReply(); // v5.11.43"), "initSwipeReply() викликається при ініціалізації");

/* ---- 4. app.js: initSwipeReply — структура жесту ---- */
const swipeFn = extractFunction(appSrc, "initSwipeReply");
ok(swipeFn.includes("touchstart") && swipeFn.includes("touchmove") && swipeFn.includes("touchend"), "swipe: touchstart/move/end");
ok(swipeFn.includes('closest("pre,code,button,a")'), "swipe: ігнорує pre/code/button/a");
ok(swipeFn.includes("Math.min(0,mx)"), "swipe: тільки вліво (dx=min(0,mx))");
ok(swipeFn.includes("quoteFinalAnswer()"), "swipe: по порозі викликає quoteFinalAnswer()");
ok(swipeFn.includes("prefersReducedMotion()"), "swipe: повага до prefers-reduced-motion");
ok(swipeFn.includes("haptic(10)"), "swipe: тактильний відгук на порозі");
ok(swipeFn.includes("touchcancel"), "swipe: обробляє touchcancel");
ok(swipeFn.includes("dataset.swipeInit"), "swipe: захист від подвійної ініціалізації");

/* ---- 5. app.js: announceStatus + notifyRunDone ---- */
const annFn = extractFunction(appSrc, "announceStatus");
ok(annFn.includes('getElementById("a11yStatus")'), "announceStatus: пише в #a11yStatus");
ok(annFn.includes("requestAnimationFrame"), "announceStatus: очищення + rAF для повторного оголошення");
const doneFn = extractFunction(appSrc, "notifyRunDone");
ok(doneFn.includes("statusReady") && doneFn.includes("statusFailed"), "notifyRunDone: готова/помилка за run.meta.error");
ok(doneFn.includes("document.hidden"), "notifyRunDone: окрема гілка для фону");
ok(doneFn.includes("[25,60,25]"), "notifyRunDone: у фоні — коротка вібрація-патерн");
ok(doneFn.includes("haptic(12)"), "notifyRunDone: на екрані — м'який haptic");
ok(!/finalAnswer[^;]{0,80}aria-live/.test(appSrc), "текст #finalAnswer не має aria-live (не авто-оголошується)");

/* ---- 6. app.js: хуки життєвого циклу ---- */
ok(appSrc.includes('announceStatus("statusGenerating")'), "sendTask: оголошення «Генерація…» при відправці");
ok((appSrc.match(/notifyRunDone\(/g) || []).length >= 6, "notifyRunDone викликається в усіх точках завершення (≥6)");

/* ---- 7. styles.css: свайп ---- */
ok(/#finalAnswer\{touch-action:pan-y\}/.test(cssSrc), "CSS: #finalAnswer touch-action:pan-y");
ok(/#finalAnswer\.swiping\{[^}]*transition:none/.test(cssSrc), "CSS: .swiping вимикає transition");
ok(/@media \(prefers-reduced-motion:reduce\)\{#finalAnswer\{/.test(cssSrc), "CSS: повага до prefers-reduced-motion");

/* ---- 8. Функціонально: announceStatus + notifyRunDone зі стабами ---- */
const a11yEl = {textContent: "", isConnected: true};
let rafCb = null;
let vibCalls = [];
let hapticCalls = [];
globalThis.document = {
  getElementById: id => (id === "a11yStatus" ? a11yEl : null),
  hidden: false,
};
globalThis.requestAnimationFrame = cb => { rafCb = cb; };
Object.defineProperty(globalThis, "navigator", {value: {vibrate: p => { vibCalls.push(p); return true; }}, configurable: true, writable: true});
globalThis.t = (k, vars) => ({statusGenerating: "Генерація…", statusReady: "Відповідь готова", statusFailed: "Помилка"}[k] || k);
globalThis.haptic = ms => { hapticCalls.push(ms); };
(0, eval)(extractFunction(appSrc, "announceStatus") + "\n" + extractFunction(appSrc, "notifyRunDone") + "\n" +
  "globalThis.__announce=announceStatus;globalThis.__done=notifyRunDone;");

a11yEl.textContent = "старе";
globalThis.__announce("statusGenerating");
ok(a11yEl.textContent === "", "announceStatus: спочатку очищує регіон");
ok(typeof rafCb === "function", "announceStatus: планує rAF");
rafCb();
ok(a11yEl.textContent === "Генерація…", "announceStatus: rAF ставить «Генерація…»");

globalThis.document.hidden = false;
globalThis.__done({meta: {}});
ok(a11yEl.textContent === "", "notifyRunDone: очищує перед оголошенням");
rafCb();
ok(a11yEl.textContent === "Відповідь готова", "notifyRunDone: успіх → «Відповідь готова»");
ok(hapticCalls.length === 1 && hapticCalls[0] === 12, "notifyRunDone: на екрані — haptic(12)");
ok(vibCalls.length === 0, "notifyRunDone: на екрані — без вібрації");

hapticCalls = []; vibCalls = [];
globalThis.__done({meta: {error: true}});
rafCb();
ok(a11yEl.textContent === "Помилка", "notifyRunDone: помилка → «Помилка»");

hapticCalls = []; vibCalls = [];
globalThis.document.hidden = true;
globalThis.__done({meta: {}});
rafCb();
ok(a11yEl.textContent === "Відповідь готова", "notifyRunDone: у фоні теж оголошує");
ok(JSON.stringify(vibCalls[0]) === "[25,60,25]", "notifyRunDone: у фоні — вібрація [25,60,25]");
ok(hapticCalls.length === 0, "notifyRunDone: у фоні — без екранного haptic");

console.log("\nPASS: " + passed + " перевірок");
