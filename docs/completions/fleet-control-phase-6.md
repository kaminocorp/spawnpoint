# M5 Fleet Control — Phase 6 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 6.
**Date:** 2026-04-26.
**Scope:** FE-only. The spawn wizard's Step 4 (`[ COMING WITH FLEET CONTROL ]`
stub rows from 0.9.1) becomes a live `<DeploymentConfigForm>`. The widened
`SpawnAgent` request from Phase 5 starts carrying real `deploy_config` payloads
on the wire. Step 5 (Review) gains a `CheckDeploymentPlacement` red/green
affordance that gates the Deploy button. Zero backend, proto, schema, env, or
dependency change — Phase 5's BE wire surface is the integration target;
Phase 6 just consumes it.

---

## What shipped

Two new files, one rewritten file, ~520 net new LOC. Lifts the duplicated
`deploymentSchema` out of `wizard.tsx` into a shared form so Phase 7's
fleet-inspector edit surface (plan §4 Phase 7: *"Edit button toggles to the
same form from Phase 6 (extracted as `<DeploymentConfigForm>`)"*) consumes
the same component without re-typing.

### New files

- **`frontend/src/lib/spawn/deployment-presets.ts`** (~115 LOC) — single
  source of truth for the eight preset chips
  (`shared-cpu-1x` → `performance-8x`, GPU presets hidden per Q3 / decision 3),
  the `DEFAULT_DEPLOYMENT_VALUES` baseline, and the `describeSize` helper that
  turns a `(cpuKind, cpus, memoryMb)` tuple into either an exact preset id
  (`shared-cpu-2x`) or an off-preset `Custom · 2x · 1.5GB` label per resolved
  Q3. Bounds (`REPLICA_BOUNDS`, `VOLUME_BOUNDS_GB`) duplicate the Go-side
  constants in `internal/deploy/types.go`; the migration's CHECK constraints
  are the safety net per the doc-comment.

  - **`DEFAULT_REGION = "sin"`** per resolved Q1 — matches the control
    plane's primary region in `backend/fly.toml`. Plan body still reads
    `iad` (it predates the Q resolution); the code follows the resolved
    value. See "Plan deviations" §1 below.

- **`frontend/src/components/fleet/deployment-config-form.tsx`** (~395 LOC) —
  the shared form. Six field surfaces:
  - **`<RegionField>`** — Select fed by an in-component `useDeploymentRegions`
    hook that calls `ListDeploymentRegions` once on mount and caches the
    result for the form's lifetime. Filters out `deprecated` regions.
    Operator-set values not present in the list (slow boot, deprecated since
    last cache refresh, mistyped) are kept selectable as `<code> (custom)`
    so the form doesn't quietly drop the value — the placement check on
    Review is the safety net.
  - **`<SizeField>`** — preset chips per Q3 / decision 3 (the eight tuples
    listed above) plus a trailing `Custom…` chip that toggles three inputs
    (CPU class Select + vCPUs number + Memory MB number with `step={256}`).
    Clicking a preset writes all three fields atomically; `findMatchingPreset`
    decides which chip renders as active. The Custom panel auto-opens when
    the current values don't match any preset (e.g. when editing in the
    inspector — Phase 7 will hit this).
  - **`<VolumeField>`** — number input 1–500 GB with the doc-prescribed
    "/opt/data, extend-only" tooltip.
  - **`<ReplicasField>`** — number input 1–10 with the "each replica gets
    its own volume — replicas don't share state" tooltip from the plan.
  - **`<RestartField>`** — radio group (`on-failure (default)` / `always` /
    `no`); the Max retries number input mounts conditionally when
    `on-failure` is selected (default 3, range `[0, 20]`).
  - **`<LifecycleField>`** — Select with `always-on` / `manual` enabled and
    `idle-on-demand` / `suspended` rendered as `disabled` items with the
    "Coming when secure agent endpoints ship" tooltip per the plan.
  Single `deploymentConfigSchema` (zod, ~50 LOC) mirrors the Go validators
  in `internal/deploy/types.go` (CPU class enum, memory step-256, replica /
  volume / restart bounds, lifecycle enum). The schema and the
  `DeploymentFormValues` type are exported for Phase 7 reuse.

### Updated files

