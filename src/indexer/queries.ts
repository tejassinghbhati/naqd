/**
 * Naqd - the specific reads we make against the indexer.
 *
 * Field selection is deliberate. `Market` exposes ~70 columns, most of which
 * belong to perps or spot; pulling them all across 8k+ rows is wasted bandwidth
 * on every backfill. Each query here takes only what a downstream analysis
 * actually consumes.
 */

import { Indexer } from "./client.js";

/** Binary event-contract market row, as the indexer stores it (raw strings). */
export interface RawMarket {
  marketId: string;
  asset: string | null;
  question: string | null;
  strike: string | null;
  expiry: string | null;
  tradingStart: string | null;
  intervalSec: string | null;
  venueId: string | null;
  operatorId: number | null;
  finalized: boolean | null;
  voided: boolean | null;
  winningOutcome: number | null;
  resolvedAtTimestamp: string | null;
  createdAtTimestamp: string | null;
  tradeCount: string | null;
  lastPrice: string | null;
  rawMidpoint: string | null;
  cumulativeBaseVolume: string | null;
  cumulativeQuoteVolume: string | null;
  poolAddress: string | null;
  binaryPoolAddress: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  oracleQuestionId: string | null;
}

const MARKET_FIELDS = `
  marketId asset question strike expiry tradingStart intervalSec
  venueId operatorId finalized voided winningOutcome
  resolvedAtTimestamp createdAtTimestamp
  tradeCount lastPrice rawMidpoint cumulativeBaseVolume cumulativeQuoteVolume
  poolAddress binaryPoolAddress yesTokenId noTokenId oracleQuestionId
`;

/** A single trade against a binary pool. */
export interface RawFill {
  id: string;
  market_id: string;
  fillPrice: string | null;
  quantity: string | null;
  quoteQuantity: string | null;
  timestamp: string | null;
  blockNumber: string | null;
  maker: string | null;
  taker: string | null;
  takerIsBid: boolean | null;
  makerSide: number | null;
  takerSide: number | null;
  txHash: string | null;
  pool: string | null;
}

const FILL_FIELDS = `
  id market_id fillPrice quantity quoteQuantity timestamp blockNumber
  maker taker takerIsBid makerSide takerSide txHash pool
`;

/** The oracle's settlement answer. `numericValue` is the observed close. */
export interface RawOracleAnswer {
  id: string;
  oracleQuestionId: string | null;
  numericValue: string | null;
  outcomeIdx: number | null;
  outcomeLabel: string | null;
  resolvedAt: string | null;
  voided: boolean | null;
  voidReason: string | null;
}

const ORACLE_FIELDS = `id oracleQuestionId numericValue outcomeIdx outcomeLabel resolvedAt voided voidReason`;

/** OHLC bar for a market's own probability, not the underlying. */
export interface RawCandle {
  id: string;
  market_id: string;
  bucketStart: string | null;
  intervalSeconds: string | null;
  openPrice: string | null;
  closePrice: string | null;
  high: string | null;
  low: string | null;
  baseVolume: string | null;
  tradeCount: string | null;
}

const CANDLE_FIELDS = `id market_id bucketStart intervalSeconds openPrice closePrice high low baseVolume tradeCount`;

const venueClause = (venueId?: string) => (venueId ? `venueId: {_eq: ${JSON.stringify(venueId)}}` : null);

const and = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");

/**
 * Every binary market on the venue, newest last.
 *
 * Includes unresolved ones on purpose: the calibration pipeline needs the live
 * tail to know which markets it is still waiting on, and excluding them here
 * would mean a second query for the same rows.
 */
