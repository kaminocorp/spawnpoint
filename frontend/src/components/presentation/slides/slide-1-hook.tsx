"use client";

import { useEffect, useState } from "react";

import { GalaxyOfAgents } from "../scenes/galaxy-of-agents";

const TARGET = 1247;
const DURATION_MS = 2200;

/**
 * Slide 1 — HOOK · "1,247".
 *
 * The future-of-work hook. A single point of light at screen-center;
 * the camera dollies back as ~1,247 particles materialise one-by-one
 * in 3D space. By the end the viewer sees the galaxy from outside.
 *
 * Count-up drives the visual: `count` (1 → TARGET over 2.2s) is fed
 * to `<GalaxyOfAgents>`, which clips its particle buffer at the
 * matching index. Camera distance scales with the visible fraction,
 * so the visual reads "the more agents, the further we have to be."
 *
 * Cubic-ease for the count-up, matching the original scaffold's
 * timing (one of the few elements from 0.9.3 that survived).
 */
export function SlideHook() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(1 + (TARGET - 1) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-12">
      <div className="absolute inset-0 -z-10">
        <GalaxyOfAgents count={count} target={TARGET} />
      </div>

      <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
        [ THE 1,247-AGENT FUTURE ]
      </p>

      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-[120px] font-bold leading-none tabular-nums text-foreground sm:text-[180px]">
          {count.toLocaleString()}
        </span>
        <span className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
          AGENTS · ONE COMPANY · THIS YEAR
        </span>
      </div>
    </div>
  );
}
