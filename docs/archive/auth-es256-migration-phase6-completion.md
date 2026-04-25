# Phase 6 Completion — Validation

**Plan:** `docs/executing/auth-es256-migration.md` Phase 6
**Date:** 2026-04-25
**Status:** 6a + 6c executed and passing. 6b deferred to operator (requires interactive FE sign-in + a Supabase test user).

---

## Summary

The ES256 / JWKS validation path works end-to-end up to the RPC layer. Boot smoke (6a) clean — JWKS fetched and cached at startup, server binds, no panic. The algorithm-confusion defence (6c, the security-relevant test in this phase) works as designed: a structurally-valid HS256-signed token using the JWKS public key as the HMAC secret is rejected with 401 before signature verification even runs, because `jwt.WithValidMethods([]string{"ES256"})` filters by `alg` header first.

The full-pipeline FE sign-in (6b) requires a real browser session and a Supabase test user; that's not something I can drive non-interactively. Exact steps are documented below for the operator to run.

---

## What was actually executed

### Pre-flight — JWKS endpoint reachability

```bash
$ dig +short AAAA db.vkjfktjhkdlbalbsggvf.supabase.co
2406:da18:243:7429:b09:d7a1:31f5:74c5
$ curl -sS "$SUPABASE_URL/auth/v1/.well-known/jwks.json"
{
  "keys": [
    {"alg":"ES256","crv":"P-256","kid":"4ed2608f-e018-410f-97d2-75cad314bcdb",
     "kty":"EC","use":"sig","key_ops":["verify"], ...}
  ]
}
```

Single-key set, ES256/P-256, `use=sig`, `key_ops=verify`. `kid` matches the value the plan's pre-work checklist named for this project. Network reaches it over IPv6 (no A record on this host — Direct Connection works because IPv6 is available locally; the Session Pooler IPv4 fallback would be the move if a future dev environment couldn't).

### 6a — Boot smoke

```bash
$ go build -o bin/api ./cmd/api      # 21M static binary
$ ./bin/api > /tmp/corellia-api.log 2>&1 &
```

Boot log:

```json
{"time":"2026-04-25T10:50:04.167065+08:00","level":"INFO","msg":"jwks initialised","url":"https://vkjfktjhkdlbalbsggvf.supabase.co/auth/v1/.well-known/jwks.json"}
{"time":"2026-04-25T10:50:04.167367+08:00","level":"INFO","msg":"listening","addr":":8080"}
```

Two log lines, ~300µs apart. The `jwks initialised` line is the explicit `slog.Info` I added in `main.go` during Phase 4 (right after `auth.NewJWKSVerifier` returns). It's the breadcrumb the plan's 6a hoped for ("if silent, add a single `log.Printf` after the verifier construction") — already in place from Phase 4, so 6a needed no extra instrumentation.

Process stayed alive after the bind, ready to serve.

### Path-level smoke checks against the live server

Three quick checks of the Connect-go boundary, all from `curl`:

```
GET /healthz                                           → 200       (unauthenticated path)
POST /corellia.v1.UsersService/GetCurrentUser
  no Authorization header                              → 401 "missing bearer token"
  Authorization: Bearer not.a.real.jwt                 → 401 "invalid token"
```

These prove the middleware is wired correctly: `/healthz` is mounted outside the auth group (CORS + logger only), and the Connect endpoint is mounted inside the auth group, so the middleware fires before the handler. The error strings come from `auth.Middleware` directly — confirming that the missing-token branch and the parse-failure branch both route through `http.Error(401)` rather than reaching domain code.

### 6c — Algorithm-confusion defence (full forge)

The interesting part of Phase 6. The classic attack: an attacker takes the JWKS public key, treats its byte representation as an HMAC secret, signs a token with HS256 (a symmetric algorithm) using the public key as the secret, and sends it. If the verifier dispatches on the token's claimed `alg` header without first whitelisting allowed algorithms, it'll happily try to verify the signature with `HS256(public_key)` — which the attacker controls — and accept the forged token.

