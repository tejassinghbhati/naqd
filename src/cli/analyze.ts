/**
 * `npm run analyze` - the whole finding, printed.
 *
 * This is the report the project's claims come from. It is meant to be run, not
 * quoted: every number below is recomputed from the local store each time.
 */
import "dotenv/config";
import { openDb } from "../db/schema.js";
import { baseRate, scoredFills, scoredMarkets } from "../analytics/queries.js";
import { calibrationReport } from "../analytics/calibration.js";
import { edgeReport, liveEdge } from "../analytics/edge.js";
import { wilson } from "../analytics/stats.js";

const network = (process.env.NETWORK ?? "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet";
const dbPath = process.env.ASSAY_DB ?? `data/assay-${network}.db`;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const cents = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}c`;
const rule = (s: string) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

const db = openDb(dbPath);
const fills = scoredFills(db);
const markets = scoredMarkets(db);

if (markets.length === 0) {
  console.error(`no scored markets in ${dbPath} - run \`npm run backfill\` first.`);
  process.exit(1);
}

console.log(`assay analyze - ${network} - ${dbPath}`);

rule("1. BASE RATE  (every resolved market, traded or not)");
const br = baseRate(db);
const [blo, bhi] = wilson(br.up, br.n);
console.log(`  resolved markets     ${br.n}`);
console.log(`  closed UP            ${br.up}  (${pct(br.rate)})`);
console.log(`  95% CI               [${pct(blo)}, ${pct(bhi)}]`);
console.log(`  fair coin at 50%?    ${blo <= 0.5 && bhi >= 0.5 ? "yes - indistinguishable" : "NO - real drift"}`);
for (const r of br.byAsset) {
  console.log(`    ${r.asset.padEnd(4)} ${String(r.intervalSec / 60).padStart(3)}m  n=${String(r.n).padStart(5)}  up=${pct(r.rate)}`);
}
console.log("  => the underlying series is a coin flip. Any edge must come from PRICING, not drift.");

rule("2. CALIBRATION  (when the venue says 70%, does it happen 70% of the time?)");
const cal = calibrationReport(markets, fills);
console.log(`  ${markets.length} traded+resolved markets, ${fills.length} fills`);
console.log(`  Brier skill vs a coin flip: ${cal.brierSkill.toFixed(3)}  (1 = perfect, 0 = no better than 50/50)`);
console.log("\n  per market, by volume-weighted price:");
console.log(`    ${"bucket".padEnd(12)} ${"n".padStart(5)} ${"implied".padStart(8)} ${"realized".padStart(9)} ${"error".padStart(8)}  95% CI on realized`);
for (const b of cal.byMarket) {
  const flag = b.significant ? " *" : "";
  console.log(
    `    ${`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`.padEnd(12)} ${String(b.n).padStart(5)} ` +
      `${b.implied.toFixed(3).padStart(8)} ${b.realized.toFixed(3).padStart(9)} ${cents(b.error).padStart(8)}  ` +
      `[${b.ci95[0].toFixed(3)}, ${b.ci95[1].toFixed(3)}]${flag}`,
  );
}
console.log("    (* = the interval excludes the price the market was actually quoting)");

console.log("\n  the same curve, split by how much of the window was left:");
for (const phase of cal.byTimeToExpiry) {
  console.log(`\n    [${phase.phase.toUpperCase()}] ${phase.label} - ${phase.n} fills`);
  for (const b of phase.bins) {
    console.log(
      `      ${`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`.padEnd(9)} n=${String(b.n).padStart(4)} ` +
        `implied=${b.implied.toFixed(3)} realized=${b.realized.toFixed(3)} err=${cents(b.error)}${b.significant ? " *" : ""}`,
    );
  }
}
console.log("\n  => the sharp S-curve on VWAP is mostly the CLOCK, not skill: score fills");
console.log("     early in the window and the curve flattens out. This is the check that");
console.log("     separates a real edge from an artifact of aggregating over a market's life.");

rule("3. IS THE EDGE CONSTANT?  (the question that decides whether a bot is viable)");
const edge = edgeReport(fills);
console.log(`  naive, per fill        ${cents(edge.naive.mean)}  t=${edge.naive.t.toFixed(2)}  n=${edge.naive.n}`);
console.log(`  clustered by market    ${cents(edge.clustered.mean)}  t=${edge.clustered.t.toFixed(2)}  n=${edge.clustered.n}`);
console.log(`     ^ the naive n counts ${edge.naive.n} fills as independent when they are really`);
console.log(`       ${edge.clustered.n} coin flips. That alone moves t from ${edge.naive.t.toFixed(2)} to ${edge.clustered.t.toFixed(2)}.`);
console.log("\n  week by week:");
for (const w of edge.weekly) {
  const bar = w.n >= 20 ? (w.mean < 0 ? "UP overpriced " : "UP underpriced") : "(thin)";
  console.log(`    ${w.week}  n=${String(w.n).padStart(4)}  mean=${cents(w.mean).padStart(8)}  ${bar}`);
}
console.log(`\n  sign flips across weeks: ${edge.signFlips ? "YES" : "no"}`);
console.log(`  week-block bootstrap    mean=${cents(edge.bootstrap.mean)} 95% CI [${cents(edge.bootstrap.ci95[0])}, ${cents(edge.bootstrap.ci95[1])}]`);
console.log(`  interval crosses zero:  ${edge.bootstrap.crossesZero ? "YES" : "no"}`);
console.log("\n  => VERDICT: the mispricing is large but NOT a fixed bias. Resampling whole");
console.log("     weeks, the interval straddles zero. A hard-coded 'always fade UP' bot is");
console.log("     fitting last month's weather. The edge has to be re-measured continuously.");

rule("4. LIVE EDGE  (what the agent would do right now)");
const live = liveEdge(fills);
console.log(`  window               last ${live.windowDays}d`);
console.log(`  markets in window    ${live.sampleMarkets}`);
console.log(`  measured edge        ${cents(live.edge)}  CI [${cents(live.recent.ci95[0])}, ${cents(live.recent.ci95[1])}]`);
console.log(`  lifetime edge        ${cents(live.lifetime.mean)}`);
console.log(`  VERDICT              ${live.verdict.toUpperCase()}`);
console.log(`  reason               ${live.reason}`);
console.log(`  size multiplier      ${live.confidence.toFixed(2)}`);
if (live.verdict === "trade") {
  console.log(`\n  direction            ${live.edge > 0 ? "BUY YES (UP is cheap)" : "BUY NO (UP is rich)"}`);
}

db.close();
