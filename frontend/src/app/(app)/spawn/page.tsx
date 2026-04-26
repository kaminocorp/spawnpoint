"use client";

import { useEffect, useState } from "react";
import { ConnectError } from "@connectrpc/connect";

import { AgentTemplateCard } from "@/components/agent-template-card";
import { ComingSoonHarnessCard } from "@/components/coming-soon-harness-card";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import { COMING_SOON_HARNESSES } from "@/lib/agents/coming-soon";
import { createApiClient } from "@/lib/api/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; templates: AgentTemplate[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export default function AgentsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
        if (res.templates.length === 0) {
          setState({ kind: "empty" });
        } else {
          setState({ kind: "ready", templates: res.templates });
        }
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

  const availableCount =
    state.kind === "ready" ? state.templates.length : 0;
  const plannedCount = COMING_SOON_HARNESSES.length;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ DEPLOY ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            AGENTS
          </h1>
        </div>
        <div className="flex items-center gap-4 font-display text-[10px] uppercase tracking-widest">
          <span className="text-[hsl(var(--feature-catalog))]">
            {availableCount} AVAILABLE
          </span>
          <span className="text-muted-foreground">
            {plannedCount} PLANNED
          </span>
        </div>
      </header>

      <TerminalContainer
        title="AVAILABLE HARNESSES"
        accent="catalog"
        meta={`${availableCount} ENTRIES`}
      >
        {state.kind === "loading" && <LoadingGrid />}
        {state.kind === "error" && (
          <p className="font-mono text-xs text-[hsl(var(--status-failed))]">
            {state.message}
          </p>
        )}
        {state.kind === "empty" && (
          <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">
            › NO HARNESSES REGISTERED
          </p>
        )}
        {state.kind === "ready" && (
          <CatalogGrid>
            {state.templates.map((t) => (
              <AgentTemplateCard key={t.id} template={t} />
            ))}
          </CatalogGrid>
        )}
      </TerminalContainer>

      <TerminalContainer
        title="PLANNED HARNESSES"
        meta={`${plannedCount} QUEUED`}
      >
        <CatalogGrid>
          {COMING_SOON_HARNESSES.map((h) => (
            <ComingSoonHarnessCard key={h.name} {...h} />
          ))}
        </CatalogGrid>
      </TerminalContainer>
    </div>
  );
}

function LoadingGrid() {
  return (
    <CatalogGrid>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-44 w-full border border-border bg-card animate-telemetry"
        />
      ))}
    </CatalogGrid>
  );
}

function CatalogGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}
