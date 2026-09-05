"use client";

/**
 * Bring a section in as it arrives.
 *
 * The point of a reveal on a page like this is not decoration, it is pacing:
 * an argument read in order should arrive in order. So it is one gesture, once
 * per element, and never on the way back up - a section that re-animates every
 * time it crosses the fold turns a document into a slideshow.
 *
 * The hiding is applied by SCRIPT, not by the stylesheet, and that distinction
 * is the whole safety story. A CSS rule that starts sections at zero opacity
 * hides the entire page if the bundle fails, is blocked, or simply has not run
 * yet. Here the server sends visible markup and the effect opts each section
 * out again on mount, so the worst case is no animation rather than no site.
 */

import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Anything already touching the viewport at load stays put. Animating the
    // fold on arrival delays the first thing the reader came for, and a band
    // that is only PARTLY on screen still shows a visibly empty strip if it is
    // held back - so the test is any intersection at all, not most of one.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) return;

    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = "in";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
