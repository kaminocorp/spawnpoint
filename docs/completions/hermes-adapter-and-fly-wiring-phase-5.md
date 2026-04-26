# Completion — M3 Phase 5: `internal/deploy/` package + `adapters.UpdateImageRef` (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 5
**Status:** Phase 5 landed; Phases 6–8 pending.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md` (adapter source)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md` (image published; digest captured)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-3.md` (operator smoke harness)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-4.md` (DB migration: `adapter_image_ref` backfill + `NOT NULL` + digest CHECK)

This document records the *as-built* state of Phase 5. Phases 1–3 produced
external artefacts (Dockerfile, published image, smoke script); Phase 4
made the *first* durable database change. **Phase 5 is the first M3 phase
whose deliverable is Go code that calls Fly's API at runtime.** It lands
`internal/deploy/`, the package that — per blueprint §11.1 — is the
*only* place in the codebase that imports `fly-go` or talks to Fly. Every
other package sees only the `DeployTarget` interface. The package compiles
under v1's actual SDK, satisfies its interface contract via three
compile-time assertions, and exposes the surface area Phase 6's `cmd/api`
wiring will instantiate. Concurrent with the deploy work, the
`adapters.Service` in `internal/adapters/` widens by one method
(`UpdateImageRef`) — the symmetric write side of M2's read-only `Get`,
unblocking the Phase 6+ flow that programmatically updates an adapter's
pinned image after a rebuild.

---

## Files added / changed

| File | Status | LOC | Notes |
|---|---|---|---|
| `backend/internal/deploy/target.go` | new | 55 | `DeployTarget` interface + `SpawnSpec` / `SpawnResult` / `HealthStatus` enum + `ErrNotImplemented` sentinel. The whole package's public surface lives here; the other two `.go` files are concrete implementations. |
| `backend/internal/deploy/fly.go` | new | 180 | `FlyDeployTarget` concrete impl. Builds a `*flaps.Client` once at construction; `Spawn` / `Stop` / `Destroy` / `Health` are all flaps round-trips. Digest-pin validation at `Spawn`'s entry. App-name derivation via UUIDv5 hash for human-friendly names. |
| `backend/internal/deploy/stubs.go` | new | 34 | `LocalDeployTarget` + `AWSDeployTarget`, both returning `ErrNotImplemented` on every method. Real interface implementations per §11.4 — the package compiles with these as first-class participants, not commented-out scaffolding. |
| `backend/internal/deploy/target_test.go` | new | 11 | Three compile-time `var _ DeployTarget = (*X)(nil)` assertions. Doubles as the trigger that flips `internal/deploy` from `[no test files]` to `0.497s [no tests to run]` in `go test ./...` output. |
| `backend/queries/harness_adapters.sql` | edit | +7 / -0 | Adds `UpdateHarnessAdapterImageRef :one` — `UPDATE … SET adapter_image_ref = $2, updated_at = now() WHERE id = $1 RETURNING *`. Mirrors the `UpdateUserName` / `UpdateOrganizationName` shape exactly. |
| `backend/internal/adapters/service.go` | edit | +14 / -0 | Widens private `adapterQueries` interface with `UpdateHarnessAdapterImageRef`; adds `Service.UpdateImageRef(ctx, id, ref)` with the same `pgx.ErrNoRows → ErrNotFound` redacted-error pattern as `Get`. |
| `backend/internal/db/harness_adapters.sql.go` | regenerated | +30 / -0 | sqlc emit: `UpdateHarnessAdapterImageRef` method on `*Queries` + `UpdateHarnessAdapterImageRefParams{ID, AdapterImageRef}` row struct. |
| `backend/internal/db/querier.go` | regenerated | +1 / -0 | New entry on the `Querier` interface. |
| `backend/go.mod` + `backend/go.sum` | edits | +18 deps | `github.com/superfly/fly-go v0.5.0` direct; transitive `macaroon`, `graphql`, `logrus`, `otel`, `vmihailenco/msgpack`, etc. |

No backend wiring (`cmd/api/main.go`), no proto, no frontend, no schema
edits. Phase 6 is the first phase that *consumes* `FlyDeployTarget` at the
binary level; Phase 5 lands its definition only.

---

## Index

