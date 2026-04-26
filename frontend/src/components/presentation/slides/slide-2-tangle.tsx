"use client";

import { TangleWeb } from "../scenes/tangle-web";

type Problem = {
  num: string;
  label: string;
  accent: string; // CSS var name e.g. "--feature-catalog"
  body: string;
  tags: readonly string[];
};

const PROBLEMS: readonly Problem[] = [
  {
    num: "01",
    label: "FIND HARNESS",
    accent: "--feature-catalog",
    body: 'A rapidly evolving, fragmented landscape. What even counts as an "agent"? Hundreds of frameworks, zero clear standard.',
    tags: ["LangGraph", "CrewAI", "AutoGen", "Hermes", "+200 more"],
  },
  {
    num: "02",
    label: "DEPLOYMENT",
    accent: "--feature-deploy",
    body: "Mac mini? AWS? Hetzner? Every choice risks lock-in. Enterprises need flexibility — but deep infra expertise isn't cheap.",
    tags: ["AWS", "Fly.io", "Hetzner", "Azure", "bare metal"],
  },
  {
    num: "03",
    label: "TOOLS & ACCESS",
    accent: "--feature-tools",
    body: "Skills on GitHub, MCPs scattered on X, Dropbox + Drive permissions. Fine for one agent. A nightmare at 250.",
    tags: ["MCPs", "Google Drive", "Dropbox", "GitHub", "X / Twitter"],
  },
  {
    num: "04",
    label: "OVERSIGHT",
    accent: "--feature-adapter",
    body: "Who has which agent? What can it access? All tracked manually today — requiring deep technical expertise across your org.",
    tags: ["access control", "audit trail", "IAM", "manual today"],
  },
];

function ProblemCard({ problem, delay }: { problem: Problem; delay: number }) {
  const accentColor = `hsl(var(${problem.accent}))`;
  return (
    <div
      className="tangle-card border border-border/60 bg-black/40 backdrop-blur-sm"
      style={{
        borderLeftColor: accentColor,
        borderLeftWidth: "2px",
        animation: `tangle-in 0.45s ease-out ${delay}ms both`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <span
          className="font-display text-xs leading-none"
          style={{ color: accentColor }}
        >
          ›
        </span>
        <span
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: accentColor }}
        >
          [ {problem.label} ]
        </span>
        <span className="ml-auto font-mono text-[9px] text-muted-foreground/40">
          {problem.num}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
          {problem.body}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {problem.tags.map((tag) => (
            <span
              key={tag}
              className="border px-2 py-0.5 font-mono text-[9px] text-foreground/60"
              style={{ borderColor: `hsl(var(${problem.accent}) / 0.3)` }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Slide 2 — TANGLE · "Find. Deploy. Equip. Govern."
 *
 * TangleWeb chaos stays as backdrop. The copy layer is four TierBox-style
 * problem cards (matching slide-6 architecture), staggered in with arch-in.
 */
export function SlideTangle({ collapsing = false }: { collapsing?: boolean }) {
  return (
    <div className="relative flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-center gap-8 px-6">
      <div className="absolute inset-0 -z-10">
        <TangleWeb collapsing={collapsing} />
      </div>

      {/* Title */}
      <div
        className="tangle-card flex flex-col items-center gap-3"
        style={{ animation: "tangle-in 0.5s ease-out 0ms both" }}
      >
        <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          [ TODAY ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Find. Deploy. Equip. Govern.
        </h2>
        <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
          Four problems. No unified tooling.
        </p>
      </div>

      {/* Problem cards */}
      <div className="grid w-full grid-cols-2 gap-3 sm:gap-4">
        {PROBLEMS.map((p, i) => (
          <ProblemCard key={p.num} problem={p} delay={200 + i * 130} />
        ))}
      </div>

      <style>{`
        .tangle-card { opacity: 0; }
        @keyframes tangle-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tangle-card {
            opacity: 1 !important;
            transform: none !important;
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
