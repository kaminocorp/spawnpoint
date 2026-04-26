"use client";

import { useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TerminalContainer } from "@/components/ui/terminal-container";
import { StatusBadge } from "@/components/fleet/status-badge";
import {
  DeploymentConfigForm,
  type DeploymentFormValues,
} from "@/components/fleet/deployment-config-form";
import {
  DriftCategory,
  UpdateKind,
  type AgentInstance,
  type DeployConfig,
  type DriftEntry,
  type UpdateResult,
} from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";
import { describeSize } from "@/lib/spawn/deployment-presets";
import type {
  CpuKind,
  LifecycleMode,
  RestartPolicy,
} from "@/lib/spawn/deployment-presets";

/**
 * `<DeploymentInspector>` — Phase 7 of fleet-control. Slide-over
 * panel mounted from the fleet row's `Deployment` action. Three
 * panes (toggled by `mode` state):
 *
 *   1. `view`     — read-only spec sheet of the live config + per-replica volumes.
 *   2. `edit`     — `<DeploymentConfigForm>` seeded from the live config.
 *   3. `preview`  — UpdateResult from a `dry_run=true` apply, with the right
 *                   confirmation copy (silent / brief restart / destructive).
 *
 * Region change is the only operation that wipes persistent state today; the
 * preview pane gates the apply behind an explicit checkbox per resolved Q14.
 *
 * Volume-shrink is rejected at submit time (not at zod-validation time —
 * the form has no current-size knowledge until a caller passes it).
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: AgentInstance;
  /** Refetch the fleet list after a successful apply. */
  onChanged: () => void;
};

type Mode =
  | { kind: "view" }
  | { kind: "edit" }
  | { kind: "preview"; values: DeploymentFormValues; result: UpdateResult }
  | { kind: "previewing" }
  | { kind: "applying" }
  | { kind: "error"; message: string };

