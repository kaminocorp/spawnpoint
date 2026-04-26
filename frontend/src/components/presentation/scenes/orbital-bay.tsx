"use client";

import { useEffect, useState } from "react";

import { AvatarFallback } from "@/components/spawn/avatar-fallback";
import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { HARNESSES } from "@/lib/spawn/harnesses";

/**
 * Slide 3 — `<OrbitalBay>`.
 *
 * The "garage of harnesses" rendered as a slowly rotating bay around
 * the CORELLIA hub. Six harnesses arranged on a circle; Hermes (the
 * one `available` entry) gets the live `<NebulaAvatar>`, the other
 * five get static `<AvatarFallback>` per the one-canvas-per-page
 * ceiling decision (decision 21 of agents-ui-mods).
 *
 * Implementation: pure CSS rotation. Three.js for this slide would be
 * overkill — the visual is a 2D circular arrangement; rotation is the
 * only motion, and CSS handles it without GPU cost beyond what's
 * already in flight from the live Hermes nebula.
 *
 * Structure (three nested layers per harness, the trick that keeps
 * labels readable while the bay rotates):
 *   .rotor       — animates rotate(0deg → 360deg) over ROTATION_SECONDS
 *     .anchor    — fixed translate(x, y) around the hub for that harness
 *       .counter — animates rotate(0deg → -360deg), upright text
 *
 * Each layer animates *one* property only, so the position translate
 * and the counter-rotation never fight each other.
 */

const RADIUS_PX = 280;
const ROTATION_SECONDS = 30;

export function OrbitalBay() {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= HARNESSES.length) clearInterval(id);
    }, 80);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative size-full">
      {/* Hub — fixed; the rotor spins around it. */}
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="flex flex-col items-center gap-2 border border-foreground/40 bg-black/70 px-7 py-5 backdrop-blur-sm">
          <span className="font-display text-base font-black uppercase tracking-[0.3em] text-foreground">
            CORELLIA
          </span>
          <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">
            CONTROL PLANE
          </span>
        </div>
      </div>

      {/* Connection lines + perimeter ring */}
      <svg
        aria-hidden
        className="absolute inset-0 size-full"
        viewBox="-320 -320 640 640"
        preserveAspectRatio="xMidYMid meet"
      >
        {HARNESSES.map((_, i) => {
          const angle = (i / HARNESSES.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * RADIUS_PX;
          const y = Math.sin(angle) * RADIUS_PX;
          const lit = i < revealed;
          return (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="0.6"
              strokeDasharray="2 4"
              className={`text-border transition-opacity duration-300 ${
                lit ? "opacity-100" : "opacity-0"
              }`}
            />
          );
        })}
        <circle
          cx={0}
          cy={0}
          r={RADIUS_PX}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="2 6"
          className="text-border/40"
        />
      </svg>

      {/* Rotor — the only element that rotates. */}
      <div className="orbital-rotor absolute inset-0">
        {HARNESSES.map((h, i) => {
          const angle = (i / HARNESSES.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * RADIUS_PX;
          const y = Math.sin(angle) * RADIUS_PX;
          const lit = i < revealed;
          return (
            <div
              key={h.key}
              className={`absolute left-1/2 top-1/2 transition-opacity duration-500 ${
                lit ? "opacity-100" : "opacity-0"
              }`}
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              }}
            >
              {/* Counter-rotation — keeps the avatar + label upright. */}
              <div className="orbital-counter flex flex-col items-center gap-2">
                {h.status === "available" ? (
                  <NebulaAvatar harness={h.key} size={140} />
                ) : (
                  <AvatarFallback harness={h.key} size={100} />
                )}
                <span
                  className={
                    "font-mono text-[11px] uppercase tracking-wider " +
                    (h.status === "available"
                      ? "text-foreground"
                      : "text-muted-foreground/70")
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
            </div>
          );
        })}
      </div>

      <style>{`
        .orbital-rotor {
          animation: orbital-rotor-spin ${ROTATION_SECONDS}s linear infinite;
        }
        .orbital-counter {
          animation: orbital-counter-spin ${ROTATION_SECONDS}s linear infinite;
        }
        @keyframes orbital-rotor-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes orbital-counter-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .orbital-rotor, .orbital-counter { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
