import 'dotenv/config';

const OANDA_API = "https://api-fxpractice.oanda.com";

export interface OandaOrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  rr?: string;
  units?: number;
}

export async function placeOandaOrder({ symbol, side, entry, sl, tp, rr, units }: OandaOrderParams) {
  const key = process.env.OANDA_API_KEY;
  const account = process.env.OANDA_ACCOUNT_ID;
  if (!key || !account) throw new Error("OANDA_API_KEY və ACCOUNT_ID .env-də yoxdur");

  const instrument = symbol.replace("/", "_");
  const qty = units ?? 1000;
  const body = {
    order: {
      type: "LIMIT",
      instrument,
      units: (side === "BUY" ? qty : -qty).toString(),
      price: entry.toFixed(5),
      stopLossOnFill: { price: sl.toFixed(5), timeInForce: "GTC" },
      takeProfitOnFill: { price: tp.toFixed(5) },
      timeInForce: "GTC",
      ...(rr ? { clientExtensions: { comment: `RR ${rr}` } } : {}),
    }
  };

  const res = await fetch(`${OANDA_API}/v3/accounts/${account}/orders`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  console.log("OANDA RESPONSE:", JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  const key = process.env.OANDA_API_KEY;
  const account = process.env.OANDA_ACCOUNT_ID;
  if (!key || !account) {
    console.log("DRY-RUN: .env-də OANDA_API_KEY / OANDA_ACCOUNT_ID yoxdur, order göndərilmədi.");
    return;
  }
  await placeOandaOrder({ symbol: "EUR/USD", side: "BUY", entry: 1.085, sl: 1.08, tp: 1.09, rr: "1:2" });
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("oanda-client.ts")) main();
