"use client";

import { type ReactNode, useEffect, useState } from "react";

// 20 person nodes representing 250 employees — laid out in a 5×4 grid
// across the upper portion of the right-panel SVG (viewBox 0 0 100 100).
const PEOPLE: readonly { x: number; y: number }[] = [
  { x: 8,  y: 9  }, { x: 26, y: 6  }, { x: 44, y: 10 }, { x: 62, y: 7  }, { x: 80, y: 11 },
  { x: 16, y: 26 }, { x: 34, y: 23 }, { x: 52, y: 27 }, { x: 70, y: 24 }, { x: 88, y: 28 },
  { x: 6,  y: 43 }, { x: 24, y: 40 }, { x: 42, y: 44 }, { x: 60, y: 41 }, { x: 78, y: 45 },
  { x: 14, y: 60 }, { x: 32, y: 57 }, { x: 50, y: 61 }, { x: 68, y: 58 }, { x: 86, y: 62 },
];

// 5 agent nodes spread across the lower portion of the right-panel SVG.
const AGENTS: readonly { x: number; y: number }[] = [
  { x: 10, y: 88 }, { x: 30, y: 85 }, { x: 50, y: 89 }, { x: 70, y: 86 }, { x: 90, y: 90 },
];

// Each tuple is [personIndex, agentIndex] — enough coverage to look tangled
// without being every-to-every. 48 edges across 20 people × 5 agents.
const EDGES: readonly [number, number][] = [
  [0,0],[0,1],           [1,0],[1,2],          [2,1],[2,2],
  [3,2],[3,3],           [4,3],[4,4],
  [5,0],[5,1],[5,3],     [6,1],[6,2],          [7,2],[7,3],[7,0],
  [8,3],[8,4],           [9,4],[9,0],[9,1],
  [10,0],[10,2],         [11,1],[11,3],[11,0],  [12,2],[12,4],
  [13,3],[13,0],         [14,4],[14,1],[14,2],
  [15,0],[15,3],[15,4],  [16,1],[16,4],         [17,2],[17,0],[17,3],
  [18,3],[18,1],         [19,4],[19,2],[19,0],
];

/**
 * Slide 1 — HOOK · "The deployment problem".
 *
 * Side-by-side comparison: one person deploying a single agent (left)
 * versus 250 employees each deploying their own (right). The contrast
 * establishes the target audience and frames the problem: manual,
 * bespoke setup is fine at N=1 but breaks down at N=250+.
 *
 * The right panel's edge-tangle animates in over ~1.6 s so the chaos
 * visibly builds as the speaker opens.
 */
export function SlideHook() {
  const [t, setT] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const dur = 1600;
    let raf = 0;
    function tick(now: number) {
      const p = Math.min((now - start) / dur, 1);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-10 px-8">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          [ the deployment problem ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Manageable at one.
          <br />
          <span className="text-muted-foreground">Chaos at 250.</span>
        </h2>
      </div>

      {/* Two-panel comparison */}
      <div className="flex w-full items-start justify-center gap-4">
        {/* LEFT — simple: one person, one agent */}
        <div className="flex flex-1 flex-col items-center gap-4">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
            1 employee
          </p>
          <svg
            viewBox="0 0 100 150"
            className="w-full max-w-[140px]"
            aria-hidden
            role="presentation"
          >
            <PersonIcon cx={50} cy={28} />
            {/* clean dashed connector */}
            <line
              x1={50} y1={52} x2={50} y2={110}
              stroke="currentColor"
              strokeWidth={0.7}
              strokeDasharray="3 2.5"
              className="text-border"
              opacity={0.6}
            />
            <AgentHex cx={50} cy={124} r={10} />
          </svg>
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
            1 agent
          </p>
          <StatusTag ok>manageable</StatusTag>
        </div>

        {/* Divider */}
        <div className="mx-4 flex shrink-0 flex-col items-center justify-center gap-2 self-stretch">
          <div className="w-px flex-1 bg-border/25" />
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/35">
            vs
          </span>
          <div className="w-px flex-1 bg-border/25" />
        </div>

        {/* RIGHT — complex: 250 employees, N agents, tangle of connections */}
        <div className="flex flex-[2] flex-col items-center gap-4">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
            250 employees
          </p>
          <svg
            viewBox="-2 -6 104 106"
            className="w-full max-w-[380px]"
            aria-hidden
            role="presentation"
          >
            {/* Tangle draws in progressively — each edge staggered by its index */}
            {EDGES.map(([pi, ai], i) => {
              const p = PEOPLE[pi];
              const a = AGENTS[ai];
              const appeared = Math.max(0, t * EDGES.length - i);
              return (
                <line
                  key={i}
                  x1={p.x} y1={p.y}
                  x2={a.x} y2={a.y}
                  stroke="currentColor"
                  strokeWidth={0.35}
                  opacity={Math.min(appeared * 0.38, 0.26)}
                  className="text-foreground"
                />
              );
            })}
            {PEOPLE.map((p, i) => (
              <PersonDot key={i} cx={p.x} cy={p.y} />
            ))}
            {AGENTS.map((a, i) => (
              <AgentHex key={i} cx={a.x} cy={a.y} r={6} />
            ))}
          </svg>
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
            n agents · n configs · n providers
          </p>
          <StatusTag ok={false}>untenable at scale</StatusTag>
        </div>
      </div>

      {/* Takeaway */}
      <p className="max-w-xl text-center font-display text-[11px] uppercase tracking-widest text-muted-foreground">
        widespread adoption demands a programmatic,{" "}
        model&#8209;agnostic control plane.
      </p>
    </div>
  );
}

function PersonIcon({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g fill="currentColor" className="text-foreground">
      <circle cx={cx} cy={cy} r={8} opacity={0.85} />
      <path
        d={`M ${cx - 12} ${cy + 22} Q ${cx - 12} ${cy + 12} ${cx} ${cy + 12} Q ${cx + 12} ${cy + 12} ${cx + 12} ${cy + 22} Z`}
        opacity={0.65}
      />
    </g>
  );
}

function PersonDot({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g fill="currentColor" className="text-foreground">
      <circle cx={cx} cy={cy - 2.5} r={3} opacity={0.8} />
      <path
        d={`M ${cx - 4.5} ${cy + 3.5} Q ${cx - 4.5} ${cy + 0.5} ${cx} ${cy + 0.5} Q ${cx + 4.5} ${cy + 0.5} ${cx + 4.5} ${cy + 3.5} Z`}
        opacity={0.65}
      />
    </g>
  );
}

function AgentHex({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(" ");
  return (
    <g className="text-foreground">
      <polygon
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.8}
        opacity={0.8}
      />
      <circle cx={cx} cy={cy} r={r * 0.28} fill="currentColor" opacity={0.6} />
    </g>
  );
}

function StatusTag({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`font-mono text-[9px] uppercase tracking-wider ${
        ok ? "text-emerald-500/70" : "text-red-500/60"
      }`}
    >
      {ok ? "✓" : "✗"} {children}
    </span>
  );
}
