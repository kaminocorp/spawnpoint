# Completion — M3 Phase 4: `harness_adapters.adapter_image_ref` backfill + `NOT NULL` + digest-pinning CHECK (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 4
**Status:** Phase 4 landed; Phases 5–8 pending.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md` (adapter source)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md` (multi-arch publish; Phase 4 reads the captured-metadata block from here)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-3.md` (operator smoke harness)

This document records the *as-built* state of Phase 4. Phases 1–3
produced source artefacts (`Dockerfile`, `entrypoint.sh`,
`smoke.sh`), a registry-published image, and an operator-facing
smoke harness — none of which touched the running database.
**Phase 4 is the first M3 phase whose `goose up` makes a durable
state change to the running database.** It closes the M2 → M3 schema
deferral (`adapter_image_ref TEXT NULL`) by backfilling Phase 2's
captured digest into the column and tightening it to `TEXT NOT NULL`
plus a digest-pinning CHECK constraint. Net effect: blueprint §11.2
("AgentTemplates pin by Docker image digest, never by mutable tag")
is now enforced at the database layer for **both** digest columns
on `harness_adapters` — the second column joins
`upstream_image_digest`'s M2 CHECK (`LIKE 'sha256:%'`).

---

## Files added / changed

| File | Status | LOC | Notes |
|---|---|---|---|
| `backend/migrations/20260426120000_adapter_image_ref_backfill.sql` | new | 56 | One-file migration: UPDATE + ALTER (NOT NULL + CHECK) in the up block; reverse in the down block. Audit-comment block above the UPDATE imports Phase 2's captured metadata verbatim. |
| `backend/internal/db/models.go` | regenerated | -1 / +1 | `AdapterImageRef *string` → `AdapterImageRef string`. sqlc rederivation; not hand-edited. |

No backend domain code, frontend, proto, or query-file edits. The
`harness_adapters.sql.go` query file already projects `*` and the
generated `getHarnessAdapterByID` Scan call doesn't change shape —
the only struct field whose type flips is in `models.go`. No
current caller reads `AdapterImageRef` (Phase 5's `FlyDeployTarget`
is the first reader), so the type-flip is invisible at the
call-site level today.

---

## Index

- **Migration applied cleanly in 53ms.** `goose up` output:
  `OK 20260426120000_adapter_image_ref_backfill.sql (53.06ms)`,
  `goose: successfully migrated database to version: 20260426120000`.
  Single transaction (goose's per-file atomicity); no partial-state
  window between the UPDATE and the ALTER.
- **Backfilled value verified against Phase 2's capture.** Post-up
  `SELECT harness_name, adapter_image_ref FROM harness_adapters`
  returned `hermes |
  ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6`
  — bit-identical to the manifest-list digest captured in
  `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md`'s
  "Captured metadata" block. The string now appears in three places
  in the working tree: the migration's UPDATE, `smoke.sh`'s default
  `IMAGE=` value (Phase 3), and Phase 2's completion doc. A future
  digest bump needs a coherent edit across all three plus the
  pending Phase 8 changelog entry.
- **Both rejection paths verified empirically, not just by inspection.**
    - `UPDATE ... SET adapter_image_ref = 'ghcr.io/...:latest'` was
      rejected with `ERROR: new row for relation "harness_adapters"
      violates check constraint "adapter_image_ref_digest_pinned"` —
      the digest-pinning CHECK is live.
    - `UPDATE ... SET adapter_image_ref = NULL` was rejected with
      `ERROR: null value in column "adapter_image_ref" of relation
      "harness_adapters" violates not-null constraint` — the
      `NOT NULL` constraint is live.
  Both DETAIL lines named the offending row's ID (`0d566724-...`),
  confirming Postgres ran the validation against the seeded row, not
  a hypothetical one.
- **Down/up cycle round-trips cleanly.** `goose down` (105ms)
  → empty `adapter_image_ref` confirmed (`SELECT` shows the row
  with the column blank) → `goose up` (87ms) → digest re-populated
  to the same string. End state matches start state across the
  cycle. Goose's per-file atomicity means even a power-loss between
  the down and up would leave the DB in one of two well-defined
  states, never a half-applied one.
- **`AdapterImageRef *string` → `string` is the load-bearing
  type-flip.** Pre-migration the column was `TEXT NULL`, so sqlc's
  `emit_pointers_for_null_types: true` (set globally in
  `backend/sqlc.yaml`) generated `AdapterImageRef *string`. Post-
  migration the column is `TEXT NOT NULL`, so `sqlc generate` flips
  the field to `string`. Verified via `grep "AdapterImageRef"
  internal/db/models.go` showing the bare `string` type. **Phase 5's
  `FlyDeployTarget.spawn(...)` will see the non-pointer type from the
  start** — no nil-check needed at the call site, no `*ref` deref
  ceremony. This is exactly the simplification Phase 4 was meant to
  unblock; the proof is the build still passing without a single
  hand edit to `harness_adapters.sql.go`.
- **`go vet ./... && go build ./... && go test ./...` all clean
  post-regen.** No package broke against the type-flip because no
  package currently reads `AdapterImageRef`. The `internal/users`
  + `internal/agents` test suites cached against the existing
  `models.go` (only the one field changed; sqlc's regen kept
  every other field byte-identical, so the cache is honest). The
  `internal/db` package gets `[no test files]` per the codebase
  convention (sqlc-generated wrappers are tested via real
  Postgres at the domain-service level, not in isolation).

---

## Verification matrix (Phase 4 acceptance check)

| Check | Status | Evidence |
|---|---|---|
| `goose status` lists the new migration as applied | ☑ | Pre-up: `Pending`. Post-up: `goose: successfully migrated database to version: 20260426120000`. |
| `harness_adapters.adapter_image_ref` is the captured ref, `NOT NULL` | ☑ | `SELECT` returns `ghcr.io/.../@sha256:d152b3cb...`; `UPDATE ... NULL` rejected with `not-null constraint` violation. |
| The CHECK constraint rejects a tag-pinned UPDATE | ☑ | `UPDATE ... :latest` rejected with `adapter_image_ref_digest_pinned` violation; constraint name matches the migration. |
| Down + Up cycles clean | ☑ | `goose down` (105ms) → row has empty `adapter_image_ref`. `goose up` (87ms) → row has the captured digest again. End state = start state. |
| Backend build remains green after sqlc regen | ☑ | `sqlc generate` ran clean; `AdapterImageRef` field flipped `*string` → `string`; `go vet ./...` clean; `go build ./...` clean (only `go: downloading` lines, no errors); `go test ./...` clean (`internal/agents` + `internal/users` cached, consistent with no regression). |

Net: 5/5 satisfied. Phase 4 acceptance criteria all met by direct
empirical evidence (not by inspection or extrapolation).

---

## Decisions made under-the-hood (not in the plan)

- **Migration filename uses today's date at noon UTC**
  (`20260426120000_adapter_image_ref_backfill.sql`). The plan's task
  1 prescribed `goose -dir backend/migrations create
  adapter_image_ref_backfill sql`, which would auto-generate the
  filename from the wall clock. I wrote the file directly to keep
  the timestamp aligned with the system date (2026-04-26) rather
  than the build host's clock skew, and to land it strictly later
  than M2's `20260425170000_agent_catalog.sql` for ordering
  determinism. The `goose create` flow would have produced the same
  shape; manual creation just removes one indirection. **The
  filename ordering is what guarantees `goose up` runs M2 before
  Phase 4's M3 migration** — names are sorted lexically; the
  YYYYMMDDHHMMSS prefix is the canonical sort key.
- **Audit-comment block expanded over the plan's sketch.** Plan §Phase
  4 task 2 had six audit fields (`registry_ref`, `tag`, `digest`,
  `captured_at`, `captured_via`, `blueprint`). The implemented
  comment adds a seventh — `built_from`, naming the upstream Hermes
  digest from Phase 1/2 — and a paragraph about why the manifest-
  list digest is non-deterministic across rebuilds (BuildKit
  attestation timestamps; Phase 2 finding). Future readers of the
  schema can answer "where did this digest come from, and why does
  the next rebuild produce a different one?" entirely from the SQL
  file, without having to triangulate across the three M3 completion
  docs.
- **CHECK pattern uses `LIKE '%@sha256:%'`, deliberately permissive
  on registry host.** Plan's Phase 4 insight already argued for this
  shape; reaffirmed in implementation. Pinning `'ghcr.io/%@sha256:%'`
  would lock in the operational choice of where the image lives,
  while what matters for §11.2 is the *governance property*
  (digest-pinned). When v2 might host the image on Fly's own
  registry, a self-hosted Harbor, or a future internal Corellia
  registry, the CHECK survives the move with no schema migration.
  Same reasoning M2 used for `upstream_image_digest LIKE 'sha256:%'`
  — both columns now have permissive-but-strict CHECKs that enforce
  the rule without locking in the location.
- **`ALTER TABLE` block uses one statement with two clauses, not
  two separate `ALTER TABLE` statements.** Plan's snippet did the
  same. Single statement is more atomic for Postgres's catalog
  bookkeeping (one DDL lock acquisition instead of two), and reads
  more honestly as "tighten this column with two related
  constraints" rather than "make two unrelated changes that happen
  to be on the same column."
- **Verification fired three independent SQL probes, not one.** Plan
  task 4 prescribed verification of (a) the post-UPDATE value, (b) a
  CHECK rejection. The implemented verification adds (c) a NULL
  rejection — which exercises the *separate* `NOT NULL` constraint
  added by the same `ALTER` statement. A passing CHECK doesn't imply
  a passing NOT NULL; both are independently enforced and both can
  in principle fail independently if the migration shape is wrong.
  The third probe takes 200ms and adds confidence that the migration
  did *all* of what it advertised, not just the most-conspicuous
  half.
- **Sourced `backend/.env` manually via `set -a; source .env; set
  +a` for `goose` invocations.** Direnv isn't installed in this
  shell session (CLAUDE.md flags this fallback as the documented
  alternative). The manual sourcing exposes `$DATABASE_URL_DIRECT`
  to the goose subprocess, with `set -a` ensuring all sourced
  variables are exported (without it, `source` only sets shell-
  local variables, which goose can't read). This is the
  documented-fallback path; functionally identical to direnv-loaded
  invocations.

---

## What this means for Phase 5

Phase 5 implements `internal/deploy/` with `DeployTarget` interface
+ `FlyDeployTarget` concrete type. The Phase 4 → Phase 5 coupling is
*structural*, not *protocol*:

1. **`adapter_image_ref` is non-nil at read time.** Phase 5's
   `FlyDeployTarget.spawn(...)` receives an `AgentInstance` (or
   reads its referenced `HarnessAdapter` row), pulls
   `AdapterImageRef`, and passes it as the `image` field of Fly's
   Machines API request body. Pre-Phase 4: the field was `*string`;
   any caller would have needed `if ref == nil { return error }`
   defensive logic. Post-Phase 4: the field is `string` and is
   structurally guaranteed non-empty (the CHECK forbids tag-pinned,
   the NOT NULL forbids absence, but neither forbids the empty
   string per se — see "Risks" below). The deploy code can pass it
   to the API call directly, no nil-check.
2. **The CHECK is a governance backstop, not the only line of
   defence.** Phase 5's Go-level type system catches obvious bugs
   (e.g., passing a tag instead of a digest from an in-Go test
   fixture); the SQL CHECK catches what the Go layer *can't* (e.g.,
   an operator with `psql` access running an UPDATE, a future seed
   script, an ad-hoc migration written under time pressure). Both
   layers should agree on the shape of a valid ref; if they ever
   diverge, the SQL CHECK is the authoritative one.
3. **Phase 2's "the API path doesn't double-resolve manifest-list
   digests" finding becomes load-bearing.** Phase 5's HTTP call to
   Fly's Machines API passes the `@sha256:...` digest in the
   `image` field; Fly's API resolves it to the per-arch manifest
   server-side. The CLI's known double-resolution quirk (Phase 2
   §"Tag-form rehearsal" finding) does *not* apply here. This is one
   of the reasons §11.1 ("no Fly outside `FlyDeployTarget`")
   matters: the abstraction lets the Go code use the API path's
   invariants without every caller knowing about the CLI's
   pathologies.

Phase 5 does not need to read this completion doc to know the column
is now `NOT NULL`; the regenerated `models.go` already advertises the
non-pointer type. The completion doc captures the *why* and the
*audit chain*; the type system captures the *what* and the *how*.

---

## Pre-work tasks status

The plan's §3 pre-work checklist is fully closed by Phase 4:
- ☑ Database connection (`$DATABASE_URL_DIRECT` available; sourced
  manually from `backend/.env` per the documented fallback).
- ☑ Goose binary present (`~/go/bin/goose`).
- ☑ M2 migration applied (`goose status` confirmed
  `20260425170000_agent_catalog.sql` was already applied; the
  `harness_adapters` row to update was present).
- ☑ Phase 2 captured-metadata block (the source of truth for the
  digest the migration writes).

Branch hygiene remains soft (same as Phases 1–3); the migration file
is uncommitted alongside the rest of the M3 working tree.

---

## Risks / open issues opened by Phase 4

- **The CHECK doesn't reject empty-string refs.** `LIKE
  '%@sha256:%'` requires `@sha256:` to appear *somewhere* in the
  string; a literal `'@sha256:'` (8 characters, no registry, no
  hash) would pass. Pre-existing properties make this benign at the
  application layer (Go's typed proto messages would never produce
  such a ref; sqlc's typed wrappers would never write one), but it's
  a strict-validation hole the constraint *could* close by tightening
  to `LIKE '%/%@sha256:%' AND length(adapter_image_ref) > 32` (a
  registry path + hex digest minimum length). Deferred — adding
  bytes-of-validation that no current caller would ever bypass falls
  under CLAUDE.md's "don't add validation for scenarios that can't
  happen." If a future seed script or CLI tool ever generates the
  empty-shell ref, the constraint can tighten then.
- **The migration is irreversible *in spirit* even though reversible
  *in syntax*.** The down block restores the schema shape (drops the
  CHECK, drops the NOT NULL, sets the row back to NULL), but: (a) the
  captured digest (`d152b3cb...`) is recorded in the SQL file's audit
  comment and in any DB backup snapshot taken between the up and the
  down — the down doesn't erase that history; (b) Phases 5–8 build
  on top of "the column is non-null" as an axiom, so a Phase 4
  rollback in production *without* a corresponding Phase 5+ rollback
  would silently start passing a `NULL` ref to Fly's API. Mitigation
  in production: never `goose down` Phase 4 in isolation; always pair
  with a Phase 5+ rollback if that ever becomes necessary. v1 is
  pre-production so this is theoretical, but worth recording for
  the eventual production runbook.
- **No CI hook for `goose up && goose down && goose up` round-trip
  testing.** Phase 4's verification ran the round-trip manually
  (down, observe empty, up, observe digest); a CI job that does the
  same against a throwaway Postgres container would catch
  migrations whose down blocks regress. Today the verifier is the
  developer's diligence at migration write-time. Bundle into the
  same post-v1 CI work that adds `bash -n` for shell scripts and
  `sqlc diff` for query-file drift.
- **The `harness_adapters.sql.go` Scan call structurally relies on
  the column order in the generated `SELECT`.** After the type-flip,
  the Scan still reads into `&i.AdapterImageRef` at position 4,
  which is now a `string` instead of a `**string`/`*string`. pgx's
  scan logic accepts both for non-NULL values; the type-flip is
  Scan-compatible. **If a future migration ever made the column
  nullable again** (which would be a regression of §11.2 but
  syntactically possible), pgx would error at scan time on any row
  with `NULL` in that column. The right shape is to never let that
  migration happen — but if it does, the failure mode is at least
  loud (a Scan error at deploy time) rather than silent.
- **Three places now hold the digest string** (migration UPDATE,
  `smoke.sh` default IMAGE, Phase 2 completion doc). The Phase 8
  changelog will add a fourth. A future digest bump needs a
  coherent edit across all four. There's no automated check that
  flags drift; the bump runbook (post-v1) should list the four
  sites explicitly. Adding a `tools/check-digest-coherence.sh`
  script is a 10-LOC follow-up that grep-counts the digest across
  the tree and asserts equality; deferred until the first bump
  happens.
- **The `ALTER ... DROP NOT NULL` in the down block doesn't restore
  the column's pre-M3 *comment*** (M2's `-- filled by M3 once
  corellia/hermes-adapter is built+pushed`). Postgres column
  comments are a separate ALTER (`COMMENT ON COLUMN`); M2 didn't
  use one (the comment was a SQL-file comment, not a database
  comment), so this is a non-issue today. Flagged because the
  general pattern — "down blocks should reverse *all* of what the
  up block did, including documentation artefacts" — is worth
  keeping in mind as the migration corpus grows.

---

## What's still uncommitted

Phase 4 produces two file diffs in the repo:

- `backend/migrations/20260426120000_adapter_image_ref_backfill.sql`
  (new, 56 LOC)
- `backend/internal/db/models.go` (regenerated; 1-line type-flip on
  `AdapterImageRef`)

Both untracked / unstaged, joining the M3 working tree (Phases 1
+ 3's adapter source files, Phase 4's migration + sqlc-regen). The
migration is the first M3 artefact whose application is **already
durable on the dev database** — even if the working-tree files
are not committed, the schema change has been applied. Re-running
`goose status` would show the migration as applied; tearing the
DB down and re-bootstrapping from `goose up` would reapply it
cleanly because the migration file exists in the working tree (the
`goose up` reads from disk, not git). Branch hygiene therefore
matters more starting here than it did for Phases 1–3 — the
working-tree migration file is *the* canonical record of what
schema state the running DB is in. Losing it (a `git clean -fd`
mishap, an accidental `rm`) would mean the DB has a row goose
doesn't know how to manage.

---

`★ Insight ─────────────────────────────────────`
- **Phase 4 is the smallest M3 phase by LOC and the largest by
  governance impact.** 56 lines of SQL + a 1-line generated-code
  type-flip closes blueprint §11.2's enforcement gap on the
  *adapter* digest column. Pre-Phase 4, §11.2 was fully encoded
  for the *upstream* digest and partially encoded for the
  *adapter* digest (Go-level convention only; no SQL-level
  backstop). Post-Phase 4, both columns have CHECK constraints
  that an operator with `psql` access cannot bypass without
  explicit constraint-violation. This is exactly the
  "defence-in-depth across application + database" shape M2's
  Phase 1 completion doc argued for; Phase 4 finishes the
  argument.
- **The type-flip from `*string` → `string` is what makes Phase 5
  ergonomic.** Without Phase 4, `FlyDeployTarget.spawn(...)` would
  start with `if adapter.AdapterImageRef == nil { return
  fmt.Errorf("adapter ref is nil — migration not applied?") }` —
  defensive code that exists only because the schema's previous
  state was looser than the application's invariants demanded.
  Phase 4 lets the schema's invariants match the application's
  invariants exactly; the defensive nil-check disappears, the
  call site reads as `req.Image = adapter.AdapterImageRef`, the
  Phase 5 code is one expression-arity simpler. **This is
  type-driven design at the database layer**: tighten the schema
  to the strongest invariant the application needs, and the
  generated types eliminate entire classes of error-handling
  branches at the call site for free.
- **The "audit-comment-as-archaeology" pattern in this migration
  matters for a non-obvious reason: it makes the schema
  *reproducible from the SQL file alone*.** A new operator in 6
  months who runs `goose up` on a fresh DB gets the captured
  digest from M2 + the captured digest from M3, both with full
  provenance comments naming when and how they were obtained. No
  "where did this magic string come from?" question, no
  cross-referencing the completion doc tree. The SQL file is
  self-documenting in the same way M2's seed-comment block was.
  This generalizes: any migration that imports an externally-
  captured fact (a digest, a Cosign certificate identity, a Fly
  app ID, a third-party service's webhook secret) should carry
  the capture provenance in a SQL comment. The cost is ~10 lines
  of SQL comment per fact; the value is the migration corpus
  doubling as a forensic trail. Worth establishing as
  codebase-wide practice now, before the schema grows past the
  point where retroactive archaeology becomes expensive.
`─────────────────────────────────────────────────`

---

*(Phase 5 — `internal/deploy/` package with `DeployTarget`
interface + `FlyDeployTarget` concrete type — is next.)*
