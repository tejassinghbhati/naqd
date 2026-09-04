"use client";

/**
 * The remaining panels: the quote header, the edge strip, and the portfolio.
 *
 * The edge strip is the one that matters. It renders the measured pricing-error
 * interval against a zero tick, which is the entire argument of this project in
 * a 22-pixel-tall element: an interval that clears zero is a signal, one that
 * straddles it is noise. Most of the time on this venue it straddles, and the
 * app says so rather than manufacturing a number to fill the space.
 */

import type { LiveMarket, Book } from "@/lib/markets";
import { cents, type AssayStats, type FairValue } from "@/lib/assay";
import { cadence } from "@/lib/format";

const fmtLeft = (s: number): string => {
  if (s <= 0) return "CLOSED";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
};

export function QuoteHeader({
  market,
  book,
  fair,
  now,
}: {
  market: LiveMarket;
  book: Book;
  fair: FairValue;
  now: number;
}) {
  const left = market.expiry - now;
  const urgent = left > 0 && left < 60;
  return (
    <div className="quote">
      <div className="quote-id">
        <div className="q-asset">
          {market.asset}
          <span className="lbl" style={{ letterSpacing: "0.1em" }}>
            {cadence(market.intervalSec, true)}
          </span>
        </div>
        <div className="q-sub">{market.question}</div>
      </div>

      <div className="q-stat">
        <span className="lbl">Market</span>
        <span className="v">
          {book.mid !== undefined ? book.mid.toFixed(3) : <span className="v muted">no quotes</span>}
        </span>
      </div>

      <div className="q-stat">
        <span className="lbl">Assay fair</span>
        <span className="v sm">
          {fair.fair !== null ? fair.fair.toFixed(3) : <span className="v muted">no edge</span>}
        </span>
      </div>

      <div className="q-stat">
        <span className="lbl">Signal</span>
        <span>
          <span className={`tag ${fair.signal === "unknown" ? "none" : fair.signal === "fair" ? "flat" : fair.signal}`}>
            {fair.signal === "rich"
              ? "UP RICH"
              : fair.signal === "cheap"
                ? "UP CHEAP"
                : fair.signal === "fair"
                  ? "IN LINE"
                  : "NO DATA"}
          </span>
        </span>
      </div>

      <div className="q-stat" style={{ marginLeft: "auto" }}>
        <span className="lbl">Closes in</span>
        <span className={`v sm countdown ${urgent ? "urgent" : ""}`}>{fmtLeft(left)}</span>
      </div>
    </div>
  );
}

/**
 * The measured edge, drawn against zero.
 *
 * `band` is the 95% interval, `pt` the point estimate, and the zero tick is the
 * decision boundary the agent obeys. When the band crosses the tick the strip
 * turns amber and says there is no measurable mispricing - which is the honest
 * state most of the time.
 */
export function EdgeStrip({ stats }: { stats: AssayStats | null }) {
  if (!stats) {
    return (
      <div className="edge-strip">
        <span className="dot" />
        <span className="txt dim">
          Stats API unreachable. Run <span className="mono">npm run api</span> to price every market against
          measured history.
        </span>
      </div>
    );
  }

  const { live } = stats;
  const [lo, hi] = live.recent.ci95;
  const crosses = lo <= 0 && hi >= 0;
  const span = Math.max(0.06, Math.abs(lo), Math.abs(hi)) * 1.25;
  const pos = (v: number) => ((v + span) / (2 * span)) * 100;
  const color = crosses ? "var(--warn)" : live.edge < 0 ? "var(--down)" : "var(--up)";
  const wash = crosses ? "var(--warn-a)" : live.edge < 0 ? "var(--down-a)" : "var(--up-a)";

  return (
    <div className={`edge-strip ${crosses ? "standing" : ""}`}>
      <span className={`dot ${crosses ? "warn" : "ok"}`} />
      <span className="txt">
        {crosses ? (
          <>
            <b>No measurable mispricing.</b> The 95% interval spans zero, so prices are shown without a
            fair-value correction.
          </>
        ) : (
          <>
            <b>
              UP is running {live.edge < 0 ? "rich" : "cheap"} by {cents(Math.abs(live.edge))}.
            </b>{" "}
            Interval clears zero over {live.sampleMarkets} settled markets.
          </>
        )}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        <span className="gauge-cap">{cents(lo)}</span>
        <div className="gauge" title={`95% CI [${cents(lo)}, ${cents(hi)}], point ${cents(live.edge)}`}>
          <span className="g-zero" style={{ left: `${pos(0)}%` }} />
          <span
            className="g-band"
            style={{
              left: `${pos(lo)}%`,
              width: `${pos(hi) - pos(lo)}%`,
              background: wash,
              borderColor: color,
            }}
          />
          <span className="g-pt" style={{ left: `${pos(live.edge)}%`, background: color }} />
        </div>
        <span className="gauge-cap">{cents(hi)}</span>
      </div>
    </div>
  );
}

export interface ClaimRow {
  marketId: string;
  asset: string;
  expiry: number;
}

export function Claims({
  rows,
  connected,
  claiming,
  onClaim,
}: {
  rows: ClaimRow[];
  connected: boolean;
  claiming: string | null;
  onClaim: (id: string) => void;
}) {
  return (
    <div className="pane">
      <div className="pane-hd">
        <h3>Settled</h3>
        <span className="lbl">{rows.length} recent</span>
      </div>
      {!connected ? (
        <div className="empty">
          <div className="hd">Not connected</div>
          Connect a wallet to see what you can claim.
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="hd">Nothing settled</div>
          No recently finalised markets on this venue.
        </div>
      ) : (
        <>
          <p className="xs dim" style={{ padding: "8px 12px 0", lineHeight: 1.45 }}>
            Winnings are claimed, not received. A settled market only pays out when someone asks it to.
          </p>
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Expired</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.marketId}>
                  <td>{r.asset}</td>
                  <td>{new Date(r.expiry * 1000).toISOString().slice(11, 16)}</td>
                  <td>
                    <button
                      type="button"
                      className="mini"
                      disabled={claiming === r.marketId}
                      onClick={() => onClaim(r.marketId)}
                    >
                      {claiming === r.marketId ? "…" : "CLAIM"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Venue-level context, so the numbers above are read with the right discount. */
export function VenueStats({ stats }: { stats: AssayStats | null }) {
  if (!stats) return null;
  return (
    <div className="pane">
      <div className="pane-hd">
        <h3>Venue</h3>
        <span className="lbl">measured</span>
      </div>
      <table>
        <tbody>
          <tr>
            <td>Settled markets</td>
            <td>{stats.markets.toLocaleString("en-US")}</td>
          </tr>
          <tr>
            <td>Ever traded</td>
            <td>{(stats.coverage * 100).toFixed(1)}%</td>
          </tr>
          <tr>
            <td>Maker ROI</td>
            <td style={{ color: "var(--ok)" }}>+{(stats.makerRoi * 100).toFixed(2)}%</td>
          </tr>
          <tr>
            <td>Taker ROI</td>
            <td style={{ color: "var(--bad)" }}>{(stats.takerRoi * 100).toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
