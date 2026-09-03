"use client";

/**
 * The connected-account control: address, balances, and the actions that belong
 * to an account rather than to a market.
 *
 * Balances live here rather than buried in a portfolio tab because the two
 * questions a trader asks constantly are "what can I spend" and "can I still
 * pay gas". Both are one glance away, and the gas warning fires before a
 * transaction fails rather than after.
 *
 * "Disconnect" is scoped honestly. A dapp cannot revoke its own permission in
 * most wallets, so this stops the site using the account and stops it
 * reconnecting - it does not claim to have severed anything in the wallet.
 */

import { useEffect, useRef, useState } from "react";
import type { Balances } from "@/lib/account";
import type { NetworkConfig } from "@/lib/chain";
import { explorerAddress, short, type Connection } from "@/lib/wallet";

interface Props {
  cfg: NetworkConfig;
  conn: Connection;
  balances: Balances | null;
  wrongChain: boolean;
  faucetBusy: boolean;
  onFaucet: () => void;
  onSwitchChain: () => void;
  onDisconnect: () => void;
}

export function AccountMenu({
  cfg,
  conn,
  balances,
  wrongChain,
  faucetBusy,
  onFaucet,
  onSwitchChain,
  onDisconnect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(conn.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked (insecure context or denied). The address is visible
      // and selectable regardless, so there is nothing to recover from.
    }
  };

  const explorer = explorerAddress(cfg, conn.address);
  const fmt = (n: number, d = 2) =>
    n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  return (
    <div className="acct" ref={wrapRef}>
      <button
        type="button"
        className="acct-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className={`dot ${wrongChain ? "bad" : balances?.lowGas ? "warn" : "live"}`} />
        <span className="mono">{short(conn.address)}</span>
        {balances && !wrongChain && (
          <span className="acct-bal mono">
            {fmt(balances.collateral)} {cfg.collateralSymbol}
          </span>
        )}
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-hd">
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              {conn.wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={conn.wallet.icon} alt="" width={18} height={18} style={{ borderRadius: 3 }} />
              ) : null}
              <span className="sm" style={{ fontWeight: 600 }}>
                {conn.wallet.name}
              </span>
            </div>
            <span className="lbl">{cfg.chain.name}</span>
          </div>

          <div className="acct-addr">
            <code className="mono xs">{conn.address}</code>
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="mini" onClick={copy}>
                {copied ? "COPIED" : "COPY"}
              </button>
              {explorer && (
                <a className="btn mini" href={explorer} target="_blank" rel="noreferrer">
                  EXPLORER
                </a>
              )}
            </div>
          </div>

          {wrongChain ? (
            <div style={{ padding: 12 }}>
              <div className="notice err" style={{ marginBottom: 8 }}>
                <span className="ic">!</span>
                <span>
                  Wallet is on chain {conn.chainId}. Switch to {cfg.chain.name} to trade.
                </span>
              </div>
              <button type="button" className="cta" onClick={onSwitchChain}>
                SWITCH NETWORK
              </button>
            </div>
          ) : (
            <>
              <div className="acct-bals">
                <div className="acct-bal-row">
                  <span className="lbl">{cfg.collateralSymbol}</span>
                  <span className="mono">{balances ? fmt(balances.collateral) : "—"}</span>
                </div>
                <div className="acct-bal-row">
                  <span className="lbl">
                    {cfg.chain.nativeCurrency.symbol} <span className="dimmer">gas</span>
                  </span>
                  <span className="mono" style={{ color: balances?.lowGas ? "var(--warn)" : undefined }}>
                    {balances ? fmt(balances.native, 4) : "—"}
                  </span>
                </div>
              </div>

              {balances?.lowGas && (
                <div style={{ padding: "0 12px 10px" }}>
                  <div className="notice warn">
                    <span className="ic">!</span>
                    <span>
                      Gas is low. Transactions will fail before they reach the pool. Top up{" "}
                      {cfg.chain.nativeCurrency.symbol}
                      {cfg.network === "testnet" ? " at testnet.somnia.network." : "."}
                    </span>
                  </div>
                </div>
              )}

              {balances && balances.outcomes.length > 0 && (
                <div className="acct-positions">
                  <div className="lbl" style={{ padding: "0 0 6px" }}>
                    Positions
                  </div>
                  {balances.outcomes.slice(0, 5).map((o) => (
                    <div key={o.symbol} className="acct-bal-row">
                      <span className="xs mono dim" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {o.symbol.replace(/\/.*?#/, " ")}
                      </span>
                      <span className="mono xs">{fmt(o.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {cfg.network === "testnet" && (
                <div style={{ padding: "0 12px 10px" }}>
                  <button type="button" onClick={onFaucet} disabled={faucetBusy} style={{ width: "100%", justifyContent: "center" }}>
                    {faucetBusy ? "Minting…" : `Get 1,000 test ${cfg.collateralSymbol}`}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="acct-ft">
            <button type="button" className="link" onClick={onDisconnect}>
              Disconnect
            </button>
            <span className="xs dimmer">stops this site using the account</span>
          </div>
        </div>
      )}
    </div>
  );
}
