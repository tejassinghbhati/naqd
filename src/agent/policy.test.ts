/**
 * Policy tests. Run with `npm test`.
 *
 * The policy is pure by design so the decisions that risk money can be checked
 * without a wallet, a network, or a market being open. The cases below are the
 * ones that were wrong at some point during development, kept as regressions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planQuotes, orderExpiryNs, DEFAULT_POLICY } from "./policy.js";
import type { LiveEdge } from "../analytics/edge.js";
import { estimate, clusteredEstimate, blockBootstrap, wilson, isoWeek } from "../analytics/stats.js";

const edgeOf = (overrides: Partial<LiveEdge> = {}): LiveEdge => ({
  verdict: "trade",
  reason: "test",
  edge: -0.03,
  recent: { mean: -0.03, se: 0.01, t: -3, ci95: [-0.05, -0.01], n: 100 },
  lifetime: { mean: -0.03, se: 0.01, t: -3, ci95: [-0.05, -0.01], n: 500 },
  sampleMarkets: 100,
  windowDays: 7,
  confidence: 0.8,
  ...overrides,
});

const inputs = (book: { bestBid?: number; bestAsk?: number; mid?: number }, edge = edgeOf()) => ({
  book,
  edge,
  secondsLeft: 700,
  intervalSec: 900,
});

test("stands down whenever the edge says stand down", () => {
  const plan = planQuotes(inputs({ mid: 0.5 }, edgeOf({ verdict: "stand-down", reason: "CI contains zero" })));
  assert.equal(plan.quotes.length, 0);
  assert.match(plan.reason, /stand down/);
});

test("quotes both sides around an edge-corrected mid", () => {
  const plan = planQuotes(inputs({ bestBid: 0.48, bestAsk: 0.52, mid: 0.5 }));
  assert.equal(plan.quotes.length, 2);
  // edge is -0.03, so fair sits below the mid
  assert.ok(Math.abs(plan.fair - 0.47) < 1e-9, `fair was ${plan.fair}`);
  const bid = plan.quotes.find((q) => q.side === "BUY_YES")!;
  const ask = plan.quotes.find((q) => q.side === "SELL_YES")!;
  assert.ok(bid.probability < plan.fair && ask.probability > plan.fair);
});

test("seeds an empty book from the 0.5 prior and widens for it", () => {
  const plan = planQuotes(inputs({}));
  assert.equal(plan.seeding, true);
  assert.equal(plan.quotes.length, 2);
  // No book means no confirmation, so the spread is 1.5x the normal width.
  const normal = planQuotes(inputs({ bestBid: 0.48, bestAsk: 0.52, mid: 0.5 }));
  assert.ok(plan.halfSpread > normal.halfSpread);
});

test("refuses a market whose mid is outside the bounds instead of clamping", () => {
  // Regression: a 0.028 mid used to clamp to a 0.05 bid - a bid ABOVE the
  // market, which post-only would simply reject.
  const plan = planQuotes(inputs({ bestBid: 0.02, bestAsk: 0.036, mid: 0.028 }));
  assert.equal(plan.quotes.length, 0);
  assert.match(plan.reason, /outside/);
});

test("never posts a bid at or above the best ask", () => {
  // A tight book where the naive quote would cross.
  const plan = planQuotes(inputs({ bestBid: 0.49, bestAsk: 0.495, mid: 0.4925 }));
  for (const q of plan.quotes) {
    if (q.side === "BUY_YES") assert.ok(q.probability < 0.495, `bid ${q.probability} crossed the ask`);
    if (q.side === "SELL_YES") assert.ok(q.probability > 0.49, `ask ${q.probability} crossed the bid`);
  }
});

test("refuses to quote in the last stretch of a window, scaled to the cadence", () => {
  // 100s left on a 900s window is 11% - under the 15% floor.
  const short = planQuotes({ ...inputs({ mid: 0.5 }), secondsLeft: 100, intervalSec: 900 });
  assert.equal(short.quotes.length, 0);
  // The same 100s on a 300s window is 33%, which is fine. A fixed-seconds rule
  // would have rejected both.
  const fast = planQuotes({ ...inputs({ mid: 0.5 }), secondsLeft: 100, intervalSec: 300 });
  assert.ok(fast.quotes.length > 0);
});

test("size scales with confidence", () => {
  const weak = planQuotes(inputs({ mid: 0.5 }, edgeOf({ confidence: 0.1 })));
  const strong = planQuotes(inputs({ mid: 0.5 }, edgeOf({ confidence: 1 })));
  assert.ok(weak.quotes[0]!.sizeMultiple < strong.quotes[0]!.sizeMultiple);
});

test("order expiry never outlives the market", () => {
  const now = 1_000_000;
  // Requote horizon would run past expiry; it must be capped at expiry.
  const ns = orderExpiryNs(now, 600, now + 100);
  assert.equal(ns, BigInt(now + 100) * 1_000_000_000n);
  // Comfortably inside the window, the horizon wins.
  const ns2 = orderExpiryNs(now, 45, now + 10_000);
  assert.equal(ns2, BigInt(now + 90) * 1_000_000_000n);
});

test("clustering collapses correlated observations", () => {
  // Twenty fills in one market are one observation, not twenty. The naive
  // estimate should report a far smaller standard error than the clustered one.
  const rows = [
    ...Array.from({ length: 20 }, () => ({ m: "a", v: 1 })),
    ...Array.from({ length: 20 }, () => ({ m: "b", v: -1 })),
  ];
  const naive = estimate(rows.map((r) => r.v));
  const clustered = clusteredEstimate(rows, (r) => r.m, (r) => r.v);
  assert.equal(clustered.n, 2);
  assert.equal(naive.n, 40);
  assert.ok(clustered.se > naive.se, "clustering must widen the standard error");
});

test("block bootstrap detects a sign-flipping series as inconclusive", () => {
  // Weeks that disagree: the pooled mean is negative but no stable conclusion
  // exists. The interval must straddle zero.
  const blocks = [
    Array.from({ length: 50 }, () => -0.06),
    Array.from({ length: 50 }, () => +0.05),
    Array.from({ length: 50 }, () => -0.04),
  ];
  const boot = blockBootstrap(blocks, { resamples: 2000, seed: 1 });
  assert.equal(boot.crossesZero, true);
});

test("block bootstrap is deterministic across runs", () => {
  const blocks = [[0.1, 0.2], [0.15, 0.05], [0.12, 0.18]];
  const a = blockBootstrap(blocks, { resamples: 1000, seed: 42 });
  const b = blockBootstrap(blocks, { resamples: 1000, seed: 42 });
  assert.deepEqual(a.ci95, b.ci95);
});

test("wilson interval stays inside [0,1] at the extremes", () => {
  const [lo, hi] = wilson(0, 10);
  assert.ok(lo >= 0 && hi <= 1);
  // The normal approximation gives a zero-width interval here; Wilson must not.
  assert.ok(hi > 0, "a 0/10 outcome still has upper uncertainty");
});

test("isoWeek groups a week together and separates adjacent ones", () => {
  const mon = Date.UTC(2026, 7, 24) / 1000;
  const sun = Date.UTC(2026, 7, 30) / 1000;
  const nextMon = Date.UTC(2026, 7, 31) / 1000;
  assert.equal(isoWeek(mon), isoWeek(sun));
  assert.notEqual(isoWeek(sun), isoWeek(nextMon));
});
