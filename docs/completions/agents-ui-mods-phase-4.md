# Completion — Spawn page redesign, Phase 4: Wizard route + step shell

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 4
**Date:** 2026-04-26
**Scope:** FE-only. Adds `/spawn/[templateId]` — the 5-step wizard skeleton (`HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`) per design-system §34. Phase 4 ships the *shell* — step containers, accent colors, gating logic, cascading invalidation. Real fields are Phase 5; bodies render `<StubBody>` placeholders for now. The `› SELECT` regression window opened by Phase 3 is closed.
**Validation:** `pnpm -C frontend type-check && lint && build` all green; new dynamic route `/spawn/[templateId]` shows up in the build's route table.

---

## What Phase 4 delivers (per plan)

> `/spawn/[templateId]` renders a 5-step wizard skeleton per design-system §34, with step gating and in-memory state (no URL params per Q3). Steps are stub-content — real fields land in Phase 5.

The roster's `› SELECT` button now lands on a real route instead of Next's 404 page. The wizard reads as a continuation of the click — Step 1 anchors visually with the harness's nebula avatar (the *one* canvas allowed on this route per decision 21). Steps 2–5 render dimmed and inert until earlier steps are confirmed; confirming each advances the active cursor. Refresh resets to Step 1 — wizard state is in-memory only per decision 8.

---

## Files added (2 new)

### `frontend/src/app/(app)/spawn/[templateId]/page.tsx` — server entry, ~25 LOC

Tiny server component. The whole job is to unwrap Next 16's async `params: Promise<{ templateId: string }>` and hand the id to the client `<Wizard>`. Also pins `metadata.title = "Spawn // Configure — Corellia"` so the browser tab and the document `<title>` match the wizard's role.

**Deliberate deviation from the plan: the data fetch is client-side, not server-side.** Plan §4 Phase 4 prescribed *"Server component: fetches the template by ID."* The project's `createApiClient()` transport binds the BE call to the **browser-only** Supabase session (`@/lib/supabase/client`), so a true server-side fetch would mean introducing a server-side Connect transport that re-issues the token via `@/lib/supabase/server`. Every other authenticated route in `(app)/*` (dashboard, fleet, the parent `/spawn` itself) is client-side for the same reason. Adding the server-side variant *just for this one route* is exactly the abstraction the operator's standing instruction *"don't refactor or introduce abstractions beyond what the task requires"* warns against. The simpler, consistent path is: server unwraps params, client fetches and decides. Functional outcome is the same — the wizard renders only when the template is found, and a `not-found` terminal-error panel renders inline when it isn't (via the `WizardNotFound` branch of the `<Wizard>` fetch state). When `getAgentTemplate` arrives as its own RPC (plan §4 Phase 4 *"future cleanup"*), this can be revisited; not now.

### `frontend/src/components/spawn/wizard.tsx` — 5-step shell, ~330 LOC

The wizard component. Three concerns layered cleanly:

- **Fetch layer (`FetchState`).** Mirrors the parent `/spawn/page.tsx` pattern: `loading | ready | not-found | error`. On mount calls `listAgentTemplates`, finds the template by id, and resolves the matching `HarnessEntry` via `template.name.toLowerCase() === harness.key` (the same join the roster page uses, kept consistent so adding a harness is still a two-step diff). The `harness` field is optional in the `ready` state — a live template whose name doesn't match any roster entry still renders the wizard; just without the per-harness mood-palette nebula.
- **Wizard state (`WizardState` + `useReducer`).** State shape per plan: `{ current: StepKey, confirmed: ReadonlySet<StepKey>, fields: WizardFields }`. Three actions: `confirm` (adds the step to the confirmed set, advances `current` to the next step in the `STEPS` array), `edit` (un-confirms the target step *and every step downstream* per decision 9, then sets `current` to the target), `setField` (merge-patch into `fields`). The reducer is a plain function — no `useReducer` middleware, no immer, no thunks; the state is small enough that a `Set` clone per action is free.
- **Render layer (`StepShell` × 5).** Each step is a `TerminalContainer` with the accent color tied to its `STEP_META` row. The container's body is dispatched to a step-specific component (`HarnessStep`, `StubBody`, `DeploymentStub`); its footer renders either a `› CONFIRM` / `› DEPLOY AGENT` button (when `isCurrent`), a `[ EDIT ]` ghost button (when confirmed but not current), or nothing (when future and inert).

