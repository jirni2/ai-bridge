/* v5.11.36 — дві ідеї scout:
   1) «Кнопка ручного стиснення контексту»: splitThreadForCompact / buildCompactDigest
      (чисті функції з app.js) + i18n-ключі + кнопка в index.html.
   2) «Чипи джерел під відповідями з веб-дослідженням»: collectAgentWebSources
      (_worker.js, чиста) + agentSourceChipsHtml (app.js, чиста) + CSS. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = fs.readFileSync(path.join(root, "_worker.js"), "utf8");
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

/* Витягнення чистої функції з сирця (баланс дужок; у функціях нема
   фігурних дужок у рядкових літералах — перевіряється нижче). */
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

/* Стаби для app.js-функцій (визначені до eval, щоб замикання їх бачило). */
const safeSourceUrl = v => { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.toString() : ""; } catch (e) { return ""; } };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const t = k => ({ srcChipsLabel: "Джерела" }[k] || k);

/* ---- 1. _worker.js: collectAgentWebSources (як модуль) ---- */
const tmp = new URL("./worker-v51136-sources.mjs", import.meta.url);
fs.writeFileSync(tmp, workerSrc);
let m;
try {
  m = await import(tmp.href + "?t=" + Date.now());
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}
ok(typeof m.collectAgentWebSources === "function", "collectAgentWebSources exported from _worker.js");

const obs = [
  { type: "search_result", query: "сайдинг ціни", results: [
    { title: "Ціни сайдингу", url: "https://example.com/siding", snippet: "ціни від 10$" },
    { title: "Ціни сайдингу", url: "https://example.com/siding", snippet: "дублікат" },
    { title: "HTTP", url: "http://insecure.example/x", snippet: "не https" },
  ]},
  { type: "web_result", url: "https://example.com/page", title: "Сторінка", purpose: "перевірити факт" },
  { type: "tool_error", tool: "search_web", detail: "boom" },
];
const srcs = m.collectAgentWebSources(obs);
ok(srcs.length === 2, "dedup + https-only: 2 sources, got " + srcs.length);
ok(srcs[0].url === "https://example.com/siding" && srcs[0].title === "Ціни сайдингу", "first source title/url kept");
ok(srcs[1].url === "https://example.com/page" && srcs[1].snippet === "перевірити факт", "web_result -> title/url/purpose");
ok(m.collectAgentWebSources([]).length === 0, "empty observations -> []");
ok(m.collectAgentWebSources(null).length === 0, "null observations -> []");
const many = Array.from({ length: 30 }, (_, i) => ({ type: "web_result", url: "https://x" + i + ".example/", title: "t" + i }));
ok(m.collectAgentWebSources(many).length === 12, "default cap 12");
ok(m.collectAgentWebSources(many, 5).length === 5, "custom max=5 respected");
const evil = m.collectAgentWebSources([{ type: "search_result", results: [{ title: "<script>", url: "https://e.example/" + "a".repeat(600), snippet: "s".repeat(500) }]}]);
ok(evil[0].title.length <= 160 && evil[0].url.length <= 500 && evil[0].snippet.length <= 300, "fields bounded (title/url/snippet)");
// Мета-результати агента несуть webSources: симуляція трьох місць виклику
for (const frag of ["webSources:collectAgentWebSources(observations)"]) {
  ok(workerSrc.split(frag).length - 1 === 3, "agent meta x3 carries webSources (got " + (workerSrc.split(frag).length - 1) + ")");
}

