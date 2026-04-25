# Plan — M4: Spawn flow + fleet view (the demo moment)

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/plans/post-0.2.6-roadmap.md` §M4 (parent roadmap; this is its detailed plan)
- `docs/executing/agent-catalog.md` (M2 — provides `agent_templates` + `harness_adapters`; this plan FK's against `agent_templates.id` and reads `harness_adapters.adapter_image_ref` at spawn time)
- `docs/plans/hermes-adapter-and-fly-wiring.md` (M3, not yet written — fills `harness_adapters.adapter_image_ref` and ships `internal/deploy/{DeployTarget,FlyDeployTarget}`; M4 is the *first* caller of `FlyDeployTarget.Spawn`)
- `docs/blueprint.md` §3 (runtime contract — `/health` is what the poller probes), §3.2 (configuration contract — `CORELLIA_*` env vars; spawn is what actually sets them), §4 (adapter strategy — adapter is the env-var translator, M4 trusts it), §5 (digest pinning — spawn reads the pinned digest off `harness_adapters` and never resolves a tag), §8 (Fly topology — one AgentInstance = one Fly app = one machine; M4 enforces this), §9 (data model — M4 lands `agent_instances` + `secrets` + `deploy_targets`), §10 (RPG-character-creation flow — M4 *is* this flow), §10 last paragraph (Spawn N — the demo moment), §11 (architecture rules: §11.1 Fly only inside `FlyDeployTarget`, §11.3 `CORELLIA_*` env-var convention, §11.4 deferred features stub as real interfaces)
- `docs/stack.md` §3 (Connect-go contract), §6 (data model + sqlc), §11.6 (no Supabase outside `auth/`+`db/`), §11.9 (handlers <30 LOC)
- `docs/changelog.md` §0.2.5 (the domain/handler/sentinel pattern this plan replicates), §0.3.0 (the wizard/state-machine pattern the deploy modal replicates), §0.3.1 (`router.replace` rule, fail-loud on misconfiguration)

---

## 1. Objective

Ship blueprint §10 end-to-end. The user-visible loop is:

> Sign in → click **Hermes** card on `/agents` → **Deploy** modal collects name + provider + API key + model → submit → backend creates an `agent_instances` row in `pending` → `FlyDeployTarget.Spawn` creates one Fly app + secrets + machine → backend polls `/health` until passing → status flips to `running` → frontend redirects to `/fleet` → new agent appears with status badge and a logs link.

Plus the demo affordance:

> **Deploy 5** on the catalog → same form with a count + name-prefix → backend fans out five spawns in parallel via goroutines → all five appear in `/fleet` within seconds.

When this lands the codebase passes blueprint §1's "end-to-end demonstrable slice" bar — v1 is shippable.

### What M4 delivers concretely

1. **Three new tables** — `deploy_targets`, `agent_instances`, `secrets` — per blueprint §9. One seed row in `deploy_targets` (`fly`).
2. **Two extended packages** — `internal/agents/` gains `Spawn`, `SpawnN`, `List`, `Get`, `Stop`, `Destroy`; `internal/deploy/` (delivered by M3) is consumed for the first time.
3. **Six new RPCs** — `SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance`.
4. **Frontend deploy modal** at `/agents` — replaces M2's disabled "Deploy" button with a real one.
5. **Frontend fleet page** at `/fleet` — replaces M1's `ComingSoon` stub with a real listing + status badges + logs link.
6. **Polling-based health convergence** — backend goroutine drives `pending → running` (or `pending → failed`) by probing `/health` on the spawned machine every few seconds for a bounded window.

### What M4 does *not* deliver (deferred, scoped explicitly)

- **Streaming log tails over RPC** (post-v1 per blueprint §13). Logs link out to Fly dashboard.
- **Stop/start lifecycle UI niceties** (start-after-stop reuse, scheduled stops). Stop button exists; start-after-stop is "destroy + spawn fresh" in v1.
- **Skills, tools, memory, audit log, observability, IAM** — all blueprint §13 deferrals.
- **Multi-template catalog** — Hermes only (M2).
- **AWS / SkyPilot / Local deploy targets** — M3 ships them as `NotImplemented` stubs; the UI doesn't surface a target picker (the `deploy_target_id` is hard-resolved to `fly` server-side).

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Tables to land in M4 | **`deploy_targets`, `agent_instances`, `secrets`** in one migration file. Seed `deploy_targets` with one `fly` row | Roadmap §1's "no table before its first reader." All three have callers in M4. Seeding `fly` here means the FK target exists before the first `agent_instances` insert |
| 2 | Migration packaging | Single migration `*_spawn_flow.sql`, schema + seed + indexes in one transaction | Matches M2's packaging (`*_agent_catalog.sql`). Goose migrations are atomic per file; partial-apply is impossible |
| 3 | `agent_instances.status` enum | `TEXT NOT NULL CHECK (status IN ('pending','running','stopped','failed','destroyed'))` with `DEFAULT 'pending'` | Matches blueprint §9 status set verbatim. CHECK over `CREATE TYPE` for the same reason as M2 decision 5 (no separate down-block, no type-drop ordering) |
| 4 | `agent_instances.deploy_external_ref` | `TEXT NULL` (filled when Fly app is created; null in `pending` state pre-Fly-call) | The row is inserted *before* the Fly call so the spawn is auditable even on Fly failure. The ref doesn't exist yet at insert; nullable is honest |
| 5 | `agent_instances.deploy_target_id` | `UUID NOT NULL REFERENCES deploy_targets(id)`. Resolved server-side from the seed `fly` row; not user-selectable in v1 | Per blueprint §11.4 deferred features are real interfaces, not fake UI. Server-side resolution means the FK exists and is exercised; no fake "AWS / SkyPilot" option in the UI |
| 6 | `secrets` table shape | `(id, agent_instance_id, key_name, storage_ref, created_at, updated_at)`. **No `value` column** | Per blueprint §9: raw secrets live in Fly's secret store, never our DB. `storage_ref` is the opaque Fly handle (e.g. `fly:corellia-agent-<uuid>:CORELLIA_MODEL_API_KEY`). DB record exists for audit + lifecycle (knowing *what was set* without exposing *what it was*) |
| 7 | Where the API key actually goes | Forwarded **once**, in-memory, from the Connect handler → `agents.Service.Spawn` → `FlyDeployTarget.Spawn` → Fly's `app secrets set` API call. Never written to `agent_instances`, never written to `secrets.value` (which doesn't exist), never logged | The API key is the single most sensitive value in the request. Single-pass-and-forget is the correct shape; logging a redacted form (`****1234`) is acceptable but unnecessary — `slog.Info("spawn complete", ...)` should not name the secret at all |
| 8 | `agent_instances.config_overrides` | `JSONB NOT NULL DEFAULT '{}'` | Per blueprint §9. Today's only writer leaves it empty; future per-instance config edits land here without schema churn |
| 9 | Org isolation on `agent_instances` | `org_id UUID NOT NULL REFERENCES organizations(id)`, set from `AuthClaims` → `users.org_id` at insert. **All read queries filter `WHERE org_id = $1`** | This is where multi-tenancy *first* gets exercised. M4 is the right place because it's the first table where cross-org leakage would be visible (a user seeing another org's agents). RLS stays disabled per stack §6; enforcement is in the queries |
| 10 | `agent_instances.owner_user_id` | `UUID NOT NULL REFERENCES users(id)`. Set from `AuthClaims.AuthUserID` → `users.id` lookup. Today equals "the spawning user," not currently a filter axis — but it's the audit trail | Per blueprint §9. v1 doesn't surface "my agents vs others' agents" filtering; the column exists for audit + future per-user views. No additive migration needed when that lands |
| 11 | Indexes on `agent_instances` | `(org_id, created_at DESC)` for fleet view paging; `(deploy_external_ref) WHERE deploy_external_ref IS NOT NULL` for inverse Fly→our-row lookups | Fleet page is the hot read path: "show me this org's agents, newest first." The partial unique index on `deploy_external_ref` means we'll catch double-spawns to the same Fly app at the DB layer instead of relying on application-level idempotency |
| 12 | RPC service mounting | `corellia.v1.AgentsService` extends; **no new service**. New methods: `SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance` | The service is the right scope (per blueprint §2 the user-facing unit is "Agent"). Templates and instances are both within that scope. One service file per domain (stack §3) — `agents.proto` already exists |
| 13 | `SpawnAgent` request shape | `template_id, name, model_provider (enum), model_name, model_api_key` | The five fields blueprint §10 calls out. `model_provider` as a proto `enum` so the FE picker can be type-driven; `model_name` as a string because the model list is provider-specific and not worth enumerating. The API key is a string field; the proto comment marks it `// SECRET — never logged` |
| 14 | `SpawnNAgents` request shape | `template_id, name_prefix, count, model_provider, model_name, model_api_key`. `count` capped server-side at **10** for v1 | The demo's "fan out 5" needs a sane upper bound. 10 is well above the demo's needs and well below "we accidentally DOS'd Fly's API" — a single misclick on `count=1000` should be impossible from the UI but also impossible from a hand-crafted RPC |
| 15 | All N agents share one API key | The N spawns reuse the same `model_api_key` — copied to N Fly apps' secret stores. Demo affordance, not production | Demoing "agents at scale" should not require typing the API key 5 times. The trade-off is per-instance key rotation later means revoking + re-spawning, which is fine for a hackathon-scoped feature |
| 16 | Polling `pending → running` | **Server-side polling** in a goroutine spawned by `agents.Service.Spawn`. Probe every **2 seconds** for up to **90 seconds**; flip to `running` on first 200, `failed` on timeout. The poll goroutine has its own context detached from the request | Roadmap §6 OQ4: poll vs webhook → poll. Reasoning: webhook requires a public BE URL that Fly can reach (we don't have one in dev), polling is "stuff a goroutine in the orchestrator," and Fly's machine readiness is fast (<30s typical). The detached context is critical: the user's RPC call returns *immediately* after the row insert + Fly app create; convergence happens in the background. Otherwise the FE waits 30s on a single round-trip, which the FE wizard pattern (M1) is structurally ill-suited for |
| 17 | What `SpawnAgent` returns to the client | The freshly-inserted `AgentInstance` row in `pending` state, *before* the Fly call has even started. The FE then redirects to `/fleet` and watches the row converge | "Return fast, converge in background" matches the demo's pacing. The FE rendering "pending" with a spinner is more honest than blocking the modal for 30s |
| 18 | How the FE sees `pending → running` | **Refetch-on-interval.** The `/fleet` page polls `ListAgentInstances` every 3 seconds while *any* row is `pending`; stops polling once all rows are terminal (`running`, `stopped`, `failed`, `destroyed`). No SSE, no WebSocket, no Connect streaming | Symmetry with the BE choice (polling). Connect-go *can* server-stream but that's a v2 capability; the catalog page polls (refresh-on-tab-focus is overkill but works), the fleet page polls. One pattern across the FE |
| 19 | What runs the spawn goroutine | `agents.Service.Spawn` itself spawns the poll goroutine via `go s.pollHealth(ctx, instanceID)`. **The goroutine binds to `context.Background()`** (with a 90s timeout) — *not* the request's ctx, which dies when the handler returns | This is the structural detail that makes "fast return + background convergence" actually work. Tying the goroutine to the request ctx would cancel the poll the moment the handler returns its response. Process-shutdown handling is acceptable as "in-flight polls are abandoned; on next process start, any `pending` row older than 5 minutes is reaped to `failed` by a cron-style sweep" — that sweep is decision 32 below |
| 20 | Fly app naming | `corellia-agent-<instance-uuid-trimmed-to-12-chars>` (Fly app names cap at ~30 chars and must be globally unique within an org). Uniqueness is supplied by the UUID prefix; the `corellia-agent-` prefix makes manual `fly` CLI usage human-readable | Blueprint §10 step 8 names the app `corellia-agent-<uuid>`; the trim is the operational reality of Fly's name length cap. Collision probability on a 12-hex-char prefix is ~1-in-2^48; safe for the lifetime of v1 |
| 21 | Fly machine config | One container running the harness adapter image (from M3's `harness_adapters.adapter_image_ref`), Firecracker microVM, auto-stop ON, auto-start on request, no volume. Resource defaults from blueprint §3.3 (declared minimum footprint) | Per blueprint §8. Auto-stop + auto-start is what makes idle agents effectively free — important for the demo where 5 agents spin up and stop being interesting after the demo ends |
| 22 | Secrets injection | All `CORELLIA_*` env vars set as Fly app *secrets* (not env vars baked into machine config). The adapter image's entrypoint reads them at boot per blueprint §11.3 | Fly secrets are encrypted at rest, scoped to the app, and survive machine recreations. Bare env vars wouldn't. Same security posture as the Go BE itself |
| 23 | `Stop` semantics | `agents.Service.Stop` sets `status='stopped'`, sets `last_stopped_at = now()`, calls `FlyDeployTarget.Stop(deploy_external_ref)` which scales the Fly machine to 0 (machine config preserved; can be started again). **No "start" RPC in v1** — start-after-stop is "destroy + re-spawn" | "Available in v1" per blueprint §10 spirit, but minimal. `start` after `stop` requires re-injecting the API key (which we no longer have post-spawn — it lives in Fly's secret store, but our DB doesn't know its value). Reusable only via an extra "rotate keys?" flow we don't need yet. Roadmap §6 OQ5 closed in favor of "yes, stop is enough; destroy is also yes" |
| 24 | `Destroy` semantics | `agents.Service.Destroy` sets `status='destroyed'`, sets `last_stopped_at = now()`, calls `FlyDeployTarget.Destroy(deploy_external_ref)` which `fly apps destroy <name>`'s the whole app (machines + secrets + image cache). Row is **soft-deleted** (kept for audit) | Roadmap §6 OQ5: destroy is included. Soft-delete (status flip, not row removal) means the audit trail survives — "this org once had 5 agents but only 2 today" remains reconstructable. Hard-deleting rows after Fly destruction would lose that |
| 25 | Connect error mapping for spawn | New sentinels: `agents.ErrTemplateNotFound`, `agents.ErrInvalidProvider`, `agents.ErrSpawnLimit`, `agents.ErrInstanceNotFound`, `agents.ErrFlyAPI`. Mapped via `agentsErrToConnect` switch — the M2 file already has the scaffolding | Sentinels are the public contract; mapping is the redaction layer. `ErrFlyAPI` flows through with a *generic* message ("upstream provider error") rather than the raw Fly error — Fly's responses can include rate-limit URLs, IDs, etc. that are operational noise from the FE's perspective. The full Fly error is `slog.Error`'d server-side |
| 26 | What "validation" means in `SpawnAgent` | Server-side checks (per the post-review hardening pattern from 0.2.5): `name` `len(strings.TrimSpace(name))` between 1 and 80; `model_api_key` non-empty; `model_provider` is in the enum; `template_id` parseable as UUID and exists. **`model_name` is *not* validated against a list** | The five-field set comes from the FE form — `react-hook-form` + `zod` does FE-side validation (M1's wizard pattern). BE re-checks the same constraints because never-trust-the-client. Skipping `model_name` validation is deliberate: provider model lists change frequently, hardcoding them in BE means a stale list rejects valid models. Provider's API will reject an invalid model name; the agent will fail-loud at first chat call. Acceptable for v1 |
| 27 | Order of operations inside `Spawn` | (1) Validate request → (2) Resolve `template_id` + load `harness_adapters` row (need `adapter_image_ref`) → (3) Resolve `users.org_id` from claims → (4) Resolve `deploy_targets` row for `fly` → (5) Insert `agent_instances` row in `pending` → (6) Insert `secrets` rows in same tx → (7) Commit → (8) Call `FlyDeployTarget.Spawn(ctx, instance, apiKey)` → (9) On success: update row with `deploy_external_ref` → (10) Return row → (11) Detached goroutine starts polling `/health` | Steps 5–7 in one tx so a half-inserted state is impossible. Step 8 *outside* the tx because the Fly call is a 1–5s network operation we don't want holding a DB transaction. If step 8 fails, the row stays in `pending`; the sweep job (decision 32) reaps it to `failed` after 5min, and the user sees the failure on the fleet page |
| 28 | What `SpawnN` does differently | Loops 1..N, calls `Spawn` for each *concurrently* via goroutines + `errgroup`. Names are `<prefix>-01`, `<prefix>-02`, ... with zero-padding to width = `len(strconv.Itoa(N))`. Returns `[]AgentInstance` ordered by index | Goroutine fan-out is Go's idiomatic fit for an orchestrator (stack §1). `errgroup` cancels remaining spawns on first failure — debatable; v1 picks "fail-stop" for demo predictability (5 of 5 succeed, or partial state is visibly broken on the fleet page). Padding (`-01` not `-1`) keeps names sortable in the FE |
| 29 | Concurrency cap inside `SpawnN` | Semaphore of **3** in-flight Fly API calls. `count=10` finishes in roughly `ceil(10/3) * spawn_latency` | Fly's API rate-limits exist (per-org request budgets). 3 concurrent spawns is well below the documented threshold and high enough that "Deploy 5" feels parallel rather than serial in the demo. If we need more we'll surface the cap as a config knob; today it's a constant |
| 30 | Idempotency on retry | `SpawnAgent` is **not idempotent** in v1. A retry submits a fresh row + fresh Fly app | Idempotency keys are post-v1 work. The FE wizard's submit button disables on click + reuses the M1 wizard's submit-once pattern; double-submit-via-network-retry is a known small risk for the hackathon scope |
| 31 | Fleet page shape | Discriminated union (`loading | empty | ready | error`) per the M1 dashboard pattern. `ready` renders a table: name, status badge (color-coded per status), template name, model, created_at, actions (Stop / Destroy / Logs link). Empty state is "no agents yet — spawn one from /agents." | Mirrors dashboard's four-state shape from 0.3.0. Status badge colors: pending=neutral, running=green, stopped=gray, failed=destructive, destroyed=muted-destructive |
| 32 | Stale-pending sweep | A startup hook in `cmd/api/main.go` runs once at boot: `UPDATE agent_instances SET status='failed' WHERE status='pending' AND created_at < now() - interval '5 minutes'`. **No background loop**, just boot-time cleanup | Decision 19's "abandoned polls on process restart" is what this addresses. A boot-time sweep is enough for v1 — the typical case is "process crashed mid-spawn, restarted, sweep runs once, user sees the failure." A continuous sweep loop would be over-engineered |
| 33 | Logs link | `GetAgentInstance` response includes `logs_url` (string), computed server-side as `https://fly.io/apps/<app-name>/monitoring`. The FE renders it as an external link with `target="_blank"` | Streaming logs in-product is post-v1 per blueprint §13. For v1 the Fly dashboard is acceptable per blueprint §7. Computing the URL server-side keeps the Fly-naming convention encapsulated (decision 20's app-name format never leaks to the FE) |
| 34 | RPC mounting | All new methods inside the existing `r.Group(...)` with `auth.Middleware(d.AuthVerifier)` — same group as `ListAgentTemplates` from M2. No unauthenticated path | The catalog is auth-gated; all spawn-flow methods are equally so. There is no v1 surface for unauthenticated access |
| 35 | `httpsrv.Deps` field reuse | **No new field** — `AgentsHandler` already exists from M2. The new methods add to `AgentsHandler`'s methods. `agents.NewService` signature widens to take `(queries, adaptersSvc, deployTargets map[string]deploy.DeployTarget)` | The handler is a thin shim (still <30 LOC per method per §11.9); the orchestration grows in `agents.Service`. The deploy-targets map is keyed by `deploy_targets.name` (e.g. `"fly"`); `FlyDeployTarget` populates `["fly"]`, the `NotImplemented` stubs from M3 populate `["aws"]`, `["local"]` etc. |
| 36 | Where `internal/deploy/` is consumed | `agents.Service.Spawn` looks up `deployTargets[targetRow.Name]` and calls `Spawn(ctx, ...)` on it. **Domain code never imports `flydeploy/...`** — it only sees the interface | Blueprint §11.1 — Fly-specific code lives behind `DeployTarget`. M4 is the rule's first real-data exercise |
| 37 | Tests | Backend: `agents/service_test.go` extended with table-driven cases for `Spawn` (validation paths), `SpawnN` (count cap, naming format), `Stop` / `Destroy` (state transitions). `deploy/` tests are M3's responsibility. **A `fakeDeployTarget` in the test file** stands in for `FlyDeployTarget` so service tests don't touch the network | The pattern from `users/service_test.go` carries: private interface, fake satisfying it, table-driven cases. The `fakeDeployTarget` is critical — service-level tests must not require Fly credentials |
| 38 | FE deploy modal | shadcn `Dialog` triggered by Hermes card's "Deploy" button. State machine `idle | submitting | error`; success closes modal + `router.push('/fleet')`. Form: `react-hook-form` + `zod`, fields per decision 13 + 14 (count + prefix shown only on the "Deploy N" path) | Reuse the M1 wizard pattern. `router.push` (not `replace`) here — the user *can* go back to `/agents` from `/fleet` legitimately, unlike sign-in/onboarding which are forced-once flows |
| 39 | API-key field type | shadcn `Input type="password"` with a "Show" toggle. Form value is held in component state, never persisted to localStorage | The toggle is a UX nicety (paste verification). No localStorage means a refreshed tab loses the in-flight value — acceptable; spawn is intended as one-shot |
| 40 | "Deploy N" trigger | A separate "Deploy 5" button on the same Hermes card, right of "Deploy". Opens the same modal with the count + prefix fields revealed | Two buttons, one modal — keeps the modal's submit logic singular (with a `count > 1 ? spawnN : spawn` branch). Visual: Deploy is `default`, Deploy 5 is `outline` — primary single-spawn action, secondary fan-out demo |
| 41 | Fleet page polling lifecycle | `useEffect` starts a 3s `setInterval` calling `refetch`; clears on unmount; **stops once no row is `pending`** (computed from refetch result). Tab visibility is *not* checked in v1 | Visibility-aware polling is the right v2 polish. v1 keeps it simple: 3s while pending exists, idle otherwise. The hot loop only runs while at least one agent is converging — typical fleet page idle cost is zero |
| 42 | Per-row actions | `Stop` button visible only when `status='running'`; `Destroy` button visible always except on `destroyed` rows. Both wrap their RPC calls in shadcn `AlertDialog` confirmations. Logs link visible whenever `deploy_external_ref IS NOT NULL` | Stop/Destroy are destructive enough to warrant confirmation. Logs link is harmless; show whenever there's a Fly app to link to |
| 43 | Optimistic UI on Stop / Destroy | **No optimism** — the FE waits for the RPC to return, then refetches. Status flip in the BE is sync (not poll-driven) for these actions because the Fly call (`scale 0` / `apps destroy`) is a 1–3s call, fits within a normal request | Optimism would mean reverting the UI on RPC failure, which is more surface area than v1 needs. The 1–3s wait is acceptable; the `AlertDialog` already conveys "this is happening." |
| 44 | Decimal vs integer for `last_started_at` / `last_stopped_at` | `TIMESTAMPTZ NULL` per blueprint §9 | Verbatim from the spec. Both nullable because a freshly-spawned `pending` row hasn't started yet, and a `running` row hasn't stopped |
| 45 | Cleanup on test/dev reset | Goose down migration `DROP TABLE` order: `secrets` → `agent_instances` → `deploy_targets`. Reverse FK order | Standard goose down. M2's down stays as written (secrets/instances/deploy_targets aren't its concern) |

### Decisions deferred (revisit when named caller arrives)

- **Streaming log tails over Connect.** Post-v1 per blueprint §13. Adds proto streaming, FE chunked rendering, BE log forwarding from Fly. Not on M4.
- **Restart of stopped agents.** Per decision 23, "destroy + re-spawn" is the v1 path. A real `Start` RPC requires solving "where does the API key come from?" (Fly's secret store still has it; we'd need a Fly API path to re-confirm without re-providing).
- **Per-instance config edits.** `config_overrides` exists in the schema; no UI in v1.
- **Idempotency keys.** Decision 30 — submit deduplication is on the FE side only.
- **Visibility-aware polling on /fleet.** Decision 41 — pause polling when tab is backgrounded. Polish, not v1.
- **Cross-org admin views.** All read queries are org-scoped; super-admin views are not in v1.
- **Webhook-driven readiness.** Decision 16 — when we have a public BE URL post-deploy.

### Follow-up plans (to be written after this lands)

- **`docs/plans/v1-deploy.md`** — putting the BE on Fly + FE on Vercel. Slot opportunistically per roadmap §4.
- **`docs/plans/log-streaming.md`** — server-streaming log tails, post-v1.
- **`docs/plans/agent-restart.md`** — solving the start-after-stop secret-rehydration question.

---

## 3. Pre-work checklist

Before Phase 1, confirm:

- [ ] `git status` clean; branch off `master` for M4 work.
- [ ] **M2 has landed.** Migration `20260425170000_agent_catalog.sql` is applied and `agent_templates` has the Hermes seed row. (`SELECT id, name FROM agent_templates;` returns one row.)
- [ ] **M3 has landed.** `internal/deploy/` exists with `DeployTarget` interface and `FlyDeployTarget` impl; `harness_adapters.adapter_image_ref` is filled and `NOT NULL`. (`SELECT adapter_image_ref FROM harness_adapters WHERE harness_name='hermes';` returns a non-null `corellia/hermes-adapter@sha256:...` value.)
- [ ] Backend builds + tests clean today: `cd backend && go vet ./... && go build ./... && go test ./...`.
- [ ] Frontend builds + lints clean today: `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build`.
- [ ] `goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" status` shows migrations applied through M2 + M3.
- [ ] `FLY_API_TOKEN` and `FLY_ORG_SLUG` populated in `backend/.env` (already required per `.env.example`; verify `direnv allow` has refreshed).
- [ ] One signed-in test user with `name` set, in an org with no existing `agent_instances` rows (clean slate for the fleet view).
- [ ] **Provider API key on hand.** A real OpenRouter / Anthropic / OpenAI key for the spawn smoke test. Without one, the test agent will boot but fail-loud at first chat call.

---

## 4. Phasing

Eight phases. Phases 1–4 are backend; 5–6 are frontend; 7 is integration smoke; 8 is cleanup. Each phase ends with a checkpoint that the next phase requires.

### Phase 1 — Schema + sqlc

**Goal:** new tables exist, sqlc emits typed query functions for them.

**Files:**

1. **`backend/migrations/<ts>_spawn_flow.sql`** — new migration.
   - `CREATE TABLE deploy_targets` with columns `(id, name, kind, config jsonb, enabled, created_at, updated_at)`. Unique index on `name`.
   - `CREATE TABLE agent_instances` per decision 3, 4, 5, 8, 9, 10, 11. FKs to `agent_templates`, `users`, `organizations`, `deploy_targets`.
   - `CREATE TABLE secrets` per decision 6.
   - Indexes: `(org_id, created_at DESC)` on `agent_instances`; partial unique index `(deploy_external_ref) WHERE deploy_external_ref IS NOT NULL`.
   - Seed: `INSERT INTO deploy_targets (name, kind, enabled) VALUES ('fly', 'fly', true) ON CONFLICT (name) DO NOTHING`.
   - `+goose Down` drops in reverse FK order (decision 45).
2. **`backend/queries/agent_instances.sql`** — new file. Queries:
   - `InsertAgentInstance :one` — full insert returning the row.
   - `SetAgentInstanceDeployRef :exec` — sets `deploy_external_ref` post-Fly-create.
   - `SetAgentInstanceStatus :exec` — flips status, with optional `last_started_at` / `last_stopped_at` updates (likely two query variants for clarity).
   - `ListAgentInstancesByOrg :many` — `WHERE org_id = $1 ORDER BY created_at DESC`. Joins `agent_templates.name AS template_name` for the fleet table.
   - `GetAgentInstanceByID :one` — `WHERE id = $1 AND org_id = $2` (org guard at the query).
   - `ReapStalePendingInstances :execrows` — `UPDATE ... SET status='failed' WHERE status='pending' AND created_at < now() - interval '5 minutes' RETURNING id` for boot-time sweep logging.
3. **`backend/queries/secrets.sql`** — new file. `InsertSecret :one`, `ListSecretsByInstance :many` (audit-only; rarely called).
4. **`backend/queries/deploy_targets.sql`** — new file. `GetDeployTargetByName :one`, `ListDeployTargets :many`.
5. **`backend/queries/agent_templates.sql`** — extend with `GetAgentTemplateByID :one` (for `Spawn`'s template lookup; the M2 service test file already references this method on the `templateQueries` interface as a comment).
6. **`backend/queries/harness_adapters.sql`** — already has `GetHarnessAdapterByID :one`. No edit.

**Run:**
```bash
goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
sqlc generate
```

**Checkpoint:** `cd backend && go build ./...` succeeds. `db.Queries` has the new methods. `db/models.go` has `AgentInstance`, `Secret`, `DeployTarget` structs. Database has the three new tables and the `fly` seed row.

---

### Phase 2 — Domain: `internal/agents/` extended for spawn lifecycle

**Goal:** `agents.Service` gains `Spawn`, `SpawnN`, `List`, `Get`, `Stop`, `Destroy` plus the background poll. No HTTP code yet.

**Files:**

1. **`backend/internal/agents/service.go`** — extend.
   - Add new sentinels: `ErrTemplateNotFound`, `ErrInvalidProvider`, `ErrSpawnLimit`, `ErrInstanceNotFound`, `ErrFlyAPI`.
   - Widen `templateQueries` interface — add `GetAgentTemplateByID`, plus all `agent_instances` / `secrets` / `deploy_targets` methods the service touches. (Or split into multiple private interfaces — `templateQueries`, `instanceQueries`, etc. — if `service.go` starts feeling crowded; M2's pattern suggests splitting at the file level rather than the interface level.)
   - Widen `Service` struct: add `adapters *adapters.Service`, `deployTargets map[string]deploy.DeployTarget`. Update `NewService` signature.
   - Add input struct `SpawnInput { TemplateID uuid.UUID, Name string, Provider string, ModelName string, APIKey string, OrgID uuid.UUID, OwnerUserID uuid.UUID }`. Validate per decision 26.
   - Implement `Spawn(ctx, in SpawnInput) (*corelliav1.AgentInstance, error)` per decision 27's order of operations. The DB writes (steps 5–7) live in a single `pgx.Tx`; the Fly call (step 8) is post-commit. Spawning the poll goroutine (step 11) uses `context.Background()` per decision 19.
   - Implement `pollHealth(ctx context.Context, instanceID uuid.UUID, deployRef string)` — internal method, not on the interface. Loops every 2s for 90s; on first 200 response from Fly's `/health`, calls `SetAgentInstanceStatus(running, last_started_at=now())`; on timeout, flips to `failed`. The `/health` URL is computed by `FlyDeployTarget.HealthURL(deployRef)` (one of M3's interface methods — confirm during M3's plan or add it here as a deferred-but-named requirement).
   - Implement `SpawnN(ctx, in SpawnNInput) ([]*corelliav1.AgentInstance, error)` per decision 28 + 29. Use `golang.org/x/sync/errgroup` and `semaphore.NewWeighted(3)`. Naming: zero-pad to `len(strconv.Itoa(N))`.
   - Implement `List(ctx, orgID) ([]*corelliav1.AgentInstance, error)` calling `ListAgentInstancesByOrg`.
   - Implement `Get(ctx, instanceID, orgID) (*corelliav1.AgentInstance, error)` calling `GetAgentInstanceByID`.
   - Implement `Stop(ctx, instanceID, orgID) error` per decision 23 — flip status, call `FlyDeployTarget.Stop`. Sync; no goroutine.
   - Implement `Destroy(ctx, instanceID, orgID) error` per decision 24.
   - Update `toProtoTemplate` to include any fields M4 needs from templates; add `toProtoInstance(db.AgentInstance) *corelliav1.AgentInstance`.

2. **`backend/internal/agents/service_test.go`** — extend.
   - `fakeDeployTarget` struct satisfying `deploy.DeployTarget`. Methods record their inputs for assertion; return success by default; configurable error injection.
   - Test cases:
     - `TestSpawn_HappyPath` — full path returns `pending` row with `deploy_external_ref` set.
     - `TestSpawn_TemplateNotFound` — bad UUID → `ErrTemplateNotFound`.
     - `TestSpawn_NameValidation` — empty / too-long / whitespace-only → `connect.CodeInvalidArgument` (handler-mapped, but service returns sentinels).
     - `TestSpawn_ProviderValidation` — bad provider → `ErrInvalidProvider`.
     - `TestSpawn_FlyFailure` — fakeDeployTarget returns error; row stays in `pending` (no rollback of the DB tx — see decision 27 step 8).
     - `TestSpawnN_NamingAndCount` — `count=5, prefix="alpha"` → names `["alpha-1","alpha-2",...,"alpha-5"]` (one digit width because `len("5")==1`); `count=10` → `["alpha-01"..."alpha-10"]`.
     - `TestSpawnN_LimitExceeded` — `count=11` → `ErrSpawnLimit`.
     - `TestStop_StatusTransition` — `running` → `stopped`; calls `fakeDeployTarget.Stop`.
     - `TestStop_NotRunning` — `pending` / `failed` / `destroyed` → permitted no-op or sentinel (lock decision in decision 23 — current text implies permitted, so test "no-op + status unchanged"; revisit if behavior should be stricter).
     - `TestDestroy_HappyPath` — any non-`destroyed` → `destroyed`; calls `fakeDeployTarget.Destroy`.

**Checkpoint:** `cd backend && go test ./internal/agents/...` passes. The service compiles against M3's `deploy.DeployTarget` interface (or a hand-written interface match if M3 hasn't shipped — flag in plan if so).

---

### Phase 3 — Proto + sqlc-to-proto mapping

**Goal:** `agents.proto` declares the new RPCs and messages; codegen produces the Go server interfaces; `agents.Service` returns proto types directly (per M2 pattern).

**Files:**

1. **`shared/proto/corellia/v1/agents.proto`** — extend.
   - `service AgentsService` adds: `SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance`.
   - `enum ModelProvider { MODEL_PROVIDER_UNSPECIFIED = 0; ANTHROPIC = 1; OPENAI = 2; OPENROUTER = 3; }`.
   - `message AgentInstance { string id; string name; string template_id; string template_name; ModelProvider provider; string model_name; string status; string deploy_external_ref; string logs_url; string created_at; string last_started_at; string last_stopped_at; }` — timestamps as RFC3339 strings (the existing pattern in `users.proto`).
   - Request/response messages for each RPC. The `SpawnAgentRequest.model_api_key` field has a `// SECRET — never log this field` comment.
2. **Run codegen.**
   ```bash
   pnpm proto:generate
   ```
3. **Verify** `backend/internal/gen/corellia/v1/agents.pb.go` has the new messages; `frontend/src/gen/corellia/v1/agents_pb.ts` has the new TS types.

**Checkpoint:** `cd backend && go build ./...` succeeds — `agents.Service` should already use the new generated types from Phase 2 (write Phase 2 against the proto shape *before* running codegen by referencing the planned message names; codegen makes them real).

---

### Phase 4 — Handler + wiring

**Goal:** Connect handlers expose the new RPCs; `cmd/api/main.go` wires `FlyDeployTarget` into the service; the boot-time sweep runs.

**Files:**

1. **`backend/internal/httpsrv/agents_handler.go`** — extend.
   - Add `SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance` methods. Each ≤30 LOC per §11.9.
   - Each method extracts `AuthClaims` from ctx (see `users_handler.go` for the pattern), resolves `org_id` and `owner_user_id` via `users.Service.GetByAuthUserID` (reuse — already exists), calls the corresponding `agents.Service` method, marshals the response.
   - Extend `agentsErrToConnect` switch with the new sentinels (decision 25). `ErrFlyAPI` → `CodeUnavailable` with generic message; the underlying error is `slog.Error`'d.
2. **`backend/internal/httpsrv/server.go`** — no edit. The mount line for `AgentsService` from M2 picks up the new methods automatically (Connect generates the full service interface).
3. **`backend/cmd/api/main.go`** — extend.
   - Construct `flyTarget := flydeploy.New(cfg.FlyAPIToken, cfg.FlyOrgSlug, ...)` (per M3's package — the exact constructor signature is M3's call; this plan assumes a single-string-arg-per-secret constructor).
   - Build `deployTargets := map[string]deploy.DeployTarget{"fly": flyTarget}`. Stub entries from M3 (`"aws": awsdeploy.New()`, etc.) are added by M3.
   - Update `agents.NewService` call to pass `(queries, adaptersSvc, deployTargets)`.
   - Add boot-time sweep call: `if n, err := queries.ReapStalePendingInstances(ctx); err == nil && n > 0 { slog.Warn("reaped stale pending instances", "count", n) }`. After `db.NewPool` succeeds, before the server `ListenAndServe`.
4. **`backend/internal/users/service.go`** — likely no edit; `GetByAuthUserID` already exists per the org-membership flow from 0.2.5.

**Checkpoint:** Backend boots cleanly. `curl -H "Authorization: Bearer <jwt>" http://localhost:8080/corellia.v1.AgentsService/ListAgentInstances` returns `{"instances":[]}` for a fresh org. `slog` shows `jwks initialised`, the sweep log if applicable, and `listening`.

---

### Phase 5 — Frontend deploy modal at `/agents`

**Goal:** the "Deploy" button on the Hermes card from M2 opens a real modal; submit fires `SpawnAgent` and redirects to `/fleet`. The "Deploy 5" button opens the same modal in N-mode.

**Files:**

1. **`frontend/src/components/agents/deploy-modal.tsx`** — new. shadcn `Dialog`. Form via `react-hook-form` + `zodResolver`. Fields:
   - `name` — required, trim, 1–80 chars.
   - `provider` — `Select` with the three enum values (Anthropic / OpenAI / OpenRouter).
   - `modelName` — text input, required, 1–200 chars.
   - `apiKey` — `Input type="password"` with show toggle, required.
   - When `mode === "many"`: also `count` (number, 1–10) and `namePrefix` (replaces `name` field; required, trim, 1–60).
   - State machine `idle | submitting | error` with the error message held in the form. Error toast on `ConnectError`.
   - On success: success toast, close modal, `router.push('/fleet')`.
2. **`frontend/src/app/(app)/agents/page.tsx`** — extend M2's catalog page.
   - Add two buttons to the Hermes card: `Deploy` (default variant) and `Deploy 5` (outline variant). Disable both while `disabled` (reuse current disabled-state from M2 if M3 hasn't yet filled `adapter_image_ref` — but at M4 execution, M3 has).
   - Both buttons open the same `<DeployModal>` with different `mode` props.
   - Sneak-peek cards from M2 decision 25 stay as-is.
3. **`frontend/src/lib/api/agents.ts`** — extend M2's catalog client. Add wrappers for `spawnAgent`, `spawnNAgents`, `listAgentInstances`, `getAgentInstance`, `stopAgentInstance`, `destroyAgentInstance`. Each calls the generated Connect TS client with the auth header pattern from M2.

**Checkpoint:** `pnpm -C frontend type-check && lint && build` clean. Manually click Deploy → modal opens → fill form → submit → redirected to `/fleet`. (`/fleet` is still the M1 stub at this point — Phase 6 builds it.)

---

### Phase 6 — Fleet page

**Goal:** `/fleet` lists this org's agents with status badges, polls every 3s while any row is pending, and supports Stop / Destroy / Logs.

**Files:**

1. **`frontend/src/app/(app)/fleet/page.tsx`** — replace M1's `<ComingSoon>`.
   - Discriminated union (`loading | empty | ready | error`) per decision 31.
   - `useEffect` polling per decision 41: `setInterval(refetch, 3000)`; clears on unmount and when `instances.every(i => isTerminal(i.status))`.
   - Table rendering with shadcn `Table`. Columns: Name, Status (badge), Template, Model, Created, Actions.
   - Status badge component: color per decision 31. Reuse shadcn `Badge` with variant overrides.
   - Per-row actions per decision 42: Stop visible if `status === "running"`, Destroy visible always except `destroyed`, Logs link visible if `deploy_external_ref` is set. Each destructive action wrapped in shadcn `AlertDialog`.
2. **`frontend/src/components/fleet/status-badge.tsx`** — new. Maps status string to variant + label.
3. **`frontend/src/components/fleet/agent-row-actions.tsx`** — new (or inline in the page if it stays trivial). Stop / Destroy click → AlertDialog → on confirm, fire RPC, refetch on success.

**Checkpoint:** `pnpm -C frontend type-check && lint && build` clean. Manually navigate to `/fleet` from the post-spawn redirect — see the agent row appear in `pending`, watch it flip to `running` within ~30s, click Logs → Fly dashboard opens, click Stop → AlertDialog → confirm → status flips to `stopped`.

---

### Phase 7 — Integration smoke test

**Goal:** the demo loop works end-to-end with a real provider key against a real Fly account.

**Steps:**

1. Sign in as the test user.
2. Click `/agents` → Hermes card visible (from M2) with active Deploy button (from M4).
3. Click Deploy → fill `{ name: "smoke-01", provider: "openrouter", modelName: "...", apiKey: "<real key>" }` → submit.
4. Redirected to `/fleet` — row visible in `pending`. Watch `pending → running` within 90s.
5. Click Logs → Fly dashboard opens, Hermes booting.
6. *Optional (sanity)*: hit the agent's `/chat` endpoint directly with curl to confirm round-trip works.
7. Back to `/agents` → `Deploy 5` → `{ namePrefix: "fanout", count: 5, ... }` → submit.
8. Redirected to `/fleet` — five new rows in `pending`, all flipping to `running` over the next minute. Status badges update via the 3s poll.
9. Click Stop on one → `AlertDialog` → confirm → row flips to `stopped`.
10. Click Destroy on the `smoke-01` row → confirm → row flips to `destroyed`. (Verify in Fly dashboard that the app is gone.)
11. Boot-sweep verification: `kill -9` the BE mid-spawn, restart, confirm any `pending` row older than 5min flips to `failed` on next boot. (Manual; can be skipped if too brittle for a smoke run.)

**Pass criteria:** all steps complete with no `slog.Error` lines server-side except the optional kill-9 line. No raw Fly errors leak to the FE (decision 25 redaction).

**Document the run in a Phase 7 completion note** — the operator-friendly runbook pattern from `docs/completions/onboarding-wizard-phase-6.md`.

---

### Phase 8 — Cleanup, docs, validation matrix

**Goal:** the milestone is mergeable.

**Steps:**

1. **Validation:**
   - `cd backend && go vet ./... && go build ./... && go test ./...`
   - `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build`
   - `goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" status` shows the M4 migration applied.
2. **Code cleanup:**
   - Zero `// TODO` or `FIXME` markers in M4 files.
   - No `console.log` / `slog.Debug` left from development.
   - Verify `agents/service.go` doesn't import any Fly-specific package — only `internal/deploy`. (Blueprint §11.1 self-check.)
   - Verify no `CORELLIA_*` env-var translation logic exists in `agents/service.go` — that lives in the adapter image only. (Blueprint §11.3 self-check.)
   - Verify `secrets` table has zero rows with a non-empty raw value (it has no value column, so this should be tautological; spot-check the migration).
3. **Doc updates:**
   - `CLAUDE.md` §"Backend layout" — flip `agents/`, `adapters/`, `deploy/` from "Planned packages (blueprint §9, not yet present)" to live entries.
   - `docs/changelog.md` new entry — pattern matches 0.2.5 / 0.3.0 entries: index, phase summaries, behavior change, resolves, known pending work, supersedes.
   - `docs/blueprint.md` — typically no edit; M4 is implementing the spec, not changing it. If decisions in §2 of this plan diverge from blueprint, update blueprint with a supersession note.
   - Move `docs/executing/spawn-flow.md` → `docs/archive/spawn-flow.md` once verified merged. (Per the convention from M1 / M2.)
4. **Per-phase completion docs** — `docs/completions/spawn-flow-phase-{1..8}.md`. Pattern from 0.3.0's six phase docs.
5. **Final smoke run** repeated by a second operator if available.

**Checkpoint:** branch is rebased clean on master, all CI green, demo loop reproducible from a fresh sign-in.

---

## 5. Out-of-scope clarifications (anti-scope-creep)

These come up *during* spawn-flow work and are deliberately deferred:

- **"Add a logs panel inline in /fleet."** Post-v1; the link to Fly dashboard is sufficient.
- **"Add a search/filter UI on /fleet."** Five rows fit on screen; filtering is post-v1 polish.
- **"Add cost-per-agent visibility."** v1.5 per blueprint §14.
- **"Add an admin override to spawn for a different user."** No multi-user-per-org flow exists; this would require the invitation flow first.
- **"Add agent-to-agent communication."** Explicit deferral per blueprint §13.
- **"Add cron / scheduled spawns."** Same.
- **"Make the polling fancier with backoff / jitter."** Constant 2s polls within a 90s window are fine. Backoff is a nice-to-have when we have hundreds of in-flight spawns; v1 demo has at most 10.
- **"Persist the model_api_key encrypted in our DB so we can support Start-after-Stop."** Decision 23 — out of scope. The Fly secret store has it; without re-providing, our DB doesn't.

---

## 6. Risk register

Risks worth flagging before execution:

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Fly API quota / rate limit during demo's `Deploy 5` | Medium | High (demo embarrassment) | Decision 29's semaphore (3 in-flight) keeps us well under documented limits. Confirm the org's quota before the demo |
| 2 | `/health` never returns 200 (adapter image bug) | Medium | High | The 90s timeout flips the row to `failed`. The bug surfaces in the FE as a red status badge — recoverable without a server redeploy. M3's smoke test (`fly machines run` the adapter) is the upstream defense |
| 3 | Detached goroutine leaks on process restart | Low | Low | Decision 32's boot-time sweep reaps stale `pending` rows. Worst case: a row sits in `pending` for up to 5 minutes after a crash |
| 4 | Provider rejects `model_name` (typo by user) | Medium | Low | Per decision 26, BE doesn't validate model names. The agent boots, fails at first `/chat` call, user sees broken behavior. Acceptable for v1 — a v1.5 polish is to surface the error in the fleet view |
| 5 | API key leaks via logs | Low | Catastrophic | Decision 7 — never log the key, never write it to our DB. Code review checkpoint: `grep -ri "api_key\|apikey\|API_KEY" backend/internal/agents/ backend/internal/httpsrv/` should turn up only validation / variable references, never `slog.Info` arguments |
| 6 | Org-isolation bug — user sees another org's agents | Low | Catastrophic | Decision 9's "all read queries filter by org_id." Test case `TestList_OtherOrgInvisible` (add to Phase 2 if not already covered) — insert two agents in two orgs, list as user A, expect only A's agent |
| 7 | Race: two simultaneous spawns with the same name | Very low | Low | No DB-level uniqueness on `(org_id, name)` in the schema; if it matters, add a unique index in a follow-up. Demo flow names are unique by virtue of timestamp + manual entry |
| 8 | Fly app naming collision (decision 20's 12-char trim) | Astronomically low | Medium | 2^48 collision space; mitigation is "the partial unique index on `deploy_external_ref` catches it at the DB layer if the impossible happens" |
| 9 | M3 hasn't landed `FlyDeployTarget.HealthURL` | Medium during execution | Blocking | Coordinate with M3's plan before executing M4 Phase 2. If M3 has shipped without it, file a small follow-up PR to M3 instead of inlining it in M4 |

---

## 7. Open questions to resolve during execution

Questions that don't need to be answered to *approve* the plan, but should be answered before / during the relevant phase:

- **Q1 (Phase 1).** Should `secrets.key_name` be UNIQUE per `(agent_instance_id, key_name)`? Likely yes — duplicate `CORELLIA_MODEL_API_KEY` rows for the same instance would be nonsense. Add the unique index in Phase 1 unless there's a reason not to.
- **Q2 (Phase 2).** Decision 23's "Stop on a non-running instance" — silent no-op or sentinel error? Defaulting to no-op for v1 simplicity; revisit if a user reports confusion.
- **Q3 (Phase 2).** Should `pollHealth`'s 90s budget be configurable per template's manifest? Blueprint §3.3 mentions "declared minimum resource footprint" which implies declared boot time too. Not for M4; flag for v2.
- **Q4 (Phase 5).** Modal close-on-outside-click — disable while submitting? shadcn `Dialog` allows it; UX-wise, blocking outside-click during the in-flight RPC prevents the user accidentally killing the request mid-flight. Default to **disable on `submitting`**.
- **Q5 (Phase 6).** Polling cadence — 3s feels right but is unconfirmed against actual `pending → running` latency. After Phase 7's smoke run, tune if needed (likely 2s is fine; 5s is too laggy for the demo).
- **Q6 (Phase 7).** Does `Stop` actually save money in Fly's auto-stop topology? If auto-stop already scales idle machines to 0, manual Stop adds the *intent* signal but no cost change. UX-wise it's still useful (the badge change is informative). Worth one paragraph in the changelog entry.

---

## 8. Definition of done

After M4 lands:

1. ✅ Sign in → click Deploy on Hermes → fill form → submit → land on /fleet with the row in `pending`.
2. ✅ Within 90s the row flips to `running`. Logs link opens Fly dashboard.
3. ✅ Click Stop → confirm → row is `stopped`. Click Destroy → confirm → row is `destroyed`, Fly app is gone.
4. ✅ Click "Deploy 5" → all five rows appear, all flip to `running` within ~60s.
5. ✅ Backend logs are quiet — no errors, no leaked secrets, no raw Fly errors on the wire.
6. ✅ `cd backend && go test ./...` passes including the new `agents/service_test.go` cases.
7. ✅ `pnpm -C frontend build` produces no warnings.
8. ✅ The changelog entry is written with the same care as 0.2.6 / 0.3.0 — index, phase notes, behavior change, supersedes.
9. ✅ Doc reorganization complete: this plan moved to `docs/archive/spawn-flow.md`; `CLAUDE.md` "Planned packages" line updated.

When all eight ticks land, blueprint §1's "end-to-end demonstrable slice" is real, and v1 is shippable.
