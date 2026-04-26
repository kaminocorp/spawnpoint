# Phase 2 Completion — Agent Catalog: sqlc queries + regen

**Plan:** `docs/executing/agent-catalog.md` §Phase 2
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete; full check matrix green (`go vet` / `go build` / `go test`)

This phase translated Phase 1's Postgres schema into typed Go query functions. Two SQL files in, four files out (two new generated, two regenerated additively), all four Phase 2 acceptance gates green. The codebase now has a typed Go API for reading the catalog — the layer the new domain packages will consume in Phase 4.

---

## Index

- **Two new query files.** `backend/queries/harness_adapters.sql` (`GetHarnessAdapterByID :one`) + `backend/queries/agent_templates.sql` (`ListAgentTemplates :many`, with a 3-line SQL comment explaining the deliberate column-projection decision; the comment propagates through codegen into the Go function's GoDoc).
- **Two new generated files.** `backend/internal/db/harness_adapters.sql.go` (33 LOC) + `backend/internal/db/agent_templates.sql.go` (54 LOC). Both stamped `sqlc v1.30.0` matching the existing generated tree.
- **Two regenerated files, additive-only.** `internal/db/models.go` (+23 / -0 lines: gained `AgentTemplate` + `HarnessAdapter` row types) and `internal/db/querier.go` (+5 / -0 lines: gained two methods on the `Querier` interface). No existing types or methods touched; users / organizations call sites unaffected.
- **All decisions honored.** Decision 11's narrowed projection produced `ListAgentTemplatesRow{ID, Name, Description, DefaultConfig}` — no `created_by_user_id`, no timestamps. Decision 3's nullable `adapter_image_ref` came through as `*string` via the global `emit_pointers_for_null_types` flag. Decision 7's `JSONB → []byte` mapping confirmed.
- **One sqlc-config quirk surfaced.** `agent_templates.created_by_user_id` (nullable UUID) generated as `pgtype.UUID`, not `*uuid.UUID`. Cause: `backend/sqlc.yaml`'s UUID override has no nullable variant, so `emit_pointers_for_null_types` falls through to sqlc's default mapping. Phase 2 doesn't *read* this column (it's not in the projection), so the quirk doesn't bite here. Flagged in "Known pending work" with a one-config-block fix for whenever M3/M4 wants `INSERT`s against `agent_templates`.
- **Validation matrix.** `go vet ./...` clean; `go build ./...` clean; `go test ./...` clean (existing `internal/users` tests still pass — no regression from the regen). Diff against HEAD on regenerated files: 28 insertions, 0 deletions.

---

## What was written, where, why

### File: `backend/queries/harness_adapters.sql`

Single query, deliberately tiny:

```sql
-- name: GetHarnessAdapterByID :one
SELECT * FROM harness_adapters WHERE id = $1;
```

**Why `SELECT *` here, not narrowed projection.** Different reasoning from `agent_templates.sql`. `harness_adapters` is *backend-internal* — its row type never crosses the Connect boundary (decision 11 omitted `HarnessAdapter` from the public proto contract). M3 will read every column on this row (it needs to update `adapter_image_ref` based on `harness_name`, possibly inspect `validated_at`, etc.). Narrow projection here would force a re-projection at the next phase. `SELECT *` is correct.

**Why a getter with no caller in M2.** The `adapters` package gets scaffolded in Phase 4 — a service with at least one method on a non-empty interface so it compiles cleanly and M3 has somewhere to add `UpdateImageRef` without a "scaffold the package now" prelude. Decision 13's rationale.

### File: `backend/queries/agent_templates.sql`

```sql
-- name: ListAgentTemplates :many
-- Narrowed projection (no SELECT *) — keeps created_by_user_id and timestamps
-- off the row type so the catalog service can't accidentally surface them.
-- M4 widens this or adds a sibling query when the deploy modal needs default_config.
SELECT id, name, description, default_config
FROM agent_templates
ORDER BY created_at ASC;
```

