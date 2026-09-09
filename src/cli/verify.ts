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
import { makerVsTaker, makerEdgeReport } from "../analytics/traders.js";
import { coverage, concentration } from "../analytics/liquidity.js";
import { wilson } from "../analytics/stats.js";

const db = openDb(process.env.NAQD_DB ?? "data/naqd-mainnet.db");
const fills = scoredFills(db);
const markets = scoredMarkets(db);
const br = baseRate(db);
const cal = calibrationReport(markets, fills);
const e = edgeReport(fills);
const cov = coverage(db);
const cc = concentration(db);
const mv = makerVsTaker(fills);
const me = makerEdgeReport(fills);
const c = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}c`;
const tot = db.prepare("SELECT COUNT(*) n FROM markets").get() as { n: number };

const pc = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(2)}%`;

const rows: [string, string, string][] = [
  ["markets total", String(tot.n), "13,910"],
  ["resolved", String(br.n), "13,883"],
  ["base rate", `${(br.rate * 100).toFixed(2)}%`, "50.16%"],
  ["base rate CI", wilson(br.up, br.n).map((x) => `${(x * 100).toFixed(2)}%`).join("-"), "49.33%-50.99%"],
  ["traded markets", String(markets.length), "2,451"],
  ["fills", String(fills.length), "5,060"],
  ["brier skill", cal.brierSkill.toFixed(3), "0.551"],
  ["naive", `${c(e.naive.mean)} [${e.naive.ci95.map(c).join(", ")}] t=${e.naive.t.toFixed(2)}`, "-2.76c [-3.81c, -1.71c] t=-5.17"],
  ["clustered", `${c(e.clustered.mean)} [${e.clustered.ci95.map(c).join(", ")}] t=${e.clustered.t.toFixed(2)}`, "-1.22c [-2.54c, +0.11c] t=-1.79"],
  ["bootstrap", `${c(e.bootstrap.mean)} [${e.bootstrap.ci95.map(c).join(", ")}] crossesZero=${e.bootstrap.crossesZero}`, "-1.22c [-3.98c, +0.67c] true"],
  ["weekly means", e.weekly.filter((w) => w.n >= 20).map((w) => c(w.mean)).join(" "), "-0.46c +0.81c -6.64c -4.00c +0.19c +1.57c"],
  ["coverage", `${(cov.overall.coverage * 100).toFixed(1)}%`, "17.7%"],
  // Finding 6. The pooled row is quoted in the README only as the estimate that
  // flipped; the two below it are the ones the text actually rests on.
  ["maker/taker pooled", `${pc(mv.maker.roi)} / ${pc(mv.taker.roi)}`, "-2.75% / +3.01%"],
  ["maker clustered", `${c(me.clustered.mean)} [${me.clustered.ci95.map(c).join(", ")}] t=${me.clustered.t.toFixed(2)}`, "-1.83c [-2.90c, -0.76c] t=-3.34"],
  ["maker bootstrap", `${c(me.bootstrap.mean)} [${me.bootstrap.ci95.map(c).join(", ")}] crossesZero=${me.bootstrap.crossesZero}`, "-1.83c [-3.09c, +0.45c] true"],
  ["maker weekly ROI", me.weekly.filter((w) => w.n >= 20).map((w) => pc(w.roi)).join(" "), "+0.15% +4.96% -8.56% +6.82% -4.16% -9.40%"],
  ["takers/top/HHI", `${cc.distinctTakers} ${(cc.topTakerShare * 100).toFixed(0)}% ${cc.takerHHI.toFixed(3)}`, "144 17% 0.076"],
];

console.log(`${"metric".padEnd(19)}${"computed".padEnd(46)}README`);
console.log("-".repeat(100));
for (const [k, got, want] of rows) console.log(`${k.padEnd(19)}${got.padEnd(46)}${want}`);
db.close();
