"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { LockIcon, ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { TerminalContainer } from "@/components/ui/terminal-container";
import { createApiClient } from "@/lib/api/client";
import { getOrgToolCuration, setOrgToolCuration } from "@/lib/api/tools";
import { useUser } from "@/lib/api/user-context";
import type { Tool } from "@/gen/corellia/v1/tools_pb";

/**
 * `<OrgToolCuration>` — v1.5 Pillar B Phase 6.
 *
 * Renders the toolset catalog with an enable/disable toggle per row.
 * Disabled toolsets are filtered out of the spawn-wizard TOOLS step
 * (Phase 4 already wires the `enabledForOrg` filter; this surface is
 * the operator-facing knob that drives that flag).
 *
 * Discovery model: there is no dedicated `ListHarnessAdapters` RPC in
 * v1.5. We derive the in-org adapter set from `listAgentTemplates`
 * (each template carries `harnessAdapterId`); the unique set is then
 * the set of catalogs to fetch. v1.5 ships one Hermes adapter, so the
 * usual case is a single section.
 *
 * Save model: per-tool single-flight latch + optimistic UI. Toggling
 * a row immediately reflects the new state, fires `setOrgToolCuration`,
 * and rolls back on error with a sonner toast. The button stays
 * disabled while the call is in flight to avoid stacking writes
 * against a contested row.
 */
