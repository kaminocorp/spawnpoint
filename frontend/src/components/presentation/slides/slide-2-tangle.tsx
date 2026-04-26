"use client";

import { TangleWeb } from "../scenes/tangle-web";

/**
 * Slide 2 — TANGLE · "Today this looks like a mess."
 *
 * Eight tool labels float in 3D as semi-transparent panels with
 * ~80 dashed lines tangling between them many-to-many. The whole
 * structure jitters faintly (the "this is barely holding together"
 * read).
 *
 * Copy collapses to a single sentence per the beat sheet — the
 * tangle *is* the message. The kicker `[ TODAY ]` disambiguates the
 * chaos as a fragmented landscape, not a broken UI.
 */
export function SlideTangle({
  collapsing = false,
}: {
  collapsing?: boolean;
}) {
  return (
    <div className="relative flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-10">
      <div className="absolute inset-0 -z-10">
        <TangleWeb collapsing={collapsing} />
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          [ TODAY ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Five planes. None unify.
        </h2>
      </div>
    </div>
  );
}
