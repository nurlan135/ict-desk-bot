export type VolatilityRegime = "Compression" | "Expansion" | "Equilibrium";
export type DealingZone = "Premium" | "Discount" | "Equilibrium" | "PREMIUM" | "DISCOUNT";

export interface MacroState {
  source: string;
  dealing_range: DealingZone;
  htf_bias: "BEARISH" | "BULLISH";
  can_trade: boolean;
  fatal_flaw: string | null;
  next_24h: string[];
  high_impact_today: number;
  volatility_regime: VolatilityRegime;
  equilibrium_price: number;
  delivery_cycle: "Internal-to-External" | "External-to-Internal";
  macro_catalyst: string;
  is_pre_news_trap: boolean;
  primary_dol: string;
  note: string;
}

interface FFEvent {
  title: string;
  country: string;
  impact: string;
  date: string;
}

const ENDPOINTS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
];

export async function getMacroState(symbol: string, d1High: number, d1Low: number, currentPrice: number): Promise<MacroState> {
  let events: FFEvent[] = [];
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.forexfactory.com/calendar" } });
      if (res.ok) { events = await res.json() as FFEvent[]; break; }
    } catch {}
  }

  if (!events.length) {
    console.log("FF calendar əlçatan deyil, MOCK_CALENDAR fallback");
    const mid = (d1High + d1Low) / 2;
    const dealing_range: DealingZone = currentPrice > mid ? "PREMIUM" : "DISCOUNT";
    return {
      source: "MOCK_CALENDAR",
      dealing_range,
      htf_bias: dealing_range === "PREMIUM" ? "BEARISH" : "BULLISH",
      can_trade: true,
      fatal_flaw: null,
      next_24h: [],
      high_impact_today: 0,
      volatility_regime: "Expansion",
      equilibrium_price: Math.round(mid * 100000) / 100000,
      delivery_cycle: "External-to-Internal",
      macro_catalyst: "No High-Impact News",
      is_pre_news_trap: false,
      primary_dol: dealing_range === "PREMIUM" ? `PDL ${d1Low} / SSL` : `PDH ${d1High} / BSL`,
      note: `${symbol} Expansion rejimində, ${dealing_range} zonada.`,
    };
  }

  const now = new Date();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const high = events.filter(e => e.impact === "High");
  const usdHigh = high.filter(e => e.country === "USD");

  const critical = usdHigh.filter(e => /Non-Farm|NFP|CPI|FOMC|Fed Funds|Interest Rate/i.test(e.title));
  const imminent = critical.filter(e => { const d = new Date(e.date); return d >= now && d <= in2h; });
  const upcoming = critical.filter(e => { const d = new Date(e.date); return d >= now && d <= in24h; });

  const can_trade = imminent.length === 0;

  const mid = (d1High + d1Low) / 2;
  const dealing_range: DealingZone = currentPrice > mid ? "PREMIUM" : "DISCOUNT";

  const todayStr = now.toISOString().slice(0, 10);
  const high_impact_today = usdHigh.filter(e => String(e.date).slice(0, 10) === todayStr).length;

  const equilibrium_price = Math.round(mid * 100000) / 100000;
  const volatility_regime: VolatilityRegime = !can_trade ? "Compression" : "Expansion";
  const delivery_cycle = "External-to-Internal" as const;
  const primary_dol = dealing_range === "PREMIUM" ? `PDL ${d1Low} / SSL` : `PDH ${d1High} / BSL`;
  const macro_catalyst = imminent.length > 0
    ? `${imminent[0].title} at ${imminent[0].date} (<2h)`
    : upcoming.length > 0
      ? `${upcoming[0].title} at ${upcoming[0].date} (<24h)`
      : "No High-Impact News";
  const note = !can_trade
    ? "Mövcud hərəkət Pre-news liquidity engineering - tələdir"
    : `${symbol} ${volatility_regime} rejimində, ${dealing_range} zonada. DOL: ${primary_dol}.`;

  return {
    source: "FOREXFACTORY_REAL - https://www.forexfactory.com/calendar",
    dealing_range,
    htf_bias: dealing_range === "PREMIUM" ? "BEARISH" : "BULLISH",
    can_trade,
    fatal_flaw: !can_trade ? `BLOCKED: ${imminent[0]?.title} at ${imminent[0]?.date} <2h` : null,
    next_24h: upcoming.map(e => `${e.date} ${e.title}`),
    high_impact_today,
    volatility_regime,
    equilibrium_price,
    delivery_cycle,
    macro_catalyst,
    is_pre_news_trap: !can_trade,
    primary_dol,
    note,
  };
}

async function main() {
  console.log(JSON.stringify(await getMacroState("EURUSD", 1.09, 1.08, 1.085), null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("calendar.ts")) main();
