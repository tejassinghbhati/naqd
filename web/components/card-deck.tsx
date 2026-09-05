"use client";

/**
 * A deck of cards in perspective, cycling front to back.
 *
 * The idea is React Bits' Card Swap: cards sit in a receding stack, and every
 * few seconds the front one drops away, the rest promote forward, and the
 * dropped card returns to the back of the queue.
 *
 * Two departures from the original.
 *
 * It does not use GSAP. The motion is three CSS transitions on a timer, which
 * is a fiftieth of the payload and lets the reduced-motion path be a genuine
 * absence of animation rather than a duration of zero.
 *
 * And the easing is the site's own curve rather than an elastic overshoot. A
 * deck that springs is charming on a marketing page; on a page whose whole
 * argument is that it does not overstate things, a bouncing card is the wrong
 * register.
 *
 * It is only ever used where cycling hides nothing: the same content is on the
 * page in full underneath. A carousel that is the only route to something is a
 * way of not showing it.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const DX = 44; // horizontal step between slots
const DY = 42; // vertical step
const DZ = 66; // depth step
const SKEW = 5; // degrees, so the stack reads as turned rather than merely offset
const DROP = 620; // ms for the front card to fall away
const MOVE = 620; // ms for the rest to promote

const slot = (i: number, total: number) => ({
  transform: `translate3d(${i * DX}px, ${-i * DY}px, ${-i * DZ}px) skewY(${SKEW}deg)`,
  zIndex: total - i,
});

export function CardDeck({
  children,
  interval = 4200,
  className = "",
}: {
  children: ReactNode[];
  interval?: number;
  className?: string;
}) {
  const total = children.length;
  const [order, setOrder] = useState<number[]>(() => children.map((_, i) => i));
  const [dropping, setDropping] = useState<number | null>(null);
  const paused = useRef(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const advance = useCallback(() => {
    if (total < 2) return;
    setOrder((cur) => {
      const [front, ...rest] = cur;
      setDropping(front!);
      // Let the card fall clear before it is re-slotted at the back, or it
      // travels diagonally across the face of the stack instead of behind it.
      timers.current.push(
        window.setTimeout(() => setDropping(null), DROP),
      );
      return [...rest, front!];
    });
  }, [total]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || total < 2) return;

    let id = 0;
    const tick = () => {
      if (!paused.current && !document.hidden) advance();
      id = window.setTimeout(tick, interval);
    };
    id = window.setTimeout(tick, interval);
    return () => {
      clearTimeout(id);
      clear();
    };
  }, [advance, interval, total]);

  return (
    <div
      className={`deck ${className}`.trim()}
      onPointerEnter={() => (paused.current = true)}
      onPointerLeave={() => (paused.current = false)}
    >
      {children.map((child, i) => {
        const pos = order.indexOf(i);
        const s = slot(pos, total);
        const isDropping = dropping === i;
        return (
          <div
            key={i}
            className="deck-card"
            style={{
              // While dropping, the card keeps its old depth and falls; only
              // after it lands does it take the back slot.
              transform: isDropping
                ? `translate3d(0px, 340px, 0px) skewY(${SKEW}deg)`
                : s.transform,
              zIndex: isDropping ? total + 1 : s.zIndex,
              opacity: isDropping ? 0 : 1,
              transitionDuration: `${isDropping ? DROP : MOVE}ms`,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
