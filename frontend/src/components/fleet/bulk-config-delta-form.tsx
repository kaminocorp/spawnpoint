"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectError } from "@connectrpc/connect";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_DEPLOYMENT_VALUES,
  DEFAULT_REGION,
  REPLICA_BOUNDS,
  SIZE_PRESETS,
  findMatchingPreset,
  type CpuKind,
  type LifecycleMode,
  type RestartPolicy,
  type SizePreset,
} from "@/lib/spawn/deployment-presets";
import { createApiClient } from "@/lib/api/client";
import type { AgentInstance, BulkConfigDelta, Region } from "@/gen/corellia/v1/agents_pb";

/**
 * `<BulkConfigDeltaForm>` — Phase 8 of fleet-control. Five field
 * sections (region / size / replicas / restart / lifecycle) — no
 * volume per decision 8.4 and the proto's `BulkConfigDelta` shape.
 *
 * Each section has a leading "Don't change" checkbox (default
 * CHECKED → skip). Unchecking reveals the editable input and marks
 * the field as user-applied. On submit, every field is filled — skipped
 * fields fall back to the common-among-selection value, or the
 * baseline default if the selection diverges. The wire shape is
 * always a complete `BulkConfigDelta`; the BE applies it uniformly.
 *
 * Q7 (mixed restart policies): when policy is in skip mode AND the
 * selection has mixed policies, the `restartMaxRetries` input is
 * disabled with a tooltip ("only applies when policy is on-failure").
 */

export type BulkSelectionSummary = {
  /** Pre-fill values: per-field, the common value across selection or
   *  `null` when the selection diverges. The form falls back to
   *  `DEFAULT_DEPLOYMENT_VALUES` for null entries. */
  region: string | null;
  size: { cpuKind: CpuKind; cpus: number; memoryMb: number } | null;
  desiredReplicas: number | null;
  restartPolicy: RestartPolicy | null;
  restartMaxRetries: number | null;
  lifecycleMode: LifecycleMode | null;
};

export function summarizeSelection(
  instances: AgentInstance[],
): BulkSelectionSummary {
  const allEqual = <T,>(get: (i: AgentInstance) => T): T | null => {
    if (instances.length === 0) return null;
    const first = get(instances[0]);
    return instances.every((i) => Object.is(get(i), first)) ? first : null;
  };
  const region = allEqual((i) => i.region || "");
  const cpuKind = allEqual((i) => (i.cpuKind || "shared") as CpuKind);
  const cpus = allEqual((i) => i.cpus || 1);
  const memoryMb = allEqual((i) => i.memoryMb || 512);
  const desiredReplicas = allEqual((i) => i.desiredReplicas || 1);
  const restartPolicy = allEqual(
    (i) => (i.restartPolicy || "on-failure") as RestartPolicy,
  );
  const restartMaxRetries = allEqual((i) => i.restartMaxRetries || 0);
  const lifecycleMode = allEqual(
    (i) => (i.lifecycleMode || "always-on") as LifecycleMode,
  );
  return {
    region: region && region.length > 0 ? region : null,
    size:
      cpuKind && cpus !== null && memoryMb !== null
        ? { cpuKind, cpus, memoryMb }
        : null,
    desiredReplicas,
    restartPolicy,
    restartMaxRetries,
    lifecycleMode,
  };
}

type Skips = {
  region: boolean;
  size: boolean;
  replicas: boolean;
  restart: boolean;
  lifecycle: boolean;
};

const ALL_SKIPPED: Skips = {
  region: true,
  size: true,
  replicas: true,
  restart: true,
  lifecycle: true,
};

export type BulkConfigDeltaFormProps = {
  instances: AgentInstance[];
  /** Submit handler. Receives a fully-populated BulkConfigDelta and
   *  the set of fields the operator explicitly applied (so the modal
   *  can refuse a no-op submit). */
  onSubmit: (
    delta: BulkConfigDelta,
    appliedFields: Array<keyof Skips>,
  ) => void;
  submitLabel?: string;
};

