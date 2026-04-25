# Phase 5 Completion — Docs Update (HS256 → ES256 / JWKS)

**Plan:** `docs/executing/auth-es256-migration.md` Phase 5
**Date:** 2026-04-24
**Status:** complete. Acceptance gate (`grep -r SUPABASE_JWT_SECRET docs/ CLAUDE.md` → 0 matches, scoped to live docs) passes clean. Full-binary `go build` + `go vet` + `go test` also clean — the provisioning work that was blocking Phase 4 validation has since landed.

---

## Summary

Five targeted edits across three files propagate the ES256 + JWKS reality from the code layer (already landed in Phases 1–4) into the living documentation. Historical docs — `docs/changelog.md`, the four ES256 phase-completion docs, the migration plan itself, and the archived scaffolding recipe — were deliberately left untouched; rewriting them would collapse the repo's audit trail.

The original plan called the scaffolding edit "`docs/backend-scaffolding.md`," but that file has since been moved to `docs/archive/backend-scaffolding.md` (and a handful of live-doc references to the old path now dangle — noted below as out-of-scope but worth flagging). I added the supersession note to the archive copy; that's where the historical prose now lives.

---

## What changed, where, why

### 5a — `docs/stack.md` §5 "Request validation (backend)"

Rewrote steps 2 and 3, and rewrote the "JWT validation is offline" subsection heading + paragraph.

**Before (steps 2–3):**
```
2. Validates JWT signature against `SUPABASE_JWT_SECRET` (HS256).
3. Extracts `sub` (Supabase auth user UUID) and `email`.
```

**After:**
```
2. Parses the JWT and resolves the public key for the token's `kid`
   via the JWKS cache (fetched once from
   `$SUPABASE_URL/auth/v1/.well-known/jwks.json` at backend boot,
   refreshed hourly in the background; unknown `kid`s trigger an
   immediate rate-limited refetch).
3. Validates the signature with ES256 (ECDSA / P-256) and rejects
   any other algorithm via `jwt.WithValidMethods` — defence against
   algorithm-confusion attacks. Extracts `sub` (Supabase auth user
   UUID) and `email`.
```

Step 3 now explicitly names `jwt.WithValidMethods` as the algorithm-whitelist mechanism — this is the detail a future reader needs to answer "why doesn't this accept HS256-forged tokens signed with the public key as an HMAC secret?" without digging into the code.

**Offline paragraph (before):**
```
### JWT validation is offline

No network call to Supabase to validate a token. Shared secret + HMAC
signature check is enough. Token expiry is enforced (default: 1 hour),
refresh happens on the FE via `@supabase/supabase-js`.
```

**After:**
```
### JWT validation is offline (after boot)

The JWKS document is fetched once at backend boot and cached in
memory; all subsequent request-path validation is fully offline
(ECDSA verify against the cached public key). The cache refreshes
in the background every hour and immediately on any unknown `kid`
(rate-limited to one refetch per 5 minutes) — so Supabase-side key
rotations propagate within the cache TTL without a backend restart.
Token expiry is enforced (default: 1 hour); refresh happens on the
FE via `@supabase/supabase-js`.
```

Heading gained the "(after boot)" qualifier — the old heading overstated the offline claim (boot-time fetch is an online step). The paragraph now names the two refresh triggers (hourly tick + unknown-kid refetch with 5-min rate limit), which matches the keyfunc v3 `NewDefaultOverrideCtx` defaults the live code uses.

**Step 5 deliberately untouched.** It describes the auto-provisioning behavior that changelog 0.2.1 removed and that the auth-user-provisioning plan replaces with a DB trigger. Step 5's update is the provisioning plan's accountability, not this one's. Keeping ES256 and provisioning docs landing independently avoids cross-dependency in review.

### 5b — `docs/stack.md` §8 env-vars table

Deleted the row:

```
| `SUPABASE_JWT_SECRET` | backend | HMAC secret for validating access tokens |
```

No replacement row. The JWKS URL is derived from `SUPABASE_URL` at runtime; adding a documentary row for "SUPABASE_JWKS_URL is derived from SUPABASE_URL (do not set)" would be noise. Plan's Phase 7 follow-up flags the possibility of adding an explicit `SUPABASE_JWKS_URL` override env var later (for CI fixtures pointing at a test JWKS server); when/if that lands, a row gets added then.

