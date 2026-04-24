# Plan — Auto-provisioning + Org/User scaffolding

**Status:** approved, ready to execute
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/changelog.md` §0.2.1 (seeding removed; provisioning gap opened)
- `docs/changelog.md` §0.2.0 "Known pending work" — local bring-up blocked on provisioning
- `docs/blueprint.md` §9 (data model), §10 (RPG-character-creation flow)
- `docs/stack.md` §6 (data model ↔ Supabase), §11.6 (no Supabase specifics outside `internal/auth` + `internal/db`)

---

## 1. Objective

Close the last blocker between the scaffolded pipeline and the first end-to-end sign-in, and use the same pass to scaffold the layers the near-term roadmap will need anyway.

- **Provisioning (primary).** A row landing in `auth.users` — dashboard-created, future signup flow, admin API, anywhere — atomically creates an `organizations` row and a `public.users` row referencing it. Symmetrically, deleting the auth row cleans up its `public.users` row and the org *iff no other users reference it* (Pattern-A-correct now; Pattern-C-safe later). Go code is unchanged for provisioning to work — the trigger is the caller.
- **Org layer scaffolded eagerly (end-to-end).** Queries + proto + domain package. Per decision §2/8.
- **User layer expanded (primers for the onboarding wizard).** `name` column, `UpdateCurrentUserName` RPC, plus a pre-scaffolded `CreateUser` query held for the future invitation flow.

After this pass, `GetCurrentUser` finds rows it previously couldn't. The stack.md §12 hour-5 milestone ("deployed, signed-in, RPC working") becomes achievable.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Provisioning mechanism | Postgres trigger on `AFTER INSERT ON auth.users` | Atomic with the auth insert; fires regardless of entry point; Supabase's canonical shape |
| 2 | Org-assignment policy (v1) | Pattern A — one new Organisation per new user | Matches vision.md's founder / solopreneur / head-of-department persona; multi-user-per-org deferred per blueprint §13 |
| 3 | Org-assignment policy (v2) | Invitation-table-driven | Right upgrade path; trigger is a single-file swap |
| 4 | Default org name | `split_part(NEW.email, '@', 1) \|\| '''s Workspace'` | e.g. `alice's Workspace`. Onboarding wizard (follow-up plan) lets users rename |
| 5 | User role on auto-provision | `'admin'` | Pattern A — every signup admins their own org |
| 6 | Security posture | `SECURITY DEFINER` + `SET search_path = public, pg_temp` | Function runs in auth-role context but writes `public.*`; fixed search_path closes a classic privilege-escalation vector |
| 7 | Delivery | Goose migration at `backend/migrations/20260424140000_auth_user_provisioning.sql` | Every DB function/trigger in version control — general DB-engineering rule |
| 8 | Org-layer scaffolding | **Option B — eager end-to-end**: queries + proto + domain package | User call: "we'll definitely need Orgs, so might as well get the basics up for it" |
| 9 | User-layer expansion | `name TEXT NULL` column + `CreateUser` query + `UpdateCurrentUserName` RPC | User call: primes schema for onboarding wizard; `CreateUser` pre-scaffolded per explicit request for future invite flow |
| 10 | Delete-side trigger | Bundled in same migration; deletes `public.users` row; deletes org iff no other members | User call: "provision and delete are two sides of the same coin". No-other-members clause keeps Pattern C safe |
| 11 | Handler error mapping | Bundled | `pgx.ErrNoRows` → `users.ErrNotProvisioned` sentinel → `connect.CodePermissionDenied` on the wire |
| 12 | FE not-provisioned state | Bundled | Dashboard renders dedicated copy when BE returns `PermissionDenied` |
| 13 | Unit test for `ErrNotProvisioned` | Basic — interface extraction + fake queries (no testcontainers this pass) | Deviates from CLAUDE.md "no DB mocks" rule in spirit but arguably not in letter: we're testing error-branching *Go* logic, not SQL correctness. Flag in changelog for future review |
| 14 | Changelog for this plan | **Out of plan scope** | User writes changelog entry manually after the pass lands |
| 15 | `UpdateCurrentUserName` + `UpdateOrganizationName` RPCs | Keep both in this pass | CLAUDE.md flags half-finished implementations as an antipattern — `name` column with no mutation path is exactly that. Onboarding wizard (next plan) needs both day-one; pulling them just re-opens the same five files (proto, sqlc, service, handler, main.go) next week. Preserves symmetry with decision 8 (eager scaffolding) |
| 16 | sqlc nullable-text handling | Add `text` nullable → `*string` override in `sqlc.yaml` | Consistency with the 0.1.0 `uuid → google/uuid.UUID` override pattern. `pgtype.Text` forces `.Valid` checks at every proto-mapping site; `*string` → proto `optional string` is a direct translation. Less boilerplate, fewer silent-null-check footguns |

### Decisions deferred (revisit when named caller arrives)

- **Onboarding wizard UI.** Backend shape is primed in this pass (`name` column, both `Update*Name` RPCs). FE wizard is a separate follow-up plan.
- **`CreateUser` Connect-RPC exposure.** Query exists; no method on `UsersService` yet. Add when the invitation flow lands.
- **Additional Organisation CRUD** (create by admin, delete, list). None are v1 needs. Add alongside callers.
- **`User` proto embedding `Organization`.** Default stays: `User.org_id` remains a string; callers issue a separate `GetOrganization` if they need the name.

### Follow-up plans (to be written after this lands)

- **`docs/plans/onboarding-wizard.md`** — FE wizard prompting for user name + org name override on first login, calling `UpdateCurrentUserName` + `UpdateOrganizationName`. BE is ready.
- **`docs/plans/invitation-flow.md`** — email-based invitations, `invitations` table, trigger branch, `CreateUser` RPC exposure.

---

## 3. Pre-work checklist

Before Task 1, confirm:

- [ ] `backend/.env` populated with real `DATABASE_URL_DIRECT` (direct connection, `db.<ref>.supabase.co:5432` — not the pooler).
- [ ] `backend/.env` also has a populated `DATABASE_URL` (needed by the backend binary at Task 6; not strictly required for Task 2).
- [ ] `direnv allow` run in `backend/`. Verify with `echo $DATABASE_URL_DIRECT` from inside `backend/` — non-empty value expected.
- [ ] Initial migration (`20260424120000_initial_schema.sql`) already applied. `goose -dir migrations postgres "$DATABASE_URL_DIRECT" status` shows it `Applied`.
- [ ] Target Supabase project has zero rows in `public.users` / `public.organizations` (fresh state).

---

## 4. Implementation tasks

Execute in the order listed. Tasks 3 and 4 can be parallelised. Task 5 depends on both.

### Task 1 — Schema migration file

**File:** `backend/migrations/20260424140000_auth_user_provisioning.sql`

Three changes, one atomic migration:
1. `ALTER TABLE public.users ADD COLUMN name TEXT NULL` — primer for the onboarding wizard.
2. Provisioning trigger: `public.handle_new_auth_user()` + `on_auth_user_created` on `auth.users`.
3. Cleanup trigger: `public.handle_deleted_auth_user()` + `on_auth_user_deleted` on `auth.users`.

**Content:**

```sql
-- +goose Up

-- 1. Schema primer for onboarding wizard.
ALTER TABLE public.users ADD COLUMN name TEXT NULL;

-- 2. Provisioning trigger.
--
-- On new auth.users row, create a fresh organization and the matching
-- public.users row linked to it. Runs in the same transaction as the
-- auth.users INSERT, so either both rows land or neither does — no
-- dangling auth users without a public record.
--
-- SECURITY DEFINER + fixed search_path is required: the function is
-- invoked in the auth role's context but writes public.*, and without
-- an explicit search_path it is a classic privilege-escalation target.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO public.organizations (name)
  VALUES (split_part(NEW.email, '@', 1) || '''s Workspace')
  RETURNING id INTO new_org_id;

  INSERT INTO public.users (auth_user_id, email, org_id, role)
  VALUES (NEW.id, NEW.email, new_org_id, 'admin');

  RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Cleanup trigger.