export function BulkConfigDeltaForm({
  instances,
  onSubmit,
  submitLabel = "› PREVIEW",
}: BulkConfigDeltaFormProps) {
  const summary = useMemo(() => summarizeSelection(instances), [instances]);

  const [skips, setSkips] = useState<Skips>(ALL_SKIPPED);
  const [region, setRegion] = useState<string>(
    summary.region ?? DEFAULT_REGION,
  );
  const [cpuKind, setCpuKind] = useState<CpuKind>(
    summary.size?.cpuKind ?? DEFAULT_DEPLOYMENT_VALUES.cpuKind,
  );
  const [cpus, setCpus] = useState<number>(
    summary.size?.cpus ?? DEFAULT_DEPLOYMENT_VALUES.cpus,
  );
  const [memoryMb, setMemoryMb] = useState<number>(
    summary.size?.memoryMb ?? DEFAULT_DEPLOYMENT_VALUES.memoryMb,
  );
  const [replicas, setReplicas] = useState<number>(
    summary.desiredReplicas ?? DEFAULT_DEPLOYMENT_VALUES.desiredReplicas,
  );
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicy>(
    summary.restartPolicy ?? DEFAULT_DEPLOYMENT_VALUES.restartPolicy,
  );
  const [restartMaxRetries, setRestartMaxRetries] = useState<number>(
    summary.restartMaxRetries ?? DEFAULT_DEPLOYMENT_VALUES.restartMaxRetries,
  );
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>(
    summary.lifecycleMode ?? DEFAULT_DEPLOYMENT_VALUES.lifecycleMode,
  );
  const [error, setError] = useState<string | null>(null);

  const toggleSkip = (key: keyof Skips) =>
    setSkips((s) => ({ ...s, [key]: !s[key] }));

  const appliedFields: Array<keyof Skips> = (
    Object.keys(skips) as Array<keyof Skips>
  ).filter((k) => !skips[k]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (appliedFields.length === 0) {
      setError("Pick at least one field to change.");
      return;
    }
    if (replicas < REPLICA_BOUNDS.min || replicas > REPLICA_BOUNDS.max) {
      setError(`Replicas must be ${REPLICA_BOUNDS.min}–${REPLICA_BOUNDS.max}.`);
      return;
    }
    if (cpus < 1 || cpus > 16) {
      setError("vCPUs must be 1–16.");
      return;
    }
    if (memoryMb < 256 || memoryMb % 256 !== 0) {
      setError("Memory must be ≥256MB and a multiple of 256.");
      return;
    }
    if (restartMaxRetries < 0 || restartMaxRetries > 20) {
      setError("Max retries must be 0–20.");
      return;
    }
    setError(null);
    const delta: BulkConfigDelta = {
      $typeName: "corellia.v1.BulkConfigDelta",
      region,
      cpuKind,
      cpus,
      memoryMb,
      restartPolicy,
      restartMaxRetries,
      lifecycleMode,
      desiredReplicas: replicas,
    };
    onSubmit(delta, appliedFields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FieldRow
        label="Region"
        skipped={skips.region}
        onToggle={() => toggleSkip("region")}
        diverges={summary.region === null}
      >
        <RegionInput
          value={region}
          onChange={setRegion}
          disabled={skips.region}
        />
      </FieldRow>

      <FieldRow
        label="Size"
        skipped={skips.size}
        onToggle={() => toggleSkip("size")}
        diverges={summary.size === null}
      >
        <SizeInput
          cpuKind={cpuKind}
          cpus={cpus}
          memoryMb={memoryMb}
          onPick={(p) => {
            setCpuKind(p.cpuKind);
            setCpus(p.cpus);
            setMemoryMb(p.memoryMb);
          }}
          onCustom={(k, c, m) => {
            setCpuKind(k);
            setCpus(c);
            setMemoryMb(m);
          }}
          disabled={skips.size}
        />
      </FieldRow>

      <FieldRow
        label="Replicas"
        skipped={skips.replicas}
        onToggle={() => toggleSkip("replicas")}
        diverges={summary.desiredReplicas === null}
      >
        <Input
          type="number"
          min={REPLICA_BOUNDS.min}
          max={REPLICA_BOUNDS.max}
          value={replicas}
          onChange={(e) => setReplicas(Number(e.target.value))}
          disabled={skips.replicas}
          aria-label="Replicas"
        />
      </FieldRow>

      <FieldRow
        label="Restart policy"
        skipped={skips.restart}
        onToggle={() => toggleSkip("restart")}
        diverges={summary.restartPolicy === null}
      >
        <RestartInput
          policy={restartPolicy}
          maxRetries={restartMaxRetries}
          onPolicy={setRestartPolicy}
          onMaxRetries={setRestartMaxRetries}
          disabled={skips.restart}
          policyDiverges={summary.restartPolicy === null}
        />
      </FieldRow>

      <FieldRow
        label="Lifecycle"
        skipped={skips.lifecycle}
        onToggle={() => toggleSkip("lifecycle")}
        diverges={summary.lifecycleMode === null}
      >
        <Select
          value={lifecycleMode}
          onValueChange={(v) => setLifecycleMode(v as LifecycleMode)}
          disabled={skips.lifecycle}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="always-on">Always on (default)</SelectItem>
            <SelectItem value="manual">Manual start / stop</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      {error && (
        <p className="font-mono text-[11px] text-[hsl(var(--status-failed))]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ─── FIELD ROW ───────────────────────────────────────────────────── */

function FieldRow({
  label,
  skipped,
  onToggle,
  diverges,
  children,
}: {
  label: string;
  skipped: boolean;
  onToggle: () => void;
  diverges: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 border border-border/50 bg-card/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <Label className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </Label>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          <input
            type="checkbox"
            checked={skipped}
            onChange={onToggle}
            className="size-3 accent-[hsl(var(--feature-deploy))]"
          />
          DON&apos;T CHANGE
        </label>
      </div>
      <div className={skipped ? "opacity-50" : ""}>{children}</div>
      {diverges && skipped && (
        <p className="font-mono text-[10px] text-[hsl(var(--status-pending))]">
          ⚠ selection diverges on this field — leaving as &quot;don&apos;t change&quot; preserves each agent&apos;s current value.
        </p>
      )}
    </div>
  );
}

/* ─── REGION ──────────────────────────────────────────────────────── */

function RegionInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listDeploymentRegions({});
        if (cancelled) return;
        setRegions(res.regions.filter((r) => !r.deprecated));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(ConnectError.from(e).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const present = regions.some((r) => r.code === value);
  const allOptions: Region[] = (() => {
    if (loading) return [];
    if (present || !value) return regions;
    return [
      ...regions,
      {
        $typeName: "corellia.v1.Region",
        code: value,
        name: `${value} (custom)`,
        deprecated: false,
        requiresPaidPlan: false,
      } as Region,
    ];
  })();

  return (
    <Select
      value={value || DEFAULT_REGION}
      onValueChange={(v) => onChange(v ?? DEFAULT_REGION)}
      disabled={disabled || loading || !!error}
    >
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={
            loading ? "Loading regions…" : error ? "Region list unavailable" : "Pick a region"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {allOptions.map((r) => (
          <SelectItem key={r.code} value={r.code}>
            {r.code} — {r.name}
            {r.requiresPaidPlan ? " · paid" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─── SIZE ────────────────────────────────────────────────────────── */

function SizeInput({
  cpuKind,
  cpus,
  memoryMb,
  onPick,
  onCustom,
  disabled,
}: {
  cpuKind: CpuKind;
  cpus: number;
  memoryMb: number;
  onPick: (p: SizePreset) => void;
  onCustom: (k: CpuKind, c: number, m: number) => void;
  disabled: boolean;
}) {
  const matched = findMatchingPreset(cpuKind, cpus, memoryMb);
  const [customOpen, setCustomOpen] = useState(!matched);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SIZE_PRESETS.map((p) => {
          const active = matched?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p);
                setCustomOpen(false);
              }}
              disabled={disabled}
              className={
                active
                  ? "border border-[hsl(var(--feature-deploy))] bg-[hsl(var(--feature-deploy))]/15 px-2.5 py-1 font-mono text-[11px] text-foreground disabled:opacity-50"
                  : "border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-[hsl(var(--feature-deploy))]/60 hover:text-foreground disabled:opacity-50"
              }
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v || !matched)}
          disabled={disabled}
          className={
            !matched || customOpen
              ? "border border-[hsl(var(--feature-deploy))] bg-[hsl(var(--feature-deploy))]/15 px-2.5 py-1 font-mono text-[11px] text-foreground disabled:opacity-50"
              : "border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-[hsl(var(--feature-deploy))]/60 hover:text-foreground disabled:opacity-50"
          }
        >
          Custom…
        </button>
      </div>
      {(customOpen || !matched) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select
            value={cpuKind}
            onValueChange={(v) => onCustom(v as CpuKind, cpus, memoryMb)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shared">shared</SelectItem>
              <SelectItem value="performance">performance</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={16}
            value={cpus}
            onChange={(e) => onCustom(cpuKind, Number(e.target.value), memoryMb)}
            disabled={disabled}
            aria-label="vCPUs"
          />
          <Input
            type="number"
            min={256}
            step={256}
            value={memoryMb}
            onChange={(e) => onCustom(cpuKind, cpus, Number(e.target.value))}
            disabled={disabled}
            aria-label="Memory MB"
          />
        </div>
      )}
    </div>
  );
}

/* ─── RESTART ─────────────────────────────────────────────────────── */

function RestartInput({
  policy,
  maxRetries,
  onPolicy,
  onMaxRetries,
  disabled,
  policyDiverges,
}: {
  policy: RestartPolicy;
  maxRetries: number;
  onPolicy: (v: RestartPolicy) => void;
  onMaxRetries: (n: number) => void;
  disabled: boolean;
  policyDiverges: boolean;
}) {
  // Q7: when the operator left policy as "Don't change" AND selected
  // agents have mixed policies, max-retries can't be edited because
  // it only applies under on-failure — surface a tooltip and grey it.
  const retriesDisabled =
    disabled || (policyDiverges && policy !== "on-failure") || policy !== "on-failure";

  return (
    <div className="space-y-2">
      <Select
        value={policy}
        onValueChange={(v) => onPolicy(v as RestartPolicy)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="on-failure">On failure (default)</SelectItem>
          <SelectItem value="always">Always</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
      <div
        className="grid grid-cols-[auto_1fr] items-center gap-2"
        title={
          policy !== "on-failure"
            ? "only applies when policy is on-failure"
            : undefined
        }
      >
        <Label className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/80">
          Max retries
        </Label>
        <Input
          type="number"
          min={0}
          max={20}
          value={maxRetries}
          onChange={(e) => onMaxRetries(Number(e.target.value))}
          disabled={retriesDisabled}
          aria-label="Max retries"
        />
      </div>
    </div>
  );
}
