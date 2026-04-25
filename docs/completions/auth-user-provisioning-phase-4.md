# Auth User Provisioning — Phase 4 Completion

**Plan:** `docs/executing/auth-user-provisioning.md`
**Phase:** 4 of 4 — Tests + validation (plan §4 Task 7)
**Status:** backend unit + automated validation complete. Manual E2E smoke test (§7b) is the operator's remaining step and is documented below.
**Date:** 2026-04-24

---

## What landed

One test file, one tiny addition to the `auth` package, and a green validation matrix.

### Backend

| File | Kind | Summary |
|---|---|---|
| `backend/internal/auth/middleware.go` | edit | `ContextWithClaims(ctx, AuthClaims) context.Context` helper added — inverse of `FromContext`, closes over the same `ctxKey{}` |
| `backend/internal/users/service_test.go` | **new** | Three table-adjacent cases: `NotProvisioned`, `HappyPath`, `NoClaims`; uses a `fakeQueries` struct that satisfies the private `userQueries` interface via structural typing |

No frontend changes in this phase.

## Test coverage

```
=== RUN   TestGetCurrentUser_NotProvisioned
--- PASS: TestGetCurrentUser_NotProvisioned (0.00s)
=== RUN   TestGetCurrentUser_HappyPath
--- PASS: TestGetCurrentUser_HappyPath (0.00s)
=== RUN   TestGetCurrentUser_NoClaims
--- PASS: TestGetCurrentUser_NoClaims (0.00s)
PASS
```

- **`NotProvisioned`** — `fakeQueries` returns `pgx.ErrNoRows` from `GetUserByAuthID`; service must translate that to `users.ErrNotProvisioned` (asserted via `errors.Is`). This is the core contract the Phase 3 handler error-mapping switch depends on.
- **`HappyPath`** — populated `db.User` returned (including a non-nil `Name *string`); service must map all five fields (`Id`, `Email`, `OrgId`, `Role`, `Name`) into the proto `User` correctly. The `Name` assertion specifically exercises the `optional string name` → `*string` wire mapping introduced in Phase 2.
- **`NoClaims`** — plain `context.Background()` (no auth middleware); service must short-circuit to `users.ErrUnauthenticated`. The middleware normally rejects no-auth requests before the handler, but the service-level guard is defence-in-depth — this test pins the behaviour so a future middleware-ordering regression can't silently expose the service without claims.

## Why a test-package interface + fake is acceptable here

CLAUDE.md's testing conventions rule out mocking sqlc outputs: "sqlc generates thin SQL wrappers — mocking them tests nothing." This test doesn't mock them — it substitutes the `userQueries` interface the *service* declares, which lists two methods out of sqlc's five. The distinction matters:

- **Mocking sqlc:** constructing a fake `db.Queries` and asserting that `GetUserByAuthID` was called with some UUID. Tests nothing meaningful about the service (same test would pass with any trivial handler wrapping any query) and rots the moment sqlc adds a column.
- **Substituting `userQueries`:** the service owns the interface contract. The fake asserts on *service behaviour* — error-branch mapping, field-level proto construction, claim-path handling — none of which depend on SQL. The fake is the minimal test-double the contract allows.

The service file even declares the interface (`type userQueries interface { ... }`) scoped to exactly what the service calls; the test satisfying it is the payoff for that design choice.

`★ Insight ─────────────────────────────────────`
- **Phase 3's `userQueries` extraction is what makes this test lightweight.** If the service had kept `*db.Queries` as its declared dependency, the test would need a fake implementing all five `Querier` methods (or importing the generated `Queries` struct with a fake `db` connection) — an order of magnitude more plumbing for zero additional coverage.
- **`ContextWithClaims` is the first function in `auth/` written with a non-HTTP caller in mind.** Everything else there (`Middleware`, `NewJWKSVerifier`, `Keyfunc`) only ever runs inside the request path. Adding the test-path helper now is cheaper than adding it when the second test arrives.
`─────────────────────────────────────────────────`

