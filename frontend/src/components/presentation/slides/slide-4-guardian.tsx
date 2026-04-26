"use client";

import { AgentProfileScene } from "../scenes/agent-profile-scene";

/**
 * Slide 4 — THE AGENT · "Skills. Tools. Memory. All wired in."
 *
 * RPG character-sheet visual: one agent at the center, five capability
 * nodes (Skills, Tools, MCPs, Memory, Context) radiating out with
 * hairline connections. Each node fades in with a stagger so the slide
 * builds as the presenter speaks to each capability.
 */
export function SlideGuardian() {
  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-catalog))]">
          [ THE AGENT ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Skills. Tools. Memory.
          <br />
          <span className="text-muted-foreground">All wired in.</span>
        </h2>
      </div>

      <AgentProfileScene />

      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        skills · tools · memory · mcps · context — all per-agent
      </p>
    </div>
  );
}
