import type { Metadata } from "next";

import { Wizard } from "@/components/spawn/wizard";

export const metadata: Metadata = {
  title: "Spawn — Corellia",
};

/**
 * `/spawn` — harness gallery (redesign-spawn Phases 1–3).
 *
 * Renders the shared `<Wizard>` in `gallery` mode: Step 1 shows the harness
 * roster as a horizontal scroll-snap carousel (`<HarnessCarousel>`) with a
 * `prefers-reduced-motion` grid fallback; Steps 2–5 are visible but
 * `inert`/PENDING shells so the operator sees the shape of the flow before
 * selecting. Clicking `› SELECT` calls `router.replace("/spawn/[templateId]")`,
 * which remounts the Wizard in `confirmed` mode with Step 1 pre-confirmed
 * and Step 2 active.
 *
 * Previously this was a standalone client page with its own template fetch.
 * That fetch has moved into the Wizard so both entry points share one
 * component tree. See `docs/completions/redesign-spawn-phase-1.md`.
 */
export default function SpawnPage() {
  return <Wizard initialMode="gallery" />;
}
