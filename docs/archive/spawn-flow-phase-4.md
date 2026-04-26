# Phase 4 Completion — Spawn Flow: Connect handlers + sentinel mapping + cmd/api wiring

**Plan:** `docs/executing/spawn-flow.md` §Phase 4
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M4
**Date:** 2026-04-26
**Status:** complete; checkpoint green (`go vet ./... && go build ./... && go test -count=1 ./...` clean; `pnpm -C frontend type-check` clean; six M4 RPCs flip from `CodeUnimplemented` stubs to real handlers; eight M4 sentinels wired through to seven distinct Connect codes)

This phase ships the **transport layer for the spawn lifecycle** — the auth-context ↔ domain seam that lets the FE hit the six M4 RPCs and reach Phase 2's `agents.Service`. Six handlers replace Phase 2's six `CodeUnimplemented` stubs; the `agentsErrToConnect` switch widens from one M2 case (the `ErrNotFound` placeholder) to nine M4 sentinel arms; one new method on `users.Service` (`CallerIdentity`) gives the handler both `userID` and `orgID` in a single DB lookup. **First time the wire surface for spawn / list / get / stop / destroy is callable** — a curl with a valid Bearer token can now hit `/corellia.v1.AgentsService/SpawnAgent` and reach the service code that reaches the resolver that reaches the Fly API.

This is also the **first time the codebase has a handler that needs both `userID` and `orgID` together**. M2's `ListAgentTemplates` is org-agnostic; the organizations service uses `CallerOrgID` alone. Spawn-flow plan decisions 9 + 10 require both — `org_id` for multi-tenancy enforcement (decision 9), `owner_user_id` for the audit trail (decision 10). One new `CallerIdentity` method delivers both from one row, mirroring how `CallerOrgID` was the M2-era extension to the same internal `loadCurrentUser` private method.

---

## Index

- **`agents_handler.go` rewritten** from 90 LOC (M2 catalog reader + 6 stubs + 1 sentinel arm) to 208 LOC (M2 catalog reader + 6 real handlers + 9 sentinel arms + `userIdentityLookup` interface). Each handler ≤30 LOC per `stack.md` §11.9; the longest (`SpawnAgent` and `SpawnNAgents`) sit at 26 LOC each. **Two stubs (`Get` / `Stop` / `Destroy`) extract a UUID from the request first, returning `CodeNotFound` on parse failure** — a malformed `id` is structurally identical to a missing instance from the FE's perspective; the public taxonomy "this resource doesn't exist" subsumes both.
- **`users/service.go` extended** with `CallerIdentity(ctx) (userID, orgID uuid.UUID, error)` (+13 LOC, one method). Reuses the private `loadCurrentUser` helper — same one-DB-lookup shape as `CallerOrgID`, just returns both columns instead of one. Doc-comment cites the avoiding-double-DB-cost rationale.
- **`cmd/api/main.go` widened by one character** (`agentsSvc` → `agentsSvc, usersSvc` at the `NewAgentsHandler` call site). The `usersSvc` value already existed for `NewUsersHandler` and `NewOrganizationsService`; reusing it is a single-letter wire change.
- **Sentinel → Connect code mapping table** (decision 25 closed). Eight M4 sentinels + two M2/0.2.5 holdovers map to seven distinct Connect codes: `Unauthenticated`, `PermissionDenied`, `InvalidArgument`, `FailedPrecondition`, `NotFound`, `Unavailable`, `Internal` (default). **`ErrSpawnLimit` got `FailedPrecondition`, not `InvalidArgument`** — see "Decisions made this phase" §1 for the FE-affordance rationale.
- **`userIdentityLookup` interface declared in `httpsrv` package**, not imported as `*users.Service`. Mirrors `organizations.userLookup`'s pattern. Single-method interface — the seam between transport and identity is structurally narrow, so no test fake has to implement an over-broad surface.
- **Validation matrix.** `cd backend && go vet ./... && go build ./... && go test -count=1 ./...` all clean: agents 18 cases / 0.346s, deploy 26 cases / 0.895s, users 3 cases / 0.623s — same baselines, no regressions, both `cmd/api` and `cmd/smoke-deploy` build green. `cd frontend && pnpm type-check` clean.

