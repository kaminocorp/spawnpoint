# Phase 1 Completion — Agent Catalog: Schema migration + seed

**Plan:** `docs/executing/agent-catalog.md` §Phase 1
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete; all four acceptance checks green

This phase landed the first product schema in Corellia: `harness_adapters` + `agent_templates`, plus one seed row in each (the Hermes adapter and its companion catalog template). It is the first time blueprint §11.2 (digest-pinning) is enforced on real data — and the first time any architectural rule is enforced *at the database layer* via a CHECK constraint, not just at the application layer.

---

## Index

- **New file.** `backend/migrations/20260425170000_agent_catalog.sql` — single migration containing schema + seed. Goose-applied in 102ms; Down + Up cycle reproduces an md5-identical state.
- **Two new tables.** `harness_adapters` (id, harness_name UNIQUE, upstream_image_digest CHECK `LIKE 'sha256:%'`, adapter_image_ref NULL, source CHECK IN ('hand_written','generated'), generated_at, validated_at, timestamps) and `agent_templates` (id, name, description, harness_adapter_id FK, default_config JSONB, created_by_user_id NULL FK→users, timestamps).
- **Two seed rows.** `harness_adapters('hermes', 'sha256:d4ee57f2...', 'hand_written')` + `agent_templates('Hermes', '...description...', <FK>, '{}')`. Both inserts are idempotent (`ON CONFLICT DO NOTHING` on the unique `harness_name` index; `WHERE NOT EXISTS` subquery on the template).
- **Pin audit embedded in SQL.** Six-line comment block records `registry_ref`, `resolved_tag`, `digest`, `captured_at`, `captured_via`, and the blueprint reference. Decision 22 is encoded in the migration source itself, not as a sidecar artefact.
- **Registry-path correction discovered.** Blueprint §1 names `ghcr.io/nousresearch/hermes-agent`; the canonical published location is `docker.io/nousresearch/hermes-agent` (Docker Hub). Migration uses the real path; flagged as a doc-correction follow-up below — *not* edited from this phase's scope.
- **Validation matrix.** All four Phase 1 acceptance checks pass: seed rows present + joined; `adapter_image_ref IS NULL`; CHECK constraints reject `'latest'` and `'imported'`; Down + Up state hashes are byte-identical (md5 `112f7821...` for adapters, `08172038...` for templates, before *and* after the cycle).
- **Plan compliance.** Migration body, table schemas, seed shape, and Down block follow `docs/executing/agent-catalog.md` §Phase 1 task 2 verbatim. Two practical deviations from the *plan's pre-work checklist* — both substituted equivalent tooling, no semantic change to decision 22:
  - `crane` was not installed on the capture host. Used Docker Hub's HTTP API + `docker buildx imagetools`-equivalent verification via the registry's `/v2/.../manifests/<digest>` HEAD endpoint, which returns the same multi-arch OCI image index `crane digest` would have surfaced.
  - `direnv` was not installed. Used the `set -a; source backend/.env; set +a` fallback documented in `CLAUDE.md` §Environment for goose invocations.

---

## Pre-work — capturing the upstream digest

Decision 22 in the plan is the load-bearing governance step. Three substeps, executed in order, with concrete results.

### Step 1 — pick a version tag (not `:latest`)

Before resolving any digest, we needed the right *tag* to resolve. The plan says explicitly: not `:latest`, because `:latest` is mutable and tells you nothing about *which release* you're pinning.

**What I tried first that didn't work.** The plan's pre-work command (`crane ls ghcr.io/nousresearch/hermes-agent`) couldn't run — `crane` isn't installed on this host (`command -v crane` → not found). Fell back to the curl + jq path. That hit a `NAME_UNKNOWN` from GHCR:

```
GET https://ghcr.io/v2/nousresearch/hermes-agent/tags/list
→ {"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry"}]}
```

Probed several path variants (`nous-research/hermes-agent`, `nousresearch/hermes`, `nousresearch/hermes-llm-engine`, `nousresearch/hermes-function-calling`) — all 404. The image isn't on GHCR.

**What I tried second that worked.** Docker Hub:

```
GET https://hub.docker.com/v2/repositories/nousresearch/hermes-agent/
→ {"name":"hermes-agent", "namespace":"nousresearch", "status":1,
   "pull_count":497794, "last_updated":"2026-04-25T04:11:26.664618Z", ...}
```

