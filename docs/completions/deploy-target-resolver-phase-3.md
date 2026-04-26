# Completion — Deploy Target Resolver Phase 3: `httpsrv.Deps` field narrowing + `cmd/api` wiring (2026-04-26)

**Plan:** `docs/executing/deploy-target-resolver.md` §Phase 3
**Status:** Phase 3 landed; Phases 4–5 pending.
**Predecessors:**
- `docs/completions/deploy-target-resolver-phase-2.md` (Phase 2 — `Resolver` interface + `StaticResolver` impl + `ErrTargetNotConfigured` sentinel; this phase is the first consumer of all three).
- `docs/completions/deploy-target-resolver-phase-1.md` (Phase 1 — `FlyCredentials` + constructor swap; the `cmd/api/main.go` map construction Phase 3 wraps was last touched in Phase 1).

This document records the *as-built* state of M3.5 Phase 3. The change is the smallest possible "consumer adopts the new abstraction" cadence: narrow one `httpsrv.Deps` field type, add one `NewStaticResolver` line in `cmd/api/main.go`, swap one identifier in the `httpsrv.New(...)` argument. Behavior is byte-identical to the M3 baseline because no handler reads `deps.DeployTargets` yet — the field is now a `Resolver` instead of a `map`, but its single reader (M4's spawn handler, not yet written) inherits a field that's already shaped exactly the way M4 will want to consume it.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `backend/internal/httpsrv/server.go` | edit | +1 / -1 | `DeployTargets map[string]deploy.DeployTarget` → `DeployTargets deploy.Resolver`. Field name + ordering preserved per plan decision 8. The `deploy` package import already exists (M3 Phase 6 added it); no new imports needed. |
| `backend/cmd/api/main.go` | edit | +1 / -1 | One new line `deployResolver := deploy.NewStaticResolver(deployTargets)` between the `slog.Info("deploy targets initialised", ...)` call and `httpsrv.New(...)`. The `httpsrv.Deps{...}` literal swaps `DeployTargets: deployTargets` → `DeployTargets: deployResolver`. The `slog.Info` line keeps reading from the *map*, not the resolver, per plan §Phase 3 step 3. |

No new files, no schema, no proto, no tests. The deploy package's 26-test count is unchanged. Phase 3's verification rests on the compiler — the field-type narrowing would have produced a directed build failure on any handler that reached into `deps.DeployTargets[kind]`, and zero such failures appeared because Phase 2's pre-work grep had already verified zero handlers consume the field today.

---

## Index

- **Phase 3 is purely a consumer-side adoption.** Phase 2 introduced the `Resolver` interface, `StaticResolver` impl, and `ErrTargetNotConfigured` sentinel — all unconsumed. Phase 3 makes the *field* that M4 will read live as a `Resolver` instead of a `map`. **The field's job in M3 was to be reachable from `New(d Deps)`** (M3 Phase 6's deliverable); Phase 3's job is to make that reachability go through the resolver layer instead of the bare map. Same field, narrower type, zero consumer impact today because zero consumers exist.
- **The `slog.Info("deploy targets initialised", ...)` line still reads from the map, not the resolver** (plan §Phase 3 step 3). Two reasons: (a) the runbook contract from M3 Phase 8 (`kinds=aws,fly,local` deterministic order via `sort.Strings(keysOf(deployTargets))`) keeps working unchanged because `keysOf` operates on the map; (b) the resolver doesn't expose a `List`/`Kinds` method by design (plan decision 1 — single-method interface), so reading kinds via the resolver would either require a new method (premature) or a type assertion (anti-pattern). **The map outlives its registry role only so the boot log can introspect it** — a deliberate carve-out, not a smell.
- **The boot wiring lands in three lines, in order:** map construction (existing), `slog.Info` from the map (existing), `deployResolver := deploy.NewStaticResolver(deployTargets)` (new). The new line sits *after* the slog so the log line still describes the map the resolver is about to wrap, not the wrapped resolver itself. **Reading the boot sequence top-to-bottom:** "build map → log map's contents → wrap map in resolver → pass resolver to handlers." The narrative reads naturally because each line's subject is the previous line's object.
- **The field-type narrowing is a single-line diff in `server.go`'s `Deps` struct definition** (`map[string]deploy.DeployTarget` → `deploy.Resolver`). Both names already in scope from the existing `deploy` import. **No handler updates needed because no handler reads the field yet** — M3 Phase 6's "wire the field, don't consume it" discipline + Phase 2's pre-work grep confirmation are what make this a 1-line change instead of an N-handler refactor. The plan's risk register §5 anticipated the consumer-discovery scenario (zero hits today; if a handler had grown a coupling, Phase 3 would expand to update it). Discipline paid for itself.
- **`grep -rn 'NewFlyDeployTarget\|NewStaticResolver\|deployTargets' backend/cmd/api/` shows the boot sequence is now 5 lines of deploy-related wiring**: 3 stub/concrete-target constructors, 1 map construction, 1 resolver construction. Each line has exactly one job. **The map is the bookkeeping seam between the three target constructors and the resolver** — it's the smallest data structure that gives the resolver a uniform input shape regardless of how many concrete targets the boot code constructed. Pre-Phase-3 it was the production data structure; post-Phase-3 it's a transient scaffold.
- **`*StaticResolver` satisfies the `deploy.Resolver` interface implicitly** — Go's structural typing means `httpsrv.Deps.DeployTargets deploy.Resolver` accepts a `*StaticResolver` value with no explicit conversion at the call site. The compile-time assertion `var _ Resolver = (*StaticResolver)(nil)` in `resolver.go` is what guarantees this works; remove the assertion and a future signature drift on `For` would surface only at the `httpsrv.Deps` literal site. **The assertion is the load-bearing pin for Phase 3's wiring, not just Phase 2's tests.**
- **`go test ./internal/deploy/...` re-ran (`0.169s`, not cached)** because `cmd/api/main.go` and `httpsrv/server.go` changed and Go's test cache invalidates on transitive dependency-graph mutations. All 26 sub-tests passed unchanged. **The cache invalidation is itself a positive signal**: the test runner correctly detected that a downstream consumer's change might affect the package, re-verified it doesn't, and got out of the way. `internal/agents` and `internal/users` both cached at their pre-Phase-3 baselines — confirming Phase 3 didn't accidentally pull either into the change graph.

