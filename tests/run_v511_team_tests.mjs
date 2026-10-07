// tests/run_v511_team_tests.mjs
// «Команда агентів» v5.11.0 — повний набір РОБОЧИХ тестів (не заглушки).
// Патерн (як tests/run_tests.mjs): копія ../_worker.js -> унікальний тимчасовий
// файл tests/worker-v511-team-under-test.mjs -> ESM-імпорт -> ok() -> видалення.
// Жодних live-мережевих викликів: лише in-memory KV-мок.
// Контракт: TEAM_CONTRACT.md (24 ролі, team:*-ключі, teamGuard, капи 500/200).
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v511-team-under-test.mjs", import.meta.url);
fs.writeFileSync(TMP, fs.readFileSync(SRC, "utf8"));

let checks = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  checks++;
  console.log("✓", msg);
}
const section = (n) => console.log("\n—— " + n);

// ---------- in-memory KV-мок (get/put/delete/list -> {keys:[{name}]}) ----------
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
const freshEnv = () => ({ BRIDGE_ACCESS_TOKEN: "private-test", AI_BRIDGE_JOBS: makeKV() });
const env = freshEnv();
const kv = env.AI_BRIDGE_JOBS;

async function expectThrow(fn, rx, msg) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  const text = String((err && err.message) || "") + " | code=" + String((err && err.code) || "");
  ok(err !== null && rx.test(text), msg + "  [got: " + text.slice(0, 140) + "]");
}
const uniq = (p) => p + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());

  // ================= 1. Експорти за контрактом =================
  section("експорти");
  ok(Array.isArray(m.TEAM_ROLES), "TEAM_ROLES експортовано як масив");
  for (const n of ["teamConfigGet", "teamConfigPut", "teamTaskCreate", "teamTaskGet",
    "teamTaskList", "teamTaskTransition", "teamTaskApprove", "teamStopAll",
    "teamEventLog", "teamEventList", "teamKbPut", "teamKbGet", "teamKbKeys",
    "teamReleaseCreate", "teamReleaseApprove", "teamGuard", "teamDailyReview",
    "teamMediaCaps", "teamBuildReport", "handleTeam"])
    ok(typeof m[n] === "function", "експортовано функцію: " + n);

  // ================= 2. TEAM_ROLES: 24 ролі =================
  section("TEAM_ROLES");
  const EXPECTED_IDS = ["coordinator", "architect", "chat", "agentplan", "search",
    "knowledge", "photo", "video", "voice", "files", "providers", "jobs", "design",
    "iphone", "backend", "security", "integrations", "workcontroller", "binance",
    "analytics", "tester", "releases", "research", "docs"];
  ok(m.TEAM_ROLES.length === 24, "рівно 24 ролі");
  ok(m.TEAM_ROLES.map((r) => r.id).join(",") === EXPECTED_IDS.join(","),
    "id ролей відповідають контракту (порядок і назви)");
  ok(new Set(m.TEAM_ROLES.map((r) => r.id)).size === 24, "id ролей унікальні");
  for (const r of m.TEAM_ROLES) {
    ok(typeof r.name === "string" && r.name.length > 0 &&
      typeof r.instructions === "string" && r.instructions.length > 0 &&
      Array.isArray(r.tools) && Array.isArray(r.permissions) &&
      Array.isArray(r.triggers) && typeof r.budget?.maxUsdPerDay === "number" &&
      r.success !== undefined && r.success !== null,
      "роль " + r.id + ": id/name/instructions/tools[]/permissions[]/triggers[]/budget{maxUsdPerDay}/success");
  }

  // ================= 3. teamTaskCreate / Get / List / дедуп =================
  section("teamTaskCreate/get/list");
  const t1 = await m.teamTaskCreate(env, { role: "chat", title: uniq("t1"), input: { q: "hello" }, deps: [] });
  ok(t1 && t1.status === "queued", "create → status queued");
  ok(typeof t1.id === "string" && t1.id.length > 0, "create → непорожній id");
  const t1b = await m.teamTaskCreate(env, { role: "chat", title: uniq("t1b"), input: {} });
  ok(t1b.id !== t1.id, "id унікальні між завданнями");
  ok(typeof t1.createdAt === "number" && typeof t1.updatedAt === "number", "create → createdAt/updatedAt");
  ok(t1.role === "chat" && typeof t1.title === "string" && t1.input && t1.input.q === "hello" && Array.isArray(t1.deps),
    "create зберігає role/title/input/deps");
  ok(Array.isArray(t1b.deps) && t1b.deps.length === 0, "deps за замовчуванням []");
  await expectThrow(() => m.teamTaskCreate(env, { role: "chat", title: t1.title, input: {} }),
    /DUP/i, "дедуп: той самий role+title поки перший у queued → DUP");
  await m.teamTaskTransition(env, t1.id, "cancel");
  const t1c = await m.teamTaskCreate(env, { role: "chat", title: t1.title, input: {} });
  ok(t1c && t1c.status === "queued", "після cancel першого — той самий role+title дозволено");

  const tg = await m.teamTaskGet(env, t1c.id);
  ok(tg && tg.id === t1c.id && tg.title === t1c.title, "teamTaskGet повертає завдання за id");
  {
    let threw = false, val = undefined;
    try { val = await m.teamTaskGet(env, "no-such-task-id"); } catch (e) { threw = true; }
    ok(threw || val == null, "teamTaskGet невідомого id → null або помилка");
  }
  const lq = await m.teamTaskList(env, { status: "queued" });
  ok(Array.isArray(lq) && lq.length > 0 && lq.every((t) => t.status === "queued"), "teamTaskList фільтрує за status");
  const lr = await m.teamTaskList(env, { role: "chat" });
  ok(Array.isArray(lr) && lr.length > 0 && lr.every((t) => t.role === "chat"), "teamTaskList фільтрує за role");

  // ================= 4. teamTaskTransition =================
  section("teamTaskTransition");
  const tl = await m.teamTaskCreate(env, { role: "search", title: uniq("life"), input: {} });
  let g = await m.teamTaskTransition(env, tl.id, "start");
  ok(g.status === "running", "queued→running через start");
  g = await m.teamTaskTransition(env, tl.id, "pause");
  ok(g.status === "paused", "running→paused через pause");
  g = await m.teamTaskTransition(env, tl.id, "resume");
  ok(g.status === "running", "paused→running через resume");
  g = await m.teamTaskTransition(env, tl.id, "cancel");
  ok(g.status === "cancelled", "running→cancelled через cancel");
  const tq = await m.teamTaskCreate(env, { role: "search", title: uniq("life-q"), input: {} });
  g = await m.teamTaskTransition(env, tq.id, "cancel");
  ok(g.status === "cancelled", "queued→cancelled через cancel (будь-який активний→cancel)");

  // DEPS: start блокується, поки не всі deps у done
  const dep = await m.teamTaskCreate(env, { role: "chat", title: uniq("dep"), input: {} });
  const child = await m.teamTaskCreate(env, { role: "chat", title: uniq("child"), input: {}, deps: [dep.id] });
  await expectThrow(() => m.teamTaskTransition(env, child.id, "start"), /DEPS/i,
    "start блокується, коли dep ще не в done (DEPS)");
  // білий ящик за контрактом (team:task:<uuid>): позначаємо dep як done
  await kv.put("team:task:" + dep.id, JSON.stringify({ ...dep, status: "done", updatedAt: Date.now() }));
  const childStarted = await m.teamTaskTransition(env, child.id, "start");
  ok(childStarted.status === "running", "start дозволено, коли всі deps у done");
  await kv.put("team:task:" + dep.id, JSON.stringify({ ...dep, status: "failed", updatedAt: Date.now() }));
  const child2 = await m.teamTaskCreate(env, { role: "chat", title: uniq("child2"), input: {}, deps: [dep.id] });
  await expectThrow(() => m.teamTaskTransition(env, child2.id, "start"), /DEPS/i,
    "start блокується, коли dep у failed (DEPS)");

  // Термінальні статуси далі не переходять
  for (const st of ["done", "failed", "cancelled"]) {
    const tt = await m.teamTaskCreate(env, { role: "search", title: uniq("term-" + st), input: {} });
    await kv.put("team:task:" + tt.id, JSON.stringify({ ...tt, status: st, updatedAt: Date.now() }));
    await expectThrow(() => m.teamTaskTransition(env, tt.id, "start"), /./,
      "термінальний статус " + st + " далі не переходить (помилка)");
  }
  // Невідома дія не повинна псувати стан
  const tu = await m.teamTaskCreate(env, { role: "search", title: uniq("unknown-act"), input: {} });
  try { await m.teamTaskTransition(env, tu.id, "definitely-not-an-action"); } catch (e) { /* допустимо */ }
  const gu = await m.teamTaskGet(env, tu.id);
  ok(gu.status === "queued", "невідома дія не псує стан (завдання лишається queued)");

  // ================= 5. teamTaskApprove =================
  section("teamTaskApprove");
  const ta = await m.teamTaskCreate(env, { role: "tester", title: uniq("approve"), input: {} });
  const other = (ta.author || "") === "reviewer-1" ? "reviewer-2" : "reviewer-1";
  await m.teamTaskApprove(env, ta.id, { approve: true, approver: other });
  const taAfter = await m.teamTaskGet(env, ta.id);
  ok(taAfter && taAfter.approver === other, "approve іншим approver проходить (approver записано)");
  const ta2 = await m.teamTaskCreate(env, { role: "tester", title: uniq("approve2"), input: {} });
  await expectThrow(() => m.teamTaskApprove(env, ta2.id, { approve: true, approver: ta2.author }),
    /FORBIDDEN/i, "approver==author → FORBIDDEN");

  // ================= 6. teamGuard =================
  section("teamGuard");
  const FORBIDDEN_ACTIONS = ["budget.increase", "security.weaken", "prod.data.delete",
    "trade.limits.change", "trade.live.activate"];
  for (const a of FORBIDDEN_ACTIONS) {
    const r = await m.teamGuard(env, { actor: "coordinator", action: a });
    ok(r && r.allowed === false, "guard: actor!=user, action=" + a + " → denied");
  }
  for (const a of ["budget.increase", "trade.live.activate"]) {
    const r = await m.teamGuard(env, { actor: "user", action: a });
    ok(r && r.allowed === true, "guard: actor==user, action=" + a + " → allowed");
  }
  const rBenign = await m.teamGuard(env, { actor: "coordinator", action: "task.create" });
  ok(rBenign && rBenign.allowed === true, "guard: незаборонена дія агента → allowed");

  // ================= 7. teamEventLog: маскування секретів =================
  section("teamEventLog/маскування");
  // Сигнатура бекенда: teamEventLog(env, kind, actor, msg) — позиційні аргументи.
  const TOKEN = "sk-abc123def456ghi789jkl012mno345";
  await m.teamEventLog(env, "unit-test", "tester", "rotating provider key " + TOKEN + " after leak");
  await m.teamEventLog(env, "unit-test", "tester", "plain heartbeat ok");
  const events = await m.teamEventList(env);
  ok(Array.isArray(events) && events.length >= 2, "події записуються і читаються через teamEventList");
  const dump = JSON.stringify(events);
  ok(!dump.includes(TOKEN), "секретоподібний токен замасковано (немає у відкритому вигляді)");
  ok(!dump.includes("sk-abc123"), "префікс токена теж відсутній у списку подій");
  ok(dump.includes("[redacted:possible-secret]"), "замасковане повідомлення позначено [redacted:possible-secret]");
  ok(dump.includes("plain heartbeat ok"), "звичайне повідомлення зберігається як є");

  // ================= 8. Симуляція: вичерпаний бюджет → BUDGET =================
  // Бюджет перевіряється в teamExecuteTask (експортовано): spent+0.01 > maxUsdPerDay → BUDGET.
  section("симуляція BUDGET");
  const budgetRole = m.TEAM_ROLES.find((r) => r.id === "search");
  const origMax = budgetRole.budget.maxUsdPerDay;
  budgetRole.budget.maxUsdPerDay = 0;
  try {
    const bt = await m.teamTaskCreate(env, { role: "search", title: uniq("budget"), input: {} });
    await expectThrow(() => m.teamExecuteTask(env, bt.id, "tester"), /BUDGET/i,
      "роль з вичерпаним бюджетом не виконується (BUDGET)");
  } finally {
    budgetRole.budget.maxUsdPerDay = origMax;
  }
  ok(budgetRole.budget.maxUsdPerDay === origMax, "бюджет ролі відновлено після симуляції");
  const btOk = await m.teamTaskCreate(env, { role: "search", title: uniq("budget-ok"), input: {} });
  const btDone = await m.teamExecuteTask(env, btOk.id, "tester");
  ok(btDone.status === "done", "з відновленим бюджетом виконання проходить (позитивний контроль)");

  // ================= 9. Симуляція: таймаут → failed =================
  // Механізм бекенда: coordinator-ранер помічає завдання "running" без heartbeat 30+ хв
  // як failed ("stale: no heartbeat 30m"); також withDeadline(25s) у teamExecuteTask.
  section("симуляція timeout");
  const stale = await m.teamTaskCreate(env, { role: "jobs", title: uniq("stale"), input: {} });
  await m.teamTaskTransition(env, stale.id, "start");
  await kv.put("team:task:" + stale.id, JSON.stringify({ ...stale, status: "running", updatedAt: Date.now() - 31 * 60 * 1000 }));
  const sweep = await m.teamTaskCreate(env, { role: "coordinator", title: uniq("sweep"), input: {} });
  const sweepRes = await m.teamExecuteTask(env, sweep.id, "tester");
  ok(sweepRes.status === "done", "coordinator-виконання (sweep) проходить");
  const staleAfter = await m.teamTaskGet(env, stale.id);
  ok(staleAfter.status === "failed" && /stale/i.test(String(staleAfter.result || "")),
    "таймаут (30хв без heartbeat) помічає зависле завдання failed");

  // ================= 10. handleTeam smoke =================
  section("handleTeam smoke");
  // Фактична сигнатура: handleTeam(req, env, url). Всупереч припущенню завдання,
  // handleTeam САМ перевіряє auth через authOK (fetch-роутер робить це окремо):
  // без заголовка → 401. Документуємо і далі працюємо із заголовком.
  const AUTH = { Authorization: "Bearer private-test" };
  const teamUrl = (p) => new URL("https://team.local" + p);
  const callTeam = (path, init) => m.handleTeam(new Request("https://team.local" + path, init), env, teamUrl(path));
  let res = await callTeam("/api/team/agents");
  ok(res.status === 401, "без Authorization → 401 (handleTeam сам вимагає auth; задокументовано)");
  res = await callTeam("/api/team/agents", { headers: AUTH });
  console.log("NOTE: handleTeam викликано напряму з Request, далі — із заголовком Authorization: Bearer private-test");
  ok(res.status === 200, "GET /api/team/agents → 200");
  const ab = await res.json();
  ok(ab && typeof ab.version !== "undefined", "agents: поле version присутнє");
  ok(Array.isArray(ab.agents) && ab.agents.length === 24, "agents: рівно 24 агенти");
  ok(ab.agents.every((a) => a && a.id && typeof a.status === "string"), "agents: у кожного є id і status");

  res = await callTeam("/api/team/media", { headers: AUTH });
  ok(res.status === 200, "GET /api/team/media → 200");
  const mb = await res.json();
  ok(mb && mb.photo && mb.photo.status === "not_connected", "media через HTTP: photo not_connected");

  const httpTitle = uniq("http-task");
  const postOpts = (body) => ({ method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  res = await callTeam("/api/team/tasks", postOpts({ role: "chat", title: httpTitle, input: {} }));
  ok(res.status === 201, "POST /api/team/tasks → 201");
  const created = await res.json();
  ok(created && created.task && created.task.status === "queued", "POST /api/team/tasks повертає queued-завдання");
  res = await callTeam("/api/team/tasks", postOpts({ role: "chat", title: httpTitle }));
  ok(res.status === 409, "POST /api/team/tasks дублікат role+title → 409");
  res = await callTeam("/api/team/tasks?status=queued", { headers: AUTH });
  ok(res.status === 200, "GET /api/team/tasks?status= → 200");
  res = await callTeam("/api/team/report", { headers: AUTH });
  ok(res.status === 200, "GET /api/team/report → 200");

  // ================= 11. teamDailyReview: ідемпотентність =================
  section("teamDailyReview");
  const tasksBefore = (await m.teamTaskList(env)).length;
  await m.teamDailyReview(env);
  const repKeys1 = (await kv.list({ prefix: "team:report:" })).keys.map((k) => k.name);
  ok(repKeys1.length >= 1, "перший виклик створює звіт team:report:<дата>");
  const rep = JSON.parse(await kv.get(repKeys1[repKeys1.length - 1]));
  ok(rep && typeof rep.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rep.date) &&
    Array.isArray(rep.found) && Array.isArray(rep.fixed) && Array.isArray(rep.verified) &&
    Array.isArray(rep.published) && Array.isArray(rep.blocked) && typeof rep.spentUsd === "number",
    "звіт має поля date/found/fixed/verified/published/blocked/spentUsd");
  const tasksAfter1 = (await m.teamTaskList(env)).length;
  ok(tasksAfter1 > tasksBefore, "перший виклик створює завдання (" + tasksBefore + "→" + tasksAfter1 + ")");
  await m.teamDailyReview(env);
  const repKeys2 = (await kv.list({ prefix: "team:report:" })).keys.map((k) => k.name);
  const tasksAfter2 = (await m.teamTaskList(env)).length;
  ok(repKeys2.length === repKeys1.length, "другий виклик того ж дня: без дублікатів звіту");
  ok(tasksAfter2 === tasksAfter1, "другий виклик того ж дня: 0 нових завдань");
  const rep2 = JSON.parse(await kv.get(repKeys2[repKeys2.length - 1]));
  ok(rep2.date === rep.date, "той самий звіт (дата збігається)");

  // ================= 12. teamStopAll =================
  section("teamStopAll");
  const s1 = await m.teamTaskCreate(env, { role: "chat", title: uniq("stop1"), input: {} });
  await m.teamTaskTransition(env, s1.id, "start");
  const s2 = await m.teamTaskCreate(env, { role: "chat", title: uniq("stop2"), input: {} });
  await m.teamTaskTransition(env, s2.id, "start");
  await m.teamTaskTransition(env, s2.id, "pause");
  const stoppedRaw = await m.teamStopAll(env);
  const stoppedN = typeof stoppedRaw === "number" ? stoppedRaw : stoppedRaw && stoppedRaw.stopped;
  ok(typeof stoppedN === "number" && stoppedN >= 24, "teamStopAll повертає кількість (>=24): " + stoppedN);
  const g1 = await m.teamTaskGet(env, s1.id);
  ok(g1.status === "cancelled", "running-завдання → cancelled");
  const g2 = await m.teamTaskGet(env, s2.id);
  ok(g2.status === "cancelled", "paused-завдання → cancelled");
  res = await callTeam("/api/team/agents", { headers: AUTH });
  const ab2 = await res.json();
  ok(res.status === 200 && ab2.agents.length === 24 && ab2.agents.every((a) => a.status === "stopped"),
    "всі 24 агенти → status stopped");
  // stopAll вимикає команду (config.enabled=false) — перевіряємо цей побічний ефект
  const cfgAfterStop = await m.teamConfigGet(env);
  ok(cfgAfterStop.enabled === false, "stopAll вимикає команду (config.enabled=false)");

  // ================= 13. teamReleaseCreate / teamReleaseApprove =================
  section("releases");
  const rel = await m.teamReleaseCreate(env, { title: uniq("v5.11.0-rc"), changes: ["team subsystem", "tests"], authorRole: "backend" });
  ok(rel && rel.id && rel.status === "pending", "реліз створюється зі статусом pending");
  await expectThrow(() => m.teamReleaseApprove(env, rel.id, { approve: true, approver: "backend" }),
    /FORBIDDEN/i, "approver==authorRole → FORBIDDEN");
  const approved = await m.teamReleaseApprove(env, rel.id, { approve: true, approver: "coordinator" });
  ok(approved && approved.status === "approved", "інший approver → approved");
  const rel2 = await m.teamReleaseCreate(env, { title: uniq("v5.11.0-rc2"), changes: ["x"], authorRole: "backend" });
  const rejected = await m.teamReleaseApprove(env, rel2.id, { approve: false, approver: "coordinator" });
  ok(rejected && rejected.status === "rejected", "approve:false → rejected");

  // ================= 14. teamMediaCaps: чесна звітність (ban Workers AI знято 2026-10-01) =================
  section("teamMediaCaps");
  const caps = await m.teamMediaCaps(env);
  ok(caps && caps.photo && caps.photo.status === "not_connected", "photo.status == not_connected без біндинга AI");
  ok(caps && caps.video && caps.video.status === "not_connected", "video.status == not_connected (відеомоделей у Workers AI немає)");
  const capsText = JSON.stringify(caps);
  ok(/workers ai/i.test(capsText), "у відповіді згадується Workers AI як дозволений шлях (заборону знято)");
  ok(typeof caps.photo.needs === "string" && caps.photo.needs.length > 10,
    "photo.needs описує потрібну інфраструктуру");
  ok(typeof caps.video.needs === "string" && caps.video.needs.length > 10,
    "video.needs описує потрібну інфраструктуру");
  // З біндингом AI фото-рушій чесно рапортує готовність через Workers AI
  const capsReady = await m.teamMediaCaps({ ...env, AI: { run: async () => ({ image: "AAA=" }) } });
  ok(capsReady && capsReady.photo && capsReady.photo.status === "ready_via_workers_ai",
    "photo.status == ready_via_workers_ai з біндингом AI");
  ok(capsReady.photo.engine && /cloudflare-workers-ai/.test(capsReady.photo.engine),
    "photo.engine називає cloudflare-workers-ai");
  ok(capsReady.video.status === "not_connected",
    "video лишається not_connected навіть з біндингом AI (відеомоделей немає)");

  // ================= 15. teamConfigGet / teamConfigPut =================
  section("config");
  const cfg = await m.teamConfigGet(env);
  ok(cfg && typeof cfg.enabled === "boolean" && typeof cfg.autoApproveLowRisk === "boolean" &&
    typeof cfg.dailyBudgetUsd === "number" && typeof cfg.scheduleNote === "string",
    "config має поля enabled/autoApproveLowRisk/dailyBudgetUsd/scheduleNote");
  await m.teamConfigPut(env, { scheduleNote: "unit-note" });
  const cfg2 = await m.teamConfigGet(env);
  ok(cfg2.scheduleNote === "unit-note", "teamConfigPut оновлює поле (roundtrip)");
  // teamConfigPut(env, patch, actor): підвищення dailyBudgetUsd через actor!="user" → FORBIDDEN
  const curBudget = cfg2.dailyBudgetUsd;
  await expectThrow(() => m.teamConfigPut(env, { dailyBudgetUsd: curBudget + 10 }, "coordinator"),
    /FORBIDDEN/i, "підвищення dailyBudgetUsd через actor!=user → FORBIDDEN");
  const cfgUp = await m.teamConfigPut(env, { dailyBudgetUsd: curBudget + 10 }, "user");
  ok(cfgUp.dailyBudgetUsd === curBudget + 10, "actor==user може підвищувати dailyBudgetUsd");
  const cfgDown = await m.teamConfigPut(env, { dailyBudgetUsd: curBudget }, "coordinator");
  ok(cfgDown.dailyBudgetUsd === curBudget, "зниження dailyBudgetUsd агентом дозволено (блокують лише підвищення)");

  // ================= 16. teamKbPut / Get / Keys =================
  section("kb");
  // Сигнатура бекенда: teamKbPut(env, key, value, source) — позиційні аргументи.
  await m.teamKbPut(env, "unit-kb-1", { a: 1 }, "unit-test");
  const kbv = await m.teamKbGet(env, "unit-kb-1");
  ok(kbv && (kbv.value?.a === 1 || kbv.a === 1), "kb put/get roundtrip");
  const kbk = await m.teamKbKeys(env);
  ok(Array.isArray(kbk) && kbk.includes("unit-kb-1"), "teamKbKeys містить ключ");

  // ================= 17. teamBuildReport =================
  section("teamBuildReport");
  // Сигнатура: teamBuildReport(env, date) — дату треба передавати явно (UTC, як teamToday).
  const todayUtc = new Date().toISOString().slice(0, 10);
  const br = await m.teamBuildReport(env, todayUtc);
  ok(br && typeof br.date === "string" && Array.isArray(br.found) && Array.isArray(br.fixed) &&
    Array.isArray(br.verified) && Array.isArray(br.published) && Array.isArray(br.blocked) &&
    typeof br.spentUsd === "number", "teamBuildReport повертає звіт з усіма полями контракту");

  // ================= 18. Капи індексів: 500 / 200 =================
  section("index caps");
  const env2 = freshEnv();
  for (let i = 0; i < 505; i++) {
    await m.teamTaskCreate(env2, { role: "chat", title: "cap-task-" + i, input: {} });
  }
  const allTasks = await m.teamTaskList(env2);
  ok(allTasks.length === 500, "team:tasks:index обрізається до 500 (маємо " + allTasks.length + ")");
  ok(allTasks.some((t) => t.title === "cap-task-504"), "обрізаються саме старі (найновіше збережено)");
  for (let i = 0; i < 205; i++) {
    await m.teamEventLog(env2, "cap", "t", "event " + i);
  }
  // teamEventList(env, limit): дефолт 50, максимум 200 — передаємо великий ліміт
  const allEvents = await m.teamEventList(env2, 500);
  ok(allEvents.length === 200, "team:events обрізається до 200 (маємо " + allEvents.length + ")");

  // ================= Підсумок =================
  console.log("\n==== ПІДСУМОК ====");
  console.log("CHECKS PASSED: " + checks);
  console.log("ПОКРИТО: експорти(21), TEAM_ROLES структура(27), create/дедуп(DUP)/get/list(фільтри), " +
    "transitions start/pause/resume/cancel + DEPS (queued/failed dep) + термінальні + невідома дія, " +
    "approve/FORBIDDEN, teamGuard(8), маскування секретів ([redacted:possible-secret]), " +
    "BUDGET-симуляція через teamExecuteTask + позитивний контроль, timeout-симуляція (stale-sweep 30хв → failed), " +
    "handleTeam smoke (401 без auth → 200 із Bearer; agents×24/media/tasks 201/409/report), " +
    "dailyReview-ідемпотентність (звіт + 0 дублів), stopAll (24 stopped, running/paused → cancelled, enabled=false), " +
    "releases pending/FORBIDDEN/approved/rejected, mediaCaps not_connected без workers-ai, " +
    "config (поля, roundtrip, FORBIDDEN на підвищення бюджету не-юзером), kb, buildReport, капи 500/200.");
  console.log("НЕ ПОКРИТО (свідомо):");
  console.log(" - create з невідомою роллю → NOT_FOUND/404: спостережено в бекенді, але контракт коду не визначає;");
  console.log(" - повний мапінг HTTP-кодів на всіх /api/team/* (smoke лише ключових: agents/media/tasks/report);");
  console.log(" - справжній 25s-таймаут withDeadline у teamExecuteTask: надто повільно для юніт-тесту;");
  console.log(" - scheduled()/cron-інтеграція teamDailyReview і team:lock:daily-review між ізолятами;");
  console.log(" - teamIssueToken/teamVerifyToken: поза контрактом v5.11.0.");
  console.log("ВІДХИЛЕННЯ ВІД ПРИПУЩЕНЬ ЗАВДАННЯ (задокументовано тестами):");
  console.log(" - handleTeam(req, env, url): третій аргумент url обов'язковий; handleTeam САМ робить authOK → 401 без заголовка;");
  console.log(" - teamEventLog(env, kind, actor, msg) і teamKbPut(env, key, value, source) — позиційні сигнатури;");
  console.log(" - BUDGET перевіряється в teamExecuteTask (не в transition); teamStopAll повертає {stopped:n} і ставить enabled=false;");
  console.log(" - teamTaskApprove ставить завданню done/failed; teamEventList(env, limit) — дефолт 50, макс 200.");
  console.log("ALL TEAM v5.11.0 TESTS PASSED");
} finally {
  try { fs.unlinkSync(TMP); } catch (e) { /* вже видалено раннером */ }
}