Active, 497k pulls, last updated *today* (2026-04-25). The image exists at `docker.io/nousresearch/hermes-agent`, **not** `ghcr.io/nousresearch/hermes-agent` as `docs/blueprint.md` §1 states. This is a real doc discrepancy — see "Doc corrections owed" below.

Tag listing on Docker Hub:

```
GET https://hub.docker.com/v2/repositories/nousresearch/hermes-agent/tags?page_size=100
→ Six tags total:
   latest         2026-04-25T04:11  sha256:8b79003f...  (mutated today)
   v2026.4.23     2026-04-23T22:59  sha256:d4ee57f2...
   v2026.4.16     2026-04-16T20:28  sha256:14ba9a26...
   v2026.4.13     2026-04-14T20:52  sha256:fa9237f9...
   v2026.4.8      2026-04-08T12:03  sha256:de8d6405...
   v2026.4.3      2026-04-03T18:22  sha256:a92b8502...
```

**Picked `v2026.4.23`** — the highest stable version tag. Notable: `:latest` was repushed today (2026-04-25) but Nous hasn't yet versioned it. Pinning `:latest`'s digest would have meant pinning *yesterday's HEAD-of-line*, not a release. `v2026.4.23` is the most recent point Nous explicitly tagged as a release, which is the granularity we want for a governance pin.

### Step 2 — resolve the tag to its manifest-list digest

Plan command was `crane digest ghcr.io/nousresearch/hermes-agent:<TAG>`. With `crane` unavailable, used Docker Hub's tag-listing API (which embeds the digest inline) cross-checked against the registry's manifest endpoint.

From the tag listing in Step 1, `v2026.4.23` resolves to:

```
sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338
```

### Step 3 — verify pullability

Plan command was `crane manifest <ref>@<digest>`. Substituted with a registry HEAD request on the manifest endpoint, which `crane manifest` would have wrapped:

```
HEAD https://registry-1.docker.io/v2/nousresearch/hermes-agent/manifests/sha256:d4ee57f2...
Authorization: Bearer <docker-token>
Accept: application/vnd.oci.image.index.v1+json,
        application/vnd.docker.distribution.manifest.list.v2+json,
        application/vnd.docker.distribution.manifest.v2+json

→ HTTP/2 200
  content-type: application/vnd.oci.image.index.v1+json
  docker-content-digest: sha256:d4ee57f2...
  content-length: 1609
```

Two pieces of evidence in this response:

1. **`200 OK`** — digest is reachable from this network with anonymous credentials; matches what Fly will see at pull time.
2. **`Content-Type: application/vnd.oci.image.index.v1+json`** — multi-arch OCI image index. This is the right *granularity* per decision 22: the index is itself content-addressed, the per-platform manifests it references are also content-addressed, so pinning the index pins the entire content tree transitively.

### Step 4 (bonus) — inspect the platforms the index references

Not in the plan, but useful for the audit trail. Pulled the index body:

```json
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    { "digest": "sha256:7ed5f22e...", "platform": "linux/amd64" },
    { "digest": "sha256:7c4f6f4e...", "platform": "linux/arm64" },
    { "digest": "sha256:2ed504d3...", "platform": "unknown/unknown" },
    { "digest": "sha256:dc2507a5...", "platform": "unknown/unknown" }
  ]
}
```

Two real platforms (`linux/amd64` + `linux/arm64`) — Fly's defaults are amd64, so it'll resolve to `sha256:7ed5f22e...` at pull time. The two `unknown/unknown` entries are attestation layers (typically SBOM + provenance, attached by buildx). Worth recording for forensic traceability: when M3 builds the adapter `FROM ...@sha256:d4ee57f2...`, the FROM resolves transitively to `sha256:7ed5f22e...` for the amd64 build target.

---

## What was written, where, why

### File: `backend/migrations/20260425170000_agent_catalog.sql`

The migration is one file, one transaction (goose handles transaction boundaries per file). Three blocks:

1. **Schema.** `CREATE TABLE harness_adapters (...)` + `CREATE TABLE agent_templates (...)`. Both follow `docs/executing/agent-catalog.md` §Phase 1 task 2 verbatim. Constraints exactly as decisions 4–9 specified: digest-format CHECK, source-enum CHECK, FK from `agent_templates.harness_adapter_id` to `harness_adapters.id`, nullable `created_by_user_id` FK to `users.id` (NULL = system seed).

