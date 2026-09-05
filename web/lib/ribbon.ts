/**
 * The hero ribbon: geometry, material and frame rendering.
 *
 * Kept out of the component so the maths stays testable and the component stays
 * lifecycle. Nothing here touches the DOM except the 2D context it is handed.
 *
 * The shape is swept along the venue's actual calibration curve, so the bend in
 * the object is the bend in the measurement: where the surface rises, markets
 * resolved above what they were priced at; where it falls away, below.
 *
 * It is real geometry rather than a filled path because the thing that makes a
 * band read as solid is the twist - the dark underside has to appear along the
 * top edge on one side of a fold and along the bottom edge on the other, and no
 * 2D offset fakes that. So a centreline is laid out in 3D, a width vector
 * rotates about the tangent as it travels, every segment becomes three quads,
 * and the whole set is depth-sorted and painted back to front.
 *
 * Canvas rather than SVG because it moves. Four hundred and fifty React nodes
 * reconciled at 60fps is not a thing you do; the same quads drawn to a canvas
 * are nearly free, and the painter's algorithm ports across unchanged.
 */

export type V3 = [number, number, number];

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

/** Camera. A long lens: enough perspective to taper the band, not to bow it. */
const CAM_Z = 4.6;
const FOCAL = 3.05;

/** Key light, in view space, so the highlight travels as the object turns. */
const KEY = norm([-0.52, 0.7, 0.49]);
/** A cool bounce from the opposite side. One light reads as a diagram. */
const FILL = norm([0.66, -0.28, 0.42]);
const VIEW: V3 = [0, 0, 1];
/** Blinn half-vector for the key. Precomputed: neither vector moves. */
const HALF = norm(add(KEY, VIEW));

/** Quantised diffuse steps. Index 0 is the brightest facet, 11 the darkest. */
export const STEPS = 12;

/**
 * How wide the finished object is relative to its height.
 *
 * This is a layout number, not a drawing one: it decides how much vertical room
 * the hero has to find. At 2.85 the object was 674px tall on a 1920x1010 screen
 * and a third of it fell below the fold, which meant none of the material work
 * was visible without scrolling.
 */
export const ASPECT = 2.75;

const N = 100;
/** Strips across the band's width. See BOW. */
const M = 13;
/**
 * How far the band curls across its width.
 *
 * A flat band has ONE normal per cross-section, so every lighting term is a
 * function of position along the sweep only, and the result is stripes running
 * lengthwise however good the material is. Rolling the cross-section gives each
 * station a spread of normals, so the reflected horizon lands as a bright line
 * running ALONG the ribbon that slides across its width as the object turns.
 * That travelling line is what reads as polished metal.
 */
const BOW = 0.34;
const SPAN = 2.9; // world length of the sweep
const RAKE = 0.1; // a slight climb, so the sweep is not symmetric
const BULGE = 0.34; // how far the middle leans toward the viewer
const HALF_W = 0.168; // half the band's width, in world units
const THICK = 0.024;

export interface Bin {
  implied: number;
  realized: number;
  n: number;
}

interface Station {
  c: V3;
  w: V3;
  n: V3;
}

/** A point across the band, v in [-1, 1]. The cross-section is a shallow arc. */
const at = (s: Station, v: number): V3 =>
  add(add(s.c, mul(s.w, HALF_W * v)), mul(s.n, HALF_W * BOW * (1 - v * v)));

/**
 * The surface normal at v.
 *
 * The cross-tangent is w - 2*BOW*v*n, and the normal has to be perpendicular to
 * it while staying in the plane spanned by w and n: n + 2*BOW*v*w does that
 * exactly (their dot product cancels).
 */
const normalAt = (s: Station, v: number): V3 => norm(add(s.n, mul(s.w, 2 * BOW * v)));