- **`frontend/src/components/spawn/wizard.tsx`** — three discrete edits:
  1. **`WizardFields` re-shaped.** The 0.9.1 flat `lifecycle` + `replicas`
     pair is replaced by a nested `deployment: DeploymentFormValues` field
     carrying the full nine-field DeployConfig shape. `INITIAL_FIELDS` seeds
     `deployment` from `DEFAULT_DEPLOYMENT_VALUES`. The reducer's `setField`
     action is structural — partial patches still work (`patch: { deployment: v }`
     replaces the whole sub-tree) — so no reducer rewrite needed.
  2. **`DeploymentStep` rewritten.** The 0.9.1 inline form (Lifecycle Select
     + Replicas Input + four `[ COMING WITH FLEET CONTROL ]` deferred rows)
     is replaced by a single `<DeploymentConfigForm>` mount. The
     confirmed-state summary widens to six rows: `REGION`, `SIZE`,
     `VOLUME`, `REPLICAS`, `RESTART` (with `on-failure · N retries` when
     applicable), `LIFECYCLE`. New `deployConfigFromFields` helper projects
     `DeploymentFormValues` → wire `DeployConfig` (typed via the generated
     `corellia.v1.DeployConfig` shape — `$typeName` carried so connect-es
     accepts it as a typed Message rather than a bag of fields).
  3. **`ReviewStep` placement check + Deploy gate.** New `PlacementState`
     discriminated union (`idle | checking | ok | blocked | error`) drives
     a new `<PlacementBanner>` directly under the Review summary and
     disables the `› DEPLOY AGENT` button when the placement is anything
     other than `ok`. The check fires from a `useEffect` keyed on
     `JSON.stringify(cfg)` + `isCurrent`, so it re-fires on edit-and-reconfirm
     (cascading invalidation re-mounts Review with a possibly-different
     deployment config) but not on every parent re-render. The synthetic
     log surface from Phase 5 is unchanged — placement is a *pre-deploy*
     check, the log surface is the *during-deploy* affordance.
  4. **`onDeploy` widened.** `api.agents.spawnAgent({...})` now passes
     `deployConfig: deployConfigFromFields(state.fields.deployment)`
     alongside the M4 fields. The proto field is `optional`, so callers
     that omit it (e.g. the `cmd/smoke-deploy` smoke harness) still hit
     the BE's `WithDefaults()` path. The wire is byte-additive vs M4.

### Compile-time interface conformance

The placement check's `useEffect` body keeps `setPlacement({ kind: "checking" })`
inside the async IIFE rather than the synchronous effect body — same pattern
the codebase has used since 0.8.1 to satisfy `react-hooks/set-state-in-effect`
without dropping back to `useSyncExternalStore` (which doesn't fit an async
fetch). The lint rule fired on the first cut; moving the call past the
`(async () => {` boundary clears it without changing observable behaviour.

---

## Plan deviations

Three deviations, all flagged at the moment they were chosen:

### 1. `DEFAULT_REGION = "sin"`, not `iad` as the plan body literally reads

Plan §4 Phase 6 body: *"default to org's primary (TBD: today, hardcoded `iad`;
org-level default is post-M5)."* Resolved Q1 (the plan's `Resolved questions`
section, binding per its own preamble: *"the corresponding decisions in §2
supersede in case of conflict"*) reads: *"Default = `sin`; user-toggleable.
Spawn wizard Step 4's region dropdown defaults to `sin` (matches the control
plane's primary region in `backend/fly.toml`)."* Followed the resolved Q.

The plan body's `iad` reference looks like a pre-Q-resolution snapshot the
plan author didn't sweep when Q1 was answered. Logged here so Phase 10's
docs-pass can either (a) update the plan body to read `sin`, or (b) add a
`Resolved Q1` cross-reference.

### 2. Shared `<DeploymentConfigForm>` extracted now (Phase 6), not later

Plan §4 Phase 7 literal: *"Edit button toggles to the same form from Phase 6
(extracted as `<DeploymentConfigForm>`)."* Two ways to satisfy that: (a) ship
the form inline in the wizard now, extract in Phase 7; (b) extract now into
`frontend/src/components/fleet/deployment-config-form.tsx` and import it
from the wizard. Chose (b) because the inline-then-extract path is exactly
what the M4 deploy-modal vs 0.9.1 wizard duplication looked like (resolved
in 0.9.2 by deleting the modal). Extracting now costs ~30 LOC of
indirection and saves Phase 7 a re-typing pass that would otherwise risk
the same drift.

### 3. `desiredReplicas` exposed as the Step-4 input name (not `replicas` from 0.9.1)

The 0.9.1 wizard had a `replicas` field (matching the `frontend/src/components/agents/deploy-modal.tsx` shape pre-deletion). The shared form aligns to the proto field name (`desiredReplicas` ↔ `desired_replicas` proto camelCase). The form input still reads "Replicas per agent" in the label — only the internal field name changes. Trade-off: any external code referring to `state.fields.replicas` would break, but a grep confirmed only the wizard itself read the field, and the change is local.

---

## What I deliberately did NOT do

- **Did not restore `Deploy N` / multi-spawn UI.** Plan §4 Phase 6 body
  flags this as a scope decision; the Q-resolution column for Q11 (and the
  matching plan §2 decision 11) explicitly drops it from the wizard
  pending a separate "fleet bulk spawn" milestone. The `spawnNAgents`
  RPC stays on the wire — Phase 6 doesn't reach for it.
