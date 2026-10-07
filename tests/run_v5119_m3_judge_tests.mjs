/* M3 (v5.11.9 wave 2) — «Оцінка якості відповіді (Judge з рубрикою)».
   1) parseQualityScore: валідний JSON, паркани ```json, українські ключі,
      кламп 0..5, зламаний JSON / порожньо / брак ключа / нечисло → null.
   2) formatQualityScore: українська кома, англійська крапка.
   3) qualityJudgePrompt: JSON-контракт і рубрика, uk/en.
   4) applyQualityGate (з інжектованими фейками, без мережі):
      високий бал → без повтору; низький → рівно 1 повтор іншою моделлю;
      низький двічі → петлі немає; таймаут Judge → без повтору;
      порожня відповідь / localResponder → пропуск; провал повтору →
      оригінал; завислий повтор → в межах бюджету, без висяка. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = fs.readFileSync(path.join(root, "_worker.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

const tmp = new URL("./worker-v5119-m3.mjs", import.meta.url);
fs.writeFileSync(tmp, workerSrc);
let m;
try {
  m = await import(tmp.href + "?t=" + Date.now());
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}
const {parseQualityScore, formatQualityScore, qualityJudgePrompt, applyQualityGate, QUALITY_JUDGE_THRESHOLD} = m;
ok(typeof parseQualityScore === "function", "parseQualityScore експортовано");
ok(typeof applyQualityGate === "function", "applyQualityGate експортовано");
ok(QUALITY_JUDGE_THRESHOLD === 3, "поріг повтору = 3");

/* ---- 1. parseQualityScore: валідний JSON ---- */
let s = parseQualityScore('{"accuracy":5,"completeness":4,"language":4,"sources":3}');
ok(s && s.accuracy === 5 && s.completeness === 4 && s.language === 4 && s.sources === 3, "валідний JSON: 4 критерії");
ok(s.avg === 4, "avg = (5+4+4+3)/4 = 4");

/* ---- 2. паркани ```json ---- */
s = parseQualityScore('```json\n{"accuracy":2,"completeness":2,"language":5,"sources":5}\n```');
ok(s && s.avg === 3.5, "паркани ```json знімаються, avg=3.5");

/* ---- 3. JSON серед тексту ---- */
s = parseQualityScore('Ось оцінка: {"accuracy":1,"completeness":1,"language":1,"sources":1} дякую.');
ok(s && s.avg === 1, "JSON витягується з навколишнього тексту");

/* ---- 4. зламаний JSON / порожньо → null ---- */
ok(parseQualityScore('{"accuracy":5,"completeness":') === null, "зламаний JSON → null");
ok(parseQualityScore('') === null, "порожній рядок → null");
ok(parseQualityScore('немає json взагалі') === null, "без JSON → null");
ok(parseQualityScore(null) === null, "null → null");

/* ---- 5. кламп 0..5 ---- */
s = parseQualityScore('{"accuracy":7,"completeness":-2,"language":4.5,"sources":5}');
ok(s && s.accuracy === 5 && s.completeness === 0 && s.language === 4.5, "значення клампляться в 0..5");

/* ---- 6. українські ключі ---- */
s = parseQualityScore('{"точність":4,"повнота":4,"мова":5,"джерела":5}');
ok(s && s.accuracy === 4 && s.completeness === 4 && s.language === 5 && s.sources === 5 && s.avg === 4.5, "українські ключі розпізнаються");

/* ---- 7. брак ключа / нечисло → null ---- */
ok(parseQualityScore('{"accuracy":4,"completeness":4,"language":4}') === null, "брак ключа sources → null");
ok(parseQualityScore('{"accuracy":"високо","completeness":4,"language":4,"sources":4}') === null, "нечислове значення → null");

/* ---- 8. formatQualityScore ---- */
ok(formatQualityScore(4.2, "uk") === "4,2", "uk: десяткова кома");
ok(formatQualityScore(4.2, "en") === "4.2", "en: десяткова крапка");
ok(formatQualityScore(5, "uk") === "5", "ціле без коми");

