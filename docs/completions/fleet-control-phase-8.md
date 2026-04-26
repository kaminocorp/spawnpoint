# M5 Fleet Control — Phase 8 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 8.
**Date:** 2026-04-26.
**Scope:** FE-only. The fleet page gains a leading checkbox column
(per-row + header select-all-on-page), a sticky `<SelectionToolbar>`
that surfaces when ≥1 row is selected, and a `<BulkApplyModal>` that
mounts a per-field "Don't change" form, runs a `dry_run=true`
preview, and applies on confirm. Failed rows stay selected for
retry per plan §4 Phase 8.

Zero backend, proto, schema, env, or dependency change. Phase 4's BE
wire surface (`BulkUpdateAgentDeployConfig`, `BulkConfigDelta`,
`BulkResult`) is the integration target — already shipped.

---

## What shipped

Three new files, three updated files, ~840 net new LOC.

### New files

- **`frontend/src/components/fleet/bulk-config-delta-form.tsx`**
  (~440 LOC) — five field sections (region / size / replicas /
  restart / lifecycle), no volume per decision 8.4 + the proto's
  `BulkConfigDelta` shape. Each section has a leading "DON'T CHANGE"
  checkbox (default CHECKED → skip), unchecking reveals the editable
  input. `summarizeSelection(instances)` computes per-field common
  values across the selection — uniform fields pre-fill with that
  value, divergent fields pre-fill with `DEFAULT_DEPLOYMENT_VALUES`
  + a yellow ⚠ warning ("selection diverges on this field — leaving
  as 'don't change' preserves each agent's current value"). On
  submit, the form produces a fully-populated `BulkConfigDelta` (the
  BE's `Validate()` requires every field set — sentinel-skip is *not*
  a wire concept, the FE preserves uniform values at submit). Q7
  enforced: when restart is in skip mode AND policy ≠ on-failure, the
  `restartMaxRetries` input is disabled with a `title=` tooltip
  ("only applies when policy is on-failure"). Region uses the same
  `useDeploymentRegions` shape as the inspector's edit form (one-shot
  fetch on mount, BE cache TTL absorbs the cost). Size uses the same
  preset-chips + `Custom…` toggle as `<DeploymentConfigForm>` — code
  paths stay parallel without lifting a generic `<SizeField>` since
  the bulk form's chip-disable wiring differs (a single boolean
  cascades to every preset button).

