/**
 * `npm run charts` - regenerate the three figures the README embeds.
 *
 * These used to be produced by hand outside the repo, which meant they drifted
 * silently: the store grew, every number in the tables moved, and the pictures
 * beside them still described an older snapshot. A figure that cannot be
 * rebuilt from the current store is a claim nobody can check, so this makes
 * them a command like every other number here.
 *
 * Each chart is emitted as standalone SVG and then rasterised through headless
 * Chrome, because GitHub's markdown pipeline is unreliable with SVG. Both
 * artefacts are written: the SVG is the source, the PNG is what the README
 * points at.
 */

import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { openDb } from "../db/schema.js";
import { scoredFills, scoredMarkets } from "../analytics/queries.js";
import { calibrationReport, type CalibrationBin } from "../analytics/calibration.js";
import { edgeReport } from "../analytics/edge.js";

/* The site's own data poles, held against the dark ground the figures use.
   Orange is "realized below implied", blue is "realized above". Grey is
   reserved for the estimate that does not clear zero - it must never read as
   one of the two poles, because it is not a direction. */
const C = {
  bg: "#16191c",
  grid: "#333b41",
  axis: "#98a2a8",
  dim: "#8a949a",
  low: "#d4764f",
  high: "#4a9ed8",
  none: "#7f8d88",
  rule: "#5b656b",
};
const MONO = "'JetBrains Mono','SF Mono',ui-monospace,Menlo,Consolas,monospace";
const SANS = "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;

function caption(lines: string[], x: number, y: number): string {
  return lines
    .map((l, i) => `<text x="${x}" y="${y + i * 26}" font-family="${SANS}" font-size="19" fill="${C.dim}">${esc(l)}</text>`)
    .join("");
}

function frame(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${C.bg}"/>${body}</svg>`;
}

