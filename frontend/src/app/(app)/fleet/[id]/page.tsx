"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ConnectError } from "@connectrpc/connect";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { ChatPanel } from "@/components/fleet/chat-panel";
import { StatusBadge } from "@/components/fleet/status-badge";
import { Button } from "@/components/ui/button";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";
import { formatCreated, providerLabel } from "@/lib/fleet-format";
import { describeSize } from "@/lib/spawn/deployment-presets";
import type { CpuKind } from "@/lib/spawn/deployment-presets";

type State =
  | { kind: "loading" }
  | { kind: "ready"; instance: AgentInstance }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.getAgentInstance({ id });
        if (cancelled) return;
        if (!res.instance) {
          setState({ kind: "not-found" });
          return;
        }
        setState({ kind: "ready", instance: res.instance });
      } catch (e) {
        if (cancelled) return;
        const err = ConnectError.from(e);
        if (err.code === 5 /* NOT_FOUND */) {
          setState({ kind: "not-found" });
        } else {
          setState({ kind: "error", message: err.message });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <div className="font-mono text-xs text-muted-foreground animate-pulse p-6">
        loading…
      </div>
    );
  }
  if (state.kind === "not-found") {
    return (
      <div className="p-6 space-y-2">
        <p className="font-mono text-xs text-muted-foreground">Agent not found.</p>
        <Link href="/fleet">
          <Button size="sm" variant="ghost">← back to fleet</Button>
        </Link>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="p-6 space-y-2">
        <p className="font-mono text-xs text-destructive">Error: {state.message}</p>
        <Link href="/fleet">
          <Button size="sm" variant="ghost">← back to fleet</Button>
        </Link>
      </div>
    );
  }

  const { instance } = state;
  const size = describeSize(
    instance.cpuKind as CpuKind,
    instance.cpus,
    instance.memoryMb,
  );

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/fleet">
          <Button size="xs" variant="ghost" className="font-mono text-xs">
            ← fleet
          </Button>
        </Link>
        <span className="font-mono text-xs text-muted-foreground/60">/</span>
        <span className="font-mono text-xs text-foreground">{instance.name}</span>
      </div>

      {/* Identity block */}
      <TerminalContainer
        title={`AGENT // ${instance.name.toUpperCase()}`}
        accent="running"
        meta={instance.status.toUpperCase()}
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-3">
          <SpecRow label="STATUS">
            <StatusBadge status={instance.status} />
          </SpecRow>
          <SpecRow label="PROVIDER">{providerLabel(instance.provider)}</SpecRow>
          <SpecRow label="MODEL">{instance.modelName}</SpecRow>
          <SpecRow label="REGION">{instance.region || "—"}</SpecRow>
          <SpecRow label="SIZE">{size}</SpecRow>
          <SpecRow label="REPLICAS">{String(instance.desiredReplicas || 1)}</SpecRow>
          <SpecRow label="CREATED">{formatCreated(instance.createdAt)}</SpecRow>
          <SpecRow label="CHAT">{instance.chatEnabled ? "enabled" : "disabled"}</SpecRow>
        </div>

        {/* Action row */}
        <div className="mt-4 border-t border-border pt-3 flex flex-wrap gap-2">
          <AgentRowActions
            instance={instance}
            onChanged={() => {
              // Reload the instance after a state-changing action.
              setState({ kind: "loading" });
              const api = createApiClient();
              api.agents.getAgentInstance({ id }).then((res) => {
                if (res.instance) setState({ kind: "ready", instance: res.instance });
              }).catch(() => setState({ kind: "error", message: "reload failed" }));
            }}
          />
        </div>
      </TerminalContainer>

      {/* Chat panel — shown when chat_enabled, affordance when not */}
      {instance.chatEnabled ? (
        <TerminalContainer
          title="CHAT // HERMES"
          accent="adapter"
          meta="ACTIVE"
        >
          <div className="h-[480px]">
            <ChatPanel instanceId={instance.id} />
          </div>
        </TerminalContainer>
      ) : (
        <TerminalContainer
          title="CHAT // HERMES"
          accent="adapter"
          meta="DISABLED"
        >
          <div className="space-y-3">
            <p className="font-mono text-xs text-muted-foreground">
              Chat is disabled for this agent. To enable it, destroy and
              respawn with the{" "}
              <span className="text-foreground">Enable chat</span> checkbox
              checked in the spawn wizard&apos;s Deployment step.
            </p>
            <Link href="/spawn">
              <Button size="sm" variant="ghost" className="font-mono text-xs">
                → spawn a chat-enabled agent
              </Button>
            </Link>
          </div>
        </TerminalContainer>
      )}
    </div>
  );
}

function SpecRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