--
-- On auth.users DELETE, remove the matching public.users row, then
-- remove the org iff it has no other members. Pattern-A-correct
-- (one admin per org; deleting the admin removes the workspace) and
-- Pattern-C-safe (if v2 adds invitations, multi-member orgs survive
-- because the IF EXISTS check fires).

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.handle_deleted_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_org_id UUID;
BEGIN
  SELECT org_id INTO old_org_id
  FROM public.users
  WHERE auth_user_id = OLD.id;

  DELETE FROM public.users WHERE auth_user_id = OLD.id;

  IF old_org_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE org_id = old_org_id
  ) THEN
    DELETE FROM public.organizations WHERE id = old_org_id;
  END IF;

  RETURN OLD;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deleted_auth_user();

-- +goose Down
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
DROP FUNCTION IF EXISTS public.handle_deleted_auth_user();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
ALTER TABLE public.users DROP COLUMN IF EXISTS name;
```

**Acceptance:**
- File exists at the specified path.
- Each function body is fenced with `-- +goose StatementBegin` / `-- +goose StatementEnd`.
- Down block is the strict reverse of Up (last-in, first-out).

---

### Task 2 — Apply migration + DB-level smoke test

From `backend/` (direnv has exported `DATABASE_URL_DIRECT`):

```bash
goose -dir migrations postgres "$DATABASE_URL_DIRECT" up
```

Expected output: `OK 20260424140000_auth_user_provisioning.sql`.

**Verify schema state** via `psql "$DATABASE_URL_DIRECT"`:
- `\d public.users` — shows new `name` column, nullable.
- `\df public.handle_new_auth_user` — function exists.
- `\df public.handle_deleted_auth_user` — function exists.
- `SELECT tgname FROM pg_trigger WHERE tgname IN ('on_auth_user_created', 'on_auth_user_deleted');` — returns two rows.

**Smoke test — create path.** Supabase dashboard → Authentication → Users → Add user → Create new user. Use a test email, enable "Auto-confirm". Then:

```sql
SELECT u.id, u.email, u.name, u.role, o.name AS org_name
FROM public.users u
JOIN public.organizations o ON u.org_id = o.id
WHERE u.email = '<smoke-test-email>';
```

Expect: one row; `name IS NULL`; `role = 'admin'`; `org_name` matches `<email-local-part>'s Workspace`.