### 5c — `CLAUDE.md` §Environment

Required-vars sentence shortened by one entry:

**Before:**
```
Required backend vars (panic-on-missing): `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_JWT_SECRET`, `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`.
```

**After:**
```
Required backend vars (panic-on-missing): `DATABASE_URL`, `SUPABASE_URL`,
`FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`. The JWKS URL for JWT
validation is derived from `SUPABASE_URL` — no separate secret needed.
```

Added the "no separate secret needed" half-sentence because a reader familiar with the HS256 pattern would expect to see the secret listed and might think it was accidentally dropped. The explicit "derived from `SUPABASE_URL`" phrasing mirrors how the code is structured (`main.go` computes `jwksURL := strings.TrimRight(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"`) and short-circuits the "where's the JWKS URL env var?" question.

### 5d — `CLAUDE.md` Backend layout bullet on `auth/`

**Before:**
```
- `auth/` — Supabase JWT middleware (HS256, offline validation via shared secret).
  Attaches `AuthClaims{AuthUserID, Email}` to request context. No DB access here —
  user provisioning is a domain concern.
```

**After:**
```
- `auth/` — Supabase JWT middleware (ES256, offline validation via cached JWKS
  from Supabase's well-known endpoint; initial fetch at boot, background hourly
  refresh, unknown-`kid` refetch rate-limited to one per 5 min). Attaches
  `AuthClaims{AuthUserID, Email}` to request context. No DB access here —
  user provisioning is a domain concern.
```

The second sentence (`Attaches AuthClaims...`) and the third (`No DB access...`) are unchanged — both are accurate after the migration. Only the parenthetical mechanism description flips. I added the rate-limit detail ("one per 5 min") because it's a real operational property an on-call engineer might need: if Supabase rotates a key and a burst of traffic hits with the new `kid`, only one refetch fires per 5 minutes even if thousands of requests arrive simultaneously.

### 5e — `docs/archive/backend-scaffolding.md` §7 "Auth middleware"

**Deviation from plan path.** Plan said `docs/backend-scaffolding.md`; the file was moved to `docs/archive/backend-scaffolding.md` at some point before this migration began. The archive header already marks the whole file as historical ("scaffolding-stage reference... live code becomes authoritative once established"), so the single-subsection supersession note remains valuable — it directs a reader who grep-landed on §7 to the current state without having to read and reconcile the whole archive document.

Prepended a blockquote note immediately after `## 7. Auth middleware`:

```markdown
> **Superseded — see `docs/executing/auth-es256-migration.md`.** This
> section captures the 0.1.0 HS256 scaffold (shared-secret HMAC
> validation via `SUPABASE_JWT_SECRET`). The live code now validates
> ES256 signatures against a cached JWKS fetched from Supabase's
> `.well-known` endpoint; the `SUPABASE_JWT_SECRET` config field and
> env var have been removed. The prose below is preserved as the
> historical record of what 0.1.0 shipped — do not edit it to match
> the current state; read the completion docs in
> `docs/completions/auth-es256-migration-phase*-completion.md` for
> what actually landed.
```

Chose a blockquote (`>`) instead of a fenced callout because plain Markdown blockquotes render correctly in every tool that might read this file (VSCode preview, GitHub, terminal pagers, `cat`) — GitHub's admonition extension (`> [!NOTE]`) is tool-specific. The four-word "Superseded — see X" prefix is the grep-target; the rest is the operator's FAQ preempt.

**Not also annotated, deliberately:**
- §5 Configuration package (line 189 shows `SupabaseJWTSecret` in the `Config` struct example). The whole file is now archival and individually flagging every retired field would be busywork; §7 is the primary user-facing auth-middleware reference, and a reader who lands there gets the full picture. A grep for `SUPABASE_JWT_SECRET` in `docs/archive/` still finds the historical code sample — which is correct, since the sample is a factual record of what the config package looked like at 0.1.0.
- §12.3 First deploy (line 830, `fly secrets set ... SUPABASE_JWT_SECRET="..."`). Same rationale.

---

## Acceptance verification