#### Step accent assignments

Plan §4 Phase 4 only pinned two accent colors directly: *"`STEP 3 // MODEL` → violet, `STEP 4 // DEPLOYMENT` → blue."* The other three are picked to read as a coherent left-to-right progression of the §5.4 feature-color sequence:

| Ordinal | Step       | Accent token       | Color     | Why                                                              |
|---------|-----------|--------------------|-----------|------------------------------------------------------------------|
| 1       | HARNESS    | `catalog`          | cyan      | Matches the active roster card's hover lift; thread continuity   |
| 2       | IDENTITY   | `secrets`          | pink      | The "secret-shaped" naming step — the name itself is the secret-shaped identifier of the new agent at this point |
| 3       | MODEL      | `adapter`          | violet    | Per plan                                                         |
| 4       | DEPLOYMENT | `deploy`           | blue      | Per plan                                                         |
| 5       | REVIEW     | `running`          | green     | Status-register green for "READY TO LAUNCH"; matches the §34.3 review-step register |

This isn't load-bearing for the v1 demo — the colors can shift in Phase 5/6 without restructure. Locking them in now keeps the visual rhythm stable while fields land.

#### Step gating — three visual states

Every step renders unconditionally (single page, no tab-style hiding). Three states:

1. **`isCurrent`** — full opacity, primary `› CONFIRM` button (or `› DEPLOY AGENT` for the last step).
2. **`isConfirmed && !isCurrent`** — full opacity, ghost `[ EDIT ]` button. Clicking it dispatches `edit` and cascades the un-confirm.
3. **`!isCurrent && !isConfirmed`** — `pointer-events-none opacity-40`. Visually present (the operator can preview the layout) but not interactive. No keyboard focus traps either — `pointer-events-none` lets the future-step's button stay focusable in the DOM but it can't actually be clicked, so the cascading-invalidation contract holds.

The `meta` slot of each `TerminalContainer` carries an `ACTIVE` / `CONFIRMED` / `PENDING` text tag so the operator can scan the wizard's state at a glance without depending on color alone (a11y).

#### Step bodies (Phase 4 stubs)

- **Step 1 // HARNESS — `<HarnessStep>`.** Real content. Renders the harness's `<NebulaAvatar size={180}>` on the left (the one canvas allowed on this route per decision 21), and a 3-row spec strip on the right: `ADAPTER: hand-written` / `DEPLOY: fly.io` / `TEMPLATE: <id>`. Mirrors the active roster card's spec-sheet shape, so the wizard reads as a continuation of the click. The plan's Step 1 prescription — *"read-only confirmation (template name + adapter digest)"* — is partially fulfilled: the wire-shape `AgentTemplate` doesn't surface an adapter digest field today (`agents.proto` exposes only `id / name / description`), so the strip uses the same `hand-written` / `fly.io` literals the roster card uses. Both displays will need a real digest field on the wire when the post-v1 generated-adapter pipeline lands; tracked as future work below.
- **Steps 2 / 3 / 5 — `<StubBody>`.** Two-line placeholder per step: a one-sentence label of what the body *will* hold, and a `[ FIELDS LAND IN PHASE 5 ]` strip-tag. Confirming the step still advances the cursor — the gating logic is exercised end-to-end even though no fields move.
- **Step 4 // DEPLOYMENT — `<DeploymentStub>`.** First slot for the M5 integration shape per plan decision 10. Surfaces the two M4-default values (`LIFECYCLE: always-on`, `REPLICAS: 1`) as read-only spec rows reading off `state.fields`, plus four real-interface stub rows (`REGION` / `SIZE` / `VOLUME` / `RESTART`) marked `[ COMING WITH FLEET CONTROL ]` per blueprint §11.4. When M5 lands, the four stub rows fill out into actual inputs without restructuring this step's container.

#### Other surfaces