export function OrgToolCuration() {
  const { user } = useUser();
  const isAdmin = user.role === "admin";

  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const templatesRes = await api.agents.listAgentTemplates({});
        const adapterIds = uniqueAdapterIds(
          templatesRes.templates.map((t) => t.harnessAdapterId),
        );
        if (adapterIds.length === 0) {
          if (!cancelled) setState({ kind: "ready", sections: [] });
          return;
        }
        const sections = await Promise.all(
          adapterIds.map(async (id) => {
            const tools = await getOrgToolCuration(api.tools, {
              harnessAdapterId: id,
            });
            return { harnessAdapterId: id, tools };
          }),
        );
        if (!cancelled) setState({ kind: "ready", sections });
      } catch (e) {
        if (!cancelled) {
          setState({ kind: "error", message: ConnectError.from(e).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadKey]);

  async function onToggle(toolId: string, nextEnabled: boolean) {
    if (pending[toolId]) return;
    setPending((p) => ({ ...p, [toolId]: true }));
    setState((prev) => patchToolEnabled(prev, toolId, nextEnabled));
    try {
      const api = createApiClient();
      const updated = await setOrgToolCuration(api.tools, {
        toolId,
        enabled: nextEnabled,
      });
      setState((prev) => replaceTool(prev, updated));
    } catch (e) {
      setState((prev) => patchToolEnabled(prev, toolId, !nextEnabled));
      const err = ConnectError.from(e);
      toast.error(`Could not update toolset: ${err.message}`);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[toolId];
        return next;
      });
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <TerminalContainer title="ADMIN ONLY" accent="failed">
          <div className="flex items-start gap-3 p-1">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-[hsl(var(--status-failed))]" />
            <div className="space-y-1">
              <p className="font-mono text-sm text-foreground">
                Tool curation is restricted to organization admins.
              </p>
              <p className="text-sm text-muted-foreground">
                Ask an admin in your workspace to grant the access you need,
                or to enable the toolsets agents in your org may equip.
              </p>
            </div>
          </div>
        </TerminalContainer>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl uppercase tracking-widest text-foreground">
          Tool Curation
        </h1>
        <p className="text-sm text-muted-foreground">
          Decide which toolsets agents in your organization may equip when
          spawned. Disabled toolsets are hidden from the spawn wizard&apos;s
          TOOLS step. Enforcement of the underlying scopes (URL, command,
          and path allowlists) is handled by the corellia_guard plugin.
        </p>
      </header>

      {state.kind === "loading" && <CatalogSkeleton />}
      {state.kind === "error" && (
        <TerminalContainer title="CATALOG UNAVAILABLE" accent="failed">
          <p className="font-mono text-sm text-foreground">{state.message}</p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={retry}>
              › RETRY
            </Button>
          </div>
        </TerminalContainer>
      )}
      {state.kind === "ready" && state.sections.length === 0 && (
        <TerminalContainer title="NO ADAPTERS" accent="pending">
          <p className="text-sm text-muted-foreground">
            No harness adapters are available in this workspace yet. Spawn an
            agent template first; the catalog populates from the adapters
            referenced by your templates.
          </p>
        </TerminalContainer>
      )}
      {state.kind === "ready" &&
        state.sections.map((section) => (
          <CatalogSection
            key={section.harnessAdapterId}
            section={section}
            pending={pending}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

type CatalogSection = {
  harnessAdapterId: string;
  tools: Tool[];
};

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; sections: CatalogSection[] }
  | { kind: "error"; message: string };

function CatalogSection({
  section,
  pending,
  onToggle,
}: {
  section: CatalogSection;
  pending: Record<string, boolean>;
  onToggle: (toolId: string, enabled: boolean) => void;
}) {
  const enabledCount = section.tools.filter((t) => t.enabledForOrg).length;
  const meta = `${enabledCount}/${section.tools.length} enabled`;
  const adapterVersion = section.tools[0]?.adapterVersion ?? "—";
  return (
    <TerminalContainer
      title={`HARNESS ${adapterVersion}`}
      accent="tools"
      meta={meta}
    >
      <div className="divide-y divide-border">
        {section.tools.map((tool) => (
          <CurationRow
            key={tool.id}
            tool={tool}
            pending={!!pending[tool.id]}
            onToggle={(next) => onToggle(tool.id, next)}
          />
        ))}
      </div>
    </TerminalContainer>
  );
}

function CurationRow({
  tool,
  pending,
  onToggle,
}: {
  tool: Tool;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const enabled = tool.enabledForOrg;
  const oauth = tool.oauthOnly;
  const scopeKeys = useMemo(
    () => Object.keys(tool.scopeShape ?? {}),
    [tool.scopeShape],
  );

  return (
    <div className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-foreground">
            {tool.displayName}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {tool.category}
          </span>
          {oauth && (
            <span className="ml-1 inline-flex items-center gap-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              <LockIcon className="size-3" />
              oauth · v1.6
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{tool.description}</p>
        {scopeKeys.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            scope: {scopeKeys.join(" · ")}
          </p>
        )}
        {tool.requiredEnvVars.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            credential: {tool.requiredEnvVars.join(" / ")}
          </p>
        )}
      </div>
      <Button
        size="xs"
        type="button"
        variant={enabled ? "default" : "outline"}
        disabled={pending || oauth}
        onClick={() => onToggle(!enabled)}
        title={oauth ? "OAuth onboarding lands in v1.6." : undefined}
      >
        {pending
          ? "[ … SAVING ]"
          : enabled
            ? "[ ✓ ENABLED ]"
            : "[ DISABLED ]"}
      </Button>
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 w-full animate-telemetry border border-border bg-card"
        />
      ))}
    </div>
  );
}

function uniqueAdapterIds(ids: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function patchToolEnabled(
  prev: FetchState,
  toolId: string,
  enabled: boolean,
): FetchState {
  if (prev.kind !== "ready") return prev;
  return {
    kind: "ready",
    sections: prev.sections.map((s) => ({
      ...s,
      tools: s.tools.map((t) =>
        t.id === toolId ? ({ ...t, enabledForOrg: enabled } as Tool) : t,
      ),
    })),
  };
}

function replaceTool(prev: FetchState, updated: Tool): FetchState {
  if (prev.kind !== "ready") return prev;
  return {
    kind: "ready",
    sections: prev.sections.map((s) => ({
      ...s,
      tools: s.tools.map((t) => (t.id === updated.id ? updated : t)),
    })),
  };
}
