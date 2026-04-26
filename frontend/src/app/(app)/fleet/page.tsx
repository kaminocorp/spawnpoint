"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConnectError } from "@connectrpc/connect";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { FleetGallery } from "@/components/fleet/fleet-gallery";
import { FleetViewToggle } from "@/components/fleet/view-toggle";
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

type State =
  | { kind: "loading" }
  | { kind: "ready"; instances: AgentInstance[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

export default function FleetPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showDestroyed, setShowDestroyed] = useState(false);
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

  const visibleInstances =
    state.kind === "ready"
      ? showDestroyed
        ? state.instances
        : state.instances.filter((i) => i.status !== "destroyed")
      : [];

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
        <FleetTable instances={visibleInstances} onChanged={fetchInstances} />
      )}
      {state.kind === "ready" && view === "gallery" && (
        <FleetGallery instances={visibleInstances} onChanged={fetchInstances} />
      )}
    </div>
  );
}

function FleetTable({
  instances,
  onChanged,
}: {
  instances: AgentInstance[];
  onChanged: () => void;
}) {
  return (
    <TerminalContainer
      title="AGENT INSTANCES"
      accent="running"
      meta={`${instances.length} ROWS`}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border">
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Template</Th>
            <Th>Model</Th>
            <Th>Created</Th>
            <Th align="right">Actions</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((i) => (
            <TableRow key={i.id} className="border-b border-border/50">
              <TableCell className="font-mono text-xs text-foreground">
                {i.name}
              </TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {i.templateName}
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
          <Button variant="default" size="sm" render={<Link href="/agents" />}>
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
