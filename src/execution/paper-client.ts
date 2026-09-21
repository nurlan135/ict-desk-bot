import fs from "fs";
const PAPER_PATH = "src/memory/paper_orders.json";

export type PaperOrder = {
  id: string,
  symbol: string,
  side: "BUY" | "SELL",
  entry: number,
  sl: number,
  tp: number,
  lot: number,
  rr: number,
  status: "OPEN" | "TP_HIT" | "SL_HIT" | "CANCELLED",
  openTime: string,
  closeTime?: string,
  pnl?: number,
  reason: string
};

function loadOrders(): PaperOrder[] {
  try { return JSON.parse(fs.readFileSync(PAPER_PATH, "utf8")); }
  catch { return []; }
}

function saveOrders(orders: PaperOrder[]) {
  fs.mkdirSync("src/memory", { recursive: true });
  fs.writeFileSync(PAPER_PATH, JSON.stringify(orders, null, 2));
}

export async function placePaperOrder({ symbol, side, entry, sl, tp, rr, reason }: {
  symbol: string; side: "BUY" | "SELL"; entry: number; sl: number; tp: number; rr: number; reason: string;
}) {
  const orders = loadOrders();
  const newOrder: PaperOrder = {
    id: `PAPER_${Date.now()}`,
    symbol,
    side,
    entry: Number(entry.toFixed(5)),
    sl: Number(sl.toFixed(5)),
    tp: Number(tp.toFixed(5)),
    lot: 0.01,
    rr: Number(rr.toFixed(2)),
    status: "OPEN",
    openTime: new Date().toISOString(),
    reason
  };
  orders.push(newOrder);
  saveOrders(orders);

  console.log(`📝 PAPER ORDER OPENED: ${side} ${symbol} 0.01 lot @ ${entry} SL ${sl} TP ${tp} RR ${rr}`);
  console.log(`   Reason: ${reason}`);
  console.log(`   ID: ${newOrder.id}`);

  return newOrder;
}

export async function checkPaperOrders(currentPrice: number, symbol: string) {
  const orders = loadOrders();
  let updated = false;

  for (const o of orders) {
    if (o.status !== "OPEN" || o.symbol !== symbol) continue;

    if (o.side === "BUY") {
      if (currentPrice >= o.tp) { o.status = "TP_HIT"; o.closeTime = new Date().toISOString(); o.pnl = (o.tp - o.entry) * 100; updated = true; console.log(`✅ PAPER TP HIT: ${o.id} +${o.pnl}$`); }
      else if (currentPrice <= o.sl) { o.status = "SL_HIT"; o.closeTime = new Date().toISOString(); o.pnl = (o.sl - o.entry) * 100; updated = true; console.log(`❌ PAPER SL HIT: ${o.id} ${o.pnl}$`); }
    } else {
      if (currentPrice <= o.tp) { o.status = "TP_HIT"; o.closeTime = new Date().toISOString(); o.pnl = (o.entry - o.tp) * 100; updated = true; console.log(`✅ PAPER TP HIT: ${o.id} +${o.pnl}$`); }
      else if (currentPrice >= o.sl) { o.status = "SL_HIT"; o.closeTime = new Date().toISOString(); o.pnl = (o.entry - o.sl) * 100; updated = true; console.log(`❌ PAPER SL HIT: ${o.id} ${o.pnl}$`); }
    }
  }

  if (updated) saveOrders(orders);
  return orders.filter(o => o.status === "OPEN");
}

export function getPaperStats() {
  const orders = loadOrders();
  const wins = orders.filter(o => o.status === "TP_HIT").length;
  const losses = orders.filter(o => o.status === "SL_HIT").length;
  const totalPnl = orders.reduce((s, o) => s + (o.pnl || 0), 0);
  return { total: orders.length, wins, losses, winRate: orders.length ? (wins / orders.length * 100).toFixed(1) + "%" : "0%", totalPnl, open: orders.filter(o => o.status === "OPEN").length };
}

async function main() {
  console.log(JSON.stringify(getPaperStats(), null, 2));
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("paper-client.ts")) main();
