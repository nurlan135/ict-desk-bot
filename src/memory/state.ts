import fs from "fs";
const STATE_PATH = "src/memory/state.json";

export type InstitutionalState = {
  last_intel_utc: string,
  last_exec_utc: string,
  asia: { high: number, low: number, swept: boolean, swept_time: string | null },
  defended_fvgs: any[],
  weak_fvgs: any[],
  sentiment_history: { time: string, buy: number, sell: number }[],
  macro_regime: string,
  pre_ny_bias: string,
  retail_extreme_start: string | null
};

function blank(): InstitutionalState {
  return { last_intel_utc: "", last_exec_utc: "", asia: { high: 0, low: 0, swept: false, swept_time: null }, defended_fvgs: [], weak_fvgs: [], sentiment_history: [], macro_regime: "", pre_ny_bias: "", retail_extreme_start: null };
}

export function loadState(): InstitutionalState {
  try { return { ...blank(), ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) }; }
  catch { return blank(); }
}

export function saveState(s: InstitutionalState) {
  fs.mkdirSync("src/memory", { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
