/**
 * Naqd - where the liquidity actually is.
 *
 * The headline number for this venue is not its volume, it is its coverage: of
 * 6,906 binary markets created on mainnet, only ~1,200 ever printed a single
 * trade. Roughly five in six event contracts are listed, run their window and
 * settle without anyone taking a position.
 *
 * That reframes the opportunity. The bottleneck is not better signals for the
 * handful of contested markets - it is that most windows have no quotes at all.
 * These functions find the gaps, and the agent uses them to decide where its
 * quotes are worth the most.
 */

import type { DB } from "../db/schema.js";

export interface CoverageRow {
  asset: string;
  intervalSec: number;
  markets: number;
  traded: number;
  coverage: number;
  trades: number;
  volume: number;
}

export function coverage(db: DB): { overall: CoverageRow; bySeries: CoverageRow[] } {
  // NOTE: the two queries below deliberately select different columns. The
  // per-series one groups by asset/interval; the total must NOT select them at
  // all, because SQLite would happily return a bare `asset` alongside an
  // ungrouped COUNT(*) - picking one arbitrary row's value and labelling the
  // whole venue's totals "BTC / 374s". Correct counts under a nonsense label is
  // worse than an error, so the total simply does not ask for them.
  const AGG = `
           COUNT(*) markets,
           SUM(CASE WHEN trade_count > 0 THEN 1 ELSE 0 END) traded,
           SUM(trade_count) trades,
           SUM(COALESCE(base_volume, 0)) volume
    FROM markets
    WHERE finalized = 1 AND voided = 0
  `;
  const rows = db
    .prepare(`SELECT asset, interval_sec, ${AGG} GROUP BY asset, interval_sec HAVING markets >= 20 ORDER BY asset, interval_sec`)
    .all() as { asset: string; interval_sec: number; markets: number; traded: number; trades: number; volume: number }[];
  const tot = db.prepare(`SELECT ${AGG}`).get() as {
    markets: number;
    traded: number;
    trades: number;
    volume: number;
  };

  const shape = (r: { asset: string; interval_sec: number; markets: number; traded: number; trades: number; volume: number }): CoverageRow => ({
    asset: r.asset,
    intervalSec: r.interval_sec,
    markets: r.markets,
    traded: r.traded ?? 0,
    coverage: r.markets ? (r.traded ?? 0) / r.markets : 0,
    trades: r.trades ?? 0,
    volume: r.volume ?? 0,
  });

  return {
    overall: shape({ ...tot, asset: "ALL", interval_sec: 0 }),
    bySeries: rows.map(shape),
  };
}

/**
 * Coverage and pricing error by UTC hour of day.
 *
 * Worth splitting out because a venue with thin, bot-driven flow is not the
 * same market at 03:00 as at 15:00, and an agent that quotes the same width
 * around the clock is mispricing one of them. Hours are UTC to stay aligned
 * with the settlement schedule rather than any local session.
 */
export function byHourOfDay(db: DB): {
  hour: number;
  markets: number;
  traded: number;
  coverage: number;
  trades: number;
}[] {
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%H', expiry, 'unixepoch') AS INTEGER) hour,
              COUNT(*) markets,
              SUM(CASE WHEN trade_count > 0 THEN 1 ELSE 0 END) traded,
              SUM(trade_count) trades
       FROM markets
       WHERE finalized = 1 AND voided = 0 AND expiry IS NOT NULL
       GROUP BY hour ORDER BY hour`,
    )
    .all() as { hour: number; markets: number; traded: number; trades: number }[];
  return rows.map((r) => ({
    hour: r.hour,
    markets: r.markets,
    traded: r.traded ?? 0,
    coverage: r.markets ? (r.traded ?? 0) / r.markets : 0,
    trades: r.trades ?? 0,
  }));
}

/**
 * How concentrated the flow is.
 *
 * A venue where three wallets are 90% of the volume is not really a market yet,
 * and any calibration measured on it is measuring those three wallets' opinions.
 * Reported honestly next to the edge numbers so a reader can discount them
 * appropriately - the Herfindahl index runs 0 (perfectly diffuse) to 1 (one
 * participant).
 */
export function concentration(db: DB): {
  distinctTakers: number;
  distinctMakers: number;
  takerHHI: number;
  topTakerShare: number;
} {
  const takers = db
    .prepare(
      `SELECT f.taker addr, COUNT(*) n FROM fills f JOIN markets m ON m.market_id = f.market_id
       WHERE f.taker IS NOT NULL GROUP BY f.taker ORDER BY n DESC`,
    )
    .all() as { addr: string; n: number }[];
  const makers = db
    .prepare(
      `SELECT COUNT(DISTINCT f.maker) n FROM fills f JOIN markets m ON m.market_id = f.market_id
       WHERE f.maker IS NOT NULL`,
    )
    .get() as { n: number };

  const total = takers.reduce((a, t) => a + t.n, 0);
  const hhi = total > 0 ? takers.reduce((a, t) => a + (t.n / total) ** 2, 0) : 0;
  return {
    distinctTakers: takers.length,
    distinctMakers: makers?.n ?? 0,
    takerHHI: hhi,
    topTakerShare: total > 0 && takers[0] ? takers[0].n / total : 0,
  };
}