## Deviations from the plan

1. **Added `TestGetCurrentUser_NoClaims` beyond the plan's two cases.** Plan §7a specifies "two cases: NotProvisioned and HappyPath." I added a third for the `ErrUnauthenticated` branch. Rationale: the branch exists in the service (`loadCurrentUser` returns `ErrUnauthenticated` when claims are missing), and the Phase 3 handler's `toConnectErr` switch maps it to `CodeUnauthenticated`. Both would silently break without a pinning test. Three short table-entries, not scope creep.
2. **`ContextWithClaims` took value, not pointer.** Plan §7a's sample code passed `auth.AuthClaims{...}` by value to the helper; the implementation mirrors that (`func ContextWithClaims(ctx, AuthClaims)`). Internally the helper wraps it as a `*AuthClaims` so `FromContext`'s pointer-return contract still holds. Callers get an ergonomic by-value API; the pointer-shape is hidden behind the opaque `ctxKey{}`.
3. **Used `got.GetXxx()` getters in the happy-path assertion instead of direct field access.** protoc-gen-go emits both `x.Name` (field) and `x.GetName()` (method). The getters are nil-safe (return the zero value on a nil receiver) and are the Google-style idiom — using them in tests models how real callers will read fields without littering `if x != nil` checks.

## Verification performed (the plan §6 validation summary)

| §6 item | Check | Result |
|---|---|---|
| Migration exists + applied | `goose status` + Phase 1 completion | ✅ |
| Dashboard smoke test (create + delete) | Requires Supabase dashboard UI | **Manual, pending operator** |
| `users.ErrNotProvisioned` exported; `GetCurrentUser` maps `pgx.ErrNoRows` | `go test ./internal/users/...` | ✅ |
| `backend/internal/organizations/` package exists with `GetOrganization` + `UpdateOrganizationName` | `ls backend/internal/organizations/` + `go build ./...` | ✅ |
| `shared/proto/corellia/v1/organizations.proto` exists; generated artefacts committed | `ls shared/proto/corellia/v1/`, `ls backend/internal/gen/.../organizations*`, `ls frontend/src/gen/.../organizations_pb.ts` | ✅ (generated; git add on commit) |
| `users.proto` includes `name` + `UpdateCurrentUserName`; `users.sql` includes `CreateUser` + `UpdateUserName` | inspection | ✅ |
| `httpsrv` mounts `OrganizationsService` + updated `UsersService` | `server.go:31-39` | ✅ |
| `go vet ./... && go build ./... && go test ./...` clean | scripted | ✅ |
| `pnpm -C frontend type-check && pnpm -C frontend lint` clean | scripted | ✅ |
| Dashboard renders email (provisioned) / not-provisioned copy (unprovisioned), no sign-in loop | Manual E2E | **Pending operator** |

## Manual E2E runbook (plan §7b)

Two manual steps the operator should run once before declaring the plan fully shipped. Neither needs code changes; both exercise the production path end to end.

### E2E-1 — Golden path (provisioned user)

1. `overmind start` from repo root (or `pnpm -C frontend dev` + `cd backend && air` individually).
2. Supabase dashboard → Authentication → Users → Add user → enable **Auto-confirm** → use a test email like `e2e-alice@example.com`.
3. Verify in psql:
   ```sql
   SELECT u.email, u.name, u.role, o.name AS org_name
   FROM public.users u JOIN public.organizations o ON u.org_id = o.id
   WHERE u.email = 'e2e-alice@example.com';
   ```
   Expect one row; `name IS NULL`; `role = 'admin'`; `org_name = 'e2e-alice''s Workspace'`. **This is also Phase 1's deferred smoke test** — killing two birds with one user.
4. Browser → `http://localhost:3000` → sign in with the e2e-alice credentials.
5. Expect dashboard to render `Signed in as e2e-alice@example.com`. No error banner. No redirect loop.

### E2E-2 — Permission-denied path (valid token, missing `public.users` row)

