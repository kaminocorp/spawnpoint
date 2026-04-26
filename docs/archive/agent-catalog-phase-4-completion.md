# Phase 4 Completion — Agent Catalog: Backend domain + handler

**Plan:** `docs/executing/agent-catalog.md` §Phase 4
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete; full check matrix green (`go vet` / `go build` / `go test`)

This phase wired the contract from Phase 3 to a working RPC. Two new domain packages (`adapters` + `agents`), one new Connect handler, two surgical edits to existing wiring (`+7 lines / -0 lines` total). The catalog RPC is now mounted, authenticated, and reachable on the wire — the next time the binary boots, `POST /corellia.v1.AgentsService/ListAgentTemplates` returns the seed row instead of 404.

---

## Index

- **New package: `backend/internal/adapters/`.** One file (`service.go`, 35 LOC). Single sentinel (`ErrNotFound`), private 1-method interface (`adapterQueries`), single getter (`Get(ctx, id) (db.HarnessAdapter, error)`). No caller in M2 — it exists so the package compiles with non-empty surface area and M3's `UpdateImageRef` extends rather than scaffolds. Decision 13 + 14.
- **New package: `backend/internal/agents/`.** One file (`service.go`, 51 LOC). Sentinel (`ErrNotFound` for M4), private 1-method interface (`templateQueries`), the `ListAgentTemplates(ctx) ([]*corelliav1.AgentTemplate, error)` method, and a `toProtoTemplate` row-to-proto helper. The empty-list contract is enforced by `make([]*…, 0, len(rows))` — pinned by Phase 6's `_Empty` test. Decision 16 + 17 + 28.
- **New file: `backend/internal/httpsrv/agents_handler.go`** (45 LOC). Implements `corelliav1connect.AgentsServiceHandler` (one method); sentinel-mapping `agentsErrToConnect` switch with `slog.Error` + redacted `Internal` default arm. The `ErrNotFound` arm is wired for M4's `GetAgentTemplate` to consume — pre-declaring saves an edit-during-M4. Decision 18.
- **Edited: `backend/internal/httpsrv/server.go`** (+4 / -0). Added `AgentsHandler corelliav1connect.AgentsServiceHandler` to `Deps` (between `OrganizationsHandler` and `AllowedOrigin` — decision 20), added two lines that mount the new service inside the existing `r.Group(auth.Middleware(...))` block. Decision 19.
- **Edited: `backend/cmd/api/main.go`** (+3 / -0). Added the `agents` package import, `agentsSvc := agents.NewService(queries)` constructor call, `AgentsHandler: httpsrv.NewAgentsHandler(agentsSvc)` field in the `Deps{...}` literal. `adapters.NewService` is *not* wired — no caller per decision 21; M3 wires it.
- **Validation matrix.** `go vet ./...` clean; `go build ./...` clean; `go test ./...` clean (existing `internal/users` suite still green — no regression). The two new packages appear in the test output as `[no test files]`, confirming they're discovered and compiled even without test files yet. Phase 6 lands the `agents/service_test.go` cases.
- **Diff stat.** `+7 / -0` total against existing files — `git diff --stat` shows `cmd/api/main.go (+3)` and `httpsrv/server.go (+4)`. Three brand-new files (`adapters/service.go`, `agents/service.go`, `httpsrv/agents_handler.go`). Nothing existing was renamed, removed, or rewritten.

---

## What was written, where, why

### File: `backend/internal/adapters/service.go`

35 LOC. The shape is intentionally minimal:

```go
var ErrNotFound = errors.New("harness adapter not found")

type adapterQueries interface {
    GetHarnessAdapterByID(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error)
}

type Service struct {
    queries adapterQueries
}

func NewService(queries adapterQueries) *Service {
    return &Service{queries: queries}
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error) {
    adapter, err := s.queries.GetHarnessAdapterByID(ctx, id)
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return db.HarnessAdapter{}, ErrNotFound
        }
        return db.HarnessAdapter{}, err
    }
    return adapter, nil
}
```