---

## Verification matrix (Phase 3 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./...` clean | ☑ | Empty output. |
| `go build ./...` clean | ☑ | Empty output. Both binaries (`cmd/api`, `cmd/smoke-deploy`) compile. |
| `go test ./...` whole-tree clean | ☑ | `internal/deploy` re-ran (`0.169s`) — 26 sub-tests all PASS. `internal/agents` + `internal/users` cached at their respective baselines. No package broke. |
| `httpsrv.Deps.DeployTargets` field is `deploy.Resolver` | ☑ | `internal/httpsrv/server.go:21`: `DeployTargets        deploy.Resolver`. Field name + position preserved between `AgentsHandler` and `AllowedOrigin`. |
| `cmd/api/main.go` constructs the resolver and passes it through | ☑ | New line `deployResolver := deploy.NewStaticResolver(deployTargets)` between the boot log and `httpsrv.New(...)`; the `httpsrv.Deps` literal passes `DeployTargets: deployResolver`. |
| `slog.Info("deploy targets initialised", "kinds", "aws,fly,local", ...)` log line preserved | ☑ (by static reasoning) | Source unchanged at the slog site; `keysOf(deployTargets)` still operates on the map; M3 Phase 8's `sort.Strings(out)` still produces the alphabetical `aws,fly,local` runbook value. |
| No handler updates needed | ☑ | `grep -rn 'DeployTargets\[' backend/internal/httpsrv/` returns zero hits — same as Phase 2's pre-work confirmed. M3's "wire the field, don't consume it" discipline held through Phase 3. |
| No behavior change observable from outside | ☑ (by inspection) | Only callsite of `deps.DeployTargets` is the `httpsrv.Deps` literal in main.go, which simply passes the resolver through. No HTTP route reads the field; no domain service reads the field. The runtime smoke (`cmd/smoke-deploy`) doesn't go through the resolver. |

Net: 8/8 satisfied at the resolution this phase is responsible for. The runtime boot smoke (`cd backend && air`) is operator-side and inherits the same deferred-to-runbook status the M3 phases established.

---

## Decisions made under-the-hood (not in the plan)

