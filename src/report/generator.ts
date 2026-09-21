export interface ReportMarket {
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

export interface ReportJev {
  dealing_range: { value: string; confidence: number };
  is_asia_sweep_complete?: { value: boolean; confidence: number };
  is_overnight_sweep_complete?: { value: boolean; confidence: number };
  smt_divergence?: { value: string; confidence: number };
  smt_with_spx?: { value: string; confidence: number };
  execution_decision: { value: string; confidence: number };
  final_confidence?: number;
  confidence?: number;
}

export interface InstitutionalReport {
  symbol: string;
  timestamp_utc: string;
  session: string;
  jev_summary: string;
  modules: {
    "1_liquidity_map": string;
    "2_dealing_range": string;
    "3_market_maker_model": string;
    "4_smt_divergence": string;
    "5_execution_objective": string;
    "6_risk": string;
  };
  final_decision: string;
  confidence: number;
}

export function generateReport(market: ReportMarket, jev: ReportJev): InstitutionalReport {
  const symbol = market.symbol.replace("/", "");
  const asiaHigh = market.asia_high ?? market.overnight_high ?? 0;
  const asiaLow = market.asia_low ?? market.overnight_low ?? 0;
  const sweep = jev.is_asia_sweep_complete?.value ?? jev.is_overnight_sweep_complete?.value ?? false;
  const smt = jev.smt_divergence?.value ?? jev.smt_with_spx?.value ?? "No Correlation";
  const range = jev.dealing_range.value;
  const decision = jev.execution_decision.value;
  const confidence = jev.final_confidence ?? jev.confidence ?? 85;

  const jev_summary = `${decision} - ${range}, sweep ${sweep}`;

  const m1 = `D1 High: ${market.d1_high} - D1 Low: ${market.d1_low}. Asia High: ${asiaHigh} Low: ${asiaLow}. Current ${market.price} internal range-dədir.`;

  const m2 =
    range === "Premium"
      ? `Premium - Price 50% üzərindədir. Discount-a qayıtmayana qədər long qadağandır.`
      : range === "Discount"
        ? `Discount - Price 50% altındadır. Premium-a qayıtmayana qədər short qadağandır.`
        : `Equilibrium - Price 50% zonasındadır. Kənarlaşmanı gözlə. Trade qadağandır.`;

  const m3 = sweep
    ? `Manipulation tamamlanıb. Asia High/Low süpürülüb. EXPANSION GÖZLƏ.`
    : `Manipulation tamamlanmayıb. Asia High/Low süpürülməyib. WAIT FOR MANIPULATION.`;

  const m4 = `DXY ilə korrelyasiya: ${smt}.`;

  let m5: string;
  if (decision === "STAND_ASIDE") {
    m5 = `NO OBJECTIVE - STAND_ASIDE. Səbəb: ${market.session} + sweep ${sweep} + ${range}`;
  } else if (decision === "EXECUTE_LONG") {
    m5 = `LONG OBJECTIVE - Hədəf: D1 High ${market.d1_high}. Invalidation: Asia Low ${asiaLow}.`;
  } else {
    m5 = `SHORT OBJECTIVE - Hədəf: D1 Low ${market.d1_low}. Invalidation: Asia High ${asiaHigh}.`;
  }

  const m6 =
    decision === "STAND_ASIDE"
      ? `Invalidation: Asia High üzəri. Mandatory Delivery: Asia Low. Risk: 0 - Trade yoxdur.`
      : decision === "EXECUTE_LONG"
        ? `Invalidation: Asia Low ${asiaLow} altı. Mandatory Delivery: D1 High ${market.d1_high}.`
        : `Invalidation: Asia High ${asiaHigh} üzəri. Mandatory Delivery: D1 Low ${market.d1_low}.`;

  return {
    symbol,
    timestamp_utc: new Date().toISOString(),
    session: market.session,
    jev_summary,
    modules: {
      "1_liquidity_map": m1,
      "2_dealing_range": m2,
      "3_market_maker_model": m3,
      "4_smt_divergence": m4,
      "5_execution_objective": m5,
      "6_risk": m6,
    },
    final_decision: decision,
    confidence,
  };
}

import { getMarketState } from "../market/collector.js";
import { getJevDecision } from "../jev/jev-client.js";
async function main() {
  const market = await getMarketState();
  const jev = await getJevDecision(market);
  const report = generateReport(market as unknown as ReportMarket, jev as unknown as ReportJev);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("generator.ts")) main();