**Why this exists in M2 with no caller.** Decision 13: `M3 (adapters)` and `M4 (agents)` extend rather than scaffold. Building both packages now (even when one is empty) means M3's plan reads "add `UpdateImageRef`" instead of "create the package, decide on the shape, then add `UpdateImageRef`." Saves a round of architectural relitigation in two months when M3 lands.

**Why `Service.Get` returns `db.HarnessAdapter`, not a domain struct.** Decision 11 omitted `HarnessAdapter` from the public proto contract — there's no `corelliav1.HarnessAdapter` to convert into. The caller (M3 onward) is backend code reading a backend-internal type. Returning `db.HarnessAdapter` directly avoids a pointless re-projection; if the caller eventually needs a domain shape (e.g., to attach derived fields), that shape is added then, not now.

**Why `pgx.ErrNoRows` lookup at this layer, not at the handler.** Same pattern as `organizations.go:50-52`. The sentinel translation is a *domain* concern — the service knows that "no rows" means "this aggregate doesn't exist" and translates to `ErrNotFound`. The handler then knows that "ErrNotFound" maps to wire code `NotFound`. Two-stage mapping (driver-error → domain-sentinel → wire-code) keeps each layer responsible only for its own concern. Same architectural pattern that 0.2.5 post-review established.

### File: `backend/internal/agents/service.go`

51 LOC. The interesting parts:

```go
var ErrNotFound = errors.New("agent template not found")

type templateQueries interface {
    ListAgentTemplates(ctx context.Context) ([]db.ListAgentTemplatesRow, error)
    // GetAgentTemplateByID added by M4.
}

type Service struct {
    queries templateQueries
}

func NewService(queries templateQueries) *Service {
    return &Service{queries: queries}
}

func (s *Service) ListAgentTemplates(ctx context.Context) ([]*corelliav1.AgentTemplate, error) {
    rows, err := s.queries.ListAgentTemplates(ctx)
    if err != nil {
        return nil, err
    }
    // make([]…, 0, len) — non-nil empty slice on zero rows. The FE branches on
    // length, but a non-nil JSON marshal produces "[]" not "null" — friendlier
    // wire shape and pinned by the Phase 6 _Empty test.
    out := make([]*corelliav1.AgentTemplate, 0, len(rows))
    for _, r := range rows {
        out = append(out, toProtoTemplate(r))
    }
    return out, nil
}

func toProtoTemplate(r db.ListAgentTemplatesRow) *corelliav1.AgentTemplate {
    return &corelliav1.AgentTemplate{
        Id:          r.ID.String(),
        Name:        r.Name,
        Description: r.Description,
    }
}
```