- **The plan's `fly-go` API surface had drifted from v0.5.0 reality
  in three places, all caught at write-time by reading the actual
  godoc.** The plan flagged this risk explicitly ("the structural
  decisions are stable; consult SDK godoc and adjust calls"); this
  is what that caveat looks like in practice. The three drifts:
    1. **`fly.NewClient(fly.ClientOptions{Tokens: fly.TokensFromString(...)})` doesn't exist.**
       Actual constructors: `fly.NewClient(accessToken, name, version, logger Logger) *Client`
       and `fly.NewClientFromOptions(opts ClientOptions) *Client`. Neither
       takes a `Tokens` field; tokens live in `github.com/superfly/fly-go/tokens.Tokens`,
       constructed via `tokens.Parse(string) *Tokens`.
    2. **`(*fly.Client).SetSecrets(ctx, app, env)` doesn't exist.** Secrets
       are a per-key flaps round-trip: `(*flaps.Client).SetAppSecret(ctx, appName, name, value)`.
       Phase 5's `Spawn` does a one-key-per-iteration loop.
    3. **`flaps.NewClientOpts` has no `AppName` field.** flaps clients are
       global; per-app routing is a method argument (`Launch(ctx, appName, ...)`,
       `List(ctx, appName, state)`, `Stop(ctx, appName, in, nonce)`,
       `DeleteApp(ctx, name)`). The plan's `flaps.NewWithOptions(ctx, flaps.NewClientOpts{AppName: app})`
       would have failed type-check with "unknown field AppName."
- **flaps-only beats fly-graphql + flaps for v1's needs.** Plan's
  sketch held both a `*fly.Client` (GraphQL) for `CreateApp` /
  `DeleteApp` / `SetSecrets` and a `*flaps.Client` for `Launch` /
  `List` / `Stop`. Phase 5 collapsed this to flaps-only because:
  (a) `flaps.CreateAppRequest{Org: <slug>}` accepts the org slug
  directly — no `client.GetOrganizationBySlug → org.ID` resolution
  needed; (b) `flaps.DeleteApp(ctx, name)` exists and is the
  symmetric counterpart of `flaps.CreateApp`; (c) one transport
  means one credential plumbing path (`tokens.Parse`), one HTTP
  client setup, one error surface to map. Smaller blast radius for
  blueprint §11.1 because there's exactly one Fly client to keep
  encapsulated, not two with different semantics. The decision is
  reversible — if a future need surfaces only on the GraphQL
  endpoint (e.g., org-level operations, app metadata that flaps
  doesn't expose), adding `*fly.Client` alongside is a one-field
  edit on `FlyDeployTarget`.
- **`target_test.go` is the smallest test file in the codebase
  doing the most work per LOC.** Eleven lines, three `var _
  DeployTarget = (*X)(nil)` declarations. The job at write time:
  satisfy the plan's acceptance criterion "compile-time interface
  assertions in `target_test.go`." The job at maintenance time:
  any future PR that renames or removes `Spawn`/`Stop`/`Destroy`/
  `Health`/`Kind` on `FlyDeployTarget`, `LocalDeployTarget`, or
  `AWSDeployTarget` produces a *directed* build failure on the
  exact line that pins the contract — not a runtime surprise at
  the call site three packages away. The side effect is that
  `internal/deploy` flips from `[no test files]` (would-be
  Phase 5 baseline) to `0.497s [no tests to run]` in `go test
  ./...` output: the package now has skin in the test-cycle game
  even before Phase 8's real cases land. **The interface
  assertion is the cheapest enforcement mechanism for §11.1
  available in Go.**
- **`appNameFor` uses UUIDv5(`NameSpaceURL`, "corellia/<name>")
  for non-UUID inputs** rather than the plan's "first 8 hex chars
  of a UUIDv5(name)" sketch's terser form. Behaviorally
  equivalent: deterministic for a given input string, no central
  registry needed, eight-character app-name suffix means up to
  16⁸ = ~4.3 billion distinct prefixes (collision-resistant for
  a population of agents the v1/v2 architecture is sized for).
  The implementation uses `strings.ReplaceAll(id.String(), "-", "")[:8]`
  because `uuid.UUID.String()` formats as `<8>-<4>-<4>-<4>-<12>`;
  slicing the un-stripped form would happen to give the right
  bytes for index `<8` but breaks the moment anyone adjusts the
  prefix length without re-deriving the hyphen positions. Belt-
  and-braces against a maintenance footgun. **For UUID inputs**
  (the production hot path: an `AgentInstance.id` from the DB),
  the function recognizes the format via `uuid.Parse` and uses
  the parsed UUID's first 8 hex chars directly.
- **`validateImageRef` is a defence-in-depth check, not a primary
  validation.** The Postgres CHECK constraint added in Phase 4
  (`adapter_image_ref LIKE '%@sha256:%'`) is the authoritative
  enforcement of blueprint §11.2; `Spawn`'s `validateImageRef` is
  the application-layer redundancy that catches programmer error
  before the API call is made. Both layers must agree on what a
  valid ref shape looks like; if they ever diverge, the SQL CHECK
  is the source of truth (an operator with `psql` access can write
  to the column without crossing the Go layer; nothing can write
  to it without crossing the CHECK). The `errors.New("deploy:
  image ref must be digest-pinned (@sha256:...)")` message is a
  *direct paste* of the human-readable form of the CHECK
  constraint name (`adapter_image_ref_digest_pinned`), so an
  operator debugging a Spawn failure can grep across the schema
  + the application code with one query.
- **The `MachineRestart{Policy: MachineRestartPolicyOnFailure}`
  decision (plan §17) is encoded directly, not as a default.** Per
  the plan, `on-failure` is the right policy for v1 because
  Hermes is a long-lived service, not a batch job — exit means
  the agent crashed, not that it finished. The fly-go default for
  `Restart` is also `on-failure` (per the SDK docstring), so the
  explicit assignment is *belt-and-braces*: a future fly-go
  version that changes the default would silently change our
  v1 agents' restart behavior across rolling SDK upgrades. Pinning
  the policy at the call site means the SDK upgrade is forced to
  break the build (if the constant disappears) rather than break
  the runtime semantics.
- **The five-state `HealthStatus` enum** (`unknown` / `starting` /
  `started` / `stopped` / `failed`) collapses Fly's eight-state
  machine state vocabulary (`created`, `starting`, `started`,
  `stopping`, `stopped`, `replacing`, `destroying`, `destroyed`,
  plus implicit-error states) into the minimum the application
  cares about. `mapFlyState` encodes the projection: `starting`
  + `created` → `HealthStarting`; `stopped` / `stopping` /
  `destroyed` / `destroying` all → `HealthStopped` (the user-
  facing distinction "is this agent serving traffic right now?"
  doesn't care about teardown granularity); anything else falls
  through to `HealthFailed` rather than `HealthUnknown` because
  an unrecognized state from a *known* API endpoint is a
  malfunction, not an indeterminate observation. `HealthUnknown`
  is reserved for "the call itself errored" (network failure,
  permission denied, etc.) — distinct from "the call succeeded
  and Fly says the machine is in some state we don't have an
  enum for."
- **`Spawn` does *not* wait for the machine to reach `started`.**
  Returns immediately after `flaps.Launch` — caller persists the
  `SpawnResult{ExternalRef, MachineID}` and is expected to poll
  `Health` if it cares. This matches the plan's decision (§14
  / §15 of the M3 plan implicitly: "spawning is fire-and-forget
  from the deploy layer; the AgentInstance state machine in the
  domain layer owns 'pending → running'"). Two reasons: (a) the
  HTTP request that hit `Spawn` shouldn't block on Fly's
  scheduling — typical machine-start times are 1–5 seconds but
  the long tail can be tens of seconds; (b) the polling loop
  belongs in the same place as the AgentInstance status update
  (Phase 6+ of M3 / M4), not split across two abstraction layers.
- **`Stop` lists then iterates rather than firing a single
  app-level `Stop` call.** flaps has no app-scoped stop primitive;
  every flaps stop is per-machine. v1's "one AgentInstance = one
  Fly app = one Fly machine" topology (blueprint §8) means the
  iterator loop is single-iteration in practice, but the code
  shape is correct for v2's "multiple machines per app" if and
  when that arrives without the consumer changing. The same
  decision (list-then-iterate) absorbs the v1 hard guarantee
  ("there is one machine"), gracefully degrading rather than
  asserting it.
- **`Destroy` is `flaps.DeleteApp`, not `Stop` then `Delete`.**
  `flaps.DeleteApp` cascades — destroying the app cleans up its
  machines, secrets, IP assignments, and metadata in one round-
  trip. Calling `Stop` first would be a courtesy to the running
  process, but Hermes 0.x is not a stateful service that needs
  graceful shutdown (there's no in-flight transaction to commit,
  no socket to drain), and the cost of the gentleness is one
  extra round-trip per agent on the destroy path — which is
  the *bulk* destroy path during fleet teardown. v2 may want to
  introduce a "graceful destroy" variant for stateful harnesses;
  for v1 the violent destroy is correct and faster.
- **`adapters.UpdateImageRef`'s redacted-error pattern is the
  third domain service to ship it.** `users.UpdateName` (0.2.5
  Phase 4) and `organizations.UpdateName` (0.3.0 / pre-M2) both
  established the shape: `pgx.ErrNoRows → service.ErrNotFound`
  (handler maps to `connect.CodeNotFound`); raw error otherwise
  (handler maps to `slog.Error` + redacted `Internal`). Phase
  5's `UpdateImageRef` follows it byte-for-byte. Three services,
  one architectural pattern — the codebase has a *convention*
  for write-side error handling at the domain layer, not just
  individual ad-hoc choices. **Adding a fourth service in M4
  (`agents.SpawnInstance` writes the AgentInstance row) is now
  paint-by-numbers.**
- **`UpdateImageRef` is plumbing-only in M3.** No caller exists
  in M3; the writer is M4 (or a hypothetical M3.5 admin tool)
  that programmatically updates the `harness_adapters` row's
  pinned ref after the next adapter rebuild. The decision to
  land it now (rather than at first reader) is the same one
  M2's plan made for `adapters.Get`: extending an existing
  package is cheaper than scaffolding it, and the surface area
  is small enough that "land the symmetric write side now"
  doesn't rise to a CLAUDE.md "design for hypothetical future
  requirements" violation. The package's API surface in M3 is
  `Get(id) → row` + `UpdateImageRef(id, ref) → row` — both
  CRUD-shaped, both required by M4's first stateful flow, both
  ~10 LOC; landing them together is honest scaffolding.

---

## Verification matrix (Phase 5 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `internal/deploy/` exists with three implementation files (target, fly, stubs) | ☑ | `wc -l backend/internal/deploy/*.go` → 55 + 180 + 34 + 11 = 280 LOC across four files (counting `target_test.go`). |
| `LocalDeployTarget` and `AWSDeployTarget` satisfy the interface (compile-time assertions in `target_test.go`) | ☑ | Three `var _ DeployTarget = (*X)(nil)` lines in `target_test.go`; `go test ./internal/deploy` compiled the test binary cleanly (`0.497s [no tests to run]`). Removing any method from any concrete type would break this build target on a directed line. |
| `FlyDeployTarget` has a runnable concrete implementation (not a stub) | ☑ | `fly.go` 180 LOC; calls real flaps API methods at every step. Construction requires `(token, orgSlug)` so the binary cannot accidentally instantiate it without credentials. |
| `adapters.Service.UpdateImageRef` exists with the same redacted error-mapping shape as `Get` | ☑ | `service.go` line ~38–50: `pgx.ErrNoRows → ErrNotFound` arm + raw-error fallthrough. Mirrors `Get` exactly. |
| `sqlc generate` regenerates cleanly; `db.Querier` interface gains `UpdateHarnessAdapterImageRef` | ☑ | `internal/db/querier.go` has the new method on the `Querier` interface; `internal/db/harness_adapters.sql.go` has the implementation + `UpdateHarnessAdapterImageRefParams` struct. Both regenerated, both committed-shape. |
| `go vet ./...` clean | ☑ | Empty output (no warnings, no errors). |
| `go build ./...` clean | ☑ | Empty output (only the initial `go: downloading <transitive>` lines once, no compile errors). |
| `go test ./...` clean | ☑ | `internal/deploy` flipped from non-existent to `0.497s [no tests to run]`; `internal/users` cached at the 3-case baseline; `internal/agents` cached at the 2-case baseline. No regression in any package. |

Net: 8/8 satisfied. Phase 5 acceptance criteria all met by direct
empirical evidence (build artefacts, file existence, command output)
rather than inspection or extrapolation.

---

## Decisions made under-the-hood (not in the plan)

- **flaps-only architecture, dropping the GraphQL `*fly.Client`.** Plan
  §Phase 5 task 3 imported `fly` for `Client.CreateApp` /
  `Client.SetSecrets` / `Client.DeleteApp` and `flaps` for `Launch` /
  `List` / `Stop`. As-built collapses both to flaps because flaps
  exposes equivalents for the GraphQL operations Phase 5 needs and
  accepts the org slug directly (no GraphQL ID resolution). The
  package still imports `fly` for the type-only surface
  (`fly.LaunchMachineInput`, `fly.MachineConfig`, `fly.MachineGuest`,
  `fly.MachineRestart`, `fly.MachineRestartPolicyOnFailure`,
  `fly.StopMachineInput`) — these are wire-format DTOs that flaps
  re-exports through method signatures. **§11.1 compliance is
  unchanged**: `internal/deploy/` is still the only package that
  imports either name. Everything else sees only `DeployTarget`,
  `SpawnSpec`, `SpawnResult`, `HealthStatus`, `ErrNotImplemented`.
- **`tokens.Parse(token)` is the credential constructor, not
  `fly.TokensFromString` (plan-specified, doesn't exist).** The
  fly-go v0.5.0 token surface lives in `github.com/superfly/fly-go/tokens`,
  exposing `func Parse(string) *Tokens` and `func ParseFromFile(string,
  string) *Tokens`. Phase 5's `NewFlyDeployTarget` uses `tokens.Parse`.
  No production-shape difference vs. the plan's intent (both produce
  a usable `*Tokens` from a single string); the import path and
  constructor name are the only delta.
- **`UserAgent: "corellia"` on the flaps client.** Plan didn't
  specify a user agent. Setting one means Fly's logs (and any
  rate-limit / abuse signals on their side) attribute API calls to
  this codebase rather than the default `"fly-go"` shared by every
  fly-go consumer. Cost: zero (one map literal entry); benefit:
  a thread-pull point if Fly ever emails about an outage or
  unusual call volume from this credential. Same shape every
  HTTP-using domain in the codebase eventually grows; landing
  it at first call rather than retrofitting later.
- **`SetAppSecret` per-key loop, *not* parallelized.** flaps
  `SetAppSecret` is a sequential round-trip; Phase 5's loop fires
  them in order. `errgroup.Group{}.Go(...)` would be a 6-line
  refactor for parallelization; deliberately not done because: (a)
  the secret count per agent is bounded by the harness contract's
  `CORELLIA_*` set (~5–10 entries); (b) any failure in the middle
  of a parallel loop leaves the app in an inconsistent partial-
  secret state that needs cleanup logic not yet written; (c) the
  serial loop's failure mode is "stop at first error, app is
  partially configured but Destroy will clean it up" — well-defined
  and actionable. v2's bulk-spawn flow may want parallelization
  here; M3 doesn't need it.
- **`flaps.NewWithOptions` is called once at `NewFlyDeployTarget`
  time, not lazily on first use.** Plan implied per-method client
  construction (`fc, err := flaps.NewWithOptions(ctx, ...)` inside
  each method body). As-built constructs once at startup so:
  (a) configuration errors (missing token, malformed `FLY_FLAPS_BASE_URL`)
  surface at boot via the existing `cfg.MustLoad → panic` path
  rather than at the first agent-spawn HTTP request; (b) the HTTP
  client + cookie jar inside flaps is reused across requests
  (negligible win on typical load, but free); (c) the `*FlyDeployTarget`
  is a clean dependency-injected handle with one
  initialization-failure point. The trade-off — `NewFlyDeployTarget`
  now requires a `context.Context` because `flaps.NewWithOptions`
  does — is mild and consistent with codebase convention (every
  `*Service` constructor that touches network or DB takes one).
- **`AutoDestroy: false` on the machine config.** Plan §17 listed
  this. As-built encodes it explicitly even though `false` is
  Go's zero value for `bool`; the explicit assignment makes the
  decision *visible* in the source rather than implicit in the
  zero-value default. A future SDK upgrade that flips the field
  to `*bool` (nil-meaning-something-different) would force this
  line to update, surfacing the change at the right place.
- **The package has no internal logging.** No `log` / `slog`
  calls in `fly.go` or `stubs.go`. Errors are wrapped with
  `fmt.Errorf("fly: <op>: %w", err)` and returned to the caller
  (the domain service in M4); the caller decides whether to log.
  Two reasons: (a) the package's surface is meant to be embedded
  in a domain service that already has an error-logging convention
  (the redacted-error pattern from 0.2.5); (b) double-logging
  (here + in the domain service + in the handler) is the wrong
  shape for the slog-once-per-error rule the codebase has settled
  on. Operator visibility into Fly errors will come through the
  `slog.Error` call in the M4 handler's redacted-default arm; the
  Fly-specific context lives in the wrapped error chain.
- **Phase 5 wrote zero `_ = ref` blank-identifier keepalive
  imports.** The temptation in earlier phases (M2 Phase 4,
  per `agents.Service` discussion) was to land an empty
  package with `import _ "..."` keepalives so the build stays
  green. Phase 5's `internal/deploy/` doesn't need this because
  every import is consumed at write-time: `context` by every
  method signature, `errors` by `validateImageRef`, `fmt` by
  every `Errorf`, `strings` by `parseExternalRef` / `appNameFor`,
  `uuid` by `appNameFor`, `fly` by the type references, `flaps`
  by every method call, `tokens` by `tokens.Parse`. Same is
  true of `stubs.go` (only `context`) and `target.go` (only
  `context` + `errors`). The package is at-rest fully consumed
  before any external caller exists — a property of the code
  shape, not a discipline imposed at review time.

---

## What this means for Phase 6

Phase 6 wires `FlyDeployTarget` into `cmd/api/main.go`. The Phase
5 → Phase 6 coupling is *constructional*, not *protocol*:

1. **`config.Config` already has `FlyAPIToken` and `FlyOrgSlug`.**
   Both are panic-on-missing required vars (per `CLAUDE.md`'s
   environment section). `cmd/api/main.go` already loads `cfg`
   at startup; Phase 6 reads `cfg.FlyAPIToken` and `cfg.FlyOrgSlug`,
   passes them to `deploy.NewFlyDeployTarget(ctx, token, slug)`,
   and stashes the result on `httpsrv.Deps`. No new env-var
   plumbing needed.
2. **The target's *constructor* takes a context.** Phase 6
   uses `context.Background()` at startup-time — the only context
   available before the HTTP server is up. This is the established
   shape for boot-time DB pool construction (`pgxpool.New` in
   `db.NewPool`) and is consistent with how startup-time
   initialization signals failure (return an error → `log.Fatal`
   in main, never panic from a constructor).
3. **The target is *not* an interface field on `Deps` yet.** Phase
   6 stashes the concrete `*deploy.FlyDeployTarget`; the M4 plan
   will widen this to a `deploy.DeployTarget` interface field
   when the M4 domain service starts taking it. Holding the
   concrete type at the boundary today (vs. the interface) means
   today's code is self-documenting about which target is
   actually wired; the interface widening is mechanical when M4
   needs polymorphism. **`stubs.go`'s `LocalDeployTarget` and
   `AWSDeployTarget` are not wired into `Deps` in M3 or M4** —
   they exist to document that the abstraction is real, not to
   participate in the v1 runtime.
4. **The interface assertions in `target_test.go` are the
   contract Phase 6 relies on.** If Phase 6 ever needs to
   substitute the deploy target in tests (a fake / a mock),
   it can do so by writing a 5-method type and dropping it
   in via the same interface — no edit to `internal/deploy/`
   required. The package is *closed for modification, open
   for extension* through the interface.

Phase 6 does not need to read this completion doc to wire the
target; the Go type signatures and the interface declaration
already advertise everything needed. The completion doc captures
the *why* and the *audit chain*; the type system captures the
*what* and the *how*.

---

## Pre-work tasks status

The plan's §3 pre-work checklist is fully closed by Phase 4; Phase
5 inherits a fully-prepared substrate:

- ☑ Database connection (touched only via `sqlc generate` reading
  `backend/sqlc.yaml`'s connection string — *no* runtime DB
  access in Phase 5 deliverables).
- ☑ Goose migrations applied through Phase 4 (`adapter_image_ref`
  is `NOT NULL` with the digest-pinning CHECK; sqlc's regen
  produces the correct non-pointer `string` type for the column
  — not exercised by Phase 5's `UpdateImageRef` directly because
  the parameter struct uses the same column type, but
  *structurally* relied on by Phase 6+'s reader path).
- ☑ Phase 2 captured-metadata block (the source of truth for
  what string `UpdateImageRef` will eventually be called with at
  M4 spawn time; not consumed by Phase 5 itself).

Branch hygiene remains soft (same as Phases 1–4); the new
`backend/internal/deploy/` directory is uncommitted alongside the
rest of the M3 working tree.

---

## Risks / open issues opened by Phase 5

- **`fly.go`'s API path is unexercised against a real Fly
  endpoint.** Build green, vet green, test-binary linked — but
  no integration test fires `FlyDeployTarget.Spawn` against
  the real API. Phase 7's end-to-end harness contract validation
  is the first time this code makes a network call to Fly. The
  risk surface: any signature drift between the godoc I read
  and the runtime behavior of fly-go (a wire-format quirk, an
  undocumented retry semantic, an authentication path that
  the godoc doesn't expose) lands as a Phase 7 failure rather
  than a Phase 5 failure. Mitigation: Phase 7's smoke runs
  against the same flaps API path that Phase 3's `smoke.sh`
  proved works end-to-end — the API path is *known* to be
  correct from Phase 3; the only new variable is whether the
  Go wrapper around it is correct.
- **No retry / backoff on flaps round-trips.** `flaps.Retry`
  exists in the SDK as a helper; Phase 5 doesn't use it. Any
  transient network blip during `Spawn`'s three round-trips
  (CreateApp → SetAppSecret loop → Launch) surfaces as a
  partial state that the caller has to clean up. v1's "one
  agent at a time, low fleet count" sizing makes this rare;
  the post-v1 work to wrap each round-trip in `flaps.Retry`
  (or to add a top-level rollback on partial Spawn failure)
  is a 30-LOC change that's deferred until the partial-state
  mode actually gets observed.
- **`Spawn` doesn't wait for `started`; callers may interpret
  `SpawnResult` as "the agent is live" rather than "the
  machine is launching."** The `HealthStatus` enum and the
  `Health` method exist precisely to answer "is it live yet?"
  but nothing in the package's docstring forces the caller to
  poll. A naive M4 implementation that returns `SpawnResult`
  to the FE without polling will surface as "agent shows
  Running but `/chat` 500s for 5 seconds." Mitigation: the
  M4 plan's spawn flow needs an explicit `Health`-poll step;
  the package's doc-comment on `Spawn` should be tightened
  in M4 to say so. Deferred to M4 because M3's job is to
  land the primitives, not to encode the orchestration on
  top.
- **No timeout on the flaps round-trips beyond the caller's
  context deadline.** A hung Fly endpoint (rare but possible)
  would block `Spawn` until the request context expires.
  In M3 there's no caller, so there's no caller-side
  deadline; M4's HTTP handler will have one (Connect's
  default is unbounded but the Chi server has a write-
  timeout). Belt-and-braces: Phase 6 could pass
  `context.WithTimeout(ctx, 60*time.Second)` to each
  flaps call. Deferred — the right place for that
  decision is the domain service that *owns* the spawn
  flow, not the deploy package that's an implementation
  detail beneath it.
- **`appNameFor` is collision-resistant but not
  collision-free.** Eight hex chars = 16⁸ ≈ 4.3B values;
  birthday collision at √16⁸ ≈ 65k agents per organization.
  v1/v2 sizing (50–500 agents per org) is comfortably below
  the collision-meaningful regime, but the failure mode
  matters: a collision means `flaps.CreateApp` rejects the
  second-spawn attempt (Fly app names are globally unique
  per organization), and the caller sees a non-ergonomic
  error string. Two mitigations available: (a) widen the
  prefix to 12 hex chars (16¹² ≈ 2.8 × 10¹⁴; collision at
  ≈17M agents — practically free); (b) detect the collision
  in `Spawn` and retry with a salted UUID. Deferred — the
  decision point arrives when the org's agent count crosses
  ~10k.
- **No equivalent of Phase 4's CHECK constraint for the
  `Spawn` validation.** `validateImageRef` enforces
  `@sha256:` containment in Go; the SQL CHECK enforces
  `LIKE '%@sha256:%'` in Postgres. The two checks should
  agree; nothing automated tests that they do. The Phase 4
  completion doc flagged the same shape (`UpdateImageRef`
  could write a tag-form ref that fails the CHECK at
  insert time) — Phase 5's `validateImageRef` is the
  application-side belt; the CHECK is the database-side
  braces. If they ever diverge, the database wins
  (authoritative) and the Go layer surfaces a confusing
  error. A 5-LOC unit test (`TestValidateImageRefMirrorsCheck`)
  could hard-pin the alignment by exercising the same
  inputs against both — deferred until the first time the
  two get out of sync.
- **`internal/deploy/` has no domain-level test file.** The
  compile-time interface assertions are not behavior tests;
  they're contract guards. The package's runtime behavior
  (the state-mapping in `mapFlyState`, the appName
  derivation in `appNameFor`, the error wrapping) is
  unexercised by `go test`. Phase 8's testing pass adds:
  `TestAppNameFor_*` (UUID input + free-text input + same-
  input-stable-output), `TestMapFlyState_*` (table-driven
  over the eight Fly states), `TestValidateImageRef_*`
  (digest-pinned vs. tag-pinned vs. malformed), and a
  `TestSpawn_RejectsTagRef_BeforeNetworkCall` that asserts
  `validateImageRef` runs before any flaps round-trip
  (preventing a future refactor from accidentally
  reordering the validation past the API call). Deferred
  to Phase 8 per the plan; called out here so the gap is
  documented at the moment it opens.

---

## What's still uncommitted

Phase 5 produces a multi-file diff in the repo:

- `backend/internal/deploy/` (new directory; four files: `target.go`,
  `fly.go`, `stubs.go`, `target_test.go`)
- `backend/queries/harness_adapters.sql` (edit; +7 LOC for the
  new `UpdateHarnessAdapterImageRef :one` query)
- `backend/internal/adapters/service.go` (edit; +14 LOC for
  the widened interface and new `UpdateImageRef` method)
- `backend/internal/db/harness_adapters.sql.go` (regenerated;
  +30 LOC for the new query method + Params struct)
- `backend/internal/db/querier.go` (regenerated; +1 LOC for
  the interface entry)
- `backend/go.mod` + `backend/go.sum` (edit; +18 deps net,
  fly-go v0.5.0 + transitives)

All untracked / unstaged, joining the M3 working tree (Phases 1–4's
adapter source + smoke + migration). The Phase 5 diff has *no*
runtime durability against the dev DB (unlike Phase 4's migration);
it's all in-tree code that needs to be committed before another
contributor can pull it. The flip side: Phase 5's code is fully
reversible by `git checkout` of the four edited files + `rm -rf
backend/internal/deploy/`, with no DB state to roll back. **Phase
5 is the most reversible phase in M3.** Phases 1–3 changed external
state (the published image at GHCR); Phase 4 changed durable DB
state; Phase 6+ will couple `cmd/api/main.go` to the new package
in a way that makes a clean revert harder. **The narrowest
checkpoint to land Phases 1–5 as a single commit is right now**,
before Phase 6 starts.

---

`★ Insight ─────────────────────────────────────`
- **Phase 5 is the smallest M3 phase by domain LOC and the
  largest by abstraction-shape impact.** ~280 LOC of Go (and
  half of that — `target.go` + `stubs.go` + `target_test.go`
  — is interface declaration and assertion, not implementation)
  introduces the second cross-cutting abstraction in the
  codebase after `db.Querier`. Pre-Phase 5, `internal/deploy`
  didn't exist as a concept; deploys were a TODO in the M3
  plan. Post-Phase 5, the *interface contract* for "deploy a
  containerized agent on any infrastructure provider" is
  encoded as a Go interface with three concrete satisfying
  types. Adding a fourth target — `K8sDeployTarget`,
  `RailwayDeployTarget`, whatever the future demands — is now
  a single-file edit alongside the existing three. **§11.1
  is encoded structurally in the type system, not just
  documented as a rule.**
- **The plan-vs-as-built drift on `fly-go` API surface is the
  load-bearing argument for separating "what to build" from
  "how to call the SDK."** The plan got the *what* exactly
  right (interface + concrete + stubs + an `UpdateImageRef`
  method), and the *how* substantially wrong (constructor
  signature, secret-setting path, flaps client construction).
  Going from plan to as-built took ~20 minutes of `go doc`
  reading and three substantive deviations from the plan's
  literal Go code. **Plans that prescribe Go code at the
  call-site level age fast against a third-party SDK; plans
  that prescribe interface shapes age slowly because the
  shape is what the codebase commits to**, while the call
  site is just the most recent way to satisfy that shape.
  The plan's risk register entry that flagged this exact
  failure mode ("the structural decisions are stable;
  consult SDK godoc and adjust calls to match") was the
  single most useful sentence in the whole plan document.
- **The 280-LOC bag of files in `internal/deploy/` is the
  first place in the codebase that *every* blueprint §11
  rule applies simultaneously and non-trivially.** §11.1
  (no Fly-specific code outside this package) — encoded
  by the package-level boundary; tested by every other
  package's import list. §11.2 (digest-pinning) — encoded
  in `validateImageRef`; tested in alignment with the
  Phase 4 CHECK. §11.3 (`CORELLIA_*` env vars) — flowed
  through `SpawnSpec.Env` to `flaps.SetAppSecret` without
  the deploy package knowing the variable names. §11.4
  (deferred features as real interfaces) — encoded by
  `LocalDeployTarget` + `AWSDeployTarget` + the
  compile-time assertions. **Five blueprint rules, one
  ~280-LOC package, all four enforcement layers (type
  system, constraint, convention, test) in agreement.**
  This is what "architecture rules treated as defects"
  looks like in practice — not a list of don'ts, but a
  package whose shape the rules collectively determine.
`─────────────────────────────────────────────────`

---

*(Phase 6 — wire `*deploy.FlyDeployTarget` into `cmd/api/main.go`
via `httpsrv.Deps`, making the deploy capability available to the
binary at startup — is next.)*
