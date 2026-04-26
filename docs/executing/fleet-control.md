# Plan — M5: Fleet control (fine-grained deployment surface)

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/plans/v1.5-roadmap.md` (parent; this plan supersedes the roadmap's "Memory → Tools → Skills" sequencing — fleet control becomes the first v1.5 milestone, with Skills next)
- `docs/executing/spawn-flow.md` (M4; this plan extends the same `agent_instances` table and the same `internal/deploy.DeployTarget` interface that M4 introduced)
- `docs/executing/deploy-target-credentials.md` (the v1.5 credentials evolution that M5 *should not* block on but *will* eventually couple with — region availability and GPU gating are token-scoped)
- `docs/blueprint.md` §3.3 (declared minimum resource footprint — M5 promotes this from "minimum" to "configurable per-instance"), §8 (Fly deployment topology — **M5 explicitly retires the "one app = one machine" invariant**; see decision 1), §11.1 (no Fly-specific code outside `FlyDeployTarget` — M5 is the rule's largest single test), §11.4 (deferred features stub as real interfaces — applies to lifecycle modes we don't ship in v1.5)
- `docs/stack.md` §3 (Connect-go contract), §11.9 (handlers <30 LOC)
- `docs/changelog.md` §0.7.0 (M4's `agent_instances` schema, the `DeployTarget` interface shape M5 widens, the `pollHealth` pattern M5 generalizes), §0.7.5 (the `Transactor` pattern — M5's deploy-config-edit path uses the same shape)
- **Fly-go reference: `github.com/superfly/fly-go@v0.5.0`** — verified field paths in Decisions table; `flaps/flaps_machines.go` (Launch/Update/Start/Stop/Suspend/List/Lease), `flaps/flaps_platform.go` (GetRegions/GetPlacements), `machine_types.go` (MachineGuest/MachineRestart/MachineService/MachinePresets), `flaps/flaps_volumes.go` (intentionally not consumed in M5; see decision 8)

---

## 1. Objective

Promote Corellia from "spawn-with-defaults" to a **control plane for deployed agents**. The user-visible loop is:

> Sign in → click **Deploy** on the Hermes card → modal now collects deployment config (region, machine size, replica count, restart policy, lifecycle mode) alongside the existing model fields → submit → backend creates the Fly app and N machines per the requested config → fleet page shows aggregate status with a per-agent **Deployment** inspector → admin edits region / size / replica count / lifecycle on a running agent → backend reconciles via `flaps.Update` (live where possible) or "destroy + respawn" (where Fly's API forbids in-place change) → admin starts / stops a machine on demand from the fleet row → bulk-apply lets the admin push a deployment-config delta across N selected agents in one click.

When this lands, an admin can answer all of the following from the UI alone, without `flyctl` or a shell:

- *Where* is each agent running? (region per agent, primary-region default per org)
- *How big* is it? (CPU kind + count + memory)
- *How many* of it are there? (replica count)
- *When* does it run? (always-on vs manual)
- *What* happens when it crashes? (restart policy + max retries)

### What M5 delivers concretely

1. **One migration** — `*_fleet_control.sql` — adds eight columns to `agent_instances` (region, cpu_kind, cpus, memory_mb, restart_policy, restart_max_retries, lifecycle_mode, desired_replicas). Existing rows get sensible defaults via `DEFAULT` clauses; no data backfill needed because M4's existing rows are all single-machine `iad`-default `shared-cpu-1x` 512MB.
2. **`internal/deploy.DeployTarget` interface widened** — six new methods: `ListRegions`, `CheckPlacement`, `Update`, `Start`, `Suspend`, `ListMachines`. Old methods (`Spawn`, `Stop`, `Destroy`, `Health`) gain a typed `DeployConfig` param or new return shape (see decisions).
3. **`internal/deploy.FlyDeployTarget` implementation** — wraps `flaps.GetRegions`, `flaps.GetPlacements`, `flaps.Update`, `flaps.Start`, `flaps.Suspend`, `flaps.AcquireLease` + multi-machine list semantics. Stubs (`AWSDeployTarget`, `LocalDeployTarget`) gain `NotImplemented` impls of the six new methods (per blueprint §11.4).
4. **`internal/agents.Service` extended** — five new methods: `UpdateDeployConfig`, `StartInstance`, `StopInstance` (M4 had this; semantics revised), `ResizeReplicas`, `BulkUpdateDeployConfig`. The existing `Spawn` / `SpawnN` accept a typed `DeployConfig` arg.
5. **Eight new RPCs** — `ListDeploymentRegions`, `CheckDeploymentPlacement`, `UpdateAgentDeployConfig`, `StartAgentInstance`, `ResizeAgentReplicas`, `BulkUpdateAgentDeployConfig`, plus widened request shapes on `SpawnAgent` / `SpawnNAgents`.
6. **Frontend deploy modal** — gains a **"Deployment"** step (region, size preset, replica count, restart policy, lifecycle mode) between the existing "Model" step and submit. Region dropdown is populated from `ListDeploymentRegions` (cached client-side per session). A **"Review"** screen shows the resolved Fly machine config + estimated monthly cost before submit.
7. **Frontend fleet page** — each row gains a **Deployment** inspector (slide-over panel) showing current config + edit form. Per-row **Start** button when the agent has any stopped machine. Per-row **Replicas** column.
8. **Bulk fleet ops** — multi-select checkbox on each row + a sticky toolbar that opens a "Bulk apply" form (subset of the deployment config). Demo moment: select 5 agents, set lifecycle = manual + size = `shared-cpu-2x`, apply, watch all 5 reconcile.
9. **Drift surfacing** — fleet page renders a banner per-row when `desired_replicas ≠ actual_machine_count` (from `flaps.List`) or when any machine's actual `Guest` differs from `agent_instances`'s desired columns (someone used `flyctl` directly).

### What M5 does *not* deliver (deferred, scoped explicitly)

- **Multi-region replicas.** v1.5: all replicas of an agent live in its primary region. Cross-region fan-out is M6 work; the schema doesn't preclude it (a future `agent_machines` table can carry per-replica region overrides).
- **Volumes / persistent storage.** Blueprint §8 says agents are "stateless or offloaded to memory provider." `flaps/flaps_volumes.go` is not consumed in M5. Volume-backed agents are a separate milestone gated on the memory-binding pillar landing first (per `v1.5-roadmap.md` §3, deferred).
- **GPU machines** (`a100-40gb`, `l40s`, `a10`). Fly gates these by org approval; surfacing them in the size dropdown for orgs not enrolled creates a dead path. M5 hides GPU presets entirely; the size dropdown shows shared + performance presets only. GPU support lands when Corellia's first GPU-required harness lands.
- **`auto_stop_machines` / `auto_start_machines` / suspend** — Fly hosts these on `MachineService`, and Corellia's agents declare no service (decision 4 below). The "lifecycle" knob in v1.5 is `always-on | manual` only; `idle-on-demand` (Fly-proxy-driven auto-stop) and `suspended` arrive when Corellia ships a network-exposure model (mTLS / Tailscale / agent gateway) — not before. The DB column `lifecycle_mode` carries an enum that includes the future values but only `always-on | manual` are accepted by the API in v1.5.
- **Health-check tuning.** M4's `pollHealth` 90s budget + 2s tick remains fixed. Per-agent override is a v2 polish.
- **Scheduled lifecycle** ("run this agent business-hours-only"). v2.
- **Live pricing API.** Fly publishes no programmatic pricing endpoint. M5 hardcodes a per-region rate card in `frontend/src/lib/fly-pricing.ts` and links out to https://fly.io/docs/about/pricing/ for live rates. Refresh cadence: manual, on operator review.
- **Per-machine inspector** (drilling into one of N replicas). M5's inspector is per-`agent_instance` (the logical agent); aggregate replica state is shown but per-machine drill-in is M6.
- **Drift auto-reconciliation.** M5 surfaces drift; resolving it ("press button to make Fly match the DB") is M6. Today the admin resolves drift by re-submitting the deploy config edit form.
- **Multi-tenant org isolation enhancements.** Same Pattern A as M4 — all queries filter by `org_id` from `AuthClaims`, no RLS.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | **Retire blueprint §8's "one app = one machine" invariant** | `agent_instance` becomes "one Fly app, N machines" (`desired_replicas` int default 1). The `corellia-agent-<uuid>` Fly app is still the agent's identity (secret isolation preserved per blueprint §8 rationale). M5 ships a **blueprint §8 rewrite** as part of pre-work | Replicas are the most-asked fleet-control feature. Fly's API natively supports N-machines-per-app via repeated `flaps.Launch`. The §8 invariant was a v1 simplification, not a load-bearing constraint — the secret-isolation rationale (the original *why*) survives intact under the new "one app = one logical agent" rule. The §11.5 governance argument for one-app-per-agent (clean destroy) also survives |
| 2 | **No `agent_machines` materialized table in v1.5** | `agent_instances.desired_replicas` is the only DB-tracked replica fact. Actual per-machine state is read from `flaps.List` on demand (fleet page render, `Health` poll). Drift = (`desired_replicas ≠ len(flaps.List)`) | Materializing per-machine state introduces a sync loop and a source-of-truth dispute (DB vs Fly). v1.5 keeps Fly as the source of truth for *machine identity and state* and Corellia as the source of truth for *desired config*. Fleet page cost: one `flaps.List` per agent per render — at 50 agents and 3s polling that's ~17 RPS, well under Fly's per-org budget. v2 problem if it matters |
| 3 | **Lifecycle modes in v1.5: `always-on \| manual` only** | `agent_instances.lifecycle_mode` enum in DB allows `('always-on','manual','idle-on-demand','suspended')` but the API rejects the latter two with `ErrLifecycleUnsupported`. Default for new spawns: `always-on` (matches today's behavior — agents run until manually stopped) | Fly's auto-stop / suspend require a `MachineService` declaration, and Corellia's agents have no public service today (network-isolated; `pollHealth` reads `machine.State` via `flaps.List`, not via HTTP). Declaring a service to enable auto-stop opens the agent's HTTP surface to the Fly proxy — a security boundary change that warrants its own milestone. The DB enum is forwards-compatible; the API surface is the constraint |
| 4 | **No `MachineService` declaration on agent machines in M5** | `flaps.Launch` continues to omit `Services`. Lifecycle is Corellia-orchestrated via `flaps.Start` / `flaps.Stop` (and `Suspend` in the future). `MinMachinesRunning` is enforced by Corellia's reconciler comparing `desired_replicas` to `flaps.List` results, not by Fly's proxy | Same security argument as #3. Two consequences: (a) lifecycle reconciliation is Corellia code, not Fly platform behavior — `internal/agents.Service.reconcileReplicas` runs on every `Health` poll cycle; (b) auto-restart on crash is `MachineRestart.Policy = "on-failure"` (Fly machine-level, not Fly-proxy-level), which is honored without a service |
| 5 | **`DeployConfig` is a typed Go struct, not a `JSONB` blob** | `internal/deploy.DeployConfig` struct: `Region string; CPUKind string; CPUs int; MemoryMB int; RestartPolicy string; RestartMaxRetries int; LifecycleMode string; DesiredReplicas int`. Validation lives on the struct (`Validate() error`). `agent_instances` columns are typed primitives, not a single `deploy_config JSONB` | Typed columns get DB-level CHECK constraints, are queryable for fleet-wide stats ("how many agents in `iad`?"), and surface in `pgx`/`sqlc` without JSON unmarshalling per row. The cost — one migration adds 8 columns instead of one JSONB — is paid once. The flexibility argument for JSONB only matters if the field set churns; the eight fields here are stable |
| 6 | **Region change requires destroy + respawn; size / restart / lifecycle are live-updatable** | `internal/deploy.DeployTarget.Update(ctx, ref, delta) (kind UpdateKind, err)` returns `LiveApplied \| RequiresRespawn` — Corellia's caller decides whether to respawn or just update. The FE edit form gates region behind a "this will destroy and recreate the agent" confirmation; size / restart / lifecycle apply silently with a "machine restarting" toast | Per Fly docs: a machine is region-pinned at create. `flaps.Update` accepts size / restart / image deltas (causes a stop→reconfigure→start, ~5s). Replica count changes are add/remove via `Launch` / `Destroy(machineID)`, never `Update`. The `UpdateKind` return surface is the architectural seam that lets the FE preview the impact before submit |
| 7 | **Replica resize is "Corellia-side reconciliation," not a single Fly call** | `agents.Service.ResizeReplicas(ctx, instanceID, desired)` updates the DB column then calls `flaps.List` to count actual; on `desired > actual`, calls `flaps.Launch` (desired - actual) times with the parent's `DeployConfig`; on `desired < actual`, calls `flaps.Destroy(machineID)` on the (actual - desired) most-recently-created machines. Reconciliation runs in a goroutine with detached `context.Background()` (M4's `pollHealth` pattern) | Fly has no first-class "resize app" RPC — it's a Corellia-orchestrated loop. Detached context per M4 decision 19's rationale (RPC returns immediately, convergence in background). Picking the *most recently created* to remove (LIFO) is conservative — older machines have more accumulated state (logs, etc.) and are likelier to be the "settled" ones |
| 8 | **No volumes in M5** | `internal/deploy.DeployTarget` does NOT gain volume methods. The `MachineMount` field on `LaunchMachineInput` is left empty. M5's `agent_instances` schema does NOT add volume columns | Volumes introduce region-pinning (volume + machine must co-locate), extend-but-not-shrink semantics, and snapshot-lifecycle decisions that don't fit M5's "compute knobs" framing. Stateful agents are gated on the memory-binding pillar (`v1.5-roadmap.md` §3) which is itself deferred. M6 candidate |
| 9 | **Region list is server-cached, not per-request** | `FlyDeployTarget.ListRegions(ctx)` calls `flaps.GetRegions` once at boot and refreshes hourly in a background goroutine (mirrors `internal/auth/`'s JWKS cache shape). The `ListDeploymentRegions` RPC reads the cache; no flaps round-trip per FE page load | 35-region list changes ~yearly. Per-request flaps proxying would add 100ms to every `/agents` page load and consume per-org rate budget. Hourly refresh is fresh enough; the cache is a 1KB struct; the refresh failure mode is "serve stale" with a `slog.Warn`. Same shape as M4's JWKS cache, same ops familiarity |
| 10 | **Capability gating uses `flaps.GetPlacements` as a pre-flight, not as a UI source** | The deploy modal's region dropdown shows all non-deprecated regions. On submit, the BE calls `flaps.GetPlacements({Guest, Region, Count, Org})` to validate the (size + region + count + org) tuple before `flaps.Launch`. On placement failure, surface `ErrPlacementUnavailable` with a structured detail (which axis failed) | `GetPlacements` is the closest thing Fly has to capability discovery (per token + org + size). Gating the dropdown on it would mean N region-checks per page load. Pre-flighting on submit is the right balance: zero render overhead, structured error before we orphan a Fly app. The "which axis failed" detail comes from parsing `flaps.GetPlacements`'s `RegionPlacement` array (regions with `Count: 0` are the ones that can't fit) |
| 11 | **Edit-config flow is two-step: preview → confirm** | `UpdateAgentDeployConfig` accepts `dry_run bool`. `dry_run=true` returns `UpdateKind` (live vs respawn) + `EstimatedDowntime` + `EstimatedMonthlyCostDelta`. FE renders the preview; user confirms; FE re-submits with `dry_run=false`. Same pattern as Terraform plan/apply | Region changes are destructive; size changes cause a brief restart; lifecycle changes are live but materially affect billing. Showing the impact before commit is the difference between "control plane" and "config UI." `dry_run` lives at the RPC layer (single endpoint, two modes) per MCP-style precedent — separate `*Preview` RPCs would double the surface area |
| 12 | **Bulk apply is a fan-out of single-update RPCs, not a transactional batch** | `BulkUpdateAgentDeployConfig` takes `(instance_ids []uuid, delta DeployConfigDelta)` and calls `UpdateDeployConfig` for each via `errgroup` + `semaphore.NewWeighted(3)`. Returns per-instance results (success / per-instance error). **Not** atomic across instances — partial success is a real outcome | "Apply to 50 agents transactionally" requires either a 2PC across Fly's API (which doesn't exist) or holding a lock that prevents per-agent edits during the batch (UX-hostile). Per-instance results give the FE the data it needs to render "47 of 50 succeeded; 3 are in `iad-only` regions and rejected the size delta." Concurrency 3 mirrors M4's `SpawnN` semaphore and Fly's per-org rate friendliness |
| 13 | **Drift surfacing is read-only in v1.5** | The fleet page computes drift on render: for each agent, compare `agent_instances` columns (desired) to `flaps.List` results (actual) for each `Guest` field + machine count. Drift renders as a yellow banner per row with the diff. **No "reconcile" button** | Auto-reconciliation can do unexpected things (someone might have manually scaled up to handle a load spike; one click and Corellia tears it back down). M5 makes drift visible; the admin's existing "Edit deployment" form is the resolution path (re-submitting the desired config triggers reconciliation). M6 candidate for one-click |
| 14 | **`Health` aggregate semantics across replicas** | `Health(ref)` returns one of: `HealthStarted` (≥1 machine `started`), `HealthStarting` (≥1 machine `starting`/`created`, none `started`), `HealthStopped` (all machines `stopped`), `HealthFailed` (any machine in `failed` / unmappable state), `HealthDrifted` (`actual_count ≠ desired_replicas`). The current `len(machines) > 1` error path at `fly.go:184` is removed | Aggregating to a single status keeps M4's `pollHealth` loop intact (no per-machine state-machine in `agents.Service`). "Any machine started → agent up" matches the load-balanced reality (with N replicas, the agent serves traffic the moment one machine is up). New `HealthDrifted` is the surface for decision 13 |
| 15 | **Pricing displayed in the FE; never persisted; never the source of authorization** | `frontend/src/lib/fly-pricing.ts` ships a hardcoded rate card (per region, per preset, per-second rate). FE computes `desiredReplicas × hoursPerMonth × rate` in JS at render. No BE involvement. No DB column for cost | Pricing is a UX nicety (helps the admin make informed choices), not a constraint. Persisting it would require a refresh job. The number is a hint; Fly's invoice is authoritative. Refresh cadence: PR'd manually when Fly publishes new rates |
| 16 | **`MachineGuest.SetSize` for preset resolution** | The deploy modal's "size" dropdown shows preset names (`shared-cpu-1x` etc.); the BE resolves to `(CPUKind, CPUs, MemoryMB)` via `MachineGuest.SetSize(name)` (fly-go helper at `machine_types.go`); the resolved tuple is what's persisted to `agent_instances`. The preset *name* is not stored | Storing the resolved tuple keeps the column types primitive (decision 5) and decouples Corellia from fly-go's preset naming if Fly ever renames. The cost: editing back to a preset later requires a reverse lookup, which is a small helper (~10 LOC) |
| 17 | **Region-list cache lives in `internal/deploy/` not `internal/agents/`** | `FlyDeployTarget` owns the cache. The interface method is `ListRegions(ctx) ([]Region, error)`. `agents.Service` calls through. `Region` is a Corellia-defined struct (Code, Name, Deprecated, RequiresPaidPlan), not `fly.Region` — keeps blueprint §11.1 intact | `fly.Region` leaking out of `internal/deploy/` would re-export Fly's type into domain code. The Corellia struct is a 4-field projection. Same pattern as M3.5's `Resolver` not exporting `flaps.Client` |
| 18 | **`flaps.AcquireLease` for every Update / Destroy / Start / Stop** | Every mutating call on a specific machine (`Update`, `Destroy`, `Start`, `Stop`, `Suspend`) acquires a lease first and passes the nonce. Lease TTL: 30s (Fly default). Lease release in `defer`. Failure to acquire → `ErrMachineBusy` → mapped to `Aborted` Connect code | Without a lease, concurrent Corellia operations (e.g. UI edit during a poll-driven reconciliation) can race against Fly's machine state. Leases are Fly's documented concurrency control. The 30s TTL accommodates the slowest single-machine op (Update with image change ~10s). `ErrMachineBusy` → `Aborted` matches Connect's semantic ("transient; retryable") |
| 19 | **Update is `flaps.Get → mutate → flaps.Update`, not partial** | Fly's API requires the full `MachineConfig` on every Update (per Machines API docs — no PATCH semantics). `FlyDeployTarget.Update` reads the current config, applies the delta, writes back. The Corellia-side `DeployConfig` is the source of truth for the Corellia-managed fields (size, restart); fields Corellia doesn't manage (image, env) are passed through unchanged | This is just matching Fly's API shape. The implementation hazard is "we read at T1, Fly mutates at T2, we write at T3 and clobber T2's change" — the lease (decision 18) prevents this. The pattern is well-trodden in `flyctl`'s own update path |
| 20 | **Validation lives on `DeployConfig.Validate()`, not in `agents.Service`** | `internal/deploy.DeployConfig.Validate()` checks: region in cached list; cpu_kind in `("shared","performance")`; (cpu_kind, cpus, memory_mb) within preset bounds (256MB/CPU shared, 2048MB/CPU performance, multiple of 256); restart_policy in `("no","always","on-failure")`; max_retries ≥ 0; lifecycle_mode in `("always-on","manual")`; desired_replicas in `[1, 10]`. Returns wrapped sentinels (`ErrInvalidRegion`, `ErrInvalidSize`, etc.) | Validation belongs with the type that defines the field set. `agents.Service` calls `cfg.Validate()` and maps the sentinel to its own error sentinel for the Connect handler. Replicas cap of 10 mirrors M4's `SpawnN` cap (decision 14 of M4); higher cap is a separate authorization decision |
| 21 | **`SpawnN`'s `count` and `desired_replicas` are different concepts** | `SpawnN(count=5)` creates 5 *separate agents* (5 Fly apps, 5 DB rows), each with `desired_replicas=1` by default. `desired_replicas=5` on a single agent means 1 Fly app, 5 machines, 1 DB row. The deploy modal UI distinguishes these via two separate sections: "Number of agents" (top of the form) and "Replicas per agent" (in the Deployment step) | Conflating these would lose the semantic difference between "five sales agents, one per region" and "one sales agent, five replicas for capacity." Keeping them separate keeps the demo-moment intact ("Deploy 5") while adding the capacity dimension |
| 22 | **Bulk apply UI: row checkboxes + sticky bottom toolbar** | Each fleet row gets a leading checkbox column. A sticky toolbar appears when ≥1 row is selected: "N agents selected | [Apply config…] [Clear]". "Apply config" opens the same edit form as the per-row inspector but submits via `BulkUpdateAgentDeployConfig`. The form's preview step shows per-instance UpdateKind (which will respawn vs which apply live) | Standard data-grid bulk-action pattern. Per-instance preview is non-negotiable — applying "region: lhr" to 50 agents could mean 50 destroy-and-respawns, and the admin must see that before clicking go |
| 23 | **Lease nonces: stored in request-scoped context, never persisted** | `flaps.AcquireLease` returns a nonce; it's held in a local var inside the operation function and released on defer. Never written to DB. If the BE crashes mid-op, the lease expires after its 30s TTL on Fly's side — no Corellia-side cleanup needed | Lease state is ephemeral; persisting it would require a "stale-lease sweep" job. TTL-based expiry is Fly's design intent. Same logic as why we don't persist Connect request IDs |
| 24 | **`/healthz` of the control plane reports flaps reachability** | The control plane's existing `/healthz` endpoint (M3.9) gains a degraded mode: returns `200` always but body includes `flaps_status: ok|degraded|down`. Degraded if `flaps.GetRegions` cache age >2h; down if last refresh failed. Surface this in the FE as an unintrusive footer pill | Operator visibility for the case "Fly is down, every spawn is failing, why?" The 200-always semantics keep Fly's own health probe (per M3.9 fly.toml) from cycling our control plane. Same pattern as how AWS surfaces `service_status` in console headers |
| 25 | **Connect error mapping for fleet ops** | New sentinels: `agents.ErrInvalidRegion`, `agents.ErrInvalidSize`, `agents.ErrPlacementUnavailable`, `agents.ErrLifecycleUnsupported`, `agents.ErrMachineBusy`, `agents.ErrReplicaCap`, `agents.ErrDriftBlock`. Mapped via the existing `agentsErrToConnect` switch (extended): the four `Invalid*` → `InvalidArgument`, `PlacementUnavailable` → `FailedPrecondition`, `LifecycleUnsupported` → `Unimplemented`, `MachineBusy` → `Aborted`, `ReplicaCap` → `FailedPrecondition`, `DriftBlock` → `FailedPrecondition` | Sentinel-per-failure-axis lets the FE render specific copy. `Unimplemented` for `LifecycleUnsupported` is correct — it's a "we declared the field but don't implement that value yet" case (decision 3); semantically distinct from invalid input |
| 26 | **No proto streaming for fleet polling** | Fleet page polling continues to be `ListAgentInstances` on a 3s interval (M4's pattern). M5 does NOT introduce server-streaming for "live machine state" | Streaming was deferred in M4 for cost reasons; nothing in M5 makes that calculus different. The 3s polling cost goes up with N agents (decision 2's flaps.List per agent) but stays well under Fly's per-org budget for v1.5 scale |
| 27 | **The pre-flight `CheckDeploymentPlacement` RPC is exposed for use by the FE during preview, not just submit** | The deploy modal's "Review" step calls `CheckDeploymentPlacement(region, size, replicas)` and renders a green "✓ Placement available" or red "✗ Region cannot fit this size" before the user clicks Submit. Single endpoint, two callers (FE preview, BE submit pre-flight) | Pre-flight UX prevents the embarrassing "you fill out the form, click submit, get a Fly error" path. The endpoint is the same code path both times; FE just calls it earlier |
| 28 | **Bulk apply has a hard cap of 50 instances per call** | `BulkUpdateAgentDeployConfig` with len(instance_ids) > 50 returns `InvalidArgument`. The FE allows multi-select beyond 50 visually but disables the toolbar with a "select 50 or fewer" tooltip | Above 50 the user is probably automating, in which case scripted RPC calls are the right tool, not the UI. Cap also bounds the BE's goroutine fan-out worst-case (50 / 3 concurrent = ~17 sequential batches at 5s/op = ~90s total — within reasonable request budget) |

### Decisions deferred (revisit when named caller arrives)

- **One-click drift reconciliation.** M5 surfaces drift; clicking to fix it is M6.
- **Per-machine inspector.** Drilling into one of N replicas to see its specific state / restart it. M5's inspector is per-agent; per-machine is M6.
- **Multi-region replicas.** Schema doesn't preclude; M5 ships single-region-per-agent.
- **Volumes / persistent storage.** Gated on memory-binding pillar; v2 candidate.
- **Auto-stop / suspend lifecycle.** Gated on the network-exposure model decision (mTLS / Tailscale / agent gateway).
- **GPU presets.** Gated on first GPU-required harness.
- **Health-check tuning** (interval, timeout, grace per agent). M4's defaults remain.
- **Live pricing API integration.** Hardcoded JSON in v1.5; fetch-on-build in v2 if Fly ships an endpoint.
- **`Containers` (multi-process per machine).** Org-gated by Fly; M5 doesn't model. The `internal/deploy.DeployConfig` struct is shaped so adding a `Containers` field later is additive.

### Follow-up plans (to be written after this lands)

- **`docs/plans/v1.5-skills-library.md`** — the skills pillar from the (revised) v1.5 roadmap. Builds on M5's bulk-apply pattern (skills are bulk-equippable across a fleet).
- **`docs/plans/v1.5-deploy-target-credentials.md`** — implements the per-user-deploy-target work that `docs/executing/deploy-target-credentials.md` (forthcoming) frames. Couples with M5's region capability gating once user-supplied tokens are in scope.

---

## 3. Pre-work checklist

Run before Phase 1 starts.

1. **Blueprint §8 rewrite.** Edit the section to read "one AgentInstance = one Fly app, with N machines for replicas." Preserve the secret-isolation rationale; rewrite the "one machine" part. Add a note: "M5 retired the `len(machines) > 1` invariant in `Health()`."
2. **Blueprint §11.1 reaffirm.** Add a sentence: "M5 widens `DeployTarget` with capability-discovery and update methods. Every new method maintains the rule — only `FlyDeployTarget` imports `fly-go` / `flaps`."
3. **CLAUDE.md update.** Reflect the new `agent_instances` columns in the data model section (one-line addition to the §2 schema overview).
4. **Verify fly-go version.** `cd backend && go list -m github.com/superfly/fly-go` should show `v0.5.0` or later. If older, `go get -u github.com/superfly/fly-go@latest` and `go mod tidy` before Phase 3.
5. **Verify Fly token scope** allows `flaps.GetRegions` and `flaps.GetPlacements` against `personal` org (the operator's current setup). One-shot test: `curl -H "Authorization: Bearer $FLY_API_TOKEN" https://api.machines.dev/v1/platform/regions | jq '.Regions | length'`. Expected: ~22 non-deprecated regions.
6. **Snapshot the current `agent_instances` row count + columns** to a one-off `pre_m5_snapshot.sql` for migration sanity-checking. Currently expected: small (operator's dev account) and all rows have `iad`-default machines.

---

## 4. Phasing

Vertical-slice phases, each strictly prerequisite for the next. Each phase ends with a green `go vet ./... && go test ./...` and (where applicable) a green `pnpm -C frontend type-check && lint && build`.

### Phase 1 — Schema migration + sqlc

**Goal:** Add 8 columns to `agent_instances`. Sqlc-regenerate. No code consumes the new columns yet — pure additive landing.

- New migration `*_fleet_control.sql` with one transaction:
  ```sql
  ALTER TABLE agent_instances
    ADD COLUMN region              TEXT      NOT NULL DEFAULT 'iad',
    ADD COLUMN cpu_kind            TEXT      NOT NULL DEFAULT 'shared'
      CHECK (cpu_kind IN ('shared','performance')),
    ADD COLUMN cpus                INTEGER   NOT NULL DEFAULT 1
      CHECK (cpus BETWEEN 1 AND 16),
    ADD COLUMN memory_mb           INTEGER   NOT NULL DEFAULT 512
      CHECK (memory_mb BETWEEN 256 AND 131072 AND memory_mb % 256 = 0),
    ADD COLUMN restart_policy      TEXT      NOT NULL DEFAULT 'on-failure'
      CHECK (restart_policy IN ('no','always','on-failure')),
    ADD COLUMN restart_max_retries INTEGER   NOT NULL DEFAULT 3
      CHECK (restart_max_retries >= 0),
    ADD COLUMN lifecycle_mode      TEXT      NOT NULL DEFAULT 'always-on'
      CHECK (lifecycle_mode IN ('always-on','manual','idle-on-demand','suspended')),
    ADD COLUMN desired_replicas    INTEGER   NOT NULL DEFAULT 1
      CHECK (desired_replicas BETWEEN 1 AND 10);
  ```
- Down migration: `ALTER TABLE agent_instances DROP COLUMN region, DROP COLUMN cpu_kind, ...` in reverse.
- New sqlc queries in `agent_instances.sql`:
  - `UpdateAgentDeployConfig` — UPDATE all 8 columns by `(id, org_id)`.
  - `UpdateAgentReplicas` — UPDATE only `desired_replicas` by `(id, org_id)`.
  - `BulkUpdateAgentDeployConfig` — UPDATE by `id = ANY($1::uuid[])` with org_id filter.
- `sqlc generate`. Run migration locally. Verify the existing M4 row(s) get the defaults.
- **Phase 1 exit criteria:** migration up + down clean against local DB; `sqlc generate` produces no diff in committed `internal/db/` other than the new methods; `go vet ./... && go build ./...` clean.

### Phase 2 — `internal/deploy.DeployTarget` interface widening (no impls yet)

**Goal:** New interface shape, new types, NotImplemented stubs for AWS/Local. Phase 3 fills `FlyDeployTarget`.

- New `internal/deploy/types.go` (or extend existing): define `DeployConfig`, `Region`, `UpdateKind`, `PlacementResult`, `MachineState` typed structs. None reference `fly.*`.
- Widen `DeployTarget` interface:
  ```go
  type DeployTarget interface {
      Kind() string
      Spawn(ctx, SpawnSpec, DeployConfig) (SpawnResult, error)  // SIG CHANGE
      Update(ctx, ref, DeployConfig) (UpdateKind, error)         // NEW
      Stop(ctx, ref) error                                       // unchanged
      Start(ctx, ref) error                                      // NEW
      Destroy(ctx, ref) error                                    // unchanged
      Health(ctx, ref) (HealthStatus, error)                     // semantics revised
      ListRegions(ctx) ([]Region, error)                         // NEW
      CheckPlacement(ctx, DeployConfig) (PlacementResult, error) // NEW
      ListMachines(ctx, ref) ([]MachineState, error)             // NEW
  }
  ```
- New sentinels in `internal/deploy/errors.go`: `ErrPlacementUnavailable`, `ErrMachineBusy`, `ErrLifecycleUnsupported`, `ErrInvalidRegion`, `ErrInvalidSize`, plus `ErrNotImplemented` (existing or new).
- `DeployConfig.Validate()` per decision 20.
- Update AWS / Local stub impls (per blueprint §11.4): all new methods return `ErrNotImplemented`.
- The existing `Spawn(ctx, SpawnSpec)` signature in `FlyDeployTarget` is widened to take `DeployConfig`. Temporary: `FlyDeployTarget.Spawn` accepts the new arg and ignores the new fields (uses M4 defaults). Phase 3 wires them.
- Existing `agents.Service.Spawn` callers pass a zero-value `DeployConfig{}` until Phase 4 wires real values; `Validate()` accepts the zero value as "use defaults" (Region="" → server defaults, replicas=0 → 1, etc.).
- **Phase 2 exit criteria:** interface compiles, fakes in test files updated with no-op impls, `go vet ./... && go test ./internal/deploy ./internal/agents` clean.

### Phase 3 — `FlyDeployTarget` implements the widened surface

**Goal:** Real Fly-API-backed implementations of the six new methods. Region cache wired. Lease-aware update path.

- **`ListRegions`** — adds a `regionCache` field on `FlyDeployTarget`: `mu sync.RWMutex`, `regions []Region`, `lastFetch time.Time`. `NewFlyDeployTarget` starts a background goroutine doing `time.NewTicker(1 * time.Hour)` calling `flaps.GetRegions`. On boot, one synchronous fetch attempt (panic on failure: blueprint §11.1 spirit — fail-fast on infrastructure misconfig). Filter out `Deprecated=true` regions.
- **`CheckPlacement`** — wraps `flaps.GetPlacements({Compute: <built from DeployConfig>, Region: cfg.Region, Count: cfg.DesiredReplicas, Org: f.orgSlug})`. Returns `PlacementResult{Available bool, Reason string, AlternateRegions []string}`. The "alternate regions" come from `GetPlacements` returning all regions (when called without `Region` filter) — useful for the "your region is full; try X" UX.
- **`Spawn` (revised)** — translates `DeployConfig` to `MachineGuest` via `MachineGuest.SetSize(presetName)` if a preset is identifiable, else direct field set. Loops `cfg.DesiredReplicas` times calling `flaps.Launch` (preserves M4's per-app rollback `defer`). Returns `SpawnResult{ExternalRef, MachineIDs []string}` (NEW: plural).
- **`Update`** — for the (cfg → current) delta:
  1. If `cfg.Region` differs from any current machine's region → return `(RequiresRespawn, nil)` immediately. Don't touch Fly.
  2. Else: `flaps.List` → for each machine, `flaps.AcquireLease(machineID, 30s)` → `flaps.Get(machineID)` → mutate config → `flaps.Update(app, input, leaseNonce)` → `flaps.ReleaseLease(machineID, nonce)` (defer).
  3. Replica count delta: if `cfg.DesiredReplicas > len(machines)` → `flaps.Launch` for the diff; if `<` → `flaps.Destroy(machineID)` for the (LIFO-ordered) diff. Each Destroy acquires its own lease.
  4. Return `(LiveApplied, nil)` on success.
- **`Start`** — `flaps.List` → for each `state == "stopped"` machine, `flaps.AcquireLease` → `flaps.Start(machineID)` → release.
- **`Stop` (revised)** — same pattern but `flaps.Stop`. (M4 already has Stop; revise for lease.)
- **`ListMachines`** — `flaps.List` → project to `[]MachineState{ID, Region, State, Guest, CreatedAt}`. Used by `Health` and the fleet page.
- **`Health` (revised semantics)** per decision 14. Removes the `len(machines) > 1` error path at `fly.go:184`.
- **Tests:** `internal/deploy/fly_test.go` extended with table-driven cases for the six new methods, using a `flapsClientFake` stand-in (define a small interface that `flaps.Client` satisfies; fake implements it). The fake does NOT make network calls. **No live-Fly tests in CI** (decision N/A — but worth restating: CI must not depend on a real token).
- **Phase 3 exit criteria:** `go test ./internal/deploy/...` all green; the existing `cmd/smoke-deploy` (if extended) can spawn a 2-replica agent in `iad` and observe both machines via `ListMachines`.

### Phase 4 — `internal/agents.Service` extended

**Goal:** Domain methods for the new fleet-control operations, sentinel-mapped, transactionally safe.

- **`Spawn` / `SpawnN`** — accept `DeployConfig` arg. Call `cfg.Validate()`. On success: persist all 8 fields to the new columns. The existing transactional `WithSpawnTx` from 0.7.5 wraps the same writes; the deploy-config columns are written inside the same tx as the `agent_instances` insert.
- **`UpdateDeployConfig(ctx, instanceID, cfg, dryRun bool) (*UpdateResult, error)`**:
  1. Load instance by (id, orgID).
  2. `cfg.Validate()`.
  3. Call `deployer.CheckPlacement(ctx, cfg)` — if `!Available`, return `ErrPlacementUnavailable`.
  4. Call `deployer.Update(ctx, ref, cfg)` to get `UpdateKind` (live vs respawn). **If `dryRun`, return `UpdateResult{Kind, EstimatedDowntime, EstimatedMonthlyCostDelta}` without persisting or calling Fly's mutation path** — `CheckPlacement` is read-only, and `Update` itself is gated by `dryRun` flag passed in.
  5. **NB:** `deployer.Update` needs a `dryRun` overload too — easier: split into `deployer.PreviewUpdate(ctx, ref, cfg) UpdateKind` (read-only) and `deployer.Update(ctx, ref, cfg) (UpdateKind, error)` (mutating). Adopt the split; it's the cleaner shape.
  6. On non-dry-run + `RequiresRespawn`: call `Destroy` then `Spawn` with the new config, preserving the `agent_instances.id` (same row, new `deploy_external_ref`). Update DB columns.
  7. On non-dry-run + `LiveApplied`: update DB columns. Spawn a `pollHealth` goroutine to watch convergence.
- **`StartInstance(ctx, instanceID)`** — load instance, call `deployer.Start(ctx, ref)`, set `last_started_at = now()`. Spawn `pollHealth`.
- **`ResizeReplicas(ctx, instanceID, desired)`** — load instance, validate `desired` in `[1, 10]`, update `desired_replicas` column, call `deployer.Update(ctx, ref, currentCfgWithNewReplicas)`. The reconciliation is `deployer.Update`'s job (per Phase 3); `agents.Service` doesn't loop machines itself.
- **`BulkUpdateDeployConfig(ctx, instanceIDs, delta, dryRun)`** — fan-out via `errgroup` + `semaphore.NewWeighted(3)` (M4 pattern). Returns `[]BulkResult{InstanceID, Kind, Error}` — partial success is normal.
- **Drift detection helper** — `agents.Service.DetectDrift(ctx, instanceID) (DriftReport, error)`: compare DB `(region, cpu_kind, cpus, memory_mb, desired_replicas)` against `deployer.ListMachines(ctx, ref)` aggregate. Used by `ListAgentInstances` to populate `drift_summary` on each row.
- **Tests:** extend `internal/agents/service_test.go` with new sub-tests: validation paths, dry-run vs apply, replica resize fan-out, bulk apply partial-failure, drift detection with all-match / size-drift / count-drift cases. Use `fakeDeployTarget` extended with new methods.
- **Phase 4 exit criteria:** all `internal/agents` tests green; sentinel mapping table updated; `cmd/api/main.go` constructor calls still compile (interface widening already absorbed in Phase 2).

### Phase 5 — Proto + handlers

**Goal:** Wire the new RPCs end-to-end. Generated code committed.

- Extend `shared/proto/corellia/v1/agents.proto`:
  - **New messages:** `DeployConfig`, `Region`, `PlacementResult`, `MachineState`, `DriftSummary`, `UpdateResult`, `BulkResult`. `DeployConfig` mirrors the Go struct exactly (decision 5). `// SECRET` comment convention reaffirmed where applicable.
  - **Widened messages:** `SpawnAgentRequest` and `SpawnNAgentsRequest` add an `optional DeployConfig deploy_config = N`. Default behavior on unset: server uses defaults from decision-5 column defaults.
  - **Widened response:** `AgentInstance` gains all 8 deploy-config fields + `drift_summary`. `ListAgentInstancesResponse` unchanged (uses widened `AgentInstance`).
  - **New RPCs:**
    - `ListDeploymentRegions(ListDeploymentRegionsRequest) returns ListDeploymentRegionsResponse`
    - `CheckDeploymentPlacement(CheckDeploymentPlacementRequest{deploy_config}) returns CheckDeploymentPlacementResponse{placement_result}`
    - `UpdateAgentDeployConfig(UpdateAgentDeployConfigRequest{instance_id, deploy_config, dry_run}) returns UpdateAgentDeployConfigResponse{update_result}`
    - `StartAgentInstance(StartAgentInstanceRequest{instance_id}) returns StartAgentInstanceResponse{instance}`
    - `ResizeAgentReplicas(ResizeAgentReplicasRequest{instance_id, desired_replicas}) returns ResizeAgentReplicasResponse{instance}`
    - `BulkUpdateAgentDeployConfig(BulkUpdateAgentDeployConfigRequest{instance_ids, deploy_config_delta, dry_run}) returns BulkUpdateAgentDeployConfigResponse{results}`
- `pnpm proto:generate`; commit both generated trees.
- Extend `internal/httpsrv/agents_handler.go` with six new handlers, each <30 LOC per blueprint §11.9. Sentinel-map all new errors per decision 25.
- Mount new RPCs inside the existing `r.Group(...)` with `auth.Middleware` (M4 decision 34).
- Extend `internal/httpsrv/agents_handler_test.go` with sentinel→Connect-code cases for all new sentinels, plus happy-path tests for at least: `UpdateAgentDeployConfig` dry-run, `BulkUpdateAgentDeployConfig` partial success, `ResizeAgentReplicas` happy path. Pattern matches 0.7.5's existing handler-level test suite.
- **Phase 5 exit criteria:** `pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen` exits 0; `go test ./internal/httpsrv/...` green; the new RPCs callable via `curl` against a local backend.

### Phase 6 — FE: deploy modal "Deployment" step

**Goal:** Spawn flow surfaces the new knobs.

- New step in `frontend/src/components/agents/deploy-modal.tsx` (between current Model and Submit): **Deployment**.
  - **Region** dropdown — populated from `ListDeploymentRegions` on modal open; cached in component state for the modal's lifetime; default to org's primary (TBD: today, hardcoded `iad`; org-level default is post-M5).
  - **Size** dropdown — preset list (`shared-cpu-1x` through `performance-8x`); GPU presets hidden (decision per "Out of scope"). Each option shows `{cpus} vCPU / {memMB}MB`.
  - **Replicas per agent** — number input, 1–10. Default 1. Tooltip: "How many machines to run for this agent. Use >1 for capacity."
  - **Restart policy** — radio: `on-failure (default)` / `always` / `no`. When `on-failure`: show "Max retries" number input (default 3).
  - **Lifecycle** — radio: `always-on (default)` / `manual`. Tooltip on `manual`: "Agent only runs when you start it from the fleet page." Disabled radio for `idle-on-demand` and `suspended` with "Coming when secure agent endpoints ship" tooltip — surfaces the deferred work without faking it (blueprint §11.4 spirit).
- New "Review" step (was previously direct-submit): renders the resolved Fly machine config, calls `CheckDeploymentPlacement` for the green/red affordance, shows estimated monthly cost from `frontend/src/lib/fly-pricing.ts`. Submit button disabled if placement is red.
- Same form on the "Deploy 5" path — applies to all 5 agents identically.
- **Phase 6 exit criteria:** `pnpm -C frontend type-check && lint && build` clean; spawning an agent with a non-default config (e.g. `lhr` + `shared-cpu-2x` + 2 replicas) succeeds against a local backend; the resulting Fly app actually has 2 machines in `lhr` (verifiable via `fly machine list -a <app>`).

### Phase 7 — FE: fleet page deployment inspector + per-row actions

**Goal:** Edit-after-spawn; per-agent visibility into deployment state.

- Each fleet row gains:
  - A **Replicas** column (e.g. "2/2 running" or "1/2 running" with a yellow indicator on mismatch).
  - A **Region** column.
  - A **Size** column (preset name resolved from cpu_kind/cpus/memory_mb via reverse-lookup helper from decision 16).
  - A **Deployment** action button → opens slide-over panel.
  - A **Start** action button (visible when `lifecycle_mode=manual` AND any machine is `stopped`).
- New slide-over panel `frontend/src/components/fleet/deployment-inspector.tsx`:
  - Header: agent name + current status pill.
  - "Current configuration" section: read-only display of all 8 fields.
  - "Edit" button toggles to the same form from Phase 6 (extracted as `<DeploymentConfigForm>`).
  - On submit: calls `UpdateAgentDeployConfig` with `dry_run=true`, renders the preview (UpdateKind + downtime estimate + cost delta), confirm button submits with `dry_run=false`.
  - Drift banner at the top if `drift_summary` shows any mismatch — yellow, with the diff bullets.
- **Phase 7 exit criteria:** type-check + lint + build green; editing a running agent's size from `shared-cpu-1x` to `shared-cpu-2x` results in a brief restart and the fleet row reflecting the new size; editing region triggers the destroy-and-respawn confirmation and on confirm the agent ends up in the new region with a new `deploy_external_ref` but the same `agent_instances.id`.

### Phase 8 — FE: bulk fleet ops

**Goal:** The demo moment.

- Each fleet row gets a leading checkbox column. Header checkbox = select-all-on-page.
- Sticky toolbar appears when ≥1 row is selected: shows count, "Apply config…" button, "Clear" button. Disabled with tooltip when count >50 (decision 28).
- "Apply config" opens a modal with the same `<DeploymentConfigForm>` — but each field has a leading "Don't change" checkbox; only checked-and-modified fields go into the `DeployConfigDelta`. Submit calls `BulkUpdateAgentDeployConfig` with `dry_run=true` first.
- Preview screen renders a per-instance table: instance name, what kind of update (live / respawn / no-change), estimated downtime. Confirm button submits with `dry_run=false`.
- Result screen: per-instance success/failure with per-row error message on failure. Failed rows stay selected so the user can retry after fixing.
- **Phase 8 exit criteria:** type-check + lint + build green; applying "lifecycle = manual" to 5 selected agents flips all 5 to manual mode, surfaces in the per-row badge, and the fleet polling loop continues to converge correctly.

### Phase 9 — Integration smoke

**Goal:** End-to-end exercise against a live Fly account. Identical pattern to M4 Phase 7 (0.7.3).

Test matrix (each is one operator-loop step against the live `personal` Fly org):

1. **Spawn with non-default region.** Deploy `agent-iad-test` in `lhr` size `shared-cpu-1x` replicas=1. Verify Fly app + machine in `lhr`.
2. **Spawn with replicas=2.** Deploy `agent-replica-test` in `iad` size `shared-cpu-1x` replicas=2. Verify Fly app has 2 machines in `iad`. Verify fleet page shows "2/2".
3. **Live size update.** Edit `agent-iad-test` size to `shared-cpu-2x`. Verify `flaps.Update` is called, machine restarts, fleet page reflects new size within polling cycle.
4. **Region update (respawn).** Edit `agent-iad-test` region to `fra`. Verify destroy+respawn confirmation flow; on confirm, old Fly app destroyed, new one created in `fra`, agent_instance.id unchanged, deploy_external_ref changed.
5. **Replica scale-up.** Edit `agent-replica-test` desired_replicas to 3. Verify a new machine launches; fleet shows "3/3".
6. **Replica scale-down.** Edit `agent-replica-test` desired_replicas to 1. Verify 2 machines destroyed (LIFO); fleet shows "1/1".
7. **Lifecycle=manual.** Edit `agent-iad-test` lifecycle to manual; click Stop on the row; machine state goes to `stopped`; click Start; machine state returns to `started`.
8. **Drift surfacing.** Use `flyctl` directly: `fly machine update <id> -a <app> --vm-size shared-cpu-2x` on a 1x agent. Wait for next fleet poll (3s). Verify yellow drift banner appears with "Size: requested shared-cpu-1x, actual shared-cpu-2x".
9. **Bulk apply.** Select 3 agents; apply lifecycle=manual; verify all 3 reflect the change. Apply size=shared-cpu-2x to those 3; verify each gets `flaps.Update` called.
10. **Placement rejection.** Try to spawn in a region known to be at capacity (TBD which region; can simulate by giving an obviously-bad region in a test build). Verify `CheckDeploymentPlacement` returns `Available=false` and the FE blocks submit.

Document outcomes in `docs/changelog.md` per the M4 Phase 7 / 0.7.3 pattern. Surface any real bugs as discrete fixes before declaring Phase 9 done.

### Phase 10 — Cleanup, docs, validation matrix

- Update `docs/blueprint.md` §8 (replicas), §9 (new columns), §11.1 (interface widening reaffirmation).
- Update `docs/stack.md` if any new env var lands (none expected in M5).
- Update `CLAUDE.md` data-model overview.
- Add a changelog entry per the existing convention (`0.X.0 — M5: Fleet Control`). Match the structure of 0.7.0's entry.
- Run the full validation matrix: `cd backend && go vet ./... && go build ./... && go test -count=1 ./...`; `pnpm -C frontend type-check && lint && build`; `pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen`.
- Manual smoke pass: spawn → edit → bulk-apply → destroy round-trip.

---

## 5. Out-of-scope clarifications (anti-scope-creep)

If any of these come up during execution, route to a separate plan; do not absorb into M5.

- **Multi-region replicas** ("3 in `iad`, 2 in `fra`, 1 in `nrt`"). Schema doesn't preclude; M5 ships single-region.
- **Volumes / persistent disks.** Separate milestone, gated on memory pillar.
- **GPU presets in the size dropdown.** Gated on first GPU-required harness.
- **Auto-stop / suspend lifecycle modes.** Gated on agent-network-exposure model.
- **Health-check tuning** per agent. M4 defaults remain.
- **Org-level deploy defaults** ("our org's default region is `lhr`"). Today: hardcoded `iad`. M6 candidate.
- **Per-machine inspector** (drilling into one of N replicas). Aggregate-only in v1.5.
- **One-click drift reconciliation.** Surface only.
- **Pricing API integration.** Hardcoded JSON.
- **Connect server-streaming for fleet state.** Polling continues.
- **Cost limits / budgets** per agent or per org. v2 governance pillar.
- **Scheduled lifecycle** ("business hours only"). v2.
- **`Containers` (multi-process per machine).** Org-gated by Fly; not in M5.
- **User-supplied Fly tokens** per the deploy-target-credentials work. M5 stays on the operator's `personal` org.

---

## 6. Risk register

| # | Risk | Mitigation | Trigger to escalate |
|---|---|---|---|
| 1 | **Fly API rate limits** triggered by N×`flaps.List` per fleet poll | Decision 2 caveat: 50 agents × 3s = 17 RPS, well under documented org budget. If exceeded, pivot to a single `flaps.GetAllMachines` (TBD whether fly-go exposes app-batch endpoint) or extend poll interval | Any 429 from flaps in production logs |
| 2 | **Replica scale-down deletes the wrong machine** (e.g. the only `running` one while keeping a `failed` one) | Phase 3 `Update` orders by `created_at` LIFO and skips `failed` machines preferentially. Add unit test for "scale 3→2 with one failed; failed should be destroyed first." | Operator reports "I scaled down and lost my running machine" |
| 3 | **Region change leaves orphaned Fly app** if Destroy succeeds but Spawn fails | Phase 4 `UpdateDeployConfig` for `RequiresRespawn` wraps the operation in a Corellia-side compensating action: capture old `deploy_external_ref`, attempt Spawn, on Spawn-fail the new respawn is rolled back AND the original is destroyed (per M4's `Spawn` rollback `defer` semantics). On Spawn-success, destroy the old one. | Boot-time sweep finds an `agent_instances` row whose `deploy_external_ref` doesn't exist in Fly |
| 4 | **`flaps.Update` accepts the call but Fly-side change rejected after** (e.g. region inconsistency we didn't catch) | Decision 6's `RequiresRespawn` heuristic catches the obvious case. For subtler cases: `Update` waits for the machine to return to `started` state via `flaps.WaitForState` (Phase 3). On timeout/`failed`, return error; admin sees "edit failed" toast | Drift banner appears immediately after a successful-looking edit |
| 5 | **Bulk apply partial failures cascade UX confusion** | Phase 8's per-instance result table is the primary mitigation. Failed rows stay selected for retry. Document the partial-failure semantics in the form's preview screen | Operator complains "I clicked apply and it said done but only some changed" |
| 6 | **Region cache staleness** if Fly adds/removes a region during the cache TTL | Hourly TTL bounds the staleness; `slog.Warn` on refresh failure. Worst case: a deprecated region remains in the dropdown for ≤1 hour after Fly removes it; a `flaps.Launch` against it would 422 (caught by `CheckPlacement` pre-flight) | Operator reports a region in the dropdown that errors on submit |
| 7 | **Drift detection false positives** if Fly's API returns transient state (e.g. machine in `starting` during poll) | `DetectDrift` only flags drift on stable state — exclude machines in `starting`/`stopping`/`creating` from the actual-vs-desired count. Add unit test | Drift banner flickers on / off during normal operation |
| 8 | **Lease contention** between UI edits and reconciliation goroutines | Decision 18's `ErrMachineBusy` → `Aborted` is the mapped error. FE renders "another operation is in progress; retry in a moment." `pollHealth` doesn't acquire leases (read-only via `flaps.List`). Only mutating ops contend | Operator reports "I clicked update and got 'busy' three times in a row" |
| 9 | **fly-go version drift** between dev and prod | Pre-work checklist item 4 pins the version. CI's existing `go mod verify` catches mismatch. v0.5.0 is the verified baseline | A new `flaps.*` method we wrote against doesn't exist at runtime |
| 10 | **The "select-all" header checkbox creates accidental fleet-wide bulk applies** | Phase 8 caps at 50 (decision 28). Header checkbox is "select all on this page" not "select all in DB" — the row-count badge in the toolbar makes the actual selection size visible. Confirm modal in the preview step adds friction | Operator complains they accidentally bulk-changed more than intended |

---

## 7. Open questions to resolve during execution

These don't block plan approval; they get answered as the corresponding phase is implemented.

1. **Org-level region default** — should the deploy modal's region dropdown default to a per-org setting? M5 punts to hardcoded `iad`; M6 candidate. (Affects Phase 6 default value.)
2. **`flaps.WaitForState` timeout** for the post-Update settle — 30s? 60s? Match M4's `pollHealth` 90s budget? (Affects Phase 3.)
3. **Reverse preset lookup** (CPU+memory tuple → preset name for display) — exact match only, or nearest-fit? Affects Phase 7 fleet row "Size" column.
4. **`MachineConfig.Metadata[fly_process_group]`** — set per replica? Per agent? Empty? Affects how Fly's internal LB sees replicas. (Probably empty for M5 since we don't use Fly's LB; revisit if we add services later.)
5. **Pricing JSON refresh cadence** — set a calendar reminder? Tie to a CI step that fetches Fly's pricing page and diffs? v1.5 picks "manual on operator review."
6. **Skeleton/loading state** for the deployment inspector during the first `dry_run` round-trip — match the `<DeployModal>` submitting state, or own pattern?
7. **Bulk apply's "Don't change" checkboxes** — what does "Don't change" mean for `restart_max_retries` (only relevant when policy=`on-failure`)? Conditional disable, or always-changeable? (Probably: disable when policy field is "Don't change" AND current values vary across selected agents.)
8. **Drift summary granularity** — bullet per drifted field, or one-line summary ("3 fields drifted")? (Affects Phase 7 banner UX.)

---

## 8. Definition of done

M5 is shippable when ALL of the following hold:

- [ ] Migration `*_fleet_control.sql` is applied in dev; up + down are clean.
- [ ] `internal/deploy.DeployTarget` has the six new methods; `FlyDeployTarget` implements them; AWS / Local stubs return `ErrNotImplemented`.
- [ ] Region cache is wired in `FlyDeployTarget` with hourly background refresh.
- [ ] `internal/agents.Service` has `UpdateDeployConfig` (with `dryRun`), `StartInstance`, `ResizeReplicas`, `BulkUpdateDeployConfig`, `DetectDrift`.
- [ ] All eight new RPCs are wired through Connect handlers; `pnpm proto:generate && git diff --exit-code` is clean.
- [ ] Handler-level sentinel mapping tests cover all seven new sentinels per decision 25.
- [ ] Deploy modal has the Deployment step + Review step; spawning with non-default region/size/replicas works end-to-end.
- [ ] Fleet page renders the new columns (Region, Size, Replicas), the deployment inspector slide-over, the per-row Start button (when applicable), and the drift banner (when applicable).
- [ ] Bulk apply UI works for at least 3 agents; per-instance preview + per-instance result render correctly; the 50-cap is enforced.
- [ ] Phase 9 integration smoke matrix: all 10 cases pass against the operator's `personal` Fly org.
- [ ] `cd backend && go vet ./... && go build ./... && go test -count=1 ./...` clean.
- [ ] `pnpm -C frontend type-check && lint && build` clean.
- [ ] Blueprint §8 / §9 / §11.1 updates landed; CLAUDE.md data model section updated.
- [ ] Changelog entry written following the 0.7.0 / M4 entry's structure.
- [ ] No new env vars introduced (verified by diff against `.env.example`).