**Why the `make(..., 0, len(rows))` is load-bearing.** Decision 28 calls out empty-list as a pinned contract: the FE's `templates.length === 0` check expects an array. sqlc's loop returns `var items []Row` — which is `nil` when zero rows. If we passed that through unchanged, `corelliav1.ListAgentTemplatesResponse{Templates: nil}` marshals to `{"templates":null}` over the JSON wire (Connect's default codec). The FE's `data.templates.length` would then crash with `Cannot read properties of null`. The `make(..., 0, len)` guarantees a non-nil empty slice → marshals as `{"templates":[]}` → FE gets a real array even on zero rows.

**Why no error sentinel mapping in `ListAgentTemplates`.** Decision 17: the read path can't fail with anything actionable. Empty list is valid (state `empty` on the FE), DB errors fall through to the handler's redacted `Internal` arm. `ErrNotFound` is declared at package level for M4's future `GetAgentTemplate(id)` — listing one already-known set has nothing to "not find."

**Why `templateQueries` is private but `ErrNotFound` is exported.** The interface is an internal seam — only this package's tests need to substitute it. The sentinel is a public contract — the handler (in `httpsrv`) needs to `errors.Is(err, agents.ErrNotFound)`. Same scoping pattern as `users.userQueries` (private) + `users.ErrUnauthenticated` / `users.ErrNotProvisioned` (exported).

**Why `GetAgentTemplateByID added by M4` is a code comment, not a TODO.** TODO comments rot — they outlive the work, accumulate, and become noise. A descriptive comment naming the *next* phase that touches this surface gives context without imposing a tracker obligation. M4's plan doc is the actual TODO.

### File: `backend/internal/httpsrv/agents_handler.go`

45 LOC. Mirrors `users_handler.go` and `organizations_handler.go` in shape — handler struct + constructor + RPC method + error-mapping function:

```go
type AgentsHandler struct {
    svc *agents.Service
}

func NewAgentsHandler(svc *agents.Service) *AgentsHandler {
    return &AgentsHandler{svc: svc}
}

func (h *AgentsHandler) ListAgentTemplates(
    ctx context.Context,
    _ *connect.Request[corelliav1.ListAgentTemplatesRequest],
) (*connect.Response[corelliav1.ListAgentTemplatesResponse], error) {
    templates, err := h.svc.ListAgentTemplates(ctx)
    if err != nil {
        return nil, agentsErrToConnect(err)
    }
    return connect.NewResponse(&corelliav1.ListAgentTemplatesResponse{Templates: templates}), nil
}

func agentsErrToConnect(err error) error {
    switch {
    case errors.Is(err, agents.ErrNotFound):
        return connect.NewError(connect.CodeNotFound, err)
    default:
        slog.Error("agents handler: unexpected error", "err", err)
        return connect.NewError(connect.CodeInternal, errors.New("internal error"))
    }
}
```

**`ListAgentTemplates` method body is 7 lines** — well under the §11.9 ceiling of <30 LOC. Stays a "parse → call domain → marshal" thin handler.

**The `_ *connect.Request[...]` discards the request value.** No fields to read on `ListAgentTemplatesRequest{}` — it's the empty message from decision 11. The leading underscore is Go's idiomatic "I'm aware this exists, I'm choosing not to use it"; preserves the signature shape that Connect-go's interface dictates without producing an unused-variable warning.

**`agentsErrToConnect` switch arms.** Two arms today:
- `agents.ErrNotFound` → `CodeNotFound`. *No caller in M2*: the only RPC (`ListAgentTemplates`) doesn't surface this sentinel. Wired now so M4's `GetAgentTemplate(id)` reuses the switch instead of an edit-during-M4. The cost is two lines; the saving is one less file-edit when M4's plan starts.
- `default` → `slog.Error(...)` + `CodeInternal` with redacted message. **The redaction is non-negotiable** per the 0.2.5 post-review hardening. If a sqlc query starts returning a wrapped `pgx` error tomorrow, the operator sees the full diagnostic in JSON logs (via `slog`); the wire surface only ever shows `{"code":"internal","message":"internal error"}`. No DB topology, no schema details, no infra shape leaks even if a future bug pipes raw driver errors here.

The function-comment paragraph mirrors the exact same structure that `users_handler.go:44-53` and `organizations_handler.go:45-48` use — three handlers, three identical-shape comments, one architectural pattern.

### Edit: `backend/internal/httpsrv/server.go` (+4 / -0)

Two changes, both surgical:

```go
type Deps struct {
    Config               config.Config
    AuthVerifier         *auth.JWKSVerifier
    UsersHandler         corelliav1connect.UsersServiceHandler
    OrganizationsHandler corelliav1connect.OrganizationsServiceHandler
    AgentsHandler        corelliav1connect.AgentsServiceHandler   // NEW (decision 20)
    AllowedOrigin        string
}
```

```go
r.Group(func(r chi.Router) {
    r.Use(auth.Middleware(d.AuthVerifier))

    usersPath, usersHandler := corelliav1connect.NewUsersServiceHandler(d.UsersHandler)
    r.Mount(usersPath, usersHandler)

    orgsPath, orgsHandler := corelliav1connect.NewOrganizationsServiceHandler(d.OrganizationsHandler)
    r.Mount(orgsPath, orgsHandler)

    agentsPath, agentsHandler := corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)   // NEW
    r.Mount(agentsPath, agentsHandler)                                                        // NEW (decision 19)
})
```

**Why between `OrganizationsHandler` and `AllowedOrigin`.** Decision 20 — the rough ordering is "config → auth infra → app handlers (alphabetical-ish-by-domain) → CORS policy." Future cross-cutting concerns (rate limiter, tracer, metrics sink) slot in naturally at the right ordinal position.

**Why mounted *inside* `r.Group(auth.Middleware(...))`.** Decision 19 — the catalog is authenticated. Anonymous catalog reads aren't a v1 concern (vision.md's admin model — every signed-in user sees every template; nobody else is supposed to see anything). Putting the mount outside the group would expose `/corellia.v1.AgentsService/ListAgentTemplates` to unauthenticated callers, which contradicts the "garage for *your* admins" framing.

