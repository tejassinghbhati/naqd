/**
 * Calibra agent - SDK bootstrap and the guards that keep writes honest.
 *
 * The DreamDEX event-contract SDK has a handful of edges that fail silently
 * rather than loudly, and every one of them is handled here rather than in the
 * strategy, so the strategy can be read as strategy.
 *
 *   1. A reverted write does not throw. The unified tier skips simulation and
 *      resolves the promise anyway; the receipt rides on `info`. `assertTxOk`
 *      is the only thing standing between "order placed" in the log and nothing
 *      on the book.
 *
 *   2. Float prices are poison on an 18-decimal venue. `createOrder` converts
 *      with `parseUnits(price.toFixed(18), 18)` and `(0.05).toFixed(18)` is
 *      `"0.050000000000000003"` - three wei off the tick grid, rejected as
 *      `InvalidPrice`. Everything here works in integer ticks and lots and goes
 *      through the raw trader.
 *
 *   3. The indexer lags the chain by seconds. It is fine for choosing WHAT to
 *      quote; it is never allowed to decide WHETHER a market accepts orders.
 *      That gate reads `getMarketOnchain` every pass.
 */

import {
  SomniaMarkets,
  SOMNIA_MAINNET_ADDRESSES,
  SOMNIA_TESTNET_ADDRESSES,
  type MarketOnchain,
  type UnifiedMarket,
} from "@somnia-chain/markets-sdk";
import { defineChain, type Chain, type Hex } from "viem";
import { COLLATERAL_DECIMALS, KNOWN_VENUE, type Network } from "../indexer/client.js";

/** On-chain MarketStatus: only `Trading` accepts orders. */
export const MARKET_STATUS = { Listed: 0, Trading: 1, Locked: 2, Settling: 3, Resolved: 4, Voided: 5 } as const;

/** OrderBook order types. PostOnly is the one this agent lives on. */
export const ORDER_TYPE = { Normal: 0, FillOrKill: 1, ImmediateOrCancel: 2, PostOnly: 3 } as const;

export interface AgentConfig {
  network: Network;
  chainId: number;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  venueId: Hex;
  decimals: number;
  /** Book granularity in RAW units. Binary rows carry no tickSize/lotSize, so
   *  these cannot be discovered through the SDK and must come from config. */
  tick: bigint;
  lot: bigint;
  privateKey?: Hex;
  dryRun: boolean;
}

const ENDPOINTS: Record<Network, { rpc: string; ws: string; indexer: string }> = {
  testnet: {
    rpc: "https://api.infra.testnet.somnia.network",
    ws: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
  },
  mainnet: {
    rpc: "https://api.infra.mainnet.somnia.network",
    ws: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
  },
};

const envNum = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // A typo'd env var must not become NaN and silently disable a size cap.
  if (!Number.isFinite(n)) throw new Error(`${name}="${raw}" is not a number`);
  return n;
};

export function loadAgentConfig(): AgentConfig {
  const network: Network = (process.env.NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  const ep = ENDPOINTS[network];
  const pk = (process.env.PRIVATE_KEY ?? "").trim();
  return {
    network,
    chainId: network === "mainnet" ? 5031 : 50312,
    rpcUrl: process.env.RPC_URL ?? ep.rpc,
    wsRpcUrl: process.env.WS_RPC_URL ?? ep.ws,
    indexerUrl: process.env.INDEXER_URL ?? ep.indexer,
    venueId: (process.env.VENUE_ID ?? KNOWN_VENUE[network]) as Hex,
    decimals: COLLATERAL_DECIMALS[network],
    // Mainnet's USDso venue runs 1e15 for both; testnet accepted orders down to
    // 1 raw unit when measured. Override if a venue tightens them.
    tick: BigInt(envNum("MM_TICK", network === "mainnet" ? 1e15 : 1e3)),
    lot: BigInt(envNum("MM_LOT", network === "mainnet" ? 1e15 : 1)),
    privateKey: pk ? (pk as Hex) : undefined,
    // Fails safe: only the exact string "false" turns the guard off.
    dryRun: (process.env.DRY_RUN ?? "true") !== "false",
  };
}

export function makeChain(cfg: AgentConfig): Chain {
  return defineChain({
    id: cfg.chainId,
    name: `somnia-${cfg.chainId}`,
    nativeCurrency:
      cfg.chainId === 5031
        ? { name: "Somnia", symbol: "SOMI", decimals: 18 }
        : { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl], webSocket: [cfg.wsRpcUrl] } },
  });
}

