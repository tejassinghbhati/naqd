/**
 * The shard field: prismatic glints on a dark ground.
 *
 * The thing that makes broken glass or a lens flare look like LIGHT rather
 * than like painted shapes is dispersion: white splits into its channels at an
 * edge, so a bright sliver carries a red fringe on one side and a cyan one on
 * the other, and only the middle stays white.
 *
 * So each shard is drawn three times - once per channel - offset along a
 * common dispersion axis, and composited ADDITIVELY. Where all three overlap
 * they sum back to a white core; where they do not, the fringes are left
 * showing. That is the real optics, not a coloured outline pretending, and it
 * is why this reads as light where a single-colour polygon reads as a shape.
 *
 * Additive only works on a dark ground - summing toward white on white paper
 * gives you white. The light theme composites the same three passes with
 * `multiply` instead, so the channels subtract toward their complements and
 * the dispersion still reads, darker rather than brighter.
 *
 * Everything is held far below the contrast of body text. This is a ground,
 * and a ground that competes with the type on it has failed however good it
 * looks in isolation.
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
  /** How the field composites. Additive on a dark ground, multiply on light. */
  blend: GlobalCompositeOperation;
  /** The three dispersion channels, drawn offset from one another. */
  ch: [string, string, string];
  /** The core, drawn last and un-offset. Where the channels resolve. */
  core: string;
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
export function buildShards(count = 46, seed = 7): Shard[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const depth = rnd();
    return {
      x: rnd(),
      y: rnd(),
      poly: makePoly(rnd),
      r: 0.012 + depth * 0.05,
      squash: 0.14 + rnd() * 0.32,
      rot: rnd() * Math.PI * 2,
      vx: (rnd() - 0.5) * 0.008,
      vy: (rnd() - 0.5) * 0.005 - 0.0025,
      spin: (rnd() - 0.5) * 0.03,
      depth,
    };
  });
}

/**
 * The dispersion axis, in screen space.
 *
 * One axis for the whole field, because a lens splits light one way. Give each
 * shard its own and the fringes point in every direction, which reads as
 * coloured noise rather than as refraction.
 */
const DX = 0.82;
const DY = 0.57;

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
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = pal.blend;

  // Far first, so the near ones lie over them. Under additive blending the
  // order barely matters for colour, but it does for the blur batching below.
  const ordered = [...shards].sort((a, b) => a.depth - b.depth);

  /*
    No canvas blur.

    `ctx.filter = "blur(...)"` looked like the obvious way to get depth of
    field, and it costs about a SECOND a frame on a full-viewport canvas at
    device-pixel-ratio 2 - measured at 1100ms, which is one frame per second.
    Every filter change forces the whole surface through an offscreen pass, and
    quantising the levels does not help because the surface is the expensive
    part, not the number of assignments.

    Distance is carried by separation and alpha instead: a far glint disperses
    WIDER and sits fainter, which is what an out-of-focus point of light
    actually does, and it costs nothing.
  */
  for (const s of ordered) {
    // Wrap rather than bounce: a shard that turns around at an invisible wall
    // draws the eye to the wall.
    const cx = (((s.x + s.vx * t + px * s.depth * 0.03) % 1) + 1) % 1;
    const cy = (((s.y + s.vy * t + py * s.depth * 0.03) % 1) + 1) % 1;
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

    // Nearer glints are brighter, and the falloff is steep: a shallow one gives
    // a flat field with no depth in it.
    const a = 0.06 + s.depth * s.depth * 0.94;

    // How far the channels separate. Bigger pieces split further, which is
    // what a wider aperture does; far ones split wider still, which is what
    // being out of focus does.
    const sep = Math.max(1.6, R * 0.17) * (1 + (1 - s.depth) * 1.9);

    const fill = (ox: number, oy: number, colour: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0] + ox, pts[0]![1] + oy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0] + ox, pts[i]![1] + oy);
      ctx.closePath();
      ctx.fill();
    };

    // The three channels, offset along the one dispersion axis.
    fill(-DX * sep, -DY * sep, pal.ch[0], a * 0.2);
    fill(0, 0, pal.ch[1], a * 0.15);
    fill(DX * sep, DY * sep, pal.ch[2], a * 0.2);

    // The core: the same shape, pulled in, where all three would resolve. This
    // is the bit that reads as a glint rather than as a coloured smudge.
    const core = pts.map(([x, y]) => [X + (x - X) * 0.45, Y + (y - Y) * 0.45] as [number, number]);
    ctx.globalAlpha = a * 0.22;
    ctx.fillStyle = pal.core;
    ctx.beginPath();
    ctx.moveTo(core[0]![0], core[0]![1]);
    for (let i = 1; i < core.length; i++) ctx.lineTo(core[i]![0], core[i]![1]);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}
