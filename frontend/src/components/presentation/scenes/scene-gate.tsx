"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useMatchMedia } from "@/lib/use-match-media";

/**
 * Shared gate for every Three.js scene under
 * `frontend/src/components/presentation/scenes/`.
 *
 * Mirrors the branch ladder used by `<NebulaAvatar>`:
 *
 *   1. `prefers-reduced-motion: reduce` → render `fallback`
 *   2. WebGL2 not detected on `window`   → render `fallback`
 *   3. Off-screen with IO available     → render nothing (lazy mount)
 *   4. Otherwise                        → render `children`
 *
 * The fallback is a per-scene static SVG schematic, kept honest with
 * design-system §28 "animated or not, never half." Lazy-mount is on by
 * default — every presentation scene is full-bleed enough that the
 * canvas-warm-up cost is worth deferring until the slide is the active
 * one. Pass `eager={true}` if a scene must already be running by the
 * time the slide enters (e.g. Slide 1 mounts before user interaction).
 */
const noopSubscribe = () => () => undefined;

function readWebgl2(): boolean {
  if (typeof window === "undefined") return true;
  return typeof window.WebGL2RenderingContext !== "undefined";
}

function useWebgl2(): boolean {
  return useSyncExternalStore(noopSubscribe, readWebgl2, () => true);
}

function readHasIO(): boolean {
  if (typeof window === "undefined") return true;
  return typeof IntersectionObserver !== "undefined";
}

function useHasIO(): boolean {
  return useSyncExternalStore(noopSubscribe, readHasIO, () => true);
}

export function SceneGate({
  fallback,
  children,
  eager = false,
  className,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
  eager?: boolean;
  className?: string;
}) {
  const reduceMotion = useMatchMedia("(prefers-reduced-motion: reduce)");
  const webglOk = useWebgl2();
  const hasIO = useHasIO();
  const [inView, setInView] = useState(eager);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eager || reduceMotion || !webglOk || !hasIO) return;
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
      { rootMargin: "0px", threshold: 0.01 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [eager, reduceMotion, webglOk, hasIO]);

  const showFallback = reduceMotion || !webglOk;
  const shouldRender = !showFallback && (inView || !hasIO);

  return (
    <div ref={containerRef} className={className}>
      {showFallback ? fallback : shouldRender ? children : fallback}
    </div>
  );
}
