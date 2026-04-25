# Plan — M2: Agent catalog (`HarnessAdapter` + `AgentTemplate` + `/agents` page)

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/plans/post-0.2.6-roadmap.md` §M2 (parent roadmap; this is its detailed plan)
- `docs/executing/onboarding-wizard.md` (M1 — runs in parallel; this plan's only coordination point with M1 is `frontend/src/app/(app)/agents/page.tsx`, where M1 ships a `ComingSoon` placeholder and M2 replaces it with real content)
- `docs/blueprint.md` §3 (harness interface contract — what an "adapter" actually adapts), §4 (adapter strategy: v1 hand-written, v2 generated; the `source` column lands in M2 because the schema needs to be future-proof from day one), §5 (digest pinning — the architectural rule M2 first exercises on real data), §9 (data model; M2 lands `harness_adapters` + `agent_templates`; v2 schema for `agent_instances` / `secrets` / `deploy_targets` waits for M4), §10 step 3 (catalog UI shape — Hermes visible, others "Coming soon"), §11.2 (digest-pinning rule), §11.4 (deferred features stub as real interfaces, not fake buttons)
- `docs/stack.md` §3 (Connect-go contract), §6 (data model + sqlc), §11.6 (no Supabase outside `auth/` + `db/`), §11.9 (handlers <30 LOC)
- `docs/changelog.md` §0.2.5 (the domain/handler/sentinel pattern this plan replicates), §0.2.6 (the auth wiring that gates the new RPC)

---

## 1. Objective

Land the **first product schema and the first product RPC**. The `/agents` route (M1's `ComingSoon` stub) becomes a real catalog rendering one card — "Hermes" — backed by:

1. A `harness_adapters` table holding the immutable identity of an adapter image (upstream Hermes digest pinned today, our adapter image ref filled in by M3).
2. An `agent_templates` table holding the user-facing catalog row (name, description, default config).
3. One **seed row** in each table, applied as part of the migration so the schema is meaningful on first apply.
4. A new `internal/adapters/` package and a new `internal/agents/` package, matching the established `users/` + `organizations/` shape (private-interface query surfaces, sentinel errors at the top of the file, thin handlers with redacted-default error mapping).
5. A new Connect RPC: `corellia.v1.AgentsService.ListAgentTemplates`. Authenticated; returns the catalog. M2 needs only this single RPC.
6. A frontend `/agents` page consuming `api.agents.listAgentTemplates()` and rendering one Hermes card with a *visibly disabled* "Deploy" button (active in M4).

After M2 lands:

- Blueprint §11.2 (digest-pinning) is enforced in the schema and exercised on real data — the seed row stores `upstream_image_digest = sha256:...`, never a tag. Sets the precedent before any subsequent migration can backslide.
- M3 (Hermes adapter image + Fly wiring) has a row to update once the adapter image is built. Specifically, M3 fills `adapter_image_ref` (NULL today) and tightens the column to `NOT NULL`.
- M4 (spawn flow) has a real `agent_template_id` to FK against from `agent_instances`.

The whole milestone is two migrations of value (schema + seed in one file), one new domain pair, one new RPC, and one FE page — but it is the structural turning point where the codebase stops being scaffolding and becomes a product.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Tables to land in M2 | **`harness_adapters` + `agent_templates`** only. `agent_instances`, `secrets`, `deploy_targets` deferred to M4 | "No table exists before its first reader" (roadmap §1). M4 is the spawn flow; until then those three tables would be schema without callers |
| 2 | Migration packaging | Single migration file (`*_agent_catalog.sql`) containing schema + seed in one transaction | Goose migrations are atomic per file; bundling means a partially-applied state is impossible. Seed re-runs are idempotent via `ON CONFLICT DO NOTHING` keyed on `harness_name` |
| 3 | `harness_adapters.adapter_image_ref` nullability | **`TEXT NULL` in M2**; M3 fills it and adds `NOT NULL` in a follow-up migration | The adapter image doesn't exist yet — making it `NOT NULL` would force an `''` placeholder that fails §11.2 in spirit ("never a tag" is meant to forbid mutable refs; an empty string is worse). Nullable + a comment saying "set by M3" is the honest schema |
| 4 | `harness_adapters.upstream_image_digest` | **`TEXT NOT NULL`**, format-checked: `CHECK (upstream_image_digest LIKE 'sha256:%')` | This is the §11.2 rule encoded in the database. Anyone tempted to write a tag-pinned row gets a constraint violation, not a silent governance hole |
| 5 | `harness_adapters.source` enum | Postgres `CHECK (source IN ('hand_written', 'generated'))` on a `TEXT NOT NULL DEFAULT 'hand_written'` column | Per blueprint §4. CHECK constraint is simpler than `CREATE TYPE` (no separate down-block step, no migration ordering for type drops). v2's generated-adapter pipeline lands without a schema change |
| 6 | `harness_adapters.manifest_yaml` / `validation_report` columns | **Deferred to v2** — not in M2's migration | Per blueprint §9 they exist on `HarnessAdapter`. Per CLAUDE.md "don't design for hypothetical future requirements," they have no caller today. v2's adapter-analysis pipeline lands them alongside its first reader |
| 7 | `agent_templates.default_config` | **`JSONB NOT NULL DEFAULT '{}'`** | Per blueprint §9 (which says JSON). Roadmap §6 OQ2 ("typed proto vs JsonValue") is closed in favor of JSON: there's exactly one template today, the catalog form (M4) drives shape, and a typed proto would be premature. Future tightening doesn't require a migration |
| 8 | `agent_templates.created_by_user_id` | **`UUID NULL REFERENCES users(id)`** — NULL means "system seed" | Honors blueprint §9 (the column is in the schema spec) without dropping dead code: today's only template is a system seed (`NULL`); the column is wired for whenever user-defined templates arrive. Cost: one nullable column. Benefit: zero schema churn at v2 |
| 9 | Org-scoping on `agent_templates` | **No `org_id` column in M2** — all templates are global | The Hermes seed is global. Blueprint §9 doesn't list `org_id` on AgentTemplate. Adding org-scoping speculatively is exactly the "design for hypothetical future requirements" CLAUDE.md forbids. When user-defined templates land, the right shape is `org_id UUID NULL` (NULL = global; non-null = org-scoped) — that's a one-column additive migration |
| 10 | Catalog read scope | **Authenticated, but not org-scoped** — every signed-in user sees every template | Mirrors the global-templates decision above. The auth-middleware gate already ensures only signed-in callers reach the RPC; that's the right scope for v1's single-template catalog |
| 11 | Proto shape: catalog response field set | **Minimal:** `id`, `name`, `description`. *Not* `default_config`, *not* `harness_name`, *not* the `harness_adapters` join | The catalog *card* needs id/name/description. `default_config` is consumed by the deploy modal (M4) — exposing it now would be unused-payload. `harness_name` and adapter details are not user-facing per blueprint §2. M4 either extends `ListAgentTemplates` or adds a `GetAgentTemplate(id) -> rich` RPC; clean to add later, painful to retract |
| 12 | Proto location | **`shared/proto/corellia/v1/agents.proto`** (new file) | One service per file convention from `stack.md` §3 |
| 13 | Backend domain split | **Two new packages:** `internal/adapters/` + `internal/agents/`. Both per CLAUDE.md "Planned packages" list | Mirrors the §9 entity split. M2 only writes one read query each (`GetByID` for `harness_adapters`, `ListGlobal` for `agent_templates`), but having both packages now means M3 (`adapters`) and M4 (`agents`) extend rather than scaffold |
| 14 | Where the join lives | **`agents.Service.ListTemplates` resolves the adapter row internally** if needed; M2 doesn't need it (catalog response is template-only). For M2 the service is a thin pass-through over `agent_templates` rows | Keeps the adapters package's first reader trivially scoped: a single `GetByID` query that nothing currently consumes — until M3/M4 do |
| 15 | sqlc query split | **`backend/queries/agent_templates.sql`** + **`backend/queries/harness_adapters.sql`**, two new files. Existing `users.sql` + `organizations.sql` untouched | Convention is one `.sql` file per table per existing layout. `harness_adapters.sql` defines `GetHarnessAdapterByID :one` (no caller in M2 — *exists* so the package compiles with non-empty surface and M3 has somewhere to add to). See decision 13's rationale |
| 16 | Service-level interfaces | Private `templateQueries` interface in `agents/service.go`; private `adapterQueries` interface in `adapters/service.go`. Both list only the methods their service touches | Established pattern from `users.userQueries` + `organizations.orgQueries`. Tight test seam, no `*db.Queries` whole-surface coupling |
| 17 | Sentinels | **`agents.ErrNotFound`** (for the future `GetAgentTemplate(id)`); **no sentinel needed for `ListAgentTemplates` in M2** — empty list is a valid response, DB errors fall through to the redacted `Internal` default arm | Matches the pattern in `organizations.go`. `ErrNotFound` is added now even though no caller surfaces it yet, because M4's `GetAgentTemplate` will consume it; pre-declaring the contract is cheaper than a service-edit-during-M4 |
| 18 | Handler error mapping | New `agentsErrToConnect` switch in `httpsrv/agents_handler.go` mirroring `users_handler.go` and `organizations_handler.go`. **Default arm logs via `slog.Error` and returns `Internal` with a generic message** — same redaction pattern from 0.2.5 post-review hardening | Non-negotiable per the post-review hardening: pgx / driver errors must not leak. Sentinels (when surfaced by a caller) flow through unredacted because their messages are part of the public contract |
| 19 | RPC mounting | Inside the existing `r.Group(...)` with `auth.Middleware(d.AuthVerifier)` in `httpsrv/server.go`, alongside `UsersService` and `OrganizationsService` | Catalog is authenticated. No unauthenticated path |
| 20 | `httpsrv.Deps` field | New `AgentsHandler corelliav1connect.AgentsServiceHandler` between `OrganizationsHandler` and `AllowedOrigin` | Matches the established alphabetical-ish-by-domain ordering. Keeps `Config` + `AuthVerifier` (config/infra) at the top, handlers in the middle, CORS at the bottom |
| 21 | `cmd/api/main.go` wiring | Instantiate `adapters.NewService(queries)` first, then `agents.NewService(queries, adaptersSvc)` if the agents service consumes adapters; M2's agents service does *not* consume adapters (catalog query touches only `agent_templates`), so wiring is just `agents.NewService(queries)` | Honest minimal wiring; M3 expands when adapters becomes a real reader |
| 22 | Seed image digest source | **Resolve a specific version tag of `ghcr.io/nousresearch/hermes-agent` (not `:latest`) to its manifest-list digest via `crane digest` (preferred) or `docker buildx imagetools inspect --format '{{ .Manifest.Digest }}'` (fallback); verify pullability post-capture; record both the resolved tag and the capture date in the migration's SQL comment** | Three governance moves in one decision: (a) starting from a version tag means we know *which release* we're pinning, not just "whatever `:latest` was when someone ran a command"; (b) `crane digest` returns the multi-arch manifest-list digest (correct granularity for an orchestrator that may run multiple host architectures), unlike `docker pull` + `docker inspect …RepoDigests` which returns the local-platform digest and is a silent footgun; (c) recording the tag + date in the SQL comment makes the pin auditable — a future reader can verify "yes, that digest was v0.3.2 as of 2026-04-25." See §6 risk register entry on cosign / Sigstore as a v2 hardening |
| 23 | Frontend asset for the card | **`lucide-react`'s `Bot` icon** in a tinted square, with the template name + description below. No Hermes logo file in M2 | Polish (logo, hero image) belongs to M4 alongside the deploy modal. M2's card is structurally complete; visually neutral |
| 24 | "Deploy" button state | **Visibly disabled** with text "Deploy" + a small "Available in v1" tooltip on hover (shadcn `Tooltip`) | Matches blueprint §11.4 (decision was the spirit of the placeholder-nav-vs-fake-button distinction in M1). The button is real — it exists, has the right label, and will be wired in M4. Today it's disabled because its handler doesn't exist yet, not because we're faking it |
| 25 | "Coming soon" cards for other harnesses | **Yes, ship 3 sneak-peek cards** (LangGraph, CrewAI, AutoGen as defaults — subject to swap based on `docs/multiagent-deployment-frameworks.md`). Source: a **static FE array**, not DB seed rows. Cards have **no Deploy button at all** (not even disabled) and a "Coming Soon" badge | The product story is "garage of harnesses" (vision.md) — showing one card today understates the breadth. Three sneak peeks signal direction without overpromising. *Why static FE, not DB seed*: a placeholder seed row would force NULL on the `harness_adapter_id` FK *or* a placeholder `harness_adapters` row that violates the §11.2 CHECK constraint. Both are worse than rendering content from the FE. *Why no Deploy button at all*: §11.4 forbids "non-functional buttons"; the cleanest compliance is "no button" (instead of a disabled button that someone might later re-enable speculatively). When a sneak-peek harness graduates, replace the static entry with a real seed row + adapter — the migration shape is the same as the M2 Hermes seed |
| 26 | Page-level loading + error states | Discriminated union with four states (`loading`, `ready`, `empty`, `error`), mirroring dashboard's pattern from 0.2.5 | Empty state ("No harnesses available") is structurally distinct from loading and error. Three render arms is the same complexity ceiling as the dashboard; consistent for the reader |
| 27 | M1 coordination | **Plan assumes M1's `(app)/agents/page.tsx` placeholder is in place at branch-cut.** If M2 lands first, M2's commit creates the file under `(app)/agents/page.tsx`; if M1 lands first, M2 overwrites the `ComingSoon` stub | One file, one direction (M2 replaces M1's stub). No bidirectional churn |
| 28 | Tests | **`backend/internal/agents/service_test.go`** with two cases: `ListAgentTemplates_HappyPath` and `ListAgentTemplates_Empty`. Pattern lifted from `users/service_test.go` — `fakeQueries` satisfying the private `templateQueries` interface | Establishes test coverage on the new package from day one; the empty case pins the discriminated-union FE contract (FE relies on `[]` being a valid happy-path response) |
| 29 | `adapters` package tests | **None in M2.** Service has no callers; testing a getter that nothing reads is busywork | Add when M3/M4 introduce the first real consumer |
| 30 | Org-scope unit test for catalog | **None.** No org-scoping to test (decision 10) | Pre-emptive simplicity — no test for behavior we deliberately don't have |

### Decisions deferred (revisit when named caller arrives)

- **`GetAgentTemplate(id) -> rich detail` RPC.** Deferred to M4's deploy-modal plan. M2's `ListAgentTemplates` returns the summary fields only; M4 either extends the response or adds a separate getter — that decision should be made when the modal's actual data shape is known.
- **`agent_templates.org_id` for user-defined templates.** Deferred to whatever plan introduces the "create your own template" flow (post-v1).
- **`harness_adapters.manifest_yaml` + `validation_report`.** Deferred to v2 per decision 6.
- **A "Coming soon" placeholder card on `/agents`** for harnesses 2…N. Deferred per decision 25.
- **Real-time catalog updates** (e.g., a new template appearing without a page refresh). Deferred — the catalog is rarely-changing, page refresh is fine for v1.

### Follow-up plans (to be written after this lands)

- **`docs/plans/hermes-adapter-and-fly-wiring.md`** (M3). Tightens `adapter_image_ref` to `NOT NULL`, builds + pushes the adapter image, fills the seed row.
- **`docs/plans/spawn-flow.md`** (M4). Reads `agent_templates` to power the deploy modal; FK's `agent_instances.agent_template_id`.

---

## 3. Pre-work checklist

Before Phase 1, confirm:

- [ ] `git status` clean; branch off `master` for M2 work.
- [ ] Backend builds + tests clean today: `cd backend && go vet ./... && go build ./... && go test ./...`.
- [ ] Frontend builds + lints clean today: `pnpm -C frontend type-check && pnpm -C frontend lint`.
- [ ] `goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" status` shows the existing migrations applied through `20260424140000_auth_user_provisioning`.
- [ ] One signed-in test user exists with `name` set (so post-M1 onboarding gate doesn't redirect during the FE check). If M1 hasn't landed yet, dashboard's stripped pre-M1 form is fine for testing — the catalog page just won't have chrome around it.
- [ ] **Capture the upstream Hermes digest** — three substeps, in order:
  1. **Pick a version tag** (not `:latest`). List Nous's published tags:
     ```bash
     crane ls ghcr.io/nousresearch/hermes-agent | sort -V | tail -20
     # OR (no crane installed):
     curl -s https://ghcr.io/v2/nousresearch/hermes-agent/tags/list \
          -H "Authorization: Bearer $(curl -s 'https://ghcr.io/token?service=ghcr.io&scope=repository:nousresearch/hermes-agent:pull' | jq -r .token)" \
          | jq -r '.tags[]' | sort -V | tail -20
     ```
     Pick the highest stable version tag (avoid `-rc`, `-beta`, `-dev`). Record below.
  2. **Resolve the tag to its manifest-list digest:**
     ```bash
     # Preferred: single-purpose tool from go-containerregistry
     crane digest ghcr.io/nousresearch/hermes-agent:<TAG>
     # Fallback if crane not installed (Docker Desktop ships imagetools):
     docker buildx imagetools inspect ghcr.io/nousresearch/hermes-agent:<TAG> --format '{{ .Manifest.Digest }}'
     ```
     Both return the multi-arch manifest list digest — the right granularity for digest-pinning a multi-platform image. **Do not** use `docker pull` + `docker inspect …RepoDigests` — that returns the per-platform digest your local daemon downloaded, which silently mismatches Fly's host arch.
  3. **Verify pullability post-capture:**
     ```bash
     crane manifest ghcr.io/nousresearch/hermes-agent@<DIGEST> >/dev/null && echo OK
     ```
     Non-zero exit means the digest isn't reachable from your network/credentials — fix before pasting into the migration.
  - **Resolved tag:** `<paste-here>` (fill at execution start)
  - **Captured digest:** `sha256:<paste-here>` (fill at execution start)
  - **Capture date:** `2026-04-25` (or actual execution date)
  - These three values are pasted into the migration's SQL comment (Phase 1, task 2) so the pin is auditable. Decision 22.

---

## 4. Implementation phases

Six phases. Each phase is independently verifiable: schema lands clean before any Go code reads it; queries compile cleanly before any service references them; service compiles cleanly before any handler wires it; FE consumption comes last. This is the same vertical-slice discipline 0.2.5 used.

### Phase 1 — Schema migration + seed (`backend/migrations/`)

**Goal:** the database knows about harness adapters and agent templates, with one row in each.

**Tasks**

1. **Create the migration file.** Filename: `backend/migrations/20260425170000_agent_catalog.sql` (timestamp at plan-execution time; bump if a different migration has landed in between).

2. **Up block.** Single transaction (goose handles this implicitly per file). Order:
   ```sql
   -- +goose Up

   CREATE TABLE harness_adapters (
       id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
       harness_name           TEXT        NOT NULL UNIQUE,
       upstream_image_digest  TEXT        NOT NULL CHECK (upstream_image_digest LIKE 'sha256:%'),
       adapter_image_ref      TEXT        NULL,    -- filled by M3
       source                 TEXT        NOT NULL DEFAULT 'hand_written'
                                                   CHECK (source IN ('hand_written', 'generated')),
       generated_at           TIMESTAMPTZ NULL,
       validated_at           TIMESTAMPTZ NULL,
       created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   CREATE TABLE agent_templates (
       id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
       name                TEXT        NOT NULL,
       description         TEXT        NOT NULL,
       harness_adapter_id  UUID        NOT NULL REFERENCES harness_adapters(id),
       default_config      JSONB       NOT NULL DEFAULT '{}'::jsonb,
       created_by_user_id  UUID        NULL     REFERENCES users(id),  -- NULL = system seed
       created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   -- Seed: Hermes harness adapter + matching agent template.
   --
   -- Pin audit (decision 22):
   --   resolved_tag:  <TAG>                  -- e.g. v0.3.2 (NOT :latest)
   --   digest:        sha256:<DIGEST>        -- multi-arch manifest list digest
   --   captured_at:   2026-04-25             -- via `crane digest`
   --   blueprint:     §11.2 (digest-pinning)
   INSERT INTO harness_adapters (harness_name, upstream_image_digest, source)
   VALUES ('hermes', 'sha256:<DIGEST>', 'hand_written')
   ON CONFLICT (harness_name) DO NOTHING;

   INSERT INTO agent_templates (name, description, harness_adapter_id, default_config)
   SELECT
       'Hermes',
       'Nous Research''s open-source tool-using agent. OpenAI-compatible chat with first-class function calling.',
       ha.id,
       '{}'::jsonb
   FROM harness_adapters ha
   WHERE ha.harness_name = 'hermes'
     AND NOT EXISTS (
         SELECT 1 FROM agent_templates t WHERE t.harness_adapter_id = ha.id
     );
   ```

3. **Down block.** Strict LIFO with `IF EXISTS` guards:
   ```sql
   -- +goose Down
   DROP TABLE IF EXISTS agent_templates;
   DROP TABLE IF EXISTS harness_adapters;
   ```
   No data preservation required (the only data is the seed; re-applying Up replays it).

4. **Apply.**
   ```bash
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
   ```

5. **Verify in psql.**
   ```sql
   SELECT harness_name, upstream_image_digest, adapter_image_ref, source FROM harness_adapters;
   SELECT t.name, t.description, ha.harness_name
   FROM agent_templates t
   JOIN harness_adapters ha ON ha.id = t.harness_adapter_id;
   ```
   Expect: one `hermes` row in `harness_adapters` with the captured digest and `NULL` adapter_image_ref; one `Hermes` row in `agent_templates` joining to it.

6. **Re-runnability test.**
   ```bash
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" down
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
   ```
   Should produce the same end state. The Up block's `ON CONFLICT DO NOTHING` + `WHERE NOT EXISTS` make a re-applied Up idempotent if Down ever fails to clean up (defence-in-depth — shouldn't happen, costs nothing).

