"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { EyeIcon, EyeOffIcon, KeyIcon, LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createApiClient } from "@/lib/api/client";
import { listTools } from "@/lib/api/tools";
import type { Tool } from "@/gen/corellia/v1/tools_pb";

import type { JsonObject } from "@bufbuild/protobuf";

/**
 * Per-toolset wizard state. `scope` is a free-form JSON object whose keys
 * mirror the catalog row's `scope_shape`. `credential` carries the raw
 * value the operator pasted; per blueprint §11.6 it is forwarded once
 * to the BE secret-store on submit and never persisted client-side.
 */
export type ToolsetState = {
  equipped: boolean;
  scope: Record<string, unknown>;
  credential?: string;
};

export type ToolsetStateMap = Record<string, ToolsetState>;

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; tools: Tool[] }
  | { kind: "error"; message: string };

/**
 * `<ToolsStep>` — the operator-facing milestone of v1.5 Pillar B Phase 4.
 *
 * Fetches the toolset catalog scoped to the harness adapter (filtered to
 * the caller's org by the BE's `ListTools` org-curation merge), renders
 * each toolset as an equippable card, and returns the equipped subset
 * with scopes + credentials when the operator confirms.
 *
 * Phase-4 deviation note: credential capture lives in the UI for parity
 * with the spawn flow's API-key pattern. The wire shape currently sends
 * an empty `credentialStorageRef` because the BE secret-stash leg is
 * scoped for the Phase 4.5 / 5 work — see plan §3 risk row + completion
 * notes. Operators see a clear "captured but not yet wired" notice on
 * any credential field they touch.
 */
