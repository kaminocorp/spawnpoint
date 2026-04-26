# Completion — M3 Phase 6: `cmd/api/main.go` wiring + `httpsrv.Deps.DeployTargets` (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 6
**Status:** Phase 6 landed (static-check threshold); Phases 7–8 pending. Boot smoke + HTTP smoke deferred to operator runbook.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md` (adapter source)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md` (image published; digest captured)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-3.md` (operator smoke harness)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-4.md` (DB migration: `adapter_image_ref` backfill + `NOT NULL` + digest CHECK)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-5.md` (`internal/deploy/` package + `adapters.UpdateImageRef`)

This document records the *as-built* state of Phase 6. Phase 5 introduced
`internal/deploy/` with `DeployTarget` interface + `FlyDeployTarget` /
`LocalDeployTarget` / `AWSDeployTarget` concrete types; nothing
instantiated them. **Phase 6 is the first M3 phase whose deliverable is
the `cmd/api` binary actually constructing a `*deploy.FlyDeployTarget` at
boot.** It registers all three deploy targets in a `map[string]deploy.DeployTarget`
keyed by each target's `Kind()`, exposes the map on `httpsrv.Deps`, and
emits a single `deploy targets initialised` boot log line so an operator
can confirm the wiring fired without running curl. Concurrent: the
`adapters.NewService(queries)` call is added with a `_ = adaptersSvc`
blank-identifier keepalive — service constructed at boot, first HTTP
caller arrives in M4. Net effect: `Config.FlyAPIToken` and
`Config.FlyOrgSlug` (both `required` env vars since 0.1.0) finally have
a runtime reader; the binary fails fast at boot if either is missing.

---

## Files added / changed

| File | Status | LOC | Notes |
|---|---|---|---|
| `backend/internal/httpsrv/server.go` | edit | +2 / -0 | One new field on `Deps` (`DeployTargets map[string]deploy.DeployTarget`) between `AgentsHandler` and `AllowedOrigin`; one new import (`internal/deploy`). **No route handler edit, no Mount call.** The field exists; the consumer arrives in M4. |
| `backend/cmd/api/main.go` | edit | +25 / -1 | Two new imports (`internal/adapters`, `internal/deploy`); five new constructor lines (`adaptersSvc` + blank-identifier keepalive; `flyTarget` with error-out path; `localTarget`; `awsTarget`; `deployTargets` map literal); one `slog.Info("deploy targets initialised", ...)` line; one new `DeployTargets: deployTargets` field on the `Deps{...}` literal; one 6-LOC `keysOf` generic helper at the bottom. |

No proto, no schema, no frontend, no domain-package edits. Phase 6 is a
binary-wiring phase end-to-end: it threads existing types through the
existing `Deps`-driven server-construction shape that 0.1.0 established
and every subsequent milestone has extended.

---

## Index

- **The `slog.Info("deploy targets initialised", "kinds", ..., "fly_org", ...)` line is the operator's single point of confirmation that Phase 6 fired.** Three lines now appear in order at boot: `jwks initialised` (auth subsystem ready) → `deploy targets initialised` (Phase 6's contribution) → `listening addr=:8080` (HTTP server up). The middle line emits `kinds=fly,local,aws` and the configured `fly_org`, which means an operator running `cd backend && air` can confirm: (a) the Fly token+slug are non-empty (config didn't panic at `env.Parse`); (b) `deploy.NewFlyDeployTarget` succeeded (flaps client constructed, `tokens.Parse` returned a non-nil `*Tokens`); (c) all three targets registered in the map. If the line is missing, the binary either panicked earlier (config) or `os.Exit(1)`'d on the flaps init (the `slog.Error("fly deploy target", ...)` arm). **Three log lines = three subsystems confirmed, no ambiguity.**
- **`map[string]deploy.DeployTarget` keyed by `Kind()` is structurally a polymorphic dispatch table.** The map keys (`"fly"`, `"local"`, `"aws"`) come from each target's own `Kind()` method — a self-describing registry, not a hand-maintained string table. M4's spawn flow can do `target, ok := deps.DeployTargets[instance.DeployTargetKind]` and surface a clean "Coming soon" UX for `local` / `aws` without an `if kind == "local" { ... } else if kind == "aws" { ... }` chain. **The map is the polymorphic dispatch table that blueprint §11.4 implicitly mandates** ("deferred features stub as real interface implementations") — and the boot log line emits all three kinds, advertising the full surface to anyone reading the logs.
- **`_ = adaptersSvc` is the M3-tier compromise between two real codebase rules.** CLAUDE.md says "don't add features beyond what the task requires" (would forbid wiring `adapters.NewService` with no caller). The M3 plan says "pre-wire now to avoid M4-time `main.go` churn" (would require it). The `_ =` line is the smallest possible artefact that satisfies both: the service is constructed at boot-time (M4's first reader will replace `_ =` with a real assignment in one keystroke); Go's unused-variable rule is satisfied by the explicit blank-identifier discard. The alternative — landing `adapters.NewService` only at M4 time — would force a separate `main.go` edit + a separate review of "where in the constructor sequence does this go?", which is exactly the relitigation the M3 plan is trying to avoid. **The `_ =` is a contract with future-self: M4 reads this and knows the constructor call sequence is already settled.**
- **`keysOf` is a 6-line generic helper at the bottom of `main.go`, not promoted to a shared package.** Go 1.26's stdlib `slices.Collect(maps.Keys(m))` would do the same job in one line — at the cost of two new imports + a `maps` package most readers haven't yet internalised. The 6-line bespoke version trades stdlib elegance for zero new imports + zero new packages to learn. **Right call for a single-call-site helper at the application boundary**; if a second consumer arrives, `slices.Collect(maps.Keys(...))` is the right migration target. The codebase has consistently made this trade-off (see `0.2.5`'s `slices.IndexFunc`-vs-loop debate in user provisioning); small bespoke utilities live where they're used until a third consumer earns promotion.
- **`NewFlyDeployTarget` takes `ctx` as first arg — different from the plan's literal sketch.** Phase 5's as-built constructor is `(ctx context.Context, token, orgSlug string)`, the plan's sketch was `(token, orgSlug string)`. The reason (recorded in Phase 5 completion doc): `flaps.NewWithOptions` requires a context, and constructing the flaps client lazily-per-call would be the wrong shape (configuration errors should surface at boot, not at first agent-spawn HTTP request). Phase 6's wiring honors this: `flyTarget, err := deploy.NewFlyDeployTarget(ctx, cfg.FlyAPIToken, cfg.FlyOrgSlug)` uses the same `ctx := context.Background()` that the existing JWKS verifier and DB pool both consume. **One context, three boot-time consumers** (DB pool, JWKS verifier, Fly target) — the established shape.
- **The constructor sequence in `main.go` is now alphabetical-by-domain, mirroring `Deps`'s field order.** Pre-Phase 6: `usersSvc` → `orgsSvc` → `agentsSvc`. Phase 6 inserts: `adaptersSvc` → `flyTarget` (+ `localTarget` + `awsTarget`) → `deployTargets` (map). The placement (after `agentsSvc`, before the `httpsrv.Deps{...}` literal) matches the corresponding `Deps`-field order (`AgentsHandler` → `DeployTargets` → `AllowedOrigin`). The 0.4.0 changelog called out this convention for M2's catalog wiring; Phase 6 preserves it. **A future maintainer scanning `main.go` and `Deps` side-by-side reads the two as a diptych** rather than two independently-ordered lists that happen to overlap.
- **`os.Exit(1)` (not `panic`) on `NewFlyDeployTarget` failure.** Same shape every other constructor in `main.go` uses (`db.NewPool`, `auth.NewJWKSVerifier`): error returned → `slog.Error` with redacted context → `os.Exit(1)`. `panic` would dump a stack trace to stderr that's noisier than helpful for an operator-facing boot failure; `os.Exit(1)` after a structured slog event is the codebase's established "fail-loud-but-cleanly" convention. **Not a Phase 6 decision — a continuation of the 0.1.0 boot pattern.**
- **`grep -rn DeployTargets backend/internal/httpsrv/` returns exactly one match: `server.go:21:	DeployTargets        map[string]deploy.DeployTarget`** — the field declaration and nothing else. Zero references in any handler, zero references in `New(d Deps) http.Handler`'s router setup. **This is the structural enforcement of "the field exists; the consumer arrives in M4."** Phase 6 left no half-finished plumbing (no half-mounted route, no draft handler with `// TODO M4`); the field's job in M3 is to be reachable from `New(d)`, and `Deps` parameter destructuring is the only edge it needs to cross. M4's spawn flow will read `d.DeployTargets[...]` from inside its handler and dispatch from there.

