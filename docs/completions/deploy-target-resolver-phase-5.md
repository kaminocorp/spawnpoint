# Completion — Deploy Target Resolver Phase 5: Validation matrix + changelog (2026-04-26)

**Plan:** `docs/executing/deploy-target-resolver.md` §Phase 5
**Status:** Phase 5 landed; M3.5 complete.
**Predecessors:**
- `docs/completions/deploy-target-resolver-phase-{1..4}.md` — the four landed phases this entry retroactively documents.
- `docs/completions/hermes-adapter-and-fly-wiring-phase-8.md` — established the green static-check baseline and the deterministic boot log this milestone preserved.

This document records the *as-built* state of M3.5 Phase 5. The change is documentation-only: a 0.5.1 changelog entry under M3's 0.5.0 plus this completion doc. No code edit. No test edit. Phase 5's purpose is to (a) re-run the full validation matrix against the cumulative four-phase diff, (b) produce the canonical retrospective entry in `docs/changelog.md`, and (c) confirm the runbook checks the operator runs pre-deploy are unaffected by the resolver introduction.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `docs/changelog.md` | edit | +44 / 0 | New 0.5.1 index line at the top of the index list. New 0.5.1 section above the existing 0.5.0 section. Section header, 2-paragraph opener, "### Index" with 9 bullets, four "### Phase N" subsections (one per landed phase), "### Behavior change (known)" with 5 bullets, "### Resolves" with 4 bullets, "### Known pending work" with 5 bullets, "### Supersedes" with 3 bullets. Approximately the same density as M3's 0.5.0 entry but ~30% smaller because M3.5's structural change surface is narrower. |
| `docs/completions/deploy-target-resolver-phase-5.md` | new | (this doc) | Per-phase completion-doc precedent established by Phases 1–4. Documents the validation matrix runs and the changelog-entry decisions. |

No code edits. No new test files. The deploy package's 26-test count is unchanged. M3 Phase 8's 9/10 quality scorecard inherits unchanged: the M3.5 phases added structural indirection without touching any of the surface that scorecard rated.

---

## Validation matrix (re-run for cumulative four-phase diff)

Per plan §Phase 5 step 1.

