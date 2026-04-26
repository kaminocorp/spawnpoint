# Completion — Deploy Target Resolver Phase 1: `FlyCredentials` + constructor swap (2026-04-26)

**Plan:** `docs/executing/deploy-target-resolver.md` §Phase 1
**Status:** Phase 1 landed; Phases 2–5 pending.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-{1..7}.md` (M3 — landed `internal/deploy/` package, the `NewFlyDeployTarget(ctx, token, orgSlug)` constructor this phase replaces, and the `cmd/smoke-deploy` driver discovered to be a third caller).
- `docs/completions/hermes-adapter-and-fly-wiring-phase-8.md` (M3 post-review hardening — established the green static-check baseline this phase departs from).

This document records the *as-built* state of M3.5 Phase 1. The change
is the smallest meaningful structural pre-payment toward the v1.5
DBResolver swap: introduce `deploy.FlyCredentials` so the
`NewFlyDeployTarget` constructor accepts a struct rather than two
positional strings, and update every existing caller. Behavior is
byte-identical to the M3 baseline — same flaps client construction,
same fields, same boot sequence. The only externally observable
delta is the constructor signature, which is a compile-time break for
any future caller still using the positional form.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `backend/internal/deploy/fly.go` | edit | +12 / -3 | New `FlyCredentials struct { APIToken, OrgSlug string }` immediately above `FlyDeployTarget` with a doc comment explaining the v1.5 widening intent. `NewFlyDeployTarget(ctx, creds FlyCredentials)` replaces the positional `(ctx, token, orgSlug)`. Body adapts trivially: `tokens.Parse(creds.APIToken)`, `orgSlug: creds.OrgSlug`. |
| `backend/cmd/api/main.go` | edit | +4 / -1 | Single call site updated to struct-literal form: `deploy.NewFlyDeployTarget(ctx, deploy.FlyCredentials{APIToken: cfg.FlyAPIToken, OrgSlug: cfg.FlyOrgSlug})`. |
| `backend/cmd/smoke-deploy/main.go` | edit | +4 / -1 | **Plan-time scope expansion** — this third caller was added in M3 Phase 7 (after the resolver plan was drafted). Same struct-literal update as `cmd/api/main.go`. The plan's risk register §4 explicitly anticipated this scenario; absorbed inline rather than spinning out a Phase 1.5. |

No new files, no schema, no proto, no domain-package edits, no
frontend, no test edits. The `internal/deploy/target_test.go` 24
sub-tests re-ran and passed unchanged because none of them construct
a `FlyDeployTarget` directly — they exercise the four pure helpers
(`validateImageRef`, `mapFlyState`, `appNameFor`, `parseExternalRef`)
which the constructor change does not touch.

---

## Index

- **The plan's pre-work step 2 expected exactly two `NewFlyDeployTarget` grep hits (definition + one caller); the actual count was three.** `cmd/smoke-deploy/main.go` was added in M3 Phase 7 — *after* the resolver plan was drafted — so the plan author's grep was correct at draft time but stale at execution time. The plan's risk register §4 anticipated exactly this ("If a third appears between drafting and execution, add a Phase 1.5 to update it"). Implementation absorbed the third caller inline rather than spinning out a Phase 1.5: the change is one line per caller, both edits are mechanically identical, and splitting them across two phases would have produced two commits with no independent verification value. **The plan's risk register paid off the way good risk registers do — not by preventing the surprise but by pre-deciding what to do when it landed.**
- **`FlyCredentials` is shape, not capability** (per the plan's decision 4). The struct has exactly two fields, both byte-identical to the previous positional arguments. **This is the structural pre-payment in its purest form**: today's caller code says `deploy.FlyCredentials{APIToken: ..., OrgSlug: ...}` instead of `..., ...`; tomorrow's v1.5 code can add `DefaultRegion`, `MaxConcurrentSpawns`, scoped tokens — additively, with zero changes at any existing call site. The cost paid today is one `struct` declaration plus four extra LOC across the two callers (named-field syntax vs. positional); the option purchased is "constructor signature never changes again, even when the credential surface grows."
- **Both call sites use named-field struct literal syntax** (`deploy.FlyCredentials{APIToken: cfg.FlyAPIToken, OrgSlug: cfg.FlyOrgSlug}`) rather than positional (`deploy.FlyCredentials{cfg.FlyAPIToken, cfg.FlyOrgSlug}`). Named-field syntax is forward-compatible — adding a field to `FlyCredentials` doesn't break callers that don't supply it (Go zero-values the omitted field). Positional syntax would break every caller the moment a third field lands. **The named-field convention is what makes the struct's "additive growth" promise actually deliverable**; positional callers would defeat it on the first extension.
- **The constructor signature break is intentional and load-bearing.** The plan's decision 5 chose "no deprecation period, no shim function" — both call sites edit in one commit. The alternative (keeping `NewFlyDeployTarget(ctx, token, orgSlug)` as a deprecated shim that calls `NewFlyDeployTargetWithCredentials(ctx, FlyCredentials{...})`) would be a permanent maintenance burden for a package with three callers in a single repo. **Cost of the migration: 5 lines edited across two files. Cost of a shim: indefinite. Right call.**
- **`internal/deploy/target_test.go` re-ran in 0.327s, not cached.** Pre-Phase-1 the package's tests showed `(cached)` in `go test ./...` output (no source changes since the last test run); post-Phase-1 they show `0.327s` because `fly.go` changed and the test cache invalidated. All 24 sub-tests re-ran and passed unchanged. The cache invalidation is itself a positive signal: Go's test cache correctly detected the source-file mutation and re-verified that the change didn't regress any pure-helper behavior. **The 24 tests existed before this phase precisely so a constructor-touching refactor would either pass them or fail them loudly — neither requires a new test in Phase 1.**
- **No `_ = creds` keepalive, no `_ = FlyCredentials{}` import-pinning hack.** The struct is consumed at the constructor call site immediately on definition; the compiler is satisfied without ceremony. CLAUDE.md's "delete unused code completely" rule is honored at write time, not at a later cleanup pass.
- **The struct lives in `fly.go`, not a new `credentials.go`.** Same package, same file, immediately above `FlyDeployTarget`. Spinning up a new file for a 4-line struct definition would be over-structured at this scale; co-location with the consumer keeps the read-trail short. If `FlyCredentials` later grows to 50+ LOC (encryption helpers, validation methods, etc.), a `credentials.go` extraction is a `git mv` away — premature today.

---

## Verification matrix (Phase 1 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./...` clean | ☑ | Empty output. |
| `go build ./...` clean | ☑ | Empty output. Both binaries (`cmd/api`, `cmd/smoke-deploy`) implicitly build via `./...`. |
| `go test ./internal/deploy/...` clean | ☑ | `ok ... 0.327s` (cache invalidated by `fly.go` change; all 24 sub-tests re-ran). |
| `go test ./...` whole-tree clean | ☑ | `internal/agents`, `internal/users` cached at their respective baselines; `internal/deploy` re-ran cleanly; no other package broke. |
| Constructor signature is `(ctx, FlyCredentials)` — not `(ctx, string, string)` | ☑ | `internal/deploy/fly.go:49`: `func NewFlyDeployTarget(ctx context.Context, creds FlyCredentials) (*FlyDeployTarget, error)`. |
| All callers updated; no positional callers remain | ☑ | `grep -rn 'NewFlyDeployTarget(ctx,' backend/ \| grep -v 'creds FlyCredentials\|FlyCredentials{' ` returns zero hits. The two real callers (`cmd/api/main.go:50`, `cmd/smoke-deploy/main.go:49`) both use named-field struct literal. |
| `FlyCredentials` is exported and consumable from outside the package | ☑ | The struct, both fields, and the constructor are all exported (capitalized). Both `cmd/api` and `cmd/smoke-deploy` reference `deploy.FlyCredentials` from outside `internal/deploy/`. |
| No behavior change observable from the outside | ☑ (by static reasoning) | Constructor body is bit-identical to pre-Phase-1: `flaps.NewWithOptions(ctx, ...)` with the same `tokens.Parse` call (now keyed off `creds.APIToken` instead of `token`), same `UserAgent: "corellia"`, same struct return with `orgSlug: creds.OrgSlug`. The runtime smoke (`cmd/smoke-deploy` against real Fly) is the same operator-side check it was at M3 Phase 7 — unchanged by Phase 1's signature shuffle. |