This exercises the `ErrNotProvisioned` → `CodePermissionDenied` → FE amber-panel path.

1. Keep the e2e-alice session from E2E-1 signed in (don't sign out).
2. In psql, surgically remove just the `public.users` row — leave `auth.users` intact:
   ```sql
   DELETE FROM public.users WHERE email = 'e2e-alice@example.com';
   ```
3. Refresh the dashboard in the browser.
4. Expect the amber "Your account isn't provisioned yet" panel. No red error message. No redirect to `/sign-in`. The access token is still valid — the middleware accepts it — but the service returns `ErrNotProvisioned` and the handler maps it to `PermissionDenied`.
5. Clean up: either re-insert the `public.users` row manually, or delete the `auth.users` row via the Supabase dashboard (which will cascade-delete the matching `public.users` row — which doesn't exist — and the org via the Phase 1 delete trigger).

### E2E-3 — Delete-side trigger (plan §4 Task 2 Smoke test, also deferred from Phase 1)

1. In the Supabase dashboard, delete the e2e-alice user.
2. In psql:
   ```sql
   SELECT count(*) FROM public.users WHERE email = 'e2e-alice@example.com';  -- expect 0
   SELECT count(*) FROM public.organizations WHERE name = 'e2e-alice''s Workspace';  -- expect 0
   ```
3. If both return 0, the cleanup trigger + "no other members" clause are working. If the user row remains, the trigger didn't fire (check `pg_trigger` and the `SECURITY DEFINER` privilege). If the org row remains, the `NOT EXISTS` subquery matched an unexpected row — likely a stale fixture.

## What is NOT covered by this plan (tracked for follow-ups)

Mirror of plan §8 + decisions deferred, plus items that surfaced during execution:

- **Onboarding wizard UI** — backend is primed (`User.Name`, `UpdateCurrentUserName`, `OrganizationsService.UpdateOrganizationName`). Next plan: `docs/plans/onboarding-wizard.md`.
- **Invitation flow / `CreateUser` Connect exposure** — the query exists; no RPC wired. Plan: `docs/plans/invitation-flow.md`.
- **Email-sync trigger** — if `auth.users.email` changes, `public.users.email` does not update. Add a third trigger (`AFTER UPDATE OF email ON auth.users`) if that drift becomes observable.
- **Backfill path for pre-trigger `auth.users` rows** — triggers only fire on future events. If the target project has any pre-existing auth rows without a matching `public.users`, those users will fail `GetCurrentUser` with `PermissionDenied` indefinitely. A one-shot `INSERT INTO public.users SELECT ... FROM auth.users WHERE NOT EXISTS (...)` script is the right fix if it becomes a real issue.
- **DB-backed integration test** — the current `service_test.go` uses the fake-queries pattern, which is a measured exception to CLAUDE.md's "no DB mocks" rule (see Phase 3 completion "Why a test-package interface + fake is acceptable" for the framing). If this pattern proliferates beyond this one file, migrate to testcontainers-go.
- **`CreateUser` query has `name` param but no proto plumbing yet** — intentional. The sqlc surface is schema-aligned so the invitation flow can adopt it without a regen cycle.

## What this unblocks

The `stack.md` §12 "hour-5 milestone" — signed-in, RPC round-trip working end-to-end against a real Supabase project — is now structurally complete. Pending the operator's E2E-1 run, the project is ready for:

- First non-`localhost` deploy (Vercel preview URL + Fly app).
- Onboarding-wizard plan authoring.
- Blueprint §10 product code: `HarnessAdapter`, `AgentTemplate` seeded with Hermes, `FlyDeployTarget.spawn()`, the RPG character-creation form.

The auth-user-provisioning plan is ready for the user-authored changelog entry (plan decision 14 explicitly kept changelog out of scope). The four completion docs (`phase-{1,2,3,4}.md`) are the durable record of what landed where and why — the changelog can reference them rather than duplicating the detail.