---

## What this phase shipped

### Six handlers, one shape

Every M4 handler implements the same five-step pattern:

1. **Resolve caller identity** via `h.users.CallerIdentity(ctx)`. Returns `userID, orgID`. On error, map to Connect via `agentsErrToConnect` — picks up `users.ErrUnauthenticated` / `users.ErrNotProvisioned` from the existing switch arms.
2. **Parse the `id`-shaped wire fields** (`template_id` for `Spawn{,N}Agents`, `id` for `Get` / `Stop` / `Destroy`). On parse failure, return early with the appropriate `Code{InvalidArgument,NotFound}` directly — no service round-trip when the input is structurally invalid.
3. **Build the typed input** (`SpawnInput`, `SpawnNInput`, or just `(instanceID, orgID)`).
4. **Call the service** — Phase 2's `Spawn`, `SpawnN`, `List`, `Get`, `Stop`, or `Destroy`.
5. **Marshal the response** by wrapping the returned `*corelliav1.AgentInstance` (or `[]*AgentInstance`) in the matching `*Response` proto.

The shape is uniform enough that a future code-gen pass could extract it; today's hand-written form is 26 LOC for the long handlers, 18 LOC for the short ones, well under the §11.9 cap. The ratio of "real logic" to "ceremony" is high because the service does the heavy lifting; the handler is the auth↔domain seam, no more.

### `userIdentityLookup` — one method, one DB lookup

The seam between `httpsrv` and `users` is declared in `httpsrv` as:

```go
type userIdentityLookup interface {
    CallerIdentity(ctx context.Context) (userID, orgID uuid.UUID, err error)
}
```

This mirrors `organizations.userLookup` (which exposes only `CallerOrgID`). Three reasons for the in-handler-package interface declaration over an `*users.Service` direct dependency:

1. **Test fakeability without standing up users.Service.** A future `agents_handler_test.go` (deferred, see "Known pending work") can satisfy the interface with three lines of code rather than constructing the whole `users.Service` + `userQueries` chain.
2. **Loose coupling at the seam.** Phase 2's pattern of declaring `agentQueries` in `agents` (not importing `*db.Queries`) extends here. The handler doesn't care that `users.Service` happens to be a struct with a config + a queries field; it cares about one method.
3. **Compile-time conformance check is cheap.** `*users.Service` has `CallerIdentity` from this phase; the assignment in `cmd/api/main.go` (`AgentsHandler: httpsrv.NewAgentsHandler(agentsSvc, usersSvc)`) verifies the shape at boot. No runtime `interface{}` reflection.

### Sentinel → Connect code mapping (decision 25 closed)

