# Completion — Deploy Target Resolver Phase 2: `Resolver` interface + `StaticResolver` impl (2026-04-26)

**Plan:** `docs/executing/deploy-target-resolver.md` §Phase 2
**Status:** Phase 2 landed; Phases 3–5 pending.
**Predecessors:**
- `docs/completions/deploy-target-resolver-phase-1.md` (Phase 1 — `FlyCredentials` struct + constructor swap; this phase has zero coupling to it but inherits its green static-check baseline).
- `docs/completions/hermes-adapter-and-fly-wiring-phase-{1..8}.md` (M3 — established the `internal/deploy/` package and the kind-keyed registry shape this resolver wraps).

This document records the *as-built* state of M3.5 Phase 2. The change introduces one new file (`internal/deploy/resolver.go`) defining the `Resolver` interface, the `StaticResolver` implementation, and the `ErrTargetNotConfigured` sentinel — plus two test cases co-located in `target_test.go`. Behavior is byte-identical to the M3 baseline because no handler consumes the resolver yet; Phase 3 wires it through `httpsrv.Deps`.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `backend/internal/deploy/resolver.go` | new | +63 LOC | New file. `ErrTargetNotConfigured` sentinel, `Resolver` interface (single method `For(ctx, kind)`), `StaticResolver` struct + `NewStaticResolver` constructor + `For` method, compile-time assertion `var _ Resolver = (*StaticResolver)(nil)` at the bottom. Doc comments cite plan §2 decisions 1, 2, 3 by name. |
| `backend/internal/deploy/target_test.go` | edit | +25 / -1 | New imports (`context`, `errors`); two new test functions (`TestStaticResolver_KindRegistered`, `TestStaticResolver_KindUnregistered`) inserted immediately above `TestParseExternalRef`. Uses `LocalDeployTarget` as the registered fixture rather than introducing a new fake. |

No new files beyond `resolver.go`, no schema, no proto, no domain-package edits, no frontend, no callers updated. The deploy package's test count moved from 24 → 26 sub-tests; all 26 pass at `0.325s`.

---

## Index