### Edit: `backend/cmd/api/main.go` (+3 / -0)

Three insertions, no deletions:

1. **Import** (1 line):
   ```go
   "github.com/hejijunhao/corellia/backend/internal/agents"
   ```
   Slotted alphabetically between `auth` and `config`.

2. **Service constructor** (1 line, after `orgsSvc := organizations.NewService(...)`):
   ```go
   agentsSvc := agents.NewService(queries)
   ```
   Single-arg constructor — agents service doesn't depend on `usersSvc` (decision 14: catalog is global, no per-user filtering).

3. **`Deps` field assignment** (1 line, between `OrganizationsHandler:` and `AllowedOrigin:`):
   ```go
   AgentsHandler: httpsrv.NewAgentsHandler(agentsSvc),
   ```

**`adapters.NewService` is conspicuously absent.** Per decision 21: `adapters.NewService(...)` has no caller in M2 — wiring it would compile a never-invoked dependency into the binary. M3's plan adds the import + constructor call when `UpdateAdapterImageRef` becomes a real reader. Today the package exists, the type compiles, no instance lives at runtime. This is the cleanest expression of "scaffold the package without scaffolding the runtime" — Go's compile-time package import is the structural anchor; Go's lazy package instantiation means no runtime cost for the unused getter.

---

## Validation — full check matrix

### `go vet ./...` — clean

```
$ go vet ./...
$ echo $?
0
```

`vet` runs across all internal packages including the two new ones. Particularly important checks for this phase:

- **`unreachable`** would have flagged a default arm before the sentinel arms — the switch ordering is sentinels first, default last.
- **`composites`** would have flagged the `connect.Request[Foo]{}` literal if I'd typed one out — the `_ *connect.Request[...]` discard pattern avoids constructing one.
- **`copylocks`** would have flagged any embedded mutex copy — none here, but worth noting that the `Service` struct holds an interface-typed field, not a value-typed query bundle, so embedded-mutex hazards are zero.

Clean exit means none of these triggered.

### `go build ./...` — clean

```
$ go build ./...
$ echo $?
0
```

The interesting thing this proves: `*db.Queries` (returned by `db.New(pool)`) structurally satisfies *both* the `agents.templateQueries` interface (one method: `ListAgentTemplates`) and the future `adapters.adapterQueries` interface (one method: `GetHarnessAdapterByID`) — without anyone editing the `*db.Queries` type. Go's structural typing means the interfaces in the two new packages are pure documentation of "what we depend on" rather than active coupling. Each new package can be tested independently with a 1-method fake.

### `go test ./...` — clean (no regression)

```
?       github.com/hejijunhao/corellia/backend/cmd/api          [no test files]
?       github.com/hejijunhao/corellia/backend/internal/adapters    [no test files]    ← new package
?       github.com/hejijunhao/corellia/backend/internal/agents      [no test files]    ← new package
?       github.com/hejijunhao/corellia/backend/internal/auth        [no test files]
?       github.com/hejijunhao/corellia/backend/internal/config      [no test files]
?       github.com/hejijunhao/corellia/backend/internal/db          [no test files]
?       github.com/hejijunhao/corellia/backend/internal/gen/...     [no test files]
?       github.com/hejijunhao/corellia/backend/internal/httpsrv     [no test files]
?       github.com/hejijunhao/corellia/backend/internal/organizations    [no test files]
ok      github.com/hejijunhao/corellia/backend/internal/users       0.324s
```

