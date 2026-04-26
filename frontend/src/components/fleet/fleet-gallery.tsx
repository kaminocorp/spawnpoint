"use client";

import { AgentCard } from "@/components/fleet/agent-card";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";

type Props = {
  instances: AgentInstance[];
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onChanged: () => void;
  templateAdapterMap: Record<string, string>;
};

export function FleetGallery({
  instances,
  selectedIds,
  onToggleOne,
  onChanged,
  templateAdapterMap,
}: Props) {
  return (
    <TerminalContainer
      title="AGENT INSTANCES"
      accent="running"
      meta={`${instances.length} CARDS`}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {instances.map((i) => (
          <AgentCard
            key={i.id}
            instance={i}
            selected={selectedIds.has(i.id)}
            onToggleSelected={() => onToggleOne(i.id)}
            onChanged={onChanged}
            harnessAdapterId={templateAdapterMap[i.templateId]}
          />
        ))}
      </div>
    </TerminalContainer>
  );
}