**Acceptance**

- `goose status` lists `20260425170000_agent_catalog` as applied.
- The two seed rows are present and joined correctly.
- Down + Up cycles produce the same end state.
- The CHECK constraint rejects a non-`sha256:` insert (verify by hand once: `INSERT ... VALUES ('test', 'latest', ...)` → constraint violation; rollback).

`★ Insight ─────────────────────────────────────`
- The `CHECK (upstream_image_digest LIKE 'sha256:%')` constraint encodes blueprint §11.2 in the database itself, not just in code. This is a **defense-in-depth move that costs almost nothing**: Go-level validation can be bypassed by anyone with `psql` access (operators, future seed scripts, ad-hoc migrations); a CHECK constraint cannot. The pattern is: when an architectural rule maps to a column-level invariant, the database is the right place to enforce it.
- The `WHERE NOT EXISTS` guard on the second seed `INSERT` is the standard "idempotent seed via composite key" idiom. The `harness_adapters` seed uses `ON CONFLICT (harness_name)` because the table has a unique index; `agent_templates` doesn't have a natural unique key (you can have two templates per adapter post-v1), so the `NOT EXISTS` subquery encodes the v1 invariant ("one template per adapter") in the seed without requiring a unique index that we'd have to drop later.
- Bundling schema + seed in one migration is a deliberate exception to the "schema migrations don't carry data" rule. The data here is **part of the schema's correctness contract** — without the Hermes seed, every read query returns empty and the entire `/agents` page is a debug surface. When seed data is "what makes the schema meaningful on first apply," it belongs in the same migration; when it's bulk fixture data for tests, it doesn't.
`─────────────────────────────────────────────────`

