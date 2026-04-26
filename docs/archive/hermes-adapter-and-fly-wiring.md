# Plan — M3: Hermes adapter image + Fly account wiring

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/plans/post-0.2.6-roadmap.md` §M3 (parent roadmap; this is its detailed plan)
- `docs/executing/agent-catalog.md` (M2 — landed `harness_adapters` row with `adapter_image_ref = NULL`; this milestone is the row's first writer)
- `docs/blueprint.md` §3 (harness interface contract — runtime / configuration / packaging / metadata sub-contracts; this milestone is the first one that *exercises* the contract end-to-end), §4 (adapter strategy: v1 hand-written; M3 *is* the v1 hand-written adapter), §5 (digest pinning — already enforced for upstream in M2; M3 establishes the same posture for our adapter image), §7 (observability options A/B/C/D; M3 uses Option D — adapter wrapper / entrypoint shim — for env-var translation, with A/B/C deferred), §8 (Fly deployment topology — one AgentInstance = one Fly app = one Firecracker microVM), §11.1 (no Fly-specific code outside `FlyDeployTarget`), §11.3 (`CORELLIA_*` env-var convention), §11.4 (deferred features stub as real interfaces, not fake buttons), §11.5 (no upstream forks)
- `docs/stack.md` §1 (Go for "spawn N agents" fan-out), §8 (`FLY_API_TOKEN` / `FLY_ORG_SLUG` env vars — already required by `config.Config` since 0.1.0, unread until this milestone), §11.1 (no Fly outside `FlyDeployTarget`)
- `docs/changelog.md` §0.1.0 (Fly env vars added to `config.Config` as required-but-unread placeholders), and the still-to-be-drafted M2 entry (digest-pinning enforced in DB; sets the precedent this plan extends to the adapter ref)
- `docs/multiagent-deployment-frameworks.md` (Hermes background — read at execution start to verify the adapter env-var translation table)

---

## 1. Objective

Make the **harness-deployment substrate real** so M4's spawn flow can be application-code only. Concretely, after M3 lands:

1. A new top-level `adapters/hermes/` directory holds a small Dockerfile (`FROM docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338`, the same digest pinned by M2's seed) plus a POSIX-shell `entrypoint.sh` that translates `CORELLIA_*` env vars into the Hermes-native names the upstream image actually consumes, then `exec`s the upstream entrypoint. This is the v1 hand-written adapter referenced in blueprint §4.
2. The adapter image is built (multi-arch where feasible: linux/amd64 is mandatory, linux/arm64 is nice-to-have) and pushed to a public GHCR repo under a project-scoped namespace. Its manifest-list digest is captured and pinned forever.
3. M2's seed row gets `adapter_image_ref` filled in via a new migration that **also tightens the column to `NOT NULL`** — so once M3 lands the schema enforces "an adapter row without an adapter image is structurally invalid."
4. A new `backend/internal/deploy/` package exposes a `DeployTarget` interface and three implementations: a real `FlyDeployTarget` (uses `github.com/superfly/fly-go` against the Machines v1 REST API + Apps v1 GraphQL for the create-app step), and two `NotImplemented` stubs (`LocalDeployTarget`, `AWSDeployTarget`) — wiring blueprint §11.4 from day one.
5. The `FlyDeployTarget.Spawn` path is **proven outside the control plane**: a pre-merge developer-only smoke runs the harness contract end-to-end via `fly machines run` against the captured adapter digest, watches `/health` come up green, kills the machine, deletes the app. The control plane *does not yet drive this flow* — that's M4.
6. M2's `adapters.Service` (which currently only has a stub `Get`) gains an `UpdateImageRef` method so the migration's backfill has a Go-level analogue when M4 (or an admin tool) needs to bump the digest later.
7. `cmd/api/main.go` wires the deploy package's three targets behind a tiny registry — even though no HTTP handler consumes them in M3 (verified by `go vet ./...` succeeding without any new public RPC). The wiring itself proves the interface fits the lifecycle.

After M3 lands:

- The §11.1 rule ("no Fly-specific code outside `FlyDeployTarget`") is exercised on real data: the rest of the codebase imports only `deploy.DeployTarget`; the `fly-go` SDK lives behind a single Go file.
- M4 (spawn flow) inherits a working spawn primitive. Its plan can focus entirely on the *flow* — `AgentInstance` row insert, secret materialisation, status state machine, `/health` poll — without relitigating any infrastructure.
- The harness interface contract from blueprint §3 has a first compliant member: Hermes via the adapter wrapper, exposing `/health` and `/chat` on a known port, configured exclusively through `CORELLIA_*` env vars.

The whole milestone is one new top-level dir (`adapters/hermes/`), one new domain package (`internal/deploy/`), one new migration, one extension to M2's `adapters.Service` — but it's the milestone where the abstraction Corellia is built around stops being aspirational and starts running real workloads.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Adapter source location in repo | **`adapters/hermes/`** at repo root, alongside `backend/`, `frontend/`, `shared/` | Adapters are operational artefacts, not Go or TS code. Putting them at the repo root signals they're a third stack peer; nesting them under `backend/` would imply Go-language ownership they don't have. Future adapters land as siblings: `adapters/langgraph/`, `adapters/crewai/`, etc. Aligns with how Hermes is the *first member of a category* per blueprint §4 |
| 2 | Adapter image base | **`FROM docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338`** — exactly the digest M2 pinned in `harness_adapters.upstream_image_digest` | Two-fold guarantee: (a) the adapter image is bit-identical to the row's `upstream_image_digest` (they reference the same blob); (b) any future digest bump is a coordinated change — new migration backfills both columns in lockstep. The single-source-of-truth for the upstream digest is the database, not the Dockerfile; the Dockerfile *quotes* the database, not the other way around. Cross-check at build time via the Phase 2 verification step |
| 3 | Wrapper script language | **POSIX `/bin/sh`**, single file `adapters/hermes/entrypoint.sh`, ~30 lines | Shell is the right tool: zero runtime dependencies, no compilation step, no language version skew between adapter authors. Bash extensions deliberately avoided so the script runs on Alpine, distroless, or whatever the upstream image's base happens to be. (If upstream is `scratch` or has no shell, this decision flips to "wrapper is a tiny static Go binary copied into the image" — Phase 1 verification step catches this) |
| 4 | Hermes-native env-var translation table | **Discovered at execution start, not ahead of time.** Pre-work checklist (§3) includes a `docker run --rm <upstream-digest> env` + `cat /proc/1/cmdline` pass plus reading the upstream README to enumerate the env vars Hermes actually consumes. The table is recorded in this doc *during execution* | The `CORELLIA_MODEL_API_KEY` → `OPENROUTER_API_KEY` mapping in `blueprint.md` §4 is illustrative, not prescriptive. Locking the table in this plan before inspecting the image risks shipping a translation that names variables Hermes never reads. Phase 1 includes the inspection as task 1 |
| 5 | Adapter image registry | **Public GHCR repo: `ghcr.io/<owner>/corellia-hermes-adapter`**. Owner = the GitHub user/org that owns the `corellia` repo. Public visibility (no pull secrets needed on Fly) | Three reasons: (a) Fly machines pulling from a public registry need zero credentials configured per-app, removing a whole class of M4 spawn-flow failure modes; (b) GHCR is free, has no private-image pull-rate limits at this scale, and ships with the GitHub repo we already use — no separate registry account to provision; (c) the image contains zero secrets (it's a public upstream image plus a public env-var rename script), so private-by-default would be security theatre. The `<owner>` slug is filled at execution start; cross-account moves are a `docker buildx imagetools create` away (registry-side rewrite, no rebuild) |
| 6 | Multi-arch build target | **`linux/amd64` mandatory, `linux/arm64` if upstream supports it**. Use `docker buildx build --platform linux/amd64,linux/arm64 --push` or fall back to amd64-only with a SQL-comment note in the migration | Fly's machines run on amd64 by default; arm64 is opt-in but cheaper. Pinning a manifest list (multi-arch index) means Fly picks the right arch automatically. If upstream's image manifest is amd64-only, building arm64 from it is impossible — fall back gracefully and document. Pre-work task verifies upstream manifest shape via `crane manifest <upstream-digest>` |
| 7 | Adapter image tagging strategy | **Tag with `:v<YYYY-MM-DD>-<short-sha>` *and* push to `:latest`**, but the migration only ever references the resolved digest. Tags are operator-facing convenience for `docker pull`; the database stores the immutable digest exclusively (per blueprint §11.2) | Same digest-pinning posture M2 established for upstream applied to our adapter. `:latest` is acceptable because it's never read by anything load-bearing — the migration writes the digest. The dated tag is human-friendly: anyone running `docker images` can identify the build at a glance |
| 8 | Adapter manifest (`corellia.yaml`) embedding | **Deferred to v2** — not embedded in M3's image | Per blueprint §3.4 a `corellia.yaml` manifest is part of the metadata contract. Per §4 it's *generated* in v2 by the adapter-analysis pipeline. For v1 the same metadata lives in `harness_adapters` columns + `agent_templates.default_config` JSON — which is what the application code reads. Embedding YAML the application doesn't read would be ceremony with no caller. Re-add when v2's pipeline ships and there's a real reader |
| 9 | Migration: shape | **Single new migration, two-statement Up block**: `UPDATE harness_adapters SET adapter_image_ref = '<ref>' WHERE harness_name = 'hermes';` followed by `ALTER TABLE harness_adapters ALTER COLUMN adapter_image_ref SET NOT NULL;`. Filename `<timestamp>_adapter_image_ref_backfill.sql` | Goose runs each migration in a transaction by default, so the UPDATE + ALTER land atomically. Putting them in the same file means a partially-applied state ("backfilled but still NULL-allowed", or "tightened but never backfilled") is impossible. The Down block reverses both: `ALTER ... DROP NOT NULL` then `UPDATE ... SET adapter_image_ref = NULL` |
| 10 | `adapter_image_ref` value format | **`<registry>@sha256:<hash>` form, never `<registry>:<tag>`**. Add a CHECK constraint in the same migration: `CHECK (adapter_image_ref LIKE '%@sha256:%')`. Constraint named `adapter_image_ref_digest_pinned` for grep-ability | Same defence-in-depth move M2 made for `upstream_image_digest` (the `LIKE 'sha256:%'` constraint). The ref *format* is slightly different (`registry@sha256:hash` rather than bare digest) because Docker's CLI / Fly's API consume the full ref form; the CHECK pattern allows for the `@sha256:` substring anywhere, which permits both patterns and forbids `:tag` refs unambiguously. The constraint can be dropped in a v2 migration if the format ever needs to evolve |
| 11 | `adapters.Service.UpdateImageRef` query | **New file `backend/queries/harness_adapters.sql` line: `-- name: UpdateHarnessAdapterImageRef :one`**, returns the updated row. Add `UpdateImageRef(ctx, id, ref) (db.HarnessAdapter, error)` to the service | M2's `harness_adapters.sql` only has `GetHarnessAdapterByID`. Extending it (rather than writing a new file) keeps queries co-located by table per the existing convention. The Go-side `UpdateImageRef` has no caller in M3 — but exists so the migration's backfill has a Go-level analogue that the operator-facing `corellia adapter bump <name> <new-digest>` CLI (post-v1, separate plan) can consume cleanly |
| 12 | `internal/deploy/` package shape | **Three files**: `target.go` (interface + types + `ErrNotImplemented` sentinel), `fly.go` (`FlyDeployTarget` real impl), `stubs.go` (`LocalDeployTarget` + `AWSDeployTarget`, both returning `ErrNotImplemented` on every method). Tests in `target_test.go` (interface conformance), `fly_test.go` (unit-level for any pure logic) | The two `NotImplemented` stubs are blueprint §11.4 ("deferred features stub as real interfaces, not fake buttons") encoded as Go code. They're real types implementing the real interface; `go vet` and tests cover them. M4's spawn handler can `switch target.Kind() { case "fly": ... default: return ErrNotImplemented }` immediately |
| 13 | `DeployTarget` interface surface | **Five methods** in M3: `Kind() string`, `Spawn(ctx, SpawnSpec) (SpawnResult, error)`, `Stop(ctx, ref string) error`, `Destroy(ctx, ref string) error`, `Health(ctx, ref string) (HealthStatus, error)`. `Logs` (streaming) explicitly deferred to v1.5 per blueprint §13 | The five methods cover the M4 spawn flow + the v1.5 lifecycle ops the roadmap mentions. Listing them all on the interface in M3 means `LocalDeployTarget` / `AWSDeployTarget` immediately stub them — and M4 doesn't need to widen the interface mid-flight (which would re-touch the stubs). Concretely: `Spawn` is M4-driven; `Stop`/`Destroy`/`Health` are roadmap §M4 "TBD" affordances and v1.5 follow-ups. Pre-declaring is cheap; widening later forces a stub-edit ripple |
| 14 | `SpawnSpec` / `SpawnResult` types | `SpawnSpec` carries `Name string`, `ImageRef string` (the `<registry>@sha256:hash` form from `harness_adapters.adapter_image_ref`), `Env map[string]string` (the `CORELLIA_*` set), `Region string` (defaults `iad`), `CPUs int`, `MemoryMB int`. `SpawnResult` carries `ExternalRef string` (e.g. `fly-app:corellia-agent-<uuid>`) and `MachineID string` | `ExternalRef` is what gets stored as `agent_instances.deploy_external_ref` per blueprint §9. The `fly-app:` scheme prefix makes the value self-describing — a reader knows immediately which target produced it. `Region` / `CPUs` / `MemoryMB` are explicit knobs even though M4 will pass defaults; encoding them in the spec means ad-hoc operator scripts (`spawn one in `lhr` for testing`) work without spec churn |
| 15 | Fly Go SDK | **`github.com/superfly/fly-go` (current major version at execution start)** for the Machines v1 REST API. App-create uses the same SDK's `flaps.NewWithOptions` + `Client.CreateApp` (under-the-hood GraphQL, but the SDK abstracts it) | `fly-go` is the canonical SDK Fly themselves use in `flyctl`. Picking it minimises the "we wrote our own GraphQL client" surface. v1 churn risk is real (it's pre-1.0); buffer with the `FlyDeployTarget` wrapper (§11.1 — no SDK types leak past the package boundary) so future SDK upgrades stay confined |
| 16 | `FlyDeployTarget.Spawn` orchestration | **Three Fly API calls in sequence**: (a) `CreateApp(name = "corellia-agent-<short-uuid>", org = cfg.FlyOrgSlug)`; (b) `SetSecrets(app, env)` with the `CORELLIA_*` map; (c) `CreateMachine(app, image = spec.ImageRef, region, resources)`. Wait for machine state `started`; do **not** wait for `/health` — that's M4's caller-side concern | Splitting the wait is a separation-of-concerns win: `FlyDeployTarget.Spawn` returns once Fly considers the machine started; whether the *application* inside the machine is healthy is `Health(ctx, ref)` — a separate method the spawn-flow caller polls. Conflating the two would couple the deploy package to the harness's `/health` semantics, which is a contract violation in spirit |
| 17 | Naming convention for spawned Fly apps | **`corellia-agent-<8-char-uuid-prefix>`** (e.g. `corellia-agent-a1b2c3d4`). `<prefix>` is the first 8 chars of `AgentInstance.id.String()`. Full UUID stored in `agents.deploy_external_ref` for back-reference | Fly app names are global (must be unique across all of Fly, not just our org), max 63 chars, lowercase + hyphen + digit. `corellia-agent-` prefix gives 48 chars for the suffix; using the UUID prefix gives near-perfect collision avoidance (~3.4×10⁻¹⁰ for 1M agents). The full UUID lives in the DB as the canonical link |
| 18 | Region selection | **Default `iad` (Ashburn / US-east-1)**, overridable by `SpawnSpec.Region`. M3 plan does not introduce a per-org / per-template default; `default_config` (M2's `JSONB` column) is the natural future home | `iad` is Fly's default, lowest-friction for the demo. Per-region defaults are a v1.5 concern; locking them into the schema today (e.g. `agent_templates.default_region`) before any user-controlled selection UI exists would be schema-without-readers |
| 19 | Resource defaults (CPU / memory) | **`shared-cpu-1x` / `512 MiB`** as the M3 default. Spec's `CPUs` field deferred to M4 (one knob less to think about); `MemoryMB` ditto | Smallest Fly preset; smallest blast radius if a Hermes machine misbehaves. Hermes itself doesn't need much — it's a thin process that proxies LLM calls. Bumping requires only changing the constant in `fly.go`, not the schema or interface |
| 20 | Auto-stop / auto-start configuration | **Enabled** on every machine (`auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0`). Hardcoded in the `CreateMachine` call body for M3 | Per blueprint §8: "Auto-stop + auto-start make idle agents effectively free." Hardcoding aligns with the §8 architectural commitment. Per-template overrides (e.g. "always-on agents") are a v2 concern |
| 21 | `DeployTarget` registry in `main.go` | **Hardcoded map** `map[string]deploy.DeployTarget{"fly": flyTarget, "local": localTarget, "aws": awsTarget}` constructed at boot. No DB-driven `deploy_targets` table in M3 | The `deploy_targets` table (blueprint §9) is M4 territory — that's where it gets a reader (`AgentInstance.deploy_target_id` FK). The hardcoded map in M3 is the bootstrap: it lets `FlyDeployTarget` exist and be exercised before any DB row points at it. M4's plan upgrades the map to a DB-resolved lookup |
| 22 | Where the registry is exposed | **Stored on `httpsrv.Deps`** as a new field `DeployTargets map[string]deploy.DeployTarget`. Not consumed by any handler in M3 (no HTTP surface; verified by `go vet` not flagging the unused field) | M4 will add a handler that reads from the registry to drive spawn. Pre-wiring it on `Deps` in M3 means M4 doesn't have to also touch `main.go` for plumbing — it's already there. The "unused field warning" is silenced by Go itself: struct fields don't trigger unused warnings, only local variables do |
| 23 | `FlyDeployTarget` constructor signature | **`deploy.NewFlyDeployTarget(token string, orgSlug string) *deploy.FlyDeployTarget`** — accepts only the credentials it needs, not the whole `Config`. Constructed in `main.go` from `cfg.FlyAPIToken` + `cfg.FlyOrgSlug` | Established pattern: `users.NewService(queries)` takes the queries it needs, not the whole `db.Pool`. Same minimisation principle. Keeps the deploy package free of any `internal/config` import — that's a one-way arrow from `main.go` *into* the domain packages |
| 24 | Adapter env vars on Fly machine | **Set as Fly app secrets** via `SetSecrets`, not as plain env on the machine. M3's `Spawn` materialises the `CORELLIA_MODEL_API_KEY` (and any other sensitive var) as secrets; non-sensitive vars (`CORELLIA_AGENT_ID`, `CORELLIA_MODEL_NAME`) are also set as secrets in M3 to avoid the categorical split (one code path, fewer surprises) | Per blueprint §8: "Secrets are Fly-app-scoped; one-app-per-agent gives true per-agent secret isolation." Setting *all* env via secrets is wasteful for non-sensitive values but operationally simpler — M4's `secrets` table tracks only the actually-sensitive ones; the deploy layer doesn't need to know the difference. Trade `O(2)` Fly API calls for `O(1)` mental complexity |
| 25 | `Stop` / `Destroy` / `Health` implementation depth | **All three implemented for real** in `FlyDeployTarget`, not stubbed. `Stop` calls `flaps.StopMachine`; `Destroy` calls `flaps.DeleteMachine` then `Client.DeleteApp`; `Health` reads `flaps.GetMachine` and reports `started` / `stopped` / `failed` | The three methods are independent calls to the same Fly SDK, ~10 lines each. Stubbing would mean re-touching the file in M4 / v1.5; implementing once is cheaper. The smoke test in Phase 7 exercises `Stop` and `Destroy` (it would leak Fly machines otherwise) |
| 26 | Smoke test scope | **Manual, developer-only, pre-merge**. No CI integration. A documented script (`adapters/hermes/smoke.sh`) that: (1) builds the adapter, (2) runs `fly machines run` against the captured digest with mock `CORELLIA_*` env vars, (3) probes `/health` until 200 or 60s timeout, (4) `fly logs` for visual confirmation, (5) `fly apps destroy --yes` | CI-driving Fly spawns introduces an external paid-API dependency the hackathon can't justify. Manual smoke is acceptable because (a) the adapter rarely changes, (b) the developer who built it has an incentive to verify, (c) M4's spawn flow will exercise the same path the moment its plan lands. The script is checked in so anyone can re-run after an upstream digest bump |
| 27 | Smoke test mock credentials | **A throwaway free-tier OpenRouter key** (or equivalent provider), set via `--env` on `fly machines run`. The key is *not* committed; the script reads it from a local env var documented in `adapters/hermes/README.md` | Hermes will call the LLM provider on `/chat`. `/health` should return 200 without an LLM call (verify against the upstream's behaviour during pre-work; if `/health` does call the LLM, a stub key is enough — Hermes has to handle 401 gracefully). Real key only needed if the smoke also exercises `/chat` (recommended but not blocking) |
| 28 | Doc placement for adapter README | **`adapters/hermes/README.md`**, ~50 lines, explaining: the upstream digest pinning rationale (with link to `blueprint.md` §11.2 + this plan), the env-var translation table (filled at execution), the smoke-test invocation, and the "do not edit; this is the v1 hand-written adapter" header | Co-locating the README with the Dockerfile means anyone reading the adapter source has the context inline. Linking back to the blueprint preserves the "blueprint is precedence-1, this is a recipe" hierarchy from `CLAUDE.md` §"Doc hierarchy". Future adapters use this README as a template |
| 29 | Tests | **`backend/internal/deploy/target_test.go`**: interface-conformance test (each implementation satisfies `DeployTarget` — compile-time check via `var _ DeployTarget = (*FlyDeployTarget)(nil)` etc., one line per impl). **`stubs_test.go`**: each stub method returns `ErrNotImplemented`. **`fly_test.go`**: pure-logic tests only — `appNameFor(uuid.UUID) string` (the `corellia-agent-<8-char>` derivation), `validateImageRef(string) error` (the `@sha256:` shape check). No integration tests against the Fly API in CI | The pure-logic tests are cheap and pin the naming convention. The Fly integration is exercised by Phase 7's smoke. CI staying free of Fly calls is a hard requirement (cost + flakiness) |
| 30 | `httpsrv.Deps.DeployTargets` field — alphabetical-or-domain placement | **Add between `AgentsHandler` and `AllowedOrigin`** | Mirrors the M2 plan's decision-19 ordering: config + auth infra at top, handlers in the middle, deploy targets sit logically with the handler-adjacent infra (since M4 will route from a handler into the registry), CORS at the bottom. New cross-cutting concerns slot into the same band |
| 31 | M2 / M3 file collision | **`backend/queries/harness_adapters.sql`** — M2 created the file with `GetHarnessAdapterByID`; M3 appends `UpdateHarnessAdapterImageRef`. **`backend/internal/adapters/service.go`** — M2 created the file; M3 appends `UpdateImageRef` method + an extension to the private `adapterQueries` interface. **`docs/changelog.md`** — M2 added the 0.3.0 entry; M3 adds 0.3.x | All edits are append-only to M2's surfaces. Conflicts only arise if M2 and M3 land out of order, which the roadmap §3 forbids ("milestones run in series unless explicitly noted parallelisable"). Phase 5 includes a defensive `git pull` from master before edits |

### Decisions deferred (revisit when named caller arrives)

- **`DeployTarget` selection logic** (which target spawns which template) — deferred to M4. M3 hardcodes `targets["fly"]` as the only consumer in the smoke test.
- **`AgentTemplate.default_region` / per-template resource overrides** — deferred to v1.5, after at least one user has asked for it.
- **`fly.toml`-style declarative app config** — deferred. M3 uses the Machines API directly; declarative `fly.toml` is operator-facing tooling, not control-plane substrate.
- **Adapter image **signed** with cosign / Sigstore** — v2 hardening (same risk-register flag M2 carries forward). For now the adapter image is content-addressed but not signature-verified.
- **A second adapter** (e.g. for one of the M2 sneak-peek harnesses) — out of scope. M3 ships exactly one adapter; M4 ships exactly one spawn flow over it; v1.5+ widens.
- **GHCR org-vs-user namespace** — flagged in roadmap §6 as M3 OQ; resolved in decision 5 toward "owner of the corellia repo" (whoever that turns out to be at execution time). If the repo moves orgs later, the migration that bumps the digest also rewrites the registry path; the CHECK constraint accepts any registry host.

### Follow-up plans (to be written after this lands)

- **`docs/plans/spawn-flow.md`** (M4). Reads `agent_templates` + `harness_adapters` to construct `SpawnSpec`; calls `deploy.DeployTarget.Spawn`; persists `AgentInstance` rows.
- **`docs/plans/adapter-bump.md`** (post-v1). Operator-facing CLI / RPC for "bump the Hermes adapter to a new upstream digest" — exercises the `adapters.Service.UpdateImageRef` method this plan introduces.
- **`docs/plans/control-plane-deploy.md`** (between M3 and M4 per roadmap §4). Deploy `corellia-api` itself to Fly + `frontend` to Vercel. M3 introduces enough Fly fluency that this becomes the obvious next non-M-track box to tick.

---

## 3. Pre-work checklist

Before Phase 1, confirm:

- [ ] M2 has landed: migration `20260425170000_agent_catalog.sql` is applied, `harness_adapters` has one `hermes` row with `adapter_image_ref IS NULL`, `/agents` page renders.
- [ ] `git status` clean; branch off `master` for M3 work (e.g. `m3/hermes-adapter-and-fly-wiring`).
- [ ] Backend builds + tests clean today: `cd backend && go vet ./... && go build ./... && go test ./...`.
- [ ] Frontend builds + lints clean today: `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build`.
- [ ] **Fly account ready.** `fly auth whoami` prints a user; `fly orgs list` shows the org slug we'll use; `fly auth token | head -c 8` is non-empty. `FLY_API_TOKEN` and `FLY_ORG_SLUG` already required by `config.Config` since 0.1.0 — confirm `backend/.env` has real values, not placeholders.
- [ ] **Docker buildx ready.** `docker buildx version`; `docker buildx ls` shows a builder supporting `linux/amd64,linux/arm64` (the default `desktop-linux` builder on Mac does). If not, `docker buildx create --use --name corellia-multiarch`.
- [ ] **GHCR auth ready.** `echo $GHCR_PAT | docker login ghcr.io -u <github-username> --password-stdin` succeeds. PAT scope: `write:packages`. Decision 5's `<owner>` slug recorded below.
  - **GHCR owner slug:** `<paste-here>` (fill at execution start)
- [ ] **Inspect the upstream image to derive the env-var translation table** (decision 4):
  ```bash
  # Pull the M2-pinned digest locally.
  docker pull docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338

  # Extract the entrypoint + command.
  docker inspect --format '{{ .Config.Entrypoint }} {{ .Config.Cmd }}' \
    docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338

  # List every env var the image declares.
  docker inspect --format '{{ range .Config.Env }}{{ println . }}{{ end }}' \
    docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338

  # If the image has a shell, dump runtime defaults.
  docker run --rm --entrypoint /bin/sh \
    docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338 \
    -c 'env | sort'

  # If `/bin/sh` doesn't exist (distroless / scratch base), this fails — flag the
  # decision-3 fallback ("wrapper as static Go binary copied in") in Phase 1.
  ```
  Pair this with reading the upstream README on GitHub / Docker Hub for documented config. Record the translation table:

  | `CORELLIA_*` env var | Hermes-native env var | Notes |
  |---|---|---|
  | `CORELLIA_AGENT_ID` | `<paste>` | stable identifier; passthrough or rename |
  | `CORELLIA_MODEL_PROVIDER` | `<paste>` | usually a string discriminator |
  | `CORELLIA_MODEL_API_KEY` | `<paste>` (e.g. `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` — depends on provider) | provider-conditional rename |
  | `CORELLIA_MODEL_NAME` | `<paste>` | passthrough or rename |
  | `<other Hermes-native var with no Corellia equivalent yet>` | `<paste>` | document; either pass through unchanged or hardcode in entrypoint.sh |

  - **Hermes listening port** (default `8642` per blueprint §3.1; confirm against the upstream image): `<paste>`
  - **Does upstream's `/health` endpoint require an LLM call?** `<yes/no>` (affects decision 27 — whether the smoke test needs a real LLM key)
- [ ] `crane manifest docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338` succeeds and the response includes a `manifests` array with `linux/amd64` (and ideally `linux/arm64`). Without arm64 in the upstream, M3 ships amd64-only (decision 6).
- [ ] **Fly machine image-pull rehearsal.** Prove Fly can pull *any* public GHCR image to your account before building ours: `fly machines run --rm ghcr.io/nginx/nginx:mainline-alpine --region iad --org $FLY_ORG_SLUG`. Cleanup: `fly apps destroy --yes <app-it-created>`. Catches network / org-permission bugs before the Phase 7 smoke depends on them.

---

## 4. Implementation phases

Eight phases. Each one is independently verifiable. Phases 1–3 produce the adapter image. Phase 4 reconciles the schema. Phases 5–6 add the deploy package + wiring. Phase 7 proves the harness contract end-to-end against real Fly. Phase 8 closes the milestone with tests + checks + changelog.

### Phase 1 — Hermes adapter Dockerfile + entrypoint

**Goal:** the `adapters/hermes/` directory exists, contains a buildable Dockerfile and a translating entrypoint, and produces an image locally.

**Tasks**

1. **Inspect upstream** (already done in pre-work; copy the recorded translation table into Phase 1 as the source of truth).

2. **Create the directory:**
   ```bash
   mkdir -p adapters/hermes
   ```

3. **Write `adapters/hermes/Dockerfile`:**
   ```dockerfile
   # corellia/hermes-adapter
   #
   # v1 hand-written adapter wrapping nousresearch/hermes-agent.
   # Pinned to the same upstream digest as
   # backend/migrations/20260425170000_agent_catalog.sql (single source of
   # truth for the upstream digest is the database; this Dockerfile quotes it).
   #
   # See blueprint.md §4 (adapter strategy) and §11.5 (no upstream forks).
   FROM docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338

   COPY entrypoint.sh /corellia/entrypoint.sh
   RUN chmod +x /corellia/entrypoint.sh

   # Override upstream entrypoint: our wrapper translates CORELLIA_* env vars,
   # then exec's the upstream binary. The upstream entrypoint path is captured
   # from `docker inspect ... .Config.Entrypoint` during pre-work and pasted
   # into entrypoint.sh as the final exec target.
   ENTRYPOINT ["/corellia/entrypoint.sh"]
   ```
   If upstream uses `CMD` instead of `ENTRYPOINT`, drop the `ENTRYPOINT` override and instead override `CMD`. Pre-work's `docker inspect` output answers which.

4. **Write `adapters/hermes/entrypoint.sh`:**
   ```sh
   #!/bin/sh
   # CORELLIA_* → Hermes-native env-var translation.
   # Per blueprint.md §11.3: Corellia code never reaches into a harness's
   # native env var names from outside the adapter; this script is the
   # adapter, and is the only place that knows the names of Hermes's
   # native vars.
   set -e

   # --- translation table (filled per pre-work inspection) ---
   # Example shape — replace mappings with the real Hermes-native names:
   #
   # export OPENROUTER_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
   # export MODEL_NAME="${CORELLIA_MODEL_NAME:-}"
   # export AGENT_ID="${CORELLIA_AGENT_ID:-}"
   #
   # Provider-conditional: Hermes may want a different API-key var per
   # provider. If so, branch on CORELLIA_MODEL_PROVIDER:
   #
   # case "${CORELLIA_MODEL_PROVIDER:-}" in
   #   openai)     export OPENAI_API_KEY="${CORELLIA_MODEL_API_KEY:-}" ;;
   #   anthropic)  export ANTHROPIC_API_KEY="${CORELLIA_MODEL_API_KEY:-}" ;;
   #   openrouter) export OPENROUTER_API_KEY="${CORELLIA_MODEL_API_KEY:-}" ;;
   #   *)          echo "unknown CORELLIA_MODEL_PROVIDER: ${CORELLIA_MODEL_PROVIDER:-}" >&2; exit 64 ;;
   # esac

   # --- exec upstream ---
   # The path here is the upstream's original ENTRYPOINT, captured from
   # `docker inspect` during pre-work. Replace with the real value:
   exec /path/to/hermes-agent "$@"
   ```
   The placeholders are deliberate — this script gets *one* concrete edit at execution time, after the pre-work inspection. The shape (POSIX shell, `set -e`, `exec` not subshell) is locked.

5. **Write `adapters/hermes/README.md`** (~50 lines per decision 28). Sections: "What this is" (one paragraph linking to `blueprint.md` §3 + §4), "Pinning" (link to §11.2 + cite the M2 migration), "Env-var translation" (the table from pre-work, also embedded in `entrypoint.sh`), "Local build" (the Phase 2 commands), "Smoke test" (link to `smoke.sh`, instructions for the throwaway LLM key), "Bumping the upstream digest" (sketch of the post-v1 process).

6. **Write `adapters/hermes/.dockerignore`** containing `README.md` (don't bloat the image with docs) and `smoke.sh` (operator script, not runtime).

7. **Local build (single-arch):**
   ```bash
   docker build -t corellia/hermes-adapter:dev adapters/hermes
   ```
   Should succeed. Image size should be ~upstream + a few KB for the script.

8. **Local sanity exec:**
   ```bash
   # Confirm the entrypoint is wired and passes through env vars.
   docker run --rm \
     -e CORELLIA_AGENT_ID=test-1 \
     -e CORELLIA_MODEL_PROVIDER=openrouter \
     -e CORELLIA_MODEL_NAME=anthropic/claude-3.5-sonnet \
     -e CORELLIA_MODEL_API_KEY=sk-fake \
     --entrypoint /corellia/entrypoint.sh \
     corellia/hermes-adapter:dev \
     env | grep -E '^(CORELLIA|OPENROUTER|MODEL|AGENT)_' | sort
   ```
   Verifies the translation actually happens. (We override the entrypoint to `/bin/sh -c 'env | ...'` if necessary; the goal is to confirm the renames before booting Hermes itself.)

**Acceptance**

- `adapters/hermes/{Dockerfile,entrypoint.sh,README.md,.dockerignore}` all present and committed.
- `docker build` succeeds.
- The local sanity exec prints the renamed env vars correctly.
- `entrypoint.sh` has `set -e`, uses `exec` (not subshell), translates every `CORELLIA_*` var the spec lists, and `exec`s the upstream binary by its actual path (no placeholder).

`★ Insight ─────────────────────────────────────`
- The `exec` (not subshell) at the end of `entrypoint.sh` is load-bearing. Without `exec`, the shell process stays around as PID 1 and the upstream Hermes process becomes PID 2 — which means `SIGTERM` from Fly hits the shell, not Hermes, and Hermes never gets a chance to drain in-flight requests before being SIGKILLed at the end of the grace period. With `exec`, the shell *replaces itself* with Hermes, Hermes becomes PID 1, and signal propagation works as intended. This single-character difference (`exec` vs no `exec`) decides whether agents shut down cleanly or get hard-killed.
- The `${VAR:-}` form (vs bare `$VAR`) matters under `set -e`: if `set -u` is also enabled (it isn't here, deliberately, so missing optional vars don't crash the wrapper), bare `$VAR` references would fail on undefined vars. The `:-` default makes every var optional from the wrapper's perspective; whether Hermes errors out on a missing required var is Hermes's concern, not the adapter's. This keeps the adapter contract minimal: "rename these vars if present, do nothing if absent."
- The Dockerfile's `FROM ...@sha256:...` line is the only place the upstream digest appears outside the database. Decision 2's "single source of truth is the DB; the Dockerfile quotes it" is structural: when the digest bumps, the migration changes first (atomically updates both `upstream_image_digest` and `adapter_image_ref`), then the Dockerfile is updated to match in the same PR. The reverse order — bump the Dockerfile first, then write the migration — is a documented anti-pattern because it permits a window where the in-registry image and the database disagree.
`─────────────────────────────────────────────────`

---

### Phase 2 — Multi-arch build + registry publish + digest capture

**Goal:** the adapter image lives at `ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>`, publicly pullable, multi-arch where possible, with the digest captured for the migration.

**Tasks**

1. **Compute the operator-facing tag** (decision 7):
   ```bash
   DATE=$(date -u +%Y-%m-%d)
   SHA=$(git rev-parse --short HEAD)
   TAG="v${DATE}-${SHA}"
   echo "$TAG"
   ```
   Record below in §3 alongside the pre-work table.

2. **Multi-arch build + push:**
   ```bash
   docker buildx build \
     --platform linux/amd64,linux/arm64 \
     --tag ghcr.io/<owner>/corellia-hermes-adapter:${TAG} \
     --tag ghcr.io/<owner>/corellia-hermes-adapter:latest \
     --push \
     adapters/hermes
   ```
   If pre-work flagged the upstream as amd64-only, drop `,linux/arm64` and the resulting single-arch image is fine — note this in the migration's SQL comment.

3. **Capture the manifest-list digest:**
   ```bash
   crane digest ghcr.io/<owner>/corellia-hermes-adapter:${TAG}
   # OR (no crane installed):
   docker buildx imagetools inspect \
     ghcr.io/<owner>/corellia-hermes-adapter:${TAG} \
     --format '{{ .Manifest.Digest }}'
   ```
   The output `sha256:<hash>` is what gets pasted into Phase 4's migration. Same `crane digest` rationale as M2 (decision 22): manifest-list digest, not per-platform.

4. **Verify the image is publicly pullable** (no auth):
   ```bash
   docker logout ghcr.io
   docker pull ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>
   ```
   If this fails with `denied: requested access to the resource is denied`, the GHCR package is still private. Make it public via the GitHub Packages UI: package page → Package settings → Change visibility → Public. **Re-test the pull** before continuing.

5. **Verify Fly can pull it** (this is the *real* test, since Fly's machine network differs from your laptop's):
   ```bash
   fly machines run \
     --rm \
     --org $FLY_ORG_SLUG \
     --region iad \
     ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash> \
     -- /bin/sh -c 'echo HELLO_FROM_FLY; sleep 5'
   ```
   Watch the logs for `HELLO_FROM_FLY`. The `--rm` flag tears down the machine when the command exits. **If this fails**, fix before Phase 7's full smoke depends on the same path. Cleanup any leftover app: `fly apps list | grep corellia-` then `fly apps destroy --yes <name>`.

6. **Record the captured digest** in this doc's pre-work-style block:
   - **Adapter image ref:** `ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>` (paste here)
   - **Operator-facing tag:** `v<YYYY-MM-DD>-<short-sha>` (paste here)
   - **Captured at:** `<date>`
   - **Single-arch fallback?** `<yes/no>`

**Acceptance**

- `crane manifest <ref>@<digest>` succeeds against the captured digest.
- The image is publicly pullable (no auth needed).
- A Fly machine in `iad` boots and prints the test string.
- The digest + tag + date are recorded for Phase 4's SQL comment.

---

### Phase 3 — `adapters/hermes/smoke.sh`

**Goal:** the operator-facing smoke script exists and is documented. Phase 7 invokes it against the registry-pushed image.

**Tasks**

1. **Write `adapters/hermes/smoke.sh`** — bash, ~40 lines, executable:
   ```bash
   #!/usr/bin/env bash
   # adapters/hermes/smoke.sh — manual harness-contract smoke test.
   #
   # Prereqs: fly auth, FLY_ORG_SLUG, and an LLM API key in
   # CORELLIA_SMOKE_API_KEY (a free-tier OpenRouter key is fine).
   #
   # Per docs/executing/hermes-adapter-and-fly-wiring.md decision 26 +
   # blueprint.md §3 (harness contract). Boots the adapter image on a
   # real Fly machine, probes /health, kills it.
   set -euo pipefail

   IMAGE="${CORELLIA_HERMES_ADAPTER:-ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>}"
   APP="corellia-smoke-$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)"
   REGION="${REGION:-iad}"

   trap 'fly apps destroy --yes "$APP" 2>/dev/null || true' EXIT

   echo ">> creating app $APP"
   fly apps create "$APP" --org "$FLY_ORG_SLUG"

   echo ">> setting secrets"
   fly secrets set --app "$APP" \
     CORELLIA_AGENT_ID="$APP" \
     CORELLIA_MODEL_PROVIDER="openrouter" \
     CORELLIA_MODEL_NAME="anthropic/claude-3.5-sonnet" \
     CORELLIA_MODEL_API_KEY="$CORELLIA_SMOKE_API_KEY"

   echo ">> spawning machine"
   MACHINE=$(fly machines run \
     --app "$APP" \
     --region "$REGION" \
     --port 80:8642/tcp:http \
     --port 443:8642/tls:http \
     --autostart \
     --autostop \
     "$IMAGE" \
     | tee /dev/stderr | awk '/Machine ID:/{print $3}')

   echo ">> probing /health (60s timeout)"
   for i in $(seq 1 30); do
     if curl -sf "https://${APP}.fly.dev/health" >/dev/null; then
       echo ">> /health OK"
       break
     fi
     sleep 2
   done

   echo ">> tail of logs:"
   fly logs --app "$APP" -n
   ```
   The trap-on-EXIT teardown is the safety net: even if `set -e` aborts mid-run, the app gets cleaned up. Fly machines accumulate cost; leaks here would matter.

2. **Document invocation in `adapters/hermes/README.md`**:
   ```sh
   export FLY_ORG_SLUG=<your-org-slug>
   export CORELLIA_SMOKE_API_KEY=sk-or-v1-<openrouter-key>
   ./adapters/hermes/smoke.sh
   ```

3. **`chmod +x adapters/hermes/smoke.sh`** and commit.

**Acceptance**

- Script exists, is executable, and is committed.
- `bash -n adapters/hermes/smoke.sh` is clean (syntax-only check, no execution).
- README documents the invocation.

---

### Phase 4 — Migration: backfill `adapter_image_ref` + add `NOT NULL`

**Goal:** the database knows the adapter ref and structurally forbids any future `NULL`.

**Tasks**

1. **Generate migration filename:**
   ```bash
   goose -dir backend/migrations create adapter_image_ref_backfill sql
   ```
   Produces `backend/migrations/<timestamp>_adapter_image_ref_backfill.sql`.

2. **Up block:**
   ```sql
   -- +goose Up

   -- M3 backfill: populate the adapter ref pinned in Phase 2 of
   -- docs/executing/hermes-adapter-and-fly-wiring.md.
   --
   -- Adapter image audit:
   --   registry_ref:  ghcr.io/<owner>/corellia-hermes-adapter
   --   tag:           v<YYYY-MM-DD>-<short-sha>
   --   digest:        sha256:<hash>                  -- multi-arch manifest list
   --   captured_at:   <date>
   --   captured_via:  `crane digest` against the GHCR registry
   --   blueprint:     §11.2 (digest-pinning), §4 (v1 hand-written adapter)
   UPDATE harness_adapters
      SET adapter_image_ref = 'ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>'
    WHERE harness_name = 'hermes';

   -- Defence-in-depth: future inserts/updates can't sneak in a NULL or a
   -- tag-pinned ref. Pairs with M2's CHECK on upstream_image_digest.
   ALTER TABLE harness_adapters
       ALTER COLUMN adapter_image_ref SET NOT NULL,
       ADD CONSTRAINT adapter_image_ref_digest_pinned
           CHECK (adapter_image_ref LIKE '%@sha256:%');

   -- +goose Down
   ALTER TABLE harness_adapters
       DROP CONSTRAINT IF EXISTS adapter_image_ref_digest_pinned,
       ALTER COLUMN adapter_image_ref DROP NOT NULL;

   UPDATE harness_adapters
      SET adapter_image_ref = NULL
    WHERE harness_name = 'hermes';
   ```

3. **Apply:**
   ```bash
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
   ```

4. **Verify in psql:**
   ```sql
   SELECT harness_name, adapter_image_ref FROM harness_adapters;
   -- Expect: hermes | ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>

   -- Constraint: this must fail.
   UPDATE harness_adapters
      SET adapter_image_ref = 'ghcr.io/<owner>/corellia-hermes-adapter:latest'
    WHERE harness_name = 'hermes';
   -- ERROR: new row for relation "harness_adapters" violates check constraint
   --        "adapter_image_ref_digest_pinned"

   -- Restore (the failed update above didn't persist, but verify shape):
   SELECT adapter_image_ref FROM harness_adapters;
   ```

5. **Re-runnability:**
   ```bash
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" down
   goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
   ```
   End state matches.

**Acceptance**

- `goose status` lists the new migration as applied.
- `harness_adapters.adapter_image_ref` is the captured ref, `NOT NULL`.
- The CHECK constraint rejects a tag-pinned UPDATE.
- Down + Up cycles clean.

`★ Insight ─────────────────────────────────────`
- The `ALTER ... ADD CONSTRAINT ... CHECK` runs *after* the UPDATE in the same migration on purpose: PostgreSQL validates the CHECK against existing rows when the constraint is added. If the order were reversed, the constraint would fail validation against the NULL row M2 left behind. The atomic-per-migration semantics of goose mean the UPDATE + ALTER land or fail together; this is why bundling them is safer than two separate migrations (in which a partial apply would leave the DB constraint-checking against a row that doesn't yet have the value).
- The CHECK pattern `LIKE '%@sha256:%'` is more permissive than `LIKE 'ghcr.io/%@sha256:%'` deliberately — pinning the registry host into the constraint would break the M3 → v2 escape hatch where we might host the same image on a different registry (e.g. fly.io's own registry, or a self-hosted Harbor instance). The constraint enforces the *governance property* (digest-pinned) without locking in the *operational choice* (where the image lives). Same reasoning M2 used for not pinning a specific upstream registry in its own CHECK.
`─────────────────────────────────────────────────`

---

### Phase 5 — `internal/deploy/` package

**Goal:** the package exists with the interface, the real `FlyDeployTarget`, and two `NotImplemented` stubs. `go vet ./...` is clean.

**Tasks**

1. **Add the dependency:**
   ```bash
   cd backend
   go get github.com/superfly/fly-go@latest
   ```

2. **New file: `backend/internal/deploy/target.go`.**
   ```go
   package deploy

   import (
       "context"
       "errors"
   )

   // ErrNotImplemented is returned by stub DeployTarget implementations.
   // Per blueprint §11.4: deferred features stub as real interface
   // implementations, not as fake UI buttons. Callers branch on this
   // sentinel to render "Coming soon" or surface a 501.
   var ErrNotImplemented = errors.New("deploy target not implemented")

   // SpawnSpec is the minimal information needed to bring up one
   // AgentInstance on any DeployTarget. Decision 14 of M3 plan.
   type SpawnSpec struct {
       Name     string            // logical name; the target may transform it
       ImageRef string            // registry@sha256:hash; CHECK-enforced
       Env      map[string]string // CORELLIA_* vars to materialise as secrets
       Region   string            // optional; target-specific default applies if empty
       CPUs     int               // optional; target-specific default applies if 0
       MemoryMB int               // optional; target-specific default applies if 0
   }

   // SpawnResult is what the caller persists as the AgentInstance's
   // back-reference to whatever the target created.
   type SpawnResult struct {
       ExternalRef string // e.g. "fly-app:corellia-agent-a1b2c3d4"
       MachineID   string // target-specific identifier
   }

   // HealthStatus is the deployment-side health summary, distinct from
   // the harness-side /health endpoint. "started" means Fly considers
   // the machine running; whether the application inside is responsive
   // is a separate concern (see blueprint §3.1).
   type HealthStatus string

   const (
       HealthUnknown  HealthStatus = "unknown"
       HealthStarting HealthStatus = "starting"
       HealthStarted  HealthStatus = "started"
       HealthStopped  HealthStatus = "stopped"
       HealthFailed   HealthStatus = "failed"
   )

   // DeployTarget is the abstraction over infrastructure providers.
   // Per blueprint §11.1: no Fly-specific (or AWS-specific, etc.) types
   // leak past this interface boundary.
   type DeployTarget interface {
       Kind() string
       Spawn(ctx context.Context, spec SpawnSpec) (SpawnResult, error)
       Stop(ctx context.Context, externalRef string) error
       Destroy(ctx context.Context, externalRef string) error
       Health(ctx context.Context, externalRef string) (HealthStatus, error)
   }
   ```

3. **New file: `backend/internal/deploy/fly.go`.** ~150 lines. Skeleton:
   ```go
   package deploy

   import (
       "context"
       "errors"
       "fmt"
       "strings"

       "github.com/google/uuid"
       fly "github.com/superfly/fly-go"
       "github.com/superfly/fly-go/flaps"
   )

   const (
       flyKind         = "fly"
       defaultRegion   = "iad"
       defaultCPUs     = 1
       defaultMemoryMB = 512
       externalRefPfx  = "fly-app:"
   )

   type FlyDeployTarget struct {
       client  *fly.Client
       orgSlug string
   }

   func NewFlyDeployTarget(token, orgSlug string) *FlyDeployTarget {
       client := fly.NewClient(fly.ClientOptions{Tokens: fly.TokensFromString(token)})
       return &FlyDeployTarget{client: client, orgSlug: orgSlug}
   }

   func (f *FlyDeployTarget) Kind() string { return flyKind }

   func (f *FlyDeployTarget) Spawn(ctx context.Context, spec SpawnSpec) (SpawnResult, error) {
       if err := validateImageRef(spec.ImageRef); err != nil {
           return SpawnResult{}, err
       }
       app := appNameFor(spec.Name)
       region := spec.Region
       if region == "" {
           region = defaultRegion
       }
       cpus := spec.CPUs
       if cpus == 0 {
           cpus = defaultCPUs
       }
       mem := spec.MemoryMB
       if mem == 0 {
           mem = defaultMemoryMB
       }

       // 1. Create app (org-scoped global namespace).
       if _, err := f.client.CreateApp(ctx, &fly.CreateAppInput{
           Name:           app,
           OrganizationID: f.orgSlug,
       }); err != nil {
           return SpawnResult{}, fmt.Errorf("fly: create app %q: %w", app, err)
       }

       // 2. Set secrets (CORELLIA_* and any other env passed in).
       if len(spec.Env) > 0 {
           if _, err := f.client.SetSecrets(ctx, app, spec.Env); err != nil {
               return SpawnResult{}, fmt.Errorf("fly: set secrets on %q: %w", app, err)
           }
       }

       // 3. Spawn machine.
       fc, err := flaps.NewWithOptions(ctx, flaps.NewClientOpts{AppName: app})
       if err != nil {
           return SpawnResult{}, fmt.Errorf("fly: flaps client for %q: %w", app, err)
       }
       m, err := fc.Launch(ctx, fly.LaunchMachineInput{
           Region: region,
           Config: &fly.MachineConfig{
               Image: spec.ImageRef,
               Guest: &fly.MachineGuest{CPUs: cpus, MemoryMB: mem, CPUKind: "shared"},
               AutoDestroy: false,
               // Per decision 20.
               Restart: &fly.MachineRestart{Policy: fly.MachineRestartPolicyOnFailure},
           },
       })
       if err != nil {
           return SpawnResult{}, fmt.Errorf("fly: launch machine in %q: %w", app, err)
       }

       return SpawnResult{
           ExternalRef: externalRefPfx + app,
           MachineID:   m.ID,
       }, nil
   }

   func (f *FlyDeployTarget) Stop(ctx context.Context, externalRef string) error {
       app, err := parseExternalRef(externalRef)
       if err != nil {
           return err
       }
       fc, err := flaps.NewWithOptions(ctx, flaps.NewClientOpts{AppName: app})
       if err != nil {
           return fmt.Errorf("fly: flaps client for %q: %w", app, err)
       }
       machines, err := fc.List(ctx, "")
       if err != nil {
           return fmt.Errorf("fly: list machines for %q: %w", app, err)
       }
       for _, m := range machines {
           if err := fc.Stop(ctx, fly.StopMachineInput{ID: m.ID}, ""); err != nil {
               return fmt.Errorf("fly: stop machine %q: %w", m.ID, err)
           }
       }
       return nil
   }

   func (f *FlyDeployTarget) Destroy(ctx context.Context, externalRef string) error {
       app, err := parseExternalRef(externalRef)
       if err != nil {
           return err
       }
       return f.client.DeleteApp(ctx, app)
   }

   func (f *FlyDeployTarget) Health(ctx context.Context, externalRef string) (HealthStatus, error) {
       app, err := parseExternalRef(externalRef)
       if err != nil {
           return HealthUnknown, err
       }
       fc, err := flaps.NewWithOptions(ctx, flaps.NewClientOpts{AppName: app})
       if err != nil {
           return HealthUnknown, fmt.Errorf("fly: flaps client for %q: %w", app, err)
       }
       machines, err := fc.List(ctx, "")
       if err != nil {
           return HealthUnknown, fmt.Errorf("fly: list machines for %q: %w", app, err)
       }
       if len(machines) == 0 {
           return HealthStopped, nil
       }
       return mapFlyState(machines[0].State), nil
   }

   func mapFlyState(s string) HealthStatus {
       switch s {
       case "started":
           return HealthStarted
       case "starting", "created":
           return HealthStarting
       case "stopped", "stopping":
           return HealthStopped
       case "destroyed", "destroying":
           return HealthStopped
       default:
           return HealthFailed
       }
   }

   // appNameFor returns "corellia-agent-<8-char-uuid-prefix>" per decision 17.
   // Accepts either a stringified UUID or any string, in which case the first
   // 8 hex chars of a UUIDv5(name) are used (deterministic, collision-resistant
   // for human-friendly names).
   func appNameFor(name string) string {
       if id, err := uuid.Parse(name); err == nil {
           return "corellia-agent-" + id.String()[:8]
       }
       id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("corellia/"+name))
       return "corellia-agent-" + id.String()[:8]
   }

   func parseExternalRef(ref string) (string, error) {
       if !strings.HasPrefix(ref, externalRefPfx) {
           return "", fmt.Errorf("deploy: external ref %q does not have %q prefix", ref, externalRefPfx)
       }
       return strings.TrimPrefix(ref, externalRefPfx), nil
   }

   func validateImageRef(ref string) error {
       if !strings.Contains(ref, "@sha256:") {
           return errors.New("deploy: image ref must be digest-pinned (@sha256:...)")
       }
       return nil
   }
   ```
   The exact `fly-go` API surface may have shifted between SDK versions — this skeleton is the *shape*; consult the SDK's godoc at execution time and adjust calls to match. The structural decisions (what the methods do, what they return, where the validation lives) are stable.

4. **New file: `backend/internal/deploy/stubs.go`.**
   ```go
   package deploy

   import "context"

   type LocalDeployTarget struct{}

   func NewLocalDeployTarget() *LocalDeployTarget { return &LocalDeployTarget{} }
   func (*LocalDeployTarget) Kind() string         { return "local" }
   func (*LocalDeployTarget) Spawn(_ context.Context, _ SpawnSpec) (SpawnResult, error) {
       return SpawnResult{}, ErrNotImplemented
   }
   func (*LocalDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
   func (*LocalDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
   func (*LocalDeployTarget) Health(_ context.Context, _ string) (HealthStatus, error) {
       return HealthUnknown, ErrNotImplemented
   }

   type AWSDeployTarget struct{}

   func NewAWSDeployTarget() *AWSDeployTarget { return &AWSDeployTarget{} }
   func (*AWSDeployTarget) Kind() string       { return "aws" }
   func (*AWSDeployTarget) Spawn(_ context.Context, _ SpawnSpec) (SpawnResult, error) {
       return SpawnResult{}, ErrNotImplemented
   }
   func (*AWSDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
   func (*AWSDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
   func (*AWSDeployTarget) Health(_ context.Context, _ string) (HealthStatus, error) {
       return HealthUnknown, ErrNotImplemented
   }
   ```

5. **Extend `backend/queries/harness_adapters.sql`** (M2's file):
   ```sql
   -- name: UpdateHarnessAdapterImageRef :one
   UPDATE harness_adapters
      SET adapter_image_ref = $2,
          updated_at = now()
    WHERE id = $1
    RETURNING *;
   ```

6. **Extend `backend/internal/adapters/service.go`:**
   - Widen the private `adapterQueries` interface with `UpdateHarnessAdapterImageRef(ctx, params) (db.HarnessAdapter, error)`.
   - Add `func (s *Service) UpdateImageRef(ctx context.Context, id uuid.UUID, ref string) (db.HarnessAdapter, error)`.
   - Same redacted error pattern as `Get` — return `ErrNotFound` on `pgx.ErrNoRows`, raw error otherwise.

7. **Run codegen:**
   ```bash
   cd backend && sqlc generate
   ```
   New entries on `Querier` and `Queries`. `git diff` should be additive only.

8. **Compile and test:**
   ```bash
   cd backend && go vet ./... && go build ./... && go test ./...
   ```

**Acceptance**

- `internal/deploy/` exists with three files (target, fly, stubs) and ~250 LOC total.
- `LocalDeployTarget` and `AWSDeployTarget` satisfy the interface (compile-time `var _ DeployTarget = ...` assertions in `target_test.go`).
- `adapters.Service.UpdateImageRef` exists and is exercised by Phase 8's tests.
- Build + vet + test clean.

---

### Phase 6 — `cmd/api/main.go` wiring

**Goal:** the deploy targets are constructed at boot, registered on `httpsrv.Deps`, and the `Config`'s `FlyAPIToken` / `FlyOrgSlug` finally have a reader.

**Tasks**

1. **Edit `backend/cmd/api/main.go`:**
   - Import `"github.com/hejijunhao/corellia/backend/internal/adapters"` (already needed once `UpdateImageRef` has a future caller — for M3, no consumer yet, but pre-wire now to avoid M4-time `main.go` churn) and `"github.com/hejijunhao/corellia/backend/internal/deploy"`.
   - After `agentsSvc := agents.NewService(queries)`, add:
     ```go
     adaptersSvc := adapters.NewService(queries)
     _ = adaptersSvc // M3 wires the service; first HTTP caller arrives in M4.

     flyTarget := deploy.NewFlyDeployTarget(cfg.FlyAPIToken, cfg.FlyOrgSlug)
     deployTargets := map[string]deploy.DeployTarget{
         flyTarget.Kind():                    flyTarget,
         deploy.NewLocalDeployTarget().Kind(): deploy.NewLocalDeployTarget(),
         deploy.NewAWSDeployTarget().Kind():   deploy.NewAWSDeployTarget(),
     }
     slog.Info("deploy targets initialised",
         "kinds", strings.Join(keysOf(deployTargets), ","),
         "fly_org", cfg.FlyOrgSlug)
     ```
   - Add `DeployTargets: deployTargets` to the `httpsrv.Deps{...}` literal between `AgentsHandler` and `AllowedOrigin`.
   - Add a tiny helper at the bottom of the file:
     ```go
     func keysOf[V any](m map[string]V) []string {
         out := make([]string, 0, len(m))
         for k := range m {
             out = append(out, k)
         }
         return out
     }
     ```
     (Or use `slices.Collect(maps.Keys(...))` from the stdlib — same effect; pick whichever the existing codebase style favours.)

2. **Edit `backend/internal/httpsrv/server.go`:**
   - Add `DeployTargets map[string]deploy.DeployTarget` to `Deps` between `AgentsHandler` and `AllowedOrigin`. Import `"github.com/hejijunhao/corellia/backend/internal/deploy"`.
   - **Do not mount any new HTTP route in M3.** The field exists; the consumer arrives in M4. Verify with `grep -r DeployTargets backend/internal/httpsrv/` after the edit — should appear only on `Deps`.

3. **Verify the field is reachable from server construction without compiler complaints.**
   ```bash
   cd backend && go vet ./... && go build ./...
   ```

4. **Boot smoke:**
   ```bash
   cd backend && air
   ```
   Watch logs for:
   - `jwks initialised`
   - `deploy targets initialised kinds=fly,local,aws fly_org=<slug>`
   - `listening addr=:8080`
   Three lines, in order, ~1s apart. If `deploy targets initialised` is missing or the `fly_org` is empty, check `backend/.env`'s `FLY_ORG_SLUG`.

5. **HTTP smoke** (proves M3 didn't break M2):
   ```bash
   curl -i -X POST http://localhost:8080/corellia.v1.AgentsService/ListAgentTemplates \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -d '{}'
   # Expect: 200 with the Hermes template (M2 behaviour intact).
   ```

**Acceptance**

- Backend boots cleanly.
- Boot log includes the `deploy targets initialised` line.
- M2's `/agents` page still works end-to-end (FE call + DB read).
- `go vet ./...` clean; no unused-import or dead-code warnings.

---

### Phase 7 — End-to-end harness contract validation (smoke)

**Goal:** prove the harness contract works on real Fly with the registry-pushed image. Out-of-band of the control plane — exercises only Phase 1's image + Phase 5's `FlyDeployTarget`.

**Tasks**

1. **Run `adapters/hermes/smoke.sh`** with real credentials:
   ```bash
   export FLY_ORG_SLUG=<your-org-slug>
   export CORELLIA_SMOKE_API_KEY=sk-or-v1-<openrouter-key>
   ./adapters/hermes/smoke.sh
   ```
   Expect:
   - `>> creating app corellia-smoke-<8char>` then Fly CLI confirms.
   - `>> setting secrets` confirms the secret-set call.
   - `>> spawning machine` returns a Machine ID.
   - `>> probing /health (60s timeout)` flips to `>> /health OK` within ~30s.
   - `>> tail of logs:` shows Hermes booting (look for the upstream's startup banner).
   - The `trap` cleanup destroys the app on exit.

2. **Run a parallel Go-level smoke** that exercises `FlyDeployTarget` directly. Create `cmd/smoke-deploy/main.go` (gitignored or land it permanently — operator's call):
   ```go
   package main

   import (
       "context"
       "fmt"
       "os"
       "time"

       _ "github.com/joho/godotenv/autoload"

       "github.com/hejijunhao/corellia/backend/internal/config"
       "github.com/hejijunhao/corellia/backend/internal/deploy"
   )

   func main() {
       cfg := config.Load()
       target := deploy.NewFlyDeployTarget(cfg.FlyAPIToken, cfg.FlyOrgSlug)
       ctx := context.Background()

       res, err := target.Spawn(ctx, deploy.SpawnSpec{
           Name:     fmt.Sprintf("smoke-%d", time.Now().Unix()),
           ImageRef: "ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>",
           Env: map[string]string{
               "CORELLIA_AGENT_ID":       "smoke-go-1",
               "CORELLIA_MODEL_PROVIDER": "openrouter",
               "CORELLIA_MODEL_NAME":     "anthropic/claude-3.5-sonnet",
               "CORELLIA_MODEL_API_KEY":  os.Getenv("CORELLIA_SMOKE_API_KEY"),
           },
       })
       if err != nil {
           fmt.Fprintln(os.Stderr, "spawn:", err)
           os.Exit(1)
       }
       fmt.Println("spawned:", res.ExternalRef, res.MachineID)

       defer func() {
           if err := target.Destroy(ctx, res.ExternalRef); err != nil {
               fmt.Fprintln(os.Stderr, "destroy:", err)
           }
       }()

       for i := 0; i < 30; i++ {
           h, _ := target.Health(ctx, res.ExternalRef)
           fmt.Println("health:", h)
           if h == deploy.HealthStarted {
               break
           }
           time.Sleep(2 * time.Second)
       }
   }
   ```
   Run: `cd backend && go run ./cmd/smoke-deploy`. Should print `spawned: ...`, then `health: starting` → `health: started` within ~30s, then clean up on exit.

3. **Confirm all Fly apps are destroyed:**
   ```bash
   fly apps list | grep corellia-smoke || echo "clean"
   ```
   Should print `clean`. If not, manual `fly apps destroy --yes <name>` per leftover.

**Acceptance**

- Both smokes (shell + Go) green end-to-end.
- `/health` returns 200 within 30s.
- Apps cleaned up; no leaks.

---

### Phase 8 — Tests + check matrix + changelog draft

**Goal:** coverage for the deploy package's pure logic; full check matrix green; changelog drafted.

**Tasks**

1. **`backend/internal/deploy/target_test.go`** — interface conformance + sentinel:
   ```go
   package deploy

   import (
       "context"
       "errors"
       "testing"
   )

   var (
       _ DeployTarget = (*FlyDeployTarget)(nil)
       _ DeployTarget = (*LocalDeployTarget)(nil)
       _ DeployTarget = (*AWSDeployTarget)(nil)
   )

   func TestStubsReturnNotImplemented(t *testing.T) {
       ctx := context.Background()
       cases := []DeployTarget{NewLocalDeployTarget(), NewAWSDeployTarget()}
       for _, tgt := range cases {
           t.Run(tgt.Kind(), func(t *testing.T) {
               if _, err := tgt.Spawn(ctx, SpawnSpec{}); !errors.Is(err, ErrNotImplemented) {
                   t.Errorf("Spawn: want ErrNotImplemented, got %v", err)
               }
               if err := tgt.Stop(ctx, "x"); !errors.Is(err, ErrNotImplemented) {
                   t.Errorf("Stop: want ErrNotImplemented, got %v", err)
               }
               if err := tgt.Destroy(ctx, "x"); !errors.Is(err, ErrNotImplemented) {
                   t.Errorf("Destroy: want ErrNotImplemented, got %v", err)
               }
               if _, err := tgt.Health(ctx, "x"); !errors.Is(err, ErrNotImplemented) {
                   t.Errorf("Health: want ErrNotImplemented, got %v", err)
               }
           })
       }
   }
   ```

2. **`backend/internal/deploy/fly_test.go`** — pure logic only, no Fly API:
   ```go
   package deploy

   import (
       "strings"
       "testing"

       "github.com/google/uuid"
   )

   func TestAppNameFor_UUID(t *testing.T) {
       id := uuid.MustParse("a1b2c3d4-e5f6-4789-0abc-def012345678")
       got := appNameFor(id.String())
       want := "corellia-agent-a1b2c3d4"
       if got != want {
           t.Errorf("got %q, want %q", got, want)
       }
       if len(got) > 63 {
           t.Errorf("Fly app name max 63 chars, got %d (%q)", len(got), got)
       }
   }

   func TestAppNameFor_NonUUID_DeterministicAndShort(t *testing.T) {
       a := appNameFor("alice")
       b := appNameFor("alice")
       if a != b {
           t.Errorf("non-deterministic: %q vs %q", a, b)
       }
       if !strings.HasPrefix(a, "corellia-agent-") {
           t.Errorf("missing prefix: %q", a)
       }
       if len(strings.TrimPrefix(a, "corellia-agent-")) != 8 {
           t.Errorf("suffix not 8 chars: %q", a)
       }
   }

   func TestParseExternalRef(t *testing.T) {
       got, err := parseExternalRef("fly-app:corellia-agent-a1b2c3d4")
       if err != nil || got != "corellia-agent-a1b2c3d4" {
           t.Errorf("got %q err %v, want corellia-agent-a1b2c3d4 nil", got, err)
       }
       if _, err := parseExternalRef("k8s:foo"); err == nil {
           t.Error("expected error on wrong-prefix ref")
       }
   }

   func TestValidateImageRef(t *testing.T) {
       if err := validateImageRef("ghcr.io/x/y@sha256:abc"); err != nil {
           t.Errorf("digest-pinned ref rejected: %v", err)
       }
       if err := validateImageRef("ghcr.io/x/y:latest"); err == nil {
           t.Error("tag-pinned ref accepted (should reject)")
       }
   }
   ```

3. **Extend `backend/internal/adapters/service_test.go`** (or create if M2 didn't ship one) with a `TestUpdateImageRef_HappyPath` + `TestUpdateImageRef_NotFound`. Same `fakeQueries` pattern as M2's `agents` tests.

4. **Run the full check matrix:**
   ```bash
   cd backend && go vet ./... && go build ./... && go test ./...
   pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build
   ```
   All clean. Frontend should be unchanged in M3 — if `pnpm build` complains, something accidental was edited.

5. **DB sanity:**
   ```sql
   SELECT harness_name, upstream_image_digest, adapter_image_ref
   FROM harness_adapters;
   -- hermes | sha256:d4ee...                 | ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>
   ```

6. **Cleanup.** Search for `// TODO`, `console.log`, dangling smoke binaries (`backend/cmd/smoke-deploy/` should either be committed permanently or deleted — operator's call; recommend keeping with a `// +build smoke` build tag or moving to `adapters/hermes/smoke.go` per the Phase 3 README).

7. **Draft changelog entry.** New top-level entry, version bumped to `0.4.0` (M3 lands a new domain package + first real Fly substrate; semver-flavoured by milestone). Index of changes + per-phase summaries in the established What / Where / Why style. Sections to include:
   - What: adapter image, deploy package, migration, wiring.
   - Where: file list per Phase tasks.
   - Why: blueprint §3 contract first exercised; §11.1 Fly-isolation rule first enforced; §11.4 NotImplemented stubs first present.
   - Risks acknowledged: cosign deferred; no CI integration for Fly; manual smoke only.
   - Resolves: roadmap §M3.
   - Supersedes: 0.1.0's "FLY_API_TOKEN required but unread" placeholder.

**Acceptance**

- Full check matrix green.
- Deploy package coverage: ~5 tests, ~50 LOC of test code, all passing.
- DB sanity SELECT shows the correctly backfilled, NOT NULL adapter ref.
- Changelog entry drafted (or queued).

---

## 5. Files touched

**New (top-level):**
- `adapters/hermes/Dockerfile`
- `adapters/hermes/entrypoint.sh`
- `adapters/hermes/README.md`
- `adapters/hermes/.dockerignore`
- `adapters/hermes/smoke.sh`

**New (backend):**
- `backend/migrations/<timestamp>_adapter_image_ref_backfill.sql`
- `backend/internal/deploy/target.go`
- `backend/internal/deploy/fly.go`
- `backend/internal/deploy/stubs.go`
- `backend/internal/deploy/target_test.go`
- `backend/internal/deploy/fly_test.go`
- `backend/cmd/smoke-deploy/main.go` (optional — operator's call whether to commit)

**Modified (backend):**
- `backend/queries/harness_adapters.sql` (append `UpdateHarnessAdapterImageRef`)
- `backend/internal/db/harness_adapters.sql.go` (sqlc-regenerated)
- `backend/internal/db/querier.go` (gains the new method; sqlc-regenerated)
- `backend/internal/adapters/service.go` (append `UpdateImageRef` + widen interface)
- `backend/internal/adapters/service_test.go` (append two tests; or create if M2 didn't)
- `backend/internal/httpsrv/server.go` (`Deps.DeployTargets` field added)
- `backend/cmd/api/main.go` (deploy-target construction + helper + log line)
- `backend/go.mod` / `backend/go.sum` (`fly-go` direct, `flaps` indirect)

**Untouched (intentionally):**
- All other migrations.
- All FE code (M3 is BE + ops only).
- All proto files (no new RPC in M3).
- Auth, config, users, organizations, agents domain packages (M2 surfaces).
- `frontend/` entirely.

---

## 6. Risk register

- **Upstream Hermes env-var translation guesswork.** Decision 4 mitigates by requiring inspection during pre-work, but if the upstream's behaviour isn't fully documented and the inspection misses a required var, the spawned machine will fail at `/health`. Phase 7's smoke catches this loudly. Mitigation if it bites: inspect the failing machine's logs (`fly logs --app <smoke-app>`), find the missing var, add a translation line in `entrypoint.sh`, rebuild, re-push, capture new digest, write a new migration backfilling the new digest. Cost: one extra round-trip; same as a v2 upstream bump.
- **`fly-go` SDK API drift.** The skeleton in Phase 5 assumes a specific shape; the SDK is pre-1.0 and may have moved. Mitigation: consult `pkg.go.dev/github.com/superfly/fly-go` at execution time and adjust calls. The decision-15 rationale stands either way; only the call sites change. **Worth flagging: if the SDK has reorganised package structure (e.g., the old `fly-go` was split into `fly` + `flaps` + something else), the import lines in this plan need rewriting; the *shape* of the wrapper doesn't.**
- **GHCR public-image cold-pull on Fly.** First pull from GHCR to a Fly machine in `iad` typically takes 20–40s for a several-hundred-MB image. The Phase 7 smoke's 60s `/health` budget should cover it, but if the upstream Hermes image is unusually large, bump the timeout. **Not a regression**; just a one-time cold cost per region per digest.
- **GHCR repo accidentally private.** Decision 5 specifies public; Phase 2 task 4 verifies. If a future contributor recreates the package privately by accident, Fly pulls fail with `denied`. Mitigation: README.md in `adapters/hermes/` documents the public-visibility requirement; Phase 2 verification step rehearses the failure mode.
- **Adapter image arch-mismatch.** If `--platform linux/arm64` is included but upstream is amd64-only, `docker buildx build` errors at the `FROM` step. Pre-work's `crane manifest` check catches this; decision 6 explicitly documents the fallback path.
- **`exec` missing from `entrypoint.sh`.** A single-character omission turns clean shutdown into hard-kill (insight in Phase 1). Mitigation: code-review checks; Phase 7 smoke's `fly machines stop` exercise is the empirical test. If shutdowns hang, this is the first place to look.
- **Fly app-name collision** (the global namespace). With `corellia-agent-<8char>` prefixes, collision odds are ~3.4×10⁻¹⁰ per million agents — negligible. If it happens (rare cosmic event), `Spawn` returns Fly's error, M4's caller surfaces it; remediation is "retry with a fresh UUID" which `appNameFor` already produces.
- **Cost leak from forgotten smoke runs.** A Phase 7 smoke that crashes mid-run could leave a Fly app + machine running. `smoke.sh`'s `trap ... EXIT` is the safety net; the Go smoke uses `defer target.Destroy`. If `kill -9` interrupts either, the trap won't fire — operator must `fly apps list | grep corellia-smoke` after a crash. Cost is bounded (auto-stop kicks in on idle), but worth noting.
- **`adapter_image_ref` CHECK constraint blocks legitimate v2 changes.** If v2 needs to support a non-`@sha256:` ref format (e.g., signed manifest references with a different shape), the constraint must be relaxed. Mitigation: it's one ALTER TABLE migration to drop and recreate. Cheap to evolve.
- **`Config.FlyAPIToken` validity at boot.** `caarlos0/env` validates *presence* (required), not *validity*. A garbage token boots fine; the first `Spawn` call fails authentication. Mitigation: either accept the late-fail (`Spawn` returns the auth error to M4's handler), or add a Phase 6 boot-time `client.GetCurrentUser()`-equivalent ping. Decision: **accept late-fail for v1** (matches `db.NewPool`'s posture; no boot-time DB query either). Note in changelog as a known limitation.
- **Hermes-native env vars conflict with adapter-internal vars.** If Hermes happens to read a var named `CORELLIA_*` directly (extremely unlikely but possible), the wrapper's translation could shadow it. Mitigation: pre-work's `docker inspect ... .Config.Env` lists every var the image declares; no `CORELLIA_*` should be among them. If it is, prefix-namespace the wrapper's translation to avoid the collision.
- **goose migration name collision.** If two M3-track branches both run `goose create adapter_image_ref_backfill sql`, the timestamps differ but the names match — goose tolerates this, but it's confusing. Single-branch discipline avoids.
- **`fly machines run --rm` semantic drift.** Some Fly CLI versions interpret `--rm` differently than others. The smoke script's `trap` is the load-bearing teardown; `--rm` is belt-and-braces.

---

## 7. Out of scope (explicit)

- **Any HTTP RPC for spawn / fleet.** No `SpawnAgent`, no `ListAgentInstances`, no `GetAgentInstance`. M4.
- **`agent_instances` / `secrets` / `deploy_targets` schema.** M4.
- **The deploy modal / fleet view in the FE.** M4.
- **CI integration for the Fly smoke.** Manual + pre-merge only (decision 26).
- **A second adapter** (LangGraph, CrewAI, etc.). The M2 sneak-peek cards stay static.
- **`corellia.yaml` manifest embedded in the adapter image.** v2 (decision 8).
- **cosign / Sigstore signature verification of the adapter image.** v2 hardening (risk register).
- **`fly.toml`-style declarative app config.** M3 uses Machines API directly.
- **Per-org / per-template region or resource overrides.** v1.5 (decisions 18 + 19).
- **Streaming logs** (`Logs(ctx, ref) <-chan LogLine`). Out of `DeployTarget` interface in M3 (decision 13).
- **`Stop` / `Destroy` / `Health` exposure as RPCs.** Methods exist; no HTTP surface. M4 + v1.5.
- **A dedicated `corellia/hermes-adapter` Docker Hub mirror.** GHCR only.
- **Pull-secret config on Fly.** The image is public; no secrets needed (decision 5).
- **Backfilling existing-but-non-existent `agent_instances`.** None exist in M3.
- **Frontend changes of any kind.** Verified by `pnpm build` being unchanged.

---

## 8. Definition of done

The `corellia/hermes-adapter` image exists at `ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>`, publicly pullable, multi-arch (or amd64-only with a documented fallback), built `FROM` the same upstream Hermes digest M2 pinned. The database knows that ref via a new migration that backfills `harness_adapters.adapter_image_ref` and tightens the column to `NOT NULL` plus a `LIKE '%@sha256:%'` CHECK constraint — encoding §11.2 governance for our adapter exactly as M2 did for upstream. The `backend/internal/deploy/` package exists with a 5-method `DeployTarget` interface, a real `FlyDeployTarget` (uses `fly-go` against the Machines + Apps APIs, named per `corellia-agent-<8-char-uuid>`, region-defaults `iad`, 1×shared / 512MiB), and two `NotImplemented` stubs (`LocalDeployTarget`, `AWSDeployTarget`) — the §11.4 deferred-feature rule made concrete. `cmd/api/main.go` constructs all three targets at boot and registers them on `httpsrv.Deps.DeployTargets` (no HTTP consumer in M3 — verified). The `adapters.Service` (M2's package) gains an `UpdateImageRef` method backed by a new sqlc query, ready for the post-v1 adapter-bump CLI. The harness contract from blueprint §3 is exercised end-to-end by a manual `adapters/hermes/smoke.sh` + a Go-level `cmd/smoke-deploy` — both spawn a real Fly machine, observe `/health` returning 200 within 30s, and clean up. The full check matrix (`go vet`, `go build`, `go test`, `pnpm type-check`, `pnpm lint`, `pnpm build`) is green; deploy-package tests cover interface conformance + naming derivation + ref validation + stub `ErrNotImplemented` returns. The `FLY_API_TOKEN` and `FLY_ORG_SLUG` env vars — required by `config.Config` since 0.1.0 but unread until now — finally have a reader, surfaced in a boot log line.

This is the milestone where the abstractions Corellia is built around stop being aspirational and start running real workloads. M4 (spawn flow + fleet view) extends rather than scaffolds: every infrastructure dependency it needs already exists and has been smoke-tested.