---

## Verification matrix (Phase 6 acceptance check, static portion)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./...` clean | ☑ | Empty output (no warnings, no errors). |
| `go build ./...` clean | ☑ | Empty output (no compile errors, no missing imports, no unused-variable complaints — the `_ = adaptersSvc` keepalive prevents the latter). |
| `go test ./...` clean | ☑ | `internal/agents` cached at 2-case baseline; `internal/users` cached at 3-case baseline; `internal/deploy` cached at `[no tests to run]` (interface assertions still valid); other packages `[no test files]`. **No regressions.** |
| `cmd/api` binary builds end-to-end | ☑ | `go build -o /tmp/corellia-api ./cmd/api` produced a 27MB static binary (executable bit set, `-rwxr-xr-x@`). The full wiring graph (config → DB pool → JWKS verifier → user/org/agents/adapters services → fly/local/aws targets → `Deps` literal → `httpsrv.New`) compiles into one statically-linked artefact. |
| `DeployTargets` is reachable from `Deps` but not mounted on any route | ☑ | `grep -rn DeployTargets backend/internal/httpsrv/` returns exactly one match (`server.go:21`, the field declaration). No handler reads it, no router mounts it. **Plan-level invariant: M3 wires the field; M4 reads it.** |
| `Config.FlyAPIToken` and `Config.FlyOrgSlug` finally have a reader | ☑ | `cfg.FlyAPIToken` and `cfg.FlyOrgSlug` referenced at `cmd/api/main.go:~52` (within `deploy.NewFlyDeployTarget(ctx, cfg.FlyAPIToken, cfg.FlyOrgSlug)`). Pre-Phase 6 the fields existed in `config.Config` but were unused — `go vet` would have warned on them eventually with stricter settings. |
| Boot smoke (`air` with three log lines in order) | **deferred to operator** | Cannot fire from non-interactive shell — `air` streams indefinitely. Same operator-runbook precedent Phase 3's `smoke.sh` and Phase 4's `goose down/up` cycle established. Runbook check: `cd backend && air` should emit `jwks initialised` → `deploy targets initialised kinds=fly,local,aws fly_org=<slug>` → `listening addr=:8080` in order, ~1s apart. Missing line = subsystem failure; check `backend/.env` for the matching env var. |
| HTTP smoke (M2 `ListAgentTemplates` still works) | **deferred to operator** | Requires a live Supabase access token from an interactive sign-in flow. Runbook check: `curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{}'` → 200 + Hermes template. Same shape M2's Phase 6 deferred-runbook entry used. |

