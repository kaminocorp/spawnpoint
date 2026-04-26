"use client";

import { useEffect, useState } from "react";

const SVG_W = 700;
const SVG_H = 360;
const CX = 350;
const CY = 180;

type FlowNode = { id: string; label: string; sub: string; x: number; y: number };

const SOURCES: readonly FlowNode[] = [
  { id: "github",      label: "GitHub",       sub: "repos & skills",  x: 68,  y: 68  },
  { id: "twitter",     label: "X / Twitter",  sub: "community packs", x: 48,  y: 170 },
  { id: "npm",         label: "npm registry", sub: "packages",        x: 70,  y: 275 },
  { id: "huggingface", label: "HuggingFace",  sub: "models & tools",  x: 175, y: 330 },
];

const GATES: readonly FlowNode[] = [
  { id: "gdrive",  label: "Google Drive", sub: "file access",  x: 570, y: 62  },
  { id: "dropbox", label: "Dropbox",      sub: "storage",      x: 635, y: 162 },
  { id: "notion",  label: "Notion",       sub: "knowledge",    x: 618, y: 265 },
  { id: "gmail",   label: "Gmail",        sub: "email access", x: 518, y: 330 },
  { id: "slack",   label: "Slack",        sub: "messaging",    x: 468, y: 52  },
];

export function SlideTools() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase(1), 200);
    const t2 = window.setTimeout(() => setPhase(2), 900);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-between py-8">
      {/* Title */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-tools))]">
          [ PROBLEM 2 OF 4 ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Skills. MCPs. Permissions.
          <br />
          <span className="text-muted-foreground">Scattered everywhere.</span>
        </h2>
      </div>

      {/* Visualization */}
      <div
        className="relative h-[460px] w-full max-w-[840px]"
        role="img"
        aria-label="Skill sources on the left and access gates on the right flowing into a central agent"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
        >
          <defs>
            <style>{`
              @keyframes tools-flow-l { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -22; } }
              @keyframes tools-flow-r { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 22; } }
              @media (prefers-reduced-motion: reduce) { .tf-l, .tf-r { animation: none !important; } }
            `}</style>
          </defs>
          {SOURCES.map((s, i) => (
            <line key={s.id} className="tf-l"
              x1={s.x} y1={s.y} x2={CX} y2={CY}
              stroke="hsl(var(--feature-tools) / 0.4)"
              strokeWidth="0.8" strokeDasharray="5 7"
              style={{
                opacity: phase >= 1 ? 1 : 0,
                transition: `opacity 400ms ${i * 80}ms`,
                animation: phase >= 1 ? "tools-flow-l 2s linear infinite" : "none",
              }}
            />
          ))}
          {GATES.map((g, i) => (
            <line key={g.id} className="tf-r"
              x1={CX} y1={CY} x2={g.x} y2={g.y}
              stroke="hsl(var(--feature-tools) / 0.4)"
              strokeWidth="0.8" strokeDasharray="5 7"
              style={{
                opacity: phase >= 2 ? 1 : 0,
                transition: `opacity 400ms ${i * 80}ms`,
                animation: phase >= 2 ? "tools-flow-r 2s linear infinite" : "none",
              }}
            />
          ))}
        </svg>

        {/* Source cards */}
        {SOURCES.map((s, i) => (
          <div key={s.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 border bg-black/75 px-3 py-2 backdrop-blur-sm"
            style={{
              left: `${(s.x / SVG_W) * 100}%`,
              top: `${(s.y / SVG_H) * 100}%`,
              borderColor: "hsl(var(--feature-tools) / 0.4)",
              opacity: phase >= 1 ? 1 : 0,
              transition: `opacity 400ms ${i * 80}ms`,
            }}
          >
            <p className="font-display text-[14px] uppercase tracking-wider"
              style={{ color: "hsl(var(--feature-tools))" }}
            >{s.label}</p>
            <p className="font-mono text-[14px] text-muted-foreground/60">{s.sub}</p>
          </div>
        ))}

        {/* Gate cards */}
        {GATES.map((g, i) => (
          <div key={g.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 border bg-black/75 px-3 py-2 backdrop-blur-sm"
            style={{
              left: `${(g.x / SVG_W) * 100}%`,
              top: `${(g.y / SVG_H) * 100}%`,
              borderColor: "hsl(var(--feature-tools) / 0.4)",
              opacity: phase >= 2 ? 1 : 0,
              transition: `opacity 400ms ${i * 80}ms`,
            }}
          >
            <p className="font-display text-[14px] uppercase tracking-wider"
              style={{ color: "hsl(var(--feature-tools))" }}
            >{g.label}</p>
            <p className="font-mono text-[14px] text-muted-foreground/60">{g.sub}</p>
          </div>
        ))}

        {/* Center — agent */}
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 border border-foreground/35 bg-black/95 px-5 py-3.5 text-center backdrop-blur-sm">
          <div className="mb-2 flex justify-center">
            <div className="size-4 rotate-45 border border-foreground/50" />
          </div>
          <p className="font-display text-[14px] uppercase tracking-widest text-muted-foreground">
            [ YOUR AGENT ]
          </p>
          <p className="mt-1 font-mono text-[15px] text-foreground/50">× 250</p>
        </div>

        {/* Column labels */}
        <p className="absolute bottom-0 left-3 font-mono text-[14px] uppercase tracking-wider"
          style={{ color: "hsl(var(--feature-tools) / 0.5)" }}
        >skill sources</p>
        <p className="absolute bottom-0 right-3 font-mono text-[9px] uppercase tracking-wider"
          style={{ color: "hsl(var(--feature-tools) / 0.5)" }}
        >access gates</p>
      </div>

      {/* Footer */}
      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        fine at 1 · impossible at 250 · all configured manually today
      </p>
    </div>
  );
}