/* ------------------------------------------------------------- calibration */
function calibrationSvg(bins: CalibrationBin[]): string {
  const W = 1034, H = 856;
  const L = 92, R = 24, T = 28, B = 168;
  const pw = W - L - R, ph = H - T - B;
  const X = (p: number) => L + p * pw;
  const Y = (p: number) => T + (1 - p) * ph;

  let s = "";
  for (let i = 0; i <= 5; i++) {
    const v = i / 5;
    s += `<line x1="${L}" y1="${Y(v)}" x2="${L + pw}" y2="${Y(v)}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 14}" y="${Y(v) + 7}" text-anchor="end" font-family="${MONO}" font-size="21" fill="${C.axis}">${v.toFixed(1)}</text>`;
    s += `<text x="${X(v)}" y="${T + ph + 38}" text-anchor="middle" font-family="${MONO}" font-size="21" fill="${C.axis}">${v.toFixed(1)}</text>`;
  }
  // The diagonal of perfect pricing.
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="${C.rule}" stroke-width="2" stroke-dasharray="8 8"/>`;

  const pts = bins.filter((b) => b.n > 0);
  s += `<polyline fill="none" stroke="${C.rule}" stroke-width="2" points="${pts.map((b) => `${X(b.implied)},${Y(b.realized)}`).join(" ")}"/>`;
  for (const b of pts) {
    const col = b.realized < b.implied ? C.low : C.high;
    s += `<line x1="${X(b.implied)}" y1="${Y(b.ci95[0])}" x2="${X(b.implied)}" y2="${Y(b.ci95[1])}" stroke="${col}" stroke-width="4"/>`;
    s += `<circle cx="${X(b.implied)}" cy="${Y(b.realized)}" r="11" fill="${col}"/>`;
  }

  s += `<text x="${L + pw / 2}" y="${T + ph + 84}" text-anchor="middle" font-family="${MONO}" font-size="23" fill="${C.axis}">implied probability (what the venue charged)</text>`;
  s += `<text transform="translate(30,${T + ph / 2}) rotate(-90)" text-anchor="middle" font-family="${MONO}" font-size="23" fill="${C.axis}">realized frequency</text>`;

  const ly = H - 78;
  s += `<rect x="${L}" y="${ly - 13}" width="16" height="16" fill="${C.low}"/><text x="${L + 26}" y="${ly}" font-family="${MONO}" font-size="19" fill="${C.axis}">realized below implied</text>`;
  s += `<rect x="${L + 300}" y="${ly - 13}" width="16" height="16" fill="${C.high}"/><text x="${L + 326}" y="${ly}" font-family="${MONO}" font-size="19" fill="${C.axis}">realized above implied</text>`;
  s += caption(
    ["One point per price bucket, using each market's volume-weighted price. Vertical bars are", "95% Wilson intervals on the realized rate."],
    L,
    H - 40,
  );
  return frame(W, H, s);
}

/* ------------------------------------------------------------- forest plot */
interface ForestRow {
  label: string;
  sub: string;
  mean: number;
  ci: [number, number];
  clears: boolean;
}

function forestSvg(rows: ForestRow[]): string {
  const W = 1034, H = 560;
  const L = 300, R = 40, T = 74, B = 150;
  const pw = W - L - R;
  const span = Math.max(...rows.flatMap((r) => [Math.abs(r.ci[0]), Math.abs(r.ci[1])])) * 1.25 || 0.06;
  const X = (v: number) => L + ((v + span) / (2 * span)) * pw;
  const rowY = (i: number) => T + 46 + i * ((H - T - B) / rows.length);

  let s = "";
  for (let i = -2; i <= 2; i++) {
    const v = (i / 2) * span;
    s += `<line x1="${X(v)}" y1="${T}" x2="${X(v)}" y2="${H - B + 16}" stroke="${i === 0 ? C.rule : C.grid}" stroke-width="1"/>`;
    s += `<text x="${X(v)}" y="${H - B + 52}" text-anchor="middle" font-family="${MONO}" font-size="21" fill="${C.axis}">${cents(v)}</text>`;
  }
  s += `<text x="${X(0)}" y="${T - 22}" text-anchor="middle" font-family="${MONO}" font-size="23" fill="${C.axis}">no edge</text>`;

  rows.forEach((r, i) => {
    const y = rowY(i);
    const col = r.clears ? C.low : C.none;
    s += `<line x1="${X(r.ci[0])}" y1="${y}" x2="${X(r.ci[1])}" y2="${y}" stroke="${col}" stroke-width="5"/>`;
    for (const e of r.ci) s += `<line x1="${X(e)}" y1="${y - 15}" x2="${X(e)}" y2="${y + 15}" stroke="${col}" stroke-width="5"/>`;
    s += `<circle cx="${X(r.mean)}" cy="${y}" r="12" fill="${col}"/>`;
    s += `<text x="24" y="${y - 22}" font-family="${MONO}" font-size="24" font-weight="700" fill="${C.axis}">${esc(r.label)}</text>`;
    s += `<text x="24" y="${y + 12}" font-family="${MONO}" font-size="22" fill="${C.dim}">${esc(r.sub)}</text>`;
    s += `<text x="24" y="${y + 46}" font-family="${MONO}" font-size="22" fill="${C.dim}">${r.clears ? "clears zero" : "touches zero - inconclusive"}</text>`;
  });

  s += caption(
    ["The point estimate barely moves. The interval is what changes, and the interval is what", "decides whether there is anything to trade."],
    24,
    H - 46,
  );
  return frame(W, H, s);
}

/* ------------------------------------------------------------ weekly bars */
function weeklySvg(weeks: { week: string; n: number; mean: number }[]): string {
  const W = 1034, H = 680;
  const L = 128, R = 32, T = 40, B = 210;
  const pw = W - L - R, ph = H - T - B;
  const span = Math.max(...weeks.map((w) => Math.abs(w.mean))) * 1.3 || 0.05;
  const Y = (v: number) => T + (1 - (v + span) / (2 * span)) * ph;
  const bw = Math.min(112, (pw / Math.max(weeks.length, 1)) * 0.52);

  let s = "";
  for (let i = -2; i <= 2; i++) {
    const v = (i / 2) * span;
    s += `<line x1="${L}" y1="${Y(v)}" x2="${L + pw}" y2="${Y(v)}" stroke="${i === 0 ? C.rule : C.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 16}" y="${Y(v) + 8}" text-anchor="end" font-family="${MONO}" font-size="22" fill="${C.axis}">${cents(v)}</text>`;
  }

  weeks.forEach((w, i) => {
    const cx = L + (pw / weeks.length) * (i + 0.5);
    const col = w.mean < 0 ? C.low : C.high;
    const y0 = Y(0), y1 = Y(w.mean);
    s += `<rect x="${cx - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(Math.abs(y1 - y0), 4)}" rx="6" fill="${col}"/>`;
    s += `<text x="${cx}" y="${T + ph + 52}" text-anchor="middle" font-family="${MONO}" font-size="24" fill="${C.axis}">${esc(w.week.replace(/^\d{4}-/, ""))}</text>`;
    s += `<text x="${cx}" y="${T + ph + 90}" text-anchor="middle" font-family="${MONO}" font-size="22" fill="${C.dim}">n=${w.n}</text>`;
  });

  const ly = H - 96;
  s += `<rect x="${24}" y="${ly - 13}" width="16" height="16" fill="${C.low}"/><text x="${50}" y="${ly}" font-family="${MONO}" font-size="19" fill="${C.axis}">UP overpriced that week</text>`;
  s += `<rect x="${390}" y="${ly - 13}" width="16" height="16" fill="${C.high}"/><text x="${416}" y="${ly}" font-family="${MONO}" font-size="19" fill="${C.axis}">UP underpriced that week</text>`;
  s += caption(
    ["Whole weeks run rich, then cheap. Errors are correlated in time as well as within markets,", "so resampling individual markets still understates the uncertainty. The bootstrap", "resamples entire weeks."],
    24,
    H - 62,
  );
  return frame(W, H, s);
}

/* -------------------------------------------------------------------- main */
const db = openDb(process.env.NAQD_DB ?? "data/naqd-mainnet.db");
const fills = scoredFills(db);
const markets = scoredMarkets(db);
const cal = calibrationReport(markets, fills);
const e = edgeReport(fills);
db.close();

const forestRows: ForestRow[] = [
  {
    label: "Per fill",
    sub: `n = ${e.naive.n.toLocaleString("en-US")} fills`,
    mean: e.naive.mean,
    ci: e.naive.ci95,
    clears: !(e.naive.ci95[0] <= 0 && e.naive.ci95[1] >= 0),
  },
  {
    label: "Clustered by market",
    sub: `n = ${e.clustered.n.toLocaleString("en-US")} markets`,
    mean: e.clustered.mean,
    ci: e.clustered.ci95,
    clears: !(e.clustered.ci95[0] <= 0 && e.clustered.ci95[1] >= 0),
  },
  {
    label: "Week-block bootstrap",
    sub: `${e.bootstrap.blocks} weekly blocks`,
    mean: e.bootstrap.mean,
    ci: e.bootstrap.ci95,
    clears: !e.bootstrap.crossesZero,
  },
];

const FIGS: { file: string; svg: string; w: number; h: number }[] = [
  { file: "calibration", svg: calibrationSvg(cal.byMarket), w: 1034, h: 856 },
  { file: "forest-plot", svg: forestSvg(forestRows), w: 1034, h: 560 },
  { file: "weekly-edge", svg: weeklySvg(e.weekly.filter((w) => w.n >= 20)), w: 1034, h: 680 },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
for (const f of FIGS) {
  writeFileSync(`docs/${f.file}.svg`, f.svg);
  await page.setContent(
    `<body style="margin:0;background:${C.bg}">${f.svg}</body>`,
    { waitUntil: "load" },
  );
  // Give webfont fallback resolution a beat so text metrics settle.
  await page.waitForTimeout(300);
  await page.locator("svg").screenshot({ path: `docs/${f.file}.png` });
  console.log(`docs/${f.file}.png  ${f.w * 2}x${f.h * 2}`);
}
await browser.close();
