"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DeployModal } from "@/components/agents/deploy-modal";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";

type Props = {
  template: AgentTemplate;
};

/**
 * Spec-sheet card per `docs/refs/design-system.md` Pillar 2 (Analog-Digital
 * Hybrid Futurism). Square hairline rectangle with two-column field
 * layout: left column = label (mono uppercase muted), right column =
 * value (mono foreground). The CTAs sit on a hairline footer rule.
 */
export function AgentTemplateCard({ template }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"one" | "many">("one");

  function openWith(next: "one" | "many") {
    setMode(next);
    setOpen(true);
  }

  // Try to surface the most useful technical metadata if it's exposed on
  // the proto. The minimal contract is `name` + `description` — additional
  // fields are rendered when present.
  const description =
    template.description ||
    "Hand-written adapter wrapping the upstream image; CORELLIA_* env vars translated to harness-native names at boot.";

  return (
    <article className="group flex flex-col border border-border bg-card transition-colors hover:border-[hsl(var(--feature-catalog))]/60">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs leading-none text-[hsl(var(--feature-catalog))]">
            ›
          </span>
          <span className="font-display text-xs uppercase tracking-wider text-foreground">
            {template.name}
          </span>
        </div>
        <span className="font-display text-[10px] uppercase tracking-wider text-[hsl(var(--feature-catalog))]">
          AVAILABLE
        </span>
      </header>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <dl className="space-y-1 font-mono text-[11px]">
          <SpecRow label="HARNESS" value={template.name.toLowerCase()} />
          <SpecRow label="ADAPTER" value="hand-written" />
          <SpecRow label="DEPLOY" value="fly.io" />
        </dl>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="outline" size="sm" onClick={() => openWith("many")}>
          Deploy 5
        </Button>
        <Button size="sm" onClick={() => openWith("one")}>
          › Deploy
        </Button>
      </footer>

      <DeployModal
        open={open}
        onOpenChange={setOpen}
        template={template}
        mode={mode}
      />
    </article>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className="text-foreground/80">{value}</dd>
    </div>
  );
}
