"use client";

import { useMemo, useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TerminalContainer } from "@/components/ui/terminal-container";
import { BulkConfigDeltaForm } from "@/components/fleet/bulk-config-delta-form";
import {
  UpdateKind,
  type AgentInstance,
  type BulkConfigDelta,
  type BulkResult,
} from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

/**
 * `<BulkApplyModal>` — Phase 8 of fleet-control. Three-pane modal:
 *
 *   1. `editing`    — the bulk delta form, seeded from the selection's
 *                     common-or-default values.
 *   2. `preview`    — `BulkResult[]` from a `dry_run=true` apply, one
 *                     row per instance: kind / downtime / no-change.
 *   3. `result`     — `BulkResult[]` from a `dry_run=false` apply.
 *                     Failed rows surface their error message; the
 *                     parent's `onComplete(failedIds)` lets the page
 *                     keep failed instances selected for retry.
 *
 * Per plan §4 Phase 8 + decision 28: cap at 50 (enforced server-side
 * by `ErrBulkLimit`; FE blocks the open state at the toolbar layer).
 * Decision 8.4: `volume_size_gb` is NOT in the bulk delta form (proto
 * `BulkConfigDelta` doesn't carry it).
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instances: AgentInstance[];
  /** Refetch the fleet list after a successful (or partially-successful) apply. */
  onChanged: () => void;
  /** Called after dry_run=false completes, with the ids that failed.
   *  The fleet page uses this to keep failed rows selected for retry. */
  onComplete: (failedInstanceIds: string[]) => void;
};

type Mode =
  | { kind: "editing" }
  | { kind: "previewing" }
  | { kind: "preview"; delta: BulkConfigDelta; results: BulkResult[] }
  | { kind: "applying"; delta: BulkConfigDelta }
  | { kind: "result"; results: BulkResult[] }
  | { kind: "error"; message: string };

