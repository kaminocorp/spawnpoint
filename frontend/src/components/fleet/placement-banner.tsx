"use client";

import type { PlacementResult } from "@/gen/corellia/v1/agents_pb";

/**
 * `<PlacementBanner>` — shared by the spawn wizard's Review step
 * (Phase 6) and the fleet inspector's edit-form preview (Phase 7).
 * Surfaces the result of `CheckDeploymentPlacement` in the four
 * states the FE can land in.
 */

export type PlacementState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; result: PlacementResult }
  | { kind: "blocked"; result: PlacementResult }
  | { kind: "error"; message: string };

export function PlacementBanner({ state }: { state: PlacementState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "checking") {
    return (
      <div className="border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
        › checking placement availability…
      </div>
    );
  }

  if (state.kind === "ok") {
    return (
      <div className="border border-[hsl(var(--status-running))]/40 bg-[hsl(var(--status-running))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-running))]">
        ✓ placement available
        {state.result.reason ? ` — ${state.result.reason}` : ""}
      </div>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div className="space-y-1 border border-[hsl(var(--status-failed))]/40 bg-[hsl(var(--status-failed))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-failed))]">
        <div>
          ✗ placement unavailable
          {state.result.reason ? ` — ${state.result.reason}` : ""}
        </div>
        {state.result.alternateRegions.length > 0 && (
          <div className="text-foreground/70">
            try: {state.result.alternateRegions.join(", ")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-[hsl(var(--status-failed))]/40 bg-[hsl(var(--status-failed))]/10 px-3 py-2 font-mono text-[11px] text-[hsl(var(--status-failed))]">
      ✗ placement check failed: {state.message}
    </div>
  );
}
