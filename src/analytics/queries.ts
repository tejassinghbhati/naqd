/**
 * Naqd - the one place that reads scored trades out of the store.
 *
 * Every analysis in this project is a view over the same join: a fill, the
 * market it printed on, and how that market actually resolved. Centralising it
 * keeps one definition of "a scored trade" - in particular the two filters that
 * are easy to forget and that quietly corrupt every downstream number:
 *
 *   - `voided = 0`. A voided market pays BOTH sides 0.5. It has no winner, so
 *     scoring it as a YES loss is simply false.
 *   - `finalized = 1`. On an unresolved market the indexer's `winningOutcome`
 *     reads 0, which is indistinguishable from a genuine YES win. Including
 *     live markets would score every open position as a YES victory.
 */

import type { DB } from "../db/schema.js";

/** A fill joined to its market's realized outcome. */
export interface ScoredFill {
  marketId: string;
  asset: string;
  intervalSec: number;
  /** The YES probability this trade printed at. */
  price: number;
  quantity: number;
  ts: number;
  expiry: number;
  /** 1 if the underlying closed at or above its open (outcome YES), else 0. */
  up: 0 | 1;
  /** Fraction of the trading window still remaining when this printed, in [0,1]. */
  fracLeft: number;
  maker: string | null;
  taker: string | null;
  takerIsBid: number | null;
}

const SCORED_SQL = `
  SELECT f.market_id, m.asset, m.interval_sec, f.price, f.quantity, f.ts, m.expiry,
         m.winning_outcome, f.maker, f.taker, f.taker_is_bid
  FROM fills f
  JOIN markets m ON m.market_id = f.market_id
  WHERE m.finalized = 1
    AND m.voided = 0
    AND m.winning_outcome IS NOT NULL
    AND f.price IS NOT NULL
    AND f.ts IS NOT NULL
    AND m.expiry IS NOT NULL
    AND m.interval_sec > 0
`;

interface Row {
  market_id: string;
  asset: string | null;
  interval_sec: number;
  price: number;
  quantity: number | null;
  ts: number;
  expiry: number;
  winning_outcome: number;
  maker: string | null;
  taker: string | null;
  taker_is_bid: number | null;
}

const toScored = (r: Row): ScoredFill => ({
  marketId: r.market_id,
  asset: r.asset ?? "?",
  intervalSec: r.interval_sec,
  price: r.price,
  quantity: r.quantity ?? 0,
  ts: r.ts,
  expiry: r.expiry,
  up: r.winning_outcome === 0 ? 1 : 0,
  // Clamped: the indexer's fill timestamp can land a second or two past a
  // market's recorded expiry, which would otherwise produce a negative
  // "fraction of window left" and land in no time bucket at all.
  fracLeft: Math.max(0, Math.min(1, (r.expiry - r.ts) / r.interval_sec)),
  maker: r.maker,
  taker: r.taker,
  takerIsBid: r.taker_is_bid,
});

export interface ScopeFilter {
  asset?: string;
  intervalSec?: number;
  /** Only fills at or after this unix second. */
  since?: number;
}

export function scoredFills(db: DB, scope: ScopeFilter = {}): ScoredFill[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.asset) {
    clauses.push("m.asset = ?");
    params.push(scope.asset);
  }
  if (scope.intervalSec) {
    clauses.push("m.interval_sec = ?");
    params.push(scope.intervalSec);
  }
  if (scope.since) {
    clauses.push("f.ts >= ?");
    params.push(scope.since);
  }
  const sql = SCORED_SQL + (clauses.length ? ` AND ${clauses.join(" AND ")}` : "") + " ORDER BY f.ts";
  return (db.prepare(sql).all(...params) as Row[]).map(toScored);
}

/** One row per resolved market that traded, with its volume-weighted implied
 *  probability. This is the unit of observation for anything that needs
 *  independent samples - see `stats.ts` for why fills are not. */
export interface ScoredMarket {
  marketId: string;
  asset: string;
  intervalSec: number;
  expiry: number;
  vwap: number;
  fills: number;
  volume: number;
  up: 0 | 1;
}

export function scoredMarkets(db: DB, scope: ScopeFilter = {}): ScoredMarket[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.asset) {
    clauses.push("m.asset = ?");
    params.push(scope.asset);
  }
  if (scope.intervalSec) {
    clauses.push("m.interval_sec = ?");
    params.push(scope.intervalSec);
  }
  if (scope.since) {
    clauses.push("m.expiry >= ?");
    params.push(scope.since);
  }
  const sql = `
    SELECT m.market_id, m.asset, m.interval_sec, m.expiry, m.winning_outcome,
           SUM(f.price * f.quantity) / NULLIF(SUM(f.quantity), 0) AS vwap,
           COUNT(f.id) AS nfills,
           SUM(f.quantity) AS volume
    FROM markets m
    JOIN fills f ON f.market_id = m.market_id
    WHERE m.finalized = 1 AND m.voided = 0 AND m.winning_outcome IS NOT NULL
      AND f.price IS NOT NULL AND f.quantity > 0
      ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
    GROUP BY m.market_id
    HAVING vwap IS NOT NULL
    ORDER BY m.expiry
  `;
  const rows = db.prepare(sql).all(...params) as {
    market_id: string;
    asset: string | null;
    interval_sec: number;
    expiry: number;
    winning_outcome: number;
    vwap: number;
    nfills: number;
    volume: number;
  }[];
  return rows.map((r) => ({
    marketId: r.market_id,
    asset: r.asset ?? "?",
    intervalSec: r.interval_sec,
    expiry: r.expiry,
    vwap: r.vwap,
    fills: r.nfills,
    volume: r.volume ?? 0,
    up: r.winning_outcome === 0 ? 1 : 0,
  }));
}

/** Resolution counts over every market, traded or not - the venue's true base
 *  rate, which the traded subset does not represent (traded markets skew). */
export function baseRate(
  db: DB,
  scope: ScopeFilter = {},
): { n: number; up: number; rate: number; byAsset: { asset: string; intervalSec: number; n: number; rate: number }[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.asset) {
    clauses.push("asset = ?");
    params.push(scope.asset);
  }
  if (scope.intervalSec) {
    clauses.push("interval_sec = ?");
    params.push(scope.intervalSec);
  }
  const where = `WHERE finalized = 1 AND voided = 0 AND winning_outcome IS NOT NULL
    ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}`;

  const tot = db
    .prepare(`SELECT COUNT(*) n, SUM(CASE WHEN winning_outcome = 0 THEN 1 ELSE 0 END) up FROM markets ${where}`)
    .get(...params) as { n: number; up: number };

  // Cadences other than the scheduled 15m/1h are one-off artifacts of a venue
  // migration (a handful of markets with odd intervals like 374s). They are
  // real resolutions but they are not a series anyone can trade, so the
  // breakdown only reports cadences with enough markets to mean something.
  const byAsset = db
    .prepare(
      `SELECT asset, interval_sec, COUNT(*) n,
              1.0 * SUM(CASE WHEN winning_outcome = 0 THEN 1 ELSE 0 END) / COUNT(*) rate
       FROM markets ${where} GROUP BY asset, interval_sec HAVING n >= 20 ORDER BY asset, interval_sec`,
    )
    .all(...params) as { asset: string; interval_sec: number; n: number; rate: number }[];

  return {
    n: tot.n ?? 0,
    up: tot.up ?? 0,
    rate: tot.n ? tot.up / tot.n : 0,
    byAsset: byAsset.map((r) => ({ asset: r.asset, intervalSec: r.interval_sec, n: r.n, rate: r.rate })),
  };
}
