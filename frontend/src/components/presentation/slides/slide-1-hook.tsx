"use client";

import { useEffect, useState } from "react";

const TARGET = 1247;
const NODE_COUNT = 120;

/**
 * Slide 1 — Hook. "The 250-agent problem."
 *
 * Visual placeholder: count-up from 1 → 1,247 with a static node grid that
 * fades in as the number rises. Real 3D variant (camera pull-back, nodes
 * materialising in volumetric space) is a design-phase upgrade — this
 * scaffold gets the timing + copy locked first.
 */
export function SlideHook() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const start = performance.now();
    const duration = 2200;
    let raf = 0;
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(1 + (TARGET - 1) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const visibleNodes = Math.round((count / TARGET) * NODE_COUNT);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
      >
        <NodeField visible={visibleNodes} total={NODE_COUNT} />
      </div>

      <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
        [ THE 250-AGENT PROBLEM ]
      </p>

      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-[120px] font-bold leading-none tabular-nums text-foreground sm:text-[180px]">
          {count.toLocaleString()}
        </span>
        <span className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
          AGENTS · ONE COMPANY · TODAY
        </span>
      </div>

      <p className="max-w-3xl text-center font-mono text-base leading-relaxed text-foreground/90 sm:text-lg">
        A 250-person company wants every employee to have an AI agent. That&apos;s
        1,000+ agents — each with different models, tools, and access. Today,
        there is{" "}
        <span className="text-[hsl(var(--status-failed))]">no way</span> to
        govern that.
      </p>
    </div>
  );
}

function NodeField({ visible, total }: { visible: number; total: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="size-full"
    >
      {Array.from({ length: total }, (_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const x = (seed % 1000) / 10;
        const y = ((seed * 31) % 1000) / 10;
        const opacity = i < visible ? 0.6 : 0;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={0.3}
            fill="currentColor"
            className="text-foreground transition-opacity duration-500"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}
