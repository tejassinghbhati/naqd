/**
 * Calibra app - the fair-value feed.
 *
 * This is the file that makes this app different from any other DreamDEX
 * frontend. Everyone can show you the price. Only this one can tell you what
 * the price has historically been WRONG by, because the measurement exists.
 *
 * The honest part matters as much as the number. The measured pricing error on
 * this venue is real but time-varying: pooled per fill it reads -3.10c at
 * t = -4.08, but fills inside one market share a single outcome, so clustering
 * by market gives t = -2.48, and a bootstrap over whole weeks puts the interval
 * at [-5.06c, +2.12c] - straddling zero. Weekly means change sign.
 *
 * So the UI must never show a bare "fair value" as though it were a fact. When
 * the interval covers zero there is no measurable edge, and the app says
 * exactly that instead of inventing a number to decorate the screen.
 */

export interface Estimate {
  mean: number;
  se: number;
  t: number;
  ci95: [number, number];
  n: number;
}

export interface LiveEdge {
  verdict: "trade" | "stand-down";
  reason: string;
  edge: number;
  recent: Estimate;
  lifetime: Estimate;
  sampleMarkets: number;
  windowDays: number;
  confidence: number;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  implied: number;
  realized: number;
  ci95: [number, number];
  error: number;
  significant: boolean;
}

export interface CalibraStats {
  live: LiveEdge;
  calibration: CalibrationBin[];
  makerRoi: number;
  takerRoi: number;
  coverage: number;
  markets: number;
  dataAsOf: number;
}

/** Vite proxies /api to the stats server, so the bundle carries no hostname. */
const API = "/api";

/**
 * Read the current edge and calibration curve.
 *
 * Returns null rather than throwing when the stats API is not running: the app
 * has to stay usable as a plain trading client without it. Every consumer here
 * treats a null as "we have no measurement", never as "the edge is zero".
 */
export async function fetchStats(signal?: AbortSignal): Promise<CalibraStats | null> {
  try {
    const res = await fetch(`${API}/v1/summary`, { signal, cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      live: LiveEdge;
      calibration: { byMarket: CalibrationBin[] };
      makerVsTaker: { maker: { roi: number }; taker: { roi: number } };
      coverage: { coverage: number; markets: number };
      dataAsOf: number;
    };
    return {
      live: d.live,
      calibration: d.calibration?.byMarket ?? [],
      makerRoi: d.makerVsTaker?.maker?.roi ?? 0,
      takerRoi: d.makerVsTaker?.taker?.roi ?? 0,
      coverage: d.coverage?.coverage ?? 0,
      markets: d.coverage?.markets ?? 0,
      dataAsOf: d.dataAsOf ?? 0,
    };
  } catch {
    return null;
  }
}

export type Signal = "rich" | "cheap" | "fair" | "unknown";

export interface FairValue {
  /** Our estimate of the true probability of UP, or null when unmeasurable. */
  fair: number | null;
  /** The market's own implied probability of UP. */
  implied: number | null;
  /** fair - implied, in probability points. Positive means UP is cheap. */
  edge: number | null;
  signal: Signal;
  /** One sentence, written for a person, explaining the badge. */
  explain: string;
}

const BOUNDS: [number, number] = [0.05, 0.95];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * What a market is really worth, given the market's own price and our
 * measurement of how wrong this venue's prices tend to be.
 *
 * Same formula the agent's policy uses: the edge is defined as
 * (realized - implied), so if history says prices run rich on UP by 3 cents,
 * the honest estimate of the true probability is implied + edge.
 *
 * Refuses to produce a number in three cases, each of which is a real "we do
 * not know" rather than a shrug:
 *   - no measurement available at all (stats API down)
 *   - the measured interval covers zero (no detectable mispricing right now)
 *   - the market has no price yet, so there is nothing to correct
 */
export function fairValue(stats: CalibraStats | null, impliedUp: number | null | undefined): FairValue {
  const implied = impliedUp ?? null;

  if (!stats) {
    return { fair: null, implied, edge: null, signal: "unknown", explain: "Edge data unavailable - start the Calibra API to see fair value." };
  }
  if (stats.live.verdict === "stand-down") {
    return {
      fair: null,
      implied,
      edge: null,
      signal: "fair",
      explain: `No measurable mispricing right now. Over the last ${stats.live.windowDays} days the interval is [${cents(stats.live.recent.ci95[0])}, ${cents(stats.live.recent.ci95[1])}], which spans zero.`,
    };
  }
  if (implied === null) {
    return {
      fair: null,
      implied: null,
      edge: null,
      signal: "unknown",
      explain: "This market has no price yet - nobody has traded it.",
    };
  }

  const edge = stats.live.edge;
  const fair = clamp(implied + edge, BOUNDS[0], BOUNDS[1]);
  const diff = fair - implied;
  // Below a cent is not a signal, it is rounding.
  const signal: Signal = Math.abs(diff) < 0.01 ? "fair" : diff > 0 ? "cheap" : "rich";
  return {
    fair,
    implied,
    edge: diff,
    signal,
    explain:
      signal === "fair"
        ? "Priced in line with the measured edge."
        : `History says UP is ${signal === "rich" ? "over" : "under"}priced by about ${cents(Math.abs(diff))} on this venue right now.`,
  };
}

export const cents = (x: number): string => `${x >= 0 ? "" : "-"}${Math.abs(x * 100).toFixed(1)}c`;