**Smoke test — delete path.** Delete the smoke-test user via dashboard. Then:

```sql
SELECT count(*) FROM public.users WHERE email = '<smoke-test-email>';
SELECT count(*) FROM public.organizations WHERE name = '<expected-workspace-name>';
```

Expect: both `0`. (Pattern A — one user per org — so the org is cleaned up as well.)

**Acceptance:** both smoke tests pass. No orphan rows.

**Failure modes to watch for:**
- `permission denied for schema auth` → using the pooler URL by accident. Confirm `$DATABASE_URL_DIRECT` is set and points at the direct connection, not Supavisor.
- Trigger doesn't fire → re-check that the functions compiled (watch for silent PL/pgSQL errors in the goose output).
- Duplicate key on `public.users.email` → stale row from 0.1.0 seed era. Clean up `public.users` / `public.organizations` and retry.

---

### Task 3 — Proto additions + regen

Two files.

**3a. `shared/proto/corellia/v1/users.proto` — updated:**

```proto
syntax = "proto3";
package corellia.v1;

option go_package = "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1;corelliav1";

service UsersService {
  rpc GetCurrentUser(GetCurrentUserRequest) returns (GetCurrentUserResponse);
  rpc UpdateCurrentUserName(UpdateCurrentUserNameRequest) returns (UpdateCurrentUserNameResponse);
}

message GetCurrentUserRequest {}
message GetCurrentUserResponse { User user = 1; }

message UpdateCurrentUserNameRequest { string name = 1; }
message UpdateCurrentUserNameResponse { User user = 1; }

message User {
  string id = 1;
  string email = 2;
  string org_id = 3;
  string role = 4;
  optional string name = 5;
}
```

**3b. `shared/proto/corellia/v1/organizations.proto` — new:**

```proto
syntax = "proto3";
package corellia.v1;

option go_package = "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1;corelliav1";

service OrganizationsService {
  rpc GetOrganization(GetOrganizationRequest) returns (GetOrganizationResponse);
  rpc UpdateOrganizationName(UpdateOrganizationNameRequest) returns (UpdateOrganizationNameResponse);
}

message Organization {
  string id = 1;
  string name = 2;
}

message GetOrganizationRequest { string id = 1; }
message GetOrganizationResponse { Organization organization = 1; }

message UpdateOrganizationNameRequest {
  string id = 1;
  string name = 2;
}
message UpdateOrganizationNameResponse { Organization organization = 1; }
```

**Regenerate** from repo root:

```bash
pnpm proto:generate
```

