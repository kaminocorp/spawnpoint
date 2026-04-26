# M5 Fleet Control — Phase 4 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 4.
**Date:** 2026-04-26.
**Scope:** Domain methods for the new fleet-control operations on `internal/agents.Service` — sentinel-mapped, transactionally safe, with a typed `BulkConfigDelta` (no `volume_size_gb`) and a typed `DriftReport` (5 categories). `DeployTarget` interface gains `PreviewUpdate` (the dry-run companion to `Update`). `GetAgentInstanceByID` widened to project the nine new deploy-config columns. Spawn / SpawnN now accept and persist a `DeployConfig`.

---

## What shipped

One new file, three updated files, one SQL widening + sqlc regen, ~700 net new LOC including tests.

### New files

- **`backend/internal/agents/fleet.go`** (~470 LOC) — Phase 4 fleet-control surface. Six methods + four types:
  - **Types:** `UpdateResult` (`Kind`, `EstimatedDowntime` — pricing dropped per Q5), `BulkResult` (`InstanceID`, `Kind`, `Err`), `BulkConfigDelta` (8 fields — DeployConfig minus `VolumeSizeGB` per decision 8.4), `DriftReport` + `DriftCategory` enum (5 categories: `count_mismatch` / `size_mismatch` / `volume_mismatch` / `volume_size_mismatch` / `volume_unattached`).
  - **`UpdateDeployConfig(ctx, instanceID, orgID, cfg, dryRun)`** — load + validate + `CheckPlacement` + `PreviewUpdate` → on dry-run return without mutating; on apply branch on `UpdateKind` (`RequiresRespawn` → `respawnAgent`; `LiveApplied` / `LiveAppliedWithRestart` → `deployer.Update` + `UpdateAgentDeployConfig` + `pollHealth`).
  - **`StartInstance(ctx, instanceID, orgID)`** — load, `deployer.Start`, spawn `pollHealth` goroutine, return refreshed instance.
  - **`ResizeReplicas(ctx, instanceID, orgID, desired)`** — `[1, 10]` validation + load + currentCfg.DesiredReplicas swap + `deployer.Update` + `UpdateAgentReplicas` + `pollHealth`.
  - **`ResizeVolume(ctx, instanceID, orgID, newSizeGB)`** — `[1, 500]` + shrink rejection (`ErrVolumeShrink`) + per-volume `deployer.ExtendVolume` + `WithResizeVolumeTx` (parent `volume_size_gb` write + per-row `agent_volumes.size_gb` writes in one tx) + `pollHealth` if any extension reported `needsRestart`.
  - **`BulkUpdateDeployConfig(ctx, ids, orgID, delta, dryRun)`** — `errgroup` + `semaphore.NewWeighted(3)` fan-out, capped at `maxBulkCount = 50` (decision 28), per-instance `applyBulkOne` records into `[]BulkResult` so partial failure is normal.
  - **`DetectDrift(ctx, instanceID, orgID)`** — load instance + `deployer.ListMachines` + `ListAgentVolumesByInstance`, compare aggregates, surface up to 5 typed categories. Empty-volumes case (M4-era agents) skips the volume_* categories — drift on volumes that don't exist yet is forward-compat noise.
  - **Helper:** `respawnAgent` — destroy old app + re-resolve template/adapter + Spawn fresh + rewrite `deploy_external_ref` + persist new config + `pollHealth`. The `instance.id` is preserved across the destructive update.

### Updated files

- **`backend/internal/agents/service.go`** — five additions:
  1. New `ErrBulkLimit` sentinel for the `[]ids` empty-or-over-cap boundary.
  2. `maxBulkCount = 50` + `bulkConcurrency = 3` constants.
  3. `agentQueries` interface widened with 6 new methods (`UpdateAgentDeployConfig`, `UpdateAgentReplicas`, `UpdateAgentInstanceVolumeSize`, `BulkUpdateAgentDeployConfig`, `ListAgentVolumesByInstance`, `UpdateAgentVolumeSize`).
  4. `SpawnInput` + `SpawnNInput` gain a `DeployConfig` field. `Spawn` calls `cfg.WithDefaults().Validate()` early (so failures precede DB writes), threads cfg into `deployer.Spawn`, and persists the nine columns inside the existing spawn tx via the new `UpdateAgentDeployConfig` call on `SpawnTx`.
  5. Two helpers: `deployConfigParams(id, orgID, cfg) → db.UpdateAgentDeployConfigParams` (the shared projector for every persist call) and `deployConfigFromInstance(row) → deploy.DeployConfig` (the reverse projector for delta-style flows).

