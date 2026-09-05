/**
 * Wallet connection, built on EIP-6963.
 *
 * The naive implementation reaches for `window.ethereum`, and it is wrong in a
 * way that is invisible until someone complains. With two extensions installed
 * they race to own that property: whichever injected last wins, so a user with
 * Rabby and MetaMask gets whichever they did not intend, with no way to choose.
 * Some wallets fight back by proxying the property, which makes the behaviour
 * differ between machines.
 *
 * EIP-6963 fixes this properly. Wallets announce themselves over an event, each
 * carrying its own provider, name, icon and a stable uuid, and the page picks.
 * `window.ethereum` remains as a last-resort fallback for wallets that have not
 * shipped 6963 yet, labelled honestly as "Injected wallet" because that is
 * genuinely all we know about it.
 *
 * Everything else here follows from treating the wallet as untrusted input:
 * chain switches can fail because the chain is unknown (4902) rather than
 * because anything is broken, users decline (4001) and that is not an error,
 * and accounts and chains change underneath us at any moment.
 */

import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import type { NetworkConfig } from "./chain";

/** Minimal EIP-1193 surface. We do not depend on a wallet library's types. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

/** The `info` half of an EIP-6963 announcement. */
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const STORAGE_KEY = "naqd-wallet-rdns";

/**
 * Listen for wallet announcements.
 *
 * Providers announce in response to our request event, but also spontaneously
 * when an extension loads late, so this stays subscribed rather than taking one
 * snapshot. Returns an unsubscribe.
 */
export function discoverWallets(onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const found = new Map<string, DiscoveredWallet>();

  const emit = () => onChange([...found.values()]);

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<DiscoveredWallet>).detail;
    if (!detail?.info?.uuid || found.has(detail.info.rdns)) return;
    // Key on rdns, not uuid: uuid is regenerated per page load, so a wallet
    // that announces twice would otherwise appear twice in the picker.
    found.set(detail.info.rdns, detail);
    emit();
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Give 6963 wallets a moment, then fall back for anything that only injects.
  const timer = setTimeout(() => {
    if (found.size === 0 && window.ethereum) {
      found.set("injected", {
        info: {
          uuid: "injected",
          name: "Injected wallet",
          icon: "",
          rdns: "injected",
        },
        provider: window.ethereum,
      });
      emit();
    }
  }, 350);

  emit();
  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    clearTimeout(timer);
  };
}

export interface Connection {
  address: Address;
  chainId: number;
  walletClient: WalletClient;
  provider: Eip1193Provider;
  wallet: WalletInfo;
}

export class WalletError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

const errCode = (e: unknown): number | undefined => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "number" ? c : undefined;
};

/**
 * Put the wallet on the right chain, adding it when the wallet has never heard
 * of it.
 *
 * 4902 is "unrecognized chain" and is the expected response the first time
 * anyone connects to Somnia - a normal step, not a failure, so it is handled
 * rather than surfaced. Some wallets report the same condition as -32603.
 */
export async function ensureChain(provider: Eip1193Provider, cfg: NetworkConfig): Promise<void> {
  const hexId = `0x${cfg.chain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (e) {
    const code = errCode(e);
    if (code === 4001) throw new WalletError("Network switch declined.", 4001);
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
  // Adding a chain does not always select it.
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
}

async function finish(
  wallet: DiscoveredWallet,
  cfg: NetworkConfig,
  address: Address,
): Promise<Connection> {
  const chainIdHex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
  const walletClient = createWalletClient({
    account: address,
    chain: cfg.chain,
    transport: custom(wallet.provider),
  });
  return {
    address,
    chainId: Number(chainIdHex),
    walletClient,
    provider: wallet.provider,
    wallet: wallet.info,
  };
}

export async function connect(wallet: DiscoveredWallet, cfg: NetworkConfig): Promise<Connection> {
  let accounts: string[];
  try {
    accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch (e) {
    if (errCode(e) === 4001) throw new WalletError("Connection declined.", 4001);
    if (errCode(e) === -32002) {
      throw new WalletError("A connection request is already open in your wallet.", -32002);
    }
    throw e;
  }
  const address = accounts[0] as Address | undefined;
  if (!address) throw new WalletError("Wallet returned no accounts.");

  await ensureChain(wallet.provider, cfg);
  remember(wallet.info.rdns);
  return finish(wallet, cfg, address);
}

/**
 * Reconnect silently to the wallet last used, if the site is still authorised.
 *
 * `eth_accounts` never prompts - it returns what has already been granted - so
 * a refresh does not throw the user back through the wallet dialog. Returns
 * null when nothing is connected, which is a normal state and not an error.
 */
export async function reconnect(
  wallets: DiscoveredWallet[],
  cfg: NetworkConfig,
): Promise<Connection | null> {
  const preferred = recall();
  const candidates = preferred
    ? [...wallets.filter((w) => w.info.rdns === preferred), ...wallets.filter((w) => w.info.rdns !== preferred)]
    : wallets;

  for (const w of candidates) {
    try {
      const accounts = (await w.provider.request({ method: "eth_accounts" })) as string[];
      const address = accounts[0] as Address | undefined;
      if (address) return await finish(w, cfg, address);
    } catch {
      // This wallet is not available. Try the next.
    }
  }
  return null;
}

/**
 * Forget the connection.
 *
 * Deliberately local. A dapp cannot revoke its own permission in most wallets,
 * so "disconnect" here means this site stops using the account and stops
 * reconnecting on load. Saying anything stronger in the UI would be a lie.
 */
export function forget(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked. The in-memory disconnect still holds for this session.
  }
}

function remember(rdns: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, rdns);
  } catch {
    // Non-fatal: the user reconnects manually next visit.
  }
}

function recall(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Subscribe to account and chain changes on a connected provider. */
export function watchProvider(provider: Eip1193Provider, onChange: () => void): () => void {
  if (!provider.on) return () => {};
  const handler = () => onChange();
  provider.on("accountsChanged", handler);
  provider.on("chainChanged", handler);
  return () => {
    provider.removeListener?.("accountsChanged", handler);
    provider.removeListener?.("chainChanged", handler);
  };
}

export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const explorerAddress = (cfg: NetworkConfig, address: string): string | null => {
  const base = cfg.chain.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : null;
};

export const explorerTx = (cfg: NetworkConfig, hash: string): string | null => {
  const base = cfg.chain.blockExplorers?.default?.url;
  return base ? `${base}/tx/${hash}` : null;
};
