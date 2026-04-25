"use client";

import { useEffect, useState } from "react";
import { ConnectError } from "@connectrpc/connect";

import { AgentTemplateCard } from "@/components/agent-template-card";
import { ComingSoonHarnessCard } from "@/components/coming-soon-harness-card";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
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

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Pick a harness, configure it, and deploy.
          </p>
        </div>

        {state.kind === "loading" && <LoadingGrid />}

        {state.kind === "ready" && (
          <>
            <CatalogGrid>
              {state.templates.map((t) => (
                <AgentTemplateCard key={t.id} template={t} />
              ))}
            </CatalogGrid>
            <ComingSoonSection />
          </>
        )}

        {state.kind === "empty" && <ComingSoonSection />}

        {state.kind === "error" && (
          <div className="mx-auto max-w-md">
            <Card>
              <CardHeader>
                <CardTitle>Couldn&apos;t load harnesses.</CardTitle>
                <CardDescription>{state.message}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function LoadingGrid() {
  return (
    <CatalogGrid>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full" />
      ))}
    </CatalogGrid>
  );
}

function CatalogGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}

function ComingSoonSection() {
  return (
    <section aria-label="Coming soon">
      <div className="my-8 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coming Soon
        </span>
        <Separator className="flex-1" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {COMING_SOON_HARNESSES.map((h) => (
          <ComingSoonHarnessCard key={h.name} {...h} />
        ))}
      </div>
    </section>
  );
}