**Acceptance:**
- `backend/internal/gen/corellia/v1/users.pb.go` includes `UpdateCurrentUserNameRequest/Response` types and `User.Name` field (likely `*string` for the `optional`).
- `backend/internal/gen/corellia/v1/organizations.pb.go` + Connect shim exist.
- `frontend/src/gen/corellia/v1/organizations_pb.ts` exists.
- Existing generated Go + TS still compiles and type-checks.

---

### Task 4 — SQL additions + sqlc regen

Two query files plus a one-line extension to the sqlc config (per decision 16).

**4a. `backend/queries/users.sql` — updated:**

```sql
-- name: GetUserByAuthID :one
SELECT * FROM users WHERE auth_user_id = $1;

-- name: CreateUser :one
INSERT INTO users (auth_user_id, email, org_id, role, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateUserName :one
UPDATE users SET name = $2, updated_at = now()
WHERE id = $1
RETURNING *;
```

**4b. `backend/queries/organizations.sql` — new:**

```sql
-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: UpdateOrganizationName :one
UPDATE organizations SET name = $2, updated_at = now()
WHERE id = $1
RETURNING *;
```

**4c. `backend/sqlc.yaml` — extended.**

The 0.1.0 config already overrides `uuid` → `google/uuid.UUID`. Add a parallel override so nullable `text` columns (e.g. the new `users.name`) emit as `*string` rather than `pgtype.Text`. The exact key name varies by sqlc minor version — check the existing overrides block and add:

```yaml
overrides:
  # existing uuid override stays as-is
  - go_type:
      type: "string"
      pointer: true
    db_type: "text"
    nullable: true
```

If the current sqlc version rejects this shape, the alternative is a per-column override scoped to `public.users.name`; prefer the type-level form for consistency if it's accepted.

**Regenerate** from `backend/`:

```bash
sqlc generate
```

**Acceptance:**
- `backend/internal/db/users.sql.go` regenerated with `CreateUser`, `UpdateUserName`.
- `backend/internal/db/organizations.sql.go` new, with `GetOrganizationByID`, `UpdateOrganizationName`.
- `backend/internal/db/models.go` regenerated: `User.Name` is `*string` (not `pgtype.Text`). If it comes out as `pgtype.Text`, the sqlc override from 4c didn't land — fix the config and re-generate before proceeding.

---

### Task 5 — Backend domain + handlers

**5a. `backend/internal/users/service.go` — updated:**

- Add sentinel: `var ErrNotProvisioned = errors.New("user not provisioned")`.
- Extract `userQueries` interface (methods the service actually calls):
  ```go
  type userQueries interface {
      GetUserByAuthID(ctx context.Context, authUserID uuid.UUID) (db.User, error)
      UpdateUserName(ctx context.Context, arg db.UpdateUserNameParams) (db.User, error)
  }
  ```
  Change `Service.queries` field type from `*db.Queries` to `userQueries`. `NewService` signature stays — `*db.Queries` satisfies the interface by structural typing.
- `GetCurrentUser`: `if errors.Is(err, pgx.ErrNoRows) { return nil, ErrNotProvisioned }` before the generic error return.
- Add `UpdateCurrentUserName(ctx, name)`: pulls claims from context, finds the user's id via `GetUserByAuthID`, calls `UpdateUserName`, maps to proto.
- Wire `User.Name` mapping (nullable column → `*string` → proto `optional string name`).

**5b. `backend/internal/organizations/service.go` — new:**

- Package `organizations`. Mirror the `users` package shape.
- `orgQueries` interface + `Service` struct + `NewService`.
- Methods: `GetOrganization(ctx, id)`, `UpdateOrganizationName(ctx, id, name)`.
- **Authorisation:** both methods must verify the caller's `auth.AuthClaims` resolves to a `public.users` row whose `org_id` matches the requested `id`. Implementation choice: inject a `userLookup` function-or-interface that returns the caller's org id, rather than pulling in the whole `users.Service`. Keeps the two packages loosely coupled.
- On authz failure → return a sentinel like `organizations.ErrForbidden` (or reuse `users.ErrNotProvisioned` if the lookup returns that first).

**5c. `backend/internal/httpsrv/users_handler.go` — updated:**

- Add `UpdateCurrentUserName` handler method (<30 lines).
- Replace the current blanket `connect.CodeUnauthenticated` error mapping with a switch:
  ```go
  switch {
  case errors.Is(err, users.ErrNotProvisioned):
      return nil, connect.NewError(connect.CodePermissionDenied, err)
  case err != nil:
      return nil, connect.NewError(connect.CodeInternal, err)
  }
  ```
