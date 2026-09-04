"use client";

/**
 * The wallet picker.
 *
 * Lists what EIP-6963 actually announced rather than a hard-coded set, so a
 * wallet we have never heard of appears with its own name and icon and works
 * without a code change. When nothing announces, the honest answer is that no
 * wallet is installed - with a link - not a dead button.
 *
 * Modal mechanics are hand-rolled because the requirements are small and
 * specific: focus moves in on open and returns on close, Escape closes, focus
 * cannot leave while open, and the background does not scroll. A dialog that
 * traps a keyboard user is worse than no dialog.
 */

import { useCallback, useEffect, useRef } from "react";
import type { DiscoveredWallet } from "@/lib/wallet";

interface Props {
  open: boolean;
  wallets: DiscoveredWallet[];
  connecting: string | null;
  error: string | null;
  onPick: (w: DiscoveredWallet) => void;
  onClose: () => void;
}

export function ConnectModal({ open, wallets, connecting, error, onPick, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const focusables = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ),
    [],
  );

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, focusables]);

  if (!open) return null;

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <h2 id="connect-title">Connect a wallet</h2>
          <button type="button" className="btn-sm" onClick={onClose} aria-label="Close">
            ESC
          </button>
        </div>

        <div className="modal-bd">
          {wallets.length === 0 ? (
            <div className="v3">
              <div className="notice info">
                <span className="ic">i</span>
                <span>
                  No wallet detected. Install a browser wallet, then reload this page.
                </span>
              </div>
              <a
                className="btn"
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
                style={{ justifyContent: "center" }}
              >
                Get MetaMask
              </a>
            </div>
          ) : (
            <div className="wallet-list">
              {wallets.map((w) => (
                <button
                  key={w.info.rdns}
                  type="button"
                  className="wallet-row"
                  onClick={() => onPick(w)}
                  disabled={connecting !== null}
                >
                  <span className="wallet-icon" aria-hidden="true">
                    {w.info.icon ? (
                      // Wallet-supplied data: URI. Not a remote fetch.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.info.icon} alt="" width={22} height={22} />
                    ) : (
                      <span className="wallet-glyph">{w.info.name.slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="wallet-name">{w.info.name}</span>
                  <span className="wallet-state">
                    {connecting === w.info.rdns ? "Check your wallet…" : "Connect"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="notice err" style={{ marginTop: "var(--s3)" }}>
              <span className="ic">!</span>
              <span>{error}</span>
            </div>
          )}

          <p className="small ink-4" style={{ marginTop: "var(--s3)" }}>
            Assay never holds your funds. Orders are signed in your wallet and settle directly
            against the DreamDEX pool.
          </p>
        </div>
      </div>
    </div>
  );
}
