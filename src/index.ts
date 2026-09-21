import 'dotenv/config';
import { getMarketState } from "./market/collector.js";
import { getRetailExposure } from "./sentiment/fxssi-collector.js";
import { getMacroState } from "./macro/calendar.js";
import { getJevDecision } from "./jev/jev-client.js";
import { getFvgState } from "./structure/fvg-engine.js";
import { checkRisk } from "./execution/risk-guard.js";
import { sendTelegram } from "./notifications/telegram.js";

async function main() {
  const market = await getMarketState() as any;
  const d1High = market.d1_high ?? market.d1High;
  const d1Low = market.d1_low ?? market.d1Low;
  const sentiment = await getRetailExposure(market.symbol);
  const macro = await getMacroState(market.symbol, d1High, d1Low, market.price);
  const jev = await getJevDecision(market);
  const fvg = await getFvgState(market.symbol, market, macro, jev);
  const guard = checkRisk(market, jev as never, { market, sentiment, macro, jev, fvg });

  const macroRange = (macro.dealing_range ?? "").toLowerCase();
  const jevRange = (jev.dealing_range.value ?? "").toLowerCase();
  const htfBias =
    macroRange === "premium" && jevRange === "premium" ? "BEARISH"
    : (macroRange === "discount" || jevRange === "discount") && macroRange !== "premium" && jevRange !== "premium" ? "BULLISH"
    : "COMPRESSION";

  const smtVal = jev.smt_divergence.value;
  const smtNote = smtVal.toLowerCase() === "confirmed" ? "uzlaşma var" : "SMT divergence - institusional yığılma";

  const report =
`VALYUTA CÜTLÜYÜ: ${market.symbol} | HTF BIAS: ${htfBias}

1. RETAIL EXPOSURE & SENTIMENT ENGINEERING
Həqiqi Ortalama: BUY ${sentiment.real_buy_avg}%, SELL ${sentiment.real_sell_avg}% (Insta və FiboGroup xaric edildi).
Pain Threshold (Ağrı Həddi): Retail kütlənin çoxluğu ${sentiment.retail_direction}-dədir. Onların Stop-Loss yığıntısı böyük ehtimalla ${sentiment.pain_threshold} zonasında cəmləşib.
Alqoritmik Hədəf: Smart Money bu zonanı ${sentiment.algorithmic_target}

2. MACRO DEALING RANGE & VOLATILITY REGIME (D1/4H)
Volatility Regime: ${macro.volatility_regime}
Dealing Range Equilibrium: Qiymət hazırda ${macro.dealing_range}-dadır.
Delivery Cycle: Qiymət hazırda ${macro.delivery_cycle} rejimində hərəkət edir.
Institutional Draw on Liquidity (DOL): Alqoritmin əsas hədəfi ${macro.primary_dol}-dir.
Macro Catalyst: ${macro.macro_catalyst} - ${macro.note}

3. LIQUIDITY SEQUENCING & CROSS-MARKET SMT (1H/15M)
Engineered Liquidity Path: Market Trendline formalaşdıraraq ${sentiment.inducement_plan}
SMT Divergence Status: ${smtVal} - DXY ilə ${smtNote}
Session AMD Timing: Asia Range ${jev.is_asia_sweep_complete.value ? "Təmizlənib - Judas Swing baş verib" : "Təmizlənməyib - Judas Swing gözlənilir"}.

4. "WHY NOW?" EXECUTION PROTOCOL (5M/1M)
Likvidlik Təciliyi (Urgency): ${fvg.why_now.urgency_ok ? "Bəli - Alqoritm məcburi çatdırılma etməlidir" : "Xeyr"} - Səbəb: ${fvg.why_now.decision}
Displacement Quality: ${fvg.displacement_quality} - ${fvg.rebalancing_note}
Optimal Trade Entry (OTE): Qiymət HTF konteksti daxilində 62-79% retracement ${fvg.ote.is_in_ote ? "zonasına uyğundur" : "zonasında deyil"} - OTE: ${fvg.ote.low} - ${fvg.ote.high}
FVG Status: ${fvg.fvg_state.defended.status} - ${fvg.fvg_state.defended.type} FVG ${fvg.fvg_state.defended.low}-${fvg.fvg_state.defended.high}

5. 🛡 INSTITUTIONAL ORDER TICKET
Qərar: ${guard.allowed ? jev.execution_decision.value : "STAND ASIDE (GÖZLƏ)"}
Entry Zone (Refined): ${fvg.ote.low} - ${fvg.ote.high} / ${fvg.fvg_state.defended.low} FVG
Hard Invalidation (SL): ${fvg.invalidation.level} - ${fvg.invalidation.reason} - Bu səviyyə qırılsa alqoritm pozulur
Alqoritmik Hədəflər:
 > TP1 (Risk Free & Partial): ${guard.risk_params.target_1} - Internal Liquidity
 > TP2 (Main Objective): ${macro.primary_dol} - External BSL/SSL
 > TP3 (Macro Runner): HTF DOL ${macro.primary_dol}
R/R Nisbəti: ${guard.risk_params.rr}
Trade Confidence Score: ${jev.final_confidence}% (Timing: ${fvg.why_now.timing_ok}, SMT: ${smtVal}, Sweep: ${jev.is_asia_sweep_complete.value})

6. ⚠ FATAL FLAW CHECK & CHALLENGE QUESTION
Bias Destruction Risk: "Əgər ${fvg.invalidation.level} səviyyəsi bu gün təmizlənməzsə, mənim bu analizim tamamilə səhvdir, çünki Market Maker dəstəyi pozulur və alqoritmik struktur External-to-Internal keçməyib."
Critical AI Challenge: "Əgər DXY doğrudan da ${smtVal.toLowerCase().includes("bearish") ? "bearish" : "bullish"}-dirsə, niyə hazırkı ${market.symbol} hərəkəti ${fvg.displacement_quality === "low momentum" ? "xırda həcmlə baş verir? Bəlkə bu, sadəcə NY sessiyası üçün likvidlik tələsidir?" : "aqressiv displacement göstərir? Bu, məcburi çatdırılmanın başlanğıcıdırmı?"}"`;

  if (guard.allowed) {
    console.log(report);
    await sendTelegram(report);
  } else {
    console.log("🛑 NO TRADE - " + guard.reason + "\n\n" + report);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("index.ts")) main();
