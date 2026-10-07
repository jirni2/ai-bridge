/* AI Bridge M2: вибір моделі за типом завдання.
   Жодних викликів AI і жодної мережі: все детерміновано й офлайн.
   Перевіряє:
   1) таблиця сильних сторін — ДАНІ (PROVIDER_STRENGTHS), покриває всі
      категорії класифікатора; Workers AI в ній немає (заборона власника);
   2) на наборі M1 (60 питань) перший провайдер правильний щонайменше для
      90% питань (для маршруту local вибір не потрібен — зараховується);
   3) модель на паузі (cooldown після перевантаження/ліміту) ніколи не
      стоїть першою, поки є здорова;
   4) вивчені дані (learningState) можуть підняти провайдера вгору. */
import {pathToFileURL, fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const m = await import(pathToFileURL(path.join(root, "_worker.js")).href);
const {loadFixtures} = await import(pathToFileURL(path.join(root, "tools", "route-eval.mjs")).href);

let passed = 0;
function ok(cond, msg){ if(!cond) throw new Error("FAIL: "+msg); passed++; console.log("PASS:", msg); }

const FREE = ["gemini", "groqfree", "openrouter"];
const PAID = ["claude", "openai", "grok"];
const env = {GROQ_API_KEY:"x", GEMINI_API_KEY:"y", OPENROUTER_API_KEY:"z"};
const resetHealth = () => m.providerHealth.clear();
const resetLearning = () => { m.learningState.data.routes = {}; };

// 1) Таблиця — дані, повна й без Workers AI
const CATS = ["empty","greeting","translation","rewrite","code","code_files","files",
  "image","url_task","creative","current_info","factual","research","general"];
ok(m.PROVIDER_STRENGTHS && typeof m.PROVIDER_STRENGTHS === "object", "PROVIDER_STRENGTHS існує як дані");
for (const c of CATS){
  const row = m.PROVIDER_STRENGTHS[c];
  ok(Array.isArray(row) && row.length >= 2 && row.every(id => FREE.includes(id)),
    `категорія «${c}» має порядок із free-провайдерів (${(row||[]).join(",")})`);
}
const allIds = new Set(Object.values(m.PROVIDER_STRENGTHS).flat());
ok(![...allIds].some(id => /workers|cloudflare/i.test(id)), "Workers AI немає в таблиці (заборона власника)");
ok(m.PROVIDER_STRENGTHS.image[0] === "gemini" && m.PROVIDER_STRENGTHS.files[0] === "gemini",
  "фото і довгий контекст — Gemini першим");
ok(m.PROVIDER_STRENGTHS.factual[0] === "groqfree" && m.PROVIDER_STRENGTHS.code[0] === "groqfree",
  "швидкі короткі відповіді — Groq першим");
ok(typeof m.selectProvidersForCategory === "function", "selectProvidersForCategory існує");

// 2) Набір M1: перший провайдер правильний для >= 90% питань
resetHealth(); resetLearning();
const fixtures = loadFixtures();
let correct = 0, providerRouted = 0;
const wrong = [];
for (const item of fixtures.items){
  const decision = m.decideRoute({}, {mode:"auto", prompt:item.prompt},
    {hasFiles:!!item.hasFiles, hasImages:!!item.hasImages});
  if (decision.route === "local"){ correct++; continue; } // вибір моделі не потрібен
  providerRouted++;
  const picked = m.autoSelect(env, item.prompt,
    {hasFiles:!!item.hasFiles, hasImages:!!item.hasImages})[0];
  const expected = m.PROVIDER_STRENGTHS[item.expectedCategory][0];
  if (picked === expected) correct++;
  else wrong.push(`[${item.id}] «${item.prompt}» → ${picked}, очікував ${expected}`);
}
const acc = correct / fixtures.items.length;
ok(acc >= 0.9,
  `M1: правильний перший провайдер для ${(acc*100).toFixed(1)}% питань (${correct}/${fixtures.items.length}, з провайдером: ${providerRouted})`);
if (wrong.length) console.log("  розбіжності:\n  - " + wrong.join("\n  - "));

// 3) Пауза: модель на cooldown не перша
resetHealth();
m.noteProviderHealth("groqfree", {ok:false, errorKind:"rate_limited", status:429});
const snap = m.providerHealthSnapshot(["groqfree"]);
ok(snap.groqfree.coolingDown === true, "groqfree справді на паузі після rate_limited");
const cooledFirst = m.autoSelect(env, "Хто винайшов телефон?")[0];
ok(cooledFirst !== "groqfree",
  `модель на паузі не перша (перший: ${cooledFirst})`);
const cooledAll = m.autoSelect(env, "Хто винайшов телефон?");
ok(cooledAll.includes("openrouter") || cooledAll.includes("gemini"),
  "здоровий провайдер підхоплює замість того, що на паузі");
m.noteProviderHealth("gemini", {ok:false, errorKind:"billing_or_quota", status:429});
m.noteProviderHealth("openrouter", {ok:false, errorKind:"timeout"});
const allCooled = m.autoSelect(env, "Хто винайшов телефон?");
ok(allCooled.length > 0, "коли всі на паузі — все одно є порядок (нема з чого вибрати кращого)");
resetHealth();
ok(m.autoSelect(env, "Хто винайшов телефон?")[0] === "groqfree",
  "після скидання здоров'я порядок відновлюється");

// 4) Вивчені дані піднімають провайдера
resetHealth(); resetLearning();
m.learningState.data.routes.creative = {
  "direct|openrouter|no_tools": {s:5, f:0, v:0, vf:0, avgMs:800, kinds:{}, updatedAt:Date.now()}
};
const learnedFirst = m.autoSelect(env, "напиши вірш про осінь")[0];
ok(learnedFirst === "openrouter",
  `впевнені вивчені дані ставлять openrouter першим для creative (є ${learnedFirst})`);
resetLearning();
ok(m.autoSelect(env, "напиши вірш про осінь")[0] === "groqfree",
  "без вивчених даних діє таблиця (groqfree першим)");

// 5) autoSelect ніколи не повертає сторонніх/заборонених провайдерів
resetHealth(); resetLearning();
for (const item of fixtures.items){
  const ids = m.autoSelect(env, item.prompt, {hasFiles:!!item.hasFiles, hasImages:!!item.hasImages});
  ok(ids.every(id => [...FREE, ...PAID].includes(id)),
    `вибір [${item.id}] лише з відомих провайдерів (${ids.join(",")})`);
  ok(ids.length <= 2, `не більше 2 провайдерів за раз [${item.id}]`);
}

// 6) Довгий промпт без файлів — як довгий контекст (Gemini першим)
resetHealth();
const longFirst = m.autoSelect(env, "поясни ".repeat(20000))[0];
ok(longFirst === "gemini", `промпт >100k символів іде до Gemini першим (є ${longFirst})`);

console.log(`\nM2: ${passed} перевірок пройдено.`);
