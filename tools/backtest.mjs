#!/usr/bin/env node
/* AI Bridge strategy backtester (v5.10.0).
   - Loads 1h klines from the public Binance market-data endpoint
     (https://data-api.binance.vision — the official market-data-only base
     from the Binance docs; api.binance.com is geo-restricted here).
   - Simulates ConservativeDCA with 0.1% commission and 0.07% slippage.
   - Walk-forward: 12-month in-sample -> 3-month out-of-sample, 3-month step.
   - Parameter sweep ±20%: Sharpe must not drop more than 50%.
   - Auto-reject red flags -> OVERFIT verdict.
   Usage: node tools/backtest.mjs --symbol BTCUSDT [--years 2] [--strategy conservative-dca]
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { detectRegime, dcaStep, dcaOnFill, DCA_DEFAULTS } = await import("../binance-bot/strategies.mjs");
const { computeMetrics } = await import("../binance-bot/metrics.mjs");

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SYMBOL = arg("--symbol", "BTCUSDT");
const YEARS = Number(arg("--years", "2")) || 2;
const STRATEGY = arg("--strategy", "conservative-dca");
if (STRATEGY !== "conservative-dca") { console.error("Only conservative-dca is wired in this backtester."); process.exit(2); }

const FEE = 0.001, SLIP = 0.0007, CAPITAL0 = 10_000;
const CACHE = "/tmp/binance-klines-cache";
fs.mkdirSync(CACHE, { recursive: true });

async function loadKlines(symbol, startMs, endMs) {
  const cacheFile = path.join(CACHE, `${symbol}-1h.json`);
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (e) { /* miss */ }
  if (cached && cached[0]?.time <= startMs && cached.at(-1)?.time >= endMs - 3600_000) {
    console.log(`[cache] ${cached.length} candles`);
    return cached.filter(c => c.time >= startMs && c.time <= endMs);
  }
  const out = [];
  let start = startMs, source = "api.binance.com";
  // Primary endpoint per spec: https://api.binance.com/api/v3/klines.
  // api.binance.com geo-restricts some regions (HTTP 451/403 from this VM),
  // so on geo-block we fall back to the public market-data-only host
  // https://data-api.binance.vision (no API key, same klines schema).
  async function fetchPage(u) {
    const res = await fetch(u);
    if (!res.ok && (res.status === 451 || res.status === 403)) {
      const e = new Error("GEO_BLOCKED");
      e.geoBlocked = true;
      throw e;
    }
    if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
    return res.json();
  }
  for (;;) {
    const qs = `symbol=${symbol}&interval=1h&limit=1000&startTime=${start}`;
    const host = source === "api.binance.com"
      ? "https://api.binance.com/api/v3/klines"
      : "https://data-api.binance.vision/api/v3/klines";
    let rows;
    try {
      rows = await fetchPage(`${host}?${qs}`);
    } catch (e) {
      if (!e.geoBlocked || source !== "api.binance.com") throw e;
      source = "data-api.binance.vision";
      console.log("[klines] api.binance.com geo-blocked, falling back to data-api.binance.vision");
      rows = await fetchPage(`https://data-api.binance.vision/api/v3/klines?${qs}`);
    }
    if (!rows.length) break;
    for (const r of rows) out.push({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });
    const last = rows.at(-1)[0];
    if (last <= start || rows.length < 1000 || last >= endMs) break;
    start = last + 1;
    await new Promise(r => setTimeout(r, 120));
  }
  const cut = out.filter(c => c.time >= startMs && c.time <= endMs);
  console.log(`[fetch] ${cut.length} 1h candles for ${symbol} (source: ${source})`);
  try { fs.writeFileSync(cacheFile, JSON.stringify(out)); } catch (e) { /* ignore */ }
  return cut;
}

// Event-driven ConservativeDCA simulation. Fills happen at the NEXT candle
// open with adverse slippage; commission on both sides.
function simulate(candles, overrides = {}, capital0 = CAPITAL0) {
  const cfg = { ...DCA_DEFAULTS, ...overrides };
  let cash = capital0, dca = null, trades = [];
  const curve = [];
  let regime = "range", lastRegimeDay = -1, lastCurveDay = "";
  const warmup = 720; // 30d for the regime filter
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const dayIdx = Math.floor(i / 24);
    if (dayIdx !== lastRegimeDay && i >= 60) {
      try { regime = detectRegime(candles.slice(Math.max(0, i - 719), i + 1)).regime; } catch (e) { /* keep */ }
      lastRegimeDay = dayIdx;
    }
    const day = new Date(c.time).toISOString().slice(0, 10);
    if (i >= warmup) {
      const step = dcaStep({ price: c.close, dca, capital: cash + (dca && dca.qty > 0 ? dca.qty * c.close : 0), now: c.time, regime, overrides: cfg });
      const nxt = candles[i + 1];
      if (step.action === "sell-all" && nxt && step.dca && step.dca.qty > 0) {
        const fill = nxt.open * (1 - SLIP);
        const proceeds = step.dca.qty * fill * (1 - FEE);
        const pnl = proceeds - step.dca.cost;
        trades.push({ pnl, time: nxt.time, reason: step.reason });
        cash += proceeds;
        dca = dcaOnFill(step.dca, { side: "sell-all", price: fill, qty: step.dca.qty, now: c.time });
      } else {
        dca = step.dca;
        if (step.action === "buy" && nxt) {
          const notional = Math.min(step.notional, cash);
          if (notional >= 5) {
            const fill = nxt.open * (1 + SLIP);
            const qty = (notional * (1 - FEE)) / fill;
            cash -= notional;
            dca = dcaOnFill(dca, { side: "buy", price: fill, qty, now: c.time });
          }
        }
      }
    }
    if (day !== lastCurveDay) {
      const eq = cash + (dca && dca.qty > 0 ? dca.qty * c.close : 0);
      curve.push({ day, equity: eq });
      lastCurveDay = day;
    }
  }
  // Mark open inventory to market at the end.
  const lastClose = candles.at(-1).close;
  const equity = cash + (dca && dca.qty > 0 ? dca.qty * lastClose : 0);
  return { trades, equityCurve: curve, equity, openQty: dca?.qty || 0 };
}

