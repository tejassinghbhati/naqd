"use client";

/**
 * A surface whose border lights up where the cursor approaches it.
 *
 * Adapted from React Bits' Border Glow. The mechanism is theirs and it is a
 * good one: track the angle from the element's centre to the cursor, and how
 * close the cursor is to the edge, then use a conic-gradient MASK anchored to
 * that angle so only the arc of border nearest the pointer is lit. The light
 * follows you around the rim instead of the whole outline switching on, which
 * is the difference between a surface that responds and a card with a hover
 * state.
 *
 * Two things are ours rather than theirs.
 *
 * The colour. The original lays seven radial gradients in three hues under the
 * border. This system reserves colour for data - the only hues on a page are
 * the two validated poles and the status set - so the glow is the one accent,
 * which already means "interaction" everywhere else on the site.
 *
 * The blend mode. `plus-lighter` over a white ground clips to white and the
 * effect disappears in light mode. Light grounds get a normal composite at a
 * lower alpha instead, which reads as the accent bleeding through the edge
 * rather than as a lamp behind it.
 */

import { useCallback, useRef, type ReactNode } from "react";

interface GlowProps {
  children: ReactNode;
  className?: string;
  /**
   * How close to the edge the cursor must be before the light appears, 0-100.
   * Higher is stingier.
   */
  sensitivity?: number;
  /** How far the outer bloom extends past the border, in px. */
  radius?: number;
  /** Arc of border lit, as a share of the perimeter. Lower is tighter. */
  spread?: number;
  as?: "div" | "li";
}

export function Glow({
  children,
  className = "",
  sensitivity = 24,
  radius = 34,
  spread = 26,
  as: Tag = "div",
}: GlowProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const cx = r.width / 2;
    const cy = r.height / 2;
    const dx = x - cx;
    const dy = y - cy;

    // Edge proximity: 1 at the border, 0 dead centre. Scaling each axis by its
    // own half-extent is what makes this work on a wide card as well as a
    // square one - a plain radial distance would light a short edge late.
    const kx = dx === 0 ? Infinity : cx / Math.abs(dx);
    const ky = dy === 0 ? Infinity : cy / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);

    let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (deg < 0) deg += 360;

    el.style.setProperty("--edge", (edge * 100).toFixed(2));
    el.style.setProperty("--angle", `${deg.toFixed(2)}deg`);
  }, []);

  return (
    <Tag
      ref={ref as never}
      onPointerMove={onPointerMove}
      className={`glow ${className}`.trim()}
      style={
        {
          "--glow-sens": sensitivity,
          "--glow-pad": `${radius}px`,
          "--glow-spread": spread,
        } as React.CSSProperties
      }
    >
      <span className="glow-rim" aria-hidden="true" />
      {children}
    </Tag>
  );
}
