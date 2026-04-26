"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConnectError } from "@connectrpc/connect";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; instances: AgentInstance[] }
  | { kind: "error"; message: string };

const STATUS_BUCKETS = [
  "running",
  "spawning",
  "pending",
  "stopped",
  "failed",
  "destroyed",
] as const;

type Bucket = (typeof STATUS_BUCKETS)[number];

export default function DashboardPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentInstances({});
        if (cancelled) return;
        setState({ kind: "ready", instances: res.instances });
      } catch (e) {
        if (cancelled) return;
        const err = ConnectError.from(e);
        setState({ kind: "error", message: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ DASHBOARD ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            CONTROL PLANE
          </h1>
        </div>
        <div className="flex items-center gap-3 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[hsl(var(--status-running))] animate-telemetry" />
          ONLINE
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Telemetry
          label="FLEET TOTAL"
          value={state.kind === "ready" ? String(state.instances.length) : "—"}
        />
        <Telemetry
          label="RUNNING"
          value={
            state.kind === "ready"
              ? String(state.instances.filter((i) => i.status === "running").length)
              : "—"
          }
          accent="running"
        />
        <Telemetry
          label="PENDING"
          value={
            state.kind === "ready"
              ? String(
                  state.instances.filter(
                    (i) => i.status === "pending" || i.status === "spawning",
                  ).length,
                )
              : "—"
          }
          accent="pending"
        />
        <Telemetry
          label="FAILED"
          value={
            state.kind === "ready"
              ? String(state.instances.filter((i) => i.status === "failed").length)
              : "—"
          }
          accent="failed"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TerminalContainer
            title="FLEET STATUS"
            accent="running"
            meta={
              state.kind === "ready"
                ? `${state.instances.length} REGISTERED`
                : ""
            }
          >
            {state.kind === "loading" && (
              <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">
                Polling…
              </p>
            )}
            {state.kind === "error" && (
              <p className="font-mono text-xs text-[hsl(var(--status-failed))]">
                {state.message}
              </p>
            )}
            {state.kind === "ready" && state.instances.length === 0 && (
              <EmptyFleet />
            )}
            {state.kind === "ready" && state.instances.length > 0 && (
              <FleetMatrix instances={state.instances} />
            )}
          </TerminalContainer>
        </div>

        <TerminalContainer title="HARNESS CATALOG" accent="catalog">
          <p className="text-sm text-muted-foreground">
            Browse the catalog of harnesses and pin a configured agent template
            to your workspace.
          </p>
          <ul className="mt-4 space-y-1.5 font-mono text-xs text-muted-foreground">
            <li>
              <span className="text-[hsl(var(--feature-catalog))]">›</span>{" "}
              hermes &nbsp;<span className="text-foreground">AVAILABLE</span>
            </li>
            <li>
              <span className="text-muted-foreground/50">›</span> langgraph
              &nbsp;<span className="text-muted-foreground/60">PLANNED</span>
            </li>
            <li>
              <span className="text-muted-foreground/50">›</span> crewai &nbsp;
              <span className="text-muted-foreground/60">PLANNED</span>
            </li>
          </ul>
          <div className="mt-4">
            <Button variant="default" size="sm" render={<Link href="/agents" />}>
              › OPEN CATALOG
            </Button>
          </div>
        </TerminalContainer>
      </div>
    </div>
  );
}

function Telemetry({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "running" | "pending" | "failed";
}) {
  const tone =
    accent === "running"
      ? "text-[hsl(var(--status-running))]"
      : accent === "pending"
        ? "text-[hsl(var(--status-pending))]"
        : accent === "failed"
          ? "text-[hsl(var(--status-failed))]"
          : "text-foreground";
  return (
    <div className="border border-border bg-card p-3">
      <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 font-mono text-3xl tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function FleetMatrix({ instances }: { instances: AgentInstance[] }) {
  const counts = countByStatus(instances);
  return (
    <div className="space-y-2">
      {STATUS_BUCKETS.filter((b) => counts[b] > 0).map((b) => (
        <div
          key={b}
          className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-0 last:pb-0"
        >
          <StatusDot status={b} />
          <span className="font-mono text-sm tabular-nums text-foreground">
            {counts[b]}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyFleet() {
  return (
    <div className="space-y-3 py-2">
      <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">
        › NO AGENTS REGISTERED
      </p>
      <p className="text-sm text-muted-foreground/80">
        Spawn an agent from the catalog. Status appears here once a Fly machine
        boots and reports healthy.
      </p>
      <div className="pt-1">
        <Button variant="default" size="sm" render={<Link href="/agents" />}>
          › DEPLOY FIRST AGENT
        </Button>
      </div>
    </div>
  );
}

function countByStatus(instances: AgentInstance[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = {
    running: 0,
    spawning: 0,
    pending: 0,
    stopped: 0,
    failed: 0,
    destroyed: 0,
  };
  for (const i of instances) {
    if (i.status in out) {
      out[i.status as Bucket]++;
    }
  }
  return out;
}
