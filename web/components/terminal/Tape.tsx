"use client";

/**
 * The price track and the tape - the two things that belong in the middle of a
 * terminal, under the book.
 *
 * `PriceTrack` plots the market's own probability across its window, with the
 * 0.5 coin-flip line as the reference and a marker on the last print. It is a
 * probability, not a price, so the y-axis is pinned to [0,1] rather than fitted
 * to the data: a market that traded between 0.90 and 0.93 should LOOK pinned to
 * one end, and an auto-fitted axis would show it as dramatic mid-range movement.
 *
 * `Tape` is the raw print history. On a venue where most markets never trade at
 * all, an honest empty state here is doing more work than the table usually is.
 */

import type { UnifiedTrade } from "@somnia-chain/markets-sdk";

export interface Print {
  id: string;
  price: number;
  amount: number;
  side?: "buy" | "sell";
  timestamp: number;
}

export const toPrint = (t: UnifiedTrade): Print => ({
  id: t.id,
  price: t.price,
  amount: t.amount,
  side: t.side,
  timestamp: t.timestamp,
});

const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** Size, with enough precision that a small fill never renders as 0.00. */
const size = (n: number): string => {
  if (n === 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toPrecision(2);
};

export function PriceTrack({
  prints,
  start,
  end,
  now,
}: {
  prints: Print[];
  /** Window open, unix seconds. */
  start: number;
  /** Window expiry, unix seconds. */
  end: number;
  now: number;
}) {
  const W = 900;
  const H = 190;
  const m = { t: 12, r: 46, b: 20, l: 8 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const span = Math.max(1, end - start);
  const x = (tsSec: number) => m.l + Math.max(0, Math.min(1, (tsSec - start) / span)) * iw;
  // Probability axis is fixed to [0,1]. See the note at the top of this file.
  const y = (p: number) => m.t + (1 - Math.max(0, Math.min(1, p))) * ih;

  const pts = prints
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((p) => ({ x: x(p.timestamp / 1000), y: y(p.price), p }));

  const last = pts[pts.length - 1];
  const nowX = x(now);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Traded probability across the window">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={m.l}
            x2={m.l + iw}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 0.5 ? "var(--rule-2)" : "var(--rule)"}
            strokeDasharray={v === 0.5 ? "3 3" : undefined}
          />
          <text x={m.l + iw + 6} y={y(v) + 3.5} fontSize="9.5" fill="var(--ink-4)" fontFamily="var(--mono)">
            {v.toFixed(2)}
          </text>
        </g>
      ))}

      {/* Elapsed portion of the window, so the clock is visible in the plot. */}
      <rect x={m.l} y={m.t} width={Math.max(0, nowX - m.l)} height={ih} fill="var(--ink)" opacity="0.025" />
      <line x1={nowX} x2={nowX} y1={m.t} y2={m.t + ih} stroke="var(--accent)" strokeWidth="1" opacity="0.55" />

      {pts.length === 0 && (
        <text
          x={m.l + iw / 2}
          y={m.t + ih / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--ink-4)"
          fontFamily="var(--mono)"
          letterSpacing="0.1em"
        >
          AWAITING FIRST PRINT
        </text>
      )}
      {pts.length > 1 && (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {pts.map((p) => (
        <circle
          key={p.p.id}
          cx={p.x}
          cy={p.y}
          r={2.4}
          fill={p.p.side === "sell" ? "var(--down)" : "var(--up)"}
        >
          <title>{`${hhmmss(p.p.timestamp)}  ${p.p.price.toFixed(3)}  x${size(p.p.amount)}`}</title>
        </circle>
      ))}
      {last && (
        <>
          <line
            x1={m.l}
            x2={m.l + iw}
            y1={last.y}
            y2={last.y}
            stroke="var(--accent)"
            strokeDasharray="2 3"
            opacity="0.5"
          />
          <circle cx={last.x} cy={last.y} r={4} fill="var(--accent)" stroke="var(--paper)" strokeWidth="1.5" />
          <text
            x={m.l + iw + 6}
            y={last.y + 3.5}
            fontSize="10"
            fill="var(--accent)"
            fontFamily="var(--mono)"
            fontWeight="600"
          >
            {last.p.price.toFixed(3)}
          </text>
        </>
      )}
    </svg>
  );
}

export function Tape({ prints }: { prints: Print[] }) {
  if (prints.length === 0) {
    return (
      <div className="empty" style={{ padding: "22px 12px" }}>
        <div className="hd">No prints</div>
        Nothing has traded inside this window yet.
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Side</th>
          <th>Price</th>
          <th>Size</th>
        </tr>
      </thead>
      <tbody>
        {prints
          .slice()
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 12)
          .map((p) => (
            <tr key={p.id}>
              <td className="dim">{hhmmss(p.timestamp)}</td>
              <td style={{ color: p.side === "sell" ? "var(--down)" : "var(--up)" }}>
                {p.side === "sell" ? "SELL" : "BUY"}
              </td>
              <td>{p.price.toFixed(3)}</td>
              <td>{size(p.amount)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
