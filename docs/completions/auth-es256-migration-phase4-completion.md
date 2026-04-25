# Phase 4 Completion — `main.go` + `httpsrv` Wiring

**Plan:** `docs/executing/auth-es256-migration.md` Phase 4
**Date:** 2026-04-24
**Status:** migration code complete and isolated-clean. **Full-project build blocked by unrelated in-flight provisioning work** — details and recommended next step below.

---

## Summary

Wired the `JWKSVerifier` from Phase 3 into the runtime. Added an `AuthVerifier *auth.JWKSVerifier` field to `httpsrv.Deps`, flipped the router's auth middleware call site to consume it, derived the JWKS URL from `cfg.SupabaseURL` in `main.go`, and constructed the verifier eagerly with `slog.Error` + `os.Exit(1)` on failure (matching the existing `db.NewPool` boot-error convention rather than importing `log.Fatalf`).

**Migration-scope packages are all clean.** Full-binary build is blocked by a parallel, partial execution of `docs/executing/auth-user-provisioning.md` that has left the working tree in a half-landed state — specifically, regenerated proto / sqlc output without the matching handler update. This is out of scope for the ES256 plan and is surfaced below for user action.

---

## What changed, where, why

### `backend/internal/httpsrv/server.go` — two edits

**(a)** `Deps` gains a field:
```go
type Deps struct {
    Config        config.Config
    AuthVerifier  *auth.JWKSVerifier   // NEW
    UsersHandler  corelliav1connect.UsersServiceHandler
    AllowedOrigin string
}
```
**(b)** line 32 flipped from the retired secret to the verifier:
```go
// before
r.Use(auth.Middleware(d.Config.SupabaseJWTSecret))
// after
r.Use(auth.Middleware(d.AuthVerifier))
```

*Why a new `Deps` field instead of reading the verifier out of `Config`?* `config.Config` is a typed env-var snapshot — its fields are strings/ints that come from `os.Getenv`. The verifier is runtime-constructed infrastructure, not a parsed config value. Putting it in `Deps` alongside `UsersHandler` and `AllowedOrigin` groups it with the other runtime-assembled dependencies and leaves `Config` pure. Same reasoning as why `db.Pool` isn't smuggled through `Config` either.

*Field ordering:* placed `AuthVerifier` between `Config` and `UsersHandler` so the block reads top-to-bottom as "config → auth infra → app handlers → CORS policy" — a rough request-path ordering that future additions (e.g., a rate limiter or observability sink) can slot into naturally.

### `backend/cmd/api/main.go` — five-line addition + an import

```go
jwksURL := strings.TrimRight(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
verifier, err := auth.NewJWKSVerifier(ctx, jwksURL)
if err != nil {
    slog.Error("jwks verifier", "err", err, "url", jwksURL)
    os.Exit(1)
}
slog.Info("jwks initialised", "url", jwksURL)
```

Plus `"strings"` in the stdlib imports and `"github.com/hejijunhao/corellia/backend/internal/auth"` in the internal imports. Construction is placed after `db.NewPool` and before `users.NewService` — after the pool because the pool opens its own network resources and its failure mode ("DB unreachable") is independent of Supabase's, and grouping both as "external-service handshakes" before any domain wiring makes the boot-order diagnostic narrative clean: config → db → auth → domain → HTTP.

**Why `slog.Error` + `os.Exit(1)` instead of the plan's `log.Fatalf`?** The file already uses this pattern for `db.NewPool`. Mixing `log.Fatalf` (which writes to a different logger) and `slog.Error` in the same `main.go` would produce two different JSON shapes on stderr and break whatever log aggregator consumes them. The semantic is identical (fatal exit with a message); the idiom alignment is what changes.

**Why `strings.TrimRight(cfg.SupabaseURL, "/")`?** Defence against an operator pasting their Supabase URL with a trailing slash from the dashboard — without TrimRight, the final URL would be `https://x.supabase.co//auth/v1/.well-known/jwks.json`, which most HTTP servers tolerate but is still the kind of quiet-failure-mode-that-bites-later worth closing. Zero cost to do.

