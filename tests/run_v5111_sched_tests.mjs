// tests/run_v5111_sched_tests.mjs
// Надійність команди v5.11.0 (без підняття версії): scheduled у default export,
// ідемпотентний daily review, heartbeat/sweep/ретраї, реальний бюджет,
// stop-all, термінальні переходи, чесні помилки KV.
// Патерн як tests/run_v511_team_tests.mjs: копія ../_worker.js -> тимчасовий
// ESM-імпорт -> ok() -> видалення. Жодних live-мережевих викликів.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v5111-sched-under-test.mjs", import.meta.url);
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
    async delete(k) { map.delete(k); },
    async list({ prefix = "", limit, cursor } = {}) {
      const names = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const cut = typeof limit === "number" && limit >= 0 ? names.slice(0, limit) : names;
      return { keys: cut.map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
// KV, що завжди помиляється — для перевірки, що помилки НЕ маскуються.
function makeBrokenKV() {
  const boom = async () => { throw new Error("KV is down (simulated)"); };
  return { get: boom, put: boom, delete: boom, list: boom };
}
const freshEnv = (extra) => Object.assign({ BRIDGE_ACCESS_TOKEN: "private-test", AI_BRIDGE_JOBS: makeKV() }, extra || {});
const uniq = (p) => p + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function expectThrow(fn, rx, msg) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  const text = String((err && err.message) || "") + " | code=" + String((err && err.code) || "");
  ok(err !== null && rx.test(text), msg + "  [got: " + text.slice(0, 140) + "]");
}

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());
  const kvOf = (env) => env.AI_BRIDGE_JOBS;

  // ================= 1. scheduled у default export =================
  section("scheduled у default export");
  ok(m.default && typeof m.default.scheduled === "function",
    "export default містить scheduled (вимога Cloudflare Cron Triggers)");
  ok(typeof m.scheduled === "function", "named export scheduled існує");

  // ================= 2. Ідемпотентний daily review =================
  section("teamDailyReview: ідемпотентність");
  {
    const env = freshEnv(), kv = kvOf(env);
    const before = (await m.teamTaskList(env)).length;
    const r1 = await m.teamDailyReview(env);
    ok(r1 && typeof r1.created === "number" && r1.created > 0, "перший виклик створює перевірки (" + r1.created + ")");
    const mid = (await m.teamTaskList(env)).length;
    ok(mid > before, "завдання з'явились (" + before + "→" + mid + ")");
    const r2 = await m.teamDailyReview(env);
    ok(r2 && r2.skipped === "already-ran", "другий виклик того ж дня → already-ran");
    const after = (await m.teamTaskList(env)).length;
    ok(after === mid, "другий виклик: 0 нових завдань (" + mid + "==" + after + ")");
    const rep = JSON.parse(await kv.get("team:report:" + todayUtc()));
    ok(rep && rep.date === todayUtc(), "звіт team:report:<дата> існує після першого виклику");
  }
  // Lock зайнято іншим власником → fail-closed, без старту огляду
  {
    const env = freshEnv();
    const lockName = "daily-review:" + todayUtc();
    await m.teamLockAcquire(env, lockName, "other-isolate", 60000);
    const before = (await m.teamTaskList(env)).length;
    const r = await m.teamDailyReview(env);
    ok(r && r.skipped === "locked", "чужий активний lock → skipped:locked (fail-closed)");
    const after = (await m.teamTaskList(env)).length;
    ok(after === before, "із зайнятим lock жодне завдання не стартує");
    await m.teamLockRelease(env, lockName, "other-isolate");
    const r2 = await m.teamDailyReview(env);
    ok(r2 && typeof r2.created === "number", "після release огляд проходить");
  }
  // Прострочений lock не блокує
  {
    const env = freshEnv(), kv = kvOf(env);
    const lockName = "daily-review:" + todayUtc();
    await kv.put("team:lock:" + lockName, JSON.stringify({ owner: "dead-isolate", ts: Date.now() - 3600000, expiresAt: Date.now() - 1000 }));
    const rec = await m.teamLockAcquire(env, lockName, "scheduler", 60000);
    ok(rec && rec.owner === "scheduler", "прострочений lock захоплюється новим власником");
    await m.teamLockRelease(env, lockName, "scheduler");
  }

  // ================= 3. Lock: власник, heartbeat, release =================
  section("teamLock*: семантика");
  {
    const env = freshEnv();
    const nm = uniq("lock");
    const a = await m.teamLockAcquire(env, nm, "owner-a", 60000);
    ok(a.owner === "owner-a" && a.expiresAt > Date.now(), "acquire повертає {owner, expiresAt}");
    await expectThrow(() => m.teamLockAcquire(env, nm, "owner-b", 60000), /LOCKED/i,
      "другий власник → LOCKED");
    await expectThrow(() => m.teamLockRelease(env, nm, "owner-b"), /LOCKED/i,
      "release чужим власником → LOCKED");
    const hb = await m.teamLockHeartbeat(env, nm, "owner-a", 60000);
    ok(hb.expiresAt >= a.expiresAt, "heartbeat продовжує володіння");
    ok(await m.teamLockRelease(env, nm, "owner-a") === true, "release власником → true");
    const b = await m.teamLockAcquire(env, nm, "owner-b", 60000);
    ok(b.owner === "owner-b", "після release lock вільний");
    await m.teamLockRelease(env, nm, "owner-b");
  }

  // ================= 4. Heartbeat / stale-sweep / ретраї =================
  section("heartbeat → stale-sweep → retry → blocked");
  {
    const env = freshEnv(), kv = kvOf(env);
    // heartbeat оновлюється на running-завданні
    const t = await m.teamTaskCreate(env, { role: "chat", title: uniq("hb"), input: {} });
    await m.teamTaskTransition(env, t.id, "start");
    const hb = await m.teamTaskHeartbeat(env, t.id, "worker-1");
    ok(hb.status === "running" && hb.heartbeatAt > 0, "heartbeat ставить heartbeatAt на running");
    await expectThrow(() => m.teamTaskHeartbeat(env, t.id, "worker-2"), /FORBIDDEN/i,
      "heartbeat чужим власником → FORBIDDEN");
    // симулюємо прострочений heartbeat: пишемо напряму в KV
    const raw = JSON.parse(await kv.get("team:task:" + t.id));
    raw.heartbeatAt = Date.now() - 11 * 60 * 1000;
    raw.updatedAt = Date.now() - 11 * 60 * 1000;
    await kv.put("team:task:" + t.id, JSON.stringify(raw));
    const sweep = await m.teamStaleSweep(env);
    ok(sweep.failed.includes(t.id), "stale-sweep помітив прострочений heartbeat");
    const afterSweep = await m.teamTaskGet(env, t.id);
    ok(afterSweep.status === "failed" && afterSweep.failKind === "stale-heartbeat",
      "прострочений heartbeat → failed (failKind=stale-heartbeat)");
    // retry: requeue з backoff
    const rp = await m.teamRetryPass(env);
    ok(rp.requeued.includes(t.id), "retry-pass: перший stale → requeue");
    const rq = await m.teamTaskGet(env, t.id);
    ok(rq.status === "queued" && rq.retries === 1 && rq.nextRetryAt > Date.now(),
      "requeue: queued, retries=1, nextRetryAt у майбутньому (backoff)");
    // due-processing не чіпає завдання, чий backoff ще не настав
    const due1 = await m.teamProcessDueTasks(env);
    ok(!(due1.executed || []).includes(t.id), "due-processing пропускає завдання з майбутнім nextRetryAt");
    const stillQ = await m.teamTaskGet(env, t.id);
    ok(stillQ.status === "queued", "завдання лишається queued до настання backoff");
    // backoff настав → підхоплення сервером (без клієнта)
    const raw2 = JSON.parse(await kv.get("team:task:" + t.id));
    raw2.nextRetryAt = Date.now() - 1000;
    await kv.put("team:task:" + t.id, JSON.stringify(raw2));
    const due2 = await m.teamProcessDueTasks(env);
    ok((due2.executed || []).includes(t.id), "due-processing підхоплює завдання після backoff");
    const doneTask = await m.teamTaskGet(env, t.id);
    ok(doneTask.status === "done", "підхоплене завдання виконалось (done)");
    // вичерпані ретраї → blocked
    const t2 = await m.teamTaskCreate(env, { role: "chat", title: uniq("hb2"), input: {} });
    await m.teamTaskTransition(env, t2.id, "start");
    const raw3 = JSON.parse(await kv.get("team:task:" + t2.id));
    raw3.heartbeatAt = Date.now() - 11 * 60 * 1000;
    raw3.updatedAt = Date.now() - 11 * 60 * 1000;
    raw3.retries = m.TEAM_TASK_MAX_RETRIES;
    await kv.put("team:task:" + t2.id, JSON.stringify(raw3));
    await m.teamStaleSweep(env);
    const rp2 = await m.teamRetryPass(env);
    ok(rp2.blocked.includes(t2.id), "вичерпані ретраї → blocked");
    const bl = await m.teamTaskGet(env, t2.id);
    ok(bl.status === "blocked" && /retries exhausted/i.test(String(bl.result || "")),
      "blocked з причиною про вичерпані ретраї");
    await expectThrow(() => m.teamTaskTransition(env, t2.id, "start"), /./,
      "blocked — термінальний, далі не переходить");
  }

  // ================= 5. Бюджет: реальні ліміти =================
  section("бюджет: резерв → списання → блокування");
  {
    const env = freshEnv();
    // Виконання списує консервативну оцінку, коли runner повертає costUsd=0
    const t = await m.teamTaskCreate(env, { role: "chat", title: uniq("cost"), input: {} });
    const done = await m.teamExecuteTask(env, t.id, "tester");
    ok(done.status === "done", "виконання проходить");
    ok(Number(done.costUsd) > 0, "невідома вартість ≠ 0: списано консервативну оцінку (" + done.costUsd + ")");
    const day = await m.teamBudgetDay(env);
    ok(day.spentUsd >= Number(done.costUsd) && day.reservedUsd === 0,
      "ledger team:budget:<дата>: spent враховано, резерв звільнено");
    // Резерви паралельних завдань сумуються
    const a = await m.teamTaskCreate(env, { role: "chat", title: uniq("res-a"), input: {} });
    const b = await m.teamTaskCreate(env, { role: "chat", title: uniq("res-b"), input: {} });
    await m.teamBudgetReserve(env, a);
    await m.teamBudgetReserve(env, b);
    const day2 = await m.teamBudgetDay(env);
    ok(day2.reservedUsd >= 0.02 - 1e-9, "резерви двох завдань сумуються (" + day2.reservedUsd + ")");
    await m.teamBudgetRelease(env, a);
    await m.teamBudgetRelease(env, b);
    const day3 = await m.teamBudgetDay(env);
    ok(Math.abs(day3.reservedUsd - (day2.reservedUsd - 0.02)) < 1e-9, "release звільняє резерви");
  }
  // Бюджет ролі: вичерпано → blocked + BUDGET
  {
    const env = freshEnv();
    const role = m.TEAM_ROLES.find((r) => r.id === "search");
    const orig = role.budget.maxUsdPerDay;
    role.budget.maxUsdPerDay = 0;
    try {
      const t = await m.teamTaskCreate(env, { role: "search", title: uniq("rb"), input: {} });
      await expectThrow(() => m.teamExecuteTask(env, t.id, "tester"), /BUDGET/i,
        "вичерпаний бюджет ролі → BUDGET");
      const bt = await m.teamTaskGet(env, t.id);
      ok(bt.status === "blocked" && /budget/i.test(String(bt.result || "")),
        "перевищення бюджету ролі → blocked з причиною");
    } finally { role.budget.maxUsdPerDay = orig; }
  }
  // Денний бюджет команди: вичерпано → blocked + BUDGET
  {
    const env = freshEnv();
    await m.teamConfigPut(env, { dailyBudgetUsd: 0.005 }, "user");
    const t = await m.teamTaskCreate(env, { role: "chat", title: uniq("tb"), input: {} });
    await expectThrow(() => m.teamExecuteTask(env, t.id, "tester"), /BUDGET/i,
      "вичерпаний денний бюджет команди → BUDGET");
    const bt = await m.teamTaskGet(env, t.id);
    ok(bt.status === "blocked" && /team daily budget/i.test(String(bt.result || "")),
      "перевищення бюджету команди → blocked з причиною");
    await m.teamConfigPut(env, { dailyBudgetUsd: 2 }, "user");
  }

  // ================= 6. Stop All зупиняє нові дії =================
  section("stop-all: жодних нових дій");
  {
    const env = freshEnv();
    const s1 = await m.teamTaskCreate(env, { role: "chat", title: uniq("sa1"), input: {} });
    await m.teamTaskTransition(env, s1.id, "start");
    const q1 = await m.teamTaskCreate(env, { role: "chat", title: uniq("sa2"), input: {} });
    await m.teamStopAll(env, "tester");
    const cfg = await m.teamConfigGet(env);
    ok(cfg.enabled === false, "stop-all ставить enabled=false");
    await expectThrow(() => m.teamTaskCreate(env, { role: "chat", title: uniq("sa3"), input: {} }), /DISABLED/i,
      "create після stop-all → DISABLED");
    await expectThrow(() => m.teamExecuteTask(env, q1.id, "tester"), /DISABLED/i,
      "execute після stop-all → DISABLED");
    await expectThrow(() => m.teamTaskTransition(env, q1.id, "start"), /DISABLED/i,
      "transition start після stop-all → DISABLED");
    await expectThrow(() => m.teamTaskApprove(env, q1.id, { approve: true, approver: "tester" }), /DISABLED/i,
      "approve після stop-all → DISABLED");
    // Виняток: cancel дозволено навіть при disabled (напрямок «вимкнути»)
    const c = await m.teamTaskTransition(env, q1.id, "cancel", "tester");
    ok(c.status === "cancelled", "cancel дозволено навіть при disabled");
    // Повторне увімкнення відновлює роботу
    await m.teamConfigPut(env, { enabled: true }, "user");
    const t = await m.teamTaskCreate(env, { role: "chat", title: uniq("sa4"), input: {} });
    ok(t.status === "queued", "після enabled=true створення знову працює");
  }

  // ================= 7. cancelled не перезаписується =================
  section("термінальні статуси: виходу немає");
  {
    const env = freshEnv();
    for (const st of ["done", "failed", "cancelled", "blocked"]) {
      const t = await m.teamTaskCreate(env, { role: "search", title: uniq("term-" + st), input: {} });
      const kv = kvOf(env);
      const raw = JSON.parse(await kv.get("team:task:" + t.id));
      raw.status = st; raw.updatedAt = Date.now();
      await kv.put("team:task:" + t.id, JSON.stringify(raw));
      await expectThrow(() => m.teamExecuteTask(env, t.id, "tester"), /TRANSITION/i,
        "execute з " + st + " → TRANSITION (не done)");
      const after = await m.teamTaskGet(env, t.id);
      ok(after.status === st, "статус " + st + " не перезаписано виконавцем");
      await expectThrow(() => m.teamTaskApprove(env, t.id, { approve: true, approver: "tester" }), /TRANSITION/i,
        "approve з " + st + " → TRANSITION");
    }
    // Гонка «пізній виконавець»: завдання скасовано ПІСЛЯ старту виконання.
    // Білий ящик: стартуємо, потім напряму в KV ставимо cancelled (імітація
    // stop-all з іншого ізолята), потім execute має відмовитись, а не писати done.
    const env2 = freshEnv(), kv2 = kvOf(env2);
    const t = await m.teamTaskCreate(env2, { role: "chat", title: uniq("race"), input: {} });
    await m.teamTaskTransition(env2, t.id, "start");
    const raw = JSON.parse(await kv2.get("team:task:" + t.id));
    raw.status = "cancelled"; raw.updatedAt = Date.now();
    await kv2.put("team:task:" + t.id, JSON.stringify(raw));
    await expectThrow(() => m.teamExecuteTask(env2, t.id, "tester"), /TRANSITION/i,
      "пізній виконавець: cancelled → TRANSITION, жодного done");
    const fin = await m.teamTaskGet(env2, t.id);
    ok(fin.status === "cancelled", "cancelled НЕ перезаписано на done пізнім виконавцем");
  }

  // ================= 8. Помилка KV не маскується =================
  section("KV error → помилка назовні");
  {
    const benv = freshEnv({ AI_BRIDGE_JOBS: makeBrokenKV() });
    const title = uniq("kvboom");
    await expectThrow(() => m.teamTaskCreate(benv, { role: "chat", title, input: {} }), /./,
      "create при мертвому KV → помилка (не тихий успіх)");
    // Жодного «успішно збережено» з пам'яті: завдання НЕ має бути в memory-fallback
    const mem = globalThis.__teamMem || new Map();
    const leaked = [...mem.values()].some((v) => v && v.title === title);
    ok(!leaked, "при помилці KV завдання НЕ осіло в in-memory fallback");
    await expectThrow(() => m.teamTaskHeartbeat(benv, "nope", "x"), /./,
      "heartbeat при мертвому KV → помилка");
    await expectThrow(() => m.teamLockAcquire(benv, "x", "y", 5000), /./,
      "lock при мертвому KV → помилка (fail-closed, не LOCKED-ілюзія)");
  }

  // ================= 9. scheduled-tick ендпоінт =================
  section("POST /api/team/scheduled-tick");
  {
    const SECRET = "test-cron-secret-" + Math.random().toString(36).slice(2);
    const env = freshEnv({ AI_BRIDGE_CRON_SECRET: SECRET });
    const call = (auth) => m.handleTeam(
      new Request("https://team.local/api/team/scheduled-tick",
        { method: "POST", headers: auth ? { Authorization: "Bearer " + auth } : {} }),
      env, new URL("https://team.local/api/team/scheduled-tick"));
    let res = await call(SECRET);
    ok(res.status === 200, "валідний cron-секрет → 200");
    const body = await res.json();
    ok(body && body.ok === true && body.tick && body.tick.sweep && body.tick.retry &&
      body.tick.due && body.tick.review,
      "tick повертає {sweep, retry, due, review}");
    ok(body.tick.review && (typeof body.tick.review.created === "number" || body.tick.review.skipped),
      "review виконався або коректно пропущено всередині тіку");
    res = await call("wrong-secret");
    ok(res.status === 401, "невірний секрет без іншої авторизації → 401");
    // Без секрету в env — потрібна звичайна авторизація
    const env2 = freshEnv();
    const res2 = await m.handleTeam(
      new Request("https://team.local/api/team/scheduled-tick", { method: "POST" }),
      env2, new URL("https://team.local/api/team/scheduled-tick"));
    ok(res2.status === 401, "без секрету і без auth → 401");
    ok(m.teamCronSecretOk({ headers: { get: () => "Bearer " + SECRET } }, env) === true,
      "teamCronSecretOk: збіг → true");
    ok(m.teamCronSecretOk({ headers: { get: () => "Bearer nope" } }, env) === false,
      "teamCronSecretOk: незбіг → false");
  }

  // ================= 10. teamScheduledTick: повний цикл =================
  section("teamScheduledTick: sweep+retry+due+review разом");
  {
    const env = freshEnv(), kv = kvOf(env);
    // Зависле running-завдання
    const t = await m.teamTaskCreate(env, { role: "chat", title: uniq("tick-stale"), input: {} });
    await m.teamTaskTransition(env, t.id, "start");
    const raw = JSON.parse(await kv.get("team:task:" + t.id));
    raw.heartbeatAt = Date.now() - 11 * 60 * 1000;
    raw.updatedAt = Date.now() - 11 * 60 * 1000;
    await kv.put("team:task:" + t.id, JSON.stringify(raw));
    const tick = await m.teamScheduledTick(env);
    ok(tick && tick.sweep && tick.retry && tick.due && tick.review, "tick повертає всі 4 фази");
    ok((tick.sweep.failed || []).includes(t.id), "sweep у тіку помітив stale");
    ok((tick.retry.requeued || []).includes(t.id), "retry у тіку переставив у чергу");
    const rq = await m.teamTaskGet(env, t.id);
    ok(rq.status === "queued", "після тіку зависле завдання — queued (не загублено)");
    ok(tick.review && (typeof tick.review.created === "number" || tick.review.skipped === "already-ran"),
      "daily review усередині тіку виконався/пропущено ідемпотентно");
  }

  console.log("\n==== ПІДСУМОК ====");
  console.log("CHECKS PASSED: " + checks);
  console.log("ALL SCHED v5.11.1 TESTS PASSED");
} catch (e) {
  console.error("\nTEST FAILURE:", e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(TMP); } catch (e) {}
}
