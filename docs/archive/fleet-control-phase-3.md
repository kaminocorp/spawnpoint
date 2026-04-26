# M5 Fleet Control — Phase 3 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 3.
**Date:** 2026-04-26.
**Scope:** Real Fly-API-backed implementations of the six compute-side new methods on `FlyDeployTarget` (`ListRegions`, `CheckPlacement`, `Spawn` rewrite, `Update`, `Start`, `Stop` revised, `ListMachines`). Region cache + hourly background refresh. Lease-aware update + start + stop paths. Replica scale up/down. **Volumes still NOT mounted** — Phase 3.5 is the immediate-next.

---

## What shipped

One file rewritten, one new test file, zero schema / proto / FE changes. The deploy-target interface signature is unchanged from Phase 2; this phase fills the bodies.

### Updated files

- **`backend/internal/deploy/fly.go`** — substantial rewrite, ~600 LOC (was ~290). Six structural additions:
  - **`flapsClient` interface** — the subset of `*flaps.Client` that `FlyDeployTarget` reaches for. Defining it as an interface lets `fly_test.go` inject a fake without spinning up the real Fly API. Per plan §4 Phase 3 literal: "small interface that `flaps.Client` satisfies; fake implements it." The `FlyDeployTarget.flaps` field type changed from `*flaps.Client` to `flapsClient`; the production constructor still wires the concrete `*flaps.Client` in via `flaps.NewWithOptions`. **Adding a new flaps method?** Append to the interface, then implement on the fake. The interface is now the single grep target for "what does `FlyDeployTarget` reach for in fly-go?"
  - **`regionCache` type + field** — `sync.RWMutex` + `regions []Region` + `lastFetch time.Time`. `snapshot()` returns a defensive copy; `store()` replaces wholesale and stamps `lastFetch`. The cache is the boundary between "Fly's region list" (which moves on Fly's schedule) and "the FE's region picker" (which needs a stable, sorted, non-deprecated set).
  - **`NewFlyDeployTarget` widened** — after constructing the `flaps.Client`, calls `refreshRegions(ctx)` synchronously and starts `regionRefreshLoop` as a goroutine. Synchronous boot fetch fail-fast pattern per plan decision 9.
  - **`refreshRegions` + `regionRefreshLoop`** — fetcher and ticker. The fetcher filters `Deprecated=true` server-side (decision 9: deprecated regions are filtered once at fetch time so every consumer sees the same set), sorts by `Code` for deterministic UX, projects to Corellia's `Region` shape (per plan decision 17 — never re-export `fly.Region` past this package). The ticker runs every `regionRefreshInterval = 1h` and uses a fresh context with `cleanupTimeout` so a transient outage logs at `slog.Warn` and retains the prior cache rather than blanking the picker.
  - **Spawn rewritten** — replica loop. `cfg.WithDefaults()` resolves `DesiredReplicas` (zero → 1). The `for i := 0; i < cfg.DesiredReplicas; i++` body calls `flaps.Launch` per replica; `MachineIDs` accumulates every ID returned. The per-app rollback `defer` chain (existing M4 cleanup pattern) is preserved unchanged — `flaps.DeleteApp` cascades to all machines + secrets, so a partial replica loop doesn't need per-machine cleanup. **Volumes are still NOT attached** — `MachineConfig.Mounts` is empty per the M4 launch shape. Phase 3.5 adds `EnsureVolume` + `Mounts` per replica. The `MachineID` (singular) field on `SpawnResult` stays populated as `MachineIDs[0]` per Phase 2's back-compat note; Phase 4 or later drops it once `cmd/smoke-deploy` migrates.
  - **Six new method bodies** — `Update` / `Start` / `Stop` (revised) / `ListRegions` / `CheckPlacement` / `ListMachines`. Detail per method below.

- **`backend/internal/deploy/fly_test.go`** — new file. `flapsClientFake` implements every `flapsClient` method, recording call counts and falling through to sensible defaults. 14 table-driven tests across the six new methods (region cache, Spawn replica loop, Spawn rollback, image validation, Update region-change → respawn, Update live-apply across replicas, scale up, scale down LIFO, lease contention → `ErrMachineBusy`, Start filters by state, Stop lease-per-machine, CheckPlacement available + unavailable + alternates, ListMachines projection, lifoTail ordering). All pass under `go test ./internal/deploy/...`. **No live-Fly tests in CI** per plan §4 Phase 3.

### Method-by-method detail

#### `ListRegions`
Reads from `regionCache.snapshot()`. Never blocks on Fly. A caller invoked before the boot fetch completes would observe an empty slice; that path is impossible in practice because `NewFlyDeployTarget` returns only after the synchronous fetch succeeds.

#### `CheckPlacement`
Wraps `flaps.GetPlacements(GetPlacementsRequest{ComputeRequirements, Region, Count, VolumeSizeBytes, Org})`. The volume-size hint is forwarded so Fly considers volume capacity in placement (plan §4 Phase 3 + decision 27). Result projection: a `RegionPlacement` whose `Region == cfg.Region` with `Count >= cfg.DesiredReplicas` → `Available: true`; otherwise `Available: false` with the requested-region's actual capacity in `Reason` and every other region with sufficient capacity in `AlternateRegions`. Errors return both a typed `PlacementResult{Available: false, Reason: redactedMsg}` *and* a wrapped `ErrPlacementUnavailable` so the caller can `errors.Is` for sentinel mapping in Phase 5 while still rendering an informative reason in the FE preview.

#### `Spawn`
- Replica loop replaces the single `flaps.Launch` call. `MachineIDs []string` carries every ID; `MachineID` (singular) = `MachineIDs[0]` for back-compat.
- Region precedence: `spec.Region` (M4 caller path) wins if set; else `cfg.Region` after `WithDefaults`. Same fall-through for `cpus` / `memory`. Once Phase 4 wires real wire-side values into `cfg`, the `spec.*` preference path becomes dead and gets dropped.
- The deferred cleanup chain orphans nothing on failure: `DeleteApp` cascades to all machines + secrets so a partial replica loop doesn't need per-machine cleanup.
- **Volumes are not mounted yet.** The M4 "no `$HERMES_HOME` survives restart" gap is unchanged; Phase 3.5 closes it.

#### `Update`
Four steps in order:
1. **Region-delta gate.** Compare `cfg.Region` against every machine's `Region`. Any mismatch → return `(UpdateRequiresRespawn, nil)` immediately. **Don't touch Fly.** The orchestrator (Phase 4's `agents.Service.UpdateDeployConfig`) handles the destroy + respawn with state-loss confirmation. Volumes are region-pinned (decision 8 + Phase 3.5), so a region change wipes persistent state — the `RequiresRespawn` return is what triggers the destructive UX.
2. **Per-machine compute mutate** under lease. `acquireLease(app, m.ID)` → `flaps.Get(m.ID)` → `mergeMachineConfig(current.Config, cfg)` (preserves `Image` / `Mounts` / `Env` / `Services` so an Update never silently changes the running image or strips a mount) → `flaps.Update(LaunchMachineInput{ID, Region, Config}, nonce)` → `flaps.Wait(machine, "started"|"stopped", waitTimeout=60s)` → defer `release()`. Each machine's lease is held only for its own cycle; concurrent edits on sibling machines don't block.
3. **Replica count delta.**
   - `cfg.DesiredReplicas > current` → scale up. Call `firstMachineForLaunch(machines)` to derive the new replicas' `LaunchMachineInput` from the existing fleet (region + image + config), then `flaps.Launch` for the diff. **No partial rollback** on a mid-loop failure: rolling back would also need to identify which machines were pre-existing vs new, which is fragile. The caller's reconcile loop catches up on the next Update call.
   - `cfg.DesiredReplicas < current` → scale down LIFO. `lifoTail(machines, n)` orders by `CreatedAt` descending (ties broken by ID for determinism) and returns the `n` newest. Each victim is destroyed under its own lease via `destroyMachine` → `acquireLease` → `flaps.Destroy(RemoveMachineInput{ID, Kill: true}, nonce)` → defer `release()`. **Plan §6 risk 2** ("scale-down deletes the wrong machine") — failed-first ordering is a Phase 3 TODO once we have per-machine state inspection in tests; today's LIFO captures the canonical case. Volume cleanup for scale-down is Phase 3.5.
4. Return `UpdateLiveApplied` on success. `UpdateLiveAppliedWithRestart` is reserved for Phase 3.5's volume-extend path.

#### `Start`
- `flaps.List` → for each `state == "stopped"` machine, `acquireLease` → `flaps.Start(machineID, nonce)` → `flaps.Wait(started, 60s)` → defer release.
- Already-running machines are skipped (Fly's Start API is not idempotent — calling it on a started machine returns an error). **Plan literal said only "stopped"; the test `TestStart_OnlyTouchesStoppedMachines` pins this filter.**

#### `Stop` (revised)
- M4 path called `flaps.Stop` directly without a lease. Phase 3 wraps it in the same `acquireLease` pattern as Update / Start so concurrent edits don't race.
- Per-machine: `acquireLease` → `flaps.Stop(StopMachineInput{ID}, nonce)` → defer release.

#### `ListMachines`
- `flaps.List` → `projectMachine(m)` per entry. Projected fields: `ID`, `Region`, `State`, `CPUKind`/`CPUs`/`MemoryMB` (from `Config.Guest`), `CreatedAt` (parsed via `time.Parse(time.RFC3339, m.CreatedAt)` with empty time on parse failure), `AttachedVolumeID` (first mount's `Volume`; one volume per machine in the M5 model per decision 8.4).

#### `Health` (untouched in Phase 3)
Already revised in Phase 2 (the `len(machines) > 1` error path was retired). Volume-drift surfacing lands in Phase 3.5; for now health observes only compute state. `HealthDrifted` is not yet returnable from this method.

#### Volume methods (still stubbed)
`EnsureVolume` and `ExtendVolume` continue to return `ErrNotImplemented`. Phase 3.5 fills them alongside the `volumeRecorder` interface and the `agent_volumes`-table-backed wiring. Stub bodies relocated from the M5 Phase 2 stub block at the end of the file to a clearly-named "Phase 3.5 — volume lifecycle methods" comment block.

---

## Lease pattern (worth keeping)

Two-layer wrapper, applied identically by Update / Start / Stop / destroyMachine:

```go
nonce, release, err := f.acquireLease(ctx, app, machineID)
if err != nil { return err }
defer release()
// ... flaps call with nonce ...
```

`acquireLease` calls `flaps.AcquireLease(app, machineID, &leaseTTLSeconds)` (30s per plan §4 Phase 3); on failure it wraps as `fmt.Errorf("%w: %v", ErrMachineBusy, err)` so the Phase 5 handler-layer mapping table can `errors.Is(err, ErrMachineBusy)` → Connect Aborted. The release closure uses a **fresh** context with `cleanupTimeout = 30s` — caller cancellation can't strand a nonce past its TTL on Fly's side. Lease-release errors log at `slog.Warn` rather than propagating; the lease will TTL out anyway.

---

## How it diverged from the plan

Three deviations, all flagged at the moment they were chosen:

### 1. `NewFlyDeployTarget` returns error instead of panicking on boot fetch

Plan §4 Phase 3 literal: *"On boot, one synchronous fetch attempt (panic on failure: blueprint §11.1 spirit — fail-fast on infrastructure misconfig)."* The existing constructor's contract is `(ctx, FlyCredentials) (*FlyDeployTarget, error)` — every other failure path (flaps client construction, missing credentials) returns an error. Returning an error on boot-fetch failure stays consistent with that contract; `cmd/api/main.go` is the fail-fast point where the process exits. Operationally identical to panicking (boot stops on misconfigured Fly token); structurally cleaner.

### 2. `MachineGuest.SetSize(presetName)` is not used

Plan §4 Phase 3: *"translates `DeployConfig` to `MachineGuest` via `MachineGuest.SetSize(presetName)` if a preset is identifiable, else direct field set."* Direct field set is always safe and simpler — `SetSize` populates a preset's defaults but we already have explicit `CPUs` / `MemoryMB` values from `DeployConfig`, so the preset would just get overridden anyway. Skipping `SetSize` removes a string-roundtrip step and a potential source of "preset matched but memory differed" surprise. The wizard's preset chips (plan §7 Q3) work entirely client-side: the chip click sets `cfg.CPUs` + `cfg.MemoryMB` to the matching preset's tuple, the BE just receives the tuple.

### 3. Failed-first scale-down ordering is a Phase 3 TODO

Plan §6 risk 2: *"Replica scale-down deletes the wrong machine (e.g. the only `running` one while keeping a `failed` one). Phase 3 `Update` orders by `created_at` LIFO and skips `failed` machines preferentially."* Today's `lifoTail` orders only by `CreatedAt`. Adding the failed-first preference is straightforward (a stable sort with `failed` machines at the head of the victim list) but needs a unit test that distinguishes "scale 3→2 with one failed" from the canonical case. **Logged as follow-up:** add `TestUpdate_ScalesDownFailedFirst` and update `lifoTail` to a two-key sort once the test fixture is in.

---

## What I deliberately did NOT do

Per the plan's "Phase 3 = compute side; Phase 3.5 = volume side" split:

- **Did not implement `EnsureVolume` / `ExtendVolume`.** Both stay as `ErrNotImplemented`. Phase 3.5 fills them alongside the `volumeRecorder` interface and the `agent_volumes`-table-backed wiring.
- **Did not attach `Mounts` in `Spawn`.** The launched machines have no `$HERMES_HOME` volume — restart loses Hermes state. **This is the load-bearing M4 correctness regression that Phase 3.5 closes (plan §1 item 10).**
- **Did not delete the volumes for scaled-down machines.** Decision 8.5 + Phase 3.5: when `Update` removes machines (LIFO), also delete each removed machine's attached volume. Today's scale-down doesn't open a volume-leak window because there are no volumes yet.
- **Did not surface volume drift in `Health`.** Decision 14: `HealthDrifted` is not yet returnable. Phase 3.5 adds the per-machine volume-attachment + size check.
- **Did not write `UpdateLiveAppliedWithRestart`.** Reserved for Phase 3.5's volume-extend path; today's `Update` always returns `UpdateLiveApplied` or `UpdateRequiresRespawn`.
- **Did not touch `agents.Service` or any other domain package.** Phase 4 wires the new methods into `Spawn` / `UpdateDeployConfig` / `StartInstance` / etc. Today's service layer still calls `Spawn` with a zero `DeployConfig{}` per Phase 2's transitional shape.
- **Did not delete the dead `defaultRegion` / `defaultCPUs` / `defaultMemoryMB` constants in `fly.go`.** Phase 4 cleanup once the service layer fully owns the defaults source. Flagged in Phase 2 completion notes; still flagged here.
- **Did not drop the singular `MachineID` field on `SpawnResult`.** `cmd/smoke-deploy` still reads it. Phase 4 or later drops it.

---

## Validation gates met

- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./internal/deploy/...` — all 14 new tests pass; existing `target_test.go` assertions still pass (compile-time `DeployTarget` conformance held).
- `cd backend && go test ./...` (full suite) — `internal/agents`, `internal/deploy`, `internal/httpsrv`, `internal/users` all green.
- No proto change, no schema change, no frontend touch.

---

## Validation gates owed (operator)

- `cmd/smoke-deploy` end-to-end test against the real Fly API: spawn a 2-replica agent in `iad`, observe both machines via `ListMachines`, then `Destroy`. **Today's smoke-deploy passes a zero `DeployConfig{}` so it still spawns 1 replica** — to exercise the replica loop, either (a) tweak `cmd/smoke-deploy/main.go` locally to pass `DeployConfig{DesiredReplicas: 2}`, or (b) wait for Phase 4's CLI surface. The plan's exit criterion ("`cmd/smoke-deploy` can spawn a 2-replica agent in `iad` and observe both machines via `ListMachines`") implies option (a) — a one-line local edit, not a committed change.
- Operator's `goose up` round-trip on Phase 1's migration is **still owed** from Phase 1 completion notes. Phase 4 reads the new columns; runtime gating depends on the migration being applied to the dev DB.
- Boot-fetch failure mode: with a deliberately-bad `FLY_SPAWN_TOKEN`, `cmd/api` should fail to start with a clear error message. Quickest check: `FLY_SPAWN_TOKEN=invalid go run ./cmd/api` from `backend/` and confirm the failure surfaces from `NewFlyDeployTarget` rather than later.

---

## Test surface added

`fly_test.go` (~470 LOC, 14 tests) covers:

| Method | Test | What it pins |
|---|---|---|
| `refreshRegions` | `TestRefreshRegions_FiltersDeprecated` | Deprecated regions never reach the cache; sort order is stable |
| `refreshRegions` | `TestRefreshRegions_PreservesPriorOnError` | Transient outage doesn't blank the picker |
| `Spawn` | `TestSpawn_LaunchesEachReplica` (3 subcases: 1, 2, 5) | Replica loop calls `Launch` `n` times; `MachineIDs` populated; `MachineID` = `MachineIDs[0]` |
| `Spawn` | `TestSpawn_RollsBackOnLaunchFailure` | `DeleteApp` called once on failure (cascade cleanup) |
| `Spawn` | `TestSpawn_RejectsTagPinnedImage` | Validation runs before any Fly call |
| `Update` | `TestUpdate_RegionChangeReturnsRespawn` | Region delta → `UpdateRequiresRespawn` with **zero** `AcquireLease` / `Update` calls |
| `Update` | `TestUpdate_LiveAppliesAcrossReplicas` | Lease pattern: 2 machines → 2 each of `AcquireLease`, `Update`, `ReleaseLease` |
| `Update` | `TestUpdate_ScalesUp` | 1 → 3 desired triggers `Launch` ×2 |
| `Update` | `TestUpdate_ScalesDownLIFO` | 3 → 1 desired triggers `Destroy` ×2; victims are the LIFO tail |
| `Update` | `TestUpdate_LeaseContentionReturnsBusy` | `flaps.AcquireLease` failure surfaces as `ErrMachineBusy` (Phase 5 sentinel mapping) |
| `Start` | `TestStart_OnlyTouchesStoppedMachines` | `started` machines skipped; lease pattern observed for `stopped` ones |
| `Stop` | `TestStop_AcquiresLeasePerMachine` | Lease per machine (revised from M4's no-lease path) |
| `CheckPlacement` | `TestCheckPlacement_AvailableInRequestedRegion` | Available = true when capacity ≥ desired; alternates surfaced |
| `CheckPlacement` | `TestCheckPlacement_UnavailableSurfacesAlternates` | Available = false; reason includes capacity gap; alternates list non-target regions with capacity |
| `ListMachines` | `TestListMachines_ProjectsConfig` | Guest fields, `AttachedVolumeID` (first mount), `CreatedAt` parsed |
| `lifoTail` | `TestLifoTail_OrdersByCreatedAtDesc` | Newest-first, ties broken by ID |
| `lifoTail` | `TestLifoTail_NRequestExceedsLen` | Request beyond available clamps to `len(machines)` |

`flapsClientFake` records every method call in a `calls map[string]int` keyed by method name; tests assert call counts via `fake.callCount("MethodName")`. The fake also exposes overridable canned responses (`machines []*fly.Machine`, `placements []flaps.RegionPlacement`, etc.) and per-method error knobs (`launchErr`, `leaseErr`, etc.). Adding a new test only needs the fixture for the methods it cares about — defaults are no-op success.

---

## Next phase entry checkpoint

Phase 3.5 implements the volume side: `EnsureVolume` (idempotent provision via `flaps.CreateVolume` + `agent_volumes` insert via the `volumeRecorder` interface), `ExtendVolume` (via `flaps.ExtendVolume`, returns `needsRestart`), the `Spawn` final form (volume-create precedes Launch per decision 8.6, mounts threaded into each replica's `MachineConfig.Mounts`), the `Destroy` revision (cascade to volumes), the scale-down volume cleanup, the `Health` volume-drift surfacing.

Phase 3.5 also introduces the `volumeRecorder` interface that injects DB persistence into `FlyDeployTarget` while preserving blueprint §11.1 (Fly-only inside `FlyDeployTarget`) AND the M4 separation (DB-only inside the service layer). Pre-work: the `agent_volumes.sql.go` queries from Phase 1 are already in place; Phase 3.5 wires a thin recorder that calls them.

The compute side stands ready; Phase 3.5 starts on a green baseline.
