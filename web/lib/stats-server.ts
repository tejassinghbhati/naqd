/**
 * Server-side reads of the Calibra stats API.
 *
 * The research pages are rendered on the server, so they fetch the measurement
 * directly rather than shipping a loading spinner to the browser and filling it
 * in afterwards. That is the whole reason this app is Next and not a static
 * bundle: the finding is the content, so it should be in the HTML.
 *
 * Every function here returns null rather than throwing when the stats server
 * is not running. A page that cannot reach it must still render and say so -
 * an analytics site that 500s because a sidecar is down is worse than one that
 * explains the gap.
 */

import type { CalibrationBin, LiveEdge } from "./calibra";

export const API_BASE = process.env.CALIBRA_API ?? "http://localhost:8787";

export interface Estimate {
  mean: number;
  se: number;
  t: number;
  ci95: [number, number];
  n: number;
}

export interface WeeklyEdge {
  week: string;
  n: number;
  mean: number;
  ci95: [number, number];
}

export interface PhaseBins {
  phase: "early" | "middle" | "late";
  label: string;
  n: number;
  bins: CalibrationBin[];
}

export interface SeriesRow {
  asset: string;
  intervalSec: number;
  markets: number;
  traded: number;
  coverage: number;
  trades: number;
  volume: number;
}

export interface Summary {
  network: string;
  venueId: string;
  dataAsOf: number;
  baseRate: {
    n: number;
    up: number;
    rate: number;
    byAsset: { asset: string; intervalSec: number; n: number; rate: number }[];
  };
  coverage: SeriesRow;
  bySeries: SeriesRow[];
  calibration: { byMarket: CalibrationBin[]; byTimeToExpiry: PhaseBins[]; brierSkill: number };
  edge: {
    naive: Estimate;
    clustered: Estimate;
    bootstrap: { mean: number; ci95: [number, number]; crossesZero: boolean; blocks: number };
    weekly: WeeklyEdge[];
    signFlips: boolean;
  };
  live: LiveEdge;
  concentration: { distinctTakers: number; distinctMakers: number; takerHHI: number; topTakerShare: number };
  makerVsTaker: {
    maker: { pnl: number; staked: number; roi: number; trades: number };
    taker: { pnl: number; staked: number; roi: number; trades: number };
  };
}

/**
 * The whole measurement in one call.
 *
 * Revalidated rather than cached forever: the underlying store only changes
 * when a backfill runs, but the live verdict is derived from it and readers
 * should not be shown yesterday's answer indefinitely.
 */
export async function getSummary(): Promise<Summary | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/summary`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as Summary;
  } catch {
    return null;
  }
}

export interface TraderRow {
  address: string;
  pnl: number;
  volume: number;
  staked: number;
  roi: number;
  trades: number;
  hitRate: number;
  makerShare: number;
  markets: number;
}

export async function getTraders(limit = 12): Promise<TraderRow[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/traders?limit=${limit}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const d = (await res.json()) as { traders: TraderRow[] };
    return d.traders ?? [];
  } catch {
    return null;
  }
}
