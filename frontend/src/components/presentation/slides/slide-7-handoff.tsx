"use client";

import Link from "next/link";

import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { Button } from "@/components/ui/button";

/**
 * Slide 7 — HANDOFF · "Let's spawn one."
 *
 * The deck *becomes* the product. Hermes nebula center-stage; single
 * CTA below. The button routes to `/spawn` (Q4 — real route
 * transition over a recorded splice; the dark register + nebula
 * visual language carry across the seam).
 *
 * The nebula here is the *same* visual as Slide 1's galaxy resolved
 * to a single point of light. Phase-4 transitions land that link.
 */
export function SlideHandoff() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-12">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--status-running))]">
          [ HANDOFF ]
        </p>
        <h2 className="text-center font-display text-5xl font-black uppercase tracking-[0.15em] text-foreground sm:text-7xl">
          Let&apos;s spawn one.
        </h2>
      </div>

      <div className="flex flex-col items-center gap-3">
        <NebulaAvatar harness="hermes" size={320} />
        <span className="font-mono text-sm uppercase tracking-wider text-foreground">
          HERMES AGENT
        </span>
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          NOUS RESEARCH · AVAILABLE
        </span>
      </div>

      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="lg"
          className="px-8"
          render={<Link href="/spawn" />}
        >
          › ENTER THE CONTROL PLANE
        </Button>
        <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground/60">
          (live demo follows)
        </span>
      </div>
    </div>
  );
}
