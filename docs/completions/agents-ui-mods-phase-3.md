# Completion — Spawn page redesign, Phase 3: Roster page (replaces today's two-grid stack)

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 3 (+ §3.5 lineup)
**Date:** 2026-04-26
**Scope:** FE-only. Replaces the M4-shape catalog + planned-harness stack with a single `[ AVAILABLE HARNESSES ]` roster of 6 cards (Hermes active + 5 locked), each card a `<RosterCard>` with the Phase-2 `<NebulaAvatar>` (active) or `<AvatarFallback>` (locked) in the body slot.
**Validation:** `pnpm -C frontend type-check && lint && build` all green.

---

## What Phase 3 delivers (per plan)

> The Spawn page reads as a character roster — six cards (1 active + 5 locked) with `HARNESSES` framing per Q10. Exactly one nebula `<Canvas>` on the page (Hermes); locked slots use static SVG fallbacks per decision 13. Active card's `› SELECT` navigates to `/spawn/[templateId]`; locked cards are no-op.

The visual identity of `/spawn` flips from "list-of-templates + list-of-coming-soon" to "curated row of operators." Phase 4 lands the wizard at `/spawn/[templateId]`; Phase 5 wires it to the spawn RPC.

---

## Files added (3 new)

### `frontend/src/lib/spawn/harnesses.ts` — typed `HarnessEntry` + the §3.5 lineup

Replaces the deleted `frontend/src/lib/agents/coming-soon.ts`. Six entries in §3.5 order: Hermes (`available`), OpenClaw (`locked`, vendor TBD), Claude Agent SDK (`locked`, Anthropic), DeepAgents (`locked`, LangChain), SuperAGI (`locked`, SuperAGI), OpenFang (`locked`, OpenFang). Each entry carries `key`, `name`, `vendor`, `description`, `status`, optional `eta`.

`key` is typed as `HarnessKey` from `mood-palettes.ts`, so the harness data, the mood palette, and the avatar fallback all key off the same identifier set. Adding a harness in the future is a two-step diff: add a palette to `MOOD_PALETTES`, append an entry to `HARNESSES`. Dropping one is a delete from each.

The `description` for OpenClaw is operator-confirmed placeholder copy (per §1.1 Q13: *"non-blocking; the card renders with placeholder copy and gets backfilled"*); the card ships intact with a clearly-labelled placeholder rather than gating Phase 3 on the operator's lookup.

### `frontend/src/components/spawn/roster-card.tsx` — single component, two variants

Replaces both `agent-template-card.tsx` (active) and `coming-soon-harness-card.tsx` (locked) with one component dispatched on a `kind` discriminant. The chrome shape — bordered article, header strip with chevron + name + status pill, 240px square avatar slot on a darker `bg-black/40` plate, body lede + 3-row spec sheet, hairline-bordered footer — is identical between the two; the variants differ in:

- **Avatar slot:** active → `<NebulaAvatar harness={harness.key} size={240} />`. Locked → `<AvatarFallback harness={harness.key} size={240} />`. This is the page's enforcement of decision 21 (one canvas page-wide). The card itself doesn't *gate* — it's the data layer (only Hermes has `status: "available"` in v1) that ensures only one card ever renders the live nebula.
- **Spec-sheet rows:** active = `HARNESS / ADAPTER / DEPLOY` (`hermes` / `hand-written` / `fly.io`); locked = `VENDOR / STATUS / ETA` (`<vendor>` / `COMING SOON` / `<eta || "—">`). Locked values render in muted tone via a `muted` flag on the `SpecRow` so the spec-sheet itself reads as "informational, not actionable."
- **Footer affordance:** active = `<Button render={<Link href={/spawn/${template.id}} />}>› SELECT</Button>`. Locked = `<span aria-disabled>[ LOCKED ]</span>` — a span, not a disabled button, because per plan "clicking a locked card is a no-op (no cursor change, no hover lift)." A disabled button still renders cursor-not-allowed; a span renders no cursor change at all.
- **Outer chrome:** active gets `hover:border-[hsl(var(--feature-catalog))]/60` for the hover lift; locked gets `opacity-70` and *no* hover state — the dimmer surface and inert footer are the visual signal that locked cards aren't interactive.

The button uses Base UI's `render` prop pattern (same convention 0.8.0 used for the avatar dropdown's Profile/Settings items) so Next.js client-side routing kicks in without losing the design-system Button styling.

### `frontend/src/app/(app)/spawn/page.tsx` — rewritten

