# M5 Fleet Control — Phase 2 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 2.
**Date:** 2026-04-26.
**Scope:** `internal/deploy.DeployTarget` interface widening, new typed `DeployConfig` + companion structs, new sentinels, `NotImplemented` stubs everywhere except the M4-preserved compute path. No service-layer behaviour change yet — Phase 4 wires the new methods.

---

## What shipped

Two new files, four updated files, zero schema or proto changes, zero frontend changes.

### New files

- **`backend/internal/deploy/types.go`** — defines the M5 type vocabulary that the rest of the milestone consumes:
  - `DeployConfig` (9 fields mirroring the migration columns), with `WithDefaults()` (zero-coalescing) and `Validate()` (static bounds per plan decision 20). Defaults centralised as `DefaultRegion`/`DefaultCPUKind`/etc constants alongside `MinReplicas`/`MaxReplicas`/`MinVolumeSize`/`MaxVolumeSize` so the migration's CHECK constraints and Go-side validation read the same numbers.
  - `Region` — Corellia's projection of `fly.Region` (4 fields). Per plan decision 17, never re-export Fly types out of `internal/deploy`.
  - `UpdateKind` — three-value enum (`live_applied` / `live_applied_with_restart` / `requires_respawn`) per plan decision 6.
  - `PlacementResult`, `MachineState` (with `AttachedVolumeID`), `VolumeRef` — the projected shapes the FE consumes via the `ListDeploymentRegions` / `CheckDeploymentPlacement` / fleet-inspector RPCs landing in Phase 5.
  - **No `fly-go` import.** `time` is the only stdlib dependency. Blueprint §11.1 holds.

- **`backend/internal/deploy/errors.go`** — eight new sentinels: `ErrInvalidRegion`, `ErrInvalidSize`, `ErrInvalidVolumeSize`, `ErrPlacementUnavailable`, `ErrLifecycleUnsupported`, `ErrMachineBusy`, `ErrVolumeShrink`, `ErrVolumeProvisionFailed`. Each carries a doc-comment pinning its Connect-code mapping per plan decision 25 — single grep target for the M5 error vocabulary. Pre-existing sentinels (`ErrNotImplemented` in `target.go`, `ErrTargetNotConfigured` in `resolver.go`) stay where they are; renaming them would churn unrelated imports for no behavioural gain.

### Updated files

- **`backend/internal/deploy/target.go`** — `DeployTarget` interface widened from 5 methods to 12. New methods: `Update`, `Start`, `ListRegions`, `CheckPlacement`, `ListMachines`, `EnsureVolume`, `ExtendVolume`. `Spawn`'s signature gained a `cfg DeployConfig` parameter. `SpawnResult` gained `MachineIDs []string` for the M5 N-replicas-per-app shape (plan decision 1); the legacy single-value `MachineID` stays as `MachineIDs[0]` for callers that haven't yet migrated. `HealthStatus` gained a sixth value `HealthDrifted` per plan decision 14.

- **`backend/internal/deploy/stubs.go`** — `LocalDeployTarget` and `AWSDeployTarget` each grew from 5 methods to 12. Every new method returns `ErrNotImplemented` per blueprint §11.4. Spawn's signature picked up the `DeployConfig` arg.

- **`backend/internal/deploy/fly.go`** — three changes:
  1. `Spawn`'s signature now takes `DeployConfig`. The body applies `cfg.WithDefaults()` and uses `cfg.Region` / `cfg.CPUs` / `cfg.MemoryMB` as the fallback for empty `spec.*` fields. The legacy lower-case constants (`defaultRegion`, `defaultCPUs`, `defaultMemoryMB`) are now dead code — left in place because Phase 2 is strictly additive; Phase 4 will delete them when `DeployConfig` becomes the sole defaults source.
  2. `Health` lost its `len(machines) > 1` error path (plan decision 1 retired the M4 invariant). Replaced with an `any-started → started`, `any-starting → starting`, `any-failed → failed`, else map-first-machine rule. Still strictly less rich than plan decision 14's full set (no `HealthDrifted` yet — that's Phase 3.5 once volume-attachment checks land).
  3. Seven new methods (`Update`, `Start`, `ListRegions`, `CheckPlacement`, `ListMachines`, `EnsureVolume`, `ExtendVolume`) added as `ErrNotImplemented` stubs. Phase 3 fills the compute side; Phase 3.5 fills the volume side. Doing it as `ErrNotImplemented` rather than empty `{}` means a caller wired ahead of the relevant phase surfaces a directed failure instead of silently no-op'ing.