/* ---- 9. qualityJudgePrompt ---- */
const pUk = qualityJudgePrompt("Скільки буде 2+2?", "4", "uk");
ok(pUk.includes('"accuracy"') && pUk.includes("точність") && pUk.includes("ТІЛЬКИ один JSON"), "uk-промпт: рубрика + JSON-контракт");
const pEn = qualityJudgePrompt("What is 2+2?", "4", "en");
ok(pEn.includes("accuracy") && pEn.includes("Return ONLY one JSON object"), "en-промпт: рубрика + JSON-контракт");

/* ---- 10. applyQualityGate з фейками ---- */
const lowScore = {accuracy: 1.5, completeness: 1, language: 2, sources: 1, avg: 1.5};
const highScore = {accuracy: 5, completeness: 4.5, language: 5, sources: 4, avg: 4.6};
const mkJudge = (score, onCall) => async () => { onCall && onCall(); return {score, judge: "groqfree", timedOut: false, error: null}; };
const mkOut = (final = "ORIGINAL ANSWER") => ({version: "x", selectedProviders: ["gemini"], results: [], final, judge: null, meta: {mode: "auto"}});

// a) високий бал → без повтору
{
  let runCalls = 0, judgeCalls = 0;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "groqfree", "openrouter"], _judge: mkJudge(highScore, () => judgeCalls++), _runOne: async () => { runCalls++; return {ok: true, provider: "x", text: "y"}; }});
  ok(runCalls === 0, "високий бал: повтору немає");
  ok(out.final === "ORIGINAL ANSWER", "високий бал: відповідь не змінено");
  ok(out.meta.qualityScore && out.meta.qualityScore.avg === 4.6 && out.meta.qualityScore.retried === false, "високий бал: оцінка в meta");
  ok(judgeCalls === 1, "високий бал: рівно 1 виклик Judge");
}
// b) низький бал → рівно 1 повтор ІНШОЮ моделлю
{
  const runCalls = [];
  let judgeN = 0;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "groqfree", "openrouter"], _judge: async () => ({score: judgeN++ === 0 ? lowScore : highScore, judge: "groqfree", timedOut: false, error: null}), _runOne: async (env, id) => { runCalls.push(id); return {ok: true, provider: id, text: "RETRY ANSWER", ms: 50}; }});
  ok(runCalls.length === 1, "низький бал: рівно 1 повтор");
  ok(runCalls[0] !== "gemini" && runCalls[0] !== "groqfree", "повтор — іншою моделлю, не автором і не суддею");
  ok(out.final === "RETRY ANSWER", "низький бал: відповідь замінено повтором");
  ok(out.meta.qualityScore.retried === true && out.meta.qualityScore.retryProvider === runCalls[0], "meta: retried + retryProvider");
  ok(out.meta.qualityScore.avg === 4.6, "після повтору — нова оцінка");
}
// c) низький бал двічі → петлі НЕМАЄ
{
  let runCalls = 0, judgeCalls = 0;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "groqfree", "openrouter"], _judge: mkJudge(lowScore, () => judgeCalls++), _runOne: async () => { runCalls++; return {ok: true, provider: "openrouter", text: "RETRY2"}; }});
  ok(runCalls === 1, "двічі низький бал: повтор все одно лише 1, петлі немає");
  ok(judgeCalls === 2, "двічі низький бал: максимум 2 виклики Judge");
  ok(out.final === "RETRY2", "двічі низький бал: показано повтор (без нескінченності)");
}
// d) таймаут Judge → без повтору, оригінал
{
  let runCalls = 0;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "groqfree", "openrouter"], _judge: async () => ({score: null, judge: "groqfree", timedOut: true, error: "timeout"}), _runOne: async () => { runCalls++; return {ok: true, provider: "x", text: "y"}; }});
  ok(runCalls === 0, "таймаут Judge: повтору немає");
  ok(out.final === "ORIGINAL ANSWER" && out.meta.qualityScore === null, "таймаут Judge: оригінал без оцінки");
}
// e) порожня відповідь / localResponder → пропуск без викликів
{
  let judgeCalls = 0;
  const out1 = mkOut("");
  await applyQualityGate({}, out1, {task: "q", _judge: mkJudge(lowScore, () => judgeCalls++)});
  ok(judgeCalls === 0 && out1.final === "", "порожня відповідь: Judge не викликається");
  const out2 = mkOut(); out2.meta.localResponder = true;
  await applyQualityGate({}, out2, {task: "2+2", _judge: mkJudge(lowScore, () => judgeCalls++)});
  ok(judgeCalls === 0, "localResponder: гейт пропущено");
}
// f) провал повтору → оригінал лишається
{
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "groqfree", "openrouter"], _judge: mkJudge(lowScore), _runOne: async () => { throw new Error("boom"); }});
  ok(out.final === "ORIGINAL ANSWER", "провал повтору: показано оригінал");
  ok(out.meta.qualityScore && out.meta.qualityScore.avg === 1.5, "провал повтору: оцінка оригіналу збережена");
}
// g) завислий повтор → в межах бюджету, гейт не висить
{
  const out = mkOut();
  const t0 = Date.now();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "openrouter"], retryBudgetMs: 300, _judge: mkJudge(lowScore), _runOne: (env, id, mode, prompt, sys, onEvent, signal) => new Promise((res, rej) => { const t = setTimeout(() => res({ok: true, provider: id, text: "late"}), 60000); signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); })});
  const dt = Date.now() - t0;
  ok(dt < 8000, `завислий повтор: гейт повернувся за ${dt}мс (бюджет)`);
  ok(out.final === "ORIGINAL ANSWER", "завислий повтор: показано оригінал");
}
// h) applyQualityGate ніколи не кидає
{
  const r = await applyQualityGate({}, null, {});
  ok(r === null, "null → null, без винятку");
}
// i) вимкнення гейта
{
  let judgeCalls = 0;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "q", lang: "uk", enabled: false, _judge: mkJudge(lowScore, () => judgeCalls++)});
  ok(judgeCalls === 0 && !out.meta.qualityScore, "enabled:false — гейт вимкнено");
}

