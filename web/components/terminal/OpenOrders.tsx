"use client";

/**
 * Resting orders, with a way out of them.
 *
 * This panel exists because of a specific failure mode the protocol docs call
 * out: an unfilled limit remainder rests with escrow locked, and if the
 * interface never shows it, that capital is invisibly gone until the market
 * expires. Showing open orders is not a convenience here, it is the difference
 * between a user knowing where their money is and not.
 *
 * Cancel is per row and optimistic only after the transaction is confirmed -
 * an order that failed to cancel must stay on screen, because the escrow is
 * still locked.
 */

import { useState } from "react";
import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { cancelOrder, explainError } from "@/lib/exchange";
import type { RestingOrder } from "@/lib/account";

interface Props {
  orders: RestingOrder[];
  exchange: SomniaMarkets | null;
  connected: boolean;
  onChanged: () => void;
}

/** Market symbols are long; the asset and window are the identifying part. */
const trim = (symbol: string) => symbol.split("/")[0]?.replace(/-\d+-/, " ") ?? symbol;

export function OpenOrders({ orders, exchange, connected, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (o: RestingOrder) => {
    if (!exchange) return;
    setBusy(o.id);
    setError(null);
    try {
      await cancelOrder(exchange, o.id, o.symbol);
      onChanged();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pane">
      <div className="pane-hd">
        <h3>Open orders</h3>
        <span className="lbl">{orders.length} resting</span>
      </div>

      {!connected ? (
        <div className="empty">
          <div className="hd">Not connected</div>
          Connect a wallet to see your resting orders.
        </div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <div className="hd">Nothing resting</div>
          Orders you place that do not fill immediately will appear here.
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th>Price</th>
                <th>Left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{trim(o.symbol)}</td>
                  <td
                    style={{
                      color: o.side.toLowerCase().includes("buy") ? "var(--up)" : "var(--down)",
                    }}
                  >
                    {o.side.toUpperCase()}
                  </td>
                  <td>{o.price.toFixed(3)}</td>
                  <td>{o.remaining.toFixed(2)}</td>
                  <td>
                    <button
                      type="button"
                      className="mini"
                      disabled={busy === o.id || !exchange}
                      onClick={() => cancel(o)}
                    >
                      {busy === o.id ? "…" : "CANCEL"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="xs dimmer" style={{ padding: "8px 12px 10px", lineHeight: 1.5 }}>
            A resting order holds escrow until it fills, is cancelled, or its expiry passes.
          </p>
        </>
      )}

      {error && (
        <div style={{ padding: "0 12px 10px" }}>
          <div className="notice err">
            <span className="ic">!</span>
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
