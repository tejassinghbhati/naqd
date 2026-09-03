/**
 * The hero.
 *
 * The reference this is modelled on uses a stock 3D render for its atmosphere.
 * We have something better available and unfakeable: the measurement itself.
 * `CalibrationField` draws the venue's real calibration scatter at hero scale -
 * the diagonal of perfect pricing, the band of uncertainty around it, and every
 * price bucket as a glowing node sitting off that line by exactly as much as it
 * actually missed by.
 *
 * So the backdrop is not decoration standing in for substance. It is the
 * finding, rendered as light. A competitor cannot copy it without doing the
 * measurement first.
 *
 * Server component: it is pure SVG over data the server already has, so it
 * arrives in the HTML rather than appearing a beat after hydration.
 */

import type { CalibrationBin } from "@/lib/assay";

/**
 * The calibration curve as an atmospheric field.
 *
 * Deliberately not readable as a chart - there are no axes or labels, and it is
 * clipped and faded at the edges. It reads as light with structure. The real,
 * legible version of the same data lives on the research page; this is its
 * shadow on the wall.
 */
export function CalibrationField({ bins }: { bins: CalibrationBin[] }) {
  const W = 1200;
  const H = 760;
  const pad = 90;
  const x = (v: number) => pad + v * (W - pad * 2);
  const y = (v: number) => H - pad - v * (H - pad * 2);

  const pts = bins.filter((b) => b.n >= 10);
  // Drawn wider than tall: at hero proportions a square plot leaves the curve
  // bunched in the middle of a very wide box.

  return (
    <svg
      className="hero-field"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--lf-4)" stopOpacity="0.9" />
          <stop offset="45%" stopColor="var(--lf-3)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--lf-3)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="diag" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--lf-3)" stopOpacity="0.05" />
          <stop offset="50%" stopColor="var(--lf-4)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--lf-3)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="curve" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--lf-3)" stopOpacity="0" />
          <stop offset="18%" stopColor="var(--lf-4)" stopOpacity="0.75" />
          <stop offset="82%" stopColor="var(--lf-4)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--lf-3)" stopOpacity="0" />
        </linearGradient>
        {/* Fades the whole field into the ground at every edge, so it reads as
            light in the room rather than as a panel with borders. */}
        <radialGradient id="vignette" cx="50%" cy="45%" r="62%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="62%" stopColor="#fff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="fade">
          <rect width={W} height={H} fill="url(#vignette)" />
        </mask>
      </defs>

      <g mask="url(#fade)">
        {/* A faint measurement grid. */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v} stroke="var(--lf-3)" strokeOpacity="0.14" strokeWidth="1">
            <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} />
            <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(1)} />
          </g>
        ))}

        {/* Perfect calibration. Everything on this line is honestly priced. */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="url(#diag)"
          strokeWidth="1.5"
          strokeDasharray="6 7"
        />

        {pts.length > 1 && (
          <>
            {/* The band between what was charged and what happened. */}
            <path
              d={[
                `M ${x(pts[0]!.implied)} ${y(pts[0]!.implied)}`,
                ...pts.map((b) => `L ${x(b.implied)} ${y(b.implied)}`),
                ...[...pts].reverse().map((b) => `L ${x(b.implied)} ${y(b.realized)}`),
                "Z",
              ].join(" ")}
              fill="var(--lf-3)"
              fillOpacity="0.2"
            />
            <polyline
              points={pts.map((b) => `${x(b.implied)},${y(b.realized)}`).join(" ")}
              fill="none"
              stroke="url(#curve)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {pts.map((b) => (
          <g key={`${b.lo}-${b.hi}`}>
            <circle cx={x(b.implied)} cy={y(b.realized)} r={58} fill="url(#node-glow)" opacity={0.75} />
            <circle cx={x(b.implied)} cy={y(b.realized)} r={3.5} fill="var(--lf-4)" opacity={1} />
          </g>
        ))}
      </g>
    </svg>
  );
}