export async function* streamMarkets(
  ix: Indexer,
  opts: { venueId?: string; resolvedOnly?: boolean; limit?: number; pageSize?: number } = {},
): AsyncGenerator<RawMarket[]> {
  const where = and(
    `marketType: {_eq: "BINARY"}`,
    venueClause(opts.venueId),
    opts.resolvedOnly ? `finalized: {_eq: true}` : null,
  );
  yield* ix.paginate<RawMarket & Record<string, unknown>>({
    table: "Market",
    fields: MARKET_FIELDS,
    cursorField: "marketId",
    where,
    limit: opts.limit,
    pageSize: opts.pageSize ?? 400,
  });
}

/**
 * Every fill printed against a BINARY market.
 *
 * Scoped through the `market` relationship rather than a list of ids: an `_in`
 * clause carrying eight thousand market ids is a request no server should be
 * asked to parse, and the relationship filter is exact. Paged numerically on
 * block number - see `paginateNumeric` for why `id` is not safe to key on.
 */
export async function* streamFills(
  ix: Indexer,
  opts: { sinceBlock?: number; limit?: number; pageSize?: number } = {},
): AsyncGenerator<RawFill[]> {
  const where = and(
    `market: {marketType: {_eq: "BINARY"}}`,
    opts.sinceBlock ? `blockNumber: {_gte: ${JSON.stringify(String(opts.sinceBlock))}}` : null,
  );
  yield* ix.paginateNumeric<RawFill & Record<string, unknown>>({
    table: "Fill",
    fields: FILL_FIELDS,
    cursorField: "blockNumber",
    where,
    limit: opts.limit,
    pageSize: opts.pageSize ?? 500,
  });
}

/** Oracle answers, which carry the underlying's observed close price. */
export async function* streamOracleAnswers(
  ix: Indexer,
  opts: { limit?: number; pageSize?: number } = {},
): AsyncGenerator<RawOracleAnswer[]> {
  yield* ix.paginate<RawOracleAnswer & Record<string, unknown>>({
    table: "OracleAnswer",
    fields: ORACLE_FIELDS,
    cursorField: "id",
    limit: opts.limit,
    pageSize: opts.pageSize ?? 500,
  });
}

export async function* streamCandles(
  ix: Indexer,
  opts: { limit?: number; pageSize?: number } = {},
): AsyncGenerator<RawCandle[]> {
  yield* ix.paginateNumeric<RawCandle & Record<string, unknown>>({
    table: "Candle",
    fields: CANDLE_FIELDS,
    cursorField: "bucketStart",
    where: `market: {marketType: {_eq: "BINARY"}}`,
    limit: opts.limit,
    pageSize: opts.pageSize ?? 500,
  });
}

/** Currently-tradable markets on the venue, soonest expiry first. Used by the
 *  agent to pick what to quote, and by the API's /markets/live route. */
export async function liveMarkets(ix: Indexer, venueId?: string, limit = 50): Promise<RawMarket[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const where = and(
    `marketType: {_eq: "BINARY"}`,
    venueClause(venueId),
    `finalized: {_eq: false}`,
    `expiry: {_gt: ${JSON.stringify(String(nowSec))}}`,
  );
  const q = `query { Market(where: {${where}}, order_by: {expiry: asc}, limit: ${limit}) { ${MARKET_FIELDS} } }`;
  const data = await ix.query<{ Market: RawMarket[] }>(q);
  return data.Market ?? [];
}

/** Distinct venues currently carrying live binary markets - the doctor uses
 *  this to tell you when the hard-coded venue id has moved. */
export async function observedVenues(ix: Indexer): Promise<{ venueId: string; count: number }[]> {
  const q = `query { Market(where: {marketType: {_eq: "BINARY"}}, order_by: {marketId: desc}, limit: 400) { venueId } }`;
  const data = await ix.query<{ Market: { venueId: string | null }[] }>(q);
  const counts = new Map<string, number>();
  for (const row of data.Market ?? []) {
    if (!row.venueId) continue;
    counts.set(row.venueId, (counts.get(row.venueId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([venueId, count]) => ({ venueId, count }))
    .sort((a, b) => b.count - a.count);
}
