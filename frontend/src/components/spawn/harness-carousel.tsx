"use client";

import { useEffect, useRef, useState } from "react";

import { HarnessSlide } from "@/components/spawn/harness-slide";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import type { HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * Horizontal scroll-snap carousel for the harness selection gallery.
 *
 * - CSS `scroll-snap-type: x mandatory`; each slide is `scroll-snap-align: center`
 *   at `width: 100%`. No carousel library — native CSS + IntersectionObserver + arrows.
 * - IO-based active-slide tracking (threshold 0.5 = only the centred slide qualifies).
 * - Arrow keys move ±1; Home/End jump to ends; 1–6 jump to slide by number.
 * - Tab order: [prev] → [scroll container] → [active SELECT] → [next].
 * - `prefers-reduced-motion: reduce` collapses to a vertical grid.
 *
 * Each `<HarnessSlide>` owns its own `<NebulaAvatar>` canvas when active and
 * unlocked. Scroll-snap ensures only one slide is visible at a time, so only
 * one canvas is ever mounted in the carousel at once.
 */

function useReducedMotion(): boolean {
  // Lazy initializer: reads the media query synchronously on mount.
  // typeof window guard keeps it SSR-safe; the effect only adds the
  // change listener (no synchronous setState in the effect body, which
  // would violate the react-hooks/set-state-in-effect rule).
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

export type HarnessCarouselProps = {
  harnesses: readonly HarnessEntry[];
  templates: readonly AgentTemplate[];
  /** Harness key of the currently centred slide. */
  activeKey: string;
  onActiveChange: (key: string) => void;
  /** Called when the user clicks › SELECT on an available slide. */
  onSelect: (templateId: string) => void;
};

export function HarnessCarousel({
  harnesses,
  templates,
  activeKey,
  onActiveChange,
  onSelect,
}: HarnessCarouselProps) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const activeIndex = harnesses.findIndex((h) => h.key === activeKey);

  // IO-based active-slide tracking.
  // Root = scroll container so percentages are relative to the viewport, not
  // the page. Threshold 0.5 means "this slide is >50% of the scroll
  // viewport" — only the centred slide qualifies when slides are 100% wide.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = slideRefs.current.findIndex((r) => r === entry.target);
            if (idx >= 0) onActiveChange(harnesses[idx].key);
          }
        }
      },
      { root: container, threshold: 0.5 },
    );
    slideRefs.current.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
  }, [harnesses, onActiveChange]);

  function scrollToIndex(idx: number) {
    const clamped = Math.max(0, Math.min(idx, harnesses.length - 1));
    slideRefs.current[clamped]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const current = harnesses.findIndex((h) => h.key === activeKey);
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        scrollToIndex(current - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        scrollToIndex(current + 1);
        break;
      case "Home":
        e.preventDefault();
        scrollToIndex(0);
        break;
      case "End":
        e.preventDefault();
        scrollToIndex(harnesses.length - 1);
        break;
      default: {
        const n = parseInt(e.key, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= harnesses.length) {
          e.preventDefault();
          scrollToIndex(n - 1);
        }
      }
    }
  }

  // prefers-reduced-motion: collapse to the Phase 1 vertical grid.
  // No scroll-snap, no IO, no animation — all slides render at full size.
  if (reduceMotion) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {harnesses.map((harness) => {
          const template = templates.find(
            (t) => t.name.toLowerCase() === harness.key,
          );
          return (
            <HarnessSlide
              key={harness.key}
              harness={harness}
              template={template}
              isActive={harness.key === activeKey}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    );
  }

  return (
    <section role="region" aria-label="Select your harness" className="space-y-3">
      {/* Navigation row: [‹] [n / total] [›] */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => scrollToIndex(activeIndex - 1)}
          disabled={activeIndex === 0}
          aria-label="Previous harness"
          className="px-1 font-display text-base leading-none text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          ‹
        </button>
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {activeIndex + 1} / {harnesses.length}
        </span>
        <button
          type="button"
          onClick={() => scrollToIndex(activeIndex + 1)}
          disabled={activeIndex === harnesses.length - 1}
          aria-label="Next harness"
          className="px-1 font-display text-base leading-none text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          ›
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Harness slides — use arrow keys or 1–6 to navigate"
      >
        {harnesses.map((harness, idx) => {
          const template = templates.find(
            (t) => t.name.toLowerCase() === harness.key,
          );
          const isActive = harness.key === activeKey;
          return (
            <div
              key={harness.key}
              ref={(el) => {
                slideRefs.current[idx] = el;
              }}
              className="w-full flex-shrink-0 snap-center"
              role="group"
              aria-roledescription="harness"
              aria-current={isActive ? "true" : undefined}
              aria-label={harness.name}
            >
              <HarnessSlide
                harness={harness}
                template={template}
                isActive={isActive}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>

      {/* Dot indicators — decorative, mouse-only (aria-hidden + tabIndex=-1).
          Arrow keys and the prev/next buttons cover keyboard navigation. */}
      <div className="flex items-center justify-center gap-1.5" aria-hidden>
        {harnesses.map((harness, idx) => (
          <button
            key={harness.key}
            type="button"
            tabIndex={-1}
            onClick={() => scrollToIndex(idx)}
            className={[
              "h-1 rounded-full transition-all duration-300",
              harness.key === activeKey
                ? "w-5 bg-[hsl(var(--feature-catalog))]"
                : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
            ].join(" ")}
          />
        ))}
      </div>
    </section>
  );
}
