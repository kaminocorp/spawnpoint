# Plan — Migrate backend JWT validation from HS256 shared secret to ES256 / JWKS

**Status:** approved, ready to execute
**Owner:** TBD
**Supersedes:** the HS256 / `SUPABASE_JWT_SECRET` path defined in 0.1.0 backend scaffolding.
**Hard prerequisite for:** `docs/plans/auth-user-provisioning.md` Task 7b (end-to-end sign-in smoke test). Provisioning Phases 1–4 can run in parallel; the E2E join requires this plan landed.

---

## 1. Objective

The target Supabase project has migrated from the legacy symmetric HS256 auth scheme to the current asymmetric ES256 scheme with a JWT Signing Key (P-256 / ECDSA). Our backend middleware was scaffolded in 0.1.0 around HS256 and is now structurally incompatible: it reads `SUPABASE_JWT_SECRET` as a shared HMAC secret and calls `jwt.ParseWithClaims` with `SigningMethodHS256`. The ES256 Signing Key's *public half* (exposed as a JWK) cannot be plugged into that slot — the key types, the signing algorithm, and the verification code path are all different.

This plan migrates the backend middleware to fetch Supabase's JWKS document, cache it in memory, and validate incoming JWTs with ES256 against the matching public key (by `kid`). Scope is strictly backend: auth middleware, config, `main.go` wiring, and docs. Frontend is unaffected (the access token is opaque from the client's perspective).

After this pass, the pipeline can authenticate against the current Supabase project without relying on a legacy-JWT-secret fallback that Supabase is deprecating.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Target algorithm | ES256 (ECDSA / P-256) | Matches Supabase's new JWT Signing Key scheme |
| 2 | Key source | JWKS endpoint at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` | OIDC-standard; Supabase rotates keys server-side without us editing env vars; the middleware just tracks the current key set |
| 3 | JWKS URL in config | Derived from `SUPABASE_URL`, not a separate env var | URL path is canonical per Supabase; introducing `SUPABASE_JWKS_URL` would be configurable surface with no legitimate reason to differ |
| 4 | JWKS library | `github.com/MicahParks/keyfunc/v3` | Canonical JWKS adapter for `golang-jwt/jwt/v5` (which we already use). Handles caching, periodic refresh, `kid`-miss refetch, and algorithm-whitelisting |
| 5 | Refresh strategy | 1-hour periodic + refresh-on-`kid`-miss | keyfunc defaults; matches Supabase's published JWKS cache headers. Rotation mid-flight is transparent |
| 6 | Startup behaviour | Eager JWKS fetch on `main.go` boot; `log.Fatalf` on unreachable endpoint | Consistent with 0.1.0 config's panic-on-missing-var pattern — prevents the silent "every request 401s" mode that would happen if the middleware tried to lazy-init the JWKS |
| 7 | `SUPABASE_JWT_SECRET` env var | **Remove entirely** from `config.Config`, `.env.example`, `backend/.env`, `CLAUDE.md`, `stack.md` | HS256-specific; no value in ES256 world. Per CLAUDE.md "if you are certain that something is unused, delete it completely" |
| 8 | `auth.AuthClaims` struct shape | Unchanged (`AuthUserID uuid.UUID`, `Email string`) | Downstream services (`users.Service`, `organizations.Service`) depend on this shape; the migration is transparent above the middleware by design |
| 9 | Algorithm whitelist at verification time | Enforce `alg == ES256` explicitly | Defence against the classic "algorithm confusion" attack where a token signed with HS256-against-the-public-key would otherwise validate. keyfunc supports this via `UseWhitelist` |
| 10 | Integration test (`httptest` + static JWKS JSON) | Deferred to follow-up | Setup is non-trivial (stub server, signed test JWTs, key-pair fixture); blocks on the manual E2E test being in place first |
| 11 | Structured logging around JWKS refresh | Deferred to follow-up | Stdout via keyfunc's default logger is sufficient for hackathon scope |

---

## 3. Pre-work checklist

- [ ] `backend/.env` has populated `SUPABASE_URL=https://<ref>.supabase.co` (already confirmed for this project).
- [ ] JWKS endpoint reachable from your machine:
  ```bash
  curl -sS "$SUPABASE_URL/auth/v1/.well-known/jwks.json" | jq .
  ```
  Expect a JSON document with a `keys` array containing at least one entry where `alg == "ES256"`, `crv == "P-256"`, `kty == "EC"`, and `kid` matches the one shown in the Supabase dashboard (`4ed2608f-e018-410f-97d2-75cad314bcdb` for this project).
