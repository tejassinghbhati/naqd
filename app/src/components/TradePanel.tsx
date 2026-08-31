/**
 * The trade panel.
 *
 * Two things here are opinions, not defaults, and both come from measurement:
 *
 *   Post-only is the default order type. Settled PnL on this venue splits
 *   +1.34% ROI to the passive side and -2.18% to the aggressive side, on a book
 *   that charges no fees at all. Crossing the spread is how you lose here, so
 *   the app makes resting the easy path and taking the deliberate one.
 *
 *   The payout line is shown before the cost line. A binary contract pays 1 per
 *   share if you are right, so "risk 4.20 to win 10.00" is the sentence a
 *   person actually needs; the probability is how the venue quotes it, not how
 *   anyone thinks about it.
 */

import { useEffect, useMemo, useState } from "react";
import type { SomniaMarkets, MarketOnchain } from "@somnia-chain/markets-sdk";
import type { NetworkConfig } from "../lib/chain.js";
import type { LiveMarket, Book } from "../lib/markets.js";
import { placeOrder, explainError, minSize, tickStep, type Outcome, type OrderMode } from "../lib/exchange.js";
import type { FairValue } from "../lib/calibra.js";

interface Props {
  cfg: NetworkConfig;
  exchange: SomniaMarkets | null;
  market: LiveMarket;
  onchain: MarketOnchain | null;
  book: Book;
  fair: FairValue;
  connected: boolean;
  onConnect: () => void;
  onPlaced: () => void;
  presetPrice?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function TradePanel({
  cfg,
  exchange,
  market,
  onchain,
  book,
  fair,
  connected,
  onConnect,
  onPlaced,
  presetPrice,
}: Props) {
  const [outcome, setOutcome] = useState<Outcome>("UP");
  const [mode, setMode] = useState<OrderMode>("post");
  const [price, setPrice] = useState<number>(0.5);
  const [size, setSize] = useState<number>(cfg.network === "mainnet" ? 1 : 25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const step = tickStep(cfg);
  const lot = minSize(cfg);

  // Price of the side the user is actually buying. The book is quoted in UP
  // terms, so DOWN is its complement.
  const impliedForSide = useMemo(() => {
    const upMid = book.mid ?? fair.implied ?? 0.5;
    return outcome === "UP" ? upMid : 1 - upMid;
  }, [book.mid, fair.implied, outcome]);

  // Seed the price from the market whenever the market or side changes, but
  // never stomp on a price the user is in the middle of typing.
  useEffect(() => {
    setPrice(Number(clamp(impliedForSide, 0.01, 0.99).toFixed(3)));
    setError(null);
    setDone(null);
    // Intentionally keyed on market + side only.
  }, [market.marketId, outcome]);

  useEffect(() => {
    if (presetPrice === undefined) return;
    setPrice(Number(clamp(outcome === "UP" ? presetPrice : 1 - presetPrice, 0.01, 0.99).toFixed(3)));
  }, [presetPrice, outcome]);

  const cost = price * size;
  const payout = size;
  const profit = payout - cost;
  const closed = market.expiry <= Math.floor(Date.now() / 1000);
  const tradable = onchain ? onchain.status === 1 : false;

  const blocked =
    closed
      ? "This window has closed."
      : onchain && !tradable
        ? "The venue is not accepting orders on this market right now."
        : size < lot
          ? `Minimum size is ${lot} shares.`
          : null;

  const submit = async () => {
    if (!exchange || !onchain) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await placeOrder({
        cfg,
        exchange,
        market: market.raw,
        onchain,
        outcome,
        probability: price,
        size,
        mode,
        expirySec: market.expiry,
      });
      setDone(
        mode === "post"
          ? `Resting order placed: ${size} ${outcome} at ${price.toFixed(3)}.`
          : `Filled what was available at ${price.toFixed(3)} or better.`,
      );
      onPlaced();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Trade</h3>
        <span className="small muted mono">
          {market.asset} · {market.intervalSec / 60}m
        </span>
      </div>

      <div className="panel-pad stack" style={{ gap: "0.85rem" }}>
        <div className="side-toggle">
          <button
            type="button"
            className="side-btn up"
            aria-pressed={outcome === "UP"}
            onClick={() => setOutcome("UP")}
          >
            <span className="label">UP</span>
            <span className="px">closes at or above open</span>
          </button>
          <button
            type="button"
            className="side-btn down"
            aria-pressed={outcome === "DOWN"}
            onClick={() => setOutcome("DOWN")}
          >
            <span className="label">DOWN</span>
            <span className="px">closes below open</span>
          </button>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="price">Price ({outcome})</label>
            <input
              id="price"
              type="number"
              min={0.01}
              max={0.99}
              step={Math.max(step, 0.001)}
              value={price}
              onChange={(e) => setPrice(clamp(Number(e.target.value) || 0, 0.01, 0.99))}
            />
          </div>
          <div className="field">
            <label htmlFor="size">Size (shares)</label>
            <input
              id="size"
              type="number"
              min={lot}
              step={lot}
              value={size}
              onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>

        <div className="field">
          <label>Order type</label>
          <div className="mode-toggle">
            <button type="button" aria-pressed={mode === "post"} onClick={() => setMode("post")}>
              Rest (maker)
            </button>
            <button type="button" aria-pressed={mode === "take"} onClick={() => setMode("take")}>
              Instant fill
            </button>
          </div>
          <p className="small muted" style={{ marginTop: "0.35rem" }}>
            {mode === "post"
              ? "Rests on the book and is rejected rather than crossing. Makers earned +1.34% on this venue; takers lost 2.18%."
              : "Takes whatever is available now and cancels the rest. You pay the spread."}
          </p>
        </div>

        <div className="summary">
          <div className="line">
            <span className="muted">If {outcome} is right</span>
            <b>+{profit.toFixed(2)} {cfg.collateralSymbol}</b>
          </div>
          <div className="line">
            <span className="muted">If it is wrong</span>
            <b>-{cost.toFixed(2)} {cfg.collateralSymbol}</b>
          </div>
          <div className="line">
            <span className="muted">Cost now</span>
            <span>{cost.toFixed(2)} for {payout.toFixed(2)} payout</span>
          </div>
          {fair.fair !== null && fair.edge !== null && (
            <div className="line">
              <span className="muted">Calibra fair ({outcome})</span>
              <span>{(outcome === "UP" ? fair.fair : 1 - fair.fair).toFixed(3)}</span>
            </div>
          )}
        </div>

        {blocked && <div className="alert info">{blocked}</div>}
        {error && <div className="alert err">{error}</div>}
        {done && <div className="alert ok">{done}</div>}

        {connected ? (
          <button
            type="button"
            className={outcome === "UP" ? "solid-up" : "solid-down"}
            disabled={busy || !!blocked || !exchange || !onchain}
            onClick={submit}
          >
            {busy ? "Confirm in your wallet..." : `Buy ${outcome} · ${size} at ${price.toFixed(3)}`}
          </button>
        ) : (
          <button type="button" className="primary" onClick={onConnect}>
            Connect wallet to trade
          </button>
        )}
      </div>
    </div>
  );
}
