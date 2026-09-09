"use client";

/**
 * The page ground.
 *
 * A fixed canvas behind every surface on the site. It reads its palette out of
 * CSS so it follows the theme, it stops when the reader asks for reduced
 * motion, and it stops when the tab is hidden. It is `pointer-events: none`
 * throughout and carries no meaning, so it is hidden from assistive technology
 * entirely.
 *
 * The one thing it must never do is compete with the type sitting on it, which
 * is why the palette tokens are held so low and why nothing here pulses.
 */

import { useEffect, useRef } from "react";
import { buildShards, drawShards, type ShardPalette } from "@/lib/shards";

function readPalette(el: HTMLElement): ShardPalette {
  const cs = getComputedStyle(el);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    blend: (v("--sh-blend", "lighter") as GlobalCompositeOperation) || "lighter",
    ch: [v("--sh-ch1", "#ff2f6b"), v("--sh-ch2", "#38ff9e"), v("--sh-ch3", "#2f8bff")],
    core: v("--sh-core", "#ffffff"),
  };
}

export function Shards() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d", { alpha: true });
    if (!ctx) return;

    const shards = buildShards();
    let pal = readPalette(document.documentElement);
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    let px = 0;
    let py = 0;
    let cxp = 0;
    let cyp = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let running = false;
    const t0 = performance.now();

    const paint = (t: number) => drawShards(ctx, shards, pal, w, h, t, cxp, cyp);
    const still = () => paint(0);

    const frame = (now: number) => {
      cxp += (px - cxp) * 0.03;
      cyp += (py - cyp) * 0.03;
      paint((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduced.matches || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onReduced = () => {
      stop();
      if (reduced.matches) still();
      else start();
    };
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
    document.addEventListener("visibilitychange", onVisibility);
    scheme.addEventListener("change", reread);
    reduced.addEventListener("change", onReduced);

    still();
    start();

    return () => {
      stop();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      scheme.removeEventListener("change", reread);
      reduced.removeEventListener("change", onReduced);
    };
  }, []);

  return <canvas className="shard-field" ref={ref} aria-hidden="true" />;
}
