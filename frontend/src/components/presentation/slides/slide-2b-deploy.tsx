"use client";

import { useEffect, useState } from "react";

const SVG_W = 640;
const SVG_H = 360;
const CX = 320;
const CY = 180;

type Target = {
  id: string;
  label: string;
  props: readonly string[];
  x: number;
  y: number;
};

const TARGETS: readonly Target[] = [
  { id: "metal",   label: "Bare Metal",  props: ["full control", "high ops burden"],    x: 138, y: 60  },
  { id: "aws",     label: "AWS",         props: ["feature-rich", "vendor lock-in"],     x: 500, y: 60  },
  { id: "mac",     label: "Mac mini",    props: ["zero-cost", "not scalable"],          x: 60,  y: 184 },
  { id: "gcp",     label: "GCP",         props: ["ML-optimized", "proprietary APIs"],   x: 578, y: 184 },
  { id: "hetzner", label: "Hetzner",     props: ["cost-efficient", "self-managed"],     x: 150, y: 308 },
  { id: "azure",   label: "Azure",       props: ["enterprise-grade", "expensive"],      x: 488, y: 308 },
  { id: "fly",     label: "Fly.io",      props: ["agent-native", "limited scale"],      x: 320, y: 336 },
];

export function SlideDeploy() {
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers = TARGETS.map((t, i) =>
      window.setTimeout(() => setVisible((prev) => new Set([...prev, t.id])), 150 + i * 120),
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-between py-8">
      {/* Title */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-deploy))]">
          [ PROBLEM 3 OF 4 ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Pick an infra.
          <br />
          <span className="text-muted-foreground">Then try to leave.</span>
        </h2>
      </div>

      {/* Visualization */}
      <div
        className="relative h-[460px] w-full max-w-[820px]"
        role="img"
        aria-label="Seven infrastructure targets arranged around a central agent"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
        >
          {TARGETS.map((t) => (
            <line
              key={t.id}
              x1={CX} y1={CY} x2={t.x} y2={t.y}
              stroke="hsl(var(--feature-deploy) / 0.4)"
              strokeWidth="0.9"
              strokeDasharray="5 6"
              style={{ opacity: visible.has(t.id) ? 1 : 0, transition: "opacity 500ms" }}
            />
          ))}
        </svg>

        {/* Target cards */}
        {TARGETS.map((t) => (
          <div
            key={t.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 border bg-black/75 px-3 py-2 backdrop-blur-sm"
            style={{
              left: `${(t.x / SVG_W) * 100}%`,
              top: `${(t.y / SVG_H) * 100}%`,
              borderColor: "hsl(var(--feature-deploy) / 0.4)",
              opacity: visible.has(t.id) ? 1 : 0,
              transition: "opacity 500ms",
            }}
          >
            <p
              className="font-display text-[15px] font-black uppercase tracking-wider"
              style={{ color: "hsl(var(--feature-deploy))" }}
            >
              {t.label}
            </p>
            {t.props.map((p) => (
              <p key={p} className="font-mono text-[14px] text-muted-foreground/60">· {p}</p>
            ))}
          </div>
        ))}

        {/* Center — agent */}
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 border bg-black/95 px-5 py-3.5 text-center backdrop-blur-sm"
          style={{ borderColor: "hsl(var(--feature-deploy) / 0.55)" }}
        >
          <p className="font-display text-[14px] uppercase tracking-widest"
            style={{ color: "hsl(var(--feature-deploy))" }}
          >
            [ YOUR AGENT ]
          </p>
          <p className="mt-1 font-mono text-[15px] text-muted-foreground/60">deploy where?</p>
        </div>
      </div>

      {/* Footer */}
      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        thousands of options · no clear migration path · expertise required
      </p>
    </div>
  );
}