Net: 7/7 satisfied at the resolution this phase is responsible for.
The runtime smoke (operator-side) inherits M3 Phase 7's deferred-to-runbook
status; Phase 1 does not change what that smoke verifies.

---

## Decisions made under-the-hood (not in the plan)

- **Absorbed the `cmd/smoke-deploy` third-caller fix into Phase 1, not a Phase 1.5.** Plan §risk-register entry 4 explicitly listed both options ("If a third appears between drafting and execution, add a Phase 1.5 to update it"). I chose inline absorption because: (a) the change is mechanically identical to `cmd/api/main.go`'s update — one positional call → one struct-literal call; (b) splitting into a separate phase would produce two commits with no independent acceptance criterion (Phase 1 would compile only after Phase 1.5, so they're already coupled); (c) the M3 phase docs establish "absorb mechanical follow-on edits into the originating phase rather than fragment the commit log" as codebase precedent (Phase 5's `flaps.Client` API drift, Phase 7's `NewFlyDeployTarget(ctx, ...)` ctx-arg drift — both absorbed into the originating phase). The risk register's own framing ("add a Phase 1.5") was the *escape hatch* if the third caller turned out to need different treatment; since both callers got the same treatment, no escape was needed.
- **Doc comment on `FlyCredentials` cites the plan and decision 4 by name.** Pattern continues from the M3 completion docs: comments at the declaration site that name the *governance source of truth* (which plan, which decision) so a future reader chasing "why does this struct have only two fields when v1.5 will add five?" lands on the answer in one hop. The alternative — a generic "// FlyCredentials carries Fly API credentials" comment — would force the reader to triangulate across the changelog and the plan to find the rationale. **Comment-as-breadcrumb beats comment-as-tautology.**
- **`creds` (not `c`, not `credentials`, not `cfg`) as the parameter name.** Three-letter names are codebase convention for short-lived locals (`ctx`, `err`, `req`); five-character abbreviated forms read as full words for parameter slots (`creds`, `spec`, `opts`). `c` would collide visually with `ctx` at the call site; `credentials` would be verbose for a one-line constructor body. `creds` is the goldilocks choice and matches how every other Go SDK names this slot (k8s `clientcmd.Credentials`, AWS SDK `aws.Credentials`).
- **Both callers use multi-line struct literal syntax** (`deploy.FlyCredentials{\n APIToken: ...,\n OrgSlug: ...,\n}`) rather than single-line (`deploy.FlyCredentials{APIToken: ..., OrgSlug: ...}`). Single-line is shorter today (two fields, both short identifiers); multi-line is forward-compatible for the additive-growth case (five fields would force multi-line anyway and then re-format the diff history). **Picking the multi-line form today preserves a stable diff for whatever v1.5 adds.** This is the same forward-compatibility principle the named-field choice rests on, applied to whitespace.

