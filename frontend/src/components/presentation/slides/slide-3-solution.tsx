"use client";

import { AvatarFallback } from "@/components/spawn/avatar-fallback";
import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { HARNESSES } from "@/lib/spawn/harnesses";

/**
 * Slide 3 — Solution. "One control plane. Any harness. Any provider."
 *
 * The "garage of harnesses" rendered literally: six harnesses arranged
 * around a circular bay, with the CORELLIA hub at center connecting to
 * all of them. Hermes (the only `available` entry) gets the live
 * `<NebulaAvatar>`; the other five get static `<AvatarFallback>` to
 * honour decision 21's one-canvas-per-page ceiling. Camera-orbit /
 * polish is a design-phase upgrade — this scaffold gets layout +
 * typography locked first.
 */
export function SlideSolution() {
  const radius = 280;
  const harnesses = HARNESSES;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-catalog))]">
          [ THE GARAGE OF HARNESSES ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          One control plane.
          <br />
          <span className="text-muted-foreground">Any harness. Any provider.</span>
        </h2>
      </div>

      <div className="relative h-[640px] w-full max-w-[640px]">
        {/* Connection lines from hub to each harness */}
        <svg
          aria-hidden
          className="absolute inset-0 size-full"
          viewBox="-320 -320 640 640"
        >
          {harnesses.map((_, i) => {
            const angle = (i / harnesses.length) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            return (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2 4"
                className="text-border"
              />
            );
          })}
          <circle
            cx={0}
            cy={0}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeDasharray="2 6"
            className="text-border/60"
          />
        </svg>

        {/* CORELLIA hub at center */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-2 border border-foreground/40 bg-black/60 px-6 py-4 backdrop-blur-sm">
            <span className="font-display text-base font-black uppercase tracking-[0.3em] text-foreground">
              CORELLIA
            </span>
            <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">
              CONTROL PLANE
            </span>
          </div>
        </div>

        {/* Six harnesses around the perimeter */}
        {harnesses.map((h, i) => {
          const angle = (i / harnesses.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          return (
            <div
              key={h.key}
              className="absolute left-1/2 top-1/2 flex flex-col items-center gap-2"
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              }}
            >
              {h.status === "available" ? (
                <NebulaAvatar harness={h.key} size={120} />
              ) : (
                <AvatarFallback harness={h.key} size={120} />
              )}
              <span
                className={
                  "font-mono text-[11px] uppercase tracking-wider " +
                  (h.status === "available"
                    ? "text-foreground"
                    : "text-muted-foreground/60")
                }
              >
                {h.name}
              </span>
              {h.status === "locked" && (
                <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground/40">
                  [ LOCKED ]
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="max-w-3xl text-center font-mono text-sm leading-relaxed text-foreground/90">
        Pick a harness like picking a car. We govern lifecycle, secrets,
        deployment, and access — across any model, any provider, any framework.
      </p>
    </div>
  );
}
