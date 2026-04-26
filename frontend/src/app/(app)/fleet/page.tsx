"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectError } from "@connectrpc/connect";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { BulkApplyModal } from "@/components/fleet/bulk-apply-modal";
import { FleetGallery } from "@/components/fleet/fleet-gallery";
import { FleetViewToggle } from "@/components/fleet/view-toggle";
import {
  BULK_APPLY_CAP,
  SelectionToolbar,
} from "@/components/fleet/selection-toolbar";
import { isTerminal, StatusBadge } from "@/components/fleet/status-badge";
import { Button } from "@/components/ui/button";
import { TerminalContainer } from "@/components/ui/terminal-container";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";
import { formatCreated, providerLabel } from "@/lib/fleet-format";
import { setFleetView, useFleetView } from "@/lib/fleet-view-pref";
import { describeSize } from "@/lib/spawn/deployment-presets";
import type { CpuKind } from "@/lib/spawn/deployment-presets";

type State =
  | { kind: "loading" }
  | { kind: "ready"; instances: AgentInstance[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

export default function FleetPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showDestroyed, setShowDestroyed] = useState(false);
  // Selection state lifted to the page so SelectionToolbar +
  // BulkApplyModal share it. Selecting a destroyed row is blocked at
  // the toggle layer (only non-destroyed rows expose checkboxes).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const view = useFleetView();

  const fetchInstances = useCallback(async () => {
    try {
      const api = createApiClient();
      const res = await api.agents.listAgentInstances({});
      if (res.instances.length === 0) {
        setState({ kind: "empty" });
      } else {
        setState({ kind: "ready", instances: res.instances });
      }
    } catch (e) {
      const err = ConnectError.from(e);
      setState({ kind: "error", message: err.message });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchInstances();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchInstances]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    if (state.instances.every((i) => isTerminal(i.status))) return;
    const id = setInterval(() => {
      void fetchInstances();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [state, fetchInstances]);

  const visibleInstances = useMemo(() => {
    if (state.kind !== "ready") return [];
    return showDestroyed
      ? state.instances
      : state.instances.filter((i) => i.status !== "destroyed");
  }, [state, showDestroyed]);

  const destroyedCount =
    state.kind === "ready"
      ? state.instances.filter((i) => i.status === "destroyed").length
      : 0;

  const count =
    state.kind === "ready" ? visibleInstances.length :
    state.kind === "empty" ? 0 : null;

  const polling =
    state.kind === "ready" &&
    !state.instances.every((i) => isTerminal(i.status));

  const selectableInstances = useMemo(
    () => visibleInstances.filter((i) => i.status !== "destroyed"),
    [visibleInstances],
  );

  // Effective selection = intersection with currently-visible rows.
  // Drops stale ids (destroyed-and-hidden / deleted) at render time
  // without needing a setState-in-effect GC pass.
  const effectiveSelectedIds = useMemo(() => {
    const visibleIds = new Set(visibleInstances.map((i) => i.id));
    return new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  }, [selectedIds, visibleInstances]);

  const selectedInstances = useMemo(
    () => visibleInstances.filter((i) => effectiveSelectedIds.has(i.id)),
    [visibleInstances, effectiveSelectedIds],
  );

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allOnPage = selectableInstances.map((i) => i.id);
      const allSelected =
        allOnPage.length > 0 && allOnPage.every((id) => prev.has(id));
      if (allSelected) {
        // Deselect only those on this page; preserve any prior off-page picks.
        const next = new Set(prev);
        allOnPage.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...allOnPage]);
    });
  }, [selectableInstances]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const onBulkComplete = useCallback((failedIds: string[]) => {
    // Failed rows stay selected for retry; succeeded rows fall out
    // of selection. Plan §4 Phase 8: "Failed rows stay selected so
    // the user can retry after fixing."
    setSelectedIds(new Set(failedIds));
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ FLEET ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            FLEET
          </h1>
        </div>
        <div className="flex items-center gap-3 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          <FleetViewToggle value={view} onChange={setFleetView} />
          <span className="text-muted-foreground/50">·</span>
          {state.kind === "ready" && destroyedCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowDestroyed((v) => !v)}
                className="flex items-center gap-1.5 border border-border px-2 py-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                <span className="font-mono text-foreground">
                  [{showDestroyed ? "✓" : " "}]
                </span>
                SHOW DESTROYED ({destroyedCount})
              </button>
              <span className="text-muted-foreground/50">·</span>
            </>
          )}
          {polling && (
            <>
              <span className="size-1.5 rounded-full bg-[hsl(var(--status-pending))] animate-telemetry" />
              POLLING
              <span className="text-muted-foreground/50">·</span>
            </>
          )}
          {count !== null && <span>{count} REGISTERED</span>}
        </div>
      </header>

      {state.kind === "loading" && <LoadingTable />}
      {state.kind === "empty" && <EmptyState />}
      {state.kind === "error" && <ErrorState message={state.message} />}
      {state.kind === "ready" && view === "list" && (
        <FleetTable
          instances={visibleInstances}
          selectedIds={effectiveSelectedIds}
          selectableInstances={selectableInstances}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          onChanged={fetchInstances}
        />
      )}
      {state.kind === "ready" && view === "gallery" && (
        <FleetGallery
          instances={visibleInstances}
          selectedIds={effectiveSelectedIds}
          onToggleOne={toggleOne}
          onChanged={fetchInstances}
        />
      )}

      <SelectionToolbar
        count={effectiveSelectedIds.size}
        onApply={() => setBulkOpen(true)}
        onClear={clearSelection}
      />

      {selectedInstances.length > 0 && selectedInstances.length <= BULK_APPLY_CAP && (
        <BulkApplyModal
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          instances={selectedInstances}
          onChanged={fetchInstances}
          onComplete={onBulkComplete}
        />
      )}
    </div>
  );
}

