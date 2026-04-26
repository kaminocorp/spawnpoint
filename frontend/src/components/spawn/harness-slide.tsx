"use client";

import { AvatarFallback } from "@/components/spawn/avatar-fallback";
import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { Button } from "@/components/ui/button";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import type { HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * One harness card — the atomic unit of both the carousel and the
 * `prefers-reduced-motion` grid fallback.
 *
 * Each slide owns its avatar: the active unlocked slide renders a live
 * `<NebulaAvatar>` canvas; locked and off-screen slides show the static
 * `<AvatarFallback>`. Since scroll-snap shows exactly one slide at a time,
 * only one canvas is ever mounted in the carousel at once.
 *
 * `isActive` controls both the avatar branch and whether `› SELECT` is in
 * the Tab order (`tabIndex={0}` when active, `tabIndex={-1}` otherwise).
 *
 * Locked slides show a `[ LOCKED ]` overlay and a `disabled` `› SELECT`
 * button (decision 4 — not hidden, just inert).
 */
export function HarnessSlide({
  harness,
  template,
  isActive,
  onSelect,
}: {
  harness: HarnessEntry;
  /** Defined when the harness has a live AgentTemplate; undefined = locked. */
  template?: AgentTemplate;
  isActive: boolean;
  onSelect: (templateId: string) => void;
}) {
  const isLocked = !template;
  const chevronTone = isLocked
    ? "text-muted-foreground/50"
    : "text-[hsl(var(--feature-catalog))]";
  const statusTone = isLocked
    ? "text-muted-foreground/60"
    : "text-[hsl(var(--feature-catalog))]";

  return (
    <article
      className={[
        "flex h-full flex-col border border-border bg-card",
        isLocked
          ? "opacity-70"
          : "transition-colors hover:border-[hsl(var(--feature-catalog))]/60",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`font-display text-xs leading-none ${chevronTone}`} aria-hidden>
            ›
          </span>
          <span
            className={`font-display text-sm uppercase tracking-wider ${
              isLocked ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {harness.name}
          </span>
        </div>
        <span className={`font-display text-[11px] uppercase tracking-wider ${statusTone}`}>
          {isLocked ? "LOCKED" : "AVAILABLE"}
        </span>
      </header>

      <div className="relative h-48 bg-black/40 sm:h-56 md:h-64">
        {isActive && !isLocked ? (
          <NebulaAvatar fill harness={harness.key} />
        ) : (
          <AvatarFallback fill harness={harness.key} />
        )}
        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="select-none font-display text-sm uppercase tracking-widest text-muted-foreground/70">
              [ LOCKED ]
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {harness.description}
        </p>
        <dl className="space-y-1 font-mono text-xs">
          {isLocked ? (
            <>
              <SlideSpecRow label="VENDOR" value={harness.vendor} muted />
              <SlideSpecRow label="STATUS" value="COMING SOON" muted />
              <SlideSpecRow label="ETA" value={harness.eta ?? "—"} muted />
            </>
          ) : (
            <>
              <SlideSpecRow label="HARNESS" value={harness.key} />
              <SlideSpecRow label="ADAPTER" value="hand-written" />
              <SlideSpecRow label="DEPLOY" value="fly.io" />
            </>
          )}
        </dl>
      </div>

      <footer className="flex items-center justify-end border-t border-border px-3 py-2">
        <Button
          size="sm"
          disabled={isLocked}
          aria-disabled={isLocked}
          tabIndex={isActive ? 0 : -1}
          onClick={() => {
            if (!isLocked && template) onSelect(template.id);
          }}
        >
          › SELECT
        </Button>
      </footer>
    </article>
  );
}

function SlideSpecRow({
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
      <dt className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className={muted ? "text-muted-foreground" : "text-foreground/80"}>{value}</dd>
    </div>
  );
}
