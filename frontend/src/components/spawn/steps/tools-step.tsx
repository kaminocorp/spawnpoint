"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import {
  Clock3Icon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  MessageSquareIcon,
  NetworkIcon,
  ShieldIcon,
  TerminalIcon,
} from "lucide-react";

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
    return fetch.tools.filter((t) => t.enabledForOrg);
  }, [fetch]);

  if (fetch.kind === "loading") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
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
    <div className="space-y-3">
      <div className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-tools))]">
        [ INVENTORY ]
      </div>

      {visibleTools.length === 0 ? (
        <p className="font-mono text-sm text-muted-foreground">
          No toolsets available for this harness in your org.
        </p>
      ) : (
        <div className="grid grid-cols-2 items-start gap-2">
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
      )}

      <div className="flex items-center justify-between border-t border-border pt-2.5">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
          {equippedCount === 0
            ? "nothing equipped"
            : equippedCount === 1
              ? "1 equipped"
              : `${equippedCount} equipped`}
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
      <div className="flex flex-col items-center gap-2 border border-border/30 bg-card/60 p-3 opacity-40">
        <div className="flex size-9 shrink-0 items-center justify-center border border-border/30 bg-black/20 text-muted-foreground/50">
          {renderToolIcon(tool, "size-4")}
        </div>
        <div className="line-clamp-2 text-center font-display text-[9px] uppercase leading-tight tracking-[0.14em] text-muted-foreground">
          {tool.displayName}
        </div>
        <LockIcon className="size-2.5 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      className={[
        "border bg-card transition-colors",
        equipped
          ? "border-[hsl(var(--feature-tools))]/60"
          : "border-border/40 hover:border-[hsl(var(--feature-tools))]/30",
      ].join(" ")}
    >
      {/* Inventory tile — click to toggle equip */}
      <button
        type="button"
        onClick={() => onToggle(!equipped)}
        className="flex w-full flex-col items-center gap-2 p-3 text-center"
      >
        {/* Icon */}
        <div
          className={[
            "flex size-9 shrink-0 items-center justify-center border transition-colors",
            equipped
              ? "border-[hsl(var(--feature-tools))]/60 bg-[hsl(var(--feature-tools))]/10 text-[hsl(var(--feature-tools))]"
              : "border-border/40 bg-black/30 text-muted-foreground/60",
          ].join(" ")}
        >
          {renderToolIcon(tool, "size-4")}
        </div>

        {/* Name + category */}
        <div className="w-full space-y-0.5">
          <div
            className={[
              "line-clamp-2 font-display text-[9px] uppercase leading-tight tracking-[0.14em]",
              equipped
                ? "text-[hsl(var(--feature-tools))]"
                : "text-foreground/80",
            ].join(" ")}
          >
            {tool.displayName}
          </div>
          <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/40">
            {tool.category}
          </div>
        </div>

        {/* Equip indicator */}
        <div
          className={[
            "flex items-center gap-1 font-mono text-[8px] uppercase tracking-widest",
            equipped
              ? "text-[hsl(var(--feature-tools))]"
              : "text-muted-foreground/40",
          ].join(" ")}
        >
          <div
            className={[
              "size-1.5 rounded-full",
              equipped
                ? "bg-[hsl(var(--feature-tools))]"
                : "border border-muted-foreground/30",
            ].join(" ")}
          />
          {equipped ? "equipped" : "equip"}
        </div>
      </button>

      {/* Scope drawer — expands when equipped */}
      {equipped && (
        <div className="space-y-2 border-t border-[hsl(var(--feature-tools))]/20 p-2.5">
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
          {error && (
            <p className="font-mono text-[9px] text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function renderToolIcon(tool: Tool, className: string) {
  const key = tool.toolsetKey.toLowerCase();
  const name = tool.displayName.toLowerCase();
  const category = tool.category.toLowerCase();

  if (key.includes("browser") || name.includes("browser")) {
    return <GlobeIcon className={className} />;
  }
  if (key.includes("clarify") || name.includes("clarify")) {
    return <MessageSquareIcon className={className} />;
  }
  if (key.includes("code") || name.includes("code")) {
    return <CodeIcon className={className} />;
  }
  if (key.includes("cron") || name.includes("cron")) {
    return <Clock3Icon className={className} />;
  }
  if (key.includes("delegat") || name.includes("delegat")) {
    return <NetworkIcon className={className} />;
  }
  if (key.includes("file") || name.includes("file")) {
    return <FolderIcon className={className} />;
  }
  if (key.includes("shell") || name.includes("shell")) {
    return <TerminalIcon className={className} />;
  }
  if (category.includes("compute")) {
    return <CodeIcon className={className} />;
  }
  if (category.includes("info")) {
    return <ShieldIcon className={className} />;
  }
  return <ShieldIcon className={className} />;
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
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
        no scope required
      </p>
    );
  }

  function patch(key: string, value: unknown) {
    onChange({ ...scope, [key]: value });
  }

  return (
    <div className="space-y-2">
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
            return (
              <div
                key={key}
                className="border border-dashed border-border p-2 font-mono text-[9px] text-muted-foreground"
              >
                <div className="uppercase tracking-wider">[ {key} ]</div>
                <div className="mt-0.5 text-muted-foreground/50">
                  not yet wired
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
      <div className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-widest text-muted-foreground/70">
        <KeyIcon className="size-3 text-[hsl(var(--feature-secrets))]" />
        {envVars[0]}
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
          className="h-7 pr-8 font-mono text-[10px]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide" : "Show"}
        >
          {show ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
        </button>
      </div>
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
