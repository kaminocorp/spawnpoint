"use client";

/**
 * Slide — TECHNICAL IMPLEMENTATION
 *
 * Three-column layout: Tech Stack | Today | Tomorrow.
 * Each column is a TierBox-style card with sub-grouped badge items.
 * Columns stagger in left-to-right so the presenter can walk each one.
 */

type Group = { label: string; items: readonly string[] };

type Column = {
  id: string;
  label: string;
  accent: string;
  groups: readonly Group[];
};

const COLUMNS: readonly Column[] = [
  {
    id: "stack",
    label: "TECH STACK",
    accent: "--feature-catalog",
    groups: [
      {
        label: "BACKEND",
        items: ["Go 1.26", "Chi router", "Connect-go RPCs", "sqlc · pgx"],
      },
      {
        label: "FRONTEND",
        items: ["Next.js 15 App Router", "TypeScript", "shadcn/ui"],
      },
      {
        label: "DATA & AUTH",
        items: ["Supabase Postgres", "Supabase Auth · ES256 JWT", "Vercel · Fly.io"],
      },
    ],
  },
  {
    id: "today",
    label: "TODAY",
    accent: "--feature-deploy",
    groups: [
      {
        label: "HARNESS",
        items: ["Hermes Agent", "Nous Research"],
      },
      {
        label: "DEPLOYMENT",
        items: ["Fly.io · Firecracker VMs", "AWS underlying", "1 app = 1 agent"],
      },
      {
        label: "GOVERNANCE",
        items: ["Fixed Hermes adapter", "corellia_guard plugin", "Chat sidecar", "Tool permissions"],
      },
    ],
  },
  {
    id: "tomorrow",
    label: "TOMORROW",
    accent: "--feature-adapter",
    groups: [
      {
        label: "HARNESSES",
        items: ["Opus 4.7 adapter gen", "OpenClaw", "CrewAI · AutoGen", "Any GitHub repo"],
      },
      {
        label: "DEPLOYMENT",
        items: ["AWS · GCP · Azure", "Hetzner · bare metal", "Edge & on-prem"],
      },
      {
        label: "GOVERNANCE",
        items: ["Skills registry", "Memory providers", "Full IAM + audit trail"],
      },
    ],
  },
];

function ColumnCard({ col, delay }: { col: Column; delay: number }) {
  const accent = `hsl(var(${col.accent}))`;
  return (
    <div
      className="arch-animate flex flex-col border border-border/60 bg-black/30"
      style={{
        borderLeftColor: accent,
        borderLeftWidth: "2px",
        animation: `arch-in 0.45s ease-out ${delay}ms both`,
      }}
    >
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-2.5">
        <span
          className="font-display text-[11px] uppercase tracking-widest"
          style={{ color: accent }}
        >
          [ {col.label} ]
        </span>
      </div>

      {/* Groups */}
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        {col.groups.map((g) => (
          <div key={g.label}>
            <p className="mb-2 font-display text-[9px] uppercase tracking-widest text-muted-foreground/45">
              {g.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((item) => (
                <span
                  key={item}
                  className="border px-2 py-0.5 font-mono text-[11px] text-foreground/80"
                  style={{ borderColor: `hsl(var(${col.accent}) / 0.35)` }}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SlideThesis() {
  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-6xl flex-col items-center justify-between py-8">
      {/* Title */}
      <div
        className="arch-animate flex flex-col items-center gap-2"
        style={{ animation: "arch-in 0.5s ease-out 0ms both" }}
      >
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-adapter))]">
          [ ARCHITECTURE ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Technical Implementation.
        </h2>
        <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
          Stack · Today · Tomorrow
        </p>
      </div>

      {/* Three columns */}
      <div className="grid w-full grid-cols-3 gap-4">
        {COLUMNS.map((col, i) => (
          <ColumnCard key={col.id} col={col} delay={200 + i * 180} />
        ))}
      </div>

      {/* Footer */}
      <p
        className="arch-animate font-mono text-sm uppercase tracking-wider text-muted-foreground"
        style={{ animation: "arch-in 0.4s ease-out 760ms both" }}
      >
        open · extensible · production-ready
      </p>

      <style>{`
        .arch-animate { opacity: 0; }
        @keyframes arch-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .arch-animate {
            opacity: 1 !important;
            transform: none !important;
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