- [ ] Current backend compiles before any edits: `cd backend && go build ./...` clean. (Gives you a known-good baseline to bisect against if the migration introduces a regression.)
- [ ] Provisioning plan (`docs/plans/auth-user-provisioning.md`) Phase 1 (migration file) is either not yet applied or has been cleanly rolled back — the E2E join should be a single atomic moment, not a half-migrated state.

---

## 4. Implementation phases

Six phases. 1–4 are the code migration; 5 is docs; 6 is validation. Linear — each builds on the previous. Rough effort: 1.5–2 hours focused.

---

### Phase 1 — Add JWKS library dependency

From `backend/`:

```bash
go get github.com/MicahParks/keyfunc/v3@latest
go mod tidy
```

**Acceptance:**
- `backend/go.mod` lists `github.com/MicahParks/keyfunc/v3` as a direct dependency.
- `backend/go.sum` updated.
- `go build ./...` still clean (no imports yet, just the dependency registered).

**Notes:**
- keyfunc v3 depends on `github.com/MicahParks/jwkset` (pulled transitively). No action needed.
- If `go get` picks up a future v4, review the breaking changes. For this plan we assume v3 API: `keyfunc.NewDefault`, `keyfunc.NewDefaultCtx`, `Keyfunc()` method returning `jwt.Keyfunc`.

---

### Phase 2 — Config layer: retire `SUPABASE_JWT_SECRET`

**Files:**

**2a. `backend/internal/config/config.go`** — remove the `SupabaseJWTSecret` field and its `env:"SUPABASE_JWT_SECRET,required"` tag. No replacement field: JWKS URL is derived from `SupabaseURL` at wiring time in `main.go` (decision 3).

**2b. `.env.example` (repo root)** — remove the `SUPABASE_JWT_SECRET=` line. Replace with a comment block explaining the new scheme:

```env
# Supabase auth validates access tokens via JWKS (ES256).
# The backend derives the JWKS URL from SUPABASE_URL automatically:
#   $SUPABASE_URL/auth/v1/.well-known/jwks.json
# No JWT_SECRET is required — keys rotate server-side and the middleware refreshes the set hourly.
```

**2c. `backend/.env`** — remove the `SUPABASE_JWT_SECRET=` line. No value-replacement needed.

**Acceptance:**
- `grep -r SUPABASE_JWT_SECRET backend/` returns no matches.
- `grep -r SupabaseJWTSecret backend/` returns no matches.
- `go build ./...` fails (expected — `main.go` still references the removed field). Phase 4 fixes this.

---

### Phase 3 — Auth middleware rewrite

Two files in `backend/internal/auth/`.

**3a. `backend/internal/auth/jwks.go` — new:**

```go
package auth

import (
    "context"
    "fmt"
    "time"

    "github.com/MicahParks/jwkset"
    "github.com/MicahParks/keyfunc/v3"
    "github.com/golang-jwt/jwt/v5"
)

// JWKSVerifier holds a refreshable cache of the Supabase project's JWT
// public keys, fetched from the standard JWKS endpoint. It is the only
// auth primitive that touches the network — everything else is offline.
type JWKSVerifier struct {
    kf keyfunc.Keyfunc
}

// NewJWKSVerifier fetches the JWKS eagerly from the given URL. On
// failure it returns an error — callers are expected to panic at boot
// rather than lazy-init, so a misconfigured SUPABASE_URL fails loud
// instead of producing blanket 401s at runtime.
func NewJWKSVerifier(ctx context.Context, jwksURL string) (*JWKSVerifier, error) {
    storage, err := jwkset.NewDefaultHTTPClient([]string{jwksURL})
    if err != nil {
        return nil, fmt.Errorf("auth: init JWKS storage: %w", err)
    }

    // Block until the initial fetch completes so boot fails fast if
    // the URL is wrong or the endpoint is unreachable.
    fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()
    if _, err := storage.KeyReadAll(fetchCtx); err != nil {
        return nil, fmt.Errorf("auth: initial JWKS fetch from %s: %w", jwksURL, err)
    }

    kf, err := keyfunc.New(keyfunc.Options{
        Storage: storage,
        Ctx:     ctx,
    })
    if err != nil {
        return nil, fmt.Errorf("auth: construct keyfunc: %w", err)
    }

    return &JWKSVerifier{kf: kf}, nil
}

// Keyfunc returns the jwt.Keyfunc used by the middleware at parse time.
// It looks up the public key by the token's `kid` header and returns
// the matching `*ecdsa.PublicKey`.
func (v *JWKSVerifier) Keyfunc() jwt.Keyfunc {
    return v.kf.Keyfunc
}
```

