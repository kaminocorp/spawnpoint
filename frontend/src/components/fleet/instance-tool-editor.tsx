"use client";

import { useEffect, useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { LockIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TerminalContainer } from "@/components/ui/terminal-container";
import {
  CommandAllowlistInput,
  validateCommandAllowlist,
} from "@/components/spawn/scope-inputs/command-allowlist";
import {
  PathAllowlistInput,
  validatePathAllowlist,
} from "@/components/spawn/scope-inputs/path-allowlist";
import {
  UrlAllowlistInput,
  validateUrlAllowlist,
} from "@/components/spawn/scope-inputs/url-allowlist";
import {
  WorkingDirectoryInput,
  validateWorkingDirectory,
} from "@/components/spawn/scope-inputs/working-directory";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import type { Tool, ToolGrant } from "@/gen/corellia/v1/tools_pb";
import { createApiClient } from "@/lib/api/client";
import {
  getInstanceToolGrants,
  listTools,
  setInstanceToolGrants,
  type GrantInput,
} from "@/lib/api/tools";

import type { JsonObject } from "@bufbuild/protobuf";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: AgentInstance;
  /**
   * The harness adapter the instance was spawned from. Required so we can
   * scope the catalog fetch correctly (`listTools(harnessAdapterId)`).
   * Today this is sourced from the agent template — the fleet-row caller
   * fetches it (the AgentTemplate.harness_adapter_id field shipped in
   * 0.13.3 for the wizard). When the agent_instances list query is
   * widened to project harness_adapter_id, the prop becomes derivable
   * from the instance directly.
   */
  harnessAdapterId: string;
  onChanged: () => void;
};

/**
 * `<InstanceToolEditor>` — v1.5 Pillar B Phase 7. Slide-over panel for
 * editing per-instance tool grants on a running agent. Mounted from the
 * fleet row's `Tools` action.
 *
 * Edit model:
 *   - Lists current grants. Each grant row is editable in place: scope
 *     inputs match the wizard's TOOLS step (URL / command / path / cwd).
 *   - Per-row `[ REVOKE ]` removes the grant from the staged set.
 *   - Catalog dropdown adds a new toolset (defaulted to empty scope).
 *   - Save composes the staged set and calls `setInstanceToolGrants`,
 *     which is atomic at the BE (revoke-all → insert-N → bump-version).
 *
 * Propagation tier (banner above Save):
 *   - **Plugin tick** — only scope changes / revokes on existing grants.
 *     The plugin re-reads scope.json on its next poll (≤35s default TTL)
 *     and the new state takes effect on the next tool call.
 *   - **Restart required** — adding a new toolset, because Hermes's
 *     `platform_toolsets` is read at boot. The `[ ⟳ Restart now ]`
 *     button issues `restartAgentInstance` on the same RPC client; the
 *     audit row is appended server-side.
 */
export function InstanceToolEditor({
  open,
  onOpenChange,
  instance,
  harnessAdapterId,
  onChanged,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <EditorBody
          key={open ? `open-${instance.id}` : "closed"}
          instance={instance}
          harnessAdapterId={harnessAdapterId}
          onClose={() => onOpenChange(false)}
          onChanged={onChanged}
        />
      </SheetContent>
    </Sheet>
  );
}

type EditableGrant = {
  /** Stable react key. Uses the original grant id when present; otherwise a synthetic. */
  rowKey: string;
  /** True iff this grant existed at fetch time. Drives "restart required" diff logic. */
  preexisting: boolean;
  toolId: string;
  toolsetKey: string;
  displayName: string;
  /** scope_shape from the catalog row — drives which inputs render. */
  scopeShape: JsonObject;
  /** mutable scope JSON the operator edits. */
  scope: Record<string, unknown>;
  /** read-only — the BE never returns the raw cred ref to the FE. */
  hasCredential: boolean;
};

type Fetched = {
  grants: ToolGrant[];
  catalog: Tool[];
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: Fetched; staged: EditableGrant[] }
  | { kind: "saving"; data: Fetched; staged: EditableGrant[] }
  | { kind: "restarting"; data: Fetched; staged: EditableGrant[] }
  | { kind: "error"; message: string };

