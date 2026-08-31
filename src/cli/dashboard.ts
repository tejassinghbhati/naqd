/**
 * `npm run dashboard` - bake the live summary into a standalone dashboard.
 *
 * `web/index.html` polls the API when one is running and falls back to a
 * snapshot embedded in its `#snapshot` script tag. This writes that snapshot in,
 * producing `web/dashboard.html`: one self-contained file that opens from disk,
 * with no server and no network, and still shows real numbers.
 *
 * That matters for a submission. A judge should be able to double-click a file
 * and see the finding, without installing anything first.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, getMeta } from "../db/schema.js";
import { baseRate, scoredFills, scoredMarkets } from "../analytics/queries.js";
import { calibrationReport } from "../analytics/calibration.js";
import { edgeReport, liveEdge } from "../analytics/edge.js";
import { makerVsTaker } from "../analytics/traders.js";
import { coverage, concentration } from "../analytics/liquidity.js";
import { KNOWN_VENUE } from "../indexer/client.js";

const network = (process.env.NETWORK ?? "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet";
const dbPath = process.env.CALIBRA_DB ?? `data/calibra-${network}.db`;

const db = openDb(dbPath);
const fills = scoredFills(db);
const markets = scoredMarkets(db);
if (markets.length === 0) {
  console.error(`no data in ${dbPath} - run \`npm run backfill\` first.`);
  process.exit(1);
}

const cal = calibrationReport(markets, fills);
const edge = edgeReport(fills);
const cov = coverage(db);

const summary = {
  network,
  venueId: getMeta(db, "venue_id") ?? KNOWN_VENUE[network as "testnet" | "mainnet"],
  dataAsOf: Number(getMeta(db, "last_backfill_at") ?? 0),
  baseRate: baseRate(db),
  coverage: cov.overall,
  bySeries: cov.bySeries,
  calibration: { byMarket: cal.byMarket, byTimeToExpiry: cal.byTimeToExpiry, brierSkill: cal.brierSkill },
  edge: {
    naive: edge.naive,
    clustered: edge.clustered,
    bootstrap: edge.bootstrap,
    weekly: edge.weekly,
    signFlips: edge.signFlips,
  },
  live: liveEdge(fills),
  concentration: concentration(db),
  makerVsTaker: makerVsTaker(fills),
};

const tpl = readFileSync(join("web", "index.html"), "utf8");
const marker = '<script id="snapshot" type="application/json">null</script>';
if (!tpl.includes(marker)) {
  console.error("web/index.html no longer contains the snapshot marker - cannot bake.");
  process.exit(1);
}

// `</script>` anywhere inside the JSON would close the tag early and break the
// page. It cannot appear in this data, but escaping it costs nothing and means
// a future field carrying arbitrary text can never silently corrupt the output.
const json = JSON.stringify(summary).replace(/<\/script>/gi, "<\\/script>");
const out = tpl.replace(marker, `<script id="snapshot" type="application/json">${json}</script>`);

writeFileSync(join("web", "dashboard.html"), out);
console.log(`wrote web/dashboard.html  (${(out.length / 1024).toFixed(0)} KB, snapshot ${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  ${summary.baseRate.n} resolved markets - live verdict: ${summary.live.verdict.toUpperCase()}`);
db.close();
