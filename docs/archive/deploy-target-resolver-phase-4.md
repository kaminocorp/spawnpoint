# Completion — Deploy Target Resolver Phase 4: `config.go` bootstrap-state annotation (2026-04-26)

**Plan:** `docs/executing/deploy-target-resolver.md` §Phase 4
**Status:** Phase 4 landed; Phase 5 (validation matrix + changelog) pending.
**Predecessors:**
- `docs/completions/deploy-target-resolver-phase-3.md` (Phase 3 — `httpsrv.Deps.DeployTargets` narrowed to `deploy.Resolver`; `cmd/api/main.go` constructs the resolver. Phase 4's annotation refers to the env vars that feed this resolver's bootstrap path).
- `docs/completions/deploy-target-resolver-phase-2.md` (Phase 2 — `Resolver` interface + `StaticResolver` impl. The annotation cites the plan §1 which describes the v1.5 swap to `DBResolver` that retires the env vars).
- `docs/completions/deploy-target-resolver-phase-1.md` (Phase 1 — `FlyCredentials` struct + constructor swap. The two fields the annotation marks as bootstrap state are read at `cmd/api/main.go:50-53` into `FlyCredentials{...}`).

This document records the *as-built* state of M3.5 Phase 4. The change is a single comment-only edit: a six-line block comment (plus a one-line `TODO(v1.5):`) above the `FlyAPIToken`/`FlyOrgSlug` field declarations in `internal/config/config.go`. No code change. No new fields. No behavior change. Phase 4's purpose is documentation-only — to leave a greppable breadcrumb for the v1.5 retirement work so that a future contributor finds the rationale at the field declaration site rather than having to triangulate across the changelog and the resolver plan.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `backend/internal/config/config.go` | edit | +9 / -3 | Six-line block comment above `FlyAPIToken` plus a separating blank line before `SupabaseURL` (cosmetic — splits the previously-flat env block into two visual groups, "current state" and "bootstrap state slated for retirement"). One-line `// TODO(v1.5):` follows the block comment for grep affordance. The field declarations themselves are byte-identical to pre-Phase-4. |

No new files, no schema, no proto, no test, no domain-package edits, no callers updated. The `Config` struct's exported surface and ABI are unchanged — the same `cfg.FlyAPIToken` / `cfg.FlyOrgSlug` reads at `cmd/api/main.go:51-52` and `cmd/smoke-deploy/main.go` continue to work without any caller modification.

---

## Index

