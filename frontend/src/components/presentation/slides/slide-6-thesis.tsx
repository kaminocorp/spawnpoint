"use client";

/**
 * Slide 6 — GOVERNANCE-AS-A-SERVICE
 *
 * Technical architecture overview: three stacked tiers (Control Plane →
 * API + Governance Engine → Agent Infrastructure) with module badges and
 * stack annotations. Each tier and connector animates in with a stagger
 * so the diagram builds as the presenter narrates.
 */

type Tier = {
  id: string;
  label: string;
  accent: string; // CSS var name e.g. "--feature-catalog"
  modules: readonly string[];
  tech: string;
};

const TIERS: readonly Tier[] = [
  {
    id: "control",
    label: "CONTROL PLANE",
    accent: "--feature-catalog",
    modules: ["Spawn Wizard", "Fleet View", "Inspector", "Chat Panel"],
    tech: "Next.js 15 App Router  ·  Vercel  ·  TypeScript  ·  shadcn/ui  ·  Connect-go TS",
  },
  {
    id: "api",
    label: "API · GOVERNANCE ENGINE",
    accent: "--feature-adapter",
    modules: [
      "Connect-go RPCs",
      "JWT Auth",
      "Tool Manifest",
      "corellia_guard",
      "sqlc / pgx",
    ],
    tech: "Go 1.26  ·  Chi  ·  Supabase Postgres  ·  ES256 JWKS  ·  Fly.io  ·  Buf Proto IDL",
  },
  {
    id: "infra",
    label: "AGENT INFRASTRUCTURE",
    accent: "--feature-deploy",
    modules: ["Hermes Adapter", "Chat Sidecar", "Digest Pin", "CORELLIA_* env"],
    tech: "Fly.io Machines (Firecracker)  ·  1 app = 1 agent  ·  Docker  ·  digest-pinned images",
  },
];

const ARROWS = [
  "Connect RPCs  ·  HTTP/1.1 JSON  ·  Supabase ES256 JWT",
  "Fly Machines API  ·  secrets injection  ·  /health probe",
];

function TierBox({ tier, delay }: { tier: Tier; delay: number }) {
  const accentColor = `hsl(var(${tier.accent}))`;
  return (
    <div
      className="arch-animate border border-border/60 bg-black/30"
      style={{
        borderLeftColor: accentColor,
        borderLeftWidth: "2px",
        animation: `arch-in 0.45s ease-out ${delay}ms both`,
      }}
    >
      <div className="border-b border-border/40 px-4 py-2">
        <span
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: accentColor }}
        >
          [ {tier.label} ]
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {tier.modules.map((m) => (
            <span
              key={m}
              className="border px-2 py-0.5 font-mono text-[10px] text-foreground/80"
              style={{ borderColor: `hsl(var(${tier.accent}) / 0.4)` }}
            >
              {m}
            </span>
          ))}
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/80">
          {tier.tech}
        </p>
      </div>
    </div>
  );
}

function ArrowConnector({ label, delay }: { label: string; delay: number }) {
  return (
    <div
      className="arch-animate flex items-center gap-3 px-5 py-1.5"
      style={{ animation: `arch-in 0.4s ease-out ${delay}ms both` }}
    >
      <div className="flex flex-col items-center">
        <div className="h-3 w-px bg-border/50" />
        <span className="font-mono text-[10px] leading-none text-muted-foreground/50">
          ▾
        </span>
      </div>
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/55">
        {label}
      </span>
    </div>
  );
}

export function SlideThesis() {
  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center gap-8">
      {/* Title */}
      <div
        className="arch-animate flex flex-col items-center gap-2"
        style={{ animation: "arch-in 0.5s ease-out 0ms both" }}
      >
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-adapter))]">
          [ ARCHITECTURE ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Governance-as-a-Service.
        </h2>
      </div>

      {/* Three-tier architecture diagram */}
      <div className="w-full">
        {TIERS.map((tier, i) => (
          <div key={tier.id}>
            <TierBox tier={tier} delay={200 + i * 220} />
            {i < ARROWS.length && (
              <ArrowConnector label={ARROWS[i]} delay={280 + i * 220} />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <p
        className="arch-animate font-mono text-sm uppercase tracking-wider text-muted-foreground"
        style={{ animation: "arch-in 0.4s ease-out 920ms both" }}
      >
        one proto IDL · buf generate → Go + TS · single source of truth
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
