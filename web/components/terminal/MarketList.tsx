"use client";

/**
 * The market list.
 *
 * Every open window on the venue, soonest expiry first, each with its own live
 * price and our read on it. Two details do most of the work:
 *
 *   Prices flash on change, once, in the direction they moved. A trader watching
 *   a list needs to see WHICH row ticked without diffing it by eye. The flash is
 *   half a second and low-alpha - it announces, it does not strobe.
 *
 *   A row with no price says "no quotes" rather than a dash or a zero. On this
 *   venue roughly five markets in six settle without a single trade, so an
 *   unquoted market is the normal case and deserves a word, not a placeholder
 *   that could be mistaken for a price of nothing.
 */

import { useEffect, useRef } from "react";
import type { LiveMarket, Book } from "@/lib/markets";
import { fairValue, type AssayStats } from "@/lib/assay";

const fmtLeft = (s: number): string => {
  if (s <= 0) return "closed";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
};

const win = (sec: number): string => (sec >= 3600 ? `${sec / 3600}H` : `${sec / 60}M`);

/** Flash a cell in the direction its value moved. Returns the class to apply. */
function useFlash(value: number | undefined): string {
  const prev = useRef<number | undefined>(undefined);
  const cls = useRef("");
  useEffect(() => {
    if (value !== undefined && prev.current !== undefined && value !== prev.current) {
      cls.current = value > prev.current ? "flash-up" : "flash-down";
    }
    prev.current = value;
  }, [value]);
  // Read after the effect has had a chance to set it; a changed value re-renders
  // anyway, so this lands on the render that shows the new number.
  if (value !== undefined && prev.current !== undefined && value !== prev.current) {
    return value > prev.current ? "flash-up" : "flash-down";
  }
  return "";
}

function Row({
  market,
  book,
  stats,
  now,
  selected,
  onSelect,
}: {
  market: LiveMarket;
  book: Book | undefined;
  stats: AssayStats | null;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const mid = book?.mid;
  const flash = useFlash(mid);
  const fv = fairValue(stats, mid ?? null);
  const left = market.expiry - now;
  const urgent = left > 0 && left < 60;

  return (
    <button type="button" className="mkt" aria-selected={selected} onClick={onSelect}>
      <div className="mkt-top">
        <span className="mkt-asset">{market.asset}</span>
        <span className="mkt-win">{win(market.intervalSec)}</span>
      </div>
      <div className={`mkt-px ${mid === undefined ? "none" : ""} ${flash}`}>
        {mid === undefined ? "NO QUOTES" : mid.toFixed(3)}
      </div>
      <div className="mkt-sub">
        <span className={`countdown ${urgent ? "urgent" : ""}`}>{fmtLeft(left)}</span>
      </div>
      <div className="mkt-edge">
        {mid === undefined ? null : fv.signal === "rich" ? (
          <span className="tag rich">RICH</span>
        ) : fv.signal === "cheap" ? (
          <span className="tag cheap">CHEAP</span>
        ) : fv.signal === "fair" ? (
          <span className="tag flat">FLAT</span>
        ) : null}
      </div>
    </button>
  );
}

export function MarketList({
  markets,
  books,
  stats,
  now,
  selectedId,
  onSelect,
  loading,
}: {
  markets: LiveMarket[];
  books: Map<string, Book>;
  stats: AssayStats | null;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading && markets.length === 0) {
    return (
      <div className="pane-bd stack">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="sk" style={{ height: 34 }} />
        ))}
      </div>
    );
  }
  if (markets.length === 0) {
    return (
      <div className="empty">
        <div className="hd">No open windows</div>
        Markets are created on a rolling schedule. The next one opens shortly.
      </div>
    );
  }
  return (
    <div>
      {markets.map((m) => (
        <Row
          key={m.marketId}
          market={m}
          book={books.get(m.marketId)}
          stats={stats}
          now={now}
          selected={m.marketId === selectedId}
          onSelect={() => onSelect(m.marketId)}
        />
      ))}
    </div>
  );
}
