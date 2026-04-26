# Completion — Spawn page redesign, Phase 6: Cleanup, docs, validation matrix

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 6
**Date:** 2026-04-26
**Scope:** FE-only deletions + doc reconciliation. No new product surface, no proto / schema / env / dependency change. Two source files removed, two doc files updated, one new completion note (this file). Closes the redirect-shim window opened in 0.9.0 (Q12: "one release only, then deleted") and the orphan-modal window opened in 0.9.1 (the deploy-modal stayed in the tree as unreferenced code through Phase 5).
**Validation:** `pnpm -C frontend type-check && lint && build` all green.

---

## What Phase 6 delivers (per plan)

> Delete `frontend/src/components/agents/deploy-modal.tsx` (replaced by the wizard route). Update CLAUDE.md frontend layout note. Update design-system.md §33.5 + §34. Add changelog entry. Full validation matrix green.

This is the cleanup phase — Phases 1–5 shipped the new spawn surface, Phase 6 takes out the old surface and reconciles the docs that diverged from implementation along the way.

---

## Files deleted (2)

### `frontend/src/components/agents/deploy-modal.tsx`

The M4 deploy-modal — the `<Dialog>`-based spawn entry that 0.7.0 introduced and 0.9.0 superseded. Untouched since 0.7.5; orphan code from 0.9.0 onwards (no caller imported it after `/agents` → `/spawn` flipped). Wire contract was preserved in the wizard verbatim (decision 5 of Phase 5: schemas lifted *verbatim* to avoid drift), so deleting the modal is a no-op for the wire path.

The empty `frontend/src/components/agents/` directory disappears with the deletion (git tracks files, not dirs; `git rm` cleans the entry).

### `frontend/src/app/(app)/agents/page.tsx`

The 5-line `redirect("/spawn")` shim from Phase 1 (0.9.0). Q12 carved one release of redirect courtesy; 0.9.0 + 0.9.1 covered that window. From 0.9.2 onward, **`/agents` 404s** rather than 308-redirecting. Acceptable because:

- The route never lived in production with users on it; the rename happened the same day the new surface shipped.
- The redirect shim's stated lifetime was "one release" per the operator's resolution.
- Internal `<Link href="/agents">` references were swept in Phase 1 (`dashboard/page.tsx` ×2, `fleet/page.tsx` ×1) and have been pointing at `/spawn` ever since.

The empty `frontend/src/app/(app)/agents/` directory disappears with the deletion.

---

## Files updated (2)

### `CLAUDE.md` — added "Frontend route map (App Router)" subsection

Six-sentence note pinned under the contract-boundary subsection. Names the two spawn routes (`/spawn` roster + `/spawn/[templateId]` wizard), notes the rename + shim removal, lists the other authenticated routes for completeness, and explicitly records that **there is no `<DeployModal>`** (the wizard is the sole spawn entry point). The note is short on purpose — CLAUDE.md is not a route catalog; this is the minimum surface that keeps a future contributor from reaching for the deleted modal.

The rest of CLAUDE.md is untouched. Per the file's own opening rule ("live code is authoritative; this file stays still") doc churn is kept tight.

### `docs/refs/design-system.md` — §33.5 + §34.1 + §34.3 + §34.4 reconciled with implementation

§33.5 was a one-liner pointing at §34. Replaced with a self-contained note covering both routes — the roster (`/spawn`) and the wizard (`/spawn/[templateId]`) — including the active/locked card distinction (one canvas page-wide), the `[ AVAILABLE HARNESSES ]` vocabulary (Q10), and the `[ LOCKED ]` non-button affordance per blueprint §11.4.

§34.1 had the original 6-step layout (`PICK HARNESS → NAME AGENT → PICK PROVIDER → PASTE API KEY → PICK MODEL → DEPLOY`). Replaced with the shipped 5-step layout (`HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`) per decision 19, with feature-color accents per decision 18 of the plan (`catalog cyan / secrets pink / adapter violet / deploy blue / running green`). Added the `ACTIVE` / `CONFIRMED` / `PENDING` text-tag note from Phase 4 — the meta-slot tag is what makes step state scannable without color, which the original §34.1 omitted.

