"use client";

import dynamic from "next/dynamic";

import { SceneGate } from "./scene-gate";

/**
 * Slide 1 — `<GalaxyOfAgents>`.
 *
 * A 3D particle field that materialises in lockstep with a count-up.
 * `count` is the live tick (1 → `target`); the scene reveals
 * `count / target` of `target` particles, distributed in a Gaussian
 * volume, while the camera pulls back proportionally. The viewer ends
 * up looking at a galaxy from outside.
 *
 * Heavy lifting (R3F + three) lives in the dynamic-imported inner
 * scene so the bundle is paid only on the `/presentation` route.
 */
const GalaxyScene = dynamic(() => import("./galaxy-of-agents-scene"), {
  ssr: false,
  loading: () => null,
});

export function GalaxyOfAgents({
  count,
  target,
}: {
  count: number;
  target: number;
}) {
  return (
    <SceneGate
      eager
      className="absolute inset-0"
      fallback={<GalaxyFallback />}
    >
      <GalaxyScene count={count} target={target} />
    </SceneGate>
  );
}

function GalaxyFallback() {
  // Deterministic 240-node static field — same node placement every
  // mount, so the reduced-motion path matches the live scene's final
  // frame (galaxy at rest).
  const NODE_COUNT = 240;
  return (
    <svg
      viewBox="-50 -50 100 100"
      preserveAspectRatio="xMidYMid meet"
      className="size-full opacity-60"
      role="presentation"
      aria-hidden
    >
      {Array.from({ length: NODE_COUNT }, (_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const r = ((seed % 1000) / 1000) * 35 + 4;
        const theta = ((seed * 31) % 1000) / 1000 * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const y = Math.sin(theta) * r * 0.6;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={0.25}
            fill="currentColor"
            className="text-foreground"
            opacity={0.55}
          />
        );
      })}
    </svg>
  );
}