- **Phase 2 has zero coupling to Phase 1.** Phase 1 changed `NewFlyDeployTarget`'s signature; Phase 2 doesn't construct a `FlyDeployTarget` and doesn't read `FlyCredentials`. The two phases are siblings under the plan's overall objective, executed sequentially for bisection cleanliness rather than because of a structural ordering constraint. **Phase 2 could in principle have landed before Phase 1**, but the linear order matches M3's pattern of one independently-bisectable commit per phase.
- **`Resolver` is a single-method interface — `For(ctx context.Context, kind string) (DeployTarget, error)`.** Mirrors the existing `map[string]DeployTarget` lookup shape exactly so M4's spawn handler reads `resolver.For(ctx, kind)` instead of `deps.DeployTargets[kind]` — same mental model, one extra layer. Per plan decision 1: ctx is included even though `StaticResolver` ignores it; `DBResolver` will need it for the row fetch + decryption call in v1.5. **Single-method interfaces are the cheapest possible implementation surface and the easiest possible test fake** — `map[string]DeployTarget{"fly": &fakeTarget{}}` wrapped in `NewStaticResolver` is a one-line test setup.
- **`ErrTargetNotConfigured` is deliberately distinct from `ErrNotImplemented`** (plan decision 3). Same package, two sentinels, two semantics: `ErrNotImplemented` (in `target.go`) means "this target type exists as a stub but its methods aren't built" (per blueprint §11.4 — `LocalDeployTarget`, `AWSDeployTarget`); `ErrTargetNotConfigured` (in `resolver.go`) means "the resolver has no entry for this kind." **Different operator failures, different M4 spawn-handler responses.** Conflating them would give the spawn handler one ambiguous error to log and react to. Documented in the doc comment at the declaration site so the distinction is visible at the grep hit.
- **`StaticResolver` is "today-implementation" — byte-identical behavior to the pre-resolver registry.** The struct holds the same `map[string]DeployTarget` the M3 boot code already builds; `For` is a single map lookup with a sentinel on miss. **No env-var reading, no construction logic, no caching** — those are all delegated to the boot site (`cmd/api/main.go` in Phase 3). Per plan decision 7, the constructor accepts the map as a parameter, keeping the resolver decoupled from how the map was built.
- **The compile-time assertion `var _ Resolver = (*StaticResolver)(nil)` lives in `resolver.go` itself**, not in the test file. **This is a deliberate departure from the `target_test.go` pattern** (which holds the three `var _ DeployTarget = (*X)(nil)` assertions). Reasoning: the assertion belongs anywhere in the package and the production file is fine; the test-file location for the `DeployTarget` assertions was a historical accident from M3 Phase 5, not load-bearing. **Both placements satisfy the same compile-time contract**; the in-source location keeps the contract pin co-located with the type that has to satisfy it. Future cleanup item (not in scope for Phase 2): consider migrating the three `target_test.go` assertions into `target.go` itself for consistency.
- **The two test cases use `errors.Is`, not equality, against `ErrTargetNotConfigured`.** Writing `if err != ErrTargetNotConfigured` would pass today (the sentinel is returned bare), but `errors.Is` survives a future refactor where `For` wraps the sentinel via `fmt.Errorf("...%w", ErrTargetNotConfigured)` to add a kind string to the message. **The test pins the contract (sentinel is reachable via `errors.Is`), not the current implementation (sentinel is returned bare).** Same pattern the M3 domain services use for redacted-error returns.
- **`TestStaticResolver_KindRegistered` checks pointer identity, not just non-nil return.** `if got != want` where both sides are the same `*LocalDeployTarget` value confirms the resolver returns the *exact instance* registered, not some wrapped or copied version. The wrapping isn't possible today (the body is a one-line map index) but the test pins the contract that callers can rely on instance equality — load-bearing for any future code that wants to distinguish "is this the singleton fly target" from "is this some fly target."
- **`LocalDeployTarget` reused as the registered-target fixture** rather than introducing a new test-only fake. `LocalDeployTarget` already implements `DeployTarget` in the same package; its `ErrNotImplemented` returns are irrelevant because `For` doesn't call any of its methods. **Reusing the stub keeps the test file dependency-free of new types** — no `fakeTarget struct{}` declaration, no new method bodies, no scope creep into "what does a minimum DeployTarget need to look like."

---

## Verification matrix (Phase 2 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./...` clean | ☑ | Empty output. |
| `go build ./...` clean | ☑ | Empty output. Both binaries (`cmd/api`, `cmd/smoke-deploy`) implicitly build via `./...`. |
| `go test ./internal/deploy/...` clean | ☑ | `ok ... 0.325s`; 24 existing sub-tests + 2 new sub-tests = 26 PASS, 0 FAIL. |
| Two new test cases visible in verbose output | ☑ | `TestStaticResolver_KindRegistered` PASS, `TestStaticResolver_KindUnregistered` PASS. |
| `Resolver` interface exported and consumable from outside the package | ☑ | All four names (`Resolver`, `StaticResolver`, `NewStaticResolver`, `ErrTargetNotConfigured`) are capitalized. Phase 3 will exercise the cross-package consumption from `internal/httpsrv/`. |
| Compile-time assertion present | ☑ | `internal/deploy/resolver.go:63`: `var _ Resolver = (*StaticResolver)(nil)`. |
| Sentinel reachable via `errors.Is` | ☑ | `TestStaticResolver_KindUnregistered` asserts `errors.Is(err, ErrTargetNotConfigured)` rather than `==`. Future wrapping via `%w` won't break the test. |
| No behavior change observable from outside the package | ☑ (by inspection) | Phase 2 added one file + two tests; no caller imports `Resolver` yet. The runtime smoke (`cmd/smoke-deploy` against real Fly) is unchanged because `cmd/smoke-deploy` doesn't go through the resolver. |

Net: 8/8 satisfied at the resolution this phase is responsible for.

---

## Decisions made under-the-hood (not in the plan)

