export interface GuardMarket {
  symbol: string;
  price: number;
  d1_high: number;
  d1_low: number;
  asia_high?: number;
  asia_low?: number;
  overnight_high?: number;
  overnight_low?: number;
  session: string;
}

export interface GuardJev {
  dealing_range: { value: string; confidence: number };
  is_asia_sweep_complete?: { value: boolean; confidence: number };
  is_overnight_sweep_complete?: { value: boolean; confidence: number };
  execution_decision: { value: string; confidence: number };
  final_confidence?: number;
  confidence?: number;
}

export interface RiskGuardResult {
  allowed: boolean;
  reason: string;
  risk_params: {
    invalidation: number;
    target_1: number;
    target_2: number;
    risk_percent: number;
    rr: string;
  };
}

export function checkRisk(market: GuardMarket, jev: GuardJev, _report?: unknown): RiskGuardResult {
  const asiaHigh = market.asia_high ?? market.overnight_high ?? 0;
  const asiaLow = market.asia_low ?? market.overnight_low ?? 0;
  const sweep = jev.is_asia_sweep_complete?.value ?? jev.is_overnight_sweep_complete?.value ?? false;
  const confidence = jev.final_confidence ?? jev.confidence ?? 85;
  const range = jev.dealing_range.value;
  const execution = jev.execution_decision.value;
  const isLong = execution === "EXECUTE_LONG";
  const invalidation = isLong ? asiaLow : asiaHigh;
  const target_1 = isLong ? market.d1_high : market.d1_low;

  const params = {
    invalidation,
    target_1,
    target_2: market.d1_high,
    risk_percent: 0.5,
    rr: "1:2.5",
  };

  if (market.session === "DEAD_ZONE") {
    return { allowed: false, reason: "REJECT - TIME > PRICE - Dead Zone", risk_params: params };
  }
  if (!sweep) {
    return { allowed: false, reason: "REJECT - Liquidity not taken", risk_params: params };
  }
  if (confidence < 70) {
    return { allowed: false, reason: "REJECT - Low confidence", risk_params: params };
  }
  if (range === "Premium" && execution === "EXECUTE_LONG") {
    return { allowed: false, reason: "REJECT - Premium long qadağandır", risk_params: params };
  }
  if (range === "Discount" && execution === "EXECUTE_SHORT") {
    return { allowed: false, reason: "REJECT - Discount short qadağandır", risk_params: params };
  }
  return { allowed: true, reason: "APPROVED", risk_params: params };
}

import { getMarketState } from "../market/collector.js";
import { getJevDecision } from "../jev/jev-client.js";
import { generateReport } from "../report/generator.js";
async function main() {
  const market = await getMarketState();
  const jev = await getJevDecision(market);
  const report = generateReport(market as never, jev as never);
  const guard = checkRisk(market as never, jev as never, report);
  console.log(JSON.stringify(guard, null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("risk-guard.ts")) main();
