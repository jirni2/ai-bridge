// indicators.mjs — hand-rolled technical indicators, zero dependencies.
// All series functions return an array aligned with the input; entries are
// null until enough data has warmed up. Pure functions: safe to unit test.
function num(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${what}`);
  return n;
}
function checkPeriod(n, what) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${what} period`);
}
function closesOf(candles) {
  if (!Array.isArray(candles)) throw new Error("Invalid candles");
  return candles.map((c, i) => num(c?.close, `close[${i}]`));
}

// Simple moving average.
export function sma(values, n) {
  checkPeriod(n, "SMA");
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = num(values[i], `value[${i}]`);
    sum += v;
    if (i >= n) sum -= num(values[i - n], `value[${i - n}]`);
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// Exponential moving average, seeded with the SMA of the first n values.
export function ema(values, n) {
  checkPeriod(n, "EMA");
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += num(values[i], `value[${i}]`);
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = num(values[i], `value[${i}]`) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI.
export function rsi(values, n = 14) {
  checkPeriod(n, "RSI");
  const out = new Array(values.length).fill(null);
  if (values.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = num(values[i], `value[${i}]`) - num(values[i - 1], `value[${i - 1}]`);
    if (d > 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  const calc = () => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  out[n] = calc();
  for (let i = n + 1; i < values.length; i++) {
    const d = num(values[i], `value[${i}]`) - num(values[i - 1], `value[${i - 1}]`);
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
    out[i] = calc();
  }
  return out;
}

function candleNums(c, i) {
  return { high: num(c?.high, `high[${i}]`), low: num(c?.low, `low[${i}]`), close: num(c?.close, `close[${i}]`) };
}
function trueRange(cur, prev) {
  return Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
}

// Wilder's ATR. candles: [{high, low, close}]. First value at index n.
export function atr(candles, n = 14) {
  checkPeriod(n, "ATR");
  if (!Array.isArray(candles)) throw new Error("Invalid candles");
  const out = new Array(candles.length).fill(null);
  if (candles.length < n + 1) return out;
  const cs = candles.map(candleNums);
  let a = 0;
  for (let i = 1; i <= n; i++) a += trueRange(cs[i], cs[i - 1]);
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < cs.length; i++) {
    a = (a * (n - 1) + trueRange(cs[i], cs[i - 1])) / n;
    out[i] = a;
  }
  return out;
}

// Wilder's ADX. First value at index 2*n.
export function adx(candles, n = 14) {
  checkPeriod(n, "ADX");
  if (!Array.isArray(candles)) throw new Error("Invalid candles");
  const out = new Array(candles.length).fill(null);
  if (candles.length < 2 * n + 1) return out;
  const cs = candles.map(candleNums);
  const dxOf = (tr, pdm, mdm) => {
    const pp = 100 * pdm / tr, mp = 100 * mdm / tr;
    return pp + mp === 0 ? 0 : (100 * Math.abs(pp - mp)) / (pp + mp);
  };
  let trS = 0, pDMs = 0, mDMs = 0;
  const dxs = [];
  for (let i = 1; i < cs.length; i++) {
    const up = cs[i].high - cs[i - 1].high, down = cs[i - 1].low - cs[i].low;
    const pDM = up > down && up > 0 ? up : 0;
    const mDM = down > up && down > 0 ? down : 0;
    const tr = trueRange(cs[i], cs[i - 1]);
    if (i <= n) {
      trS += tr; pDMs += pDM; mDMs += mDM;
      if (i === n) dxs.push(dxOf(trS, pDMs, mDMs));
    } else {
      trS = trS - trS / n + tr;
      pDMs = pDMs - pDMs / n + pDM;
      mDMs = mDMs - mDMs / n + mDM;
      dxs.push(dxOf(trS, pDMs, mDMs));
    }
  }
  let a = 0;
  for (let j = 0; j < n; j++) a += dxs[j];
  a /= n;
  out[2 * n] = a;
  for (let j = n; j < dxs.length; j++) {
    a = (a * (n - 1) + dxs[j]) / n;
    out[n + j] = a;
  }
  return out;
}

// Population standard deviation.
export function stdev(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const ns = values.map((v, i) => num(v, `value[${i}]`));
  if (ns.length === 1) return 0;
  const mean = ns.reduce((a, b) => a + b, 0) / ns.length;
  return Math.sqrt(ns.reduce((a, b) => a + (b - mean) ** 2, 0) / ns.length);
}

export function highestHigh(candles, n) {
  checkPeriod(n, "highestHigh");
  const hs = candles.map((c, i) => num(c?.high, `high[${i}]`));
  if (hs.length < n) return null;
  return Math.max(...hs.slice(-n));
}
export function lowestLow(candles, n) {
  checkPeriod(n, "lowestLow");
  const ls = candles.map((c, i) => num(c?.low, `low[${i}]`));
  if (ls.length < n) return null;
  return Math.min(...ls.slice(-n));
}
