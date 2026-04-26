# M5 Fleet Control — Phase 7 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 7.
**Date:** 2026-04-26.
**Scope:** FE-only. The fleet page gains four new columns (Region / Size /
Replicas / Storage) plus a `Deployment` per-row action that opens a slide-over
inspector. The inspector reads the live `DeployConfig`, lets the operator
edit it via the shared `<DeploymentConfigForm>` (Phase 6), previews the
result with `UpdateAgentDeployConfig{dry_run=true}`, and applies it on
confirm. Region-change previews surface a destructive-confirmation modal
with explicit checkbox per resolved Q14. The shared `<PlacementBanner>` is
lifted out of the wizard so two callers (Phase 6 wizard Review + future
Phase-7 inspector preview) consume the same affordance — though Phase 7's
preview pane uses the `UpdateResult` directly, not a separate placement
check, so the banner's actual second caller waits for Phase 8 (bulk preview).

Zero backend, proto, schema, env, or dependency change. Phase 5's BE wire
surface (`UpdateAgentDeployConfig`, `StartAgentInstance`, `Resize*`) is the
integration target.

---

## What shipped

Two new files, four updated files, ~620 net new LOC.

### New files

- **`frontend/src/components/fleet/placement-banner.tsx`** (~60 LOC) —
  shared `<PlacementBanner>` lifted from `wizard.tsx` per the Phase 6
  completion notes' "Phase 7 entry checkpoint" note. Same five-state
  discriminated union (`idle | checking | ok | blocked | error`), same
  visual treatment. Wizard's import switches over; the inline copy in
  `wizard.tsx` is deleted. Lift comes one phase early (vs the
  rule-of-three threshold) because the file already had two consumers
  in flight: the wizard, and the Phase-7 inspector — extracting now
  avoided a copy-paste.