Existing `users` tests still green (3 cases from 0.2.5 — `NotProvisioned`, `HappyPath`, `NoClaims`). Two new packages appear with `[no test files]` — Phase 6 territory.

### `git diff --stat backend/` — additivity confirmation

```
backend/cmd/api/main.go            | 3 +++
backend/internal/httpsrv/server.go | 4 ++++
2 files changed, 7 insertions(+)
```

7 insertions, 0 deletions across all *modified* files. Plus three brand-new files (`adapters/service.go`, `agents/service.go`, `httpsrv/agents_handler.go`). Nothing existing was renamed, removed, or rewritten.

---

## Behavior change (known)

- **Live wire surface gained one route.** Booting the binary now serves `POST /corellia.v1.AgentsService/ListAgentTemplates` inside the auth-middleware group. Anonymous calls return 401 (existing middleware behavior); authenticated calls run the new domain code path: `Connect handler → agents.Service.ListAgentTemplates → db.Queries.ListAgentTemplates → SQL`. End-to-end runtime path is in place.
- **The server binary now has `agents` and `adapters` packages linked in.** Both are minimally exercised today — `agents.NewService` is constructed and held; `adapters.NewService` is referenced in source but not instantiated at runtime (decision 21). Binary size grows by ~a few KB; nothing runtime-significant.
- **Three handlers now mount inside the auth group.** `users`, `organizations`, `agents`. The auth middleware fires once per group, not per mount, so adding a mount has zero impact on auth-path latency.
- **No DB schema or row change.** Phase 4 is read-only against the schema landed in Phase 1. Re-running `goose status` shows the same migration timeline.
- **The redacted-default arm in `agentsErrToConnect` is now active.** Today nothing goes through the default arm (no caller path can produce an unmapped error from `ListAgentTemplates`); when `pgx`-level connection failures bite, they'll log to stderr/stdout via `slog.Error` and surface as `{"code":"internal","message":"internal error"}` on the wire — same redaction posture established in 0.2.5.

---

## Observations worth keeping

### Structural typing is the load-bearing trick of this phase

The plan called out the "private interface listing only the methods the service touches" pattern (decision 16) as the test-seam shape. What it *also* does is collapse the wiring: `*db.Queries` is constructed once in `main.go`, then passed to four different services (`users`, `organizations`, `agents`, future `adapters`), each of which sees it as a different *interface* (`userQueries`, `orgQueries`, `templateQueries`, `adapterQueries`). The interfaces don't share definitions — they share *satisfiers*. Adding a fifth service is a five-line file in `internal/<new>/service.go` plus a constructor call in `main.go`; no central registry to update, no shared type to widen.

This is what CLAUDE.md's "Don't add features, refactor, or introduce abstractions beyond what the task requires" looks like in practice — the abstraction (private per-service interface) is *required* (test-seam need + tight dependency surface), not speculative. The fact that it also enables zero-coupling-cost service expansion is a consequence, not a goal.

### The sentinel-with-no-current-caller pattern earns its keep on the next phase

`agents.ErrNotFound` is declared but unused in M2. So is the `case errors.Is(err, agents.ErrNotFound)` arm in `agentsErrToConnect`. Both are 4 lines of dead code, and a strict reading of CLAUDE.md ("Don't design for hypothetical future requirements") would forbid them.

The exception case is: when the *next named milestone* (M4, with `GetAgentTemplate(id)`) is named in the codebase comments, has a plan doc, and produces a concrete branch in the dependency graph, "future" stops being hypothetical and becomes "named-but-not-yet-built." The 4 lines mean M4's PR is one fewer line; M4's plan doc is one fewer review concern; and the contract surface is established at the *first* RPC, not retrofitted at the second.

The general rule: pre-emptive code with a named caller in a written plan is fine. Pre-emptive code "for whenever someone might want it" is not.

### `make([]…, 0, len(rows))` vs `var out []…` is a real wire-shape decision