2. **Pin audit comment.** Six lines above the first INSERT. Encodes:
   ```
   registry_ref:  docker.io/nousresearch/hermes-agent
                  (NOT ghcr.io/... as docs/blueprint.md §1 states; the GHCR
                   path does not exist; the canonical published location is
                   Docker Hub)
   resolved_tag:  v2026.4.23                                        -- highest stable version tag (NOT :latest)
   digest:        sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338
                  -- multi-arch OCI image index; references linux/amd64 + linux/arm64
   captured_at:   2026-04-25
   captured_via:  Docker Hub registry HEAD against the manifest endpoint;
                  cross-checked against hub.docker.com/v2/.../tags?page_size=100.
                  `crane digest` would be the preferred tool but was not installed
                  on the capture host; the registry HEAD response carried
                  Content-Type: application/vnd.oci.image.index.v1+json which
                  is the same artefact `crane digest` returns.
   blueprint:     §11.2 (digest-pinning is non-negotiable)
   ```
   This is the load-bearing governance artefact in Phase 1. **Why in the migration source rather than a sidecar doc:** migrations are immutable once applied — `git blame` will always show this comment alongside the row that pins. A sidecar doc rotates with edits and could drift from the migration; embedding makes drift impossible. Future auditor reads the migration, sees the audit, can independently verify ("does v2026.4.23 still resolve to that digest? does that digest still exist?") without context-switching to a separate file.

3. **Two INSERTs** for the seed rows. The `harness_adapters` INSERT uses `ON CONFLICT (harness_name) DO NOTHING` (idempotent on the unique index). The `agent_templates` INSERT uses `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM agent_templates t WHERE t.harness_adapter_id = ha.id)` because there's no natural unique key on `agent_templates` (post-v1 will allow multiple templates per adapter, so a unique index would have to be dropped later). The `WHERE NOT EXISTS` subquery encodes the v1 invariant ("one template per adapter") in the seed without requiring a unique index.

4. **Down block.** `DROP TABLE IF EXISTS agent_templates; DROP TABLE IF EXISTS harness_adapters;` — strict LIFO with `IF EXISTS` guards. Verified re-runnable; see Validation §4.

---

## Validation — four acceptance checks executed

All four checks per `docs/executing/agent-catalog.md` §Phase 1 acceptance ran clean against the live Supabase project (host `db.vkjfktjhkdlbalbsggvf.supabase.co`).

### Check 1 — `goose status` lists the migration as applied; seed rows present + joined

```
goose status:
  Fri Apr 24 03:53:27 2026 -- 20260424120000_initial_schema.sql
  Fri Apr 24 03:53:27 2026 -- 20260424140000_auth_user_provisioning.sql
  Sat Apr 25 04:42:26 2026 -- 20260425170000_agent_catalog.sql      ← applied

SELECT t.name, t.description, ha.harness_name,
       ha.upstream_image_digest, ha.adapter_image_ref, ha.source
FROM agent_templates t
JOIN harness_adapters ha ON ha.id = t.harness_adapter_id;
→ 1 row:
  template     | harness_name | upstream_image_digest                     | adapter_image_ref | source
  Hermes       | hermes       | sha256:d4ee57f254aabbe10e41c49533bbf3eb98e... | NULL              | hand_written
```

### Check 2 — `adapter_image_ref IS NULL` (M3 fills)

```
SELECT adapter_image_ref IS NULL FROM harness_adapters WHERE harness_name = 'hermes';
→ t
```

Confirmed. M3's migration (separate plan) will fill this column with the built adapter's digest and tighten to `NOT NULL` via `ALTER TABLE`.

### Check 3 — CHECK constraints reject bad input

Three test inserts, each in a `BEGIN; INSERT ...; ROLLBACK;` block so no rows persist:

```
INSERT (harness_name, upstream_image_digest) VALUES ('test-bad', 'latest');
→ ERROR: violates check constraint "harness_adapters_upstream_image_digest_check"
  (rejected — tag-style ref blocked) ✓

INSERT (harness_name, upstream_image_digest, source) VALUES ('test-source', 'sha256:abc', 'imported');
→ ERROR: violates check constraint "harness_adapters_source_check"
  (rejected — non-enum source blocked) ✓
```

**Known weakness surfaced.** A third probe — `INSERT ... VALUES ('test-empty', 'sha256:')` — was *accepted* by the constraint. The `LIKE 'sha256:%'` pattern matches zero or more chars after the prefix, so `'sha256:'` (empty hash), `'sha256:abc'` (3 chars, not 64), and even `'sha256:not-hex'` all pass. This is a real-but-narrow gap in decision 4's CHECK.

