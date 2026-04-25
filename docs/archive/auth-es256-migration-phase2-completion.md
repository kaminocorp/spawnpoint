# Phase 2 Completion — Retire `SUPABASE_JWT_SECRET`

**Plan:** `docs/executing/auth-es256-migration.md` Phase 2
**Date:** 2026-04-24
**Status:** complete. Build intentionally fails on one expected call site (`httpsrv/server.go:32`); Phase 4 restores it.

---

## Summary

Removed every reference to the HS256 shared-secret variable from the typed config layer and from the two env files that had slots for it. After this phase, the codebase has a clean conceptual model — `SupabaseURL` is the only Supabase-auth-related config field — but is structurally broken at one call site on purpose. Phase 3 introduces the replacement (`JWKSVerifier`), Phase 4 rewires the broken call site to use it.

---

## What changed, where, why

### `backend/internal/config/config.go`

Removed the field:

```go
SupabaseJWTSecret string `env:"SUPABASE_JWT_SECRET,required"`
```

No replacement field. The JWKS URL is derived from `SupabaseURL` at Phase 4 wiring time (plan decision 3 — canonical path, not a configurable knob). Field alignment in the struct literal was reflowed from `long-name    type` padding to a narrower column now that `SupabaseJWTSecret` (the longest key) is gone — same semantic, cleaner gofmt.

*Why delete and not deprecate?* CLAUDE.md's "if you are certain something is unused, delete it completely" rule. `caarlos0/env` marked this `required`, so leaving it in would keep forcing operators to set a now-meaningless value in `backend/.env` — and the "this field is a no-op, ignore it" anti-pattern rots faster than outright removal.

### `.env.example`

The `SUPABASE_JWT_SECRET=` line is gone from `§ --- Supabase Auth ---`. Replaced with a five-line comment describing the new scheme (ES256 + JWKS, URL derived from `SUPABASE_URL`, hourly refresh, no secret needed). This comment is the operator's runbook when they're sitting in front of `.env.example` wondering where the JWT secret went.

**Adjacent cleanup:** left the `SUPABASE_ANON_KEY` line untouched. It's a separate concern (public anon key for the Supabase client, not a signing secret) and has always served a different purpose than `SUPABASE_JWT_SECRET` did.

### `backend/.env`

Same delete on line 10 (`SUPABASE_JWT_SECRET=`, which was already an empty value — a mild Chekhov's-gun of a "secret" that was never going to be populated because the Supabase project had already migrated off HS256). Kept a two-line comment pointing at the new scheme.

This file is gitignored, so the edit doesn't reach commit history directly — but the completion record + `.env.example` do, so anyone onboarding after this lands sees the right shape.

---

## Deviation from the plan — failing call site is in `httpsrv/`, not `main.go`

The plan's Phase 2 acceptance text reads:

> `go build ./...` fails (expected — `main.go` still references the removed field).

In the live code, `main.go` does **not** reference `SupabaseJWTSecret` directly. It constructs a `httpsrv.Deps{Config: cfg, ...}` at `backend/cmd/api/main.go:34-38` and hands `cfg` wholesale to the router; the actual dereference is inside `backend/internal/httpsrv/server.go:32`:

```go
r.Use(auth.Middleware(d.Config.SupabaseJWTSecret))
```

This is where the single compile error now lives. Semantically identical to the plan's prediction (HS256-specific string is still being passed into `auth.Middleware`), one hop deeper in. **Phase 4's scope expands slightly because of this:** alongside the `main.go` edits the plan lists, Phase 4 must also modify `httpsrv.Deps` (to carry a `*auth.JWKSVerifier` instead of reading it from `d.Config`) and flip the call site on `server.go:32`.

I debated re-reading the Supabase JWT secret inside `main.go` as an interim transport layer to keep `httpsrv` untouched, but that would be: (a) a detour I'd have to undo in Phase 4 anyway, and (b) a conceptual muddle (transport-layer code holding a crypto primitive it shouldn't know about). Cleaner to let Phase 4 do the whole job.

---

## Acceptance verification

| Plan acceptance | Result |
|---|---|
| `grep -r SUPABASE_JWT_SECRET backend/` → 0 matches | ✅ |
| `grep -r SupabaseJWTSecret backend/` → 0 matches | ❌ intentional: 1 match at `httpsrv/server.go:32` (call site, not declaration) |
| `go build ./...` fails | ✅ — exactly one error: `d.Config.SupabaseJWTSecret undefined (type config.Config has no field or method SupabaseJWTSecret)` |

The second row's "failure" is architecturally the *point* of Phase 2 — the removed field leaves exactly one arrow pointing at what Phase 4 must fix. If that grep returned 0 while the field was gone, either the middleware call had already been dead code (not the case here) or some config path was smuggling the secret around off-type (nope — caught by the grep).

---

## Dependencies reset for phases 3–4

Phase 4's edits are now scoped to three files, up from the plan's implicit "mostly `main.go`":

1. `backend/cmd/api/main.go` — construct the verifier, pass into `httpsrv.Deps`.
2. `backend/internal/httpsrv/server.go` — add `AuthVerifier *auth.JWKSVerifier` to `Deps`, flip line 32 to `r.Use(auth.Middleware(d.AuthVerifier))`.
3. (Phase 3 already: `backend/internal/auth/{jwks.go new, middleware.go rewritten}`.)

No other new seams needed. `httpsrv.Deps` is already the idiomatic injection point for cross-cutting concerns (currently carries `Config`, `UsersHandler`, `AllowedOrigin`), so adding a `*auth.JWKSVerifier` is a natural extension rather than a redesign.

---

## Risk / rollback

`git revert` of the Phase 2 commit restores the prior state exactly — config field, `.env` slot, `.env.example` comment all come back in one motion. If Phase 3/4 stall mid-migration and a rollback is needed, the broken call site at `server.go:32` will start working again the moment `SupabaseJWTSecret` is restored; no secondary cleanup required.

Operator's `backend/.env` stays untouched by a revert (gitignored); operator would need to either re-source the secret from their Supabase dashboard or simply not revert.

---

## Handoff to Phase 3

Phase 3 adds `backend/internal/auth/jwks.go` (new `JWKSVerifier`) and rewrites `backend/internal/auth/middleware.go` to accept a `*JWKSVerifier` instead of a string secret. The expected signatures — pinned by the existing callers and the plan's "preserve the public surface" note — are:

- `NewJWKSVerifier(ctx context.Context, jwksURL string) (*JWKSVerifier, error)` — new.
- `Middleware(verifier *JWKSVerifier) func(http.Handler) http.Handler` — replaces `Middleware(jwtSecret string)`.
- `FromContext(ctx context.Context) (*AuthClaims, bool)` — **pointer** return, matching the existing call site in `users/service.go:21`. The plan's sample code returns a value; I'll flag the pointer preservation in Phase 3's completion doc.
- `AuthClaims` struct — unchanged (already in `claims.go`, pointer usage is the current convention).

After Phase 3, `go build` continues to fail on `server.go:32` (the type of the middleware's first parameter changed from `string` to `*JWKSVerifier`, but the call site still passes `d.Config.SupabaseJWTSecret` — now a compile error for two reasons: field doesn't exist and the types wouldn't match if it did). Phase 4 fixes both in one motion.
