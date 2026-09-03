"use client";

/**
 * The order book, quoted in UP terms.
 *
 * One deliberate simplification worth stating: the venue runs a single unified
 * book where DOWN is the complement of UP, so "bid UP at 0.40" and "ask DOWN at
 * 0.60" are the same resting order seen from opposite sides. Rendering both
 * would double-count the depth. This shows the UP book, labels it, and lets the
 * ticket do the complement arithmetic when you buy DOWN.
 *
 * Depth bars are anchored to the outside edge of each column so the two sides
 * grow away from the spread - the conventional reading, where the widest bars
 * sit furthest from the touch.
 */

import type { Book } from "@/lib/markets";

const px = (n: number) => n.toFixed(3);
const sz = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n < 10 ? 2 : 1));

interface Props {
  book: Book;
  onPick?: (price: number) => void;
  rows?: number;
}

export function OrderBook({ book, onPick, rows = 7 }: Props) {
  const bids = book.bids.slice(0, rows);
  const asks = book.asks.slice(0, rows);
  const maxSize = Math.max(1e-9, ...bids.map((l) => l.size), ...asks.map((l) => l.size));

  const spread =
    book.bestBid !== undefined && book.bestAsk !== undefined ? book.bestAsk - book.bestBid : null;

  const Side = ({ levels, kind }: { levels: Book["bids"]; kind: "bid" | "ask" }) => (
    <div className="book-col">
      <div className="book-hd">
        <span>{kind === "bid" ? "Bid" : "Ask"}</span>
        <span>Size</span>
      </div>
      {levels.length === 0 ? (
        <div className="empty xs" style={{ padding: "14px 8px" }}>
          none
        </div>
      ) : (
        levels.map((l, i) => (
          <button
            key={`${l.price}-${i}`}
            type="button"
            className={`lvl ${kind}`}
            onClick={() => onPick?.(l.price)}
            title={onPick ? `Use ${px(l.price)} as your price` : undefined}
            disabled={!onPick}
          >
            <span
              className="depth"
              style={{
                width: `${Math.max(2, (l.size / maxSize) * 100)}%`,
                [kind === "bid" ? "right" : "left"]: 0,
              }}
            />
            <span className="p">{px(l.price)}</span>
            <span className="s">{sz(l.size)}</span>
          </button>
        ))
      )}
    </div>
  );

  return (
    <>
      <div className="book-grid">
        <Side levels={bids} kind="bid" />
        <Side levels={asks} kind="ask" />
      </div>
      <div className="book-spread">
        {spread === null ? (
          <span>NO TWO-SIDED MARKET</span>
        ) : (
          <>
            <span>
              SPREAD <b style={{ color: "var(--ink-2)" }}>{(spread * 100).toFixed(1)}¢</b>
            </span>
            <span className="dimmer">·</span>
            <span>
              MID <b style={{ color: "var(--ink-2)" }}>{px(book.mid ?? 0)}</b>
            </span>
          </>
        )}
      </div>
    </>
  );
}