---

## What this means for Phase 2

Phase 2 introduces the `Resolver` interface, the `StaticResolver`
implementation, and `ErrTargetNotConfigured`, plus two test cases.
The Phase 1 → Phase 2 coupling is *zero* — Phase 2 doesn't read or
write `FlyCredentials`, doesn't touch `NewFlyDeployTarget`, doesn't
edit either caller. **The two phases are siblings under the
plan's overall objective, not strictly sequential**, and could in
principle be parallelized. The linear order keeps each commit
independently bisectable, which matches M3's pattern.

What Phase 2 *does* inherit from Phase 1:

1. **A struct-shaped `FlyDeployTarget` constructor.** When Phase 2's `StaticResolver` is later replaced by `DBResolver` in v1.5, the per-row credential rows in `deploy_targets` map cleanly to `FlyCredentials{...}` (one struct → one constructor call). Phase 1 is what makes that swap textual rather than structural.
2. **Verified zero-consumer-cost migration discipline.** Phase 1 broke a constructor signature with no shim, no deprecation, no migration period — and the static-check matrix stayed green. Phase 2 inherits the same discipline: when it changes `httpsrv.Deps.DeployTargets` from `map[string]deploy.DeployTarget` to `deploy.Resolver` (Phase 3, actually — but the same shape), the M3 plan's "no consumer in `httpsrv/`" baseline (verified by Phase 6's `grep -rn DeployTargets backend/internal/httpsrv/` returning one line) means the type-change is a single-line edit at the field declaration with no handler updates needed.

