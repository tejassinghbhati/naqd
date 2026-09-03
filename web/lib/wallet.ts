/**
 * Calibra app - injected wallet connection.
 *
 * Deliberately thin: an EIP-1193 provider, a viem wallet client, and the chain
 * switch. No wallet-connect modal library, no adapter framework - this app
 * needs one injected provider and adding a connector kit would be more code
 * than the thing it wraps.
 *
 * The one piece of real care here is the chain switch. `wallet_switchEthereumChain`
 * fails with 4902 when the wallet has never heard of the chain, and the fix is
 * to add it first and then switch. Skipping that is the single most common
 * reason a Somnia dapp appears to hang on connect.
 */

import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import type { NetworkConfig } from "./chain";

/** Minimal EIP-1193 surface, so we do not depend on a wallet library's types. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const hasWallet = (): boolean => typeof window !== "undefined" && !!window.ethereum;

export interface Connection {
  address: Address;
  chainId: number;
  walletClient: WalletClient;
  provider: Eip1193Provider;
}

class WalletError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "WalletError";
  }
}

const errCode = (e: unknown): number | undefined => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "number" ? c : undefined;
};

/**
 * Put the wallet on the right chain, adding it if the wallet does not know it.
 *
 * 4902 is "unrecognized chain" and is expected the first time any user connects
 * to Somnia - it is a normal step, not an error, so it is handled rather than
 * surfaced. 4001 is the user declining, which we pass through as a plain
 * message instead of a stack trace.
 */
export async function ensureChain(provider: Eip1193Provider, cfg: NetworkConfig): Promise<void> {
  const hexId = `0x${cfg.chain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (e) {
    const code = errCode(e);
    if (code === 4001) throw new WalletError("Network switch declined.", 4001);
    // 4902 unrecognized; some wallets nest it, some report -32603 instead.
    if (code !== 4902 && code !== -32603) throw e;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: hexId,
        chainName: cfg.chain.name,
        nativeCurrency: cfg.chain.nativeCurrency,
        rpcUrls: [cfg.rpcUrl],
        blockExplorerUrls: cfg.chain.blockExplorers?.default?.url
          ? [cfg.chain.blockExplorers.default.url]
          : undefined,
      },
    ],
  });
  // Adding does not always select it.
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
}

export async function connect(cfg: NetworkConfig): Promise<Connection> {
  const provider = window.ethereum;
  if (!provider) throw new WalletError("No wallet found. Install MetaMask or another EVM wallet.");

  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch (e) {
    if (errCode(e) === 4001) throw new WalletError("Connection declined.", 4001);
    throw e;
  }
  const address = accounts[0] as Address | undefined;
  if (!address) throw new WalletError("Wallet returned no accounts.");

  await ensureChain(provider, cfg);

  const walletClient = createWalletClient({
    account: address,
    chain: cfg.chain,
    transport: custom(provider),
  });

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  return { address, chainId: Number(chainIdHex), walletClient, provider };
}

/** Reconnect silently if the site is already authorized, so a refresh does not
 *  force the user through the wallet prompt again. Returns null when not. */
export async function reconnect(cfg: NetworkConfig): Promise<Connection | null> {
  const provider = window.ethereum;
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    const address = accounts[0] as Address | undefined;
    if (!address) return null;
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    const walletClient = createWalletClient({ account: address, chain: cfg.chain, transport: custom(provider) });
    return { address, chainId: Number(chainIdHex), walletClient, provider };
  } catch {
    return null;
  }
}

/** Subscribe to account and chain changes. Returns an unsubscribe function. */
export function watchWallet(onChange: () => void): () => void {
  const p = window.ethereum;
  if (!p?.on) return () => {};
  const handler = () => onChange();
  p.on("accountsChanged", handler);
  p.on("chainChanged", handler);
  return () => {
    p.removeListener?.("accountsChanged", handler);
    p.removeListener?.("chainChanged", handler);
  };
}

export const short = (a: string): string => `${a.slice(0, 6)}...${a.slice(-4)}`;
