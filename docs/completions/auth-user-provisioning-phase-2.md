# Auth User Provisioning — Phase 2 Completion

**Plan:** `docs/executing/auth-user-provisioning.md`
**Phase:** 2 of 4 — Contract layer (plan §4 Tasks 3 + 4)
**Status:** contract artifacts complete; **downstream `go build ./...` is blocked by an unrelated, intentional breakage from a parallel in-flight plan** (see §Blocker). Phase 3 paused.
**Date:** 2026-04-24

---

## What landed

The **FE↔BE contract surface** and the **sqlc query surface** have been expanded end-to-end to match the plan's Task 3 + Task 4 shape. All generated code emitted cleanly on the first run.

### Proto IDL (`shared/proto/corellia/v1/`)

- **`users.proto`** updated:
  - `UsersService` gains `UpdateCurrentUserName` RPC.
  - `User` gains `optional string name = 5`.
  - `UpdateCurrentUserNameRequest { string name = 1 }` / `UpdateCurrentUserNameResponse { User user = 1 }` messages added.
- **`organizations.proto`** (new):
  - `OrganizationsService` with `GetOrganization` + `UpdateOrganizationName` RPCs.
  - `Organization { string id = 1; string name = 2 }` message.
  - Matching request/response pairs.

### SQL queries (`backend/queries/`)

- **`users.sql`** updated — added `CreateUser` + `UpdateUserName`, kept `GetUserByAuthID`.
- **`organizations.sql`** (new) — `GetOrganizationByID` + `UpdateOrganizationName`.

### Generated outputs

| Pipeline | Command | Output |
|---|---|---|
| `buf generate` (from `shared/proto/`) | silent, 0 stderr | `backend/internal/gen/corellia/v1/{users.pb.go, organizations.pb.go}` + `.../corelliav1connect/{users.connect.go, organizations.connect.go}` + `frontend/src/gen/corellia/v1/{users_pb.ts, organizations_pb.ts}` |
| `sqlc generate` (from `backend/`) | silent, 0 stderr | `backend/internal/db/{users.sql.go, organizations.sql.go, querier.go, models.go}` (regenerated) |

`backend/internal/db/querier.go` now lists all five generated methods:

```go
type Querier interface {
    CreateUser(ctx context.Context, arg CreateUserParams) (User, error)
    GetOrganizationByID(ctx context.Context, id uuid.UUID) (Organization, error)
    GetUserByAuthID(ctx context.Context, authUserID uuid.UUID) (User, error)
    UpdateOrganizationName(ctx context.Context, arg UpdateOrganizationNameParams) (Organization, error)
    UpdateUserName(ctx context.Context, arg UpdateUserNameParams) (User, error)
}
```

## Files touched

| File | Kind | Notes |
|---|---|---|
| `shared/proto/corellia/v1/users.proto` | edit | +`UpdateCurrentUserName` rpc, +`optional string name` on `User` |
| `shared/proto/corellia/v1/organizations.proto` | **new** | Mirrors users.proto structure |
| `backend/queries/users.sql` | edit | +`CreateUser`, +`UpdateUserName` |
| `backend/queries/organizations.sql` | **new** | Two queries |
| `backend/internal/gen/corellia/v1/users.pb.go` | regen | `User.Name` now `*string` (protobuf `optional` → pointer) |
| `backend/internal/gen/corellia/v1/organizations.pb.go` | regen | new |
| `backend/internal/gen/corellia/v1/corelliav1connect/users.connect.go` | regen | new RPC method wired |
| `backend/internal/gen/corellia/v1/corelliav1connect/organizations.connect.go` | regen | new |
| `backend/internal/db/users.sql.go` | regen | +`CreateUser`, +`UpdateUserName`; scans now include `Name` |
| `backend/internal/db/organizations.sql.go` | regen | new |
| `backend/internal/db/models.go` | regen | `User.Name *string` appended |
| `backend/internal/db/querier.go` | regen | five-method interface |
| `frontend/src/gen/corellia/v1/users_pb.ts` | regen | includes new RPC + optional name |
| `frontend/src/gen/corellia/v1/organizations_pb.ts` | regen | new |

## Deviations from the plan

### Plan decision 16 (sqlc nullable-text override) was **not required**

Plan §4c prescribed adding an explicit override to `backend/sqlc.yaml`:

```yaml
- go_type:
    type: "string"
    pointer: true
  db_type: "text"
  nullable: true
```

…to force nullable `text` columns to emit as `*string`. The existing `sqlc.yaml` already sets `emit_pointers_for_null_types: true`, and the regen output confirms `User.Name *string` came out correctly from that setting alone. Adding the explicit override on top would be a functional no-op and would diverge from the "minimal config" approach that `emit_pointers_for_null_types` was chosen for in 0.1.0.