export function ToolsStep({
  harnessAdapterId,
  value,
  onConfirm,
  isCurrent,
}: {
  harnessAdapterId: string;
  value: ToolsetStateMap;
  onConfirm: (next: ToolsetStateMap) => void;
  isCurrent: boolean;
}) {
  const [fetch, setFetch] = useState<FetchState>({ kind: "loading" });
  const [draft, setDraft] = useState<ToolsetStateMap>(value);
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isCurrent || !harnessAdapterId) return;
    let cancelled = false;
    (async () => {
      setFetch({ kind: "loading" });
      try {
        const api = createApiClient();
        const tools = await listTools(api.tools, { harnessAdapterId });
        if (cancelled) return;
        setFetch({ kind: "ready", tools });
      } catch (e) {
        if (cancelled) return;
        setFetch({ kind: "error", message: ConnectError.from(e).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCurrent, harnessAdapterId]);

  const visibleTools = useMemo(() => {
    if (fetch.kind !== "ready") return [] as Tool[];
    // Plan §3 Phase 4: org-curated-out toolsets are hidden entirely
    // (locked rendering is reserved for OAuth-only).
    return fetch.tools.filter((t) => t.enabledForOrg);
  }, [fetch]);

  if (fetch.kind === "loading") {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 w-full animate-telemetry border border-border bg-card"
          />
        ))}
      </div>
    );
  }
  if (fetch.kind === "error") {
    return (
      <p className="font-mono text-sm text-[hsl(var(--status-failed))]">
        Could not load toolset catalog: {fetch.message}
      </p>
    );
  }

  function setToolset(key: string, patch: Partial<ToolsetState>) {
    setDraft((prev) => {
      const existing: ToolsetState = prev[key] ?? { equipped: false, scope: {} };
      return { ...prev, [key]: { ...existing, ...patch } };
    });
  }

  function onConfirmClick() {
    const errors: Record<string, string> = {};
    for (const tool of visibleTools) {
      const state = draft[tool.toolsetKey];
      if (!state?.equipped) continue;
      const scopeErr = validateScope(tool, state.scope);
      if (scopeErr) errors[tool.toolsetKey] = scopeErr;
      if (tool.requiredEnvVars.length > 0 && !state.credential) {
        errors[tool.toolsetKey] =
          errors[tool.toolsetKey] ??
          `Credential required (${tool.requiredEnvVars.join(", ")}).`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setSubmitErrors(errors);
      return;
    }
    setSubmitErrors({});
    onConfirm(draft);
  }

  const equippedCount = Object.values(draft).filter((t) => t.equipped).length;

  return (
    <div className="space-y-4">
      <div className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-tools))]">
        [ EQUIP TOOLSETS ]
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Pick the toolsets the agent may call, scope each one, and attach
        credentials where required. URL, command, and path allowlists are
        captured here and enforced by the corellia_guard plugin once Pillar
        B Phase 5 ships.
      </p>

      <div className="space-y-3">
        {visibleTools.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">
            No toolsets available for this harness in your org.
          </p>
        )}
        {visibleTools.map((tool) => (
          <ToolsetCard
            key={tool.id}
            tool={tool}
            state={draft[tool.toolsetKey]}
            onToggle={(equipped) => setToolset(tool.toolsetKey, { equipped })}
            onScopeChange={(scope) => setToolset(tool.toolsetKey, { scope })}
            onCredentialChange={(credential) =>
              setToolset(tool.toolsetKey, { credential })
            }
            error={submitErrors[tool.toolsetKey]}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
          {equippedCount === 0
            ? "no toolsets equipped"
            : equippedCount === 1
              ? "1 toolset equipped"
              : `${equippedCount} toolsets equipped`}
        </div>
        <Button size="sm" type="button" onClick={onConfirmClick}>
          › CONFIRM
        </Button>
      </div>
    </div>
  );
}

function ToolsetCard({
  tool,
  state,
  onToggle,
  onScopeChange,
  onCredentialChange,
  error,
}: {
  tool: Tool;
  state: ToolsetState | undefined;
  onToggle: (equipped: boolean) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
  onCredentialChange: (cred: string) => void;
  error?: string;
}) {
  const equipped = state?.equipped ?? false;

  if (tool.oauthOnly) {
    return (
      <div className="border border-border bg-card p-4 opacity-70">
        <div className="flex items-center gap-2">
          <LockIcon className="size-4 text-muted-foreground" />
          <span className="font-mono text-sm text-foreground">
            {tool.displayName}
          </span>
          <span className="ml-auto font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            [ OAUTH REQUIRED — v1.6 ]
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {tool.description}
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        "border bg-card p-4 transition " +
        (equipped
          ? "border-[hsl(var(--feature-tools))]"
          : "border-border hover:border-[hsl(var(--feature-tools))]/40")
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">
              {tool.displayName}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {tool.category}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
        <Button
          size="xs"
          variant={equipped ? "default" : "outline"}
          type="button"
          onClick={() => onToggle(!equipped)}
        >
          {equipped ? "[ ✓ EQUIPPED ]" : "[ EQUIP ]"}
        </Button>
      </div>

      {equipped && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <ScopeFields
            tool={tool}
            scope={state?.scope ?? {}}
            onChange={onScopeChange}
          />
          {tool.requiredEnvVars.length > 0 && (
            <CredentialField
              envVars={tool.requiredEnvVars}
              value={state?.credential ?? ""}
              onChange={onCredentialChange}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ScopeFields({
  tool,
  scope,
  onChange,
}: {
  tool: Tool;
  scope: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const shape = tool.scopeShape ?? {};
  const keys = Object.keys(shape);
  if (keys.length === 0) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
        no operator-configurable scope
      </p>
    );
  }

  function patch(key: string, value: unknown) {
    onChange({ ...scope, [key]: value });
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => {
        switch (key) {
          case "url_allowlist":
            return (
              <UrlAllowlistInput
                key={key}
                value={asStringArray(scope[key])}
                onChange={(v) => patch(key, v)}
              />
            );
          case "command_allowlist":
            return (
              <CommandAllowlistInput
                key={key}
                value={asStringArray(scope[key])}
                onChange={(v) => patch(key, v)}
              />
            );
          case "path_allowlist":
            return (
              <PathAllowlistInput
                key={key}
                value={asStringArray(scope[key])}
                onChange={(v) => patch(key, v)}
              />
            );
          case "working_directory":
            return (
              <WorkingDirectoryInput
                key={key}
                value={asString(scope[key])}
                onChange={(v) => patch(key, v)}
              />
            );
          default:
            // Unknown shape — render an inert preview so the catalog
            // can introduce new scope keys without crashing the wizard.
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
  );
}

function CredentialField({
  envVars,
  value,
  onChange,
}: {
  envVars: ReadonlyArray<string>;
  value: string;
  onChange: (next: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
        <KeyIcon className="size-3.5 text-[hsl(var(--feature-secrets))]" />
        [ CREDENTIAL · {envVars.join(" / ")} ]
      </div>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder="paste secret…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${envVars.join(", ")} value`}
          className="pr-10 font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide credential" : "Show credential"}
        >
          {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Forwarded once to the agent&apos;s secret store. Never written to
        Corellia&apos;s database.
      </p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--status-pending))]">
        [ STASH WIRING IN PILLAR B PHASE 4.5 ] — captured here today; the
        BE→Fly secret stash lands alongside the manifest env-var resolver.
      </p>
    </div>
  );
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validateScope(
  tool: Tool,
  scope: Record<string, unknown>,
): string | null {
  const shape = tool.scopeShape ?? {};
  for (const key of Object.keys(shape)) {
    const value = scope[key];
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

/**
 * Project the wizard's `ToolsetStateMap` into the GrantInput[] shape the
 * SetInstanceToolGrants RPC expects. Only equipped toolsets are included.
 * Drops `credential` (raw value) — the wire today carries an empty
 * `credentialStorageRef`; see the Phase 4 deviation note in the file
 * header.
 */
export function toolsetMapToGrants(
  toolsets: ToolsetStateMap,
  toolIdByKey: Record<string, string>,
): Array<{ toolId: string; scope: JsonObject }> {
  const out: Array<{ toolId: string; scope: JsonObject }> = [];
  for (const [key, state] of Object.entries(toolsets)) {
    if (!state.equipped) continue;
    const toolId = toolIdByKey[key];
    if (!toolId) continue;
    out.push({ toolId, scope: state.scope as JsonObject });
  }
  return out;
}

/** Summary rows for the Review-step character sheet. */
export function toolsetSummaryRows(
  toolsets: ToolsetStateMap,
): ReadonlyArray<{ label: string; value: string }> {
  const equipped = Object.entries(toolsets).filter(([, s]) => s.equipped);
  if (equipped.length === 0) {
    return [{ label: "TOOLSETS", value: "none equipped" }];
  }
  return equipped.map(([key, s]) => {
    const scopeKeys = Object.keys(s.scope ?? {});
    const detail = scopeKeys.length === 0 ? "" : ` · ${scopeKeys.join(", ")}`;
    const cred = s.credential ? " · credential set" : "";
    return { label: key.toUpperCase(), value: `equipped${detail}${cred}` };
  });
}
