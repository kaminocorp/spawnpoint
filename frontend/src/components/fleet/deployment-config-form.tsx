"use client";

import { useEffect, useState } from "react";
import {
  useForm,
  useWatch,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { createApiClient } from "@/lib/api/client";
import {
  DEFAULT_DEPLOYMENT_VALUES,
  DEFAULT_REGION,
  REPLICA_BOUNDS,
  SIZE_PRESETS,
  VOLUME_BOUNDS_GB,
  findMatchingPreset,
  type CpuKind,
  type DeploymentConfigValues,
  type LifecycleMode,
  type RestartPolicy,
  type SizePreset,
} from "@/lib/spawn/deployment-presets";
import type { Region } from "@/gen/corellia/v1/agents_pb";

/**
 * `<DeploymentConfigForm>` — shared by the spawn wizard's Step 4
 * (Phase 6) and the fleet inspector's edit form (Phase 7). Single
 * form, single zod schema, single set of preset chips. Wizard side
 * disables nothing; the inspector will pass `disabledFields` to
 * lock the immutable knobs (region change is a destroy-respawn —
 * Phase 7 raises a destructive-confirmation modal).
 */

export const deploymentConfigSchema = z.object({
  region: z.string().min(1, "Required"),
  cpuKind: z.enum(["shared", "performance"], { message: "Pick a class" }),
  cpus: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(1, "At least 1")
    .max(16, "Up to 16 vCPUs"),
  memoryMb: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(256, "At least 256MB")
    .max(131072, "Up to 128GB")
    .refine((v) => v % 256 === 0, "Must be a multiple of 256"),
  restartPolicy: z.enum(["no", "always", "on-failure"], {
    message: "Pick a restart policy",
  }),
  restartMaxRetries: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(0, "0 or more")
    .max(20, "Up to 20"),
  lifecycleMode: z.enum(["always-on", "manual", "idle-on-demand", "suspended"], {
    message: "Pick a lifecycle",
  }),
  desiredReplicas: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(REPLICA_BOUNDS.min, `At least ${REPLICA_BOUNDS.min}`)
    .max(REPLICA_BOUNDS.max, `v1 caps replicas at ${REPLICA_BOUNDS.max}`),
  volumeSizeGb: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(VOLUME_BOUNDS_GB.min, `At least ${VOLUME_BOUNDS_GB.min}GB`)
    .max(VOLUME_BOUNDS_GB.max, `Up to ${VOLUME_BOUNDS_GB.max}GB`),
  // M-chat Phase 5: default-on "Enable chat" toggle. When false, the
  // adapter image starts no sidecar and exposes no :443 endpoint.
  chatEnabled: z.boolean(),
});

export type DeploymentFormValues = z.infer<typeof deploymentConfigSchema>;

export type DeploymentConfigFormProps = {
  /** Initial values; falls back to `DEFAULT_DEPLOYMENT_VALUES`. */
  defaults?: Partial<DeploymentConfigValues>;
  /** Submit handler. Receives the validated form values. */
  onSubmit: (values: DeploymentFormValues) => void;
  /** Submit button label. Defaults to `› CONFIRM`. */
  submitLabel?: string;
  /**
   * Field keys that should render read-only because the live-update
   * path can't apply them. Today only `chatEnabled` is supported here:
   * toggling chat post-spawn requires an add/remove of the Fly
   * services block, which `mergeMachineConfig` doesn't handle, so the
   * inspector locks it and points the operator at destroy + respawn.
   */
  lockedFields?: ReadonlyArray<keyof DeploymentFormValues>;
};

export function DeploymentConfigForm({
  defaults,
  onSubmit,
  submitLabel = "› CONFIRM",
  lockedFields = [],
}: DeploymentConfigFormProps) {
  const merged = { ...DEFAULT_DEPLOYMENT_VALUES, ...defaults };
  const form = useForm<DeploymentFormValues>({
    resolver: zodResolver(deploymentConfigSchema),
    defaultValues: merged,
  });

  const isLocked = (k: keyof DeploymentFormValues) => lockedFields.includes(k);

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="space-y-5"
    >
      <RegionField form={form} />
      <SizeField form={form} />
      <VolumeField form={form} />
      <ReplicasField form={form} />
      <RestartField form={form} />
      <LifecycleField form={form} />
      <ChatEnabledField form={form} locked={isLocked("chatEnabled")} />

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ─── REGION ──────────────────────────────────────────────────────── */

/**
 * Fetches the cached region list once on mount. The list comes from
 * the BE's in-memory cache (`FlyDeployTarget.regions`, refreshed
 * hourly per fleet-control plan §4 Phase 3) so this RPC is cheap.
 */
function useDeploymentRegions(): {
  regions: Region[];
  loading: boolean;
  error: string | null;
} {
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

  return { regions, loading, error };
}

function RegionField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  const value = useWatch({ control: form.control, name: "region" });
  const { regions, loading, error } = useDeploymentRegions();

  // If the cached region list comes back without the operator's
  // chosen value (deprecated, mis-typed, or just slow boot), keep
  // the chosen value selectable so the form doesn't quietly drop
  // it. The placement check on Review is the safety net.
  const allOptions: Region[] = (() => {
    if (loading) return [];
    const present = regions.some((r) => r.code === value);
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
    <div className="space-y-1.5">
      <Label htmlFor="region">Region</Label>
      <Select
        value={value || DEFAULT_REGION}
        onValueChange={(v) =>
          form.setValue("region", v ?? DEFAULT_REGION, { shouldValidate: true })
        }
        disabled={loading || !!error}
      >
        <SelectTrigger id="region" className="w-full">
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
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Where the agent&apos;s machine(s) will run. Default is{" "}
          <code className="text-foreground">{DEFAULT_REGION}</code>.
        </p>
      )}
      {form.formState.errors.region?.message && (
        <p className="text-sm text-destructive">
          {form.formState.errors.region.message}
        </p>
      )}
    </div>
  );
}

