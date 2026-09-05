/**
 * The shard field: an aero-glass background.
 *
 * Slabs of tinted glass drifting behind the page. Each one is a convex polygon
 * with three things happening at its boundary, because that is where glass
 * announces itself:
 *
 *   1. a face gradient, brighter along the edge nearest the light
 *   2. a bright rim on the two edges facing that light, and nothing on the rest
 *   3. a chromatic fringe - the rim drawn twice more, a fraction of a pixel
 *      apart, warm one way and cool the other
 *
 * The third is the one that does the work. A single white outline reads as a
 * sticker; two offset outlines in opposing hues read as something with a
 * thickness that bends light through it.
 *
 * Everything is held far below the contrast of body text. This is a ground, and
 * a ground that competes with the type on it has failed regardless of how good
 * it looks in isolation.
 */

export interface Shard {
  /** Centre, in viewport fractions so a resize does not reshuffle the field. */
  x: number;
  y: number;
  /** Vertices in local space, unit-ish, scaled by `r`. */
  poly: [number, number][];
  r: number;
  /** Cross-axis squash. Below 1 the piece is a sliver rather than a chunk. */
  squash: number;
  rot: number;
  /** Drift, in viewport fractions per second. */
  vx: number;
  vy: number;
  spin: number;
  /** Parallax depth, 0 far to 1 near. Drives size, alpha and drift rate. */
  depth: number;
}

export interface ShardPalette {
  /** Glass face, brightest stop. */
  faceHi: string;
  faceLo: string;
  rim: string;
  /** The two dispersion hues. */
  fringeWarm: string;
  fringeCool: string;
}

/** Deterministic PRNG, so the field is identical on server and client. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A convex polygon, built by walking a circle and pushing each vertex out by a
 * random amount. Sorting angles keeps it convex, which matters because a
 * self-intersecting shard fills with a visible crease and stops reading as a
 * flat pane.
 */
function makePoly(rnd: () => number): [number, number][] {
  const n = 3 + Math.floor(rnd() * 3);
  const angles = Array.from({ length: n }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  return angles.map((a) => {
    const rad = 0.62 + rnd() * 0.38;
    return [Math.cos(a) * rad, Math.sin(a) * rad] as [number, number];
  });
}

/*
  Many small pieces rather than a few large ones.

  At the old size the field was slabs: a shape that big is read as a shape, and
  a flat polygon the size of a paragraph competes with the paragraph. Broken
  glass is small, numerous and mostly EDGE - which is also why these are
  squashed on one axis. A sliver catching light along its length reads as
  glass; an equilateral blob reads as a polygon.
*/
export function buildShards(count = 38, seed = 7): Shard[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const depth = rnd();
    return {
      x: rnd(),
      y: rnd(),
      poly: makePoly(rnd),
      r: 0.014 + depth * 0.042,
      squash: 0.26 + rnd() * 0.5,
      rot: rnd() * Math.PI * 2,
      vx: (rnd() - 0.5) * 0.008,
      vy: (rnd() - 0.5) * 0.005 - 0.0025,
      spin: (rnd() - 0.5) * 0.03,
      depth,
    };
  });
}

/** Light direction for the rim, in screen space. Up and to the left. */
const LX = -0.6;
const LY = -0.8;

export function drawShards(
  ctx: CanvasRenderingContext2D,
  shards: Shard[],
  pal: ShardPalette,
  w: number,
  h: number,
  t: number,
  px: number,
  py: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const unit = Math.max(w, h);

  // Far shards first, so the near ones lie over them.
  for (const s of [...shards].sort((a, b) => a.depth - b.depth)) {
    // Wrap rather than bounce: a shard that turns around at an invisible wall
    // draws the eye to the wall.
    const cx = (((s.x + s.vx * t + px * s.depth * 0.02) % 1) + 1) % 1;
    const cy = (((s.y + s.vy * t + py * s.depth * 0.02) % 1) + 1) % 1;
    const X = cx * w;
    const Y = cy * h;
    const R = s.r * unit;
    const rot = s.rot + s.spin * t;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    // Squash across the local y axis before rotating, so the sliver's long
    // side lands wherever the piece happens to be turned.
    const pts = s.poly.map(([vx0, vy0]) => {
      const vy = vy0 * s.squash;
      return [X + (vx0 * cos - vy * sin) * R, Y + (vx0 * sin + vy * cos) * R] as [number, number];
    });

    // Nearer shards are more present; far ones fade toward the ground. Steeper
    // than before: a shallow falloff gives a flat field with no depth in it.
    const a = 0.1 + s.depth * s.depth * 0.9;

    const path = new Path2D();
    path.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]![0], pts[i]![1]);
    path.closePath();

    // The face. Gradient runs along the light direction so the lit edge is
    // brighter than the far one, which is what gives a flat fill a tilt.
    const g = ctx.createLinearGradient(X + LX * R, Y + LY * R, X - LX * R, Y - LY * R);
    g.addColorStop(0, pal.faceHi);
    g.addColorStop(1, pal.faceLo);
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fill(path);

    // The rim, edge by edge, only where the edge faces the light. An outline
    // all the way round is a shape; a rim on two sides is an object.
    ctx.lineCap = "round";
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i]!;
      const p1 = pts[(i + 1) % pts.length]!;
      const ex = p1[0] - p0[0];
      const ey = p1[1] - p0[1];
      const len = Math.hypot(ex, ey) || 1;
      // Outward normal of this edge, for a polygon wound one way.
      const nx = ey / len;
      const ny = -ex / len;
      const facing = nx * LX + ny * LY;
      if (facing <= 0) continue;

      const stroke = (dx: number, dy: number, colour: string, alpha: number, width: number) => {
        ctx.globalAlpha = a * alpha * facing;
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(p0[0] + dx, p0[1] + dy);
        ctx.lineTo(p1[0] + dx, p1[1] + dy);
        ctx.stroke();
      };

      // Dispersion: the same edge, split either side of the rim. Weighted by
      // depth as well as facing - a distant piece should lose its chromatic
      // fringe before it loses its outline, which is what depth of field does.
      const near = 0.35 + s.depth * 0.65;
      stroke(-0.8, -0.8, pal.fringeCool, 0.6 * near, 1.2);
      stroke(0.8, 0.8, pal.fringeWarm, 0.5 * near, 1.2);
      stroke(0, 0, pal.rim, near, 1);
    }
  }
  ctx.globalAlpha = 1;
}