- **`backend/internal/agents/transactor.go`** — three additions:
  1. `SpawnTx` interface gains `UpdateAgentDeployConfig`. `*db.Queries` already structurally satisfies it (the method exists from Phase 1's sqlc regen).
  2. New `ResizeVolumeTx` interface (`UpdateAgentInstanceVolumeSize` + `UpdateAgentVolumeSize`). Two narrow tx shapes vs one generic Querier-bound tx: self-documenting at the closure boundary, and test fakes only need the methods each surface actually calls.
  3. `Transactor` interface widened with `WithResizeVolumeTx`. `PgxTransactor` implements both via a refactored `runTx(fn func(*db.Queries) error)` private helper — the old `WithSpawnTx` now delegates to it; rollback / log shape is unchanged.

- **`backend/internal/deploy/target.go`** — `DeployTarget` interface gains `PreviewUpdate(ctx, ref, cfg) (UpdateKind, error)`. Plan §4 Phase 4 NB: the dry-run / apply split is the cleaner shape vs a `dryRun bool` flag through `Update`. Implemented on `FlyDeployTarget` as a region-delta-only check (calls `flaps.List`, returns `UpdateRequiresRespawn` if any machine's region differs, else `UpdateLiveApplied`); Phase 3.5 widens this to also surface `LiveAppliedWithRestart` for volume-extend cases. `LocalDeployTarget` / `AWSDeployTarget` stubs return `ErrNotImplemented`.

- **`backend/internal/deploy/fly.go`** — implements `PreviewUpdate` (~20 LOC body next to `Update`).

- **`backend/internal/deploy/stubs.go`** — `PreviewUpdate` stubs on Local / AWS.

- **`backend/queries/agent_instances.sql`** — `GetAgentInstanceByID` projection widened with the 9 new columns (`region`, `cpu_kind`, `cpus`, `memory_mb`, `restart_policy`, `restart_max_retries`, `lifecycle_mode`, `desired_replicas`, `volume_size_gb`). The fleet-page list query (`ListAgentInstancesByOrg`) is **NOT** widened in this phase — it stays at the M4 projection because no current FE code consumes the new columns. Phase 5/6 widens it when the row card adds size + region badges.

- **`backend/internal/db/agent_instances.sql.go`** — sqlc regen. `GetAgentInstanceByIDRow` gains 9 fields.

- **`backend/internal/agents/service_test.go`** — extensive extension:
  - `fakeQueries` gains 6 new methods + their call counters + injection points + `agentVolumes map[uuid.UUID][]db.AgentVolume`.
  - `fakeDeployTarget` gains 11 new injection knobs (`updateKind`, `previewKind`, `placement`, `machines`, etc.) + per-method call counters + `lastCfg` for cfg-thread-through assertions. The Phase 2 stub block is replaced by recording impls.
  - `fakeTransactor` gains `WithResizeVolumeTx`.
  - 19 new Phase 4 tests (3 Spawn validation, 4 UpdateDeployConfig, 2 ResizeReplicas, 3 ResizeVolume, 2 StartInstance, 2 BulkUpdateDeployConfig, 4 DetectDrift) plus a `perIDQueries` embed-and-override helper used by the bulk-partial-failure test (the single-value `fakeQueries.getInst` can't express different rows per ID in one run).

### Compile-time interface conformance

`internal/deploy/target_test.go` already had:

```go
var (
    _ DeployTarget = (*FlyDeployTarget)(nil)
    _ DeployTarget = (*LocalDeployTarget)(nil)
    _ DeployTarget = (*AWSDeployTarget)(nil)
)
```

The added `PreviewUpdate` method ripples through and the assertions still compile — confirming method-completeness on all three concrete types.

---

## Plan deviations

Three deviations, all flagged at the moment they were chosen:

### 1. `Spawn` persists deploy-config via insert-then-update inside one tx, not via a widened insert

Plan §4 Phase 4 literal: *"persist all 9 fields (incl. volume_size_gb) to the new columns. The existing transactional `WithSpawnTx` from 0.7.5 wraps the same writes; the deploy-config columns are written inside the same tx as the agent_instances insert."*

Two ways to satisfy that: (a) widen `InsertAgentInstance` to take 17 fields; (b) keep `InsertAgentInstance` at 8 fields (column DEFAULTs cover the rest) and run `UpdateAgentDeployConfig` inside the same tx. Chose (b) because the SQL-shape change is smaller — no migration-level churn, no callsite update for a pre-existing query. The two-step pattern inside one tx is equivalent to a widened insert; the closure boundary keeps both writes atomic. Trade-off: an extra DB roundtrip per Spawn (insert + update + secret-insert vs widened-insert + secret-insert). At spawn-rate scale this is invisible.

### 2. `BulkUpdateDeployConfig` uses per-instance writes, not the bulk SQL

Phase 1 added a `BulkUpdateAgentDeployConfig` sqlc query that updates N rows in one statement (`id = ANY($1)`). Phase 4 doesn't use it. Reason: each bulk-applied instance also needs its own per-instance `deployer.Update` call to Fly, and the bulk flow's bottleneck is the Fly round-trip count (3 in flight at a time per `bulkConcurrency`), not the DB-write count. Routing each instance through `applyBulkOne` keeps the per-row `UpdateResult` shape (success vs error vs which UpdateKind) honest — a single bulk SQL would lose the per-row signal that the FE needs to render partial-failure.

The bulk SQL is left in place for v1.5+ surfaces that don't touch Fly: a future "lifecycle-mode flip across N agents" without a per-instance Update call could use it as one shot. Today's caller is the per-instance fan-out; the bulk SQL is the v1.5 affordance.

### 3. `respawnAgent` does not re-supply the model API key

Plan §4 Phase 4 step 6 is silent on this. The respawn path (region change → destroy + spawn fresh) re-resolves the template + adapter via `resolveSpawnDeps` to get the image ref, but the freshly-launched Fly app has **no** `CORELLIA_MODEL_API_KEY` secret — the original key was set on the now-destroyed app and the audit `secrets` row's `storage_ref` points at the dead Fly app's secret store. Today's behavior: the respawn produces a new Fly app whose Hermes will fail on first `/chat` call ("no API key").

This is a known v1.5 gap. Two viable resolutions:
- **Option A:** the FE's region-change destructive-confirmation modal gains an "API key" input field, and the `UpdateDeployConfig` RPC payload carries it on respawn paths.
- **Option B:** v1.5 introduces a Corellia-side secret store (separate from Fly's per-app secrets) keyed by `instance.id`; the audit row's `storage_ref` becomes meaningful and respawn fetches the value directly.

Option B is the cleaner long-term shape (it's also what the v1.5 deploy-target-credentials work needs anyway), but Option A is the M5-scope answer. Until that lands, region-change respawns are a known broken path. Logged as a Phase 4 follow-up; the destructive-confirmation modal in Phase 7 should gate on either (a) "I will re-paste the API key after this completes" or (b) the API-key field being included in the payload.

---

## What I deliberately did NOT do

Per the plan's "Phase 4 = service layer; Phase 5 = wire" split:

- **Did not touch `internal/httpsrv/`.** No new RPC handlers, no proto changes. Phase 5 wires `UpdateDeployConfig` / `StartInstance` / `ResizeReplicas` / `ResizeVolume` / `BulkUpdateDeployConfig` / `DetectDrift` to Connect endpoints.
- **Did not widen `ListAgentInstancesByOrg`.** The list query stays at the M4 projection because the fleet-page list rendering doesn't yet consume the new columns. Phase 5/6 widens it when the row card adds size + region badges.
- **Did not touch the M4 sentinel mapping table in `httpsrv.agentsErrToConnect`.** The deploy-package sentinels (`ErrInvalidSize`, `ErrInvalidVolumeSize`, `ErrPlacementUnavailable`, `ErrLifecycleUnsupported`, `ErrMachineBusy`, `ErrVolumeShrink`, `ErrVolumeProvisionFailed`) and the new `ErrBulkLimit` agents sentinel need handler-layer mappings. **Phase 5 task:** add cases for these to `agentsErrToConnect` and update the mapping comment block in `errors.go`.
- **Did not implement Phase 3.5.** `EnsureVolume` / `ExtendVolume` on `FlyDeployTarget` still return `ErrNotImplemented`. The service layer's `ResizeVolume` happy-path test passes because the test fake returns `(false, nil)`; against the real Fly target, ResizeVolume on a Phase-3.5-deployed agent would hit `ErrNotImplemented` and fall through to `ErrFlyAPI`. End-to-end ResizeVolume becomes meaningful when Phase 3.5 ships.
- **Did not update `cmd/api/main.go`.** No constructor change needed — the `agentsSvc := agents.NewService(...)` call at `cmd/api/main.go:71` still compiles. The four-arg shape is unchanged; the new Phase 4 methods hang off the resulting `*Service`.

---

## Validation gates met

- `cd backend && go vet ./...` clean (full repo).
- `cd backend && go build ./...` clean.
- `cd backend && go test ./...` — full suite green: `agents`, `deploy`, `httpsrv`, `users`. The 19 new Phase 4 tests run in 0.4s.
- `cd backend && go test -run "TestSpawn_PersistsDeployConfigInTx|...|TestDetectDrift_NoDrift" -v ./internal/agents/...` — every Phase 4 test PASSes individually.
- No live-Fly tests in CI (per-package unit tests use `fakeDeployTarget`).
- Sqlc regen produced exactly the expected diff: `GetAgentInstanceByIDRow` gains 9 fields; nothing else changed.

---

## Validation gates owed (operator)

- **Operator's `goose up` round-trip on Phase 1's migration is now hard-blocking.** Pre-Phase-4 it was a soft prerequisite; from Phase 4 onward, any agent created via `Spawn` writes to the nine new columns via `UpdateAgentDeployConfig`, which fails against an unmigrated DB. The owed Phase-1 step (`goose -dir migrations postgres "$DATABASE_URL_DIRECT" up && down && up`) must run before the next deploy.
- **Smoke test of `Spawn` against the new columns:** `cmd/smoke-deploy/main.go` still passes a zero `DeployConfig{}`; verify a smoke run actually writes the default values into all 9 columns (vs leaving them at the column DEFAULTs alone). Quickest check after `goose up`: `psql … "SELECT region, cpus, memory_mb, desired_replicas, volume_size_gb FROM agent_instances ORDER BY created_at DESC LIMIT 1;"` after a smoke run.
- **Manual exercise of `UpdateDeployConfig` dry-run vs apply** against a live agent. The handler doesn't exist yet (Phase 5), so this owes either (a) a quick `go run` harness, or (b) wait for Phase 5's `curl`-able RPC.

---

## Test surface added

19 new tests in `service_test.go`, organised by method:

| Method | Test | Pin |
|---|---|---|
| `Spawn` | `TestSpawn_PersistsDeployConfigInTx` | `UpdateAgentDeployConfig` runs **inside** the spawn tx; cfg threads through to `deployer.Spawn` |
| `Spawn` | `TestSpawn_RejectsInvalidVolumeSize` | Volume size out-of-range fails before any DB write |
| `Spawn` | `TestSpawn_RejectsInvalidLifecycle` | `idle-on-demand` is rejected as `ErrLifecycleUnsupported` |
| `UpdateDeployConfig` | `TestUpdateDeployConfig_DryRunDoesNotMutate` | Dry run calls `PreviewUpdate` once; **zero** `Update` / `UpdateAgentDeployConfig` calls |
| `UpdateDeployConfig` | `TestUpdateDeployConfig_ApplyLive` | Apply path calls `Update` + `UpdateAgentDeployConfig` once each; cfg persisted |
| `UpdateDeployConfig` | `TestUpdateDeployConfig_PlacementUnavailable` | Placement gate blocks before Update — zero `Update` calls |
| `UpdateDeployConfig` | `TestUpdateDeployConfig_RequiresRespawn` | RequiresRespawn → `Destroy` + `Spawn` (×1 each); zero `Update` calls; cfg persisted |
| `ResizeReplicas` | `TestResizeReplicas_HappyPath` | DesiredReplicas threaded into deployer.Update + persisted |
| `ResizeReplicas` | `TestResizeReplicas_OutOfRange` | `[0, -1, 11, 100]` all surface `ErrInvalidSize` |
| `ResizeVolume` | `TestResizeVolume_HappyPath` | Parent volume_size_gb update ×1; per-volume size_gb update ×N |
| `ResizeVolume` | `TestResizeVolume_RejectsShrink` | newSizeGB < current → `ErrVolumeShrink` |
| `ResizeVolume` | `TestResizeVolume_OutOfRange` | `[0, -1, 501, 9999]` all surface `ErrInvalidVolumeSize` |
| `StartInstance` | `TestStartInstance_HappyPath` | `deployer.Start` called ×1 |
| `StartInstance` | `TestStartInstance_NotFound` | pgx.ErrNoRows → `ErrInstanceNotFound` |
| `BulkUpdateDeployConfig` | `TestBulkUpdateDeployConfig_PartialFailure` | 3 IDs, middle row has empty external ref → its slot has `ErrInstanceNotFound`; the other two succeed; `Update` called twice |
| `BulkUpdateDeployConfig` | `TestBulkUpdateDeployConfig_OverLimit` | 51 IDs → `ErrBulkLimit` |
| `DetectDrift` | `TestDetectDrift_CountMismatch` | DesiredReplicas=3 but ListMachines returns 1 → `count_mismatch` |
| `DetectDrift` | `TestDetectDrift_SizeMismatch` | Machine guest differs from row's CPUs/MemoryMB → `size_mismatch` |
| `DetectDrift` | `TestDetectDrift_VolumeUnattached` | agent_volumes row with `fly_machine_id IS NULL` → `volume_unattached` |
| `DetectDrift` | `TestDetectDrift_NoDrift` | Aligned state → empty Categories slice |

---

## Sentinel mapping table (handed to Phase 5)

Phase 5 must add cases for these in `httpsrv.agentsErrToConnect`. `errors.Is` is the pattern; sentinels carry `fmt.Errorf("%w: …", sentinel)` wrapping so the contract is `errors.Is(err, sentinel)`:

| Sentinel (source pkg) | Connect code | Notes |
|---|---|---|
| `deploy.ErrInvalidSize` | `InvalidArgument` | Wrapped from `DeployConfig.Validate()` and `ResizeReplicas` range check |
| `deploy.ErrInvalidVolumeSize` | `InvalidArgument` | Wrapped from `DeployConfig.Validate()` and `ResizeVolume` range check |
| `deploy.ErrInvalidRegion` | `InvalidArgument` | Reserved; service layer doesn't surface it directly today (region validation against the live cache is a Phase 5 concern) |
| `deploy.ErrPlacementUnavailable` | `FailedPrecondition` | `UpdateDeployConfig` gates on `CheckPlacement` |
| `deploy.ErrLifecycleUnsupported` | `Unimplemented` | `DeployConfig.Validate()` rejects `idle-on-demand` / `suspended` |
| `deploy.ErrMachineBusy` | `Aborted` | Lease contention from `FlyDeployTarget.Update` / `Start` / `Stop` |
| `deploy.ErrVolumeShrink` | `InvalidArgument` | `ResizeVolume` rejects newSizeGB < current |
| `deploy.ErrVolumeProvisionFailed` | `Unavailable` | Phase 3.5 — surfaces from `EnsureVolume` mid-Spawn |
| `agents.ErrBulkLimit` | `InvalidArgument` | Empty or > 50 IDs |
| `agents.ErrInstanceNotFound` | `NotFound` | Already mapped (M4) |
| `agents.ErrFlyAPI` | `Unavailable` | Already mapped (M4) — every redacted Fly-side failure |
| `agents.ErrTargetUnavailable` | `Unavailable` | Already mapped (M4) |

---

## Next phase entry checkpoint

Phase 5 lands the proto IDL changes + the Connect handlers for the six new RPCs (`UpdateDeployConfig`, `StartAgentInstance`, `ResizeAgentReplicas`, `ResizeAgentVolume`, `BulkUpdateDeployConfig`, plus `ListDeploymentRegions` / `CheckDeploymentPlacement` / `ListAgentMachines` / drift surface). The service-layer surface is now method-complete and sentinel-mapped at the agents-package boundary; Phase 5's only ask is wire-up. Tests in `internal/httpsrv/agents_handler_test.go` get the same shape as Phase 4's table-driven additions — the new handlers should each be <30 lines per blueprint §11.9.