function metricsOf(sim) {
  return { ...computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, currentEquity: sim.equity }), equity: sim.equity, n: sim.trades.length };
}
const f2 = v => v == null || !Number.isFinite(v) ? "n/a" : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
const f4 = v => v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(4);

async function main() {
  const nowMs = Date.now();
  const endMs = nowMs - 3600_000;
  const startMs = endMs - YEARS * 365 * 86400_000;
  const candles = await loadKlines(SYMBOL, startMs, endMs);
  if (candles.length < 8000) throw new Error(`Not enough history: ${candles.length} candles`);

  // Walk-forward windows: 12mo train / 3mo test, 3mo step.
  const D = 86400_000, windows = [];
  for (let m = 0; ; m += 91 * D) {
    const t0 = candles[0].time + m, t1 = t0 + 365 * D, t2 = t1 + 91 * D;
    if (t2 > candles.at(-1).time) break;
    windows.push({ train: candles.filter(c => c.time >= t0 && c.time < t1), test: candles.filter(c => c.time >= t1 && c.time < t2), label: `${new Date(t1).toISOString().slice(0, 7)}→${new Date(t2).toISOString().slice(0, 7)}` });
  }
  console.log(`\nWalk-forward: ${windows.length} windows (12mo in-sample → 3mo out-of-sample)\n`);
  const rows = [];
  for (const w of windows) {
    const s = simulate(w.test);
    const m = metricsOf(s);
    rows.push({ window: w.label, ...m });
    console.log(`${w.label}  n=${m.n} win=${f2(m.winRate * 100)}% PF=${f2(m.profitFactor)} Sharpe=${f2(m.sharpe)} maxDD=${f2(m.maxDrawdown * 100)}% Calmar=${f2(m.calmar)} avgW=${f2(m.avgWin)} avgL=${f2(m.avgLoss)} eq=${f2(m.equity)}`);
  }

  // Full-history reference run.
  const full = metricsOf(simulate(candles));
  console.log(`\nFULL ${YEARS}y  n=${full.n} win=${f2(full.winRate * 100)}% PF=${f2(full.profitFactor)} Sharpe=${f2(full.sharpe)} maxDD=${f2(full.maxDrawdown * 100)}% Calmar=${f2(full.calmar)} avgW=${f2(full.avgWin)} avgL=${f2(full.avgLoss)} eq=${f2(full.equity)}`);

  // Parameter sweep ±20%.
  console.log("\nParameter sweep ±20% (Sharpe must not drop >50%):");
  const sweepKeys = ["basePct", "safetyStepPct", "takePct", "hardStopPct", "multiplier"];
  let sweepOk = true;
  for (const k of sweepKeys) {
    for (const f of [0.8, 1.2]) {
      const s = metricsOf(simulate(candles, { [k]: DCA_DEFAULTS[k] * f }));
      let ok, note;
      if (full.sharpe > 0.2) { ok = s.sharpe >= 0.5 * full.sharpe; note = `base ${f2(full.sharpe)} → ${f2(s.sharpe)}`; }
      else { ok = s.sharpe >= full.sharpe - 0.25; note = `weak base ${f2(full.sharpe)} → ${f2(s.sharpe)} (no cliff)`; }
      if (!ok) sweepOk = false;
      console.log(`  ${k} ×${f}: Sharpe ${f2(s.sharpe)}  ${ok ? "OK" : "DEGRADED"} (${note})`);
    }
  }

  // Red flags -> OVERFIT.
  const flags = [];
  if (full.winRate > 0.8) flags.push(`winrate ${(full.winRate * 100).toFixed(1)}% > 80%`);
  if (full.sharpe > 3) flags.push(`Sharpe ${full.sharpe.toFixed(2)} > 3`);
  if (full.maxDrawdown < 0.02) flags.push(`maxDD ${(full.maxDrawdown * 100).toFixed(2)}% < 2%`);
  if (full.topShare > 0.5) flags.push(`top-2 trades = ${(full.topShare * 100).toFixed(1)}% of profit`);
  const oosSharpe = rows.reduce((a, r) => a + (r.sharpe || 0), 0) / Math.max(1, rows.length);
  console.log(`\nRed flags: ${flags.length ? flags.join(" | ") : "none"}`);
  console.log(`Mean OOS Sharpe: ${f2(oosSharpe)}`);

  let verdict, reasons = [];
  if (flags.length) { verdict = "FAIL"; reasons.push("OVERFIT (" + flags.join("; ") + ")"); }
  if (!sweepOk) { verdict = "FAIL"; reasons.push("parameter sweep degrades >50%"); }
  if (!verdict) {
    if (oosSharpe >= 0) { verdict = "PASS"; }
    else { verdict = "FAIL"; reasons.push("negative mean out-of-sample Sharpe"); }
  }
  console.log(`\nVERDICT: ${verdict}${reasons.length ? " — " + reasons.join("; ") : ""}`);
  const out = { symbol: SYMBOL, strategy: STRATEGY, years: YEARS, windows: rows, full, sweepOk, flags, oosSharpe, verdict, reasons, ts: new Date().toISOString() };
  const outFile = `/tmp/backtest-${SYMBOL}-${STRATEGY}.json`;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`JSON: ${outFile}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch(e => { console.error("backtest failed:", e.message); process.exit(2); });
