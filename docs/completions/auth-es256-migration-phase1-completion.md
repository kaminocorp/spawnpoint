# Phase 1 Completion — Add JWKS Library Dependency

**Plan:** `docs/executing/auth-es256-migration.md` Phase 1
**Date:** 2026-04-24
**Status:** complete, clean build, ready for Phase 2

---

## Summary

Added `github.com/MicahParks/keyfunc/v3@v3.8.0` to the backend Go module as the JWKS adapter for `golang-jwt/jwt/v5`. The transitive dependency `github.com/MicahParks/jwkset@v0.11.0` came along automatically (keyfunc v3 is a thin layer on top of jwkset — jwkset owns the HTTP-fetching JWKS client + in-memory storage; keyfunc wraps it to produce a `jwt.Keyfunc` consumable by `jwt/v5`). `golang.org/x/time@v0.9.0` came along as a second-order transitive from jwkset's rate limiter.

No source code was touched. No `import` was added. Phase 1 is strictly a module-graph change.

---

## What changed, where, why

### `backend/go.mod`

Added three entries in the second (indirect) `require` block:

```
github.com/MicahParks/jwkset v0.11.0 // indirect
github.com/MicahParks/keyfunc/v3 v3.8.0 // indirect
golang.org/x/time v0.9.0 // indirect
```

*Why indirect, not direct?* Go's module tooling distinguishes **direct** (imported by this module's source) from **indirect** (pulled in but not imported). `go get X` without a matching `import X` in the source tree places X in the indirect block. The instant Phase 3 adds `import "github.com/MicahParks/keyfunc/v3"` to `backend/internal/auth/jwks.go`, the next `go mod tidy` will promote keyfunc/v3 to the direct `require` block automatically; jwkset + x/time stay indirect because we never import them directly.

### `backend/go.sum`

Six new entries — the module hash and the go.mod hash for each of the three new modules:

```
github.com/MicahParks/jwkset v0.11.0 h1:...
github.com/MicahParks/jwkset v0.11.0/go.mod h1:...
github.com/MicahParks/keyfunc/v3 v3.8.0 h1:...
github.com/MicahParks/keyfunc/v3 v3.8.0/go.mod h1:...
golang.org/x/time v0.9.0 h1:...
golang.org/x/time v0.9.0/go.mod h1:...
```

Checksums are what make `go build` reproducible across machines — they pin the exact bytes of the module zip, so a compromise of the proxy or a silent republish is detectable.

---

## Deviation from the plan — `go mod tidy` intentionally skipped

**What the plan said:** "`go get github.com/MicahParks/keyfunc/v3@latest` then `go mod tidy`."

**What I did:** ran `go get` only; skipped `go mod tidy`.

**Why:** `go mod tidy` prunes any directly-declared `require` entry whose package no source file imports. In Phase 1 — by the plan's own design — no file imports keyfunc yet (the import lands in Phase 3). Running tidy in this state removes keyfunc + jwkset + x/time from `go.mod` and from `go.sum` entirely, producing a state equivalent to "the dep was never added," which contradicts Phase 1's acceptance criteria ("go.sum updated", "keyfunc listed as a dependency").

**What the plan's intent was presumably:** this phase boundary makes sense in a workflow where Phase 1 and Phase 3 happen back-to-back in a single code change — tidy runs once at the end and everything settles consistently. In our staged execution (Phase 1 lands, then Phase 2 retires config field, then Phase 3 introduces the import), tidy between phases would thrash the module graph.

**Knock-on effect for Phase 3:** the acceptance check "`keyfunc/v3` is a direct dependency" is satisfied only after Phase 3's `import` + a subsequent `go mod tidy`, at which point the entry moves from the indirect block to the direct block automatically. No special action needed — just run `go mod tidy` at Phase 3's end.

---

## Acceptance verification

| Plan acceptance | Result |
|---|---|
| `backend/go.mod` lists `github.com/MicahParks/keyfunc/v3` as a dependency | ✅ (indirect block; promoted to direct at Phase 3 on first import + tidy) |
| `backend/go.sum` updated | ✅ (6 new entries for 3 modules) |
| `go build ./...` clean | ✅ |

---

## Version pinned + expected API surface

- `github.com/MicahParks/keyfunc/v3 v3.8.0`
- `github.com/MicahParks/jwkset v0.11.0`
- `golang.org/x/time v0.9.0`

The plan (decision 4 + Phase 3 notes) assumes this v3 API surface:
- `jwkset.NewDefaultHTTPClient([]string{url})` → returns a `Storage` (which is itself a JWKSet reader backed by a goroutine refreshing from the URL). Confirmed in v3.8.0 (`github.com/MicahParks/jwkset@v0.11.0/http_client.go`).
- `keyfunc.New(keyfunc.Options{Storage, Ctx})` → constructs the `keyfunc.Keyfunc` wrapper.
- `(keyfunc.Keyfunc).Keyfunc(*jwt.Token) (any, error)` → the method value satisfying `jwt.Keyfunc`.

If any of these shift in a later v3.x patch before Phase 3 lands, Phase 3's implementer note ("consult the keyfunc README for the equivalent — the *shape* is stable") covers it.

---

## Risk / rollback

Pure module-graph change. `git revert` plus `go mod tidy` restores the pre-Phase-1 state exactly. No runtime code paths touched, no environment variables added or removed, no contracts changed.

---

## Handoff to Phase 2

Phase 2 retires `SUPABASE_JWT_SECRET` from:
- `backend/internal/config/config.go` (`SupabaseJWTSecret` field + env tag)
- `.env.example` (line 42)
- `backend/.env` (line 10)

After Phase 2, `go build ./...` will **fail** on `backend/cmd/api/main.go` and `backend/internal/httpsrv/server.go` — both of which reference `d.Config.SupabaseJWTSecret` via the now-removed field. Phase 3 + 4 restore the build by wiring the new `JWKSVerifier` in. This staged failure is intentional — it guarantees nothing can accidentally still reference the retired field once the phase chain lands.
