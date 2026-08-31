/**
 * Calibra - per-wallet realized PnL on event contracts.
 *
 * Binary PnL is simple once you fix the convention. Every fill prints at a YES
 * probability `p` for `q` shares:
 *
 *   long YES  → pay p per share, receive 1 if the window closed UP
 *             → pnl = q · (up − p)
 *   short YES → the mirror image, which is identical to being long NO at 1 − p
 *             → pnl = q · (p − up)
 *
 * `takerIsBid` gives the taker's direction; the maker is always on the other
 * side. Both are credited here, which is why the leaderboard's PnL sums to
 * (almost) zero across wallets - event contracts are a closed system, and any
 * residual is the venue's settlement fee. On the DreamDEX venue that fee is
 * currently 0 bps, so the sum should be zero to floating-point noise. The API
 * exposes that residual as a self-check: if it drifts, our accounting is wrong.
 *
 * One caveat stated plainly: this is *realized settled* PnL over fills we can
 * see. A wallet that minted a complete set and sold only one leg carries
 * inventory this does not model, and a wallet that never redeemed still shows
 * the profit it is owed. It measures trading skill, not wallet balance.
 */

import type { ScoredFill } from "./queries.js";

export interface TraderStats {
  address: string;
  /** Settled PnL in collateral units (USDso on mainnet). */
  pnl: number;
  /** Total shares traded across both sides. */
  volume: number;
  /** Collateral put at risk - the denominator for ROI. */
  staked: number;
  roi: number;
  trades: number;
  /** Fraction of trades that settled in this wallet's favour. */
  hitRate: number;
  /** How often this wallet was the passive side. Makers earn the spread; takers pay it. */
  makerShare: number;
  markets: number;
}

interface Acc {
  pnl: number;
  volume: number;
  staked: number;
  trades: number;
  wins: number;
  asMaker: number;
  markets: Set<string>;
}

const blank = (): Acc => ({ pnl: 0, volume: 0, staked: 0, trades: 0, wins: 0, asMaker: 0, markets: new Set() });

/**
 * Leaderboard over settled fills.
 *
 * Two floors, not one. `minTrades` is the obvious guard against a wallet that
 * got lucky once. `minMarkets` is the one that actually matters here and is
 * easy to miss: ten fills inside a single 15-minute window are ten slices of
 * ONE coin flip, so a wallet can post a 200% ROI over "10 trades" having taken
 * exactly one position. Ranking by settled PnL without it puts single-bet
 * wallets on top - which is precisely the artifact this project exists to
 * catch elsewhere, so it would be embarrassing to ship it here.
 */
export function traderLeaderboard(
  fills: ScoredFill[],
  opts: { minTrades?: number; minMarkets?: number; limit?: number } = {},
): { traders: TraderStats[]; zeroSumResidual: number } {
  const minTrades = opts.minTrades ?? 5;
  const minMarkets = opts.minMarkets ?? 3;
  const acc = new Map<string, Acc>();

  const credit = (addr: string | null, pnl: number, staked: number, qty: number, marketId: string, isMaker: boolean) => {
    if (!addr) return;
    let a = acc.get(addr);
    if (!a) acc.set(addr, (a = blank()));
    a.pnl += pnl;
    a.staked += staked;
    a.volume += qty;
    a.trades += 1;
    if (pnl > 0) a.wins += 1;
    if (isMaker) a.asMaker += 1;
    a.markets.add(marketId);
  };

  let residual = 0;
  for (const f of fills) {
    if (f.takerIsBid === null || f.quantity <= 0) continue;
    const takerLong = f.takerIsBid === 1;
    // Per-share payoff to the YES side of this print.
    const yesPnl = f.up - f.price;
    const takerPnl = (takerLong ? yesPnl : -yesPnl) * f.quantity;
    // Each side risks what it could lose: the long risks its premium, the
    // short risks the complement.
    const takerStake = (takerLong ? f.price : 1 - f.price) * f.quantity;
    const makerStake = (takerLong ? 1 - f.price : f.price) * f.quantity;

    credit(f.taker, takerPnl, takerStake, f.quantity, f.marketId, false);
    credit(f.maker, -takerPnl, makerStake, f.quantity, f.marketId, true);
    residual += takerPnl + -takerPnl;
  }

  const traders = [...acc.entries()]
    .filter(([, a]) => a.trades >= minTrades && a.markets.size >= minMarkets)
    .map(([address, a]) => ({
      address,
      pnl: a.pnl,
      volume: a.volume,
      staked: a.staked,
      roi: a.staked > 0 ? a.pnl / a.staked : 0,
      trades: a.trades,
      hitRate: a.trades > 0 ? a.wins / a.trades : 0,
      makerShare: a.trades > 0 ? a.asMaker / a.trades : 0,
      markets: a.markets.size,
    }))
    .sort((x, y) => y.pnl - x.pnl);

  return { traders: opts.limit ? traders.slice(0, opts.limit) : traders, zeroSumResidual: residual };
}

/**
 * Do makers or takers win on this venue?
 *
 * On a zero-fee book with no rebate, the maker's only compensation is the
 * spread and the taker's only cost is crossing it - so this comparison is a
 * direct read on whether liquidity provision is currently paid or punished.
 * It is the number that decides whether Calibra's agent should quote passively
 * or cross, and the agent consults it before choosing a mode.
 */
export function makerVsTaker(fills: ScoredFill[]): {
  maker: { pnl: number; staked: number; roi: number; trades: number };
  taker: { pnl: number; staked: number; roi: number; trades: number };
} {
  let mPnl = 0;
  let mStake = 0;
  let tPnl = 0;
  let tStake = 0;
  let n = 0;
  for (const f of fills) {
    if (f.takerIsBid === null || f.quantity <= 0) continue;
    const takerLong = f.takerIsBid === 1;
    const pnl = (takerLong ? f.up - f.price : f.price - f.up) * f.quantity;
    tPnl += pnl;
    mPnl -= pnl;
    tStake += (takerLong ? f.price : 1 - f.price) * f.quantity;
    mStake += (takerLong ? 1 - f.price : f.price) * f.quantity;
    n++;
  }
  return {
    maker: { pnl: mPnl, staked: mStake, roi: mStake > 0 ? mPnl / mStake : 0, trades: n },
    taker: { pnl: tPnl, staked: tStake, roi: tStake > 0 ? tPnl / tStake : 0, trades: n },
  };
}
