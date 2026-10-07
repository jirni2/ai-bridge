// tests/run_v5111_e2e_tests.mjs
// v5.11.1 — E2E-сценарій (§7 специфікації): демонстрація повного циклу
// команди на РЕАЛЬНОМУ дефекті (дірки авторизації /api/team/*, виправлені у v5.11.1).
// Ланцюжок: координатор → дослідник/виконавець (агентні завдання з критеріями)
// → тестувальник → тестовий деплой [BLOCKED: немає Cloudflare credentials]
// → реліз → схвалення user (pending симульовано) → production/smoke [BLOCKED:
// це частина parent-агента, виконує її він] → дефектна зміна НЕ доходить до production.
//
// Чесність середовища: локальний мок-KV, без git (ізольована гілка = запис змін
// + codeRefs у релізі; гіток немає — зафіксовано), без Cloudflare API,
// без реальних саб-агентів (межа задокументована в TEAM_CONTRACT.md).
// Все, що позначено BLOCKED, — НЕ виконувалося, а зафіксовано як неможливе тут.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v5111-e2e-under-test.mjs", import.meta.url);
fs.writeFileSync(TMP, fs.readFileSync(SRC, "utf8"));

let checks = 0, blocked = [];
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  checks++;
  console.log("✓", msg);
}
function markBlocked(stage, reason) {
  blocked.push({ stage, reason });
  console.log("⛔ BLOCKED [" + stage + "]: " + reason);
}
const stage = (n) => console.log("\n—— " + n);

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
  BRIDGE_ACCESS_TOKEN: "test",
  TEAM_TOKEN_SECRET: "test-team-secret",
  CRON_SECRET: "test-cron-secret",
});

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());
  ok(m.default && typeof m.default.fetch === "function", "export default з fetch() доступний");

  // ── STAGE 1. Координатор створює агентне завдання «security»: перевірити закриття дірок
  stage("STAGE 1 — координатор ставить завдання досліднику/виконавцю");
  const env = freshEnv();
  const secTask = await m.teamTaskCreate(env, {
    role: "security",
    title: "Перевірити закриття дірок авторизації /api/team/*",
    kind: "agent",
    author: "team:coordinator",
    criteria: [
      { id: "c1", text: "no secret leak in public settings", expectEvidence: "leak=false" },
      { id: "c2", text: "login rate-limit увімкнено", expectEvidence: "rateLimit=true" },
    ],
  });
  ok(secTask && secTask.kind === "agent" && secTask.status === "queued",
    "завдання security створено (kind=agent, статус queued)");

  // ── STAGE 2. Виконання: security-раннер робить РЕАЛЬНУ перевірку (не заглушку)
  stage("STAGE 2 — виконавець (security) робить реальну перевірку");
  const done = await m.teamExecuteTask(env, secTask.id, "team:coordinator");
  ok(done.status === "done", "security-завдання done: " + JSON.stringify((done.result && done.result.summary) || done.result));
  const ev = done.evidence || [];
  ok(ev.some((e) => String(e).includes("leak=false")), "доказ: leak=false (публічні налаштування не світять секрети)");
  ok(ev.some((e) => String(e).includes("rateLimit=true")), "доказ: rateLimit=true");

  // Додатково: три конкретні дірки реального дефекту — прямо через teamAuthorize (не HTTP-шлях, він покритий 43 auth-тестами)
  const a1 = m.teamAuthorize(env, "team:photo", "/config", "POST", { scope: "tasks" });
  ok(a1 && a1.allowed === false, "дірка 1 закрита: токен photo (scope tasks) НЕ може POST /api/team/config (403)");
  const a2 = m.teamAuthorize(env, "team:photo", "/tokens", "POST", { scope: "tasks" });
  ok(a2 && a2.allowed === false, "дірка 4 закрита: токен НЕ user НЕ може керувати токенами");
  // самосхвалення: approver==author після нормалізації → 403
  const n1 = m.teamNormalizeActor("photo"), n2 = m.teamNormalizeActor("team:photo");
  ok(n1 === n2 && n1 === "team:photo", "дірка 2 закрита: 'photo' і 'team:photo' — одна ідентичність (" + n1 + ")");

  // ── STAGE 3. «Ізольована гілка»: git-репозиторію в робочій копії НЕМАЄ —
  // запис змін + codeRefs у релізі є гілкою. Фіксуємо це чесно.
  stage("STAGE 3 — виконавець готує зміну (ізольована гілка)");
  const changes = [
    "TEAM_ACL: централізована матриця прав (default deny)",
    "teamNormalizeActor: єдина ідентичність team:<roleId>",
    "token scope у KV, revoke, expiry; без TEAM_TOKEN_SECRET → 503",
    "автор записується сервером, не з тіла запиту",
  ];
  const codeRefs = [
    "_worker.js:TEAM_ACL",
    "_worker.js:teamAuthorize",
    "_worker.js:teamNormalizeActor",
    "_worker.js:teamIssueToken/teamVerifyToken",
    "tests/run_v5111_auth_tests.mjs",
  ];
  markBlocked("ізольована гілка git", "git-репозиторію в ~/workspace/audit_bot немає; зміна живе у робочій копії + записана у релізі (changes[]+codeRefs[])");

  // ── STAGE 4. Тестувальник: реальні детерміновані перевірки
  stage("STAGE 4 — тестувальник робить реальні перевірки");
  const testerTask = await m.teamTaskCreate(env, {
    role: "tester",
    title: "Selftest після закриття дірок",
    kind: "agent",
    author: "team:coordinator",
    criteria: [
      { id: "roles24", text: "24 ролі на місці" },
      { id: "kvRoundtrip", text: "kv roundtrip" },
    ],
  });
  const tdone = await m.teamExecuteTask(env, testerTask.id, "team:coordinator");
  ok(tdone.status === "done", "tester-завдання done: " + JSON.stringify((tdone.result && tdone.result.summary) || ""));
  ok((tdone.evidence || []).length > 0, "тестувальник надав реальні докази, не 'manual'");

  // ── STAGE 5. Реліз підготовлено виконавцем; деплой на staging — НЕМОЖЛИВИЙ тут
  stage("STAGE 5 — реліз + тестовий деплой");
  const rel = await m.teamReleaseCreate(env, {
    role: "releases",
    author: "team:releases",
    title: "v5.11.1 — закриття дірок авторизації /api/team/*",
    changes, codeRefs,
  });
  ok(rel.status === "pending", "реліз у pending (чекає схвалення), contentHash=" + String(rel.contentHash).slice(0, 12));
  markBlocked("тестовий деплой (staging)", "немає Cloudflare credentials у цьому середовищі — wrangler deploy виконати нікому; parent-агент робить деплой окремо");
  // Гейт: без схвалення деплой записати НЕМОЖЛИВО
  let threw = null;
  try { await m.teamReleaseMarkDeployed(env, rel.id, { actor: "team:releases", deployRef: "fake" }); }
  catch (e) { threw = e; }
  ok(threw && /approved/i.test(String(threw.message)), "markDeployed без схвалення → відмова: " + String(threw && threw.message).slice(0, 60));

  // ── STAGE 6. Схвалення user (симульовано як pending → тут підтверджено)
  stage("STAGE 6 — схвалення user → deploy → smoke");
  const appr = await m.teamReleaseApprove(env, rel.id, { approver: "user", approve: true, note: "e2e: перевірено, схвалено" });
  ok(appr.status === "approved" && appr.approvedHash === appr.contentHash,
    "user схвалив реліз; approvedHash зафіксовано (" + String(appr.approvedHash).slice(0, 12) + ")");
  // Гейт: deployed — тільки з deployRef (без вигаданих публікацій)
  threw = null;
  try { await m.teamReleaseMarkDeployed(env, rel.id, { actor: "user" }); }
  catch (e) { threw = e; }
  ok(threw && /deployRef/i.test(String(threw.message)), "markDeployed без deployRef → відмова (не можна 'опублікувати' без факту деплою)");
  // deployRef симулює факт деплою, який робить parent-агент (креденшали — у нього)
  const dep = await m.teamReleaseMarkDeployed(env, rel.id, { actor: "user", deployRef: "pages:manual-by-parent (pending)" });
  ok(dep.status === "deployed", "реліз позначено deployed із записом deployRef");
  markBlocked("production deploy", "деплой на Cloudflare виконує parent-агент (потрібні credentials); тут лише запис факту");
  markBlocked("smoke test production", "немає доступу до production з цього середовища; smoke робить parent-агент після деплою");

  // ── STAGE 7. НЕГАТИВНИЙ кейс: дефектна зміна НЕ доходить до production
  stage("STAGE 7 — дефектна зміна не доходить до production");
  const bad = await m.teamReleaseCreate(env, {
    role: "releases", author: "team:releases",
    title: "ДЕФЕКТНА зміна (навмисно, для e2e)", changes: ["broken change"], codeRefs: ["_worker.js:nowhere"],
  });
  const blockedRel = await m.teamReleaseApprove(env, bad.id, { approver: "team:tester", approve: false, note: "e2e: дефект — тести не пройдено" });
  ok(blockedRel.status === "blocked" && blockedRel.blockedReason, "тестувальник заблокував дефектний реліз: " + String(blockedRel.blockedReason).slice(0, 50));
  threw = null;
  try { await m.teamReleaseMarkDeployed(env, bad.id, { actor: "user", deployRef: "x" }); }
  catch (e) { threw = e; }
  ok(threw && /approved/i.test(String(threw.message)), "заблокований реліз НЕ можна позначити deployed (409): " + String(threw && threw.message).slice(0, 50));
  // Виправлення вмісту анулює рішення → знову pending (схвалення «всліпу» неможливе)
  const fixed = await m.teamReleaseUpdate(env, bad.id, { changes: ["fixed change"], codeRefs: ["_worker.js:fixed"], actor: "team:releases" });
  ok(fixed.status === "pending" && fixed.approvedHash === null, "зміна вмісту анулювала рішення → знову pending");
  // Самосхвалення автором — 403
  threw = null;
  try { await m.teamReleaseApprove(env, bad.id, { approver: "team:releases", approve: true }); }
  catch (e) { threw = e; }
  ok(threw && /403|FORBIDDEN/i.test(String((threw && threw.code) || "") + String(threw && threw.message)),
    "самосхвалення автором → 403 (author cannot approve own release)");

  // ── STAGE 8. Звіт команди: 7 категорій
  stage("STAGE 8 — звіт команди (7 категорій)");
  const rep = await m.teamBuildReport(env, { actor: "user" });
  ok(rep && Array.isArray(rep.verified) && Array.isArray(rep.fixed) && Array.isArray(rep.blocked),
    "звіт містить категорії verified/fixed/blocked (+ found/prepared/tested/published)");
  const fixedIds = (rep.fixed || []).map((f) => f.task || f.id || JSON.stringify(f));
  console.log("  fixed:", JSON.stringify(fixedIds).slice(0, 120));
  console.log("  blocked:", JSON.stringify((rep.blocked || []).map((b) => b.task || b.id || b.title)).slice(0, 120));

  console.log("\nE2E-CHECKS PASSED: " + checks);
  console.log("BLOCKED (чесно не виконано, причини вище): " + blocked.length);
} catch (e) {
  console.error("E2E FAILED:", e && e.message);
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(TMP); } catch (_) {}
}
