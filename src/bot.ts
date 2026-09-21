import 'dotenv/config';
import cron from "node-cron";
import { getGlobalSession, getMarketState } from "./market/collector.js";
import { getRetailExposure } from "./sentiment/fxssi-collector.js";
import { getMacroState } from "./macro/calendar.js";
import { getFvgState } from "./structure/fvg-engine.js";
import { getJevDecision } from "./jev/jev-client.js";
import { checkRisk } from "./execution/risk-guard.js";
import { placeMT5Order } from "./execution/mt5-client.js";
import { placePaperOrder, checkPaperOrders, getPaperStats } from "./execution/paper-client.js";
import { loadState, saveState } from "./memory/state.js";
import { sendTelegram } from "./notifications/telegram.js";

const SYMBOL = "EUR/USD";

function d1(m: any): { h: number; l: number } {
  return { h: m.d1_high ?? m.d1High ?? 0, l: m.d1_low ?? m.d1Low ?? 0 };
}

async function runIntelligence() {
  const state = loadState();
  const session = getGlobalSession();
  const market = await getMarketState() as any;
  const { h, l } = d1(market);
  const sentiment = await getRetailExposure(market.symbol);
  const macro = await getMacroState(market.symbol, h, l, market.price);
  const now = new Date().toISOString();

  state.last_intel_utc = now;
  state.sentiment_history.push({ time: now, buy: sentiment.real_buy_avg, sell: sentiment.real_sell_avg });
  if (state.sentiment_history.length > 168) state.sentiment_history.shift();
  if (sentiment.is_extreme && !state.retail_extreme_start) state.retail_extreme_start = now;
  if (!sentiment.is_extreme) state.retail_extreme_start = null;
  if (session.session === "ASIA") { state.asia.high = h; state.asia.low = l; }
  saveState(state);

  console.log(`[INTEL] ${session.nyTime} ${session.session} Retail ${sentiment.real_buy_avg}% ${sentiment.retail_direction} Macro ${macro.dealing_range} CanTrade ${macro.can_trade}`);
  return { session, market, sentiment, macro };
}

async function runExecution() {
  let ctx;
  try {
    ctx = await runIntelligence();
  } catch (e) {
    console.error("INTEL ERROR:", (e as Error).message);
    return;
  }
  const { session, market, sentiment, macro } = ctx;

  if (!session.can_execute) { console.log("NY deyil - yalnız intel"); return; }
  if (!macro.can_trade) { console.log(`BLOCKED: ${macro.fatal_flaw}`); return; }

  const jev = await getJevDecision(market);
  const fvg = await getFvgState(market.symbol, market, macro, jev);
  const risk = checkRisk(market, jev as never, { market, sentiment, macro, fvg });
  const side = jev.execution_decision.value === "EXECUTE_SHORT" ? "SELL" : "BUY";

  if (fvg.why_now.decision !== "EXECUTE" || !risk.allowed) {
    console.log(`NO_TRADE: ${fvg.rebalancing_note} - ${risk.reason}`);
    return;
  }

  const entry = Number(market.price.toFixed(5));
  const sl = fvg.invalidation.level;
  const tp = Number((risk.risk_params.target_1 ?? fvg.ote.high).toFixed(5));
  const rrNum = Number((Math.abs(tp - entry) / (Math.abs(entry - sl) || 1e-9)).toFixed(2));

  let order: any;
  let via = "MT5";
  try {
    const out = await placeMT5Order({ symbol: market.symbol, side: side as "BUY" | "SELL", entry, sl, tp, rr: rrNum });
    order = { id: "MT5", side, entry, sl, tp };
    console.log(String(out).slice(0, 200));
  } catch (e) {
    console.log("MT5 bağlı deyil, Paper-a düşür");
    via = "PAPER";
    order = await placePaperOrder({
      symbol: market.symbol, side: side as "BUY" | "SELL", entry, sl, tp, rr: rrNum,
      reason: `${fvg.rebalancing_note} | Retail ${sentiment.real_buy_avg}% ${sentiment.retail_direction} | ${macro.dealing_range}`,
    });
  }

  const stats = getPaperStats();
  const state = loadState();
  state.last_exec_utc = new Date().toISOString();
  saveState(state);
  const report = `🏦 INSTITUTIONAL DESK | ${market.symbol} | ${session.nyTime} NY | ${fvg.why_now.decision} (${via})
M1 Market: ${session.session} Price ${market.price}
M2 Macro: ${macro.dealing_range} Bias ${macro.htf_bias} News ${macro.can_trade ? "CLEAR ✅" : "BLOCKED ❌"}
M3 Retail: ${sentiment.real_buy_avg}% ${sentiment.retail_direction} Extreme ${sentiment.is_extreme ? "YES" : "NO"} Pain ${sentiment.pain_threshold}
M4 Structure: FVG ${fvg.fvg_state?.defended?.status} ${fvg.fvg_state?.defended?.type ?? ""} ${fvg.fvg_state?.defended?.low}-${fvg.fvg_state?.defended?.high}
M5 Risk: RR ${risk.risk_params.rr} Allowed ${risk.allowed}
M6 WHY NOW: ${fvg.rebalancing_note} Urgency ${fvg.why_now.urgency_ok ? "OK ✅" : "WAIT"}
Order: ${order?.id || "MT5 Pending"} ${order.side} @${order.entry} | Stats ${stats.wins}W/${stats.losses}L ${stats.winRate}`;

  await sendTelegram(report);
  await checkPaperOrders(market.price, market.symbol);
}

const ONCE = process.argv.includes("--once") || process.env.BOT_ONCE === "1";

async function main() {
  if (ONCE) {
    const { is_ny } = getGlobalSession();
    if (is_ny) await runExecution().catch(e => console.error("EXEC:", e));
    else await runIntelligence().catch(e => console.error("INTEL:", e));
    process.exit(0);
  }
  cron.schedule("0 * * * *", () => runIntelligence().catch(e => console.error("INTEL CRON:", e)));
  cron.schedule("*/5 * * * *", () => runExecution().catch(e => console.error("EXEC CRON:", e)));
  console.log("🚀 INSTITUTIONAL BOT PRODUCTION STARTED - Paper + Free MT5");
  void runIntelligence();
}
void main();

export { SYMBOL };
