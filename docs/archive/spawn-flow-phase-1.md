# Phase 1 Completion — Spawn Flow: Schema + sqlc

**Plan:** `docs/executing/spawn-flow.md` §Phase 1
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M4
**Date:** 2026-04-26
**Status:** complete; checkpoint green (build OK, tests OK, three new tables + seed row live in Supabase, sqlc emits typed methods + structs)

This phase landed M4's full data-layer footprint in one migration plus four query files. **First time `agent_instances` exists** — the table the rest of the codebase has referred to in comments since v0.1.0 (`backend/internal/agents/service.go`'s `// GetAgentTemplateByID added by M4` placeholder, dating to 0.4.0) is now real and reachable. **First time multi-tenancy is enforced at the schema layer** via `org_id NOT NULL` + a query convention that filters every read by org. **First time `deploy_targets` is a table, not just a Go map** — the env-var-bootstrapped registry from M3.5 is supplemented (not yet replaced) by a DB-row source of truth, in preparation for v1.5's `DBResolver` swap.

---

## Index

- **One new migration.** `backend/migrations/20260426150000_spawn_flow.sql` (87 LOC). Schema + indexes + seed in one file; goose-applied in 129ms. `goose status` shows the new migration applied, all four predecessors intact. The Up block is structurally three table creates + two indexes + one seed insert; the Down drops in reverse FK order (`secrets` → `agent_instances` → `deploy_targets`).
- **Three new tables.** `deploy_targets` (id, name UNIQUE, kind CHECK IN ('fly','aws','local'), config JSONB, enabled, timestamps); `agent_instances` (id, name, four FKs to existing tables, deploy_external_ref NULL, model_provider CHECK IN three providers, model_name, status CHECK IN five states default 'pending', config_overrides JSONB, last_started_at NULL, last_stopped_at NULL, timestamps); `secrets` (id, agent_instance_id FK with `ON DELETE CASCADE`, key_name, storage_ref, timestamps, UNIQUE(agent_instance_id, key_name)).
- **One seed row.** `INSERT INTO deploy_targets ('fly', 'fly', true) ON CONFLICT (name) DO NOTHING`. Idempotent. Verified live: `id=812ce1a2-3631-4b42-b5c4-537c2050b6fc` (will differ on other databases — UUID is server-generated). `aws` and `local` are deliberately *not* seeded; their stub `DeployTarget` Go impls exist (M3) but a DB row would be a lie ("you can deploy here") that the UI doesn't expose. v1.5 adds rows when targets become operator-configurable.
- **Two indexes on `agent_instances`.** `agent_instances_org_created_idx (org_id, created_at DESC)` for the fleet view's hot read path; `agent_instances_deploy_ref_uniq (deploy_external_ref) WHERE NOT NULL` partial unique index for catching double-spawns at the DB layer.
- **One unique constraint on `secrets`.** `(agent_instance_id, key_name)` — Phase 1 Q1 closed. Duplicate `CORELLIA_MODEL_API_KEY` rows for the same instance would be a programming error; the index pins it.
- **Four query files.** `agent_instances.sql` (8 queries: insert, deploy-ref setter, four status transitions, list-by-org, get-by-id, reap-stale-pending); `secrets.sql` (insert + list-by-instance); `deploy_targets.sql` (get-by-name + list-enabled); `agent_templates.sql` extended with `GetAgentTemplateByID :one`.
- **Generated artefacts.** `internal/db/agent_instances.sql.go` (357 LOC), `internal/db/secrets.sql.go`, `internal/db/deploy_targets.sql.go`. `internal/db/models.go` gains `AgentInstance`, `DeployTarget`, `Secret` structs. `internal/db/querier.go` widens by 13 methods. All driven by `sqlc generate`; zero hand-edits.
- **Validation matrix.** `cd backend && go vet ./... && go build ./... && go test ./...` all clean. `internal/agents` cached at the M2 baseline (2 cases); `internal/users` at the 0.2.5 baseline (3 cases); `internal/deploy` at the M3+M3.5 baseline (26 cases). No regressions, no new tests yet (Phase 2's responsibility per plan §Phase 2 task 2). Goose Up applied successfully against the live Supabase project; live `\dt` confirms three new tables; live `SELECT … FROM deploy_targets` confirms the seed row.

---

## What this phase shipped

### The migration: schema choices that pay forward

**`agent_instances.status` is a `TEXT` column with a `CHECK` constraint, not a `CREATE TYPE`.** Same rationale as M2 decision 5 — no separate down-block, no type-drop ordering, no awkward `ALTER TYPE` on later additive growth (e.g. when v2 adds `'updating'` to the lifecycle). The CHECK is informationally equivalent and operationally cheaper. Five values pinned: `pending`, `running`, `stopped`, `failed`, `destroyed` — verbatim from blueprint §9.

**`agent_instances.model_provider` gets the same treatment** with a tighter set: `anthropic`, `openai`, `openrouter`. This is the third layer of validation (proto enum on the wire, decision 26's BE-side `validateProvider`, and now the DB CHECK) — a defence-in-depth pattern Phase 1 establishes for *enumerable* string columns. `model_name` deliberately has *no* check — provider model lists change frequently (decision 26's "the provider's API will reject an invalid model name; the agent will fail-loud at first chat call" stance).

**`deploy_external_ref` is `TEXT NULL`.** Decision 4's "the row is inserted *before* the Fly call so the spawn is auditable even on Fly failure" needs the column to be honest about pre-Fly state. Generated code shows `*string` per `emit_pointers_for_null_types: true` — same sqlc lever M3 used for the `harness_adapters.adapter_image_ref *string → string` flip when that column tightened to NOT NULL. **The pointer/non-pointer split at the call site is type-driven invariant enforcement**: a future caller cannot accidentally read `instance.DeployExternalRef` as if it were always set.

**Two indexes on `agent_instances`, both grounded in actual read patterns.** `(org_id, created_at DESC)` is the fleet view's primary read shape — `WHERE org_id = $1 ORDER BY created_at DESC`. The `DESC` is on the index itself so the planner skips the Sort node. The partial unique index on `deploy_external_ref WHERE NOT NULL` is **defence against the kind of bug you can't observe locally**: two rows in `pending` state legitimately have NULL refs (no collision), but two rows in `running` state with the same Fly app ref means we double-spawned and forgot. Postgres treats multiple NULLs in unique indexes as distinct anyway, but the partial form makes the intent explicit.

**`secrets.agent_instance_id` has `ON DELETE CASCADE`.** Asymmetric with `agent_instances.org_id` (no cascade) because the two relationships have different semantics: instances are soft-deleted by status flip in v1, but if a hard delete ever happens (test cleanup, future GDPR purge), the secret rows must follow because they're audit shadows of the parent — orphaned `secrets` rows have no meaning. `agent_instances.org_id`, by contrast, points at a real first-class entity that outlives any individual instance.

**`secrets` has no `value` column.** Blueprint §9 + decision 6 + decision 7 — the API key is forwarded **once**, in-memory, to Fly's secret store and never crosses our DB. `storage_ref` is the opaque handle (e.g. `fly:corellia-agent-<uuid>:CORELLIA_MODEL_API_KEY`) for audit. Phase 1 §"Validation" spot-check: `\d secrets` shows no `value` column. Trivially true today; the spot-check exists so a future PR adding a "value" column trips a code review red flag.

### The query files: 13 methods across four files

**`agent_instances.sql` ships eight queries**, one per state transition or read shape. The plan §Phase 1 task 2 said "likely two query variants for clarity" for status transitions; execution settled on **four named variants** (`SetAgentInstanceRunning`, `SetAgentInstanceStopped`, `SetAgentInstanceDestroyed`, `SetAgentInstanceFailed`) plus the bare deploy-ref setter. The reason is timestamp invariants: `last_started_at` should be set *iff* the instance has ever been running; `last_stopped_at` should be set *iff* it has ever stopped or been destroyed; the failed transition has no timestamp side-effect. Encoding each transition as its own query pins these invariants at the SQL layer, where they cannot be sidestepped by a careless caller. A polymorphic `SetStatus(id, status, last_started, last_stopped)` with COALESCE would have been one query but five distinct ways to call it incorrectly.

**`ListAgentInstancesByOrg` and `GetAgentInstanceByID` both project a 16-column row** including `template_name` from a join on `agent_templates`. Two reasons: (1) the FE's fleet view needs the human-readable template name per row (decision 31), and a per-row second round-trip is wasteful; (2) sqlc emits a custom `*Row` struct for each query, which means the wire shape is type-pinned at the boundary — the proto `AgentInstance.template_name` field maps 1:1 to the row column. **The `*` projection on `GetAgentInstanceByID` would have skipped `template_name`** because sqlc resolves `SELECT *` to the bare table columns, not joined ones; named projection is the correct shape regardless of what the convenience cost might suggest.

**`GetAgentInstanceByID` takes a two-arg struct (id + org_id)** rather than just id. Decision 9's multi-tenancy posture compiled into the type system: a caller cannot fetch an instance without naming the requesting org, which means cross-org leakage requires actively passing the wrong org_id (a much louder bug than forgetting to filter). sqlc's `Params` struct shape makes "I forgot to add WHERE org_id" structurally impossible at this query.

**`ReapStalePendingInstances` is `:many` returning `[]uuid.UUID`, not `:execrows`.** Plan §Phase 1 task 2 suggested `:execrows`; execution flipped to `:many RETURNING id` because the plan's stated purpose was "for boot-time sweep logging" and `:execrows` returns only a count, not the IDs. Logging `count=3` is less actionable than logging the actual UUIDs — a contributor seeing the warn line in production logs gets to grep for the specific row in their database. Cost: a slightly larger return type. Benefit: the operator can cross-reference reaped instances with whatever crash event preceded the boot.

**`secrets.sql` ships two queries (insert + list); `deploy_targets.sql` ships two queries (get-by-name + list-enabled)** — both list queries have **no v1 caller**. They're shipped now because the querier-interface widening cost is zero (sqlc regenerates the interface from the queries directory regardless), and the contract surface is more honest with both reads visible. Future phases that need them — v1.5's fleet detail view, an admin "show me all configured deploy targets" panel — won't have to come back and amend Phase 1's data layer to enable obvious reads.

**`agent_templates.sql` extends with `GetAgentTemplateByID :one`** rather than narrowing the projection. Decision-by-decision: M2's `ListAgentTemplates` is *deliberately* narrowed (no `created_by_user_id`, no timestamps) because the catalog page doesn't need them; M4's `Get` is *deliberately* full-row because the spawn flow's first step (decision 27 step 2) needs `harness_adapter_id` to chain into `GetHarnessAdapterByID` for the adapter image ref. **Two queries, two projections, one rationale: project exactly what the caller needs.**

### Generated code: `db.AgentInstance`, `db.Secret`, `db.DeployTarget`

**`db.AgentInstance` has 15 fields.** The full row including the pointer-typed `DeployExternalRef *string`, `pgtype.Timestamptz` for the two nullable timestamps, and `[]byte` for `ConfigOverrides` (sqlc's mapping for JSONB). Three structs reading `*string` reflects three nullable columns, with the `emit_pointers_for_null_types` lever doing exactly what M3 documented. **Future caller bugs that would have been "I tried to dereference a maybe-set field as if it were always set" become compile errors at the call site** — the same way `db.User.Name *string` (introduced in 0.2.5) made the onboarding wizard's "name not yet set" branch impossible to forget.

**`Querier` widens by 13 methods.** The interface is the structural contract that `agents.Service` will narrow against in Phase 2 (per the M2 `templateQueries` interface pattern). At 13 new methods the interface is wide enough that a single `instanceQueries` interface in `agents` would be unwieldy — Phase 2 may need to split into `templateQueries` (existing) + `instanceQueries` + `secretQueries` + `deployTargetQueries`, or possibly fold the latter three into one `spawnQueries`. **The split is Phase 2's call**, not Phase 1's. Phase 1 ships the wide Querier and lets Phase 2 narrow it from the consuming side.

**`var _ Querier = (*Queries)(nil)`** at the bottom of `querier.go` is the compile-time conformance assertion sqlc emits automatically. It's why the build catches signature drift between the SQL files and the Go struct: any time a query is added/removed/reshaped, this assertion either passes (interface and impl match) or fails at exactly the right diagnostic location. The same defence-in-depth pattern M3.5 introduced for `var _ Resolver = (*StaticResolver)(nil)` and that M3 used for `target_test.go`'s interface conformance checks.

---

## Decision drift from the plan

**Two intentional deviations** from `docs/executing/spawn-flow.md` §Phase 1:

1. **Status transitions split into four named variants instead of "two query variants for clarity."** Plan §Phase 1 task 2 said: `SetAgentInstanceStatus :exec — flips status, with optional last_started_at / last_stopped_at updates (likely two query variants for clarity).` Execution settled on `SetAgentInstanceRunning`, `SetAgentInstanceStopped`, `SetAgentInstanceDestroyed`, `SetAgentInstanceFailed` — four variants, one per terminal state with a wall-clock-event semantic. Rationale captured above (timestamp invariants pinned at the SQL layer, not the call site). **The plan's word "likely" was the escape hatch**; the deviation is a clarification, not a structural change.

2. **`ReapStalePendingInstances` is `:many` returning `[]uuid.UUID`, not `:execrows`.** Plan said `:execrows` with `RETURNING id … for boot-time sweep logging`. `:execrows` returns only a count; if the goal is logging *which* IDs got reaped (the plan's own framing), `:many RETURNING id` is the right tag. Rationale captured above.

**Zero unintentional deviations.** No SDK-version drift (this phase touches only Postgres + sqlc, both stable in this codebase); no fly-go API surprises (no fly-go calls in Phase 1); no proto codegen issues (no proto changes yet — Phase 3's territory). The plan's structural decisions all survived intact.

---

## Validation matrix

```
cd backend && go vet ./... && go build ./... && go test ./...
→ vet OK (no warnings)
→ build OK (cmd/api + cmd/smoke-deploy + all internal/* packages)
→ tests OK (cached: deploy 26 sub-tests, agents 2, users 3; no regressions)

cd backend && goose -dir migrations postgres "$DATABASE_URL_DIRECT" status
→ 20260426150000_spawn_flow.sql           Sun Apr 26 12:17:49 2026
→ 20260426120000_adapter_image_ref_backfill.sql  (M3, untouched)
→ 20260425170000_agent_catalog.sql        (M2, untouched)
→ 20260424140000_auth_user_provisioning.sql (0.2.5, untouched)
→ 20260424120000_initial_schema.sql       (v0.1.0, untouched)

psql "$DATABASE_URL_DIRECT" -c "\dt" | grep -E 'agent_instances|secrets|deploy_targets'
→ public | agent_instances | table | postgres
→ public | deploy_targets  | table | postgres
→ public | secrets         | table | postgres

psql "$DATABASE_URL_DIRECT" -c "SELECT id, name, kind, enabled FROM deploy_targets;"
→ 812ce1a2-3631-4b42-b5c4-537c2050b6fc | fly | fly | t

ls backend/internal/db/
→ agent_instances.sql.go  ← new
→ deploy_targets.sql.go   ← new
→ secrets.sql.go          ← new
→ models.go (now includes AgentInstance, DeployTarget, Secret)
→ querier.go (now includes 13 new methods)
```

All four Phase 1 checkpoint conditions satisfied:

- ✅ `cd backend && go build ./...` succeeds.
- ✅ `db.Queries` has the new methods (13 added; verified in `querier.go`).
- ✅ `db/models.go` has `AgentInstance`, `Secret`, `DeployTarget` structs.
- ✅ Database has the three new tables and the `fly` seed row.

---

## Known pending work (Phase 2's territory, not Phase 1's)

- **Service-layer extension.** `agents.Service` gains `Spawn`, `SpawnN`, `List`, `Get`, `Stop`, `Destroy` plus the background poll. Phase 1 sets up the data layer; Phase 2 consumes it.
- **Test coverage.** `agents/service_test.go` extends with table-driven cases covering the new service methods. **No tests exist for the Phase 1 queries themselves** — sqlc-generated code is treated like `node_modules` per stack §11.7; the queries' correctness is exercised via the service tests. (Same convention M2 used.)
- **Down/Up round-trip not exercised.** Plan §Phase 1 acceptance asks for `goose down ; goose up` to confirm idempotency. Skipped this phase to avoid destroying live state on the shared dev database; the migration's structural shape (CREATE TABLE + DROP TABLE in reverse FK order) is well-trodden ground in this codebase (M2 used the same pattern), and the per-file atomicity guarantee means partial-apply is impossible. **If it turns out to matter**, an isolated round-trip via `pg_dump`/`pg_restore` against a throwaway local DB is the right way to verify; flagged for v1-deploy follow-up if any operator-facing tooling changes assumptions about idempotency.
- **Querier interface narrowing.** Phase 2 will pick whether to keep one wide `templateQueries` interface in `agents` or split into three (`templateQueries` + `instanceQueries` + `secretQueries` + `deployTargetQueries`). The 13-method widening of the underlying `db.Querier` makes a single in-package narrowed interface plausible but not obviously right — this is deliberately Phase 2's structural call, not Phase 1's.

---

## What this unlocks for Phase 2

1. **`agents.Service.Spawn` can be written in full.** Decision 27's eleven-step order of operations all has matching queries:
   - Step 2 (resolve template) → `GetAgentTemplateByID`
   - Step 4 (resolve deploy target) → `GetDeployTargetByName`
   - Step 5 (insert instance row) → `InsertAgentInstance`
   - Step 6 (insert secret rows) → `InsertSecret` (one per `CORELLIA_*` env var)
   - Step 9 (set deploy ref post-Fly) → `SetAgentInstanceDeployRef`
   - Step 11 (poll goroutine flips status) → `SetAgentInstanceRunning` / `SetAgentInstanceFailed`
2. **`agents.Service.Stop` / `.Destroy`** map directly to `SetAgentInstanceStopped` / `SetAgentInstanceDestroyed` after the FlyDeployTarget call returns.
3. **`agents.Service.List` / `.Get`** map to `ListAgentInstancesByOrg` / `GetAgentInstanceByID` — the org-scoped reads the fleet page and detail view need.
4. **`cmd/api/main.go`'s boot-time sweep** (decision 32) is one call to `queries.ReapStalePendingInstances` returning `[]uuid.UUID`; logging shape is `slog.Warn("reaped stale pending instances", "count", len(ids), "ids", ids)`.

---

## Files touched

```
backend/migrations/20260426150000_spawn_flow.sql        new (87 LOC)
backend/queries/agent_instances.sql                     new (113 LOC)
backend/queries/secrets.sql                             new (18 LOC)
backend/queries/deploy_targets.sql                      new (12 LOC)
backend/queries/agent_templates.sql                     +9 LOC (GetAgentTemplateByID added)

backend/internal/db/agent_instances.sql.go              generated (357 LOC)
backend/internal/db/secrets.sql.go                      generated
backend/internal/db/deploy_targets.sql.go               generated
backend/internal/db/models.go                           +3 structs (AgentInstance, DeployTarget, Secret)
backend/internal/db/querier.go                          +13 methods, +4 doc-comments
backend/internal/db/agent_templates.sql.go              +1 method (GetAgentTemplateByID)
```

**No edits to non-generated code outside the schema/queries directories.** Phase 1 is a pure data-layer phase; the service / handler / proto / FE work all live in subsequent phases. The Phase-2-onwards diff will *consume* this phase's surface area, not *modify* it — the load-bearing evidence that the data layer was designed to fit the lifecycle, not retrofitted to it.
