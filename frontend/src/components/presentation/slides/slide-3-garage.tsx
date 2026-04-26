"use client";

import { OrbitalBay } from "../scenes/orbital-bay";

/**
 * Slide 3 — GARAGE · "Pick a harness. Like picking a car."
 *
 * The "garage of harnesses" rendered as an orbiting bay. Six
 * harnesses around the CORELLIA hub: Hermes lit (live nebula);
 * five locked (static SVG fallbacks). Bay rotates slowly (~30s/turn)
 * — perceptible, not distracting. **The diagram is no longer frozen**
 * compared to the 0.9.3 scaffold.
 */
export function SlideGarage() {
  return (
    <div className="relative flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-catalog))]">
          [ THE GARAGE ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          One control plane.
          <br />
          <span className="text-muted-foreground">Any harness. Any provider.</span>
        </h2>
      </div>

      <div className="relative h-[640px] w-full max-w-[640px]">
        <OrbitalBay />
      </div>

      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        pick a harness like picking a car
      </p>
    </div>
  );
}
