/**
 * Assay - historical backfill.
 *
 * Pulls the venue's entire binary-market history into the local store: markets,
 * fills, oracle answers, candles. Idempotent - every write is an upsert keyed on
 * the indexer's own id, so re-running only advances the tail and never
 * double-counts. That matters because the analytics are frequency counts; a
 * duplicated market would quietly bias the base rate.
 */

import { Indexer, toFloat, type Network } from "../indexer/client.js";
import {
  streamMarkets,
  streamFills,
  streamOracleAnswers,
  streamCandles,
  type RawMarket,
  type RawFill,
} from "../indexer/queries.js";
import { setMeta, type DB } from "../db/schema.js";

const int = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export interface BackfillProgress {
  stage: "markets" | "fills" | "oracle" | "candles";
  rows: number;
}

export interface BackfillResult {
  markets: number;
  fills: number;
  oracleAnswers: number;
  candles: number;
  elapsedMs: number;
}

export async function backfill(
  db: DB,
  ix: Indexer,
  opts: {
    network: Network;
    venueId?: string;
    decimals: number;
    marketLimit?: number;
    onProgress?: (p: BackfillProgress) => void;
  },
): Promise<BackfillResult> {
  const started = Date.now();
  const { decimals, network } = opts;
  const report = opts.onProgress ?? (() => {});

  const upsertMarket = db.prepare(`
    INSERT INTO markets (
      market_id, network, asset, question, strike, expiry, trading_start, interval_sec,
      venue_id, operator_id, finalized, voided, winning_outcome, resolved_at, created_at,
      trade_count, last_price, raw_midpoint, base_volume, quote_volume,
      pool_address, yes_token_id, no_token_id, oracle_question_id
    ) VALUES (
      @market_id, @network, @asset, @question, @strike, @expiry, @trading_start, @interval_sec,
      @venue_id, @operator_id, @finalized, @voided, @winning_outcome, @resolved_at, @created_at,
      @trade_count, @last_price, @raw_midpoint, @base_volume, @quote_volume,
      @pool_address, @yes_token_id, @no_token_id, @oracle_question_id
    )
    ON CONFLICT(market_id) DO UPDATE SET
      finalized = excluded.finalized,
      voided = excluded.voided,
      winning_outcome = excluded.winning_outcome,
      resolved_at = excluded.resolved_at,
      trade_count = excluded.trade_count,
      last_price = excluded.last_price,
      raw_midpoint = excluded.raw_midpoint,
      base_volume = excluded.base_volume,
      quote_volume = excluded.quote_volume
  `);

  const marketRow = (m: RawMarket) => ({
    market_id: m.marketId,
    network,
    asset: m.asset,
    question: m.question,
    strike: m.strike,
    expiry: int(m.expiry),
    trading_start: int(m.tradingStart),
    interval_sec: int(m.intervalSec),
    venue_id: m.venueId,
    operator_id: m.operatorId ?? null,
    finalized: m.finalized ? 1 : 0,
    voided: m.voided ? 1 : 0,
    // Only meaningful once finalized: an unresolved market reads
    // winningOutcome 0, which is indistinguishable from a real YES win.
    winning_outcome: m.finalized ? m.winningOutcome ?? null : null,
    resolved_at: int(m.resolvedAtTimestamp),
    created_at: int(m.createdAtTimestamp),
    trade_count: int(m.tradeCount) ?? 0,
    last_price: toFloat(m.lastPrice, decimals),
    raw_midpoint: toFloat(m.rawMidpoint, decimals),
    base_volume: toFloat(m.cumulativeBaseVolume, decimals),
    quote_volume: toFloat(m.cumulativeQuoteVolume, decimals),
    pool_address: m.binaryPoolAddress ?? m.poolAddress,
    yes_token_id: m.yesTokenId,
    no_token_id: m.noTokenId,
    oracle_question_id: m.oracleQuestionId,
  });

  let markets = 0;
  const writeMarkets = db.transaction((rows: RawMarket[]) => {
    for (const m of rows) upsertMarket.run(marketRow(m));
  });
  for await (const page of streamMarkets(ix, { venueId: opts.venueId, limit: opts.marketLimit })) {
    writeMarkets(page);
    markets += page.length;
    report({ stage: "markets", rows: markets });
  }

  const upsertFill = db.prepare(`
    INSERT INTO fills (id, market_id, price, quantity, quantity_raw, quote_quantity, ts, block_number, maker, taker, taker_is_bid, tx_hash)
    VALUES (@id, @market_id, @price, @quantity, @quantity_raw, @quote_quantity, @ts, @block_number, @maker, @taker, @taker_is_bid, @tx_hash)
    ON CONFLICT(id) DO NOTHING
  `);
  const fillRow = (f: RawFill) => ({
    id: f.id,
    market_id: f.market_id,
    price: toFloat(f.fillPrice, decimals),
    quantity: toFloat(f.quantity, decimals),
    quantity_raw: f.quantity,
    quote_quantity: toFloat(f.quoteQuantity, decimals),
    ts: int(f.timestamp),
    block_number: int(f.blockNumber),
    maker: f.maker?.toLowerCase() ?? null,
    taker: f.taker?.toLowerCase() ?? null,
    taker_is_bid: f.takerIsBid === null || f.takerIsBid === undefined ? null : f.takerIsBid ? 1 : 0,
    tx_hash: f.txHash,
  });

  let fills = 0;
  const writeFills = db.transaction((rows: RawFill[]) => {
    for (const f of rows) upsertFill.run(fillRow(f));
  });
  for await (const page of streamFills(ix)) {
    writeFills(page);
    fills += page.length;
    report({ stage: "fills", rows: fills });
  }

  const upsertOracle = db.prepare(`
    INSERT INTO oracle_answers (id, question_id, numeric_value, outcome_idx, outcome_label, resolved_at, voided)
    VALUES (@id, @question_id, @numeric_value, @outcome_idx, @outcome_label, @resolved_at, @voided)
    ON CONFLICT(id) DO UPDATE SET
      numeric_value = excluded.numeric_value,
      outcome_idx = excluded.outcome_idx,
      resolved_at = excluded.resolved_at,
      voided = excluded.voided
  `);
  let oracleAnswers = 0;
  const writeOracle = db.transaction((rows: { [k: string]: unknown }[]) => {
    for (const a of rows) upsertOracle.run(a);
  });
  for await (const page of streamOracleAnswers(ix)) {
    writeOracle(
      page.map((a) => ({
        id: a.id,
        question_id: a.oracleQuestionId,
        numeric_value: a.numericValue,
        outcome_idx: a.outcomeIdx ?? null,
        outcome_label: a.outcomeLabel,
        resolved_at: int(a.resolvedAt),
        voided: a.voided ? 1 : 0,
      })),
    );
    oracleAnswers += page.length;
    report({ stage: "oracle", rows: oracleAnswers });
  }

  const upsertCandle = db.prepare(`
    INSERT INTO candles (id, market_id, bucket_start, interval_seconds, open, close, high, low, volume, trade_count)
    VALUES (@id, @market_id, @bucket_start, @interval_seconds, @open, @close, @high, @low, @volume, @trade_count)
    ON CONFLICT(id) DO NOTHING
  `);
  let candles = 0;
  const writeCandles = db.transaction((rows: { [k: string]: unknown }[]) => {
    for (const c of rows) upsertCandle.run(c);
  });
  for await (const page of streamCandles(ix)) {
    writeCandles(
      page.map((c) => ({
        id: c.id,
        market_id: c.market_id,
        bucket_start: int(c.bucketStart),
        interval_seconds: int(c.intervalSeconds),
        open: toFloat(c.openPrice, decimals),
        close: toFloat(c.closePrice, decimals),
        high: toFloat(c.high, decimals),
        low: toFloat(c.low, decimals),
        volume: toFloat(c.baseVolume, decimals),
        trade_count: int(c.tradeCount) ?? 0,
      })),
    );
    candles += page.length;
    report({ stage: "candles", rows: candles });
  }

  setMeta(db, "last_backfill_at", String(Math.floor(Date.now() / 1000)));
  setMeta(db, "network", network);
  if (opts.venueId) setMeta(db, "venue_id", opts.venueId);

  return { markets, fills, oracleAnswers, candles, elapsedMs: Date.now() - started };
}
