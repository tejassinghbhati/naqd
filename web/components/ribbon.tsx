/**
 * The hero ribbon.
 *
 * The reference this is modelled on floats a rendered 3D form under its
 * headline. We cannot ship a render, but we do have something a render does
 * not: the shape can mean something. This ribbon is swept along the venue's
 * actual calibration curve, so the bend in it is the bend in the measurement -
 * where the surface rises, markets resolved above what they were priced at;
 * where it falls away, below.
 *
 * It is built as real geometry rather than as a filled path, because the thing
 * that makes a band read as a solid object is the twist: the dark underside has
 * to appear along the top edge on one side of an inflection and along the
 * bottom edge on the other. No 2D offset can do that. So:
 *
 *   1. a centreline is laid out in 3D - x sweeps, y carries the measurement,
 *      z bulges toward the viewer through the middle
 *   2. a width vector is rotated about the tangent as it travels, which is the
 *      twist
 *   3. every segment becomes three quads (surface, near edge, far edge), each
 *      shaded by Lambert against a fixed light
 *   4. all of them are sorted back-to-front and painted in that order, so the
 *      band occludes itself correctly where it folds over
 *
 * Shading is quantised to twelve steps held as CSS tokens rather than computed
 * as hex, which keeps the object theme-aware and, as a side effect, makes it
 * read as faceted panels rather than as an airbrushed gradient.
 */

import type { CalibrationBin } from "@/lib/assay";

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Camera. A long lens: enough perspective to taper the band, not enough to bow it. */
const CAM_Z = 4.6;
const FOCAL = 3.05;
const LIGHT = norm([-0.52, 0.7, 0.49]);

/** Quantised shading steps. Index 0 is the brightest facet, 11 the darkest. */
const STEPS = 12;

interface Quad {
  pts: [number, number][];
  /** Depth of the centroid. Smaller is further away, so painted earlier. */
  z: number;
  shade: number;
  edge: boolean;
}

