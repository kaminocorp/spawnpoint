"use client";

import dynamic from "next/dynamic";

import { SceneGate } from "./scene-gate";

/**
 * Slide 2 — `<TangleWeb>`.
 *
 * Eight tool labels float as semi-transparent panels in 3D; ~80
 * dashed lines tangle between them many-to-many. The structure pulses
 * with low-amplitude noise (the "this is barely holding together"
 * read). The `collapsing` prop drives the exit transition (Phase 4) —
 * lines + nodes converge to a point.
 */
const TangleScene = dynamic(() => import("./tangle-web-scene"), {
  ssr: false,
  loading: () => null,
});

export const TANGLE_TOOLS = [
  "LangGraph",
  "Composio",
  "Portkey",
  "LangSmith",
  "Fly",
  "AWS",
  "AgentOps",
  "LiteLLM",
] as const;

export function TangleWeb({ collapsing = false }: { collapsing?: boolean }) {
  return (
    <SceneGate
      eager
      className="absolute inset-0"
      fallback={<TangleFallback />}
    >
      <TangleScene collapsing={collapsing} />
    </SceneGate>
  );
}

function TangleFallback() {
  // Static schematic — eight node circles with a hairline cross-mesh
  // hinting at the tangled structure. Honest motion register: not the
  // live mess, but recognisably the same shape.
  const nodes = TANGLE_TOOLS.map((label, i) => {
    const angle = (i / TANGLE_TOOLS.length) * Math.PI * 2 - Math.PI / 2;
    return {
      label,
      x: Math.cos(angle) * 35,
      y: Math.sin(angle) * 22,
    };
  });
  return (
    <svg
      viewBox="-50 -32 100 64"
      preserveAspectRatio="xMidYMid meet"
      className="size-full opacity-60"
      role="presentation"
      aria-hidden
    >
      {nodes.map((a, i) =>
        nodes
          .filter((_, j) => j > i)
          .map((b, k) => (
            <line
              key={`${i}-${k}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeWidth="0.18"
              strokeDasharray="0.5 1"
              className="text-foreground/40"
            />
          )),
      )}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x}
          cy={n.y}
          r={1.2}
          fill="currentColor"
          className="text-foreground"
        />
      ))}
    </svg>
  );
}