export function DeploymentInspector({
  open,
  onOpenChange,
  instance,
  onChanged,
}: Props) {
  // Inner body keyed on instance.id so each re-open starts in the
  // view pane with no half-edited preview state bleeding through —
  // satisfies `react-hooks/set-state-in-effect` without needing a
  // reset effect (key change is the React-idiomatic reset signal).
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <InspectorBody
          key={open ? `open-${instance.id}` : "closed"}
          instance={instance}
          onClose={() => onOpenChange(false)}
          onChanged={onChanged}
        />
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({
  instance,
  onClose,
  onChanged,
}: {
  instance: AgentInstance;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const currentValues = deploymentValuesFromInstance(instance);

  async function runPreview(values: DeploymentFormValues) {
    if (values.volumeSizeGb < instance.volumeSizeGb) {
      toast.error(
        "Volumes can only be extended. To shrink, you'd need to destroy and recreate the agent — losing its persistent state.",
      );
      return;
    }
    setMode({ kind: "previewing" });
    try {
      const api = createApiClient();
      const res = await api.agents.updateAgentDeployConfig({
        instanceId: instance.id,
        deployConfig: deployConfigFromValues(values),
        dryRun: true,
      });
      const result = res.updateResult;
      if (!result) {
        setMode({ kind: "error", message: "no update result returned" });
        return;
      }
      setMode({ kind: "preview", values, result });
      setConfirmDestructive(false);
    } catch (e) {
      setMode({ kind: "error", message: ConnectError.from(e).message });
    }
  }

  async function applyChange() {
    if (mode.kind !== "preview") return;
    setMode({ kind: "applying" });
    try {
      const api = createApiClient();
      await api.agents.updateAgentDeployConfig({
        instanceId: instance.id,
        deployConfig: deployConfigFromValues(mode.values),
        dryRun: false,
      });
      toast.success(`Updated ${instance.name}.`);
      onChanged();
      onClose();
    } catch (e) {
      setMode({ kind: "error", message: ConnectError.from(e).message });
    }
  }

  return (
    <>
      <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{instance.name}</SheetTitle>
            <StatusBadge status={instance.status} />
          </div>
          <SheetDescription>
            Deployment inspector — region, size, volume, replicas, restart, lifecycle.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {instance.driftSummary && instance.driftSummary.entries.length > 0 && (
            <DriftBanner entries={instance.driftSummary.entries} />
          )}

          {mode.kind === "view" && (
            <ViewPane
              instance={instance}
              onEdit={() => setMode({ kind: "edit" })}
            />
          )}

          {mode.kind === "edit" && (
            <EditPane
              defaults={currentValues}
              onCancel={() => setMode({ kind: "view" })}
              onSubmit={runPreview}
            />
          )}

          {mode.kind === "previewing" && (
            <div className="border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
              › computing preview…
            </div>
          )}

          {mode.kind === "preview" && (
            <PreviewPane
              instanceName={instance.name}
              currentRegion={instance.region}
              values={mode.values}
              result={mode.result}
              confirmDestructive={confirmDestructive}
              onToggleConfirm={() => setConfirmDestructive((v) => !v)}
              onBack={() => setMode({ kind: "edit" })}
              onApply={applyChange}
            />
          )}

          {mode.kind === "applying" && (
            <div className="border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
              › applying…
            </div>
          )}

          {mode.kind === "error" && (
            <div className="space-y-2 border border-[hsl(var(--status-failed))]/40 bg-[hsl(var(--status-failed))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-failed))]">
              <div>✗ {mode.message}</div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setMode({ kind: "view" })}
              >
                ‹ back
              </Button>
            </div>
          )}
        </div>
    </>
  );
}

/* ─── VIEW PANE ───────────────────────────────────────────────────── */

function ViewPane({
  instance,
  onEdit,
}: {
  instance: AgentInstance;
  onEdit: () => void;
}) {
  const restart =
    instance.restartPolicy === "on-failure"
      ? `on-failure · ${instance.restartMaxRetries} retries`
      : instance.restartPolicy || "—";

  return (
    <div className="space-y-3">
      <TerminalContainer title="CURRENT CONFIGURATION" accent="deploy">
        <dl className="space-y-1 font-mono text-[11px]">
          <SpecRow label="REGION" value={instance.region || "—"} />
          <SpecRow
            label="SIZE"
            value={describeSize(
              (instance.cpuKind || "shared") as CpuKind,
              instance.cpus || 1,
              instance.memoryMb || 512,
            )}
          />
          <SpecRow
            label="VOLUME"
            value={instance.volumeSizeGb ? `${instance.volumeSizeGb}GB` : "—"}
          />
          <SpecRow
            label="REPLICAS"
            value={String(instance.desiredReplicas || 1)}
          />
          <SpecRow label="RESTART" value={restart} />
          <SpecRow
            label="LIFECYCLE"
            value={instance.lifecycleMode || "always-on"}
          />
        </dl>
      </TerminalContainer>

      {instance.volumes.length > 0 && (
        <TerminalContainer title="PER-REPLICA VOLUMES" accent="deploy">
          <ul className="space-y-1 font-mono text-[11px]">
            {instance.volumes.map((v) => (
              <li key={v.volumeId} className="flex items-center gap-3">
                <span className="text-muted-foreground/70">{v.volumeId}</span>
                <span className="text-foreground/80">{v.region}</span>
                <span className="text-foreground/80">{v.sizeGb}GB</span>
                <span className="text-muted-foreground/70">
                  {v.machineId ? `→ ${v.machineId}` : "unattached"}
                </span>
              </li>
            ))}
          </ul>
        </TerminalContainer>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={onEdit}>
          › EDIT
        </Button>
      </div>
    </div>
  );
}

/* ─── EDIT PANE ───────────────────────────────────────────────────── */

function EditPane({
  defaults,
  onCancel,
  onSubmit,
}: {
  defaults: DeploymentFormValues;
  onCancel: () => void;
  onSubmit: (values: DeploymentFormValues) => void;
}) {
  // `chatEnabled` is locked in the inspector: toggling it on/off
  // requires adding/removing the Fly services block, which the
  // live-update path (`mergeMachineConfig`) doesn't handle. Showing
  // an enabled checkbox here would silently corrupt running
  // machines (DB column flips; Fly machine config doesn't),
  // violating blueprint §11.4. Operators see the current value but
  // are pointed at destroy + respawn to change it.
  return (
    <TerminalContainer title="EDIT CONFIGURATION" accent="deploy">
      <DeploymentConfigForm
        defaults={defaults}
        onSubmit={onSubmit}
        submitLabel="› PREVIEW"
        lockedFields={["chatEnabled"]}
      />
      <div className="mt-2 flex items-center justify-end">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          ‹ cancel
        </Button>
      </div>
    </TerminalContainer>
  );
}

/* ─── PREVIEW PANE ────────────────────────────────────────────────── */

function PreviewPane({
  instanceName,
  currentRegion,
  values,
  result,
  confirmDestructive,
  onToggleConfirm,
  onBack,
  onApply,
}: {
  instanceName: string;
  currentRegion: string;
  values: DeploymentFormValues;
  result: UpdateResult;
  confirmDestructive: boolean;
  onToggleConfirm: () => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const isRespawn = result.updateKind === UpdateKind.REQUIRES_RESPAWN;
  const isRestart = result.updateKind === UpdateKind.LIVE_APPLIED_WITH_RESTART;
  const downtime = result.estimatedDowntimeSeconds;
  const wipes = result.wipesPersistentState;
  const regionChanging = values.region !== currentRegion;

  const accent = isRespawn ? "failed" : isRestart ? "pending" : "running";
  const title = isRespawn
    ? "DESTRUCTIVE PREVIEW"
    : isRestart
      ? "PREVIEW · BRIEF RESTART"
      : "PREVIEW · INSTANT";

  return (
    <TerminalContainer title={title} accent={accent}>
      <div className="space-y-3">
        {isRespawn && (
          <div className="space-y-1 border border-[hsl(var(--status-failed))]/40 bg-[hsl(var(--status-failed))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-failed))]">
            <div className="font-semibold">⚠ destructive update</div>
            <p className="text-foreground/80">
              {regionChanging
                ? `Region change (${currentRegion} → ${values.region}) will destroy and recreate the agent, wiping its persistent state (memory, skills, conversation history). The new agent starts with an empty $HERMES_HOME.`
                : "This change requires destroying and recreating the agent. Persistent state (memory, skills, conversation history) will be wiped."}
            </p>
            {wipes && (
              <p className="text-foreground/80">
                The <code className="text-foreground">agent_instances.id</code>{" "}
                stays the same; the deploy_external_ref + volumes are replaced.
              </p>
            )}
          </div>
        )}

        {isRestart && (
          <div className="border border-[hsl(var(--status-pending))]/40 bg-[hsl(var(--status-pending))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-pending))]">
            ⟳ machine will restart briefly
            {downtime > 0 ? ` (~${downtime}s downtime)` : ""}
          </div>
        )}

        {!isRespawn && !isRestart && (
          <div className="border border-[hsl(var(--status-running))]/40 bg-[hsl(var(--status-running))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-running))]">
            ✓ change applies live · no restart
          </div>
        )}

        <dl className="space-y-1 font-mono text-[11px]">
          <SpecRow label="REGION" value={values.region} />
          <SpecRow
            label="SIZE"
            value={describeSize(values.cpuKind, values.cpus, values.memoryMb)}
          />
          <SpecRow label="VOLUME" value={`${values.volumeSizeGb}GB`} />
          <SpecRow label="REPLICAS" value={String(values.desiredReplicas)} />
          <SpecRow
            label="RESTART"
            value={
              values.restartPolicy === "on-failure"
                ? `on-failure · ${values.restartMaxRetries} retries`
                : values.restartPolicy
            }
          />
          <SpecRow label="LIFECYCLE" value={values.lifecycleMode} />
        </dl>

        {isRespawn && (
          <label className="flex items-start gap-2 text-[11px] text-foreground/90">
            <input
              type="checkbox"
              checked={confirmDestructive}
              onChange={onToggleConfirm}
              className="mt-0.5 size-3 accent-[hsl(var(--status-failed))]"
            />
            <span>
              I understand this destroys the agent&apos;s memory and skills.
            </span>
          </label>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button size="xs" variant="ghost" onClick={onBack}>
            ‹ back to edit
          </Button>
          {isRespawn ? (
            <DestructiveApplyButton
              disabled={!confirmDestructive}
              instanceName={instanceName}
              onApply={onApply}
            />
          ) : (
            <Button size="sm" onClick={onApply}>
              › APPLY
            </Button>
          )}
        </div>
      </div>
    </TerminalContainer>
  );
}

function DestructiveApplyButton({
  disabled,
  instanceName,
  onApply,
}: {
  disabled: boolean;
  instanceName: string;
  onApply: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Name-match gate: the operator must type the agent's name
  // verbatim before the destroy action enables. Mirrors the
  // industry pattern (kubectl / terraform / GitHub) for actions
  // that wipe persistent state — a checkbox alone is too easy
  // to dismiss with a single click.
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === instanceName;

  function close() {
    setConfirming(false);
    setTyped("");
  }

  return (
    <>
      <Button
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        › DESTROY + RESPAWN
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !open && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Destroy and respawn?</AlertDialogTitle>
            <AlertDialogDescription>
              The Fly app + volumes are deleted; a new app is created in the
              new region. The agent_instances row stays — same id, same name,
              new external ref, empty $HERMES_HOME.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 px-1">
            <label
              htmlFor="destroy-name-confirm"
              className="font-mono text-[11px] text-muted-foreground"
            >
              Type{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                {instanceName}
              </code>{" "}
              to confirm.
            </label>
            <Input
              id="destroy-name-confirm"
              autoComplete="off"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={instanceName}
              aria-invalid={typed.length > 0 && !matches}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={close}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!matches}
              onClick={() => {
                close();
                onApply();
              }}
            >
              Destroy + respawn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── DRIFT BANNER ────────────────────────────────────────────────── */

function DriftBanner({ entries }: { entries: DriftEntry[] }) {
  return (
    <div className="space-y-1 border border-[hsl(var(--status-pending))]/40 bg-[hsl(var(--status-pending))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-pending))]">
      <div className="font-semibold">⟳ drift detected</div>
      <ul className="space-y-0.5 text-foreground/80">
        {entries.map((e, i) => (
          <li key={`${e.category}-${i}`}>
            <span className="text-muted-foreground/80">
              {driftCategoryLabel(e.category)}:
            </span>{" "}
            {e.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function driftCategoryLabel(c: DriftCategory): string {
  switch (c) {
    case DriftCategory.COUNT_MISMATCH:
      return "replica count";
    case DriftCategory.SIZE_MISMATCH:
      return "size";
    case DriftCategory.VOLUME_MISMATCH:
      return "volume";
    case DriftCategory.VOLUME_SIZE_MISMATCH:
      return "volume size";
    case DriftCategory.VOLUME_UNATTACHED:
      return "unattached volume";
    default:
      return "drift";
  }
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className="text-foreground/80">{value}</dd>
    </div>
  );
}

function deploymentValuesFromInstance(i: AgentInstance): DeploymentFormValues {
  return {
    region: i.region || "sin",
    cpuKind: ((i.cpuKind || "shared") as CpuKind) ?? "shared",
    cpus: i.cpus || 1,
    memoryMb: i.memoryMb || 512,
    restartPolicy: ((i.restartPolicy || "on-failure") as RestartPolicy) ?? "on-failure",
    restartMaxRetries: i.restartMaxRetries || 3,
    lifecycleMode: ((i.lifecycleMode || "always-on") as LifecycleMode) ?? "always-on",
    desiredReplicas: i.desiredReplicas || 1,
    volumeSizeGb: i.volumeSizeGb || 1,
    // M-chat Phase 6: ListAgentInstancesByOrg now includes chat_enabled;
    // the value is accurate. The ?. guard remains for future TS strictness.
    chatEnabled: i.chatEnabled ?? true,
  };
}

function deployConfigFromValues(v: DeploymentFormValues): DeployConfig {
  return {
    $typeName: "corellia.v1.DeployConfig",
    region: v.region,
    cpuKind: v.cpuKind,
    cpus: v.cpus,
    memoryMb: v.memoryMb,
    restartPolicy: v.restartPolicy,
    restartMaxRetries: v.restartMaxRetries,
    lifecycleMode: v.lifecycleMode,
    desiredReplicas: v.desiredReplicas,
    volumeSizeGb: v.volumeSizeGb,
    chatEnabled: v.chatEnabled,
  };
}