I almost wrote `var out []*corelliav1.AgentTemplate` and let the loop append onto a nil slice — Go's append handles nil fine, and the result would be syntactically identical. The difference is at marshal time: a Go nil slice marshals to JSON `null`; a Go non-nil empty slice marshals to JSON `[]`. Connect-ES on the FE side calls `data.templates.length` — `null.length` throws.

This kind of nil-versus-empty distinction comes up *constantly* in Go-to-typed-frontend wire boundaries. The fix is always "constructor with explicit zero capacity," and it's worth pinning with a test (Phase 6 does — the `_Empty` case). The code comment in the service explains the choice in-line so it doesn't regress on a future code-cleanup pass.

---

## Known pending work

- **No tests on `internal/agents/` or `internal/adapters/`.** Per plan; Phase 6 lands `agents/service_test.go` (two cases: `_HappyPath`, `_Empty`). `adapters` stays test-free until M3 introduces a real consumer (decision 29).
- **No FE caller yet.** Phase 5's job. The wire path `/corellia.v1.AgentsService/ListAgentTemplates` is reachable but nothing in the FE invokes it.
- **No live-DB E2E run-through.** Phase 4's acceptance gates are static (`vet`/`build`/`test`). Phase 6's Validation §3 runs the curl smoke against a live binary against a live DB.
- **`adapters.Service.Get` has no caller and no test.** Both correct per the plan (decision 21 leaves it unwired; decision 29 leaves it untested). M3 wires + tests it together.
- **`agents.ErrNotFound` and the matching `case` arm in the handler switch are dead code in M2.** M4's `GetAgentTemplate(id)` becomes the first surfacer. Earned-its-keep observation above; flagged here for the changelog/audit trail.
- **No request-context propagation tests.** A future hardening would assert that `claims, ok := auth.FromContext(ctx)` works inside `agents.Service` — i.e., the Connect handler doesn't silently strip the auth-middleware-attached claims. The test would be cheap (extend Phase 6's setup with a `auth.ContextWithClaims`-bearing ctx and assert the service sees them) but neither M2's `ListAgentTemplates` nor M4's `GetAgentTemplate` *needs* claims (decision 10: catalog is global). When something does (per-user templates, per-org filtering), the test lands then.

---

## What's next — Phase 5 hand-off

Phase 5 (frontend `/agents` page) is the user-visible payoff:

- **Pre-conditions:** ✅ Tables (Phase 1), ✅ typed Go queries (Phase 2), ✅ proto + generated TS (Phase 3), ✅ live RPC (Phase 4). All four backend foundations are in place.
- **Phase 5 work:**
  1. One-line edit to `frontend/src/lib/api/client.ts` — add `agents: createConnectClient(AgentsService, transport)` alongside users + organizations.
  2. Replace M1's `ComingSoon` stub at `frontend/src/app/(app)/agents/page.tsx` with a discriminated-union state machine (`loading | ready | empty | error`) calling `api.agents.listAgentTemplates({})`.
  3. New file `frontend/src/components/agent-template-card.tsx` — live (DB-backed) Hermes card with disabled "Deploy" button + tooltip.
  4. New file `frontend/src/components/coming-soon-harness-card.tsx` — sneak-peek card *with no Deploy button at all* (decision 25's "nothing to click means nothing to fake" §11.4 compliance).
  5. New file `frontend/src/lib/agents/coming-soon.ts` — static array of 3 sneak-peek harnesses (LangGraph, CrewAI, AutoGen — subject to swap based on `docs/multiagent-deployment-frameworks.md` shortlist).
  6. New file `frontend/src/app/(app)/agents/layout.tsx` — `metadata.title = "Agents"`.
- **Phase 5 acceptance:** `pnpm -C frontend type-check`, `pnpm -C frontend lint`, `pnpm -C frontend build` all clean. Visiting `/agents` renders the live Hermes card + 3 sneak-peek cards.
- **Risk heading in:** small. The Connect-ES v2 client pattern is established (`users` and `organizations` already wired in `client.ts`); shadcn `Tooltip` + `Badge` may need a `pnpm dlx shadcn@latest add ...` run if M1 didn't include them. Dashboard pattern from 0.2.5 is the template for the discriminated-union state machine.