§34.3 still described the M4 redirect target (`/agent/[id]`), which never shipped — M4 redirects to `/fleet`. Rewrote to describe the actual streaming-log surface from Phase 5: synthesized lines on a 600 ms `setInterval`, RPC fires in parallel, decorative not load-bearing, error path flips to `failed` accent + `› BACK TO REVIEW` button. The redirect target is corrected to `/fleet`.

§34.4 was the Spawn-N variant (count input on Step 6, name-prefix on Step 2). Decision 11 dropped Spawn-N from the wizard scope. Renamed the section "Spawn-N (deferred)" and rewrote it to record the deferral + the deferred-decisions framing (it returns later as a fleet-page action composing with M5's bulk-apply, not a wizard variant).

§34.2 (the `Confirm` button pattern) is unchanged — it shipped verbatim.

---

## Files added (1)

This completion note (`docs/completions/agents-ui-mods-phase-6.md`).

The plan also called for "Add changelog entry per the existing convention." That entry — `0.9.2 — Spawn Page Redesign Phase 6: Cleanup + Docs Reconciliation` — is added to `docs/changelog.md` as part of this phase.

---

## Why this exact set of changes, and not more

Plan §4 Phase 6's bullet list maps 1:1 to the diff:

- ✅ Delete `frontend/src/components/agents/deploy-modal.tsx`.
- ✅ `agent-template-card.tsx` and `frontend/src/lib/agents/coming-soon.ts` already deleted in Phase 3 (0.9.0); confirmed gone.
- ✅ Update CLAUDE.md frontend layout note (one-line → six-line addition; CLAUDE.md had no route note before this phase, so the "update" is an addition).
- ✅ Update design-system.md §33.5 + §34 to match implementation (4 subsections rewritten).
- ✅ Add changelog entry per the existing convention.
- ✅ Validation matrix: `type-check && lint && build` green; route table no longer lists `/agents`.

Things deliberately *not* done:

- **No extraction of the duplicated `PROVIDERS` array / schemas.** Phase 5's note flagged the duplication; once the modal is deleted there's only one caller (`wizard.tsx`), so the duplication evaporates without a refactor. The wizard now owns the canonical copy.
- **No edits to comments referencing the deleted files.** `roster-card.tsx`'s comment ("Replaces `agent-template-card.tsx` and `coming-soon-harness-card.tsx`") and `harnesses.ts`'s comment ("Replaces `frontend/src/lib/agents/coming-soon.ts` (deleted in this phase)") are *historical* — they record the lineage of the file. Editing them now would erase intent that's load-bearing for understanding the file's purpose. The "this phase" wording in `harnesses.ts` is dated to 0.9.0 and reads correctly as past tense to a future contributor.
- **No widening of the CLAUDE.md route map.** The spawn surface is the only one that's diverged enough from the docs to need pinning; `/dashboard`, `/fleet`, `/settings` are stable and the App Router is self-documenting via the directory tree. Adding a full per-route catalog would be doc-debt waiting to rot.
- **No design-system.md §33.2 (`/agents` Catalog) update.** That section is *historical context* about what the catalog page used to be; superseded by §33.5's roster description but not load-bearing. Deleting it would erase the intent record. Editors of the next plan that touches the spawn surface should read §33.2 + §33.5 together.
- **No proto change for `lifecycle` / `replicas`.** Reaffirmed: M5's `DeployConfig` is the right place; Phase 5 deliberately left the slot reserved.
- **No new RPCs, no schema changes, no env changes, no dep changes.** Decision 17 — pure FE.

---

## Validation evidence

```
rm -rf frontend/.next             # clear stale cache referencing deleted /agents/page.tsx
pnpm -C frontend type-check        # tsc --noEmit, exit 0
pnpm -C frontend lint              # eslint, exit 0
pnpm -C frontend build             # next build, exit 0
```

`next build` route table:

```
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
├ ○ /sign-in
├ ○ /spawn
└ ƒ /spawn/[templateId]
```

`/agents` no longer appears. `/spawn/[templateId]` is the only dynamic (`ƒ`) route in the (app) tree.

**Stale-cache gotcha (recurring pattern):** the first `type-check` after `git rm` of `agents/page.tsx` failed with `.next/types/validator.ts(42,39): error TS2307: Cannot find module '../../src/app/(app)/agents/page.js'`. Same pattern documented in 0.9.0 Phase 1 ("the first `type-check` after the `git mv` failed because `.next/types/validator.ts` still referenced `agents/layout.js` — `rm -rf .next` before re-running"). Fix is identical: `rm -rf .next` and re-run. Worth recording for the next route deletion.

---

## Manual smoke pass owed (per v1 testing posture)

The build pipeline gates shape correctness; behavior is the manual round-trip the v1 testing posture leans on (no Playwright; deployed RPC round-trip as the integration smoke test). The Phase-5 10-check list is unchanged — Phase 6 deletes orphan code, so the existing flow has identical user-visible behavior. New checks specific to Phase 6:

1. **`/agents` 404s** (was 308-redirecting in 0.9.0 / 0.9.1). DevTools network tab confirms 404, not redirect.
2. **DevTools "Open in Editor" on the wizard's deploy button** lands on `wizard.tsx`'s `onDeploy`, not `deploy-modal.tsx` (the modal file is gone).
3. **Search across `frontend/src` for `deploy-modal` / `DeployModal`** returns zero hits (other than the changelog and completion-note files, which are doc artefacts).
4. **Sidebar nav** still highlights correctly on `/spawn` and `/spawn/[templateId]`. (Unchanged behavior — gate is just regression check.)

---

## Phase 6 exit criteria — status

Per plan §4 Phase 6:

- ✅ `frontend/src/components/agents/deploy-modal.tsx` deleted.
- ✅ `frontend/src/components/agent-template-card.tsx` already deleted (Phase 3 / 0.9.0).
- ✅ `frontend/src/lib/agents/coming-soon.ts` already deleted (Phase 3 / 0.9.0).
- ✅ CLAUDE.md frontend layout note updated.
- ✅ design-system.md §33.5 + §34.1 + §34.3 + §34.4 reconciled with implementation.
- ✅ Changelog entry added per convention (`0.9.2 — Spawn Page Redesign Phase 6: Cleanup + Docs Reconciliation`).
- ✅ Full validation matrix green.
- 🔄 Manual smoke pass — owed on next `overmind start` boot per v1 testing posture.

---

## Closes

- **`/agents` redirect-shim window** opened by Q12 in 0.9.0. One-release courtesy honored across 0.9.0 + 0.9.1. Removed in 0.9.2.
- **`deploy-modal.tsx` orphan-code window** opened by Phase 5's deliberate scoping (0.9.1). Modal stayed in the tree as unreferenced code for one release; deleted in 0.9.2.
- **The eight-resolved-Q `agents-ui-mods.md` plan**. All six phases shipped: route rename + nebula avatar + roster page + wizard shell + functional fields + cleanup.

---

## Supersedes

- **Phase 1's redirect shim** (0.9.0) — `/agents` no longer redirects, it 404s. The bookmark-courtesy lifetime defined by Q12 is exhausted.
- **Phase 5's "modal stays in the tree as orphan code awaiting Phase-6 deletion" deferral** (0.9.1) — the modal is gone.
- **design-system.md §34.1's original 6-step layout** (`PICK HARNESS → NAME AGENT → PICK PROVIDER → PASTE API KEY → PICK MODEL → DEPLOY`) — replaced with the shipped 5-step layout (`HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`) per plan decision 19.
- **design-system.md §34.3's `/agent/[id]` redirect target** — corrected to `/fleet`. The agent-detail route was never built; the M4 spawn flow has always landed on the fleet view.
- **design-system.md §34.4's "Spawn-N Variant" as a wizard mode** — replaced with the deferral note per plan decision 11.
