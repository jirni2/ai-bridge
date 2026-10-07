import fs from "node:fs";
const src = fs.readFileSync(new URL("../_worker.js", import.meta.url), "utf8");
const tmp = new URL("./worker-v4510-retry.mjs", import.meta.url);
fs.writeFileSync(tmp, src);
const m = await import(tmp.href + "?t=" + Date.now());
function ok(v, msg) { if (!v) throw new Error("FAIL: " + msg); console.log("✓", msg); }

/* ---- Fake timer harness ----
   Real setTimeout is replaced so a scheduled sleep of N ms resolves almost
   immediately, but we record N. That lets us assert the EXACT delay the code
   decided to wait without actually waiting ~60s in CI. We also record a
   virtual clock so ordering assertions stay meaningful. */
const realSetTimeout = globalThis.setTimeout;
function installFakeTimers() {
  const scheduled = [];
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms > 0) scheduled.push(ms); return realSetTimeout(fn, 0, ...a); };
  return { scheduled, restore() { globalThis.setTimeout = realSetTimeout; } };
}
const GEMINI_URL_FRAGMENT = "generativelanguage.googleapis.com";
function geminiOkBody(text) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}
const MEANINGFUL = "In _worker.js the function withRetry() computes `const wait=Math.min(RETRY_DELAY_CAP_MS,base+jitter)` and then sleeps. The concrete failure mode is that a long provider-supplied delay could exceed the per-call budget and be dropped without any diagnostic, which this run exercises directly.";
const env = { GOOGLE_API_KEY: "g", GEMINI_MODEL: "gemini-3.8-flash" };

/* ================= A. Gemini RetryInfo 59.577s ================= */
{
  const t = installFakeTimers();
  const bodies = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: 429, message: "Resource exhausted. Please retry in 59.577s", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "59.577s" }] } }), { status: 429, headers: { "content-type": "application/json" } });
    }
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  const text = await m.callGemini(env, "sys", "prompt", e => events.push(e));
  t.restore();
  ok(calls === 2, "A: exactly one retry attempt is made after the 429 (2 fetches total)");
  const retryEv = events.find(e => e.type === "provider_retry");
  ok(!!retryEv, "A: a provider_retry diagnostic event is emitted");
  ok(retryEv.requestedWaitMs === 59577, "A: requested wait is the exact fractional RetryInfo value 59577ms (not floored to 59000)");
  ok(retryEv.actualWaitMs >= 59577, "A: actual scheduled wait is at least the requested 59577ms");
  ok(t.scheduled.some(ms => ms >= 59577), "A: the real sleep scheduled was >= 59577ms, so the second fetch cannot occur earlier");
  ok(retryEv.delaySource === "google.rpc.RetryInfo", "A: delaySource is the Google RetryInfo detail, not backoff");
  ok(text === MEANINGFUL, "A: the successful second attempt's text is returned");
}

/* ================= B. "Please retry in 1.25s" text (no RetryInfo detail) ================= */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 429, message: "Rate limited. Please retry in 1.25s" } }), { status: 429, headers: { "content-type": "application/json" } });
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  await m.callGemini(env, "sys", "prompt", e => events.push(e));
  t.restore();
  const ev = events.find(e => e.type === "provider_retry");
  ok(ev.requestedWaitMs === 1250, "B: fractional 1.25s is parsed as 1250ms, not 1000ms");
  ok(ev.actualWaitMs >= 1250, "B: actual wait is at least 1250ms");
  ok(/google-message|please_retry_in/.test(ev.delaySource), "B: delaySource identifies the 'Please retry in ...s' message parser");
}

/* ================= C. Retry-After: 3 header ================= */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "3" } });
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  await m.callGemini(env, "sys", "prompt", e => events.push(e));
  t.restore();
  const ev = events.find(e => e.type === "provider_retry");
  ok(ev.requestedWaitMs === 3000, "C: Retry-After: 3 is parsed as 3000ms");
  ok(ev.actualWaitMs >= 3000, "C: actual wait is at least 3000ms");
  ok(/retry-after|retry_after/i.test(ev.delaySource), "C: delaySource identifies the HTTP Retry-After header");
}

/* ---- Precedence: RetryInfo must win over a (smaller) Retry-After header ---- */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "42.5s" }] } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  await m.callGemini(env, "sys", "prompt", e => events.push(e));
  t.restore();
  const ev = events.find(e => e.type === "provider_retry");
  ok(ev.requestedWaitMs === 42500, "C2: google.rpc.RetryInfo (42.5s) WINS over a smaller Retry-After: 1 header");
  ok(ev.delaySource === "google.rpc.RetryInfo", "C2: delaySource reflects RetryInfo, confirming the required precedence order");
}

/* ================= D. Cancellation interrupts the sleep itself ================= */
{
  const ac = new AbortController();
  const t = installFakeTimers();
  // Abort while the retry sleep is pending.
  let err = null;
  try {
    await m.withRetry(async () => { const e = new Error("429"); e.status = 429; e.retryAfterMs = 59577; e.retryDelaySource = "google.rpc.RetryInfo"; throw e; },
      { attempts: 2, retryStatuses: [429], maxTotalMs: 150000, signal: ac.signal, provider: "gemini", onRetry: async () => { ac.abort(); } });
  } catch (e) { err = e; }
  t.restore();
  ok(err && (err.cancelled === true || err.status === 499), "D: aborting during the retry wait rejects immediately instead of sleeping out the full delay");
}
{
  // A per-attempt timeout must NOT cancel the scheduled retry.
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) { const e = new Error("The operation was aborted"); e.name = "AbortError"; throw e; }
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const text = await m.callGemini(env, "sys", "prompt");
  t.restore();
  ok(calls === 2 && text === MEANINGFUL, "D: a per-attempt timeout (504) is retried; the timeout does not cancel the scheduled retry");
}