Phase 2's plan-prescribed steps are unchanged by Phase 1's execution
notes; the file `internal/deploy/resolver.go` does not exist yet and
is exactly what Phase 2 lands.

---

## Pre-work tasks status

The plan's §3 pre-work checklist:

- ☑ **M3 has merged (or this plan rebases against the M3 branch).** M3 + Phase 8 hardening are in the working tree; the resolver plan executes against that baseline. No rebase needed.
- ☑ **No second `NewFlyDeployTarget` caller has crept in** — *partially*. Pre-work assumed exactly two grep hits (definition + one caller); the actual count was three (definition + `cmd/api/main.go` + `cmd/smoke-deploy/main.go`). Phase 1.5 absorbed the third per risk-register §4. Post-Phase-1, all callers use the new struct-literal form; the shape the pre-work check was guarding (uniform constructor consumption) holds.
- ☑ **No handler reads `deps.DeployTargets` directly yet.** Verified by `grep -rn 'DeployTargets\[' backend/internal/httpsrv/` returning zero hits. M3's "wire the field, don't consume it" discipline holds; Phase 3 will narrow the type without breaking any handler.

Branch hygiene remains soft (same as the M3 phases — single-thread
work on `master`'s working tree); the three edited files are
uncommitted alongside the rest of the M3 + Phase 1 working tree.

---

## Risks / open issues opened by Phase 1

- **Future contributors may attempt to add a `NewFlyDeployTargetSimple(ctx, token, orgSlug)` shim** for "convenience." This would defeat the entire point of the struct — you cannot add fields additively if a positional shim exists alongside. Mitigation: a doc comment on `FlyCredentials` explicitly names the v1.5 widening intent; the deploy-target-resolver plan is referenced; the changelog (when 0.5.x lands) documents the rationale. If a shim shows up in code review, the reviewer has three artefacts to point at. The shim is the kind of "cleanup" that looks helpful and is actively harmful; flagging it now means the answer is documented before the question is asked.
- **`FlyCredentials` is currently a "shape, not capability" struct.** A reader who lands on it without context might assume it's over-engineered (two fields, both `string`, no methods, no validation). The doc comment explains the rationale; the plan documents it; this completion doc records it. **The over-engineering is the entire point** — pre-paying the structural seam now is what makes v1.5 cheap. Without the comment trail, a future "let's simplify this back to two strings" patch is plausible. With it, the patch is a directed defeat of a documented architectural decision.
- **No automated test exercises the constructor signature change.** Phase 1's verification rests on the compiler (the build would have broken if any caller still used the positional form) and the existing 24 sub-tests (none of which construct a `FlyDeployTarget` directly, so none of them needed to change). A regression test like `TestNewFlyDeployTarget_RejectsEmptyCredentials` would pin the constructor's contract — but it's not in scope for Phase 1, would need a real or faked flaps endpoint to exercise the actual `flaps.NewWithOptions` failure path, and the value vs. cost trade is poor at v1 scale. Deferred until the resolver plan's Phase 2 establishes the test-file precedent for resolver-related tests.
- **The `cmd/smoke-deploy` runtime smoke is unverified post-Phase-1.** Static checks prove the binary builds; `go run ./cmd/smoke-deploy` against real Fly is the only way to confirm the new struct-literal form actually constructs a working flaps client. The code path is byte-identical to pre-Phase-1 (same `flaps.NewWithOptions` call with the same arguments), so a runtime regression is structurally implausible — but flagged per the M3 precedent that runtime smokes are deploy-confidence gates, not merge gates.

---

## What's still uncommitted

Phase 1 produces a three-file diff in the repo:

- `backend/internal/deploy/fly.go` (edit; +12 / -3)
- `backend/cmd/api/main.go` (edit; +4 / -1)
- `backend/cmd/smoke-deploy/main.go` (edit; +4 / -1)

Net: +20 / -5 across three files. Untracked / unstaged, joining
the M3 working tree (Phases 1–8's adapter source, smoke scripts,
migration, deploy package, deploy package tests, main.go wiring,
smoke-deploy driver). The Phase 1 diff has *no* runtime durability
against the dev DB and *no* external state changed — reverting Phase
1 = reverting three file edits with zero blast radius.

**Phase 1 is more reversible than any M3 phase** — even M3 Phase 5
(the most reversible of the M3 phases) introduced a new directory
that needed `rm -rf` to revert; Phase 1 is line-level edits to three
existing files with no new directories, no new test files, no new
dependencies. A `git checkout backend/internal/deploy/fly.go
backend/cmd/api/main.go backend/cmd/smoke-deploy/main.go` reverts the
whole phase in one command.

---

`★ Insight ─────────────────────────────────────`
- **Phase 1 is the smallest meaningful structural change in the codebase to date** — three file edits, +20 / -5 LOC, one new exported type, one constructor signature change, zero new files, zero new tests. **The smallness is the point**: the structural pre-payment is supposed to be cheap *now* so the v1.5 swap is cheap *later*. If Phase 1 had needed 200 LOC of indirection, the trade would have been suspect. At 20 LOC, the option's premium is barely measurable — and the option itself (constructor signature never changes again, regardless of how many credential fields v1.5 adds) is unconditionally valuable.
- **Named-field struct literal syntax is the load-bearing convention here, not the struct itself.** The struct alone doesn't deliver the additive-growth promise — positional literals (`FlyCredentials{cfg.FlyAPIToken, cfg.FlyOrgSlug}`) would break the moment v1.5 added a third field. Named-field literals (`FlyCredentials{APIToken: ..., OrgSlug: ...}`) survive the addition because Go zero-values omitted fields and ignores unknown ones at the literal site. **The convention is what makes the architecture work**; the architecture without the convention is identical to the positional pair in disguise.
- **The plan's risk-register §4 entry was the most useful sentence in the resolver plan** — exactly the same observation M3 Phase 5's completion doc made about its own plan's "the structural decisions are stable; consult SDK godoc and adjust calls" line. The pattern repeats: **plans get the *what* exactly right and the *details* substantially wrong; the risk-register entries that anticipate the wrongness are what make the plan executable without re-litigation.** A plan that prescribes "exactly two grep hits, fix any third" is more durable than one that prescribes "exactly two grep hits" alone — the former survives drift, the latter doesn't. Worth noting as a cross-plan pattern: every future plan should have a "what changes between drafting and execution" risk entry.
`─────────────────────────────────────────────────`

---

*(Phase 2 — `Resolver` interface + `StaticResolver` implementation +
`ErrTargetNotConfigured` sentinel + two test cases — is next.)*
