"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConnectError } from "@connectrpc/connect";
import { ArrowRightIcon } from "lucide-react";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { isTerminal, StatusBadge } from "@/components/fleet/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { ModelProvider } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; instances: AgentInstance[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const POLL_MS = 3000;

export default function FleetPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

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

  // Poll while at least one row is non-terminal (i.e. pending). Stops once
  // all rows have settled — typical idle cost is zero (plan decision 41).
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (state.instances.every((i) => isTerminal(i.status))) return;
    const id = setInterval(() => {
      void fetchInstances();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [state, fetchInstances]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Fleet</h1>
        <p className="text-sm text-muted-foreground">
          Every agent you&apos;ve spawned. Updates every few seconds while
          anything is converging.
        </p>
      </div>

      {state.kind === "loading" && <LoadingTable />}
      {state.kind === "empty" && <EmptyState />}
      {state.kind === "error" && <ErrorState message={state.message} />}
      {state.kind === "ready" && (
        <FleetTable instances={state.instances} onChanged={fetchInstances} />
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
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.name}</TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {i.templateName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                <span className="font-mono text-xs">
                  {providerLabel(i.provider)} / {i.modelName}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatCreated(i.createdAt)}
              </TableCell>
              <TableCell>
                <AgentRowActions instance={i} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>No agents yet.</CardTitle>
        <CardDescription>
          Spawn one from the catalog. They&apos;ll appear here with status and
          logs.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button render={<Link href="/agents" />}>
          Browse harnesses
          <ArrowRightIcon />
        </Button>
      </CardFooter>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Couldn&apos;t load the fleet.</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The page polls every few seconds — this might recover on its own.
      </CardContent>
    </Card>
  );
}

function providerLabel(p: ModelProvider): string {
  switch (p) {
    case ModelProvider.ANTHROPIC:
      return "anthropic";
    case ModelProvider.OPENAI:
      return "openai";
    case ModelProvider.OPENROUTER:
      return "openrouter";
    default:
      return "—";
  }
}

function formatCreated(rfc3339: string): string {
  if (!rfc3339) return "—";
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
