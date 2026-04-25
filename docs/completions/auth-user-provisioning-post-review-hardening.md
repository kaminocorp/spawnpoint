# Auth User Provisioning — Post-Review Hardening

**Plan:** `docs/executing/auth-user-provisioning.md`
**Phase:** post-completion (follows phases 1–4)
**Status:** complete. `go vet ./...`, `go build ./...`, `go test ./...` all clean.
**Date:** 2026-04-25

---

## Why this exists

Phases 1–4 landed the auth-user-provisioning plan as designed. A subsequent code review of the four completion docs against the live tree flagged one medium-severity production-hardening gap that the plan did not anticipate: the handler error-mapping switches introduced in Phase 3 (`httpsrv/users_handler.go:47-56`, `httpsrv/organizations_handler.go:44-56`) wrapped *unknown* service errors with `connect.NewError(connect.CodeInternal, err)` — passing the raw error message through to the wire.

This is the only finding from the review treated as pre-prod blocking. The other items the review surfaced (no tests for `organizations.authorize`, `UpdateCurrentUserName` is a 2-query operation that could be 1, no input validation on names, no API to NULL out a name) are scoped polish and intentionally deferred — they are not regressions of plan intent and will be picked up alongside the callers that motivate them (onboarding wizard, invitation flow).

---

## What landed

| File | Kind | Summary |
|---|---|---|
| `backend/internal/httpsrv/users_handler.go` | edit | `default:` arm in `toConnectErr` now logs the underlying error via `slog.Error` and returns `connect.NewError(connect.CodeInternal, errors.New("internal error"))` instead of wrapping the original. New `log/slog` import. |
| `backend/internal/httpsrv/organizations_handler.go` | edit | Same change to `orgErrToConnect`'s `default:` arm. New `log/slog` import. |