*Leaving `sqlc.yaml` untouched.* If a future nullable column comes in as `pgtype.Text` for some reason (e.g. a type sqlc doesn't cover under that flag), the override becomes the right tool. For now it would be premature.

`★ Insight ─────────────────────────────────────`
- `emit_pointers_for_null_types` is sqlc's **type-level** knob: nullable columns of *any* type emit as pointers (`*string`, `*time.Time`, `*int32`, etc.). Decision 16's override would have been a per-type carve-out for `text` specifically, which is redundant when the type-level flag is already doing the job universally.
- The protobuf `optional` keyword in proto3 → generated Go `*string` is a separate decision from the SQL-side nullable → `*string`, but they happen to align. That alignment is what lets the wire mapping be a direct pointer copy (Phase 3 will lean on this).
`─────────────────────────────────────────────────`

## Blocker before Phase 3 — unrelated pre-existing compile break

`go build ./...` currently fails at `backend/internal/httpsrv/server.go:32`:

```
d.Config.SupabaseJWTSecret undefined (type config.Config has no field or method SupabaseJWTSecret)
```

This is **not caused by Phase 2** — it predates the session. A parallel, in-flight plan (`docs/executing/auth-es256-migration.md`, referenced by `docs/completions/auth-es256-migration-phase{1,2}-completion.md`) is mid-migration from HS256 shared-secret validation to ES256 + JWKS:

- **Phase 1** (done): `@supabase/ssr` updates + new dependency `MicahParks/keyfunc/v3`.
- **Phase 2** (done): removed `SupabaseJWTSecret` field from `config.Config`; also removed the `SUPABASE_JWT_SECRET=` line from `.env.example` and `backend/.env`. The Phase-2 completion doc explicitly states the build was **intentionally** left broken at `server.go:32` as a hand-off artifact for Phase 4.
- **Phase 3** (pending): add `JWKSVerifier` (the file `backend/internal/auth/jwks.go` exists; `middleware.go` still uses the old `string` signature — so Phase 3 of the migration is **partially** in place but not finished).
- **Phase 4** (pending): rewire `httpsrv.Deps` + `main.go` to carry a `*JWKSVerifier` instead of a string secret.

The break is in a file I have not touched in this session. A clean `git stash` of only my changes would leave the break in place.

### Why this pauses my Phase 3

Plan §4 Task 5 (Phase 3 backend work) acceptance is `cd backend && go vet ./... && go build ./...` clean. That cannot be satisfied while `server.go:32` is broken, regardless of what I do to `users/`, `organizations/`, `httpsrv/users_handler.go`, `httpsrv/organizations_handler.go`, or `main.go`.

Additionally, the auth-es256 Phase 3 completion doc notes that `auth.FromContext` signature will be touched by *that* plan — the same function `users/service.go:21` reads from. Two simultaneous in-flight edits to the same auth surface would collide.

### Recommended unblock sequence

Two sane orderings, user's call:

1. **Finish auth-es256-migration first.** Complete its Phase 3 (rewrite `middleware.go` to take `*JWKSVerifier`) and Phase 4 (`httpsrv.Deps` + `main.go` rewire). Then `go build ./...` is clean, `auth` package is in its final shape, and auth-user-provisioning Phase 3 proceeds against a stable surface.
2. **Suspend auth-es256-migration, force-compile on this branch.** Temporarily restore `SupabaseJWTSecret` (via `git checkout HEAD -- backend/internal/config/config.go`, and unstage the `.env` edit) so the build passes, finish auth-user-provisioning Phase 3 + 4, then re-apply the ES256 migration. Riskier — the two plans would end up in competing diffs for the same `auth` package and the same `config.go`, and the auth-user-provisioning Phase 3 error-mapping in `users_handler.go` would need to be reconciled with any further `middleware.go` changes.

**My recommendation is #1.** The auth-es256 Phase 4 is small and scoped (two files per its own completion doc); knocking it out first leaves one moving piece on the auth surface instead of two, and the auth-user-provisioning Phase 3 code below gets to land against a working build from the first go.

## What is still green (not blocked)

- The Phase 1 migration (already applied) — unaffected.
- All generated artifacts in this phase — `buf generate` and `sqlc generate` both read only from proto + SQL and don't care about Go compile state.
- `frontend/` type-check + lint should still pass independently (not verified in this pass; frontend doesn't import the broken Go package transitively via anything except the wire format).

## Next phase — on hold pending blocker resolution

Phase 3 (plan §4 Task 5 + Task 6) is fully planned and ready. Pseudocode for each file — `users/service.go`, `organizations/service.go` (new), `httpsrv/users_handler.go`, `httpsrv/organizations_handler.go` (new), `cmd/api/main.go`, `frontend/src/lib/api/client.ts`, `frontend/src/app/dashboard/page.tsx` — will land the moment the build is clean.
