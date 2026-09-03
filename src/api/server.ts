/**
 * Assay API - a public read API for DreamDEX event contracts.
 *
 * This exists to fill a documented gap. DreamDEX's own HTTP API covers spot
 * only ("The HTTP API covers spot only - no event-contract endpoints"), so
 * every event-contract consumer today has to run the TypeScript SDK and hold a
 * viem client, even to render a price. That rules out anything that is not a
 * Node process: a Python notebook, a Grafana panel, a Discord bot, a phone.
 *
 * So: plain JSON over HTTP, no key, permissive CORS. Live market state is
 * proxied from the indexer on demand; everything statistical is served from the
 * local store built by `npm run backfill`.
 *
 * Built on node:http rather than a framework on purpose - this is a read-only
 * service with a dozen routes, and a dependency-free server is one fewer thing
 * between a judge and a running demo.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { openDb, getMeta, type DB } from "../db/schema.js";
import { baseRate, scoredFills, scoredMarkets, type ScoredFill, type ScoredMarket } from "../analytics/queries.js";
import { calibrationReport } from "../analytics/calibration.js";
import { edgeReport, liveEdge } from "../analytics/edge.js";
import { traderLeaderboard, makerVsTaker } from "../analytics/traders.js";
import { coverage, byHourOfDay, concentration } from "../analytics/liquidity.js";
import { Indexer, KNOWN_VENUE, COLLATERAL_DECIMALS, toFloat, type Network } from "../indexer/client.js";
import { liveMarkets } from "../indexer/queries.js";

const network = ((process.env.NETWORK ?? "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet") as Network;
const dbPath = process.env.ASSAY_DB ?? `data/assay-${network}.db`;
const port = Number(process.env.PORT ?? 8787);

const db: DB = openDb(dbPath);
const ix = new Indexer({ network });
const venueId = process.env.VENUE_ID ?? getMeta(db, "venue_id") ?? KNOWN_VENUE[network];
const decimals = COLLATERAL_DECIMALS[network];

/**
 * Memoise the expensive reads.
 *
 * The edge report runs a 20,000-resample bootstrap; recomputing it per request
 * would make the dashboard's own polling the server's heaviest load. The store
 * only changes when a backfill runs, so a short TTL is plenty.
 */
function memo<T>(ttlMs: number, fn: () => T): () => T {
  let at = 0;
  let val: T;
  return () => {
    const now = Date.now();
    if (now - at > ttlMs) {
      val = fn();
      at = now;
    }
    return val;
  };
}

const TTL = 60_000;
const getFills = memo<ScoredFill[]>(TTL, () => scoredFills(db));
const getMarkets = memo<ScoredMarket[]>(TTL, () => scoredMarkets(db));
const getCalibration = memo(TTL, () => calibrationReport(getMarkets(), getFills()));
const getEdge = memo(TTL, () => edgeReport(getFills()));
const getCoverage = memo(TTL, () => coverage(db));

interface Ctx {
  url: URL;
  res: ServerResponse;
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=30",
  });
  res.end(payload);
};

const num = (u: URL, key: string, def: number) => {
  const raw = u.searchParams.get(key);
  if (raw === null) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
};

type Handler = (ctx: Ctx) => void | Promise<void>;

