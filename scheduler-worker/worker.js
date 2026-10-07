// scheduler-worker/worker.js
// Окремий Worker-планувальник для AI Bridge (Cloudflare Pages).
// Чому окремий: Cloudflare Pages НЕ підтримує Cron Triggers (навіть в advanced
// mode з _worker.js) — це фіча тільки Workers (див. гайд Cloudflare
// «Migrate from Pages to Workers»: «Unlike Pages, Workers has ... Cron Triggers ...»,
// перевірено за офіційними доками 2026-09-30).
// Цей Worker має cron-тригер і просто викликає серверний тік Pages-застосунку:
//   POST {SITE_URL}/api/team/scheduled-tick   (Authorization: Bearer {CRON_SECRET})
// Уся логіка (stale-sweep → retry → due tasks → daily review) живе в _worker.js
// (teamScheduledTick) і виконується на боці Pages — Safari може бути закрито.
//
// Env (wrangler secret / dashboard):
//   CRON_SECRET — той самий секрет, що й AI_BRIDGE_CRON_SECRET на Pages-проєкті.
// Vars (wrangler.toml):
//   SITE_URL    — https://aibridge-aff.pages.dev (без слеша в кінці).

async function callTick(env) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  const secret = String(env.CRON_SECRET || "");
  if (!site) throw new Error("SITE_URL is not configured");
  if (!secret) throw new Error("CRON_SECRET is not configured");
  const url = site + "/api/team/scheduled-tick";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("tick-timeout"), 55000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + secret,
        "Content-Type": "application/json",
        "User-Agent": "aibridge-scheduler/1.0",
      },
      body: JSON.stringify({ source: "scheduler-worker", at: new Date().toISOString() }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 500) }; }
    if (!r.ok) throw new Error("tick HTTP " + r.status + ": " + text.slice(0, 300));
    return { ok: true, status: r.status, tick: body && body.tick ? body.tick : body };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async scheduled(event, env, ctx) {
    // event.cron — вираз, що спрацював; scheduledTime — час спрацювання (UTC).
    const started = Date.now();
    try {
      const res = await callTick(env);
      console.log(
        "aibridge-scheduler: tick ok cron=" + event.cron +
        " ms=" + (Date.now() - started) +
        " sweep=" + JSON.stringify(res.tick && res.tick.sweep) +
        " retry=" + JSON.stringify(res.tick && res.tick.retry) +
        " due=" + JSON.stringify(res.tick && res.tick.due) +
        " review=" + JSON.stringify(res.tick && res.tick.review)
      );
    } catch (e) {
      // Не кидаємо назовні без noRetry: одноразовий збій мережі не має
      // блокувати наступні тіки; помилка видима в Workers Logs.
      console.error("aibridge-scheduler: tick failed cron=" + event.cron + ": " + (e && e.message ? e.message : e));
    }
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "aibridge-scheduler", site: String(env.SITE_URL || ""), at: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return new Response("aibridge-scheduler: cron worker; see SCHEDULER_DEPLOY.md", { status: 200 });
  },
};