- **Compile-time assertion in `resolver.go`, not `target_test.go`.** Plan §Phase 2 step 2 said "matches the pattern already in `target_test.go`" — interpreted as "use the same compile-time-assertion *technique*," not "put it in the same file." The in-source location keeps the assertion next to the type it constrains; the test-file location for the existing `DeployTarget` assertions was historical. Both satisfy the same compile-time check. Flagged in §Index above as a candidate cleanup for later.
- **`LocalDeployTarget` as the registered-target fixture.** Plan didn't prescribe what the registered target should be in `TestStaticResolver_KindRegistered`. Options were: (a) introduce a `fakeTarget struct{}` test-only type, (b) reuse one of the existing stubs (`LocalDeployTarget` / `AWSDeployTarget`), (c) construct a real `*FlyDeployTarget` (would have required a Fly token in test scope — rejected). Picked (b) because the resolver's `For` doesn't call any method on the returned target — its job ends at "give me back what I registered," so any `DeployTarget` value works. **Reuse beats introduction** for a two-case test where the fixture is irrelevant to the assertion.
- **Doc comment on `Resolver` cites plan §2 decision 2 by name.** Same comment-as-breadcrumb pattern Phase 1 established for `FlyCredentials`. A future reader chasing "why is this a single-method interface that ignores ctx in StaticResolver but accepts it anyway?" lands on the answer (DBResolver in v1.5 will need ctx for the DB call) in one hop. Comment-as-breadcrumb beats comment-as-tautology.
- **`*StaticResolver` returns `*StaticResolver`, not `Resolver`, from its constructor.** Go-idiomatic ("accept interfaces, return structs") and matches the M3 pattern (`NewLocalDeployTarget()` returns `*LocalDeployTarget`, etc.). Test code can reach into struct internals without a type assertion if needed; the compile-time assertion at the bottom of `resolver.go` enforces interface conformance regardless of the return type. **Convention over indirection** — the assertion is the load-bearing check, not the return type.
- **Two-case test, not one merged table-driven test.** The two cases (registered vs. unregistered) have different shapes — one checks pointer identity + nil error, the other checks `errors.Is` + nil result. A merged table would either lose the pointer-identity assertion (not all rows have a registered target to compare against) or carry awkward nullable fields. Two flat test functions are cleaner at this scale; promotion to a table-driven form would only make sense if the test count grew past 4–5. Matches the M3 codebase's "table-driven for branching logic, flat for distinct shapes" convention.

---

## What this means for Phase 3

Phase 3 narrows `httpsrv.Deps.DeployTargets` from `map[string]deploy.DeployTarget` → `deploy.Resolver`. The Phase 2 → Phase 3 coupling is purely consumer-side:

1. **The `Resolver` interface, `StaticResolver` type, and `NewStaticResolver` constructor are all in scope** for Phase 3's `cmd/api/main.go` edit. Phase 3 adds one line — `deployResolver := deploy.NewStaticResolver(deployTargets)` — between the existing map construction and the `httpsrv.New(...)` call.
2. **The `httpsrv.Deps` field type change is a single-line diff.** Field name (`DeployTargets`) and ordering (between `AgentsHandler` and `AllowedOrigin`) preserved per plan decision 8; only the type narrows.
3. **Pre-work step 3's grep (`grep -rn 'DeployTargets\[' backend/internal/httpsrv/` → zero hits) was confirmed clean during Phase 2's pre-work.** Phase 3 inherits a verified consumer-free state — no handler updates needed.

What Phase 3 *does not* inherit from Phase 2: any new test file, any new domain-package surface, any new env-var read. Phase 3 is purely wiring.

---

## Pre-work tasks status

The plan's §3 pre-work checklist (re-verified at Phase 2 start):

- ☑ **M3 has merged** (or rebased against). M3 + Phase 8 hardening + Phase 1 are in the working tree; Phase 2 executes against that baseline.
- ☑ **No second `NewFlyDeployTarget` caller has crept in beyond Phase 1's three.** `grep -rn 'NewFlyDeployTarget' backend/` returns the expected three hits (definition + `cmd/api/main.go:50` + `cmd/smoke-deploy/main.go:49`), all using the post-Phase-1 struct-literal form. Phase 2 does not touch any of them.
- ☑ **No handler reads `deps.DeployTargets` directly yet.** `grep -rn 'DeployTargets\[' backend/` returns zero hits. M3's "wire the field, don't consume it" discipline + Phase 1's no-consumer baseline both hold; Phase 3's field-type narrowing is structurally safe.

---

## Risks / open issues opened by Phase 2

- **A future contributor may "simplify" the resolver back to a raw map by deleting the indirection.** The doc comments on `Resolver` and `StaticResolver` cite the plan and v1.5 widening intent; the Phase 1 + Phase 2 completion docs record the rationale. If a "simplification" PR shows up, the reviewer has three artefacts to point at. **The indirection's purpose becomes self-evident the moment `DBResolver` lands in v1.5** — until then, the breadcrumb trail is the defense.
- **The compile-time assertion in `resolver.go` and the three in `target_test.go` are stylistically inconsistent.** Same compile-time effect, different locations. Not a defect today; flagged as a candidate for unification when next touching either file. Trivial cleanup if/when it matters.
- **No automated test exercises `For` with a nil map.** `NewStaticResolver(nil)` would produce a `*StaticResolver` whose `For` returns `ErrTargetNotConfigured` for any kind (Go's nil-map read is well-defined for reads). The behavior is correct but not pinned by a test. **Not in scope for Phase 2** — the constructor's contract today is "pass the map you built"; if a future refactor changes that, the test would be added then.
- **`Resolver` interface widening risk.** Plan decision 2 explicitly anticipates v1.5 widening the interface (e.g. `ForTarget(ctx, id uuid.UUID)`) or replacing it. Either is cheap from today's baseline; the risk is that Phase 3's `httpsrv.Deps.DeployTargets deploy.Resolver` field becomes the wrong shape. **Mitigation: today's two callers (`cmd/api/main.go` and the M4 spawn handler) are the only places that depend on the interface shape**; widening or replacement is a 2-callsite refactor, not an N-callsite refactor.

---

## What's still uncommitted

Phase 2 produces a two-file diff in the repo:

- `backend/internal/deploy/resolver.go` (new; +63 LOC)
- `backend/internal/deploy/target_test.go` (edit; +25 / -1)

Net: +88 / -1 across two files. Untracked / unstaged, joining the M3 + Phase 1 working tree.

**Phase 2 is even more reversible than Phase 1.** Phase 1 broke a constructor signature (compile-time observable across two files); Phase 2 adds one new file + an additive test extension (no existing call site changed). A `git checkout backend/internal/deploy/target_test.go && rm backend/internal/deploy/resolver.go` reverts the whole phase in one shell command, no compile errors at intermediate states.

---

`★ Insight ─────────────────────────────────────`
- **Phase 2 is the cheapest possible "introduce indirection without breaking anything" cadence.** Define the abstraction (interface), write the today-implementation (`StaticResolver`), test it in isolation — no consumer, no caller, no wiring. Phase 3 then points the existing wiring at the new abstraction in a single field-type narrowing. **This is the right ordering** because it means each phase has a single responsibility: Phase 2 introduces the type, Phase 3 introduces the consumer. Bisection on a regression in either phase isolates the cause to one file's worth of change.
- **The single-method `Resolver` interface is the load-bearing design choice for v1.5 cheapness.** A two-method interface (`For` + `List`) would be more "complete" today but would lock in a contract `DBResolver` may not want to honor (e.g. `List` over a paginated DB result has a different shape than `List` over an in-memory map). **Restricting today's interface to exactly what M4's spawn handler will consume** keeps the v1.5 swap costless — `DBResolver` only has to implement what the codebase already calls. CLAUDE.md's "don't design for hypothetical future requirements" applied at the interface-design level.
- **The `ErrTargetNotConfigured` vs. `ErrNotImplemented` split is the kind of decision that quietly compounds.** Today both errors would produce a 500 from the spawn handler and the user would see "spawn failed." Tomorrow when the M4 plan introduces its own error mapping (probably "configuration error → 503 with operator-fix message" vs. "not-yet-built → 501 with feature-flag message"), the two sentinels feed two different code paths cleanly. **The plan's decision 3 paid for itself before the M4 plan was even drafted** — the operator-failure-mode distinction was the actual underlying decision; the two sentinels are the structural encoding of it.
`─────────────────────────────────────────────────`

---

*(Phase 3 — `httpsrv.Deps.DeployTargets` field type narrowing + `cmd/api/main.go` resolver wiring — is next.)*