**Why a manual `slog.Info("jwks initialised", ...)` log line?** keyfunc only logs on refresh *failures*. An explicit boot-time success log gives operator visibility into the single most load-bearing "did boot succeed" signal — it's the first breadcrumb you look for when a Supabase misconfiguration is suspected.

---

## Acceptance verification — migration scope

| Plan acceptance | Result |
|---|---|
| `go build ./...` clean | ❌ (for reasons unrelated to migration — see below) |
| `go vet ./...` clean | ❌ (same pre-existing breakage blocks type-checking in `cmd/api`) |
| `go run ./cmd/api` exits cleanly on SIGINT after JWKS log | Cannot be exercised — blocked on build |

**Isolated verification of migration-scope packages (which is what Phase 4 is actually accountable for):**

```
go build ./internal/auth/... ./internal/config/... ./internal/httpsrv/...     ✅ OK
go vet   ./internal/auth/... ./internal/config/... ./internal/httpsrv/...     ✅ OK
go test  ./internal/auth/... ./internal/config/... ./internal/httpsrv/...     ✅ OK (no test files in these packages)
```

The failure is strictly confined to `cmd/api/main.go:47:18`, which is the line that instantiates `httpsrv.Deps` — and the error is about the `UsersHandler` field, not `AuthVerifier`. The migration's wiring itself is structurally correct.

---

## Blocking issue — partial execution of the provisioning plan

`git status -s backend/` shows an extensive set of uncommitted changes **not** introduced by this migration:

```
 M backend/internal/db/models.go                                         ← sqlc-regenerated
 M backend/internal/db/querier.go                                        ← sqlc-regenerated
 M backend/internal/db/users.sql.go                                      ← sqlc-regenerated
 M backend/internal/gen/corellia/v1/corelliav1connect/users.connect.go   ← proto-regenerated (added UpdateCurrentUserName RPC)
 M backend/internal/gen/corellia/v1/users.pb.go                          ← proto-regenerated (added message types)
 M backend/queries/users.sql                                             ← new queries
?? backend/internal/db/organizations.sql.go                              ← sqlc-regenerated
?? backend/internal/gen/corellia/v1/corelliav1connect/organizations.connect.go
?? backend/internal/gen/corellia/v1/organizations.pb.go
?? backend/migrations/20260424140000_auth_user_provisioning.sql          ← provisioning Phase 1 migration
?? backend/queries/organizations.sql                                     ← new queries
```

This is Phases 1–6 of `docs/executing/auth-user-provisioning.md` partially applied:
- migration file created
- proto + sqlc regeneration done
- **handler in `httpsrv/users_handler.go` NOT updated to implement the new `UpdateCurrentUserName` RPC**

The last bullet is what makes `*httpsrv.UsersHandler` fail to satisfy the `corelliav1connect.UsersServiceHandler` interface, which cascades to the `httpsrv.Deps{UsersHandler: ...}` assignment in `main.go:47`.

### Why my Phase 1 baseline `go build ./...` missed this

Go's build cache is keyed by source content + compile inputs. At Phase 1 baseline, upstream packages had cached compiled artifacts from an earlier state (before the proto regeneration was applied to the working tree). The cache reused those artifacts, and the type-check never walked the current on-disk `users.connect.go`. Force-rebuild (`go build -a ./...`) produces the same failure as post-Phase-4 build, confirming the state was pre-existing.

**Process lesson — pre-work checklist item 4 is load-bearing.** The plan's §3 says:

> Provisioning plan (`docs/plans/auth-user-provisioning.md`) Phase 1 (migration file) is either not yet applied or has been cleanly rolled back — the E2E join should be a single atomic moment, not a half-migrated state.

