"use client";

import { useEffect, useState } from "react";

const SVG_W = 640;
const SVG_H = 360;
const CX = 320;
const CY = 182;

type HarnessNode = { id: string; label: string; sub: string; x: number; y: number };

const NODES: readonly HarnessNode[] = [
  { id: "langgraph",  label: "LangGraph",   sub: "framework",   x: 500, y: 48  },
  { id: "crewai",     label: "CrewAI",       sub: "multi-agent", x: 580, y: 148 },
  { id: "autogen",    label: "AutoGen",      sub: "framework",   x: 538, y: 282 },
  { id: "hermes",     label: "Hermes",       sub: "agent",       x: 395, y: 342 },
  { id: "swarm",      label: "Swarm",        sub: "agent",       x: 228, y: 340 },
  { id: "agno",       label: "Agno",         sub: "framework",   x: 92,  y: 286 },
  { id: "superagi",   label: "SuperAGI",     sub: "agent",       x: 52,  y: 170 },
  { id: "autogpt",    label: "AutoGPT",      sub: "agent",       x: 98,  y: 55  },
  { id: "smol",       label: "SmolAgents",   sub: "framework",   x: 255, y: 28  },
  { id: "metagpt",    label: "MetaGPT",      sub: "multi-agent", x: 490, y: 335 },
  { id: "haystack",   label: "Haystack",     sub: "framework",   x: 605, y: 235 },
  { id: "dify",       label: "Dify",         sub: "platform",    x: 42,  y: 282 },
];

const CONNECTED = new Set(["langgraph", "crewai", "hermes", "autogpt", "smol"]);

export function SlideHarness() {
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers = NODES.map((n, i) =>
      window.setTimeout(() => setVisible((prev) => new Set([...prev, n.id])), 100 + i * 75),
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-between py-8">
      {/* Title */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-catalog))]">
          [ PROBLEM 1 OF 4 ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Hundreds of harnesses.
          <br />
          <span className="text-muted-foreground">No clear standard.</span>
        </h2>
      </div>

      {/* Visualization */}
      <div
        className="relative h-[460px] w-full max-w-[820px]"
        role="img"
        aria-label="Scattered harness landscape with admin in the center"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
        >
          <defs>
            <style>{`
              @keyframes harn-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -22; } }
              @media (prefers-reduced-motion: reduce) { .harn-line { animation: none !important; } }
            `}</style>
          </defs>
          {NODES.map((n) =>
            CONNECTED.has(n.id) ? (
              <line
                key={n.id}
                className="harn-line"
                x1={CX} y1={CY} x2={n.x} y2={n.y}
                stroke="hsl(var(--feature-catalog) / 0.45)"
                strokeWidth="0.8"
                strokeDasharray="5 7"
                style={{
                  opacity: visible.has(n.id) ? 1 : 0,
                  transition: "opacity 500ms",
                  animation: visible.has(n.id) ? "harn-flow 2s linear infinite" : "none",
                }}
              />
            ) : null,
          )}
        </svg>

        {/* Harness cards */}
        {NODES.map((n) => {
          const connected = CONNECTED.has(n.id);
          return (
            <div
              key={n.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 border bg-black/70 px-2.5 py-1.5 backdrop-blur-sm"
              style={{
                left: `${(n.x / SVG_W) * 100}%`,
                top: `${(n.y / SVG_H) * 100}%`,
                borderColor: connected
                  ? "hsl(var(--feature-catalog) / 0.55)"
                  : "hsl(var(--border) / 0.25)",
                opacity: visible.has(n.id) ? 1 : 0,
                transition: "opacity 400ms",
              }}
            >
              <p
                className="font-mono text-[17px] font-medium"
                style={{
                  color: connected
                    ? "hsl(var(--feature-catalog) / 0.9)"
                    : "hsl(var(--foreground) / 0.35)",
                }}
              >
                {n.label}
              </p>
              <p className="font-mono text-[14px] text-muted-foreground/45">{n.sub}</p>
            </div>
          );
        })}

        {/* Center — admin */}
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 border border-foreground/40 bg-black/95 px-5 py-3.5 text-center backdrop-blur-sm">
          <p className="font-display text-[14px] uppercase tracking-widest text-muted-foreground">
            [ ADMIN ]
          </p>
          <p className="mt-0.5 font-display text-3xl font-black text-foreground">?</p>
          <p className="font-mono text-[14px] text-muted-foreground/55">which harness?</p>
        </div>
      </div>

      {/* Footer */}
      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        no registry · no interface contract · landscape changes weekly
      </p>
    </div>
  );
}
