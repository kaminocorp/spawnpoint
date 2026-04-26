"use client";

import { useEffect, useState } from "react";

/**
 * Slide — ADAPTIVE PLANE
 *
 * The control plane is self-writing: whenever an agent changes (new
 * model, new tools, new Dockerfile), Opus 4.7 analyzes the diff and
 * regenerates the adapter, sidecar config, and scope rules without
 * any manual integration work. The cycle loops forever.
 *
 * Four-node loop: AGENT CHANGES → OPUS 4.7 ANALYZES → ARTIFACTS
 * GENERATED → DEPLOYED SEAMLESSLY → (feedback arc back to start).
 * Each node pulses in sequence at STEP_MS cadence; a feedback arc
 * glows below the pipeline on the return leg, then everything resets.
 */

const LOOP_NODES = [
  {
    id: "change",
    label: ["AGENT", "CHANGES"],
    sub: "new model · new tool · new Dockerfile",
  },
  {
    id: "analyze",
    label: ["OPUS 4.7", "ANALYZES"],
    sub: "repo diff · manifest delta · API shape",
  },
  {
    id: "gen",
    label: ["ARTIFACTS", "GENERATED"],
    sub: "adapter · sidecar · scope rules",
  },
  {
    id: "deploy",
    label: ["DEPLOYED", "SEAMLESSLY"],
    sub: "zero manual integration",
  },
] as const;

const STEP_MS = 680;
// 0..3 = node pulses, 4 = feedback arc, 5 = pause before reset
const TOTAL_STEPS = LOOP_NODES.length + 2;

function LoopNode({
  label,
  sub,
  active,
}: {
  label: readonly string[];
  sub: string;
  active: boolean;
}) {
  return (
    <div
      className="flex min-w-[130px] flex-col items-center gap-1.5 border px-4 py-3 transition-all duration-500"
      style={{
        borderColor: active
          ? "hsl(var(--feature-adapter))"
          : "hsl(var(--border) / 0.55)",
        backgroundColor: active
          ? "hsl(var(--feature-adapter) / 0.09)"
          : "hsl(var(--background) / 0.25)",
        boxShadow: active
          ? "0 0 22px hsl(var(--feature-adapter) / 0.28)"
          : "none",
      }}
    >
      <span
        className="text-center font-display text-[11px] font-black uppercase leading-tight tracking-widest transition-colors duration-400"
        style={{
          color: active
            ? "hsl(var(--feature-adapter))"
            : "hsl(var(--foreground) / 0.65)",
        }}
      >
        {label.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
      <span className="text-center font-mono text-[9px] leading-tight text-muted-foreground/65">
        {sub}
      </span>
    </div>
  );
}

function PipeArrow({ lit }: { lit: boolean }) {
  return (
    <span
      aria-hidden
      className="font-mono text-2xl transition-colors duration-400"
      style={{
        color: lit
          ? "hsl(var(--feature-adapter) / 0.8)"
          : "hsl(var(--border) / 0.4)",
      }}
    >
      →
    </span>
  );
}

function FeedbackArc({ active }: { active: boolean }) {
  return (
    <div className="flex w-full items-center gap-3 px-2">
      <span
        className="whitespace-nowrap font-mono text-[10px] uppercase tracking-wider transition-all duration-400"
        style={{
          color: active
            ? "hsl(var(--feature-adapter))"
            : "transparent",
        }}
      >
        ← SELF-WRITES
      </span>
      <div
        className="h-0 flex-1 transition-colors duration-400"
        style={{
          borderTopWidth: "1px",
          borderTopStyle: "dashed",
          borderTopColor: active
            ? "hsl(var(--feature-adapter) / 0.55)"
            : "hsl(var(--border) / 0.2)",
        }}
      />
      <span
        className="whitespace-nowrap font-mono text-[10px] uppercase tracking-wider transition-all duration-400"
        style={{
          color: active
            ? "hsl(var(--feature-adapter))"
            : "transparent",
        }}
      >
        LOOP ↺
      </span>
    </div>
  );
}

export function SlideAdaptive() {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setPulse((p) => (p + 1) % TOTAL_STEPS),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, []);

  const feedbackActive = pulse === LOOP_NODES.length;

  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center gap-10">
      {/* Title */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-adapter))]">
          [ SELF-WRITING CONTROL PLANE ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Agents change.
          <br />
          <span className="text-[hsl(var(--feature-adapter))]">
            The plane self-writes.
          </span>
        </h2>
      </div>

      {/* Loop visualization */}
      <div className="flex w-full flex-col gap-4">
        {/* Forward pipeline */}
        <div className="flex items-center justify-center gap-3">
          {LOOP_NODES.map((node, i) => (
            <div key={node.id} className="flex items-center gap-3">
              <LoopNode
                label={node.label}
                sub={node.sub}
                active={pulse === i}
              />
              {i < LOOP_NODES.length - 1 && (
                <PipeArrow lit={pulse > i && pulse < LOOP_NODES.length} />
              )}
            </div>
          ))}
        </div>

        {/* Feedback arc — return leg from DEPLOYED back to AGENT CHANGES */}
        <FeedbackArc active={feedbackActive} />
      </div>

      {/* Descriptor */}
      <div className="flex flex-col items-center gap-2">
        <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
          Opus 4.7 in the loop · adapter · sidecar · scope — regenerated on demand
        </p>
        <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/50">
          no human in the integration path · forever adaptive
        </p>
      </div>
    </div>
  );
}
