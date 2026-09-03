/**
 * Assay agent - what to quote, and whether to quote at all.
 *
 * Kept free of any SDK or network dependency so the policy can be unit-tested
 * and replayed against history without a wallet. Everything here is a pure
 * function of (measured edge, current book, market clock).
 *
 * Three empirical results from `npm run analyze` drive every decision below:
 *
 *   1. The underlying is a coin flip. Across 6,902 resolved mainnet markets the
 *      window closed up 50.58% of the time, CI [49.40%, 51.76%] - indistinguish-
 *      able from 50%. So the prior is 0.5 and there is no directional drift to
 *      harvest. Any edge has to come from the PRICE being wrong, not the asset.
 *
 *   2. Makers get paid; takers do not. Settled PnL splits +1.34% ROI to the
 *      passive side and -2.18% to the aggressive side. So this agent is
 *      post-only. It never crosses a spread to express a view.
 *
 *   3. The mispricing is real but not constant. Week-block bootstrap puts the
 *      pricing error at [-5.1c, +2.2c] - straddling zero. So the agent asks
 *      `liveEdge()` every cycle and quotes nothing when the answer is
 *      stand-down.
 *
 * Result 3 is the one that makes this different from the sample strategies: the
 * default state is flat, and it takes positive evidence to leave it.
 */

import type { LiveEdge } from "../analytics/edge.js";

export interface BookTop {
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
}

export interface QuoteInputs {
  /** The venue's live YES book for this market. */
  book: BookTop;
  /** The current regime read from settled history. */
  edge: LiveEdge;
  /** Seconds until the market locks. */
  secondsLeft: number;
  /** The series cadence, so headroom scales with the window. */
  intervalSec: number;
}

export interface QuotePlan {
  /** Null when the agent should stand down on this market. */
  quotes: { side: "BUY_YES" | "SELL_YES"; probability: number; sizeMultiple: number }[];
  fair: number;
  halfSpread: number;
  reason: string;
  /** True when there was no book and we are the first quote in the window. */
  seeding: boolean;
}

export interface PolicyParams {
  /** Minimum half-spread to quote, in probability points. */
  minHalfSpread: number;
  /** Never quote outside these bounds - deep tails are a free option. */
  bounds: [number, number];
  /**
   * Refuse to quote when less than this FRACTION of the window remains.
   *
   * A fraction rather than a fixed number of seconds, deliberately: 300s of
   * headroom is prudent on an hourly series and rejects every market on a
   * 5-minute one. Scaling to the cadence keeps one constant correct for both.
   */
  minWindowFraction: number;
}

export const DEFAULT_POLICY: PolicyParams = {
  minHalfSpread: 0.02,
  bounds: [0.05, 0.95],
  minWindowFraction: 0.15,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Turn the measured edge and the current book into a two-sided post-only quote.
 *
 * Fair value is the book's mid corrected by the measured pricing error: the
 * edge is defined as (realized − implied), so if history says the venue's
 * prices run 3 cents rich on UP, the honest estimate of the true probability is
 * mid + edge. When there is no book at all - five markets in six, on this venue
 * - the prior takes over and fair value is 0.5 + edge. That case is not an
 * edge case here, it is the main one.
 */
export function planQuotes(inputs: QuoteInputs, params: PolicyParams = DEFAULT_POLICY): QuotePlan {
  const { book, edge, secondsLeft, intervalSec } = inputs;
  const none = (reason: string, fair = 0.5): QuotePlan => ({
    quotes: [],
    fair,
    halfSpread: 0,
    reason,
    seeding: false,
  });

  if (edge.verdict === "stand-down") return none(`stand down: ${edge.reason}`);

  // Late in a window the price is dominated by information we do not have, and
  // a resting quote is most likely to be picked off by someone who does.
  const fractionLeft = intervalSec > 0 ? secondsLeft / intervalSec : 0;
  if (fractionLeft < params.minWindowFraction) {
    return none(`only ${(fractionLeft * 100).toFixed(0)}% of the window left (need ${(params.minWindowFraction * 100).toFixed(0)}%)`);
  }

  const seeding = book.mid === undefined;
  const anchor = book.mid ?? 0.5;

  // A market already trading outside our bounds is one where the outcome is
  // close to decided. Clamping the fair value back into range there does not
  // produce a conservative quote, it produces a WRONG one: with a mid of 0.028
  // the clamp yields a 0.05 bid, which is a bid above the market. Stand down
  // instead - having no view is a legitimate answer.
  if (anchor < params.bounds[0] || anchor > params.bounds[1]) {
    return none(`mid ${anchor.toFixed(3)} is outside [${params.bounds[0]}, ${params.bounds[1]}] - no view`, anchor);
  }

  const fair = clamp(anchor + edge.edge, params.bounds[0], params.bounds[1]);

  // Widen with the size of the edge: a bigger claimed mispricing means a bigger
  // model, and a bigger model deserves a bigger margin for being wrong. Widen
  // further when seeding, since a book with no trades gives no confirmation.
  const halfSpread = Math.max(params.minHalfSpread, Math.abs(edge.edge)) * (seeding ? 1.5 : 1);

  let bid = clamp(fair - halfSpread, params.bounds[0], params.bounds[1]);
  let ask = clamp(fair + halfSpread, params.bounds[0], params.bounds[1]);

  // Post-only rejects any order that would match on arrival, so a quote that
  // crosses the resting book is not a risk - it is simply a wasted transaction.
  // Pull each side back behind the touch rather than sending it to be refused.
  const tick = params.minHalfSpread / 4;
  if (book.bestAsk !== undefined && bid >= book.bestAsk) bid = book.bestAsk - tick;
  if (book.bestBid !== undefined && ask <= book.bestBid) ask = book.bestBid + tick;

  const sides: QuotePlan["quotes"] = [];
  if (bid >= params.bounds[0] && bid < fair) {
    sides.push({ side: "BUY_YES", probability: bid, sizeMultiple: edge.confidence });
  }
  if (ask <= params.bounds[1] && ask > fair) {
    sides.push({ side: "SELL_YES", probability: ask, sizeMultiple: edge.confidence });
  }
  if (sides.length === 0) return none("both sides would cross or breach the bounds", fair);

  return {
    quotes: sides,
    fair,
    halfSpread,
    reason: seeding
      ? `seeding an empty book at fair ${fair.toFixed(3)} (prior 0.5 ${edge.edge >= 0 ? "+" : ""}${edge.edge.toFixed(3)} edge)`
      : `quoting around fair ${fair.toFixed(3)} (mid ${anchor.toFixed(3)} ${edge.edge >= 0 ? "+" : ""}${edge.edge.toFixed(3)} edge)`,
    seeding,
  };
}

/**
 * Order expiry, in nanoseconds.
 *
 * Every binary order must carry one, and the pool rejects anything past its own
 * market expiry (`OrderExpiryBeyondMarket`). Setting it just past the requote
 * interval means a crashed agent's orders age off the book by themselves rather
 * than resting with escrow locked until the window closes.
 */
export function orderExpiryNs(nowSec: number, requoteSec: number, marketExpirySec: number): bigint {
  const target = Math.min(nowSec + requoteSec * 2, marketExpirySec);
  return BigInt(Math.floor(target)) * 1_000_000_000n;
}
