/**
 * The four charts that carry the argument.
 *
 * Deliberately server components: they are pure SVG over data the server
 * already has, so they ship inside the HTML rather than being painted after
 * hydration. A research page whose findings appear a beat late is a research
 * page people bounce off.
 *
 * All four use the same convention: the warm pole means "realized below
 * implied" (UP was overpriced) and the cool pole the reverse, with a neutral
 * grey reserved for "this interval touches zero, so it says nothing".
 */

import type { CalibrationBin } from "@/lib/assay";
import type { Estimate, WeeklyEdge, SeriesRow } from "@/lib/stats-server";

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/* ------------------------------------------------------------------ *
 * Calibration curve: implied probability against realized frequency.
 * ------------------------------------------------------------------ */

export function CalibrationCurve({ bins }: { bins: CalibrationBin[] }) {
  const W = 560;
  const H = 420;
  const m = { t: 16, r: 20, b: 44, l: 50 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (v: number) => m.l + v * iw;
  const y = (v: number) => m.t + (1 - v) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Implied probability against realized frequency">
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
        <g key={v}>
          <line className="grid-line" x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} />
          <text className="axis-text" x={m.l - 9} y={y(v) + 3.5} textAnchor="end">
            {v.toFixed(1)}
          </text>
          <text className="axis-text" x={x(v)} y={m.t + ih + 17} textAnchor="middle">
            {v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Perfect calibration. Everything on this line is correctly priced. */}
      <line className="ref-line" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
      <line className="axis-line" x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} />
      <line className="axis-line" x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} />

      <text className="axis-text" x={m.l + iw / 2} y={H - 8} textAnchor="middle">
        implied probability (what the venue charged)
      </text>
      <text className="axis-text" x={-(m.t + ih / 2)} y={14} transform="rotate(-90)" textAnchor="middle">
        realized frequency
      </text>

      <polyline
        points={bins.map((b) => `${x(b.implied)},${y(b.realized)}`).join(" ")}
        fill="none"
        stroke="var(--ink-4)"
        strokeWidth={1.5}
        strokeOpacity={0.55}
      />

      {bins.map((b) => {
        const color = b.error < 0 ? "var(--down)" : "var(--up)";
        return (
          <g key={`${b.lo}-${b.hi}`}>
            {/* Wilson interval. The uncertainty is the point of the chart. */}
            <line
              x1={x(b.implied)}
              x2={x(b.implied)}
              y1={y(b.ci95[0])}
              y2={y(b.ci95[1])}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.45}
              strokeLinecap="round"
            />
            <circle cx={x(b.implied)} cy={y(b.realized)} r={5.5} fill={color} stroke="var(--panel)" strokeWidth={2}>
              <title>
                {`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}: ${b.n} markets, implied ${b.implied.toFixed(3)}, realized ${b.realized.toFixed(3)}, error ${cents(b.error)}`}
              </title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Forest plot: three estimates of one quantity, against zero.
 * ------------------------------------------------------------------ */

export interface ForestRow {
  label: string;
  unit: string;
  detail: string;
  mean: number;
  ci: [number, number];
}

export function ForestPlot({ rows }: { rows: ForestRow[] }) {
  const W = 620;
  const m = { t: 38, r: 26, b: 44, l: 186 };
  const rowH = 66;
  const H = m.t + rows.length * rowH + m.b;
  const lim = Math.max(...rows.flatMap((r) => [Math.abs(r.ci[0]), Math.abs(r.ci[1])])) * 1.2;
  const iw = W - m.l - m.r;
  const x = (v: number) => m.l + ((v + lim) / (2 * lim)) * iw;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Three estimates of the mean pricing error with confidence intervals">
      {[0, 1, 2, 3, 4].map((i) => {
        const v = -lim + (i / 4) * 2 * lim;
        return (
          <g key={i}>
            <line className="grid-line" x1={x(v)} x2={x(v)} y1={m.t - 12} y2={m.t + rows.length * rowH} />
            <text className="axis-text" x={x(v)} y={m.t + rows.length * rowH + 18} textAnchor="middle">
              {cents(v)}
            </text>
          </g>
        );
      })}

      {/* Zero is the decision boundary the agent obeys. */}
      <line className="axis-line" x1={x(0)} x2={x(0)} y1={m.t - 18} y2={m.t + rows.length * rowH} strokeWidth={1.5} />
      <text className="axis-text" x={x(0)} y={m.t - 24} textAnchor="middle" fontWeight={600}>
        no edge
      </text>

      {rows.map((r, i) => {
        const yy = m.t + i * rowH + rowH / 2 - 6;
        const crosses = r.ci[0] <= 0 && r.ci[1] >= 0;
        const color = crosses ? "var(--ink-4)" : r.mean < 0 ? "var(--down)" : "var(--up)";
        return (
          <g key={r.label}>
            <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={yy} y2={yy} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
            {r.ci.map((b, j) => (
              <line key={j} x1={x(b)} x2={x(b)} y1={yy - 6} y2={yy + 6} stroke={color} strokeWidth={2} />
            ))}
            <circle cx={x(r.mean)} cy={yy} r={6} fill={color} stroke="var(--panel)" strokeWidth={2} />
            <text className="axis-text" x={10} y={yy - 9} fontWeight={600} fill="var(--ink)">
              {r.label}
            </text>
            <text className="axis-text" x={10} y={yy + 6}>
              {r.unit}
            </text>
            <text className="axis-text" x={10} y={yy + 21} fill={crosses ? "var(--warn)" : "var(--ink-3)"}>
              {crosses ? "touches zero - inconclusive" : "clears zero"}
            </text>
            <title>{r.detail}</title>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Weekly pricing error, diverging around a zero baseline.
 * ------------------------------------------------------------------ */

export function WeeklyBars({ weeks }: { weeks: WeeklyEdge[] }) {
  const W = Math.max(460, weeks.length * 96);
  const H = 260;
  const m = { t: 26, r: 16, b: 46, l: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(...weeks.map((w) => Math.abs(w.mean))) * 1.18 || 0.05;
  const y = (v: number) => m.t + ih / 2 - (v / max) * (ih / 2);
  const bw = Math.min(54, (iw / Math.max(1, weeks.length)) * 0.56);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean pricing error by week">
      {[-max, -max / 2, 0, max / 2, max].map((v, i) => (
        <g key={i}>
          <line className="grid-line" x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} />
          <text className="axis-text" x={m.l - 9} y={y(v) + 3.5} textAnchor="end">
            {cents(v)}
          </text>
        </g>
      ))}
      <line className="axis-line" x1={m.l} x2={m.l + iw} y1={y(0)} y2={y(0)} strokeWidth={1.5} />

      {weeks.map((w, i) => {
        const cx = m.l + (i + 0.5) * (iw / weeks.length);
        const color = w.mean < 0 ? "var(--down)" : "var(--up)";
        const h = Math.max(2, Math.abs(y(w.mean) - y(0)));
        return (
          <g key={w.week}>
            <rect x={cx - bw / 2} y={w.mean < 0 ? y(0) : y(w.mean)} width={bw} height={h} rx={3} fill={color}>
              <title>{`${w.week}: ${w.n} markets, mean ${cents(w.mean)}`}</title>
            </rect>
            <text className="axis-text" x={cx} y={H - 26} textAnchor="middle">
              {w.week.replace(/^\d{4}-/, "")}
            </text>
            <text className="axis-text" x={cx} y={H - 12} textAnchor="middle" fill="var(--ink-4)">
              n={w.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Coverage: share of markets that ever traded. One measure, one hue.
 * ------------------------------------------------------------------ */

export function CoverageBars({ series }: { series: SeriesRow[] }) {
  const W = 560;
  const rowH = 42;
  const m = { t: 8, r: 62, b: 28, l: 104 };
  const H = m.t + series.length * rowH + m.b;
  const iw = W - m.l - m.r;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of markets with at least one trade, by series">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line className="grid-line" x1={m.l + v * iw} x2={m.l + v * iw} y1={m.t} y2={m.t + series.length * rowH} />
          <text className="axis-text" x={m.l + v * iw} y={H - 9} textAnchor="middle">
            {pct(v, 0)}
          </text>
        </g>
      ))}
      {series.map((s, i) => {
        const yy = m.t + i * rowH + 10;
        return (
          <g key={`${s.asset}-${s.intervalSec}`}>
            <rect x={m.l} y={yy} width={iw} height={17} rx={2} fill="var(--sunk)" />
            <rect x={m.l} y={yy} width={Math.max(2, s.coverage * iw)} height={17} rx={2} fill="var(--accent)">
              <title>{`${s.asset} ${s.intervalSec / 60}m: ${s.traded} of ${s.markets} traded`}</title>
            </rect>
            <text className="axis-text" x={10} y={yy + 13} fill="var(--ink)">
              {s.asset} {s.intervalSec >= 3600 ? `${s.intervalSec / 3600}h` : `${s.intervalSec / 60}m`}
            </text>
            <text className="axis-text" x={m.l + iw + 9} y={yy + 13}>
              {pct(s.coverage)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * The live interval against zero - the whole thesis in one strip.
 * ------------------------------------------------------------------ */

export function EdgeGauge({ estimate, point }: { estimate: Estimate; point: number }) {
  const [lo, hi] = estimate.ci95;
  const crosses = lo <= 0 && hi >= 0;
  const span = Math.max(0.06, Math.abs(lo), Math.abs(hi)) * 1.25;
  const pos = (v: number) => ((v + span) / (2 * span)) * 100;
  const color = crosses ? "var(--warn)" : point < 0 ? "var(--down)" : "var(--up)";
  const wash = crosses ? "var(--warn-a)" : point < 0 ? "var(--down-a)" : "var(--up-a)";

  return (
    <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
      <span className="lbl" style={{ letterSpacing: "0.06em" }}>{cents(lo)}</span>
      <div
        style={{
          position: "relative",
          height: 26,
          flex: "1 1 auto",
          minWidth: 140,
          background: "var(--sunk)",
          border: "1px solid var(--rule)",
          borderRadius: 2,
        }}
        title={`95% CI [${cents(lo)}, ${cents(hi)}], point ${cents(point)}`}
      >
        <span style={{ position: "absolute", top: -3, bottom: -3, width: 1, background: "var(--ink-4)", left: `${pos(0)}%` }} />
        <span
          style={{
            position: "absolute",
            top: 6,
            height: 12,
            borderRadius: 1,
            left: `${pos(lo)}%`,
            width: `${pos(hi) - pos(lo)}%`,
            background: wash,
            border: `1px solid ${color}`,
          }}
        />
        <span style={{ position: "absolute", top: 3, width: 2, height: 18, background: color, left: `${pos(point)}%` }} />
      </div>
      <span className="lbl" style={{ letterSpacing: "0.06em" }}>{cents(hi)}</span>
    </div>
  );
}