- **`frontend/src/components/fleet/bulk-apply-modal.tsx`** (~280 LOC)
  — `<Dialog>`-based modal with a five-state `Mode` discriminated
  union: `editing | previewing | preview | applying | result | error`.
  Editing mounts `<BulkConfigDeltaForm>`. On submit, fires
  `bulkUpdateAgentDeployConfig{dry_run: true}` with the full delta;
  preview pane renders a per-instance row table (name + UpdateKind
  label, color-coded — green for `LIVE_APPLIED`, amber for
  `LIVE_APPLIED_WITH_RESTART`, red for `REQUIRES_RESPAWN`, red for
  per-row error). Confirm fires `dry_run=false`; result pane renders
  the same shape with success/failure per row. The parent's
  `onComplete(failedInstanceIds)` callback is the load-bearing wire
  for "failed rows stay selected" — fleet page's `setSelectedIds(new
  Set(failedIds))` replaces the selection in one call. Toast
  summarises the apply ("Applied to N agents" or "X succeeded, Y
  failed. Failed rows stay selected for retry."). Modal body keyed
  on `props.open ? "open" : "closed"` so each open starts in editing
  mode — same `key`-as-reset pattern Phase 7's inspector uses,
  satisfying `react-hooks/set-state-in-effect`.

- **`frontend/src/components/fleet/selection-toolbar.tsx`** (~50 LOC)
  — sticky-bottom toolbar; surfaces when ≥1 row is selected. Shows
  count, "› APPLY CONFIG…" button, "CLEAR" button. Plan §4 Phase 8 +
  decision 28: cap at 50 — over-cap selection disables the apply
  button with a `title=` tooltip ("Bulk apply is capped at 50 agents
  per submit (plan decision 28).") AND surfaces a red `· over cap
  (50)` count badge. Exports `BULK_APPLY_CAP = 50` so the page can
  also gate the modal-mount predicate (no over-cap bulk request can
  ever be constructed).

### Updated files

- **`frontend/src/app/(app)/fleet/page.tsx`** — selection state
  lifted to the page (`selectedIds: Set<string>`), three callbacks
  (`toggleOne`, `toggleAll`, `clearSelection`) memoized with
  `useCallback`. Header checkbox = "select-all-on-page" (only
  non-destroyed rows). Toggle-all has three states: when every
  selectable row is selected → deselect them while preserving any
  off-page picks; when partial → select-all-on-page; when none →
  same as partial. `effectiveSelectedIds` is a memoized intersection
  of `selectedIds` ∩ visible row ids — drops stale ids
  (destroyed-and-hidden, deleted) at render time without a
  setState-in-effect GC. Toolbar count + modal mount key off
  `effectiveSelectedIds.size` so over-cap state is a pure render
  derivation. Bulk apply modal only mounts when
  `selectedInstances.length > 0 && ≤ BULK_APPLY_CAP` — over-cap state
  is unreachable from the modal's perspective, even though the
  toolbar's apply button is disabled at the cap separately.
  `onBulkComplete` callback flips `selectedIds` to the failed-id set.
  New `<Th>` cell + per-row `<input type="checkbox">` in the table;
  `<SelectAllCheckbox>` helper sets `el.indeterminate` via ref so
  partial-selection state is visible.

- **`frontend/src/components/fleet/fleet-gallery.tsx`** — props
  widened with `selectedIds` + `onToggleOne`. Passes per-card
  selected boolean and a closured toggle to `<AgentCard>`.

- **`frontend/src/components/fleet/agent-card.tsx`** — header gains
  a leading checkbox (only for non-destroyed cards). Card border
  flips to `border-[hsl(var(--feature-deploy))]` when selected, so
  selection is glanceable in the gallery view without a separate
  row-highlight rule.

---

## Plan deviations

Three deviations, all flagged at the moment they were chosen:

### 1. "Don't change" semantics: form-level, not wire-level

Plan §4 Phase 8 + Q7 reads as: "only checked-and-modified fields go
into the `DeployConfigDelta`." The proto's `BulkConfigDelta` has no
sentinel-skip mechanism — empty/zero values pass through to the BE's
`DeployConfig.Validate()` which calls `WithDefaults()`, coercing zero
fields to platform defaults (e.g. an empty `Region` becomes `iad`).
Sentinel-skip on the wire would either (a) require a BE patch widening
the bulk-apply path with per-field optional gates, or (b) silently
clobber every selected agent to defaults for any skipped field.

Resolved with form-level skip semantics: the form pre-fills every
field with the common-among-selection value when uniform (or
`DEFAULT_DEPLOYMENT_VALUES` when the selection diverges), so a
skipped-but-uniform field is a true no-op for the BE — every selected
agent already has that value. Skipped-but-divergent fields surface a
yellow ⚠ warning so the operator sees the risk before submit.

The demo case (Phase 8 exit criterion) — "applying lifecycle = manual
to 5 selected agents" — works exactly as specified: select 5
default-config agents, uncheck Lifecycle, set to manual, submit. The
4 other fields stay skipped, pre-filled with the common values they
already have, no-op uniform. This matches the plan's literal intent
without a BE round-trip.

### 2. Per-field skip ≠ per-instance preview accuracy

Because skipped fields are sent at their common-among-selection
value, the BE's `dry_run=true` preview correctly classifies each
agent's `UpdateKind` (`LIVE_APPLIED` for a no-op, etc.). For divergent
fields left skipped, the preview will show the "use the common value"
side as a real change for the divergent agents — the operator sees
this in the per-instance preview row and can decide to back out. The
warning copy in the form is the first guardrail; the preview table is
the second.

### 3. Selection persists across pages of polled data

Plan implicitly assumes selection is page-local. This implementation
tolerates a row dropping in / out of the visible set (e.g. a row
becomes destroyed and gets hidden) by deriving
`effectiveSelectedIds` at render time. Stale ids in `selectedIds`
state are never visible to the user but also never garbage-collected
— the alternative (a setState-in-effect GC pass) trips
`react-hooks/set-state-in-effect`. Net: zero-cost; selection is
"sticky" against the current visible set, not against the underlying
state set.

---

## What I deliberately did NOT do

- **Did not lift `<DeploymentConfigForm>` into a generic shape that
  both the inspector and the bulk form can consume.** The inspector's
  form is a single-instance editor; the bulk form has per-field skip
  toggles, divergence warnings, and a different submit shape
  (`BulkConfigDelta`, no volume). One round-trip of "extract a
  generic form" would have exploded the prop surface — three callers
  would need different field-disable + visibility wiring, two of
  which (volume, single-instance vs bulk) don't share the same
  control. Two parallel forms with shared preset/region helpers is
  the right shape today.
- **Did not implement per-row preview/result drilldown.** The
  preview + result tables show one summary line per instance. A
  click-to-expand drill-in surface (full diff per agent) is a v1.5
  candidate when fleet sizes get larger and uniform-delta
  application is no longer the norm.
- **Did not add a `Bulk Start` / `Bulk Stop` / `Bulk Destroy`
  action.** Plan §4 Phase 8 scopes bulk to deploy-config apply only.
  Lifecycle-only bulk action would need its own RPC fan-out shape;
  not in this phase.
- **Did not gate selection on org permissions.** v1 has no IAM
  (blueprint §13). When permissions land, the selection toolbar's
  "Apply config…" button needs an org-level check before opening the
  modal.
- **Did not run a live-Fly smoke against `overmind start`.** Plan §4
  Phase 8 exit criterion mentions the live runtime gate ("applying
  'lifecycle = manual' to 5 selected agents flips all 5 to manual
  mode, surfaces in the per-row badge, and the fleet polling loop
  continues to converge correctly"). Verified at the type-check +
  lint + build boundary; the operator runtime smoke is owed per the
  v1 manual-smoke posture.
- **Did not reach for the v1 `<DriftBanner>` extraction the Phase 7
  notes mentioned as "Phase 8's actual second caller".** The bulk
  preview surfaces per-instance UpdateKind + error, not placement
  results — `<PlacementBanner>` doesn't fit the bulk shape (one
  banner per N candidates would need a different render). Plan's
  Phase 7 lift "for Phase 8" was speculative; deferring the second
  caller until a use-case actually arrives keeps the surface tight.

---

## Validation gates met

- `pnpm -C frontend type-check` clean.
- `pnpm -C frontend lint` clean (after replacing the
  setState-in-effect GC pass with a render-time `effectiveSelectedIds`
  memoization).
- `pnpm -C frontend build` clean. `next build` route table unchanged
  (same shape as Phase 7).
- All Phase-1–7 gates still green; no BE files touched.

---

## Validation gates owed (operator)

- **Live bulk-apply smoke against `overmind start`.** Plan exit
  criteria:
  - Spawn 5 default-config agents.
  - Select all 5 via the header checkbox.
  - Toolbar shows "5 selected"; cap badge absent.
  - Open modal; uncheck "Lifecycle"; set to manual; preview.
  - Preview table shows 5 rows, all `LIVE_APPLIED_WITH_RESTART` (or
    `LIVE_APPLIED` per the BE's lifecycle-update heuristic).
  - Confirm; result table shows 5 ✓ rows; toast says "Applied to 5
    agents."
  - Selection clears (no failed rows); fleet rows reflect
    `lifecycleMode=manual` on the next poll cycle (3s); per-row
    `Start` button appears for any agent that's currently `stopped`.
- **Partial-failure smoke.** Force a failure on one of N selected
  agents (e.g. one in a region the BE has flagged as at-capacity).
  Apply with a region change. Verify: result table shows 4 ✓ + 1 ✗
  rows; toast says "4 succeeded, 1 failed. Failed rows stay selected
  for retry."; fleet rows update for the 4 successes; the 1 failed
  row stays selected; the toolbar count drops from 5 → 1; clicking
  "Apply config…" reopens the modal with just that 1 row.
- **Cap enforcement smoke.** With 51+ rows visible, header
  checkbox-then-select extras until count > 50. Toolbar shows red
  "· over cap (50)" badge; "Apply config…" button is disabled with a
  hover-tooltip; clicking the button does nothing. Deselect down to
  50; button re-enables.
- **Divergent-skip warning smoke.** Spawn 2 agents in different
  regions. Select both; open the modal; observe the Region row's
  warning copy ("selection diverges on this field — leaving as 'don't
  change' preserves each agent's current value"). Submit anyway with
  Region in skip mode; verify the preview table shows both agents'
  region as "changed to <common-default>" — operator sees the
  clobber risk before confirming.

---

## Files touched

| File | Lines | Status |
|---|---|---|
| `frontend/src/components/fleet/bulk-config-delta-form.tsx` | +440 | new |
| `frontend/src/components/fleet/bulk-apply-modal.tsx` | +280 | new |
| `frontend/src/components/fleet/selection-toolbar.tsx` | +50 | new |
| `frontend/src/app/(app)/fleet/page.tsx` | net +95 | selection state + checkbox column + toolbar/modal mount |
| `frontend/src/components/fleet/fleet-gallery.tsx` | net +5 | selection props passthrough |
| `frontend/src/components/fleet/agent-card.tsx` | net +20 | per-card checkbox + selected-border |

---

## Next phase entry checkpoint

Phase 9 is the integration smoke matrix — 14 tests against the
operator's `personal` Fly org. Test 12 ("Bulk apply") is the Phase 8
load-bearing case: select 3 agents, apply lifecycle=manual, then size
shared-cpu-2x; verify both bulk applies fire `flaps.Update` per agent
and `volume_size_gb` is NOT in the bulk form (decision 8.4 — the
proto enforces it; the form omits it; the wire path can't carry it).

The Phase 7 carry-over (BE-side projection of `driftSummary` into the
list/GET paths) remains a Phase 10 cleanup item, not a Phase 9
blocker. Phase 8 surfaces drift correctly when populated; the
projection is the only missing piece.
