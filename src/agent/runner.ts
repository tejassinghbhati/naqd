/**
 * Assay agent - the loop.
 *
 * Reads the measured edge out of the local store, asks the policy what to quote,
 * and places post-only orders on the markets that pass every gate. Its default
 * state is flat: with no measurable edge it cancels, logs why, and waits.
 *
 * Two operational rules worth stating, both learned from the protocol docs
 * rather than from a stack trace:
 *
 *   Winnings are claimed, not received. A settled market pays out only when
 *   someone asks it to, so a bot that trades for a week without redeeming has
 *   its balance spread across dozens of finalised markets while its wallet
 *   reads near zero. The sweep runs inside the loop.
 *
 *   The claim runs in the loop rather than on a timer for a specific reason:
 *   claiming signs from the same key the agent quotes with, and two senders on
 *   one key race each other's nonce. Serialising it here is free.
 */

import type { Hex } from "viem";
import {
  assertTxOk,
  isTradable,
  marketOnchain,
  ORDER_TYPE,
  priceToTicks,
  quantize,
  type AgentContext,
} from "./exchange.js";
import { planQuotes, orderExpiryNs, DEFAULT_POLICY, type BookTop, type PolicyParams } from "./policy.js";
import type { LiveEdge } from "../analytics/edge.js";

export interface RunnerOptions {
  /** Seconds between passes. */
  requoteSec: number;
  /** Shares to quote per side at full confidence. */
  size: number;
  /** Most markets to quote in one pass. */
  maxMarkets: number;
  policy?: PolicyParams;
  /** Re-read the edge from the store on every pass. */
  readEdge: () => LiveEdge;
  claimIntervalMs?: number;
  log?: (line: string) => void;
}

interface LiveRow {
  marketId: Hex;
  asset: string;
  symbol: string;
  intervalSec: number;
  expiry: number;
}

const ts = () => new Date().toISOString().slice(11, 19);

export class Agent {
  private lastClaim = 0;
  private readonly log: (line: string) => void;

  constructor(
    private readonly ctx: AgentContext,
    private readonly opts: RunnerOptions,
  ) {
    this.log = opts.log ?? ((l) => console.log(l));
  }

  /** One pass. Returns how many orders were placed (or would have been). */
  async tick(): Promise<number> {
    const { config } = this.ctx;
    const edge = this.opts.readEdge();

    if (edge.verdict === "stand-down") {
      this.log(`[${ts()}] STAND DOWN - ${edge.reason}`);
      await this.cancelAll();
      await this.maybeClaim();
      return 0;
    }

    this.log(
      `[${ts()}] TRADE - edge ${(edge.edge * 100).toFixed(2)}c, confidence ${edge.confidence.toFixed(2)} - ${edge.reason}`,
    );

    const markets = await this.liveMarkets();
    let placed = 0;
    for (const m of markets.slice(0, this.opts.maxMarkets)) {
      try {
        placed += await this.quoteMarket(m, edge);
      } catch (e) {
        this.log(`[${ts()}]   ${m.asset} ${m.intervalSec}s: ${(e as Error).message}`);
      }
    }
    await this.maybeClaim();
    return placed;
  }

  private async liveMarkets(): Promise<LiveRow[]> {
    const all = Object.values(await this.ctx.exchange.loadMarkets(true));
    const now = Math.floor(Date.now() / 1000);
    return all
      .filter((m) => m.type === "binary" && m.active)
      .filter((m) => {
        const info = m.info as { marketType?: string; venueId?: string };
        return info.marketType === "BINARY" && String(info.venueId ?? "").toLowerCase() === this.ctx.config.venueId.toLowerCase();
      })
      .map((m) => {
        const info = m.info as { marketId: string; asset?: string; intervalSec?: number | string; expiry?: number | string };
        return {
          marketId: info.marketId as Hex,
          asset: info.asset ?? "?",
          symbol: m.symbol,
          intervalSec: Number(info.intervalSec ?? 0),
          expiry: Number(info.expiry ?? 0),
        };
      })
      .filter((m) => m.expiry > now && m.intervalSec > 0)
      .sort((a, b) => a.expiry - b.expiry);
  }

