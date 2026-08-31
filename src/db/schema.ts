/**
 * Calibra - local analytical store.
 *
 * SQLite rather than a server database, on purpose: the whole point of this
 * project is that anyone can reproduce the numbers. `npm run backfill` writes a
 * single file you can open in any SQLite client and check our arithmetic
 * against the chain yourself. Nothing here is a black box.
 *
 * Prices are stored as REAL at human scale (a probability in (0,1)) rather than
 * as fixed-point strings. Probabilities live in a range where float64 has ~15
 * significant digits to spare, so the conversion is lossless for every use we
 * make of it. Sizes keep their raw string alongside the float, because those DO
 * get large enough to lose precision and the agent reconciles against them.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS markets (
  market_id           TEXT PRIMARY KEY,
  network             TEXT NOT NULL,
  asset               TEXT,
  question            TEXT,
  strike              TEXT,
  expiry              INTEGER,
  trading_start       INTEGER,
  interval_sec        INTEGER,
  venue_id            TEXT,
  operator_id         INTEGER,
  finalized           INTEGER NOT NULL DEFAULT 0,
  voided              INTEGER NOT NULL DEFAULT 0,
  -- 0 = YES (underlying closed at or above open), 1 = NO. NULL until resolved.
  winning_outcome     INTEGER,
  resolved_at         INTEGER,
  created_at          INTEGER,
  trade_count         INTEGER NOT NULL DEFAULT 0,
  last_price          REAL,
  raw_midpoint        REAL,
  base_volume         REAL,
  quote_volume        REAL,
  pool_address        TEXT,
  yes_token_id        TEXT,
  no_token_id         TEXT,
  oracle_question_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_markets_expiry   ON markets(expiry);
CREATE INDEX IF NOT EXISTS idx_markets_resolved ON markets(finalized, expiry);
CREATE INDEX IF NOT EXISTS idx_markets_asset    ON markets(asset, interval_sec);
CREATE INDEX IF NOT EXISTS idx_markets_oq       ON markets(oracle_question_id);

CREATE TABLE IF NOT EXISTS fills (
  id             TEXT PRIMARY KEY,
  market_id      TEXT NOT NULL,
  -- The YES probability the trade printed at, in (0,1).
  price          REAL,
  quantity       REAL,
  quantity_raw   TEXT,
  quote_quantity REAL,
  ts             INTEGER,
  block_number   INTEGER,
  maker          TEXT,
  taker          TEXT,
  taker_is_bid   INTEGER,
  tx_hash        TEXT
);
CREATE INDEX IF NOT EXISTS idx_fills_market ON fills(market_id, ts);
CREATE INDEX IF NOT EXISTS idx_fills_ts     ON fills(ts);
CREATE INDEX IF NOT EXISTS idx_fills_maker  ON fills(maker);
CREATE INDEX IF NOT EXISTS idx_fills_taker  ON fills(taker);

CREATE TABLE IF NOT EXISTS oracle_answers (
  id            TEXT PRIMARY KEY,
  question_id   TEXT,
  numeric_value TEXT,
  outcome_idx   INTEGER,
  outcome_label TEXT,
  resolved_at   INTEGER,
  voided        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oracle_question ON oracle_answers(question_id);

CREATE TABLE IF NOT EXISTS candles (
  id               TEXT PRIMARY KEY,
  market_id        TEXT NOT NULL,
  bucket_start     INTEGER,
  interval_seconds INTEGER,
  open             REAL,
  close            REAL,
  high             REAL,
  low              REAL,
  volume           REAL,
  trade_count      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_candles_market ON candles(market_id, bucket_start);

-- Ingest bookkeeping, so a re-run resumes instead of restarting.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value,
  );
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