The plan's `LIKE` was deliberate (decision 4 says "format-checked: `CHECK (upstream_image_digest LIKE 'sha256:%')`"), so the migration is plan-compliant. A stricter regex check — `CHECK (upstream_image_digest ~ '^sha256:[a-f0-9]{64}$')` — would close the gap and is a one-line follow-up:

```sql
-- v2 hardening (separate migration):
ALTER TABLE harness_adapters
  DROP CONSTRAINT harness_adapters_upstream_image_digest_check,
  ADD  CONSTRAINT harness_adapters_upstream_image_digest_check
       CHECK (upstream_image_digest ~ '^sha256:[a-f0-9]{64}$');
```

Listed in "Known pending work" below. The practical risk in v1 is near-zero — empty-hash inserts only happen when someone is doing seed work with a placeholder string, and the CHECK still catches the dominant failure mode (tag-style references like `'latest'` or `'v0.3.2'`).

### Check 4 — Down + Up cycle produces identical state

Captured md5 hashes of the seed rows pre-cycle, ran `goose down` (drops both tables), confirmed both `to_regclass` are NULL, ran `goose up`, recaptured hashes:

```
pre-adapters:    112f7821037675589dede565ae9ef0ab
pre-templates:   081720385a098727b7232e52f0c9bbe8

goose down:  OK   20260425170000_agent_catalog.sql (60.06ms)
SELECT to_regclass('agent_templates') IS NULL AND to_regclass('harness_adapters') IS NULL;  → t

goose up:    OK   20260425170000_agent_catalog.sql (74.43ms)

post-adapters:   112f7821037675589dede565ae9ef0ab     ← byte-identical
post-templates:  081720385a098727b7232e52f0c9bbe8     ← byte-identical

RESULT: re-runnable (state hashes match)
```

Re-runnability confirmed at the strongest possible level (md5 over the full row content, not just row count). Even the timestamps differ between cycles — the md5 hash deliberately omits `created_at`/`updated_at` from the digest input so the comparison is on *semantically meaningful* state.

---

## Behavior change (known)

- **First product schema in the codebase.** `harness_adapters` and `agent_templates` are now real tables in the live database, with two real seed rows. Anything reading `auth.users` or `public.users` continues to work unchanged; the new tables are additive.
- **Architectural rule §11.2 enforced at the database level.** `CHECK (upstream_image_digest LIKE 'sha256:%')` means any future migration, ad-hoc psql session, or seed script that tries to write a tag-style reference (`'latest'`, `'v0.3.2'`, etc.) gets a constraint violation instead of silent governance erosion. This is the first time an architectural rule is enforced via a database constraint rather than convention.
- **Two new pending FKs visible to the existing schema.** `agent_templates.harness_adapter_id → harness_adapters.id` (NOT NULL) and `agent_templates.created_by_user_id → users.id` (NULL). The latter creates a soft coupling between the existing `users` table and the new catalog — deleting a user with seeded templates would fail with a FK violation (which is the correct behavior; templates outlive the user who created them). This isn't reachable in M2 (seed templates have `NULL` here) but lands the constraint shape so M3/M4 inherit it.
- **No application-code change.** `cmd/api`, `internal/*`, frontend — all unchanged. The schema exists ahead of its first reader. Phase 2 (sqlc regen) is the next reader; Phase 5 (FE catalog page) is the user-visible reader.

---

## Doc corrections owed (not executed in Phase 1; flagged for follow-up)

These are surfaced from Phase 1 work but deliberately *not* applied here — Phase 1's scope is the migration file only. Each one is a one-line edit to a different file; the user should decide which to land and when.

### 1. `docs/blueprint.md` §1 — registry path

**Current text:** `One harness: Hermes Agent (Nous Research, from `ghcr.io/nousresearch/hermes-agent`)`

**Reality:** Image is published at `docker.io/nousresearch/hermes-agent` (Docker Hub). The GHCR path does not exist (`NAME_UNKNOWN` from `ghcr.io/v2/nousresearch/hermes-agent/tags/list`).

**Recommended edit:** s/ghcr.io/docker.io/ in §1, and one line in §4 ("v1 — hand-written") which currently reads `FROM`s the upstream Hermes image via implicit `nousresearch/hermes-agent` (Docker Hub default registry, no path prefix needed). The §4 text doesn't actually name a registry, so it's already correct by accident.

