// tests/run_v51186_routing_swipe_tests.mjs
// v5.11.86: (1) рядок роутингу M2 називає відхилених кандидатів і причини;
// (2) свайп-дії на картках завдань команди (complete/snooze/unsnooze).
// Патерн як tests/run_v511_team_tests.mjs: копія ../_worker.js -> тимчасовий
// файл -> ESM-імпорт -> ok() -> видалення. Жодних live-мережевих викликів.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v51186-under-test.mjs", import.meta.url);
fs.writeFileSync(TMP, fs.readFileSync(SRC, "utf8"));

let checks = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  checks++;
  console.log("✓", msg);
}
const section = (n) => console.log("\n—— " + n);

function makeKV() {
  const map = new Map();
  return {
    async get(k) { const v = map.get(String(k)); return v === undefined ? null : v; },
    async put(k, v) { map.set(String(k), String(v)); },
    async delete(k) { map.delete(String(k)); },
    async list({ prefix = "", limit, cursor } = {}) {
      const names = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const cut = typeof limit === "number" && limit >= 0 ? names.slice(0, limit) : names;
      return { keys: cut.map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
const uniq = (p) => p + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
async function expectThrow(fn, rx, msg) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  const text = String((err && err.message) || "") + " | code=" + String((err && err.code) || "");
  ok(err !== null && rx.test(text), msg + "  [got: " + text.slice(0, 140) + "]");
}

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());

  // ============ 1. routingRejectedList ============
  section("routingRejectedList");
  ok(typeof m.routingRejectedList === "function", "routingRejectedList експортовано");

  const env2 = () => ({ GEMINI_API_KEY: "t1", GROQ_API_KEY: "t2" }); // лише 2 налаштовано
  let r = m.routingRejectedList(env2(), ["gemini"]);
  ok(Array.isArray(r) && r.length === 3, "3 відхилених (кап)");
  ok(r[0].p === "groqfree" && r[0].r === "weaker", "налаштований, але не обраний — weaker першим: " + JSON.stringify(r[0]));
  ok(r.every((x) => typeof x.p === "string" && typeof x.r === "string"), "елементи {p,r}");
  ok(r.slice(1).every((x) => x.r === "no_key"), "неналаштовані — no_key після weaker");

  r = m.routingRejectedList(env2(), ["gemini", "groqfree"]);
  ok(r.every((x) => x.r === "no_key"), "обидва налаштовані обрані — лишаються тільки no_key");

  // cooldown
  m.providerHealth.set("groqfree", { provider: "groqfree", cooldownUntil: Date.now() + 60000, updatedAt: Date.now(), consecutiveFailures: 3 });
  r = m.routingRejectedList(env2(), ["gemini"]);
  ok(r[0].p === "groqfree" && r[0].r === "cooldown", "cooldown має пріоритет над weaker: " + JSON.stringify(r[0]));
  m.providerHealth.delete("groqfree");

  // sticky
  r = m.routingRejectedList(env2(), ["gemini"], { sticky: true });
  ok(r[0].p === "groqfree" && r[0].r === "sticky", "sticky-pin — причина sticky: " + JSON.stringify(r[0]));

  // visionOnly: groqfree без зору
  r = m.routingRejectedList(env2(), ["gemini"], { visionOnly: true });
  ok(r[0].p === "groqfree" && r[0].r === "no_vision", "не-vision провайдер на image-задачі — no_vision: " + JSON.stringify(r[0]));

  // бюджетне пониження
  r = m.routingRejectedList({ GEMINI_API_KEY: "t1", GROQ_API_KEY: "t2", OPENAI_API_KEY: "t3" }, ["gemini"], { over: true });
  ok(r.some((x) => x.p === "openai" && x.r === "budget"), "платний при перевищеному бюджеті — budget: " + JSON.stringify(r));

  // обраний не потрапляє у відхилені
  r = m.routingRejectedList(env2(), ["groqfree"]);
  ok(!r.some((x) => x.p === "groqfree"), "обраний провайдер не в списку відхилених");

  // ============ 2. teamTaskTransition: complete/snooze/unsnooze ============
  section("team transitions");
  const env = { BRIDGE_ACCESS_TOKEN: "test-token", AI_BRIDGE_JOBS: makeKV() };
  await m.teamConfigPut(env, { enabled: true }, "user");
  const mkTask = async (title) => m.teamTaskCreate(env, { role: "coordinator", title, input: "t" });

  const t1 = await mkTask(uniq("swipe-complete"));
  await m.teamTaskTransition(env, t1.id, "start", "user");
  let g = await m.teamTaskGet(env, t1.id);
  ok(g.status === "running", "start -> running");
  await m.teamTaskTransition(env, t1.id, "complete", "user");
  g = await m.teamTaskGet(env, t1.id);
  ok(g.status === "done", "complete: running -> done");

  const t2 = await mkTask(uniq("swipe-complete-bad"));
  await expectThrow(() => m.teamTaskTransition(env, t2.id, "complete", "user"), /TRANSITION/, "complete з queued — TRANSITION (409)");

  const t3 = await mkTask(uniq("swipe-snooze"));
  const until = Date.now() + 24 * 3600e3;
  await m.teamTaskTransition(env, t3.id, "snooze", "user", { until });
  g = await m.teamTaskGet(env, t3.id);
  ok(g.status === "blocked" && Number(g.snoozedUntil) === until, "snooze: queued -> blocked + мітка");
  ok(typeof g.blockedReason === "string" && g.blockedReason.includes("відкладено"), "blockedReason українською: " + g.blockedReason);
  await m.teamTaskTransition(env, t3.id, "unsnooze", "user");
  g = await m.teamTaskGet(env, t3.id);
  ok(g.status === "queued" && !g.snoozedUntil && !g.blockedReason, "unsnooze: blocked -> queued, мітки очищено");

  const t4 = await mkTask(uniq("swipe-snooze-bad"));
  await expectThrow(() => m.teamTaskTransition(env, t4.id, "snooze", "user", { until: Date.now() - 1000 }), /BAD/, "snooze в минуле — BAD (400)");
  await expectThrow(() => m.teamTaskTransition(env, t4.id, "snooze", "user", { until: Date.now() + 60 * 24 * 3600e3 }), /BAD/, "snooze далі 30 днів — BAD (400)");

  // ============ 3. teamSnoozePass: автоповернення ============
  section("teamSnoozePass");
  ok(typeof m.teamSnoozePass === "function", "teamSnoozePass експортовано");
  const t5 = await mkTask(uniq("snooze-wake"));
  await m.teamTaskTransition(env, t5.id, "snooze", "user", { until: Date.now() + 3600e3 });
  let w = await m.teamSnoozePass(env);
  ok(w.woken.length === 0, "майбутній snooze не чіпається");
  g = await m.teamTaskGet(env, t5.id);
  g.snoozedUntil = Date.now() - 1000;
  await m.teamTaskSave(env, g);
  w = await m.teamSnoozePass(env);
  ok(w.woken.includes(t5.id), "минула мітка -> woken");
  g = await m.teamTaskGet(env, t5.id);
  ok(g.status === "queued" && !g.snoozedUntil, "прокинуте завдання в queued");

  // ============ 4. статика клієнта ============
  section("client static");
  const root = new URL("..", import.meta.url).pathname;
  const appjs = fs.readFileSync(root + "app.js", "utf8");
  const crewjs = fs.readFileSync(root + "crew.js", "utf8");
  const i18njs = fs.readFileSync(root + "i18n.js", "utf8");
  ok(appjs.includes("routingRejected") && appjs.includes("routeRejectedShow") && appjs.includes("routeWhyRejList"), "app.js: розкриття відхилених у рядку роутингу");
  ok(crewjs.includes("initTaskSwipe") && crewjs.includes('data-id="${esc(x.id)}"') && crewjs.includes("openSnoozeSheet"), "crew.js: свайп-дії карток");
  ok(crewjs.includes('action:"snooze"') || crewjs.includes('"snooze",{until'), "crew.js: snooze з until");
  for (const k of ["routeRejectedShow", "routeRejNoKey", "routeRejNoVision", "routeRejCooldown", "routeRejBudget", "routeRejSticky", "routeRejWeaker",
    "crewComplete", "crewCompleted", "crewSnooze", "crewSnoozeTitle", "crewSnoozeToday", "crewSnoozeTomorrow", "crewSnoozeWeek",
    "crewSnoozed", "crewUnsnooze", "crewUnsnoozed", "crewSnoozedUntil"]) {
    ok((i18njs.match(new RegExp(k + ":", "g")) || []).length === 3, "i18n: " + k + " у 3 мовах");
  }
  ok(fs.readFileSync(root + "styles.css", "utf8").includes(".crew-swipe"), "styles.css: стилі свайпу");

  console.log("\nPASS: " + checks + " checks");
} finally {
  try { fs.unlinkSync(TMP); } catch (e) {}
}
