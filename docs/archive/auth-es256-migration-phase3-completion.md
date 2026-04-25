# Phase 3 Completion — Auth Middleware Rewrite (HS256 → ES256 / JWKS)

**Plan:** `docs/executing/auth-es256-migration.md` Phase 3
**Date:** 2026-04-24
**Status:** complete. `internal/auth/` compiles + vets clean. Full-project build still fails on `httpsrv/server.go:32` as expected — Phase 4 fixes it.

---

## Summary

Added `backend/internal/auth/jwks.go` — a thin wrapper (`JWKSVerifier`) around keyfunc v3's refreshable JWKS cache. Rewrote `backend/internal/auth/middleware.go` to consume a `*JWKSVerifier` instead of an HS256 shared secret, enforcing ES256 explicitly via `jwt.WithValidMethods` to defend against algorithm-confusion attacks. `AuthClaims` in `claims.go` untouched.

Result: the auth layer is structurally ready to validate Supabase's current ES256-signed access tokens. Phase 4 wires it into the router and fills the one remaining compile error.

---

## What changed, where, why

### `backend/internal/auth/jwks.go` (new, 40 lines)

```go
type JWKSVerifier struct { kf keyfunc.Keyfunc }

func NewJWKSVerifier(ctx context.Context, jwksURL string) (*JWKSVerifier, error)
func (v *JWKSVerifier) Keyfunc() jwt.Keyfunc
```

Single struct, single constructor, single method. The method returns a `jwt.Keyfunc` adapter that `jwt.ParseWithClaims` consumes at request time.

**The construction path.** The plan's sample code built the JWKS client manually — `jwkset.NewDefaultHTTPClient([]string{url})`, then `storage.KeyReadAll(ctx)` to force an initial fetch, then `keyfunc.New(keyfunc.Options{Storage, Ctx})`. In pinned keyfunc v3.8.0, all three steps collapse into one call:

```go
kf, err := keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, keyfunc.Override{
    NoErrorReturnFirstHTTPReq: &failOnFirstFetchError, // flip default
    HTTPTimeout:               10 * time.Second,
})
```

Why this is cleaner than the plan's hand-rolled version:

- **keyfunc v3's default is `NoErrorReturnFirstHTTPReq: true`** — it swallows first-fetch errors so a service can boot through a transient network blip and recover on the next refresh tick. For our use case (misconfigured `SUPABASE_URL` or a wedged Supabase endpoint would produce a stream of 401s that'd take an hour of debugging to diagnose), we want the *opposite*: fail loud at boot. The library has a purpose-built knob for exactly this — `NoErrorReturnFirstHTTPReq *bool` in `keyfunc.Override`. Passing a pointer to `false` inverts the default without any manual fetch-and-check logic.
- **`HTTPTimeout: 10 * time.Second`** bounds the boot-time fetch (matching the plan's intent via `context.WithTimeout`). Without this, a blackholed TCP connection could block startup indefinitely on whatever the OS's default socket-timeout is.
- **`ctx` is the long-lived server context** (passed in by Phase 4's `main.go`). keyfunc binds the refresh goroutine to that context, so server shutdown (via cancellation of the root context) cleanly terminates the refresh loop instead of leaking a goroutine.

**Defaults kept from keyfunc's `NewDefaultOverrideCtx` path:**
- Refresh interval: 1 hour (plan decision 5 ✅).
- Refresh-on-unknown-KID rate limit: 5 minutes, 1 token/window (plan decision 5 ✅).
- Refresh-error handler: `slog.Default().ErrorContext` (stdout in our current `main.go` config — plan decision 11 defers structured logging).

**What I did not add:**
- `keyfunc.UseWhitelist` (filters JWKS entries by the JWK `"use"` parameter — sig/enc). The plan's Decision 9 mentions it as the mechanism for algorithm-whitelisting, but that's a terminology muddle: `UseWhitelist` is about JWK `use`, not JWT `alg`. Algorithm-confusion defence lives in `jwt.WithValidMethods` at parse time (see `middleware.go` below). Adding `UseWhitelist` would be belt-and-suspenders, but it'd also tightly couple us to Supabase publishing their signing key with `"use": "sig"` — if they ever stopped populating that field the middleware would start rejecting valid tokens. Net: skip for now, add only if Supabase's JWKS gains multi-purpose keys.

### `backend/internal/auth/middleware.go` (rewritten in place, net +5 / −3 lines)

The public surface changed exactly once:

```go
// before
func Middleware(jwtSecret string) func(http.Handler) http.Handler

// after
func Middleware(verifier *JWKSVerifier) func(http.Handler) http.Handler
```

Everything else — `FromContext(ctx) (*AuthClaims, bool)`, the `ctxKey{}` type, the `jwt.MapClaims` extraction, the `uuid.Parse(sub)` step, the `http.Error` responses — is preserved byte-for-byte. The two real semantic changes are:

1. **Key source.** `func(t *jwt.Token) (any, error) { return []byte(jwtSecret), nil }` (returns the shared HMAC secret regardless of token) → `verifier.Keyfunc()` (looks up the public key by the token's `kid` header via the JWKS cache).

2. **Algorithm enforcement.** Added `jwt.WithValidMethods([]string{"ES256"})` to the `ParseWithClaims` call. Without this, the classic algorithm-confusion attack works: an attacker signs a token with HS256 using the *public* key as the HMAC secret, and `jwt/v5` would happily accept it — the library dispatches on the token's claimed `alg` header. `WithValidMethods` rejects the token before key-lookup if `alg` isn't in the whitelist, closing that attack.

**Deviation from the plan's sample code, preserved intentionally:**
- Plan returned `AuthClaims` by value from `FromContext`; live code returns `*AuthClaims` pointer. Reason: `users/service.go:21` already consumes the pointer. Changing the shape would ripple into an unrelated domain service with no net benefit. CLAUDE.md "don't refactor beyond what the task requires" applies.
- Plan added `ContextWithClaims` and `ErrNoClaims` helpers "for test use" / "compat." Neither has a caller today (verified by grep); there are no test files in `internal/auth/`. Per CLAUDE.md "don't add abstractions for hypothetical future requirements," omitted. Adding them is a single Edit when Phase 7's follow-up test lands.
- Plan used `claimsCtxKey{}` as the context key name; kept existing `ctxKey{}`. Zero semantic difference; keeps the diff minimal and avoids a fourth ripple edit.

### `backend/internal/auth/claims.go`

Untouched. The `AuthClaims` struct's shape (`AuthUserID uuid.UUID`, `Email string`) is exactly what downstream services depend on, and the plan's Decision 8 explicitly preserves it.

### `backend/go.mod` / `backend/go.sum`

`go mod tidy` promoted `github.com/MicahParks/keyfunc/v3` from the indirect `require` block to the direct block the instant `jwks.go` imported it. `github.com/MicahParks/jwkset` and `golang.org/x/time` stay indirect (we import keyfunc, keyfunc transitively imports those). This closes the loop Phase 1's completion doc opened.

---

## Acceptance verification

| Plan acceptance | Result |
|---|---|
| `go build ./internal/auth/...` clean | ✅ |
| `grep SigningMethodHS256 backend/internal/auth/` → 0 matches | ✅ |
| Any test files in `internal/auth/` still compile | N/A — no test files in package |
| `go vet ./internal/auth/...` clean | ✅ (plan didn't require, but verified anyway) |

Full-project build status: **one expected failure remains** (`httpsrv/server.go:32`, unchanged from end of Phase 2). This is the singular call site Phase 4 targets.

---

## Architectural notes worth preserving

**Why `JWKSVerifier` is a struct wrapper around a `keyfunc.Keyfunc` and not just a direct `keyfunc.Keyfunc`.** I considered aliasing — `type JWKSVerifier = keyfunc.Keyfunc` — and decided against it:

1. **Insulation from library churn.** keyfunc v3 → v4 will almost certainly rename or reshape the `Keyfunc` interface (the plan explicitly flags API shifts between minor versions). A wrapper means any such churn is absorbed in one file; call sites in `httpsrv` and `main.go` see only our own `*JWKSVerifier` type.
2. **Testability seam.** When the Phase 7 integration test lands, a fake JWKS server + a wrapper type is easier than mocking the keyfunc interface directly.
3. **Naming.** `*auth.JWKSVerifier` reads cleanly at call sites; `keyfunc.Keyfunc` would leak the transitive-dependency vocabulary into `httpsrv` and `main.go`, violating rule §11.6 in spirit (auth-library specifics should stay confined to `internal/auth/`).

**Why the ES256 whitelist is hardcoded, not config-driven.** Supabase has a single, canonical signing algorithm per project (currently ES256 with the JWT Signing Key scheme). Making this a config knob would be: (a) surface area with no legitimate variation, (b) a footgun — adding HS256 back to the whitelist re-opens the algorithm-confusion attack. If Supabase ever adds a second supported algorithm, the one-line whitelist edit is auditable; the env var version wouldn't be.

---

## Risk / rollback

`git revert` restores the HS256 path atomically:
- `claims.go` untouched → no revert noise.
- `middleware.go` reverts to the HS256 `jwtSecret string` signature.
- `jwks.go` disappears.
- `go.mod` / `go.sum` revert; next `go mod tidy` removes the keyfunc entries.

The revert is self-consistent only if Phase 2's revert lands in the same motion (the `SupabaseJWTSecret` config field needs to come back for the HS256 middleware to have something to consume). Since the phases are a linear chain by design, a revert of Phases 2 + 3 in one commit-range is the correct unit.

---

## Handoff to Phase 4

Phase 4 has a three-file scope (slightly wider than the plan's "mostly `main.go`" framing, per Phase 2's note):

1. **`backend/cmd/api/main.go`** — derive `jwksURL` from `cfg.SupabaseURL`, construct `verifier` eagerly via `auth.NewJWKSVerifier(ctx, jwksURL)`, `log.Fatalf` on error, pass `verifier` into `httpsrv.Deps`.
2. **`backend/internal/httpsrv/server.go`** — add `AuthVerifier *auth.JWKSVerifier` to `Deps`, flip line 32 to `r.Use(auth.Middleware(d.AuthVerifier))`.
3. **(optional polish)** — a single `slog.Info("auth: JWKS initialised", "url", jwksURL)` log line right after verifier construction. keyfunc itself logs only on refresh *failures*; an explicit boot-time success log gives operator visibility into the single most load-bearing "did boot succeed" signal.

Post-Phase-4 expectation: `go build ./... && go vet ./... && go test ./...` all clean; `go run ./cmd/api` binds a port and logs a JWKS-initialised line without crashing, assuming `backend/.env` has a populated `SUPABASE_URL` pointing at a reachable project (already verified — line 9 of the live `.env`).
