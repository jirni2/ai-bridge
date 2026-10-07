// risk.mjs — deterministic risk layer, separate from signal generation.
// Every order must pass vetOrder() before it is sent to the exchange.
// All limits live in RISK_DEFAULTS and are overridable via config.
// Pure functions: no I/O, no Date.now() inside vetting (time is injected).

export const RISK_DEFAULTS = Object.freeze({
  riskPerTrade: 0.01,        // 1% of capital risked per trade
  maxPerCoin: 0.10,          // max 10% of portfolio in one coin
  maxTotalExposure: 0.30,    // max 30% total exposure
  dailyLossHaltPct: 0.03,    // -3% day -> halt new entries until 00:00 UTC
  streakLossPct: 0.05,       // -5% ...
  streakDays: 2,             // ... two days in a row -> pause streakPauseDays
  streakPauseDays: 7,
  maxDrawdownPct: 0.15,      // -15% from peak -> full stop, manual review
  minOrderIntervalMs: 60_000,
  lossCooldownMs: 15 * 60_000,
  maxTradesPerDay: 20,
  maxMartingaleMultiplier: 1.5,
  maxAveragingCount: 6,
  maxBackoffAttempts: 5,     // 429/418 exponential backoff attempts
  recvWindow: 5000,
});

function cfgOf(overrides) {
  return { ...RISK_DEFAULTS, ...(overrides || {}) };
}

// Max quantity such that a move from entryPrice to stopPrice loses exactly
// riskPerTrade * capital.
export function positionSize(capital, entryPrice, stopPrice, overrides) {
  const cfg = cfgOf(overrides);
  const c = Number(capital), e = Number(entryPrice), s = Number(stopPrice);
  if (!(c > 0) || !(e > 0) || !(s > 0) || e === s) throw new Error("Invalid positionSize input");
  return (c * cfg.riskPerTrade) / Math.abs(e - s);
}

// Architectural martingale ban: averaging sequences must keep
// multiplier <= 1.5 and at most 6 averaging steps.
export function validateAveraging(multiplier, count, overrides) {
  const cfg = cfgOf(overrides);
  const m = Number(multiplier);
  if (!(m > 0) || !Number.isInteger(count) || count < 0)
    return { allowed: false, reason: "INVALID_AVERAGING_INPUT" };
  if (m > cfg.maxMartingaleMultiplier) return { allowed: false, reason: "MARTINGALE_MULTIPLIER" };
  if (count > cfg.maxAveragingCount) return { allowed: false, reason: "AVERAGING_COUNT" };
  return { allowed: true, reason: "OK" };
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function nextUtcMidnight(ms = Date.now()) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function addDaysUtc(dayStr, n) {
  return new Date(new Date(dayStr + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

// Assess a finished day: record -5% streak days and arm the 7-day pause.
// Pure: returns a new risk object, never mutates.
export function assessFinishedDay(risk, dayStr, dayPnlPct, nowMs, overrides) {
  const cfg = cfgOf(overrides);
  const r = { ...(risk || {}), lossDays: [...((risk || {}).lossDays || [])] };
  if (dayPnlPct <= -cfg.streakLossPct && !r.lossDays.includes(dayStr)) r.lossDays.push(dayStr);
  r.lossDays = r.lossDays.slice(-30);
  const last = r.lossDays.at(-1), prev = r.lossDays.at(-2);
  if (last && prev && addDaysUtc(prev, 1) === last) {
    r.pausedUntil = nowMs + cfg.streakPauseDays * 86_400_000;
    r.pauseReason = `STREAK_LOSS ${prev} + ${last}`;
  }
  return r;
}

const veto = (reason, extra) => ({ allowed: false, reason, ...(extra || {}) });

// order: {side: "BUY"|"SELL", symbol, qty?, notional?, price?, stopPrice?}
// state: {equity, peak, positions:[{symbol, notional}], halted, haltReason,
//         manualReviewRequired, pausedUntil, haltedUntil, lastOrderAt,
//         lastLossAt, tradesToday}
// nowMs injected for determinism. Exits (SELL) are always allowed: the risk
// layer must never block closing risk.
export function vetOrder(order, state, overrides, nowMs = Date.now()) {
  const cfg = cfgOf(overrides);
  const st = state || {};
  const isEntry = order?.side === "BUY";
  if (!order || (order.side !== "BUY" && order.side !== "SELL") || !order.symbol)
    return veto("INVALID_ORDER");
  if (st.halted) return veto("KILL_SWITCH");
  if (st.manualReviewRequired) return veto("MANUAL_REVIEW");
  if (st.pausedUntil && nowMs < st.pausedUntil) return veto("RISK_PAUSE");
  const peak = Number(st.peak) || 0, equity = Number(st.equity) || 0;
  if (peak > 0 && equity > 0 && (peak - equity) / peak >= cfg.maxDrawdownPct)
    return veto("MAX_DRAWDOWN", { manualReviewRequired: true });
  if (!isEntry) return { allowed: true, reason: "OK_EXIT" };
  if (st.haltedUntil && nowMs < st.haltedUntil) return veto("DAILY_LOSS_HALT");
  if (st.lastOrderAt && nowMs - st.lastOrderAt < cfg.minOrderIntervalMs) return veto("ORDER_COOLDOWN");
  if (st.lastLossAt && nowMs - st.lastLossAt < cfg.lossCooldownMs) return veto("LOSS_COOLDOWN");
  if (Number(st.tradesToday) >= cfg.maxTradesPerDay) return veto("MAX_TRADES_PER_DAY");
  const price = Number(order.price) || 0;
  const newNotional = Number(order.notional) > 0 ? Number(order.notional)
    : Number(order.qty) > 0 && price > 0 ? Number(order.qty) * price : 0;
  if (!(newNotional > 0)) return veto("INVALID_ORDER_SIZE");
  const positions = Array.isArray(st.positions) ? st.positions : [];
  const coinExp = positions.filter(p => p.symbol === order.symbol).reduce((a, p) => a + (Number(p.notional) || 0), 0);
  const totalExp = positions.reduce((a, p) => a + (Number(p.notional) || 0), 0);
  if (equity > 0) {
    if ((coinExp + newNotional) / equity > cfg.maxPerCoin) return veto("PER_COIN_EXPOSURE");
    if ((totalExp + newNotional) / equity > cfg.maxTotalExposure) return veto("TOTAL_EXPOSURE");
  }
  const stopPrice = Number(order.stopPrice);
  if (price > 0 && stopPrice > 0 && stopPrice !== price && equity > 0) {
    const maxQty = positionSize(equity, price, stopPrice, cfg);
    const qty = Number(order.qty) > 0 ? Number(order.qty) : newNotional / price;
    if (qty > maxQty * 1.000001) return veto("POSITION_SIZE");
  }
  return { allowed: true, reason: "OK" };
}

// Empty risk state for a fresh bot.
export function initialRisk() {
  return {
    peak: 0, equity: 0, dayStartEquity: 0,
    halted: false, haltReason: null,
    manualReviewRequired: false,
    pausedUntil: 0, pauseReason: null,
    haltedUntil: 0,
    lastOrderAt: 0, lastLossAt: 0,
    tradesToday: 0, tradesTodayDay: "",
    lossDays: [],
  };
}
