"use client";

import { TerminalContainer } from "@/components/ui/terminal-container";

/**
 * Slide 4 — How. "The harness contract + Opus in the loop."
 *
 * Split-screen: left = stack diagram (FE → Connect-go → Domain →
 * DeployTarget → Fly), right = the Opus-4.7 angle (any GitHub repo →
 * Opus reads structure → emits adapter image + corellia.yaml). The
 * Opus pipeline is post-v1 stubbed but architecturally real
 * (`HarnessAdapter.source = hand_written | generated` is in the schema
 * today). Slide narrates that depth.
 */
export function SlideHow() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-10">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-adapter))]">
          [ HOW IT WORKS ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-4xl">
          The harness contract.
          <br />
          <span className="text-[hsl(var(--feature-adapter))]">Opus 4.7 in the loop.</span>
        </h2>
      </div>

      <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT — stack diagram */}
        <TerminalContainer title="ARCHITECTURE" accent="catalog" meta="STACK">
          <ul className="flex flex-col gap-2">
            {[
              { label: "Frontend", detail: "Next.js 15 · App Router" },
              { label: "Wire", detail: "Connect-go RPC · proto IDL" },
              { label: "Domain", detail: "Go · sqlc · Chi" },
              { label: "DeployTarget", detail: "interface · vendor-neutral" },
              { label: "Fly.io", detail: "v1 target · 1 app per agent" },
            ].map((row, i, arr) => (
              <li key={row.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between border border-border/60 bg-black/40 px-3 py-2.5">
                  <span className="font-mono text-sm text-foreground">
                    {row.label}
                  </span>
                  <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                    {row.detail}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <span
                    aria-hidden
                    className="self-center font-mono text-xs text-muted-foreground/50"
                  >
                    ↓
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            AgentTemplates pin by Docker image digest — never mutable tag.
            Governance primitive · no exceptions.
          </p>
        </TerminalContainer>

        {/* RIGHT — Opus 4.7 adapter generation */}
        <TerminalContainer title="ADAPTER PIPELINE" accent="adapter" meta="OPUS 4.7">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border border-[hsl(var(--feature-adapter))]/40 bg-[hsl(var(--feature-adapter))]/5 px-3 py-2.5">
              <span className="font-mono text-sm text-foreground">
                github.com/&lt;any-agent-repo&gt;
              </span>
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                INPUT
              </span>
            </div>
            <span
              aria-hidden
              className="self-center font-mono text-xs text-[hsl(var(--feature-adapter))]"
            >
              ↓
            </span>
            <div className="border border-[hsl(var(--feature-adapter))]/60 bg-[hsl(var(--feature-adapter))]/10 px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-[hsl(var(--feature-adapter))]">
                  OPUS 4.7
                </span>
                <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                  ANALYZE
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-foreground/80">
                <li>· tree-sitter parses repo structure</li>
                <li>· README + Dockerfile feed prompt</li>
                <li>· extract corellia.yaml manifest</li>
                <li>· build & validate adapter image</li>
              </ul>
            </div>
            <span
              aria-hidden
              className="self-center font-mono text-xs text-[hsl(var(--feature-adapter))]"
            >
              ↓
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-border/60 bg-black/40 px-3 py-2.5">
                <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                  ARTIFACT
                </span>
                <p className="mt-1 font-mono text-sm text-foreground">
                  corellia.yaml
                </p>
              </div>
              <div className="border border-border/60 bg-black/40 px-3 py-2.5">
                <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                  ARTIFACT
                </span>
                <p className="mt-1 font-mono text-sm text-foreground">
                  adapter image
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            Hand-written adapter for Hermes. Opus 4.7 writes the rest.
          </p>
        </TerminalContainer>
      </div>

      <p className="max-w-4xl text-center font-mono text-sm leading-relaxed text-foreground/90">
        Built on a strict harness interface contract — runtime, configuration,
        packaging, metadata. Point Corellia at any agent repo on GitHub and it
        generates the adapter for you.
      </p>
    </div>
  );
}