- Unauthenticated (no claims in context) remains `connect.CodeUnauthenticated`; it's a separate branch before the service call.

**5d. `backend/internal/httpsrv/organizations_handler.go` — new:**

- Thin transport glue. `GetOrganization` / `UpdateOrganizationName` handlers, each <30 lines.
- Same error-mapping pattern as updated `users_handler.go`.

**5e. `backend/cmd/api/main.go` — updated:**

- Instantiate `organizations.Service` with its query dependencies.
- Mount the new Connect handler alongside the existing `UsersService` handler.

**Acceptance:**
- `cd backend && go vet ./... && go build ./...` clean.
- `go test ./...` clean (new test arrives in Task 7).

---

### Task 6 — Frontend additions

**6a. `frontend/src/app/dashboard/page.tsx` — updated:**

- On RPC error, distinguish `ConnectError.code === Code.PermissionDenied` from generic errors.
- For `PermissionDenied`, render dedicated copy: *"Your account isn't provisioned yet — contact an admin."* (Exact wording TBD at commit time.)
- Other errors render the existing generic state.

**6b. `frontend/src/lib/api/client.ts` — updated:**

- Add `organizations: createClient(OrganizationsService, transport)` alongside the existing `users` key. No component consumes it in this pass; it's exposed so the onboarding wizard plan can import `api.organizations` on day one.

**6c. Generated FE client.** Auto-emitted by `pnpm proto:generate` in Task 3. No hand-edit.

**Acceptance:**
- `pnpm -C frontend type-check && pnpm -C frontend lint` clean.
- Manual: simulate `PermissionDenied` by deleting a user's `public.users` row directly in psql while keeping the `auth.users` row intact; sign in with that user; expect the dedicated copy, not a sign-in loop or generic error.

---

### Task 7 — Tests

**7a. Unit test — `backend/internal/users/service_test.go` (new):**

Basic, two cases: `GetCurrentUser` maps `pgx.ErrNoRows` to `ErrNotProvisioned`; happy path returns a populated `User`.

```go
package users_test

import (
    "context"
    "errors"
    "testing"

    "github.com/google/uuid"
    "github.com/hejijunhao/corellia/backend/internal/auth"
    "github.com/hejijunhao/corellia/backend/internal/db"
    "github.com/hejijunhao/corellia/backend/internal/users"
    "github.com/jackc/pgx/v5"
)

type fakeQueries struct {
    getResult db.User
    getErr    error
}

func (f *fakeQueries) GetUserByAuthID(_ context.Context, _ uuid.UUID) (db.User, error) {
    return f.getResult, f.getErr
}
func (f *fakeQueries) UpdateUserName(_ context.Context, _ db.UpdateUserNameParams) (db.User, error) {
    return db.User{}, nil
}

func TestGetCurrentUser_NotProvisioned(t *testing.T) {
    s := users.NewService(&fakeQueries{getErr: pgx.ErrNoRows})
    ctx := auth.ContextWithClaims(context.Background(), auth.AuthClaims{
        AuthUserID: uuid.New(),
        Email:      "test@example.com",
    })
    if _, err := s.GetCurrentUser(ctx); !errors.Is(err, users.ErrNotProvisioned) {
        t.Fatalf("want ErrNotProvisioned, got %v", err)
    }
}
```

> **Note for the implementer:** `auth.ContextWithClaims` is a placeholder — use whatever the existing `auth` package exports for constructing a claims-bearing context (e.g. the inverse of `auth.FromContext`). If no such helper exists, either add one (preferred) or inline the context key.

**Tradeoff acknowledgement.** This deviates from CLAUDE.md's "no DB mocks" rule in spirit but not in letter — the fake substitutes the query interface to test *error-branching Go logic*, not SQL correctness. If this pattern spreads, revisit with testcontainers-go.

**7b. End-to-end test — manual:**

1. `overmind start` from repo root.
2. Create a fresh test user in Supabase dashboard (auto-confirm email).
3. Browser → `http://localhost:3000` → sign in with the test user.
4. Expect: dashboard renders the test user's email.

**Acceptance:**
- `go test ./internal/users/...` passes.
- E2E manual test passes — dashboard renders email; no sign-in loop.

---

### Task 8 — Follow-ups tracked (not implemented)

Outside the code, for the user-authored changelog entry's "Known pending work":