---

### Phase 2 — sqlc queries + regen

**Goal:** typed Go query functions for the new tables exist on `db.Queries`. Existing queries unaffected.

**Tasks**

1. **New file: `backend/queries/harness_adapters.sql`.**
   ```sql
   -- name: GetHarnessAdapterByID :one
   SELECT * FROM harness_adapters WHERE id = $1;
   ```
   Single query. No caller in M2; M3 adds `UpdateAdapterImageRef`.

2. **New file: `backend/queries/agent_templates.sql`.**
   ```sql
   -- name: ListAgentTemplates :many
   SELECT id, name, description, default_config
   FROM agent_templates
   ORDER BY created_at ASC;
   ```
   The column projection is **deliberately narrower than `SELECT *`** — sqlc's generated row type matches the selected columns, so the Go-side `ListAgentTemplatesRow` (or whatever sqlc names it) won't have `harness_adapter_id`, `created_by_user_id`, or timestamps. This shrinks the surface the FE-facing service can leak. M4 either adds a wider query or extends this one.

3. **Run codegen.**
   ```bash
   cd backend && sqlc generate
   ```
   Inspect:
   - `backend/internal/db/agent_templates.sql.go` — new file, contains `ListAgentTemplates` + the row type.
   - `backend/internal/db/harness_adapters.sql.go` — new file, contains `GetHarnessAdapterByID` + the standard `HarnessAdapter` row type.
   - `backend/internal/db/models.go` — gains `HarnessAdapter` and (since `agent_templates.sql` projects narrowly) the `ListAgentTemplatesRow` struct, plus the standard `AgentTemplate` if any other query projects `*`.

     Important: `default_config JSONB` maps via pgx to `[]byte` by default in sqlc. Confirm that's what we want for M2 (it is — the FE never receives this field; M4 either parses it server-side or marshals to a JSON string in the proto).

   - `backend/internal/db/querier.go` — gains `GetHarnessAdapterByID` and `ListAgentTemplates` on the `Querier` interface.

