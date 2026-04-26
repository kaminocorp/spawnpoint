"use client";

import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import type { HarnessEntry } from "@/lib/spawn/harnesses";

/**
 * `<CharacterSheet>` — Wizard Step 5 review portrait + 3-column stat block.
 *
 * Portrait: 180px live `<NebulaAvatar>` + agent name in `text-3xl font-display
 * uppercase` + harness display name as subtitle. This is the *second* canvas
 * to mount during a wizard session — Step 1's gallery canvas is unmounted by
 * the time the operator reaches Step 5, so the one-canvas-page-wide invariant
 * (decision 21) holds across the wizard's lifetime.
 *
 * Stat block: three columns (IDENTITY / INTELLIGENCE / LOADOUT) each with the
 * §34.1 step-accent rule on top — feature-secrets / feature-adapter /
 * feature-deploy respectively.
 */
export function CharacterSheet({
  harness,
  templateName,
  agentName,
  identityRows,
  intelligenceRows,
  loadoutRows,
}: {
  harness: HarnessEntry | undefined;
  templateName: string;
  agentName: string;
  identityRows: ReadonlyArray<StatRow>;
  intelligenceRows: ReadonlyArray<StatRow>;
  loadoutRows: ReadonlyArray<StatRow>;
}) {
  const display = (agentName.trim() || "—").toUpperCase();
  return (
    <div className="space-y-5">
      <Portrait
        harness={harness}
        templateName={templateName}
        agentName={display}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatColumn
          kicker="IDENTITY"
          accentVar="--feature-secrets"
          rows={identityRows}
        />
        <StatColumn
          kicker="INTELLIGENCE"
          accentVar="--feature-adapter"
          rows={intelligenceRows}
        />
        <StatColumn
          kicker="LOADOUT"
          accentVar="--feature-deploy"
          rows={loadoutRows}
        />
      </div>
    </div>
  );
}

export type StatRow = { label: string; value: string };

function Portrait({
  harness,
  templateName,
  agentName,
}: {
  harness: HarnessEntry | undefined;
  templateName: string;
  agentName: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 border border-border bg-card/40 px-4 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
      <div className="flex shrink-0 items-center justify-center bg-black/40 p-2">
        {harness ? (
          <NebulaAvatar harness={harness.key} size={180} />
        ) : (
          <div className="size-[180px] border border-border" />
        )}
      </div>
      <div className="flex-1 space-y-1.5 text-center sm:text-left">
        <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
          [ CHARACTER SHEET ]
        </div>
        <h2 className="font-display text-3xl font-bold uppercase tracking-widest text-foreground">
          {agentName}
        </h2>
        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {harness?.name ?? templateName}
        </div>
      </div>
    </div>
  );
}

function StatColumn({
  kicker,
  accentVar,
  rows,
}: {
  kicker: string;
  accentVar: string;
  rows: ReadonlyArray<StatRow>;
}) {
  return (
    <div
      className="space-y-2 border-t-2 bg-card/30 px-3 py-3"
      style={{ borderTopColor: `hsl(var(${accentVar}))` }}
    >
      <div
        className="font-display text-[11px] uppercase tracking-widest"
        style={{ color: `hsl(var(${accentVar}))` }}
      >
        [ {kicker} ]
      </div>
      <dl className="space-y-1 font-mono text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground/70">
              {r.label}
            </dt>
            <dd className="flex-1 break-all text-foreground/80">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
