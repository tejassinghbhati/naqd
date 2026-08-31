/**
 * `npm run agent` - run the Calibra market-making agent.
 *
 * Defaults to DRY_RUN and to testnet. It logs exactly what it would place and
 * sends nothing until you set DRY_RUN=false, which is the order every one of
 * these decisions should be made in.
 *
 * The edge is read from the LOCAL store, which means the agent is only as
 * current as your last `npm run backfill`. That is deliberate - the edge is a
 * multi-day statistic and re-deriving it from the chain every 30 seconds would
 * be both slow and pointless - but it does mean a stale store makes a confident
 * agent, so the banner prints the store's age and refuses anything ancient.
 */
import "dotenv/config";
import { openDb, getMeta } from "../db/schema.js";
import { scoredFills } from "../analytics/queries.js";
import { liveEdge } from "../analytics/edge.js";
import { createExchange, loadAgentConfig } from "../agent/exchange.js";
import { Agent } from "../agent/runner.js";
import { DEFAULT_POLICY } from "../agent/policy.js";

const config = loadAgentConfig();

// The edge is measured on mainnet history regardless of where we trade: testnet
// markets are too thin to estimate anything, and the pricing behaviour we are
// modelling is the venue's, not the chain's. Say so rather than let it surprise.
const edgeNetwork = process.env.EDGE_NETWORK ?? "mainnet";
const dbPath = process.env.CALIBRA_DB ?? `data/calibra-${edgeNetwork}.db`;

const num = (name: string, def: number) => {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name}="${raw}" is not a number`);
  return n;
};

const db = openDb(dbPath);
const asOf = Number(getMeta(db, "last_backfill_at") ?? 0);
const ageHours = asOf ? (Date.now() / 1000 - asOf) / 3600 : Infinity;

console.log("calibra agent");
console.log(`  trading on   ${config.network} (chain ${config.chainId})${config.dryRun ? "  [DRY RUN]" : "  [LIVE]"}`);
console.log(`  venue        ${config.venueId.slice(0, 12)}...`);
console.log(`  edge from    ${dbPath} (${edgeNetwork})`);
console.log(`  store age    ${Number.isFinite(ageHours) ? `${ageHours.toFixed(1)}h` : "never backfilled"}`);
console.log(`  signer       ${config.privateKey ? "set" : "NOT SET - read-only"}`);

if (!Number.isFinite(ageHours)) {
  console.error("\nno backfill in the store. run `npm run backfill` first.");
  process.exit(1);
}
if (ageHours > 48) {
  console.error(`\nstore is ${ageHours.toFixed(0)}h old - refusing to size quotes off a stale edge.`);
  console.error("run `npm run backfill`, or set CALIBRA_ALLOW_STALE=1 to override.");
  if (process.env.CALIBRA_ALLOW_STALE !== "1") process.exit(1);
}
if (!config.dryRun && !config.privateKey) {
  console.error("\nDRY_RUN=false but no PRIVATE_KEY is set.");
  process.exit(1);
}

const windowDays = num("EDGE_WINDOW_DAYS", 7);
const minMarkets = num("EDGE_MIN_MARKETS", 60);
const minEdge = num("EDGE_MIN", 0.02);

// Re-read on every pass so a backfill running alongside the agent takes effect
// without a restart, and so a widening interval can pull it back to flat.
const readEdge = () => liveEdge(scoredFills(db), { windowDays, minMarkets, minEdge });

const first = readEdge();
console.log(`  edge now     ${(first.edge * 100).toFixed(2)}c over ${first.sampleMarkets} markets -> ${first.verdict.toUpperCase()}`);
console.log(`               ${first.reason}\n`);

const ctx = createExchange(config);
const agent = new Agent(ctx, {
  requoteSec: num("REQUOTE_SEC", 45),
  size: num("QUOTE_SIZE", config.network === "mainnet" ? 1 : 50),
  maxMarkets: num("MAX_MARKETS", 6),
  policy: {
    ...DEFAULT_POLICY,
    minHalfSpread: num("MIN_HALF_SPREAD", DEFAULT_POLICY.minHalfSpread),
    minWindowFraction: num("MIN_WINDOW_FRACTION", DEFAULT_POLICY.minWindowFraction),
  },
  readEdge,
});

const controller = new AbortController();
const shutdown = () => {
  console.log("\nshutting down...");
  controller.abort();
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (process.env.ONCE === "1") {
  agent
    .tick()
    .then((n) => {
      console.log(`\none pass complete - ${n} order(s) ${config.dryRun ? "simulated" : "placed"}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`pass failed: ${e.message}`);
      process.exit(1);
    });
} else {
  agent.run(controller.signal).catch((e) => {
    console.error(`agent stopped: ${e.message}`);
    process.exit(1);
  });
}
