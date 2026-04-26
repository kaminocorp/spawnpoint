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
- **Fly-go reference: `github.com/superfly/fly-go@v0.5.0`** — verified field paths in Decisions table; `flaps/flaps_machines.go` (Launch/Update/Start/Stop/Suspend/List/Lease), `flaps/flaps_platform.go` (GetRegions/GetPlacements), `machine_types.go` (MachineGuest/MachineRestart/MachineService/MachinePresets/MachineMount), `flaps/flaps_volumes.go` (CreateVolume/ExtendVolume/GetVolumes/DeleteVolume — consumed in M5 per decision 8)
- **Hermes upstream Dockerfile** (https://github.com/NousResearch/hermes-agent/blob/main/Dockerfile) declares `ENV HERMES_HOME=/opt/data` + `VOLUME [ "/opt/data" ]` — the harness is **not** stateless. M5 mounts a Fly volume at `/opt/data` per machine. Without it, Hermes' FTS5 session search, autonomous skill creation, agent memory, model-selection (`$HERMES_HOME/config.yaml`), and credential caches all evaporate on every machine restart. Today's M4 spawn (`backend/internal/deploy/fly.go:118-130`) launches with no `Mounts` and silently corrupts every persistent Hermes feature; M5 closes this defect as part of fleet control

---

## 1. Objective

Promote Corellia from "spawn-with-defaults" to a **control plane for deployed agents**. The user-visible loop is:

> Sign in → click **Deploy** on the Hermes card → modal now collects deployment config (region, machine size, **volume size**, replica count, restart policy, lifecycle mode) alongside the existing model fields → submit → backend creates the Fly app, **provisions a per-machine volume**, and N machines per the requested config → fleet page shows aggregate status with a per-agent **Deployment** inspector → admin edits region / size / **volume size** / replica count / lifecycle on a running agent → backend reconciles via `flaps.Update` + `flaps.ExtendVolume` (live where possible) or "destroy + respawn" (where Fly's API forbids in-place change) → admin starts / stops a machine on demand from the fleet row → bulk-apply lets the admin push a deployment-config delta across N selected agents in one click.

When this lands, an admin can answer all of the following from the UI alone, without `flyctl` or a shell:

- *Where* is each agent running? (region per agent, primary-region default per org)
- *How big* is it? (CPU kind + count + memory)
- *How much state can it keep?* (volume size in GB)
- *How many* of it are there? (replica count)
- *When* does it run? (always-on vs manual)
- *What* happens when it crashes? (restart policy + max retries)

And — load-bearing for v1's only harness — **Hermes' persistent state survives restart, resize, and crash recovery.**

### What M5 delivers concretely

1. **One migration** — `*_fleet_control.sql` — adds nine columns to `agent_instances` (region, cpu_kind, cpus, memory_mb, restart_policy, restart_max_retries, lifecycle_mode, desired_replicas, **volume_size_gb**) and one new table `agent_volumes` (one row per provisioned Fly volume; per-replica). Existing rows get sensible defaults via `DEFAULT` clauses for the new columns. **Backfill required for M4's existing `agent_instances` rows: provision a 1GB volume for each, attach to the running machine via destroy-and-respawn (state-loss is acceptable; today they have no persistent state because no volume was ever attached).** Documented in pre-work step 7.
2. **`internal/deploy.DeployTarget` interface widened** — eight new methods: `ListRegions`, `CheckPlacement`, `Update`, `Start`, `Suspend`, `ListMachines`, **`EnsureVolume`, `ExtendVolume`**. Old methods (`Spawn`, `Stop`, `Destroy`, `Health`) gain a typed `DeployConfig` param or new return shape (see decisions).
3. **`internal/deploy.FlyDeployTarget` implementation** — wraps `flaps.GetRegions`, `flaps.GetPlacements`, `flaps.Update`, `flaps.Start`, `flaps.Suspend`, `flaps.AcquireLease`, **`flaps.CreateVolume` / `flaps.ExtendVolume` / `flaps.GetVolumes` / `flaps.DeleteVolume`** + multi-machine list semantics. Stubs (`AWSDeployTarget`, `LocalDeployTarget`) gain `NotImplemented` impls of the eight new methods (per blueprint §11.4).
4. **`internal/agents.Service` extended** — six new methods: `UpdateDeployConfig`, `StartInstance`, `StopInstance` (M4 had this; semantics revised), `ResizeReplicas`, `BulkUpdateDeployConfig`, **`ResizeVolume`**. The existing `Spawn` / `SpawnN` accept a typed `DeployConfig` arg and provision a volume per replica before launch.
5. **Nine new RPCs** — `ListDeploymentRegions`, `CheckDeploymentPlacement`, `UpdateAgentDeployConfig`, `StartAgentInstance`, `ResizeAgentReplicas`, `BulkUpdateAgentDeployConfig`, **`ResizeAgentVolume`**, plus widened request shapes on `SpawnAgent` / `SpawnNAgents` (now include `deploy_config.volume_size_gb`).
6. **Frontend deploy modal** — gains a **"Deployment"** step (region, size preset, **volume size**, replica count, restart policy, lifecycle mode) between the existing "Model" step and submit. Region dropdown is populated from `ListDeploymentRegions` (cached client-side per session). A **"Review"** screen shows the resolved Fly machine config + estimated monthly cost (compute + storage) before submit.
7. **Frontend fleet page** — each row gains a **Deployment** inspector (slide-over panel) showing current config + edit form. Per-row **Start** button when the agent has any stopped machine. Per-row **Replicas** column. **Per-row volume-usage hint** (size only in v1.5; actual usage is post-M5).
8. **Bulk fleet ops** — multi-select checkbox on each row + a sticky toolbar that opens a "Bulk apply" form (subset of the deployment config; **volume size NOT bulk-editable in v1.5 — see decision 8.4**). Demo moment: select 5 agents, set lifecycle = manual + size = `shared-cpu-2x`, apply, watch all 5 reconcile.
9. **Drift surfacing** — fleet page renders a banner per-row when `desired_replicas ≠ actual_machine_count` (from `flaps.List`) or when any machine's actual `Guest` differs from `agent_instances`'s desired columns, **or when a machine's attached volume size diverges from `agent_volumes.size_gb`** (someone used `flyctl volumes extend` directly).
10. **Hermes data persistence verified end-to-end** — Phase 9's integration smoke matrix proves that `$HERMES_HOME` survives machine restart, size update, replica resize, and crash recovery (per Hermes upstream's `VOLUME [ "/opt/data" ]` declaration). This is the de-facto correctness-bug fix that M5 carries.

### What M5 does *not* deliver (deferred, scoped explicitly)

- **Multi-region replicas.** v1.5: all replicas of an agent live in its primary region. Cross-region fan-out is M6 work; the schema doesn't preclude it (a future `agent_machines` table can carry per-replica region overrides). **Volume region-pinning reinforces this**: a Fly volume can only attach to a machine in its own region, so multi-region replicas would mean per-region volume provisioning — a separable concern.
- **Volume usage telemetry / autoscaling.** v1.5 surfaces volume *size* (the desired ceiling) but not *actual usage* (how full it is). Fly does not expose used-bytes via the Machines API; it requires reading `df` inside the machine, which means a sidecar or in-harness reporter — out of scope. Auto-extend on threshold (Fly's `MachineMount.ExtendThresholdPercent`) is also deferred; v1.5 ships manual resize via the inspector form.
- **Volume snapshots / backups.** `flaps.CreateVolumeSnapshot` exists and Fly's default snapshot retention is 5 days, but exposing snapshot management to admins is its own UX (list, restore-from, delete). v1.5 leaves Fly's automatic 5-day retention in place and surfaces nothing in the UI. M6 candidate.
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
| 5 | **`DeployConfig` is a typed Go struct, not a `JSONB` blob** | `internal/deploy.DeployConfig` struct: `Region string; CPUKind string; CPUs int; MemoryMB int; RestartPolicy string; RestartMaxRetries int; LifecycleMode string; DesiredReplicas int; VolumeSizeGB int`. Validation lives on the struct (`Validate() error`). `agent_instances` columns are typed primitives, not a single `deploy_config JSONB` | Typed columns get DB-level CHECK constraints, are queryable for fleet-wide stats ("how many agents in `iad`?"), and surface in `pgx`/`sqlc` without JSON unmarshalling per row. The cost — one migration adds 9 columns instead of one JSONB — is paid once. The flexibility argument for JSONB only matters if the field set churns; the nine fields here are stable |
| 6 | **Region change requires destroy + respawn (state-loss); size / restart / lifecycle / volume-extend are live-updatable** | `internal/deploy.DeployTarget.Update(ctx, ref, delta) (kind UpdateKind, err)` returns `LiveApplied \| LiveAppliedWithRestart \| RequiresRespawn` (three values, refining the M5-original two). Volume-extend is `LiveApplied` for small grows, `LiveAppliedWithRestart` for grows that trip Fly's `needsRestart` flag. Region change is `RequiresRespawn` AND **destroys the agent's volume** (region-pinned) — the FE warning escalates from "will destroy and recreate the agent" to **"will destroy and recreate the agent AND wipe its persistent state (memory, skills, conversation history)"**. Size / restart / lifecycle apply with `LiveAppliedWithRestart` (~5s downtime) | Per Fly docs: a machine is region-pinned at create AND a volume is region-pinned to its first attached machine. Region change therefore wipes Hermes state — irrecoverable without a snapshot-restore (deferred). Surfacing this honestly in the FE confirmation prevents accidental data loss. The `UpdateKind` triplet maps cleanly to FE UX: silent (zero-downtime), brief restart toast, and full destructive confirmation modal |
| 7 | **Replica resize is "Corellia-side reconciliation," not a single Fly call** | `agents.Service.ResizeReplicas(ctx, instanceID, desired)` updates the DB column then calls `flaps.List` to count actual; on `desired > actual`, **provisions (desired - actual) new volumes via `flaps.CreateVolume`**, then calls `flaps.Launch` (desired - actual) times mounting each; on `desired < actual`, calls `flaps.Destroy(machineID)` on the (actual - desired) most-recently-created machines **AND `flaps.DeleteVolume` for each removed machine's attached volume**. Reconciliation runs in a goroutine with detached `context.Background()` (M4's `pollHealth` pattern) | Fly has no first-class "resize app" RPC — it's a Corellia-orchestrated loop. Detached context per M4 decision 19's rationale. Picking the *most recently created* to remove (LIFO) is conservative — older machines have more accumulated state and are likelier to be the "settled" ones; **per decision 8.2 their volumes carry distinct state, so LIFO ordering is also "lose the least-trained replica" by default**. Removed-volume cleanup is part of the same goroutine; failure logs `slog.Warn` and surfaces as drift |
| 8 | **Volumes ARE in M5** *(reversed from initial draft)* | `internal/deploy.DeployTarget` gains `EnsureVolume(ctx, ref, region, sizeGB) (volumeID, err)` + `ExtendVolume(ctx, ref, volumeID, newSizeGB) (needsRestart bool, err)`. Spawn provisions one volume per replica before `flaps.Launch`, attaches at `/opt/data` via `MachineMount`. `agent_instances.volume_size_gb` (default 1GB) and a new `agent_volumes` table track Corellia-side state. Per-replica volume = per-replica state divergence (acknowledged trade-off, decision 8.2) | **Hermes is not stateless.** Upstream `Dockerfile` declares `ENV HERMES_HOME=/opt/data` + `VOLUME [ "/opt/data" ]`; the harness writes essential state there (FTS5 sqlite session search, autonomous skills, agent memory, `config.yaml` for model selection). Today's M4 spawn launches with no `Mounts`, silently corrupting all of these on every restart. M5's "live size update" / "region change respawn" / "replica scale-down" / "manual restart" all *increase* the restart cadence — shipping fleet control without volumes would actively make Hermes less usable than M4. Volumes are therefore a correctness-bug fix bundled with the feature, not a separable milestone. Original "no volumes" framing in this doc's first draft was predicated on the false premise that v1's harness is stateless |
| 8.1 | **Default volume size = 1GB; range 1–500GB** | `agent_instances.volume_size_gb INTEGER NOT NULL DEFAULT 1 CHECK (volume_size_gb BETWEEN 1 AND 500)`. Fly's volume default is also 1GB, max 500GB | Hermes' state (sqlite + skills + logs) starts in tens-of-MB; 1GB is comfortable headroom for the demo and small fleets. 500GB matches Fly's per-volume cap. Real production agents may want 10–50GB; the default doesn't penalize them (extend is live for ext4) |
| 8.2 | **One volume per replica; replicas have divergent state** | When `desired_replicas=N`, M5 provisions N volumes (one per machine, region-pinned). Each replica's `$HERMES_HOME` is its own; an agent skill learned by replica-1 is not available to replica-2. The fleet inspector explicitly labels this: "Each replica maintains its own state" | Fly volumes don't multi-attach (it's a hard constraint of their block-storage model). Two architectural alternatives — (a) put state on a shared external store via memory pillar, (b) one machine per agent forever — both deferred. v1.5 accepts replica state divergence as the honest trade-off; the demo for replicas is "capacity for stateless workloads" not "horizontal scale of memoryful agents." Most operators will run replicas=1 for memoryful Hermes; >1 is a power-user move with documented divergence |
| 8.3 | **Volume size is live-extendable; never shrinkable** | `flaps.ExtendVolume` is live (ext4 grows online). The inspector form's "Volume size" field is editable up only; a "decrease" attempt is rejected client-side with a tooltip. `ExtendVolume` returns `needsRestart bool` — when true, M5 surfaces "machine will restart" in the preview step | Fly's API only supports extend; shrink would require migrate-and-recreate, which v1.5 doesn't model. Calling out the asymmetry up-front in the UI is honest design (vs. silently failing at submit). The `needsRestart` signal lets the FE warn appropriately — small extensions are zero-downtime, large extensions or filesystem-resize triggers may cycle the machine |
| 8.4 | **Volume size NOT bulk-editable** | `BulkUpdateAgentDeployConfig`'s `DeployConfigDelta` excludes `volume_size_gb`. Bulk apply is for compute knobs (size, region, lifecycle, replicas) only; per-agent volume sizing is a deliberate per-instance decision | Volumes carry data; bulk-extending across a fleet is rarely the right action and creates surprise cost. The omission is a guardrail, not a missing feature. Power users can script via direct RPC calls if needed |
| 8.5 | **Volume lifecycle on Destroy: cascade-delete** | `agents.Service.Destroy` first calls `flaps.DeleteApp` (M4 behavior; destroys machines + secrets); the `agent_volumes` rows for that instance are then deleted via `flaps.DeleteVolume(volumeID)` per-volume in a goroutine after app-destroy succeeds. Soft-delete on `agent_instances` is preserved (audit trail); `agent_volumes` rows are hard-deleted (no point keeping a row pointing at a non-existent Fly volume) | Fly does not auto-delete volumes when an app is destroyed (volumes are app-scoped but persist independently — costly orphan risk). Cascade-delete after Destroy succeeds is the correct symmetry. Delete failures are logged (`slog.Warn`) but don't block the user-visible Destroy outcome — orphaned volumes are recoverable via `fly volumes list` and operator cleanup. The post-Destroy delete is best-effort with a 30s timeout per volume, mirroring M4's cleanup pattern |
| 8.6 | **Volume creation precedes app-secret-set in `Spawn`** | New `Spawn` order (revising M4 decision 27 step 8): (a) `flaps.CreateApp` → (b) **`flaps.CreateVolume` × N replicas** → (c) `flaps.SetAppSecret` for each `CORELLIA_*` env var → (d) `flaps.Launch` × N replicas with `MachineMount` referencing the volume → (e) detached `pollHealth`. Volume-create rollback is added to the existing rollback `defer` chain | Volume-create must precede `Launch` because `MachineMount.Volume` references the volume ID. Failure during volume-create rolls back the (now-empty) Fly app via the existing M4 deferred cleanup at `fly.go:100-110`. The rollback chain extends: volumes created in this Spawn are deleted before the app is destroyed (Fly's app-delete *does* destroy machines but not volumes — see decision 8.5) |
| 9 | **Region list is server-cached, not per-request** | `FlyDeployTarget.ListRegions(ctx)` calls `flaps.GetRegions` once at boot and refreshes hourly in a background goroutine (mirrors `internal/auth/`'s JWKS cache shape). The `ListDeploymentRegions` RPC reads the cache; no flaps round-trip per FE page load | 35-region list changes ~yearly. Per-request flaps proxying would add 100ms to every `/agents` page load and consume per-org rate budget. Hourly refresh is fresh enough; the cache is a 1KB struct; the refresh failure mode is "serve stale" with a `slog.Warn`. Same shape as M4's JWKS cache, same ops familiarity |
| 10 | **Capability gating uses `flaps.GetPlacements` as a pre-flight, not as a UI source** | The deploy modal's region dropdown shows all non-deprecated regions. On submit, the BE calls `flaps.GetPlacements({Guest, Region, Count, Org})` to validate the (size + region + count + org) tuple before `flaps.Launch`. On placement failure, surface `ErrPlacementUnavailable` with a structured detail (which axis failed) | `GetPlacements` is the closest thing Fly has to capability discovery (per token + org + size). Gating the dropdown on it would mean N region-checks per page load. Pre-flighting on submit is the right balance: zero render overhead, structured error before we orphan a Fly app. The "which axis failed" detail comes from parsing `flaps.GetPlacements`'s `RegionPlacement` array (regions with `Count: 0` are the ones that can't fit) |
| 11 | **Edit-config flow is two-step: preview → confirm** | `UpdateAgentDeployConfig` accepts `dry_run bool`. `dry_run=true` returns `UpdateKind` (live vs respawn) + `EstimatedDowntime` + `EstimatedMonthlyCostDelta`. FE renders the preview; user confirms; FE re-submits with `dry_run=false`. Same pattern as Terraform plan/apply | Region changes are destructive; size changes cause a brief restart; lifecycle changes are live but materially affect billing. Showing the impact before commit is the difference between "control plane" and "config UI." `dry_run` lives at the RPC layer (single endpoint, two modes) per MCP-style precedent — separate `*Preview` RPCs would double the surface area |
| 12 | **Bulk apply is a fan-out of single-update RPCs, not a transactional batch** | `BulkUpdateAgentDeployConfig` takes `(instance_ids []uuid, delta DeployConfigDelta)` and calls `UpdateDeployConfig` for each via `errgroup` + `semaphore.NewWeighted(3)`. Returns per-instance results (success / per-instance error). **Not** atomic across instances — partial success is a real outcome | "Apply to 50 agents transactionally" requires either a 2PC across Fly's API (which doesn't exist) or holding a lock that prevents per-agent edits during the batch (UX-hostile). Per-instance results give the FE the data it needs to render "47 of 50 succeeded; 3 are in `iad-only` regions and rejected the size delta." Concurrency 3 mirrors M4's `SpawnN` semaphore and Fly's per-org rate friendliness |
| 13 | **Drift surfacing is read-only in v1.5** | The fleet page computes drift on render: for each agent, compare `agent_instances` columns (desired) to `flaps.List` results (actual) for each `Guest` field + machine count. Drift renders as a yellow banner per row with the diff. **No "reconcile" button** | Auto-reconciliation can do unexpected things (someone might have manually scaled up to handle a load spike; one click and Corellia tears it back down). M5 makes drift visible; the admin's existing "Edit deployment" form is the resolution path (re-submitting the desired config triggers reconciliation). M6 candidate for one-click |
| 14 | **`Health` aggregate semantics across replicas** | `Health(ref)` returns one of: `HealthStarted` (≥1 machine `started` AND volume-attachment matches DB), `HealthStarting` (≥1 machine `starting`/`created`, none `started`), `HealthStopped` (all machines `stopped`), `HealthFailed` (any machine in `failed` / unmappable state, **or any expected volume missing/detached**), `HealthDrifted` (`actual_count ≠ desired_replicas`, **or any volume size differs from `agent_volumes.size_gb`**). The current `len(machines) > 1` error path at `fly.go:184` is removed | Aggregating to a single status keeps M4's `pollHealth` loop intact. "Any machine started → agent up" matches the load-balanced reality. **Volume-attachment failure is a `HealthFailed` not a `HealthDrifted`** — a Hermes machine running without its `$HERMES_HOME` volume is *broken* (it'll appear to work but lose state on next restart), not just out-of-sync. New `HealthDrifted` covers the recoverable cases (count mismatch, size mismatch from operator's direct `flyctl volumes extend`) |
| 15 | **Pricing displayed in the FE; never persisted; never the source of authorization** | `frontend/src/lib/fly-pricing.ts` ships a hardcoded rate card (per region, per preset, per-second rate). FE computes `desiredReplicas × hoursPerMonth × rate` in JS at render. No BE involvement. No DB column for cost | Pricing is a UX nicety (helps the admin make informed choices), not a constraint. Persisting it would require a refresh job. The number is a hint; Fly's invoice is authoritative. Refresh cadence: PR'd manually when Fly publishes new rates |
| 16 | **`MachineGuest.SetSize` for preset resolution** | The deploy modal's "size" dropdown shows preset names (`shared-cpu-1x` etc.); the BE resolves to `(CPUKind, CPUs, MemoryMB)` via `MachineGuest.SetSize(name)` (fly-go helper at `machine_types.go`); the resolved tuple is what's persisted to `agent_instances`. The preset *name* is not stored | Storing the resolved tuple keeps the column types primitive (decision 5) and decouples Corellia from fly-go's preset naming if Fly ever renames. The cost: editing back to a preset later requires a reverse lookup, which is a small helper (~10 LOC) |
| 17 | **Region-list cache lives in `internal/deploy/` not `internal/agents/`** | `FlyDeployTarget` owns the cache. The interface method is `ListRegions(ctx) ([]Region, error)`. `agents.Service` calls through. `Region` is a Corellia-defined struct (Code, Name, Deprecated, RequiresPaidPlan), not `fly.Region` — keeps blueprint §11.1 intact | `fly.Region` leaking out of `internal/deploy/` would re-export Fly's type into domain code. The Corellia struct is a 4-field projection. Same pattern as M3.5's `Resolver` not exporting `flaps.Client` |
| 18 | **`flaps.AcquireLease` for every Update / Destroy / Start / Stop** | Every mutating call on a specific machine (`Update`, `Destroy`, `Start`, `Stop`, `Suspend`) acquires a lease first and passes the nonce. Lease TTL: 30s (Fly default). Lease release in `defer`. Failure to acquire → `ErrMachineBusy` → mapped to `Aborted` Connect code | Without a lease, concurrent Corellia operations (e.g. UI edit during a poll-driven reconciliation) can race against Fly's machine state. Leases are Fly's documented concurrency control. The 30s TTL accommodates the slowest single-machine op (Update with image change ~10s). `ErrMachineBusy` → `Aborted` matches Connect's semantic ("transient; retryable") |
| 19 | **Update is `flaps.Get → mutate → flaps.Update`, not partial** | Fly's API requires the full `MachineConfig` on every Update (per Machines API docs — no PATCH semantics). `FlyDeployTarget.Update` reads the current config, applies the delta, writes back. The Corellia-side `DeployConfig` is the source of truth for the Corellia-managed fields (size, restart); fields Corellia doesn't manage (image, env) are passed through unchanged | This is just matching Fly's API shape. The implementation hazard is "we read at T1, Fly mutates at T2, we write at T3 and clobber T2's change" — the lease (decision 18) prevents this. The pattern is well-trodden in `flyctl`'s own update path |
| 20 | **Validation lives on `DeployConfig.Validate()`, not in `agents.Service`** | `internal/deploy.DeployConfig.Validate()` checks: region in cached list; cpu_kind in `("shared","performance")`; (cpu_kind, cpus, memory_mb) within preset bounds (256MB/CPU shared, 2048MB/CPU performance, multiple of 256); restart_policy in `("no","always","on-failure")`; max_retries ≥ 0; lifecycle_mode in `("always-on","manual")`; desired_replicas in `[1, 10]`; **volume_size_gb in `[1, 500]`**. Returns wrapped sentinels (`ErrInvalidRegion`, `ErrInvalidSize`, **`ErrInvalidVolumeSize`**, etc.) | Validation belongs with the type that defines the field set. `agents.Service` calls `cfg.Validate()` and maps the sentinel to its own error sentinel for the Connect handler. Replicas cap of 10 mirrors M4's `SpawnN` cap. Volume range matches Fly's API (1GB min, 500GB max) |
| 21 | **`SpawnN`'s `count` and `desired_replicas` are different concepts** | `SpawnN(count=5)` creates 5 *separate agents* (5 Fly apps, 5 DB rows), each with `desired_replicas=1` by default. `desired_replicas=5` on a single agent means 1 Fly app, 5 machines, 1 DB row. The deploy modal UI distinguishes these via two separate sections: "Number of agents" (top of the form) and "Replicas per agent" (in the Deployment step) | Conflating these would lose the semantic difference between "five sales agents, one per region" and "one sales agent, five replicas for capacity." Keeping them separate keeps the demo-moment intact ("Deploy 5") while adding the capacity dimension |
| 22 | **Bulk apply UI: row checkboxes + sticky bottom toolbar** | Each fleet row gets a leading checkbox column. A sticky toolbar appears when ≥1 row is selected: "N agents selected | [Apply config…] [Clear]". "Apply config" opens the same edit form as the per-row inspector but submits via `BulkUpdateAgentDeployConfig`. The form's preview step shows per-instance UpdateKind (which will respawn vs which apply live) | Standard data-grid bulk-action pattern. Per-instance preview is non-negotiable — applying "region: lhr" to 50 agents could mean 50 destroy-and-respawns, and the admin must see that before clicking go |
| 23 | **Lease nonces: stored in request-scoped context, never persisted** | `flaps.AcquireLease` returns a nonce; it's held in a local var inside the operation function and released on defer. Never written to DB. If the BE crashes mid-op, the lease expires after its 30s TTL on Fly's side — no Corellia-side cleanup needed | Lease state is ephemeral; persisting it would require a "stale-lease sweep" job. TTL-based expiry is Fly's design intent. Same logic as why we don't persist Connect request IDs |
| 24 | **`/healthz` of the control plane reports flaps reachability** | The control plane's existing `/healthz` endpoint (M3.9) gains a degraded mode: returns `200` always but body includes `flaps_status: ok|degraded|down`. Degraded if `flaps.GetRegions` cache age >2h; down if last refresh failed. Surface this in the FE as an unintrusive footer pill | Operator visibility for the case "Fly is down, every spawn is failing, why?" The 200-always semantics keep Fly's own health probe (per M3.9 fly.toml) from cycling our control plane. Same pattern as how AWS surfaces `service_status` in console headers |
| 25 | **Connect error mapping for fleet ops** | New sentinels: `agents.ErrInvalidRegion`, `agents.ErrInvalidSize`, **`agents.ErrInvalidVolumeSize`**, `agents.ErrPlacementUnavailable`, `agents.ErrLifecycleUnsupported`, `agents.ErrMachineBusy`, `agents.ErrReplicaCap`, `agents.ErrDriftBlock`, **`agents.ErrVolumeShrink`** (attempt to set `volume_size_gb` below current), **`agents.ErrVolumeProvisionFailed`** (Fly's `flaps.CreateVolume` failed mid-spawn). Mapped via `agentsErrToConnect`: `Invalid*` → `InvalidArgument`, `PlacementUnavailable` → `FailedPrecondition`, `LifecycleUnsupported` → `Unimplemented`, `MachineBusy` → `Aborted`, `ReplicaCap` → `FailedPrecondition`, `DriftBlock` → `FailedPrecondition`, `VolumeShrink` → `InvalidArgument`, `VolumeProvisionFailed` → `Unavailable` (provider-side failure, redacted message per M4 decision 25 pattern) | Sentinel-per-failure-axis lets the FE render specific copy. `Unimplemented` for `LifecycleUnsupported` is correct (decision 3 deferred values). `Unavailable` for `VolumeProvisionFailed` matches the `ErrFlyAPI` redaction layer from M4 — Fly's volume errors can include capacity/region detail that's operator-noise from the FE perspective |
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

1. **Blueprint §8 rewrite.** Edit the section to read "one AgentInstance = one Fly app, with N machines for replicas, **each with its own region-pinned Fly volume mounted at the harness's `$HERMES_HOME` (or harness-equivalent state path)**." Preserve the secret-isolation rationale; rewrite the "one machine" and "stateless or offloaded to memory provider" parts (the latter was wrong for v1's only harness — see CLAUDE.md change in step 3). Add a note: "M5 retired the `len(machines) > 1` invariant in `Health()`."
2. **Blueprint §11.1 reaffirm.** Add a sentence: "M5 widens `DeployTarget` with capability-discovery, update, and **volume-lifecycle** methods. Every new method maintains the rule — only `FlyDeployTarget` imports `fly-go` / `flaps`."
3. **CLAUDE.md update.** Reflect the new `agent_instances` columns + new `agent_volumes` table in the data model section (one-line addition to the §2 schema overview). Also: explicitly correct the implied "stateless agent" framing — Hermes (and likely most future harnesses Corellia adds) keeps essential state under `$HERMES_HOME`; M5 makes this first-class.
4. **Verify fly-go version.** `cd backend && go list -m github.com/superfly/fly-go` should show `v0.5.0` or later. If older, `go get -u github.com/superfly/fly-go@latest` and `go mod tidy` before Phase 3. Confirm `flaps/flaps_volumes.go` exposes `CreateVolume`, `GetVolumes`, `GetVolume`, `ExtendVolume`, `DeleteVolume`, `CreateVolumeSnapshot`.
5. **Verify Fly token scope** allows `flaps.GetRegions`, `flaps.GetPlacements`, **AND `flaps.CreateVolume` / `flaps.DeleteVolume`** against `personal` org (the operator's current setup). One-shot tests:
   - `curl -H "Authorization: Bearer $FLY_API_TOKEN" https://api.machines.dev/v1/platform/regions | jq '.Regions | length'` → expect ~22 non-deprecated regions.
   - `fly volumes create m5-token-test -a corellia-agent-<some-existing-app> --region iad --size 1 --yes && fly volumes destroy <id> -a <app> --yes` → expect both to succeed without error. If the org-scoped token lacks volume permissions, surfaces here before Phase 3.
6. **Snapshot the current `agent_instances` row count + columns** to a one-off `pre_m5_snapshot.sql` for migration sanity-checking. Currently expected: small (operator's dev account) and all rows have `iad`-default machines, **no volumes attached**.
7. **Operator decision: backfill strategy for existing M4 agents.** Two options:
   - **(a) Destroy + respawn with volume.** Loses the agent's current state (acceptable since today's M4 agents have no persistent state — there's no volume, so nothing to lose).
   - **(b) Leave M4 agents on the no-volume path; new agents only get volumes.** Schema permits it (`volume_size_gb` defaults to 1 but `agent_volumes` rows are optional; M4 rows can have zero `agent_volumes` rows and `Spawn` can detect "no volume row → skip mount"). Avoids touching live agents but creates two code paths to test.
   - **Recommendation: (a)**, given the operator's M4 fleet is dev-scale (per 0.7.5: a handful of test agents). Pre-work step is the SQL: `SELECT id, name FROM agent_instances WHERE status NOT IN ('destroyed', 'failed')` to enumerate, then operator runs Destroy via UI for each, then re-spawns post-M5. Migration writes `volume_size_gb=1` for all rows but leaves `agent_volumes` empty until re-spawn populates it.
8. **Stub a one-shot Hermes-state-survives-restart test** in `cmd/smoke-deploy` (or extend it). Spawns a Hermes agent, exec's into it to write a sentinel file under `$HERMES_HOME/corellia-test-marker`, restarts the machine, exec's back in, expects the file to still exist. Used in Phase 9 as the load-bearing correctness check; written now so Phase 9 isn't blocked on test scaffolding.

---

## 4. Phasing

Vertical-slice phases, each strictly prerequisite for the next. Each phase ends with a green `go vet ./... && go test ./...` and (where applicable) a green `pnpm -C frontend type-check && lint && build`.

### Phase 1 — Schema migration + sqlc

**Goal:** Add 9 columns to `agent_instances` plus the new `agent_volumes` table. Sqlc-regenerate. No code consumes the new schema yet — pure additive landing.

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
      CHECK (desired_replicas BETWEEN 1 AND 10),
    ADD COLUMN volume_size_gb      INTEGER   NOT NULL DEFAULT 1
      CHECK (volume_size_gb BETWEEN 1 AND 500);

  CREATE TABLE agent_volumes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_instance_id  UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    fly_volume_id      TEXT NOT NULL,                          -- e.g. "vol_abc123"
    fly_machine_id     TEXT NULL,                              -- nullable: row exists between CreateVolume and Launch
    region             TEXT NOT NULL,                          -- pinned at create
    size_gb            INTEGER NOT NULL CHECK (size_gb BETWEEN 1 AND 500),
    mount_path         TEXT NOT NULL DEFAULT '/opt/data',      -- harness-specific; Hermes default
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fly_volume_id),
    UNIQUE(agent_instance_id, fly_machine_id)                  -- one volume per machine per agent
  );
  CREATE INDEX agent_volumes_by_instance ON agent_volumes(agent_instance_id);
  ```
- Down migration: `DROP TABLE agent_volumes;` then `ALTER TABLE agent_instances DROP COLUMN volume_size_gb, DROP COLUMN desired_replicas, ...` in reverse column order.
- New sqlc queries:
  - In `agent_instances.sql`: `UpdateAgentDeployConfig` (all 9 columns by `(id, org_id)`), `UpdateAgentReplicas` (just `desired_replicas`), `UpdateAgentVolumeSize` (just `volume_size_gb`), `BulkUpdateAgentDeployConfig` (`id = ANY($1::uuid[])` with org_id filter).
  - New `agent_volumes.sql` file: `InsertAgentVolume`, `SetAgentVolumeMachine` (fills `fly_machine_id` after `Launch` returns), `UpdateAgentVolumeSize`, `ListAgentVolumesByInstance`, `DeleteAgentVolume`.
- `sqlc generate`. Run migration locally. Verify the existing M4 row(s) get all defaults including `volume_size_gb=1`; `agent_volumes` is empty (M4 agents predate volumes per pre-work step 7).
- **Phase 1 exit criteria:** migration up + down clean against local DB; `sqlc generate` produces no diff in committed `internal/db/` other than the new methods + new `agent_volumes.sql.go`; `go vet ./... && go build ./...` clean.

### Phase 2 — `internal/deploy.DeployTarget` interface widening (no impls yet)

**Goal:** New interface shape, new types, NotImplemented stubs for AWS/Local. Phase 3 fills `FlyDeployTarget`.

- New `internal/deploy/types.go` (or extend existing): define `DeployConfig` (9 fields incl. `VolumeSizeGB`), `Region`, `UpdateKind` (three values: `LiveApplied`, `LiveAppliedWithRestart`, `RequiresRespawn`), `PlacementResult`, `MachineState` (incl. `AttachedVolumeID`), `VolumeRef` typed structs. None reference `fly.*`.
- Widen `DeployTarget` interface:
  ```go
  type DeployTarget interface {
      Kind() string
      Spawn(ctx, SpawnSpec, DeployConfig) (SpawnResult, error)  // SIG CHANGE; provisions volumes inline
      Update(ctx, ref, DeployConfig) (UpdateKind, error)         // NEW
      Stop(ctx, ref) error                                       // unchanged
      Start(ctx, ref) error                                      // NEW
      Destroy(ctx, ref) error                                    // semantics revised: also deletes volumes
      Health(ctx, ref) (HealthStatus, error)                     // semantics revised (incl. volume drift)
      ListRegions(ctx) ([]Region, error)                         // NEW
      CheckPlacement(ctx, DeployConfig) (PlacementResult, error) // NEW
      ListMachines(ctx, ref) ([]MachineState, error)             // NEW
      EnsureVolume(ctx, ref, region string, sizeGB int) (VolumeRef, error)        // NEW — idempotent provision
      ExtendVolume(ctx, ref, volumeID string, newSizeGB int) (needsRestart bool, err error)  // NEW
  }
  ```
- New sentinels in `internal/deploy/errors.go`: `ErrPlacementUnavailable`, `ErrMachineBusy`, `ErrLifecycleUnsupported`, `ErrInvalidRegion`, `ErrInvalidSize`, `ErrInvalidVolumeSize`, `ErrVolumeShrink`, `ErrVolumeProvisionFailed`, plus `ErrNotImplemented` (existing or new).
- `DeployConfig.Validate()` per decision 20 (includes `VolumeSizeGB ∈ [1,500]`).
- Update AWS / Local stub impls (per blueprint §11.4): all new methods return `ErrNotImplemented`.
- The existing `Spawn(ctx, SpawnSpec)` signature in `FlyDeployTarget` is widened to take `DeployConfig`. Temporary: `FlyDeployTarget.Spawn` accepts the new arg and ignores the volume fields (uses M4 defaults, no `Mounts`). Phase 3 wires real volume provisioning.
- Existing `agents.Service.Spawn` callers pass a zero-value `DeployConfig{}` until Phase 4 wires real values; `Validate()` accepts the zero value as "use defaults" (Region="" → server defaults, replicas=0 → 1, volume=0 → 1GB, etc.).
- **Phase 2 exit criteria:** interface compiles, fakes in test files updated with no-op impls (`fakeDeployTarget.EnsureVolume` returns a deterministic stub `VolumeRef`), `go vet ./... && go test ./internal/deploy ./internal/agents` clean.

### Phase 3 — `FlyDeployTarget` implements the widened surface (compute side)

**Goal:** Real Fly-API-backed implementations of the six compute-side new methods. Region cache wired. Lease-aware update path. **Volume methods land in Phase 3.5.**

- **`ListRegions`** — adds a `regionCache` field on `FlyDeployTarget`: `mu sync.RWMutex`, `regions []Region`, `lastFetch time.Time`. `NewFlyDeployTarget` starts a background goroutine doing `time.NewTicker(1 * time.Hour)` calling `flaps.GetRegions`. On boot, one synchronous fetch attempt (panic on failure: blueprint §11.1 spirit — fail-fast on infrastructure misconfig). Filter out `Deprecated=true` regions.
- **`CheckPlacement`** — wraps `flaps.GetPlacements({Compute: <built from DeployConfig>, Region: cfg.Region, Count: cfg.DesiredReplicas, Org: f.orgSlug})`. Returns `PlacementResult{Available bool, Reason string, AlternateRegions []string}`.
- **`Spawn` (compute portion only in Phase 3; volume mounting lands in Phase 3.5)** — translates `DeployConfig` to `MachineGuest` via `MachineGuest.SetSize(presetName)` if a preset is identifiable, else direct field set. Loops `cfg.DesiredReplicas` times calling `flaps.Launch` (preserves M4's per-app rollback `defer`). Returns `SpawnResult{ExternalRef, MachineIDs []string}` (NEW: plural). At end of Phase 3, machines launch *without* volumes — Hermes still loses state on restart. Phase 3.5 closes that gap.
- **`Update`** — for the (cfg → current) delta:
  1. If `cfg.Region` differs from any current machine's region → return `(RequiresRespawn, nil)` immediately. Don't touch Fly.
  2. Else: `flaps.List` → for each machine, `flaps.AcquireLease(machineID, 30s)` → `flaps.Get(machineID)` → mutate config → `flaps.Update(app, input, leaseNonce)` → `flaps.ReleaseLease(machineID, nonce)` (defer).
  3. Replica count delta: if `cfg.DesiredReplicas > len(machines)` → `flaps.Launch` for the diff; if `<` → `flaps.Destroy(machineID)` for the (LIFO-ordered) diff. Each Destroy acquires its own lease. **Volume provisioning/cleanup for replica deltas lands in Phase 3.5.**
  4. Return `(LiveApplied, nil)` on success.
- **`Start`** — `flaps.List` → for each `state == "stopped"` machine, `flaps.AcquireLease` → `flaps.Start(machineID)` → release.
- **`Stop` (revised)** — same pattern but `flaps.Stop`.
- **`ListMachines`** — `flaps.List` → project to `[]MachineState{ID, Region, State, Guest, CreatedAt, AttachedVolumeID}` (`AttachedVolumeID` populated from `machine.Config.Mounts`).
- **`Health` (revised semantics)** per decision 14. Volume-drift signal added in Phase 3.5; for now health observes only compute state. Removes the `len(machines) > 1` error path at `fly.go:184`.
- **Tests:** `internal/deploy/fly_test.go` extended with table-driven cases for the six new methods, using a `flapsClientFake` stand-in (small interface that `flaps.Client` satisfies; fake implements it). No live-Fly tests in CI.
- **Phase 3 exit criteria:** `go test ./internal/deploy/...` all green; the existing `cmd/smoke-deploy` can spawn a 2-replica agent in `iad` and observe both machines via `ListMachines`. **Known limitation at this checkpoint: spawned agents still have no volumes — restart loses Hermes state. Phase 3.5 immediate-next.**

### Phase 3.5 — `FlyDeployTarget` volume lifecycle

**Goal:** Volumes provisioned per replica, mounted at `/opt/data`, cleaned up on Destroy / scale-down. Hermes state survives restart.

- **`EnsureVolume(ctx, ref, region, sizeGB)`** — idempotent provision. Reads `agent_volumes` for this `ref` + `region`; if any unattached row exists with the right size, returns it. Else `flaps.CreateVolume(app, fly.CreateVolumeRequest{Name: "agent-data-<machineSeqOrUUID>", Region: region, SizeGb: &sizeGB, Encrypted: ptr(true), FSType: ptr("ext4"), SnapshotRetention: ptr(5)})`. Inserts an `agent_volumes` row with `fly_machine_id=NULL`. Returns `VolumeRef{VolumeID, Region, SizeGB}`. **Volume creation is the boundary where decision 8.6's rollback chain attaches** — `Spawn`'s deferred cleanup gains a "delete volumes created in this Spawn" step before the existing app-delete.
  - **Storage side-effect: this method writes to the `agent_volumes` table.** That's a deviation from the otherwise-stateless `FlyDeployTarget` shape (M4's `FlyDeployTarget` touches no DB). To preserve §11.1 (Fly-only inside `FlyDeployTarget`) AND the M4 separation (DB-only inside service layer), the implementation pattern is: `FlyDeployTarget` takes a `volumeRecorder` interface (one method, `RecordVolume(ctx, AgentInstanceID, VolumeRef) error`) injected via constructor; the production wiring passes a thin `agent_volumes`-table-backed recorder. Tests pass an in-memory recorder. The Fly-API call and the DB-record call are in the same method so partial-failure is recoverable (if `RecordVolume` fails after `flaps.CreateVolume` succeeds, the volume is orphaned on Fly — surface via `slog.Warn` and let drift detection catch it).
- **`ExtendVolume(ctx, ref, volumeID, newSizeGB) (needsRestart, error)`** — calls `flaps.ExtendVolume(app, volumeID, newSizeGB)` which returns `(volume, needsRestart, err)` per Fly-go's signature. Updates the corresponding `agent_volumes.size_gb` on success. Reject if `newSizeGB < current` with `ErrVolumeShrink`.
- **`Spawn` (final form, Phase 3 + 3.5 combined)** — order per decision 8.6:
  1. `flaps.CreateApp`.
  2. **Loop `cfg.DesiredReplicas` times: `EnsureVolume(ref, cfg.Region, cfg.VolumeSizeGB)` → capture `VolumeRef`.**
  3. For each `CORELLIA_*` env var: `flaps.SetAppSecret`.
  4. **Loop replicas: `flaps.Launch(app, LaunchMachineInput{Region: cfg.Region, Config: &fly.MachineConfig{..., Mounts: []fly.MachineMount{{Volume: volRef.VolumeID, Path: "/opt/data", SizeGb: volRef.SizeGB, Encrypted: true}}}})`. After `Launch` returns, call `volumeRecorder.SetVolumeMachine(volumeID, machineID)` to populate `agent_volumes.fly_machine_id`.**
  5. Detached `pollHealth`.
  - Rollback `defer` chain extends: on any failure, delete any volumes created *in this Spawn invocation* via `flaps.DeleteVolume`, then the existing app-delete.
- **`Update` (volume changes)** — when `cfg.VolumeSizeGB` differs from current `agent_volumes.size_gb`: call `ExtendVolume` for each volume. Result determines `UpdateKind`: if all return `needsRestart=false` → `LiveApplied`; if any → `LiveAppliedWithRestart`; if shrink-attempt → `ErrVolumeShrink`. Region-change path (`RequiresRespawn`) — volumes are region-pinned, so respawn destroys the old volumes (decision 6's "wipes persistent state" warning is what surfaces this).
- **`Destroy` (revised)** — `flaps.DeleteApp` (M4 behavior; cascades to machines + secrets) → enumerate `agent_volumes` rows for this `ref` → `flaps.DeleteVolume(volumeID)` for each in a goroutine with 30s per-volume timeout → on success, delete the `agent_volumes` rows. Failures logged at `slog.Warn`; soft-deleted `agent_instances` row remains, orphan volumes recoverable via `fly volumes list`.
- **Replica scale-down (Phase 3 placeholder closed here)** — when `Update` removes machines (LIFO), also delete each removed machine's attached volume.
- **`Health` volume-drift surfacing** — for each machine in `ListMachines`, check that `AttachedVolumeID` matches an `agent_volumes` row AND that the row's `size_gb` matches current Fly-side size. Mismatch → `HealthDrifted`. Missing attachment → `HealthFailed` (decision 14).
- **Tests:** extend `internal/deploy/fly_test.go` with: spawn-with-volume happy path, spawn-with-volume-create-failure rollback, extend-volume happy path, shrink-rejected, destroy-cascades-volumes, scale-down-deletes-volume.
- **Phase 3.5 exit criteria:** `go test ./internal/deploy/...` green; `cmd/smoke-deploy` end-to-end test (pre-work step 8) passes — sentinel file under `$HERMES_HOME` survives a `flaps.Stop` + `flaps.Start` cycle.

### Phase 4 — `internal/agents.Service` extended

**Goal:** Domain methods for the new fleet-control operations, sentinel-mapped, transactionally safe.

- **`Spawn` / `SpawnN`** — accept `DeployConfig` arg. Call `cfg.Validate()`. On success: persist all 9 fields (incl. `volume_size_gb`) to the new columns. The existing transactional `WithSpawnTx` from 0.7.5 wraps the same writes; the deploy-config columns are written inside the same tx as the `agent_instances` insert. **`agent_volumes` rows are written by `FlyDeployTarget.EnsureVolume` via the injected `volumeRecorder` interface (Phase 3.5)**, *outside* the agents-side `WithSpawnTx` — they're a Fly-state mirror, not a domain invariant. Failure to record after Fly succeeds surfaces as drift, not as a Spawn failure (rationale: blocking Spawn on a `agent_volumes` insert when the Fly volume already exists would create a worse failure mode — Fly would have a volume, Corellia wouldn't know about it, and the rollback `defer` would have to delete the Fly volume to clean up).
- **`UpdateDeployConfig(ctx, instanceID, cfg, dryRun bool) (*UpdateResult, error)`**:
  1. Load instance by (id, orgID).
  2. `cfg.Validate()`.
  3. Call `deployer.CheckPlacement(ctx, cfg)` — if `!Available`, return `ErrPlacementUnavailable`.
  4. Call `deployer.Update(ctx, ref, cfg)` to get `UpdateKind` (live vs respawn). **If `dryRun`, return `UpdateResult{Kind, EstimatedDowntime, EstimatedMonthlyCostDelta}` without persisting or calling Fly's mutation path** — `CheckPlacement` is read-only, and `Update` itself is gated by `dryRun` flag passed in.
  5. **NB:** `deployer.Update` needs a `dryRun` overload too — easier: split into `deployer.PreviewUpdate(ctx, ref, cfg) UpdateKind` (read-only) and `deployer.Update(ctx, ref, cfg) (UpdateKind, error)` (mutating). Adopt the split; it's the cleaner shape.
  6. On non-dry-run + `RequiresRespawn`: call `Destroy` then `Spawn` with the new config, preserving the `agent_instances.id` (same row, new `deploy_external_ref`). Update DB columns.
  7. On non-dry-run + `LiveApplied`: update DB columns. Spawn a `pollHealth` goroutine to watch convergence.
- **`StartInstance(ctx, instanceID)`** — load instance, call `deployer.Start(ctx, ref)`, set `last_started_at = now()`. Spawn `pollHealth`.
- **`ResizeReplicas(ctx, instanceID, desired)`** — load instance, validate `desired` in `[1, 10]`, update `desired_replicas` column, call `deployer.Update(ctx, ref, currentCfgWithNewReplicas)`. The reconciliation (incl. per-replica volume provisioning/cleanup) is `deployer.Update`'s job (per Phase 3.5); `agents.Service` doesn't loop machines itself.
- **`ResizeVolume(ctx, instanceID, newSizeGB)`** — load instance, validate `newSizeGB ≥ current` (else `ErrVolumeShrink`), enumerate `agent_volumes` rows, call `deployer.ExtendVolume` for each, update `agent_instances.volume_size_gb` AND each `agent_volumes.size_gb` row in one tx. Spawn `pollHealth` to observe machine restarts if any extension reported `needsRestart`.
- **`BulkUpdateDeployConfig(ctx, instanceIDs, delta, dryRun)`** — fan-out via `errgroup` + `semaphore.NewWeighted(3)` (M4 pattern). Returns `[]BulkResult{InstanceID, Kind, Error}` — partial success is normal. Per decision 8.4, the `delta` shape excludes `volume_size_gb`.
- **Drift detection helper** — `agents.Service.DetectDrift(ctx, instanceID) (DriftReport, error)`: compare DB `(region, cpu_kind, cpus, memory_mb, desired_replicas)` against `deployer.ListMachines(ctx, ref)` aggregate **AND** compare `agent_volumes` rows against actual Fly-side volume state (count, per-volume size, attachment to expected machine). Used by `ListAgentInstances` to populate `drift_summary` on each row. Distinct drift categories: `count_mismatch`, `size_mismatch`, `volume_mismatch`, `volume_size_mismatch`, `volume_unattached`.
- **Tests:** extend `internal/agents/service_test.go` with new sub-tests: validation paths (incl. `ErrInvalidVolumeSize`), dry-run vs apply, replica resize fan-out, bulk apply partial-failure, volume extend happy path, volume shrink rejection, drift detection across all five drift categories. Use `fakeDeployTarget` extended with new methods.
- **Phase 4 exit criteria:** all `internal/agents` tests green; sentinel mapping table updated; `cmd/api/main.go` constructor calls still compile (interface widening already absorbed in Phase 2).

### Phase 5 — Proto + handlers

**Goal:** Wire the new RPCs end-to-end. Generated code committed.

- Extend `shared/proto/corellia/v1/agents.proto`:
  - **New messages:** `DeployConfig` (9 fields incl. `volume_size_gb`), `Region`, `PlacementResult`, `MachineState` (incl. `attached_volume_id`), `DriftSummary` (with the five drift categories from Phase 4), `UpdateResult` (incl. `update_kind` enum: `LIVE_APPLIED`, `LIVE_APPLIED_WITH_RESTART`, `REQUIRES_RESPAWN`; plus `wipes_persistent_state bool` for the region-change case), `BulkResult`, `VolumeRef`. `// SECRET` comment convention reaffirmed where applicable.
  - **Widened messages:** `SpawnAgentRequest` and `SpawnNAgentsRequest` add `optional DeployConfig deploy_config = N`. Default behavior on unset: server uses defaults from decision-5 column defaults.
  - **Widened response:** `AgentInstance` gains all 9 deploy-config fields + `drift_summary` + `repeated VolumeRef volumes` (one per replica). `ListAgentInstancesResponse` unchanged structurally (uses widened `AgentInstance`).
  - **New RPCs:**
    - `ListDeploymentRegions(ListDeploymentRegionsRequest) returns ListDeploymentRegionsResponse`
    - `CheckDeploymentPlacement(CheckDeploymentPlacementRequest{deploy_config}) returns CheckDeploymentPlacementResponse{placement_result}`
    - `UpdateAgentDeployConfig(UpdateAgentDeployConfigRequest{instance_id, deploy_config, dry_run}) returns UpdateAgentDeployConfigResponse{update_result}`
    - `StartAgentInstance(StartAgentInstanceRequest{instance_id}) returns StartAgentInstanceResponse{instance}`
    - `ResizeAgentReplicas(ResizeAgentReplicasRequest{instance_id, desired_replicas}) returns ResizeAgentReplicasResponse{instance}`
    - `ResizeAgentVolume(ResizeAgentVolumeRequest{instance_id, volume_size_gb}) returns ResizeAgentVolumeResponse{instance, needs_restart}`
    - `BulkUpdateAgentDeployConfig(BulkUpdateAgentDeployConfigRequest{instance_ids, deploy_config_delta, dry_run}) returns BulkUpdateAgentDeployConfigResponse{results}`
- `pnpm proto:generate`; commit both generated trees.
- Extend `internal/httpsrv/agents_handler.go` with seven new handlers, each <30 LOC per blueprint §11.9. Sentinel-map all new errors per decision 25 (incl. `ErrInvalidVolumeSize`, `ErrVolumeShrink`, `ErrVolumeProvisionFailed`).
- Mount new RPCs inside the existing `r.Group(...)` with `auth.Middleware` (M4 decision 34).
- Extend `internal/httpsrv/agents_handler_test.go` with sentinel→Connect-code cases for all new sentinels, plus happy-path tests for at least: `UpdateAgentDeployConfig` dry-run, `BulkUpdateAgentDeployConfig` partial success, `ResizeAgentReplicas` happy path. Pattern matches 0.7.5's existing handler-level test suite.
- **Phase 5 exit criteria:** `pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen` exits 0; `go test ./internal/httpsrv/...` green; the new RPCs callable via `curl` against a local backend.

### Phase 6 — FE: deploy modal "Deployment" step

**Goal:** Spawn flow surfaces the new knobs.

- New step in `frontend/src/components/agents/deploy-modal.tsx` (between current Model and Submit): **Deployment**.
  - **Region** dropdown — populated from `ListDeploymentRegions` on modal open; cached in component state for the modal's lifetime; default to org's primary (TBD: today, hardcoded `iad`; org-level default is post-M5).
  - **Size** dropdown — preset list (`shared-cpu-1x` through `performance-8x`); GPU presets hidden. Each option shows `{cpus} vCPU / {memMB}MB`.
  - **Volume size** — number input (1–500), default 1, suffix "GB". Tooltip: "Persistent storage for the agent's memory, skills, and conversation history. Mounted at `/opt/data`. Can be increased later but never decreased."
  - **Replicas per agent** — number input, 1–10. Default 1. Tooltip: "How many machines to run for this agent. Use >1 for capacity. **Note: each replica gets its own volume — replicas don't share state.**"
  - **Restart policy** — radio: `on-failure (default)` / `always` / `no`. When `on-failure`: show "Max retries" number input (default 3).
  - **Lifecycle** — radio: `always-on (default)` / `manual`. Tooltip on `manual`: "Agent only runs when you start it from the fleet page." Disabled radio for `idle-on-demand` and `suspended` with "Coming when secure agent endpoints ship" tooltip.
- New "Review" step (was previously direct-submit): renders the resolved Fly machine config, calls `CheckDeploymentPlacement` for the green/red affordance, shows estimated monthly cost from `frontend/src/lib/fly-pricing.ts` **(compute + storage; storage rate is `$0.15/GB/month` per Fly's pricing page, hardcoded alongside compute rates)**. Submit button disabled if placement is red.
- Same form on the "Deploy 5" path — applies to all 5 agents identically.
- **Phase 6 exit criteria:** `pnpm -C frontend type-check && lint && build` clean; spawning an agent with a non-default config (e.g. `lhr` + `shared-cpu-2x` + 5GB volume + 2 replicas) succeeds against a local backend; the resulting Fly app has 2 machines in `lhr`, each with a 5GB volume mounted at `/opt/data` (verifiable via `fly machine list -a <app>` and `fly volumes list -a <app>`).

### Phase 7 — FE: fleet page deployment inspector + per-row actions

**Goal:** Edit-after-spawn; per-agent visibility into deployment state.

- Each fleet row gains:
  - A **Replicas** column (e.g. "2/2 running" or "1/2 running" with a yellow indicator on mismatch).
  - A **Region** column.
  - A **Size** column (preset name resolved from cpu_kind/cpus/memory_mb via reverse-lookup helper from decision 16).
  - A **Storage** column (e.g. "5GB" — sum across replicas if >1).
  - A **Deployment** action button → opens slide-over panel.
  - A **Start** action button (visible when `lifecycle_mode=manual` AND any machine is `stopped`).
- New slide-over panel `frontend/src/components/fleet/deployment-inspector.tsx`:
  - Header: agent name + current status pill.
  - "Current configuration" section: read-only display of all 9 fields. Volume row shows per-replica volume IDs + sizes (one line per replica from the new `repeated VolumeRef volumes` field on `AgentInstance`).
  - "Edit" button toggles to the same form from Phase 6 (extracted as `<DeploymentConfigForm>`). Volume size field's "decrease" attempt is rejected client-side with a tooltip ("Volumes can only be extended. To shrink, you'd need to destroy and recreate the agent — losing its persistent state.").
  - On submit: calls `UpdateAgentDeployConfig` with `dry_run=true`, renders the preview. **Region-change preview shows a red destructive warning** ("This will destroy and recreate the agent, **wiping its persistent state** (memory, skills, conversation history). The new agent will start with empty `$HERMES_HOME`. Continue?") with explicit checkbox confirmation. Other live-update previews show "machine will restart briefly" toast.
  - Drift banner at the top if `drift_summary` shows any mismatch — yellow, with the diff bullets categorized by drift type.
- **Phase 7 exit criteria:** type-check + lint + build green; editing a running agent's size from `shared-cpu-1x` to `shared-cpu-2x` results in a brief restart and the fleet row reflecting the new size; editing volume from 1GB to 5GB triggers `flaps.ExtendVolume` and the new size is observable via `fly volumes list`; attempting volume shrink is blocked client-side; editing region triggers the destructive-confirmation modal and on confirm the agent ends up in the new region with a new `deploy_external_ref`, new volume(s), but the same `agent_instances.id` (and a fresh empty `$HERMES_HOME`).

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

1. **Spawn with non-default region.** Deploy `agent-iad-test` in `lhr` size `shared-cpu-1x` replicas=1 volume=1GB. Verify Fly app + machine + volume in `lhr`; volume mounted at `/opt/data` (`fly ssh console -a <app> 'mount | grep data'`).
2. **Spawn with replicas=2.** Deploy `agent-replica-test` in `iad` size `shared-cpu-1x` replicas=2 volume=1GB. Verify Fly app has 2 machines AND 2 volumes in `iad`. Verify fleet page shows "2/2".
3. **Live size update.** Edit `agent-iad-test` size to `shared-cpu-2x`. Verify `flaps.Update` is called, machine restarts, fleet page reflects new size within polling cycle. **Critically: verify the volume survives — sentinel file written to `/opt/data/corellia-test-marker` before the update is still present after.**
4. **Volume extend.** Edit `agent-iad-test` volume from 1GB to 5GB. Verify `flaps.ExtendVolume` is called, `fly volumes show <id>` reflects 5GB, sentinel file still present, `df -h /opt/data` inside the machine shows the new size.
5. **Volume shrink rejected.** Try to edit `agent-iad-test` volume from 5GB to 2GB. FE blocks client-side; if forced via direct RPC, BE returns `ErrVolumeShrink` → `InvalidArgument`.
6. **Region update (respawn, destructive).** Edit `agent-iad-test` region to `fra`. Verify the destructive-confirmation modal appears with the "wiping persistent state" warning. On confirm: old Fly app + volume destroyed, new app + volume created in `fra`, agent_instance.id unchanged, deploy_external_ref changed, sentinel file gone (expected).
7. **Replica scale-up.** Edit `agent-replica-test` desired_replicas to 3. Verify a new machine launches AND a new volume is created and attached; fleet shows "3/3".
8. **Replica scale-down.** Edit `agent-replica-test` desired_replicas to 1. Verify 2 machines destroyed AND 2 volumes deleted (LIFO); fleet shows "1/1"; `fly volumes list -a <app>` shows exactly 1.
9. **Lifecycle=manual + restart-survives-state.** Edit `agent-iad-test` lifecycle to manual; write sentinel file; click Stop; machine state goes to `stopped`; click Start; machine state returns to `started`; **sentinel file still present** — the load-bearing Hermes-state-persistence test (pre-work step 8 scaffold).
10. **Drift surfacing — compute.** Use `flyctl` directly: `fly machine update <id> -a <app> --vm-size shared-cpu-2x` on a 1x agent. Wait for next fleet poll (3s). Verify yellow drift banner appears with "Size: requested shared-cpu-1x, actual shared-cpu-2x".
11. **Drift surfacing — volume.** Use `flyctl` directly: `fly volumes extend <vol-id> -s 10`. Wait for next fleet poll. Verify drift banner shows "Volume: requested 5GB, actual 10GB".
12. **Bulk apply.** Select 3 agents; apply lifecycle=manual; verify all 3 reflect the change. Apply size=shared-cpu-2x to those 3; verify each gets `flaps.Update` called. Verify volume_size_gb is NOT in the bulk form (decision 8.4).
13. **Placement rejection.** Try to spawn in a region known to be at capacity (TBD which; can simulate by giving an obviously-bad region in a test build). Verify `CheckDeploymentPlacement` returns `Available=false` and the FE blocks submit.
14. **Destroy cascades volumes.** Destroy `agent-replica-test` (now at replicas=1). Verify Fly app destroyed AND the remaining volume deleted; `fly volumes list -a <app>` returns empty before the app itself is gone; `agent_volumes` rows for this instance are deleted.

Document outcomes in `docs/changelog.md` per the M4 Phase 7 / 0.7.3 pattern. Test 9 is the load-bearing acceptance — if it fails, Hermes' state-persistence regression from M4 is *still* unfixed and M5 is not shippable.

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

- **Multi-region replicas** ("3 in `iad`, 2 in `fra`, 1 in `nrt`"). Schema doesn't preclude; M5 ships single-region. Volume region-pinning reinforces this constraint.
- **Volume usage telemetry** ("how full is the disk?"). Requires reading inside the machine — defer to sidecar/in-harness reporter (M6+).
- **Volume snapshots / restore** UI. Fly's automatic 5-day retention runs in the background; surfacing it in the UI is M6+.
- **Volume auto-extend on threshold** (`MachineMount.ExtendThresholdPercent`). v1.5 ships manual resize; auto is M6+.
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
| 11 | **`flaps.CreateVolume` succeeds but the matching `agent_volumes` insert fails (DB write race / connection drop)** | Decision 8.6 + Phase 3.5: failure to record after Fly succeeds logs `slog.Warn` with `fly_volume_id`, leaves the Fly volume orphaned, and surfaces via drift detection on next poll. **Spawn rollback `defer` does NOT auto-delete an orphan in this case** — the orphan is recoverable evidence, and auto-deleting it would create a "where did my volume go?" failure mode worse than orphan-and-surface. Operator can clean up via `fly volumes destroy <id>` or via the eventual M6 reconcile-button | `agent_volumes` row count diverges from `fly volumes list` count for a healthy agent |
| 12 | **Hermes state grows beyond the provisioned volume size and writes start failing** | M5 ships manual resize via the inspector. **Volume usage telemetry is out of scope** (would require sidecar/in-harness reporter — see §5). Without telemetry, the operator learns about the full disk via Hermes errors in Fly logs. Mitigation: default 1GB is comfortable for typical Hermes workloads; the deploy modal's tooltip mentions "can be increased later." Documented limitation, not a bug | Operator reports "my agent stopped responding and I see disk-full errors in logs" — resolution: extend volume via inspector, restart machine if `ExtendVolume` returned `needsRestart=true` |
| 13 | **Volume cleanup race on Destroy: app-delete succeeds, volume-delete fails, `agent_instances` row is soft-deleted** | Decision 8.5: best-effort, `slog.Warn` on failure, `agent_instances` row stays soft-deleted regardless. `agent_volumes` rows for failed-cleanup volumes stay too (so we can re-attempt). Operator can clean up orphans via `fly volumes list` (filtered to `corellia-agent-*` apps that no longer exist) | Soft-deleted `agent_instances` row has surviving `agent_volumes` rows pointing at Fly volumes that may or may not still exist |
| 14 | **Region change destructive-confirmation copy is dismissed too easily** ("just click OK to continue" muscle memory loses an agent's months of memory) | Phase 7's region-change preview adds an explicit checkbox confirmation ("I understand this destroys the agent's memory and skills"). The submit button stays disabled until the checkbox is checked. The preview also lists what specifically will be lost (skill count, conversation count) when a future Hermes-introspection RPC exists; v1.5 just shows the warning copy | First operator who loses an agent's state to a region-change reports it as a UX bug |

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
9. **Mount path for non-Hermes harnesses.** `agent_volumes.mount_path` defaults to `/opt/data` (Hermes' `$HERMES_HOME`). When v1.5+ adds a second harness with a different state path (LangGraph, custom), where does the mount-path decision live? Likely candidate: `harness_adapters.default_mount_path` column added when needed; M5 ships with the column on `agent_volumes` (DB shape ready) but reads it from a hardcoded constant in `internal/agents/service.go` for now.
10. **Should `agent_volumes.fly_machine_id` be nullable forever, or non-null after `Spawn` completes?** Currently nullable to handle the "volume created, machine launch failed mid-Spawn" case. Could enforce `NOT NULL` post-launch via an `UPDATE agent_volumes ... WHERE fly_machine_id IS NULL` after `Launch` returns (with a tx). Probably fine to leave nullable; the orphan case is real and "unattached volume" is a legitimate state to model.

---

## 8. Definition of done

M5 is shippable when ALL of the following hold:

- [ ] Migration `*_fleet_control.sql` is applied in dev (9 columns added to `agent_instances`, `agent_volumes` table created); up + down are clean.
- [ ] `internal/deploy.DeployTarget` has the eight new methods (incl. `EnsureVolume`, `ExtendVolume`); `FlyDeployTarget` implements them; AWS / Local stubs return `ErrNotImplemented`.
- [ ] Region cache is wired in `FlyDeployTarget` with hourly background refresh.
- [ ] `internal/agents.Service` has `UpdateDeployConfig` (with `dryRun`), `StartInstance`, `ResizeReplicas`, `ResizeVolume`, `BulkUpdateDeployConfig`, `DetectDrift`.
- [ ] All nine new RPCs (incl. `ResizeAgentVolume`) are wired through Connect handlers; `pnpm proto:generate && git diff --exit-code` is clean.
- [ ] Handler-level sentinel mapping tests cover all nine new sentinels per decision 25 (incl. `ErrInvalidVolumeSize`, `ErrVolumeShrink`, `ErrVolumeProvisionFailed`).
- [ ] Deploy modal has the Deployment step (incl. volume size field) + Review step (incl. storage cost line); spawning with non-default region/size/volume/replicas works end-to-end.
- [ ] Fleet page renders the new columns (Region, Size, Storage, Replicas), the deployment inspector slide-over (with per-replica volume list), the per-row Start button (when applicable), and the drift banner (when applicable, including volume-drift cases).
- [ ] Bulk apply UI works for at least 3 agents; per-instance preview + per-instance result render correctly; the 50-cap is enforced; volume_size_gb is NOT in the bulk delta form.
- [ ] **Region-change destructive-confirmation modal explicitly warns about state loss and requires a checkbox to enable submit.**
- [ ] Phase 9 integration smoke matrix: all 14 cases pass against the operator's `personal` Fly org. **Tests 3, 4, 9 (volume persistence across restart / extend / lifecycle stop-start) are load-bearing — they prove the M4 Hermes-state regression is fixed.**
- [ ] Pre-work step 7 backfill executed: any pre-M5 `agent_instances` rows still in non-terminal status have been destroyed and re-spawned (or operator has explicitly opted to leave them on the no-volume path with documented limitation).
- [ ] Pre-work step 8 sentinel-file scaffold lives in `cmd/smoke-deploy` and runs against a real Fly app to confirm volume mount + persistence.
- [ ] `cd backend && go vet ./... && go build ./... && go test -count=1 ./...` clean.
- [ ] `pnpm -C frontend type-check && lint && build` clean.
- [ ] Blueprint §8 / §9 / §11.1 updates landed (incl. removal of "stateless or offloaded to memory provider" framing); CLAUDE.md data model section updated; CLAUDE.md framing-correction note about Hermes-as-stateful added.
- [ ] Changelog entry written following the 0.7.0 / M4 entry's structure. Entry explicitly calls out that M5 closes the silent M4 defect where Hermes' `$HERMES_HOME` was unmounted.
- [ ] No new env vars introduced (verified by diff against `.env.example`).
