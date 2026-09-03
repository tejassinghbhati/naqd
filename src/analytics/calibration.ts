/**
 * Assay - calibration: when this venue says 70%, does it happen 70% of the time?
 *
 * Short windows are what make this measurable at all. A Polymarket question
 * resolves in months, so its calibration curve is a lifetime project. DreamDEX
 * settles a BTC market every 15 minutes, which is ~96 resolutions a day per
 * series - enough that calibration becomes a live instrument rather than a
 * retrospective.
 *
 * The curve here is deliberately computed two ways, because they disagree and
 * the disagreement is the interesting part:
 *
 *   byMarket - one point per market, using its volume-weighted price. This is
 *     the statistically clean unit (independent outcomes) but it blurs a
 *     market's whole life into one number.
 *
 *   byFill, sliced on time-to-expiry - every trade scored separately. Noisier
 *     and correlated, but it separates "the market was well-priced" from "the
 *     market got obvious in its last two minutes". A curve that looks sharply
 *     S-shaped on VWAP and flat on early fills is not measuring skill, it is
 *     measuring the clock.
 */

import { wilson, brierSkill, clusteredEstimate, type Estimate } from "./stats.js";
import type { ScoredFill, ScoredMarket } from "./queries.js";

export interface CalibrationBin {
  /** Half-open [lo, hi) on implied probability, except the last which includes 1. */
  lo: number;
  hi: number;
  n: number;
  /** Mean implied probability of the observations that landed here. */
  implied: number;
  /** Fraction that actually resolved UP. */
  realized: number;
  /** Wilson 95% interval on `realized`. */
  ci95: [number, number];
  /** realized − implied. Negative means UP was overpriced in this bin. */
  error: number;
  /** True when the interval excludes the implied probability. */
  significant: boolean;
}

const DEFAULT_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

function bin(points: { p: number; up: 0 | 1 }[], edges = DEFAULT_EDGES): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const last = i === edges.length - 2;
    const sel = points.filter((x) => x.p >= lo && (last ? x.p <= hi : x.p < hi));
    if (sel.length === 0) continue;
    const ups = sel.filter((x) => x.up === 1).length;
    const realized = ups / sel.length;
    const implied = sel.reduce((a, x) => a + x.p, 0) / sel.length;
    const ci95 = wilson(ups, sel.length);
    out.push({
      lo,
      hi,
      n: sel.length,
      implied,
      realized,
      ci95,
      error: realized - implied,
      significant: implied < ci95[0] || implied > ci95[1],
    });
  }
  return out;
}

export interface CalibrationReport {
  /** One observation per market (VWAP). The headline curve. */
  byMarket: CalibrationBin[];
  /** Per-fill curves split by how much of the window was left when they printed. */
  byTimeToExpiry: { phase: "early" | "middle" | "late"; label: string; bins: CalibrationBin[]; n: number }[];
  /** How much better than a coin flip the venue's prices are. 1 = perfect. */
  brierSkill: number;
  /** Mean pricing error, clustered by market. */
  meanError: Estimate;
  markets: number;
  fills: number;
}

const PHASES = [
  { phase: "early" as const, label: "first third of window", lo: 2 / 3, hi: 1.01 },
  { phase: "middle" as const, label: "second third", lo: 1 / 3, hi: 2 / 3 },
  { phase: "late" as const, label: "final third", lo: 0, hi: 1 / 3 },
];

export function calibrationReport(markets: ScoredMarket[], fills: ScoredFill[]): CalibrationReport {
  const byMarket = bin(markets.map((m) => ({ p: m.vwap, up: m.up })));

  const byTimeToExpiry = PHASES.map(({ phase, label, lo, hi }) => {
    const sel = fills.filter((f) => f.fracLeft >= lo && f.fracLeft < hi);
    return {
      phase,
      label,
      n: sel.length,
      // Coarser bins here: splitting ~900 fills ten ways leaves buckets too
      // small for the interval to say anything.
      bins: bin(
        sel.map((f) => ({ p: f.price, up: f.up })),
        [0, 0.2, 0.4, 0.6, 0.8, 1.0],
      ),
    };
  });

  return {
    byMarket,
    byTimeToExpiry,
    brierSkill: brierSkill(markets.map((m) => ({ p: m.vwap, outcome: m.up }))),
    meanError: clusteredEstimate(
      fills,
      (f) => f.marketId,
      (f) => f.up - f.price,
    ),
    markets: markets.length,
    fills: fills.length,
  };
}

/**
 * The correction implied by the curve: given a quoted probability, what does
 * history say the true probability is?
 *
 * Isotonic-lite - we take the bin's realized rate and interpolate between bin
 * centres, then enforce monotonicity, because a calibration map that is not
 * monotone would tell the agent that raising its price lowers its win chance.
 * Bins whose interval still contains the implied probability contribute no
 * correction: we only bend the curve where the data actually objects.
 */
export function calibrationMap(bins: CalibrationBin[]): (p: number) => number {
  const pts = bins
    .filter((b) => b.n >= 20)
    .map((b) => ({ x: b.implied, y: b.significant ? b.realized : b.implied }))
    .sort((a, b) => a.x - b.x);

  // Enforce non-decreasing y by a forward pass; an inversion here is noise, not
  // signal, and the agent must never see it.
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.y < pts[i - 1]!.y) pts[i]!.y = pts[i - 1]!.y;
  }

  return (p: number) => {
    if (pts.length === 0) return p;
    if (p <= pts[0]!.x) return pts[0]!.y;
    if (p >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (p <= b.x) {
        const w = (p - a.x) / (b.x - a.x || 1);
        return a.y + w * (b.y - a.y);
      }
    }
    return p;
  };
}
