"use client";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { StatusBadge } from "@/components/fleet/status-badge";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { formatCreated, providerLabel } from "@/lib/fleet-format";
import { cn } from "@/lib/utils";

type Props = {
  instance: AgentInstance;
  onChanged: () => void;
};

export function AgentCard({ instance, onChanged }: Props) {
  const isDestroyed = instance.status === "destroyed";

  return (
    <article
      className={cn(
        "flex flex-col border border-border bg-card transition-opacity",
        "hover:border-border/80",
        isDestroyed && "opacity-50",
      )}
    >
      <header className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <StatusBadge status={instance.status} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {formatCreated(instance.createdAt)}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-3 pb-2">
        <h2 className="font-mono text-sm text-foreground">{instance.name}</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          {instance.templateName}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {providerLabel(instance.provider)} / {instance.modelName}
        </p>
      </div>

      <footer className="flex items-center justify-end border-t border-border/50 px-2 py-1.5">
        <AgentRowActions instance={instance} onChanged={onChanged} />
      </footer>
    </article>
  );
}
