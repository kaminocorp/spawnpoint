# M5 Fleet Control — Phase 1 completion notes

**Plan:** `docs/executing/fleet-control.md` §4 Phase 1.
**Date:** 2026-04-26.
**Scope:** Schema migration + sqlc codegen, additive only. No code consumes the new schema yet — that's Phase 2 onward.

---

## What shipped

Three files written, three files updated by codegen, zero existing files touched outside of additive query appends.

### New files

- **`backend/migrations/20260426160000_fleet_control.sql`** — single-file migration. `+goose Up` adds nine columns to `agent_instances` (`region`, `cpu_kind`, `cpus`, `memory_mb`, `restart_policy`, `restart_max_retries`, `lifecycle_mode`, `desired_replicas`, `volume_size_gb`) and creates the `agent_volumes` table + the `agent_volumes_by_instance_idx` index. `+goose Down` drops the table first then drops columns in reverse-add order. Per-file goose transaction means the whole pair lands atomically or not at all.
- **`backend/queries/agent_volumes.sql`** — new sqlc input file. Five queries: `InsertAgentVolume :one`, `SetAgentVolumeMachine :exec`, `UpdateAgentVolumeSize :exec`, `ListAgentVolumesByInstance :many`, `DeleteAgentVolume :exec`. Each pinned to its Phase 3.5 / Phase 4 caller in the doc-comment above the query.
- **`backend/internal/db/agent_volumes.sql.go`** — sqlc-generated. Five methods + two param structs + the `AgentVolume` model picked up via `models.go`. Untracked; treat as committed-once-per-`sqlc generate`-run (per stack §11.7 — generated code is checked in but never hand-edited).

### Updated files

- **`backend/queries/agent_instances.sql`** — four new queries appended *above* the existing `ReapStalePendingInstances` block (so the boot-sweep stays at the bottom, where it always lived):
  - `UpdateAgentDeployConfig :exec` — full nine-tuple write keyed by `(id, org_id)`. Phase 4's `UpdateDeployConfig` non-dry-run path.
  - `UpdateAgentReplicas :exec` — single-column write. Phase 4's `ResizeReplicas`.
  - `UpdateAgentInstanceVolumeSize :exec` — single-column write. Phase 4's `ResizeVolume` (parent-side; the per-volume mirror is `UpdateAgentVolumeSize` in `agent_volumes.sql`). See "Discovered conflict" below for why the parent's name had to diverge from what the plan literally specified.
  - `BulkUpdateAgentDeployConfig :exec` — eight-column write keyed by `id = ANY($1::uuid[]) AND org_id = $2`. Excludes `volume_size_gb` per plan decision 8.4.
- **`backend/internal/db/agent_instances.sql.go`** — sqlc regenerated. Four new methods + four new param structs.
- **`backend/internal/db/models.go`** — sqlc regenerated. `AgentInstance` struct grows from 15 fields to 24 (the nine new columns); new `AgentVolume` struct lands.
- **`backend/internal/db/querier.go`** — sqlc regenerated. Nine new method signatures on the `Querier` interface (four `agent_instances` + five `agent_volumes`).

`git diff --stat` summary post-Phase-1: `+353 -1` across the four sqlc-touched files (the `-1` is a trailing-newline reflow, not a behavioural change).

---

## How it diverged from the plan

Two deviations, both flagged at the moment they were chosen:

### 1. `gen_random_uuid()` → `uuid_generate_v4()`

The plan body's SQL literal uses `gen_random_uuid()` (Postgres 13+ built-in). Every other Corellia migration uses `uuid_generate_v4()` from the `uuid-ossp` extension that the initial migration (`20260424120000_initial_schema.sql`) installs. Mixing the two would create inconsistent provenance across PK defaults — every table except `agent_volumes` would still use `uuid-ossp`, and a future contributor reading the schema cold would have no signal as to why one table differs. Stayed on the existing convention. Functional outcome is identical (both produce v4 UUIDs); the choice is purely about codebase coherence.

### 2. Plan's `UpdateAgentVolumeSize` collides with itself across two files

