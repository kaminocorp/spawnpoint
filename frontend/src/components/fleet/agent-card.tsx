"use client";

import { AgentRowActions } from "@/components/fleet/agent-row-actions";
import { StatusBadge } from "@/components/fleet/status-badge";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { formatCreated, providerLabel } from "@/lib/fleet-format";
import { describeSize } from "@/lib/spawn/deployment-presets";
import type { CpuKind } from "@/lib/spawn/deployment-presets";
import { cn } from "@/lib/utils";

type Props = {
  instance: AgentInstance;
  selected: boolean;
  onToggleSelected: () => void;
  onChanged: () => void;
};

export function AgentCard({
  instance,
  selected,
  onToggleSelected,
  onChanged,
}: Props) {
  const isDestroyed = instance.status === "destroyed";
  const size =
    instance.cpus && instance.memoryMb
      ? describeSize(
          (instance.cpuKind || "shared") as CpuKind,
          instance.cpus,
          instance.memoryMb,
        )
      : null;
  const replicas = instance.desiredReplicas || 1;
  const storage = instance.volumeSizeGb
    ? `${instance.volumeSizeGb * replicas}GB`
    : null;

  return (
    <article
      className={cn(
        "flex flex-col border bg-card transition-opacity",
        "hover:border-border/80",
        selected
          ? "border-[hsl(var(--feature-deploy))]"
          : "border-border",
        isDestroyed && "opacity-50",
      )}
    >
      <header className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          {!isDestroyed && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={`Select ${instance.name}`}
              className="size-3.5 accent-[hsl(var(--feature-deploy))]"
            />
          )}
          <StatusBadge status={instance.status} />
        </div>
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
        {(instance.region || size) && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {[instance.region, size].filter(Boolean).join(" · ")}
          </p>
        )}
        {(replicas > 1 || storage) && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {[
              replicas > 1 ? `${replicas} replicas` : null,
              storage,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end border-t border-border/50 px-2 py-1.5">
        <AgentRowActions instance={instance} onChanged={onChanged} compact />
      </footer>
    </article>
  );
}