- **`backend/internal/agents/service.go`** — single `deployer.Spawn(...)` call site at line 210 now passes `deploy.DeployConfig{}`. Comment pins the Phase 2 transitional contract: zero values → `WithDefaults` internally → byte-identical M4 behaviour. Phase 4 widens `SpawnInput` to carry the `DeployConfig` from the wire.

- **`backend/cmd/smoke-deploy/main.go`** — `target.Spawn(...)` call site updated identically. Comment notes that Phase 9's integration matrix extends this with the volume-persistence sentinel test.

- **`backend/internal/agents/service_test.go`** — `fakeDeployTarget` got the seven new methods (no-op + zero-value, except `EnsureVolume` returns a deterministic stub `VolumeRef` per plan §4 Phase 2 exit criteria). `Spawn` signature picked up the `DeployConfig` arg. Existing tests still pass without modification — the fake's expanded surface is invisible to callers that only exercise the M4 methods.

### Compile-time interface conformance

`internal/deploy/target_test.go` already had compile-time assertions:

```go
var (
    _ DeployTarget = (*FlyDeployTarget)(nil)
    _ DeployTarget = (*LocalDeployTarget)(nil)
    _ DeployTarget = (*AWSDeployTarget)(nil)
)
```

These are the cheapest possible "did I miss a method on a stub?" check, and they all pass on the widened interface — confirming the AWS / Local / Fly impls are method-complete against the new contract.

---

## What I deliberately did NOT do

