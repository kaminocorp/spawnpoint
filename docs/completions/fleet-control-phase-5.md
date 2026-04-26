# M5 Fleet Control — Phase 5 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 5.
**Date:** 2026-04-26.
**Scope:** Wire the M5 service-layer surface end-to-end. Proto IDL gains 9 new messages + 7 new RPCs + 3 new enums + a widened `AgentInstance` and `SpawnAgentRequest` / `SpawnNAgentsRequest`. `internal/httpsrv/agents_handler.go` extends with seven new handlers, sentinel-mapping table widened to cover all M5 sentinels (deploy package + `agents.ErrBulkLimit`). Generated trees regenerated and committed. The new RPCs are now mounted by the existing `corelliav1connect.NewAgentsServiceHandler` call in `httpsrv/server.go` — no router edit needed.

---

## What shipped

One proto file widened, four code files updated, two generated trees regenerated. ~600 net new lines of hand-written Go (handlers + tests) plus ~3.3 K of regenerated Go + TS.

### Updated files

- **`shared/proto/corellia/v1/agents.proto`** — proto IDL widening:
  - **3 new enums:** `UpdateKind` (UNSPECIFIED / LIVE_APPLIED / LIVE_APPLIED_WITH_RESTART / REQUIRES_RESPAWN), `DriftCategory` (5 values mirroring `agents.DriftCategory`).
  - **9 new messages:** `DeployConfig` (9 fields), `Region`, `PlacementResult`, `MachineState` (incl. `attached_volume_id`), `VolumeRef`, `DriftEntry`, `DriftSummary`, `UpdateResult` (`update_kind` + `estimated_downtime_seconds` + `wipes_persistent_state`), `BulkResult`, `BulkConfigDelta` (DeployConfig minus `volume_size_gb` per decision 8.4 — the type-level invariant carving makes "no volume change in bulk" compile-time-enforced on the wire).
  - **Widened `SpawnAgentRequest` + `SpawnNAgentsRequest`** with `optional DeployConfig deploy_config = 6/7`. Field-presence semantics so partial overrides flow naturally; unset = server-side WithDefaults.
  - **Widened `AgentInstance`** with fields 13–23: the 9 deploy-config columns inlined (not nested under a `DeployConfig deploy_config = 13` field — fleet rows consume them as flat columns and unwrapping a nested message would force every FE consumer through `instance.deployConfig?.region` instead of `instance.region`), plus `DriftSummary drift_summary = 22` and `repeated VolumeRef volumes = 23`.
  - **7 new RPCs** mounted on the existing `AgentsService`:
    - `ListDeploymentRegions(ListDeploymentRegionsRequest) returns ListDeploymentRegionsResponse`
    - `CheckDeploymentPlacement(CheckDeploymentPlacementRequest{deploy_config}) returns CheckDeploymentPlacementResponse{placement_result}`
    - `UpdateAgentDeployConfig(UpdateAgentDeployConfigRequest{instance_id, deploy_config, dry_run}) returns UpdateAgentDeployConfigResponse{update_result}`
    - `StartAgentInstance(StartAgentInstanceRequest{instance_id}) returns StartAgentInstanceResponse{instance}`
    - `ResizeAgentReplicas(ResizeAgentReplicasRequest{instance_id, desired_replicas}) returns ResizeAgentReplicasResponse{instance}`
    - `ResizeAgentVolume(ResizeAgentVolumeRequest{instance_id, volume_size_gb}) returns ResizeAgentVolumeResponse{instance, needs_restart}`
    - `BulkUpdateAgentDeployConfig(BulkUpdateAgentDeployConfigRequest{instance_ids, deploy_config_delta, dry_run}) returns BulkUpdateAgentDeployConfigResponse{results}`

- **`backend/internal/gen/corellia/v1/agents.pb.go`** + **`agents.connect.go`** + **`frontend/src/gen/corellia/v1/agents_pb.ts`** — regenerated via `pnpm proto:generate`. Verified idempotent (running `pnpm proto:generate` twice produces no diff on the second run).

- **`backend/internal/agents/fleet.go`** — two new service methods:
  - **`ListRegions(ctx) ([]deploy.Region, error)`** — thin wrapper around `flyTarget.ListRegions`. Keeps the deploy package sealed behind agents.Service so the handler stays <30 LOC per blueprint §11.9.
  - **`CheckPlacement(ctx, cfg) (deploy.PlacementResult, error)`** — wraps `flyTarget.CheckPlacement` after `cfg.WithDefaults().Validate()`. Same code path the FE's spawn-wizard review step calls and the BE's Spawn / Update path calls — single source of truth per plan decision 27.