/* ─── SIZE (preset chips + Custom…) ───────────────────────────────── */

function SizeField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  const cpuKind = useWatch({ control: form.control, name: "cpuKind" });
  const cpus = useWatch({ control: form.control, name: "cpus" });
  const memoryMb = useWatch({ control: form.control, name: "memoryMb" });

  const matched = findMatchingPreset(cpuKind, cpus, memoryMb);
  const [customOpen, setCustomOpen] = useState(!matched);

  const selectPreset = (p: SizePreset) => {
    form.setValue("cpuKind", p.cpuKind, { shouldValidate: true });
    form.setValue("cpus", p.cpus, { shouldValidate: true });
    form.setValue("memoryMb", p.memoryMb, { shouldValidate: true });
    setCustomOpen(false);
  };

  const sizeError =
    form.formState.errors.cpus?.message ||
    form.formState.errors.memoryMb?.message ||
    form.formState.errors.cpuKind?.message;

  return (
    <div className="space-y-2">
      <Label>Size</Label>
      <div className="flex flex-wrap gap-1.5">
        {SIZE_PRESETS.map((p) => {
          const active = matched?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p)}
              className={
                active
                  ? "border border-[hsl(var(--feature-deploy))] bg-[hsl(var(--feature-deploy))]/15 px-3 py-1.5 font-mono text-xs text-foreground"
                  : "border border-border bg-card px-3 py-1.5 font-mono text-sm text-muted-foreground transition hover:border-[hsl(var(--feature-deploy))]/60 hover:text-foreground"
              }
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v || !matched)}
          className={
            !matched || customOpen
              ? "border border-[hsl(var(--feature-deploy))] bg-[hsl(var(--feature-deploy))]/15 px-3 py-1.5 font-mono text-xs text-foreground"
              : "border border-border bg-card px-3 py-1.5 font-mono text-sm text-muted-foreground transition hover:border-[hsl(var(--feature-deploy))]/60 hover:text-foreground"
          }
        >
          Custom…
        </button>
      </div>

      {(customOpen || !matched) && (
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cpuKind">CPU class</Label>
            <Select
              value={cpuKind}
              onValueChange={(v) =>
                form.setValue("cpuKind", v as CpuKind, { shouldValidate: true })
              }
            >
              <SelectTrigger id="cpuKind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">shared</SelectItem>
                <SelectItem value="performance">performance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpus">vCPUs</Label>
            <Input
              id="cpus"
              type="number"
              min={1}
              max={16}
              {...form.register("cpus", { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memoryMb">Memory (MB)</Label>
            <Input
              id="memoryMb"
              type="number"
              min={256}
              step={256}
              {...form.register("memoryMb", { valueAsNumber: true })}
            />
          </div>
        </div>
      )}

      {sizeError && <p className="text-sm text-destructive">{sizeError}</p>}
    </div>
  );
}

/* ─── VOLUME ──────────────────────────────────────────────────────── */

function VolumeField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="volumeSizeGb">Volume size (GB)</Label>
      <Input
        id="volumeSizeGb"
        type="number"
        min={VOLUME_BOUNDS_GB.min}
        max={VOLUME_BOUNDS_GB.max}
        aria-invalid={!!form.formState.errors.volumeSizeGb}
        {...form.register("volumeSizeGb", { valueAsNumber: true })}
      />
      <p className="text-sm text-muted-foreground">
        Persistent storage for the agent&apos;s memory, skills, and
        conversation history. Mounted at{" "}
        <code className="text-foreground">/opt/data</code>. Can be increased
        later but never decreased.
      </p>
      {form.formState.errors.volumeSizeGb?.message && (
        <p className="text-sm text-destructive">
          {form.formState.errors.volumeSizeGb.message}
        </p>
      )}
    </div>
  );
}

/* ─── REPLICAS ────────────────────────────────────────────────────── */

