/**
 * Calibra Terminal.
 *
 * A trading client for DreamDEX event contracts that shows, beside every
 * price, what that price has historically been wrong by. Nobody else can show
 * that column, because the measurement did not exist before this project.
 *
 * The honest version of the claim is the one on screen: the venue's pricing
 * error is real but time-varying, and when the measured interval covers zero
 * the app says there is no edge rather than inventing one. A trading UI that
 * always has an opinion is a UI that is lying some of the time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SomniaMarkets, MarketOnchain } from "@somnia-chain/markets-sdk";
import { DEFAULT_NETWORK, NETWORKS, type Network } from "./lib/chain.js";
import { connect, reconnect, watchWallet, hasWallet, short, type Connection } from "./lib/wallet.js";
import { createExchange, explainError, redeem } from "./lib/exchange.js";
import {
  loadBook,
  loadLiveMarkets,
  loadOnchain,
  loadSettledMarkets,
  type Book,
  type LiveMarket,
} from "./lib/markets.js";
import { fairValue, fetchStats, cents, type CalibraStats } from "./lib/calibra.js";
import { OrderBook } from "./components/OrderBook.js";
import { TradePanel } from "./components/TradePanel.js";

const REFRESH_MS = 6_000;
const STATS_MS = 60_000;

const fmtCountdown = (sec: number): string => {
  if (sec <= 0) return "closed";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
};

export default function App() {
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);
  const cfg = NETWORKS[network];

  const [conn, setConn] = useState<Connection | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<LiveMarket[]>([]);
  const [venueUsed, setVenueUsed] = useState<{ venueId: string; fallback: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [books, setBooks] = useState<Map<string, Book>>(new Map());
  const [onchain, setOnchain] = useState<MarketOnchain | null>(null);
  const [stats, setStats] = useState<CalibraStats | null>(null);
  const [claimable, setClaimable] = useState<{ marketId: string; asset: string; expiry: number }[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [presetPrice, setPresetPrice] = useState<number | undefined>();

  // A read-only exchange always exists so the app works before any wallet is
  // connected. A second one carrying the signer is created on connect.
  const readExchange = useMemo(() => createExchange(cfg), [cfg]);
  const tradeExchange = useMemo(
    () => (conn ? createExchange(cfg, conn.walletClient) : null),
    [cfg, conn],
  );
  const selected = useMemo(
    () => markets.find((m) => m.marketId === selectedId) ?? markets[0] ?? null,
    [markets, selectedId],
  );

  // ---- clock ----
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- wallet ----
  useEffect(() => {
    let alive = true;
    reconnect(cfg).then((c) => {
      if (alive && c) setConn(c);
    });
    return watchWallet(() => {
      reconnect(cfg).then((c) => setConn(c));
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
      const { markets: ms, venueId, usedFallback } = await loadLiveMarkets(readExchange, cfg);
      setMarkets(ms);
      setVenueUsed({ venueId, fallback: usedFallback });
      setSelectedId((cur) => (cur && ms.some((m) => m.marketId === cur) ? cur : (ms[0]?.marketId ?? null)));
    } catch (e) {
      setNotice(explainError(e));
    } finally {
      setLoading(false);
    }
  }, [readExchange, cfg]);

  useEffect(() => {
    setLoading(true);
    setMarkets([]);
    refreshMarkets();
    const id = setInterval(refreshMarkets, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshMarkets]);

  // ---- books for every open market, plus the selected market's chain status ----
  //
  // Fetching one book per visible market rather than only the selected one:
  // with ~10 open windows this is ten cheap reads a cycle, and it is the
  // difference between a list that prices the whole venue at a glance and one
  // where every row reads "select to load". The venue is small enough that the
  // honest version is also the affordable one.
  const refreshBooks = useCallback(async () => {
    if (markets.length === 0) return;
    const entries = await Promise.all(
      markets.map(async (m) => [m.marketId, await loadBook(readExchange, m.yesSymbol)] as const),
    );
    setBooks(new Map(entries));
  }, [readExchange, markets]);

  useEffect(() => {
    refreshBooks();
    const id = setInterval(refreshBooks, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshBooks]);

  // On-chain status is read only for the market being traded. It gates writes,
  // so it must be fresh - but reading it for every row would be ten RPC calls a
  // cycle to answer a question only one market is being asked.
  const refreshOnchain = useCallback(async () => {
    if (!selected) return;
    setOnchain(await loadOnchain(readExchange, selected.marketId).catch(() => null));
  }, [readExchange, selected]);

  useEffect(() => {
    setOnchain(null);
    refreshOnchain();
    const id = setInterval(refreshOnchain, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshOnchain]);

  // ---- stats ----
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

  // ---- claimable ----
  const refreshClaims = useCallback(async () => {
    if (!conn || !venueUsed) return setClaimable([]);
    const rows = await loadSettledMarkets(readExchange, venueUsed.venueId, 12);
    setClaimable(rows.map((r) => ({ marketId: r.marketId, asset: r.asset, expiry: r.expiry })));
  }, [conn, venueUsed, readExchange]);

  useEffect(() => {
    refreshClaims();
  }, [refreshClaims]);

  const doClaim = async (marketId: string) => {
    if (!tradeExchange) return;
    setClaiming(marketId);
    setNotice(null);
    try {
      await redeem(tradeExchange, marketId);
      setNotice("Claimed. Winnings are now in your wallet.");
      setClaimable((cur) => cur.filter((c) => c.marketId !== marketId));
    } catch (e) {
      setNotice(explainError(e));
    } finally {
      setClaiming(null);
    }
  };

  const EMPTY_BOOK: Book = { bids: [], asks: [], empty: true };
  const book = (selected && books.get(selected.marketId)) || EMPTY_BOOK;
  const selFair = fairValue(stats, book.mid ?? null);
  const wrongChain = conn !== null && conn.chainId !== cfg.chain.id;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Calibra</h1>
          <span className="sub">DreamDEX event contracts</span>
        </div>
        <div className="top-right">
          <select
            aria-label="Network"
            value={network}
            onChange={(e) => setNetwork(e.target.value as Network)}
            style={{ width: "auto" }}
          >
            <option value="testnet">Shannon testnet</option>
            <option value="mainnet">Somnia mainnet</option>
          </select>
          <span className={`chip ${markets.length ? "live" : ""}`}>
            <i className="dot" />
            {loading ? "loading" : `${markets.length} open`}
          </span>
          {conn ? (
            <span className="chip mono">{short(conn.address)}</span>
          ) : (
            <button type="button" className="primary" onClick={doConnect} disabled={!hasWallet()}>
              {hasWallet() ? "Connect wallet" : "No wallet detected"}
            </button>
          )}
        </div>
      </header>

      {walletError && <div className="alert err" style={{ marginBottom: "1rem" }}>{walletError}</div>}
      {wrongChain && (
        <div className="alert err" style={{ marginBottom: "1rem" }}>
          Your wallet is on chain {conn?.chainId}. Switch to {cfg.chain.name} ({cfg.chain.id}) to trade.{" "}
          <button type="button" className="ghost" onClick={doConnect}>Switch</button>
        </div>
      )}
      {notice && <div className="alert info" style={{ marginBottom: "1rem" }}>{notice}</div>}
      {venueUsed?.fallback && (
        <div className="alert info" style={{ marginBottom: "1rem" }}>
          The configured venue has no live markets, so this is showing venue{" "}
          <span className="mono">{venueUsed.venueId.slice(0, 12)}...</span> instead. Venue ids move often on
          this deployment.
        </div>
      )}

      <EdgeBanner stats={stats} />

      <div className="grid">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h3>Open windows</h3>
              <span className="small muted">price = probability of UP</span>
            </div>
            {loading && markets.length === 0 ? (
              <div className="panel-pad stack">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 44 }} />
                ))}
              </div>
            ) : markets.length === 0 ? (
              <div className="empty-note">
                No open windows on this venue right now. New markets are created on a rolling schedule.
              </div>
            ) : (
              markets.map((m) => (
                <MarketRow
                  key={m.marketId}
                  market={m}
                  now={now}
                  selected={selected?.marketId === m.marketId}
                  stats={stats}
                  isSelected={selected?.marketId === m.marketId}
                  bookMid={books.get(m.marketId)?.mid}
                  onSelect={() => {
                    setSelectedId(m.marketId);
                    setPresetPrice(undefined);
                  }}
                />
              ))
            )}
          </div>

          {selected && (
            <div className="panel">
              <div className="panel-head">
                <h3>Order book</h3>
                <span className="small muted mono">
                  {book.empty ? "empty" : `mid ${book.mid?.toFixed(3) ?? "-"}`}
                </span>
              </div>
              {book.empty ? (
                <div className="empty-note">
                  Nobody has quoted this window yet. About five in six markets on this venue settle without a
                  single trade, so being first here is normal.
                </div>
              ) : (
                <OrderBook book={book} onPick={(p) => setPresetPrice(p)} />
              )}
            </div>
          )}
        </div>

        <div className="stack">
          {selected ? (
            <>
              <FairPanel market={selected} fair={selFair} book={book} now={now} />
              <TradePanel
                cfg={cfg}
                exchange={tradeExchange}
                market={selected}
                onchain={onchain}
                book={book}
                fair={selFair}
                connected={!!conn && !wrongChain}
                onConnect={doConnect}
                onPlaced={() => {
                  refreshBooks();
                  refreshOnchain();
                  refreshClaims();
                }}
                presetPrice={presetPrice}
              />
            </>
          ) : (
            <div className="panel panel-pad muted">Select a market to trade.</div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h3>Claim winnings</h3>
              <span className="small muted">settled markets</span>
            </div>
            {!conn ? (
              <div className="empty-note">Connect a wallet to see what you can claim.</div>
            ) : claimable.length === 0 ? (
              <div className="empty-note">Nothing recently settled on this venue.</div>
            ) : (
              <>
                <p className="small muted" style={{ padding: "0.6rem 1.05rem 0" }}>
                  Winnings are claimed, not received. A settled market only pays out when someone asks it to.
                </p>
                {claimable.map((c) => (
                  <div key={c.marketId} className="list-item">
                    <span className="mono">
                      {c.asset} · {new Date(c.expiry * 1000).toISOString().slice(11, 16)} UTC
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={claiming === c.marketId}
                      onClick={() => doClaim(c.marketId)}
                    >
                      {claiming === c.marketId ? "Claiming..." : "Claim"}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <p className="footer-note">
        Fair value comes from Calibra's measurement of this venue's settled history, served by the local
        stats API. When the measured interval covers zero the app reports no edge rather than inventing
        one. Not financial advice; event contracts can lose their entire stake.
      </p>
    </div>
  );
}

function EdgeBanner({ stats }: { stats: CalibraStats | null }) {
  if (!stats) {
    return (
      <div className="edge-banner">
        <i className="verdict-dot" style={{ background: "var(--mid)" }} />
        <div>
          <div className="eyebrow">Fair value</div>
          <p className="small">
            Stats API not reachable. Run <span className="mono">npm run api</span> in the project root to see a
            measured fair value beside each price.
          </p>
        </div>
      </div>
    );
  }
  const standing = stats.live.verdict === "stand-down";
  return (
    <div className={`edge-banner ${standing ? "standing" : "trading"}`}>
      <i className="verdict-dot" />
      <div>
        <div className="eyebrow">
          Measured edge · last {stats.live.windowDays} days · {stats.live.sampleMarkets} markets
        </div>
        <p className="small" style={{ marginTop: "0.15rem" }}>
          {standing ? (
            <>
              <b>No measurable mispricing right now.</b> The interval is{" "}
              <span className="mono">
                [{cents(stats.live.recent.ci95[0])}, {cents(stats.live.recent.ci95[1])}]
              </span>
              , which spans zero. Prices are shown without a fair-value correction.
            </>
          ) : (
            <>
              <b>UP is running {stats.live.edge < 0 ? "rich" : "cheap"} by {cents(Math.abs(stats.live.edge))}.</b>{" "}
              Interval{" "}
              <span className="mono">
                [{cents(stats.live.recent.ci95[0])}, {cents(stats.live.recent.ci95[1])}]
              </span>{" "}
              over {stats.live.sampleMarkets} settled markets.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function FairPanel({
  market,
  fair,
  book,
  now,
}: {
  market: LiveMarket;
  fair: ReturnType<typeof fairValue>;
  book: Book;
  now: number;
}) {
  const left = market.expiry - now;
  return (
    <div className="panel panel-pad stack" style={{ gap: "0.6rem" }}>
      <div className="spread">
        <div>
          <div className="market-name">
            <span className="asset">{market.asset}</span>
            <span className="cadence">{market.intervalSec / 60}m window</span>
          </div>
          <p className="small muted">{market.question}</p>
        </div>
        <span className={`countdown ${left < 120 ? "soon" : ""}`}>{fmtCountdown(left)}</span>
      </div>
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Market</div>
          <div className="mono" style={{ fontSize: "1.35rem" }}>
            {book.mid !== undefined ? book.mid.toFixed(3) : <span className="muted small">no price yet</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">Calibra fair</div>
          <div className="mono" style={{ fontSize: "1.35rem" }}>
            {fair.fair !== null ? fair.fair.toFixed(3) : <span className="muted small">no edge</span>}
          </div>
        </div>
        <span className={`badge ${fair.signal}`}>
          {fair.signal === "rich"
            ? "UP RICH"
            : fair.signal === "cheap"
              ? "UP CHEAP"
              : fair.signal === "fair"
                ? "IN LINE"
                : "NO DATA"}
        </span>
      </div>
      <p className="small muted">{fair.explain}</p>
    </div>
  );
}

function MarketRow({
  market,
  now,
  isSelected,
  stats,
  bookMid,
  onSelect,
}: {
  market: LiveMarket;
  now: number;
  selected: boolean;
  isSelected: boolean;
  stats: CalibraStats | null;
  bookMid?: number;
  onSelect: () => void;
}) {
  // Every row carries its own book now, so "no quotes" means the market is
  // genuinely unquoted - which is the common case here - rather than merely
  // not fetched yet.
  const fv = fairValue(stats, bookMid ?? null);
  const left = market.expiry - now;
  return (
    <button type="button" className="market-row" aria-selected={isSelected} onClick={onSelect}>
      <div>
        <div className="market-name">
          <span className="asset">{market.asset}</span>
          <span className="cadence">{market.intervalSec / 60}m</span>
          {bookMid !== undefined && fv.signal !== "unknown" && (
            <span className={`badge ${fv.signal}`}>
              {fv.signal === "rich" ? "RICH" : fv.signal === "cheap" ? "CHEAP" : "IN LINE"}
            </span>
          )}
        </div>
        <div className="market-meta">
          <span className={`countdown ${left < 120 ? "soon" : ""}`}>{fmtCountdown(left)}</span>
          <span>closes {new Date(market.expiry * 1000).toISOString().slice(11, 16)} UTC</span>
        </div>
      </div>
      <div className="price-cell">
        {bookMid !== undefined ? (
          <span className="px">{bookMid.toFixed(3)}</span>
        ) : (
          <span className="px none">no quotes</span>
        )}
      </div>
    </button>
  );
}
