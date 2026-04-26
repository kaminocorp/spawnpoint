import Link from "next/link";

import { AvatarFallback } from "@/components/spawn/avatar-fallback";
import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { Button } from "@/components/ui/button";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import type { HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * `<RosterCard>` — Phase 3 of `docs/executing/agents-ui-mods.md`.
 *
 * Replaces `agent-template-card.tsx` (active variant) and
 * `coming-soon-harness-card.tsx` (locked variant) with a single component
 * keyed off `kind`. Same chrome shape between variants — the visual
 * difference is the avatar slot (live nebula vs static SVG), the
 * spec-sheet rows (HARNESS/ADAPTER/DEPLOY vs VENDOR/STATUS/ETA), and the
 * footer affordance (`› SELECT` button vs `[ LOCKED ]` badge).
 *
 * Per decision 21 the active variant is the *only* place a `<NebulaAvatar>`
 * is mounted on the spawn page; locked cards render `<AvatarFallback>`
 * directly so the page-wide WebGL context count stays at exactly one.
 */

type ActiveProps = {
  kind: "active";
  harness: HarnessEntry;
  template: AgentTemplate;
};

type LockedProps = {
  kind: "locked";
  harness: HarnessEntry;
};

type RosterCardProps = ActiveProps | LockedProps;

export function RosterCard(props: RosterCardProps) {
  if (props.kind === "active") return <ActiveCard {...props} />;
  return <LockedCard {...props} />;
}

function ActiveCard({ harness, template }: ActiveProps) {
  return (
    <article className="group flex flex-col border border-border bg-card transition-colors hover:border-[hsl(var(--feature-catalog))]/60">
      <CardHeader name={harness.name} status="available" />

      <div className="flex items-center justify-center bg-black/40 px-3 py-3">
        <NebulaAvatar harness={harness.key} size={240} />
      </div>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {template.description || harness.description}
        </p>
        <dl className="space-y-1 font-mono text-[11px]">
          <SpecRow label="HARNESS" value={harness.key} />
          <SpecRow label="ADAPTER" value="hand-written" />
          <SpecRow label="DEPLOY" value="fly.io" />
        </dl>
      </div>

      <footer className="flex items-center justify-end border-t border-border px-3 py-2">
        <Button size="sm" render={<Link href={`/spawn/${template.id}`} />}>
          › SELECT
        </Button>
      </footer>
    </article>
  );
}

function LockedCard({ harness }: LockedProps) {
  return (
    <article className="flex flex-col border border-border bg-card opacity-70">
      <CardHeader name={harness.name} status="locked" />

      <div className="flex items-center justify-center bg-black/40 px-3 py-3">
        <AvatarFallback harness={harness.key} size={240} />
      </div>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {harness.description}
        </p>
        <dl className="space-y-1 font-mono text-[11px]">
          <SpecRow label="VENDOR" value={harness.vendor} muted />
          <SpecRow label="STATUS" value="COMING SOON" muted />
          <SpecRow label="ETA" value={harness.eta ?? "—"} muted />
        </dl>
      </div>

      <footer className="flex items-center justify-end border-t border-border px-3 py-2">
        <span
          aria-disabled
          className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60"
        >
          [ LOCKED ]
        </span>
      </footer>
    </article>
  );
}

function CardHeader({
  name,
  status,
}: {
  name: string;
  status: HarnessEntry["status"];
}) {
  const statusLabel = status === "available" ? "AVAILABLE" : "LOCKED";
  // Active uses catalog cyan as the chevron + status accent; locked stays
  // muted so the active card visibly leads the eye.
  const chevronTone =
    status === "available"
      ? "text-[hsl(var(--feature-catalog))]"
      : "text-muted-foreground/50";
  const statusTone =
    status === "available"
      ? "text-[hsl(var(--feature-catalog))]"
      : "text-muted-foreground/60";
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`font-display text-xs leading-none ${chevronTone}`}
          aria-hidden
        >
          ›
        </span>
        <span
          className={`font-display text-xs uppercase tracking-wider ${
            status === "available" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {name}
        </span>
      </div>
      <span
        className={`font-display text-[10px] uppercase tracking-wider ${statusTone}`}
      >
        {statusLabel}
      </span>
    </header>
  );
}

function SpecRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className={muted ? "text-muted-foreground" : "text-foreground/80"}>
        {value}
      </dd>
    </div>
  );
}