export function BulkApplyModal(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <ModalBody key={props.open ? "open" : "closed"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ModalBody({
  instances,
  onOpenChange,
  onChanged,
  onComplete,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "editing" });
  const idToInstance = useMemo(
    () => new Map(instances.map((i) => [i.id, i])),
    [instances],
  );

  async function runPreview(delta: BulkConfigDelta) {
    setMode({ kind: "previewing" });
    try {
      const api = createApiClient();
      const res = await api.agents.bulkUpdateAgentDeployConfig({
        instanceIds: instances.map((i) => i.id),
        deployConfigDelta: delta,
        dryRun: true,
      });
      setMode({ kind: "preview", delta, results: res.results });
    } catch (e) {
      setMode({ kind: "error", message: ConnectError.from(e).message });
    }
  }

  async function runApply() {
    if (mode.kind !== "preview") return;
    const delta = mode.delta;
    setMode({ kind: "applying", delta });
    try {
      const api = createApiClient();
      const res = await api.agents.bulkUpdateAgentDeployConfig({
        instanceIds: instances.map((i) => i.id),
        deployConfigDelta: delta,
        dryRun: false,
      });
      const failed = res.results.filter((r) => r.errorMessage !== "");
      const succeeded = res.results.length - failed.length;
      if (failed.length === 0) {
        toast.success(`Applied to ${succeeded} agents.`);
      } else {
        toast.error(
          `${succeeded} succeeded, ${failed.length} failed. Failed rows stay selected.`,
        );
      }
      onChanged();
      onComplete(failed.map((r) => r.instanceId));
      setMode({ kind: "result", results: res.results });
    } catch (e) {
      setMode({ kind: "error", message: ConnectError.from(e).message });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>BULK APPLY · {instances.length} AGENTS</DialogTitle>
        <DialogDescription>
          {mode.kind === "editing" &&
            "Pick fields to change. Skipped fields preserve each agent's current value when the selection is uniform."}
          {mode.kind === "previewing" && "Computing per-agent preview…"}
          {mode.kind === "preview" &&
            "Per-agent preview. Confirm to apply."}
          {mode.kind === "applying" && "Applying across selection…"}
          {mode.kind === "result" && "Results — failed rows stay selected for retry."}
          {mode.kind === "error" && "Bulk apply failed."}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] overflow-y-auto">
        {mode.kind === "editing" && (
          <BulkConfigDeltaForm
            instances={instances}
            onSubmit={(delta) => runPreview(delta)}
          />
        )}

        {mode.kind === "previewing" && (
          <div className="border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
            › computing preview…
          </div>
        )}

        {mode.kind === "preview" && (
          <PreviewTable
            results={mode.results}
            idToInstance={idToInstance}
          />
        )}

        {mode.kind === "applying" && (
          <div className="border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
            › applying…
          </div>
        )}

        {mode.kind === "result" && (
          <ResultTable
            results={mode.results}
            idToInstance={idToInstance}
          />
        )}

        {mode.kind === "error" && (
          <div className="space-y-2 border border-[hsl(var(--status-failed))]/40 bg-[hsl(var(--status-failed))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-failed))]">
            <div>✗ {mode.message}</div>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setMode({ kind: "editing" })}
            >
              ‹ back to edit
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        {mode.kind === "preview" && (
          <>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setMode({ kind: "editing" })}
            >
              ‹ back to edit
            </Button>
            <Button size="sm" onClick={runApply}>
              › CONFIRM &amp; APPLY
            </Button>
          </>
        )}
        {mode.kind === "result" && (
          <>
            <span className="font-mono text-[11px] text-muted-foreground">
              {countSucceeded(mode.results)} ok ·{" "}
              {countFailed(mode.results)} failed
            </span>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              › CLOSE
            </Button>
          </>
        )}
        {(mode.kind === "editing" ||
          mode.kind === "previewing" ||
          mode.kind === "applying" ||
          mode.kind === "error") && (
          <span className="ml-auto" />
        )}
      </div>
    </>
  );
}

/* ─── PREVIEW TABLE ───────────────────────────────────────────────── */

function PreviewTable({
  results,
  idToInstance,
}: {
  results: BulkResult[];
  idToInstance: Map<string, AgentInstance>;
}) {
  return (
    <TerminalContainer title="PREVIEW" accent="deploy">
      <ul className="space-y-1 font-mono text-[11px]">
        {results.map((r) => {
          const inst = idToInstance.get(r.instanceId);
          const label = updateKindLabel(r.updateKind);
          const accent = updateKindAccent(r.updateKind, r.errorMessage);
          return (
            <li
              key={r.instanceId}
              className="flex items-center justify-between gap-3 border-b border-border/40 py-1"
            >
              <span className="text-foreground">{inst?.name ?? r.instanceId}</span>
              <span className={accent}>
                {r.errorMessage ? `✗ ${r.errorMessage}` : label}
              </span>
            </li>
          );
        })}
      </ul>
    </TerminalContainer>
  );
}

/* ─── RESULT TABLE ────────────────────────────────────────────────── */

function ResultTable({
  results,
  idToInstance,
}: {
  results: BulkResult[];
  idToInstance: Map<string, AgentInstance>;
}) {
  return (
    <TerminalContainer title="APPLY RESULT" accent="running">
      <ul className="space-y-1 font-mono text-[11px]">
        {results.map((r) => {
          const inst = idToInstance.get(r.instanceId);
          const ok = r.errorMessage === "";
          return (
            <li
              key={r.instanceId}
              className="flex items-center justify-between gap-3 border-b border-border/40 py-1"
            >
              <span className="text-foreground">{inst?.name ?? r.instanceId}</span>
              <span
                className={
                  ok
                    ? "text-[hsl(var(--status-running))]"
                    : "text-[hsl(var(--status-failed))]"
                }
              >
                {ok ? `✓ ${updateKindLabel(r.updateKind)}` : `✗ ${r.errorMessage}`}
              </span>
            </li>
          );
        })}
      </ul>
    </TerminalContainer>
  );
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */

function updateKindLabel(k: UpdateKind): string {
  switch (k) {
    case UpdateKind.LIVE_APPLIED:
      return "✓ live · no restart";
    case UpdateKind.LIVE_APPLIED_WITH_RESTART:
      return "⟳ brief restart";
    case UpdateKind.REQUIRES_RESPAWN:
      return "⚠ requires respawn";
    default:
      return "—";
  }
}

function updateKindAccent(k: UpdateKind, errorMessage: string): string {
  if (errorMessage) return "text-[hsl(var(--status-failed))]";
  switch (k) {
    case UpdateKind.LIVE_APPLIED:
      return "text-[hsl(var(--status-running))]";
    case UpdateKind.LIVE_APPLIED_WITH_RESTART:
      return "text-[hsl(var(--status-pending))]";
    case UpdateKind.REQUIRES_RESPAWN:
      return "text-[hsl(var(--status-failed))]";
    default:
      return "text-muted-foreground";
  }
}

function countSucceeded(rs: BulkResult[]): number {
  return rs.filter((r) => r.errorMessage === "").length;
}

function countFailed(rs: BulkResult[]): number {
  return rs.filter((r) => r.errorMessage !== "").length;
}