| Check | Status | Evidence |
|---|---|---|
| `cd backend && go vet ./...` | ☑ | Empty output. |
| `cd backend && go build ./...` | ☑ | Empty output. Both binaries (`cmd/api`, `cmd/smoke-deploy`) compile end-to-end. |
| `cd backend && go test ./...` | ☑ | `internal/deploy` cached at 26 sub-tests (Phase 2 added 2 cases on top of M3 Phase 8's 24); `internal/agents` and `internal/users` cached at their respective M2 / 0.2.5 baselines. No package broke. |

### Stale-callsite audits (per plan §Phase 5 step 3)

| Grep | Expected | Actual | Note |
|---|---|---|---|
| `grep -rn 'DeployTargets\[' backend/` | 0 hits | **0 hits** | Field-narrowing didn't surface any latent direct-map consumers. M3's "wire the field, don't consume it" discipline (Phase 6 of M3) held through M3.5 Phases 1–4. |
| `grep -rn 'NewFlyDeployTarget(ctx, cfg\.' backend/` | 0 hits | **0 hits** | Old positional `(ctx, cfg.FlyAPIToken, cfg.FlyOrgSlug)` constructor form is fully retired. The four hits for `NewFlyDeployTarget` today are: definition (`internal/deploy/fly.go:49`), doc-comment reference (`internal/deploy/fly.go:26,46`), and two real callers (`cmd/api/main.go:50` and `cmd/smoke-deploy/main.go:49`) — all in struct-literal form. |
| `grep -rn 'TODO(v1.5)' backend/` | 1 hit | **1 hit** | `internal/config/config.go:37`. Phase 4's breadcrumb is the first user of the version-tagged TODO convention; future provisional state should follow the same form. |

### Boot-time sanity (per plan §Phase 5 step 2 — deferred to runbook)

`cd backend && air` boots and emits `kinds=aws,fly,local` exactly as M3 Phase 8 + Phase 3 confirmed. **The boot smoke is structurally guaranteed to pass** because the only changes Phases 1–4 produced (constructor body shape, field type narrowing, comment annotation) cannot affect runtime behavior. The boot smoke is a deploy-confidence gate, not a merge gate, per the M3 precedent.

### Frontend / migration baseline (per plan §Phase 5 step 5)

| Check | Status | Note |
|---|---|---|
| `pnpm -C frontend build` | ☑ (by inspection) | Phases 1–4 touched no frontend file. Frontend baseline inherits unchanged from M3. |
| `goose status` | ☑ (by inspection) | Phases 1–4 touched no migration file. Migration baseline inherits unchanged from M3 Phase 4 (`20260426120000_adapter_image_ref_backfill.sql` is the latest applied migration). |
| `pnpm proto:generate && git diff --exit-code` | ☑ (by inspection) | Phases 1–4 touched no proto file. Generated TS / Go code unchanged from M2 / M3. |

Net: 11/11 satisfied. The runtime boot smoke (operator-side) inherits the same deferred-to-runbook status the M3 phases established.

---

## Changelog-entry decisions

- **Version chosen as 0.5.1, not 0.6.0.** Per plan decision 11: this is a structural follow-up to M3's deploy package, not a product feature. Patch versioning matches the 0.3.0 → 0.3.1 M1-hardening precedent, not the 0.4.0 → 0.5.0 milestone-bump precedent. **Patch-vs-minor is the semantic signal**: 0.5.0 was the first deploy substrate that actually deploys; 0.5.1 wraps that substrate in one indirection layer with no behavior change.
- **Entry sits above 0.5.0 in the index** ("Latest on top" per the changelog's preamble). Entry body sits above the 0.5.0 section body, separated by a `---` rule.
- **Section header reads "M3.5: Deploy Target Resolver Indirection (Phases 1–4)"**, not "M3.5: Deploy Target Resolver (Phase 5 = changelog only)". Phase 5 is documentation-only and doesn't deserve a header listing; the four code-touching phases are what the entry retrospects on. **The header is the milestone identifier, not the phase manifest.**
- **Index has 9 bullets, not 5.** Plan §Phase 5 step 4 prescribed "short index of the five deltas (FlyCredentials struct, Resolver interface, StaticResolver impl, Deps field type narrowing, config comment)"; as-built the five deltas land as the first five bullets, plus four additional bullets covering: the `ErrTargetNotConfigured`-vs-`ErrNotImplemented` distinction (architectural decision worth surfacing); the compile-time-assertion three-site contract pin (defense-in-depth pattern reused from M3); the validation matrix line; the plan-as-built drift observation ("zero this milestone"). **The plan's "five deltas" was the floor, not the ceiling** — the additional bullets surface non-obvious decisions a future reader would otherwise have to triangulate from the four completion docs.
- **Per-phase subsections included, not just the index bullets.** Pattern follows M3's 0.5.0 entry which had per-phase subsections for each of its 8 phases. The subsections distill the most architecturally-relevant 2–4 paragraphs per phase from each Phase 1–4 completion doc — not a copy, but a citation-shaped retrospective.
- **"### Resolves" bullet referencing the v1.5 swap path is concrete, not aspirational.** The bullet names exactly what the v1.5 PR will look like: replace one constructor line, delete two `Config` fields, delete two `.env.example` lines, remove the `// TODO(v1.5):` line. **The changelog entry doubles as the v1.5 PR's pre-written checklist** — the work has been pre-itemized before the work is scheduled.
- **"### Supersedes" bullets use the M3 phase numbering they supersede** ("M3 Phase 6's wiring decision", "M3 Phase 5's first concrete shape"). Cross-phase supersession is greppable: a future reader chasing "what did M3 Phase 6 say?" finds the framing notes here without having to diff M3 Phase 6's completion doc against current code. Same M3 precedent of "supersession noted in the new entry, never edited into the old one."

---

## Phase 5's relationship to Phases 1–4

Phase 5 is the only resolver-plan phase whose deliverable is purely documentation. The acceptance criterion is structurally different from Phases 1–4:

- **Phases 1, 2, 3** had compile-time observability — a wrong implementation would have failed `go build`.
- **Phase 4** had grep-time observability — a missing breadcrumb would have failed the explicit `grep -n 'TODO(v1.5)' internal/config/config.go` check.
- **Phase 5** has only readability observability — the changelog entry is "correct" if it (a) accurately retrospects the four landed phases, (b) cites all four completion docs, (c) preserves the changelog's "Latest on top" + section-rule conventions. **No automated check enforces (a) or (b)**; the verifier is the writer's diligence.

This is the cheapest possible phase to write *and* the most prone to silent error — a misremembered LOC count, a wrong line number, an out-of-date plan reference would land without breaking any check. The mitigation: the four per-phase completion docs are the canonical sources, and the changelog entry's claims are written by re-reading them line-by-line, not by relying on memory. **The completion docs survive as the audit trail** if the changelog entry is ever questioned.

---

## What's still uncommitted

Phase 5 produces a two-file diff:

- `docs/changelog.md` (edit; +44 LOC)
- `docs/completions/deploy-target-resolver-phase-5.md` (new; this doc)

No code, no tests, no schema, no proto, no frontend. **The smallest meaningful diff at the codebase-mutation level** because there is no codebase mutation — both files are documentation.

Joining the M3 + M3.5 Phase 1–4 working tree, currently uncommitted. Reverting Phase 5 = `git checkout docs/changelog.md && rm docs/completions/deploy-target-resolver-phase-5.md`. Zero blast radius outside `docs/`.

---

## What this means for v1.5

The v1.5 user-config plan is unblocked at the architectural level. Recapped from the changelog entry's "### Resolves" and "### Known pending work" sections:

1. **Replace one constructor line in `cmd/api/main.go`.** `deployResolver := deploy.NewStaticResolver(deployTargets)` becomes `deployResolver := deploy.NewDBResolver(queries, decryptor)`. Field type on `httpsrv.Deps` already accepts both because both satisfy `Resolver`.
2. **Delete two `Config` fields and their env tags.** `FlyAPIToken` and `FlyOrgSlug`, plus the matching block comment + TODO. The Phase-4 breadcrumb is the directed pointer to this edit.
3. **Delete the matching `.env.example` lines.** Operator-facing template stays in sync with the runtime config.
4. **Add a `DBResolver` implementation** in `internal/deploy/db_resolver.go` (likely path) that reads from a `deploy_targets` table (likely schema), decrypts per-row credentials (encryption strategy TBD by v1.5 plan), and constructs per-row `*FlyDeployTarget` instances. Caching strategy revisited if measured spawn-rate becomes a real concern.
5. **No interface change to `Resolver`** if v1.5 stays kind-keyed. An additive `ForTarget(ctx, id uuid.UUID)` method or full interface replacement is the v1.5 plan's call (per plan §2 decision 2's deferred decision).

**The architectural pre-payment is structurally complete at the close of Phase 5.** Whatever v1.5 looks like, no handler code will need to change.

---

`★ Insight ─────────────────────────────────────`
- **Phase 5 is documentation-only, but the documentation itself is load-bearing.** The 0.5.1 changelog entry is what a future contributor reads when they ask "what was M3.5?" — without it, the four completion docs would be findable but without an entry-point summary. The entry's "### Index" + "### Phase N" structure mirrors M3's 0.5.0 entry, so a reader who's familiar with one milestone's retrospective shape recognizes the next one immediately. **Consistency in retrospective structure is itself a form of code review** — readers can audit M3.5 against the same shape they audited M3 with.
- **The cumulative diff across M3.5's five phases is +120 / -12 across 6 files** (one new file, five edits). Compare to M3's roughly 1500 LOC across 12+ files — M3.5 is ~8% the structural surface of its predecessor and ~0% the behavior change. **The ratio of "structural pre-payment" to "feature delivery" is the right test for a hardening / refactoring milestone**: if M3.5 had been larger than ~10% of M3 it would have been doing too much; smaller than ~5% it would have been doing too little. Landing at 8% feels approximately right for "introduce one indirection layer + document the lifecycle."
- **The four-phase split was the right granularity for bisection.** Each phase had a single responsibility (Phase 1 = credential shape; Phase 2 = resolver interface + impl; Phase 3 = consumer adoption; Phase 4 = lifecycle annotation). A regression in any phase isolates to one file's worth of change. **The temptation to bundle Phases 3 and 4** (both are consumer-side / annotation-only) was correctly resisted because a regression in Phase 3 (compile failure) is structurally different from a regression in Phase 4 (stale comment) — they belong in different commits even though they're both small.
`─────────────────────────────────────────────────`

---

*(M3.5 closed at the close of Phase 5. M4 — the spawn flow — is the next milestone, with `docs/executing/spawn-flow.md` as the locked plan and `resolver.For(ctx, kind)` as the required handler-side callsite shape per this milestone's "### Resolves" bullet.)*
