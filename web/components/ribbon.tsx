"use client";

/**
 * The hero ribbon.
 *
 * Geometry and material live in lib/ribbon; this is lifecycle. It owns the
 * canvas, the animation loop, the pointer, and reading the palette back out of
 * CSS so the object stays theme-aware without a single hex value in here.
 *
 * The motion is deliberately slow and never loops visibly: two sine terms at
 * incommensurate periods, so the object drifts rather than cycling. Pointer
 * input adds to that and is heavily damped, so moving the mouse nudges the
 * object instead of yanking it.
 *
 * Three things it refuses to do. It does not animate when the reader has asked
 * for reduced motion - it paints one frame and stops. It does not animate while
 * scrolled out of view. And it does not reflow: the canvas holds a fixed aspect
 * ratio, so nothing below it moves when the object appears.
 */

import { useEffect, useRef } from "react";
import type { CalibrationBin } from "@/lib/assay";
import {
  ASPECT,
  MAX_PITCH,
  MAX_YAW,
  STEPS,
  buildGeometry,
  drawFrame,
  type Geometry,
  type Palette,
} from "@/lib/ribbon";

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    steps: Array.from({ length: STEPS }, (_, i) => v(`--rb-s${i}`, "#dfe6f0")),
    edge: v("--rb-edge", "#10161f"),
    seam: v("--rb-seam", "rgba(255,255,255,0.6)"),
    perf: v("--rb-perf", "rgba(16,34,61,0.26)"),
    spec: v("--rb-spec", "#ffffff"),
  };
}

const clamp = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);

export function Ribbon({ bins }: { bins: CalibrationBin[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d", { alpha: true });
    if (!ctx) return;

    const geom: Geometry = buildGeometry(bins);
    let pal = readPalette(document.documentElement);

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = box.clientWidth;
      // Read the box back from CSS rather than deriving it, so the responsive
      // aspect-ratio rule is the single source of truth for how tall the
      // object is at a given width.
      h = Math.round(el.getBoundingClientRect().height) || Math.round(w / ASPECT);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Pointer parallax, in normalised viewport coordinates. Tracked on the
    // window rather than the canvas: the object is decorative and takes no
    // pointer events, and a hero that only responds while you are directly over
    // it reads as broken rather than as subtle.
    let px = 0;
    let py = 0;
    let cx = 0;
    let cy = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let visible = true;
    let running = false;

    const paint = (yaw: number, pitch: number) => drawFrame(ctx, geom, pal, w, h, yaw, pitch);
    const still = () => paint(0, 0);

    const frame = (t: number) => {
      // Ease toward the pointer rather than tracking it. The constant is per
      // frame, so this is framerate-dependent by a hair, and that is fine: it
      // is a feel, not a measurement.
      cx += (px - cx) * 0.06;
      cy += (py - cy) * 0.06;
      // Wider and faster than a drift. The object is the page's one moving
      // thing and it was turning slowly enough that a reader could look at it
      // for several seconds without being sure it moved at all - which buys
      // the cost of animating it and none of the benefit.
      // Clamped to the same limits the frame was solved against. Without the
      // clamp a pointer at the far corner pushes the sweep past the bounds the
      // box was built for, and the object clips at the edge.
      const yaw = clamp(
        0.2 * Math.sin(t * 0.00046) + 0.11 * Math.sin(t * 0.00071 + 1.7) + cx * 0.18,
        MAX_YAW,
      );
      const pitch = clamp(0.1 * Math.sin(t * 0.00037 + 0.6) + cy * 0.09, MAX_PITCH);
      paint(yaw, pitch);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduced.matches || !visible) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Off-screen the object is not worth a frame budget: a hero that keeps
    // running while the reader is three sections down is just heat.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible) start();
        else stop();
      },
      { rootMargin: "120px" },
    );
    io.observe(box);

    const onReduced = () => {
      stop();
      if (reduced.matches) still();
      else start();
    };

    // The palette lives in CSS, so a theme change has to be read back rather
    // than recomputed. Covers both routes: the toggle stamps data-theme on the
    // root, and "system" stamps nothing and follows the OS.
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const reread = () => {
      pal = readPalette(document.documentElement);
      if (!running) still();
    };
    const mo = new MutationObserver(reread);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const onResize = () => {
      resize();
      if (!running) still();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    scheme.addEventListener("change", reread);
    reduced.addEventListener("change", onReduced);

    still();
    start();

    return () => {
      stop();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      scheme.removeEventListener("change", reread);
      reduced.removeEventListener("change", onReduced);
    };
  }, [bins]);

  return (
    <div className="ribbon-wrap" ref={wrap} aria-hidden="true">
      <canvas className="ribbon" ref={canvas} />
    </div>
  );
}
