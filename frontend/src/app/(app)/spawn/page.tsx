"use client";

import { useEffect, useState } from "react";
import { ConnectError } from "@connectrpc/connect";

import { RosterCard } from "@/components/spawn/roster-card";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";
import { HARNESSES, type HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * `/spawn` — character roster.
 *
 * Phase 3 of `docs/executing/agents-ui-mods.md`. The page reads as a
 * curated row of selectable operators: one active card per harness in
 * `harnesses.ts` whose `status === "available"` AND whose `key` matches a
 * live `AgentTemplate.name`, every other harness rendered locked.
 *
 * Decision 21 ceiling: at most one nebula `<Canvas>` mounts page-wide.
 * `<RosterCard kind="active">` is the *only* place a `<NebulaAvatar>` is
 * mounted; locked cards render `<AvatarFallback>` directly.
 */

type State =
  | { kind: "loading" }
  | { kind: "ready"; templates: AgentTemplate[] }
  | { kind: "error"; message: string };

export default function SpawnPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
        setState({ kind: "ready", templates: res.templates });
      } catch (e) {
        if (cancelled) return;
        const err = ConnectError.from(e);
        setState({ kind: "error", message: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableCount = HARNESSES.filter((h) => h.status === "available").length;
  const lockedCount = HARNESSES.length - availableCount;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ LAUNCHPAD ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            SPAWN
          </h1>
        </div>
        <div className="flex items-center gap-4 font-display text-[10px] uppercase tracking-widest">
          <span className="text-[hsl(var(--feature-catalog))]">
            {availableCount} AVAILABLE
          </span>
          <span className="text-muted-foreground">{lockedCount} LOCKED</span>
        </div>
      </header>

      <TerminalContainer
        title="AVAILABLE HARNESSES"
        accent="catalog"
        meta={`${HARNESSES.length} HARNESSES`}
      >
        {state.kind === "loading" && <RosterSkeleton />}
        {state.kind === "error" && (
          <p className="font-mono text-xs text-[hsl(var(--status-failed))]">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && (
          <RosterGrid>
            {HARNESSES.map((harness) => (
              <RosterCardSlot
                key={harness.key}
                harness={harness}
                templates={state.templates}
              />
            ))}
          </RosterGrid>
        )}
      </TerminalContainer>
    </div>
  );
}

/**
 * Render the right `<RosterCard>` variant for one harness entry.
 *
 * An "available" entry only renders as active when a live `AgentTemplate`
 * matches by `name.toLowerCase() === harness.key`. If the BE hasn't
 * registered the matching template (transient deploy state, fresh DB,
 * harness key typo), it falls through to the locked variant — defensive,
 * keeps the visual layout stable, and surfaces the gap as something the
 * operator can notice.
 */
function RosterCardSlot({
  harness,
  templates,
}: {
  harness: HarnessEntry;
  templates: AgentTemplate[];
}) {
  if (harness.status === "available") {
    const template = templates.find(
      (t) => t.name.toLowerCase() === harness.key,
    );
    if (template) {
      return <RosterCard kind="active" harness={harness} template={template} />;
    }
  }
  return <RosterCard kind="locked" harness={harness} />;
}

function RosterSkeleton() {
  // Six telemetry-pulse blocks at the same dimensions a real card occupies
  // (~440px tall: 240px avatar + ~200px chrome). Keeps layout reflow at
  // zero between loading and ready states.
  return (
    <RosterGrid>
      {Array.from({ length: HARNESSES.length }).map((_, i) => (
        <div
          key={i}
          className="h-[440px] w-full border border-border bg-card animate-telemetry"
        />
      ))}
    </RosterGrid>
  );
}

function RosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}
