import { spawn } from "child_process";
import path from "path";

export async function placeMT5Order({ symbol, side, entry, sl, tp, rr }: {
  symbol: string; side: "BUY" | "SELL"; entry: number; sl: number; tp: number; rr: number | string;
}): Promise<string> {
  const mtSymbol = symbol.includes("XAU") ? "XAUUSD" : symbol;

  return new Promise((resolve, reject) => {
    const py = spawn("python", [
      path.join(process.cwd(), "src/execution/mt5_bridge.py"),
      mtSymbol, side, entry.toString(), sl.toString(), tp.toString()
    ]);

    let out = "";
    py.stdout.on("data", d => out += d);
    py.stderr.on("data", d => console.log("MT5 LOG:", d.toString()));
    py.on("error", reject);

    py.on("close", () => {
      console.log(`🏦 MT5 DEMO (PULSUZ): ${side} ${mtSymbol} 0.01 @ ${entry} SL ${sl} TP ${tp} RR ${rr}`);
      console.log(out);
      resolve(out);
    });
  });
}

async function main() {
  console.log("DRY-RUN: placeMT5Order hazırdır, real order üçün arqumentlə çağır.");
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("mt5-client.ts")) main();