/* ---- 2. app.js: splitThreadForCompact / buildCompactDigest / agentSourceChipsHtml ---- */
for (const fn of ["splitThreadForCompact", "buildCompactDigest", "agentSourceChipsHtml"]) {
  const body = extractFunction(appSrc, fn);
  // Після видалення рядків і коментарів дужки мають бути збалансовані,
  // а бектиків поза рядками — не бути (інакше ${} ламає extractFunction).
  const noStr = body.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
  const noCom = noStr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  let d = 0, neg = false;
  for (const c of noCom) { if (c === "{") d++; else if (c === "}") { d--; if (d < 0) neg = true; } }
  ok(d === 0 && !neg, fn + ": braces balanced outside strings/comments");
  ok(!/`/.test(noStr), fn + ": no backticks outside strings");
}
const splitThreadForCompact = eval("(" + extractFunction(appSrc, "splitThreadForCompact") + ")");
const buildCompactDigest = eval("(" + extractFunction(appSrc, "buildCompactDigest") + ")");
const agentSourceChipsHtml = eval("(" + extractFunction(appSrc, "agentSourceChipsHtml") + ")");

function dialog(pairs) {
  const out = [];
  for (let i = 1; i <= pairs; i++) {
    out.push({ role: "user", text: "Q" + i });
    out.push({ role: "assistant", text: "A" + i });
  }
  return out;
}
// 12 пар -> older 16 повідомлень, recent 8 (останні 4 пари)
const d12 = dialog(12);
const sp12 = splitThreadForCompact(d12, 4);
ok(sp12.older.length === 16 && sp12.recent.length === 8, "12 pairs -> older=16, recent=8");
ok(sp12.recent[0].text === "Q9" && sp12.recent[7].text === "A12", "recent = last 4 pairs (Q9..A12)");
ok(sp12.older[0].text === "Q1" && sp12.older[15].text === "A8", "older = first 8 pairs");
// 3 пари -> нічого стискати
const sp3 = splitThreadForCompact(dialog(3), 4);
ok(sp3.older.length === 0 && sp3.recent.length === 6, "3 pairs -> older empty");
// Незавершена пара (питання без відповіді) лишається в recent
const dOpen = dialog(6); dOpen.push({ role: "user", text: "Q7" });
const spOpen = splitThreadForCompact(dOpen, 4);
ok(spOpen.recent.at(-1).text === "Q7" && spOpen.older.length === 6, "open question stays in recent");
// Повідомлення-переказ (assistant без пари) не ламає парування
const dMark = [{ role: "assistant", text: "переказ", compacted: true }].concat(dialog(6));
const spMark = splitThreadForCompact(dMark, 4);
ok(spMark.older.length === 5, "compact marker flows into older, pairing intact");
// Дайджест обмежений
const dg = buildCompactDigest(sp12.older, 800);
ok(dg.length <= 800 && dg.length > 0, "digest capped at 800 chars (got " + dg.length + ")");
ok(dg.includes("Q1") && dg.includes("A8"), "digest mentions oldest and newest of older block");
ok(buildCompactDigest([], 800) === "", "empty older -> empty digest");
ok(buildCompactDigest(sp3.recent, 100).length <= 100, "custom cap respected");

// Чипи джерел
const chips = agentSourceChipsHtml([
  { title: "Ціни", url: "https://a.example/1", snippet: "s1" },
  { title: "Друге", url: "https://b.example/2" },
  { title: "XSS", url: 'https://c.example/3" onmouseover="x', snippet: "<img src=x>" },
  { title: "nope", url: "http://plain.example/" },
]);
ok(chips.includes('class="agentSrcChips"'), "chips wrapped in .agentSrcChips");
ok((chips.match(/data-asrc="/g) || []).length === 3, "3 https chips kept, http dropped (got " + ((chips.match(/data-asrc="/g) || []).length) + ")");
ok(chips.includes('<span class="srcNum">1</span>') && chips.includes('<span class="srcNum">3</span>'), "numbered 1..3");
ok(!chips.includes("<img") && chips.includes("&lt;img"), "snippet HTML-escaped");
ok(!/" onmouseover="/.test(chips) && chips.includes("onmouseover=%22x"), "URL normalized by URL parser: quotes percent-encoded, no attribute injection");
ok(agentSourceChipsHtml([]) === "" && agentSourceChipsHtml(null) === "", "no results -> empty string");
ok(appSrc.includes("renderAgentSourceChips(m)"), "renderAgentThread uses renderAgentSourceChips");
ok(appSrc.includes('meta.webSources') && appSrc.includes('meta.webSearch'), "chips read meta.webSources or meta.webSearch.results");

/* ---- 3. i18n / HTML / CSS ---- */
for (const k of ["ctxCompact", "ctxCompacted", "ctxNothingToCompact", "ctxCompactSummaryTitle", "srcChipsLabel"]) {
  ok(i18nSrc.includes("en:{" ) && new RegExp(k + ":").test(i18nSrc), "i18n key present: " + k);
}
for (const [lang, val] of [["uk", "Стиснути контекст"], ["en", "Compact context"], ["ru", "Сжать контекст"]]) {
  ok(i18nSrc.includes(val), "ctxCompact " + lang + ": " + JSON.stringify(val));
}
ok(htmlSrc.includes('id="ctxCompactBtn"') && htmlSrc.includes('data-i18n="ctxCompact"'), "ctxCompactBtn in index.html composer head");
ok(cssSrc.includes(".agentSrcChips"), ".agentSrcChips style in styles.css");
ok(cssSrc.includes("overflow-x:auto") || cssSrc.includes("overflow-x: auto"), "chips scroll horizontally on 390px");

console.log("\nPASS: " + passed + " checks (v5.11.36 ctx-compact + source chips)");