export function Ribbon({ bins }: { bins: CalibrationBin[] }) {
  const usable = bins.filter((b) => b.n >= 10);

  // The measured deviation from fair pricing along the sweep. Without a
  // measurement the ribbon still draws, on a default S-curve, so the page never
  // renders a hole.
  const source =
    usable.length >= 3
      ? usable.map((b) => ({ t: b.implied, d: b.realized - b.implied }))
      : [
          { t: 0.05, d: 0.05 },
          { t: 0.3, d: -0.05 },
          { t: 0.7, d: 0.06 },
          { t: 0.95, d: -0.02 },
        ];

  // Smooth the bins before sweeping. Bin-to-bin noise is real measurement, but
  // at this size it reads as a zigzag rather than as a curve, and the honest
  // version with error bars is on the research page.
  const sm = source.map((_, i) => {
    const w = source.slice(Math.max(0, i - 1), i + 2);
    return { t: source[i]!.t, d: w.reduce((a, b) => a + b.d, 0) / w.length };
  });

  const t0 = sm[0]!.t;
  const t1 = sm[sm.length - 1]!.t;
  // Normalise the deviation to a fixed amplitude. The composition then holds
  // whatever the next data refresh does to the numbers: the shape stays true,
  // only its scale is fixed.
  const peak = Math.max(...sm.map((b) => Math.abs(b.d))) || 1;

  const devAt = (u: number) => {
    const x = t0 + (t1 - t0) * u;
    let j = 0;
    while (j < sm.length - 2 && sm[j + 1]!.t < x) j++;
    const p1 = sm[j]!;
    const p2 = sm[j + 1]!;
    const p0 = sm[j - 1] ?? p1;
    const p3 = sm[j + 2] ?? p2;
    const k = p2.t === p1.t ? 0 : Math.max(0, Math.min(1, (x - p1.t) / (p2.t - p1.t)));
    // Catmull-Rom. It passes exactly through every measured bin - these are
    // data, not decoration - while staying C1 continuous, which matters here
    // because the facet normals are derived from this curve and a kink in it
    // shows up as a visible dent in the surface.
    const k2 = k * k;
    const k3 = k2 * k;
    const d =
      0.5 *
      (2 * p1.d +
        (-p0.d + p2.d) * k +
        (2 * p0.d - 5 * p1.d + 4 * p2.d - p3.d) * k2 +
        (-p0.d + 3 * p1.d - 3 * p2.d + p3.d) * k3);
    return d / peak;
  };

  // ---------------------------------------------------------------- geometry

  const N = 150;
  const SPAN = 2.9; // world length of the sweep
  const RAKE = 0.1; // a slight climb, so the sweep is not symmetric
  const BULGE = 0.34; // how far the middle leans toward the viewer
  const HALF = 0.135; // half the band's width, in world units
  const THICK = 0.024;
  /** How wide the finished object is relative to its height. */
  const ASPECT = 2.85;

  const project = (p: V3): [number, number] => {
    const k = FOCAL / (CAM_Z - p[2]);
    return [p[0] * k, -p[1] * k];
  };

  // The twist. This is the whole trick: a band that rotates about its own
  // tangent as it travels shows its underside along opposite edges either side
  // of the fold, which is what a flat extrusion can never fake.
  const twist = (u: number) => -0.62 + 2.15 * u;

  const build = (dev: number) => {
    const centre = (u: number): V3 => [
      (u - 0.5) * SPAN,
      devAt(u) * dev + (u - 0.5) * RAKE,
      BULGE * Math.sin(Math.PI * u) - 0.1,
    ];
    return Array.from({ length: N + 1 }, (_, i) => {
      const u = i / N;
      const c = centre(u);
      const eps = 1 / (N * 2);
      const tangent = norm(sub(centre(Math.min(1, u + eps)), centre(Math.max(0, u - eps))));
      // A stable frame along the tangent, then rotated by the twist angle.
      const side0 = norm(cross(tangent, [0, 0, 1]));
      const up0 = norm(cross(side0, tangent));
      const a = twist(u);
      const w = add(mul(side0, Math.cos(a)), mul(up0, Math.sin(a)));
      const n = add(mul(side0, -Math.sin(a)), mul(up0, Math.cos(a)));
      return { c, hi: add(c, mul(w, HALF)), lo: sub(c, mul(w, HALF)), w, n, u };
    });
  };

  // Solve for the bend amplitude that lands the finished object on a fixed
  // aspect ratio, instead of hard-coding one that happens to suit today's
  // numbers. The measured shape is preserved; only its vertical scale is set
  // by the layout, which is the same exaggeration any sculptural chart makes -
  // and the version with axes and error bars is on the research page.
  let lo = 0.02;
  let hi = 1.6;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    const pts = build(mid).flatMap((st) => [project(st.hi), project(st.lo)]);
    const w = Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]));
    const h = Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]));
    if (w / h > ASPECT) lo = mid;
    else hi = mid;
  }
  const stations = build((lo + hi) / 2);

  // Lambert, then normalised across the whole sweep before quantising. A
  // physical falloff spends most of its range on facets that all read as
  // "pale"; stretching the observed range across all seven steps is what gives
  // the object its full tonal ramp regardless of how the curve happens to bend.
  const lambert = (n: V3) => {
    const l = dot(n, LIGHT);
    return l > 0 ? l : l * 0.85;
  };
  const lit = stations.map((st) => lambert(st.n));
  const lMin = Math.min(...lit);
  const lMax = Math.max(...lit);
  const shadeOf = (n: V3) => {
    const t = (lambert(n) - lMin) / (lMax - lMin || 1);
    return Math.max(0, Math.min(STEPS - 1, Math.round((1 - t) * (STEPS - 1))));
  };

  const quads: Quad[] = [];
  for (let i = 0; i < N; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    const nAvg = norm(add(a.n, b.n));

    quads.push({
      pts: [project(a.hi), project(b.hi), project(b.lo), project(a.lo)],
      z: (a.hi[2] + b.hi[2] + a.lo[2] + b.lo[2]) / 4,
      shade: shadeOf(nAvg),
      edge: false,
    });

    // The two thickness edges. Only one faces the camera at any point along
    // the sweep, and which one it is changes at the fold - but we never have to
    // decide that, because the depth sort does it for us.
    const off = mul(nAvg, -THICK);
    for (const [p, q] of [
      [a.hi, b.hi],
      [a.lo, b.lo],
    ] as [V3, V3][]) {
      const p2 = add(p, off);
      const q2 = add(q, off);
      quads.push({
        pts: [project(p), project(q), project(q2), project(p2)],
        z: (p[2] + q[2] + p2[2] + q2[2]) / 4,
        shade: STEPS - 1,
        edge: true,
      });
    }
  }

  // Painter's algorithm. Furthest first, so the near half of a fold covers the
  // far half instead of the two being drawn as one flat silhouette.
  quads.sort((p, q) => p.z - q.z);

  // ------------------------------------------------------------ perforation
  // Placed in the band's own parametric grid and then projected, so the holes
  // travel with the twist. A flat pattern fill would slide across the surface
  // and give the whole thing away.
  const holes: { x: number; y: number; r: number }[] = [];
  for (let i = 2; i < N; i += 2) {
    const st = stations[i]!;
    if (dot(st.n, [0, 0, 1]) <= 0.14) continue; // the underside shows no holes
    for (let k = 0; k < 7; k++) {
      const v = -0.74 + (1.48 * k) / 6;
      const p = add(st.c, mul(st.w, HALF * v));
      const [x, y] = project(p);
      holes.push({ x, y, r: 0.0035 * (FOCAL / (CAM_Z - p[2])) });
    }
  }

  // ------------------------------------------------------------------ seams
  // A panel joint every so often. Tiles are what stop a smooth sweep reading as
  // a stroke and start it reading as something manufactured.
  const seams = stations
    .filter((_, i) => i % 10 === 5)
    .filter((st) => dot(st.n, [0, 0, 1]) > 0.14)
    .map((st) => ({ a: project(st.hi), b: project(st.lo) }));

  // --------------------------------------------------------------- view box
  // Crop in from both ends so the ribbon leaves the frame rather than stopping
  // inside it. A sweep that terminates on screen shows its cut cross-section
  // and reads as a shape; one that runs off the edge reads as an object that
  // continues past what you can see.
  const all = quads.flatMap((q) => q.pts);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const fullW = Math.max(...xs) - x0;
  const vx = x0 + fullW * 0.055;
  const vw = fullW * 0.89;
  const vh = vw / ASPECT;
  const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const vy = yMid - vh / 2;

  const d = (pts: [number, number][]) =>
    `M ${pts.map((p) => `${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(" L ")} Z`;

  return (
    <svg
      className="ribbon"
      viewBox={`${vx.toFixed(4)} ${vy.toFixed(4)} ${vw.toFixed(4)} ${vh.toFixed(4)}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {quads.map((q, i) => {
        const c = q.edge ? "var(--rb-edge)" : `var(--rb-s${q.shade})`;
        return (
          // The hairline stroke matches the fill: without it the browser leaves
          // slivers of background between adjacent quads at some zoom levels.
          <path key={i} d={d(q.pts)} fill={c} stroke={c} strokeWidth="0.0016" strokeLinejoin="round" />
        );
      })}

      {seams.map((s, i) => (
        <line
          key={`s${i}`}
          x1={s.a[0]}
          y1={s.a[1]}
          x2={s.b[0]}
          y2={s.b[1]}
          stroke="var(--rb-seam)"
          strokeWidth="0.0028"
        />
      ))}

      {holes.map((h, i) => (
        <circle key={`h${i}`} cx={h.x} cy={h.y} r={h.r} fill="var(--rb-perf)" />
      ))}
    </svg>
  );
}