export interface Geometry {
  stations: Station[];
  /** The resting frame, in projected units. Fixed, so rotation cannot rescale. */
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

export interface Palette {
  /** STEPS diffuse steps, brightest first. */
  steps: string[];
  edge: string;
  seam: string;
  perf: string;
  /** Specular colour. White on light grounds, warmer on dark. */
  spec: string;
}

const project = (p: V3): [number, number] => {
  const k = FOCAL / (CAM_Z - p[2]);
  return [p[0] * k, -p[1] * k];
};

/**
 * Build the world-space geometry once.
 *
 * The bend amplitude is bisected to land the object on a fixed aspect ratio
 * rather than hard-coded to suit today's numbers: the measured shape is
 * preserved, only its vertical scale is set by the layout. That is the same
 * exaggeration any sculptural chart makes, and the version with axes and error
 * bars is on the research page.
 */
export function buildGeometry(bins: Bin[]): Geometry {
  const usable = bins.filter((b) => b.n >= 10);

  // Without a measurement the ribbon still draws, on a default S-curve, so the
  // page never renders a hole.
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
  // at this size it reads as a zigzag rather than as a curve.
  const sm = source.map((_, i) => {
    const w = source.slice(Math.max(0, i - 1), i + 2);
    return { t: source[i]!.t, d: w.reduce((a, b) => a + b.d, 0) / w.length };
  });

  const t0 = sm[0]!.t;
  const t1 = sm[sm.length - 1]!.t;
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
    // data, not decoration - while staying C1 continuous, which matters because
    // the facet normals come from this curve and a kink shows as a dent.
    const k2 = k * k;
    const k3 = k2 * k;
    return (
      (0.5 *
        (2 * p1.d +
          (-p0.d + p2.d) * k +
          (2 * p0.d - 5 * p1.d + 4 * p2.d - p3.d) * k2 +
          (-p0.d + 3 * p1.d - 3 * p2.d + p3.d) * k3)) /
      peak
    );
  };

  // The twist. A band that rotates about its own tangent as it travels shows
  // its underside along opposite edges either side of the fold.
  const twist = (u: number) => -0.62 + 2.15 * u;

  const build = (dev: number): Station[] => {
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
      const side0 = norm(cross(tangent, [0, 0, 1]));
      const up0 = norm(cross(side0, tangent));
      const a = twist(u);
      const w = add(mul(side0, Math.cos(a)), mul(up0, Math.sin(a)));
      const n = add(mul(side0, -Math.sin(a)), mul(up0, Math.cos(a)));
      return { c, w, n };
    });
  };

  let lo = 0.02;
  let hi = 1.6;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    const pts = build(mid).flatMap((st) => [project(at(st, 1)), project(at(st, -1))]);
    const w = Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]));
    const h = Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]));
    if (w / h > ASPECT) lo = mid;
    else hi = mid;
  }
  const stations = build((lo + hi) / 2);

  // Crop in from both ends so the ribbon leaves the frame rather than stopping
  // inside it. A sweep that terminates on screen shows its cut cross-section
  // and reads as a shape; one that runs off the edge reads as an object.
  const pts = stations.flatMap((st) => [project(at(st, 1)), project(at(st, -1))]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const fullW = Math.max(...xs) - x0;
  const vx = x0 + fullW * 0.055;
  const vw = fullW * 0.89;
  const vh = vw / ASPECT;
  const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;

  return { stations, vx, vy: yMid - vh / 2, vw, vh };
}

interface Quad {
  pts: [number, number][];
  z: number;
  fill: string;
  /** Specular alpha, 0 when the facet catches no highlight. */
  spec: number;
  edge: boolean;
}

