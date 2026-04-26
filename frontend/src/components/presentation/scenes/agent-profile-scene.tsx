"use client";

import { useEffect, useState } from "react";

/**
 * Slide 4 — `<AgentProfileScene>`
 *
 * RPG character-sheet layout. The agent is the central identity card;
 * five capability nodes (Skills, Tools, MCPs, Memory, Context) radiate
 * from it with animated hairline connections.
 *
 * All coordinates are in a fixed 720×440 SVG viewBox with
 * `preserveAspectRatio="none"` — HTML element positions derive directly
 * from (svgX / 720, svgY / 440) percentages so lines and cards share
 * the same coordinate space regardless of container width.
 */

const SVG_W = 720;
const SVG_H = 440;
const CX = 360;
const CY = 220;

type Node = {
  id: string;
  label: string;
  items: readonly string[];
  cssVar: string;
  svgX: number;
  svgY: number;
  delay: number;
};

const NODES: readonly Node[] = [
  {
    id: "skills",
    label: "SKILLS",
    items: ["Web search", "Summarise docs", "Write code"],
    cssVar: "--feature-catalog",
    svgX: 360,
    svgY: 58,
    delay: 150,
  },
  {
    id: "tools",
    label: "TOOLS",
    items: ["Gmail", "Calendar", "Notion"],
    cssVar: "--status-running",
    svgX: 618,
    svgY: 98,
    delay: 350,
  },
  {
    id: "mcps",
    label: "MCPs",
    items: ["github-mcp", "slack-mcp"],
    cssVar: "--feature-deploy",
    svgX: 618,
    svgY: 342,
    delay: 550,
  },
  {
    id: "memory",
    label: "MEMORY",
    items: ["Long-term recall", "Elephantasm"],
    cssVar: "--feature-adapter",
    svgX: 102,
    svgY: 342,
    delay: 750,
  },
  {
    id: "context",
    label: "CONTEXT",
    items: ["sales-2026.pdf", "team-wiki"],
    cssVar: "--status-pending",
    svgX: 102,
    svgY: 98,
    delay: 950,
  },
];

export function AgentProfileScene() {
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers = NODES.map((n) =>
      window.setTimeout(() => {
        setVisible((prev) => new Set([...prev, n.id]));
      }, n.delay),
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div
      className="relative h-[440px] w-full max-w-[720px]"
      role="img"
      aria-label="Agent profile: skills, tools, MCPs, memory, and context nodes connected to a central agent"
    >
      {/* SVG connection lines — beneath the cards */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <style>{`
            @keyframes agent-dash-flow {
              from { stroke-dashoffset: 0; }
              to   { stroke-dashoffset: -26; }
            }
            @media (prefers-reduced-motion: reduce) {
              .agent-line { animation: none !important; }
            }
          `}</style>
        </defs>

        {NODES.map((n) => (
          <line
            key={n.id}
            className="agent-line"
            x1={CX}
            y1={CY}
            x2={n.svgX}
            y2={n.svgY}
            stroke={`hsl(var(${n.cssVar}) / 0.4)`}
            strokeWidth="0.8"
            strokeDasharray="5 8"
            style={{
              opacity: visible.has(n.id) ? 1 : 0,
              transition: "opacity 600ms",
              animation: visible.has(n.id)
                ? "agent-dash-flow 1.4s linear infinite"
                : "none",
            }}
          />
        ))}

        {/* Small dot at each satellite anchor so the line doesn't end in mid-air */}
        {NODES.map((n) => (
          <circle
            key={`dot-${n.id}`}
            cx={n.svgX}
            cy={n.svgY}
            r="1.5"
            fill={`hsl(var(${n.cssVar}) / 0.6)`}
            style={{
              opacity: visible.has(n.id) ? 1 : 0,
              transition: "opacity 600ms",
            }}
          />
        ))}
      </svg>

      {/* Center — agent identity card */}
      <div
        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 border border-foreground/50 bg-black/90 text-center backdrop-blur-sm"
        style={{ minWidth: "158px", padding: "14px 20px" }}
      >
        <div className="mb-2.5 flex justify-center">
          <div className="size-5 rotate-45 border border-foreground/60" />
        </div>
        <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          [ HERMES · ALICE-01 ]
        </p>
        <p className="mt-1.5 font-mono text-sm font-bold text-foreground">
          claude-opus-4-7
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          anthropic
        </p>
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          <span className="animate-telemetry size-1.5 rounded-full bg-[hsl(var(--status-running))]" />
          <span className="font-display text-[9px] uppercase tracking-widest text-[hsl(var(--status-running))]">
            running
          </span>
        </div>
      </div>

      {/* Satellite capability nodes */}
      {NODES.map((n) => (
        <div
          key={n.id}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(n.svgX / SVG_W) * 100}%`,
            top: `${(n.svgY / SVG_H) * 100}%`,
            opacity: visible.has(n.id) ? 1 : 0,
            transition: "opacity 500ms",
          }}
        >
          <div
            className="border bg-black/80 backdrop-blur-sm"
            style={{
              borderColor: `hsl(var(${n.cssVar}) / 0.5)`,
              padding: "8px 12px",
              minWidth: "120px",
            }}
          >
            <p
              className="mb-1.5 font-display text-[9px] uppercase tracking-widest"
              style={{ color: `hsl(var(${n.cssVar}))` }}
            >
              [ {n.label} ]
            </p>
            {n.items.map((item) => (
              <p
                key={item}
                className="font-mono text-[10px] leading-snug text-foreground/75"
              >
                · {item}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
