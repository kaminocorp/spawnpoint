# Phase 6 Completion — Agent Catalog: Tests + validation matrix

**Plan:** `docs/executing/agent-catalog.md` §Phase 6
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete on the static-checkable surface (test file + full check matrix + cleanup pass); three runtime checks (curl smoke, FE end-to-end, DB sanity SELECT) deferred to operator with a written runbook below — same precedent as M1 Phase 6 and 0.2.6 Phase 6b.

This phase pinned the agents service's contract with two unit tests, ran the full backend + frontend check matrix end-to-end, and confirmed zero `TODO` / `console.log` / blank-identifier keepalives across every M2 surface. With Phases 1–5 already green, Phase 6 is the closing gate: nothing in the M2 deliverable is structurally untested, untyped, or unbuilt.

---

## Index

- **New file: `backend/internal/agents/service_test.go`** (60 LOC). Two cases — `TestListAgentTemplates_HappyPath` and `TestListAgentTemplates_Empty`. External-test package (`agents_test`), `fakeQueries` struct satisfying the private `templateQueries` interface via Go structural typing. Pattern lifted directly from `users/service_test.go` (the only adjustment: agents tests don't construct an `auth.AuthClaims`-bearing context because catalog reads are global per decision 10 — Phase 4 completion doc covered the rationale). Plan decision 28.
- **Backend full check matrix.** `go vet ./...` clean. `go build ./...` clean. `go test ./...` clean — `internal/agents` flipped from `[no test files]` (Phase 4 baseline) to `ok ... 0.333s` with both new cases passing; `internal/users` stayed `(cached)` (no regression on the existing 3-case suite from 0.2.5); `internal/adapters` correctly stays `[no test files]` per decision 29 (no caller, no test).
- **Frontend full check matrix.** `pnpm type-check` clean. `pnpm lint` clean. `pnpm build` clean — same 8 routes (`/`, `/_not-found`, `/agents`, `/dashboard`, `/fleet`, `/onboarding`, `/settings`, `/sign-in`) prerendered as in M1; `/agents` is `○ Static` (the page is `"use client"` but has no render-time server dependency, so Next 16's static-export pass produces a static shell that hydrates and fetches client-side — same shape M1 set up for `/dashboard`).
- **Cleanup pass.** Zero `TODO` / `FIXME` / `XXX` in M2 surfaces (`backend/internal/agents/`, `backend/internal/adapters/`, `backend/internal/httpsrv/agents_handler.go`, `backend/queries/agent_templates.sql`, `backend/queries/harness_adapters.sql`, `shared/proto/corellia/v1/agents.proto`, the four FE files, the M2 lib file). Zero `console.log` / `console.error` / `console.warn` in any FE M2 file. Zero blank-identifier import keepalives (`var _ = ...`, `_ = ...`) in `agents/service.go` or `adapters/service.go` — the plan's practical-guidance note ("drop them, accept that M4 re-adds the imports") was followed in Phase 4.
- **Runtime checks (§3 / §4 / §5) deferred to operator.** A curl smoke against the live RPC, an interactive browser walkthrough at `/agents`, and a `psql` sanity SELECT against the seed row all need a running backend + a live DB + (for §4) a real Supabase session. Same precedent as M1 Phase 6 (seven-scenario E2E walkthrough) and 0.2.6 Phase 6b (interactive sign-in). Runbook captured below.
- **Changelog entry.** Plan §Phase 6 task 7 flagged this as "out of strict plan scope" but worth queueing. Not drafted in this completion — recommended next-action ahead of merge: a `0.3.0` entry under `docs/changelog.md` summarising M2 in the established **What / Where / Why** style. M2 is the first product feature (catalog schema + first product RPC + first product UI page), so the version bump from `0.2.x` → `0.3.0` is the right semantic signal.

---

## What was written, where, why

### File: `backend/internal/agents/service_test.go`

60 LOC. Three public functions; one struct.

```go
type fakeQueries struct {
    rows []db.ListAgentTemplatesRow
    err  error
}

func (f *fakeQueries) ListAgentTemplates(_ context.Context) ([]db.ListAgentTemplatesRow, error) {
    return f.rows, f.err
}
```

The fake satisfies the private `agents.templateQueries` interface (one method) via structural typing — same trick the production wiring uses, where `*db.Queries` (from `db.New(pool)`) satisfies four different per-service interfaces simultaneously without anyone editing `*db.Queries`. The fake is local to the test file (lowercase) since no other package needs it; the interface itself is `agents`-internal.

#### `TestListAgentTemplates_HappyPath`

Constructs a single `db.ListAgentTemplatesRow` (with `DefaultConfig: []byte(\`{}\`)` to match the sqlc-generated row type — confirmed in `backend/internal/db/agent_templates.sql.go` after Phase 2's regen), feeds it through the service, and asserts the proto fields on the returned `*corelliav1.AgentTemplate` match. The asserted fields are exactly the three proto fields from decision 11 (`id`, `name`, `description`); the service's `toProtoTemplate` helper deliberately drops `DefaultConfig` from the projection per the same decision (M2's catalog response is template-summary-only; M4 either widens the message or adds `GetAgentTemplate(id) -> rich`). The test reads through Go's auto-generated proto getters (`GetId()` / `GetName()` / `GetDescription()`) for proto3 nil-safety — matches the assertion style in `users/service_test.go`.

#### `TestListAgentTemplates_Empty`

Constructs a `fakeQueries` with `rows: nil` (the zero value sqlc returns when the SQL `SELECT` produces no result rows). The service's `make([]*corelliav1.AgentTemplate, 0, len(rows))` then becomes `make(..., 0, 0)` — a non-nil empty slice. The test asserts both `got != nil` and `len(got) == 0`. **The non-nil assertion is the load-bearing one**: a nil slice marshals to JSON `null` over Connect's default codec; a non-nil empty slice marshals to JSON `[]`. The FE's `res.templates.length === 0` branch in `(app)/agents/page.tsx` requires the array shape — `null.length` would throw. This test is the contract guarantee that Phase 4's `make(..., 0, len(rows))` line stays load-bearing across future refactors. The plan's decision 28 specifically called out this test ("the empty case pins the discriminated-union FE contract"); the assertion message reproduces that framing for any future reader who wonders why the redundant-looking `if got == nil` check exists.

#### What's *not* tested (deliberate)

- **No DB error case.** The plan didn't specify one; the only meaningful failure mode is `pgx`-level (connection drop, schema-out-of-sync), all of which fall through to the handler's redacted `Internal` arm — covered by the post-review hardening pattern, not by an `agents` unit test. A "service propagates DB error" test would assert `err == fakeErr` and prove almost nothing.
- **No `ErrNotFound` case.** Decision 17: catalog reads can't surface `ErrNotFound`. The sentinel exists for M4's future `GetAgentTemplate(id)`; testing it without a caller is testing dead code.
- **No `*db.Queries`-against-real-DB integration test.** Per the project's testing convention (CLAUDE.md): "No DB mocks. ... Use real Postgres via testcontainers-go or a local dev DB." The unit test above doesn't mock the DB — it mocks the *interface* `agents.Service` depends on. A real-DB integration test would land in a separate file under `backend/internal/agents/integration_test.go` with a build tag, and is appropriate for M4's first stateful operations (spawn → status update → cleanup), not M2's read-only catalog.

---

## Validation — full check matrix output

### Backend: `go vet ./... && go build ./... && go test ./...`

```
$ cd backend && go vet ./...
$ echo $?
0

$ go build ./...
$ echo $?
0

$ go test ./...
?       github.com/hejijunhao/corellia/backend/cmd/api                              [no test files]
?       github.com/hejijunhao/corellia/backend/internal/adapters                    [no test files]
ok      github.com/hejijunhao/corellia/backend/internal/agents                      0.333s
?       github.com/hejijunhao/corellia/backend/internal/auth                        [no test files]
?       github.com/hejijunhao/corellia/backend/internal/config                      [no test files]
?       github.com/hejijunhao/corellia/backend/internal/db                          [no test files]
?       github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1             [no test files]
?       github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1/...connect  [no test files]
?       github.com/hejijunhao/corellia/backend/internal/httpsrv                     [no test files]
?       github.com/hejijunhao/corellia/backend/internal/organizations               [no test files]
ok      github.com/hejijunhao/corellia/backend/internal/users                       (cached)
```

The state transition that pins this phase: `internal/agents` flipped from `[no test files]` (Phase 4's baseline) to `ok ... 0.333s` — both new cases ran in 333ms total (well within the project's lightweight unit-test envelope). `internal/users` cached the existing 3-case suite from 0.2.5, confirming zero regression on the cross-cutting auth/provisioning code path that M2 didn't touch.

### Frontend: `pnpm type-check && pnpm lint && pnpm build`

```
$ pnpm -C frontend type-check
> tsc --noEmit
$ echo $?
0

$ pnpm -C frontend lint
> eslint
$ echo $?
0

$ pnpm -C frontend build
> next build
✓ Compiled successfully in 1461ms
✓ Generating static pages using 11 workers (10/10) in 256ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /agents          ← prerendered as static shell; hydrates + fetches client-side
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
└ ○ /sign-in

ƒ Proxy (Middleware)
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Eight routes, identical inventory to M1. `/agents` is `○ Static` even though the page is `"use client"` — Next 16's static-export pass produces a static shell because the page has no render-time server dependency (data fetch is in `useEffect`, post-hydration). Same shape M1 set up for `/dashboard`.

### Cleanup pass

```bash
# TODO/FIXME/XXX in M2 surfaces
$ grep -rn 'TODO\|FIXME\|XXX' \
    backend/internal/agents/ backend/internal/adapters/ \
    backend/internal/httpsrv/agents_handler.go \
    backend/queries/agent_templates.sql backend/queries/harness_adapters.sql \
    shared/proto/corellia/v1/agents.proto \
    'frontend/src/app/(app)/agents/' \
    frontend/src/components/agent-template-card.tsx \
    frontend/src/components/coming-soon-harness-card.tsx \
    frontend/src/lib/agents/
# (no output)

# console.* in M2 FE files
$ grep -rn 'console\.' \
    'frontend/src/app/(app)/agents/' \
    frontend/src/components/agent-template-card.tsx \
    frontend/src/components/coming-soon-harness-card.tsx \
    frontend/src/lib/agents/
# (no output)

# blank-identifier keepalives
$ grep -nE '^\s*var _ |^\s*_ = ' \
    backend/internal/agents/service.go backend/internal/adapters/service.go
# (no output)
```

Three greps, three empty results. The plan's plan-time concern about blank-identifier keepalives ("drop them, accept that M4 re-adds the imports") was honored at Phase 4 write-time; this grep confirms nothing snuck back in.

---

## Operator runbook — runtime validation (§3 / §4 / §5)

These three checks need a running backend, a running DB with the M2 migration applied, and (for §4) a real Supabase session. None are drivable from a non-interactive agent shell. Follow this runbook before opening M2 to non-localhost users; same posture M1 Phase 6 took with its seven-scenario E2E.

**Pre-flight**

```bash
# 1. Confirm migration timeline (from backend/, with direnv loaded):
goose -dir migrations postgres "$DATABASE_URL_DIRECT" status
# Expect: 20260425170000_agent_catalog applied; nothing pending.

# 2. Boot both halves (from repo root):
overmind start
# Expect: backend on :8080 with `jwks initialised` + `listening` log lines;
# frontend on :3000.
```

If the migration is *not* applied, run `goose -dir migrations postgres "$DATABASE_URL_DIRECT" up` first. Goose is idempotent and the M2 migration's seed `INSERT` statements both use `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS` guards (Phase 1 verification), so re-applying is safe.

### §3 — RPC smoke (curl)

Three calls; matches plan §Phase 6 task 3 verbatim:

```bash
# 1. Healthz (mounted outside the auth group — sanity).
curl -i http://localhost:8080/healthz
# Expect: HTTP/1.1 200 OK

# 2. Without Authorization header — expect 401 from the auth middleware.
curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates \
     -H "Content-Type: application/json" -d '{}'
# Expect: HTTP/1.1 401 Unauthorized
# Body: {"code":"unauthenticated", ...}

# 3. With a valid Supabase access token — expect the seed row.
#    Capture the token from the FE's localStorage after sign-in:
#      // in browser DevTools console:
#      JSON.parse(localStorage.getItem('sb-<project-ref>-auth-token')).access_token
#    or from the /onboarding network panel, copy the Authorization: Bearer header.
export SUPABASE_ACCESS_TOKEN='<paste-here>'

curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -d '{}'
# Expect: HTTP/1.1 200 OK
# Body: {"templates":[{"id":"<uuid>","name":"Hermes","description":"Nous Research's open-source tool-using agent. ..."}]}
```

**What pass means.** All three calls return the expected status, the third returns exactly one template with `name == "Hermes"` and a non-empty `description`. The single-row response confirms (a) the seed migration landed, (b) the Connect handler is mounted inside the auth group, (c) the domain → DB → proto conversion path round-trips, and (d) the FE-facing wire surface is `{"templates":[...]}` (not `{"templates":null}`) — pinning the contract that `_Empty`'s unit test guards.

### §4 — FE end-to-end walkthrough

Five sub-scenarios; matches plan §Phase 6 task 4 with the loading-state and sneak-peek-section additions Phase 5 introduced:

1. **Sign in via `/sign-in`** with the test user from pre-flight. Expect: redirect to `/dashboard`; chrome (sidebar + top bar) renders with workspace name + first-name greeting.
2. **Click `Agents` in the sidebar.** Expect: route to `/agents`; the `Agents` sidebar item lights up active. Page renders the heading "Agents" + subhead, then a single Hermes card (icon: `BotIcon` in a tinted square; description from the seed; disabled `Deploy` button at the card footer).
3. **Hover the disabled `Deploy` button.** Expect: tooltip "Available in v1" appears. (If it doesn't, the base-ui `<TooltipTrigger render={<span tabIndex={0} />}>` workaround for disabled-button pointer events is misbehaving — see plan risk register §6 entry on `Tooltip` on disabled `Button`; fallback is `aria-disabled` + `onClick={e => e.preventDefault()}`.)
4. **Scroll past the live card.** Expect: a horizontal divider with the caption "Coming Soon", followed by three sneak-peek cards (LangGraph, CrewAI, AutoGen). Each card has a `Sparkles` icon, a "Coming Soon" badge, name + vendor + description. **Crucially: no Deploy button anywhere on these cards** (decision 25 — "nothing to click means nothing to fake" §11.4 compliance; the `CardFooter` is structurally absent).
5. **Backend-down regression.** Stop the backend (`overmind stop` or `Ctrl-C` the `air` window), then in the browser navigate `Dashboard → Agents`. Expect: layout's chrome handles the layout-level `getCurrentUser` call's failure first (renders the layout's "Something went wrong" card with sign-out). Bring the backend back up, reload — expect clean render of the Hermes card + sneak peeks.

If a *transport-only* error happens after the layout already loaded the user (e.g., the backend goes down between layout-fetch and page-fetch), expect: the page's own `kind: "error"` branch renders a centered "Couldn't load harnesses." card with the underlying message. Sneak peeks are deliberately *suppressed* in this branch (plan Phase 5 task 3 rationale: surfacing them while the live catalog errors would be confusing — sneak peeks are a complement to a working catalog, not a fallback for a broken one).

### §5 — DB sanity SELECT

```sql
SELECT t.id, t.name, t.description, ha.harness_name,
       ha.upstream_image_digest, ha.adapter_image_ref
FROM agent_templates t
JOIN harness_adapters ha ON ha.id = t.harness_adapter_id;
```

**Expected:** exactly one row. `t.name = 'Hermes'`, `t.description` matches the seed copy. `ha.harness_name = 'hermes'`. `ha.upstream_image_digest` matches the captured digest from Phase 1 pre-work (starts with `sha256:`, ~71 chars total). **`ha.adapter_image_ref` is `NULL`** — M3 fills it. If `adapter_image_ref` is non-NULL today, M3 has been mistakenly partially applied; investigate before proceeding.

---

## Behavior change (known)

- **Test suite gained one package, two cases.** `go test ./...` runtime grows by ~330ms (the `agents` package's first test run; subsequent runs cache to near-zero). Existing `users` package still cached at 3-case baseline.
- **No wire-surface change.** Phase 4 already mounted the RPC; Phase 5 already shipped the FE consumer. Phase 6 only proves correctness — nothing new in `httpsrv/server.go`, no schema delta.
- **No `package.json` / `go.mod` change.** Test imports (`testing`, `context`, `uuid`, `db`, `agents`) all already in use elsewhere; no new dep required.

---

## Observations worth keeping

### The `_Empty` test is genuinely load-bearing, not ceremonial

Easy to misread `TestListAgentTemplates_Empty` as "we test the trivial path because we test the happy path" — the kind of mechanical-coverage test that adds maintenance weight without catching anything. It isn't. The `make([]..., 0, len(rows))` line in `agents.Service.ListAgentTemplates` is one keystroke away from `var out []*corelliav1.AgentTemplate` (cleaner-looking, syntactically identical for the `append` loop). The difference is invisible in a code review (both compile, both pass the happy-path test, both look idiomatic) but breaks at the JSON wire boundary: nil slice → `null`; non-nil empty slice → `[]`. The FE's `res.templates.length` reads the latter and crashes on the former.

The test exists as a *future-refactor tripwire*: anyone who "cleans up" the `make` call to a `var` declaration will see `TestListAgentTemplates_Empty` fail with `want non-nil empty slice (pinned wire-shape contract), got nil` — and the assertion message points directly at the contract being violated. This is what "design for the regression you'll forget about in three months" looks like in practice. Same idiom CLAUDE.md's testing-conventions section endorses ("no DB mocks ... real Postgres") at a different scale: pin the *boundary* behavior, not the implementation detail.

### The agents package is now structurally complete for M2's read path

After Phase 6: schema (Phase 1) + queries (Phase 2) + proto (Phase 3) + service + handler + wiring (Phase 4) + FE consumer (Phase 5) + tests (Phase 6) = a vertical slice that an outside reviewer can walk top-to-bottom in fifteen minutes. Each layer's seam is the same shape it would be after M3 / M4 add real callers — the only deltas at M3 are "add `UpdateAdapterImageRef` to `adapters.Service`" and "fill `harness_adapters.adapter_image_ref` via migration"; at M4, "add `GetAgentTemplate(id)` to `agents.Service`" + "wire deploy modal." Both extensions add to the existing surface; neither rewrites.

This is what blueprint §15's "Is it reversible?" test looks like answered correctly: every M2 abstraction is bounded by a real caller (or a named *future* caller in a written plan), every M2 file has a single rationale, every M2 boundary is the same shape M3/M4 will extend rather than refactor. The phase that *proved* this is Phase 6 — the static checks confirm the structural shape isn't compromised by hidden coupling.

### The deferred-runtime-checks pattern is now the codebase norm

Three milestones in a row (M1 Phase 6, 0.2.6 Phase 6b, M2 Phase 6) have written runtime-validation runbooks rather than executing them in the agent loop. The pattern is: *static checks must complete before merge; runtime checks must complete before deploy.* A non-interactive agent shell can drive the first half deterministically; the second half needs a human-in-the-loop or a Playwright-in-CI fixture (out of v1 scope per stack.md §13). Writing the runbook into the completion doc makes the second half a deterministic checklist with a single owner (whoever triggers the deploy) rather than a "did anyone test this?" pre-merge question. The runbook is the audit trail; the deploy is the assertion that it ran.

---

## Known pending work

- **Operator runtime walkthrough.** Three checks (§3 curl, §4 FE end-to-end, §5 DB sanity SELECT). Should run before the first non-localhost deploy. Low-risk if any single check fails — the static check matrix already proved the wire path compiles, types align, and the schema applies; a runtime miss almost certainly maps to environment-shape problems (DB credentials, JWKS URL drift, missing seed) rather than M2 code bugs.
- **Changelog entry for `0.3.0`.** Plan §Phase 6 task 7 flagged this as out-of-strict-scope. Recommended next-action ahead of merge: a top-level entry under `docs/changelog.md` with the established **What / Where / Why** structure, summarising M2 across all six phases. Version bump from `0.2.x` → `0.3.0` because M2 is the codebase's first product feature (catalog schema + first product RPC + first product UI page); minor patch numbers (`0.2.x`) have so far meant pre-product scaffolding and infra. The shape: an Index of changes, six phase summaries (linkable to the per-phase completion docs in `docs/completions/`), Behavior change, Supersedes, Known pending work — same format 0.2.5 / 0.2.6 / 0.2.7 used.
- **Plan migration: `executing/agent-catalog.md` → `executed/` (or `archive/`).** All six phases complete; the plan is no longer a forward-looking artifact. The exact destination directory depends on the project's convention — 0.2.5 / 0.2.6 / 0.2.7 used `archive/` for completed plans, but `executed/` would be a clearer separation. Either way, move once the changelog entry lands.
- **`agents/service_test.go` does not cover the DB-error propagation arm.** Documented above as deliberate; flagging here for the audit trail. M4 will land the first test that exercises `agentsErrToConnect`'s `default` arm — when `GetAgentTemplate(id)` adds a real `pgx.ErrNoRows → agents.ErrNotFound → connect.CodeNotFound` path, the test for "unmapped DB error → `Internal` (redacted)" lands alongside it.
- **No integration test against a real DB for the catalog query.** Per CLAUDE.md's "no DB mocks" stance, this is the *correct* test for end-to-end query-shape validation, but lands more naturally at M4 when the first stateful flow (spawn → status update → cleanup) needs the same harness. Adding it for a single read-only query in M2 would be testcontainers-go scaffolding for one assertion; the cost-benefit tilts the other way once M4's stateful operations bring four assertions onto the same fixture.
- **No request-context propagation test.** Same rationale Phase 4's completion doc named: M2's `ListAgentTemplates` doesn't consume `auth.AuthClaims` (catalog is global per decision 10), so there's no claims-flow assertion to make. When M4 introduces per-org filtering or per-user template ownership, the test pattern from `users/service_test.go` (`auth.ContextWithClaims(...)` setup, assert the service sees the claims) ports over directly.

---

## What's next — M2 wrap-up + M3 hand-off

**M2 closing actions (operator):**
1. Run §3 / §4 / §5 of the runbook above.
2. Draft and merge the `0.3.0` changelog entry.
3. Move `docs/executing/agent-catalog.md` to its terminal location.
4. Open the M2 PR; reference all six phase completion docs.

**M3 entry conditions (now satisfied):**
- ✅ `harness_adapters` table exists with one seed row (`harness_name = 'hermes'`).
- ✅ `harness_adapters.adapter_image_ref` is `TEXT NULL` — M3's first migration tightens to `NOT NULL` after backfilling with the built adapter image ref.
- ✅ `internal/adapters` package exists with `Get(ctx, id) (db.HarnessAdapter, error)` — M3 extends with `UpdateImageRef(ctx, id, ref) error`.
- ✅ Wire path: M3's first new RPC slots into the same `r.Group(auth.Middleware(...))` block alongside `agents`. The `Deps` struct's "config → auth infra → app handlers (alphabetical-ish-by-domain) → CORS" ordering accommodates `AdaptersHandler` between `AgentsHandler` and `AllowedOrigin` — though if M3 doesn't expose adapter operations to the FE (which it likely doesn't — adapter management is admin-internal), no new handler is needed and M3 is purely backend-internal + Fly-deploy work.

The structural turning point M2 promised has landed. The codebase has its first product schema, its first product RPC, and its first product UI page. M3 (Hermes adapter image + Fly wiring) and M4 (spawn flow) extend rather than scaffold.
