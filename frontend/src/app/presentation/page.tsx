import { Deck } from "@/components/presentation/deck";

/**
 * `/presentation` — public top-level route (no auth gate). Sibling of
 * `/sign-in`. The deck is the narrative half of the hackathon
 * submission video (60s for ~7 slides; the demo half is recorded
 * separately on `/spawn`).
 *
 * Phase 6 — `?mode=record` switches the deck into recording mode:
 * chrome hidden, auto-advance on the locked beat-sheet timeline,
 * deterministic per-slide seeding. Default mode stays click-advance.
 *
 * Next 16's `searchParams` is a Promise (App Router async-params); we
 * unwrap it server-side and hand a plain boolean to the client deck.
 */
export default async function PresentationPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const recordMode = params.mode === "record";

  return (
    <main className="relative flex min-h-screen flex-col bg-black text-foreground">
      <Deck recordMode={recordMode} />
    </main>
  );
}