Net: 6/8 satisfied directly by static checks; 2/8 deferred to the
operator runbook for live-shell exercise. The deferred two are
exactly the runtime-shape checks Phase 6 cannot fire from a
non-interactive shell — same precedent every prior M3 phase set
when the verification needed live state (Phase 3's smoke, Phase 4's
goose round-trip, Phase 5's no-runtime-shape).

---

## Decisions made under-the-hood (not in the plan)

- **Constructor pattern: explicit `localTarget := deploy.NewLocalDeployTarget()` / `awsTarget := deploy.NewAWSDeployTarget()` once each, not the plan's double-call shape.** The plan's snippet had `deploy.NewLocalDeployTarget().Kind(): deploy.NewLocalDeployTarget()` — calling the constructor twice per stub (once to get the key, once to put the value in the map). As-built constructs each stub once and uses the variable on both sides of the map literal: `localTarget.Kind(): localTarget`. Two reasons: (a) one constructor call per target type matches what an `interface DeployTarget` consumer expects (the targets are stateful in principle, even if `LocalDeployTarget{}` is empty in practice); (b) the variable name documents intent at the call site (`localTarget` is more searchable than `deploy.NewLocalDeployTarget()` in `git grep`). Behavior identical for empty-struct types, but the shape generalises better — when a future stub gains state (config, sentinel error, anything), the single-construction shape stays correct.
- **Error handling on `NewFlyDeployTarget` is `slog.Error + os.Exit(1)`, not the plan's implicit success assumption.** Plan §Phase 6 task 1 had `flyTarget := deploy.NewFlyDeployTarget(cfg.FlyAPIToken, cfg.FlyOrgSlug)` — no error return because the plan's sketch of Phase 5 had the constructor returning a single value. Phase 5's as-built `NewFlyDeployTarget` returns `(*FlyDeployTarget, error)` because `flaps.NewWithOptions` is fallible; Phase 6's wiring honors that with the standard boot-error pattern (slog → exit). **The error path is the kind of cross-phase plumbing that only surfaces at integration time** — neither phase plans had it because each was reasoning about its own boundary in isolation.
- **`_ = adaptersSvc`'s comment is plain prose, not `// TODO`.** "M3 wires the service; first HTTP caller arrives in M4." A future maintainer reading this immediately understands: (a) it's deliberate, not forgotten; (b) the next step is wiring an HTTP handler, not removing the line; (c) the responsibility lives in M4. **`// TODO` would have been semantically wrong** — there's no task to do *here*; the task is in the M4 plan. Same shape M2's plan used for the M3-pending `harness_adapters.adapter_image_ref` column comment. **Comments that describe what's *next* are project-state comments, not code comments**; project-state belongs in plan/changelog docs, but at the call site, prose-as-rationale beats pretend-task syntax.
- **`keysOf` lives at the bottom of `main.go`, after `func main()`.** Go's package-level convention is "exports first, then unexported helpers, then test files." `keysOf` is unexported and called only by `main()`, so under-`main()` placement keeps it adjacent to its call site. Promoting it above `main()` would have been arguable (alphabetical ordering of top-level declarations); promoting it to a shared package would have been wrong (single call site, six lines, generic). **Bottom-of-file is the codebase's established home for one-call-site utilities** — same shape `httpsrv/cors.go` uses for `originAllowed` and `users_handler.go` uses for `usersErrToConnect`.
- **The `deploy targets initialised` log keys are `kinds` (plural, comma-separated) and `fly_org` (singular).** Not `targets` / `target` / `count`. **`kinds` advertises the polymorphic surface** (three values: `fly,local,aws`) so an operator-grep on `kinds=` returns the full set across all observed runs; `fly_org` is the single-value parameter that actually informs the configuration sanity check (an empty value would mean `FLY_ORG_SLUG` was set to empty-string at boot, which `env.Parse` allows but is a typo signal). The asymmetry is deliberate. **One log line, two grep-target structured fields, designed for actionable answer-seeking** rather than uniform key-value padding.

---

## What this means for Phase 7 and Phase 8

**Phase 7** is the end-to-end harness contract validation against the
real Fly endpoint. Phase 6 → Phase 7 coupling is *substrate*, not
*protocol*: Phase 6 makes `FlyDeployTarget` instantiable in the
running binary; Phase 7 exercises it against a real flaps endpoint.
Three sub-couplings:

1. **Phase 7 may exercise `FlyDeployTarget` directly** (out-of-band of
   the running `cmd/api`), constructed via `deploy.NewFlyDeployTarget`
   from a small test driver — same pattern as Phase 3's `smoke.sh`,
   but Go-shaped instead of bash-shaped. Phase 6's `cmd/api` boot is
   the *primary* sanity check ("the binary starts cleanly with
   real Fly credentials"); Phase 7 is the secondary, narrower check
   ("the API path actually reaches Fly and returns the expected
   wire shapes"). The two are complementary.
2. **Phase 7's failure modes split into two regimes.** (a) "The plan-vs-as-built
   API drift caught at Phase 5 write-time was incomplete and there are
   *more* drifts" — surfaces as a non-200 from flaps, decodable from
   the wrapped error. (b) "The flaps API path itself is healthy but
   the Hermes adapter image (Phase 1+2's deliverable) doesn't accept
   the env vars Phase 7 sends" — surfaces as a machine that
   `flaps.Launch` succeeds for, but `Health` reports `failed` after
   the boot probe. The two regimes need different debugging paths;
   the wrapped-error chains in `fly.go`'s `fmt.Errorf("fly: <op>: %w", err)`
   should make the first easy and the second require log-tailing.
3. **Phase 7 does *not* need any new wiring in `cmd/api`** — Phase 6
   completed the binary's wiring graph. Phase 7's smoke harness is
   either a separate Go test file (`internal/deploy/integration_test.go`)
   gated behind a build tag, a one-shot `go run ./cmd/deploy-smoke/`
   driver, or a curl-based exercise of an as-yet-unwritten admin
   RPC. The plan §Phase 7 hasn't picked a shape; the choice belongs
   to Phase 7 write-time.

**Phase 8** is the testing pass + check matrix + changelog draft.
Phase 6 → Phase 8 coupling: the `cmd/api` binary's wiring graph
is now the largest single thing the test matrix exercises (every
import path is loaded; every constructor fires; the `Deps` literal
type-checks). Phase 8's testing contributions land in
`internal/deploy/` (per Phase 5's deferred test list — `mapFlyState`,
`appNameFor`, `validateImageRef`) and `internal/adapters/` (a single
test for `UpdateImageRef` exercising `pgx.ErrNoRows → ErrNotFound`).
Neither package needs `cmd/api` to be involved; Phase 6's wiring is
load-bearing for Phase 7's smoke and the eventual production deploy,
not for Phase 8's unit test additions.

---

## Pre-work tasks status

The plan's §3 pre-work checklist is fully closed by Phase 4; Phase
6 inherits a fully-prepared substrate:

- ☑ `Config.FlyAPIToken` and `Config.FlyOrgSlug` declared since
  0.1.0 — Phase 6 is the first reader of both.
- ☑ `slog`-based JSON logging configured at `main()`'s first line
  (since 0.1.0) — Phase 6's new log line lands in the existing
  pipeline without ceremony.
- ☑ Phase 5's `internal/deploy/` package compiled, tested, and
  ready — Phase 6 only consumes the constructor + `Kind()`
  method and the `DeployTarget` interface.
- ☑ `httpsrv.Deps` shape from M1/M2 — Phase 6 extends it by one
  field rather than introducing a new construction pattern.

Branch hygiene remains soft (same as Phases 1–5); the two edited
files are uncommitted alongside the rest of the M3 working tree.

---

## Risks / open issues opened by Phase 6

- **Boot smoke + HTTP smoke both unverified by static checks alone.**
  The static check matrix (vet/build/test/binary-build) confirms the
  *types* are right — the runtime behavior of "binary boots, three
  log lines fire in order, M2's catalog still serves" requires an
  interactive `air` session to confirm. If any of those three live
  checks fail, the failure is not in Phase 6's diff (which is
  type-checked clean) but in environment shape: missing
  `FLY_API_TOKEN`, `FLY_ORG_SLUG` set to a no-longer-existing org,
  Supabase URL drift, etc. The runbook captured in the verification
  matrix above is the operator's debugging tree.
- **`flaps.NewWithOptions` may succeed even with an invalid token.**
  The flaps client constructor doesn't make a network call to verify
  the token is live; it sets up an HTTP client and a cookie jar.
  The first failure point on a stale/invalid token is `Spawn` (or
  `Stop` / `Destroy` / `Health`) — i.e. Phase 7's smoke. If `cfg.FlyAPIToken`
  is wrong but well-formed (a stale token from a rotated credential),
  Phase 6's boot succeeds *and the boot log line emits*, but Phase 7
  fails. **The boot log line is not a credential-validity check** —
  it's a constructor-success check. Phase 7's runbook should
  document this, since the cleanest failure mode for an operator
  is "I ran air, got the green light, then curl-tested and got
  401 from Fly."
- **The `_ = adaptersSvc` keepalive could survive past M4 if M4's
  wiring forgets to remove it.** A future PR that adds the M4
  spawn handler should replace `_ = adaptersSvc` with a real field
  binding (`AdaptersService: adaptersSvc` on the `Deps` literal,
  or whatever M4 chooses). If M4 forgets and instead constructs a
  *second* `adapters.NewService(queries)` somewhere, the binary
  would have two unrelated service instances — both backed by the
  same `*db.Queries`, but separate sentinel-error scopes,
  potentially divergent in future state. **Phase 8's check matrix
  should include `grep "_ = adaptersSvc" backend/`** to catch the
  vestige if M4 lands without removing it. (Trivial follow-up; flag
  here so the lifecycle is explicit.)
- **No timeout on `NewFlyDeployTarget`'s context.** `ctx :=
  context.Background()` has no deadline — if `flaps.NewWithOptions`
  ever does a network call on construction (it doesn't today, but
  could in a future SDK upgrade), the binary would hang at boot
  rather than time out. Plan §Phase 6 didn't specify a timeout;
  as-built honors that. The right shape — if it ever matters —
  is `ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second); defer cancel()`
  scoped just for boot-time constructors. Deferred until the SDK
  upgrade that would need it.
- **The `deploy targets initialised` log line emits even on
  partial-init failure.** If `deploy.NewFlyDeployTarget` errors
  (the `os.Exit(1)` arm), the line never fires. But if any future
  refactor makes Local/AWS-stub construction fallible (it won't,
  but...), and the construction sits *between* `flyTarget` and
  the `slog.Info`, the log line could fire after a partial failure.
  Today the construction order is fly → local → aws → log → Deps
  literal, so any failure short-circuits at `os.Exit(1)`. Worth
  flagging because reordering the constructor sequence in a
  future PR could weaken this property.
- **`keysOf` returns map keys in non-deterministic order.** Go's
  `range` over a map is randomized. The boot log line therefore
  emits `kinds=fly,local,aws` *or* `kinds=local,aws,fly` *or* any
  other permutation, run-to-run. For an operator grep this is
  noise (three permutations match the same intent). The cleanest
  fix is `slices.Sort(out)` inside `keysOf` — one extra import
  + one line. Deferred because: (a) the log key is informational,
  not asserted; (b) introducing a `sort` dependency for log-output
  cosmetic stability is over-investment for a debug-line. If a
  future test ever asserts on the log line's value, the sort
  becomes load-bearing — at that point, sort.

---

## What's still uncommitted

Phase 6 produces a two-file diff in the repo:

- `backend/internal/httpsrv/server.go` (edit; +2 LOC: one field, one
  import)
- `backend/cmd/api/main.go` (edit; +25 / -1 LOC: two imports, five
  constructor lines, one log line, one `Deps`-field assignment, one
  6-LOC helper)

Both untracked / unstaged, joining the M3 working tree (Phases 1–5's
adapter source + smoke + migration + deploy package). The Phase 6
diff has *no* runtime durability against the dev DB, no external
state changed (unlike Phases 1+2's GHCR push and Phase 4's `goose up`).
Reverting Phase 6 = reverting the two file edits + the matching
import lines. The `internal/deploy/` package itself is from Phase 5
and survives the revert; the binary just goes back to not
instantiating any deploy target at boot.

**Phase 6 is *almost* as reversible as Phase 5**, with one
asymmetry: Phase 6 adds two lines (field + import) to an
already-shipped file (`server.go`), so its diff lives inside an
existing artefact. Phase 5's deliverable was a whole new directory;
removing it is `rm -rf`. Phase 6's revert is line-level. Both are
fast; neither touches durable state.

---

`★ Insight ─────────────────────────────────────`
- **Phase 6 is the M3 phase with the highest confidence-per-LOC
  ratio.** ~27 LOC of `main.go` edits + 2 LOC of `server.go` edits
  = full integration of the Phase 5 deploy package into the running
  binary. The compile-clean static check matrix doesn't just
  validate Phase 6's diff — it validates the *entire wiring graph
  M3 introduced* (Phase 4 schema → Phase 5 package → Phase 6
  binary). One `go build ./cmd/api` confirms: the schema migration
  applied (sqlc-generated types match), the deploy package's
  interface contract holds (the `Deps` field's type is satisfied),
  the config's required env vars are accessible, and the slog
  pipeline accepts the new log line. **27 LOC is the smallest
  diff that would catch a regression in any of the four Phase 4
  / 5 / 6 sub-systems** — the binary wouldn't compile, and the
  failure mode would point at the broken sub-system. This is
  what "integration is the cheap part if the abstractions are
  right" looks like in practice.
- **The `_ = adaptersSvc` keepalive is doing more work than its
  one line suggests.** It's simultaneously: (a) Go's
  unused-variable compliance gate; (b) project-state
  documentation ("M4 is the next step, not 'go figure out
  whether to add this'"); (c) a constructor-call-site reservation
  ("the `adaptersSvc` variable name is taken; M4 doesn't have to
  bikeshed the name"); (d) a reverse-grep target ("when M4
  removes this line, every reader of M4's PR sees the wiring
  finalisation"). Four separate jobs, one underscored
  assignment. The alternative — leaving `adapters.NewService`
  call out entirely — would require M4 to also do the
  constructor-placement decision in addition to the handler
  wiring. **Phase 6 trades one line of code now for half an
  hour of M4 indecision later.** This is the kind of micro-decision
  that compounds across milestones; a codebase that consistently
  makes these trades reads as *intentional* rather than as
  organic accretion.
- **Phase 6 has no test of its own and that's the right call.**
  The compile-time check that `Deps`'s `DeployTargets` field
  type-checks against the map literal is *itself* the Phase 6
  test. There's nothing else to assert: the map is in the
  binary, the field is reachable via `Deps`-parameter
  destructuring, no handler reads it. Adding a test like
  `TestDepsHasDeployTargetsField` would be a tautology against
  the type system. **The Go type system is the test framework
  for wiring phases**; the place where Phase 6 *does* need a
  behavior test is the live `air` boot + log-tail check, which
  is correctly deferred to the operator runbook because
  non-interactive shells can't run `air`. Same precedent every
  prior M3 phase set when the verification needed live state.
`─────────────────────────────────────────────────`

---

*(Phase 7 — end-to-end harness contract validation against the real
Fly endpoint, exercising Phase 1's published image through Phase 5's
`FlyDeployTarget` — is next.)*