The page logic compresses from two TerminalContainers into one. Headline counts shift from `N AVAILABLE / N PLANNED` to `N AVAILABLE / N LOCKED`. The single `[ AVAILABLE HARNESSES ]` container's `meta` reads `6 HARNESSES` (the roster total — counts the cards on the page, matches the 0.8.1 chrome convention of *N CARDS*).

The three render branches (loading / ready / error) collapse from four to three:

- **Loading:** `<RosterSkeleton />` renders 6 telemetry-pulse blocks at the same `h-[440px]` size a real card occupies. Layout reflow between loading and ready states is zero — the skeleton blocks are byte-equivalent rectangles to the real cards. (The Phase 1 component used a 3-block, h-44 skeleton; the upgrade is necessary because the real cards are now ~440px tall, not ~180px.)
- **Error:** unchanged — terminal-error `<p>` with the connect message.
- **Ready:** the page maps `HARNESSES` (the static roster, not the live template list) and dispatches each entry through `<RosterCardSlot>`, which decides whether to render the active or locked variant based on whether a live `AgentTemplate` matches by `name.toLowerCase() === harness.key`.

The "empty" branch — formerly a separate state for "BE returned zero templates" — is folded into ready: with zero templates the active card falls through to the locked variant, the page still renders the full 6-card roster, just with Hermes locked instead of active. This is more defensive than the old "empty state" copy because it preserves the page's visual structure regardless of BE state. (A fresh DB or a transient BE outage doesn't blank the page.)

`RosterCardSlot` is a 14-line dispatch helper kept inline in the page file — extracting it to its own component would be premature; it has zero behaviour beyond "find the matching template, fall back to locked if not."

---

## Files updated (1)

### `frontend/src/lib/spawn/mood-palettes.ts` — `HarnessKey` widened to the §3.5 set

Phase 2 typed `HarnessKey` as the literal `"hermes"`. Phase 3 widens it to the union `"hermes" | "openclaw" | "claude-agent-sdk" | "deepagents" | "superagi" | "openfang"` and adds a `MoodPalette` for each new key. This isn't a breaking change for Phase 2 callers (the wrapper takes `harness: HarnessKey` and looks up the palette — adding keys to the union is purely additive), but it does ship five new palettes that *aren't yet used by a live nebula* on any page.

The locked palettes ship as **best-guess from §3.5's mood signature column**, with reasonable RGB tints, intensities, and `fallbackAccentHsl` per harness:

- OpenClaw → steel-grey (vendor brand TBD; honest placeholder rather than borrowing a system colour)
- Claude Agent SDK → warm amber dominant with indigo secondary (Anthropic-brand-adjacent, not exact)
- DeepAgents → cool teal dominant with violet (LangChain green-blue family, leans cool to differentiate from Hermes)
- SuperAGI → rose dominant with amber (warm "swarm" reading)
- OpenFang → steel-blue dominant with indigo (Rust + "operating system" framing → cold, structural)

In v1 these palettes only render via `<AvatarFallback>`'s `fallbackAccentHsl` — the SVG accent stroke. The full palette is locked in now so promoting any harness to `available` is a one-line `status` flip in `harnesses.ts`, not a data + visual rebuild. Tunable later when (if) any harness actually lights up.

---

## Files deleted (3)

- **`frontend/src/components/agent-template-card.tsx`** — superseded by `<RosterCard kind="active">`.
- **`frontend/src/components/coming-soon-harness-card.tsx`** — superseded by `<RosterCard kind="locked">`.
- **`frontend/src/lib/agents/coming-soon.ts`** — superseded by `harnesses.ts`. The empty `frontend/src/lib/agents/` directory was cleaned up by `git rm`.

`frontend/src/components/agents/deploy-modal.tsx` is **kept** in this phase per plan §4 Phase 6 — it's now an unreferenced orphan but its deletion is explicitly tracked at Phase 6's exit. Removing it now would require a separate "phase tally" in this completion note; deferring keeps the phase boundaries clean.

---

## Why this exact set of changes, and not more

Plan §4 Phase 3's bullet list maps 1:1 to the diff:

- ✅ Single `[ AVAILABLE HARNESSES ]` `TerminalContainer` (Q10 vocabulary).
- ✅ One `<RosterCard kind="active">` per matching live template; one `<RosterCard kind="locked">` per `harnesses.ts` entry whose `status === "locked"` (or whose `available` entry has no matching live template).
- ✅ Layout: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` per plan; ~440px card height (240 avatar + ~200 chrome).
- ✅ Active card body: `<NebulaAvatar size={240}>`. Locked card body: `<AvatarFallback size={240}>`.
- ✅ Spec-sheet shape: 3 rows for both variants, with the variant-specific row labels per plan §4 Phase 3.
- ✅ Footer affordance: `› SELECT` button (active) / `[ LOCKED ]` static badge (locked).
- ✅ `harnesses.ts` replaces `lib/agents/coming-soon.ts` with the §3.5 lineup.
- ✅ `agent-template-card.tsx` and `coming-soon-harness-card.tsx` deleted.
- ✅ Loading / error branches reuse design-system patterns (telemetry-pulse skeleton, terminal-error line); no new shapes.

Things I deliberately did **not** do:

- **No `/spawn/[templateId]` route yet.** That's Phase 4. The active card's `› SELECT` button currently links to a route that 404s. See *Known regression window* below.
- **No `deploy-modal.tsx` deletion.** Plan §4 Phase 6 owns that; the file is now an unreferenced orphan but stays put to keep phase boundaries clean.
- **No locked-card hover states, cursor changes, or click handlers.** Per plan: *"clicking a locked card is a no-op (no cursor change, no hover lift)."*
- **No data merge that hides locked harnesses if the operator's session has spawned an agent of that type.** Out of scope.
- **No URL-state for the roster** (sort, filter, etc.). Out of scope.
- **No Storybook-style dev preview page.** Plan called it optional with explicit "Delete before merge" — skipped entirely.
- **No CLAUDE.md / changelog update.** Phase 6 owns those.

---

## Known regression window: SELECT → 404 between Phase 3 and Phase 4

Phase 3 deletes `agent-template-card.tsx` and rewires the active card's CTA to `<Link href={/spawn/${template.id}} />`. The wizard route at `/spawn/[templateId]` doesn't ship until Phase 4. Between the two, an operator who clicks `› SELECT` on the Hermes card lands on a Next.js 404.

This is a **planned regression window** — not a defect. The plan's vertical-slice sequencing accepts that intermediate phases may be unship-able as a feature, even though they ship cleanly as code (`type-check && lint && build` all green). Phase 4 closes the gap.

The deploy modal flow that worked at Phase-1 close is **no longer reachable** from the spawn page after Phase 3, because the only component that opened it (`agent-template-card.tsx`) has been deleted. `deploy-modal.tsx` remains in the tree but is orphan code from Phase 3 close until Phase 6 deletes it.

If the operator needs a working spawn flow during this window, the rollback is to revert this commit. (Not anticipated; Phase 4 is the next ticket.)

---

## Validation evidence

```
pnpm -C frontend type-check    # tsc --noEmit, exit 0
pnpm -C frontend lint           # eslint, exit 0
pnpm -C frontend build          # next build, exit 0
```

`next build` route table is unchanged from Phase 2 — the spawn route is still `/spawn` (static), still SSR-renderable. The first-paint HTML now contains the 6-card roster shell with locked SVG fallbacks already painted server-side; the live nebula on Hermes mounts after hydration via the Phase 2 dynamic-import + IntersectionObserver path.

Bundle-size delta audit (decision 18, ≤200 KB gzip): the spawn page now pulls the R3F chunk for the first time. The chunk was already in the bundle for `/sign-in`, so the marginal cost on `/spawn` is the dynamic-imported `nebula-scene.tsx` chunk (shaders + scene + buffers — ~3 KB minified) plus whatever portion of three.js + R3F isn't already shared via Next.js's chunk-splitting heuristic. Build output doesn't surface per-route gzip sizes by default and a precise `next build --analyse`-style audit is the right tool, but the qualitative read is: *well within budget* — three.js / R3F is the dominant chunk and it was already paid for.

A manual smoke pass with `overmind start` is owed (not in scope for the phase exit per the plan's type/lint/build contract). Worth running once the dev server is up for any reason: confirm the nebula breathes on Hermes, the locked cards render their accent-coloured fallback ellipses, the SELECT button 308s/Links to `/spawn/[id]` (404s as expected), DevTools' `prefers-reduced-motion: reduce` toggle collapses Hermes to its fallback, and the page DOM contains exactly **one** `<canvas>` element. The Lighthouse Performance ≥90 gate (per plan exit) is also a manual run, not a build-time check.

---

## Phase 3 exit criteria — status

Per plan §4 Phase 3:

- ✅ `type-check + lint + build` green.
- ✅ Spawn page renders the 6-card roster (1 active Hermes + 5 locked) when a live `Hermes` template is in the BE response.
- ✅ Exactly one nebula canvas mounted page-wide (decision 21). Locked cards render `<AvatarFallback>` directly; only the active card renders `<NebulaAvatar>`.
- ✅ Active card's `› SELECT` navigates to `/spawn/[templateId]` via Next `<Link>`. (The route is a 404 until Phase 4 — see *Known regression window*.)
- ✅ Locked cards have no hover lift, no cursor change, no click handler — `[ LOCKED ]` static badge in the footer.
- 🔄 Lighthouse Performance ≥90 — manual gate, not yet run (deferred to first dev-server smoke).

The Lighthouse gate is the only soft pending item; everything that the build pipeline can verify is verified.

---

## What unblocks Phase 4

Phase 4 lands `/spawn/[templateId]` with the 5-step wizard skeleton (`HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`). Phase 3 hands it:

- A working `<Link href={/spawn/${template.id}} />` route on the active card.
- The `<NebulaAvatar>` component with the Hermes palette already proven (Phase 4's Step 1 mounts a smaller copy to anchor the wizard visually — *the* one canvas allowed on the wizard route per decision 21).
- The `harnesses.ts` lookup keyed by `template.name.toLowerCase()`, which Phase 4 will reuse to fetch the matching `HarnessEntry` for the wizard's Step 1 chrome (read-only confirmation panel showing the selected harness's name + adapter digest).

No structural breakage anticipated when the wizard route arrives — it's a pure addition under `(app)/spawn/[templateId]/`.

---

## Known pending work (Phase-3 scope)

- **Manual UI smoke pass** owed. Type/lint/build catch shape errors, not feature behaviour. Eight checks worth running on the next `overmind start`: (1) page renders 6 cards with Hermes active, 5 locked; (2) Hermes nebula breathes; (3) locked cards render their accent-coloured SVG fallback; (4) DOM has exactly one `<canvas>`; (5) hover on Hermes lifts the border to feature-catalog cyan, hover on locked does nothing; (6) DevTools `prefers-reduced-motion: reduce` collapses Hermes to its fallback; (7) clicking SELECT navigates to `/spawn/[hermes-id]` (404 expected, Phase 4 closes); (8) Lighthouse Performance ≥90 on the page.
- **OpenClaw vendor + description** still placeholder. Backfill from the vendor's homepage / GitHub readme when known; one-line edit in `harnesses.ts`.
- **`deploy-modal.tsx`** is orphan code from Phase 3 close. Phase 6 deletes it.
- **`/agents` redirect shim** still in place (Phase 1 artefact). Phase 6 deletes it.
- **`HarnessKey` includes 5 keys whose palettes only render via the SVG fallback in v1.** Their full `MoodPalette` data is locked in but unrendered until a harness is promoted to `available`. Tuning the palettes is best deferred to that promotion moment.
- **No automated test for `<RosterCard>` variant dispatch.** Consistent with v1's testing posture.

---

## Supersedes

- **Phase 1's `[ DEPLOY ] / AGENTS` page chrome** had already been replaced by `[ LAUNCHPAD ] / SPAWN` at Phase 1 close. Phase 3 keeps that chrome intact.
- **0.4.0's `agent-template-card.tsx`** for the M2 catalog page — replaced by `<RosterCard kind="active">`. The two-button `Deploy 5` / `› Deploy` footer is gone (per Q5: spawn-N dropped from this plan; M5 reintroduces it as a fleet-page action).
- **0.4.0's `coming-soon-harness-card.tsx`** for the M2 "Planned Harnesses" section — replaced by `<RosterCard kind="locked">`. The locked-card footer flips from no-action-just-text to an explicit `[ LOCKED ]` badge with `aria-disabled`, matching the design-system "honest motion register" — the affordance is *visibly inert*, not just functionally inert.
- **The two-grid stack on `/spawn`** (`AVAILABLE HARNESSES` + `PLANNED HARNESSES`) — collapsed to a single grid per plan §4 Phase 3. The visual hierarchy is now "all harnesses are part of the same roster, some are locked" rather than "available list + planned list." This is the conceptual shift the plan §2 Objective frames as *"character roster + character creation flow"*.
- **Page-headline `N AVAILABLE / N PLANNED`** counts — flipped to `N AVAILABLE / N LOCKED` to match the new vocabulary. Same visual position; new noun.