**Why the SQL comment.** sqlc propagates `--` comments above a query into the *generated Go function's* GoDoc and *into the `Querier` interface's method comment*. Verified post-regen — see `querier.go:18-20` and `agent_templates.sql.go:27-29`. Three benefits:

1. The reasoning lives next to the code that depends on it; future readers see "why is this projection narrow?" answered in the IDE hover.
2. If a contributor changes `SELECT id, name, description, default_config` to `SELECT *`, the comment becomes false — visible in code review without context-switching to a plan doc.
3. It's the only way to leave a comment that survives sqlc regen — comments inside the generated Go file would be stripped on the next regen.

**Why `default_config` *is* in the projection but `created_by_user_id` isn't.** `default_config` is needed by M4's deploy modal — projecting it now means the M4 service-layer code path is `query → service → handler` without a re-query. The Connect *response* (from decision 11) still won't carry `default_config` in M2; the field lives only in the row type, used internally if/when the service decides to surface it. Pre-projecting M4's needs doesn't violate decision 11 because the response shape is what `agents.proto` says, not what the row type contains. By contrast, `created_by_user_id` has no plausible reader before "user-defined templates" (post-v1) — projecting it now would be dead bytes on every catalog read forever.

**Why `ORDER BY created_at ASC`.** Stable, deterministic ordering. The catalog should render in the order templates were created — Hermes first, future templates after. Without `ORDER BY`, Postgres is free to return rows in any order, including a different order on each query. The FE's `key={t.id}` would still work, but the *visual* order would jitter across reloads. Cheap insurance.

### Generated: `backend/internal/db/harness_adapters.sql.go`

33 LOC, generates a `(q *Queries) GetHarnessAdapterByID(ctx, id) (HarnessAdapter, error)` method. Standard sqlc shape — `QueryRow` + `Scan` over the nine columns of the row type. Imports only `context` + `uuid`.

### Generated: `backend/internal/db/agent_templates.sql.go`

54 LOC, generates `(q *Queries) ListAgentTemplates(ctx) ([]ListAgentTemplatesRow, error)`. The row type is *narrow by construction* — exactly four fields, none of which carry the timestamps or `created_by_user_id`:

```go
type ListAgentTemplatesRow struct {
    ID            uuid.UUID `json:"id"`
    Name          string    `json:"name"`
    Description   string    `json:"description"`
    DefaultConfig []byte    `json:"default_config"`
}
```

This is **decision 11 + the column-projection-as-API-design insight enforced by the type system**. The catalog service in Phase 4 *physically cannot* leak `created_by_user_id` out — there's no field on `ListAgentTemplatesRow` to reference. The same pattern appears in `users.UpdateUserNameRow` (returns the full `User` because the caller needs it) versus what we just did here (return the catalog projection because the caller is a public-facing service). Choice of projection is choice of API surface.

The query body returns `nil` on error and `var items []Row` on the rows-loop path — sqlc's standard shape. The catalog service in Phase 4 does its own `make([]*proto, 0, len(rows))` to convert the nil-versus-empty case into a non-nil empty slice for FE wire stability (decision 28's empty-list test pins this contract). sqlc's nil-on-error is fine; nil-on-zero-rows is what the service wraps.

### Regenerated: `backend/internal/db/models.go`

23 lines added at the top, alphabetically before `Organization`:

```go
type AgentTemplate struct {
    ID               uuid.UUID          `json:"id"`
    Name             string             `json:"name"`
    Description      string             `json:"description"`
    HarnessAdapterID uuid.UUID          `json:"harness_adapter_id"`
    DefaultConfig    []byte             `json:"default_config"`
    CreatedByUserID  pgtype.UUID        `json:"created_by_user_id"`     // ← see Known pending work
    CreatedAt        pgtype.Timestamptz `json:"created_at"`
    UpdatedAt        pgtype.Timestamptz `json:"updated_at"`
}

type HarnessAdapter struct {
    ID                  uuid.UUID          `json:"id"`
    HarnessName         string             `json:"harness_name"`
    UpstreamImageDigest string             `json:"upstream_image_digest"`
    AdapterImageRef     *string            `json:"adapter_image_ref"`     // ← *string per emit_pointers_for_null_types
    Source              string             `json:"source"`
    GeneratedAt         pgtype.Timestamptz `json:"generated_at"`
    ValidatedAt         pgtype.Timestamptz `json:"validated_at"`
    CreatedAt           pgtype.Timestamptz `json:"created_at"`
    UpdatedAt           pgtype.Timestamptz `json:"updated_at"`
}
```

Note `AdapterImageRef *string` — the `emit_pointers_for_null_types: true` flag in `backend/sqlc.yaml` covers this. Plan decision 3 (M3 fills, then tightens to NOT NULL) is therefore typed correctly: today's nil pointer is the "M3 hasn't filled it yet" state, and dereferencing without a nil-check would panic — so the type system forces M3's reader code to handle the absence explicitly.

`Organization`, `User` types unchanged byte-for-byte — confirmed via `git diff --numstat` (23 insertions, 0 deletions).

### Regenerated: `backend/internal/db/querier.go`

5 lines added:

```go
type Querier interface {
    CreateUser(ctx context.Context, arg CreateUserParams) (User, error)
    GetHarnessAdapterByID(ctx context.Context, id uuid.UUID) (HarnessAdapter, error)        // new
    GetOrganizationByID(ctx context.Context, id uuid.UUID) (Organization, error)
    GetUserByAuthID(ctx context.Context, authUserID uuid.UUID) (User, error)
    // Narrowed projection (no SELECT *) — keeps created_by_user_id and timestamps        // SQL comment propagated into GoDoc
    // off the row type so the catalog service can't accidentally surface them.
    // M4 widens this or adds a sibling query when the deploy modal needs default_config.
    ListAgentTemplates(ctx context.Context) ([]ListAgentTemplatesRow, error)               // new
    UpdateOrganizationName(ctx context.Context, arg UpdateOrganizationNameParams) (Organization, error)
    UpdateUserName(ctx context.Context, arg UpdateUserNameParams) (User, error)
}

var _ Querier = (*Queries)(nil)
```

The interface gain is what enables Phase 4's private-interface pattern: `agents.templateQueries` will list only `ListAgentTemplates` (and later `GetAgentTemplateByID`); `adapters.adapterQueries` will list only `GetHarnessAdapterByID`. `*db.Queries` satisfies both interfaces structurally without anyone editing the wiring.

The 5+0 lines confirm Phase 2's "additive-only" promise. No existing methods renamed, no existing methods removed.

---

## Validation — full check matrix

### `go vet ./...` — clean

```
$ go vet ./...
$ echo $?
0
```

No warnings. Particularly important here: the new generated files reference `uuid.UUID`, `context.Context`, `pgtype.UUID`, and `pgtype.Timestamptz`, all already imported elsewhere — no new transitive vet concerns.

### `go build ./...` — clean

```
$ go build ./...
$ echo $?
0
```

Important: `cmd/api/main.go` builds without modification. The new `Queries` methods don't break the `users.NewService(queries)` + `organizations.NewService(queries, usersSvc)` call shapes — `*db.Queries` still satisfies the existing private interfaces in `users/` and `organizations/`. Phase 4 adds new packages; today's wiring is untouched.

### `go test ./...` — clean (no regression)

```
?   	github.com/hejijunhao/corellia/backend/cmd/api    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/auth    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/config    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/db    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/gen/...    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/httpsrv    [no test files]
?   	github.com/hejijunhao/corellia/backend/internal/organizations    [no test files]
ok  	github.com/hejijunhao/corellia/backend/internal/users    0.336s
```

Existing `users` test suite still green (3 cases from 0.2.5). New `agents` + `adapters` packages don't yet exist (Phase 4). Tests for `agents` will land in Phase 6 per decision 28.

