/**
 * Naqd app - reading live markets, books, and positions.
 *
 * Everything here is a read. Writes live in exchange.ts, so a component that
 * only displays data cannot accidentally reach a signer.
 *
 * All of it goes through the SDK's BINARY tier (`client.listLiveBinaryMarkets`,
 * `getBinaryOrderBook`, `getFills`) rather than the unified tier, and that is
 * not a style preference. `exchange.loadMarkets()` walks every venue on the
 * chain and builds a viem client per venue: measured against mainnet it takes
 * over five minutes to return, cached or forced. A terminal built on it sits on
 * "connecting" until the user leaves. The binary tier answers the same question
 * with one indexer query in under two seconds, so that is what the desk reads.
 *
 * The consequence is that markets are keyed by `marketId` and books by
 * `poolAddress`, never by a unified symbol string. That is the right identity
 * anyway: a binary pool is RECYCLED across successive markets, so a pool
 * address does not name a market for longer than one window.
 */

import type { SomniaMarkets, MarketOnchain } from "@somnia-chain/markets-sdk";
import type { Address, Hex } from "viem";
import type { NetworkConfig } from "./chain";

export interface LiveMarket {
  marketId: Hex;
  /** The pool the book rests on. Time-varying: pools are recycled. */
  pool: Address;
  asset: string;
  question: string;
  intervalSec: number;
  expiry: number;
  /** When the window opened. Bounds the tape and the price track. */
  tradingStart: number;
  venueId: string;
}

/** One row as the binary tier returns it. Every scalar arrives as a string. */
interface BinaryRow {
  marketId?: string;
  poolAddress?: string;
  asset?: string;
  question?: string;
  intervalSec?: number | string;
  expiry?: number | string;
  tradingStart?: number | string;
  createdAtTimestamp?: number | string;
  venueId?: string;
  status?: string;
}

const num = (v: unknown): number => Number(v ?? 0);

function shape(r: BinaryRow): LiveMarket | null {
  if (!r.marketId || !r.poolAddress) return null;
  const expiry = num(r.expiry);
  const intervalSec = num(r.intervalSec);
  if (!(expiry > 0) || !(intervalSec > 0)) return null;
  return {
    marketId: r.marketId as Hex,
    pool: r.poolAddress as Address,
    asset: r.asset ?? "?",
    // Never parse the question text for meaning - its wording has changed
    // several times. It is display copy only; `asset` and `intervalSec` are
    // the fields that carry the actual semantics.
    question: r.question ?? `${r.asset ?? "?"} closes at or above its opening price`,
    intervalSec,
    expiry,
    tradingStart: num(r.tradingStart ?? r.createdAtTimestamp) || expiry - intervalSec,
    venueId: String(r.venueId ?? ""),
  };
}

const sortByExpiry = (ms: LiveMarket[]) => [...ms].sort((a, b) => a.expiry - b.expiry);

/**
 * Every currently-tradable binary market, soonest expiry first.
 *
 * Venue scoping is intentionally forgiving. Venue ids move - both networks
 * changed theirs three times in one week - and a UI that silently shows an
 * empty list because a hard-coded constant went stale is worse than one that
 * shows the markets that are actually there. So: prefer the configured venue,
 * but if it has nothing live, fall back to whichever venue does, and tell the
 * caller that happened so the UI can say so.
 */
