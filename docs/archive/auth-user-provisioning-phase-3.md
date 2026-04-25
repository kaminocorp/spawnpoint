# Auth User Provisioning — Phase 3 Completion

**Plan:** `docs/executing/auth-user-provisioning.md`
**Phase:** 3 of 4 — Application layer (plan §4 Tasks 5 + 6)
**Status:** complete. `go vet ./...`, `go build ./...`, `pnpm type-check`, `pnpm lint` all clean.
**Date:** 2026-04-24

---

## What landed

The domain + transport + frontend layers that consume the Phase 2 contracts. Every new RPC from the proto files now has a handler, a service method, and (for users) a frontend state to render.

### Backend

| File | Kind | Summary |
|---|---|---|
| `backend/internal/users/service.go` | rewrite | `ErrUnauthenticated` + `ErrNotProvisioned` sentinels; private `userQueries` interface; `loadCurrentUser` helper; new `UpdateCurrentUserName` + `CallerOrgID` methods; `Name` mapped through to proto |
| `backend/internal/organizations/service.go` | **new** | `ErrForbidden` + `ErrNotFound` sentinels; `orgQueries` + `userLookup` interfaces; `GetOrganization` + `UpdateOrganizationName`, both gated by an equality-based `authorize` check |
| `backend/internal/httpsrv/users_handler.go` | rewrite | `UpdateCurrentUserName` handler method; `toConnectErr` switch replaces the old blanket `CodeUnauthenticated` wrap |
| `backend/internal/httpsrv/organizations_handler.go` | **new** | `GetOrganization` + `UpdateOrganizationName` handlers; parallel `orgErrToConnect` switch |
| `backend/internal/httpsrv/server.go` | edit | `Deps.OrganizationsHandler` added; both Connect handlers mounted inside the auth-middleware group |
| `backend/cmd/api/main.go` | edit | `organizations.NewService(queries, usersSvc)` wiring + `OrganizationsHandler` passed into `Deps` |

### Frontend

| File | Kind | Summary |
|---|---|---|
| `frontend/src/lib/api/client.ts` | edit | `organizations: createConnectClient(OrganizationsService, transport)` exposed alongside `users` |
| `frontend/src/app/dashboard/page.tsx` | rewrite | Four-state discriminated union (`loading \| ready \| not-provisioned \| error`); `ConnectError.code === Code.PermissionDenied` branches to the dedicated "not provisioned" panel |

## How the error mapping works now

Before: the handler did `return nil, connect.NewError(connect.CodeUnauthenticated, err)` for *every* service error. That collapsed four meaningfully different failure modes (missing token, invalid token, provisioning gap, DB error) into one wire code — making it impossible for the FE to distinguish "sign in again" from "ask your admin."

After: errors are sorted at the handler boundary via `errors.Is` against typed sentinels:

```
ErrUnauthenticated  →  Unauthenticated   (401-ish; FE sends the user back to /sign-in)
ErrNotProvisioned   →  PermissionDenied  (403-ish; FE renders the provisioning panel)
ErrForbidden (org)  →  PermissionDenied  (same shape; FE future work will distinguish)
ErrNotFound (org)   →  NotFound          (404-ish)
<anything else>     →  Internal          (500-ish; FE surfaces the message)
```

The middleware continues to reject missing/invalid tokens with plain HTTP 401 *before* any handler runs — `ErrUnauthenticated` is a defence-in-depth branch for the rare case where context claims are missing but the middleware somehow let the request through (bug, future middleware-reordering). In normal operation it never fires.

`★ Insight ─────────────────────────────────────`
- **Sentinel errors + `errors.Is` beat typed-error hierarchies for this shape.** We could have defined a `domain.Error` interface with a `Code() connect.Code` method, threaded it through every service, and had one mapper look it up. That's cleaner in a 50-package codebase, but in a 3-package one it's overengineering — three sentinels in a switch is obvious, greppable, and doesn't require every new error to route through a type hierarchy. The "don't abstract before the third case" rule.
- **The `loadCurrentUser` helper pays for itself immediately.** `GetCurrentUser`, `UpdateCurrentUserName`, and `CallerOrgID` all need the exact same "claims → auth_user_id → public.users row, with pgx.ErrNoRows mapped" dance. Centralising it means the sentinel-mapping logic exists once, not three times — if a fourth sentinel ever arises (say `ErrRevoked`), there's one place to add it.
`─────────────────────────────────────────────────`

## Why the `organizations` authz is minimal

`organizations.Service.authorize` is a pointer-equality check: `callerOrgID == orgID` or `ErrForbidden`. No membership table, no role check, no scope tree. That's correct for Pattern A (one user per org — every `public.users` row has its own `organizations` row, authored by the Phase 1 trigger). The v2 upgrade to Pattern C (invitations, multi-member orgs) replaces the equality check with a membership lookup — but `userLookup.CallerOrgID` stays, because even under Pattern C a *primary* org is the caller's default home. The signature of `userLookup` doesn't need to evolve; only the `authorize` body does. This matches plan decision 10's "Pattern-A-correct now; Pattern-C-safe later" framing on the delete-side trigger.

## Why `userLookup` instead of importing `*users.Service`

