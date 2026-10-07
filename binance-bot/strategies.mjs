// strategies.mjs — regime filter + three strategies. Pure functions; the
// engine executes the plans they produce. No I/O, no network.
import { ema, rsi, atr, adx, sma, stdev } from "./indicators.mjs";
import { validateAveraging } from "./risk.mjs";

export const STRATEGY_NAMES = ["signal", "trend-follow", "conservative-dca", "bounded-grid"];
export const TREND_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
export const DCA_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

// Regime filter: ADX(14) + volatility (stdev of log returns).
// candles: [{high, low, close}] — 1h candles, >= 60 (720+ for full 30d vol).
// Returns {regime: 'trend'|'range'|'chaos', adx, volatility, volAvg30d}.
export function detectRegime(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 60) throw new Error("detectRegime needs >= 60 candles");
  const volWindow = opts.volWindow || 24;
  const closes = candles.map(c => Number(c.close));
  const rets = logReturns(closes);
  const volatility = stdev(rets.slice(-volWindow)) ?? 0;
  // 30-day average volatility: stdev of the last 720 hourly returns.
  const volAvg30d = stdev(rets.slice(-720)) ?? volatility;
  const adxSeries = adx(candles, 14);
  const adxNow = adxSeries.at(-1);
  if (volAvg30d > 0 && volatility > 3 * volAvg30d)
    return { regime: "chaos", adx: adxNow, volatility, volAvg30d, reason: "VOLATILITY_SPIKE" };
  if (adxNow == null) return { regime: "range", adx: adxNow, volatility, volAvg30d, reason: "ADX_WARMUP" };
  return {
    regime: adxNow >= 20 ? "trend" : "range",
    adx: adxNow, volatility, volAvg30d,
    reason: adxNow >= 20 ? "ADX_TREND" : "ADX_RANGE",
  };
}

// ---- BoundedGrid -------------------------------------------------------
export const GRID_DEFAULTS = Object.freeze({
  levels: 12,            // grid levels below the entry price
  baseStepPct: 0.02,     // 2% base step...
  atrStepMin: 0.015,     // ...adapted to 1.5-3% of ATR
  atrStepMax: 0.03,
  rangeTolerancePct: 0.08, // entry only if price within 30d min/max ±8%
  breakPct: 0.05,        // global stop: range broken by >5%
  allocationPct: 0.10,   // of capital, split equally across levels
  multiplier: 1.0,       // no martingale, ever
});

// Pure plan: does NOT place orders. Returns levels with limit prices,
// per-level TP and the global stop band.
export function boundedGridPlan(candles, price, capital, overrides = {}) {
  const cfg = { ...GRID_DEFAULTS, ...overrides };
  const p = Number(price), cap = Number(capital);
  if (!(p > 0) || !(cap > 0)) throw new Error("Invalid grid input");
  const reg = detectRegime(candles);
  if (reg.regime === "chaos") return { allowed: false, reason: "CHAOS", ...reg };
  if (reg.regime !== "range" || !(reg.adx < 20))
    return { allowed: false, reason: "NOT_RANGE", ...reg };
  const window = candles.slice(-720);
  const hi = Math.max(...window.map(c => Number(c.high)));
  const lo = Math.min(...window.map(c => Number(c.low)));
  if (p > hi * (1 + cfg.rangeTolerancePct) || p < lo * (1 - cfg.rangeTolerancePct))
    return { allowed: false, reason: "OUT_OF_RANGE", rangeLow: lo, rangeHigh: hi, ...reg };
  const atrNow = atr(candles, 14).at(-1) || p * cfg.baseStepPct;
  const step = Math.min(cfg.atrStepMax, Math.max(cfg.atrStepMin, atrNow / p));
  const perLevel = (cap * cfg.allocationPct) / cfg.levels;
  const levels = [];
  for (let i = 1; i <= cfg.levels; i++) {
    const lp = p * (1 - step * i);
    if (lp < lo * 0.9) break;
    levels.push({ index: i, price: lp, notional: perLevel, tpPrice: lp * (1 + step), stepPct: step });
  }
  return {
    allowed: true, reason: "OK", levels, stepPct: step,
    rangeLow: lo, rangeHigh: hi,
    globalStopLow: lo * (1 - cfg.breakPct),
    globalStopHigh: hi * (1 + cfg.breakPct),
    adx: reg.adx, volatility: reg.volatility,
  };
}

// ---- TrendFollow --------------------------------------------------------
// 1h candles [{open,high,low,close,volume}]. Entry: EMA(20) crosses above
// EMA(50) + RSI(14) > 55 + volume > SMA(20) volume. Exit: trailing stop
// 2.5*ATR(14) from the highest high, or EMA cross down.
export const TREND_DEFAULTS = Object.freeze({ rsiMin: 55, trailAtrMult: 2.5, symbols: TREND_SYMBOLS });

export function trendFollowSignal(candles, overrides = {}) {
  const cfg = { ...TREND_DEFAULTS, ...overrides };
  if (!Array.isArray(candles) || candles.length < 60) throw new Error("trendFollowSignal needs >= 60 candles");
  const closes = candles.map(c => Number(c.close));
  const vols = candles.map(c => Number(c.volume ?? 0));
  const e20 = ema(closes, 20), e50 = ema(closes, 50), r = rsi(closes, 14), a = atr(candles, 14), vs = sma(vols, 20);
  const i = candles.length - 1;
  const crossUp = e20[i - 1] <= e50[i - 1] && e20[i] > e50[i];
  const crossDown = e20[i - 1] >= e50[i - 1] && e20[i] < e50[i];
  const buy = crossUp && r[i] > cfg.rsiMin && vols[i] > (vs[i] ?? Infinity);
  return {
    signal: buy ? "buy" : crossDown ? "sell" : "hold",
    ema20: e20[i], ema50: e50[i], rsi: r[i], atr: a[i],
    volume: vols[i], volumeSma: vs[i],
  };
}
export function trailingStopPrice(highestHigh, atrValue, mult = 2.5) {
  const h = Number(highestHigh), a = Number(atrValue);
  if (!(h > 0) || !(a > 0)) throw new Error("Invalid trailing stop input");
  return h - mult * a;
}

