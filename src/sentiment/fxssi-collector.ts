export interface BrokerSentiment {
  broker: string;
  buy: number;
  sell: number;
  long?: number;
}

export interface RetailExposure {
  symbol: string;
  source: string;
  brokers_raw?: BrokerSentiment[];
  brokers_filtered?: BrokerSentiment[];
  real_buy_avg: number;
  real_sell_avg: number;
  retail_direction: "BUY" | "SELL" | "NEUTRAL";
  is_extreme: boolean;
  pain_threshold: string;
  algorithmic_target: string;
  inducement_plan: string;
  average_fxssi?: number;
}

const BROKERS: BrokerSentiment[] = [
  { broker: "Insta", buy: 70, sell: 30 },
  { broker: "FiboGroup", buy: 65, sell: 35 },
  { broker: "OANDA", buy: 62, sell: 38 },
  { broker: "Forex.com", buy: 58, sell: 42 },
  { broker: "FXCM", buy: 61, sell: 39 },
  { broker: "Dukascopy", buy: 59, sell: 41 },
  { broker: "Myfxbook", buy: 63, sell: 37 },
  { broker: "FXSSI", buy: 60, sell: 40 },
];

function mockFallback(symbol: string): RetailExposure {
  const norm = symbol.replace("/", "").toUpperCase();
  const filtered = norm === "XAUUSD" ? BROKERS : BROKERS.filter((b) => b.broker !== "Insta" && b.broker !== "FiboGroup");
  const real_buy_avg = Math.round((filtered.reduce((s, b) => s + b.buy, 0) / filtered.length) * 10) / 10;
  const real_sell_avg = Math.round((100 - real_buy_avg) * 10) / 10;
  const retail_direction = real_buy_avg > 60 ? "BUY" : real_sell_avg > 60 ? "SELL" : "NEUTRAL";
  const is_extreme = real_buy_avg > 60 || real_sell_avg > 60;
  return {
    symbol: norm, source: "MOCK_LIVE", brokers_raw: BROKERS, brokers_filtered: filtered,
    real_buy_avg, real_sell_avg, retail_direction, is_extreme,
    pain_threshold: retail_direction === "BUY" ? `BSL - ${norm} High üzərində` : `SSL - ${norm} Low altında`,
    algorithmic_target: `Smart Money ${retail_direction === "BUY" ? "BSL" : "SSL"} süpürmə üçün mühəndislik edir`,
    inducement_plan: is_extreme ? "Retail-ə daha çox ümid verərək likvidliyi artırır" : "Kütlə neytraldır",
  };
}

export async function getRetailExposure(symbol: string): Promise<RetailExposure> {
  const norm = symbol.replace("/", "").toUpperCase();
  try {
    const res = await fetch("https://fxssi.com/api/current-ratios", {
      headers: { "User-Agent": "Mozilla/5.0 InstitutionalEngine" }
    });
    if (!res.ok) throw new Error(`FXSSI HTTP ${res.status}`);
    const data = await res.json() as { brokers?: Record<string, Record<string, string>>; broker_titles?: Record<string, string>; pairs?: Record<string, any> };
    const slug = norm;
    if (!data.brokers) throw new Error("No brokers in FXSSI");
    const titles = data.broker_titles ?? {};
    const brokers: BrokerSentiment[] = Object.entries(data.brokers)
      .filter(([, v]) => v[slug] !== undefined)
      .map(([key, v]) => ({
        broker: titles[key] ?? key,
        buy: Number(v[slug]),
        sell: Number((100 - Number(v[slug])).toFixed(2)),
        long: Number(v[slug]),
      }));
    if (brokers.length === 0) throw new Error("Pair not found in FXSSI");
    let filtered = brokers;
    if (norm !== "XAUUSD") {
      filtered = brokers.filter(b =>
        !b.broker.toLowerCase().includes("insta") &&
        !b.broker.toLowerCase().includes("fibo")
      );
    }
    if (filtered.length === 0) filtered = brokers;
    const real_buy_avg = filtered.reduce((s, b) => s + b.buy, 0) / filtered.length;
    const real_sell_avg = 100 - real_buy_avg;
    const retail_direction = real_buy_avg > 60 ? "BUY" : real_sell_avg > 60 ? "SELL" : "NEUTRAL";
    const is_extreme = real_buy_avg > 60 || real_sell_avg > 60;
    return {
      symbol: norm,
      source: "FXSSI_REAL",
      brokers_raw: brokers,
      brokers_filtered: filtered,
      real_buy_avg: Number(real_buy_avg.toFixed(1)),
      real_sell_avg: Number(real_sell_avg.toFixed(1)),
      retail_direction,
      is_extreme,
      pain_threshold: retail_direction === "BUY" ? `BSL - ${norm} High üzərində` : `SSL - ${norm} Low altında`,
      algorithmic_target: `Smart Money ${retail_direction === "BUY" ? "BSL" : "SSL"} süpürmə üçün mühəndislik edir`,
      inducement_plan: is_extreme ? "Retail-ə daha çox ümid verərək likvidliyi artırır" : "Kütlə neytraldır",
      average_fxssi: Number((data.pairs as any)?.[slug.toLowerCase()]?.average ?? brokers.find(b => b.broker === "FXSSI")?.buy ?? real_buy_avg)
    };
  } catch (e) {
    console.log("FXSSI API xətası, MOCK_LIVE fallback:", (e as Error).message);
    return mockFallback(norm);
  }
}

async function main() {
  const eur = await getRetailExposure("EURUSD");
  console.log(JSON.stringify(eur, null, 2));
  const xau = await getRetailExposure("XAUUSD");
  console.log("XAU:", xau.real_buy_avg);
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("fxssi-collector.ts")) main();