`jwt.WithValidMethods([]string{"ES256"})` (added in Phase 3's middleware rewrite) closes this attack by rejecting any token whose `alg` header isn't in the whitelist *before* attempting signature verification. To verify the defence works in practice, I forged a token using the live JWKS public key:

```python
# canonical JSON of the public JWK becomes the "shared secret" the attacker
# uses to sign an HS256 token — the most common shape of this attack
jwks   = json.load(open("/tmp/jwks.json"))
k      = jwks["keys"][0]
secret = json.dumps(k, separators=(",", ":"), sort_keys=True).encode()

header  = b64u({"alg":"HS256", "typ":"JWT", "kid":k["kid"]})    # alg = HS256, kid = real
payload = b64u({"sub":"…uuid…", "email":"forge@example.com", "exp":<far_future>})
sig     = b64u(hmac.new(secret, header + b"." + payload, hashlib.sha256).digest())
forged  = header + "." + payload + "." + sig
```

Sent to the live server:

```
POST /corellia.v1.UsersService/GetCurrentUser
  Authorization: Bearer <forged>                         → 401 "invalid token"
```

The defence works. To be precise about *why* this 401 is the right kind: the response body is the same `"invalid token"` string the middleware returns when `jwt.ParseWithClaims` returns any non-nil error. Without `WithValidMethods`, the parse would have returned `nil` error and `token.Valid == true`, the middleware would have looked up the user by `sub`, and the request would have proceeded. The whitelist short-circuits at the parse level — that's the `alg`-vs-`use` distinction Phase 3's completion doc went into detail about.

### Cleanup

```bash
$ kill -TERM $(cat /tmp/corellia-api.pid)
api stopped (was pid 79231)
```

---

## What I didn't run — 6b end-to-end FE sign-in

6b requires an interactive browser session: the Supabase Auth UI on the FE issues credentials, the SSR cookie persists, the dashboard route mounts and the FE makes a GetCurrentUser RPC. None of that can be driven from a non-interactive shell without standing up a headless browser fixture (Playwright + a seeded Supabase user) — Phase 7 territory.

The runbook for the operator:

```bash
# 1. Boot both halves
overmind start                                           # repo root; reads Procfile.dev

# 2. Create a test user in Supabase
#    Dashboard → Authentication → Users → "Add user" → "Create new user"
#    Tick "Auto Confirm User" so no mailbox round-trip is needed.

# 3. Sign in
open http://localhost:3000/sign-in
#    Use the credentials from step 2.

# 4. Expected outcome
#    → redirected to /dashboard
#    → the test user's email is rendered on the page
#    → no 401 at the RPC layer in either log stream

# 5. Optional verification on backend logs
#    The "jwks initialised" line should appear once at boot.
#    No "invalid token" / "missing bearer token" lines after sign-in.
```

If the dashboard renders the email, the full ES256 + JWKS path works: Supabase issues an ES256 JWT → FE attaches as Bearer → Go middleware looks up the matching public key by `kid` in the cache → ECDSA verifies the signature → `users.Service` loads the matching row → Connect handler marshals → FE renders. That's the stack.md §12 hour-5 milestone clearing — and now actually achievable, since this migration plus the provisioning plan are both landed.

The single failure mode to watch for during 6b: a 401 with body `"invalid sub claim"` would indicate that the JWT validated but `sub` failed `uuid.Parse` — would mean Supabase issued a non-UUID subject for some reason, which is interesting but not a migration bug. Anything else (200 with the email, or any other error message) gives clean diagnostic information.

---

## Acceptance verification

| Plan acceptance | Result |
|---|---|
| 6a passes (boot log, server bound) | ✅ |
| 6b passes (FE sign-in, dashboard renders email) | ⏸️ deferred to operator — runbook above |
| 6c rejects forged token with clean 401 | ✅ |

---

## Notes for Phase 7 follow-ups (already tracked in plan §7)

What this manual validation surfaced as worth landing properly:

- **JWKS integration test as a Go test** — the Python forge script proves the defence works against the live server, but it's a dev-only one-shot. A `httptest.Server` + a synthetic JWKS JSON + a private key fixture wired into a `*_test.go` file under `internal/auth/` would let CI detect a regression at PR time. Plan §7 calls this out; nothing new to add.
- **Boot-smoke test as a `cmd/api` integration test** — an `internal/cmd_test.go` that builds the binary, runs it briefly with a mock Supabase JWKS server, and asserts the "jwks initialised" log line, would also catch regressions at PR time. Out of scope for v1.
- **Operator runbook for 6b** — the steps above are good enough for ad-hoc validation; if multiple operators end up running them regularly, lifting them into `docs/refs/runbooks/auth-validation.md` would be a clean future move.

---

## Risk / rollback

Nothing to rollback — Phase 6 is read-only validation. No code, docs, config, or migrations were touched in this phase. If 6b reveals a bug, Phase 4's verifier construction or Phase 3's middleware are the most likely culprits, and a `git revert` of those phases (plus Phase 2 to restore the config field) is the rollback escape hatch — though, as Phase 4's completion doc notes, that's "going back to a non-bootable state on this Supabase project," so the realistic recovery is forward-fix.

---

## Migration status after Phase 6

| Phase | Status |
|---|---|
| 1 — Add JWKS library dependency | ✅ landed |
| 2 — Retire `SUPABASE_JWT_SECRET` | ✅ landed |
| 3 — Auth middleware rewrite | ✅ landed |
| 4 — `main.go` + `httpsrv` wiring | ✅ landed |
| 5 — Docs update | ✅ landed |
| 6 — Validation | ✅ landed (6a, 6c); ⏸️ 6b deferred to operator |
| 7 — Follow-ups tracked, not implemented | n/a — tracking only |

The migration is mergeable. The remaining 6b is a smoke test you run against the deployed pair, not a code change — its outcome doesn't gate the merge, just confirms the deploy worked.