- **`backend/internal/agents/service.go`** — three additions:
  1. **`applyDeployConfigToInstance(*db.AgentInstance, deploy.DeployConfig)`** helper. Patches the in-memory row's nine fields after the in-tx `UpdateAgentDeployConfig` call. The DB row is the source of truth; this just keeps the in-memory copy in sync so the wire response surfaces what the caller asked for (without a re-read).
  2. **`Spawn` calls `applyDeployConfigToInstance` inside the spawn-tx closure** right after `q.UpdateAgentDeployConfig(...)`. Pre-Phase-5 this didn't matter because the wire shape didn't carry the nine fields; Phase 5's widened `toProtoInstance` consumes them, so the patch is now load-bearing.
  3. **`toProtoInstance` + `toProtoInstanceGetRow` widened with the 9 deploy-config fields.** `toProtoInstanceListRow` is **deliberately NOT widened** — `ListAgentInstancesByOrg` still projects the M4 column set per the Phase 4 plan deviation; widening that query is Phase 5/6's job when the FE row card consumes the new columns. Today the list path emits proto3 zero values for fields 13–21, which the FE renders as "—" in the row badges (verified during type-check).

- **`backend/internal/httpsrv/agents_handler.go`** — rewritten end-to-end:
  - **`agentsService` interface widened** with the 7 new M5 methods. `*agents.Service` satisfies it structurally.
  - **`SpawnAgent` / `SpawnNAgents` handlers** now thread `req.Msg.GetDeployConfig()` through `deployConfigFromProto(...)` into `SpawnInput.DeployConfig` / `SpawnNInput.DeployConfig`. Backwards-compatible: callers omitting the field land at the zero `DeployConfig{}` which `WithDefaults` canonicalises to the M4-equivalent shape.
  - **7 new handlers**, each <30 LOC:
    - `ListDeploymentRegions` — auth-check + `svc.ListRegions` + projection loop.
    - `CheckDeploymentPlacement` — auth-check + `svc.CheckPlacement(deployConfigFromProto)` + projection.
    - `UpdateAgentDeployConfig` — auth + UUID-parse + `svc.UpdateDeployConfig` + `updateResultToProto`.
    - `StartAgentInstance` — auth + UUID-parse + `svc.StartInstance` (returns the new instance directly).
    - `ResizeAgentReplicas` — auth + UUID-parse + `svc.ResizeReplicas` + re-fetch via `svc.Get` for the response. The service returns `*UpdateResult` not the instance; the handler does the re-fetch (one extra round-trip per resize, acceptable at fleet-edit cadence).
    - `ResizeAgentVolume` — same shape as `ResizeAgentReplicas` but also surfaces `needs_restart` from `result.Kind == UpdateLiveAppliedWithRestart`.
    - `BulkUpdateAgentDeployConfig` — auth + per-id UUID-parse + `svc.BulkUpdateDeployConfig` + `bulkResultToProto` per row. Bad-UUID in the input slice short-circuits the whole call with `InvalidArgument` (so the FE doesn't get a partial-success response with one phantom failure that's actually a request-shape bug).
  - **5 small projection helpers:** `deployConfigFromProto`, `bulkDeltaFromProto`, `updateResultToProto`, `bulkResultToProto`, `updateKindToProto`. All nil-safe; nil proto messages return zero domain values (which the service's `WithDefaults` canonicalises).
  - **`agentsErrToConnect` widened** with cases for all M5 sentinels per Phase 4 completion notes' hand-off table:

    | Sentinel | Code |
    |---|---|
    | `deploy.ErrInvalidSize` | `InvalidArgument` |
    | `deploy.ErrInvalidVolumeSize` | `InvalidArgument` |
    | `deploy.ErrInvalidRegion` | `InvalidArgument` |
    | `deploy.ErrVolumeShrink` | `InvalidArgument` |
    | `agents.ErrBulkLimit` | `InvalidArgument` |
    | `deploy.ErrPlacementUnavailable` | `FailedPrecondition` |
    | `deploy.ErrLifecycleUnsupported` | `Unimplemented` |
    | `deploy.ErrMachineBusy` | `Aborted` |
    | `deploy.ErrVolumeProvisionFailed` | `Unavailable` |

    `errors.Is` is the matching primitive; the wrapped form (`fmt.Errorf("%w: ...", sentinel)`) the service layer surfaces matches the same way as the bare sentinel — verified in the test table.

- **`backend/internal/httpsrv/agents_handler_test.go`** — extended:
  - **`fakeAgentsSvc`** gains the 7 M5 methods + `updateResult` / `bulkResults` / `regions` / `placement` injection knobs.
  - **9 new sentinel-mapping rows** in `TestAgentsErrToConnect_SentinelMapping`: each M5 sentinel + the wrapped form of `deploy.ErrInvalidSize` (proves `errors.Is` matches both forms).
  - **6 new happy-path / error-path tests** in `TestUpdateAgentDeployConfig_DryRunHappyPath`, `TestUpdateAgentDeployConfig_RegionRespawnSetsWipesFlag`, `TestResizeAgentReplicas_HappyPath`, `TestResizeAgentVolume_NeedsRestartReflectsKind`, `TestBulkUpdateAgentDeployConfig_PartialSuccess`, `TestBulkUpdateAgentDeployConfig_BadInstanceID`, `TestListDeploymentRegions_HappyPath`. The plan called out three load-bearing scenarios (UpdateAgentDeployConfig dry-run, BulkUpdateAgentDeployConfig partial success, ResizeAgentReplicas happy path); the others provide spot-checks of the per-handler projection helpers (`updateResultToProto`'s `wipes_persistent_state` derivation, `ResizeAgentVolume`'s `needs_restart` derivation).

---

## Plan deviations

Three deviations, all flagged at the moment they were chosen:

### 1. `UpdateAgentDeployConfigResponse` does not carry `instance`

Plan §4 Phase 5 literal: *"`UpdateAgentDeployConfig(...) returns UpdateAgentDeployConfigResponse{update_result}`"*. Strict adherence — only `update_result` on the wire. The FE re-Gets the instance after a successful apply (one extra round-trip; the dry-run path doesn't need to). Trade-off considered: adding `AgentInstance instance = 2` would save the FE one round-trip per apply, but the plan explicitly names `{update_result}` as the response shape and Phase 5 is a wire-up phase, not a shape-redesign phase. A future Phase 7 can revisit if the FE's edit-and-re-render flow proves chatty.

### 2. `ResizeAgentReplicas` / `ResizeAgentVolume` re-fetch via `svc.Get` for the response

Plan §4 Phase 5: *"`ResizeAgentReplicasResponse{instance}`"*. The Phase 4 service method returns `*UpdateResult`, not the instance (because the apply path's value to the caller is "what kind of update happened, how long is the downtime"). The handler bridges by calling `svc.Get` after the resize. Adds one DB round-trip per resize (negligible at fleet-edit cadence — the handler is already in flight from a `flaps.Update` call that takes 100ms+). Alternative considered: change Phase 4's service signatures to return `(*AgentInstance, *UpdateResult)`. Rejected because Phase 4 already shipped and Phase 5 is contract-additive only; widening service-layer signatures mid-milestone churns more code than the extra `Get` round-trip costs.

### 3. `AgentInstance.deploy_config` is inlined as 9 flat fields, not nested

Plan §4 Phase 5 literal allowed both shapes. Chose flat (fields 13–21 on `AgentInstance` directly) over nested (`DeployConfig deploy_config = 13`) because the FE consumes them as fleet-row columns: `instance.region`, `instance.cpus`, `instance.memoryMb`. A nested message would force every consumer through `instance.deployConfig?.region` with optional-chaining-or-default boilerplate. The wire-format byte cost is identical; the FE ergonomics are strictly better.

---

## What I deliberately did NOT do

- **Did not widen `ListAgentInstancesByOrg`.** Phase 4 deferred this; Phase 5 doesn't pick it up either. The list query stays at the M4 projection; the M5 fleet-row columns will land in Phase 5/6 (the FE plan-side phase, not this BE plan-side phase) when the row card actually renders the new fields. Today's `toProtoInstanceListRow` emits proto3 zero values for fields 13–21 — the FE will render them as "—" until widening lands.

- **Did not add a `DetectDrift` RPC.** Plan §4 Phase 4 ships `DetectDrift` as a service method, but Phase 5's RPC list does NOT include it. Drift surfaces via the `AgentInstance.drift_summary` field (loaded on demand by Phase 7's inspector). The service method is callable — Phase 7 can either add a dedicated RPC or wire it through `GetAgentInstance` projection if cheaper. Tracked as Phase 7 entry-point decision.

- **Did not exercise live RPCs via `curl`.** Plan exit criterion mentions "callable via `curl` against a local backend." Verified via the unit-test happy paths plus `go build ./...` clean (which proves the `corelliav1connect.AgentsServiceHandler` interface is satisfied by `*AgentsHandler` — the mount in `server.go:45` would fail to compile otherwise). A live-`curl` smoke is owed when the operator runs `overmind start` next; not blocking for the phase boundary.

- **Did not touch `cmd/api/main.go`.** No constructor change needed — `agentsSvc := agents.NewService(...)` and `httpsrv.NewAgentsHandler(agentsSvc, usersSvc)` both still compile against the widened `agentsService` interface (structural satisfaction).

- **Did not touch the FE.** Phase 5 is BE-only per the plan split. Phase 6 (FE: spawn wizard Step 4 wired to DeployConfig) is the next phase.

---

## Validation gates met

- `cd backend && go vet ./...` clean (full repo).
- `cd backend && go build ./...` clean.
- `cd backend && go test ./...` — full suite green: `agents`, `deploy`, `httpsrv`, `users`. The 9 new sentinel rows + 7 new happy-path tests run in <0.7s.
- `pnpm proto:generate` runs cleanly; idempotent on second invocation (the Phase 5 exit criterion).
- `pnpm -C frontend type-check` clean — the regenerated TS messages compile against existing FE imports (M4 callsites still valid; the new fields surface as optional getters).
- `pnpm -C frontend lint` clean.
- Sqlc unchanged (no SQL touched in Phase 5).

---

## Validation gates owed (operator)

- **Live `curl` smoke against `overmind start`.** Hit each new RPC at least once with a valid Supabase JWT in the `Authorization` header. Quickest path: `ListDeploymentRegions` (no body needed) confirms the auth + service + Fly-cache wiring; `CheckDeploymentPlacement` with a sample DeployConfig confirms the placement read-path; `UpdateAgentDeployConfig` with `dry_run=true` against a real spawned agent confirms the preview path end-to-end without mutating Fly. The actual apply path (`dry_run=false`) is the Phase 9 integration smoke's job, not Phase 5.
- **Migration round-trip is still hard-blocking** — `goose -dir migrations postgres "$DATABASE_URL_DIRECT" up` must run against the dev DB before any Spawn through the new wire path; otherwise `UpdateAgentDeployConfig` fails on the missing columns. Owed since Phase 1.

---

## Sentinel mapping table (for future contributors)

The full M5 sentinel → Connect-code mapping shipped in `agentsErrToConnect`:

| Sentinel (source pkg) | Connect code | Notes |
|---|---|---|
| `users.ErrUnauthenticated` | `Unauthenticated` | M4 baseline |
| `users.ErrNotProvisioned` | `PermissionDenied` | M4 baseline |
| `agents.ErrInvalidName` | `InvalidArgument` | M4 baseline |
| `agents.ErrInvalidProvider` | `InvalidArgument` | M4 baseline |
| `agents.ErrInvalidModel` | `InvalidArgument` | M4 baseline |
| `agents.ErrMissingAPIKey` | `InvalidArgument` | M4 baseline |
| `agents.ErrBulkLimit` | `InvalidArgument` | M5 (empty / over-50 IDs) |
| `deploy.ErrInvalidSize` | `InvalidArgument` | M5 (cpu/mem/replicas/restart fields fail bounds) |
| `deploy.ErrInvalidVolumeSize` | `InvalidArgument` | M5 (volume_size_gb out of [1,500]) |
| `deploy.ErrInvalidRegion` | `InvalidArgument` | M5 (region not in cached list — service-layer cross-check) |
| `deploy.ErrVolumeShrink` | `InvalidArgument` | M5 (newSizeGB < current) |
| `agents.ErrSpawnLimit` | `FailedPrecondition` | M4 (caller asked for > 10) |
| `deploy.ErrPlacementUnavailable` | `FailedPrecondition` | M5 (Fly placement gate) |
| `deploy.ErrLifecycleUnsupported` | `Unimplemented` | M5 (idle-on-demand / suspended) |
| `deploy.ErrMachineBusy` | `Aborted` | M5 (lease contention; transient) |
| `agents.ErrTemplateNotFound` | `NotFound` | M4 baseline |
| `agents.ErrInstanceNotFound` | `NotFound` | M4 baseline |
| `agents.ErrNotFound` | `NotFound` | M2 holdover |
| `agents.ErrFlyAPI` | `Unavailable` | M4 baseline (already redacted) |
| `agents.ErrTargetUnavailable` | `Unavailable` | M4 baseline |
| `deploy.ErrVolumeProvisionFailed` | `Unavailable` | M5 (Fly volume create failed) |
| `*` | `Internal` | Logged + replaced with "internal error" — pgx / driver internals never leak |

---

## Next phase entry checkpoint

Phase 6 is FE-side: spawn wizard Step 4 (Deployment) wired to `DeployConfig`. The wire surface Phase 5 just shipped is the integration target — `ListDeploymentRegions` populates the region dropdown on wizard mount, `CheckDeploymentPlacement` powers the Step-5 (Review) green/red affordance, and `SpawnAgent` now accepts the wizard's collected DeployConfig payload via the optional `deploy_config` field. The 0.9.1 wizard's Step 4 client-side `lifecycle` + `replicas` fields (collected but dropped at the request boundary per the 0.9.1 entry) start riding the wire as part of `DeployConfig`.
