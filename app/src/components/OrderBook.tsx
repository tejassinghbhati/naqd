/**
 * The book, in UP terms.
 *
 * One deliberate simplification: the venue runs a single unified book where
 * DOWN is the complement of UP, so a "bid for UP at 0.40" and an "ask for DOWN
 * at 0.60" are the same resting order seen from two sides. Showing both would
 * double-count the depth. This renders the UP book and labels it plainly, and
 * the trade panel does the complement arithmetic when you buy DOWN.
 */

import type { Book } from "../lib/markets.js";

const fmt = (n: number, d = 3) => n.toFixed(d);

export function OrderBook({ book, onPick }: { book: Book; onPick?: (price: number) => void }) {
  const maxSize = Math.max(1e-9, ...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));

  const Side = ({ levels, kind }: { levels: Book["bids"]; kind: "bid" | "ask" }) => (
    <div className="book-side">
      <h4>{kind === "bid" ? "Bids (buy UP)" : "Asks (sell UP)"}</h4>
      {levels.length === 0 ? (
        <div className="book-empty">No resting orders</div>
      ) : (
        levels.slice(0, 6).map((l, i) => (
          <div
            key={`${l.price}-${i}`}
            className="book-level"
            role={onPick ? "button" : undefined}
            tabIndex={onPick ? 0 : undefined}
            onClick={() => onPick?.(l.price)}
            onKeyDown={(e) => {
              if (onPick && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onPick(l.price);
              }
            }}
            style={{ cursor: onPick ? "pointer" : undefined }}
            title={onPick ? `Use ${fmt(l.price)} as your price` : undefined}
          >
            <span
              className="depth"
              style={{
                width: `${(l.size / maxSize) * 100}%`,
                background: kind === "bid" ? "var(--up-wash)" : "var(--down-wash)",
              }}
            />
            <span style={{ color: kind === "bid" ? "var(--up)" : "var(--down)" }}>{fmt(l.price)}</span>
            <span className="muted">{l.size.toFixed(2)}</span>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="book">
      <Side levels={book.bids} kind="bid" />
      <Side levels={book.asks} kind="ask" />
    </div>
  );
}
