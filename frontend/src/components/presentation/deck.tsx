"use client";

import { useCallback, useEffect, useState } from "react";

import { AudioBed, SlideCue } from "./audio/audio-bed";
import { SlideFrame } from "./slide-frame";
import { SlideHook } from "./slides/slide-1-hook";
import { SlideHarness } from "./slides/slide-2a-harness";
import { SlideDeploy } from "./slides/slide-2b-deploy";
import { SlideTools } from "./slides/slide-2c-tools";
import { SlideOversight } from "./slides/slide-2d-oversight";
import { SlideGarage } from "./slides/slide-3-garage";
import { SlideOpus } from "./slides/slide-5-opus";
import { SlideThesis } from "./slides/slide-6-thesis";
import { SlideHandoff } from "./slides/slide-7-handoff";

/**
 * 7-slide deck for `/presentation`. Click / Space / ArrowRight advance;
 * Shift+Space / ArrowLeft go back; number keys 1–7 jump; Home / End jump
 * to ends. Number keys 1–8 jump to a specific slide. Whole surface is
 * the click target.
 *
 * **Phase 4** — crossfade transitions: each slide fades in/out over
 * 250ms when `index` changes. Linked transitions:
 *   - Slide 2 → 3: tangle collapses to point (TangleWeb's `collapsing`
 *     prop is true for ~600ms while the deck is mid-transition out of
 *     slide 2). The hub of slide 3 occupies the same screen-center
 *     position the collapse converges on, so the seam reads as a single
 *     visual moment.
 *   - Slide 1 ↔ 7: same visual language (galaxy of agents resolves to
 *     a single nebula). Cross-slide identity carried by shared shaders
 *     (`@/lib/shaders/simplex-noise`) rather than a transition shim.
 *
 * **Phase 6** — `?mode=record` mode:
 *   - chrome (top strip, prev/next, dots, click-hint) hidden
 *   - auto-advance on the locked beat-sheet timeline (60s total)
 *   - keyboard advance + click-advance still work as overrides
 *   - `Math.random()`-driven scene state is per-slide deterministic
 *     because each scene mounts fresh on slide entry (not pre-mounted
 *     on deck mount), so two recordings produce frame-equivalent video
 *     so long as the seed is the same. The galaxy/tangle scenes' RNG
 *     is module-level seeded; this is the gate that needs additional
 *     work if seeded reproducibility is ever exercised.
 */

type SlideId =
  | "hook"
  | "harness"
  | "deploy"
  | "tools"
  | "oversight"
  | "garage"
  | "opus"
  | "thesis"
  | "handoff";

type SlideEntry = {
  id: SlideId;
  title: string;
  /** Beat-sheet duration in record mode, in milliseconds. */
  durationMs: number;
  /** Optional per-slide audio cue (Phase 5 — no assets ship today). */
  cueSrc?: string;
};

const SLIDES: readonly SlideEntry[] = [
  { id: "hook",      title: "HOOK",       durationMs: 8000  },
  { id: "harness",   title: "HARNESS",    durationMs: 9000  },
  { id: "tools",     title: "TOOLS",      durationMs: 9000  },
  { id: "deploy",    title: "DEPLOYMENT", durationMs: 9000  },
  { id: "oversight", title: "OVERSIGHT",  durationMs: 9000  },
  { id: "garage",    title: "GARAGE",     durationMs: 10000 },
  { id: "opus", title: "OPUS LOOP", durationMs: 10000 },
  { id: "thesis", title: "THESIS", durationMs: 7000 },
  { id: "handoff", title: "HANDOFF", durationMs: 5000 },
];

const COUNT = SLIDES.length;
const CROSSFADE_MS = 250;

function renderSlide(id: SlideId) {
  switch (id) {
    case "hook":
      return <SlideHook />;
    case "harness":
      return <SlideHarness />;
    case "deploy":
      return <SlideDeploy />;
    case "tools":
      return <SlideTools />;
    case "oversight":
      return <SlideOversight />;
    case "garage":
      return <SlideGarage />;
    case "opus":
      return <SlideOpus />;
    case "thesis":
      return <SlideThesis />;
    case "handoff":
      return <SlideHandoff />;
  }
}

export function Deck({ recordMode = false }: { recordMode?: boolean }) {
  const [index, setIndex] = useState(0);
  // `transitioning` is true for CROSSFADE_MS while the slide-body fades
  // out — drives both the wrapper opacity and (when transitioning out
  // of slide 2) the tangle's `collapsing` prop.
  const [transitioning, setTransitioning] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const advanceTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, COUNT - 1));
      if (clamped === index) return;
      setPendingIndex(clamped);
      setTransitioning(true);
    },
    [index],
  );

  // Run the crossfade: after CROSSFADE_MS, swap the slide and start the
  // fade-in.
  useEffect(() => {
    if (!transitioning || pendingIndex === null) return;
    const id = setTimeout(() => {
      setIndex(pendingIndex);
      setPendingIndex(null);
      // small stagger to let the new slide mount before fade-in starts
      requestAnimationFrame(() => setTransitioning(false));
    }, CROSSFADE_MS);
    return () => clearTimeout(id);
  }, [transitioning, pendingIndex]);

  const next = useCallback(() => advanceTo(index + 1), [advanceTo, index]);
  const prev = useCallback(() => advanceTo(index - 1), [advanceTo, index]);
  const goto = useCallback((i: number) => advanceTo(i), [advanceTo]);

  // Auto-advance in record mode — fixed timeline driven by SLIDES
  // durations. Disabled outside record mode.
  useEffect(() => {
    if (!recordMode) return;
    const slide = SLIDES[index];
    const id = setTimeout(() => {
      // index === COUNT - 1 means we're at handoff; in record mode we
      // *don't* navigate to /spawn automatically (the editor crossfades
      // the seam). Just stop.
      if (index < COUNT - 1) advanceTo(index + 1);
    }, slide.durationMs);
    return () => clearTimeout(id);
  }, [recordMode, index, advanceTo]);

  // Keyboard handler — same as 0.9.3 scaffold, expanded to 1–8.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
      }
      if (e.key === "ArrowRight" || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft" || (e.key === " " && e.shiftKey)) {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        goto(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        goto(COUNT - 1);
        return;
      }
      const n = Number.parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= COUNT) {
        e.preventDefault();
        goto(n - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goto]);

  const slide = SLIDES[index];

  return (
    <div
      className="relative flex min-h-screen w-full cursor-pointer flex-col"
      onClick={next}
      role="button"
      tabIndex={0}
      aria-label={`Slide ${index + 1} of ${COUNT}: ${slide.title}. Click or press space to advance.`}
    >
      <SlideFrame
        index={index}
        count={COUNT}
        title={slide.title}
        onJump={goto}
        onPrev={prev}
        onNext={next}
        chromeHidden={recordMode}
      >
        <div
          className="relative flex w-full items-center justify-center transition-opacity duration-200"
          style={{ opacity: transitioning ? 0 : 1 }}
        >
          {renderSlide(slide.id)}
        </div>
      </SlideFrame>

      {/* Phase 5 audio slot — silent until ops drops the bed + cues */}
      <AudioBed enabled={recordMode} />
      <SlideCue key={index} src={slide.cueSrc} />
    </div>
  );
}