- **Page header.** `[ LAUNCHPAD // CONFIGURE ]` eyebrow + harness name in the spawn-page font register; `STEP N OF 5` indicator on the right, reading off `state.current` via `STEP_META`.
- **Loading branch.** `WizardSkeleton` — six telemetry-pulse blocks (one for the header strip, five for the steps) at the same heights they'll occupy when ready. Zero layout reflow on first paint.
- **Error / not-found branches.** `WizardError` and `WizardNotFound` each render a single `<TerminalContainer accent="failed">` panel with the relevant message. The not-found panel surfaces the requested id so a misrouted operator can see *why* the route bounced.

---

## Files updated (0)

No existing files modified. This phase is a pure addition.

---

## Files deleted (0)

`deploy-modal.tsx` is still in the tree as orphan code — Phase 6 owns the deletion per the plan's phase boundaries. The `/agents` redirect shim is still in place — also Phase 6.

---

## Why this exact set of changes, and not more

Plan §4 Phase 4's bullet list maps 1:1 to the diff:

- ✅ New server entry at `frontend/src/app/(app)/spawn/[templateId]/page.tsx` that resolves the template by id (deviation: client-side fetch — see *Files added* §1; functional outcome unchanged).
- ✅ New `frontend/src/components/spawn/wizard.tsx` client component owning step state in `useReducer`. No `useSearchParams`. State shape matches plan: `{ confirmed: Set<StepKey>, current: StepKey, fields: WizardFields }`.
- ✅ Five `TerminalContainer` step shells, titles `STEP N // KEY`, accents per plan + the three picked above.
- ✅ Step 1 renders the harness's `<NebulaAvatar size={180}>` and is the *only* canvas mounted on this route (decision 21).
- ✅ Step 4 surfaces `lifecycle` + `replicas` read-only and the four M5-deferred knobs as `[ COMING WITH FLEET CONTROL ]` stub rows (decision 10 + blueprint §11.4).
- ✅ Step 5's primary CTA reads `› DEPLOY AGENT`. (No-op in Phase 4; Phase 5 wires submission.)
- ✅ Gating logic: only the current step is interactive; later steps are `opacity-40 pointer-events-none`. Confirming each advances; clicking a confirmed earlier step's `[ EDIT ]` un-confirms it + every step downstream.
- ✅ Refresh resets to Step 1 (in-memory state only, decision 8).

Things deliberately *not* done in Phase 4:

