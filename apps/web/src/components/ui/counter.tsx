"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A money figure that counts to its new value instead of jumping (about a third of a second). The moving digits are
 * hidden from screen readers, which only ever hear the final value, read once from a quiet live region. With "reduce
 * motion" it simply shows the new value. When the same figure is on screen twice, pass `live={false}` to the copy, so
 * it is announced once.
 */
export function Counter({ value, decimals = 2, className, live = true }: { value: number; decimals?: number; className?: string; live?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    // With "reduce motion" the duration is zero: the first frame lands on the value.
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = start + (value - start) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className}>
      <span aria-hidden>{shown.toFixed(decimals)}</span>
      {live ? <span className="sr-only" aria-live="polite">{value.toFixed(decimals)}</span> : <span className="sr-only">{value.toFixed(decimals)}</span>}
    </span>
  );
}