function FleetTable({
  instances,
  selectedIds,
  selectableInstances,
  onToggleOne,
  onToggleAll,
  onChanged,
}: {
  instances: AgentInstance[];
  selectedIds: Set<string>;
  selectableInstances: AgentInstance[];
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onChanged: () => void;
}) {
  const allSelectableIds = selectableInstances.map((i) => i.id);
  const headerChecked =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selectedIds.has(id));
  const headerIndeterminate =
    !headerChecked && allSelectableIds.some((id) => selectedIds.has(id));

  return (
    <TerminalContainer
      title="AGENT INSTANCES"
      accent="running"
      meta={`${instances.length} ROWS`}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border">
            <Th>
              <SelectAllCheckbox
                checked={headerChecked}
                indeterminate={headerIndeterminate}
                disabled={allSelectableIds.length === 0}
                onChange={onToggleAll}
              />
            </Th>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Region</Th>
            <Th>Size</Th>
            <Th>Replicas</Th>
            <Th>Storage</Th>
            <Th>Model</Th>
            <Th>Created</Th>
            <Th align="right">Actions</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((i) => (
            <TableRow key={i.id} className="border-b border-border/50">
              <TableCell>
                {i.status !== "destroyed" && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(i.id)}
                    onChange={() => onToggleOne(i.id)}
                    aria-label={`Select ${i.name}`}
                    className="size-3.5 accent-[hsl(var(--feature-deploy))]"
                  />
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground">
                {i.name}
              </TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {i.region || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {sizeLabel(i)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                <ReplicasCell instance={i} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {storageLabel(i)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {providerLabel(i.provider)} / {i.modelName}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {formatCreated(i.createdAt)}
              </TableCell>
              <TableCell>
                <AgentRowActions instance={i} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TerminalContainer>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      disabled={disabled}
      onChange={onChange}
      aria-label="Select all on this page"
      className="size-3.5 accent-[hsl(var(--feature-deploy))]"
    />
  );
}

function sizeLabel(i: AgentInstance): string {
  if (!i.cpus || !i.memoryMb) return "—";
  return describeSize((i.cpuKind || "shared") as CpuKind, i.cpus, i.memoryMb);
}

function storageLabel(i: AgentInstance): string {
  // Per-replica volume × replica count is the total fleet storage for
  // the agent. Each replica gets its own volume (Phase 6 tooltip), so
  // the headline storage figure on the row sums across replicas.
  if (!i.volumeSizeGb) return "—";
  const replicas = i.desiredReplicas || 1;
  if (replicas <= 1) return `${i.volumeSizeGb}GB`;
  return `${i.volumeSizeGb * replicas}GB · ${replicas}×${i.volumeSizeGb}GB`;
}

function ReplicasCell({ instance }: { instance: AgentInstance }) {
  const desired = instance.desiredReplicas || 1;
  // Drift is loaded on demand by the inspector today (Phase 7
  // entry-point decision); the list query doesn't widen drift_summary
  // either. When BE eventually projects drift on the list path, the
  // mismatch indicator activates without a FE change.
  const mismatch = !!instance.driftSummary?.entries.some(
    (e) => e.category === 1, // DriftCategory.COUNT_MISMATCH
  );
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{desired}/{desired}</span>
      {mismatch && (
        <span
          className="size-1.5 rounded-full bg-[hsl(var(--status-pending))]"
          aria-label="replica count drift"
          title="Replica count drift — open Deployment for details"
        />
      )}
    </span>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <TableHead
      className={`font-display text-[10px] uppercase tracking-widest text-muted-foreground/70 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </TableHead>
  );
}

function LoadingTable() {
  return (
    <TerminalContainer title="AGENT INSTANCES" accent="running">
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-9 w-full border border-border/40 animate-telemetry"
          />
        ))}
      </div>
    </TerminalContainer>
  );
}

function EmptyState() {
  return (
    <TerminalContainer title="AGENT INSTANCES" accent="running">
      <div className="space-y-3 py-2">
        <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">
          › NO AGENTS REGISTERED
        </p>
        <p className="text-sm text-muted-foreground/80">
          Spawn one from the catalog. They&apos;ll appear here with status and
          logs.
        </p>
        <div className="pt-1">
          <Button variant="default" size="sm" render={<Link href="/spawn" />}>
            › OPEN CATALOG
          </Button>
        </div>
      </div>
    </TerminalContainer>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <TerminalContainer title="FLEET FAULT" accent="failed">
      <p className="font-mono text-xs text-[hsl(var(--status-failed))]">
        {message}
      </p>
      <p className="mt-2 text-sm text-muted-foreground/80">
        Polls every few seconds — this might recover on its own.
      </p>
    </TerminalContainer>
  );
}
