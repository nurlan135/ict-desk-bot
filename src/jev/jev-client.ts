import 'dotenv/config';
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { MarketState } from "../market/collector.js";

// JEV mətn yazmır, yalnız typed qərar qaytarır.

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
}

export interface EurusdMarketState {
  symbol: string;
  price: number;
  d1_high: number;
  d1_low: number;
  asia_high: number;
  asia_low: number;
  dxy_price: number;
  session: string;
}

type AnyState = MarketState | EurusdMarketState;

function loadApiKey(): string | undefined {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.trim().match(/^TYPESAFE_API_KEY\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

function norm(state: AnyState): EurusdMarketState {
  const s = state as Record<string, unknown>;
  return {
    symbol: "EURUSD",
    price: s.price as number,
    d1_high: s.d1_high as number,
    d1_low: s.d1_low as number,
    asia_high: (s.asia_high ?? s.overnight_high) as number,
    asia_low: (s.asia_low ?? s.overnight_low) as number,
    dxy_price: (s.dxy_price ?? s.spx_price) as number,
    session: s.session as string,
  };
}

function mockDecision(input: AnyState): JevDecision {
  const state = norm(input);
  const dealing_range: DealingRange = state.price > (state.d1_high + state.d1_low) / 2 ? "Premium" : "Discount";
  const sweep = state.price > state.asia_high || state.price < state.asia_low;
  const smt_divergence: SmtDivergence = state.dxy_price > 104.5 ? "Divergence - Accumulation" : "Confirmed";
  let execution_decision: ExecutionDecision;
  if (state.session === "DEAD_ZONE") {
    execution_decision = "STAND_ASIDE";
  } else if (!sweep) {
    execution_decision = "STAND_ASIDE";
  } else if (dealing_range === "Discount") {
    execution_decision = "EXECUTE_LONG";
  } else if (dealing_range === "Premium") {
    execution_decision = "EXECUTE_SHORT";
  } else {
    execution_decision = "STAND_ASIDE";
  }
  return {
    dealing_range: { value: dealing_range, confidence: 0.92 },
    is_asia_sweep_complete: { value: sweep, confidence: 0.85 },
    smt_divergence: { value: smt_divergence, confidence: 0.8 },
    execution_decision: { value: execution_decision, confidence: 0.85 },
    final_confidence: 85,
  };
}

export async function getJevDecision(state: AnyState): Promise<JevDecision> {
  const key = loadApiKey();
  if (!key) return mockDecision(state);
  try {
    const res = await fetch("https://api.typesafe.ai/v1/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        state: norm(state),
        questions: [
          { id: "dealing_range", type: "choice", options: ["Premium", "Discount", "Equilibrium"] },
          { id: "is_asia_sweep_complete", type: "boolean" },
          { id: "smt_divergence", type: "choice", options: ["Confirmed", "Divergence - Accumulation", "No Correlation"] },
          { id: "execution_decision", type: "choice", options: ["EXECUTE_LONG", "EXECUTE_SHORT", "STAND_ASIDE"] },
          { id: "confidence", type: "score", min: 0, max: 100 },
        ],
      }),
    });
    if (!res.ok) return mockDecision(state);
    const data = (await res.json()) as JevDecision;
    if (!data.dealing_range || !data.execution_decision || typeof data.final_confidence !== "number") {
      return mockDecision(state);
    }
    return data;
  } catch {
    return mockDecision(state);
  }
}

import { getMarketState } from "../market/collector.js";
async function main() {
  const market = await getMarketState();
  const decision = await getJevDecision(market);
  console.log(JSON.stringify({ market, jev: decision }, null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("jev-client.ts")) main();
