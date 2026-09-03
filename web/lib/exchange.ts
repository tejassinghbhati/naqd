/**
 * Calibra app - the SDK client, and every guard that keeps a click honest.
 *
 * The event-contract SDK has a set of edges that fail SILENTLY, which is far
 * worse in a UI than in a bot: a bot logs and retries, a user just sees a
 * spinner stop and assumes it worked. Each one is handled here so the
 * components never have to think about it.
 *
 *   1. A reverted write does not throw. The unified tier skips simulation and
 *      resolves anyway, with the receipt riding on `info`. Without `assertTxOk`
 *      the UI would show "order placed" for a transaction that reverted.
 *
 *   2. Float prices are poison on an 18-decimal venue. `createOrder` converts
 *      with parseUnits(price.toFixed(18), 18), and (0.05).toFixed(18) is
 *      "0.050000000000000003" - three wei off the tick grid, rejected as
 *      InvalidPrice. Of fifteen ordinary probabilities, only 0.25, 0.5 and
 *      0.75 survive that round trip. So prices go through the raw trader as
 *      tick-aligned integers, never as numbers.
 *
 *   3. The indexer lags the chain by seconds. Fine for listing markets, never
 *      allowed to decide whether one accepts an order - that reads the chain.
 *
 *   4. Order expiry is mandatory and capped at the market's own expiry.
 *
 *   5. Winnings are claimed, not received. A settled market pays out only when
 *      someone asks, so the app has to surface claiming as a real action.
 */

import { SomniaMarkets, type MarketOnchain, type UnifiedMarket } from "@somnia-chain/markets-sdk";
import type { Hex, WalletClient } from "viem";
import { MARKET_STATUS, ORDER_TYPE, type NetworkConfig } from "./chain";

export type Outcome = "UP" | "DOWN";
export type OrderMode = "post" | "take";

export function createExchange(cfg: NetworkConfig, walletClient?: WalletClient): SomniaMarkets {
  return new SomniaMarkets({
    chain: cfg.chain,
    rpcUrl: cfg.rpcUrl,
    wsRpcUrl: cfg.wsRpcUrl,
    indexerUrl: cfg.indexerUrl,
    // binaryModule is not optional: settlement-extraction v2 resolves a market
    // by marketId THROUGH the module, so getMarketOnchain - the status gate
    // every write depends on - simply fails without it.
    addresses: cfg.addresses,
    ...(walletClient ? { walletClient } : {}),
  } as ConstructorParameters<typeof SomniaMarkets>[0]);
}

/** Assert a write actually landed. See note 1 above. */
export function assertTxOk(res: unknown, what: string): void {
  const r = res as {
    status?: string | number;
    receipt?: { status?: string | number };
    info?: { receipt?: { status?: string | number } };
  };
  const status = r?.receipt?.status ?? r?.info?.receipt?.status ?? r?.status;
  if (status === undefined) return;
  const ok = status === "success" || status === 1 || status === "0x1";
  if (!ok) throw new Error(`${what} reverted on-chain.`);
}

export const isTradable = (onchain: MarketOnchain): boolean => onchain.status === MARKET_STATUS.Trading;

/**
 * Snap a probability onto the venue's integer tick grid, in raw units.
 *
 * Clamped strictly inside (0,1): a binary pool rejects 0 and 1 outright, and
 * quoting either would be handing someone a free option.
 */
export function priceToTicks(cfg: NetworkConfig, probability: number): bigint {
  const one = 10n ** BigInt(cfg.decimals);
  const clamped = Math.min(0.99, Math.max(0.01, probability));
  const raw = BigInt(Math.round(clamped * Number(one)));
  const snapped = (raw / cfg.tick) * cfg.tick;
  return snapped < cfg.tick ? cfg.tick : snapped;
}

/** The tick grid expressed as a probability step, for UI increments. */
export const tickStep = (cfg: NetworkConfig): number => Number(cfg.tick) / 10 ** cfg.decimals;

/**
 * Snap a size DOWN to the venue's lot grid, in raw units.
 *
 * Deliberately not `exchange.amountToPrecision()`: that rounds binary sizes to
 * a WHOLE share because binary rows carry no lotSize, which floors every
 * sub-share order to zero on the 18-decimal mainnet venue. Returns 0n below one
 * lot - callers must refuse to send, not send zero.
 */
export function quantize(cfg: NetworkConfig, humanShares: number): bigint {
  if (!(humanShares > 0)) return 0n;
  const one = 10n ** BigInt(cfg.decimals);
  const raw = BigInt(Math.floor(humanShares * Number(one)));
  return (raw / cfg.lot) * cfg.lot;
}

export const toHuman = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;
export const minSize = (cfg: NetworkConfig): number => Number(cfg.lot) / 10 ** cfg.decimals;