// i2) single-режим: суддя — та сама модель (force), повтору іншою немає
{
  let runCalls = 0, forced = null;
  const out = mkOut();
  await applyQualityGate({}, out, {task: "питання", lang: "uk", providerIds: ["gemini", "openrouter"], judgeProvider: "openrouter", allowRetry: false, _judge: async (env, opts) => { forced = opts.force; return {score: lowScore, judge: "openrouter", timedOut: false, error: null}; }, _runOne: async () => { runCalls++; return {ok: true, provider: "x", text: "y"}; }});
  ok(forced === "openrouter", "single: Judge примусово та сама модель (force)");
  ok(runCalls === 0, "single: низький бал, але повтору іншою моделлю немає");
  ok(out.final === "ORIGINAL ANSWER", "single: показано оригінал обраної моделі");
  ok(out.meta.qualityScore && out.meta.qualityScore.avg === 1.5 && out.meta.qualityScore.retried === false, "single: низька оцінка чесно показана");
}

/* ---- 11. i18n / UI ---- */
ok(i18nSrc.includes('qualityScore:"Оцінка: {n}"'), "i18n: український ключ «Оцінка: {n}»");
ok(i18nSrc.includes('qualityScore:"Score: {n}"'), "i18n: англійський ключ");
ok(!/qualityScore:"[^"]*[Оо]ценка/.test(i18nSrc), "i18n: російської немає");
ok(appSrc.includes("renderQualityScore(run)"), "app.js: renderAnswer викликає renderQualityScore");
ok(cssSrc.includes(".qualityScore{"), "styles.css: клас .qualityScore");
ok(!/\.qualityScore\{[^}]*#[0-9a-f]{3,6}/i.test(cssSrc), "styles.css: без hex у .qualityScore (токени D1)");

console.log(`\nM3: ${passed} перевірок пройдено.`);