function EditorBody({
  instance,
  harnessAdapterId,
  onClose,
  onChanged,
}: {
  instance: AgentInstance;
  harnessAdapterId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const [grantsRes, catalog] = await Promise.all([
          getInstanceToolGrants(api.tools, { instanceId: instance.id }),
          listTools(api.tools, { harnessAdapterId }),
        ]);
        if (cancelled) return;
        const data = { grants: grantsRes, catalog };
        setState({
          kind: "ready",
          data,
          staged: grantsRes.map((g) => grantToEditable(g, catalog, true)),
        });
      } catch (e) {
        if (!cancelled) {
          setState({ kind: "error", message: ConnectError.from(e).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instance.id, harnessAdapterId, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);

  if (state.kind === "loading") {
    return (
      <div className="space-y-4 p-1">
        <SheetHeader>
          <SheetTitle>{instance.name}</SheetTitle>
          <SheetDescription>Loading tool grants…</SheetDescription>
        </SheetHeader>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 w-full animate-telemetry border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-4 p-1">
        <SheetHeader>
          <SheetTitle>{instance.name}</SheetTitle>
        </SheetHeader>
        <TerminalContainer title="GRANTS UNAVAILABLE" accent="failed">
          <p className="font-mono text-sm text-foreground">{state.message}</p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={retry}>
              › RETRY
            </Button>
          </div>
        </TerminalContainer>
      </div>
    );
  }

  const { data, staged } = state;
  const isMutating = state.kind === "saving" || state.kind === "restarting";

  // Diff-based propagation tier. Comparing staged against the original grants
  // tells us whether any toolset was added or removed (restart-required) or
  // only scope changed on existing toolsets (plugin-tick).
  const tier = computePropagationTier(data.grants, staged);

  // Catalog filtered to "available to add" — already-equipped toolsets are
  // hidden from the dropdown so the operator can't double-equip.
  //
  // Credential-bearing toolsets (`requiredEnvVars.length > 0`) are excluded
  // from the inspector's add list: in-flight credential capture has its own
  // UX surface (key rotation modal) that lands in v1.6. The BE's
  // SetInstanceGrants reattaches credential refs from prior grants for
  // existing rows, so editing scope on an already-equipped credential-bearing
  // toolset works correctly — it's only *adding new* ones from the inspector
  // that's gated. The wizard remains the spawn-time entry point for
  // credential-bearing toolsets.
  const stagedToolIds = new Set(staged.map((g) => g.toolId));
  const addable = data.catalog.filter(
    (t) =>
      t.enabledForOrg &&
      !t.oauthOnly &&
      t.requiredEnvVars.length === 0 &&
      !stagedToolIds.has(t.id),
  );
  const credLocked = data.catalog.filter(
    (t) =>
      t.enabledForOrg &&
      !t.oauthOnly &&
      t.requiredEnvVars.length > 0 &&
      !stagedToolIds.has(t.id),
  );

  function patchScope(rowKey: string, scope: Record<string, unknown>) {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      return {
        ...prev,
        staged: prev.staged.map((g) =>
          g.rowKey === rowKey ? { ...g, scope } : g,
        ),
      };
    });
  }

  function revoke(rowKey: string) {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      return { ...prev, staged: prev.staged.filter((g) => g.rowKey !== rowKey) };
    });
  }

  function addGrant(toolId: string) {
    const tool = data.catalog.find((t) => t.id === toolId);
    if (!tool) return;
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const next: EditableGrant = {
        rowKey: `new-${toolId}-${Date.now()}`,
        preexisting: false,
        toolId,
        toolsetKey: tool.toolsetKey,
        displayName: tool.displayName,
        scopeShape: tool.scopeShape ?? {},
        scope: {},
        hasCredential: false,
      };
      return { ...prev, staged: [...prev.staged, next] };
    });
  }

  async function save() {
    // Validate every staged grant before sending — the BE rejects bad scope
    // anyway, but local validation gives the operator inline error feedback
    // without a round-trip.
    for (const g of staged) {
      const err = validateScope(g);
      if (err) {
        toast.error(`${g.displayName}: ${err}`);
        return;
      }
    }
    setState((prev) => (prev.kind === "ready" ? { ...prev, kind: "saving" } : prev));
    try {
      const api = createApiClient();
      const grants: GrantInput[] = staged.map((g) => ({
        toolId: g.toolId,
        scope: g.scope as JsonObject,
        // credentialStorageRef is intentionally omitted — credential capture
        // for *new* grants from the inspector is reserved for v1.6 (the
        // wizard already captures creds at spawn time; in-flight credential
        // capture has its own UX surface to design).
      }));
      await setInstanceToolGrants(api.tools, {
        instanceId: instance.id,
        grants,
      });
      toast.success(`Updated ${instance.name}'s tool grants.`);
      onChanged();
      retry(); // refetch the canonical post-write state into the editor
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
      setState((prev) => (prev.kind === "saving" ? { ...prev, kind: "ready" } : prev));
    }
  }

  async function restart() {
    setState((prev) => (prev.kind === "ready" ? { ...prev, kind: "restarting" } : prev));
    try {
      const api = createApiClient();
      await api.agents.restartAgentInstance({ id: instance.id });
      toast.success(`Restarted ${instance.name}.`);
      onChanged();
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
    } finally {
      setState((prev) =>
        prev.kind === "restarting" ? { ...prev, kind: "ready" } : prev,
      );
    }
  }

  return (
    <div className="space-y-4 p-1">
      <SheetHeader>
        <SheetTitle>{instance.name}</SheetTitle>
        <SheetDescription>
          Edit which toolsets the agent may call and how each is scoped.
          Changes apply via the manifest poll daemon (≤35s) for scope edits;
          adding or removing a toolset requires a restart.
        </SheetDescription>
      </SheetHeader>

      <TerminalContainer
        title="GRANTS"
        accent="tools"
        meta={`${staged.length} equipped`}
      >
        {staged.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">
            No toolsets equipped. Add one below or close this panel to leave
            the agent without tools.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {staged.map((g) => (
              <GrantRow
                key={g.rowKey}
                grant={g}
                isMutating={isMutating}
                onScopeChange={(s) => patchScope(g.rowKey, s)}
                onRevoke={() => revoke(g.rowKey)}
              />
            ))}
          </div>
        )}
      </TerminalContainer>

      {addable.length > 0 && (
        <TerminalContainer title="ADD TOOLSET" accent="tools">
          <div className="flex flex-wrap gap-2">
            {addable.map((t) => (
              <Button
                key={t.id}
                size="xs"
                variant="outline"
                disabled={isMutating}
                onClick={() => addGrant(t.id)}
              >
                + {t.displayName}
              </Button>
            ))}
          </div>
        </TerminalContainer>
      )}

      {credLocked.length > 0 && (
        <TerminalContainer title="REQUIRES CREDENTIAL — V1.6">
          <p className="font-mono text-xs text-muted-foreground">
            These toolsets need a secret value (e.g. API key) at equip time.
            In-flight credential capture from the inspector lands in v1.6.
            Equip them through the spawn wizard for now.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {credLocked.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                <LockIcon className="size-3" />
                {t.displayName}
                <span className="ml-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
                  · {t.requiredEnvVars.join(" / ")}
                </span>
              </span>
            ))}
          </div>
        </TerminalContainer>
      )}

      <PropagationBanner tier={tier} />

      <div className="flex items-center justify-end gap-2">
        {tier === "restart-required" && (
          <Button
            size="sm"
            variant="outline"
            onClick={restart}
            disabled={isMutating}
            title="Restart now to apply platform_toolsets changes immediately."
          >
            <RefreshCwIcon className="size-3.5" />
            {state.kind === "restarting" ? "Restarting…" : "Restart now"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={isMutating}>
          Close
        </Button>
        <Button size="sm" onClick={save} disabled={isMutating || tier === "no-change"}>
          {state.kind === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function GrantRow({
  grant,
  isMutating,
  onScopeChange,
  onRevoke,
}: {
  grant: EditableGrant;
  isMutating: boolean;
  onScopeChange: (next: Record<string, unknown>) => void;
  onRevoke: () => void;
}) {
  const keys = Object.keys(grant.scopeShape);

  function patch(key: string, value: unknown) {
    onScopeChange({ ...grant.scope, [key]: value });
  }

  return (
    <div className="space-y-3 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-foreground">
          {grant.displayName}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {grant.toolsetKey}
        </span>
        {!grant.preexisting && (
          <span className="font-display text-[10px] uppercase tracking-widest text-[hsl(var(--feature-tools))]">
            new
          </span>
        )}
        {grant.hasCredential && (
          <span className="ml-1 inline-flex items-center gap-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            <LockIcon className="size-3" />
            credential set
          </span>
        )}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={onRevoke}
          disabled={isMutating}
          aria-label={`Revoke ${grant.displayName}`}
        >
          <Trash2Icon className="size-3.5" />
          Revoke
        </Button>
      </div>

      {keys.length === 0 ? (
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
          no operator-configurable scope
        </p>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => {
            switch (key) {
              case "url_allowlist":
                return (
                  <UrlAllowlistInput
                    key={key}
                    value={asStringArray(grant.scope[key])}
                    onChange={(v) => patch(key, v)}
                  />
                );
              case "command_allowlist":
                return (
                  <CommandAllowlistInput
                    key={key}
                    value={asStringArray(grant.scope[key])}
                    onChange={(v) => patch(key, v)}
                  />
                );
              case "path_allowlist":
                return (
                  <PathAllowlistInput
                    key={key}
                    value={asStringArray(grant.scope[key])}
                    onChange={(v) => patch(key, v)}
                  />
                );
              case "working_directory":
                return (
                  <WorkingDirectoryInput
                    key={key}
                    value={asString(grant.scope[key])}
                    onChange={(v) => patch(key, v)}
                  />
                );
              default:
                return (
                  <div
                    key={key}
                    className="rounded-sm border border-dashed border-border p-2 font-mono text-[11px] text-muted-foreground"
                  >
                    <div className="uppercase tracking-wider">[ {key} ]</div>
                    <div className="mt-1 text-muted-foreground/60">
                      shape not yet wired in this build
                    </div>
                  </div>
                );
            }
          })}
        </div>
      )}
    </div>
  );
}

function PropagationBanner({ tier }: { tier: PropagationTier }) {
  if (tier === "no-change") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
        no pending changes
      </p>
    );
  }
  if (tier === "plugin-tick") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--feature-tools))]">
        plugin tick — applies within ~35s on next tool call
      </p>
    );
  }
  return (
    <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--status-pending))]">
      restart required — applies on next agent boot
    </p>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