- **`frontend/src/components/fleet/deployment-inspector.tsx`** (~430 LOC) —
  the slide-over panel. Composed as `<DeploymentInspector>` (Sheet
  wrapper) + `<InspectorBody>` (re-keyed on `${open}-${instance.id}`
  so each open starts in the view pane — React-idiomatic state reset
  via `key` prop, no effect needed; same pattern the codebase uses
  for stale-state resets elsewhere). Six-state `Mode` discriminated
  union drives the panel content:
  - **`view`** — read-only spec sheet of the live nine fields (region /
    size / volume / replicas / restart / lifecycle), plus a
    `PER-REPLICA VOLUMES` block driven by `instance.volumes` (renders
    `volume_id · region · size · machine` for each `VolumeRef`; only
    appears when `instance.volumes.length > 0`, so M4-era agents
    without backfilled volumes see no empty block).
  - **`edit`** — mounts `<DeploymentConfigForm>` seeded from the
    current values via `deploymentValuesFromInstance`. Submit goes to
    `runPreview` (not the apply path).
  - **`previewing`** — synchronous loading line during the dry-run
    round-trip.
  - **`preview`** — renders the `UpdateResult` with the right
    confirmation copy:
    - `LIVE_APPLIED` → green "✓ change applies live · no restart"
      banner + `› APPLY` button.
    - `LIVE_APPLIED_WITH_RESTART` → amber "⟳ machine will restart
      briefly (~Ns downtime)" banner + `› APPLY` button.
    - `REQUIRES_RESPAWN` → red "⚠ destructive update" banner with the
      region-change-specific copy ("region change … will destroy and
      recreate the agent, wiping its persistent state … new agent
      starts with an empty $HERMES_HOME"), an explicit checkbox
      ("I understand this destroys the agent's memory and skills") that
      gates the `› DESTROY + RESPAWN` button, plus a confirmation
      `<AlertDialog>` on click — two-step gate per resolved Q14
      ("dismissed too easily" risk row 14).
  - **`applying`** — synchronous loading line during the
    `dry_run=false` apply.
  - **`error`** — failure surface with a `‹ back` button returning to
    the view pane (preserves the Sheet open so the operator can retry
    without reopening from the row).

  Volume-shrink rejection is enforced at the `runPreview` boundary —
  not in the form schema — because the form has no current-size
  knowledge until a caller passes it in. Tested logic:
  `if (values.volumeSizeGb < instance.volumeSizeGb) toast.error(...)`,
  per the plan's literal client-side-tooltip ask.

  Drift surfaces via `instance.driftSummary?.entries` if the BE has
  populated the field; per the Phase-5 entry-point decision, drift is
  loaded on-demand and the list query doesn't widen `drift_summary`
  yet — the inspector renders the `<DriftBanner>` conditionally, so
  when BE catches up the banner activates without an FE change. Five
  drift categories map to human-readable labels via
  `driftCategoryLabel(c)`.

### Updated files

- **`frontend/src/components/spawn/wizard.tsx`** — three deletions
  + two import edits:
  - Drops the inline `PlacementBanner` function (~40 LOC).
  - Drops the inline `PlacementState` type alias.
  - Drops the now-unused `PlacementResult` type import.
  - Adds the named import from `@/components/fleet/placement-banner`.
  Net: −44 LOC. Wizard behaviour identical.

- **`frontend/src/components/fleet/agent-row-actions.tsx`** — three
  additions:
  1. `Deployment` button (always visible when not destroyed) opens the
     inspector. Mounted as a sibling of the existing AlertDialog, so
     the destroy-confirm flow stays untouched.
  2. `Start` button (visible when `lifecycle_mode=manual && status=stopped`)
     calls `api.agents.startAgentInstance({instanceId})`. Toast on
     success, toast.error on failure. Same shape as the existing Stop
     button, no confirmation prompt — Start is non-destructive.
  3. The existing Stop confirmation copy is updated: pre-Phase-7 it
     read *"…cannot be started again in v1"*. Now reads
     *"Manual-lifecycle agents can be started again from the fleet
     row; always-on agents are managed by Fly's auto-start."* Reflects
     the new capability (no Q-resolution required — copy was already
     stale relative to Phase 5's BE Start RPC; Phase 7 is when the FE
     surface catches up).

- **`frontend/src/app/(app)/fleet/page.tsx`** — list view widened with
  four new columns: `Region`, `Size`, `Replicas`, `Storage`. Three
  small projection helpers below the table:
  - `sizeLabel(i)` — `describeSize` from the shared presets file
    (handles exact-preset vs `Custom · 2x · 1.5GB` shape).
  - `storageLabel(i)` — replica-aware: 1 replica → `"5GB"`; >1 →
    `"10GB · 2×5GB"` so the headline figure is the fleet-wide total
    while the per-replica breakdown stays visible.
  - `<ReplicasCell>` — renders `desired/desired` plus a yellow drift
    pip when `driftSummary.entries` includes a `COUNT_MISMATCH`
    category. The `desired/actual` form (e.g. `"1/2"` when
    under-provisioned) is owed when BE's drift surfaces actual machine
    count via the list path — Phase-5 entry-point decision — recorded
    inline so the activation is a no-op when BE catches up.

- **`frontend/src/components/fleet/agent-card.tsx`** — gallery card
  gains the same Region / Size + Replicas / Storage info as compact
  text rows under the existing model row. Same `describeSize` helper;
  rows render conditionally so M4-era cards with zero values don't
  print empty `—` lines.

### Compile-time interface conformance

The inspector's `Mode` discriminated union narrows correctly across
all six branches (verified by `tsc --noEmit` clean). The
`AgentInstance` projection helpers (`deploymentValuesFromInstance`,
`deployConfigFromValues`) round-trip through the form's
`DeploymentFormValues` shape — proto-side widening to include the new
fields (Phase 1 + 5) feeds the projection helpers without further
hand-editing.

---

## Plan deviations

Three deviations, all flagged at the moment they were chosen:

### 1. Inspector resets mode via `key` prop, not via a reset effect

Plan §4 Phase 7 doesn't prescribe how the panel resets. The textbook
React shape is `useEffect(() => { if (open) setMode(...) }, [open])`,
which the codebase's lint rule (`react-hooks/set-state-in-effect`)
blocks — same lint hit Phase 6 took. Resolved by splitting the
inspector into outer `<DeploymentInspector>` (Sheet wrapper, holds
no state) + inner `<InspectorBody>` (state + UI), keyed on
`open ? "open-${instance.id}" : "closed"`. Each open mounts a fresh
body; the React `key` prop is the idiomatic reset signal here. No
behaviour change vs what the effect would have done.

### 2. `<PlacementBanner>` lifted in Phase 7, but Phase 7 doesn't actually re-use it yet

Phase 6 completion notes promised the lift "when two callers cross the
rule-of-three threshold cleanly." The lift shipped because the file
already existed in flight and re-importing was zero cost — but the
inspector's preview pane reads the `UpdateResult` directly (because
the dry-run is the placement check; calling `CheckDeploymentPlacement`
separately would be a redundant round-trip). The banner's actual
second caller arrives in Phase 8 (bulk preview), where each
candidate's pre-apply check needs the same red/green render. Lift now,
caller later — the alternative was deleting the wizard's import,
re-adding the inline component, and re-extracting in Phase 8. Three
copies and two extractions for one component is worse than a one-phase
gap between extract and second use.

