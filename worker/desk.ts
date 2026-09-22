/// <reference types="@cloudflare/workers-types" />
export interface Env {
  TWELVEDATA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  SYMBOL?: string;
  STATE?: KVNamespace;
}

const BUF = 0.0002;
const PIP5 = 0.0005;

type Session = "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | "DEAD_ZONE";

function getGlobalSession(date = new Date()) {
  const nyHour = Number(date.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
  const nyMin = Number(date.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
  const utcHour = date.getUTCHours();
  let session: Session;
  if (nyHour >= 20 || nyHour < 2) session = "ASIA";
  else if (nyHour >= 2 && nyHour < 5) session = "LONDON";
  else if (nyHour >= 7 && nyHour < 10) session = "NY_AM";
  else if (nyHour >= 10 && nyHour < 12) session = "NY_PM";
  else session = "DEAD_ZONE";
  const is_ny = session === "NY_AM" || session === "NY_PM";
  return {
    nyTime: `${String(nyHour).padStart(2, "0")}:${String(nyMin).padStart(2, "0")} NY`,
    session, is_ny, can_execute: is_ny,
    utc: `${String(utcHour).padStart(2, "0")}:${String(nyMin).padStart(2, "0")} UTC`,
  };
}

async function tg(env: Env, text: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

async function kvGet(env: Env, key: string, fb: any) {
  try {
    if (!env.STATE) return fb;
    const v = await env.STATE.get(key, "json");
    return v ?? fb;
  } catch { return fb; }
}

async function kvPut(env: Env, key: string, val: any) {
  try { if (env.STATE) await env.STATE.put(key, JSON.stringify(val)); } catch {}
}

async function tdCandles(symbol: string, key: string, size: number) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=15min&outputsize=${size}&timezone=UTC&order=DESC&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TD ${res.status}`);
  const data = await res.json() as { values?: any[]; status?: string };
  if (data.status === "error" || !Array.isArray(data.values)) throw new Error("TD no data");
  return data.values.reverse().map((c: any) => ({
    high: Number(c.high), low: Number(c.low), close: Number(c.close),
    open: Number(c.open), datetime: String(c.datetime),
  }));
}

function toMinUTC(dt: string): number {
  const d = new Date(dt.endsWith("Z") ? dt : dt.replace(" ", "T") + "Z");
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

async function getSentiment(symbol: string) {
  const norm = symbol.replace("/", "").toUpperCase();
  const res = await fetch("https://fxssi.com/api/current-ratios", { headers: { "User-Agent": "Mozilla/5.0 InstitutionalEngine" } });
  if (!res.ok) throw new Error(`FXSSI ${res.status}`);
  const data = await res.json() as { brokers?: Record<string, Record<string, string>>; broker_titles?: Record<string, string> };
  if (!data.brokers) throw new Error("FXSSI no brokers");
  const titles = data.broker_titles ?? {};
  let brokers = Object.entries(data.brokers)
    .filter(([, v]) => v[norm] !== undefined)
    .map(([k, v]) => ({ broker: titles[k] ?? k, buy: Number(v[norm]), sell: Number((100 - Number(v[norm])).toFixed(2)) }));
  if (!brokers.length) throw new Error("Pair not found");
  let filtered = norm === "XAUUSD" ? brokers : brokers.filter(b =>
    !b.broker.toLowerCase().includes("insta") && !b.broker.toLowerCase().includes("fibo"));
  if (!filtered.length) filtered = brokers;
  const buy = filtered.reduce((s, b) => s + b.buy, 0) / filtered.length;
  const sell = 100 - buy;
  const dir = buy > 60 ? "BUY" : sell > 60 ? "SELL" : "NEUTRAL";
  return {
    real_buy_avg: Number(buy.toFixed(1)), real_sell_avg: Number(sell.toFixed(1)),
    retail_direction: dir, is_extreme: buy > 60 || sell > 60,
    pain_threshold: dir === "BUY" ? `BSL - ${norm} High üzərində` : `SSL - ${norm} Low altında`,
  };
}

async function getMacro(symbol: string, h: number, l: number, price: number) {
  let events: any[] = [];
  for (const url of ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json"]) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.forexfactory.com/calendar" } });
      if (r.ok) { events = await r.json(); break; }
    } catch {}
  }
  const now = new Date();
  const in2h = now.getTime() + 2 * 3600e3;
  const in24h = now.getTime() + 24 * 3600e3;
  const usdHigh = events.filter(e => e.impact === "High" && e.country === "USD");
  const crit = usdHigh.filter(e => /Non-Farm|NFP|CPI|FOMC|Fed Funds|Interest Rate/i.test(e.title));
  const imminent = crit.filter(e => { const t = new Date(e.date).getTime(); return t >= now.getTime() && t <= in2h; });
  const upcoming = crit.filter(e => { const t = new Date(e.date).getTime(); return t >= now.getTime() && t <= in24h; });
  const mid = (h + l) / 2;
  const dealing = price > mid ? "PREMIUM" : "DISCOUNT";
  const can_trade = imminent.length === 0;
  return {
    dealing_range: dealing, htf_bias: dealing === "PREMIUM" ? "BEARISH" : "BULLISH",
    can_trade, fatal_flaw: can_trade ? null : `BLOCKED: ${imminent[0]?.title} <2h`,
    next_24h: upcoming.map(e => `${e.date} ${e.title}`),
    volatility_regime: can_trade ? "Expansion" : "Compression",
  };
}

function detectFVG(candles: any[], price: number, h1: number, l1: number) {
  const fvgs: any[] = [];
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].low > candles[i - 2].high + BUF) fvgs.push({ type: "Bullish", high: candles[i].low, low: candles[i - 2].high, idx: i });
    else if (candles[i - 2].low > candles[i].high + BUF) fvgs.push({ type: "Bearish", high: candles[i - 2].low, low: candles[i].high, idx: i });
  }
  const recent = fvgs.slice(-5);
  let defended = recent[recent.length - 1] ?? { type: "Bullish", high: price, low: price, idx: -1 };
  const range = h1 - l1;
  const mid = (h1 + l1) / 2;
  const last = candles[candles.length - 1];
  const bodyRatio = Math.abs(last.close - last.open) / ((last.high - last.low) || 1e-9);
  const disp = bodyRatio > 0.6 ? "aggressive" : "low momentum";
  const win = candles.slice(-10);
  const sL = Math.min(...win.map(c => c.low));
  const sH = Math.max(...win.map(c => c.high));
  const short = price > mid;
  return {
    defended, disp, count: recent.length,
    inv: short ? Math.round((sH + PIP5) * 1e5) / 1e5 : Math.round((sL - PIP5) * 1e5) / 1e5,
    oteH: Math.round((l1 + range * 0.79) * 1e5) / 1e5,
    oteL: Math.round((l1 + range * 0.62) * 1e5) / 1e5,
    short,
  };
}

async function runOnce(env: Env): Promise<string> {
  const rawSymbol = env.SYMBOL || "EUR/USD";
  const tdSymbol = rawSymbol === "XAUUSD" || rawSymbol === "GOLD" ? "XAU/USD" : rawSymbol;
  const symbol = rawSymbol;
  const sess = getGlobalSession();
  const state = await kvGet(env, "state", { last_intel_utc: "", sentiment_history: [] });

  if (!sess.is_ny && state.last_intel_utc && Date.now() - new Date(state.last_intel_utc).getTime() < 3600e3)
    return `[SKIP ${sess.session}] intel fresh`;

  const candles = await tdCandles(tdSymbol, env.TWELVEDATA_API_KEY, 100);
  const today = new Date(candles[0].datetime.replace(" ", "T") + "Z").toISOString().slice(0, 10);
  const day = candles.filter(c => new Date(c.datetime.replace(" ", "T") + "Z").toISOString().slice(0, 10) === today);
  const scope = day.length ? day : candles;
  const h = Math.max(...scope.map(c => c.high));
  const l = Math.min(...scope.map(c => c.low));
  const price = candles[candles.length - 1].close;
  const overnight = scope.filter(c => { const m = toMinUTC(c.datetime); return m >= 0 && m < 810; });
  const aH = overnight.length ? Math.max(...overnight.map(c => c.high)) : h;
  const aL = overnight.length ? Math.min(...overnight.map(c => c.low)) : l;

  const sentiment = await getSentiment(symbol);
  const macro = await getMacro(symbol, h, l, price);
  const c50 = candles.slice(-50);
  const fvg = detectFVG(c50, price, h, l);

  state.last_intel_utc = new Date().toISOString();
  state.sentiment_history = [...(state.sentiment_history || []), { time: state.last_intel_utc, buy: sentiment.real_buy_avg }].slice(-48);
  await kvPut(env, "state", state);

  if (!sess.can_execute) {
    const msg = `🧠 INTEL ${sess.nyTime} ${symbol}\nPrice ${price} D1 ${l}-${h}\nRetail ${sentiment.real_buy_avg}% ${sentiment.retail_direction}\nMacro ${macro.dealing_range} ${macro.can_trade ? "CLEAR ✅" : "BLOCKED ❌"}\nFVG ${fvg.defended.type} ${fvg.defended.low}-${fvg.defended.high} (${fvg.count} ədəd)`;
    console.log(msg);
    return msg;
  }
  if (!macro.can_trade) return `BLOCKED: ${macro.fatal_flaw}`;

  const sweep = price > aH || price < aL;
  const dealing = price > (h + l) / 2 ? "Premium" : "Discount";
  const exec = !sweep ? "STAND_ASIDE" : dealing === "Discount" ? "EXECUTE_LONG" : "EXECUTE_SHORT";
  if (exec === "STAND_ASIDE" || (dealing === "Premium" && exec === "EXECUTE_LONG") || (dealing === "Discount" && exec === "EXECUTE_SHORT"))
    return `NO_TRADE: sweep=${sweep} dealing=${dealing}`;

  const dec = tdSymbol === "XAU/USD" ? 2 : 5;
  const side = exec === "EXECUTE_SHORT" ? "SELL" : "BUY";
  const entry = Number(price.toFixed(dec));
  const sl = fvg.inv;
  const tp = side === "BUY" ? h : l;
  const rr = Number((Math.abs(tp - entry) / (Math.abs(entry - sl) || 1e-9)).toFixed(2));

  const orders = await kvGet(env, "orders", []);
  const order = { id: `PAPER_${Date.now()}`, symbol, side, entry, sl, tp, rr, time: new Date().toISOString() };
  orders.push(order);
  await kvPut(env, "orders", orders.slice(-100));

  const wins = orders.filter((o: any) => o.status === "TP_HIT").length;
  const report = `🏦 INSTITUTIONAL DESK | ${symbol} | ${sess.nyTime} NY\n📊 ${side} 0.01 LOT\nEntry ${entry} | SL ${sl} | TP ${tp} | RR ${rr}\nM1 ${sess.session} Price ${price} D1 ${l}-${h}\nM2 ${macro.dealing_range} Bias ${macro.htf_bias}\nM3 Retail ${sentiment.real_buy_avg}% ${sentiment.retail_direction}\nM4 FVG ${fvg.defended.type} ${fvg.defended.low}-${fvg.defended.high}\nM6 ${fvg.disp} displacement\nPaper: ${order.id} | Keçmiş W ${wins}`;
  await tg(env, report);
  return `EXECUTED ${order.id}`;
}

export default {
  async scheduled(_e: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runOnce(env).then(m => console.log(m)).catch(e => console.error("CRON:", (e as Error).message)));
  },
  async fetch(req: Request, env: Env) {
    const u = new URL(req.url);
    if (u.searchParams.get("run") === "1") {
      try { return new Response(await runOnce(env)); }
      catch (e) { return new Response("ERR " + (e as Error).message, { status: 500 }); }
    }
    return new Response("ict-desk alive. ?run=1 manual tetik.");
  },
};