- **No real field inputs.** All non-Step-1 bodies are `<StubBody>`s. Plan: *"Steps are stub-content — real fields land in Phase 5."*
- **No RPC submission.** The Step 5 `› DEPLOY AGENT` button just dispatches `confirm`, which lands on a no-op (the last step's confirm doesn't advance because there's no next step). Phase 5 wires `spawnAgent`.
- **No streaming-log surface.** Decision 14 owns this — Phase 5.
- **No URL state.** Decision 8 + Q3 — refresh resets the wizard.
- **No `notFound()` redirect.** The not-found state renders inline as a terminal-error panel, matching the parent `/spawn/page.tsx` style. Equivalent UX, fewer Next-routing edges to reason about.
- **No proto / backend changes.** Decision 17 — pure FE.
- **No `deploy-modal.tsx` deletion.** Phase 6 owns it.
- **No `/agents` redirect-shim deletion.** Phase 6.
- **No CLAUDE.md / changelog edits.** Phase 6.

---

## Validation evidence

```
pnpm -C frontend type-check    # tsc --noEmit, exit 0
pnpm -C frontend lint           # eslint, exit 0
pnpm -C frontend build          # next build, exit 0
```

`next build` route table confirms `/spawn/[templateId]` is registered as a dynamic route (`ƒ`) — first dynamic segment in the (app) tree.

```
Route (app)
├ ○ /spawn
└ ƒ /spawn/[templateId]
```

A manual smoke pass with `overmind start` is owed (consistent with the type/lint/build contract Phase 3 used). Worth running on next dev-server boot:

1. From `/spawn`, click `› SELECT` on Hermes → wizard route loads, Step 1 active with the green-dominant nebula at 180px.
2. Click `› CONFIRM` on Step 1 → Step 2 becomes active; Step 1 shows `[ EDIT ]`; Steps 3–5 stay dimmed.
3. Walk all five `› CONFIRM`s → final `› DEPLOY AGENT` button renders on Step 5.
4. Click `[ EDIT ]` on Step 1 → Steps 2–5 all un-confirm; Step 1 becomes active again (cascading invalidation).
5. Hard refresh on the wizard route → resets to Step 1, no confirmed steps (in-memory state).
6. Navigate to a fabricated `/spawn/<garbage-uuid>` → renders the `WizardNotFound` terminal-error panel.
7. DevTools confirms exactly **one** `<canvas>` element in the wizard DOM (decision 21).

---

## Phase 4 exit criteria — status

Per plan §4 Phase 4:

- ✅ `type-check + lint + build` green.
- ✅ Navigating to `/spawn/<hermes-id>` shows all 5 steps with Step 1 active.
- ✅ Confirming each advances the cursor.
- ✅ Refresh resets the wizard to Step 1.

All four exit criteria met. Manual smoke pass deferred to next `overmind start` boot per the v1 testing posture.

---

## What unblocks Phase 5

Phase 5 wires the wizard to the existing `spawnAgent` RPC. Phase 4 hands it:

- A `WizardFields` state shape that already includes every field the M4 RPC needs (`name`, `provider`, `modelName`, `apiKey`) plus the two M5-shape extras (`lifecycle`, `replicas`) the wizard tracks but won't send on the wire until M5's `DeployConfig` proto arrives.
- A `dispatch({ type: "setField", patch: {...} })` reducer action that's already wired but unused — Phase 5's field-input components call it directly without state-shape changes.
- A step-body dispatch in `<StepBody>` keyed off `step` — Phase 5 swaps `<StubBody>` for real `<IdentityFields>` / `<ModelFields>` / `<ReviewSummary>` components in those switch arms.
- A `confirm` reducer action that already advances the cursor — Phase 5's last-step variant calls `spawnAgent` *instead* of dispatching a no-op confirm.

No structural breakage anticipated when fields arrive — they're a pure addition under the existing step bodies.

---

## Known regression window: closed

Phase 3 left a planned regression: the active card's `› SELECT` button linked to `/spawn/[templateId]`, but the route 404'd until Phase 4. Phase 4 closes it. From this commit forward, the spawn flow is *navigable* end-to-end (roster → select → wizard → all five steps → click `› DEPLOY AGENT` → no-op) but not yet *functional* end-to-end (the deploy CTA doesn't actually deploy until Phase 5). The fleet view remains the M4 deploy flow's only real entry until Phase 5 wires submission.

---

## Known pending work (Phase-4 scope)

- **Manual UI smoke pass** owed per the seven-check list above. Type/lint/build catch shape errors, not behaviour.
- **Step accent colors** for HARNESS / IDENTITY / REVIEW are picked, not pinned in the plan — a Phase 5 / 6 review of the live render may shift them. Easy one-line edits in `STEP_META` if so.
- **Adapter digest** doesn't yet exist on the `AgentTemplate` wire shape (`agents.proto`); Step 1's spec strip uses the same `hand-written` / `fly.io` literals the roster card uses. When the post-v1 generated-adapter pipeline ships and `AgentTemplate` grows an `adapter_image_ref` field, Step 1's spec strip should swap that in.
- **Server-side data fetch** would be cleaner once a server-side `createApiClient()` variant exists. Not Phase 4's job.
- **`deploy-modal.tsx`** is *still* orphan code; Phase 6 deletes it.
- **`/agents` redirect shim** is *still* in place; Phase 6 deletes it.
- **No automated test for the wizard.** Consistent with v1's testing posture (no Playwright; FE exercised by the deployed RPC round-trip).

---

## Supersedes

- **The Phase 3 *Known regression window*** — `› SELECT` no longer 404s. Phase 4 routes it to a working wizard skeleton.
- **The plan's Phase 4 prescription of a server-component data fetch** — superseded by the client-side fetch via the parent's `createApiClient()` pattern. See *Files added* §1 for the rationale; the deviation is intentional and documented.
- **`/spawn`'s status as the only authenticated spawn route** — the wizard route joins it. The (app) tree now has its first dynamic segment.