### 3. Volume-shrink check lives in `runPreview`, not in the form's zod schema

Plan §4 Phase 7: *"Volume size field's 'decrease' attempt is rejected
client-side with a tooltip."* The shared `<DeploymentConfigForm>` is
schema-driven via `deploymentConfigSchema`, but the schema has no way
to know the *current* volume size — that's instance-specific, and
threading it into the form would mean either (a) plumbing
`currentVolumeSizeGb` through the form props, then a
`refine`-with-context, or (b) catching it at the parent's submit
handler. Chose (b): the inspector's `runPreview` checks
`values.volumeSizeGb < instance.volumeSizeGb` and toasts an error
without firing the dry-run. The submit-time toast is functionally
equivalent to the field-level tooltip per the plan's "rejected
client-side" intent; the in-input live tooltip is a nice-to-have that
costs more than the gain.

---

## What I deliberately did NOT do

- **Did not add a `DetectDrift` RPC.** Phase-5 entry-point decision
  carved this as a Phase-7 follow-up that could either add a dedicated
  RPC or wire drift through `GetAgentInstance` projection. Chose
  neither today: the inspector reads `instance.driftSummary` from the
  existing `AgentInstance` shape, which today comes back empty (the
  list query doesn't project drift; nor does GET as of Phase 5). The
  banner + replica-cell drift pip wire correctly when BE catches up;
  no FE change is required when that happens. Tracked as a v1.5
  follow-up: when drift becomes load-bearing, add the projection in
  `agents/service.go::toProtoInstanceGetRow`.
- **Did not re-fetch `getAgentInstance` on inspector open.** The
  inspector reads the same `AgentInstance` object the fleet list
  fetched. After a successful apply it calls `onChanged()` which
  refetches the whole list — same pattern Stop / Destroy use today.
  A per-instance refetch would be the right shape if the volume
  inspector grows interactive ("rescue volume" / "reattach machine"
  per resolved Q10's M5-scope obligations), tracked separately.
- **Did not implement the unattached-volume rescue actions.** Plan
  resolved Q10: *"the per-agent inspector must surface unattached
  volumes and offer two actions — (a) attach a fresh machine to the
  existing volume (rescue), (b) delete the unattached volume +
  respawn the agent (clean restart). These two actions are M5-scope;
  Phase 7's inspector design must include them."* Phase 7 surfaces
  unattached volumes (the `PER-REPLICA VOLUMES` block renders
  `unattached` when `machine_id === ""`) but doesn't ship the two
  actions. Reason: both require new RPCs (`AttachVolumeToMachine`,
  `DeleteVolume`) that Phase 5 didn't ship. Logged as a Phase 8
  carry-over or a Phase 10 cleanup item — defer the BE work, don't
  fake a button per blueprint §11.4.
- **Did not gate the inspector on the user's permission scope.**
  v1 has no IAM (blueprint §13). When permissions land, the inspector
  needs an org-level check before exposing apply / start.
- **Did not run a live-Fly smoke against `overmind start`.** Plan
  §4 Phase 7 exit criterion mentions the live runtime gates (size
  edit, volume extend, region change). Verified at the type-check +
  lint + build boundary; the operator runtime smoke is owed per the
  v1 manual-smoke posture.
- **Did not extract a generic `<RowAction>` component.** The row
  now has up to five buttons (Logs / Deployment / Start / Stop /
  Destroy) and the file is starting to feel busy, but every button
  has different visibility logic and different confirmation shape —
  abstracting them now would be a one-off-fits-all that obscures
  more than it shares.

---

## Validation gates met

- `pnpm -C frontend type-check` clean.
- `pnpm -C frontend lint` clean (after the `set-state-in-effect`
  pattern fix noted in Plan deviations §1).
- `pnpm -C frontend build` clean. `next build` route table unchanged
  (same shape as Phase 6).
- All Phase-1–6 gates still green; no BE files touched.

---

## Validation gates owed (operator)

- **Live edit smoke against `overmind start`.** Plan exit criteria:
  - Size `shared-cpu-1x → shared-cpu-2x`: brief restart, fleet row
    reflects the new size on the next poll.
  - Volume `1GB → 5GB`: `flaps.ExtendVolume`, observable via
    `fly volumes list -a <app>`.
  - Volume shrink attempt: blocked by the toast (`runPreview` gate)
    without an RPC firing.
  - Region change: destructive modal opens; on confirm the
    `agent_instances.id` is preserved, `deploy_external_ref` rolls
    over, `$HERMES_HOME` is empty on the new app.
- **Manual `Start` smoke.** Spawn an agent with `lifecycle_mode=manual`,
  Stop it, confirm the Start button appears, click it, confirm the
  status returns to `running`.
- **Drift detection round-trip.** Today the inspector's drift banner
  renders only when BE populates `driftSummary` — neither the list
  nor the GET path projects it as of Phase 5. Once a future change
  wires the projection, sanity-check the banner activates without an
  FE edit (e.g. by manually destroying a Fly machine to trigger
  `count_mismatch`).

---

## Files touched

| File | Lines | Status |
|---|---|---|
| `frontend/src/components/fleet/placement-banner.tsx` | +60 | new |
| `frontend/src/components/fleet/deployment-inspector.tsx` | +430 | new |
| `frontend/src/components/spawn/wizard.tsx` | net −44 | refactored (banner extraction) |
| `frontend/src/components/fleet/agent-row-actions.tsx` | net +75 | Deployment + Start buttons |
| `frontend/src/app/(app)/fleet/page.tsx` | net +75 | four new columns + projection helpers |
| `frontend/src/components/fleet/agent-card.tsx` | net +30 | Region / Size / Replicas / Storage rows |

---

## Next phase entry checkpoint

Phase 8 is the bulk-fleet-ops phase: header checkbox + per-row checkbox,
selection toolbar, "edit selected" surface that mounts a stripped-down
`<DeploymentConfigForm>` (no `volume_size_gb` per decision 8.4 — the
proto's `BulkConfigDelta` enforces this on the wire), fan-out via
`BulkUpdateAgentDeployConfig`, partial-failure result table.

The shared affordances Phase 7 puts in place that Phase 8 will reach for:
- `<PlacementBanner>` for the per-candidate check in the bulk preview
  surface.
- `<DeploymentConfigForm>` — the bulk variant needs a `disabledFields`
  prop (Phase 8 will add it) to grey out `volume_size_gb`.
- The inspector's preview-pane render of `UpdateResult` is the per-row
  shape `BulkResult` will match — the Phase 8 result table can lift the
  `LIVE_APPLIED / WITH_RESTART / REQUIRES_RESPAWN` rendering verbatim.

The drift carry-over from Phase 7 (BE-side projection of `driftSummary`
into the list / GET paths) is a Phase 10 cleanup item, not a Phase 8
blocker.
