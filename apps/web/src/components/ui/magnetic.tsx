"use client";

import { useRef, type ReactNode } from "react";

/**
 * Lets a call to action lean a few pixels toward the pointer, like it is pulled by a magnet. Only with a mouse (a finger
 * has nothing to follow), never with "reduce motion", and only ever a transform, so the page around it never moves.
 */
export function Magnetic({ children, strength = 0.22, max = 8 }: { children: ReactNode; strength?: number; max?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);

  const enabled = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
  const place = (x: number, y: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { if (box.current) box.current.style.transform = x || y ? `translate(${x}px, ${y}px)` : ""; });
  };
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));

  return (
    <span ref={box} className="inline-flex transition-transform duration-200 ease-out will-change-transform"
      onPointerMove={(e) => {
        if (!enabled()) return;
        const r = e.currentTarget.getBoundingClientRect();
        place(clamp((e.clientX - r.left - r.width / 2) * strength), clamp((e.clientY - r.top - r.height / 2) * strength));
      }}
      onPointerLeave={() => place(0, 0)}>
      {children}
    </span>
  );
}
