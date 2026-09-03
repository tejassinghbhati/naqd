"use client";

/**
 * One source of truth for the wallet.
 *
 * The nav shows the account and the terminal signs with it, so the connection
 * cannot live inside either. Holding it in a context also means there is
 * exactly one place that reacts to `accountsChanged` - the alternative, two
 * components each with their own listener, produces the classic bug where the
 * header updates and the trading panel keeps signing as the previous account.
 *
 * The network lives here too, for the same reason: switching it has to
 * invalidate balances and the signer together, atomically.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { DEFAULT_NETWORK, NETWORKS, type Network, type NetworkConfig } from "@/lib/chain";
import {
  connect as doConnect,
  discoverWallets,
  ensureChain,
  forget,
  reconnect,
  watchProvider,
  type Connection,
  type DiscoveredWallet,
} from "@/lib/wallet";
import { createExchange, explainError } from "@/lib/exchange";
import { faucet, loadBalances, type Balances } from "@/lib/account";
import { ConnectModal } from "./ConnectModal";

interface WalletState {
  cfg: NetworkConfig;
  network: Network;
  setNetwork: (n: Network) => void;
  conn: Connection | null;
  wrongChain: boolean;
  balances: Balances | null;
  /** Read-only client. Always present, so the app works before connecting. */
  read: SomniaMarkets;
  /** Signing client. Null until a wallet is connected on the right chain. */
  trade: SomniaMarkets | null;
  openConnect: () => void;
  disconnect: () => void;
  switchChain: () => void;
  refreshBalances: () => void;
  runFaucet: () => void;
  faucetBusy: boolean;
  notice: string | null;
  clearNotice: () => void;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);
  const cfg = NETWORKS[network];

  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [conn, setConn] = useState<Connection | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [modal, setModal] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  // Set on explicit disconnect so the silent reconnect does not immediately
  // undo it on the next render.
  const dismissed = useRef(false);

  const read = useMemo(() => createExchange(cfg), [cfg]);
  const wrongChain = conn !== null && conn.chainId !== cfg.chain.id;
  const trade = useMemo(
    () => (conn && !wrongChain ? createExchange(cfg, conn.walletClient) : null),
    [cfg, conn, wrongChain],
  );

  useEffect(() => discoverWallets(setWallets), []);

  // Silent reconnect once wallets have announced.
  useEffect(() => {
    if (wallets.length === 0 || conn || dismissed.current) return;
    let alive = true;
    reconnect(wallets, cfg).then((c) => {
      if (alive && c && !dismissed.current) setConn(c);
    });
    return () => {
      alive = false;
    };
  }, [wallets, cfg, conn]);

  // A single listener on the connected provider.
  useEffect(() => {
    if (!conn) return;
    return watchProvider(conn.provider, () => {
      reconnect([{ info: conn.wallet, provider: conn.provider }], cfg).then((c) => {
        setConn(c);
        if (!c) setBalances(null);
      });
    });
  }, [conn, cfg]);

  const refreshBalances = useCallback(() => {
    if (!conn || wrongChain) return setBalances(null);
    loadBalances(read, cfg, conn.address)
      .then(setBalances)
      .catch(() => setBalances(null));
  }, [conn, wrongChain, read, cfg]);

  useEffect(() => {
    refreshBalances();
    if (!conn || wrongChain) return;
    const id = setInterval(refreshBalances, 20_000);
    return () => clearInterval(id);
  }, [refreshBalances, conn, wrongChain]);

  const pick = async (w: DiscoveredWallet) => {
    setConnecting(w.info.rdns);
    setError(null);
    try {
      dismissed.current = false;
      const c = await doConnect(w, cfg);
      setConn(c);
      setModal(false);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setConnecting(null);
    }
  };

  const value: WalletState = {
    cfg,
    network,
    setNetwork: (n) => {
      setNetwork(n);
      setBalances(null);
    },
    conn,
    wrongChain,
    balances,
    read,
    trade,
    openConnect: () => {
      setError(null);
      setModal(true);
    },
    disconnect: () => {
      dismissed.current = true;
      forget();
      setConn(null);
      setBalances(null);
    },
    switchChain: () => {
      if (!conn) return;
      ensureChain(conn.provider, cfg)
        .then(() => reconnect([{ info: conn.wallet, provider: conn.provider }], cfg))
        .then((c) => c && setConn(c))
        .catch((e) => setNotice(explainError(e)));
    },
    refreshBalances,
    runFaucet: () => {
      if (!conn || wrongChain) return;
      setFaucetBusy(true);
      setNotice(null);
      faucet(conn.walletClient, cfg)
        .then(() => {
          setNotice(`Minted 1,000 test ${cfg.collateralSymbol}. It will appear shortly.`);
          setTimeout(refreshBalances, 2500);
        })
        .catch((e) => setNotice(explainError(e)))
        .finally(() => setFaucetBusy(false));
    },
    faucetBusy,
    notice,
    clearNotice: () => setNotice(null),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <ConnectModal
        open={modal}
        wallets={wallets}
        connecting={connecting}
        error={error}
        onPick={pick}
        onClose={() => setModal(false)}
      />
    </Ctx.Provider>
  );
}