type PropagationTier = "no-change" | "plugin-tick" | "restart-required";

function computePropagationTier(
  original: ToolGrant[],
  staged: EditableGrant[],
): PropagationTier {
  const originalById = new Map(original.map((g) => [g.toolId, g]));
  const stagedById = new Map(staged.map((g) => [g.toolId, g]));

  // Add or remove a toolset → restart-required (Hermes's platform_toolsets
  // is only read at boot; new toolsets need their register_tools() called).
  for (const id of stagedById.keys()) {
    if (!originalById.has(id)) return "restart-required";
  }
  for (const id of originalById.keys()) {
    if (!stagedById.has(id)) return "restart-required";
  }

  // Same set of toolsets — diff scope_json. Any change is plugin-tick.
  for (const [id, staged] of stagedById) {
    const orig = originalById.get(id)!;
    const origScope = (orig.scope ?? {}) as Record<string, unknown>;
    if (!shallowJsonEqual(origScope, staged.scope)) return "plugin-tick";
  }
  return "no-change";
}

function grantToEditable(
  grant: ToolGrant,
  catalog: Tool[],
  preexisting: boolean,
): EditableGrant {
  const tool = catalog.find((t) => t.id === grant.toolId);
  return {
    rowKey: grant.id || `existing-${grant.toolId}`,
    preexisting,
    toolId: grant.toolId,
    toolsetKey: grant.toolsetKey,
    displayName: grant.displayName,
    scopeShape: tool?.scopeShape ?? {},
    scope: (grant.scope ?? {}) as Record<string, unknown>,
    hasCredential: grant.hasCredential,
  };
}

