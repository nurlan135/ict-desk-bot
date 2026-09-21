import { get15MCandles } from "../market/collector.js";
import { getMarketState } from "../market/collector.js";

export interface FvgState {
  fvg_state: {
    defended: { type: string; high: number; low: number; status: string; reaction: string };
    weak: { type: string; high: number; low: number; status: string };
  };
  displacement_quality: "aggressive" | "low momentum";
  why_now: { timing_ok: boolean; purge_ok: boolean; urgency_ok: boolean; decision: "EXECUTE" | "WAIT FOR MANIPULATION" };
  ote: { high: number; low: number; is_in_ote: boolean };
  invalidation: { level: number; reason: string };
  rebalancing_note: string;
}

const BUF = 0.0002;
const PIP5 = 0.0005;

export async function getFvgState(symbol: string, market: any, macro: any, jev: any): Promise<FvgState> {
  const norm = symbol.includes("/") ? symbol : symbol === "EURUSD" ? "EUR/USD" : symbol;
  const candles = await get15MCandles(norm);
  const price = market?.price ?? candles[candles.length - 1].close;
  const d1High = market?.d1_high ?? Math.max(...candles.map(c => c.high));
  const d1Low = market?.d1_low ?? Math.min(...candles.map(c => c.low));
  const range = d1High - d1Low;

  const fvgs: { type: "Bullish" | "Bearish"; high: number; low: number; idx: number }[] = [];
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].low > candles[i - 2].high + BUF)
      fvgs.push({ type: "Bullish", high: candles[i].low, low: candles[i - 2].high, idx: i });
    else if (candles[i - 2].low > candles[i].high + BUF)
      fvgs.push({ type: "Bearish", high: candles[i - 2].low, low: candles[i].high, idx: i });
  }
  const recent = fvgs.slice(-5);

  let defended = recent[recent.length - 1];
  let weak: typeof defended | undefined;
  for (const f of recent) {
    const after = candles.slice(f.idx + 1, f.idx + 4);
    const touched = after.some(c => c.low <= f.high && c.high >= f.low);
    if (!touched) { weak = f; continue; }
    const retest = candles.slice(f.idx + 1);
    const held = retest.some((c, k) => {
      if (c.low > f.low && c.low < f.high) {
        const body = Math.abs(c.close - c.open);
        const rng = c.high - c.low || 1e-9;
        return body / rng > 0.6 && (f.type === "Bullish" ? c.close > f.high : c.close < f.low) && k > 0;
      }
      return false;
    });
    if (held) defended = f; else if (!weak) weak = f;
  }
  if (!defended) defended = recent[recent.length - 1] ?? { type: price >= (d1High + d1Low) / 2 ? "Bearish" : "Bullish", high: price + range * 0.05, low: price - range * 0.05, idx: -1 };
  if (!weak) weak = recent.length > 1 ? recent[0] : { type: defended.type === "Bullish" ? "Bearish" : "Bullish", high: d1High, low: d1High - range * 0.02, idx: -1 };

  const last = candles[candles.length - 1];
  const bodyRatio = Math.abs(last.close - last.open) / ((last.high - last.low) || 1e-9);
  const displacement_quality = bodyRatio > 0.6 ? "aggressive" : "low momentum";

  const timing_ok = market?.session === "LONDON" || market?.session === "NY_AM" || market?.session === "NY_PM";
  const purge_ok = (jev?.is_asia_sweep_complete?.value ?? jev?.is_overnight_sweep_complete?.value) === true;
  const urgency_ok = (macro?.is_pre_news_trap === false && macro?.volatility_regime !== "Compression") || Math.abs(price - (d1High + d1Low) / 2) > range * 0.3;
  const decision = timing_ok && purge_ok && urgency_ok ? "EXECUTE" : "WAIT FOR MANIPULATION";

  const oteHigh = Math.round((d1Low + range * 0.79) * 100000) / 100000;
  const oteLow = Math.round((d1Low + range * 0.62) * 100000) / 100000;
  const is_in_ote = price <= oteHigh && price >= oteLow;

  const win = candles.slice(-10);
  const swingLow = Math.min(...win.map(c => c.low));
  const swingHigh = Math.max(...win.map(c => c.high));
  const mid = (d1High + d1Low) / 2;
  const isShort = (jev?.execution_decision?.value ?? jev?.dealing_range?.value) === "EXECUTE_SHORT" || price > mid;
  const invalidation = isShort
    ? { level: Math.round((swingHigh + PIP5) * 100000) / 100000, reason: "15M swing high + 5 pip" }
    : { level: Math.round((swingLow - PIP5) * 100000) / 100000, reason: "15M swing low - 5 pip" };

  return {
    fvg_state: {
      defended: { ...defended, status: "Defended", reaction: displacement_quality },
      weak: { ...weak!, status: "Weak - Liquidity Target" },
    },
    displacement_quality,
    why_now: { timing_ok, purge_ok, urgency_ok, decision },
    ote: { high: oteHigh, low: oteLow, is_in_ote },
    invalidation,
    rebalancing_note: `${symbol} real FVG: ${recent.length} FVG son 50 şamda - ${displacement_quality} displacement`,
  };
}

async function main() {
  const market = await getMarketState().catch(() => null);
  const m = market ?? { symbol: "EUR/USD", price: 1.085, d1_high: 1.09, d1_low: 1.08, session: "LONDON" };
  const st = await getFvgState("EUR/USD",
    { ...m, price: (m as any).price, d1_high: (m as any).d1_high, d1_low: (m as any).d1_low, session: (m as any).session },
    { is_pre_news_trap: false, volatility_regime: "Expansion" },
    { is_asia_sweep_complete: { value: true }, execution_decision: { value: "EXECUTE_LONG" } });
  console.log(JSON.stringify(st, null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("fvg-engine.ts")) main();
