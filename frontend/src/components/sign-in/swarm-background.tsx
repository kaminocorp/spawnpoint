"use client";

import dynamic from "next/dynamic";

import { useMatchMedia } from "@/lib/use-match-media";

import { ReducedMotionStill } from "./reduced-motion-still";

const SwarmCanvas = dynamic(() => import("./swarm-canvas"), { ssr: false });

/**
 * The `/sign-in` background. Branches on `prefers-reduced-motion`:
 *
 *   - reduced-motion: skip the dynamic-import entirely, render a
 *     Corellia-shaped static still (inline SVG, no JS dependencies).
 *     Users who opt out of motion still get a branded login screen,
 *     not a dead grid-bg.
 *
 *   - default: dynamic-import the R3F canvas so three.js stays out of
 *     the initial JS bundle on this signed-out route.
 *
 * Both branches share the same `fixed inset-0 -z-10 bg-black` shell
 * so the vignette in `/sign-in/page.tsx` layers correctly over either.
 */
export function SwarmBackground() {
  const reduceMotion = useMatchMedia("(prefers-reduced-motion: reduce)");

  return (
    <div className="fixed inset-0 -z-10 bg-black">
      {reduceMotion ? <ReducedMotionStill /> : <SwarmCanvas />}
    </div>
  );
}
