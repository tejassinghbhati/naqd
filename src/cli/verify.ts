/**
 * `npx tsx src/cli/verify.ts` - check every figure quoted in the README against
 * a fresh recomputation from the local store.
 *
 * A README that quotes numbers goes stale silently. This makes staleness a
 * command you can run rather than something a reader has to trust.
 */
import { openDb } from "../db/schema.js";
import { baseRate, scoredFills, scoredMarkets } from "../analytics/queries.js";
import { calibrationReport } from "../analytics/calibration.js";
import { edgeReport } from "../analytics/edge.js";
import { makerVsTaker } from "../analytics/traders.js";
import { coverage, concentration } from "../analytics/liquidity.js";
import { wilson } from "../analytics/stats.js";

const db = openDb(process.env.ASSAY_DB ?? "data/assay-mainnet.db");
const fills = scoredFills(db);
const markets = scoredMarkets(db);
const br = baseRate(db);
const cal = calibrationReport(markets, fills);
const e = edgeReport(fills);
const cov = coverage(db);
const cc = concentration(db);
const mv = makerVsTaker(fills);
const c = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}c`;
const tot = db.prepare("SELECT COUNT(*) n FROM markets").get() as { n: number };

const rows: [string, string, string][] = [
  ["markets total", String(tot.n), "6,906"],
  ["resolved", String(br.n), "6,902"],
  ["base rate", `${(br.rate * 100).toFixed(2)}%`, "50.58%"],
  ["base rate CI", wilson(br.up, br.n).map((x) => `${(x * 100).toFixed(2)}%`).join("-"), "49.40%-51.76%"],
  ["traded markets", String(markets.length), "1,200"],
  ["fills", String(fills.length), "2,683"],
  ["brier skill", cal.brierSkill.toFixed(3), "0.474"],
  ["naive", `${c(e.naive.mean)} [${e.naive.ci95.map(c).join(", ")}] t=${e.naive.t.toFixed(2)}`, "-3.10c [-4.59c, -1.61c] t=-4.08"],
  ["clustered", `${c(e.clustered.mean)} [${e.clustered.ci95.map(c).join(", ")}] t=${e.clustered.t.toFixed(2)}`, "-2.59c [-4.63c, -0.54c] t=-2.48"],
  ["bootstrap", `${c(e.bootstrap.mean)} [${e.bootstrap.ci95.map(c).join(", ")}] crossesZero=${e.bootstrap.crossesZero}`, "-2.59c [-5.06c, +2.12c] true"],
  ["weekly means", e.weekly.filter((w) => w.n >= 20).map((w) => c(w.mean)).join(" "), "-0.46c +0.81c -6.64c -4.00c +18.47c"],
  ["coverage", `${(cov.overall.coverage * 100).toFixed(1)}%`, "17.4%"],
  ["maker/taker ROI", `${(mv.maker.roi * 100).toFixed(2)}% / ${(mv.taker.roi * 100).toFixed(2)}%`, "+1.34% / -2.18%"],
  ["takers/top/HHI", `${cc.distinctTakers} ${(cc.topTakerShare * 100).toFixed(0)}% ${cc.takerHHI.toFixed(3)}`, "129 16% 0.073"],
];

console.log(`${"metric".padEnd(17)}${"computed".padEnd(46)}README`);
console.log("-".repeat(100));
for (const [k, got, want] of rows) console.log(`${k.padEnd(17)}${got.padEnd(46)}${want}`);
db.close();