export interface AgentContext {
  exchange: SomniaMarkets;
  config: AgentConfig;
}

/**
 * The deployment's contract addresses.
 *
 * Taken from the SDK's own bundled address book rather than hard-coded here, so
 * they can never drift out of step with the SDK version that consumes them.
 * `binaryModule` in particular is not optional: settlement-extraction v2
 * resolves a market by `marketId` THROUGH the module, so `getMarketOnchain`
 * - the on-chain status gate every write depends on - simply fails without it.
 */
const ADDRESSES = {
  testnet: SOMNIA_TESTNET_ADDRESSES,
  mainnet: SOMNIA_MAINNET_ADDRESSES,
} as const;

export function createExchange(config: AgentConfig): AgentContext {
  const exchange = new SomniaMarkets({
    chain: makeChain(config),
    rpcUrl: config.rpcUrl,
    wsRpcUrl: config.wsRpcUrl,
    indexerUrl: config.indexerUrl,
    addresses: ADDRESSES[config.network],
    ...(config.privateKey ? { privateKey: config.privateKey } : {}),
  } as ConstructorParameters<typeof SomniaMarkets>[0]);
  return { exchange, config };
}

/**
 * Assert a write actually landed.
 *
 * SDK writes resolve even when the transaction reverted, and on the unified
 * tier the receipt is not on the returned order - it rides on `info`. Without
 * this, a bot logs a full book of orders it never placed.
 */
export function assertTxOk(res: unknown, what: string): void {
  const r = res as { status?: string; receipt?: { status?: string | number }; info?: { receipt?: { status?: string | number } } };
  const receipt = r?.receipt ?? r?.info?.receipt;
  const status = receipt?.status ?? r?.status;
  if (status === undefined) return; // nothing to check - a read-shaped result
  const ok = status === "success" || status === 1 || status === "0x1";
  if (!ok) throw new Error(`${what}: transaction reverted (status=${String(status)})`);
}

/** The authoritative status. Never gate a write on the indexer's copy. */
export const isTradable = (onchain: MarketOnchain): boolean => onchain.status === MARKET_STATUS.Trading;

export async function marketOnchain(ctx: AgentContext, marketId: Hex): Promise<MarketOnchain> {
  return ctx.exchange.client.getMarketOnchain(marketId);
}

/**
 * Snap a human probability onto the venue's integer tick grid.
 *
 * Returns a bigint of RAW collateral units, never a float, because the float
 * path is exactly the bug described at the top of this file. Clamped inside
 * (0,1) - a binary pool rejects 0 and 1 outright, and quoting either is a
 * free option for whoever takes it.
 */
export function priceToTicks(cfg: AgentConfig, probability: number): bigint {
  const one = 10n ** BigInt(cfg.decimals);
  const clamped = Math.min(0.99, Math.max(0.01, probability));
  const raw = BigInt(Math.round(clamped * Number(one)));
  const snapped = (raw / cfg.tick) * cfg.tick;
  // Snapping toward zero can land on 0 for a very small tick-relative price.
  return snapped < cfg.tick ? cfg.tick : snapped;
}

/**
 * Snap a size DOWN to the venue's lot grid, in raw units.
 *
 * Deliberately not `exchange.amountToPrecision()`: that helper rounds binary
 * sizes to a WHOLE share because binary rows carry no `lotSize`, which floors
 * every sub-share order to zero on the 18-decimal mainnet venue. Returns 0n
 * when the size is under one lot; callers must skip rather than send.
 */
export function quantize(cfg: AgentConfig, humanShares: number): bigint {
  if (!(humanShares > 0)) return 0n;
  const one = 10n ** BigInt(cfg.decimals);
  const raw = BigInt(Math.floor(humanShares * Number(one)));
  return (raw / cfg.lot) * cfg.lot;
}

export const toHuman = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** The YES / NO tradable symbols for a binary market (outcome 0 = YES). */
export function outcomeSymbols(market: UnifiedMarket): { yes: string; no: string } {
  const outs = market.outcomes ?? [];
  return {
    yes: outs[0]?.symbol ?? `${market.symbol}#YES`,
    no: outs[1]?.symbol ?? `${market.symbol}#NO`,
  };
}