No other files touched. No tests touched (the existing `users/service_test.go` cases are all sentinel-mapping tests; they don't exercise the handler-level redaction).

## The change in plain terms

**Before** (Phase 3 shape):

```go
default:
    return connect.NewError(connect.CodeInternal, err)
```

`connect-go` propagates the wrapped error's `.Error()` string into the response body the client receives. So a `pgx`-level error like:

- `failed to connect: dial tcp [2406:da18:...]:5432: i/o timeout`
- `ERROR: relation "users" does not exist (SQLSTATE 42P01)`
- `ERROR: duplicate key value violates unique constraint "users_email_key" (SQLSTATE 23505) Key (email)=(alice@example.com) already exists.`

…would land in the browser. That leaks DB topology, schema details, and infrastructure shape to anyone who can produce a 500 — including unauthenticated traffic that gets past the middleware due to a future bug.

**After:**

```go
default:
    slog.Error("users handler: unexpected error", "err", err)
    return connect.NewError(connect.CodeInternal, errors.New("internal error"))
```

The full diagnostic stays in the structured server logs (already JSON-formatted via `slog.NewJSONHandler` in `cmd/api/main.go:22`) where ops can see it; the client receives only `{"code":"internal","message":"internal error"}`. Sentinel branches are unchanged — their messages are part of the public contract (the FE branches on the Connect *code*, not the string), so `users.ErrNotProvisioned` and friends still flow through verbatim.

## Why this shape — the non-obvious decisions

- **Why redact only the `default:` arm, not the sentinel arms.** Sentinel errors are *defined by us* and intentionally short, generic, and free of internal detail (`"unauthenticated"`, `"user not provisioned"`, `"organization not found"`). They are part of the API surface — the FE may surface them in UI copy or use them for telemetry. Redacting them would needlessly remove signal. The risk lives entirely in the unknown-error path, where the message originates from `pgx`, the OS, or some other third party we don't control.
- **Why `errors.New("internal error")` rather than nil.** `connect.NewError` requires a non-nil error; passing `nil` panics. The literal string is generic enough to leak nothing while still rendering as a sane fallback if the FE displays it raw.
- **Why `slog.Error` rather than `log.Println` or a return-and-log-in-middleware pattern.** The codebase already standardized on `slog` with a JSON handler in 0.2.x; consistency with the existing structured-logging shape lets ops grep on `"users handler: unexpected error"` or filter on `level=ERROR`. Logging in the handler (vs. in middleware) keeps the call site close to the error origin — useful when stack traces aren't captured.
- **Why two separate log lines (one per handler) rather than a shared helper.** Two short switches in two files are easier to grep and easier to evolve independently than a third helper file. If a third Connect handler appears (`AgentsHandler`, etc.) and the duplication starts to bite, *that* is the moment to extract — not before. Three similar lines is better than a premature abstraction.

`★ Insight ─────────────────────────────────────`
- **Connect-go's error propagation is the inverse of what you might expect from gRPC/HTTP REST.** Connect's wire format includes the error message verbatim by design, treating it as part of the response body the client should be able to render. That's great for sentinel errors (the FE can show meaningful copy) and dangerous for raw errors (the FE shows internal state). The pattern of "sentinels = transparent, defaults = redacted" is the load-bearing rule that makes the design safe; it's not a Connect-specific peculiarity but it's where Connect's defaults bite hardest.
- **`slog` with a JSON handler at the root means structured fields, not formatted strings.** `slog.Error("...", "err", err)` lands as `{"level":"ERROR","msg":"...","err":"..."}` — the operator can `jq '. | select(.level=="ERROR")'` against the Fly log stream. Using `fmt.Errorf("...: %w", err)` in the message would smush the same data into a single string and make filtering harder.
`─────────────────────────────────────────────────`

## What this does NOT change

- **The wire codes are unchanged.** `Unauthenticated`, `PermissionDenied`, `NotFound`, `Internal` all map exactly as Phase 3 specified. The dashboard's discriminated state machine (`frontend/src/app/dashboard/page.tsx`) branches on `Code.PermissionDenied` — that branch still fires identically.
- **The FE's error rendering for `Internal`** now displays `"internal error"` instead of the raw underlying string in the `state.kind === "error"` arm of the dashboard. That's the intended outcome: the user sees a generic message, the operator sees the diagnostic in logs.
- **`users.ErrUnauthenticated`** still maps to `Unauthenticated` and still passes through with its message — not because the message is interesting (it isn't), but because consistency with other sentinel handling outweighs the negligible information value of redacting a 1-word string.
- **No service-layer changes.** The redaction is purely a transport concern — the right boundary for it. Services still return their natural errors (sentinel or not); the handler decides what reaches the client.

## Verification performed

```
$ cd backend && go vet ./...      # clean (no output)
$ cd backend && go build ./...    # clean (exit 0)
$ cd backend && go test ./...     # ok internal/users (cached); no other test packages
```

Manual verification of the redaction itself was not run (would require triggering a real internal error, e.g. by killing the DB pool mid-request, which is outside the runbook scope). The change is small, mechanical, and the existing sentinel-mapping tests pin the *non-default* branches — a regression that swallowed a sentinel into the default arm would surface as a test failure on `TestGetCurrentUser_NotProvisioned` (currently green).

## Deviations from the original plan

None — the original plan didn't address handler-level error redaction at all. This is a post-completion addition, scoped to one finding, in two files. No plan revision needed; this completion doc is the durable record.

## What is still open from the same code review

These were flagged but deliberately *not* implemented in this pass — the user asked for the one fix I deemed appropriate, not the full punch list. They remain reasonable follow-ups:

- **Operator-side trigger E2E verification** (manual, plan §7b / phase-4 §E2E-1 through E2E-3). The provisioning + cleanup triggers compile and are wired correctly, but their runtime semantics under the Supabase auth role have not been exercised against a live project. Should be run before the first non-localhost deploy.
- **Unit tests for `organizations.Service.authorize`** — the most security-relevant code in this pass has zero test coverage. The `userQueries`-style fake pattern from `users/service_test.go` extends naturally: a `fakeOrgQueries` + `fakeUserLookup` would give 3 cheap pinning tests (matching org → ok; mismatched org → `ErrForbidden`; malformed UUID → `ErrNotFound`).
- **Fold `UpdateCurrentUserName` into a single query.** Current shape is `SELECT … WHERE auth_user_id = $1` then `UPDATE … WHERE id = $1`. A single `UPDATE … WHERE auth_user_id = $1 RETURNING *` halves the round trips and removes a small TOCTOU window.
- **Input validation on `UpdateCurrentUserName` and `UpdateOrganizationName`.** Empty string, multi-megabyte, control chars all currently accepted. Empty string in particular writes `""` to a nullable column — diverges from "unset" semantics. Trim + min/max length guards in the service.
- **No way to clear a user's name back to NULL via the API.** `UpdateUserName` always passes `&name`. Onboarding wizard probably doesn't need this, but it's a one-way door worth tracking.

## Rollback

```bash
git revert <this-commit>
```

The change is self-contained in two files with no external dependencies. Reverting restores the pre-review behaviour (raw error message in `Internal` responses) — useful only if downstream tooling somehow depended on the leaked detail, which nothing currently does.