/* ================= E. Merge: a retried provider never erases another provider's success ================= */
{
  const t = installFakeTimers();
  let geminiCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes(GEMINI_URL_FRAGMENT)) {
      geminiCalls++;
      if (geminiCalls === 1) return new Response(JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "59.577s" }] } }), { status: 429, headers: { "content-type": "application/json" } });
      return new Response(geminiOkBody(MEANINGFUL + " Gemini pass."), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("openrouter.ai")) return new Response(JSON.stringify({ choices: [{ message: { content: MEANINGFUL + " OpenRouter pass." } }] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("unexpected " + u);
  };
  const req = new Request("https://x/api/work/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify({ task: "Review.", fileText: "", mode: "code", providers: ["gemini", "openrouter"] }) });
  const res = await m.handleWorkRun(req, { ...env, BRIDGE_ACCESS_TOKEN: "t", OPENROUTER_API_KEY: "r" });
  const j = await res.json();
  t.restore();
  const byProvider = Object.fromEntries((j.results || []).map(r => [r.provider, r]));
  ok(byProvider.openrouter?.ok === true, "E: the already-successful OpenRouter result survives the Gemini retry");
  ok(byProvider.gemini?.ok === true, "E: the retried Gemini provider ends up successful");
  ok((j.results || []).length === 2, "E: no result is duplicated or erased (exactly 2 results)");
  ok(geminiCalls >= 2, "E: the failing Gemini provider was retried (calls=" + geminiCalls + ")");
  ok((j.retryEvents || []).some(e => e.type === "provider_retry" && e.provider === "gemini"), "E: retry diagnostics are attached to the run response");
}

/* ================= F. Streaming diagnostics ordering ================= */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "59.577s" }] } }), { status: 429, headers: { "content-type": "application/json" } });
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  await m.callGemini(env, "sys", "prompt", e => events.push(e));
  t.restore();
  const types = events.map(e => e.type);
  ok(types[0] === "provider_attempt", "F: the first event is provider_attempt (emitted before the first request)");
  const ri = types.indexOf("provider_retry"), ai = types.lastIndexOf("provider_attempt");
  ok(ri >= 0 && ai > ri, "F: provider_retry is emitted BEFORE the next provider_attempt, i.e. during the wait, not after completion");
  const ev = events[ri];
  for (const f of ["provider", "attempt", "maxAttempts", "status", "requestedWaitMs", "actualWaitMs", "delaySource", "nextAttempt", "timestamp"]) {
    ok(ev[f] !== undefined && ev[f] !== null, `F: provider_retry event carries '${f}'`);
  }
  ok(ev.status === 429, "F: the event reports HTTP status 429");
  ok(ev.provider === "gemini", "F: the event reports provider 'gemini'");
}

/* ================= F2. Retry dropped for budget reasons is reported, never masked ================= */
{
  const t = installFakeTimers();
  const events = [];
  let err = null;
  try {
    await m.withRetry(async () => { const e = new Error("Gemini HTTP 429"); e.status = 429; e.retryAfterMs = 59577; e.retryDelaySource = "google.rpc.RetryInfo"; throw e; },
      { attempts: 2, retryStatuses: [429], maxTotalMs: 5000, provider: "gemini", ...m.providerRetryHooks("gemini", e => events.push(e)) });
  } catch (e) { err = e; }
  t.restore();
  const skipped = events.find(e => e.type === "provider_retry_skipped");
  ok(!!skipped, "F2: dropping a retry for budget reasons emits an explicit provider_retry_skipped event");
  ok(skipped.reason === "retry_budget_exhausted", "F2: the skip reason is explicit, not silent");
  ok(skipped.requestedWaitMs === 59577 && skipped.wouldHaveWaitedMs >= 59577, "F2: the event records the delay that WOULD have been waited");
  ok(err.retrySkipped === true, "F2: the thrown error is annotated so callers can distinguish this from a non-retryable status");
}

/* ================= G. Empty / non-meaningful 200 OK is retried, not accepted ================= */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(geminiOkBody(""), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(geminiOkBody(MEANINGFUL), { status: 200, headers: { "content-type": "application/json" } });
  };
  const text = await m.callGemini(env, "sys", "prompt");
  t.restore();
  ok(calls === 2 && text === MEANINGFUL, "G: an empty 200 OK is treated as a 502 and retried");
  ok(m.meaningfulProviderText("OK") === false, "G: a bare 'OK' is not a meaningful review");
  ok(m.meaningfulProviderText("Looks good.") === false, "G: 'Looks good.' is not a meaningful review");
}

/* ================= Non-retryable 4xx must NOT be retried ================= */
{
  const t = installFakeTimers();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("bad request", { status: 400 }); };
  let err = null;
  try { await m.callGemini(env, "sys", "prompt"); } catch (e) { err = e; }
  t.restore();
  ok(calls === 1, "non-retryable 400 is attempted exactly once");
  ok(err && String(err.message).includes("400"), "the exact last error is surfaced after a non-retryable status");
}

/* ================= Cap sanity ================= */
ok(m.RETRY_DELAY_CAP_MS >= 75000, "retry delay cap leaves real headroom above a ~60s RetryInfo (cap=" + m.RETRY_DELAY_CAP_MS + "ms)");

fs.unlinkSync(tmp);
console.log("All v4.5.10 retry regression tests passed.");
