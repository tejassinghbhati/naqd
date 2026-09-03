/**
 * Calibra app - reading live markets, books, and positions.
 *
 * Everything here is a read. Writes live in exchange.ts, so a component that
 * only displays data cannot accidentally reach a signer.
 */

import type { SomniaMarkets, UnifiedMarket, MarketOnchain } from "@somnia-chain/markets-sdk";
import type { Hex } from "viem";
import type { NetworkConfig } from "./chain";

export interface LiveMarket {
  marketId: Hex;
  symbol: string;
  asset: string;
  question: string;
  intervalSec: number;
  expiry: number;
  venueId: string;
  /** YES outcome symbol, for order-book reads. */
  yesSymbol: string;
  raw: UnifiedMarket;
}

interface BinaryInfo {
  marketType?: string;
  marketId?: string;
  asset?: string;
  question?: string;
  intervalSec?: number | string;
  expiry?: number | string;
  venueId?: string;
}

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
  const all = Object.values(await exchange.loadMarkets(true)) as UnifiedMarket[];
  const now = Math.floor(Date.now() / 1000);

  const shape = (m: UnifiedMarket): LiveMarket | null => {
    const info = m.info as BinaryInfo;
    if (info.marketType !== "BINARY" || !info.marketId) return null;
    const expiry = Number(info.expiry ?? 0);
    const intervalSec = Number(info.intervalSec ?? 0);
    if (!(expiry > now) || !(intervalSec > 0)) return null;
    const outs = m.outcomes ?? [];
    return {
      marketId: info.marketId as Hex,
      symbol: m.symbol,
      asset: info.asset ?? "?",
      // Never parse the question text for meaning - its wording has changed
      // several times. It is display copy only; `asset` and `intervalSec` are
      // the fields that carry the actual semantics.
      question: info.question ?? `${info.asset ?? "?"} closes at or above its opening price`,
      intervalSec,
      expiry,
      venueId: String(info.venueId ?? ""),
      yesSymbol: outs[0]?.symbol ?? `${m.symbol}#YES`,
      raw: m,
    };
  };

  const live = all.filter((m) => m.type === "binary" && m.active).map(shape).filter((m): m is LiveMarket => m !== null);

  const onConfigured = live.filter((m) => m.venueId.toLowerCase() === cfg.venueId.toLowerCase());
  if (onConfigured.length > 0) {
    return { markets: sortByExpiry(onConfigured), venueId: cfg.venueId, usedFallback: false };
  }

  // Configured venue is empty. Pick the venue carrying the most live markets.
  const byVenue = new Map<string, LiveMarket[]>();
  for (const m of live) {
    const k = m.venueId.toLowerCase();
    const arr = byVenue.get(k);
    if (arr) arr.push(m);
    else byVenue.set(k, [m]);
  }
  const best = [...byVenue.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return { markets: [], venueId: cfg.venueId, usedFallback: false };
  return { markets: sortByExpiry(best[1]), venueId: best[0], usedFallback: true };
}

const sortByExpiry = (ms: LiveMarket[]) => [...ms].sort((a, b) => a.expiry - b.expiry);

export interface BookLevel {
  price: number;
  size: number;
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

export async function loadBook(exchange: SomniaMarkets, yesSymbol: string, depth = 8): Promise<Book> {
  try {
    const ob = await exchange.fetchOrderBook(yesSymbol, depth);
    const bids = (ob.bids ?? []).map(([price, size]) => ({ price, size }));
    const asks = (ob.asks ?? []).map(([price, size]) => ({ price, size }));
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
 * Returns [] rather than throwing when a market has never traded, which is the
 * majority case here - an empty tape is a fact about the venue, not a failure.
 */
export async function loadTrades(exchange: SomniaMarkets, yesSymbol: string, limit = 40) {
  try {
    return await exchange.fetchTrades(yesSymbol, undefined, limit);
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