- **Did not add a per-row pricing line on Review.** Resolved Q5 / decision
  5 supersedes the Decision-15 plan-body reference: *"Pricing entirely cut
  from M5."* No `frontend/src/lib/fly-pricing.ts` shipped; the Review's
  Deployment subsection has no estimated-cost row.
- **Did not edit the fleet page or any inspector affordance.** Phase 7 is
  the fleet-page phase. The shared `<DeploymentConfigForm>` is *available*
  for Phase 7 to import; Phase 6 doesn't wire it on the fleet side.
- **Did not extract `<PlacementBanner>` or `PlacementState` into a shared
  module.** The fleet inspector's edit form (Phase 7) will need the same
  affordance. Today there's exactly one consumer; extracting now would
  mirror the same one-call-site abstraction the operator's standing
  instructions warn against. Phase 7 is the right time to lift it (two
  callers = the rule of three's threshold for shared infra) — at which
  point the lift is a ~40-LOC move with no behaviour change.
- **Did not touch `cmd/smoke-deploy/main.go`.** It still passes a
  zero-value `DeployConfig{}` (i.e. omits the field on the wire), which
  the BE's `WithDefaults()` canonicalises to the M4-equivalent shape —
  the smoke smoke-test path is unchanged.
- **Did not run a live-Fly smoke against `overmind start`.** Phase 6's
  exit criterion mentions "spawning an agent with a non-default config
  (e.g. `lhr` + `shared-cpu-2x` + 5GB volume + 2 replicas) succeeds
  against a local backend." Verified at the type-check + lint + build
  boundary; a runtime end-to-end against the operator's `personal` Fly
  org is owed on the next `overmind start` boot per the v1 manual-smoke
  posture (not a CI step).
- **Did not write a `<DeploymentConfigForm>` test file.** No unit tests
  in the FE codebase today (per stack §13: *"No end-to-end tests
  (Playwright) in v1 — Go unit tests on domain packages only."*).
  Type-check + lint + build are the FE gates, plus the operator
  manual-smoke.

---

## Validation gates met

- `pnpm -C frontend type-check` clean.
- `pnpm -C frontend lint` clean (after the `set-state-in-effect` fix
  noted above — same pattern the codebase has used since 0.8.1).
- `pnpm -C frontend build` clean. `next build` route table unchanged
  (`/spawn` static, `/spawn/[templateId]` dynamic — same shape as 0.9.x).
- All Phase-1–5 Go gates still green (no BE files touched in Phase 6;
  the Phase 5 BE handlers are the wire targets — verified by the FE
  type-check accepting the generated TS shape end-to-end).

---

## Validation gates owed (operator)

- **Live spawn against `overmind start`.** Plan exit criterion: *"spawning
  an agent with a non-default config (e.g. `lhr` + `shared-cpu-2x` + 5GB
  volume + 2 replicas) succeeds against a local backend; the resulting
  Fly app has 2 machines in `lhr`, each with a 5GB volume mounted at
  `/opt/data` (verifiable via `fly machine list -a <app>` and `fly volumes
  list -a <app>`)."* This is the load-bearing FE-side gate; today's exit
  is type-check + lint + build clean, owed runtime check is the operator's.
- **Manual placement-check exercise.** Pick a deliberately non-existent
  region (e.g. `xyz` via the `(custom)` write-through path) and confirm
  the Review banner flips red and the Deploy button disables.
- **Phase 1 migration round-trip is still hard-blocking** for any spawn
  that hits the new BE columns. Owed since Phase 1 / Phase 4.

---

## Files touched

| File | Lines | Status |
|---|---|---|
| `frontend/src/lib/spawn/deployment-presets.ts` | +115 | new |
| `frontend/src/components/fleet/deployment-config-form.tsx` | +395 | new |
| `frontend/src/components/spawn/wizard.tsx` | net ~+10 (≈+135 / −125) | rewritten Step 4 + Review |

---

## Next phase entry checkpoint

Phase 7 is FE-side: fleet page deployment inspector + per-row actions.
The shared `<DeploymentConfigForm>` is the integration target for the
inspector's Edit affordance — the form already accepts a `defaults` prop
seeded from the row's existing `DeployConfig`. Phase 7's additional
ask is the destructive-confirmation modal for region-change updates
(plan §6 risk row 14: explicit checkbox, disabled submit until checked,
copy listing what's lost). The placement-check banner will likely lift
to a shared `<PlacementBanner>` at that point — two callers crosses the
rule-of-three threshold cleanly.

The Phase-5 sentinel-mapping table is the contract surface for the
inspector's error rendering: `deploy.ErrPlacementUnavailable` →
`FailedPrecondition` → red banner with `result.alternateRegions`,
`deploy.ErrLifecycleUnsupported` → `Unimplemented` → "Coming when secure
agent endpoints ship" tooltip on the lifecycle Select (which Phase 6
already disables those options for, so the runtime hit is unreachable
from the wizard — but the inspector will need to render it for agents
spawned via API).