**Why this matters for v1.** M3's adapter Dockerfile will need `FROM nousresearch/hermes-agent@sha256:d4ee57f2...` (Docker Hub default) — *not* `FROM ghcr.io/nousresearch/hermes-agent@sha256:...` (which would 404). Anyone reading blueprint §1 to write the Dockerfile would write the wrong FROM line and fail at build time. Worth correcting before M3 starts.

### 2. `docs/blueprint.md` §10 step 3 — sneak-peek copy

**Current text:** `**Pick harness:** catalog shows "Hermes" (others grayed out / "Coming soon").`

**Reality:** No discrepancy with the new `docs/executing/agent-catalog.md` decision 25 — blueprint already names this UX. But blueprint's framing implies "grayed out" within the same DB-backed list; the M2 plan goes with static FE cards. Worth a sentence noting that v1's "others" come from a static FE manifest, not seed rows. Optional polish.

### 3. CLAUDE.md §"Common commands" — direnv prerequisite warning

**Current text** (correct, but worth amplifying): `**Recommended local setup: install direnv** ... Without direnv, goose migrations require manual sourcing: set -a; source backend/.env; set +a`

**Suggestion:** elevate the "without direnv" fallback into a code block in §"Migrations" so it's discoverable without grep-ing §Environment. Used the fallback in Phase 1; it works exactly as documented, but a one-line example in the migrations subsection would have saved 30s of CLAUDE.md re-read time.

---

## Known pending work

- **Stricter `upstream_image_digest` CHECK constraint.** Replace `LIKE 'sha256:%'` with `~ '^sha256:[a-f0-9]{64}$'` to close the empty-hash gap surfaced in Check 3. One-line ALTER, separate migration. Low priority (no realistic attacker surface; the gap only manifests if someone hand-writes a placeholder seed). v2 hardening item.
- **Cosign / Sigstore provenance verification on the captured digest.** Today's pin is "this digest is bit-identical to what we captured at 2026-04-25." A full governance posture also verifies "this digest was signed by Nous's published signing key." When Nous publishes a Sigstore identity, add `cosign verify nousresearch/hermes-agent@sha256:d4ee57f2... --certificate-identity ...` to pre-work and a `harness_adapters.signature_verified_at TIMESTAMPTZ NULL` column. v2 hardening item; flagged in the plan's risk register.
- **`linux/amd64` per-platform digest** (`sha256:7ed5f22eac98380638e55920cf3b04cb49b8e51d39ba290c8a46f7f4cafa2d41`) is captured in this completion doc but not in the migration's audit comment. If we ever need to debug a "Fly says it pulled X but the index says Y" issue, the per-platform digest is the cross-reference. Not a Phase 1 deliverable; just noted for future forensics.
- **Doc corrections** listed in §"Doc corrections owed" above. Three one-line edits, none in Phase 1's scope. User decision on whether to fold into Phase 2's PR or hold.
- **Re-running `goose up` against an already-up DB to test the seed idempotency in *practice*.** Goose normally won't re-apply already-applied migrations — the version table guards it. So the `ON CONFLICT DO NOTHING` + `WHERE NOT EXISTS` defences are exercised only in the Down + Up cycle (Check 4). They're correct by construction, but if a future operator runs the seed inserts standalone (e.g., porting to another environment), the idempotency clauses earn their keep then.

---

## What's next — Phase 2 hand-off

Phase 2 (sqlc queries + regen) consumes the new tables. Pre-conditions for Phase 2:

- ✅ Both tables exist in the live DB (`harness_adapters`, `agent_templates`).
- ✅ One seed row in each, joined correctly.
- ✅ Migration timestamp recorded (`20260425170000`) so any cross-reference doc lands the right filename.
- ✅ Pin audit comment in the migration source (decision 22 closed).
- ⚠ `crane` not installed on this host — Phase 2 doesn't need it (regen is local Go), but if a future phase wants to verify pullability again, install `crane` first or document the registry-HEAD substitution path.

Phase 2 will write `backend/queries/harness_adapters.sql` (`GetHarnessAdapterByID :one`) and `backend/queries/agent_templates.sql` (`ListAgentTemplates :many`), then run `sqlc generate` from `backend/`. Expected new files: `internal/db/harness_adapters.sql.go`, `internal/db/agent_templates.sql.go`, plus updates to `internal/db/models.go` (gains `HarnessAdapter` + `AgentTemplate`/`ListAgentTemplatesRow` types) and `internal/db/querier.go` (gains two methods).