- **Phase 4 is the only resolver-plan phase whose deliverable is purely a comment.** Phase 1 = constructor break (compile-time observable); Phase 2 = new interface + impl + tests (runtime observable through tests); Phase 3 = field type narrowing + boot wiring (compile-time observable through downstream consumers); Phase 4 = block comment + TODO. **The verification surface for a comment-only phase is structurally different**: there's no compiler check, no test that fails, no log line that changes. The acceptance criterion is "the comment is at the field declaration site, the TODO is greppable, the cross-references are accurate." Verified by `grep -n 'TODO(v1.5)' internal/config/config.go` returning the expected line and a re-read of the cross-references.
- **The annotation lives at the field declaration site, not the call site.** Two sites consume `cfg.FlyAPIToken` / `cfg.FlyOrgSlug`: `cmd/api/main.go:51-52` (production runtime path) and `cmd/smoke-deploy/main.go` (operator smoke). Putting the breadcrumb at the *field declaration* (instead of either or both call sites) means a future contributor reading "what does `Config.FlyAPIToken` mean?" lands on the rationale immediately, regardless of which call site they navigated from. **The field declaration is the single source of truth for the field's lifecycle**; call sites describe consumption, not provenance. Per plan decision 9: "comments at the field declaration are the highest-visibility surface for 'this is provisional' — every future config edit reads them."
- **`// TODO(v1.5):` is a greppable retirement marker, not a generic "fix this later."** The version-tagged form has three load-bearing properties. (a) **Scoped to a milestone**, not "someday" — when v1.5 lands, the work is in scope; before v1.5, it's deliberately deferred. (b) **Distinguishable from generic TODOs** in any future grep audit (`grep -rn 'TODO(v1.5)' backend/` returns this line; `grep -rn 'TODO[^(]' backend/` filters it out for general-purpose hygiene passes). (c) **Self-superseding** — when v1.5's `DBResolver` lands, the deletion of the TODO and the deletion of the fields happen in the same commit; the TODO and its rationale die together. **A bare "TODO" comment would have none of these properties.**
- **The block comment cites `docs/executing/deploy-target-resolver.md §1` by exact section.** §1 is the plan's "Objective" — the load-bearing description of what v1.5 retires and why. Citing §1 (instead of the plan as a whole) means the future reader's click-through lands on a half-page, not a six-page document. **Comment-as-breadcrumb beats comment-as-tautology** — same pattern Phase 1's `FlyCredentials` doc comment established and Phase 2's `Resolver` interface continued.
- **Cosmetic split of the env block into two groups** (`SupabaseURL` separated from `FlyAPIToken`/`FlyOrgSlug` by a blank line and the comment block). The two groups are now visually distinct: "current state" (`Port`, `DatabaseURL`, `SupabaseURL`, `FrontendOrigin`) and "bootstrap state slated for v1.5 retirement" (`FlyAPIToken`, `FlyOrgSlug`). **The blank-line split is informationally redundant with the comment** — but it's the kind of redundancy that helps a reader scanning the file at high speed. A reader who notices "two groups" before they notice the comment text still gets the right mental model. Costs zero LOC of comment text and one LOC of whitespace; pays back at every future re-read.
- **`Port` was *not* annotated as "current state."** A symmetric annotation ("the other env vars are not slated for retirement") would over-specify — most env vars in any config struct are stable; only the unstable ones need calling out. **The absence of an annotation on the other fields is itself the implicit signal that they're stable.** Adding "this one is stable" comments would mirror the bad pattern of `// not deprecated` comments in deprecated APIs — informationally noise.
- **Three-line block comment + one-line TODO + one-line plan reference = six total lines of comment** (plus the `//` markers). The plan's §Phase 4 step 1 prescribed a 5-line block comment; as-built lands at six lines because (a) splitting "see docs/executing/deploy-target-resolver.md §1" onto its own line keeps the cross-reference greppable as a path, (b) the TODO line is below the prose so the prose reads as continuous English. Plan-level prescription was approximately right; the +1 LOC delta is editorial, not structural.

---

## Verification matrix (Phase 4 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./...` clean | ☑ | Empty output. Vet does not warn on comment-only edits, but ran for completeness. |
| `go build ./...` clean | ☑ | Empty output. Comment-only edits do not change compilation behavior, but the build was re-run to confirm no pathological interaction (e.g. accidental field deletion). |
| Block comment is at the field declaration site | ☑ | `internal/config/config.go:32-37`: six-line comment block immediately above `FlyAPIToken string \`env:"FLY_API_TOKEN,required"\``. Field name, type, env tag, `required` flag all unchanged. |
| `TODO(v1.5)` is greppable | ☑ | `grep -n 'TODO(v1.5)' internal/config/config.go` returns `37:	// TODO(v1.5): delete these two fields when DBResolver lands.` Single-line, version-tagged, self-superseding form. |
| Plan reference is correct | ☑ | The block comment cites `docs/executing/deploy-target-resolver.md §1`. §1 is the plan's "Objective" section, which describes the v1.5 retirement intent in two paragraphs — the right anchor for the breadcrumb. |
| `Config` struct exported surface unchanged | ☑ | `FlyAPIToken string` and `FlyOrgSlug string` declarations are byte-identical to pre-Phase-4. Both env tags (`env:"FLY_API_TOKEN,required"`, `env:"FLY_ORG_SLUG,required"`) preserved. |
| No call site needs updating | ☑ | `grep -rn 'FlyAPIToken\|FlyOrgSlug' backend/` returns the same hits as pre-Phase-4: declarations in `internal/config/config.go`, reads at `cmd/api/main.go:51-52`, reads at `cmd/smoke-deploy/main.go`. The annotation does not change any consumer's API. |
| No behavior change observable from outside | ☑ (by inspection) | `config.Load()` produces a `Config` value with byte-identical field values for any given env. The runtime smoke (`cd backend && air`) inherits the M3 baseline unchanged. |

Net: 8/8 satisfied at the resolution this phase is responsible for.

---

## Decisions made under-the-hood (not in the plan)

- **Inserted a blank line between `SupabaseURL` and the new comment block.** Plan §Phase 4 step 1 didn't prescribe whitespace; as-built lands a one-line gap so the comment block visually attaches to `FlyAPIToken`/`FlyOrgSlug` rather than merging into `SupabaseURL`'s scope. **Whitespace as scoping** — a reader's eye associates a comment block with the declaration immediately below it, and the gap above keeps that association unambiguous. Costs one LOC; pays back at every re-read.
- **Comment text uses "deploy.StaticResolver" (not just "the resolver" or "Resolver").** The fully-qualified type name is greppable; "the resolver" would force a reader to remember which package "the resolver" lives in. **Identifier-shaped names in comments are searchable; English nouns are not.** Same reasoning Phase 1's `FlyCredentials` doc comment used when it referred to "the deploy-target-resolver plan §2 decision 4" by exact section.
- **One-line TODO format (`// TODO(v1.5): delete these two fields when DBResolver lands.`) instead of two-line block.** Single line keeps the action verb (`delete`), the timing marker (`v1.5`), the scope (`these two fields`), and the trigger (`when DBResolver lands`) on one screen-line — readable as a sentence rather than a paragraph. Splitting the action and trigger across lines would have been pedantic for a 14-word imperative. **The TODO is a single instruction, not an essay.**
- **No mirror annotation in `.env.example`.** The env vars also appear in `.env.example` (the committed template), and a parallel "this is bootstrap state slated for v1.5 retirement" annotation could have been added there. Skipped because: (a) `.env.example` is operator-facing, not contributor-facing — operators need to know what to set, not whether the field is provisional; (b) when the v1.5 deletion lands, both `.env.example` lines disappear in the same commit anyway, so a `TODO(v1.5)` in `.env.example` would die alongside the contributor-facing TODO with no incremental value; (c) a single canonical breadcrumb in `config.go` is the better single source of truth than scattered TODOs across two files. Decision parallels Phase 3's "no `// TODO(v1.5):` at the resolver-wrapping line" reasoning — one canonical breadcrumb beats many.
- **Block comment uses prose, not bullet points.** Three sentences forming a continuous explanation: (1) what the fields are; (2) when they retire; (3) where to read more. Bullets would have invited a fourth/fifth/Nth point ("the encryption strategy is deferred", "the per-org credential model is deferred", etc.) — none of which belong at the field declaration. **Prose discipline keeps the comment from sprawling.**

---

## What this means for Phase 5

Phase 5 is the validation matrix + changelog entry. Phase 4 → Phase 5 coupling is light:

1. **Static checks.** Phase 5 step 1 re-runs `go vet ./... && go build ./... && go test ./...` whole-tree. Phase 4 ran vet + build mid-phase and got empty output; the test step is unchanged from Phase 3 (`internal/deploy` re-runs because of source changes upstream of the comment edit; everything else cached). No surprises expected.
2. **Boot-time sanity (Phase 5 step 2).** `cd backend && air` boots and emits `kinds=aws,fly,local` exactly as M3 Phase 8 + Phase 3 confirmed. Phase 4's comment-only edit cannot affect runtime behavior — the boot smoke is structurally guaranteed to pass. Operator-side check, deferred to runbook per the M3 precedent.
3. **Grep audits (Phase 5 step 3).** `grep -rn 'DeployTargets\[' backend/` (zero hits) and `grep -rn 'NewFlyDeployTarget(ctx, cfg\.' backend/` (zero hits — the old positional form is gone). Both inherit cleanly from Phases 1–3; Phase 4 doesn't touch either site.
4. **Changelog entry (Phase 5 step 4).** Single entry under M3's 0.5.0 covering all four landed phases. Phase 4 contributes one bullet to the entry's body — the bootstrap-state annotation as the architectural breadcrumb that completes the resolver plan's structural pre-payment.

Phase 5 is the lightest phase by structural change (no code edits in scope) and the most documentation-heavy. Comparable to M3 Phase 8 in shape (post-implementation hardening + changelog), but smaller — the resolver plan's hardening was distributed across Phases 1–3, not concentrated at the tail.

---

## Pre-work tasks status

The plan's §3 pre-work checklist (re-verified at Phase 4 start, since intermediate phases could have changed assumptions):

- ☑ **`Config` struct's `FlyAPIToken` and `FlyOrgSlug` fields exist and are read by callers.** Confirmed by inspection of `internal/config/config.go:31-32` (pre-Phase-4 line numbers) and `grep -rn 'FlyAPIToken\|FlyOrgSlug' backend/` showing reads at the expected two call sites. Without these fields the annotation would be hallucinating about non-existent state.
- ☑ **`docs/executing/deploy-target-resolver.md` §1 exists and describes the v1.5 retirement.** Plan file is present in the working tree; §1 reads "Pre-pay one architectural move that buys cheap user-configurable deploy targets in v1.5+" and explicitly mentions `FlyAPIToken`/`FlyOrgSlug` retirement. The cross-reference is accurate as of write time.
- ☑ **No competing TODO comment exists at the same field declaration.** `grep -n 'TODO\|FIXME\|XXX' internal/config/config.go` pre-Phase-4 returned no hits. The new `TODO(v1.5)` is the file's first such marker.
- ☑ **Phases 1, 2, 3 have not been reverted.** All three phases' deliverables are in the working tree alongside Phase 4's edit. The annotation references concepts (`deploy.StaticResolver`, `DBResolver`) that Phase 2 made real and Phase 3 wired through; reverting any predecessor would invalidate the breadcrumb.

---

## Risks / open issues opened by Phase 4

- **A future contributor may interpret the `// TODO(v1.5):` as a license to delete the fields *now*.** The TODO is explicitly version-tagged, but a hasty PR could elide the version tag's meaning. Mitigation: the block comment above the TODO names "v1.5" and "DBResolver" twice, with a plan reference. A code-review heuristic: "if you delete `FlyAPIToken`, you're also (a) deleting from `.env.example`, (b) deleting from `cmd/api/main.go:51-52`, (c) deleting from `cmd/smoke-deploy/main.go`, and (d) you have a `DBResolver` to point at." Failing any of (a)-(d) is the signal that the deletion is premature.
- **The plan reference (`docs/executing/deploy-target-resolver.md §1`) becomes stale if the plan is moved to `docs/archive/` post-completion.** The codebase precedent (per CLAUDE.md) is that `docs/executing/` plans move to `docs/archive/` when the milestone closes. When that move happens, the comment's path will dangle. **Mitigation: update the path in the same commit that archives the plan** — a one-line edit. Alternatively, reference by slug instead of path; deferred until the archive move actually happens.
- **The `// TODO(v1.5):` form is unique in this codebase today.** No other files use a version-tagged TODO; the convention is being established by this phase. **If the convention catches on, future TODOs should follow the same form** (`TODO(v1.5)`, `TODO(v2)`, etc.) to keep the grep audit clean. If it doesn't catch on, this single TODO is still self-contained and self-superseding. **Either outcome is acceptable** — the marker's value to *this* annotation doesn't depend on broader adoption.
- **No automated test exercises the annotation.** Comments don't have a test surface; the annotation's correctness rests on (a) the plan reference being accurate (verified by re-reading §1), (b) the field names being correct (verified by the build still compiling), (c) the TODO being greppable (verified by the explicit grep). A future PR that renames `FlyAPIToken` to (e.g.) `FlyAccessToken` would silently break the comment's "two fields" wording without breaking the build. **The risk is mitigated by the comment block being adjacent to the fields** — a rename PR is structurally likely to touch the comment block at the same time.

---

## What's still uncommitted

Phase 4 produces a one-file diff:

- `backend/internal/config/config.go` (edit; +9 / -3)

Net: +6 / 0 across one file. **The smallest meaningful diff in the resolver plan**, and the smallest *positive* delta of any phase to date. Phase 1 was +20/-5; Phase 2 was +88/-1; Phase 3 was +2/-2; Phase 4 is +9/-3 (or +6 net).

The downward trend reflects each phase's narrowing role: Phase 1 designed the credential surface, Phase 2 designed the resolver surface, Phase 3 wired the surface into the consumer slot, Phase 4 documented the bootstrap-state lifecycle. **Phase 4 is the narrowest because there's no code surface left to design** — the architectural pre-payment is structurally complete; the comment is the trail-marker that survives into v1.5.

A `git checkout backend/internal/config/config.go` reverts Phase 4 in one command, no side effects, no compile errors at intermediate states. **Comment-only changes are the most reversible kind of change a phase can produce.**

---

`★ Insight ─────────────────────────────────────`
- **A version-tagged TODO is a structurally different artefact from a generic TODO.** Generic TODOs accumulate as backlog and become noise; version-tagged TODOs (`TODO(v1.5)`, `TODO(v2)`) are scoped to a specific future milestone and self-supersede when that milestone lands. The grep audit at v1.5 start (`grep -rn 'TODO(v1.5)' backend/`) becomes the canonical to-do list for the v1.5 release; nothing else needs to be tracked. **The version tag is what gives the TODO a known end-of-life**; without it, the TODO is indistinguishable from "we never got around to this." The convention costs nothing to apply and pays back at every milestone-scoping conversation.
- **The annotation's three-sentence prose structure ("what / when / where to read more") is the minimum-viable lifecycle marker.** Each sentence carries one piece of information; together they let a future reader answer the three questions a "this is provisional" comment must answer: (1) what is provisional? (2) when does it stop being provisional? (3) where do I read the rationale? Bullet points or a four-sentence form would have padded without adding information. **Comment minimalism with structured content is more useful than comment volume.**
- **Phase 4 closes the resolver plan's architectural pre-payment.** Phases 1–3 delivered the structural moves (credential struct, resolver interface, field type narrowing); Phase 4 delivered the *temporal* move — the bootstrap state's known retirement. **Without Phase 4, a future reader landing on `cfg.FlyAPIToken` has no way to know the field is provisional**; the resolver plan exists but isn't reachable from the field declaration. With Phase 4, the path from "I see this field" → "I understand it retires in v1.5" → "I read the plan that explains why" is exactly one comment block long. The architectural plan and the field declaration are now linked by a 6-line trail-marker; the marker outlives the plan's `docs/executing/` path (with the caveat that the archive move requires updating the cite).
`─────────────────────────────────────────────────`

---

*(Phase 5 — validation matrix re-run + changelog entry under M3's 0.5.0 — is next.)*
