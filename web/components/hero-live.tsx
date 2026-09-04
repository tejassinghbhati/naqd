"use client";

/**
 * The live window in the hero.
 *
 * A static hero says "here is a claim". A live one says "here is the thing,
 * working, right now" - and on a venue where a market opens and settles every
 * fifteen minutes, standing still is the wrong choice.
 *
 * What makes this ours rather than a copy of anyone else's ticker is the middle
 * column: beside the venue's price sits the price our measurement says is
 * right, and the gap between them, live. Nobody else can render that column,
 * because the measurement does not exist anywhere else.
 *
 * When the interval covers zero it shows NO EDGE rather than inventing a fair
 * value. The honest state has to survive contact with the marketing page, or it
 * was never a principle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { NETWORKS } from "@/lib/chain";
import { createExchange } from "@/lib/exchange";
import { loadBook, loadLiveMarkets, type Book, type LiveMarket } from "@/lib/markets";
import { fairValue, type LiveEdge } from "@/lib/assay";
import { cadence } from "@/lib/format";

const MARKETS_MS = 20_000;
const BOOK_MS = 5_000;

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

// Takes only what it reads, so both the server summary and the client stats
// object satisfy it without a cast.
export function HeroLive({ stats }: { stats: { live: LiveEdge } | null }) {
  // Mainnet: the hero should show the venue people can actually go and trade,
  // not the testnet the agent is exercised against.
  const cfg = NETWORKS.mainnet;
  const exchange = useMemo(() => createExchange(cfg), [cfg]);

  const [market, setMarket] = useState<LiveMarket | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [ready, setReady] = useState(false);
  const failed = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const pick = useCallback(async () => {
    try {
      const { markets } = await loadLiveMarkets(exchange, cfg);
      // Soonest expiry with enough of its window left to still be interesting -
      // a market with nine seconds on the clock makes a poor first impression.
      const usable = markets.filter((m) => m.expiry - Date.now() / 1000 > 45);
      setMarket(usable[0] ?? markets[0] ?? null);
    } catch {
      failed.current = true;
    } finally {
      setReady(true);
    }
  }, [exchange, cfg]);

  useEffect(() => {
    pick();
    const id = setInterval(pick, MARKETS_MS);
    return () => clearInterval(id);
  }, [pick]);

  useEffect(() => {
    if (!market) return;
    let alive = true;
    const run = () => {
      loadBook(exchange, market.yesSymbol).then((b) => alive && setBook(b));
    };
    run();
    const id = setInterval(run, BOOK_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [exchange, market]);

  const left = market ? Math.max(0, market.expiry - now) : 0;
  const frac = market && market.intervalSec > 0 ? Math.min(1, Math.max(0, left / market.intervalSec)) : 0;
  const mid = book?.mid;
  const fair = fairValue(stats, mid ?? null);

  const up = mid;
  const down = mid === undefined ? undefined : 1 - mid;

  // Ring geometry for the countdown.
  const R = 26;
  const C = 2 * Math.PI * R;

  if (!ready) {
    return (
      <div className="live" aria-busy="true">
        <div className="sk" style={{ height: 196 }} />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="live">
        <span className="eyebrow">Live window</span>
        <p className="body-sm" style={{ marginTop: "var(--s3)" }}>
          No window is open on the venue right now. New markets are created on a rolling schedule,
          usually within a few minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="live">
      <div className="live-top">
        <div className="live-clock">
          <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
            <circle cx="32" cy="32" r={R} fill="none" stroke="var(--rule-2)" strokeWidth="3" />
            <circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke={left < 60 ? "var(--warn)" : "var(--ink-3)"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              transform="rotate(-90 32 32)"
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <span className={`live-time mono ${left < 60 ? "urgent" : ""}`}>
            {pad(left / 60)}:{pad(left % 60)}
          </span>
        </div>

        <div className="live-id">
          <span className="eyebrow">
            {market.asset} · {cadence(market.intervalSec)} window
          </span>
          <p className="live-q">{market.question}</p>
        </div>
      </div>

      <div className="live-sides">
        <div className="live-side">
          <span className="eyebrow" style={{ color: "var(--up)" }}>
            Up
          </span>
          <span className="live-px mono">{up === undefined ? "—" : up.toFixed(2)}</span>
        </div>

        {/* The column nobody else has. */}
        <div className="live-fair">
          <span className="eyebrow">Assay fair</span>
          <span className="live-px mono" style={{ color: "var(--ink)" }}>
            {fair.fair === null ? "—" : fair.fair.toFixed(2)}
          </span>
          <span className={`tag ${fair.signal === "unknown" ? "none" : fair.signal === "fair" ? "flat" : fair.signal}`}>
            {fair.signal === "rich"
              ? "UP RICH"
              : fair.signal === "cheap"
                ? "UP CHEAP"
                : fair.signal === "fair"
                  ? "NO EDGE"
                  : "NO DATA"}
          </span>
        </div>

        <div className="live-side live-side-r">
          <span className="eyebrow" style={{ color: "var(--down)" }}>
            Down
          </span>
          <span className="live-px mono">{down === undefined ? "—" : down.toFixed(2)}</span>
        </div>
      </div>

      <p className="live-note">
        {mid === undefined
          ? "Nobody has quoted this window yet. About five markets in six settle without a single trade."
          : fair.explain}
      </p>

      <Link href="/terminal" className="btn">
        Open the terminal
      </Link>
    </div>
  );
}