> **Implementer note:** the exact API surface of `keyfunc/v3` + `jwkset` has shifted between minor versions. If the above helpers (`NewDefaultHTTPClient`, `KeyReadAll`, `keyfunc.Options.Storage`) don't exist in the pinned version, consult the keyfunc README for the equivalent — the *shape* is stable (storage backed by an HTTP-fetching JWKS client; `keyfunc.New` or similar takes that storage; `.Keyfunc` returns the `jwt.Keyfunc`).

**3b. `backend/internal/auth/middleware.go` — rewrite:**

Replace the current HS256-based body with ES256 + keyfunc. Shape (adapt to match the current file's chi-middleware signature):

```go
package auth

import (
    "context"
    "errors"
    "net/http"
    "strings"

    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
)

const bearerPrefix = "Bearer "

type claimsCtxKey struct{}

// AuthClaims is the shape domain services see. Shape is preserved
// across the HS256 → ES256 migration by design.
type AuthClaims struct {
    AuthUserID uuid.UUID
    Email      string
}

// Middleware validates a Supabase-issued JWT on every request and
// attaches AuthClaims to the context. Requires a pre-initialised
// JWKSVerifier (see NewJWKSVerifier) — the verifier is expected to be
// constructed once at boot and shared across requests.
func Middleware(verifier *JWKSVerifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            authz := r.Header.Get("Authorization")
            if !strings.HasPrefix(authz, bearerPrefix) {
                http.Error(w, "missing bearer token", http.StatusUnauthorized)
                return
            }
            tokenStr := strings.TrimPrefix(authz, bearerPrefix)

            // Parse + validate. Whitelist ES256 explicitly to defend
            // against algorithm-confusion attacks.
            token, err := jwt.Parse(
                tokenStr,
                verifier.Keyfunc(),
                jwt.WithValidMethods([]string{"ES256"}),
            )
            if err != nil || !token.Valid {
                http.Error(w, "invalid token", http.StatusUnauthorized)
                return
            }

            claims, ok := token.Claims.(jwt.MapClaims)
            if !ok {
                http.Error(w, "invalid claims", http.StatusUnauthorized)
                return
            }

            sub, _ := claims["sub"].(string)
            email, _ := claims["email"].(string)
            authUserID, err := uuid.Parse(sub)
            if err != nil {
                http.Error(w, "invalid subject", http.StatusUnauthorized)
                return
            }

            ctx := context.WithValue(r.Context(), claimsCtxKey{}, AuthClaims{
                AuthUserID: authUserID,
                Email:      email,
            })
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func FromContext(ctx context.Context) (AuthClaims, bool) {
    c, ok := ctx.Value(claimsCtxKey{}).(AuthClaims)
    return c, ok
}

// ContextWithClaims is exported for tests (e.g. users.service_test.go).
func ContextWithClaims(ctx context.Context, c AuthClaims) context.Context {
    return context.WithValue(ctx, claimsCtxKey{}, c)
}

// ErrNoClaims is returned by FromContext-style consumers to signal an
// authenticated path was reached without the middleware. Retained for
// compatibility with existing call sites.
var ErrNoClaims = errors.New("no auth claims in context")
```

> **Adapt to existing signatures.** Check the current `middleware.go` before pasting — if it already exports a constructor or context helpers with different names, preserve those names and only change the validation internals. The public surface consumed by `users.Service` and `httpsrv` should not change as a result of this pass.

**Acceptance:**
- `go build ./internal/auth/...` clean.
- `grep SigningMethodHS256 backend/internal/auth/` returns no matches.
- Any test files in `backend/internal/auth/` either still compile or have been updated; if they mock the old secret-based path, adapt them to the new `*JWKSVerifier` seam (see Phase 7).

---

### Phase 4 — `main.go` wiring

**File:** `backend/cmd/api/main.go`.

Changes:
- Remove any reference to `cfg.SupabaseJWTSecret`.
- Derive the JWKS URL from `cfg.SupabaseURL`:
  ```go
  jwksURL := strings.TrimRight(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
  ```
- Construct the verifier eagerly and panic on failure:
  ```go
  verifier, err := auth.NewJWKSVerifier(ctx, jwksURL)
  if err != nil {
      log.Fatalf("auth: initialise JWKS verifier: %v", err)
  }
  ```
  Use whichever `context.Context` `main.go` already has in scope — typically a long-lived background context for server lifetime.
- Pass `verifier` into the existing `auth.Middleware(...)` call site (likely inside `httpsrv` router setup). If the middleware was previously constructed with `cfg.SupabaseJWTSecret`, replace that argument with `verifier`.

**Acceptance:**
- `go build ./...` clean (this is the first phase at which a full-project build passes after Phase 2 broke it).
- `go vet ./...` clean.
- `go run ./cmd/api` exits cleanly on `SIGINT` after printing the JWKS-fetch log line. (Server binds its port and waits for requests.)

**Failure modes to watch for:**
- `auth: initial JWKS fetch from https://<ref>.supabase.co/auth/v1/.well-known/jwks.json: context deadline exceeded` → either `SUPABASE_URL` is wrong, or outbound network from your machine to Supabase is blocked. Re-run the curl from pre-work.
- `no keys in JWKS` / zero-length key set → rare; indicates a Supabase misconfiguration. Check the dashboard's JWT Keys section.

---

### Phase 5 — Docs update

Five targeted edits to existing docs. No new docs beyond this plan itself.

**5a. `docs/stack.md` §5 "Auth flow (Supabase ↔ Go) — Request validation (backend)".**

Rewrite steps 2–3 to describe ES256 + JWKS instead of HS256. Suggested replacement (keep adjacent steps 1, 4, 5 as-is):

```markdown
2. Parses the JWT and resolves the public key for the token's `kid` via
   the JWKS cache (fetched once from `$SUPABASE_URL/auth/v1/.well-known/jwks.json`
   at boot, refreshed hourly; cache misses trigger an immediate refetch).
3. Validates the signature with ES256 (ECDSA / P-256) and rejects any
   other algorithm. Extracts `sub` (Supabase auth user UUID) and `email`.
```

Update the "JWT validation is offline" paragraph:

```markdown
### JWT validation is offline (after boot)

The JWKS document is fetched once at backend boot and cached in memory;
subsequent request-path validation is fully offline (ECDSA verify against
the cached public key). The cache refreshes in the background every hour
and immediately on any unknown `kid` — so Supabase-side key rotations
propagate without a backend restart.
```

**5b. `docs/stack.md` §8 env vars table.** Remove the `SUPABASE_JWT_SECRET` row entirely.

**5c. `CLAUDE.md` §Environment.** Update the "Required backend vars (panic-on-missing)" list: remove `SUPABASE_JWT_SECRET`. No replacement var.

**5d. `CLAUDE.md` top "Backend layout" bullet on `auth/`.** Current text says "(HS256, offline validation via shared secret)". Change to "(ES256, offline validation via cached JWKS from Supabase's well-known endpoint)".

**5e. `docs/backend-scaffolding.md`.** Find the section(s) that describe the HS256 middleware scaffold (should be §8 or §9 based on 0.1.0 changelog) and add a "Superseded — see `docs/executing/auth-es256-migration.md`" note at the top of the relevant subsection. Do not delete the original prose — it remains accurate as an account of what 0.1.0 shipped; the note just points readers to the current state.

**Acceptance:**
- `grep -r SUPABASE_JWT_SECRET docs/ CLAUDE.md` returns no matches (except possibly inside `docs/changelog.md`, which is historical and should NOT be rewritten).
- `grep -r HS256 docs/ CLAUDE.md` only matches intentional "we migrated away from HS256" references.

---

### Phase 6 — Validation

**6a. Boot smoke.**

```bash
cd backend
go build -o bin/api ./cmd/api
./bin/api
```

Expect: a log line indicating JWKS was fetched (keyfunc logs by default; if silent, add a single `log.Printf("auth: JWKS initialised from %s", jwksURL)` after the verifier construction). Server should bind and not exit.

**6b. End-to-end sign-in** (after the provisioning plan's Phase 1–5 have also landed):

1. `overmind start` from repo root.
2. Create a test user in Supabase dashboard (auto-confirm email).
3. Sign in at `http://localhost:3000/sign-in`.
4. Dashboard renders the test user's email. No `401` errors in the backend logs at the RPC layer.

**6c. Algorithm-confusion defence — manual sanity check.** Forge a JWT signed with HS256 using the JWKS public key as the shared secret (classic confusion attack). Send it as a Bearer token. Expect `401` with "invalid token" — the `jwt.WithValidMethods([]string{"ES256"})` whitelist should reject it before signature verification even runs.

Optional but cheap; skip if time is tight.

**Acceptance:**
- 6a and 6b pass.
- 6c (if attempted) rejects the forged token with a clean 401.

---

### Phase 7 — Follow-ups tracked (not implemented)

For the user-authored changelog entry's "Known pending work":

- **JWKS integration test** with `httptest.Server` + static JWKS JSON + signed test JWTs. Non-trivial setup; defer until `auth/` gains more branches or a regression shakes out.
- **Structured logging / metrics around JWKS refresh cycles.** Current setup uses keyfunc's default logger. Observability polish.
- **Key-rotation runbook** documenting expected behaviour when Supabase rotates keys server-side (should be transparent, but worth a one-page doc for oncall).
- **Explicit `SUPABASE_JWKS_URL` override env var.** Currently derived from `SUPABASE_URL`. If a future use case needs to point the backend at a non-canonical JWKS (e.g., a test fixture in CI), add an optional override.

---

## 5. Rollback plan

Pure git revert of the migration commit(s). No DB migrations touched. If a rollback is needed:

```bash
git revert <migration-commit-sha>
go mod tidy      # keyfunc/jwkset come back out of go.sum
```

Restore `SUPABASE_JWT_SECRET` in `backend/.env` from the operator's secrets store *only if* you intend to go back to the legacy HS256 path — which presumes Supabase still exposes the legacy secret on the project. Not expected to be needed; flagged for completeness.

---

## 6. Validation summary

End of this plan, all true:

- [ ] `github.com/MicahParks/keyfunc/v3` is a direct dependency of `backend/`.
- [ ] No reference to `SUPABASE_JWT_SECRET` or `SupabaseJWTSecret` exists in the codebase or committed docs (excluding `docs/changelog.md` which is historical).
- [ ] `backend/internal/auth/` exports `NewJWKSVerifier`, `Middleware(verifier)`, `FromContext`, `ContextWithClaims`, `AuthClaims`. HS256-specific code is gone.
- [ ] `main.go` eager-fetches JWKS on boot and `log.Fatalf`s on failure.
- [ ] `go vet ./... && go build ./... && go test ./...` clean from `backend/`.
- [ ] Middleware enforces `alg == ES256` explicitly via `jwt.WithValidMethods`.
- [ ] `stack.md` §5, `stack.md` §8, `CLAUDE.md` §Environment, `CLAUDE.md` backend-layout bullet all describe ES256 + JWKS.
- [ ] Boot smoke (6a) succeeds; end-to-end sign-in (6b) succeeds once the provisioning plan has also landed.

---

## 7. What this unblocks

- **`docs/plans/auth-user-provisioning.md` Task 7b** — the end-to-end sign-in smoke test. Provisioning + this plan jointly deliver the stack.md §12 hour-5 milestone.
- **FE sign-in against the current Supabase project** — literally any authenticated RPC call stops returning 401.
- **Future Supabase key rotations** — now a server-side ops concern, not a deploy event on our side. Rotating the signing key in Supabase dashboard propagates within 1 hour of cache TTL or immediately on first `kid`-miss.

---

## 8. Non-goals

Deliberately out of scope:

- Frontend changes. The access token is opaque to the FE; Supabase client handles issuance and refresh.
- Service-role / admin-API access from the backend. `sb_secret_...` stays in the operator's password manager; no Go code path needs it.
- Implementing invitation flow / multi-tenant auth policies. Separate plans.
- Custom JWT signing on our side (e.g., backend-issued tokens for M2M use). None of our RPCs need it in v1.
- Migrating the frontend's `@supabase/ssr` client. FE auth flow is unchanged.

---

## 9. Order of operations vs. the provisioning plan

Both plans touch the auth path, but at different layers (this plan: validation middleware; provisioning plan: `auth.users` trigger). They don't conflict in code; the sequencing is strictly a join at end-to-end validation.

Recommended execution order:

1. **This plan, Phases 1–5** (this plan's code is contained and small; land first to unblock clean E2E testing).
2. **Provisioning plan, Phases 1–6** (can start in parallel with step 1 — no file overlap).
3. **Joint validation:** this plan's Phase 6 + provisioning plan's Task 7b. These are effectively the same test (sign in, see dashboard); they just assert different invariants.

If you prefer strict sequence, do this plan fully first, then provisioning. The parallel-until-join path saves perhaps an hour of elapsed time at the cost of having two incomplete branches in flight simultaneously — whether that's a good trade depends on whether you're working solo or with others.
