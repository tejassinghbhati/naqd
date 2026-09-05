/**
 * `npm run doctor` - preflight. Read-only, no key needed, sends nothing.
 *
 * The first command to run in a fresh checkout, and the first one to run when
 * something has gone quiet. It answers the questions that otherwise cost an
 * afternoon:
 *
 *   - Is the indexer reachable, and does it have live binary markets?
 *   - Has the venue id moved? Both networks changed theirs three times in one
 *     week, and a bot pointed at a stale venue simply finds nothing, forever,
 *     with nothing in the log to say so. Silence is the wrong answer here, so
 *     this compares the bundled constant against where the markets actually are.
 *   - Does the local store exist, and how stale is it?
 *   - What would the agent do right now, and why?
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { Indexer, KNOWN_VENUE, COLLATERAL_DECIMALS, toFloat, type Network } from "../indexer/client.js";
import { liveMarkets, observedVenues } from "../indexer/queries.js";
import { openDb, getMeta } from "../db/schema.js";
import { scoredFills } from "../analytics/queries.js";
import { liveEdge } from "../analytics/edge.js";
import { loadAgentConfig } from "../agent/exchange.js";

const OK = "  ok  ";
const WARN = " warn ";
const BAD = " fail ";
const line = (mark: string, label: string, detail: string) => console.log(`[${mark}] ${label.padEnd(22)} ${detail}`);

const main = async () => {
  const cfg = loadAgentConfig();
  const edgeNetwork = (process.env.EDGE_NETWORK ?? "mainnet") as Network;
  const dbPath = process.env.NAQD_DB ?? `data/naqd-${edgeNetwork}.db`;
  let problems = 0;

  console.log("naqd doctor\n");

  // --- 1. The chain the agent would trade on --------------------------------
  console.log(`agent target: ${cfg.network} (chain ${cfg.chainId})`);
  line(cfg.dryRun ? OK : WARN, "dry run", cfg.dryRun ? "on - nothing will be sent" : "OFF - orders will be REAL");
  line(cfg.privateKey ? OK : WARN, "signer", cfg.privateKey ? "set" : "not set - read-only");
  if (!cfg.dryRun && !cfg.privateKey) {
    line(BAD, "config", "DRY_RUN=false with no PRIVATE_KEY - the agent will refuse to start");
    problems++;
  }

  // --- 2. Indexer reachability and venue drift ------------------------------
  console.log(`\nindexer: ${cfg.indexerUrl}`);
  const ix = new Indexer({ network: cfg.network });
  let venues: { venueId: string; count: number }[] = [];
  try {
    venues = await observedVenues(ix);
    line(OK, "reachable", `${venues.length} venue(s) seen in recent binary markets`);
  } catch (e) {
    line(BAD, "reachable", (e as Error).message);
    problems++;
  }

  // Report drift precisely. "The busiest venue is a different one" and "the
  // venue you are pointed at is dead" are different situations with different
  // fixes, and only the live-market count below can tell them apart - so say
  // which one this is rather than crying MOVED at every multi-venue deployment.
  const bundled = KNOWN_VENUE[cfg.network];
  const busiest = venues[0];
  const configured = venues.find((v) => v.venueId.toLowerCase() === cfg.venueId.toLowerCase());
  if (busiest && busiest.venueId.toLowerCase() !== cfg.venueId.toLowerCase()) {
    line(WARN, "venue id", `busiest venue is ${busiest.venueId.slice(0, 12)}... (${busiest.count} recent markets)`);
    console.log(`       you are scoped to ${cfg.venueId.slice(0, 12)}...` +
      `${configured ? ` (${configured.count} recent markets)` : " (0 in the recent sample)"}`);
    console.log(`       if that is not deliberate: VENUE_ID=${busiest.venueId}`);
  } else if (busiest) {
    line(OK, "venue id", `${cfg.venueId.slice(0, 14)}... is the busiest venue`);
  }
  if (cfg.venueId.toLowerCase() !== bundled.toLowerCase()) {
    line(OK, "venue source", "VENUE_ID from .env, overriding the bundled constant");
  }
  if (venues.length > 1) {
    line(WARN, "venue scope", `markets span ${venues.length} venues - pin VENUE_ID so reads and trades agree`);
  }

  // --- 3. Live markets ------------------------------------------------------
  try {
    const live = await liveMarkets(ix, cfg.venueId, 10);
    if (live.length === 0) {
      line(BAD, "live markets", "none on the venue you are scoped to - the agent will find nothing to quote");
      problems++;
    } else {
      line(OK, "live markets", `${live.length} tradable`);
      const now = Math.floor(Date.now() / 1000);
      for (const m of live.slice(0, 4)) {
        const left = Number(m.expiry ?? 0) - now;
        const px = toFloat(m.lastPrice, COLLATERAL_DECIMALS[cfg.network]);
        console.log(
          `       ${String(m.asset).padEnd(4)} ${String(Number(m.intervalSec ?? 0) / 60).padStart(3)}m  ` +
            `closes in ${String(Math.max(0, Math.floor(left / 60))).padStart(3)}m  ` +
            `last ${px === null ? "  -  " : px.toFixed(3)}  trades ${m.tradeCount ?? 0}`,
        );
      }
    }
  } catch (e) {
    line(BAD, "live markets", (e as Error).message);
    problems++;
  }

  // --- 4. The local store the edge is measured from -------------------------
  console.log(`\nstore: ${dbPath}`);
  if (!existsSync(dbPath)) {
    line(BAD, "exists", "no - run `npm run backfill` first");
    console.log("\n1 blocking problem. Run `npm run backfill`, then this again.");
    process.exit(1);
  }

  const db = openDb(dbPath);
  const counts = db.prepare("SELECT COUNT(*) n FROM markets").get() as { n: number };
  const fillCount = db.prepare("SELECT COUNT(*) n FROM fills").get() as { n: number };
  const asOf = Number(getMeta(db, "last_backfill_at") ?? 0);
  const ageH = asOf ? (Date.now() / 1000 - asOf) / 3600 : Infinity;

  line(counts.n > 0 ? OK : BAD, "markets", `${counts.n} rows, ${fillCount.n} fills`);
  if (counts.n === 0) problems++;
  // The agent refuses to size quotes off a store older than 48h, so warn early.
  line(ageH <= 48 ? OK : WARN, "freshness", Number.isFinite(ageH) ? `${ageH.toFixed(1)}h old` : "never backfilled");
  if (ageH > 48) console.log("       the agent refuses to trade on a store older than 48h - run `npm run backfill`");

  // --- 5. What the agent would do right now ---------------------------------
  const fills = scoredFills(db);
  const scored = fills.length;
  if (scored === 0) {
    line(WARN, "scored fills", "none - nothing resolved to measure yet");
  } else {
    const edge = liveEdge(fills);
    console.log(`\nlive edge (last ${edge.windowDays}d, measured on ${edgeNetwork}):`);
    line(
      edge.verdict === "trade" ? OK : WARN,
      "verdict",
      `${edge.verdict.toUpperCase()} - ${edge.reason}`,
    );
    console.log(
      `       edge ${(edge.edge * 100).toFixed(2)}c  ` +
        `CI [${(edge.recent.ci95[0] * 100).toFixed(2)}c, ${(edge.recent.ci95[1] * 100).toFixed(2)}c]  ` +
        `over ${edge.sampleMarkets} markets  size x${edge.confidence.toFixed(2)}`,
    );
    if (edge.verdict === "stand-down") {
      console.log("       standing down is the expected default - it takes positive evidence to quote.");
    }
  }
  db.close();

  console.log(
    problems === 0
      ? "\nall checks passed. `npm run analyze` for the full report, `npm run agent` to dry-run the bot."
      : `\n${problems} problem(s) above.`,
  );
  process.exit(problems === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(`doctor failed: ${e.message}`);
  process.exit(1);
});