- **No real `Update` / `Start` / `ListRegions` / `CheckPlacement` / `ListMachines` impl on `FlyDeployTarget`.** That's Phase 3.
- **No real `EnsureVolume` / `ExtendVolume` impl, no `volumeRecorder` interface on `FlyDeployTarget`, no `agent_volumes`-backed recorder.** That's Phase 3.5.
- **No region cache field on `FlyDeployTarget`, no boot-time `flaps.GetRegions` fetch, no hourly refresh goroutine.** Phase 3 (plan decision 9).
- **No new sqlc reads of the agent_volumes table from the service layer.** Phase 4.
- **No new RPC, no proto change.** Phase 5.
- **No Spawn-time replica fan-out** (`for i := 0; i < cfg.DesiredReplicas; i++ { flaps.Launch(...) }`). Phase 3 (plan decision 7's Corellia-side reconciliation pattern lands there). Today's Spawn still creates exactly one machine regardless of `cfg.DesiredReplicas`.
- **Did not touch `agents.Service` beyond the one `Spawn` call site update.** No new `UpdateDeployConfig` / `StartInstance` / `ResizeReplicas` / `ResizeVolume` / `BulkUpdateDeployConfig` methods yet — Phase 4.

Holding all of this for the named phase is what keeps Phase 2 a clean "interface lands; nothing changes behaviourally" boundary. The widened interface compiles, every concrete type implements it, every existing test passes, and the M4 spawn flow still works byte-for-byte (the dead-code path for `defaultRegion` etc is unreachable but doesn't change observable behaviour).

---

## Plan deviations

### 1. `errors.go` is a new file, not an extension of an existing one

The plan says "new sentinels in `internal/deploy/errors.go`." The package didn't have an `errors.go` — the two pre-existing sentinels (`ErrNotImplemented`, `ErrTargetNotConfigured`) live in their respective behavioural files (`target.go` / `resolver.go`). I created `errors.go` as the plan literal directs, but did **not** move the pre-existing sentinels in (would churn unrelated imports). Future readers should expect the M5 sentinels to live in `errors.go` and the original two to stay where they are — recommend a follow-up plan revision noting this split, or a small post-M5 cleanup that consolidates all sentinels in `errors.go`.

### 2. Dead-code constants in fly.go

The original `defaultRegion = "iad"`, `defaultCPUs = 1`, `defaultMemoryMB = 512` constants in `fly.go` are now unreachable from `Spawn` (which reads from `cfg.Region` / `cfg.CPUs` / `cfg.MemoryMB` after `WithDefaults`). Go compiles unused package-level constants without complaint. **Left in place intentionally** because Phase 2 is strictly additive — deleting them is a Phase 4 cleanup once the service layer fully owns the defaults source. Flagged here so a future contributor doesn't add new readers of these constants.

### 3. `MachineID` (singular) preserved for back-compat

Plan §4 Phase 3 says `SpawnResult` "gains `MachineIDs []string` (NEW: plural)" — implying the singular field goes away. Phase 2 keeps **both** fields populated (`MachineIDs = []string{m.ID}` alongside `MachineID = m.ID`) so existing readers (`cmd/smoke-deploy` reads `res.MachineID`) keep working without a Phase 2 callsite churn. Phase 3 or 4 should drop `MachineID` once every reader has migrated to `MachineIDs[0]`.

---

## Validation gates met

- `cd backend && sqlc generate` clean (no schema change, but ran to confirm Phase 1's generated tree is still consistent against the new package surface).
- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./internal/deploy/... ./internal/agents/...` all green — the named exit-criteria packages pass.
- `cd backend && go test ./...` (full suite) green: `internal/agents`, `internal/deploy`, `internal/httpsrv`, `internal/users`. Compile-time interface-conformance assertions in `target_test.go` confirm method-completeness on all three concrete types.
- No proto change, no frontend touch, no migration touch.

---

## Validation gates owed (for later phases)

- Phase 3 will need real Fly-API tests against the new compute methods (`Update`, `Start`, `ListRegions`, `CheckPlacement`, `ListMachines`); plan §4 Phase 3 calls for a `flapsClientFake` interface that `flaps.Client` already satisfies. Today's `target_test.go` is fly-API-free.
- Phase 4's service-layer tests will exercise the seven new fake methods on `fakeDeployTarget` for real (counting calls, injecting failures); the no-op stubs added today are placeholders.
- The operator's `goose up` round-trip on Phase 1's migration is still owed and is now also a soft prerequisite for Phase 4's service-layer tests (those will read the new columns).

---

## Schema / interface symmetry check

The M5 typed surface lines up cleanly with Phase 1's schema:

| `DeployConfig` field | `agent_instances` column | DB CHECK | Go bounds (Validate) |
|---|---|---|---|
| `Region` | `region TEXT` | (unconstrained — runtime cache check) | (unconstrained — service layer) |
| `CPUKind` | `cpu_kind TEXT` | `IN ('shared','performance')` | `IN ('shared','performance')` |
| `CPUs` | `cpus INTEGER` | `BETWEEN 1 AND 16` | `MinCPUs..MaxCPUs` |
| `MemoryMB` | `memory_mb INTEGER` | `BETWEEN 256 AND 131072 AND %256=0` | `MinMemoryMB..MaxMemoryMB`, `%MemoryStepMB==0` |
| `RestartPolicy` | `restart_policy TEXT` | `IN ('no','always','on-failure')` | same set |
| `RestartMaxRetries` | `restart_max_retries INTEGER` | `>= 0` | `>= 0` |
| `LifecycleMode` | `lifecycle_mode TEXT` | 4-value enum | 2-value enum (rest → `ErrLifecycleUnsupported`) |
| `DesiredReplicas` | `desired_replicas INTEGER` | `BETWEEN 1 AND 10` | `MinReplicas..MaxReplicas` |
| `VolumeSizeGB` | `volume_size_gb INTEGER` | `BETWEEN 1 AND 500` | `MinVolumeSize..MaxVolumeSize` |

The forward-compatible asymmetry on `LifecycleMode` (DB allows 4, API allows 2) is plan decision 3 working as designed: the column is forward-compatible; the API is the constraint. When `idle-on-demand` / `suspended` ship in a future milestone, only `Validate()` changes — no migration churn.

---

## Next phase entry checkpoint

Phase 3 implements the six compute-side new methods on `FlyDeployTarget` for real (Update / Start / ListRegions / CheckPlacement / ListMachines, plus making Spawn loop `cfg.DesiredReplicas` times). Phase 3.5 wires the volume side (EnsureVolume / ExtendVolume / volume cleanup on Destroy / volume-aware Health). The interface, types, sentinels, and stubs all stand ready; Phase 3 starts on a green baseline.
