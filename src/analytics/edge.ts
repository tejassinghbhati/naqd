/**
 * Assay - is there an edge in this venue's pricing right now?
 *
 * The finding this module encodes, measured on 6,906 mainnet markets and the
 * 1,200 of them that traded:
 *
 *   Pooled over all fills, UP looks overpriced by 3.1 cents with t = -4.08.
 *   That number is an illusion. Cluster by market (fills in one window share one
 *   outcome) and it becomes -2.6 cents at t = -2.50. Then look at it week by
 *   week and it does not merely weaken, it CHANGES SIGN: -0.4c, +1.0c, -6.7c,
 *   -4.2c, +18.4c. A bootstrap over whole weeks puts the interval at
 *   [-5.1c, +2.2c], straddling zero.
 *
 * So the venue is not persistently biased in one direction, and a bot that hard-
 * codes "fade UP" is fitting last month's weather. What IS true is that the
 * mispricing is large and regime-dependent - which is tradable, but only if you
 * re-measure continuously and stand down when the measurement says nothing.
 *
 * That is the entire contract of this file: `liveEdge()` returns a verdict the
 * agent is required to obey, and its default answer is "stand down".
 */

import { blockBootstrap, clusteredEstimate, estimate, isoWeek, type Estimate } from "./stats.js";
import type { ScoredFill } from "./queries.js";

/** Pricing error of one trade: how much the outcome beat the price. */
const errorOf = (f: ScoredFill) => f.up - f.price;

export interface WeeklyEdge {
  week: string;
  n: number;
  mean: number;
  ci95: [number, number];
}

export interface EdgeReport {
  /** Naive per-fill estimate. Reported ONLY so the honest number has something
   *  to be compared against - never act on it. */
  naive: Estimate;
  /** One observation per market. The defensible point estimate. */
  clustered: Estimate;
  /** Resampling whole weeks. The interval that survives autocorrelation. */
  bootstrap: { mean: number; ci95: [number, number]; crossesZero: boolean; blocks: number };
  weekly: WeeklyEdge[];
  /** True when the weekly means are not all the same sign. */
  signFlips: boolean;
}

export function edgeReport(fills: ScoredFill[]): EdgeReport {
  const byWeek = new Map<string, ScoredFill[]>();
  for (const f of fills) {
    const k = isoWeek(f.expiry);
    const arr = byWeek.get(k);
    if (arr) arr.push(f);
    else byWeek.set(k, [f]);
  }

  const weekly: WeeklyEdge[] = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, fs]) => {
      // Within a week, still collapse to markets before averaging - otherwise a
      // single heavily-traded window dominates its week.
      const est = clusteredEstimate(
        fs,
        (f) => f.marketId,
        errorOf,
      );
      return { week, n: est.n, mean: est.mean, ci95: est.ci95 };
    });

  // Blocks for the bootstrap are the weeks' market-level means.
  const blocks = [...byWeek.values()].map((fs) => {
    const perMarket = new Map<string, number[]>();
    for (const f of fs) {
      const arr = perMarket.get(f.marketId);
      if (arr) arr.push(errorOf(f));
      else perMarket.set(f.marketId, [errorOf(f)]);
    }
    return [...perMarket.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  });

  const meaningful = weekly.filter((w) => w.n >= 20);
  return {
    naive: estimate(fills.map(errorOf)),
    clustered: clusteredEstimate(fills, (f) => f.marketId, errorOf),
    bootstrap: blockBootstrap(blocks),
    weekly,
    signFlips: meaningful.length > 1 && new Set(meaningful.map((w) => Math.sign(w.mean))).size > 1,
  };
}

export type Verdict = "trade" | "stand-down";

