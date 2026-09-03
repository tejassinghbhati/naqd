/**
 * Assay - the statistics the rest of the analytics stands on.
 *
 * This file exists because the obvious way to measure a prediction-market edge
 * is wrong, and wrong in a direction that manufactures confidence.
 *
 * The trap: you have N fills, each with an implied probability and a realized
 * outcome, so you take the mean pricing error over N and put a t-stat on it.
 * But every fill in one market resolves to the SAME outcome. Twenty fills in one
 * 15-minute BTC window are twenty copies of a single coin flip, not twenty
 * flips. On our mainnet history that inflates n from 1,200 to 2,683 and drives
 * the t-stat from -2.50 to -4.08 - the difference between "worth a look" and
 * "obviously real".
 *
 * Worse, the errors are correlated in TIME as well: whole weeks run rich and
 * whole weeks run cheap. So even the market-clustered t-stat overstates things.
 * `blockBootstrap` resamples whole weeks, which is the only interval estimate
 * here that survives contact with the data.
 */

export interface Estimate {
  mean: number;
  /** Standard error under the stated clustering. */
  se: number;
  t: number;
  ci95: [number, number];
  n: number;
}

const EMPTY: Estimate = { mean: 0, se: 0, t: 0, ci95: [0, 0], n: 0 };

export function estimate(xs: number[]): Estimate {
  const n = xs.length;
  if (n < 2) return { ...EMPTY, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const t = se > 0 ? mean / se : 0;
  return { mean, se, t, ci95: [mean - 1.96 * se, mean + 1.96 * se], n };
}

/**
 * Cluster-robust estimate: collapse each group to its mean, then treat the
 * groups as the sample. Use the market id as the group when scoring fills.
 */
export function clusteredEstimate<T>(rows: T[], groupOf: (r: T) => string, valueOf: (r: T) => number): Estimate {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = groupOf(r);
    const arr = groups.get(k);
    if (arr) arr.push(valueOf(r));
    else groups.set(k, [valueOf(r)]);
  }
  const means = [...groups.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  return estimate(means);
}

/** Deterministic PRNG, so a reported confidence interval is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Moving-block bootstrap over pre-formed blocks (we use calendar weeks).
 *
 * Resamples whole blocks with replacement, so any correlation INSIDE a block is
 * preserved and only correlation ACROSS blocks is assumed away. On our data the
 * ordinary CI on the pricing error is [-0.047, -0.006] - comfortably negative -
 * while this one is [-0.051, +0.022], which crosses zero. The second is the
 * honest one, and it is why Assay's agent refuses to trade a "constant" bias.
 */
export function blockBootstrap(
  blocks: number[][],
  opts: { resamples?: number; seed?: number } = {},
): { mean: number; ci95: [number, number]; crossesZero: boolean; blocks: number } {
  const usable = blocks.filter((b) => b.length > 0);
  const flat = usable.flat();
  if (usable.length < 2 || flat.length === 0) {
    const m = flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : 0;
    return { mean: m, ci95: [m, m], crossesZero: true, blocks: usable.length };
  }
  const rand = mulberry32(opts.seed ?? 7);
  const resamples = opts.resamples ?? 20_000;
  const means: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    let count = 0;
    for (let b = 0; b < usable.length; b++) {
      const blk = usable[Math.floor(rand() * usable.length)]!;
      for (const v of blk) {
        sum += v;
        count++;
      }
    }
    means.push(count ? sum / count : 0);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * means.length)]!;
  const hi = means[Math.floor(0.975 * means.length)]!;
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  return { mean, ci95: [lo, hi], crossesZero: lo < 0 && hi > 0, blocks: usable.length };
}

/**
 * Wilson score interval for a proportion.
 *
 * Preferred over the normal approximation because calibration buckets routinely
 * hold a handful of markets at p near 0 or 1, exactly where `p ± 1.96·√(p(1-p)/n)`
 * produces bounds outside [0,1] and a zero-width interval when p hits 0.
 */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - half) / d), Math.min(1, (centre + half) / d)];
}

/** Mean squared error of a probabilistic forecast. 0.25 = always saying 50%. */
export function brier(pairs: { p: number; outcome: 0 | 1 }[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((a, { p, outcome }) => a + (p - outcome) ** 2, 0) / pairs.length;
}

/**
 * Brier skill score against the always-50% forecaster: 1 is perfect, 0 is no
 * better than a coin, negative is worse than a coin. Reported instead of raw
 * Brier because "0.131" means nothing to a reader without the baseline.
 */
export function brierSkill(pairs: { p: number; outcome: 0 | 1 }[]): number {
  const b = brier(pairs);
  return Number.isNaN(b) ? NaN : 1 - b / 0.25;
}

/** ISO week key (`2026-W35`) - the block unit for the bootstrap. */
export function isoWeek(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
