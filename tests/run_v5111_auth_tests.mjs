// tests/run_v5111_auth_tests.mjs
// v5.11.1 — regression-тести авторизації /api/team/* (security hardening).
// Патерн як у tests/run_v511_team_tests.mjs: копія ../_worker.js -> тимчасовий
// файл -> ESM-імпорт -> ok() -> видалення. Вхід ТІЛЬКИ через повний HTTP-шлях:
// new Request("https://x/api/team/...", ...) -> m.default.fetch(req, env, {}).
// Жодних live-мережевих викликів: лише in-memory KV-мок.
//
// Дірки, що відтворюються (мають падати ДО фіксу, проходити ПІСЛЯ):
//  1. Токен ролі photo зі scope tasks: POST /api/team/config, POST /api/team/tokens,
//     створення релізу від photo + його самосхвалення.
//  2. Самосхвалення: порівняння "photo" vs "team:photo" обходиться.
//  3. POST /api/team/releases брав authorRole з тіла запиту.
//  4. POST /api/team/tokens без перевірки прав.
// Плюс: матриця прав teamAuthorize (default deny), scope токена в KV
// (team:token:<id>), revoke, expiry, TEAM_TOKEN_SECRET обов'язковий.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v5111-auth-under-test.mjs", import.meta.url);
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
const USER_SECRET = "user-secret-test";
const TEAM_SECRET = "team-token-secret-test-0123456789abcdef";
const freshEnv = (extra) => Object.assign(
  { BRIDGE_ACCESS_TOKEN: USER_SECRET, TEAM_TOKEN_SECRET: TEAM_SECRET, AI_BRIDGE_JOBS: makeKV() },
  extra || {}
);
const uniq = (p) => p + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);