/**
 * Paint one frame.
 *
 * `yaw` and `pitch` turn the object in world space before projection, so the
 * normals turn with it and the lighting genuinely changes. That is the whole
 * point of animating this rather than looping a transform on a flat image: the
 * highlight travels across the surface because the surface moved under it.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  geom: Geometry,
  pal: Palette,
  w: number,
  h: number,
  yaw: number,
  pitch: number,
): void {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const turn = (p: V3): V3 => {
    const x = p[0] * cy + p[2] * sy;
    const z0 = -p[0] * sy + p[2] * cy;
    return [x, p[1] * cp - z0 * sp, p[1] * sp + z0 * cp];
  };

  // Cover, on a UNIFORM scale. Fitting each axis independently would let a
  // canvas whose box does not match the geometry's own aspect stretch the
  // object, and a stretched reflection stops looking like a reflection. Scaling
  // to the larger of the two and centring lets the sweep bleed further off the
  // sides instead, which is what it is built to do.
  const sc = Math.max(w / geom.vw, h / geom.vh);
  const ox = (w - geom.vw * sc) / 2;
  const oy = (h - geom.vh * sc) / 2;
  const toPx = (p: V3): [number, number] => {
    const [px, py] = project(p);
    return [(px - geom.vx) * sc + ox, (py - geom.vy) * sc + oy];
  };

  // Turn every station once, then reuse. Rotating inside the quad loop would
  // do the same trigonometry three times per segment.
  const st = geom.stations.map((s) => ({ c: turn(s.c), w: turn(s.w), n: turn(s.n) }));

  // The material.
  //
  // Diffuse alone cannot look polished - it is the same maths whether the
  // surface is chalk or chrome. What actually reads as gloss is a REFLECTED
  // ENVIRONMENT: a bright sky above a dark ground, with a hard horizon between
  // them, mirrored in the surface. As the object turns, that horizon sweeps
  // across it, and that travelling light/dark boundary is the entire visual
  // signature of metal.
  //
  // So the shading term is diffuse plus environment, and the result picks the
  // token step. Folding the reflection into the quantised ramp rather than
  // overlaying it keeps the whole object theme-aware, and the banding lands on
  // real palette steps instead of washing them out.
  const reflect = (n: V3): V3 => {
    const d = 2 * dot(n, VIEW);
    return [d * n[0] - VIEW[0], d * n[1] - VIEW[1], d * n[2] - VIEW[2]];
  };

  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /**
   * The environment, as seen by a mirror.
   *
   * A studio lighting a metal object does not use one soft lamp - it uses a
   * hard horizon and two strip lights, because a gradual gradient reflects as
   * mush. The hard edges are the point: a crisp boundary between a bright
   * reflection and a dark one is the only thing that separates chrome from
   * grey paint.
   */
  const sky = (r: V3) => {
    const y = r[1];
    return (
      smoothstep(-0.05, 0.06, y) * 0.62 +
      Math.exp(-((y - 0.52) ** 2) * 80) * 0.55 +
      Math.exp(-((y + 0.4) ** 2) * 150) * 0.26
    );
  };

  const material = (n: V3) => {
    const l = dot(n, KEY);
    const diffuse = (l > 0 ? l : l * 0.85) + Math.max(0, dot(n, FILL)) * 0.22;
    // Fresnel: grazing facets reflect far more than facets facing you. Without
    // it a reflective surface looks uniformly mirrored, which reads as plastic.
    const fres = 0.22 + 0.78 * Math.pow(1 - Math.abs(dot(n, VIEW)), 4);
    // Metal is mostly reflection. Weighting diffuse like a painted surface is
    // what made the earlier passes look like matte card stock.
    return diffuse * 0.2 + sky(reflect(n)) * (0.5 + fres * 0.85);
  };

  // Normalised across the sweep before quantising. A physically correct falloff
  // spends most of its range on facets that all read as pale; stretching the
  // observed range across all twelve steps is what gives the object its full
  // tonal ramp however the curve happens to bend.
  const lit = st.flatMap((s) => [material(normalAt(s, -1)), material(s.n), material(normalAt(s, 1))]);
  const lMin = Math.min(...lit);
  const lMax = Math.max(...lit);

  const shade = (n: V3) => {
    const t = (material(n) - lMin) / (lMax - lMin || 1);
    return Math.max(0, Math.min(STEPS - 1, Math.round((1 - t) * (STEPS - 1))));
  };

  // The hot highlight, laid over the ramp in white. Tight, so it is a glint
  // travelling across the form rather than a general brightening.
  const gloss = (n: V3) => Math.min(1, Math.pow(Math.max(0, dot(n, HALF)), 13) * 0.9);

  const quads: Quad[] = [];
  for (let i = 0; i < N; i++) {
    const a = st[i]!;
    const b = st[i + 1]!;

    // The lit surface, in strips across the width so the cross-section curl
    // actually shows. One quad per segment would average the whole arc into a
    // single tone and throw away the reflection.
    for (let j = 0; j < M; j++) {
      // Strips overlap by a sliver. Butt-jointed quads leave antialiasing seams
      // between them, and the usual fix - stroking every quad in its own fill
      // colour - costs a second path op on every one of them. Overlapping is
      // free, and the quad underneath is the same colour to within one step.
      const step = 2 / M;
      const v0 = -1 + step * j - step * 0.06;
      const v1 = -1 + step * (j + 1) + step * 0.06;
      const vm = -1 + step * (j + 0.5);
      const p0 = at(a, v0);
      const p1 = at(b, v0);
      const p2 = at(b, v1);
      const p3 = at(a, v1);
      const nAvg = norm(add(normalAt(a, vm), normalAt(b, vm)));
      quads.push({
        pts: [toPx(p0), toPx(p1), toPx(p2), toPx(p3)],
        z: (p0[2] + p1[2] + p2[2] + p3[2]) / 4,
        fill: pal.steps[shade(nAvg)]!,
        spec: gloss(nAvg),
        edge: false,
      });
    }

    // The two thickness edges. Only one faces the camera at any point along the
    // sweep, and which one changes at the fold - but we never have to decide
    // that, because the depth sort does it for us.
    for (const v of [1, -1]) {
      const nEdge = normalAt(a, v);
      const off = mul(nEdge, -THICK);
      const p = at(a, v);
      const q = at(b, v);
      const p2 = add(p, off);
      const q2 = add(q, off);
      quads.push({
        pts: [toPx(p), toPx(q), toPx(q2), toPx(p2)],
        z: (p[2] + q[2] + p2[2] + q2[2]) / 4,
        fill: pal.edge,
        spec: 0,
        edge: true,
      });
    }
  }

  // Painter's algorithm. Furthest first, so the near half of a fold covers the
  // far half instead of the two being drawn as one flat silhouette.
  quads.sort((p, q) => p.z - q.z);

  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (const q of quads) {
    ctx.beginPath();
    ctx.moveTo(q.pts[0]![0], q.pts[0]![1]);
    for (let i = 1; i < q.pts.length; i++) ctx.lineTo(q.pts[i]![0], q.pts[i]![1]);
    ctx.closePath();
    ctx.fillStyle = q.fill;
    ctx.fill();
    // The extruded edges are thin enough to drop below a pixel, so they alone
    // still need a hairline. The surface strips overlap instead.
    if (q.edge) {
      ctx.strokeStyle = q.fill;
      ctx.stroke();
    } else if (q.spec > 0.02) {
      ctx.fillStyle = pal.spec;
      ctx.globalAlpha = q.spec;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Perforation, placed in the band's own parametric grid and projected with
  // it, so the holes travel with the twist. A flat pattern would slide across
  // the surface and give the whole thing away.
  ctx.fillStyle = pal.perf;
  const r = Math.max(0.9, w * 0.0012);
  for (let i = 2; i < N; i += 2) {
    const s = st[i]!;
    if (dot(s.n, VIEW) <= 0.14) continue; // the underside shows no holes
    for (let k = 0; k < 7; k++) {
      const v = -0.74 + (1.48 * k) / 6;
      const [x, y] = toPx(at(s, v));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Panel joints. Tiles are what stop a smooth sweep reading as a stroke and
  // start it reading as something manufactured.
  ctx.strokeStyle = pal.seam;
  ctx.lineWidth = Math.max(1, w * 0.0009);
  for (let i = 5; i < N; i += 10) {
    const s = st[i]!;
    if (dot(s.n, VIEW) <= 0.14) continue;
    const [x1, y1] = toPx(at(s, 1));
    const [x2, y2] = toPx(at(s, -1));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}