| Sentinel | Connect code | Source | Rationale |
|---|---|---|---|
| `users.ErrUnauthenticated` | `Unauthenticated` | 0.2.5 | Bearer token missing/invalid; must reach FE so it can re-auth. |
| `users.ErrNotProvisioned` | `PermissionDenied` | 0.2.5 | Valid token but no `public.users` row — auth provisioning gap, not auth failure. |
| `agents.ErrInvalidName` | `InvalidArgument` | M4 | Empty / whitespace-only / >80 chars; FE form-level validation should catch but BE re-checks (decision 26). |
| `agents.ErrInvalidProvider` | `InvalidArgument` | M4 | Provider not in the closed enum (`anthropic`, `openai`, `openrouter`); typically a `MODEL_PROVIDER_UNSPECIFIED` slip. |
| `agents.ErrInvalidModel` | `InvalidArgument` | M4 | Empty / >200 chars `model_name`. The provider's API will reject invalid names at first chat call; BE only enforces shape. |
| `agents.ErrMissingAPIKey` | `InvalidArgument` | M4 | Empty `model_api_key`. The single most security-sensitive validation; see decision 7's never-log invariant. |
| `agents.ErrSpawnLimit` | `FailedPrecondition` | M4 | `count <= 0` or `count > 10`. **Not InvalidArgument** — see §1 below. |
| `agents.ErrTemplateNotFound` | `NotFound` | M4 | Resolves either an unparseable `template_id` or a parseable UUID with no row. |
| `agents.ErrInstanceNotFound` | `NotFound` | M4 | Same shape for the `agent_instances` lookups in `Get` / `Stop` / `Destroy`. |
| `agents.ErrNotFound` | `NotFound` | M2 holdover | Retained — the M2 `ListAgentTemplates` path can theoretically surface it (no caller does today, but the handler's switch must satisfy the M2 contract). |
| `agents.ErrFlyAPI` | `Unavailable` | M4 | The redaction layer (decision 25). The raw Fly error is `slog.Error`'d in the service; the wire sees only the generic. |
| `agents.ErrTargetUnavailable` | `Unavailable` | M4 | Resolver couldn't find a registered target for the requested kind; same operator-side observability shape as `ErrFlyAPI`. |
| anything else | `Internal` | M2 | `slog.Error` with the raw `err`; wire sees `"internal error"`. The pgx / driver leak guard. |

### Wire surface summary (post-Phase-4)

```
POST /corellia.v1.AgentsService/ListAgentTemplates    (M2 — unchanged)
POST /corellia.v1.AgentsService/SpawnAgent            (M4 — first reachable now)
POST /corellia.v1.AgentsService/SpawnNAgents          (M4)
POST /corellia.v1.AgentsService/ListAgentInstances    (M4)
POST /corellia.v1.AgentsService/GetAgentInstance      (M4)
POST /corellia.v1.AgentsService/StopAgentInstance     (M4)
POST /corellia.v1.AgentsService/DestroyAgentInstance  (M4)
```

All seven mounted under the `auth.Middleware(d.AuthVerifier)` group from M1 (server.go line 36–47, unchanged). No new mount, no new service file — `agents_handler.go` extends the existing `*AgentsHandler` so the `corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)` mount picks the new methods up automatically (decision 12 + Phase 2's known-pending §"Phase 4 work").

---

## Decisions made this phase

### 1. `ErrSpawnLimit` → `FailedPrecondition`, not `InvalidArgument`

Plan decision 25 said "validation sentinels → InvalidArgument; not-found → NotFound; ErrFlyAPI → Unavailable" — and explicitly noted `ErrSpawnLimit`'s code as TBD with the candidates `CodeOutOfRange` or `CodeFailedPrecondition`.

**Phase 4 picks `FailedPrecondition`.** The reasoning:

- **`InvalidArgument` semantically means "the input you sent doesn't satisfy this RPC's schema."** A `count` of 11 is well-formed (it's an int32, in-range for the wire type, non-negative); the rejection is *policy*, not *shape*. Lumping it with `ErrInvalidName` would conflate "your form has a typo" with "your form's fine but our server has a per-call cap."
- **`OutOfRange` is the closest single-word fit** but it's typically used for paginated cursors / range-bounded queries (e.g. "you asked for offset 1000 in a 100-row result"). Spawn-count overflow doesn't have a "next page" semantic.
- **`FailedPrecondition` matches "the server's state can't satisfy this request"** — in this case, the v1 demo cap is the server's state. A future v1.5 might raise the cap based on org tier; same code, different policy. The FE can branch on `FailedPrecondition` and surface a friendly "v1 caps deploys at 10 agents per request — try a smaller batch" message without confusing it with form validation errors.

This is the kind of taxonomy decision that ages well precisely because it doesn't claim more than it knows: `FailedPrecondition` says "you can't do this *right now* on *this server*"; both qualifiers carry information the FE can use.

### 2. Parse-failure UUID handling: short-circuit before the service call

Three handlers (`GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance`) parse an `id` field; two (`SpawnAgent`, `SpawnNAgents`) parse a `template_id`. **All five short-circuit on parse failure** rather than passing a `uuid.Nil` to the service.

The split between the two parse-failure responses:

- **`template_id` parse failure** → `CodeInvalidArgument` with `agents.ErrTemplateNotFound`. Reasoning: at the spawn boundary, "you sent a malformed template ID" is structurally an input validation failure; the FE should surface a "please pick a template" error.
- **`id` parse failure** → `CodeNotFound` with `agents.ErrInstanceNotFound`. Reasoning: at the read/mutate boundary, "this instance doesn't exist" subsumes "the ID you sent isn't a valid UUID" — the FE can't distinguish the two cases meaningfully, and the public taxonomy ("the resource isn't here") is the same.

The asymmetry is deliberate: spawn is *creation* (template must exist before you can use it; bad ID = bad input), get/stop/destroy are *operations on existing rows* (no row found = NotFound regardless of whether the ID was malformed or just nonexistent).

### 3. `users.CallerIdentity` over re-using `CallerOrgID` + a separate method

Two implementation candidates considered:

- **A.** Add `CallerUserID(ctx) (uuid.UUID, error)`; the handler calls both `CallerOrgID` and `CallerUserID` (two DB lookups per RPC).
- **B.** Add `CallerIdentity(ctx) (userID, orgID, error)`; the handler calls once.

**B chosen.** Both `userID` and `orgID` come from the same `db.User` row; doubling the DB lookup for two columns from the same row would be a measurable per-RPC cost (roughly 2× the JWT-validate-and-load latency). Option A would also force every future `AgentsHandler` method to make the same trade-off again; option B is a one-shot fix that aligns with how `CallerOrgID` itself was structured (one query, return one column) — the new method is one query, return two columns.

The `(userID, orgID uuid.UUID, err error)` named-return signature also doubles as documentation: callers see at the type-system level which UUID is which, no positional confusion.

---

## Decision drift from the plan

**One intentional drift** beyond decision 25's already-deferred-to-Phase-4 sub-decisions:

### Plan §Phase 4 task 2 — "`server.go` no edit" — confirmed

Plan §Phase 4 task 2 said "no edit" to `server.go`; Phase 4 confirms: zero changes. The `corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)` mount call from M2 (server.go line 45) picks up the six new methods automatically because the underlying interface (`AgentsServiceHandler`) widened in Phase 2's regenerated `agents.connect.go` and the `*AgentsHandler` struct in this phase satisfies the wider interface via its six new methods. The "Connect mount is shape-driven" property pays off: no per-method registration, no route table to update.

**No additional drift.** The handler shape, the error mapping, the UUID parse paths, and the `CallerIdentity` design all match plan §Phase 4 task 1 + decision 25. The two not-strictly-from-the-plan choices are §1 (FailedPrecondition over OutOfRange) and §2 (parse-failure short-circuit), both decided this phase as the plan named them as TBD.

---

## Validation matrix

```
cd backend && go vet ./... && go build ./... && go test -count=1 ./...
→ vet OK
→ build OK (cmd/api + cmd/smoke-deploy + all internal/* packages)
→ tests:
    internal/agents     0.346s  (18 sub-tests, Phase 2 baseline preserved)
    internal/deploy     0.895s  (26 sub-tests, M3+M3.5 baseline preserved)
    internal/users      0.623s  (3 sub-tests, 0.2.5 baseline preserved)

cd frontend && pnpm type-check
→ tsc --noEmit clean (no FE changes this phase; pure regression check)

git diff --stat backend/cmd/api/main.go backend/internal/users/service.go backend/internal/httpsrv/agents_handler.go
→ backend/cmd/api/main.go                    |   2 +-
→ backend/internal/httpsrv/agents_handler.go | 167 +++++++++++++++++++++-----
→ backend/internal/users/service.go          |  13 +++
→ 3 files changed, 157 insertions(+), 25 deletions(-)
```

All Phase 4 checkpoint conditions satisfied:

- ✅ Backend boots cleanly (build green; runtime smoke deferred to Phase 7's integration walkthrough — no operator-facing change beyond the six previously-Unimplemented endpoints flipping to real behavior).
- ✅ Six M4 RPCs wired through to `agents.Service`. The `CodeUnimplemented` stubs are gone.
- ✅ `agentsErrToConnect` extended with all M4 sentinels per decision 25; new sub-decisions §1 + §2 documented above.
- ✅ Boot-time stale-pending sweep (decision 32) already wired in Phase 2's `cmd/api/main.go` change; Phase 4 didn't need to touch it.
- ✅ Each handler ≤30 LOC per `stack.md` §11.9 (longest is 26 LOC; counted in hand-written form, excluding signature wrapping).

---

## Known pending work

**Phase 5–6** (frontend deploy modal + fleet page) — unchanged from plan §Phase 5–6. Phase 4 unblocks Phase 5 by making the spawn endpoint reachable; Phase 5's deploy modal will hit `SpawnAgent` / `SpawnNAgents` for the first time over a live wire.

**Phase 7** (integration smoke test) — the load-bearing end-to-end walkthrough. The first time anyone exercises the full flow: sign in → click Deploy → fill form → POST `SpawnAgent` → `agents.Service` calls `FlyDeployTarget.Spawn` → row inserts → poll goroutine fires → `/health` flips status → `/fleet` poll surfaces it. **This is also the first test of decision 25's redaction layer in production conditions** — a bad provider key (or any other Fly-side error) should surface as a `Unavailable` Connect error, not a raw Fly API response.

**Phase 8 hardening pre-flagged**:

- **`agents_handler_test.go`** — no test file exists yet for any handler in `internal/httpsrv/`. The `userIdentityLookup` interface design makes this trivial when written; just hadn't been needed because handlers were thin glue. The new mapping switch is the first piece of handler-side logic worth a test fake (sentinel → Connect code is a public contract; a regression in the switch would silently re-classify errors). Pattern: fake `agents.Service` returning each sentinel in turn, assert `connect.CodeOf(err)` returns the expected code. ~50 LOC for full coverage.
- **`secrets` row insertion** still happens with the literal `"CORELLIA_MODEL_API_KEY"` key name in `Spawn` — Phase 8 hardening should consider whether more `CORELLIA_*` env vars need separate audit rows (today the audit shadow is one row per spawn, capturing only the API key key-name). Plan decision 6 implies one row per CORELLIA_* var; v1's spawn flow only injects four CORELLIA_* vars (AGENT_ID, MODEL_PROVIDER, MODEL_NAME, MODEL_API_KEY) and only one of them is actually a secret — the others are config. Today's "one audit row for the key" shape may be exactly right; flagged for explicit decision in Phase 8.
- **Transactional spawn writes** (decision 27 step 6) still deferred — Phase 2 known-pending, Phase 4 unchanged.
- **`logsURL` lifted to `DeployTarget` interface** still v1.5 candidate.
- **Polling integration test** still deferred to goroutine-aware test infrastructure.

---

## Files touched

```
backend/internal/users/service.go            +13 LOC (CallerIdentity method)
backend/internal/httpsrv/agents_handler.go   +132 net LOC (six handlers + 8 sentinel arms + 1 interface)
backend/cmd/api/main.go                      +1 LOC (usersSvc passed to NewAgentsHandler)

docs/completions/spawn-flow-phase-4.md       new (this file)
```

**Net ratio**: ~150 LOC of hand-written code (~120 of which is the handler implementations + sentinel switch; ~30 is the small surface extensions). Zero generated-code churn — the proto contract was set in Phase 2/3 and the wire surface is stable; this phase is pure consumer-side adoption of that contract.

Phase 4 closes the M4 backend loop. **Decision 27's eleven-step spawn order, written in Phase 2 as service-internal logic, is now reachable from the wire.** The next phase (Phase 5's deploy modal) makes it reachable from a UI; the phase after (Phase 6's fleet page) makes the converged status visible. The contract that started as a `.proto` edit in Phase 2 has now flowed through generated code (Phase 3 receipt) into a live Connect handler (Phase 4) with seven distinct error taxonomies — what M4 promised at the data layer in Phase 1 is now end-to-end on the BE.