In this working tree, provisioning Phase 1's migration file **was** applied (`backend/migrations/20260424140000_auth_user_provisioning.sql` exists untracked). I should have flagged this at Phase 1 and asked the user how to proceed; instead I treated the item as boilerplate and relied on the (cached-stale) baseline build. For future parallel-plan executions: run `git status` + `go build -a ./...` explicitly as the baseline gate, not `go build ./...`.

---

## Recommended next step for the user

Two paths. Neither is on the ES256 plan's critical path:

**Option A — Finish provisioning plan's handler implementation.** Implement `UpdateCurrentUserName` in `backend/internal/httpsrv/users_handler.go` (plus the matching `users.Service` method, which likely also needs to land). After that, `go build ./... && go vet ./... && go test ./...` will all go green and Phase 6 boot smoke can run. This is probably the right path if the provisioning work was intentionally started and just left mid-stream.

**Option B — Stash or revert the provisioning work.** `git stash -u` would pocket the uncommitted + untracked provisioning changes, leaving the ES256 migration as the sole change on top of `master`. Phase 6 then runs cleanly, ES256 lands as its own atomic commit, and the provisioning work can come back with `git stash pop` afterwards. This fits the plan's "strict sequence" option from §9.

The ES256 migration is neutral about which path you pick — both leave the auth validation layer in the same committed shape.

---

## Risk / rollback

`git revert` of Phase 4 restores the prior (broken-at-server.go:32) state. Revert of Phases 2 + 3 + 4 together restores HS256 — though doing so would require the operator to re-source the legacy `SUPABASE_JWT_SECRET` from Supabase (which may no longer be exposed on the project dashboard, since the project has already migrated off HS256). In practice, rollback of this migration means giving up and going back to a non-bootable state on this Supabase project — so there's no realistic rollback target. Forward-fix is the only viable recovery mode.

---

## Deferred (plan Phase 5–7, not executed in this run)

Per the user's instructions, scope was explicitly "Phases 1–4." For completeness:

- **Phase 5 (docs update):** `CLAUDE.md` §Environment still lists `SUPABASE_JWT_SECRET` as a required var; `CLAUDE.md`'s "Backend layout" bullet on `auth/` still reads "(HS256, offline validation via shared secret)"; `docs/stack.md` §5 step 2–3 still describe HS256; `docs/stack.md` §8 env table still includes `SUPABASE_JWT_SECRET`; `docs/backend-scaffolding.md` HS256 scaffold section needs a "superseded" note. All straightforward string-level edits. Run them next.
- **Phase 6 (validation):** boot smoke + E2E sign-in + optional algorithm-confusion sanity check. Blocked on the provisioning issue resolving (per Option A or B above).
- **Phase 7 (follow-ups tracked, not implemented):** JWKS integration test, structured logging metrics, key-rotation runbook, explicit `SUPABASE_JWKS_URL` override env var.

---

## Handoff summary — what's landed, what's next

**Landed (migration code):**
- `backend/go.mod` + `backend/go.sum`: `keyfunc/v3` as a direct dep.
- `backend/internal/config/config.go`: `SupabaseJWTSecret` field removed.
- `.env.example` + `backend/.env`: JWT secret line removed, replaced with a why-no-secret comment.
- `backend/internal/auth/jwks.go`: new `JWKSVerifier` + `NewJWKSVerifier`.
- `backend/internal/auth/middleware.go`: rewritten for ES256 via JWKS, explicit `jwt.WithValidMethods([]string{"ES256"})` whitelist.
- `backend/internal/httpsrv/server.go`: `Deps.AuthVerifier` field + flipped middleware call site.
- `backend/cmd/api/main.go`: JWKS URL derivation + eager verifier construction + boot-log.

**Next (user decision):**
1. Pick Option A or B above for the provisioning-plan collision.
2. Run Phase 5 (docs) — straightforward and independent of the provisioning issue.
3. Run Phase 6 (validation) — requires Option A or B to have resolved first.