Plan §4 Phase 1 specifies a query named `UpdateAgentVolumeSize` in *both* `agent_instances.sql` (the parent's `volume_size_gb` desired-state column) and `agent_volumes.sql` (the per-row size mirror). sqlc namespaces query names per-package, not per-table — generating both produces `# package db: duplicate query name: UpdateAgentVolumeSize`. Renamed the parent-side query to **`UpdateAgentInstanceVolumeSize`** (the plan's name stays on the per-row mirror, since that's the one a Phase 3.5 reader is most likely to reach for). The `ResizeVolume` Phase 4 caller will run both inside one tx; the names had to diverge but the semantics line up.

This is plan errata, not a design change — recommend folding the rename back into `docs/executing/fleet-control.md` §4 Phase 1's bullet list during the next plan revision so a future re-reader doesn't trip on the same conflict.

---

## What I deliberately did NOT do

Per the plan's "pure additive landing" framing for Phase 1:

- **Did not widen existing read queries.** `ListAgentInstancesByOrg` and `GetAgentInstanceByID` still SELECT only the M4 columns. Phase 4/5 widens them when the service-layer code starts reading `region`, `volume_size_gb`, etc. Today, the new columns exist in the DB but no read path surfaces them. This is intentional — keeps Phase 1 a zero-behavioural-change landing.
- **Did not touch `cmd/api/main.go` or any service-layer code.** Phase 2's interface widening is what introduces the first compile-time use of the new columns (via `DeployConfig` validation), and Phase 3+ is what wires real reads/writes.
- **Did not run the migration against the dev DB.** The IPv6-only Direct Connection (`db.<ref>.supabase.co:5432`) is unreachable from the current shell's network; the documented IPv4 Session Pooler fallback (CLAUDE.md "Database connection" + stack §8) is a config swap on the operator's `backend/.env`. **Open follow-up: operator runs `goose -dir migrations postgres "$DATABASE_URL_DIRECT" up` then `down` then `up` against the dev DB to confirm clean round-trip before Phase 2 starts.** sqlc codegen does not need DB connectivity (it parses migration files locally per `sqlc.yaml`'s `schema: "migrations"` config), which is why Phase 1 still produced a green generated tree.

---

## Validation gates met

- `sqlc generate` clean (no errors, no warnings).
- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- Generated diff is exactly: nine new columns on `AgentInstance`, new `AgentVolume` struct, four new agent_instances methods, five new agent_volumes methods, nine new `Querier` interface entries. No spurious changes to other generated files.
- No proto change in this phase (Phase 5's surface). No frontend change.

---

## Validation gates owed (operator)

- `goose up` against dev DB: expect new migration to apply, the existing M4 `agent_instances` row(s) to gain all nine columns at their DEFAULTs (`region='iad'`, `cpu_kind='shared'`, `cpus=1`, `memory_mb=512`, `restart_policy='on-failure'`, `restart_max_retries=3`, `lifecycle_mode='always-on'`, `desired_replicas=1`, `volume_size_gb=1`), and `agent_volumes` to be empty (M4 agents predate volumes per pre-work step 7).
- `goose down` against dev DB: expect new table dropped first, then nine columns dropped in reverse-add order, no errors.
- `goose up` again: idempotent re-up to confirm the down really cleared state.

---

## Schema-level rationale (worth keeping)

The plan covers the *what*; this section pins the non-obvious *why* for future readers reaching the migration cold.

- **All nine new columns are `NOT NULL` with `DEFAULT`.** Backward-compatible against the existing M4 row population (pre-work step 6: dev-scale, all rows in `iad`, no volumes). Nullable-here-just-in-case is the wrong posture — the deploy config is always *some* value, even if it's the default.
- **`lifecycle_mode` CHECK admits four values, the API accepts two.** The DB column is forwards-compatible; the API surface (decision 3) is the tight constraint. When `idle-on-demand` or `suspended` ship, only the validation layer changes — no migration churn.
- **`agent_volumes.fly_machine_id` is NULL-allowed forever** (Q10). Unattached is a legitimate state — the orphan case (volume created, launch failed mid-Spawn) happens, and modeling it cleanly opens the rescue/reattach use case for free.
- **`UNIQUE (agent_instance_id, fly_machine_id)`** is "one volume per machine per agent." Postgres treats multiple NULLs as distinct in unique indexes, so multiple unattached rows pre-launch don't collide — that's the right semantic (each volume is its own pre-launch placeholder).
- **`mount_path` defaulting to `/opt/data`** (Hermes' `$HERMES_HOME`) is service-layer convention exposed at the schema layer for forward-compatibility. Q9: when the second harness lands, add `harness_adapters.default_mount_path` and have the service layer read from there — zero schema change to `agent_volumes`.
- **`ON DELETE CASCADE` on `agent_volumes.agent_instance_id`** is a safety net, not the primary cleanup mechanism. Decision 8.5: the real cleanup path is `agents.Service.Destroy` calling `flaps.DeleteVolume` per-row then hard-deleting the `agent_volumes` row. The cascade matters for any future hard-DELETE on `agent_instances` (which v1.5 doesn't have — agents soft-delete via `status='destroyed'`).

---

## Next phase entry checkpoint

Phase 2 is `internal/deploy.DeployTarget` interface widening — eight new methods, new `DeployConfig` typed struct, `NotImplemented` stubs for AWS / Local. The schema is now ready to back the service layer's writes once Phase 4 lands; Phase 2 needs no DB at all.