const routes: Record<string, Handler> = {
  "/": ({ res }) =>
    send(res, 200, {
      name: "assay",
      description: "Public read API for DreamDEX event contracts on Somnia",
      network,
      venueId,
      dataAsOf: Number(getMeta(db, "last_backfill_at") ?? 0),
      routes: [
        "GET /v1/summary            everything the dashboard needs, in one call",
        "GET /v1/markets/live       currently tradable event contracts (live from the indexer)",
        "GET /v1/stats/base-rate    how often the underlying actually closes up",
        "GET /v1/stats/calibration  implied vs realized probability, incl. by time-to-expiry",
        "GET /v1/stats/edge         is the mispricing constant? (clustered + block bootstrap)",
        "GET /v1/edge/live          the trade / stand-down verdict the agent obeys",
        "GET /v1/traders            settled PnL leaderboard  (?minTrades=5&limit=25)",
        "GET /v1/liquidity          coverage, hour-of-day, participant concentration",
      ],
    }),

  "/health": ({ res }) => {
    const m = db.prepare(`SELECT COUNT(*) n FROM markets`).get() as { n: number };
    const f = db.prepare(`SELECT COUNT(*) n FROM fills`).get() as { n: number };
    send(res, 200, {
      ok: m.n > 0,
      network,
      markets: m.n,
      fills: f.n,
      dataAsOf: Number(getMeta(db, "last_backfill_at") ?? 0),
    });
  },

  "/v1/markets/live": async ({ res }) => {
    const rows = await liveMarkets(ix, venueId, 60);
    const now = Math.floor(Date.now() / 1000);
    send(
      res,
      200,
      rows.map((m) => ({
        marketId: m.marketId,
        asset: m.asset,
        question: m.question,
        intervalSec: Number(m.intervalSec ?? 0),
        expiry: Number(m.expiry ?? 0),
        secondsLeft: Number(m.expiry ?? 0) - now,
        // The market's own last print, as a YES probability.
        impliedUp: toFloat(m.lastPrice, decimals),
        midpoint: toFloat(m.rawMidpoint, decimals),
        trades: Number(m.tradeCount ?? 0),
        poolAddress: m.binaryPoolAddress ?? m.poolAddress,
      })),
    );
  },

  "/v1/stats/base-rate": ({ res }) => send(res, 200, baseRate(db)),

  "/v1/stats/calibration": ({ res }) => send(res, 200, getCalibration()),

  "/v1/stats/edge": ({ res }) => {
    const e = getEdge();
    send(res, 200, {
      ...e,
      note:
        "`naive` is the per-fill estimate and is included only as a foil: fills within one market " +
        "share a single outcome, so it overstates n and inflates t. Act on `clustered` for the point " +
        "estimate and `bootstrap` for the interval.",
    });
  },

  "/v1/edge/live": ({ url, res }) =>
    send(
      res,
      200,
      liveEdge(getFills(), {
        windowDays: num(url, "windowDays", 7),
        minMarkets: num(url, "minMarkets", 60),
        minEdge: num(url, "minEdge", 0.02),
      }),
    ),

  "/v1/traders": ({ url, res }) => {
    const { traders, zeroSumResidual } = traderLeaderboard(getFills(), {
      minTrades: num(url, "minTrades", 5),
      minMarkets: num(url, "minMarkets", 3),
      limit: num(url, "limit", 25),
    });
    send(res, 200, {
      traders,
      makerVsTaker: makerVsTaker(getFills()),
      // Event contracts are a closed system and this venue charges no
      // settlement fee, so PnL must sum to ~0. Exposed as a live audit of our
      // own accounting rather than hidden.
      zeroSumResidual,
      note:
        "Realized settled PnL over observed fills. Ranked only over wallets with >=minMarkets " +
        "distinct markets, because repeated fills inside one window are one bet, not many. " +
        "Unredeemed winnings still count; open inventory does not.",
    });
  },

  "/v1/liquidity": ({ res }) =>
    send(res, 200, {
      ...getCoverage(),
      byHourUtc: byHourOfDay(db),
      concentration: concentration(db),
    }),

  "/v1/summary": ({ res }) => {
    const cal = getCalibration();
    const e = getEdge();
    const live = liveEdge(getFills());
    const cov = getCoverage();
    send(res, 200, {
      network,
      venueId,
      dataAsOf: Number(getMeta(db, "last_backfill_at") ?? 0),
      baseRate: baseRate(db),
      coverage: cov.overall,
      bySeries: cov.bySeries,
      calibration: { byMarket: cal.byMarket, byTimeToExpiry: cal.byTimeToExpiry, brierSkill: cal.brierSkill },
      edge: { naive: e.naive, clustered: e.clustered, bootstrap: e.bootstrap, weekly: e.weekly, signFlips: e.signFlips },
      live,
      concentration: concentration(db),
      makerVsTaker: makerVsTaker(getFills()),
    });
  },
};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
    });
    return res.end();
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const handler = routes[url.pathname.replace(/\/+$/, "") || "/"];
  if (!handler) return send(res, 404, { error: "not found", try: "/" });
  try {
    await handler({ url, res });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(port, () => {
  console.log(`assay api - ${network} - http://localhost:${port}`);
  console.log(`  store ${dbPath}  venue ${venueId.slice(0, 10)}...`);
});
