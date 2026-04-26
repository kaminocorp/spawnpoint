import type { Metadata } from "next";

import { Wizard } from "@/components/spawn/wizard";

export const metadata: Metadata = {
  title: "Spawn — Corellia",
};

/**
 * `/spawn` — harness gallery (Phase 1 of redesign-spawn.md).
 *
 * Renders the shared `<Wizard>` in `gallery` mode: Step 1 shows the full
 * harness roster as a vertical grid; Steps 2–5 are visible but inert/pending.
 * Selecting a harness navigates to `/spawn/[templateId]` (via the
 * `<RosterCard>` Link), which remounts the Wizard in `confirmed` mode with
 * Step 1 already confirmed and Step 2 active.
 *
 * Previously this was a standalone client page with its own template fetch.
 * That fetch has moved into the Wizard so both entry points share one
 * component tree. See Phase 1 implementation notes in
 * `docs/completions/redesign-spawn-phase-1.md`.
 */
export default function SpawnPage() {
  return <Wizard initialMode="gallery" />;
}