- **Onboarding wizard UI** — backend primed (`name` column, both `Update*Name` RPCs). New plan: `docs/plans/onboarding-wizard.md`.
- **`CreateUser` RPC exposure** — query exists; invitation flow adds the Connect method.
- **Email-sync trigger** for `auth.users` email updates → `public.users.email`.
- **Richer Organisation CRUD** — add as FE callers emerge.
- **Dashboard "Welcome to [Org Name]"** — now that `OrganizationsService.GetOrganization` exists; trivial follow-up.
- **Revisit unit-test pattern** — if the interface + fake approach spreads, migrate to testcontainers-go per CLAUDE.md conventions.

---

## 5. Rollback plan

```bash
# from backend/
goose -dir migrations postgres "$DATABASE_URL_DIRECT" down
```

Runs the migration's Down block. Drops both triggers, both functions, the `name` column. Application rows in `public.users` / `public.organizations` are **not** removed — those are data, not schema artefacts. `IF EXISTS` clauses keep the Down block re-runnable.

Git-level rollback of the proto / SQL / Go / FE changes: standard `git revert` of the commit(s).

---

## 6. Validation summary

End of this plan, all true:

- [ ] Migration file exists at `backend/migrations/20260424140000_auth_user_provisioning.sql` and is applied.
- [ ] Creating a user in Supabase dashboard creates matching `public.users` + `public.organizations` rows; deleting that user removes both.
- [ ] `users.ErrNotProvisioned` exported; `GetCurrentUser` maps `pgx.ErrNoRows` to it.
- [ ] `backend/internal/organizations/` package exists with `GetOrganization` + `UpdateOrganizationName`.
- [ ] `shared/proto/corellia/v1/organizations.proto` exists; generated Go + TS artefacts committed.
- [ ] `users.proto` includes `name` and `UpdateCurrentUserName` RPC; `users.sql` includes `CreateUser` + `UpdateUserName`.
- [ ] `httpsrv` mounts `OrganizationsService` handler and the updated `UsersService` handler.
- [ ] `go vet ./... && go build ./... && go test ./...` clean.
- [ ] `pnpm -C frontend type-check && pnpm -C frontend lint` clean.
- [ ] Dashboard: provisioned user sees their email; not-provisioned user sees the dedicated copy, not a sign-in loop.

---

## 7. What this unblocks

- **stack.md §12 hour-5 milestone** — signed-in, RPC round-trip working end-to-end.
- **Onboarding wizard plan** — FE work against existing RPCs.
- **Vercel + Fly deploy** — first non-`localhost` `FRONTEND_ORIGIN` exercise.
- **Product code per blueprint §10** — RPG character-creation flow. `HarnessAdapter`, `AgentTemplate` seeded with Hermes, `FlyDeployTarget.spawn()`.

---

## 8. Non-goals

Deliberately out of scope for this pass:

- Onboarding wizard UI itself — separate plan.
- Invitation flow (Pattern C) — v2 per blueprint §13.
- RLS policies — disabled in v1 per blueprint §6 / stack.md §6.
- Sync between Supabase auth email updates and `public.users.email`.
- Soft delete / audit trail — audit log deferred per blueprint §13.
- Dashboard "Welcome to [Org Name]" — lands with the onboarding wizard.
- Full Organisation CRUD beyond `GetOrganization` + `UpdateOrganizationName`.

---

## 9. Open questions — resolved

All eight items from the prior revision are settled.

| # | Question | Resolution |
|---|---|---|
| 9.1 | Org name format | `split_part(email, '@', 1) \|\| '''s Workspace'` (default hook); onboarding wizard will allow override |
| 9.2 | Org-layer scaffolding timing | Option B — eager end-to-end; User layer similarly expanded (`CreateUser` pre-scaffolded) |
| 9.3 | Bundle Task 5 (handler error mapping)? | Yes |
| 9.4 | Bundle Task 6 (FE not-provisioned state)? | Yes |
| 9.5 | Unit test for `ErrNotProvisioned`? | Basic (interface + fake); revisit with testcontainers if pattern spreads |
| 9.6 | `ON DELETE` semantics for `auth.users` → `public.users`? | Bundled in this migration; org cleaned up iff no other members |
| 9.7 | Changelog for this pass? | Out of scope — user handles manually |
| 9.8 | Pre-flight readiness | Pending — checkboxes in §3, resolved at execution time |
