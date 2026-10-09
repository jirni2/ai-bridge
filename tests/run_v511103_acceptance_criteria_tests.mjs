// tests/run_v511103_acceptance_criteria_tests.mjs
// v5.11.103 — критерії прийняття завдань команди (acceptance checklist).
// Сервер: нова дія POST /api/team/tasks/:id {action:"set-criteria"} — дозволена
// лише для статусів queued/paused, авторизація через perm task.create.
// Клієнт: crew.js — блок критеріїв з вердиктами на картці + інлайн-редактор.
//
// Запуск: node tests/run_v511103_acceptance_criteria_tests.mjs (має вийти 0).
// Метод: _worker.js копіюється в tmp і імпортується (як у run_v5111_* тестах);
// set-criteria проганяється крізь handleTeam з моком KV; реальний сервер НЕ запускається.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v511103-acceptance-under-test.mjs", import.meta.url);
fs.writeFileSync(TMP, fs.readFileSync(SRC, "utf8"));

let checks = 0, failures = 0;
function ok(cond, msg) {
  checks++;
  if (cond) { console.log("✓", msg); }
  else { failures++; console.log("✗ FAIL:", msg); }
}
const section = (n) => console.log("\n—— " + n);

function makeKV() {
  const map = new Map();
  return {
    async get(k) { const v = map.get(String(k)); return v === undefined ? null : v; },
    async put(k, v) { map.set(String(k), String(v)); },
    async delete(k) { map.delete(String(k)); },
    async list({ prefix = "", limit } = {}) {
      const names = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const cut = typeof limit === "number" && limit >= 0 ? names.slice(0, limit) : names;
      return { keys: cut.map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
const freshEnv = () => ({
  AI_BRIDGE_JOBS: makeKV(),
  BRIDGE_ACCESS_TOKEN: "test-access-token-v511103",
  TEAM_TOKEN_SECRET: "test-team-secret-v511103",
  CRON_SECRET: "test-cron-secret-v511103",
});

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());

  // ================= 1. teamNormalizeCriteria: межі =================
  section("teamNormalizeCriteria: межі нормалізації");
  {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: "c" + (i + 1), text: "t" + i }));
    const norm = m.teamNormalizeCriteria(many);
    ok(norm.length === 20, "обрізає список до 20 (було 30)");
    const long = m.teamNormalizeCriteria([{ id: "c1", text: "x".repeat(500) }]);
    ok(long[0].text.length === 200, "текст обрізає до 200 символів");
    const str = m.teamNormalizeCriteria(["рядок-критерій"]);
    ok(str.length === 1 && str[0].id === "c1" && str[0].text === "рядок-критерій",
      "рядки (не об'єкти) нормалізуються з авто-id");
    ok(m.teamNormalizeCriteria(null).length === 0, "не-масив → порожній список");
    ok(typeof m.teamNormalizeCriteria === "function" && typeof m.teamEvaluateCriteria === "function",
      "функції експортовані з _worker.js");
  }

  // ================= 2. teamEvaluateCriteria: вердикти =================
  section("teamEvaluateCriteria: вердикти");
  {
    const criteria = [
      { id: "c1", text: "перевірка раннера", expectEvidence: null },
      { id: "c2", text: "маркер у доказах", expectEvidence: "deploy-ok" },
      { id: "c3", text: "не оцінено" },
    ];
    const res = {
      criteriaChecks: [{ id: "c1", verdict: "pass", note: "ok" }],
      evidence: ["звіт [log] deploy-ok: деплой вдався"],
    };
    const v = m.teamEvaluateCriteria(criteria, res);
    ok(v.length === 3, "вердикт по кожному з 3 критеріїв");
    ok(v[0].verdict === "pass" && v[0].text === "перевірка раннера",
      "c1: pass за вердиктом раннера (criteriaChecks за id)");
    ok(v[1].verdict === "pass", "c2: pass — expectEvidence знайдено в evidence (case-insensitive)");
    ok(v[2].verdict === "fail", "c3: fail — раннер не оцінив і expectEvidence немає");
    const noMark = m.teamEvaluateCriteria(
      [{ id: "c1", text: "t", expectEvidence: "missing-marker" }], { criteriaChecks: [], evidence: ["інше"] });
    ok(noMark[0].verdict === "fail", "expectEvidence без збігу → fail");
    const runnerFail = m.teamEvaluateCriteria(
      [{ id: "c1", text: "t" }], { criteriaChecks: [{ id: "c1", verdict: "fail", note: "broken" }] });
    ok(runnerFail[0].verdict === "fail" && runnerFail[0].note === "broken",
      "вердикт раннера fail → fail з його note");
  }

  // ================= 3. set-criteria через HTTP (handleTeam) =================
  section("set-criteria через POST /api/team/tasks/:id");
  {
    const env = freshEnv();
    const AUTH = { Authorization: "Bearer test-access-token-v511103" };
    const callTeam = (path, init) => m.handleTeam(new Request("https://team.local" + path, init),
      env, new URL("https://team.local" + path));
    const postOpts = (body) => ({ method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const t = await m.teamTaskCreate(env, { role: "tester", title: "crit-t-1", author: "user" });
    ok(t && t.status === "queued", "завдання створено (queued)");

    // queued → дозволено
    let res = await callTeam("/api/team/tasks/" + t.id, postOpts({ action: "set-criteria", criteria: ["перший", "другий"] }));
    ok(res.status === 200, "set-criteria на queued → 200");
    let body = await res.json();
    ok(body.task && body.task.criteria.length === 2 && body.task.criteria[0].id === "c1"
      && body.task.criteria[0].text === "перший",
      "критерії нормалізовано й збережено (рядки → {id,text})");

    // об'єктна форма + обріз до 20
    const many = Array.from({ length: 25 }, (_, i) => ({ id: "k" + i, text: "k" + i }));
    res = await callTeam("/api/team/tasks/" + t.id, postOpts({ action: "set-criteria", criteria: many }));
    body = await res.json();
    ok(res.status === 200 && body.task.criteria.length === 20, "set-criteria: 25 критеріїв → збережено 20");

    // running → заборонено (409)
    const cur = await m.teamTaskGet(env, t.id);
    cur.status = "running"; await m.teamTaskSave(env, cur);
    res = await callTeam("/api/team/tasks/" + t.id, postOpts({ action: "set-criteria", criteria: ["новий"] }));
    body = await res.json();
    ok(res.status === 409 && String(body.error || "").toLowerCase().includes("locked"),
      "set-criteria на running → 409 CRITERIA_LOCKED");

    // paused → дозволено
    cur.status = "paused"; await m.teamTaskSave(env, cur);
    res = await callTeam("/api/team/tasks/" + t.id, postOpts({ action: "set-criteria", criteria: ["змінено на паузі"] }));
    body = await res.json();
    ok(res.status === 200 && body.task.criteria.length === 1
      && body.task.criteria[0].text === "змінено на паузі",
      "set-criteria на paused → 200, критерії замінено");

    // done → заборонено
    cur.status = "done"; await m.teamTaskSave(env, cur);
    res = await callTeam("/api/team/tasks/" + t.id, postOpts({ action: "set-criteria", criteria: ["пізно"] }));
    ok(res.status === 409, "set-criteria на done → 409");

    // неіснуюче завдання → 404
    res = await callTeam("/api/team/tasks/nope-123", postOpts({ action: "set-criteria", criteria: ["x"] }));
    ok(res.status === 404, "set-criteria на невідомий id → 404");

    // подія в журналі
    const ev = await m.teamEventList(env, 50);
    ok(ev.some((e) => String(e.msg || "").includes("criteria updated")),
      "подія 'criteria updated' залогована в journal");
  }

  // ================= 4. Авторизація set-criteria =================
  section("teamAuthorize: set-criteria вимагає task.create");
  {
    const env = freshEnv();
    const ctx = (a, scope) => ({ action: a, scope });
    const route = "/tasks/:id";
    ok(m.teamAuthorize(env, "user", route, "POST", ctx("set-criteria", [])).allowed === true,
      "user (кореневий принципал) — дозволено");
    ok(m.teamAuthorize(env, "team:coordinator", route, "POST", ctx("set-criteria", ["task.create"])).allowed === true,
      "агент з task.create — дозволено");
    const denied = m.teamAuthorize(env, "team:architect", route, "POST", ctx("set-criteria", []));
    ok(denied.allowed === false, "агент без task.create — відхилено");
    const other = m.teamAuthorize(env, "team:coordinator", route, "POST", ctx("set-criteria", ["task.assign"]));
    ok(other.allowed === false, "perm task.assign не дає права на set-criteria");
  }

  // ================= 5. crew.js: клієнтські функції =================
  section("crew.js: критерії в клієнті (статичний аналіз)");
  {
    const src = fs.readFileSync(new URL("../crew.js", import.meta.url), "utf8");
    for (const fn of ["criteriaVerdicts", "critBlock", "critEditorBlock", "saveCriteria"])
      ok(src.includes("function " + fn), "crew.js містить " + fn);
    ok(src.includes('action:"set-criteria"') || src.includes('action: "set-criteria"'),
      "crew.js надсилає action set-criteria");
    ok(src.includes("data-crit-edit") && src.includes("data-crit-save") && src.includes("data-crit-cancel"),
      "crew.js має кнопки edit/save/cancel критеріїв");
    for (const k of ["crewCritTitle", "crewCritPassed", "crewCritEdit", "crewCritHint", "crewCritSaved",
      "crewCritPass", "crewCritFail", "crewCritUneval", "save", "cancelBtn"])
      ok(src.includes('t("' + k + '"'), "crew.js викликає t(\"" + k + "\")");
    const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    ok(css.includes(".crew-crit") && css.includes(".crew-crit-ed"),
      "styles.css має стилі .crew-crit / .crew-crit-ed");
  }

  console.log("\n==== ПІДСУМОК ====");
  console.log("CHECKS PASSED: " + (checks - failures) + "/" + checks);
  if (failures > 0) {
    console.log("ALL v5.11.103-acceptance TESTS FAILED (" + failures + " fails)");
    process.exitCode = 1;
  } else {
    console.log("ALL v5.11.103-acceptance TESTS PASSED");
  }
} finally {
  try { fs.unlinkSync(TMP); } catch (e) { /* вже видалено */ }
}
