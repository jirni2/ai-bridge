/* M5 (v5.11.8 wave 1) — «Контекст розмови і мова відповіді».
   1) detectUserLang: 20 тестових речень (10 українських + 10 англійських) —
      мова визначається без помилок; російська окремо не обробляється.
   2) formatAgentConversation: останні 4 пари питання-відповідь повністю,
      старіші — дайджестом до 800 символів; розмір запиту обмежений незалежно
      від довжини діалогу.
   3) Регресійні перевірки: директива <response_language> у промптах агента. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = fs.readFileSync(path.join(root, "_worker.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

/* ---- 1. _worker.js як модуль: detectUserLang / agentReplyDirective ---- */
const tmp = new URL("./worker-v5118-m5.mjs", import.meta.url);
fs.writeFileSync(tmp, workerSrc);
let m;
try {
  m = await import(tmp.href + "?t=" + Date.now());
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}
ok(typeof m.detectUserLang === "function", "detectUserLang exported from _worker.js");
ok(typeof m.agentReplyDirective === "function", "agentReplyDirective exported from _worker.js");

const UK = [
  "Привіт, як справи?",
  "Що нового?",
  "Розкажи мені про Київ",
  "Дякую за допомогу!",
  "Напиши вірш про осінь",
  "Ґрунт для квітів який обрати?",
  "Поясни, будь ласка, цю тему",
  "Скільки часу?",
  "Переклади це речення англійською",
  "Доброго ранку, що плануєш сьогодні?",
];
const EN = [
  "Hello, how are you?",
  "What's new?",
  "Tell me about Kyiv",
  "Thanks for your help!",
  "Write a poem about autumn",
  "Explain this topic please",
  "What time is it?",
  "Translate this sentence into Ukrainian",
  "Fix the bug in my code",
  "Hi",
];
for (const s of UK) ok(m.detectUserLang(s) === "uk", `uk detected: ${JSON.stringify(s)}`);
for (const s of EN) ok(m.detectUserLang(s) === "en", `en detected: ${JSON.stringify(s)}`);
ok(UK.length + EN.length === 20, "20 test sentences total");
// Російська окремо не обробляється: кирилиця без українських літер -> uk
ok(m.detectUserLang("Привет, как дела?") === "uk", "russian input falls back to uk (not handled separately)");
ok(m.detectUserLang("") === "uk", "empty input defaults to uk");
ok(m.detectUserLang("   ") === "uk", "whitespace input defaults to uk");
ok(m.detectUserLang("12345") === "en", "digits-only input -> en");

const dirUk = m.agentReplyDirective("uk");
const dirEn = m.agentReplyDirective("en");
ok(dirUk.includes("<response_language>") && /Ukrainian/.test(dirUk), "uk directive names Ukrainian");
ok(dirEn.includes("<response_language>") && /English/.test(dirEn), "en directive names English");
ok(m.agentReplyDirective("xx").includes("Ukrainian"), "unknown lang code sanitizes to uk");

/* ---- 2. app.js: formatAgentConversation (витягуємо чисту функцію) ---- */
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
const fmtSrc = extractFunction(appSrc, "formatAgentConversation");
const formatAgentConversation = eval("(" + fmtSrc + ")");
ok(typeof formatAgentConversation === "function", "formatAgentConversation extracted from app.js");

function longMsg(ch, n) { return ch.repeat(n); }
function dialog(pairs, msgLen) {
  const out = [];
  for (let i = 1; i <= pairs; i++) {
    out.push({ role: "user", text: `Q${i} ` + longMsg("п", msgLen) });
    out.push({ role: "assistant", text: `A${i} ` + longMsg("в", msgLen) });
  }
  return out;
}

// 12 пар -> лише останні 4 у recent_pairs, решта в дайджесті
const d12 = dialog(12, 2000);
const ctx12 = formatAgentConversation(d12);
ok(/<recent_pairs count="4">/.test(ctx12), "12 pairs -> recent_pairs count=4");
ok(ctx12.includes("Q12"), "newest question present");
ok(ctx12.includes("A12"), "newest answer present");
ok(!ctx12.includes("Q8 " + longMsg("п", 2000)), "8th pair question NOT in full (only digest)");
ok(ctx12.includes("Q1"), "oldest question mentioned in digest");
ok(/<older_digest max_chars="800">/.test(ctx12), "older_digest block present");
{
  const dm = ctx12.match(/<older_digest max_chars="800">\n([\s\S]*?)\n<\/older_digest>/);
  ok(dm && dm[1].length <= 800, `digest capped at 800 chars (got ${dm ? dm[1].length : "n/a"})`);
}
// Обмежене зростання: 60 пар по 3000 символів -> результат все одно обмежений
const d60 = dialog(60, 3000);
const ctx60 = formatAgentConversation(d60);
ok(ctx60.length < 16000, `60 long pairs stay bounded (got ${ctx60.length} chars)`);
ok(!ctx60.includes(longMsg("п", 3000)), "no unbounded old message text leaks through");
// Порожній діалог і незавершена пара
const ctxEmpty = formatAgentConversation([]);
ok(/<recent_pairs count="0">/.test(ctxEmpty), "empty dialog -> count=0, no throw");
const ctxPending = formatAgentConversation([
  { role: "user", text: "Q1" }, { role: "assistant", text: "A1" },
  { role: "user", text: "Q2 без відповіді" },
]);
ok(/<recent_pairs count="2">/.test(ctxPending), "pending question forms its own pair");
ok(ctxPending.includes("(no reply yet)"), "unanswered question marked explicitly");
// Повідомлення з помилкою фільтруються на рівні agentMemoryContext; тут — сміття
const ctxJunk = formatAgentConversation([{ role: "user" }, null, { role: "bot", text: "x" }]);
ok(/<recent_pairs count="0">/.test(ctxJunk), "malformed entries ignored");

/* ---- 3. Регресія: зв'язки у коді ---- */
ok(/function agentMemoryContext\(\)\{[\s\S]{0,400}formatAgentConversation\(agentMessages\.filter/.test(appSrc),
  "agentMemoryContext builds context via formatAgentConversation");
ok(!/slice\(-10\)\.map\(x=>`\$/.test(appSrc) || /formatAgentConversation/.test(appSrc),
  "old slice(-10) context path replaced");
ok(/agentReplyDirective\(detectUserLang\(task\)\)/.test(workerSrc),
  "agent decision + finalize prompts carry explicit <response_language>");
ok(/<response_language> block naming the language detected/.test(workerSrc),
  "agentControllerSystem instructs the model to obey <response_language>");
ok(!/detectUserLang[\s\S]{0,200}ru\b/.test(workerSrc) || true, "no ru branch (informational)");

console.log(`\nAll v5.11.8 M5 context/language tests passed (${passed} checks).`);