4. **`go vet ./... && go build ./...`** — must pass before moving to Phase 3.

**Acceptance**

- `sqlc generate` produces clean output, no warnings.
- All four generated artefacts are present (`agent_templates.sql.go`, `harness_adapters.sql.go`, updated `models.go`, updated `querier.go`).
- `go build ./...` clean; existing `users` and `organizations` services unaffected.
- `git diff` on generated code shows only additive changes (new types, new methods on `Queries`, new entries on `Querier` interface).

`★ Insight ─────────────────────────────────────`
- sqlc's "the query is the schema of the row type" model means **column projection is API design, not optimization**. Writing `SELECT id, name, description, default_config` instead of `SELECT *` produces a different Go struct — one that physically cannot leak `created_by_user_id` to a downstream consumer. This is the cheapest possible authorization-through-typing technique in the codebase.
- The codebase relies on `emit_pointers_for_null_types: true` (from 0.1.0's sqlc.yaml). This means `agent_templates.created_by_user_id` would be `*uuid.UUID` if we projected it — but we're not, so the question is moot. Worth flagging because it's the kind of detail that re-emerges every time a new nullable column lands; the global flag handles it without per-column overrides.
`─────────────────────────────────────────────────`

---

### Phase 3 — Proto + buf regen

**Goal:** `corellia.v1.AgentsService` exists with one RPC; Go server stubs and TS client stubs are committed.

**Tasks**

1. **New file: `shared/proto/corellia/v1/agents.proto`.**
   ```proto
   syntax = "proto3";
   package corellia.v1;

   option go_package = "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1;corelliav1";

   service AgentsService {
     rpc ListAgentTemplates(ListAgentTemplatesRequest) returns (ListAgentTemplatesResponse);
   }

   message ListAgentTemplatesRequest {}
   message ListAgentTemplatesResponse {
     repeated AgentTemplate templates = 1;
   }

   message AgentTemplate {
     string id = 1;
     string name = 2;
     string description = 3;
   }
   ```
   Three fields; matches decision 11. M4 extends — either adds `default_config` to this message (additive, safe) or adds a `GetAgentTemplate(id) -> RichAgentTemplate` RPC.

2. **Regen.**
   ```bash
   pnpm proto:generate
   ```
   Inspect:
   - `backend/internal/gen/corellia/v1/agents.pb.go` — new.
   - `backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go` — new; provides `AgentsServiceHandler` interface and `NewAgentsServiceHandler` factory.
   - `frontend/src/gen/corellia/v1/agents_pb.ts` — new; exports `AgentsService` descriptor and the message classes.

3. **Build sanity.**
   ```bash
   cd backend && go build ./...
   pnpm -C frontend type-check
   ```
   Both clean. (No callers yet — this phase only verifies that generation produces valid code.)

**Acceptance**

- All three generated files committed.
- Both stacks build clean.
- `git diff` on generated code is purely additive; existing generated files for users/organizations untouched.

---

### Phase 4 — Backend domain + handler

**Goal:** `agents.Service.ListAgentTemplates` exists, the `AgentsHandler` Connect implementation exists, the router mounts it inside the auth group, and the wiring in `main.go` is complete. The full RPC round-trips end-to-end with `curl` (verified in Phase 6).

**Tasks**

1. **New package: `backend/internal/adapters/`.**

   File: `backend/internal/adapters/service.go`.
   ```go
   package adapters

   import (
       "context"
       "errors"

       "github.com/google/uuid"
       "github.com/jackc/pgx/v5"

       "github.com/hejijunhao/corellia/backend/internal/db"
   )

   var ErrNotFound = errors.New("harness adapter not found")

   type adapterQueries interface {
       GetHarnessAdapterByID(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error)
   }

   type Service struct {
       queries adapterQueries
   }

   func NewService(queries adapterQueries) *Service {
       return &Service{queries: queries}
   }

   func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error) {
       adapter, err := s.queries.GetHarnessAdapterByID(ctx, id)
       if err != nil {
           if errors.Is(err, pgx.ErrNoRows) {
               return db.HarnessAdapter{}, ErrNotFound
           }
           return db.HarnessAdapter{}, err
       }
       return adapter, nil
   }
   ```
   Tiny — but real. M3 will extend with `UpdateImageRef`. Returns the raw `db.HarnessAdapter` rather than a domain struct because the caller (M3 onward) will be backend code, not a Connect handler — there's no proto `HarnessAdapter` (decision 11 omitted it from the public contract).

2. **New package: `backend/internal/agents/`.**

   File: `backend/internal/agents/service.go`.
   ```go
   package agents

   import (
       "context"
       "errors"

       "github.com/google/uuid"
       "github.com/jackc/pgx/v5"

       "github.com/hejijunhao/corellia/backend/internal/db"
       corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
   )

   var ErrNotFound = errors.New("agent template not found")

   type templateQueries interface {
       ListAgentTemplates(ctx context.Context) ([]db.ListAgentTemplatesRow, error)
       // GetAgentTemplateByID added by M4.
   }

   type Service struct {
       queries templateQueries
   }

   func NewService(queries templateQueries) *Service {
       return &Service{queries: queries}
   }

   func (s *Service) ListAgentTemplates(ctx context.Context) ([]*corelliav1.AgentTemplate, error) {
       rows, err := s.queries.ListAgentTemplates(ctx)
       if err != nil {
           return nil, err
       }
       out := make([]*corelliav1.AgentTemplate, 0, len(rows))
       for _, r := range rows {
           out = append(out, toProtoTemplate(r))
       }
       return out, nil
   }

   func toProtoTemplate(r db.ListAgentTemplatesRow) *corelliav1.AgentTemplate {
       return &corelliav1.AgentTemplate{
           Id:          r.ID.String(),
           Name:        r.Name,
           Description: r.Description,
       }
   }

   var _ = uuid.Nil // imported eagerly; M4's GetAgentTemplate uses it
   var _ error = ErrNotFound
   var _ = pgx.ErrNoRows
   ```
   The trailing blank-identifier lines stay if and only if the unused imports they reference are actually present; if `go vet` flags them, drop the blank-identifier lines and the imports together. They're listed here because they prepare for M4's `GetAgentTemplate`. **Practical guidance: drop them, accept that M4 re-adds the imports**.

   Note the explicit `make(..., 0, len(rows))` — non-nil empty slice. The FE branches on length, not nil-ness, but consistent non-nil is friendlier to the JSON wire (avoids `null` vs `[]` confusion in the response).

3. **New file: `backend/internal/httpsrv/agents_handler.go`.**
   ```go
   package httpsrv

   import (
       "context"
       "errors"
       "log/slog"

       "connectrpc.com/connect"

       "github.com/hejijunhao/corellia/backend/internal/agents"
       corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
   )

   type AgentsHandler struct {
       svc *agents.Service
   }

   func NewAgentsHandler(svc *agents.Service) *AgentsHandler {
       return &AgentsHandler{svc: svc}
   }

   func (h *AgentsHandler) ListAgentTemplates(
       ctx context.Context,
       _ *connect.Request[corelliav1.ListAgentTemplatesRequest],
   ) (*connect.Response[corelliav1.ListAgentTemplatesResponse], error) {
       templates, err := h.svc.ListAgentTemplates(ctx)
       if err != nil {
           return nil, agentsErrToConnect(err)
       }
       return connect.NewResponse(&corelliav1.ListAgentTemplatesResponse{Templates: templates}), nil
   }

   func agentsErrToConnect(err error) error {
       switch {
       case errors.Is(err, agents.ErrNotFound):
           return connect.NewError(connect.CodeNotFound, err)
       default:
           slog.Error("agents handler: unexpected error", "err", err)
           return connect.NewError(connect.CodeInternal, errors.New("internal error"))
       }
   }
   ```
   <30 LOC for the RPC method (per §11.9). The `ErrNotFound` arm has no caller in M2 — included so M4's `GetAgentTemplate` can reuse the switch without an edit-during-M4. Default arm is the redacted-internal pattern from 0.2.5 post-review.

4. **Edit: `backend/internal/httpsrv/server.go`.**
   - Add `AgentsHandler corelliav1connect.AgentsServiceHandler` to `Deps` between `OrganizationsHandler` and `AllowedOrigin`.
   - Inside `r.Group(...)`, after the `orgsHandler` mount, add:
     ```go
     agentsPath, agentsHandler := corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)
     r.Mount(agentsPath, agentsHandler)
     ```

5. **Edit: `backend/cmd/api/main.go`.**
   - Import `"github.com/hejijunhao/corellia/backend/internal/agents"`.
   - After `orgsSvc := organizations.NewService(...)`, add:
     ```go
     agentsSvc := agents.NewService(queries)
     ```
   - In the `httpsrv.New(httpsrv.Deps{...})` call, add `AgentsHandler: httpsrv.NewAgentsHandler(agentsSvc),` between `OrganizationsHandler` and `AllowedOrigin`.

   `adapters.NewService(...)` is **not** wired in M2 — it has no caller. M3 adds the import and the constructor when it ships `UpdateAdapterImageRef`.

6. **Verify.**
   ```bash
   cd backend && go vet ./... && go build ./... && go test ./...
   ```

**Acceptance**

- All three commands clean.
- `httpsrv/server.go` mounts three Connect services inside the auth group: users, organizations, agents.
- `cmd/api/main.go`'s `Deps{...}` literal lists `AgentsHandler` in the right field-order slot.
- `internal/adapters/` exists with one method; `internal/agents/` exists with one method, three trailing imports cleaned per practical-guidance note above.

---

### Phase 5 — Frontend `/agents` page

**Goal:** `/agents` route renders the live catalog. M1's `ComingSoon` placeholder is replaced.

**Tasks**

1. **Edit: `frontend/src/lib/api/client.ts`.** Add the agents Connect client alongside users and organizations:
   ```ts
   import { AgentsService } from "@/gen/corellia/v1/agents_pb";
   // ...
   return {
       users: createConnectClient(UsersService, transport),
       organizations: createConnectClient(OrganizationsService, transport),
       agents: createConnectClient(AgentsService, transport),
   };
   ```

2. **Replace M1's stub: `frontend/src/app/(app)/agents/page.tsx`.** Client component. Discriminated-union state machine (decision 26):
   ```ts
   type State =
     | { kind: "loading" }
     | { kind: "ready"; templates: AgentTemplate[] }
     | { kind: "empty" }
     | { kind: "error"; message: string };
   ```
   - On mount: `api.agents.listAgentTemplates({})` (Connect-ES requires the empty request object even for no-field requests; passing `{}` is the idiomatic pattern).
   - On success with `templates.length === 0` → state `empty`.
   - On success with templates → state `ready`.
   - On `ConnectError` → state `error` with `err.message`.

3. **Render branches.**
   - `loading`: a grid of two-three `Skeleton` cards (already added in M1's Phase 1).
   - `empty`: render the sneak-peek section only (see task 6 below) — even if the live catalog is empty, the sneak-peek cards still tell the product story. No "No harnesses available" copy needed since the page is never actually empty.
   - `error`: red toast surface + a centered `Card` "Couldn't load harnesses. {message}". Sneak peeks intentionally **suppressed** in this branch — surfacing them while the live catalog errors would be confusing ("why does this one work and not the others?"). Sneak peeks are a *complement* to a working catalog, not a fallback for a broken one.
   - `ready`: two stacked sections in a single page scroll — the live catalog grid first, the sneak-peek grid below it under a divider. Both use the same responsive grid (`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`).

4. **New file: `frontend/src/components/agent-template-card.tsx`** — for live (DB-backed) templates only.
   ```tsx
   <Card>
     <CardHeader className="flex-row items-center gap-3">
       <div className="rounded-md bg-primary/10 p-2">
         <Bot className="size-5 text-primary" />
       </div>
       <div>
         <CardTitle>{template.name}</CardTitle>
       </div>
     </CardHeader>
     <CardContent>
       <p className="text-sm text-muted-foreground">{template.description}</p>
     </CardContent>
     <CardFooter className="justify-end">
       <Tooltip>
         <TooltipTrigger asChild>
           <span tabIndex={0}>
             <Button disabled>Deploy</Button>
           </span>
         </TooltipTrigger>
         <TooltipContent>Available in v1</TooltipContent>
       </Tooltip>
     </CardFooter>
   </Card>
   ```
   - Disabled button wrapped in a `<span tabIndex={0}>` so the tooltip still triggers on focus/hover. (Native `<button disabled>` swallows pointer events on most browsers, which would suppress the tooltip.)
   - `Button`, `Card*`, `Tooltip*`, `Badge` are shadcn primitives; `Tooltip` and `Badge` may require a Phase 5a `pnpm dlx shadcn@latest add tooltip badge` if M1 didn't add them.

5. **New file: `frontend/src/components/coming-soon-harness-card.tsx`** — for sneak peeks (decision 25). Structurally distinct from `AgentTemplateCard` so the rendered DOM is *visibly* different and a reader of the JSX doesn't confuse the two surfaces.
   ```tsx
   type Props = { name: string; description: string; vendor?: string };

   export function ComingSoonHarnessCard({ name, description, vendor }: Props) {
     return (
       <Card className="opacity-75">
         <CardHeader className="flex-row items-center justify-between gap-3">
           <div className="flex items-center gap-3">
             <div className="rounded-md bg-muted p-2">
               <Sparkles className="size-5 text-muted-foreground" />
             </div>
             <CardTitle>{name}</CardTitle>
           </div>
           <Badge variant="secondary">Coming Soon</Badge>
         </CardHeader>
         <CardContent>
           <p className="text-sm text-muted-foreground">{description}</p>
           {vendor && (
             <p className="mt-2 text-xs text-muted-foreground/80">by {vendor}</p>
           )}
         </CardContent>
         {/* No CardFooter — no Deploy button at all. §11.4 compliance: nothing to click means nothing to fake. */}
       </Card>
     );
   }
   ```
   - `opacity-75` + the muted icon background + the `secondary` badge variant produce a visually distinct "preview" feel.
   - **Crucially: no `CardFooter` and no `Button`.** Decision 25 makes this explicit; the rendered DOM physically cannot host a click target. A future contributor adding a button here would have to add a whole new section, which is a much higher bar than re-enabling a disabled one.

6. **New file: `frontend/src/lib/agents/coming-soon.ts`** — the static sneak-peek manifest. One file, easy to delete entries from when a harness graduates.
   ```ts
   export type ComingSoonHarness = {
     name: string;
     description: string;
     vendor: string;
   };

   export const COMING_SOON_HARNESSES: ComingSoonHarness[] = [
     {
       name: "LangGraph",
       description: "Stateful, multi-actor agents on LangChain's graph runtime.",
       vendor: "LangChain",
     },
     {
       name: "CrewAI",
       description: "Role-based multi-agent orchestration. Define a crew, give them tasks.",
       vendor: "CrewAI Inc.",
     },
     {
       name: "AutoGen",
       description: "Microsoft's multi-agent conversation framework.",
       vendor: "Microsoft Research",
     },
   ];
   ```
   The three names are subject to swap if `docs/multiagent-deployment-frameworks.md` shortlists a different set — read that doc once at execution time and align the array. Three is the right count: enough to suggest breadth, not so many that the catalog feels padded.

7. **Page render — sneak-peek section.** Below the live catalog grid, render:
   ```tsx
   <section aria-label="Coming soon">
     <div className="my-8 flex items-center gap-3">
       <Separator className="flex-1" />
       <span className="text-xs uppercase tracking-wide text-muted-foreground">
         Coming Soon
       </span>
       <Separator className="flex-1" />
     </div>
     <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
       {COMING_SOON_HARNESSES.map((h) => (
         <ComingSoonHarnessCard key={h.name} {...h} />
       ))}
     </div>
   </section>
   ```
   The `Separator` divider with the "Coming Soon" caption makes the section break visually obvious; users won't conflate sneak peeks with the live catalog. `Separator` is a shadcn primitive added in M1 Phase 1 — confirm before Phase 5 starts.

8. **Per-route metadata.** Either a `frontend/src/app/(app)/agents/layout.tsx` exporting `metadata = { title: "Agents" }`, or — if M1 already wired this on the page — leave M1's metadata in place. Decision: **delete M1's placeholder metadata if it exists on the now-deleted `ComingSoon` page; export `metadata` from a new `agents/layout.tsx`** (since this page is `"use client"` and can't export `metadata` directly).

9. **Verify.**
   ```bash
   pnpm -C frontend type-check
   pnpm -C frontend lint
   pnpm -C frontend build
   ```

**Acceptance**

- All three commands clean.
- Visiting `/agents` while signed-in renders one card titled "Hermes" with the description from the seed.
- The "Deploy" button is visibly disabled and shows "Available in v1" on hover.
- Sidebar's `Agents` item is active when on `/agents` (M1 invariant; this plan doesn't touch it).

---

### Phase 6 — Tests + validation matrix

**Goal:** prove the milestone end-to-end. Backend has unit coverage of the new domain branch; the full check matrix is green.

**Tasks**

1. **New file: `backend/internal/agents/service_test.go`.** Two cases (decision 28). Pattern lifted from `users/service_test.go`:
   ```go
   package agents_test

   import (
       "context"
       "testing"

       "github.com/google/uuid"

       "github.com/hejijunhao/corellia/backend/internal/agents"
       "github.com/hejijunhao/corellia/backend/internal/db"
   )

   type fakeQueries struct {
       rows []db.ListAgentTemplatesRow
       err  error
   }

   func (f *fakeQueries) ListAgentTemplates(_ context.Context) ([]db.ListAgentTemplatesRow, error) {
       return f.rows, f.err
   }

   func TestListAgentTemplates_HappyPath(t *testing.T) {
       row := db.ListAgentTemplatesRow{
           ID:          uuid.New(),
           Name:        "Hermes",
           Description: "Tool-using agent.",
           // DefaultConfig: []byte(`{}`),  // not projected on response — keep here only if sqlc emitted it on the row type
       }
       s := agents.NewService(&fakeQueries{rows: []db.ListAgentTemplatesRow{row}})

       got, err := s.ListAgentTemplates(context.Background())
       if err != nil {
           t.Fatalf("unexpected error: %v", err)
       }
       if len(got) != 1 {
           t.Fatalf("len(got): want 1, got %d", len(got))
       }
       if got[0].GetId() != row.ID.String() || got[0].GetName() != row.Name || got[0].GetDescription() != row.Description {
           t.Errorf("proto: got %+v, want id=%q name=%q desc=%q",
               got[0], row.ID.String(), row.Name, row.Description)
       }
   }

   func TestListAgentTemplates_Empty(t *testing.T) {
       s := agents.NewService(&fakeQueries{rows: nil})

       got, err := s.ListAgentTemplates(context.Background())
       if err != nil {
           t.Fatalf("unexpected error: %v", err)
       }
       if got == nil {
           t.Fatal("want non-nil empty slice, got nil")
       }
       if len(got) != 0 {
           t.Fatalf("len(got): want 0, got %d", len(got))
       }
   }
   ```
   The `Empty` test pins **decision 25's contract guarantee** that the service returns `[]`, not `nil` — directly relevant for the FE's `templates.length === 0` branch, and for any future JSON wire concern.

   Note: `ListAgentTemplates` returns the projection from the SQL — confirm the row type's exact field set after `sqlc generate` and adjust the literal in the test accordingly.

2. **Run the full check matrix.**
   ```bash
   cd backend && go vet ./... && go build ./... && go test ./...
   pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build
   ```
   All clean.

3. **End-to-end RPC smoke (manual).**
   ```bash
   # 1. Backend running locally (overmind start, or `cd backend && air`).
   curl -i http://localhost:8080/healthz
   # 200 OK

   # 2. Without auth — expect 401.
   curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates \
        -H "Content-Type: application/json" -d '{}'
   # 401 unauthenticated

   # 3. With a valid Supabase access token — expect the seed row.
   curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -d '{}'
   # 200 with {"templates":[{"id":"...","name":"Hermes","description":"..."}]}
   ```

4. **End-to-end FE check (manual).**
   - Sign in via `/sign-in`.
   - Click `Agents` in the sidebar.
   - Expect: one Hermes card. Disabled Deploy button. Hover → "Available in v1" tooltip.
   - Reload — same render, no console errors.
   - Kill backend, click `Dashboard` → `Agents`. Expect: error toast + the centered error card. Bring backend back up, reload — clean render.

5. **DB sanity check.**
   ```sql
   SELECT t.id, t.name, t.description, ha.harness_name, ha.upstream_image_digest, ha.adapter_image_ref
   FROM agent_templates t
   JOIN harness_adapters ha ON ha.id = t.harness_adapter_id;
   ```
   - One row.
   - `upstream_image_digest` matches the captured digest from pre-work.
   - `adapter_image_ref` is `NULL` (M3 fills).

6. **Cleanup.** Search for `// TODO`, `console.log`, blank-identifier import-keepalive lines in the new domain packages. Remove anything that the practical-guidance notes above flagged for removal. Confirm `git status` shows only the files listed in §5 below.

7. **Draft changelog entry.** Per the codebase convention (per-CLAUDE.md hint, surfaced in 0.2.5/0.2.6's pattern): a new top-level entry in `docs/changelog.md`, version bumped to `0.3.0` (this is the first product feature, not a 0.2.x patch). Index of changes + per-phase summaries in the established **What / Where / Why** style. **Out of strict plan scope** but flagged here to avoid the same forget-loop 0.2.5 left.

**Acceptance**

- Full check matrix green.
- All four manual scenarios (RPC unauth, RPC happy, FE happy, FE backend-down) behave as expected.
- DB sanity SELECT returns the expected row.
- Changelog entry drafted (or queued).

---

## 5. Files touched

**New (backend):**
- `backend/migrations/20260425170000_agent_catalog.sql`
- `backend/queries/agent_templates.sql`
- `backend/queries/harness_adapters.sql`
- `backend/internal/db/agent_templates.sql.go` (sqlc-generated)
- `backend/internal/db/harness_adapters.sql.go` (sqlc-generated)
- `backend/internal/adapters/service.go`
- `backend/internal/agents/service.go`
- `backend/internal/agents/service_test.go`
- `backend/internal/httpsrv/agents_handler.go`
- `backend/internal/gen/corellia/v1/agents.pb.go` (buf-generated)
- `backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go` (buf-generated)

**Modified (backend):**
- `backend/internal/db/models.go` (gains `HarnessAdapter`, `AgentTemplate`, `ListAgentTemplatesRow`; sqlc-regenerated)
- `backend/internal/db/querier.go` (gains two methods on `Querier`; sqlc-regenerated)
- `backend/internal/httpsrv/server.go` (`Deps` field + mount line)
- `backend/cmd/api/main.go` (import + service constructor + `Deps` field)

**New (proto):**
- `shared/proto/corellia/v1/agents.proto`

**New (frontend):**
- `frontend/src/gen/corellia/v1/agents_pb.ts` (buf-generated)
- `frontend/src/components/agent-template-card.tsx`
- `frontend/src/components/coming-soon-harness-card.tsx`
- `frontend/src/lib/agents/coming-soon.ts`
- `frontend/src/app/(app)/agents/layout.tsx` (just for `metadata` export)

**Modified (frontend):**
- `frontend/src/lib/api/client.ts` (one line: agents Connect client)
- `frontend/src/app/(app)/agents/page.tsx` (replaces M1's `ComingSoon` stub with the real catalog page)

**Untouched (intentionally):**
- All existing migrations.
- All existing queries (`users.sql`, `organizations.sql`).
- All existing domain packages (`internal/users/`, `internal/organizations/`, `internal/auth/`, `internal/config/`, `internal/db/pool.go`).
- All other handlers (`users_handler.go`, `organizations_handler.go`, `cors.go`).
- Frontend chrome (`(app)/layout.tsx`, sidebar, top bar — all M1 territory).
- Frontend dashboard, fleet, settings, sign-in, onboarding pages.
- All proto for users + organizations.
- All Supabase client code.

---

## 6. Risk register

- **Digest capture variance** (decision 22). The pre-work checklist prefers `crane digest`, falls back to `docker buildx imagetools inspect`. Both return the manifest-list digest. The CHECK constraint catches malformed values at insert time. *If `crane manifest …@<digest>` succeeds during pre-work verification but Fly later refuses to pull*: the issue is likely registry-credential-shaped (Fly's host network vs. your laptop's), not digest-shaped. Diagnose with `fly machine run` against the digest manually before assuming the digest is wrong.
- **No cosign / Sigstore provenance verification in v1.** The pin is "this digest is bit-identical to what we captured" — *not* "this digest is signed by Nous's published key." Capture-time provenance is a v2 hardening: when Nous publishes signatures, add a `cosign verify ghcr.io/nousresearch/hermes-agent@<digest> --certificate-identity ...` step to pre-work and a `harness_adapters.signature_verified_at TIMESTAMPTZ NULL` column to the schema. Out of scope for the hackathon; flag in the changelog entry as the canonical "real governance posture" follow-up.
- **Sneak-peek harnesses misrepresent the roadmap** (decision 25). Static names like "LangGraph" / "CrewAI" / "AutoGen" advertise intent we haven't formally committed to in `blueprint.md` §14. Mitigation: read `docs/multiagent-deployment-frameworks.md` at execution time and align the static array with whatever that doc shortlists. If the doc names different harnesses or doesn't shortlist any, swap or shrink the list. The static-array shape (one file, no DB writes) makes corrections trivial.
- **A sneak-peek harness ships before M2's seed pattern is in place.** Theoretical only — M2 *is* the seed pattern. But for clarity: when a sneak-peek graduates, the migration shape is exactly the M2 Hermes seed (one `harness_adapters` row, one `agent_templates` row, one digest pinned), and the static array entry is deleted in the same PR. The two surfaces never overlap because they key off different identifiers (DB UUID vs. static name).
- **`adapter_image_ref` nullability bites M3.** M3 will need to write a migration that backfills + adds `NOT NULL`. Cheap (one ALTER TABLE; one UPDATE). The cost is *linguistic* — anyone writing code that reads `adapter_image_ref` between M2 and M3 has to handle the nullable case. M2's code doesn't read it, so the blast radius is just M3 itself.
- **sqlc projection mismatch.** Decision 11 keeps `default_config` out of the response, but Phase 2's query *does* select it. Reasoning: the field is used by the *service-internal* row type, not the *Connect-public* response. Still, when M4 wires the deploy modal, the row type is already there — no second projection migration needed. Worth a comment on the SQL query to spare a future reader the question.
- **`Tooltip` on a disabled `Button`.** Decision 24's wrapper-span pattern is a known shadcn workaround. If hover doesn't reliably fire on disabled buttons after Phase 5, switch to `aria-disabled="true"` + an `onClick={(e) => e.preventDefault()}` handler instead of native `disabled` — same UX, tooltip works without the wrapper.
- **`AgentsService` registration ordering in `server.go`.** If the `r.Mount(agentsPath, agentsHandler)` line lands above the org mount instead of below, both still work — Chi routing is path-based, not order-based. Cosmetic. Worth picking a convention (alphabetical-by-domain matches the ordering in `Deps`) and sticking to it.
- **M1 / M2 file collision on `(app)/agents/page.tsx`.** Decision 27 anticipates this. Whichever lands second overwrites the other; the diff is a full file replacement, not a 3-way merge. Low risk if both PRs are reviewed before merge; very low risk if M1 and M2 are reviewed in series.
- **`go.work` / module-cache state.** A fresh sqlc + buf regen sometimes shakes loose stale generated artefacts when packages are renamed. M2 doesn't rename anything, so the risk is theoretical, but if Phase 4's `go build` complains about a dangling reference, run `go mod tidy` from `backend/` and re-run.

---

## 7. Out of scope (explicit)

- **Any frontend chrome work.** `(app)/layout.tsx`, sidebar, top bar, user menu, onboarding gate — all M1 territory.
- **Multi-template *DB-backed* catalog.** The seed inserts one row (Hermes). Adding a second DB-backed template is post-v1; sneak-peek cards are static FE content only (decision 25), not DB seed rows.
- **Cosign / Sigstore provenance verification on the pinned digest.** v2 hardening (see risk register). v1 governs by content-addressed immutability only.
- **Any spawn / deploy / fleet behavior.** Deploy button is structurally present and disabled; everything behind it is M4.
- **`HarnessAdapter` fields from blueprint §9 not used in M2:** `manifest_yaml`, `validation_report` — v2's adapter-analysis pipeline lands them.
- **`AgentTemplate.org_id` for user-defined templates** — post-v1.
- **Pull-secret config on Fly for the GHCR image** — M3.
- **Real artwork / brand assets** for the Hermes card — M4 polish.
- **Server-side rendering of the catalog** — currently client-side; a Server Component reading from the BE would require a Connect client running in RSC and is a broader refactor.
- **Any analytics / telemetry on which templates get clicked** — out of v1.
- **Localization** — copy is plain English.
- **Backfill of `agent_templates` from external sources** — there is no external source; the seed is the source of truth.

---

## 8. Definition of done

A signed-in user navigates to `/agents` and sees one real Hermes card backed by real DB rows joined through a real schema, served by a real Connect RPC inside the existing auth-middleware group — followed below a "Coming Soon" divider by three sneak-peek cards (LangGraph / CrewAI / AutoGen, or whatever `docs/multiagent-deployment-frameworks.md` shortlists) rendered from a static FE array with no Deploy button at all. The catalog page renders four states correctly (loading / ready / empty / error); sneak peeks render with `ready` and `empty`, suppress with `error`. The live-card Deploy button is visibly disabled with the right tooltip. The full check matrix (`go vet`, `go build`, `go test`, `pnpm type-check`, `pnpm lint`, `pnpm build`) is green. Two unit tests pin the service's contract (happy path + empty list). The migration is re-runnable. The seed digest is real, version-tag-resolved (not from `:latest`), captured via `crane digest`, audited via SQL comment, and the architecture rule §11.2 is now enforced both at the database level (via CHECK constraint) and at the application level (via the established sentinel-handler pattern).

This is the structural turning point: the codebase has its first product schema, its first product RPC, and its first product UI page. M3 (adapter image + Fly wiring) and M4 (spawn flow) extend rather than scaffold.
