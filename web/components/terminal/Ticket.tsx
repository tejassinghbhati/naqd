"use client";

/**
 * The order ticket.
 *
 * Two things here are opinions the data earned, not defaults:
 *
 *   Rest (post-only) is the default order type - but not because makers are
 *   measurably paid here. Pooled over fills that split looks decisive and has
 *   already changed sign between snapshots; bootstrapped over whole weeks it
 *   straddles zero. What resting actually buys is that an order which would
 *   cross is rejected rather than filled, so a stale book costs you nothing.
 *   That is a risk argument, and it holds whichever way the split points.
 *
 *   The payoff is stated in money before it is stated in probability. A binary
 *   contract pays 1 per share, so "risk 4.20 to make 5.80" is the sentence a
 *   person reasons with; 0.42 is merely how the venue quotes it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SomniaMarkets, MarketOnchain } from "@somnia-chain/markets-sdk";
import type { NetworkConfig } from "@/lib/chain";
import type { LiveMarket, Book } from "@/lib/markets";
import { placeOrder, explainError, minSize, tickStep, type Outcome, type OrderMode } from "@/lib/exchange";
import type { FairValue } from "@/lib/naqd";
import { cadence } from "@/lib/format";

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
  outcome: Outcome;
  setOutcome: (o: Outcome) => void;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Number(x.toFixed(3));

export function Ticket({
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
  outcome,
  setOutcome,
}: Props) {
  const [mode, setMode] = useState<OrderMode>("post");
  const [price, setPrice] = useState(0.5);
  const [size, setSize] = useState(cfg.network === "mainnet" ? 1 : 25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const step = Math.max(tickStep(cfg), 0.001);
  const lot = minSize(cfg);

  // The price of the side actually being bought. The book is quoted in UP
  // terms, so DOWN is its complement.
  const marketPx = useMemo(() => {
    const up = book.mid ?? fair.implied ?? 0.5;
    return outcome === "UP" ? up : 1 - up;
  }, [book.mid, fair.implied, outcome]);

  // Reseed from the market when the market or side changes. Keyed narrowly so
  // a price the user is editing is never overwritten by a poll.
  useEffect(() => {
    setPrice(round3(clamp(marketPx, 0.01, 0.99)));
    setError(null);
    setDone(null);
  }, [market.marketId, outcome]);

  useEffect(() => {
    if (presetPrice === undefined) return;
    setPrice(round3(clamp(outcome === "UP" ? presetPrice : 1 - presetPrice, 0.01, 0.99)));
  }, [presetPrice, outcome]);

  const cost = price * size;
  const payout = size;
  const profit = payout - cost;
  const closed = market.expiry <= Math.floor(Date.now() / 1000);
  const tradable = onchain ? onchain.status === 1 : false;

  const fairForSide = fair.fair === null ? null : outcome === "UP" ? fair.fair : 1 - fair.fair;
  // Value against our own estimate, not against the market: positive means we
  // think this side is worth more than it costs.
  const valueCents = fairForSide === null ? null : (fairForSide - price) * 100;

  const blocked = closed
    ? "This window has closed."
    : onchain && !tradable
      ? `Not accepting orders (on-chain status ${onchain.status}).`
      : size < lot
        ? `Minimum size is ${lot} shares.`
        : null;

  const submit = async () => {
    if (!exchange || !onchain || blocked) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await placeOrder({
        cfg,
        exchange,
        onchain,
        outcome,
        probability: price,
        size,
        mode,
        expirySec: market.expiry,
      });
      setDone(
        mode === "post"
          ? `Resting ${size} ${outcome} at ${price.toFixed(3)}.`
          : `Filled at ${price.toFixed(3)} or better.`,
      );
      onPlaced();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  const bump = (d: number) => setPrice((p) => round3(clamp(p + d * step, 0.01, 0.99)));

  return (
    <div className="pane">
      <div className="pane-hd">
        <h3>Ticket</h3>
        <span className="lbl">
          {market.asset} {cadence(market.intervalSec, true)}
        </span>
      </div>

      <div className="pane-bd stack">
        <div className="seg">
          {(["UP", "DOWN"] as const).map((side) => (
            <button
              key={side}
              type="button"
              className="seg-btn"
              data-side={side}
              aria-pressed={outcome === side}
              onClick={() => setOutcome(side)}
            >
              <span className="t">{side}</span>
              <span className="d">{side === "UP" ? "at or above open" : "below open"}</span>
            </button>
          ))}
        </div>

        <div className="two">
          <div className="field">
            <label htmlFor="tk-price">Price</label>
            <div className="stepper">
              <input
                id="tk-price"
                ref={priceRef}
                type="number"
                min={0.01}
                max={0.99}
                step={step}
                value={price}
                onChange={(e) => setPrice(clamp(Number(e.target.value) || 0, 0.01, 0.99))}
              />
              <div className="btns">
                <button type="button" onClick={() => bump(1)} aria-label="Increase price">
                  ▲
                </button>
                <button type="button" onClick={() => bump(-1)} aria-label="Decrease price">
                  ▼
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tk-size">Size</label>
            <input
              id="tk-size"
              type="number"
              min={lot}
              step={lot}
              value={size}
              onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>

        <div className="chips">
          {[0.25, 0.5, 0.75].map((p) => (
            <button key={p} type="button" onClick={() => setPrice(p)}>
              {p.toFixed(2)}
            </button>
          ))}
          <button type="button" onClick={() => setPrice(round3(clamp(marketPx, 0.01, 0.99)))}>
            MKT
          </button>
          {fairForSide !== null && (
            <button type="button" onClick={() => setPrice(round3(clamp(fairForSide, 0.01, 0.99)))}>
              FAIR
            </button>
          )}
        </div>

        <div className="field">
          <label>Execution</label>
          <div className="tabs">
            <button type="button" aria-pressed={mode === "post"} onClick={() => setMode("post")}>
              Rest
            </button>
            <button type="button" aria-pressed={mode === "take"} onClick={() => setMode("take")}>
              Instant
            </button>
          </div>
          <p className="xs dim" style={{ marginTop: 2, lineHeight: 1.45 }}>
            {mode === "post"
              ? "Rests on the book, rejected rather than crossed, so a book that moved costs you nothing."
              : "Takes what is there now and cancels the rest. You pay the spread."}
          </p>
        </div>

        <div className="payoff">
          <div className="r lead">
            <span className="k">Max profit</span>
            <span className="v" style={{ color: "var(--ok)" }}>
              +{profit.toFixed(2)}
            </span>
          </div>
          <div className="r">
            <span className="k">Max loss</span>
            <span className="v" style={{ color: "var(--bad)" }}>
              −{cost.toFixed(2)}
            </span>
          </div>
          <div className="sep" />
          <div className="r">
            <span className="k">Cost</span>
            <span className="v">
              {cost.toFixed(2)} {cfg.collateralSymbol}
            </span>
          </div>
          <div className="r">
            <span className="k">Payout if right</span>
            <span className="v">{payout.toFixed(2)}</span>
          </div>
          <div className="r">
            <span className="k">Breakeven</span>
            <span className="v">{(price * 100).toFixed(1)}%</span>
          </div>
          {valueCents !== null && (
            <>
              <div className="sep" />
              <div className="r">
                <span className="k">vs Naqd fair</span>
                <span
                  className="v"
                  style={{ color: valueCents > 0.5 ? "var(--ok)" : valueCents < -0.5 ? "var(--bad)" : "var(--ink-3)" }}
                >
                  {valueCents >= 0 ? "+" : "−"}
                  {Math.abs(valueCents).toFixed(1)}¢
                </span>
              </div>
            </>
          )}
        </div>

        {blocked && (
          <div className="notice info">
            <span className="ic">i</span>
            <span>{blocked}</span>
          </div>
        )}
        {error && (
          <div className="notice err">
            <span className="ic">!</span>
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="notice ok">
            <span className="ic">✓</span>
            <span>{done}</span>
          </div>
        )}

        {/* Which chain this signature lands on, stated before the button rather
            than in a header the eye has already left. The desk reads mainnet by
            default because that is where the markets are; signing there spends
            real collateral, and that should never be inferred. */}
        {connected && (
          <div className={`signs-on ${cfg.network}`}>
            <span className="lbl">Signs on</span>
            <span className="v">
              {cfg.network === "mainnet" ? "Somnia mainnet · real USDso" : "Shannon testnet · tUSDC"}
            </span>
          </div>
        )}

        {connected ? (
          <button
            type="button"
            className={`cta ${outcome === "UP" ? "buy-up" : "buy-down"}`}
            disabled={busy || !!blocked || !exchange || !onchain}
            onClick={submit}
          >
            {busy ? "CONFIRM IN WALLET…" : `BUY ${outcome} · ${size} @ ${price.toFixed(3)}`}
          </button>
        ) : (
          <button type="button" className="cta" onClick={onConnect}>
            CONNECT WALLET
          </button>
        )}
      </div>
    </div>
  );
}