// ---- ConservativeDCA ----------------------------------------------------
// BTC/ETH only. Base order 7% of allocated capital; up to 5 safety orders on
// each further 2% drawdown with 1.25x size; TP 2.5% from average price;
// HARD stop -20% from the first entry (placed as a native exchange order
// by the engine).
export const DCA_DEFAULTS = Object.freeze({
  basePct: 0.07, maxSafety: 5, safetyStepPct: 0.02, multiplier: 1.25,
  takePct: 0.025, hardStopPct: 0.12, symbols: DCA_SYMBOLS,
  entryCooldownMs: 24 * 3600_000,
});

// dca state: null | {firstEntry, avgPrice, qty, cost, baseNotional,
//                    safetyCount, lastSafetyPrice, lastExitAt}
// price: current price; capital: allocated capital; regime: from detectRegime.
export function dcaStep({ price, dca = null, capital, now = Date.now(), regime = "range", overrides = {} }) {
  const cfg = { ...DCA_DEFAULTS, ...overrides };
  const p = Number(price), cap = Number(capital);
  if (!(p > 0) || !(cap > 0)) throw new Error("Invalid dcaStep input");
  if (!dca || !(dca.qty > 0)) {
    if (regime === "chaos") return { action: "hold", reason: "CHAOS", dca: null };
    if (dca?.lastExitAt && now - dca.lastExitAt < cfg.entryCooldownMs)
      return { action: "hold", reason: "ENTRY_COOLDOWN", dca: null };
    const notional = cap * cfg.basePct;
    return {
      action: "buy", notional, reason: "DCA_BASE",
      dca: { firstEntry: p, avgPrice: p, qty: 0, cost: 0, baseNotional: notional, safetyCount: 0, lastSafetyPrice: p, lastExitAt: dca?.lastExitAt ?? 0 },
    };
  }
  const d = { ...dca };
  if (p <= d.firstEntry * (1 - cfg.hardStopPct))
    return { action: "sell-all", reason: "DCA_HARD_STOP", dca: d, qtyToClose: d.qty };
  if (p >= d.avgPrice * (1 + cfg.takePct))
    return { action: "sell-all", reason: "DCA_TAKE", dca: d, qtyToClose: d.qty };
  if (d.safetyCount < cfg.maxSafety && p <= d.lastSafetyPrice * (1 - cfg.safetyStepPct)) {
    const v = validateAveraging(cfg.multiplier, d.safetyCount + 1);
    if (!v.allowed) return { action: "hold", reason: v.reason, dca: d };
    return { action: "buy", notional: d.baseNotional * Math.pow(cfg.multiplier, d.safetyCount + 1), reason: "DCA_SAFETY", dca: d };
  }
  return { action: "hold", reason: "DCA_WAIT", dca: d };
}

// Apply a fill to DCA state. side "buy" adds, "sell-all" closes.
export function dcaOnFill(dca, { side, price, qty, now = Date.now() }) {
  if (!dca) return { lastExitAt: now };
  if (side === "sell-all") return { lastExitAt: now };
  const p = Number(price), q = Number(qty);
  if (!(p > 0) || !(q > 0)) throw new Error("Invalid dcaOnFill");
  const cost = dca.cost + q * p, nqty = dca.qty + q;
  const wasBase = dca.qty === 0;
  return {
    ...dca,
    qty: nqty, cost, avgPrice: cost / nqty,
    safetyCount: wasBase ? dca.safetyCount : dca.safetyCount + 1,
    lastSafetyPrice: wasBase ? dca.lastSafetyPrice : p,
  };
}

// Validate a strategy configuration for the set-strategy command.
export function validateStrategyConfig(name, params = {}) {
  if (!STRATEGY_NAMES.includes(name)) return { ok: false, error: `Unknown strategy: ${name}` };
  const p = { ...(params || {}) };
  const num = (k, min, max, dflt) => {
    const v = p[k] === undefined ? dflt : Number(p[k]);
    if (!Number.isFinite(v) || v < min || v > max) return { ok: false, error: `Invalid ${k}` };
    p[k] = v; return null;
  };
  const strats = {
    "signal": [["stopPct", 0.005, 0.2, 0.03], ["takePct", 0.01, 0.5, 0.06], ["stopLimitGapPct", 0, 0.05, 0.005]],
    "trend-follow": [["stopPct", 0.005, 0.2, 0.03], ["takePct", 0.01, 0.5, 0.10], ["stopLimitGapPct", 0, 0.05, 0.005], ["trailAtrMult", 1, 5, 2.5]],
    "conservative-dca": [["stopPct", 0.05, 0.5, 0.20], ["stopLimitGapPct", 0, 0.05, 0.005], ["basePct", 0.01, 0.2, 0.07], ["takePct", 0.005, 0.1, 0.025]],
    "bounded-grid": [["stopPct", 0.01, 0.2, 0.05], ["stopLimitGapPct", 0, 0.05, 0.005]],
  };
  for (const [k, min, max, dflt] of strats[name]) {
    const err = num(k, min, max, dflt);
    if (err) return err;
  }
  return { ok: true, params: p };
}
