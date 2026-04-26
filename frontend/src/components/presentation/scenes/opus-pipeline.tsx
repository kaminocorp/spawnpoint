"use client";

import { useEffect, useState } from "react";

/**
 * Slide 5 — `<OpusPipeline>`.
 *
 * Three-stage scene rendered as CSS animation:
 *
 *   1. github URL "unfolds" into a 3D file-tree cascade (1.5s)
 *   2. OPUS 4.7 scan beam sweeps top-to-bottom, dimming each glyph (1.5s)
 *   3. corellia.yaml + adapter image crystallise on the right (2s)
 *   4. settle (2s)
 *
 * Q7 — the scan beam reuses the nebula shader family in spirit: it's
 * a thin horizontal band with a soft simplex-noise filter on the
 * gradient so the beam *flickers* like the nebula's edge rather than
 * being a hard geometric strip. Implemented as a CSS gradient with
 * `mix-blend-mode: screen` plus a subtle box-shadow halo — visually
 * adjacent without paying for another R3F canvas.
 *
 * Real repo per Q5: `github.com/nousresearch/hermes-agent`.
 */

const TREE_FILES = [
  { depth: 0, name: "hermes-agent/" },
  { depth: 1, name: "Dockerfile" },
  { depth: 1, name: "README.md" },
  { depth: 1, name: "pyproject.toml" },
  { depth: 1, name: "src/" },
  { depth: 2, name: "agent.py" },
  { depth: 2, name: "tools/" },
  { depth: 3, name: "web_search.py" },
  { depth: 3, name: "shell.py" },
  { depth: 1, name: "tests/" },
  { depth: 2, name: "test_agent.py" },
];

const STAGE_MS = {
  cascade: 1500,
  scan: 1500,
  crystallize: 2000,
  settle: 2000,
};

type Stage = "cascade" | "scan" | "crystallize" | "settle";

export function OpusPipeline() {
  const [stage, setStage] = useState<Stage>("cascade");

  useEffect(() => {
    const tid1 = setTimeout(() => setStage("scan"), STAGE_MS.cascade);
    const tid2 = setTimeout(
      () => setStage("crystallize"),
      STAGE_MS.cascade + STAGE_MS.scan,
    );
    const tid3 = setTimeout(
      () => setStage("settle"),
      STAGE_MS.cascade + STAGE_MS.scan + STAGE_MS.crystallize,
    );
    return () => {
      clearTimeout(tid1);
      clearTimeout(tid2);
      clearTimeout(tid3);
    };
  }, []);

  const showCrystals = stage === "crystallize" || stage === "settle";

  return (
    <div className="relative grid w-full max-w-6xl grid-cols-[1.2fr_auto_1fr] items-center gap-8">
      {/* LEFT — github URL + file tree cascade */}
      <div className="relative">
        <div className="mb-3 border border-[hsl(var(--feature-adapter))]/40 bg-[hsl(var(--feature-adapter))]/5 px-3 py-2">
          <span className="font-mono text-[13px] text-foreground">
            github.com/nousresearch/hermes-agent
          </span>
        </div>

        <div className="relative h-[260px] overflow-hidden border border-border/60 bg-black/40 px-4 py-3">
          <ul className="flex flex-col gap-1 font-mono text-[11px] text-foreground/85">
            {TREE_FILES.map((f, i) => (
              <li
                key={i}
                className="opus-tree-row"
                style={{
                  paddingLeft: `${f.depth * 14}px`,
                  animationDelay: `${i * 110}ms`,
                }}
              >
                <span className="text-muted-foreground/60">
                  {f.depth === 0 ? "" : "│ ".repeat(f.depth - 1) + "├─ "}
                </span>
                {f.name}
              </li>
            ))}
          </ul>

          {/* Scan beam */}
          {(stage === "scan" || stage === "crystallize") && <ScanBeam />}
        </div>
      </div>

      {/* CENTER — directional arrow */}
      <div className="flex flex-col items-center gap-2 font-mono text-xs text-[hsl(var(--feature-adapter))]">
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          OPUS 4.7
        </span>
        <span aria-hidden className="text-2xl">
          →
        </span>
        <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground/60">
          ANALYZE
        </span>
      </div>

      {/* RIGHT — crystallized artifacts */}
      <div className="flex flex-col gap-3">
        <Crystal label="corellia.yaml" delay={0} show={showCrystals} />
        <Crystal label="adapter image" delay={300} show={showCrystals} />
      </div>

      <style>{`
        .opus-tree-row {
          opacity: 0;
          transform: translateX(-8px);
          animation: opus-tree-cascade 0.5s ease-out forwards;
        }
        @keyframes opus-tree-cascade {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes opus-scan-sweep {
          from { transform: translateY(-100%); }
          to   { transform: translateY(100%); }
        }
        @keyframes opus-crystallize {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .opus-tree-row, .opus-scan-beam, .opus-crystal {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function ScanBeam() {
  return (
    <div
      aria-hidden
      className="opus-scan-beam pointer-events-none absolute inset-x-0 top-0 h-full"
      style={{
        animation: `opus-scan-sweep ${STAGE_MS.scan}ms ease-in-out forwards`,
      }}
    >
      <div
        className="h-12 w-full"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, hsl(var(--feature-adapter) / 0.55) 45%, hsl(var(--feature-adapter) / 0.85) 50%, hsl(var(--feature-adapter) / 0.55) 55%, transparent 100%)",
          boxShadow: "0 0 24px hsl(var(--feature-adapter) / 0.4)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

function Crystal({
  label,
  delay,
  show,
}: {
  label: string;
  delay: number;
  show: boolean;
}) {
  return (
    <div
      className={`opus-crystal border border-[hsl(var(--feature-adapter))]/60 bg-[hsl(var(--feature-adapter))]/8 px-4 py-3 ${
        show ? "" : "opacity-0"
      }`}
      style={{
        animation: show
          ? `opus-crystallize 600ms ease-out forwards`
          : undefined,
        animationDelay: `${delay}ms`,
      }}
    >
      <span className="block font-display text-[10px] uppercase tracking-widest text-muted-foreground">
        ARTIFACT
      </span>
      <span className="mt-1 block font-mono text-sm font-bold text-foreground">
        {label}
      </span>
    </div>
  );
}
