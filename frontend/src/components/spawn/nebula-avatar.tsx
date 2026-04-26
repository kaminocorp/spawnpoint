"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useMatchMedia } from "@/lib/use-match-media";
import {
  type HarnessKey,
  paletteFor,
} from "@/lib/spawn/mood-palettes";

import { AvatarFallback } from "./avatar-fallback";

/**
 * Three.js / R3F scene is dynamic-imported here, *outside* the component
 * body, so the chunk only enters the bundle once per route — not per
 * `<NebulaAvatar>` instance. `ssr: false` keeps WebGL out of server
 * rendering (it requires a browser context).
 */
const NebulaScene = dynamic(() => import("./nebula-scene"), {
  ssr: false,
  loading: () => null,
});

/**
 * Static feature-detection helpers. Both values are constants for any
 * given browser session, so we use `useSyncExternalStore` with an empty
 * subscribe — same hydration-safe pattern as `fleet-view-pref.ts` (see
 * 0.8.1 completion notes). A naïve `useEffect` + `setState` trips the
 * `react-hooks/set-state-in-effect` rule, which is correct in the general
 * case: synchronous setState in an effect body cascades a re-render.
 */
const noopSubscribe = () => () => undefined;

function readWebglOk(): boolean {
  if (typeof window === "undefined") return true;
  return typeof window.WebGL2RenderingContext !== "undefined";
}

function useWebglOk(): boolean {
  return useSyncExternalStore(noopSubscribe, readWebglOk, () => true);
}

function readHasIntersectionObserver(): boolean {
  if (typeof window === "undefined") return true;
  return typeof IntersectionObserver !== "undefined";
}

function useHasIntersectionObserver(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    readHasIntersectionObserver,
    () => true,
  );
}

/**
 * `<NebulaAvatar>` — Phase 2 of `docs/executing/agents-ui-mods.md`.
 *
 * Public wrapper that decides *whether* to render the live R3F nebula or
 * the static SVG fallback. Per-harness divergence is keyed off `harness`;
 * `size` is the rendered square in pixels (decision 5: shape stays
 * shared across harnesses, palette is the only variable).
 *
 * Branch ladder (decision 4 + decision 16):
 *   1. `prefers-reduced-motion: reduce` → SVG fallback (no canvas mount)
 *   2. WebGL not detected on `window`   → SVG fallback (no canvas mount)
 *   3. Off-screen with IO available     → render nothing (lazy mount)
 *   4. Otherwise                        → live R3F canvas
 *
 * Decision 21's "at most one canvas mounted per page" ceiling is a
 * page-level concern — this component will mount more than one if the
 * parent asks; the spawn-page layout is responsible for the page-wide
 * budget by only handing `<NebulaAvatar>` to the active harness card.
 */
export function NebulaAvatar({
  harness,
  targetHarness,
  size = 240,
  className,
}: {
  harness: HarnessKey;
  /**
   * When provided, `NebulaScene` lerps its palette toward this harness's
   * palette over ~400ms (redesign-spawn.md Phase 3 / decision 3).
   * Used by `<HarnessCarousel>` to crossfade between harnesses as the
   * active slide changes — a single canvas is mounted at the carousel
   * centre slot and `targetHarness` updates on each IO-detected swipe.
   * Omitting this prop (default) leaves behaviour byte-identical to today.
   */
  targetHarness?: HarnessKey;
  size?: number;
  className?: string;
}) {
  const reduceMotion = useMatchMedia("(prefers-reduced-motion: reduce)");
  const webglOk = useWebglOk();
  const hasIO = useHasIntersectionObserver();
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy-mount on intersection (decision 15). Canvas costs the shader
  // compile and a steady GPU draw; off-screen avatars stay as nothing
  // until the operator scrolls them into view. The `setInView(true)`
  // call lives inside the IntersectionObserver callback — that is the
  // sanctioned "subscribe to an external system" pattern, not a
  // cascading setState in the effect body.
  useEffect(() => {
    if (reduceMotion || !webglOk || !hasIO) return;
    const node = containerRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      // 0.01 threshold — the avatar is small (~240px); a stricter
      // threshold would delay mount until the entire square clears the
      // viewport. The 120px rootMargin pre-mounts just before scroll-in
      // so the cloud is already breathing by the time it's visible.
      { rootMargin: "120px", threshold: 0.01 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduceMotion, webglOk, hasIO]);

  const palette = paletteFor(harness);
  const targetPalette = targetHarness ? paletteFor(targetHarness) : undefined;
  const showFallback = reduceMotion || !webglOk;
  // No-IO browsers fail open: render the scene immediately. They are rare
  // enough that the lazy-mount optimisation isn't worth a third branch.
  const shouldRenderScene = !showFallback && (inView || !hasIO);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size }}
    >
      {showFallback ? (
        <AvatarFallback harness={harness} size={size} />
      ) : shouldRenderScene ? (
        <NebulaScene palette={palette} targetPalette={targetPalette} />
      ) : null}
    </div>
  );
}
