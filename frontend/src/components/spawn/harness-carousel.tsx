"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { HarnessSlide } from "@/components/spawn/harness-slide";
import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import type { HarnessKey } from "@/lib/spawn/mood-palettes";
import type { HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * Horizontal scroll-snap carousel for the harness selection gallery.
 *
 * Architecture (redesign-spawn.md decisions 2, 3, 8, 9):
 *
 * - CSS `scroll-snap-type: x mandatory` on the container; each slide is
 *   `scroll-snap-align: center` at `width: 100%`. No carousel library —
 *   native CSS + a small IntersectionObserver driver + arrow buttons.
 * - IO-based active-slide tracking is the source of truth (not the snap
 *   geometry, which diverges across Safari iOS < 16). Threshold 0.5 reliably
 *   selects the centred full-width slide.
 * - Arrow keys move ±1; Home/End jump to ends; 1–6 jump to slide by number.
 * - Tab order: [prev button] → [scroll container] → [active SELECT button]
 *   → [next button]. Non-active SELECT buttons are `tabIndex={-1}` so focus
 *   stays on the visible slide.
 * - `prefers-reduced-motion: reduce` collapses to a vertical grid (the same
 *   layout shipped in Phase 1). Palette transitions are instant cuts in CSS.
 *
 * Phase 3 adds `<NebulaAvatar>` for the centred slide (an absolute-positioned
 * canvas overlay over the active slot — not inside HarnessSlide — so the
 * one-canvas-per-page ceiling is never breached).
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
  // Probe slide measures the avatar slot's offsetTop relative to the wrapper
  // so the canvas overlay tracks any structural change to slide chrome
  // (header height, py-* padding) without a hardcoded `top-[49px]`.
  const probeSlotRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [overlayTopPx, setOverlayTopPx] = useState<number | null>(null);

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

  // Measure the avatar slot's vertical offset relative to the overlay's
  // positioning context (`wrapperRef`). All slides share the same chrome,
  // so a single probe is enough; remeasure on resize. useLayoutEffect runs
  // before paint so the canvas mounts at the right `top` on the first frame.
  useLayoutEffect(() => {
    function measure() {
      const slot = probeSlotRef.current;
      const wrapper = wrapperRef.current;
      if (!slot || !wrapper) return;
      const top = slot.getBoundingClientRect().top -
        wrapper.getBoundingClientRect().top;
      setOverlayTopPx(top);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [reduceMotion]);

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

      {/* Scroll container wrapper — `relative` so the canvas overlay can be
          positioned within it without being inside any slide's DOM subtree.
          The overlay is a sibling of the scroll container, not a child of it,
          so it is never clipped by `overflow-x: auto` on the container. */}
      <div ref={wrapperRef} className="relative">
        {/* Scroll container
            snap-x snap-mandatory → scroll-snap-type: x mandatory
            overscroll-x-contain  → overscroll-behavior-x: contain (Safari fix)
            scrollbar hidden via [scrollbar-width:none] (Firefox) +
            [&::-webkit-scrollbar]:hidden (Chrome/Safari)
        */}
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
            // First slide doubles as the layout probe — its avatar slot is
            // measured to position the canvas overlay. Every slide shares
            // the same chrome, so one probe is enough.
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
                  avatarSlotRef={idx === 0 ? probeSlotRef : undefined}
                />
              </div>
            );
          })}
        </div>

        {/* Single canvas overlay — always at the centre of the scroll viewport.
            Vertical offset is measured from the first slide's avatar slot
            (see `useLayoutEffect` above), so structural changes to slide
            chrome (header height, padding) propagate without code edits here.
            Slides always render <AvatarFallback> as a layout placeholder;
            this canvas sits on top of it, blending additively with the dark
            bg-black/40 background the card provides (decision 21 — one canvas,
            page-wide, never inside slide DOM to avoid double-mount on swipe).
            pointer-events-none keeps the SELECT button in the footer clickable.
            Hidden until measured to avoid a one-frame top:0 flash. */}
        {overlayTopPx !== null && (
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            style={{ top: overlayTopPx }}
          >
            <NebulaAvatar
              harness={harnesses[0].key as HarnessKey}
              targetHarness={activeKey as HarnessKey}
              size={240}
            />
          </div>
        )}
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
