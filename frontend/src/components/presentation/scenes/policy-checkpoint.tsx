"use client";

import { useEffect, useState } from "react";

/**
 * Slide 4 — `<PolicyCheckpoint>`.
 *
 * Tool-call inspection visualised as a horizontal flow:
 *
 *   agent (left)  →  checkpoint (center)  →  tool target (right)
 *
 * Three sample requests stream through one at a time over ~6s. Each
 * is a small text capsule that slides L→R, pauses at the checkpoint
 * for ~150ms while a hairline scan-line crosses it, then either
 * passes (cyan) or dissolves into pixels (failed-red).
 *
 * Hermes-real call examples per Q6 of `presentation-polish.md` —
 * `shell.exec`, `web_search`. Research engineer recognises them; non-
 * technical viewer doesn't lose anything.
 *
 * No R3F here — capsule motion + dissolve animate cheaply with CSS
 * + SVG. The "particle dissolve" on a blocked call is a 14-particle
 * radial scatter via SVG with `transform` keyframes.
 */

type CallSample = {
  call: string;
  verdict: "allow" | "deny";
};

const CALLS: readonly CallSample[] = [
  { call: 'web_search("wiki.acme.com")', verdict: "allow" },
  { call: 'shell.exec("rm -rf /")', verdict: "deny" },
  { call: 'web_search("evil.com")', verdict: "deny" },
];

const STAGGER_MS = 1900;

export function PolicyCheckpoint() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setStep(i);
      if (i >= CALLS.length) clearInterval(id);
    }, STAGGER_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full max-w-5xl">
      {/* Track — horizontal rule between agent and target */}
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
        <NodeLabel label="AGENT" sub="hermes · alice-01" />

        <div className="relative w-full">
          <div className="h-px w-full bg-border/60" />
        </div>

        <NodeLabel label="TARGET" sub="tool" align="right" />
      </div>

      {/* Checkpoint — fixed center diamond + scan line */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative">
          <div className="checkpoint-diamond size-12 border border-foreground/60 bg-black/70 backdrop-blur-sm" />
          <div className="checkpoint-scan absolute inset-0" />
          <p className="absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            corellia_guard
          </p>
        </div>
      </div>

      {/* Capsules — one in flight at a time */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
        {CALLS.map((c, i) => (
          <Capsule key={i} sample={c} active={i === step - 1} index={i} />
        ))}
      </div>

      <style>{`
        @keyframes capsule-pass {
          0% { transform: translate(-46%, 0); opacity: 0; }
          12% { opacity: 1; }
          42% { transform: translate(0, 0); }
          58% { transform: translate(0, 0); }
          100% { transform: translate(46%, 0); opacity: 0; }
        }
        @keyframes capsule-deny {
          0% { transform: translate(-46%, 0) scale(1); opacity: 0; }
          12% { opacity: 1; }
          42% { transform: translate(0, 0) scale(1); opacity: 1; }
          58% { transform: translate(0, 0) scale(1.04); opacity: 1; }
          70% { transform: translate(0, 0) scale(0.96); opacity: 0.4; }
          100% { transform: translate(0, 0) scale(0.6); opacity: 0; }
        }
        @keyframes capsule-particle {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          60% { opacity: 0; }
          75% { opacity: 0.9; }
          100% { transform: translate(var(--px), var(--py)) scale(0); opacity: 0; }
        }
        @keyframes checkpoint-scan-sweep {
          0%, 100% { opacity: 0; transform: translateY(-100%); }
          40%, 60% { opacity: 1; transform: translateY(0%); }
          80% { opacity: 0; transform: translateY(100%); }
        }
        .checkpoint-diamond {
          transform: rotate(45deg);
        }
        .checkpoint-scan {
          background: linear-gradient(
            to bottom,
            transparent 0%,
            hsl(var(--feature-catalog) / 0.5) 50%,
            transparent 100%
          );
          height: 100%;
        }
        @media (prefers-reduced-motion: reduce) {
          .capsule-anim, .checkpoint-scan { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function NodeLabel({
  label,
  sub,
  align = "left",
}: {
  label: string;
  sub: string;
  align?: "left" | "right";
}) {
  return (
    <div
      className={
        "flex flex-col gap-1 border border-border/60 bg-black/40 px-4 py-3 " +
        (align === "right" ? "text-right" : "")
      }
    >
      <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
        [ {label} ]
      </span>
      <span className="font-mono text-sm text-foreground">{sub}</span>
    </div>
  );
}

function Capsule({
  sample,
  active,
  index,
}: {
  sample: CallSample;
  active: boolean;
  index: number;
}) {
  const colour =
    sample.verdict === "allow"
      ? "text-[hsl(var(--feature-catalog))] border-[hsl(var(--feature-catalog))]/60"
      : "text-[hsl(var(--status-failed))] border-[hsl(var(--status-failed))]/60";
  const animation =
    sample.verdict === "allow" ? "capsule-pass" : "capsule-deny";

  return (
    <div
      className="absolute left-1/2 top-0"
      style={{
        opacity: active ? 1 : 0,
      }}
    >
      <div
        className={`capsule-anim relative -translate-x-1/2 border ${colour} bg-black/80 px-3 py-1.5 backdrop-blur-sm`}
        style={{
          animation: active
            ? `${animation} ${STAGGER_MS}ms linear forwards`
            : "none",
          animationDelay: active ? "0ms" : undefined,
        }}
      >
        <span className="font-mono text-[12px]">{sample.call}</span>
        {sample.verdict === "deny" && active && <DenyParticles index={index} />}
      </div>
    </div>
  );
}

function DenyParticles({ index }: { index: number }) {
  // 14-particle radial dissolve; deterministic per-index so the visual
  // is recording-stable.
  const particles = Array.from({ length: 14 }, (_, i) => {
    const seed = (index * 137 + i * 53) % 360;
    const angle = (seed / 360) * Math.PI * 2;
    const dist = 18 + ((seed * 7) % 20);
    return {
      px: Math.cos(angle) * dist,
      py: Math.sin(angle) * dist,
    };
  });
  return (
    <div className="pointer-events-none absolute inset-0">
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 size-1 rounded-full bg-[hsl(var(--status-failed))]"
          style={{
            ["--px" as string]: `${p.px}px`,
            ["--py" as string]: `${p.py}px`,
            animation: `capsule-particle ${STAGGER_MS}ms linear forwards`,
          }}
        />
      ))}
    </div>
  );
}