- **`deployResolver` lives *after* the `slog.Info` boot log, not before it.** Plan §Phase 3 step 2 said "after the existing map construction"; ordering relative to the slog line wasn't prescribed. Picked post-slog because: (a) the slog describes the map the resolver wraps, so reading top-to-bottom narrates the construction in cause-then-effect order; (b) if the slog line ever grew to log resolver-derived facts (it shouldn't, per the resolver's intentional list-free interface), the placement makes the dependency direction visually obvious; (c) `deployResolver` has exactly one consumer (the `httpsrv.New` call) so colocation with that call is fine. **Ordering trivia, but trivia that compounds across re-reads.**
- **No `// TODO(v1.5):` comment added at the resolver-wrapping line.** The plan reserves the v1.5 retirement breadcrumb for `config.go`'s `FlyAPIToken`/`FlyOrgSlug` annotation (Phase 4's deliverable). Adding a parallel TODO at the wrapping site would: (a) duplicate the breadcrumb, (b) suggest the resolver itself is provisional (it isn't — `StaticResolver` swaps for `DBResolver`, but the *wrapping pattern* persists), (c) age confusingly when v1.5 only deletes the env-var bootstrap, not the wrapping line. **One canonical breadcrumb in `config.go` is the better single source of truth than scattered TODOs across multiple files.**
- **No defensive nil-check on `deployTargets` before `NewStaticResolver(deployTargets)`.** The map is unconditionally constructed three lines above with three guaranteed entries (fly + local + aws); a nil case is structurally impossible at this call site. Adding a nil-check would be CLAUDE.md-flagged "validation for scenarios that can't happen" — the boot sequence is the system boundary and validates inputs at higher levels (`config.Load()` panics on missing env vars; `NewFlyDeployTarget` returns an error caught two lines above). The map's existence is invariant by the time the resolver wraps it.
- **The new `deployResolver` variable name uses the same `XxxResolver` suffix the type uses**, paralleling existing `flyTarget`/`localTarget`/`awsTarget` (each named after its type's `Xxx` prefix). Three-letter abbreviations (`res`, `dr`) would collide visually with `err` and `db` at the call site; the typed name makes "what is this thing" obvious from one identifier away. **Naming convention pulled from the file's existing variables**, not from a foreign convention.
- **No keepalive `_ = deployResolver` ceremony.** `deployResolver` is consumed two lines below at the `httpsrv.Deps` literal; the compiler is satisfied without ceremony. **CLAUDE.md's "delete unused code completely, don't keepalive" rule is honored at write time** — same posture M3 Phase 8 enforced when it deleted Phase 6's `_ = adaptersSvc` keepalive.

---

## What this means for Phase 4 + Phase 5

**Phase 4** (`config.go` annotation) has zero coupling to Phase 3. Phase 4 adds a 6-line block comment above `FlyAPIToken`/`FlyOrgSlug` with a `// TODO(v1.5):` breadcrumb pointing at the eventual env-var retirement. No code change. Phase 4 inherits from Phase 3:

1. **A field that's already a `deploy.Resolver`**, so the v1.5 swap (`StaticResolver` → `DBResolver`) is a 1-line type swap at the `cmd/api/main.go:deployResolver := deploy.NewStaticResolver(...)` line — `deps.DeployTargets`'s type already accepts whatever satisfies `Resolver`.
2. **A boot sequence whose env-var consumption is concentrated at exactly two lines** (`cfg.FlyAPIToken`, `cfg.FlyOrgSlug` inside `deploy.FlyCredentials{...}`). When Phase 4's `// TODO(v1.5)` breadcrumb fires, the v1.5 PR knows exactly which lines to delete — both of them are at `cmd/api/main.go:50-53`.

**Phase 5** (validation matrix + changelog) has minor coupling to Phase 3 in the form of a runbook check: `cd backend && air` should boot successfully and log `kinds=aws,fly,local` exactly as before. Phase 3's `slog.Info` preservation makes this a non-event; the runbook line stays valid across the resolver introduction.

---

## Pre-work tasks status

The plan's §3 pre-work checklist (re-verified at Phase 3 start, since M4 work or unrelated changes could have crept in between Phase 2 and Phase 3):

- ☑ **No handler reads `deps.DeployTargets` directly.** `grep -rn 'DeployTargets\[' backend/internal/httpsrv/` returns zero hits at Phase 3's start (re-confirmed mid-execution after the field-type narrowing). M3's "wire the field, don't consume it" discipline held through Phases 1, 2, and 3.
- ☑ **No second `NewFlyDeployTarget` caller has crept in beyond Phase 1's three.** The three callers (definition + `cmd/api/main.go` + `cmd/smoke-deploy/main.go`) all use the post-Phase-1 struct-literal form; Phase 3 doesn't touch any of them.
- ☑ **M3 + Phase 1 + Phase 2 have not been reverted.** All three are in the working tree alongside Phase 3's edits.

---

## Risks / open issues opened by Phase 3

- **The `httpsrv.Deps.DeployTargets` field type narrowing is irreversible at zero cost only because no handler consumes it yet.** Once M4's spawn handler reads `deps.DeployTargets.For(ctx, kind)`, reverting to a raw map shape would require updating that handler too. **The window of cheap reversibility closes when M4 lands** — if Phase 3's design choice ever needs revisiting, M4's plan is the latest opportunity.
- **A future contributor could re-introduce direct map indexing by adding a method to `*StaticResolver` that returns the underlying map.** This would defeat the indirection's purpose: M4 handlers could grow `deps.DeployTargets.RawMap()["fly"]` callsites, which would re-couple them to the today-implementation. **Mitigation: the `Resolver` interface deliberately doesn't expose `RawMap` / `Kinds` / `List` / etc.; adding such methods to `*StaticResolver` (the concrete type) wouldn't widen the interface but would make the indirection escape-hatch-able.** The risk is contained because Go's structural typing requires callers to type-assert `deps.DeployTargets.(*StaticResolver)` to reach struct-private surfaces — visible in code review.
- **No automated test exercises the boot-time wiring** (`cmd/api/main.go`'s resolver construction). Phase 3's verification rests on the compiler (signature mismatch would have failed `go build`) and the existing 26 sub-tests (none of which construct an `httpsrv.Deps` literal, but `httpsrv.Deps.DeployTargets` is a field access that the build-time type checker validates exhaustively). **The runtime smoke (`cd backend && air` boot success + log line check) is the integration test for the boot sequence**, deferred to the Phase 5 runbook check.
- **The `slog.Info` log line's reliance on `keysOf(deployTargets)` (the map, not the resolver) means a future refactor that deletes the `deployTargets` local variable in favor of constructing the resolver inline would silently break the log line.** Mitigation: the `slog.Info` line is upstream of `NewStaticResolver` in the source order, so the variable's continued existence is a precondition for the log call. A code-review heuristic: "if you delete `deployTargets`, also rewrite the slog line."

---

## What's still uncommitted

Phase 3 produces a two-file diff:

- `backend/internal/httpsrv/server.go` (edit; +1 / -1)
- `backend/cmd/api/main.go` (edit; +1 / -1)

Net: +2 / -2 across two files. **The smallest meaningful diff in the resolver plan to date.** Phase 1 was +20/-5 (constructor break + 2 callers); Phase 2 was +88/-1 (new file + tests); Phase 3 is +2/-2 (consumer adoption). The downward trend reflects each phase's narrowing role: Phase 1 designed the credential surface, Phase 2 designed the resolver surface, Phase 3 wires Phase 2 into the existing consumer slot.

Untracked / unstaged, joining the M3 + Phase 1 + Phase 2 working tree.

A `git checkout backend/internal/httpsrv/server.go backend/cmd/api/main.go` reverts Phase 3 in one command — **even more reversible than Phase 2's "delete one new file + revert one edit."**

---

`★ Insight ─────────────────────────────────────`
- **Phase 3's diff size (+2 / -2) is the load-bearing evidence that Phases 1 and 2 paid for themselves.** Each previous phase's job was to make Phase 3 possible at this size: Phase 1's `FlyCredentials` struct meant the resolver could wrap the map without touching the constructor; Phase 2's `Resolver` interface + `StaticResolver` impl meant Phase 3 had a type to swap to. **A 2-line diff is structurally impossible without the prerequisites being in place.** Conversely, if Phase 3 had been larger than this, one of the previous phases would have been doing less than its job. The bisection-clean phase split is what makes the diff sizes monotonically decrease — each phase delivers a smaller increment of structural change because the previous phase did its piece.
- **The `slog.Info` carve-out (still reads the map, not the resolver) is a deliberate non-orthogonality that's worth its weight.** Strict adherence to "the map is dead post-Phase-3" would force either adding `Kinds()` / `List()` to the `Resolver` interface (premature widening) or losing the deterministic boot log (operator regression). Keeping the map as a transient scaffold for the slog line costs one extra local variable lifetime; gaining it loses no architectural property because the resolver doesn't *need* a list method to do its job. **Premature interface widening for a single boot-time observability call would be the worse trade.**
- **`*StaticResolver` satisfies `deploy.Resolver` implicitly via Go's structural typing — no `implements` keyword, no explicit cast in `cmd/api/main.go`.** The compile-time assertion in `resolver.go` (`var _ Resolver = (*StaticResolver)(nil)`) is what catches a future signature drift on `For` *before* it surfaces at the `httpsrv.Deps` literal site in main.go. **The test-file assertion + the resolver-file assertion + the main.go callsite form a three-point pin** on the `Resolver`/`StaticResolver` contract: any one of them would catch a contract violation, and having all three means the directed build failure lands at the most useful diagnostic location depending on what changed. Defense-in-depth at zero runtime cost.
`─────────────────────────────────────────────────`

---

*(Phase 4 — `config.go` block-comment annotation marking `FlyAPIToken`/`FlyOrgSlug` as bootstrap state with `// TODO(v1.5):` breadcrumb — is next.)*