function ReplicasField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="desiredReplicas">Replicas per agent</Label>
      <Input
        id="desiredReplicas"
        type="number"
        min={REPLICA_BOUNDS.min}
        max={REPLICA_BOUNDS.max}
        aria-invalid={!!form.formState.errors.desiredReplicas}
        {...form.register("desiredReplicas", { valueAsNumber: true })}
      />
      <p className="text-sm text-muted-foreground">
        How many machines to run for this agent. Use &gt;1 for capacity.{" "}
        <span className="text-foreground">
          Note: each replica gets its own volume — replicas don&apos;t share
          state.
        </span>
      </p>
      {form.formState.errors.desiredReplicas?.message && (
        <p className="text-sm text-destructive">
          {form.formState.errors.desiredReplicas.message}
        </p>
      )}
    </div>
  );
}

/* ─── RESTART POLICY (radio + conditional max-retries) ────────────── */

function RestartField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  const policy = useWatch({ control: form.control, name: "restartPolicy" });

  const options: ReadonlyArray<{ value: RestartPolicy; label: string }> = [
    { value: "on-failure", label: "On failure (default)" },
    { value: "always", label: "Always" },
    { value: "no", label: "No" },
  ];

  return (
    <div className="space-y-2">
      <Label>Restart policy</Label>
      <div
        role="radiogroup"
        aria-label="Restart policy"
        className="flex flex-col gap-1"
      >
        {options.map((opt) => {
          const active = policy === opt.value;
          return (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 font-mono text-xs"
            >
              <input
                type="radio"
                name="restartPolicy"
                value={opt.value}
                checked={active}
                onChange={() =>
                  form.setValue("restartPolicy", opt.value, {
                    shouldValidate: true,
                  })
                }
                className="size-3 accent-[hsl(var(--feature-deploy))]"
              />
              <span className={active ? "text-foreground" : "text-muted-foreground"}>
                {opt.label}
              </span>
            </label>
          );
        })}
      </div>

      {policy === "on-failure" && (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="restartMaxRetries">Max retries</Label>
          <Input
            id="restartMaxRetries"
            type="number"
            min={0}
            max={20}
            aria-invalid={!!form.formState.errors.restartMaxRetries}
            {...form.register("restartMaxRetries", { valueAsNumber: true })}
          />
          {form.formState.errors.restartMaxRetries?.message && (
            <p className="text-sm text-destructive">
              {form.formState.errors.restartMaxRetries.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── LIFECYCLE ───────────────────────────────────────────────────── */

function LifecycleField({
  form,
}: {
  form: UseFormReturn<DeploymentFormValues>;
}) {
  const value = useWatch({ control: form.control, name: "lifecycleMode" });

  return (
    <div className="space-y-1.5">
      <Label htmlFor="lifecycleMode">Lifecycle</Label>
      <Select
        value={value}
        onValueChange={(v) =>
          form.setValue("lifecycleMode", v as LifecycleMode, {
            shouldValidate: true,
          })
        }
      >
        <SelectTrigger id="lifecycleMode" className="w-full">
          <SelectValue placeholder="Pick a lifecycle" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="always-on">Always on (default)</SelectItem>
          <SelectItem value="manual">
            Manual start / stop
          </SelectItem>
          <SelectItem value="idle-on-demand" disabled>
            Idle on demand · Coming when secure agent endpoints ship
          </SelectItem>
          <SelectItem value="suspended" disabled>
            Suspended · Coming when secure agent endpoints ship
          </SelectItem>
        </SelectContent>
      </Select>
      {value === "manual" && (
        <p className="text-sm text-muted-foreground">
          Agent only runs when you start it from the fleet page.
        </p>
      )}
      {form.formState.errors.lifecycleMode?.message && (
        <p className="text-sm text-destructive">
          {form.formState.errors.lifecycleMode.message}
        </p>
      )}
    </div>
  );
}

/* ─── CHAT ENABLED ────────────────────────────────────────────────── */

function ChatEnabledField({
  form,
  locked,
}: {
  form: UseFormReturn<DeploymentFormValues>;
  locked?: boolean;
}) {
  const checked = useWatch({ control: form.control, name: "chatEnabled" });
  const isOn = checked ?? true;

  return (
    <div className="space-y-1.5">
      <Label>Chat</Label>
      <label
        className={
          locked
            ? "flex cursor-not-allowed items-center gap-3 opacity-70"
            : "flex cursor-pointer items-center gap-3"
        }
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border border-input bg-background accent-primary disabled:opacity-50"
          checked={isOn}
          disabled={locked}
          onChange={(e) => {
            if (locked) return;
            form.setValue("chatEnabled", e.target.checked, {
              shouldValidate: true,
            });
          }}
        />
        <span className="font-mono text-xs text-foreground">
          Enable chat
          {locked && (
            <span className="ml-2 text-muted-foreground">
              ({isOn ? "currently on" : "currently off"})
            </span>
          )}
        </span>
      </label>
      <p className="text-sm text-muted-foreground">
        {locked ? (
          <>
            Chat enablement maps to a Fly services-block change that the
            live-update path doesn&apos;t apply. To toggle chat, destroy and
            respawn this agent with the new setting.
          </>
        ) : (
          <>
            Enables the Corellia chat panel for this agent. When on, a sidecar
            process exposes <code className="text-foreground">/chat</code> on
            the agent&apos;s machine. Disabling saves resources and removes
            inbound HTTPS exposure.
          </>
        )}
      </p>
    </div>
  );
}
