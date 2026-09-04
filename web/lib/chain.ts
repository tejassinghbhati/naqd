/**
 * Assay app - network definitions and the venue we trade.
 *
 * Kept separate from the wallet plumbing because these are facts about the
 * deployment, not about the user: a browser with no wallet at all still needs
 * them to read markets.
 */

import { defineChain, type Chain } from "viem";
import { SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";

export type Network = "testnet" | "mainnet";

export const SOMNIA_TESTNET: Chain = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://api.infra.testnet.somnia.network"],
      webSocket: ["wss://api.infra.testnet.somnia.network/ws"],
    },
  },
  blockExplorers: { default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" } },
  testnet: true,
});

export const SOMNIA_MAINNET: Chain = defineChain({
  id: 5031,
  name: "Somnia",
  nativeCurrency: { name: "Somnia", symbol: "SOMI", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://api.infra.mainnet.somnia.network"],
      webSocket: ["wss://api.infra.mainnet.somnia.network/ws"],
    },
  },
  blockExplorers: { default: { name: "Somnia Explorer", url: "https://explorer.somnia.network" } },
});

export interface NetworkConfig {
  network: Network;
  chain: Chain;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  addresses: typeof SOMNIA_TESTNET_ADDRESSES | typeof SOMNIA_MAINNET_ADDRESSES;
  /** Collateral decimals: 6 on testnet (tUSDC), 18 on mainnet (USDso). */
  decimals: number;
  collateralSymbol: string;
  /**
   * Book granularity in RAW units.
   *
   * Binary market rows carry no tickSize/lotSize - unlike spot and perp - so
   * these are not discoverable through the SDK and have to be configured.
   * Mainnet's USDso venue runs 1e15 for both; testnet was measured accepting
   * orders down to a single raw unit.
   */
  tick: bigint;
  lot: bigint;
  /**
   * Venue scope. These MOVE - both networks changed theirs three times in one
   * week - so the app treats this as a default and falls back to whichever
   * venue the live markets are actually on. See `resolveVenue` in markets.ts.
   */
  venueId: `0x${string}`;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    network: "testnet",
    chain: SOMNIA_TESTNET,
    rpcUrl: "https://api.infra.testnet.somnia.network",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    decimals: 6,
    collateralSymbol: "tUSDC",
    tick: 1_000n,
    lot: 1n,
    venueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  },
  mainnet: {
    network: "mainnet",
    chain: SOMNIA_MAINNET,
    rpcUrl: "https://api.infra.mainnet.somnia.network",
    wsRpcUrl: "wss://api.infra.mainnet.somnia.network/ws",
    indexerUrl: "https://prd.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_MAINNET_ADDRESSES,
    decimals: 18,
    collateralSymbol: "USDso",
    tick: 1_000_000_000_000_000n,
    lot: 1_000_000_000_000_000n,
    venueId: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
  },
};

/**
 * Default to mainnet, because that is where the markets are.
 *
 * The instinct is to open a trading surface on testnet, and this did. But the
 * testnet indexer carries no populated binary markets, so the terminal opened
 * on an empty desk - which teaches a first-time visitor nothing except that the
 * thing does not work. Mainnet is also where every figure on this site is
 * measured from, so reading it here is consistent with the rest.
 *
 * Reading is not trading. Placing an order still needs a wallet connected, the
 * collateral approved and a signature, and the ticket says plainly which
 * network it is about to sign against. `?network=testnet` opens on the desk
 * where the faucet works.
 *
 * Guarded against a missing `location` so this module can be imported outside a
 * browser - the data layer below it is plain async functions, and being able to
 * exercise them from Node is worth more than one saved line.
 */
export const DEFAULT_NETWORK: Network =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("network") === "testnet"
    ? "testnet"
    : "mainnet";

/** On-chain MarketStatus. Only `Trading` accepts orders. */
export const MARKET_STATUS = {
  Listed: 0,
  Trading: 1,
  Locked: 2,
  Settling: 3,
  Resolved: 4,
  Voided: 5,
} as const;

/** OrderBook order types. */
export const ORDER_TYPE = {
  Normal: 0,
  FillOrKill: 1,
  ImmediateOrCancel: 2,
  PostOnly: 3,
} as const;
