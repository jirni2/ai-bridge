// tests/run_v5111_exec_tests.mjs
// «Команда агентів» v5.11.1-exec — чесне агентне виконання (kind:"agent").
// Патерн як tests/run_v511_team_tests.mjs: копія ../_worker.js -> тимчасовий
// файл -> ESM-імпорт -> ok() -> видалення. Жодних live-мережевих викликів.
// Покриває: kind diagnostic/agent; гейт done (критерії pass + докази);
// evidence "manual" не дає done; делегування parentId/waiting/teamProcessWaiting;
// blocked замість фейкового done; 7 категорій звіту; contentHash релізів і
// анулювання схвалення; блокування випуску тестувальником; deployRef.
import fs from "node:fs";

const SRC = new URL("../_worker.js", import.meta.url);
const TMP = new URL("./worker-v5111-exec-under-test.mjs", import.meta.url);
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
const freshEnv = () => ({ BRIDGE_ACCESS_TOKEN: "private-test", AI_BRIDGE_JOBS: makeKV() });
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

  // ================= 1. kind: diagnostic default / agent / валідація =================
  section("kind");
  {
    const env = freshEnv();
    const d = await m.teamTaskCreate(env, { role: "chat", title: uniq("k-diag"), input: {} });
    ok(d.kind === "diagnostic", "kind за замовчуванням = diagnostic (існуюча поведінка не зламана)");
    ok(Array.isArray(d.criteria) && d.criteria.length === 0, "criteria за замовчуванням []");
    ok(d.parentId === null && d.waitingFor === null, "parentId/waitingFor за замовчуванням null");
    const a = await m.teamTaskCreate(env, {
      role: "tester", title: uniq("k-agent"), kind: "agent", input: {},
      criteria: [{ id: "c1", text: "перший", expectEvidence: "x" }, "другий рядком"],
    });
    ok(a.kind === "agent", "kind:'agent' зберігається");
    ok(a.criteria.length === 2 && a.criteria[0].id === "c1" && a.criteria[0].expectEvidence === "x" &&
      a.criteria[1].id === "c2" && typeof a.criteria[1].text === "string",
      "criteria нормалізуються в [{id,text,expectEvidence}]");
    await expectThrow(() => m.teamTaskCreate(env, { role: "chat", title: uniq("k-bad"), kind: "bogus" }),
      /BAD/i, "невідомий kind → BAD");
    await expectThrow(() => m.teamTaskCreate(env, { role: "chat", title: uniq("k-noparent"), parentId: "task_nope" }),
      /NOT_FOUND/i, "parentId на неіснуюче завдання → NOT_FOUND");
    const dd = await m.teamExecuteTask(env, d.id, "tester");
    ok(dd.status === "done" && dd.kind === "diagnostic", "diagnostic виконується старим шляхом (done без критеріїв)");
  }

  // ================= 2. Гейт: критерії pass + докази → done =================
  section("gate: all pass + evidence → done");
  {
    const env = freshEnv();
    const t = await m.teamTaskCreate(env, {
      role: "tester", title: uniq("gate-ok"), kind: "agent",
      input: { assertions: [{ id: "versionFormat", check: "versionFormat" }, { id: "roles24", check: "roles24" }] },
      criteria: [{ id: "versionFormat", text: "формат версії коректний" }, { id: "roles24", text: "ролей 24" }],
    });
    const done = await m.teamExecuteTask(env, t.id, "tester");
    ok(done.status === "done", "всі критерії pass + докази → done");
    ok(done.result && Array.isArray(done.result.criteriaChecks) && done.result.criteriaChecks.length === 2 &&
      done.result.criteriaChecks.every((c) => c.verdict === "pass"),
      "result.criteriaChecks: 2/2 pass");
    ok(Array.isArray(done.evidence) && done.evidence.length > 0, "докази збережено в task.evidence");
    ok(Array.isArray(done.result.testResults) && done.result.testResults.length === 2, "testResults структуровано");
  }

  // ================= 3. Один критерій fail → failed (не done) =================
  section("gate: one fail → failed");
  {
    const env = freshEnv();
    const t = await m.teamTaskCreate(env, {
      role: "tester", title: uniq("gate-fail"), kind: "agent",
      input: { assertions: [{ id: "versionFormat", check: "versionFormat" }] },
      criteria: [{ id: "versionFormat", text: "ok" }, { id: "nope", text: "немає такої перевірки" }],
    });
    const r = await m.teamExecuteTask(env, t.id, "tester");
    ok(r.status === "failed", "один критерій без вердикту → failed, а не done");
    ok(r.result.criteriaChecks.find((c) => c.id === "nope").verdict === "fail",
      "неоцінений критерій має verdict fail");
  }

  // ================= 4. done без доказів неможливий; «manual» не зараховується =================
  section("gate: no evidence / manual → never done");
  {
    const env = freshEnv(), kv = env.AI_BRIDGE_JOBS;
    // Білий ящик: дитина «виконана» з evidence ["manual"] і pass-вердиктом (антипатерн).
    const child = await m.teamTaskCreate(env, { role: "tester", title: uniq("mchild"), kind: "agent" });
    await kv.put("team:task:" + child.id, JSON.stringify({
      ...child, status: "done", evidence: ["manual"],
      result: { summary: "делеговано", files: [], changes: [], evidence: ["manual"], testResults: [],
        criteriaChecks: [{ id: "c1", text: "t", verdict: "pass", note: "" }] },
      updatedAt: Date.now(),
    }));
    const parent = await m.teamTaskCreate(env,
      { role: "coordinator", title: uniq("mparent"), kind: "agent", criteria: [{ id: "c1", text: "t" }] });
    await kv.put("team:task:" + parent.id, JSON.stringify({
      ...parent, status: "waiting", waitingFor: child.id, updatedAt: Date.now(),
    }));
    const res = await m.teamProcessWaiting(env);
    ok(Array.isArray(res) && res.length === 1, "teamProcessWaiting розібрав одного waiting-батька");
    const p2 = await m.teamTaskGet(env, parent.id);
    ok(p2.status === "failed", "evidence ['manual'] вирізано → доказів 0 → done НЕМОЖЛИВИЙ (failed)");
    ok(!JSON.stringify(p2.evidence).includes("manual"), "заглушка 'manual' не потрапила в evidence");
    // teamEvaluateCriteria напряму: маркер у заглушці не рятує без реальних доказів
    const evaled = m.teamEvaluateCriteria([{ id: "c1", text: "t", expectEvidence: "roundtrip=ok" }],
      { evidence: ["roundtrip=ok"], criteriaChecks: [] });
    ok(evaled[0].verdict === "pass", "expectEvidence: маркер у реальних доказах → pass");
    const evaled2 = m.teamEvaluateCriteria([{ id: "c1", text: "t" }], { evidence: ["щось"], criteriaChecks: [] });
    ok(evaled2[0].verdict === "fail", "критерій без маркера і без вердикту раннера → fail");
  }

  // ================= 5. Делегування: waiting → child → processWaiting → done =================
  section("delegation");
  {
    const env = freshEnv();
    const parent = await m.teamTaskCreate(env, {
      role: "coordinator", title: uniq("deleg-parent"), kind: "agent",
      input: { op: "delegate", delegation: {
        role: "tester", title: uniq("deleg-child"),
        input: { assertions: [{ id: "versionFormat", check: "versionFormat" }] },
        criteria: [{ id: "versionFormat", text: "формат версії" }],
        reason: "потрібна незалежна перевірка",
      } },
    });
    const pw = await m.teamExecuteTask(env, parent.id, "coordinator");
    ok(pw.status === "waiting", "батько після делегування → waiting (не done)");
    ok(typeof pw.waitingFor === "string" && pw.waitingFor.length > 0, "waitingFor вказує на дочірнє");
    const child = await m.teamTaskGet(env, pw.waitingFor);
    ok(child && child.parentId === parent.id, "дочірнє має parentId батька");
    ok(child.kind === "agent" && child.status === "queued", "дочірнє: kind agent, статус queued");
    const still = await m.teamProcessWaiting(env);
    ok(still.length === 0, "поки дитина не done — батько лишається waiting (0 розібрано)");
    const pw2 = await m.teamTaskGet(env, parent.id);
    ok(pw2.status === "waiting", "батько досі waiting");
    const cd = await m.teamExecuteTask(env, child.id, "tester");
    ok(cd.status === "done", "дочірнє виконано → done");
    const res = await m.teamProcessWaiting(env);
    ok(res.length === 1 && res[0].status === "done", "teamProcessWaiting: батько → done після дитини");
    const pd = await m.teamTaskGet(env, parent.id);
    ok(pd.status === "done", "батько done (вердикт успадковано від дитини)");
    ok(pd.result.criteriaChecks.length === 1 && pd.result.criteriaChecks[0].verdict === "pass",
      "критерії батька — pass (успадковано за id)");
    ok(pd.evidence.length > 0 && pd.evidence.every((e) => e.includes(child.id)),
      "докази батька — з дитини, з позначкою джерела");
    ok(pd.result.summary.includes("delegation complete via"), "summary фіксує делегування");
  }

  // ================= 6. Делегування в невідому роль → failed =================
  section("delegation to unknown role → failed");
  {
    const env = freshEnv();
    const parent = await m.teamTaskCreate(env, {
      role: "coordinator", title: uniq("deleg-bad"), kind: "agent",
      input: { op: "delegate", delegation: { role: "nope", title: "x" } },
    });
    const r = await m.teamExecuteTask(env, parent.id, "coordinator");
    ok(r.status === "failed", "делегування в невідому роль → failed (не waiting, не done)");
    ok(/unknown role/i.test(r.result.summary), "причина зафіксована");
  }

  // ================= 7. Дитина blocked → батько blocked; дитина failed → батько failed =================
  section("delegation: child blocked/failed propagates");
  {
    const env = freshEnv(), kv = env.AI_BRIDGE_JOBS;
    const mkWaiting = async (childPatch) => {
      const ch = await m.teamTaskCreate(env, { role: "research", title: uniq("wc"), kind: "agent" });
      const pa = await m.teamTaskCreate(env, { role: "coordinator", title: uniq("wp"), kind: "agent" });
      await kv.put("team:task:" + ch.id, JSON.stringify({ ...ch, ...childPatch, updatedAt: Date.now() }));
      await kv.put("team:task:" + pa.id, JSON.stringify({ ...pa, status: "waiting", waitingFor: ch.id, updatedAt: Date.now() }));
      return pa.id;
    };
    const pidB = await mkWaiting({ status: "blocked", blockedReason: "немає доступу до X", evidence: [] });
    await m.teamProcessWaiting(env);
    const pb = await m.teamTaskGet(env, pidB);
    ok(pb.status === "blocked" && /немає доступу/.test(pb.blockedReason || ""),
      "дитина blocked → батько blocked з причиною");
    const pidF = await mkWaiting({ status: "failed", result: "щось зламалось", evidence: [] });
    await m.teamProcessWaiting(env);
    const pf = await m.teamTaskGet(env, pidF);
    ok(pf.status === "failed", "дитина failed → батько failed");
  }

  // ================= 8. research agent → blocked (фікс антипатерна) =================
  section("research agent → blocked, never fake done");
  {
    const env = freshEnv();
    const t = await m.teamTaskCreate(env, {
      role: "research", title: uniq("res-blocked"), kind: "agent",
      input: { query: "знайди джерела про X" },
      criteria: [{ id: "c1", text: "знайдено джерела" }],
    });
    const r = await m.teamExecuteTask(env, t.id, "research");
    ok(r.status === "blocked", "research без автономного доступу → blocked");
    ok(r.status !== "done", "НЕ done (антипатерн виправлено)");
    ok(typeof r.blockedReason === "string" && r.blockedReason.length > 20, "пояснення причини записано");
    ok(!JSON.stringify(r).includes("manual"), "жодної заглушки 'manual' у результаті");
  }

  // ================= 9. knowledge agent: реальний запис у kb =================
  section("knowledge agent: real kb write");
  {
    const env = freshEnv();
    const key = "exec-test-" + Date.now().toString(36);
    const t = await m.teamTaskCreate(env, {
      role: "knowledge", title: uniq("kb-remember"), kind: "agent",
      input: { op: "remember", key, value: { fact: "exec-ok" } },
      criteria: [{ id: "r", text: "запис збережено", expectEvidence: "roundtrip=ok" }],
    });
    const r = await m.teamExecuteTask(env, t.id, "knowledge");
    ok(r.status === "done", "kb remember → done");
    ok(r.result.changes.includes("kb:" + key), "changes фіксує реальну зміну kb");
    const back = await m.teamKbGet(env, key);
    ok(back && back.value && back.value.fact === "exec-ok", "запис справді в kb (не імітація)");
  }

  // ================= 10. Звіт: 7 категорій =================
  section("teamBuildReport: 7 categories");
  {
    const env = freshEnv();
    const today = new Date().toISOString().slice(0, 10);
    // diagnostic done → verified, НЕ fixed
    const dg = await m.teamTaskCreate(env, { role: "chat", title: uniq("rep-diag"), input: {} });
    await m.teamExecuteTask(env, dg.id, "tester");
    // agent done із changes → fixed
    const kbk = "rep-kb-" + Date.now().toString(36);
    const ag = await m.teamTaskCreate(env, {
      role: "knowledge", title: uniq("rep-agent"), kind: "agent",
      input: { op: "remember", key: kbk, value: "v" },
      criteria: [{ id: "r", text: "t", expectEvidence: "roundtrip=ok" }],
    });
    const agDone = await m.teamExecuteTask(env, ag.id, "knowledge");
    ok(agDone.status === "done", "передумова: agent-завдання done");
    // tester done → tested
    const ts = await m.teamTaskCreate(env, {
      role: "tester", title: uniq("rep-tester"), kind: "agent",
      input: { assertions: [{ id: "versionFormat", check: "versionFormat" }] },
      criteria: [{ id: "versionFormat", text: "t" }],
    });
    await m.teamExecuteTask(env, ts.id, "tester");
    // реліз pending → prepared; approved+deployRef → published
    const relP = await m.teamReleaseCreate(env, { title: uniq("rep-rel-pending"), changes: ["a"], authorRole: "backend" });
    const relD = await m.teamReleaseCreate(env, { title: uniq("rep-rel-dep"), changes: ["b"], authorRole: "backend" });
    await m.teamReleaseApprove(env, relD.id, { approve: true, approver: "coordinator" });
    await m.teamReleaseMarkDeployed(env, relD.id, { deployRef: "pages:deployment:test123", actor: "user" });
    // failed + blocked → blocked
    const fl = await m.teamTaskCreate(env, {
      role: "tester", title: uniq("rep-fail"), kind: "agent",
      input: { assertions: [] }, criteria: [{ id: "zzz", text: "неіснуючий критерій" }],
    });
    await m.teamExecuteTask(env, fl.id, "tester");
    const bl = await m.teamTaskCreate(env, { role: "research", title: uniq("rep-blocked"), kind: "agent", input: {} });
    await m.teamExecuteTask(env, bl.id, "research");

    const rep = await m.teamBuildReport(env, today);
    for (const k of ["verified", "found", "prepared", "tested", "fixed", "published", "blocked"])
      ok(Array.isArray(rep[k]), "категорія '" + k + "' присутня як масив");
    ok(rep.found.length >= 5, "found: усі створені (" + rep.found.length + ")");
    ok(rep.verified.some((s) => s.includes("rep-diag")), "diagnostic done → verified");
    ok(!rep.fixed.some((f) => JSON.stringify(f).includes("rep-diag")), "diagnostic НЕ в fixed");
    ok(rep.fixed.some((f) => JSON.stringify(f).includes("rep-agent") && f.changes.some((c) => c.includes(kbk))),
      "fixed: agent done із changes[] і доказами (посилання на зміну)");
    ok(rep.tested.some((s) => s.includes("rep-tester")), "tested: завдання тестера");
    ok(rep.prepared.includes(relP.title), "prepared: реліз у pending");
    ok(rep.published.some((p) => p.release === relD.title && p.deployRef === "pages:deployment:test123"),
      "published: тільки з deployRef");
    ok(!rep.published.some((p) => p.release === relP.title), "pending-реліз НЕ в published");
    ok(rep.blocked.some((s) => s.includes("rep-fail")) && rep.blocked.some((s) => s.includes("rep-blocked")),
      "blocked: failed і blocked із причинами");
  }

  // ================= 11. Релізи: contentHash, анулювання, блокування тестером =================
  section("releases: contentHash lifecycle");
  {
    const env = freshEnv();
    const rel = await m.teamReleaseCreate(env, {
      title: uniq("rel-hash"), changes: ["team subsystem"], codeRefs: ["_worker.js:teamExecuteTask"], authorRole: "backend",
    });
    ok(rel.status === "pending", "створено → pending");
    ok(/^[0-9a-f]{64}$/.test(rel.contentHash || ""), "contentHash пораховано (sha256 hex)");
    ok(rel.approvedHash === null, "до схвалення approvedHash null");
    const h1 = rel.contentHash;
    const relB = await m.teamReleaseCreate(env, { title: uniq("rel-hash-b"), changes: ["team subsystem"], codeRefs: ["other.js:1"], authorRole: "backend" });
    ok(relB.contentHash !== h1, "хеш залежить від вмісту (codeRefs впливають)");

    const appr = await m.teamReleaseApprove(env, rel.id, { approve: true, approver: "coordinator" });
    ok(appr.status === "approved" && appr.approvedHash === h1, "схвалення фіксує хеш");
    // зміна вмісту після схвалення → анулювання
    const upd = await m.teamReleaseUpdate(env, rel.id, { changes: ["team subsystem", "ще одна зміна"], actor: "user" });
    ok(upd.status === "pending" && upd.approver === null && upd.approvedHash === null,
      "зміна вмісту після схвалення → статус назад у pending, рішення анульовано");
    ok(upd.contentHash !== h1, "хеш перераховано");
    // та сама зміна вмісту без змін → рішення лишається
    const appr2 = await m.teamReleaseApprove(env, rel.id, { approve: true, approver: "coordinator" });
    const updSame = await m.teamReleaseUpdate(env, rel.id, { changes: ["team subsystem", "ще одна зміна"], actor: "user" });
    ok(updSame.status === "approved", "ідентичний вміст → схвалення НЕ анулюється");
    ok(appr2.approvedHash === updSame.contentHash, "approvedHash збігається з contentHash");
    // тестувальник блокує дефектний випуск
    const relT = await m.teamReleaseCreate(env, { title: uniq("rel-tester"), changes: ["x"], authorRole: "backend" });
    const blocked = await m.teamReleaseApprove(env, relT.id, { approve: false, approver: "tester", note: "падає smoke-тест" });
    ok(blocked.status === "blocked", "approve:false від tester → blocked");
    ok(/падає smoke-тест/.test(blocked.blockedReason || ""), "причина блокування записана");
    // після блокування — повторний розгляд дозволено
    await m.teamReleaseUpdate(env, relT.id, { changes: ["x", "фікс smoke"], actor: "user" });
    const relT2 = await m.teamReleaseGet(env, relT.id);
    ok(relT2.status === "pending", "після виправлення вмісту blocked → pending");
    const reAppr = await m.teamReleaseApprove(env, relT.id, { approve: true, approver: "coordinator" });
    ok(reAppr.status === "approved", "повторне схвалення після blocked дозволено");
    // не-тестер approve:false → rejected як раніше
    const relR = await m.teamReleaseCreate(env, { title: uniq("rel-rej"), changes: ["y"], authorRole: "backend" });
    const rej = await m.teamReleaseApprove(env, relR.id, { approve: false, approver: "coordinator" });
    ok(rej.status === "rejected", "approve:false від не-тестера → rejected (як раніше)");
    // deployRef
    await expectThrow(() => m.teamReleaseMarkDeployed(env, relR.id, { deployRef: "x", actor: "user" }),
      /STATE/i, "deployed лише зі статусу approved");
    await expectThrow(() => m.teamReleaseMarkDeployed(env, rel.id, { deployRef: "", actor: "user" }),
      /BAD/i, "deployRef обов'язковий");
    const dep = await m.teamReleaseMarkDeployed(env, rel.id, { deployRef: "pages:dep:abc", actor: "user" });
    ok(dep.status === "deployed" && dep.deployRef === "pages:dep:abc", "markDeployed фіксує deployRef");
    await expectThrow(() => m.teamReleaseApprove(env, rel.id, { approve: true, approver: "coordinator" }),
      /STATE/i, "рішення після deployed неможливе");
    await expectThrow(() => m.teamReleaseUpdate(env, rel.id, { changes: ["z"], actor: "user" }),
      /STATE/i, "зміна вмісту deployed-релізу неможлива");
  }

  // ================= 12. HTTP: kind/criteria/delegation крізь /api/team =================
  section("handleTeam: agent flow over HTTP");
  {
    const env = freshEnv();
    const AUTH = { Authorization: "Bearer private-test" };
    const callTeam = (path, init) => m.handleTeam(new Request("https://team.local" + path, init),
      env, new URL("https://team.local" + path));
    const postOpts = (body) => ({ method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let res = await callTeam("/api/team/tasks", postOpts({ role: "tester", title: uniq("http-agent"), kind: "agent",
      input: { assertions: [{ id: "versionFormat", check: "versionFormat" }] },
      criteria: [{ id: "versionFormat", text: "t" }] }));
    ok(res.status === 201, "POST /api/team/tasks з kind:agent → 201");
    const created = await res.json();
    ok(created.task.kind === "agent" && created.task.criteria.length === 1, "kind/criteria пройшли крізь HTTP");
    res = await callTeam("/api/team/tasks/" + created.task.id, postOpts({ action: "execute" }));
    ok(res.status === 200, "execute через HTTP → 200");
    const ex = await res.json();
    ok(ex.task.status === "done", "agent-завдання done через HTTP");
    // process-waiting: user — кореневий принципал, але маршрут відомий
    res = await callTeam("/api/team/tasks/" + created.task.id, postOpts({ action: "process-waiting" }));
    ok(res.status === 200, "action process-waiting → 200");
    const pw = await res.json();
    ok(Array.isArray(pw.resolved), "process-waiting повертає resolved[]");
  }

  console.log("\n==== ПІДСУМОК ====");
  console.log("CHECKS PASSED: " + checks);
  console.log("ALL v5.11.1-exec TESTS PASSED");
} finally {
  try { fs.unlinkSync(TMP); } catch (e) { /* вже видалено */ }
}
