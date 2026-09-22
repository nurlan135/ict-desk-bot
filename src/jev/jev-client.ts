import 'dotenv/config';
import type { MarketState } from "../market/collector.js";

export type DealingRange = "Premium" | "Discount" | "Equilibrium";
export type SmtDivergence = "Confirmed" | "Divergence - Accumulation" | "No Correlation";
export type ExecutionDecision = "EXECUTE_LONG" | "EXECUTE_SHORT" | "STAND_ASIDE";

export interface TypedAnswer<T> {
  value: T;
  confidence: number;
}

export interface JevDecision {
  dealing_range: TypedAnswer<DealingRange>;
  is_asia_sweep_complete: TypedAnswer<boolean>;
  smt_divergence: TypedAnswer<SmtDivergence>;
  execution_decision: TypedAnswer<ExecutionDecision>;
  final_confidence: number;
  _mode?: string;
}

type AnyState = MarketState | Record<string, any>;

function pick(s: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) if (s[k] !== undefined) return s[k];
  return undefined;
}

export async function getJevDecision(marketState: AnyState): Promise<JevDecision> {
  const s = marketState as Record<string, any>;
  console.log(`[JEV] Mode: REAL LOCAL ✅ | Symbol: ${s.symbol} | Price: ${s.price}`);

  const price = s.price as number;
  const d1_high = pick(s, "d1_high", "d1High") as number;
  const d1_low = pick(s, "d1_low", "d1Low") as number;
  const asia_high = pick(s, "asia_high", "overnight_high") as number | undefined;
  const asia_low = pick(s, "asia_low", "overnight_low") as number | undefined;
  const mid = (d1_high + d1_low) / 2;
  const range = d1_high - d1_low || 1e-9;

  let dealing_range: DealingRange;
  if (price > mid + range * 0.1) dealing_range = "Premium";
  else if (price < mid - range * 0.1) dealing_range = "Discount";
  else dealing_range = "Equilibrium";

  const is_asia_sweep_complete = asia_high !== undefined ? (price > asia_high || (asia_low !== undefined && price < asia_low)) : false;

  const smt_divergence: SmtDivergence = dealing_range !== "Equilibrium" ? "Confirmed" : "No Correlation";

  let execution_decision: ExecutionDecision = "STAND_ASIDE";
  const session = s.session as string;
  if (session === "DEAD_ZONE" || session === "OFF") execution_decision = "STAND_ASIDE";
  else if (!is_asia_sweep_complete) execution_decision = "STAND_ASIDE";
  else if (dealing_range === "Discount") execution_decision = "EXECUTE_LONG";
  else if (dealing_range === "Premium") execution_decision = "EXECUTE_SHORT";
  else execution_decision = "STAND_ASIDE";

  const distanceFromMid = Math.abs(price - mid) / range;
  const final_confidence = Math.round(70 + distanceFromMid * 60);

  const result: JevDecision = {
    dealing_range: { value: dealing_range, confidence: 0.9 },
    is_asia_sweep_complete: { value: is_asia_sweep_complete, confidence: 0.85 },
    smt_divergence: { value: smt_divergence, confidence: 0.8 },
    execution_decision: { value: execution_decision, confidence: 0.9 },
    final_confidence,
    _mode: "REAL LOCAL ✅",
  };

  console.log(`[JEV] Decision: ${result.execution_decision.value} | Confidence: ${result.final_confidence}% | Range: ${result.dealing_range.value} | Sweep: ${result.is_asia_sweep_complete.value} | Session: ${session}`);

  return result;
}

import { getMarketState } from "../market/collector.js";
async function main() {
  const market = await getMarketState();
  const decision = await getJevDecision(market);
  console.log(JSON.stringify({ market, jev: decision }, null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("jev-client.ts")) main();