export async function loadLiveMarkets(
  exchange: SomniaMarkets,
  cfg: NetworkConfig,
): Promise<{ markets: LiveMarket[]; venueId: string; usedFallback: boolean }> {
  const list = async (venueId?: string): Promise<LiveMarket[]> => {
    const rows = (await exchange.client.listLiveBinaryMarkets({
      ...(venueId ? { venueId } : {}),
      status: "Trading",
      limit: 50,
    })) as BinaryRow[];
    return rows.map(shape).filter((m): m is LiveMarket => m !== null);
  };

  const onConfigured = await list(cfg.venueId);
  if (onConfigured.length > 0) {
    return { markets: sortByExpiry(onConfigured), venueId: cfg.venueId, usedFallback: false };
  }

  // Configured venue is empty. Take whichever venue is carrying the most.
  const all = await list();
  const byVenue = new Map<string, LiveMarket[]>();
  for (const m of all) {
    const k = m.venueId.toLowerCase();
    const arr = byVenue.get(k);
    if (arr) arr.push(m);
    else byVenue.set(k, [m]);
  }
  const best = [...byVenue.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return { markets: [], venueId: cfg.venueId, usedFallback: false };
  return { markets: sortByExpiry(best[1]), venueId: best[0], usedFallback: true };
}

export interface BookLevel {
  price: number;
  size: number;
}

/** One print on the tape. Mirrors the shape the Tape component renders. */
export interface Print {
  id: string;
  price: number;
  amount: number;
  side?: "buy" | "sell";
  /** Milliseconds, to match Date. */
  timestamp: number;
}

export interface Book {
  /** Bids and asks in YES/UP probability terms. */
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
  /** True when the book is completely empty - the common case on this venue. */
  empty: boolean;
}

const EMPTY_BOOK: Book = { bids: [], asks: [], empty: true };

/**
 * A market's resting book, in UP-probability terms.
 *
 * The chain read returns raw collateral units per whole outcome token, so a
 * price of 0.63 arrives as 630000000000000000n on an 18-decimal venue. Scaling
 * happens here, once, against the network's own decimals - doing it in a
 * component is how a book ends up rendering 6.3e17 on one chain and 630000 on
 * the other.
 */
export async function loadBook(
  exchange: SomniaMarkets,
  cfg: NetworkConfig,
  pool: Address,
  depth = 8,
): Promise<Book> {
  try {
    const one = 10 ** cfg.decimals;
    const ob = await exchange.client.getBinaryOrderBook(pool, { depth, decimals: cfg.decimals });
    const lvl = (ls: { price: bigint; quantity: bigint }[]): BookLevel[] =>
      ls.map((l) => ({ price: Number(l.price) / one, size: Number(l.quantity) / one }));
    const bids = lvl(ob.yesBids ?? []);
    const asks = lvl(ob.yesAsks ?? []);
    const bestBid = bids[0]?.price;
    const bestAsk = asks[0]?.price;
    const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
    return { bids, asks, bestBid, bestAsk, mid, empty: bids.length === 0 && asks.length === 0 };
  } catch {
    // An empty book is the normal state here, not an error: roughly five in six
    // markets on this venue never trade at all.
    return EMPTY_BOOK;
  }
}

/**
 * Top of book for many markets in one round-trip.
 *
 * The market list needs an implied probability per row, and asking the chain
 * per pool is an N+1 that scales with however many windows happen to be open.
 * Keyed on marketId rather than pool, which is what makes it recycle-safe.
 */
export async function loadBookTops(
  exchange: SomniaMarkets,
  cfg: NetworkConfig,
  marketIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (marketIds.length === 0) return out;
  try {
    const one = 10 ** cfg.decimals;
    const tops = await exchange.client.getBookTops(marketIds);
    for (const [id, t] of Object.entries(tops)) {
      const bid = t.bestBid === null ? undefined : Number(t.bestBid) / one;
      const ask = t.bestAsk === null ? undefined : Number(t.bestAsk) / one;
      const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : bid ?? ask;
      if (mid !== undefined) out.set(id.toLowerCase(), mid);
    }
  } catch {
    // Fall through to an empty map: the list renders without an implied price
    // rather than not rendering.
  }
  return out;
}

export async function loadOnchain(exchange: SomniaMarkets, marketId: Hex): Promise<MarketOnchain> {
  return exchange.client.getMarketOnchain(marketId);
}

export interface Holding {
  marketId: string;
  symbol: string;
  asset: string;
  outcome: "UP" | "DOWN";
  size: number;
  /** Present once the market has settled. */
  claimable?: number;
  settled: boolean;
  won?: boolean;
  voided?: boolean;
  expiry: number;
}

/**
 * Settled markets holding unclaimed winnings.
 *
 * `loadMarkets()` cannot answer this. A settled market leaves the live list,
 * and the registry sweep skips finalized binaries to stay small - so filtering
 * loadMarkets() for inactive rows returns an empty set, and a UI built that way
 * silently tells users they have nothing to claim. The binary tier does carry
 * them, under the terminal status "Finalized".
 */
export async function loadSettledMarkets(
  exchange: SomniaMarkets,
  venueId: string,
  limit = 30,
): Promise<{ marketId: Hex; asset: string; expiry: number; intervalSec: number }[]> {
  try {
    const rows = await exchange.client.listBinaryMarkets({
      venueId: venueId as Hex,
      status: "Finalized",
      // Over-fetch: the server sorts newest-CREATED but we want newest-EXPIRED,
      // and those orders disagree across series of different cadences.
      limit: Math.min(200, limit * 3),
    });
    return rows
      .map((r) => ({
        marketId: r.marketId as Hex,
        asset: String(r.asset ?? "?"),
        expiry: Number(r.expiry ?? 0),
        intervalSec: Number(r.intervalSec ?? 0),
      }))
      .sort((a, b) => b.expiry - a.expiry)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Recent prints on a market, newest last.
 *
 * Scoped to the window rather than to the pool. A binary pool is recycled
 * across successive markets, so asking a pool for its fills returns prints
 * belonging to windows that closed hours ago - which is exactly how a tape ends
 * up showing stale trades stacked against the left edge of a fresh chart.
 *
 * Returns [] rather than throwing when a market has never traded, which is the
 * majority case here: an empty tape is a fact about the venue, not a failure.
 */
export async function loadTrades(
  exchange: SomniaMarkets,
  cfg: NetworkConfig,
  market: LiveMarket,
  limit = 40,
): Promise<Print[]> {
  try {
    const one = 10 ** cfg.decimals;
    const rows = await exchange.client.getFills(market.pool, {
      limit,
      since: market.tradingStart,
      until: market.expiry,
    });
    return rows
      .filter((f) => String(f.market).toLowerCase() === market.marketId.toLowerCase())
      .map((f) => ({
        id: f.id,
        price: Number(f.fillPrice) / one,
        amount: Number(f.quantity) / one,
        side: f.takerIsBid === null ? undefined : f.takerIsBid ? ("buy" as const) : ("sell" as const),
        timestamp: Number(f.timestamp ?? 0) * 1000,
      }))
      .reverse();
  } catch {
    return [];
  }
}

export async function loadOpenOrders(exchange: SomniaMarkets) {
  try {
    return await exchange.fetchOpenOrders();
  } catch {
    return [];
  }
}

export async function loadBalances(exchange: SomniaMarkets) {
  try {
    return await exchange.fetchBalance();
  } catch {
    return null;
  }
}
