import 'dotenv/config';
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export type Session = "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | "DEAD_ZONE";

export function getGlobalSession(date = new Date()) {
  const now = date;
  const nyHour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
  const nyMin = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
  const utcHour = now.getUTCHours();

  let session: Session;
  if (nyHour >= 20 || nyHour < 2) session = "ASIA";
  else if (nyHour >= 2 && nyHour < 5) session = "LONDON";
  else if (nyHour >= 7 && nyHour < 10) session = "NY_AM";
  else if (nyHour >= 10 && nyHour < 12) session = "NY_PM";
  else session = "DEAD_ZONE";

  const is_ny = session === "NY_AM" || session === "NY_PM";
  return {
    nyTime: `${String(nyHour).padStart(2, "0")}:${String(nyMin).padStart(2, "0")} NY`,
    utcTime: `${String(utcHour).padStart(2, "0")}:${String(nyMin).padStart(2, "0")} UTC`,
    session,
    is_ny,
    is_ny_session: is_ny,
    is_kill_zone: is_ny || session === "LONDON",
    can_execute: is_ny,
  };
}

export function getSession(date = new Date()): Session {
  return getGlobalSession(date).session;
}

export interface MarketState {
  symbol: string;
  price: number;
  d1_high: number;
  d1_low: number;
  overnight_high: number;
  overnight_low: number;
  spx_price: number;
  session: Session;
  timestamp_utc: string;
}

interface Candle {
  datetime: string;
  high: string;
  low: string;
  close: string;
}

function loadApiKey(): string | undefined {
  if (process.env.TWELVEDATA_API_KEY) return process.env.TWELVEDATA_API_KEY;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.trim().match(/^TWELVEDATA_API_KEY\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

// TIME > PRICE: YALNIZ NY_AM / NY_PM sessiyalarında EXECUTE.

function mockState(): MarketState {
  return {
    symbol: "EUR/USD",
    price: 1.085,
    d1_high: 1.088,
    d1_low: 1.082,
    overnight_high: 1.086,
    overnight_low: 1.083,
    spx_price: 5420,
      session: getGlobalSession().session,
    timestamp_utc: new Date().toISOString(),
  };
}

async function fetchCandles(symbol: string, key: string): Promise<Candle[] | null> {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=15min&outputsize=100&timezone=UTC&order=DESC&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { values?: Candle[]; status?: string };
  if (data.status === "error" || !Array.isArray(data.values)) return null;
  return data.values;
}

function toMinutesUTC(datetime: string): number {
  const d = new Date(datetime.endsWith("Z") ? datetime : datetime.replace(" ", "T") + "Z");
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function todayKeyUTC(datetime: string): string {
  const d = new Date(datetime.endsWith("Z") ? datetime : datetime.replace(" ", "T") + "Z");
  return d.toISOString().slice(0, 10);
}

export async function getMarketState(): Promise<MarketState> {
  const key = loadApiKey();
  if (!key) return mockState();

  try {
    let symbol = "EUR/USD";
    let candles = await fetchCandles(symbol, key);
    if (!candles) {
      symbol = "QQQ";
      candles = await fetchCandles(symbol, key);
    }
    if (!candles || candles.length === 0) return applyForceFlag(mockState());

    const today = todayKeyUTC(candles[0].datetime);
    const dayCandles = candles.filter((c) => todayKeyUTC(c.datetime) === today);
    const scope = dayCandles.length > 0 ? dayCandles : candles;

    const highs = scope.map((c) => Number(c.high));
    const lows = scope.map((c) => Number(c.low));
    const d1_high = Math.max(...highs);
    const d1_low = Math.min(...lows);

    const overnight = scope.filter((c) => {
      const m = toMinutesUTC(c.datetime);
      return m >= 0 && m < 810;
    });
    const overnight_high = overnight.length > 0 ? Math.max(...overnight.map((c) => Number(c.high))) : d1_high;
    const overnight_low = overnight.length > 0 ? Math.min(...overnight.map((c) => Number(c.low))) : d1_low;

    const price = Number(candles[0].close);

    let spx_price = 5420;
    const spxCandles = (await fetchCandles("SPX", key)) ?? (await fetchCandles("SPY", key));
    if (spxCandles && spxCandles.length > 0) spx_price = Number(spxCandles[0].close);

    return applyForceFlag({
      symbol,
      price,
      d1_high,
      d1_low,
      overnight_high,
      overnight_low,
      spx_price,
      session: getGlobalSession().session,
      timestamp_utc: new Date().toISOString(),
    });
  } catch {
    return applyForceFlag(mockState());
  }
}

export interface Candle15M { high: number; low: number; close: number; open: number; datetime: string; }

function mock15MCandles(): Candle15M[] {
  const out: Candle15M[] = [];
  let p = 1.085;
  const now = Date.now();
  for (let k = 19; k >= 0; k--) {
    const o = p;
    const c = p + (Math.random() - 0.48) * 0.0012;
    const h = Math.max(o, c) + Math.random() * 0.0004;
    const l = Math.min(o, c) - Math.random() * 0.0004;
    out.push({ high: r(h), low: r(l), close: r(c), open: r(o), datetime: new Date(now - k * 15 * 60e3).toISOString() });
    p = c;
  }
  return out;
}
function r(n: number): number { return Math.round(n * 100000) / 100000; }

export async function get15MCandles(symbol: string): Promise<Candle15M[]> {
  const key = loadApiKey();
  if (!key) return mock15MCandles();
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=15min&outputsize=50&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return mock15MCandles();
    const data = await res.json() as { values?: any[]; status?: string };
    if (data.status === "error" || !Array.isArray(data.values)) return mock15MCandles();
    return data.values.reverse().map((c: any) => ({
      high: Number(c.high), low: Number(c.low), close: Number(c.close),
      open: Number(c.open), datetime: String(c.datetime),
    }));
  } catch { return mock15MCandles(); }
}

function applyForceFlag(state: MarketState): MarketState {  if (process.argv.includes("--force-london")) {
    state.session = "LONDON";
    state.price = state.overnight_high + 0.0005;
  }
  return state;
}

async function main() {
  try {
    const state = await getMarketState("EUR/USD");
    console.log(JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Collector xətası:", e);
    // Mock fallback - API key yoxdursa
    console.log(JSON.stringify({
      symbol: "EUR/USD",
      price: 1.085,
      d1_high: 1.088,
      d1_low: 1.082,
      overnight_high: 1.086,
      overnight_low: 1.083,
      spx_price: 5420,
      session: "NY_AM",
      timestamp_utc: new Date().toISOString()
    }, null, 2));
  }
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("collector.ts")) main();