Plan §5b called for "inject a `userLookup` function-or-interface that returns the caller's org id, rather than pulling in the whole `users.Service`." Concretely, `organizations/service.go` depends on:

```go
type userLookup interface {
    CallerOrgID(ctx context.Context) (uuid.UUID, error)
}
```

…which `*users.Service` satisfies structurally (via the new `CallerOrgID` method). Two benefits:

1. **Circular-import insurance.** If a hypothetical future method on `users.Service` needs to consult an org (e.g. "can this user see org X"), the `users` package might end up importing `organizations`. With the whole-`*users.Service` pattern, `organizations` importing `users` importing `organizations` deadlocks. With the interface, `organizations` depends only on a shape the `users` package happens to fulfil — no import edge needed in the other direction.
2. **Test seams.** A trivial `type fakeUserLookup struct{ orgID uuid.UUID }` is enough to unit-test `organizations.Service`. No need to construct a `users.Service` with a fake `userQueries`.

## Frontend state machine

The dashboard used to be `{email | err}` (two booleans, one mutually-exclusive-with-the-other). That's equivalent to `State<ok> | State<err>`, but represented as two independent `useState`s — so it's possible to be in the nonsensical `{email: "x", err: "y"}` state for a brief render cycle if both resolve concurrently.

The rewrite uses a single discriminated union:

```ts
type State =
  | { kind: "loading" }
  | { kind: "ready"; email: string }
  | { kind: "not-provisioned" }
  | { kind: "error"; message: string };
```

Exactly one `kind` is true at a time; the render body is a four-arm switch. Adding a fifth state (e.g. `{ kind: "signed-out" }` after the sign-out button is clicked) is a one-line edit, not a dance with three booleans.

`ConnectError.from(e)` is the idiomatic Connect-ES way to coerce an `unknown` caught value back into a `ConnectError` — it passes through already-ConnectError values unchanged and wraps everything else. Using `e instanceof ConnectError` would miss errors that came from nested promise wrappers; `ConnectError.from` handles both.

## Deviations from the plan

1. **Plan §5a called for `NewService` signature to stay `*db.Queries`.** Live code accepts the `userQueries` interface instead. Reason: `*db.Queries` satisfies `userQueries` by structural typing, so every existing call site (`users.NewService(queries)` in `cmd/api/main.go`) still compiles — but the service's *declared* dependency is now the minimal interface, not the generated omnibus. The test in Phase 4 uses a `fakeQueries` struct that implements only these two methods; accepting the concrete `*db.Queries` would force the test to satisfy the full 5-method `Querier` (or use the generated `Queries` struct with a hand-rolled `db` field, which is exactly the "mock sqlc" anti-pattern CLAUDE.md forbids).
2. **Plan §5b's authz sketch was "verify the caller's org_id matches the requested id"** — left open whether to wrap that in `ErrForbidden` or reuse `users.ErrNotProvisioned`. Live code defines `organizations.ErrForbidden` as a distinct sentinel so the org handler can map it cleanly to `CodePermissionDenied` without importing `users` for the sentinel. Handler still maps `users.ErrNotProvisioned` to the same wire code — both flow through `orgErrToConnect` — so the FE sees the same `PermissionDenied` in both cases for now. If the onboarding wizard ever needs to differentiate "unprovisioned" vs "forbidden" on the org path, the sentinels are already separated and the switch just grows a new branch.
3. **Invalid-UUID in `GetOrganization(id)` maps to `ErrNotFound`**, not a dedicated `ErrInvalidID`. Rationale: from the caller's perspective a malformed id and a nonexistent id are the same failure (the id doesn't resolve to a real org), and exposing "that's not even a valid UUID" leaks shape info. Same choice applies to `UpdateOrganizationName`.

## What is NOT covered here

- **Unit tests** — plan §7a is Phase 4's scope, not Phase 3's. The interface extraction that the test needs is in place.
- **`CreateUser` RPC exposure** — plan §2 decision box explicitly defers this to the invitation-flow plan. The query exists (Phase 2); no Connect method for it in `users.proto`.
- **`ContextWithClaims` helper in `auth/`** — the Phase 4 test needs this (plan §7a note). Will be added as part of Phase 4, not back-ported into auth by Phase 3.

## Verification performed

```
$ cd backend && go vet ./...      # clean (no output)
$ cd backend && go build ./...    # clean (exit 0)
$ cd frontend && pnpm type-check  # clean
$ cd frontend && pnpm lint        # clean
```

Runtime smoke tests — signing in with a provisioned user (dashboard shows email), signing in with an unprovisioned user (dashboard shows the amber panel) — are part of Phase 4's §7b manual E2E flow.

## What this unblocks for Phase 4

- The `userQueries` interface extraction is done, so the Phase 4 `service_test.go` can construct a `fakeQueries` that satisfies it without dragging in `*db.Queries`.
- The error-mapping switch in the handler is in place, so Phase 4's test can assert on `errors.Is(..., users.ErrNotProvisioned)` — the sentinel it needs to catch is exported and reachable.
- The FE "not provisioned" copy renders a discriminated state, so the manual E2E can *see* whether the permission-denied path fires correctly without log-spelunking.