### `git diff --numstat` confirmation of additivity

```
23  0  backend/internal/db/models.go
 5  0  backend/internal/db/querier.go
```

23 insertions / 0 deletions on `models.go`; 5 / 0 on `querier.go`. **Zero existing code touched.** This is the strongest possible form of regen safety — anything that compiled before still compiles, anything that linked before still links, anything that satisfied an interface before still satisfies it.

### `git status` — final state

```
 M backend/internal/db/models.go              ← regenerated, +23/-0
 M backend/internal/db/querier.go             ← regenerated, +5/-0
?? backend/internal/db/agent_templates.sql.go ← new generated
?? backend/internal/db/harness_adapters.sql.go ← new generated
?? backend/queries/agent_templates.sql        ← new query
?? backend/queries/harness_adapters.sql       ← new query
```

Six file deltas, all in scope. The migration file (`20260425170000_agent_catalog.sql`) shows as `A` (already staged from Phase 1's commit/working state) — Phase 2 didn't touch it.

---

## Behavior change (known)

- **Two new types in `internal/db`.** Anything that imports `db` can now reference `db.AgentTemplate`, `db.HarnessAdapter`, `db.ListAgentTemplatesRow`. Nothing currently does — the first reader is Phase 4's `agents.Service`.
- **Two new methods on `*db.Queries`.** `GetHarnessAdapterByID` and `ListAgentTemplates`. The `Querier` interface (used nowhere as a value type, only as a structural-typing satisfier check via `var _ Querier = (*Queries)(nil)`) now has two more methods. Existing services consume `*db.Queries` directly and structural-type satisfy whatever subset interface they declare — none of them list `GetHarnessAdapterByID` or `ListAgentTemplates`, so the interface gain is invisible to them.
- **No runtime behavior change.** The application binary boots, listens, serves the same RPCs identically. The new tables exist in the DB (Phase 1), the new types exist in Go (Phase 2), but no code path reads or writes the new tables yet. First runtime read happens in Phase 4 once the new RPC is registered and the catalog service exists.

---

## Findings flagged for follow-up

These are *Phase 2 findings*, not *Phase 2 deliverables*. None block Phase 3.

### Finding 1 — `created_by_user_id` is `pgtype.UUID`, not `*uuid.UUID`

**What.** Generated `AgentTemplate.CreatedByUserID` has type `pgtype.UUID`, despite `emit_pointers_for_null_types: true` being set in `sqlc.yaml`.

**Why.** sqlc's `overrides` block in `backend/sqlc.yaml` declares the UUID override only for non-nullable columns:

```yaml
overrides:
  - db_type: "uuid"
    go_type:
      import: "github.com/google/uuid"
      type: "UUID"
```

Without an explicit `nullable: true` sibling override, sqlc falls back to its default nullable-UUID mapping (`pgtype.UUID`) instead of pointer-wrapping the override target (`*uuid.UUID`). Known sqlc behavior — the global `emit_pointers_for_null_types` flag works for the *built-in* type mappings (text → `*string`) but doesn't compose with user-supplied overrides.

**Why this didn't bite Phase 2.** `ListAgentTemplates` doesn't project `created_by_user_id`. The column exists on `AgentTemplate` (the full row type, generated because `agent_templates` has at least one query that uses `RETURNING *` style — actually we don't, but sqlc generates the canonical row type anyway). It will bite the first phase that *reads or writes* `created_by_user_id`, almost certainly M3 or M4 when invitation flow lands.

**Fix when bite is imminent.** Add a sibling override:

```yaml
overrides:
  - db_type: "uuid"
    go_type:
      import: "github.com/google/uuid"
      type: "UUID"
  - db_type: "uuid"
    nullable: true
    go_type:
      import: "github.com/google/uuid"
      type: "*UUID"
```

Then `sqlc generate` and re-build. Expected diff: `pgtype.UUID` → `*uuid.UUID` everywhere a nullable UUID column appears, *plus* a `pgtype` import drop in `models.go` if no other column needs it. ~10-line config + regen change.

**Why not now.** Phase 2's plan compliance check would fail — the plan explicitly didn't list this config edit, and changing config during a regen phase muddles the additivity-of-this-phase story. M3 or M4's plan should pick it up explicitly.

### Finding 2 — sqlc generates the full `AgentTemplate` row type even though no query uses it

**What.** `models.go` has `type AgentTemplate { ID, Name, Description, HarnessAdapterID, DefaultConfig, CreatedByUserID, CreatedAt, UpdatedAt }` — the *full* table shape. But `agent_templates.sql` declares only `ListAgentTemplates :many` with a *narrowed* projection. Nothing returns the full `AgentTemplate`.

**Why this is fine.** sqlc generates the canonical row type for every table it sees in the schema, regardless of whether any query uses it. This is *expected* behavior, not a bug — it gives the codebase a typed handle on every table from day one, making future query additions trivial. The full `AgentTemplate` is just a few bytes of generated Go that nobody currently references; tree-shaking happens at link time, not at codegen time.

**Why I'm flagging it.** A reader of `models.go` might wonder "why is this full type here if nothing returns it?" Answer: sqlc convention. Mentioned here so the next phase's author doesn't go hunting for "the missing `:one` query that uses `AgentTemplate`" — there is none, by design.

### Finding 3 — comment-propagation behavior is a load-bearing-but-undocumented sqlc feature

**What.** The 3-line `--` comment above `ListAgentTemplates` in `agent_templates.sql` propagated into both the Go function's GoDoc *and* the `Querier` interface's method comment. This is the cleanest available channel for "leave a permanent rationale next to a regen-managed function."

**Why I'm flagging it.** It's used deliberately in this phase (to anchor decision 11's "narrowed projection" rationale where readers will actually see it), but it's worth noting as a *technique* the codebase can lean on more broadly. Future regen-managed code that has architectural rationale (e.g., M4's spawn handler if it ever reads from sqlc-generated code) can use the same `-- comment` channel.

---

## Known pending work

- **The `pgtype.UUID` → `*uuid.UUID` config tweak.** Per Finding 1. Land in M3 or M4 — whichever first writes a query reading or writing `created_by_user_id`.
- **No tests on `internal/agents/` or `internal/adapters/`.** Per plan; tests live in Phase 6 (decision 28). The two new packages don't even exist yet — Phase 4 writes them.
- **No FE consumption of the catalog yet.** Phase 5 territory. The TS regen for `agents.proto` happens in Phase 3.
- **Integration test against a live DB** for `ListAgentTemplates` returning the seed row. Not in this milestone's scope; would belong to a future testcontainers-based suite per CLAUDE.md "no DB mocks" rule.

---

## What's next — Phase 3 hand-off

Phase 3 (Proto + buf regen) lands the wire contract:

- **Pre-conditions:** ✅ Tables exist (Phase 1), ✅ typed Go queries exist (Phase 2). Both are read-only foundations Phase 3 doesn't touch.
- **Phase 3 work:** Write `shared/proto/corellia/v1/agents.proto` with one service + one RPC + three messages (per decision 11). Run `pnpm proto:generate`. Three new generated files expected: `internal/gen/corellia/v1/agents.pb.go`, `internal/gen/corellia/v1/corelliav1connect/agents.connect.go`, `frontend/src/gen/corellia/v1/agents_pb.ts`.
- **Phase 3 acceptance:** all three generated files committed; `go build ./...` and `pnpm -C frontend type-check` clean. No callers yet — Phase 3 only verifies generation produces valid stubs.
- **No prerequisite tooling concerns.** `buf` is required, available via `which buf` (or `brew install bufbuild/buf/buf`); `pnpm proto:generate` script is wired in `package.json` from 0.1.0.
