"use client";

import { PolicyCheckpoint } from "../scenes/policy-checkpoint";

/**
 * Slide 4 — GUARDIAN · "Per-agent scopes. Revoke without restart."
 *
 * The substantive product claim: Corellia governs *what each agent
 * can do*, not just deploys them.
 *
 * Visual: tool-call inspection visualised as a checkpoint. Three
 * sample requests stream through; the safe one passes (cyan), the
 * dangerous ones dissolve at the checkpoint (failed-red).
 *
 * Hermes-real call examples per Q6.
 */
export function SlideGuardian() {
  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-12">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--status-running))]">
          [ THE GUARDIAN ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Per-agent scopes.
          <br />
          <span className="text-muted-foreground">Revoke without restart.</span>
        </h2>
      </div>

      <div className="relative flex h-[200px] w-full max-w-5xl items-center justify-center">
        <PolicyCheckpoint />
      </div>

      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        every tool call passes through a policy you wrote
      </p>
    </div>
  );
}
