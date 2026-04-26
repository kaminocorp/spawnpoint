"use client";

import { Button } from "@/components/ui/button";

/**
 * `<SelectionToolbar>` — Phase 8 of fleet-control. Sticky bottom
 * toolbar that appears when ≥1 fleet row is selected. Plan §4 Phase
 * 8 + decision 28: cap at 50 — over-cap selection disables the
 * "Apply config…" button with a tooltip-equivalent title attribute.
 */

export const BULK_APPLY_CAP = 50;

type Props = {
  count: number;
  onApply: () => void;
  onClear: () => void;
};

export function SelectionToolbar({ count, onApply, onClear }: Props) {
  if (count === 0) return null;
  const overCap = count > BULK_APPLY_CAP;

  return (
    <div className="sticky bottom-3 z-40 mx-auto w-fit">
      <div className="flex items-center gap-3 border border-[hsl(var(--feature-deploy))]/60 bg-card/95 px-3 py-2 font-mono text-[11px] shadow-lg backdrop-blur">
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          [ SELECTION ]
        </span>
        <span className="text-foreground">{count} selected</span>
        {overCap && (
          <span className="text-[hsl(var(--status-failed))]">
            · over cap ({BULK_APPLY_CAP})
          </span>
        )}
        <span className="text-muted-foreground/50">·</span>
        <Button
          size="xs"
          onClick={onApply}
          disabled={overCap}
          title={
            overCap
              ? `Bulk apply is capped at ${BULK_APPLY_CAP} agents per submit (plan decision 28).`
              : undefined
          }
        >
          › APPLY CONFIG…
        </Button>
        <Button size="xs" variant="ghost" onClick={onClear}>
          CLEAR
        </Button>
      </div>
    </div>
  );
}