function validateScope(grant: EditableGrant): string | null {
  for (const key of Object.keys(grant.scopeShape)) {
    const value = grant.scope[key];
    switch (key) {
      case "url_allowlist": {
        const err = validateUrlAllowlist(asStringArray(value));
        if (err) return err;
        break;
      }
      case "command_allowlist": {
        const err = validateCommandAllowlist(asStringArray(value));
        if (err) return err;
        break;
      }
      case "path_allowlist": {
        const err = validatePathAllowlist(asStringArray(value));
        if (err) return err;
        break;
      }
      case "working_directory": {
        const err = validateWorkingDirectory(asString(value));
        if (err) return err;
        break;
      }
    }
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Order-insensitive structural compare used by the propagation-tier diff.
 *
 * `JSON.stringify` honours insertion order, which means an object spread
 * (`{...prev, foo: bar}`) can produce a stringification that differs from the
 * server-canonical order even when the contents are identical — the editor
 * would then mis-classify a no-op edit as `plugin-tick`. This walks the trees
 * and compares values directly: arrays element-wise (order-sensitive — patterns
 * are positional), objects key-by-key (order-insensitive). Primitive equality
 * uses ===; nested objects/arrays recurse.
 *
 * Inputs are scope JSON values which are bounded (≤64 patterns × ≤200 chars
 * per the BE scope_validator); recursion depth and cost are negligible.
 */
function shallowJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowJsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
      if (!shallowJsonEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