export interface LiveEdge {
  verdict: Verdict;
  /** Plain-language reason, surfaced in the agent log and the dashboard. */
  reason: string;
  /** Signed edge in probability points. Positive = UP is CHEAP (buy YES). */
  edge: number;
  /** The recent-window estimate the verdict was made on. */
  recent: Estimate;
  /** The full-history estimate, for context. */
  lifetime: Estimate;
  /** Markets observed in the recent window. */
  sampleMarkets: number;
  windowDays: number;
  /** Size multiplier in [0,1] the agent should scale its quotes by. */
  confidence: number;
}

export interface LiveEdgeOptions {
  /** Lookback for the "current regime" estimate. */
  windowDays?: number;
  /** Refuse to trade on fewer than this many resolved markets in the window. */
  minMarkets?: number;
  /** Refuse to trade unless the measured edge is at least this large. */
  minEdge?: number;
  now?: number;
}

/**
 * The agent's gate. Four conditions, all of which must hold to trade:
 *
 *   1. Enough resolved markets in the window to estimate anything.
 *   2. The recent-window CI excludes zero - there IS a measured mispricing.
 *   3. It is bigger than `minEdge`, so we are not trading noise into a spread.
 *   4. The recent sign agrees with the lifetime sign. Condition 2 alone will
 *      fire on roughly one window in twenty by chance; requiring the long-run
 *      estimate to point the same way is what separates a regime from a run of
 *      luck. This is the condition that would have kept the agent flat through
 *      week 33, when the weekly mean flipped positive for a week and then went
 *      back.
 *
 * Fails closed: any missing input returns `stand-down`.
 */
export function liveEdge(fills: ScoredFill[], opts: LiveEdgeOptions = {}): LiveEdge {
  const windowDays = opts.windowDays ?? 7;
  const minMarkets = opts.minMarkets ?? 60;
  const minEdge = opts.minEdge ?? 0.02;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const cutoff = now - windowDays * 86_400;

  const recentFills = fills.filter((f) => f.expiry >= cutoff);
  const recent = clusteredEstimate(recentFills, (f) => f.marketId, errorOf);
  const lifetime = clusteredEstimate(fills, (f) => f.marketId, errorOf);

  const base = {
    edge: recent.mean,
    recent,
    lifetime,
    sampleMarkets: recent.n,
    windowDays,
  };
  const stand = (reason: string): LiveEdge => ({ verdict: "stand-down", reason, confidence: 0, ...base });

  if (recent.n < minMarkets) {
    return stand(`only ${recent.n} resolved markets in the last ${windowDays}d (need ${minMarkets})`);
  }
  const [lo, hi] = recent.ci95;
  if (lo <= 0 && hi >= 0) {
    return stand(`edge interval [${lo.toFixed(3)}, ${hi.toFixed(3)}] contains zero - no measurable mispricing`);
  }
  if (Math.abs(recent.mean) < minEdge) {
    return stand(`edge ${(recent.mean * 100).toFixed(2)}c is below the ${(minEdge * 100).toFixed(0)}c floor`);
  }
  if (lifetime.n >= minMarkets && Math.sign(recent.mean) !== Math.sign(lifetime.mean)) {
    return stand(
      `recent edge ${(recent.mean * 100).toFixed(2)}c contradicts the lifetime ${(lifetime.mean * 100).toFixed(2)}c - ` +
        `treating it as a regime break, not a signal`,
    );
  }

  // Confidence scales with how far the near bound of the interval sits from
  // zero, capped at 1 by the time it reaches ~5 cents. Sizing off the BOUND
  // rather than the point estimate means a wide, uncertain interval sizes small
  // even when its centre looks juicy.
  const nearBound = Math.min(Math.abs(lo), Math.abs(hi));
  const confidence = Math.max(0, Math.min(1, nearBound / 0.05));

  return {
    verdict: "trade",
    reason:
      `edge ${(recent.mean * 100).toFixed(2)}c, 95% CI [${(lo * 100).toFixed(2)}c, ${(hi * 100).toFixed(2)}c] ` +
      `over ${recent.n} markets in ${windowDays}d`,
    confidence,
    ...base,
  };
}
