// metrics.mjs — shared performance-metric computation for the dashboard
// contract and the backtester. Pure functions.
import { stdev } from "./indicators.mjs";

function sum(xs) { return xs.reduce((a, b) => a + b, 0); }

// trades: [{pnl, time?, ...}] closed trades (pnl defined)
// equityCurve: [{day, equity}] daily snapshots, ascending
// currentEquity: latest portfolio value (quote currency)
export function computeMetrics({ trades = [], equityCurve = [], currentEquity = null } = {}) {
  const closed = trades.filter(t => Number.isFinite(t?.pnl));
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const grossWin = sum(wins.map(t => t.pnl));
  const grossLoss = sum(losses.map(t => Math.abs(t.pnl)));
  const total = closed.length;
  const winRate = total ? wins.length / total : null;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const avgWin = wins.length ? grossWin / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;

  const eq = equityCurve.map(p => Number(p.equity)).filter(Number.isFinite);
  let sharpe = null, maxDrawdown = null, calmar = null, currentDrawdown = null, peak = null;
  if (eq.length >= 2) {
    const rets = [];
    for (let i = 1; i < eq.length; i++) if (eq[i - 1] > 0) rets.push((eq[i] - eq[i - 1]) / eq[i - 1]);
    const sd = stdev(rets);
    if (rets.length >= 2 && sd > 0) {
      const mean = sum(rets) / rets.length;
      sharpe = (mean / sd) * Math.sqrt(365);
    }
    peak = eq[0];
    maxDrawdown = 0;
    for (const v of eq) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? (peak - v) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const years = eq.length / 365;
    if (years > 0 && eq[0] > 0 && maxDrawdown > 0) {
      const cagr = Math.pow(eq.at(-1) / eq[0], 1 / years) - 1;
      calmar = cagr / maxDrawdown;
    }
  }
  const cur = Number.isFinite(currentEquity) ? currentEquity : eq.at(-1);
  if (Number.isFinite(cur) && peak > 0) currentDrawdown = Math.max(0, (peak - cur) / peak);

  // Concentration: share of gross profit coming from the top 1-2 trades.
  let topShare = 0;
  if (grossWin > 0) {
    const sorted = wins.map(t => t.pnl).sort((a, b) => b - a);
    topShare = sum(sorted.slice(0, 2)) / grossWin;
  }
  return {
    trades: total, winRate, profitFactor, sharpe, maxDrawdown, calmar,
    avgWin, avgLoss, currentDrawdown, peak, topShare,
  };
}

// Aggregate per-trade PnL by UTC month: {"2026-09": 12.5}.
export function monthlyPnl(trades = []) {
  const out = {};
  for (const t of trades) {
    if (!Number.isFinite(t?.pnl) || !Number.isFinite(t?.time)) continue;
    const m = new Date(t.time).toISOString().slice(0, 7);
    out[m] = (out[m] || 0) + t.pnl;
  }
  return out;
}
