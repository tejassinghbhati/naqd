"use client";

/**
 * Calibra Terminal.
 *
 * A trading client for DreamDEX event contracts that shows, beside every price,
 * what that price has historically been wrong by. No other frontend can render
 * that column, because the measurement did not exist before this project.
 *
 * The honest version of the claim is the one on screen. The venue's pricing
 * error is real but time-varying: pooled per fill it reads -3.10c at t = -4.08,
 * but fills inside one market share a single outcome, so clustering by market
 * gives t = -2.48, and a bootstrap over whole weeks puts the interval at
 * [-5.06c, +2.12c] - straddling zero. So when the interval covers zero this app
 * reports NO EDGE rather than inventing one. A trading UI that always has an
 * opinion is a UI that is lying some of the time.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SomniaMarkets, MarketOnchain } from "@somnia-chain/markets-sdk";
import { DEFAULT_NETWORK, NETWORKS, type Network } from "@/lib/chain";
import { connect, reconnect, watchWallet, hasWallet, short, type Connection } from "@/lib/wallet";
import { createExchange, explainError, redeem, type Outcome } from "@/lib/exchange";
import {
  loadBook,
  loadLiveMarkets,
  loadOnchain,
  loadSettledMarkets,
  loadTrades,
  type Book,
  type LiveMarket,
} from "@/lib/markets";
import { fairValue, fetchStats, type CalibraStats } from "@/lib/calibra";
import { OrderBook } from "@/components/terminal/OrderBook";
import { Ticket } from "@/components/terminal/Ticket";
import { MarketList } from "@/components/terminal/MarketList";
import { QuoteHeader, EdgeStrip, Claims, VenueStats, type ClaimRow } from "@/components/terminal/Panels";
import { PriceTrack, Tape, toPrint, type Print } from "@/components/terminal/Tape";

const BOOK_MS = 5_000;
const MARKETS_MS = 15_000;
const STATS_MS = 60_000;
const EMPTY_BOOK: Book = { bids: [], asks: [], empty: true };

export default function TerminalClient() {
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);
  const cfg = NETWORKS[network];

  const [conn, setConn] = useState<Connection | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<LiveMarket[]>([]);
  const [venue, setVenue] = useState<{ venueId: string; fallback: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [books, setBooks] = useState<Map<string, Book>>(new Map());
  const [onchain, setOnchain] = useState<MarketOnchain | null>(null);
  const [stats, setStats] = useState<CalibraStats | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [presetPrice, setPresetPrice] = useState<number | undefined>();
  const [outcome, setOutcome] = useState<Outcome>("UP");
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [prints, setPrints] = useState<Print[]>([]);

  // A read-only client always exists, so the terminal is fully usable before any
  // wallet is connected. A second one carrying the signer appears on connect.
  const read = useMemo(() => createExchange(cfg), [cfg]);
  const trade = useMemo(() => (conn ? createExchange(cfg, conn.walletClient) : null), [cfg, conn]);
  const selected = useMemo(
    () => markets.find((m) => m.marketId === selectedId) ?? markets[0] ?? null,
    [markets, selectedId],
  );
  const book = (selected && books.get(selected.marketId)) || EMPTY_BOOK;
  const fair = fairValue(stats, book.mid ?? null);
  const wrongChain = conn !== null && conn.chainId !== cfg.chain.id;

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- wallet ----
  useEffect(() => {
    reconnect(cfg).then((c) => c && setConn(c));
    return watchWallet(() => {
      reconnect(cfg).then(setConn);
    });
  }, [cfg]);

  const doConnect = useCallback(async () => {
    setWalletError(null);
    try {
      setConn(await connect(cfg));
    } catch (e) {
      setWalletError(explainError(e));
    }
  }, [cfg]);

  // ---- markets ----
  const refreshMarkets = useCallback(async () => {
    try {
      const { markets: ms, venueId, usedFallback } = await loadLiveMarkets(read, cfg);
      setMarkets(ms);
      setVenue({ venueId, fallback: usedFallback });
      setSelectedId((cur) => (cur && ms.some((m) => m.marketId === cur) ? cur : ms[0]?.marketId ?? null));
    } catch (e) {
      setNotice(explainError(e));
    } finally {
      setLoading(false);
    }
  }, [read, cfg]);

  useEffect(() => {
    setLoading(true);
    setMarkets([]);
    setBooks(new Map());
    refreshMarkets();
    const id = setInterval(refreshMarkets, MARKETS_MS);
    return () => clearInterval(id);
  }, [refreshMarkets]);

  // ---- books for every open market ----
  //
  // One read per visible market rather than only the selected one. With ~10 open
  // windows that is ten cheap calls a cycle, and it is the difference between a
  // list that prices the venue at a glance and one where every row says "select
  // to load". Round-trip time is sampled here and shown in the status bar.
  const refreshBooks = useCallback(async () => {
    if (markets.length === 0) return;
    const t0 = performance.now();
    const entries = await Promise.all(
      markets.map(async (m) => [m.marketId, await loadBook(read, m.yesSymbol)] as const),
    );
    setLatency(Math.round(performance.now() - t0));
    setBooks(new Map(entries));
    setLastTick(Date.now());
  }, [read, markets]);

  useEffect(() => {
    refreshBooks();
    const id = setInterval(refreshBooks, BOOK_MS);
    return () => clearInterval(id);
  }, [refreshBooks]);

  // On-chain status only for the market being traded. It gates writes so it must
  // be fresh, but reading it for every row would be ten RPC calls a cycle to
  // answer a question only one market is being asked.
  const refreshOnchain = useCallback(async () => {
    if (!selected) return;
    const [oc, tr] = await Promise.all([
      loadOnchain(read, selected.marketId).catch(() => null),
      loadTrades(read, selected.yesSymbol, 40),
    ]);
    setOnchain(oc);
    // fetchTrades answers for the tradable SYMBOL, and a symbol outlives any one
    // window - so the raw list mixes in prints from windows that already
    // settled. Plotting those against this window's clock stacks them all on the
    // left edge and makes an unrelated hour of history look like the open. Keep
    // only what actually printed inside this window.
    const openedAt = (selected.expiry - selected.intervalSec) * 1000;
    const closesAt = selected.expiry * 1000;
    setPrints(tr.map(toPrint).filter((p) => p.timestamp >= openedAt && p.timestamp <= closesAt));
  }, [read, selected]);

  useEffect(() => {
    setOnchain(null);
    setPrints([]);
    refreshOnchain();
    const id = setInterval(refreshOnchain, BOOK_MS);
    return () => clearInterval(id);
  }, [refreshOnchain]);

  // ---- measured edge ----
  useEffect(() => {
    const ctl = new AbortController();
    const run = () => fetchStats(ctl.signal).then((s) => s && setStats(s));
    run();
    const id = setInterval(run, STATS_MS);
    return () => {
      ctl.abort();
      clearInterval(id);
    };
  }, []);

  // ---- claims ----
  const refreshClaims = useCallback(async () => {
    if (!conn || !venue) return setClaims([]);
    const rows = await loadSettledMarkets(read, venue.venueId, 8);
    setClaims(rows.map((r) => ({ marketId: r.marketId, asset: r.asset, expiry: r.expiry })));
  }, [conn, venue, read]);

  useEffect(() => {
    refreshClaims();
  }, [refreshClaims]);

  const doClaim = async (marketId: string) => {
    if (!trade) return;
    setClaiming(marketId);
    setNotice(null);
    try {
      await redeem(trade, marketId);
      setNotice("Claimed. Winnings are in your wallet.");
      setClaims((c) => c.filter((x) => x.marketId !== marketId));
    } catch (e) {
      setNotice(explainError(e));
    } finally {
      setClaiming(null);
    }
  };

  // ---- keyboard ----
  //
  // The shortcuts a desk actually uses: move the selection, flip the side. Kept
  // off any field that takes text, so typing a price never moves the market.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const idx = markets.findIndex((m) => m.marketId === selected?.marketId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = markets[Math.min(markets.length - 1, idx + 1)];
        if (next) setSelectedId(next.marketId);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = markets[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.marketId);
      } else if (e.key.toLowerCase() === "u") {
        setOutcome("UP");
      } else if (e.key.toLowerCase() === "d") {
        setOutcome("DOWN");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markets, selected]);

  const age = lastTick ? Math.max(0, Math.round((now * 1000 - lastTick) / 1000)) : null;

  return (
    <div className="terminal">
      <header className="topbar">
        <div className="wordmark">
          <span className="name">CALIBRA</span>
          <span className="tag">EVENT CONTRACTS</span>
        </div>

        <div className="spacer" />

        <div className="readout opt">
          <span className="k">Venue</span>
          <span className="v">{venue ? `${venue.venueId.slice(0, 10)}…` : "—"}</span>
        </div>
        <div className="readout opt">
          <span className="k">Open</span>
          <span className="v">{markets.length}</span>
        </div>
        <div className="readout opt">
          <span className="k">Latency</span>
          <span className={`v ${latency !== null && latency < 800 ? "good" : latency !== null ? "warn" : ""}`}>
            {latency !== null ? `${latency}ms` : "—"}
          </span>
        </div>
        <div className="readout">
          <span className="k">Network</span>
          <span className="v">
            <select
              aria-label="Network"
              value={network}
              onChange={(e) => setNetwork(e.target.value as Network)}
              style={{ border: 0, background: "none", padding: 0, width: "auto", fontSize: 12, color: "inherit" }}
            >
              <option value="testnet">Shannon testnet</option>
              <option value="mainnet">Somnia mainnet</option>
            </select>
          </span>
        </div>

        <div style={{ paddingLeft: 12, borderLeft: "1px solid var(--rule)" }}>
          {conn ? (
            <div className="rowf">
              <span className={`dot ${wrongChain ? "bad" : "live"}`} />
              <span className="mono" style={{ fontSize: 12 }}>
                {short(conn.address)}
              </span>
            </div>
          ) : (
            <button type="button" onClick={doConnect} disabled={!hasWallet()}>
              {hasWallet() ? "Connect wallet" : "No wallet"}
            </button>
          )}
        </div>
      </header>

      <EdgeStrip stats={stats} />

      {(walletError || wrongChain || notice || venue?.fallback) && (
        <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {walletError && (
            <div className="notice err">
              <span className="ic">!</span>
              <span>{walletError}</span>
            </div>
          )}
          {wrongChain && (
            <div className="notice err">
              <span className="ic">!</span>
              <span>
                Wallet is on chain {conn?.chainId}. Switch to {cfg.chain.name} ({cfg.chain.id}) to trade.{" "}
                <button type="button" className="link" onClick={doConnect}>
                  switch now
                </button>
              </span>
            </div>
          )}
          {venue?.fallback && (
            <div className="notice warn">
              <span className="ic">!</span>
              <span>
                The configured venue has no live markets, so this is showing{" "}
                <span className="mono">{venue.venueId.slice(0, 12)}…</span> instead. Venue ids move often on
                this deployment.
              </span>
            </div>
          )}
          {notice && (
            <div className="notice info">
              <span className="ic">i</span>
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}

      <div className="workspace">
        <div className="col left">
          <div className="pane grow">
            <div className="pane-hd">
              <h3>Markets</h3>
              <span className="lbl">P(UP)</span>
            </div>
            <MarketList
              markets={markets}
              books={books}
              stats={stats}
              now={now}
              selectedId={selected?.marketId ?? null}
              onSelect={(id) => {
                setSelectedId(id);
                setPresetPrice(undefined);
              }}
              loading={loading}
            />
          </div>
        </div>

        <div className="col">
          {selected ? (
            <>
              <QuoteHeader market={selected} book={book} fair={fair} now={now} />
              <div className="pane">
                <div className="pane-hd">
                  <h3>Order book</h3>
                  <span className="lbl">click a level to load its price</span>
                </div>
                {book.empty ? (
                  <div className="empty" style={{ padding: "26px 24px" }}>
                    <div className="hd">No resting orders</div>
                    Nobody has quoted this window. About five markets in six on this venue settle without a
                    single trade, so being first here is the normal case, not an edge case.
                  </div>
                ) : (
                  <OrderBook book={book} onPick={setPresetPrice} />
                )}
              </div>

              <div className="pane grow">
                <div className="pane-hd">
                  <h3>Traded probability</h3>
                  <span className="lbl">
                    {prints.length} print{prints.length === 1 ? "" : "s"} this window
                  </span>
                </div>
                <div className="pane-bd" style={{ paddingBottom: 4 }}>
                  <PriceTrack
                    prints={prints}
                    start={selected.expiry - selected.intervalSec}
                    end={selected.expiry}
                    now={now}
                  />
                  <p className="xs dim" style={{ marginTop: 6, lineHeight: 1.5 }}>
                    {fair.explain}
                  </p>
                </div>
              </div>

              <div className="pane">
                <div className="pane-hd">
                  <h3>Tape</h3>
                  <span className="lbl">last prints</span>
                </div>
                <Tape prints={prints} />
              </div>

            </>
          ) : (
            <div className="empty" style={{ padding: 48 }}>
              <div className="hd">No market selected</div>
              Waiting for an open window.
            </div>
          )}
        </div>

        <div className="col right">
          {selected && (
            <Ticket
              cfg={cfg}
              exchange={trade}
              market={selected}
              onchain={onchain}
              book={book}
              fair={fair}
              connected={!!conn && !wrongChain}
              onConnect={doConnect}
              onPlaced={() => {
                refreshBooks();
                refreshOnchain();
                refreshClaims();
              }}
              presetPrice={presetPrice}
              outcome={outcome}
              setOutcome={setOutcome}
            />
          )}
          <Claims rows={claims} connected={!!conn} claiming={claiming} onClaim={doClaim} />
          <VenueStats stats={stats} />
        </div>
      </div>

      <footer className="statusbar">
        <span className="seg-i">
          <span className={`dot ${age !== null && age < 15 ? "live" : "warn"}`} />
          {age !== null ? `updated ${age}s ago` : "connecting"}
        </span>
        <span className="seg-i">
          {onchain ? `STATUS ${onchain.status === 1 ? "TRADING" : onchain.status}` : "STATUS —"}
        </span>
        <span className="seg-i">
          {stats ? `EDGE DATA ${new Date(stats.dataAsOf * 1000).toISOString().slice(0, 10)}` : "EDGE DATA —"}
        </span>
        <span className="spacer" />
        <span className="seg-i">
          <span className="kbd">J</span>
          <span className="kbd">K</span> market
        </span>
        <span className="seg-i">
          <span className="kbd">U</span>
          <span className="kbd">D</span> side
        </span>
        <span className="seg-i dimmer">not financial advice</span>
      </footer>
    </div>
  );
}