/**
 * Order expiry in nanoseconds, capped at the market's own expiry.
 *
 * The pool rejects anything beyond it with `OrderExpiryBeyondMarket`, and a
 * value already in the past reverts with `OrderAlreadyExpired`, so this also
 * refuses to build one for a market that has already closed.
 */
export function orderExpiryNs(marketExpirySec: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  if (marketExpirySec <= now) throw new Error("This window has already closed.");
  return BigInt(marketExpirySec) * 1_000_000_000n;
}

export interface PlaceArgs {
  cfg: NetworkConfig;
  exchange: SomniaMarkets;
  market: UnifiedMarket;
  onchain: MarketOnchain;
  outcome: Outcome;
  /** Probability for the side being bought, in (0,1). */
  probability: number;
  /** Size in shares. */
  size: number;
  mode: OrderMode;
  expirySec: number;
}

/**
 * Buy one side of a binary market.
 *
 * "Buy DOWN at p" is the same order as "sell UP at 1 - p" - the venue runs one
 * unified book where the two outcomes are complements. The SDK's BUY_NO side
 * still takes its price in YES terms, which is the single easiest thing to get
 * backwards here, so the conversion happens once, in this function, and the UI
 * only ever speaks in the price of the side the user actually clicked.
 */
export async function placeOrder(args: PlaceArgs): Promise<{ hash?: string }> {
  const { cfg, exchange, onchain, outcome, probability, size, mode, expirySec } = args;

  if (!isTradable(onchain)) {
    throw new Error(`Market is not accepting orders (status ${onchain.status}).`);
  }
  const qty = quantize(cfg, size);
  if (qty === 0n) throw new Error(`Size is below the venue's minimum of ${minSize(cfg)} shares.`);

  const yesProbability = outcome === "UP" ? probability : 1 - probability;
  const price = priceToTicks(cfg, yesProbability);

  const res = await exchange.trader.placeOrder({
    pool: onchain.pool,
    side: outcome === "UP" ? "BUY_YES" : "BUY_NO",
    price,
    quantity: qty,
    expireTimestampNs: orderExpiryNs(expirySec),
    // Post-only rests and is rejected rather than crossing; IOC takes whatever
    // is available now and cancels the rest. Never `Normal` here - a resting
    // remainder the user did not ask for locks their escrow invisibly.
    orderType: mode === "post" ? ORDER_TYPE.PostOnly : ORDER_TYPE.ImmediateOrCancel,
  });
  assertTxOk(res, "Order");
  return { hash: (res as { hash?: string })?.hash };
}

export async function cancelOrder(exchange: SomniaMarkets, id: string, symbol: string): Promise<void> {
  const res = await exchange.cancelOrder(id, symbol);
  assertTxOk(res, "Cancel");
}

/**
 * Redeem a settled market's winnings.
 *
 * Amount 0 asks the SDK to redeem the whole claimable balance. This is a
 * separate user action because the protocol makes it one: a settled position
 * does not decay into collateral on its own, and a wallet that never redeems
 * reads near zero while holding winnings across dozens of finalised markets.
 */
export async function redeem(exchange: SomniaMarkets, marketRef: string): Promise<void> {
  const res = await exchange.redeem(marketRef, 0);
  assertTxOk(res, "Claim");
}

/**
 * Turn an SDK or RPC failure into something a person can act on.
 *
 * The raw strings here are contract custom-error names and wallet RPC codes;
 * showing them verbatim tells a user nothing about what to do next.
 */
export function explainError(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);
  const has = (s: string) => raw.toLowerCase().includes(s.toLowerCase());

  if (has("User rejected") || has("User denied") || has("4001")) return "You declined the transaction.";
  if (has("InvalidPrice")) return "That price is off the venue's tick grid. Nudge it by one tick.";
  if (has("OrderExpiryBeyondMarket")) return "Order would outlive the market window.";
  if (has("OrderAlreadyExpired")) return "This window closed before the order was sent.";
  if (has("PostOnly") || has("WouldCross")) return "A post-only order would have crossed the spread. Lower your price, or switch to instant fill.";
  if (has("insufficient funds") || has("exceeds balance")) return "Not enough balance for this order, including gas.";
  if (has("InsufficientEscrow") || has("TransferFailed")) return "Not enough collateral. Check your balance and token approval.";
  if (has("MarketNotTrading") || has("not accepting orders")) return "This window is no longer accepting orders.";
  if (has("nonce")) return "Wallet nonce is out of sync. Reset the account's activity in your wallet and retry.";
  if (has("reverted")) return "The transaction reverted on-chain.";
  // Fall back to the raw text, trimmed - better a long message than a silent failure.
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}
