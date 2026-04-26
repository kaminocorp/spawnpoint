"use client";

import { useCallback, useEffect, useState } from "react";

import { SlideFrame } from "./slide-frame";
import { SlideHook } from "./slides/slide-1-hook";
import { SlideProblem } from "./slides/slide-2-problem";
import { SlideSolution } from "./slides/slide-3-solution";
import { SlideHow } from "./slides/slide-4-how";
import { SlideHandoff } from "./slides/slide-5-handoff";

const SLIDES = [
  { id: "hook", title: "HOOK", render: () => <SlideHook /> },
  { id: "problem", title: "PROBLEM", render: () => <SlideProblem /> },
  { id: "solution", title: "SOLUTION", render: () => <SlideSolution /> },
  { id: "how", title: "HOW", render: () => <SlideHow /> },
  { id: "handoff", title: "HANDOFF", render: () => <SlideHandoff /> },
] as const;

const COUNT = SLIDES.length;

/**
 * Discrete-slide deck for `/presentation` (Option B). Click / Space /
 * ArrowRight advance; Shift+Space / ArrowLeft go back; number keys 1–5
 * jump; Home / End jump to ends. The whole surface is the click target —
 * keep escape hatches off the click path so the operator can advance from
 * anywhere on the slide.
 */
export function Deck() {
  const [index, setIndex] = useState(0);

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, COUNT - 1));
  }, []);
  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);
  const goto = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(i, COUNT - 1)));
  }, []);

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
        onJump={(i) => goto(i)}
        onPrev={prev}
        onNext={next}
      >
        {slide.render()}
      </SlideFrame>
    </div>
  );
}