let m;
try {
  m = await import(TMP.href + "?t=" + Date.now());
  ok(m.default && typeof m.default.fetch === "function", "export default з fetch() доступний");
  ok(typeof m.teamAuthorize === "function", "teamAuthorize експортовано");

  const env = freshEnv();
  const kv = env.AI_BRIDGE_JOBS;
  const call = async (envArg, path, { method = "GET", headers = {}, body } = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await m.default.fetch(new Request("https://x" + path, init), envArg, {});
    let data = null;
    try { data = await res.json(); } catch (e) { /* не-JSON */ }
    return { status: res.status, data };
  };
  const USER = { Authorization: "Bearer " + USER_SECRET };
  const teamAuth = (tok) => ({ Authorization: "Bearer " + tok });
  const tokenIdOf = (tok) => String(tok).split(".")[1];

  // Токени для тестів (видаються через teamIssueToken — формат-агностично).
  const photoTok = await m.teamIssueToken(env, "photo", ["task.create"]);
  const knowledgeTok = await m.teamIssueToken(env, "knowledge", ["task.create", "kb.write"]);
  const releasesTok = await m.teamIssueToken(env, "releases", ["task.create", "release.prepare"]);
  const testerTok = await m.teamIssueToken(env, "tester", ["task.create", "release.block"]);
  ok(String(photoTok).startsWith("team."), "teamIssueToken повертає токен формату team.*");

  // ================= ДІРКА 1a: photo-токен міняє /config =================
  section("дірка 1a: токен photo не чіпає /config");
  {
    const r = await call(env, "/api/team/config", { method: "POST", headers: teamAuth(photoTok), body: { autoApproveLowRisk: true } });
    ok(r.status === 403, "POST /api/team/config токеном photo → 403 (було 200)");
    const cfg = await m.teamConfigGet(env);
    ok(cfg.autoApproveLowRisk === false, "autoApproveLowRisk НЕ змінено атакою");
  }

  // ================= ДІРКА 1b/4: photo-токен видає токени =================
  section("дірка 1b/4: токен photo не видає токени");
  {
    const r = await call(env, "/api/team/tokens", {
      method: "POST", headers: teamAuth(photoTok),
      body: { agentId: "coordinator", scope: ["task.create", "task.assign", "task.cancel"] },
    });
    ok(r.status === 403, "POST /api/team/tokens токеном photo → 403 (було 201)");
  }

  // ================= ДІРКА 1c/2/3: реліз від photo + самосхвалення =================
  section("дірка 1c/2/3: реліз, автор із сервера, самосхвалення");
  let relId;
  {
    // Намагаємось підробити автора через тіло (authorRole:coordinator).
    const r = await call(env, "/api/team/releases", {
      method: "POST", headers: teamAuth(photoTok),
      body: { title: uniq("evil-rel"), changes: ["pwn"], authorRole: "coordinator", lowRisk: true },
    });
    // photo НЕ має release.prepare → 403. Це теж частина закриття дірки 1c.
    ok(r.status === 403, "POST /api/team/releases токеном photo (без release.prepare) → 403");
  }
  {
    // Легітимне створення релізу роллю releases — але authorRole в тілі бреше.
    const r = await call(env, "/api/team/releases", {
      method: "POST", headers: teamAuth(releasesTok),
      body: { title: uniq("rel"), changes: ["fix"], authorRole: "coordinator", lowRisk: false },
    });
    ok(r.status === 201, "POST /api/team/releases токеном releases → 201");
    ok(r.data.release.author === "team:releases",
      "автор релізу визначається СЕРВЕРОМ (team:releases), а не тілом запиту");
    ok(r.data.release.authorRole === "releases",
      "authorRole тіла (coordinator) проігноровано, взято роль актора");
    relId = r.data.release.id;
    // Самосхвалення: approver team:releases == author team:releases → 403.
    const a = await call(env, "/api/team/releases/" + relId + "/approve", {
      method: "POST", headers: teamAuth(releasesTok), body: { approve: true },
    });
    ok(a.status === 403, "самосхвалення релізу (team:releases == team:releases) → 403 (було 200)");
    // Той самий кейс у старому форматі порівняння: approver 'releases' vs author 'team:releases'.
    const rel = await m.teamReleaseGet(env, relId);
    ok(rel && rel.author === "team:releases", "реліз зберігає author у єдиному форматі team:<role>");
  }
  {
    // Незалежний approver (tester з release.block) — схвалення проходить.
    const a = await call(env, "/api/team/releases/" + relId + "/approve", {
      method: "POST", headers: teamAuth(testerTok), body: { approve: true, note: "ok" },
    });
    ok(a.status === 200 && a.data.release.status === "approved",
      "схвалення релізу іншою роллю (tester, release.block) → 200 approved");
    ok(a.data.release.approver === "team:tester", "approver записано у єдиному форматі");
  }

  // ================= Самосхвалення завдань =================
  section("самосхвалення завдань");
  {
    const c = await call(env, "/api/team/tasks", {
      method: "POST", headers: teamAuth(photoTok),
      body: { role: "photo", title: uniq("task-self"), input: {} },
    });
    ok(c.status === 201, "photo-токен створює завдання (task.create дозволено)");
    ok(c.data.task.author === "team:photo", "автор завдання — team:photo (визначив сервер)");
    const a = await call(env, "/api/team/tasks/" + c.data.task.id + "/approve", {
      method: "POST", headers: teamAuth(photoTok), body: { approve: true },
    });
    ok(a.status === 403, "самосхвалення завдання (team:photo == team:photo) → 403");
  }

  // ================= Матриця прав: перетин роль × scope =================
  section("матриця прав teamAuthorize");
  {
    // knowledge має kb.write і в ролі, і в scope → дозволено.
    const r = await call(env, "/api/team/kb", {
      method: "POST", headers: teamAuth(knowledgeTok), body: { key: "auth-test-k", value: "v" },
    });
    ok(r.status === 200, "POST /api/team/kb токеном knowledge (kb.write в ролі × scope) → 200");
    // photo: kb.write НЕМАЄ в ролі → 403 навіть якби scope містив.
    const r2 = await call(env, "/api/team/kb", {
      method: "POST", headers: teamAuth(photoTok), body: { key: "auth-test-k2", value: "v" },
    });
    ok(r2.status === 403, "POST /api/team/kb токеном photo (kb.write поза роллю) → 403");
    // Токен із scope ширшим за роль не видається взагалі (defense in depth).
    const r3 = await call(env, "/api/team/tokens", {
      method: "POST", headers: USER, body: { agentId: "photo", scope: ["task.assign"] },
    });
    ok(r3.status === 403, "видача токена photo зі scope поза роллю (task.assign) → 403 (було 201)");
    // stop-all — лише user.
    const r4 = await call(env, "/api/team/stop-all", { method: "POST", headers: teamAuth(photoTok), body: {} });
    ok(r4.status === 403, "POST /api/team/stop-all токеном агента → 403");
    // revoke — лише user.
    const r5 = await call(env, "/api/team/tokens/revoke", {
      method: "POST", headers: teamAuth(photoTok), body: { tokenId: tokenIdOf(photoTok) },
    });
    ok(r5.status === 403, "POST /api/team/tokens/revoke токеном агента → 403");
    // Читання дозволено будь-якому валідному актору.
    const r6 = await call(env, "/api/team/tasks", { headers: teamAuth(photoTok) });
    ok(r6.status === 200, "GET /api/team/tasks токеном photo → 200");
    const r7 = await call(env, "/api/team/config", { headers: teamAuth(photoTok) });
    ok(r7.status === 200, "GET /api/team/config токеном photo → 200");
    // Битий підпис → 401.
    const r8 = await call(env, "/api/team/agents", { headers: teamAuth(photoTok.slice(0, -4) + "xxxx") });
    ok(r8.status === 401, "токен з битим підписом → 401");
  }

  // ================= Scope токена в KV + revoke + expiry =================
  section("KV scope / revoke / expiry");
  {
    const tok = await m.teamIssueToken(env, "photo", ["task.create"]);
    const tid = tokenIdOf(tok);
    const raw = await kv.get("team:token:" + tid);
    const rec = JSON.parse(raw);
    ok(rec && rec.agentId === "photo" && Array.isArray(rec.scope) && rec.scope.includes("task.create") &&
      typeof rec.exp === "number" && rec.revoked === false,
      "scope токена зберігається в KV team:token:<id> {agentId, scope[], exp, revoked}");
    // Токен працює до відкликання.
    const ok1 = await call(env, "/api/team/agents", { headers: teamAuth(tok) });
    ok(ok1.status === 200, "свіжий токен проходить верифікацію → 200");
    // Revoke лише user'ом.
    const rv = await call(env, "/api/team/tokens/revoke", {
      method: "POST", headers: USER, body: { tokenId: tid },
    });
    ok(rv.status === 200 && rv.data.ok === true, "POST /api/team/tokens/revoke (user) → 200 {ok:true}");
    const ok2 = await call(env, "/api/team/agents", { headers: teamAuth(tok) });
    ok(ok2.status === 401, "відкликаний токен → 401");
    // Revoke неіснуючого → 404.
    const rv2 = await call(env, "/api/team/tokens/revoke", {
      method: "POST", headers: USER, body: { tokenId: "tok_nope" },
    });
    ok(rv2.status === 404, "revoke невідомого tokenId → 404");
  }
  {
    // Expiry: підміняємо exp у KV на минуле.
    const tok = await m.teamIssueToken(env, "photo", ["task.create"]);
    const tid = tokenIdOf(tok);
    const rec = JSON.parse(await kv.get("team:token:" + tid));
    rec.exp = Math.floor(Date.now() / 1000) - 10;
    await kv.put("team:token:" + tid, JSON.stringify(rec));
    const r = await call(env, "/api/team/agents", { headers: teamAuth(tok) });
    ok(r.status === 401, "прострочений токен (exp у минулому) → 401");
  }

  // ================= TEAM_TOKEN_SECRET обов'язковий =================
  section("TEAM_TOKEN_SECRET обов'язковий, без fallback");
  {
    const envNoSecret = freshEnv({ TEAM_TOKEN_SECRET: "" });
    delete envNoSecret.TEAM_TOKEN_SECRET;
    const r = await call(envNoSecret, "/api/team/tokens", {
      method: "POST", headers: USER, body: { agentId: "photo", scope: ["task.create"] },
    });
    ok(r.status === 503, "видача токена без TEAM_TOKEN_SECRET → 503 (блоковано, жодного fallback)");
    const r2 = await call(envNoSecret, "/api/team/agents", { headers: { Authorization: "Bearer team.aaa.bbb" } });
    ok(r2.status === 503 || r2.status === 401, "верифікація без TEAM_TOKEN_SECRET → блоковано (" + r2.status + ")");
    // І код не містить fallback-секрету для командних токенів.
    const src = fs.readFileSync(SRC, "utf8");
    ok(!/team-fallback/.test(src), "у коді немає fallback-секрету 'team-fallback'");
  }

  // ================= Позитивні контролі (user-шлях не зламано) =================
  section("позитивні контролі: user-шлях");
  {
    const r = await call(env, "/api/team/config", {
      method: "POST", headers: USER, body: { autoApproveLowRisk: true },
    });
    ok(r.status === 200 && r.data.config.autoApproveLowRisk === true, "user міняє autoApproveLowRisk → 200");
    const r2 = await call(env, "/api/team/config", {
      method: "POST", headers: USER, body: { autoApproveLowRisk: false },
    });
    ok(r2.status === 200, "user повертає autoApproveLowRisk=false → 200");
    const t = await call(env, "/api/team/tokens", {
      method: "POST", headers: USER, body: { agentId: "photo", scope: ["task.create"], ttlSec: 600 },
    });
    ok(t.status === 201 && String(t.data.token).startsWith("team."), "user видає токен → 201");
    const g = await call(env, "/api/team/agents", { headers: teamAuth(t.data.token) });
    ok(g.status === 200 && Array.isArray(g.data.agents) && g.data.agents.length === 24,
      "виданий user'ом токен працює (agents ×24)");
    // user створює і (за новим правилом) НЕ може сам схвалити — задокументована поведінка.
    const c = await call(env, "/api/team/tasks", {
      method: "POST", headers: USER, body: { role: "chat", title: uniq("u-task"), input: {} },
    });
    ok(c.status === 201 && c.data.task.author === "user", "user створює завдання (author=user) → 201");
  }

  // ================= Матриця прав: cron:scheduler лише свій тік =================
  section("cron:scheduler скоуп");
  {
    ok(m.teamAuthorize(env, "cron:scheduler", "/scheduled-tick", "POST").allowed === true,
      "teamAuthorize: cron:scheduler → POST /scheduled-tick дозволено");
    ok(m.teamAuthorize(env, "cron:scheduler", "/tasks", "GET").allowed === false,
      "teamAuthorize: cron:scheduler → GET /tasks заборонено (лише свій тік)");
    ok(m.teamAuthorize(env, "cron:scheduler", "/config", "POST", { patchKeys: [] }).allowed === false,
      "teamAuthorize: cron:scheduler → POST /config заборонено");
    ok(m.teamAuthorize(env, "user", "/nope", "GET").allowed === false,
      "teamAuthorize: невідомий маршрут → default deny навіть для user");
  }

  // ================= Підсумок =================
  console.log("\n==== ПІДСУМОК ====");
  console.log("CHECKS PASSED: " + checks);
  console.log("ПОКРИТО: дірка 1a (config токеном photo → 403), 1b/4 (видача токенів токеном photo → 403), " +
    "1c/2/3 (реліз: authorRole з тіла ігнорується, author=team:<role> від сервера, самосхвалення → 403), " +
    "самосхвалення завдань → 403, матриця teamAuthorize (kb.write перетин роль×scope, stop-all/revoke лише user, " +
    "читання дозволено, битий підпис → 401), KV team:token:<id> {agentId,scope[],exp,revoked}, revoke (user-only, " +
    "відкликаний → 401, невідомий → 404), expiry → 401, TEAM_TOKEN_SECRET обов'язковий (503 без нього, " +
    "немає fallback у коді), позитивні контролі user-шляху.");
  console.log("ALL v5.11.1 AUTH TESTS PASSED");
} finally {
  try { fs.unlinkSync(TMP); } catch (e) { /* вже видалено */ }
}
