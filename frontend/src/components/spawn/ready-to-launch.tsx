"use client";

import { Button } from "@/components/ui/button";
import {
  PlacementBanner,
  type PlacementState,
} from "@/components/fleet/placement-banner";

/**
 * `<ReadyToLaunch>` — full-width green-bordered panel per design-system §34.3.
 * Wizard Step 5's commit moment: kicker, supporting copy, embedded placement
 * banner that gates the deploy button.
 *
 * The panel borrows the `--status-running` accent (the same green that
 * Hermes' nebula is dominant in) so the panel reads as the natural
 * culmination of the five-step flow.
 */
export function ReadyToLaunch({
  placement,
  onDeploy,
  blocked,
  summary,
}: {
  placement: PlacementState;
  onDeploy: () => void;
  blocked: boolean;
  summary: string;
}) {
  return (
    <div className="border border-[hsl(var(--status-running))]/50 bg-[hsl(var(--status-running))]/5">
      <div className="flex items-center justify-between border-b border-[hsl(var(--status-running))]/30 px-4 py-2">
        <div className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--status-running))]">
          [ READY TO LAUNCH ]
        </div>
        <div className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--status-running))]/70">
          STAND BY FOR DEPLOY
        </div>
      </div>

      <div className="space-y-4 px-4 py-5">
        <p className="text-sm leading-relaxed text-foreground/80">{summary}</p>

        <PlacementBanner state={placement} />

        <div className="flex items-center justify-end pt-1">
          <Button
            size="lg"
            onClick={onDeploy}
            disabled={blocked}
            className="font-display text-sm uppercase tracking-widest"
          >
            › DEPLOY AGENT
          </Button>
        </div>
      </div>
    </div>
  );
}
