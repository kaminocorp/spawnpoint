"use client";

import { AgentCard } from "@/components/fleet/agent-card";
import { TerminalContainer } from "@/components/ui/terminal-container";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";

type Props = {
  instances: AgentInstance[];
  onChanged: () => void;
};

export function FleetGallery({ instances, onChanged }: Props) {
  return (
    <TerminalContainer
      title="AGENT INSTANCES"
      accent="running"
      meta={`${instances.length} CARDS`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {instances.map((i) => (
          <AgentCard key={i.id} instance={i} onChanged={onChanged} />
        ))}
      </div>
    </TerminalContainer>
  );
}