  private async quoteMarket(m: LiveRow, edge: LiveEdge): Promise<number> {
    const { exchange, config } = this.ctx;

    // Authoritative gate. The indexer said this market is live; only the chain
    // gets to decide whether it will accept an order.
    const onchain = await marketOnchain(this.ctx, m.marketId);
    if (!isTradable(onchain)) {
      this.log(`[${ts()}]   ${m.asset} ${m.intervalSec}s: on-chain status ${onchain.status}, not Trading - skip`);
      return 0;
    }

    const book = await this.bookTop(m.symbol);
    const now = Math.floor(Date.now() / 1000);
    const plan = planQuotes(
      { book, edge, secondsLeft: m.expiry - now, intervalSec: m.intervalSec },
      this.opts.policy ?? DEFAULT_POLICY,
    );
    if (plan.quotes.length === 0) {
      this.log(`[${ts()}]   ${m.asset} ${m.intervalSec}s: ${plan.reason}`);
      return 0;
    }

    const expireNs = orderExpiryNs(now, this.opts.requoteSec, m.expiry);
    let placed = 0;
    for (const q of plan.quotes) {
      const size = quantize(config, this.opts.size * Math.max(0.1, q.sizeMultiple));
      if (size === 0n) {
        this.log(`[${ts()}]   ${m.asset}: size below one lot - skip`);
        continue;
      }
      const price = priceToTicks(config, q.probability);
      const label = `${m.asset} ${m.intervalSec}s ${q.side} ${q.probability.toFixed(3)} x${this.opts.size}`;

      if (config.dryRun) {
        this.log(`[${ts()}]   DRY ${label} - ${plan.reason}`);
        placed++;
        continue;
      }

      const res = await exchange.trader.placeOrder({
        pool: onchain.pool,
        side: q.side,
        price,
        quantity: size,
        expireTimestampNs: expireNs,
        // Post-only. Settled PnL on this venue pays the passive side (+1.34%
        // ROI) and charges the aggressive one (-2.18%), so an order that would
        // cross is an order we want rejected, not filled.
        orderType: ORDER_TYPE.PostOnly,
      });
      assertTxOk(res, `placeOrder(${label})`);
      this.log(`[${ts()}]   ${label} - ${plan.reason}`);
      placed++;
    }
    return placed;
  }

  private async bookTop(symbol: string): Promise<BookTop> {
    try {
      const ob = await this.ctx.exchange.fetchOrderBook(symbol, 5);
      const bestBid = ob.bids?.[0]?.[0];
      const bestAsk = ob.asks?.[0]?.[0];
      const mid =
        bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
      return { bestBid, bestAsk, mid };
    } catch {
      // No book is the normal case here, not an error: ~5 of 6 markets on this
      // venue never trade. Treat it as "empty" and let the policy seed it.
      return {};
    }
  }

  private async cancelAll(): Promise<void> {
    if (this.ctx.config.dryRun) return;
    try {
      const open = await this.ctx.exchange.fetchOpenOrders();
      for (const o of open) {
        try {
          await this.ctx.exchange.cancelOrder(o.id, o.symbol);
        } catch (e) {
          this.log(`[${ts()}]   cancel ${o.id}: ${(e as Error).message}`);
        }
      }
      if (open.length) this.log(`[${ts()}]   cancelled ${open.length} resting order(s)`);
    } catch {
      // Nothing resting, or the read failed - either way there is nothing to do
      // and refusing to continue would strand the loop.
    }
  }

  /**
   * Sweep settled markets and redeem.
   *
   * `loadMarkets()` cannot answer this: a settled market leaves the live list
   * and the registry sweep skips finalized binaries, so filtering it for
   * inactive rows returns an empty set and a redeem-by-scan bot silently finds
   * nothing. The binary tier does carry them, under status "Finalized".
   */
  private async maybeClaim(): Promise<void> {
    const interval = this.opts.claimIntervalMs ?? 600_000;
    if (Date.now() - this.lastClaim < interval) return;
    this.lastClaim = Date.now();
    if (this.ctx.config.dryRun) return;

    try {
      const settled = await this.ctx.exchange.client.listBinaryMarkets({
        venueId: this.ctx.config.venueId,
        status: "Finalized",
        limit: 25,
      });
      let claimed = 0;
      for (const row of settled) {
        try {
          const res = await this.ctx.exchange.redeem(String(row.marketId), 0);
          assertTxOk(res, `redeem(${row.marketId})`);
          claimed++;
        } catch {
          // Nothing claimable in that market - the common case on a sweep.
        }
      }
      if (claimed) this.log(`[${ts()}]   claimed ${claimed} settled market(s)`);
    } catch (e) {
      this.log(`[${ts()}]   claim sweep failed: ${(e as Error).message}`);
    }
  }

  async run(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      try {
        await this.tick();
      } catch (e) {
        this.log(`[${ts()}] pass failed: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, this.opts.requoteSec * 1000));
    }
  }
}