| Plan acceptance | Result |
|---|---|
| `grep -r SUPABASE_JWT_SECRET docs/ CLAUDE.md` → 0 matches in live docs (changelog + completions + executing + archive excluded as historical) | ✅ |
| `grep -r HS256 docs/ CLAUDE.md` → only intentional "we migrated away" references in live docs (same exclusions) | ✅ |
| Full-binary `go build ./...` clean | ✅ (bonus — unblocked by provisioning work landing in parallel) |
| `go vet ./...` clean | ✅ |
| `go test ./...` passes | ✅ (`internal/users` has a real test suite that passes; other packages have no test files) |

Exclusion policy applied in the grep:
- `docs/changelog.md` — repo convention treats the changelog as append-only history; editing old entries to match current state collapses the timeline.
- `docs/completions/auth-es256-migration-phase*-completion.md` — the four completion docs describing the migration itself; every HS256 / `SUPABASE_JWT_SECRET` reference is the migration's subject matter.
- `docs/executing/auth-es256-migration.md` — the plan itself; it describes HS256 because that's what it's migrating away from.
- `docs/archive/backend-scaffolding.md` — explicitly archival, with the new §7 supersession note pointing forward to live state.

---

## Out-of-scope observations (flagged for a future cleanup pass)

Three pre-existing live-doc references to `docs/backend-scaffolding.md` still point at the old (pre-archive) path. None are caused by this migration, and none are in this plan's Phase 5 scope, but worth naming so a future contributor (or the user) can fix them in a single dedicated pass:

- `CLAUDE.md:9` — "Only `backend/` is partially scaffolded (through §10 of `docs/backend-scaffolding.md` — the `GetCurrentUser` RPC pipeline)." The path is broken, and the sentiment ("partially scaffolded") is also outdated now that Phases 1–4 + provisioning have landed.
- `CLAUDE.md:17` — doc hierarchy bullet: "`docs/backend-scaffolding.md` / `docs/frontend-scaffolding.md` — step-by-step recipes with starter code." Broken path.
- `CLAUDE.md:44` — "Planned packages (blueprint §9, scaffolded empty at §15 of backend-scaffolding)…" Broken relative reference.
- `docs/stack.md:9` — companion docs bullet: "`backend-scaffolding.md` — step-by-step recipe for creating `backend/`, with starter file contents." Broken.
- `docs/frontend-scaffolding.md:17` — companion docs bullet: "`backend-scaffolding.md` — mirrored guide for the Go half." Broken.

All five want the same update: `docs/backend-scaffolding.md` → `docs/archive/backend-scaffolding.md`, plus a clarifying note that the file is archival and live code is authoritative. I deliberately did not bundle this cleanup into Phase 5 — it's unrelated to the ES256 migration, and scope-creeping it in would muddy the `git log -- docs/` attribution story. A separate commit titled "fix stale `backend-scaffolding.md` paths (file is now under archive/)" would be the clean unit.

---

## One minor divergence from my earlier Phase 3 completion doc

Phase 3 completion doc stated: *"no test files in `internal/auth/`; `ContextWithClaims` and `ErrNoClaims` have no callers, omitted."* The live `middleware.go` now exports `ContextWithClaims` (re-added by the user after Phase 3 landed, for anticipated admin-path + test use). This doesn't invalidate anything in the migration, but the Phase 3 completion doc's framing of "added only what has a caller today" no longer literally holds for that helper. The decision to re-add is sound — `ContextWithClaims` is a legitimately exported testing / admin-synthesis seam — but worth noting here so future readers auditing the "did Phase 3 follow minimal-scope rules?" question don't get confused by a direct read of the live file.

---

## Risk / rollback

`git revert` of the Phase 5 commit restores the HS256 prose across all three live files + the archive supersession note. No code, no migration, no deployable artifact is touched. If Phase 5 needed to be undone (e.g., a broader doc-restructuring PR wanted to land first and Phase 5's edits created merge conflicts), the revert is free.

---

## Handoff

Phase 6 (boot smoke + end-to-end sign-in + optional algorithm-confusion defence check) is now unblocked:
- The migration itself: landed (Phases 1–4).
- The docs: consistent with the code (Phase 5 — this).
- The provisioning blocker: resolved (Option A from Phase 4's completion doc — handler implementation now in place).

Remaining plan work: Phase 6 (validation — requires a reachable Supabase project + a test user), Phase 7 (follow-ups tracked but not implemented — JWKS integration test, structured-logging polish, key-rotation runbook, optional `SUPABASE_JWKS_URL` override env var). Neither is blocking for merge of the migration.
