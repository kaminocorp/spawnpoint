# Changelog

Index - short one-liners:

- [0.8.0 — Frontend Mods: Chrome Alignment + Avatar Dropdown + Logo Treatment + Destroyed-Filter](#080--frontend-mods-chrome-alignment--avatar-dropdown--logo-treatment--destroyed-filter-2026-04-26)
- [0.7.7 — `fly.toml`: `min_machines_running` 0 → 1 (Always-Warm Control Plane)](#077--flytoml-min_machines_running-0--1-always-warm-control-plane-2026-04-26)
- [0.7.6 — Env Var Rename: `FLY_API_TOKEN` → `FLY_SPAWN_TOKEN` (Stop `flyctl` Shadowing the Operator's Deploy Identity)](#076--env-var-rename-fly_api_token--fly_spawn_token-stop-flyctl-shadowing-the-operators-deploy-identity-2026-04-26)
- [0.7.5 — M4 Phase 8 Hardening: Transactional Spawn Writes + Handler-Level Sentinel Mapping Tests + v1.5 Deploy-Target-Credentials Breadcrumbs](#075--m4-phase-8-hardening-transactional-spawn-writes--handler-level-sentinel-mapping-tests--v15-deploy-target-credentials-breadcrumbs-2026-04-26)
- [0.7.4 — M3.9: Control-Plane Deploy (BE → Fly, FE → Vercel)](#074--m39-control-plane-deploy-be--fly-fe--vercel-2026-04-26)
- [0.7.3 — M4 Phase 7: Integration Smoke Pass (Local BE + Prod DB + Live Fly) + Fly Token Swap (PAT → Org-Scoped)](#073--m4-phase-7-integration-smoke-pass-local-be--prod-db--live-fly--fly-token-swap-pat--org-scoped-2026-04-26)
- [0.7.2 — UX Copy: `/agents` Nav + Page Heading Renamed to "Agents"](#072--ux-copy-agents-nav--page-heading-renamed-to-agents-2026-04-26)
- [0.7.1 — Frontend Mission-Control Implementation: Spec → Pixels](#071--frontend-mission-control-implementation-spec--pixels-2026-04-26)
- [0.7.0 — M4: Spawn Flow (Phases 1–6)](#070--m4-spawn-flow-phases-16-2026-04-26)
- [0.6.1 — Frontend Redesign Phase 5: Dark Mode Activation + Base UI Button Fixes](#061--frontend-redesign-phase-5-dark-mode-activation--base-ui-button-fixes-2026-04-26)
- [0.6.0 — Frontend Redesign Phases 1–4: Pearlescent Chrome × Halftone Substrate](#060--frontend-redesign-phases-14-pearlescent-chrome--halftone-substrate-2026-04-26)
- [0.5.2 — Dev Tooling: Procfile Rename + Overmind Port Pinning](#052--dev-tooling-procfile-rename--overmind-port-pinning-2026-04-26)
- [0.5.1 — M3.5: Deploy Target Resolver Indirection (Phases 1–4)](#051--m35-deploy-target-resolver-indirection-phases-14-2026-04-26)
- [0.5.0 — M3: Hermes Adapter Image + Fly Account Wiring (Phases 1–7) + Phase 8 Post-Review Hardening](#050--m3-hermes-adapter-image--fly-account-wiring-phases-17--phase-8-post-review-hardening-2026-04-25--2026-04-26)
- [0.4.0 — M2: Agent Catalog (`HarnessAdapter` + `AgentTemplate` + `/agents` page)](#040--m2-agent-catalog-harnessadapter--agenttemplate--agents-page-2026-04-25)
- [0.3.1 — M1 Hardening: Provider Memoization, Title Template, `middleware` → `proxy`](#031--m1-hardening-provider-memoization-title-template-middleware--proxy-2026-04-25)
- [0.3.0 — M1: Onboarding Wizard + Dashboard Shell](#030--m1-onboarding-wizard--dashboard-shell-2026-04-25)
- [0.2.6 — Auth Migration: HS256 Shared Secret → ES256 / JWKS](#026--auth-migration-hs256-shared-secret--es256--jwks-2026-04-25)
- [0.2.5 — Auth User Provisioning (Phases 1–4 + Post-Review Hardening)](#025--auth-user-provisioning-phases-14--post-review-hardening-2026-04-25)
- [0.2.4 — `DATABASE_URL` Canonicalized to Direct Connection](#024--database_url-canonicalized-to-direct-connection-2026-04-24)
- [0.2.3 — direnv for Shell-Level Env Loading](#023--direnv-for-shell-level-env-loading-2026-04-24)
- [0.2.2 — Env File Placement: Per-App](#022--env-file-placement-per-app-2026-04-24)
- [0.2.1 — Seeding Removed](#021--seeding-removed-2026-04-24)
- [0.2.0 — Frontend Scaffolding](#020--frontend-scaffolding-2026-04-24)
- [0.1.0 — Backend Scaffolding & Docs Reconciliation](#010--backend-scaffolding--docs-reconciliation-2026-04-24)

Latest on top. Each release has a tight index followed by detail entries (**What / Where / Why** inlined). When a decision contradicts an earlier one, note the supersession in the new entry rather than editing the old one.

---

## 0.8.0 — Frontend Mods: Chrome Alignment + Avatar Dropdown + Logo Treatment + Destroyed-Filter (2026-04-26)

Four operator-driven UX fixes from first sustained use of the M4 spawn flow, shipped in one pass. All FE-only: zero backend, proto, schema, env, or dependency change. Type-check + lint clean. Minor version (not patch) because (a) the chrome surface — top bar height, sidebar logo, avatar dropdown — changes for every signed-in user on every page, and (b) the dashboard/fleet semantic for "destroyed" rows shifts (audit artefact, not active fleet member). Plan: `docs/executing/frontend-mods.md`. Completion notes: `docs/completions/frontend-mods.md`.

### Index

- **`app-top-bar.tsx:68` — `h-12 → h-14`.** Top bar grows from 48px → 56px so its `border-b` sits at the same Y as the sidebar's CORELLIA section. Companion change in `app-sidebar.tsx`: `SidebarHeader` overridden to `h-14 p-0` (defaults are `p-2` + inner `py-2.5`, which produced a variable height ~56–60px); inner div fills via `flex h-full items-center px-4`. The two chrome strips now line up deterministically; `cn()`'s tailwind-merge resolves the override correctly.
- **`app-top-bar.tsx` — avatar dropdown gains Profile + Settings items above Sign out.** Both routed to `/settings` via `<Link>` — there's no `/profile` route in v1, and per architecture rule §11.4 *deferred features are stubbed as real interface implementations, not as fake UI buttons*; landing on the real `<ComingSoon>` placeholder is honest. Lucide `UserIcon` + `SettingsIcon` (already in the icon set; no new dep). `<DropdownMenuSeparator>` divides them from Sign out — destructive-ish action gets its own visual lane. The render-prop pattern (`<DropdownMenuItem render={<Link href=…/>}>`) keeps Next.js client-side navigation; same Base UI convention used elsewhere in the chrome.
- **`app-top-bar.tsx` — `<DropdownMenuLabel>` wrapped in `<DropdownMenuGroup>`.** Surfaced as a runtime error after the new items mounted: Base UI's `MenuPrimitive.GroupLabel` requires a `MenuPrimitive.Group` ancestor; the bare label happened to work pre-mod but the new render path tripped the context check. New `DropdownMenuGroup` import; one wrapper element.
- **`app-sidebar.tsx` — logo redesign.** Removed the `›` chevron prefix (read as a nav-item bullet, not a brand mark); CORELLIA wordmark restyled `text-base font-black uppercase tracking-[0.3em]` (was `text-sm font-bold tracking-widest`). The weight bump (700 → 900) and tracking widen (0.1em → 0.3em) is the visual delta that makes it stop reading as a label and start reading as a logo. **Collapsed-mode `C` monogram** added so the icon-mode header isn't visually empty (the `›` previously held that role).
- **`fleet/page.tsx` — hide-destroyed filter, default off.** New `showDestroyed` state + `visibleInstances` / `destroyedCount` derivations. Toggle button in the header strip alongside POLLING and N REGISTERED — renders only when `destroyedCount > 0` (zero noise for fresh workspaces). Format `[✓] SHOW DESTROYED (N)` matches the design-system terminal aesthetic. `N REGISTERED` count now reflects `visibleInstances.length`, not the raw total — toggling instantly updates both the table and the count. **Polling logic unchanged**: `polling` still derives from the unfiltered `state.instances`, so a destroyed row that gets filtered out doesn't change whether *any* row is non-terminal.
- **`dashboard/page.tsx` — FLEET TOTAL excludes `status === "destroyed"`.** One-line filter on the telemetry tile. The other three tiles (RUNNING, PENDING, FAILED) already filter by status, so no change needed. The FLEET STATUS matrix below the strip still surfaces a DESTROYED row if any exist — countable on demand, not hidden, but not headlining.

### Behavior change (known)

- **Top bar is 8px taller** across every signed-in page; content area below absorbs the delta via `flex-1`.
- **Avatar dropdown has three items** (was one). Profile + Settings both navigate to `/settings`.
- **Sidebar shows CORELLIA without a chevron prefix**, in heavier/wider type. Collapsed mode shows `C`.
- **Fleet table hides destroyed instances by default.** Toggle in the header strip surfaces them on demand; toggle is invisible when there are no destroyed instances.
- **Dashboard FLEET TOTAL drops by however many destroyed rows the org has.** RUNNING / PENDING / FAILED tiles unchanged.

### Resolves

- **`docs/executing/frontend-mods.md` items 1–4.** All four asks shipped.

### Known pending work

- **No automated test for the chrome alignment.** v1 has no Playwright; verification was visual. The override is explicit enough (`h-14 p-0` on `SidebarHeader`) that an upstream shadcn padding change wouldn't drift silently — a future reviewer would notice the override exists for a reason.
- **Profile menu item points at `/settings`.** Acceptable v1 stand-in; a real `/profile` route is a future-milestone item.
- **Fleet filter is not URL-persisted.** Refresh resets to "hide destroyed." Correct for v1's session-length workflow; lift into `useSearchParams` if/when audit deep-linking matters.

### Supersedes

- **0.7.1's logo treatment** for the CORELLIA wordmark — the `›` prefix + `text-sm font-bold tracking-widest` is replaced by the heavier, wider, chevron-less treatment.
- **0.7.0's fleet header strip semantic for N REGISTERED** — was raw `state.instances.length`, now `visibleInstances.length`. Reflects "agents currently visible to you," not "agents in the org's history."
- **0.7.0's dashboard FLEET TOTAL definition** — was "all rows ever created," now "all non-destroyed rows." Closer to the operator's mental model of "fleet."

---

## 0.7.7 — `fly.toml`: `min_machines_running` 0 → 1 (Always-Warm Control Plane) (2026-04-26)

One-line config change in `backend/fly.toml:15`: `min_machines_running = 0` → `1`. The control plane no longer cold-starts on the first request after idle; one machine stays warm at all times. Auto-stop + auto-start remain on for any *additional* machines a future scale-up adds — the floor is 1, not the ceiling. Trades the idle-cost savings of the previous "scale to zero" posture for predictable first-request latency (relevant now that the FE is on Vercel and the BE is the user-facing surface, not a localhost endpoint). Patch version: zero code, zero RPC, zero schema, one TOML line. Takes effect on next `fly deploy` from `backend/`; `fly scale count 1 -a corellia` reconciles the live machine state immediately if needed.

---

## 0.7.6 — Env Var Rename: `FLY_API_TOKEN` → `FLY_SPAWN_TOKEN` (Stop `flyctl` Shadowing the Operator's Deploy Identity) (2026-04-26)

Surfaced when `fly deploy` from `backend/` returned `unauthorized` against `corellia` (the control-plane app itself), despite the operator being signed in via `fly auth login`. Diagnosis: `flyctl` honors the `FLY_API_TOKEN` shell env var ahead of `fly auth login` credentials; direnv auto-loads `backend/.env` on `cd backend/`; the runtime *spawn* token (org-scoped per 0.7.3, no permissions on the `corellia` app) was therefore silently shadowing the operator's interactive identity on every `fly deploy`. The two credentials are distinct roles by design — the **runtime spawn token** the deployed backend uses to create agent apps, and the **operator's deploy identity** for releasing the control plane itself — but they collided on a single env var name. Fix is a rename: the runtime-spawn env var becomes `FLY_SPAWN_TOKEN`, a name `flyctl` does not look at, so the two roles stay in their own lanes permanently. Patch version (not minor) per the 0.5.1 / 0.5.2 / 0.7.3 precedent for non-product correctness: zero new product surface, zero RPC change, zero schema/migration change. One env-var name change, four files touched, plus the Fly secret rotation on the deployed backend.

---

## 0.7.5 — M4 Phase 8 Hardening: Transactional Spawn Writes + Handler-Level Sentinel Mapping Tests + v1.5 Deploy-Target-Credentials Breadcrumbs (2026-04-26)

Closes the three M4 Phase 8 hardening items 0.7.0 parked in *Known pending work* and re-flagged in 0.7.3, plus drops the two v1.5 deploy-target-credentials breadcrumbs that `docs/executing/deploy-target-credentials.md` flagged as "worth committing before they evaporate." Patch version (not minor) per the 0.5.1 / 0.7.3 precedent for non-product structural follow-up: zero new product surface, zero new RPC, zero schema/migration/env-var change. The Spawn write path becomes atomic, the public sentinel→Connect-code wire contract becomes test-pinned, and v1.5's per-user deploy-target work has its first two breadcrumbs in code + spec rather than in a one-off design doc.

The transactional-spawn-writes work is the only one with a real runtime effect. The handler tests are pure documentation-via-code of a contract that already held empirically. The breadcrumbs are forward-looking: they don't change v1 behavior, only what the next milestone in this area will inherit.

- **`backend/internal/agents/transactor.go` — new (~75 LOC).** Two interfaces and one production type. **`SpawnTx`** is the narrow exported view of `*db.Queries` Spawn touches *inside* the tx — `InsertAgentInstance` + `InsertSecret`, nothing else. Reads (template lookup, deploy-target lookup) and post-Fly writes (deploy-ref set) stay outside the tx via the wider `agentQueries` view, so they don't belong in `SpawnTx`. Exported (not the package-private `agentQueries`) so external implementations — production `PgxTransactor`, test fakes — can name the type in their fn signature without reaching into agents-internal types. **`Transactor`** is the lifter interface (`WithSpawnTx(ctx, fn func(SpawnTx) error) error`) — named for purpose, not a generic `WithTx`, so the call site reads as "this is a spawn-scope tx" without a comment. **`PgxTransactor`** is the production implementation: thin lifter over `pgxpool.Pool`, calls `BeginTx` → `fn(db.New(tx))` → `Commit` on success or `Rollback` on error. Pool ownership stays with `cmd/api/main.go`; the transactor borrows it per-call. Rollback errors are logged at warn and dropped — the *fn* error is what the caller is reacting to; obscuring it with a downstream rollback failure would hide the root cause. `pgx.ErrTxClosed` on rollback is silently absorbed (legitimate when the context cancellation already unwound the tx).
- **`backend/internal/agents/service.go` — `Spawn` rewritten to use `WithSpawnTx`** (decision 27 step 6, deferred at M4 ship). `Service` struct gains a `txr Transactor` field; `NewService` widens to a 4-arg constructor. The two `s.queries.Insert{AgentInstance,Secret}` calls move inside one `s.txr.WithSpawnTx(ctx, func(q SpawnTx) error { ... })` block; the Fly call (step 8) stays outside the closure per decision 27. **Pre-Phase-8 a process crash between the two inserts could leave an instance row visible without an audit row, or vice versa** — the only honest atomic shape for the paired write is one tx, and now it has one. Result of the closure (the inserted `db.AgentInstance`) is captured via a closed-over outer `var instance db.AgentInstance`. The 11-step order of decision 27 is otherwise unchanged.
- **`backend/internal/agents/service.go` — secrets-row policy pinned in code.** Comment added at the `InsertSecret` call site (now inside the tx closure): "one secrets row per *secret-shaped* CORELLIA_* env var, not per CORELLIA_* env var. Today CORELLIA_MODEL_API_KEY is the only credential the spawn flow forwards; CORELLIA_AGENT_ID / CORELLIA_MODEL_PROVIDER / CORELLIA_MODEL_NAME are configuration, not secrets, and don't get audit rows. New secret-shaped vars (e.g. CORELLIA_TOOL_AUTH_TOKEN in v1.5+) each insert their own row here." Closes the open question 0.7.0 *Known pending work* posed against decision 6.
- **`backend/cmd/api/main.go` — `agents.NewService` call updated.** One-character widen: `agents.NewService(queries, adaptersSvc, deployResolver, agents.NewPgxTransactor(pool))`. The `pool` was already in scope (constructed three lines earlier for `db.New(pool)`); no new wiring.
- **`backend/internal/agents/service_test.go` — `fakeTransactor` added; 21 `NewService` call sites updated.** The fake's `WithSpawnTx` runs the closure in-place against the test's existing `fakeQueries` — no real `BeginTx`, since the fake's "DB" is just struct fields. `replace_all` handled 19 of the 21 call sites (the `agents.NewService(q, a, r)` form from `newSpawnReadyHarness`); the two M2-holdover call sites that constructed `fakeQueries` inline were edited individually to pull the queries into a named var so the transactor can capture it. **Existing 18 sub-tests still green; no test logic changed**, only constructor arity.
- **`backend/internal/httpsrv/agents_handler.go` — `agentsService` interface introduced.** New small in-package interface mirrors the seven-method surface the handler calls on `agents.Service` (`ListAgentTemplates`, `Spawn`, `SpawnN`, `List`, `Get`, `Stop`, `Destroy`). `AgentsHandler.svc` field swaps from concrete `*agents.Service` → `agentsService`; `NewAgentsHandler`'s first parameter type changes accordingly. **`*agents.Service` satisfies `agentsService` structurally**, so `cmd/api/main.go` requires zero change. The seam is the same one `userIdentityLookup` (this file) and `organizations.userLookup` already use — *narrow private interface declared by the consumer, the producer satisfies it for free* — extended from one method to seven.
- **`backend/internal/httpsrv/agents_handler_test.go` — new (~210 LOC, 16 sub-tests).** Three top-level tests. **`TestAgentsErrToConnect_SentinelMapping`** (13 sub-cases) is the load-bearing one: table-drives every `users.Err*` and `agents.Err*` sentinel through `SpawnAgent` (the mapping is method-agnostic, so one RPC vehicle exercises the whole `agentsErrToConnect` switch) and asserts `connect.CodeOf(err)` against the expected code. The 13 cases cover all 12 sentinels in the switch's named arms (`Unauthenticated`, `PermissionDenied`, `InvalidArgument` ×4, `FailedPrecondition`, `NotFound` ×3, `Unavailable` ×2) plus the `default` arm (unknown error → `Internal`, with the raw error logged at `slog.Error` server-side — the redaction layer's contract). **`TestSpawnAgent_BadTemplateID`** and **`TestStopAgentInstance_BadID`** cover the per-handler UUID-parse fast paths that bypass the service entirely. The two paths return *different* Connect codes (template-id parse failure → `InvalidArgument` wrapping `ErrTemplateNotFound`; instance-id parse failure → `NotFound` wrapping `ErrInstanceNotFound`) — the tests *document* this inconsistency rather than fix it; if the inconsistency is wrong, that's a separate decision. **`TestListAgentInstances_HappyPath`** confirms the success-path response is shaped correctly (not just that the error path is wired).
- **`backend/internal/deploy/fly.go:33` — `// TODO(v1.5):` on `FlyCredentials`.** Existing doc-comment (which already gestured at v1.5) extended with a concrete description of the split: "v1.5's resolver loads per-target credentials from the secret store via `deploy_targets.credentials_storage_ref`; the boot-time `FLY_API_TOKEN` / `FLY_ORG_SLUG` env path becomes the operator-only fallback for the platform's own service-account (Corellia's own dogfood deploys). User-supplied targets get an org-scoped Fly macaroon via OAuth — never a PAT pasted into a form. See `docs/executing/deploy-target-credentials.md`." Resolves 0.7.3 *Known pending work* item "two breadcrumbs from `deploy-target-credentials.md` not yet committed" (this is the first of the two).
- **`docs/blueprint.md` — new architecture rule §11.6.** "**Deploy-target credentials never live in Corellia's database.** Raw credentials live in a secret store; DB rows reference them via opaque `storage_ref` (M4 decision 6, applied to deploy-target credentials the same way it applies to per-instance secrets). When v1.5 introduces user-supplied targets, the acquisition flow uses the provider's narrowest-capability mechanism — Fly OAuth → org-scoped macaroon, AWS STS → assumed-role with an external ID, etc. **Never accept PATs from users.** Paste-as-fallback is acceptable only when no narrower mechanism exists, with explicit capability scope labelled in the UI. The macaroon/role caveats define the capability contract; the adapter declares the minimum set it needs." First architecture rule appended to blueprint §11 since the original five (which §11.1–§11.5 enumerate). Resolves the second of the two `deploy-target-credentials.md` breadcrumbs. Companion mirror in `CLAUDE.md`'s architecture-rules list as #11.


---

## 0.7.4 — M3.9: Control-Plane Deploy (BE → Fly, FE → Vercel) (2026-04-26)

Closes the M3.9 milestone (`docs/plans/post-0.2.6-roadmap.md` §M3.9) — the control plane is no longer local-only. **Sequencing note:** roadmap prescribed M3.9 *before* M4; in practice M4 (0.7.0 + 0.7.3) landed first against `localhost`, and the artefacts below were created today (2026-04-26) to retire that gap. Step 1 of §5's "demoable v1" definition-of-done — *open the deployed FE in a browser* — is now reachable.

### Index

- **`backend/Dockerfile` — new.** Multi-stage build: `golang:1.26-alpine` builder → `gcr.io/distroless/static-debian12:nonroot` runtime. `CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`, port 8080, `nonroot` user. `cmd/smoke-deploy` deliberately not built into the image.
- **`backend/.dockerignore` — new.** Strips `.env*`, `.envrc`, `bin/`, `tmp/`, `*_test.go`, editor noise. Secrets stay outside the image surface.
- **`backend/fly.toml` — new.** App `corellia`, primary region `sin`, `internal_port = 8080`, `force_https = true`, `[[http_service.checks]]` against `/healthz` (already exposed outside the auth group), `auto_stop_machines = "stop"` + `auto_start_machines = true` + `min_machines_running = 0`, `shared-cpu-1x` / 512MB. Org pinned at deploy time, not in the file.
- **Vercel project rooted at `frontend/`** with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` set in the dashboard. Auto-deploys on push to `main`. No committed `vercel.json`.
- **Fly secrets** (`fly secrets set`) — `DATABASE_URL`, `SUPABASE_URL`, `FLY_API_TOKEN` (org-scoped per 0.7.3), `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`. Never committed.


---

## 0.7.3 — M4 Phase 7: Integration Smoke Pass (Local BE + Prod DB + Live Fly) + Fly Token Swap (PAT → Org-Scoped) (2026-04-26)

The first end-to-end walkthrough of the M4 spawn flow against a live Fly account — the integration smoke that 0.7.0's *Known pending work* parked as Phase 7. Surfaced one real bug: the operator's Fly **Personal Access Token** in `backend/.env` succeeded against Fly's GraphQL API but returned `unauthorized` on `flaps.CreateApp` against `api.machines.dev`. The Machines API gates more strictly than GraphQL, and PATs — despite working everywhere `flyctl` is used interactively — aren't the right token *shape* for what Corellia is becoming. Two things shipped here, neither involving Go or TS code: (a) the diagnosis was written up as a problem-statement doc (`docs/executing/deploy-target-credentials.md`) framing both today's fix and the v1.5 product evolution (per-user deploy targets, secret-store-backed credentials, OAuth-acquired where the provider supports it); (b) the fix itself — swap the operator's PAT for an **org-scoped Fly token** (`fly tokens create org -o personal --name "corellia-dev" --expiry 8760h`), zero code change, byte-compatible with the v1 code path *and* the same token *shape* users will eventually supply via the v1.5 connect flow. We dogfood the production credential model from day one without writing v1.5 code. Patch version (zero code change, runtime-config + docs only).

### Index

- **`backend/.env:15` — `FLY_API_TOKEN` swapped from PAT to org-scoped token.** *Why:* PATs grant full-account power forever (equivalent to an AWS root key) and — empirically — are gated *out* of the Machines API surface that `flaps.CreateApp` / `flaps.SetAppSecret` / `flaps.Launch` need. An org-scoped token (`fly tokens create org -o <slug>`) is the **narrowest token that satisfies all six flaps endpoints** the M3 `FlyDeployTarget` exercises (`CreateApp`, `DeleteApp`, `SetAppSecret`, `Launch`, `List`, `Stop`) — provider-correct, and the same shape v1.5's connect flow will ask users to mint themselves. `FLY_ORG_SLUG=personal` was already correct; no companion change. Token written without the `FlyV1 ` prefix to match the file's existing convention; `fly-go` / `flaps-go` clients accept both forms.
- **`docs/executing/deploy-target-credentials.md` — new (66 LOC).** Problem-statement doc, pre-plan, not yet milestone-scoped. Frames three concrete problems (one credential serves all users; PAT-shaped paste UX is wrong; credentials must never live in Corellia's database) and proposes a two-track resolution: today's operator-loop fix (no code) and the v1.5 product evolution (`deploy_targets` schema extension with `owner_org_id` + `display_name` + `credentials_storage_ref`; `resolver.For(ctx, kind)` evolving to `resolver.For(ctx, deployTargetID)`; per-provider connect flow — Fly OAuth, AWS STS, paste-as-fallback). Records two breadcrumbs to commit before they evaporate: a `// TODO(v1.5):` on `FlyCredentials` in `internal/deploy/fly.go:33`, and a new `blueprint.md` section codifying "never PATs from users." **Both breadcrumbs deferred** — not in this entry; queued for the next session that touches either file.
- **Validation against live Fly account.** `fly apps list -t <new-token>` returned a non-empty result — exercises the Machines API auth path before any Corellia code path is invoked, so the token shape is confirmed *before* we trust it inside the spawn flow. Then the UI walkthrough: sign in → `/agents` → click Deploy → form fills → submit. The spawn produced a `corellia-agent-<uuid>` app under the `personal` org with one machine in `iad` running the pinned Hermes adapter image — the first end-to-end confirmation that the M4 wire connects from React form → Connect-go RPC → `agents.Service.Spawn` → `deploy.Resolver.For(ctx, "fly")` → `FlyDeployTarget.Spawn` → flaps `CreateApp` + `SetAppSecret` + `Launch` against a real Fly account. Machine ran for ~88s before Fly's native auto-stop kicked in — consistent with blueprint §8 ("Auto-stop enabled, auto-start on request"). Backend ran locally via `overmind start` against the prod Supabase DB (no separate dev project; `DATABASE_URL` unchanged).

### Behavior change (known)

- **`flaps.CreateApp` succeeds against `api.machines.dev`.** Pre-fix: `unauthorized`. Post-fix: app + machine created.
- **No code, generated code, schema, env-var-name, or dependency change.** Pure runtime-config + docs.
- **The token in `backend/.env` is now scoped to org `personal` only.** Cannot create/delete apps in any other Fly org the operator's account belongs to. This is the intended narrowing — Corellia spawns under `personal` per `FLY_ORG_SLUG`; access to other orgs the operator owns is now intentionally out-of-scope for the running backend.

### Resolves

- **0.7.0 *Known pending work*: "Phase 7 (integration smoke) — first end-to-end walkthrough against a live Fly account + real provider key."** First walkthrough complete; the `pending → running` convergence, the 3s polling cadence, and the `Deploy 5` semaphore behavior remain to be exercised explicitly in subsequent runs but the auth-gated boundary that was blocking *any* spawn is now open.
- **0.7.0 *Known pending work*: "decision 25's redaction layer (bad provider key should surface as `Unavailable` in the FE toast)."** Not directly tested in this run (the *Fly* token was the failing surface, not the *model provider* key). Still pending for an explicit malformed-key smoke.

### Known pending work

- **M4 Phase 8 hardening — three pre-flagged items unchanged from 0.7.0.** (1) Transactional spawn writes (decision 27 step 6 deferred); (2) `agents_handler_test.go` for the sentinel → Connect code mapping; (3) explicit secrets-row policy decision (one row vs one-per-`CORELLIA_*` var).
- **v1.5 deploy-target credentials work itself.** Schema extension + resolver evolution + Fly OAuth connect flow per `docs/executing/deploy-target-credentials.md`. Not in this entry; not in M4. Will be a distinct milestone with its own plan.
- **Two breadcrumbs from `deploy-target-credentials.md` not yet committed.** `// TODO(v1.5):` on `FlyCredentials` in `internal/deploy/fly.go:33`; new `blueprint.md` section on the per-user / secret-store-backed / OAuth-where-possible / never-PATs rule. Cheap to drop in next time either file is open.
- **Old PAT not yet revoked.** Kept around as a fallback while the new token is exercised in further spawn-flow runs (UI shows the spawn worked, but `pending → running` convergence and the M4 lifecycle endpoints — `Stop`, `Destroy`, `pollHealth` flipping the row — haven't all been confirmed in one session yet). Once Phase 7 is fully green: `fly tokens list` → `fly tokens revoke <id>`.
- **`pollHealth` → `running` confirmation.** Spawn produced the Fly app + machine, but this entry doesn't pin whether the `agent_instances.status` row reached `running` before the 90s `pollHealth` budget elapsed — the machine was already in Fly's `stopped` state at inspection time, which is consistent with *either* successful health-check + auto-stop *or* `pollHealth` deadline → status `failed` + Fly auto-stop. Worth checking the fleet UI's status badge on the next session and `fly logs -a <app-name>` if it reads `failed`.

### Supersedes

- **The implicit assumption since 0.5.0 that PATs are an acceptable dev-time stand-in for the operator's Fly credential.** Empirically false against the Machines API; the v1 code path now runs against the production-correct token shape from day one.

---

## 0.7.2 — UX Copy: `/agents` Nav + Page Heading Renamed to "Agents" (2026-04-26)

Three-string copy fix. The sidebar nav item for `/agents` was labelled "Catalog" — an internal descriptor for the harness-template listing, not a user-facing concept. Post-M4, that page is where admins deploy agents; "Catalog" describes the implementation but not the user's job-to-be-done. Renamed to **"Agents"** to match the URL slug, the nav's sibling "Fleet" naming convention (noun = section), and the user's mental model ("I go to Agents to create one; I go to Fleet to see them running"). The page's H1 follows the nav label for consistency (`CATALOG` → `AGENTS`). The decorative section tag above the H1 (`[ HARNESS CATALOG ]`) flips to `[ DEPLOY ]` — it reads as intent rather than section label, signalling to the user that this page is the deploy entry point without baking a verb into the H1 or the nav. Patch version (not minor): pure copy change, zero logic delta, no API/env/DB change.

### Index

- **`app-sidebar.tsx:26` — `label: "Catalog"` → `label: "Agents"`.** *Why:* "Catalog" was the M2-era internal label; the URL has always been `/agents`. Nav label and URL slug should name the same thing. The sibling items ("Fleet", "Dashboard", "Settings") are all nouns naming sections; "Catalog" was the odd one out.
- **`agents/page.tsx:54` — `[ HARNESS CATALOG ]` → `[ DEPLOY ]`.** *Why:* The section tag sits above the H1 and reads as intent, not as the section title. "Harness Catalog" describes the listing's content; `[ DEPLOY ]` tells the user what they are here to do. The distinction matters post-M4 because the page now has a real Deploy button — the tag is no longer just label copy, it narrates the action.
- **`agents/page.tsx:57` — H1 `CATALOG` → `AGENTS`.** *Why:* Consistency with the sidebar label (both say "Agents") and the URL. The Fleet page's H1 is "FLEET"; the Agents page's H1 is now "AGENTS" — parallel structure across the two core app sections.

### Supersedes

- **M2's "Catalog" label for the `/agents` route** (`app-sidebar.tsx` first set in 0.4.0). The harness-listing framing is preserved in the `TerminalContainer` title ("AVAILABLE HARNESSES") and the coming-soon section ("COMING SOON") — the word "catalog" doesn't need to appear at the nav/H1 level to be legible as a catalog page.

---

## 0.7.1 — Frontend Mission-Control Implementation: Spec → Pixels (2026-04-26)

The frontend's visual identity finally matches the spec. **`docs/refs/design-system.md` has prescribed a Mission Control × Deep Space aesthetic since 0.2.0** — terminal green `#22c55e` as primary accent, Space Mono as the signature face, uppercase + `tracking-wider` chrome, hairline-bordered square panels, `[ BRACKETED ]` section labels, `›` chevrons, four-tier near-black depth, status-dot indicators with telemetry pulses. **None of it ever shipped.** 0.6.0 introduced a pearlescent chrome × halftone substrate direction *on top of* the unimplemented spec; 0.6.1 activated dark mode but the underlying tokens were still shadcn-stock-dark with pearl gradients glued on. Operator's verdict on first review: "looks clunky compared to Elephantasm" — confirming the doc-vs-code gap empirically.

0.7.1 closes that gap. **The spec is now the runtime.** Token system rewritten in `globals.css` (HSL channels matching §5 + §12, `--primary: 142 71% 45%` terminal green, `--background: 0 0% 0%` pure black, `--radius: 2px` square corners, `--font-display: var(--font-space-mono)`); seven shadcn primitives rewritten at the CVA layer (`button`, `card`, `input`, `label`, `badge`, plus the previously-orphan `status-dot` and `terminal-container` get first consumers); pearl deleted (`pearl-text.tsx` removed; `pearl` button variant retired; `.pearl`, `.pearl-text`, `.pearl-ring`, `.halftone-bg` utilities gone from `globals.css`); five live routes rewritten as mission-control panels (dashboard reframed from "Welcome back, Phil + 2 onboarding cards" to a four-tile telemetry strip + `[ FLEET STATUS ]` matrix; agents reframed as `[ HARNESS CATALOG ]` with cyan-accented spec-sheet cards; fleet wrapped in `[ AGENT INSTANCES ]` `TerminalContainer` with live `POLLING · N REGISTERED` indicator; sign-in becomes a `[ AUTHENTICATE ]` panel with `EMAIL` / `PASSPHRASE` fields and `› AUTHENTICATE` CTA; onboarding becomes `[ INITIAL CONFIGURATION ] / [ OPERATOR PROFILE ]` with `CALLSIGN` / `WORKSPACE` fields). Two console errors closed along the way: vestigial `nativeButton={false}` props leaking to DOM (residue from a `@base-ui-components/react` → `@base-ui/react` migration, finished off in the first turn of this milestone) and a Base UI `useButton` warning when `<Button render={<Link>}>` is used on the dashboard's catalog CTAs. Patch version (not minor) per the 0.5.1 / 0.5.2 / 0.6.1 precedent for non-product structural follow-up: zero new product surface, pure aesthetic correctness + two console-error fixes; the user-visible action surface (deploy modal, fleet table actions, onboarding flow) is byte-equivalent in *behavior*, transformed in *register*. No API change, no env var, no DB change, no migration. **Supersedes 0.6.0's pearl direction wholesale.**

The aesthetic register has shifted from "shadcn-stock-dark with pearl decoration" to "operator console with always-on monitoring." The load-bearing tells: a live `[ UTC ] HH:MM:SS` clock in the top-right (ticks every second, mono tabular-nums); `[ ONLINE ]` indicator with a 2.4s telemetry-pulse green dot on the dashboard header; `POLLING` indicator on the fleet route that pulses amber while non-terminal rows exist and stops when everything settles; the sidebar's active item gets a 12px green left-rule via `::before` pseudo + green text (no fill swap). Animation count: zero gratuitous motion (pearl drift retired); two functional motion registers — `.animate-telemetry` (2.4s opacity pulse for live-state indicators) and the live clock's per-second redraw. Both are "alive, not showy" per design-system.md §Animation Stance.

---

## 0.7.0 — M4: Spawn Flow (Phases 1–6) (2026-04-26)

Fourth product milestone — the first end-to-end agent lifecycle. Where 0.5.0 (M3) proved the Fly deploy primitive and 0.6.0 introduced the visual design language, 0.7.0 closes the loop between the UI and the wire: an admin can sign in, click Deploy, fill a form, submit, and watch the agent flip from `pending` → `running` in the fleet table. Six phases shipped vertical-slice — schema → service → proto verification → Connect handlers → deploy modal → fleet page — each a strict prerequisite for the next. **First time `agent_instances`, `secrets`, and `deploy_targets` exist as real tables.** **First time `agents.Service` owns a lifecycle (`Spawn`, `SpawnN`, `List`, `Get`, `Stop`, `Destroy`) beyond the M2 catalog reader.** **First time any Connect handler executes a write-path RPC.** **First time M3's `deploy.Resolver` has a runtime reader.** The user-visible loop — Deploy button → Fly app creation → `pending → running` convergence shown in the fleet table — is now code, not stub. Phase 7 (integration smoke) is the runtime confirmation that all six layers agree against a live Fly account; Phase 8 is the hardening pass. Plan: `docs/executing/spawn-flow.md`. Six per-phase completion docs under `docs/completions/spawn-flow-phase-{1..6}.md`.

### Index

- **Migration `20260426150000_spawn_flow.sql`** (87 LOC, one goose transaction) — three tables, two indexes, one seed row. `deploy_targets (name UNIQUE, kind CHECK IN ('fly','aws','local'), config JSONB, enabled)`. `agent_instances (name, four FKs, deploy_external_ref TEXT NULL, model_provider CHECK IN ('anthropic','openai','openrouter'), model_name, status CHECK IN ('pending','running','stopped','failed','destroyed') DEFAULT 'pending', config_overrides JSONB, last_started_at NULL, last_stopped_at NULL)`. `secrets (agent_instance_id FK ON DELETE CASCADE, key_name, storage_ref, UNIQUE(agent_instance_id, key_name))` — no `value` column; the API key is forwarded once to Fly's secret store and never written to Corellia's DB (blueprint §9 + decision 7). Two indexes on `agent_instances`: `(org_id, created_at DESC)` for the fleet view's hot read path; partial unique on `deploy_external_ref WHERE NOT NULL` for double-spawn defence. Seed row `INSERT INTO deploy_targets ('fly', 'fly', true) ON CONFLICT DO NOTHING`; `aws` and `local` are deliberately not seeded — a DB row implies the target is usable.
- **Four query files (13 new methods) and `sqlc generate`.** `agent_instances.sql` (8 queries: insert, deploy-ref setter, four named status-transition variants, list-by-org, get-by-id, reap-stale-pending). Status transitions are split into four named variants (`SetAgentInstanceRunning/Stopped/Destroyed/Failed`) rather than one polymorphic `SetStatus` — each variant pins the correct `last_started_at` / `last_stopped_at` timestamp side-effect at the SQL layer. `secrets.sql` (insert + list); `deploy_targets.sql` (get-by-name + list-enabled); `agent_templates.sql` extended with `GetAgentTemplateByID :one`. **`GetAgentInstanceByID` takes `(id, org_id)`** — single-tenant leakage requires actively passing the wrong org_id; a caller cannot omit the filter structurally. Generated: `internal/db/agent_instances.sql.go` (357 LOC), `secrets.sql.go`, `deploy_targets.sql.go`; `models.go` gains `AgentInstance`, `DeployTarget`, `Secret`; `querier.go` widens by 13 methods + compile-time `var _ Querier = (*Queries)(nil)` assertion.
- **`agents/service.go` rewritten** from the M2 51-line catalog reader to a 480-line spawn-lifecycle service. Nine error sentinels (`ErrInvalidName`, `ErrInvalidProvider`, `ErrInvalidModel`, `ErrMissingAPIKey`, `ErrSpawnLimit`, `ErrTemplateNotFound`, `ErrInstanceNotFound`, `ErrFlyAPI`, `ErrTargetUnavailable`). One wide `agentQueries` interface (12 methods — the M2 `templateQueries` + M4 instance/secret/deploy-target coverage). `Spawn` implements decision 27's eleven-step order in discrete code sections: validate → resolve template + adapter + deploy target → insert `agent_instances` row → insert `secrets` row → call `deployer.Spawn` → set `deploy_external_ref` → detach `pollHealth` goroutine. The API key flows through the `Env` map in-memory exactly once and is never logged, returned, or persisted. `SpawnN` fans out via `errgroup` + `semaphore.NewWeighted(3)` with zero-padded names (5→`alpha-1..5`; 10→`fanout-01..10`). `Stop` and `Destroy` are synchronous (1–3s fits request budget). `pollHealth` runs with a detached `context.Background()` 90s budget, 2s tick, exits on `HealthStarted` (flip to running) / `HealthFailed` (flip to failed) / deadline (flip to failed); probe errors are *warned* not exited-on.
- **`agents/service_test.go` rewritten** from 2 cases to 18 table-driven cases. Fakes: `fakeQueries` (atomic counters, scriptable returns), `fakeDeployTarget` (atomic counters, scriptable Health sequences), `fakeResolver`. Coverage: happy-path spawn + SpawnN naming + all validation sentinels + FlyAPI redaction (`errors.Is(err, ErrFlyAPI)` strict) + stop/destroy lifecycle + `TestList_Empty` + `TestProviderFromProto` bidirectional enum + `TestReapStalePending`.
- **`shared/proto/corellia/v1/agents.proto` extended** (+95 LOC) with six RPCs (`SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance`), the `AgentInstance` message (12 fields), six request/response pairs, and `enum ModelProvider`. Two `// SECRET — never log this field` comments on the `model_api_key` field in both spawn request types — the IDL encodes the invariant so every downstream artefact (Go pb, TS bundle, future code reviewer) sees it. This work shipped in Phase 2 (absorbed forward because Phase 2's service signatures depended on the types at compile time); Phase 3 is the no-drift attestation (`pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen` exits 0). Generated: `agents.pb.go` (+≈800 LOC delta), `corelliav1connect/agents.connect.go` (six new handler-interface methods + procedure constants), `agents_pb.ts` (525 LOC, 98 references to M4 types).
- **`agents_handler.go` rewritten** from 90 LOC (M2 catalog + 6 `CodeUnimplemented` stubs + 1 sentinel arm) to 208 LOC (6 real handlers + 9 sentinel arms + `userIdentityLookup` interface). Each handler ≤30 LOC: resolve caller identity (`CallerIdentity`) → parse UUID-shaped fields → build typed input → call service → marshal response. `agentsErrToConnect` switch maps 9 sentinels to 7 distinct Connect codes: `Unauthenticated`, `PermissionDenied`, `InvalidArgument` (name/provider/model/key validation), `FailedPrecondition` (`ErrSpawnLimit` — policy cap, not malformed input), `NotFound`, `Unavailable` (`ErrFlyAPI` redaction layer; raw error goes to `slog.Error` only), `Internal` (pgx/driver leak guard). `ErrSpawnLimit → FailedPrecondition` not `InvalidArgument`: a `count` of 11 is well-formed; the rejection is policy, not shape. `userIdentityLookup` is a single-method in-package interface (mirrors `organizations.userLookup`); fake-able in three lines without constructing the full users.Service chain.
- **`users.Service.CallerIdentity(ctx) (userID, orgID uuid.UUID, error)`** added (+13 LOC). Reuses the private `loadCurrentUser` helper — one DB lookup, both columns. Replaces the alternative of calling `CallerOrgID` + a separate `CallerUserID` (two DB lookups for two columns from the same row). Named-return signature makes positional confusion impossible at the call site. `cmd/api/main.go` passes `usersSvc` to `NewAgentsHandler` (one-character wiring change; `usersSvc` already existed for the users and organizations handlers).
- **Boot-time stale-pending sweep** (`agentsSvc.ReapStalePending`) wired in `cmd/api/main.go` between service construction and `httpsrv.New`. Returns `[]uuid.UUID` (not just a count) so the `slog.Warn` line is actionable: the operator can cross-reference reaped IDs against the crash event that preceded the boot. Empty-result case is silent.
- **`frontend/src/components/agents/deploy-modal.tsx` — new (491 LOC).** One `<DeployModal>` wrapper, two parallel form variants (`<DeployOneForm>` / `<DeployManyForm>`), three shared field subcomponents (`<Field>`, `<ProviderField>`, `<ApiKeyField>`). Two forms not one because the value types differ at the schema level (`name: string` vs `namePrefix: string + count: number`); React `key={mode}` on the wrapper guarantees remount on mode flip so no field state leaks. Zod schemas share three field defs (provider, modelName, apiKey); oneSchema adds `name min(1) max(80)`; manySchema adds `namePrefix min(1) max(60)` + `count int min(1) max(10)`. `count` field uses `register("count", { valueAsNumber: true })` + `z.number()` — not `z.coerce.number()`, which produces `unknown` input type and breaks the `Resolver<TFieldValues>` inference. Provider field uses `useWatch({ control, name: "provider" })` not `form.watch()` (React Compiler memoization, no `react-hooks/incompatible-library` warnings). API key field is `type="password"` with show-toggle; inline copy "Forwarded once to the agent's secret store. Never written to Corellia's database." is the user-facing surface of decision 7. `submitting` state lifted to the wrapper so all four close paths (outside-click, ESC, X, Cancel) are gated during an in-flight RPC. Success path: toast → `onClose()` → `router.push("/fleet")` per decision 38; no localStorage (decision 39). No `lib/api/agents.ts` wrapper file — the generated Connect TS client is itself the wrapper; the plan's prescription for this file was drafted before M2's `createApiClient()` pattern existed.
- **`frontend/src/components/agent-template-card.tsx` rewritten** (48 → 58 LOC). Two active buttons replace the single disabled `<Button>` + `<Tooltip>` with "Available in v1" copy: `<Button variant="outline" onClick={() => openWith("many")}>Deploy 5</Button>` (secondary — demo-moment affordance) + `<Button onClick={() => openWith("one")}>Deploy</Button>` (primary). Card owns its own modal state (`open`, `mode`). `<TooltipProvider>` removed from `agents/page.tsx` (now a vestigial import; per CLAUDE.md "if certain it's unused, delete").
- **`frontend/src/components/ui/dialog.tsx` — new (160 LOC, shadcn-installed).** Wrapper over `@base-ui/react/dialog`. Establishes the modal primitive that Phase 6's `alert-dialog.tsx` sits alongside.
- **`frontend/src/app/(app)/fleet/page.tsx` replaced** (18-LOC ComingSoon stub → 216-LOC real listing). Discriminated union state machine (`loading | empty | ready | error`). Two-`useEffect` lifecycle: Effect 1 fires once on mount (initial fetch); Effect 2 watches `state` and conditionally starts/stops a `setInterval` — **polling costs exactly zero once every row is terminal** (all statuses in `TERMINAL_STATUSES = new Set(['stopped','failed','destroyed'])`). `POLL_MS = 3000`. `fetchInstances` is `useCallback`-wrapped with no external dependencies; both effects depend on its stable identity to avoid re-fetch storms.
- **`frontend/src/components/fleet/status-badge.tsx` — new (50 LOC).** Maps five status strings to Badge variant + label + optional className: `pending` → secondary (muted); `running` → secondary + `bg-emerald-500/15 text-emerald-700 dark:text-emerald-400` (green per decision 31; no "success" variant in shadcn, className override is correct scope); `stopped` → outline + muted-foreground; `failed` → destructive; `destroyed` → outline + `text-muted-foreground/70 line-through` (line-through signals "audit row, not manageable"). Exports `isTerminal(status)` and `TERMINAL_STATUSES` — single source of truth for the polling predicate.
- **`frontend/src/components/fleet/agent-row-actions.tsx` — new (141 LOC).** Three conditional buttons (Logs when `logsUrl !== ""`; Stop when `status === "running"`; Destroy when `status !== "destroyed"`). One `pending: "stop" | "destroy" | null` state drives both AlertDialog open/close and the confirm action — collapsing two booleans into a tagged null encodes the "at most one action in flight" invariant at the type level. `onChanged: () => void` callback signals the parent to refetch on success (explicit prop, not context — the data flow is short and unidirectional). Confirm fires the RPC, closes on success, stays open on failure so the user can retry; Cancel uses `AlertDialog.Close` primitive (no manual onClick needed). No optimistic UI (decision 43) — 1–3s synchronous Fly call fits the request budget; rollback-on-error is more surface area than v1 warrants.
- **`frontend/src/components/ui/alert-dialog.tsx` — new (187 LOC, shadcn-installed).** Wrapper over `@base-ui/react/alert-dialog`. Sibling to `dialog.tsx`; distinct semantic ("destructive confirmation" vs "form modal") despite similar Base UI primitive.
- **Validation matrix.** `cd backend && go vet ./... && go build ./... && go test -count=1 ./...` clean across all phases: `internal/agents` 18 sub-tests (was 2 after M2); `internal/deploy` 26 sub-tests (M3.5 baseline); `internal/users` 3 sub-tests (0.2.5 baseline). `pnpm -C frontend type-check && lint && build` clean across Phases 5–6; `next build` produces 10 static routes including `/agents` (active CTAs) and `/fleet` (real listing). Proto no-drift check (`pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen`) exits 0.

### Behavior change (known)

- **Six new Connect RPCs callable** (behind the existing `auth.Middleware` group): `SpawnAgent`, `SpawnNAgents`, `ListAgentInstances`, `GetAgentInstance`, `StopAgentInstance`, `DestroyAgentInstance`. The six `CodeUnimplemented` stubs from Phase 2 are gone.
- **`/agents` page has two active deploy buttons.** The disabled "Available in v1" tooltip card is gone; clicking Deploy or Deploy 5 opens a real form modal.
- **`/fleet` page replaces the M1 `<ComingSoon>` stub** with a live table + status badges + Stop / Destroy actions + Logs link. Polling activates while any row is in a non-terminal status, then self-cancels.
- **Boot-time stale-pending sweep runs before the HTTP server starts.** On first boot after a crash mid-spawn, orphaned `pending` rows older than 5 minutes are reaped to `failed`; their IDs are logged at `WARN` level.
- **API key security posture.** The model API key travels in-memory from the RPC request through the `CORELLIA_MODEL_API_KEY` env var in `deployer.Spawn`'s `Env` map and then into Fly's secret store. It is never written to Corellia's database, never logged, never returned in a response.
- **`internal/deploy.Resolver` gets its first runtime reader.** M3.5 (0.5.1) wired the `deploy.Resolver` field on `httpsrv.Deps` but no handler consumed it; M4's `agents.Service` is the first reader via `resolver.For(ctx, kind)`.

### Resolves

- **Blueprint §10 "RPG character creation" user flow** — the golden path (sign in → New Agent → pick harness → name → provider → API key → model → Deploy → fleet view) is now code, not description.
- **`docs/plans/post-0.2.6-roadmap.md` §M4** — all six coded phases shipped; Phase 7 (integration smoke) and Phase 8 (hardening) remain.
- **0.6.0 known-pending-work: "M4 spawn-flow Phase 4 WIP parking is unstable."** The `deploy-modal.tsx` was untracked and `agent-template-card.tsx` had a dangling import; both are now committed and consistent.
- **0.5.1 known-pending-work: "M4 (spawn flow) is unblocked structurally for resolver-based callsite design."** `agents.Service` consumes `resolver.For(ctx, kind)` from line 1 — no intermediate map-shaped layer needed.

### Known pending work

- **Phase 7 (integration smoke)** — first end-to-end walkthrough against a live Fly account + real provider key. Exercises: the `pending → running` convergence (90s `pollHealth` budget vs real machine boot); decision 25's redaction layer (bad provider key should surface as `Unavailable` in the FE toast, not raw Fly noise); the 3s polling cadence; the `Deploy 5` semaphore feeling parallel in the demo; `Stop` vs Fly's auto-stop topology.
- **Phase 8 hardening** — three pre-flagged items from Phase 2: (1) **Transactional spawn writes** (decision 27 step 6 deferred) — introduce a `Transactor` abstraction around `pgxpool.Pool.BeginTx` + `WithTx(tx)` lifter so `InsertAgentInstance` + `InsertSecret` are one logical unit; (2) **`agents_handler_test.go`** — the `agentsErrToConnect` sentinel → Connect code mapping is a public contract; a fake service returning each sentinel in turn + `errors.Is`-based assertions would be ~50 LOC; (3) **Secrets row policy** — currently one audit row per spawn for `CORELLIA_MODEL_API_KEY` only; decision 6 implies one row per `CORELLIA_*` var; Phase 8 should pin the explicit decision.
- **`logsURL` on `DeployTarget` interface** — v1.5 candidate. Currently computed in `agents.toProto*` mappers (a small §11.1 tension — `agents` knows the Fly URL prefix). Decision 33 deviation documented in Phase 2's completion doc.
- **`CORELLIA_MODEL_NAME` is observability-only.** Hermes 0.x has no env-var hook for model selection (deprecated `LLM_MODEL` was removed). The catalog model picker is visually functional but the deployed agent always uses the upstream default. v1.5 sidecar work: write a `config.yaml` fragment or pass `--model` via parsed CLI from the entrypoint shim.
- **FE Phase 8 polish (fleet):** tab-visibility-aware polling (pause `setInterval` when backgrounded); sortable columns (the `(org_id, created_at DESC)` Phase 1 index is the substrate; FE is the missing half); skeleton matching table column widths; error-toast deduplication via `sonner`'s `toast.id`.
- **buf-lint rule for `// SECRET` comment convention** — deferred Phase 3; v1.5 polish when shared IDL governance infrastructure has ≥3 use cases.

### Supersedes

- **M1's `<ComingSoon>` stub at `/fleet`.** The fleet page is now a live listing; the `ComingSoon` component is still referenced by other pages (e.g. `/settings`) and stays in `coming-soon.tsx`.
- **The M2 `AgentTemplateCard`'s disabled "Available in v1" button + `<TooltipProvider>`.** Both are gone; the two active deploy buttons are the v1 affordance.
- **Phase 2's six `CodeUnimplemented` handler stubs** for the M4 RPCs. Replaced by real handler implementations in Phase 4.

---

## 0.6.1 — Frontend Redesign Phase 5: Dark Mode Activation + Base UI Button Fixes (2026-04-26)

Two runtime correctness bugs surfaced on first boot post-0.6.0, both blocking the Phases 1–4 redesign from rendering at all. **Fix 1 — dark mode never activated:** `globals.css` defines two token sets — `:root {}` (light, plain white) and `.dark {}` (dark pearlescent chrome). The `.dark` block is the only one that carries the pearl stops, sidebar dark tones, and dark background — but no code ever applied the `dark` class to `<html>`, so the browser silently fell through to the light theme and Phases 1–4's entire visual surface was invisible. Fix: `dark` added as a static class on the root `<html>` element in `layout.tsx`. **Fix 2 — Base UI `nativeButton` console error:** Two trigger sites — `DropdownMenuTrigger` in `app-top-bar.tsx` and `TooltipTrigger` inside `SidebarMenuButton` in `sidebar.tsx` — fired `useButton`'s `nativeButton` check on every mount. Base UI inspects the React element *type* (`Button`, `Link`) rather than the rendered DOM element (`<button>`, `<a>`), so passing a React component as the `render` prop fails the `"button"` string test even when the component renders a genuine `<button>` downstream. Fix: `nativeButton={false}` at both trigger sites. Patch version (not minor) per the 0.5.1 / 0.5.2 precedent: zero new product surface, pure correctness. Completion doc: `docs/completions/frontend-redesign-phase-5.md`.

Note on phase numbering: the 0.6.0 known-pending-work entry called Phase 5 the `design-system.md` doc rewrite. That work is now Phase 6 — the runtime correctness issues in this entry could not wait for a doc-only pass. The Phase 4 §9 hand-off items carry forward to Phase 6 unchanged, plus one addition: documenting the static-`dark`-class approach and its `next-themes` upgrade path.

### Index

- **`dark` class added to `<html>` in `layout.tsx`.** *Where:* `frontend/src/app/layout.tsx:29` — `className` string gains `dark ` as the first token (+1 string token, zero LOC delta). *Why:* Tailwind's class-based dark mode strategy (shadcn/ui's default) activates the `.dark {}` CSS block only when `dark` is present on an ancestor element. `globals.css` explicitly comments "Tuned dark-first; light mode is not a v1 product target" — the dark block is the intended runtime theme. Without the class, every `var(--background)`, `var(--sidebar)`, and pearl token resolves to the light `:root {}` values: white background, light gray sidebar, no pearl surface contrast. **The redesign was visually inert on every live route until this fix.** Adding `dark` statically is correct for v1; a future theme toggle (`next-themes`) would swap the class at runtime without touching the CSS variables themselves. The `layout.tsx` Server Component emits the class into the initial HTML shell — no flash-of-wrong-theme on page load.
- **`nativeButton={false}` on `DropdownMenuTrigger` in `app-top-bar.tsx`.** *Where:* `frontend/src/components/app-top-bar.tsx:52` — one prop added to the existing `<DropdownMenuTrigger render={<Button ...>} />` call (+1 prop, 1 LOC). *Why:* Base UI's `useButton` hook checks `typeof elementType === "button"` — a string comparison against the JSX tag. When `render={<Button>}` is passed, `elementType` is the `Button` function reference, not the literal string `"button"`, so the check fails and fires the console error even though `Button` renders a genuine `<button>` in the DOM. `nativeButton={false}` tells Base UI to inject `role="button"` + keyboard handlers itself rather than delegating to assumed native semantics. The rendered DOM element is still a real `<button>` — the prop does not downgrade accessibility, it just stops Base UI from making an assumption it cannot verify at the React element level.
- **`nativeButton={false}` on `TooltipTrigger` in `SidebarMenuButton` (`sidebar.tsx`).** *Where:* `frontend/src/components/ui/sidebar.tsx:521` — one prop added to the inline `<TooltipTrigger render={render} />` JSX (+1 prop, 1 LOC). *Why:* `SidebarMenuButton` accepts an arbitrary `render` prop and, when a `tooltip` prop is present, wraps it with `<TooltipTrigger>`. In `app-sidebar.tsx`, `render` is `<Link href={...}>` — a Next.js link that resolves to an `<a>` element, definitively not a `<button>`. `TooltipPrimitive.Trigger` defaults to `nativeButton={true}`, so every sidebar nav item with a tooltip (all four in the current nav) fired the error on mount. `nativeButton={false}` is unconditionally correct on this site: `SidebarMenuButton` is designed for arbitrary render elements; the tooltip wrapper cannot know or assume the element type in advance.

### Behavior change (known)

- **The pearlescent chrome × halftone substrate design is now visible.** All live routes render the dark token set: dark background, dark sidebar, pearl surfaces, halftone dot pattern. Phases 1–4's entire visual work becomes observable for the first time.
- **Zero console errors from Base UI `useButton` on dashboard, agents, and fleet pages.** The warning fired on every mount of `AppTopBar` (avatar dropdown trigger) and every mount of the sidebar when in tooltip-capable state.
- **No API change, no env var, no migration, no new dependency.**

### Resolves

- **0.6.0 known-pending-work item: "Phase 5 — design-system.md rewrite."** Phase 5 shipped as runtime code fixes rather than the doc rewrite; see the phase-numbering note in the opening paragraph. The design-system.md rewrite is now Phase 6.
- **0.6.0 known-pending-work item: "Visual aesthetic verdict deferred to operator review."** The verdict was deferred because the design was rendering in light mode — the pearl surfaces had no contrast against a white background. With dark mode activated, the operator-review gate is now meaningful.

### Supersedes

- **The implicit 0.6.0 assumption that `overmind start` + browser renders the redesign.** Pre-0.6.1 the browser silently fell through to the light theme. Post-0.6.1 the dark token set is applied from the initial server-rendered HTML.

---

## 0.6.0 — Frontend Redesign Phases 1–4: Pearlescent Chrome × Halftone Substrate (2026-04-26)

First product-shaped FE milestone since M2 (0.4.0) — value is visual, not functional. Replaces the shadcn-neutral OKLch grayscale identity with a **two-material design language**: a Kamino-shared monochrome **substrate** (halftone illustration + dot-grid backdrop, anchored by `frontend/public/logo.png`) and a Corellia-distinct pearlescent **chrome** (slow-drifting low-saturation OKLch gradient on heroes, primary CTAs, and focus rings). The two never overlap on the same element — body content (terminal containers, status indicators, semantic green) stays monochrome and lives between them. Plan: `docs/executing/frontend-redesign.md`. Four per-phase completion docs under `docs/completions/frontend-redesign-phase-{1..4}.md`. **Phase 5 (in-place rewrite of `docs/refs/design-system.md`) is not yet shipped** — see *Known pending work*. Minor version bump (not patch) per the 0.4.0 / 0.5.0 precedent: this is the first user-navigable visual identity for the product. Phases ladder in monotonically-increasing visibility — Phase 1 unconsumed CSS, Phase 2 unconsumed primitives, Phase 3 first visible change, Phase 4 cross-cutting chrome via one CVA edit.

### Index

- **`globals.css` gains the material vocabulary** (Phase 1, +119 / -0). Seven OKLch tokens for the pearl gradient + drift duration + fallback color; two for halftone density + opacity; one shared `@keyframes pearl-drift` driving `.pearl` / `.pearl-text` / `.pearl-ring`; `.halftone-bg` with the `::before` strategy baked in (consumers don't need their own `position: relative`); `prefers-reduced-motion` snap-to-midpoint. **Pearl is deliberately not a Tailwind color** — iridescence is a surface, not a hue; `text-pearl-300` would render dull static silver.
- **`pearl` button variant + three new primitives** (Phase 2, +182 LOC across 4 files). One CVA variant in `ui/button.tsx`; new `ui/{pearl-text,terminal-container,status-dot}.tsx`. **`<TerminalContainer>` and `<StatusDot>` ship without consumers** — available for M4's spawn-flow + fleet UI from line 1 (blueprint §11.4 stub-vs-real applied at the design-system layer). All three primitives use `React.ComponentProps<"...">` spread typing + `data-slot` attribute (the `Skeleton`/`Button` convention).
- **Logo asset wired + hero treatments** (Phase 3, ~73 LOC + 1 asset). `docs/assets/logo.png` (4.2 MB / 2048×2048) downsampled to `frontend/public/logo.png` (355 KB / 512×512) via `sips -Z 512` (`pngquant` not installed). Pearl-clipped wordmark on `/sign-in` (160px logo) + `/onboarding` ready-state (64px) + `/dashboard` H1; `halftone-bg` on all four `(app)/layout.tsx` state branches plus sign-in/onboarding `<main>`. **First visible visual change.** All routes use `next/image`; vignette uses `var(--background)` (theme-aware, per plan OQ4).
- **Focus chrome + sidebar logo + ambient backings** (Phase 4, ~16 net LOC across 7 files). One swap in `ui/button.tsx`'s base CVA — `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` → `focus-visible:pearl-ring` — cascades drifting pearl focus rings to **every** `<Button>` consumer. Sidebar's hardcoded "C" placeholder (M1 holdover) retired in favour of 28×28 `<Image src="/logo.png" />`. Coming-soon + agent-template-card icon backings flip from `bg-muted` / `bg-primary/10` to `halftone-bg`. Sign-in + onboarding submits gain `variant="pearl"` (decision 17 — pearl reserved for *commit* actions).
- **Pearl variant + pearl-ring interaction documented as accepted** (Phase 4 §2). Pearl-variant focus shows static halo only — `overflow: hidden` (gradient-spill mitigation) clips `.pearl-ring::before`'s `inset: -4px`. The variant is *already* drifting (its background); a second drifting layer on focus would be visual noise.
- **Validation matrix held clean across all four phases.** `pnpm type-check && pnpm lint && pnpm build` ✓ (10/10 static pages); `pnpm dev` boots ✓ (213ms in Phase 4); `/sign-in`, `/onboarding`, `/dashboard`, `/agents`, `/fleet` all 200; HTML probes confirm `pearl-ring`, `class="pearl ...`, `halftone-bg`, `CORELLIA` wordmark all server-render. **The pearl gradient itself is not screenshot-verified** — visual aesthetic checks deferred to operator review per plan §7.

### Behavior change (known)

- **Visible visual change at all live routes.** `/sign-in`, `/onboarding`, `/dashboard`, `/agents`, `/fleet`, `/settings` read as one product family. Sign-in is the loudest composition (logo + halftone + vignette + pearl wordmark + pearl submit + pearl focus rings); dashboard the smallest (just the H1).
- **Focus chrome is now pearl across every Button consumer** via one CVA swap. Decision 20's "every focused interactive element shimmers" is real after Phase 4.
- **No API change, no env var, no DB change, no migration.** Pure FE redesign.
- **Two new asset locations on disk.** `frontend/public/logo.png` (new, 355 KB); `docs/assets/logo.png` untouched as source-of-truth raster.

### Resolves

- **`docs/executing/frontend-redesign.md` Phases 1–4.** Phase 5 (`design-system.md` rewrite) is the only remaining checkbox.
- **Doc-vs-code drift on "brand green"** — live code already had zero green since 0.2.0; redesign formalises the monochrome reality and adds pearl as the only active register. Phase 5 will rewrite `design-system.md` §5.3 to match.
- **Plan risk-8 — "M4 reinvents primitives"** — `<TerminalContainer>` + `<StatusDot>` exist at known imports with exported types.

### Known pending work

- **Phase 5 — `design-system.md` rewrite — not yet shipped.** Plan §4 Phase 5 enumerates 13 specific edits (HSL → OKLch in §12, "New York" → "base-nova", brand-green → semantic-green-only, new §5.X / §5.Y / §29.X sections, `pearl` row in §13.4, `pearl-drift` keyframe spec in §28, anti-patterns in §37, version bump 1.0 → 2.0). When it lands, either close 0.6.0 in place or open 0.6.1.
- **Logo PNG is 355 KB, above plan risk-7's 100 KB target.** Mitigation: `.webp` sibling via `cwebp` + `next/image` format negotiation. Polish-tier, not blocker.
- **Pearl variant focus state shows static halo only.** Documented and accepted; alternative (drop `overflow-hidden`, migrate spill mitigation to `mask-image`) is more CSS for less-obvious shape.
- **Dashboard H1 weight stayed at `font-semibold`**; plan §27 said `font-bold`. Phase 5 reviewer's call.
- **M4 spawn-flow Phase 4 WIP parking is unstable.** `frontend/src/components/agents/deploy-modal.tsx` is untracked; `agent-template-card.tsx` carries an `import { DeployModal }` in its tracked file. Spawn-flow plan owner needs to commit or revert; subsequent FE work touching `agent-template-card.tsx` will compound rebase complexity.
- **Visual aesthetic verdict deferred to operator review.** Plan risk-1 ("pearl reads as Y2K Winamp") is the single subjective gate; static markup verified, drift / fallback / reduced-motion need a human eye.

### Supersedes

- **`design-system.md`'s "Brand Green is Kamino-shared" stance** (formally in Phase 5; empirically since 0.2.0). Pearl is the brand chrome; semantic green stays on status indicators only (decision 9 — `RUNNING`, `SPAWNING` use `bg-green-400 animate-pulse` unchanged).
- **`app-sidebar.tsx`'s hardcoded "C" placeholder from M1.** Replaced with the logo image.
- **`ui/button.tsx`'s shadcn-default focus-visible triple.** Now `focus-visible:pearl-ring` — applies to every variant.
- **Coming-soon + agent-template-card icon-box backings** (`bg-muted` / `bg-primary/10`). Now `halftone-bg`.

---

## 0.5.2 — Dev Tooling: Procfile Rename + Overmind Port Pinning (2026-04-26)

Polish-tier dev-tooling fix surfaced during a first-time-boot diagnosis on a fresh contributor environment. Two unrelated changes bundled because both block plain `overmind start` from working as documented in `stack.md` §7: (1) `Procfile.dev` renamed to `Procfile` so overmind's default discovery (`./Procfile`) works without `-f` or a pre-set `OVERMIND_PROCFILE`, (2) the Procfile itself rewritten to pin FE port 3000 and BE port 8080 explicitly, defending against overmind's auto-`PORT` injection that silently re-binds first-in-Procfile processes per the foreman/Heroku convention. **Supersedes 0.2.0**'s introduction of `Procfile.dev` as a Heroku-style namespace separator — Vercel ignores Procfile entirely, and Fly.io reads `fly.toml`'s `[processes]` block, so the suffix was guarding against a deploy collision that can't happen. No runtime change; no code outside repo-root tooling files; the diff is one `git mv` + one Procfile rewrite + four live-doc reflows. Patch version (not minor) per the 0.5.1 precedent for sub-milestone polish; thematically separate from 0.5.1's M3.5 product work.

### Index

- **`Procfile.dev` → `Procfile` (via `git mv`).** *Where:* repo root. The `.dev` suffix was a defensive holdover from Heroku's deploy convention (a plain `Procfile` is read by Heroku's build system as the production process declaration; separating dev orchestration prevented `next dev` and `air` from accidentally running in production). Corellia's deploy path is Vercel + Fly.io — neither reads Procfile — so the suffix was guarding against a collision that can't happen. Cost of keeping it: every `overmind start` needed `-f Procfile.dev` or a pre-set `OVERMIND_PROCFILE`, and `stack.md` §7 + `CLAUDE.md` §Common commands both already documented the bare command. **The rename resolves the doc-vs-file inconsistency in the direction the docs already assumed** — `git mv` preserves history so `git log --follow Procfile` traces back through the `.dev` era.
- **Procfile rewritten to pin both ports explicitly.** *Where:* `/Procfile` — was `web: pnpm -C frontend dev` + `api: cd backend && air`; now `web: pnpm -C frontend dev --port 3000` + `api: cd backend && PORT=8080 air`. *Why:* overmind injects `PORT=<base+stride>` into each process per foreman/Heroku convention (default base 5000, +100 per process), which without explicit overrides would shift FE→5000 and BE→5100. On Linux this would have produced "FE loads, can't reach BE, network errors throughout the catalog page" — the FE bakes `NEXT_PUBLIC_API_URL=http://localhost:8080` into its bundle at build time. On macOS Sequoia the failure is loud (`EADDRINUSE :::5000`) because the AirPlay Receiver squats on port 5000 by default, which is operationally lucky — surfaces at boot rather than at debug time. **Pinning the ports explicitly is idiomatic, not a workaround**: Next.js's `--port` flag wins over `process.env.PORT`, and `PORT=8080 air` exports the value into `air`'s child env so `internal/config.Load()` reads `8080` regardless of what overmind injects. The committed Procfile now matches what `FRONTEND_ORIGIN`, `NEXT_PUBLIC_API_URL`, and `internal/config.Config.PORT`'s default already assumed.
- **Live docs reflowed across four files.** `README.md` (×2: stack table + repo-layout tree), `CLAUDE.md` (Common commands code block at line 113), `docs/stack.md` (×3: stack table §1, layout tree §2, hour-zero scaffolding step §12), `docs/blueprints/toolchain-overview.md` (overmind tool description). Historical references in `docs/changelog.md` (the v0.2.0 entry's mention on line 879, plus the architecture-diagram update note around line 829) and `docs/archive/*` are deliberately untouched — the changelog convention "when a decision contradicts an earlier one, note the supersession in the new entry rather than editing the old one" applies. Future readers grepping `Procfile.dev` in those archived contexts will see it as the historical name and find the supersession via this entry.

### Behavior change (known)

- **`overmind start` from repo root now works without `-f Procfile.dev`.** The implicit assumption in `stack.md` §7 (which documented the bare command pre-fix) is now literal.
- **First-process `PORT` injected by overmind no longer changes FE bind port.** `pnpm -C frontend dev --port 3000` overrides whatever overmind sets — Next.js's CLI flag has higher precedence than `process.env.PORT`. Same shape on the BE: `PORT=8080 air` exports the value into `air`'s child env so `internal/config.Load()` reads it before overmind's injection takes effect.
- **No runtime change in production.** Vercel and Fly.io don't read Procfile; this entry touches dev orchestration only.
- **No new env vars, tools, or dependencies.** A pure repo-root tooling fix.

### Resolves

- **First-time-boot friction on macOS.** Any contributor with AirPlay Receiver enabled (default on Sequoia) would have hit `EADDRINUSE :::5000` on their first `overmind start`. Pinning the FE port removes a class-of-friction, not a single instance.
- **Doc-vs-file inconsistency in the local-dev story.** Pre-0.5.2 the docs said `overmind start`; the file required `-f Procfile.dev`. Post-0.5.2 they match — `overmind start` is literal, not aspirational.

### Supersedes

- **0.2.0's introduction of `Procfile.dev`** (changelog line 879 — "Monorepo workspace plumbing: root `pnpm-workspace.yaml` + `package.json` + `Procfile.dev`"). The Heroku-style namespace separator was defensive against a deploy convention Corellia never adopted. Plain `Procfile` is the canonical name from 0.5.2 onward.
- **The implicit pre-0.5.2 contract that `overmind start` finds `Procfile.dev`.** It didn't — operators had to pass `-f Procfile.dev` or pre-set `OVERMIND_PROCFILE`. `stack.md` §7's bare `overmind start` was the desired-not-actual command pre-0.5.2; from 0.5.2 it's literal.
- **The pre-0.5.2 Procfile shape** (`web: pnpm -C frontend dev` + `api: cd backend && air`). The new shape with explicit `--port 3000` and `PORT=8080` is the canonical form; any future Procfile edit should preserve the explicit-port-pinning pattern.

---

## 0.5.1 — M3.5: Deploy Target Resolver Indirection (Phases 1–4) (2026-04-26)

Structural follow-up to M3's `internal/deploy/` package — **no behavior change**. Where 0.5.0 made the `DeployTarget` interface concrete (one Fly-backed `FlyDeployTarget`, two `NotImplemented` stubs, a kind-keyed `map[string]DeployTarget` exposed on `httpsrv.Deps`), 0.5.1 inserts one indirection layer between handlers and that map: a new `deploy.Resolver` interface with a today-implementation (`StaticResolver`) that wraps the same env-var-bootstrapped registry. Behavior is byte-identical at boot — same flaps client construction, same three targets registered, same `kinds=aws,fly,local` boot log — but the field on `httpsrv.Deps` is now narrower (`deploy.Resolver` instead of `map[string]DeployTarget`), the constructor accepts a struct instead of two positional strings (`FlyCredentials`), and the env vars that bootstrap it carry a `// TODO(v1.5):` retirement breadcrumb. Patch version (not minor) per the 0.3.0 → 0.3.1 M1-hardening precedent: this is structural pre-payment toward v1.5's user-configurable deploy targets, not a product feature. Plan: `docs/executing/deploy-target-resolver.md` (locked ahead of execution). Four per-phase completion docs under `docs/completions/deploy-target-resolver-phase-{1..4}.md`.

The whole milestone is +120 / -12 across 5 files (one new file, four edits) and lands in monotonically-decreasing diff sizes — Phase 1 +20/-5, Phase 2 +88/-1, Phase 3 +2/-2, Phase 4 +9/-3. Each phase's diff size measures how much of the architectural pre-payment was already in place when it landed; Phase 3's two-line diff is the load-bearing evidence that Phases 1 and 2 did their jobs. The eventual v1.5 swap (`StaticResolver` → `DBResolver`) is now a one-line type change in `cmd/api/main.go` plus deletion of the two annotated `Config` fields — zero handler updates, because no handler reaches into the underlying map.

### Index

- **`deploy.FlyCredentials struct{APIToken, OrgSlug string}` replaces the positional `(token, orgSlug)` constructor pair** (Phase 1). `NewFlyDeployTarget(ctx, FlyCredentials{...})` is the new shape; both call sites (`cmd/api/main.go:50`, `cmd/smoke-deploy/main.go:49`) updated to named-field struct literals. **The struct is shape, not capability** — exactly two fields, byte-identical to the previous arguments — but named-field literal syntax makes future additive growth (DefaultRegion, scoped tokens, MaxConcurrentSpawns) cost zero at existing call sites. No deprecation period, no shim function: a single-commit constructor break across three files. Plan-time pre-work assumed two grep hits but execution found three (`cmd/smoke-deploy` was added in M3 Phase 7, after the resolver plan was drafted); plan §risk-register entry 4 had explicitly anticipated this and the third caller was absorbed inline rather than spinning out a Phase 1.5.
- **New `deploy.Resolver` interface and `StaticResolver` implementation** (Phase 2). `Resolver` is single-method: `For(ctx context.Context, kind string) (DeployTarget, error)`. The ctx argument is unused by `StaticResolver` but required by v1.5's `DBResolver` for the row fetch + decryption call. **The interface deliberately omits `Kinds()` / `List()`** — adding a list method would be premature interface widening for a single boot-time observability call; the `slog.Info("deploy targets initialised", "kinds", "aws,fly,local", ...)` line keeps reading from the underlying map by design (Phase 3 carve-out). New file `internal/deploy/resolver.go` (63 LOC) holds the interface, the `StaticResolver` struct, the constructor, the `For` method, and a compile-time assertion (`var _ Resolver = (*StaticResolver)(nil)`) — the same pattern `target_test.go` already uses for `DeployTarget` conformance.
- **New `deploy.ErrTargetNotConfigured` sentinel, distinct from `ErrNotImplemented`** (Phase 2). Two sentinels, two semantics: `ErrNotImplemented` (in `target.go`, M3) means "this target type exists as a stub but its methods aren't built yet" — the blueprint §11.4 stub-vs-real distinction for `LocalDeployTarget` / `AWSDeployTarget`. `ErrTargetNotConfigured` (in `resolver.go`, M3.5) means "the resolver has no entry for this kind" — a different operator failure with a different M4 spawn-handler response. **Conflating them would give the spawn handler one ambiguous error to log and react to.** Test cases pin the contract via `errors.Is(err, ErrTargetNotConfigured)` rather than equality, so a future wrapping via `fmt.Errorf("...%w", ErrTargetNotConfigured)` won't break the test.
- **`httpsrv.Deps.DeployTargets` narrowed from `map[string]deploy.DeployTarget` to `deploy.Resolver`** (Phase 3). Single-line diff in `internal/httpsrv/server.go`'s `Deps` struct — field name and ordering preserved. **No handler updates needed because no handler reads the field yet** (M3 Phase 6's "wire the field, don't consume it" discipline holds); M4's spawn handler will be the first reader and will consume `resolver.For(ctx, kind)`, never `deps.DeployTargets[kind]`. The pre-work grep (`grep -rn 'DeployTargets\[' backend/internal/httpsrv/`) returned zero hits at the start of every phase 1–4, confirming the discipline survived end to end.
- **`cmd/api/main.go` constructs `*StaticResolver` at boot, between the existing map construction and `httpsrv.New(...)`** (Phase 3). One new line — `deployResolver := deploy.NewStaticResolver(deployTargets)` — sits *after* the `slog.Info("deploy targets initialised", ...)` so the boot sequence reads top-to-bottom as "build map → log map's contents → wrap map in resolver → pass resolver to handlers." The `keysOf(deployTargets)` slog still operates on the map, not the resolver, preserving Phase 8's `sort.Strings`-driven deterministic `kinds=aws,fly,local` runbook output. **The map outlives its registry role only as a transient scaffold for the slog line** — a deliberate non-orthogonality that costs one extra local-variable lifetime and avoids premature interface widening.
- **`Config.FlyAPIToken` and `FlyOrgSlug` carry a six-line block comment plus a `// TODO(v1.5):` retirement breadcrumb** (Phase 4). Comment-only edit at `internal/config/config.go:31-37` — no field rename, no env-tag change, no consumer update. **The version-tagged TODO is structurally different from a generic TODO**: scoped to a specific milestone (the v1.5 `DBResolver` swap), self-superseding (the deletion of the TODO and the deletion of the fields happen in the same commit), greppable as the canonical v1.5 punch list (`grep -rn 'TODO(v1.5)' backend/` returns this single line, and will return the v1.5 to-do list as more phases use the convention). Establishes the version-tagged-TODO convention in the codebase; future provisional state should use the same form.
- **Compile-time assertion as defense-in-depth across three sites.** The `var _ Resolver = (*StaticResolver)(nil)` line in `resolver.go` (Phase 2) is what makes the `httpsrv.Deps.DeployTargets deploy.Resolver` field at server.go:21 (Phase 3) accept a `*StaticResolver` value with no explicit conversion at the `cmd/api/main.go` callsite. **The three sites form a contract pin** that catches signature drift on `Resolver.For` at the most useful diagnostic location: changes to the interface fail at the assertion; changes to the implementation fail at the assertion; changes to the field type fail at the callsite. Same pattern M3's `target_test.go` established for `DeployTarget` (Phase 5 of M3); this milestone applies it to one additional interface.
- **Validation matrix.** `cd backend && go vet ./... && go build ./... && go test ./...` all clean — `internal/deploy` flipped from 24 sub-tests (M3 Phase 8) to 26 sub-tests (Phase 2's two new resolver cases); `internal/agents` and `internal/users` cached at their respective M2 / 0.2.5 baselines; both binaries (`cmd/api` and `cmd/smoke-deploy`) build end-to-end. `grep -rn 'DeployTargets\[' backend/` returns zero hits — the field-narrowing didn't surface any latent direct-map consumers. `grep -rn 'NewFlyDeployTarget(ctx, cfg\.' backend/` returns zero hits — the old positional constructor form is fully retired. Boot-time runtime smoke (`cd backend && air`) deferred to runbook per the M3 precedent that runtime checks are deploy-confidence gates, not merge gates.
- **Plan-as-built drift on Go API code: zero this milestone.** All five plan-prescribed Go signature changes (struct definition, interface declaration, two method bodies, two callsite swaps) landed exactly as drafted — no SDK-version drift, no fly-go API surprises, no signature reshape in execution. **The plan's structural decisions and call-site prescriptions both survived intact** because the Go surface this plan touches is internal — no third-party SDK godoc to drift against. Contrast with M3 where 3/7 phases needed signature touch-up against `fly-go` v0.5.0; the resolver plan's all-internal scope was structurally easier to land on the prescribed shape.

### Behavior change (known)

- **Zero behavior change at boot or at any HTTP route.** The boot log line is identical to M3 Phase 8 (`deploy targets initialised kinds=aws,fly,local fly_org=<slug>`). The HTTP surface is identical to M3 (`POST /corellia.v1.UsersService/GetCurrentUser`, `POST /corellia.v1.OrganizationsService/CreateOrganization`, `POST /corellia.v1.AgentsService/ListAgentTemplates`). The runtime smoke (`cmd/smoke-deploy` against real Fly) is unchanged because `cmd/smoke-deploy` doesn't go through the resolver — it constructs `*deploy.FlyDeployTarget` directly via `NewFlyDeployTarget(ctx, deploy.FlyCredentials{...})`, the same shape Phase 1 established.
- **Constructor signature break for `NewFlyDeployTarget` (Phase 1, in scope by design).** Any external caller still on the positional `(ctx, token, orgSlug)` form needs the one-line struct-literal update; no shim exists. Internally only two callers existed (`cmd/api/main.go`, `cmd/smoke-deploy/main.go`); both updated. **No external callers exist** because `internal/deploy/` is a Go-internal package — the break is contained to this repo.
- **`httpsrv.Deps.DeployTargets` field type narrowing (Phase 3, in scope by design).** Any external constructor of `httpsrv.Deps` (none in this repo today) that supplied a raw map would fail to compile. Internal callers: only `cmd/api/main.go`'s `httpsrv.New(httpsrv.Deps{...})` literal, which Phase 3 updated.
- **Live wire surface gained zero new routes.** Same as M3: no handler reads the resolver yet. M4 is the first reader.
- **Five new artefacts committed**: `backend/internal/deploy/resolver.go` (new), `backend/internal/deploy/target_test.go` (extended), `backend/internal/deploy/fly.go` (Phase 1 — `FlyCredentials` struct + constructor body), `backend/cmd/api/main.go` (Phase 1 callsite + Phase 3 resolver wiring), `backend/cmd/smoke-deploy/main.go` (Phase 1 callsite), `backend/internal/httpsrv/server.go` (Phase 3 field narrowing), `backend/internal/config/config.go` (Phase 4 annotation). Plus the four per-phase completion docs under `docs/completions/deploy-target-resolver-phase-{1..4}.md`.

### Resolves

- **`docs/executing/deploy-target-resolver.md` (M3.5 plan).** All four planned phases shipped (Phases 1–4) plus the validation-and-changelog phase (Phase 5, this entry). Plan moves to `docs/archive/` at next housekeeping (consistent with M3's plan-archival cadence after Phase 8).
- **Blueprint §11.1 — "no Fly outside `FlyDeployTarget`" — preserved unchanged.** `internal/deploy/` remains the only package importing `fly-go`; the resolver layer is purely Go-internal indirection above the deploy package, not a leak of Fly types into wider scope.
- **Blueprint §11.4 — "deferred features stub as real interfaces" — extended one level up.** M3 applied it to `DeployTarget` (`LocalDeployTarget` and `AWSDeployTarget` returning `ErrNotImplemented`); M3.5 applies it to `Resolver` itself. `StaticResolver` is the v1 real implementation; `DBResolver` is the v1.5 real implementation. Both will satisfy the same interface; the swap is one constructor line in `cmd/api/main.go`.
- **M4 (spawn flow) is unblocked structurally for resolver-based callsite design.** M4's plan can adopt `resolver.For(ctx, kind)` from line 1 instead of `deps.DeployTargets[kind]`, with no map-shaped intermediate layer to refactor away later.

### Known pending work

- **Operator runtime walkthrough.** `cd backend && air` boot smoke confirms `kinds=aws,fly,local` exactly as M3 Phase 8 + Phase 3 attest. The boot smoke is structurally guaranteed to pass because the only changes (constructor body shape, field type, comment) cannot affect runtime behavior. Static checks complete pre-merge; runtime check pre-deploy per the M3 precedent.
- **v1.5 user-config plan placeholder.** When v1.5 is drafted, the swap is: replace `deploy.NewStaticResolver(deployTargets)` in `cmd/api/main.go` with `deploy.NewDBResolver(queries, decryptor)`; delete `Config.FlyAPIToken` + `FlyOrgSlug`; delete the matching `.env.example` lines; remove the `// TODO(v1.5):` line + block comment. The `DBResolver` struct will likely live in `internal/deploy/db_resolver.go` and read from a `deploy_targets` table that doesn't yet exist (deferred to v1.5 schema work). **No interface change needed** if v1.5 stays kind-keyed; an additive `ForTarget(ctx, id uuid.UUID)` method or full interface replacement is the v1.5 plan's call.
- **No automated test exercises the boot-time wiring.** Phase 3's verification rests on the compiler + the existing 26 sub-tests; no test constructs an `httpsrv.Deps` literal. Acceptable at v1 scale; the runtime smoke is the integration test.
- **Compile-time assertion location inconsistency** — `var _ Resolver = (*StaticResolver)(nil)` lives in `resolver.go`, but `var _ DeployTarget = (*X)(nil)` lives in `target_test.go`. Same compile-time effect, different locations. Not a defect today; flagged as a candidate for unification when next touching either file. Trivial cleanup if/when it matters.
- **The plan-reference path (`docs/executing/deploy-target-resolver.md §1`) in `config.go`'s Phase 4 annotation will dangle when the plan moves to `docs/archive/`.** Mitigation: update the path in the same commit that archives the plan — a one-line edit. Same precedent M3 followed for its plan-archive moves.

### Supersedes

- **M3's `httpsrv.Deps.DeployTargets map[string]deploy.DeployTarget`** (Phase 3, M3 Phase 6's wiring decision). Field name and ordering preserved; only the type narrows. Any future reference to the M3 field type (in completion docs, plan docs, or code review comments) should treat M3 Phase 6's "kind-keyed registry" framing as the *bootstrap* shape and the resolver as the *consumer-facing* shape.
- **M3's `NewFlyDeployTarget(ctx, token, orgSlug string)` positional constructor** (Phase 1, M3 Phase 5's first concrete shape). Same constructor name, same package, struct-literal arguments. The M3 Phase 5 completion doc's signature notes are now historical — the post-Phase-1 form is what live code uses.
- **The implicit assumption (M3 Phase 6) that the boot wiring would be "wire the map, M4 will be the first reader."** Post-M3.5, the more accurate framing is "wire the resolver, M4 will be the first reader, the map exists only as a transient scaffold for the slog line." M4's spawn handler is the next consumer in either framing; the difference is purely structural.

---

## 0.5.0 — M3: Hermes Adapter Image + Fly Account Wiring (Phases 1–7) + Phase 8 Post-Review Hardening (2026-04-25 → 2026-04-26)

Second product milestone. Where 0.4.0 (M2) crossed scaffolding → product, 0.5.0 crosses *infrastructure abstraction* → real: blueprint §11.1's `DeployTarget` interface gets its first concrete implementation calling Fly's API at runtime; blueprint §3's harness contract gets its first compliant member (Hermes via the v1 hand-written adapter); blueprint §11.2's digest-pinning rule lands at the database layer for *both* `harness_adapters` digest columns. Seven phases shipped vertical-slice — adapter source → registry publish → operator smoke → DB backfill → Go package → binary wiring → Go-level smoke — followed by an off-plan Phase 8 hardening pass that closed two load-bearing gaps (`internal/deploy/` had zero functional tests; `Spawn` orphaned Fly apps on partial failure) and four polish items. The milestone exercises *all five* blueprint §11 rules non-trivially (§11.1 fly-isolation; §11.2 digest-pinning at app + DB layer; §11.3 `CORELLIA_*` env-var translation; §11.4 deferred features as real interfaces; §11.5 no upstream forks via the entrypoint shim). Plan: `docs/executing/hermes-adapter-and-fly-wiring.md`. Eight per-phase completion docs under `docs/completions/hermes-adapter-and-fly-wiring-phase-{1..8}.md`. Quality gate ended at 9/10 after Phase 8.

### Index

- **`adapters/hermes/` at repo root** — alongside `backend/`, `frontend/`, `shared/`. Five files: `Dockerfile` (29 LOC, `FROM docker.io/nousresearch/hermes-agent@sha256:d4ee57f2…` — bit-identical to M2's seeded `upstream_image_digest`), `entrypoint.sh` (109 LOC POSIX `/bin/sh` wrapper translating `CORELLIA_*` → Hermes-native names then `exec`'ing upstream), `README.md`, `.dockerignore`, `smoke.sh` (110 LOC operator harness). The Dockerfile *quotes* the database — migrations write the digest, the Dockerfile follows in the same PR.
- **Multi-arch image published at GHCR.** `ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cb…` (linux/amd64 + linux/arm64; tag `v2026-04-26-0ece98b` + `:latest`; public; anonymous pull verified after `docker logout ghcr.io`). **The manifest-list digest is non-deterministic across rebuilds** because BuildKit bakes SLSA-style provenance attestations (with build-time timestamps) into the image index. Per-arch digests are deterministic; the wrapper digest is not. The DB pins the manifest-list (operational identity); per-arch digests are the substantive identity.
- **Fly substrate pull-rehearsal succeeded** with throwaway `corellia-rehearsal-46efd119` in `iad` (~50s end-to-end). Two CLI quirks documented for Phase 3: `fly logs --no-tail` waits for at least one batch even when none exist (hangs on empty streams); the doubled-digest quirk where Fly's CLI resolves manifest-list → per-arch and *appends* without stripping (`<image>@sha256:X@sha256:X`). Both are CLI-only — Phase 5's Go path via `fly-go` + `flaps` doesn't hit either.
- **`harness_adapters.adapter_image_ref` backfilled + tightened** (migration `20260426120000_adapter_image_ref_backfill.sql`, 56 LOC, single transaction). `NOT NULL` + `CHECK (adapter_image_ref LIKE '%@sha256:%')` named `adapter_image_ref_digest_pinned`. Both rejection paths verified empirically (tag-form UPDATE + NULL UPDATE). **First time §11.2 is enforced on real data for *both* digest columns.** Defence-in-depth across DB + Go layer.
- **`AdapterImageRef *string` → `string` type-flip from the migration.** `emit_pointers_for_null_types: true` produced `*string` while nullable; post-`NOT NULL`, sqlc flips to bare `string`. Phase 5's `Spawn` sees the non-pointer type from day one — no nil-check, no `*ref` deref. **Type-driven design at the database layer**: tighten the schema to the strongest invariant, the generated types eliminate entire classes of error-handling at the call site for free.
- **`internal/deploy/` package shipped** — second cross-cutting abstraction after `db.Querier`. Three files: `target.go` (interface + types + `ErrNotImplemented`), `fly.go` (concrete `FlyDeployTarget`), `stubs.go` (`LocalDeployTarget` + `AWSDeployTarget` returning `ErrNotImplemented` from every method). `DeployTarget` interface has five methods (`Kind`/`Spawn`/`Stop`/`Destroy`/`Health`); `Logs` deferred to v1.5. **The two stubs are §11.4 encoded as Go code** — real types, not commented-out scaffolding.
- **`fly-go` SDK consolidated to flaps-only.** Plan held both `fly` (GraphQL) and `flaps`; as-built collapsed to flaps-only because `flaps.CreateAppRequest{Org: <slug>}` accepts the slug directly (no GraphQL ID resolution), `flaps.DeleteApp` is the symmetric counterpart, and one transport means one credential plumbing path. The plan's `fly-go` API surface had drifted from v0.5.0 reality in three places (constructor shape, `SetSecrets` location, `flaps.NewClientOpts.AppName`). **Plans that prescribe Go code at the call-site level age fast against a third-party SDK; plans that prescribe interface shapes age slowly.**
- **`adapters.Service.UpdateImageRef`** — symmetric write-side of M2's `Get`. New SQL query co-located in M2's `harness_adapters.sql`; domain method follows the established `pgx.ErrNoRows → ErrNotFound` redacted-error pattern from `users.UpdateName` (0.2.5) and `organizations.UpdateName` (0.3.0). Three services, one architectural pattern. No caller in M3; M4 (or an admin tool) writes after the next adapter rebuild.
- **`cmd/api/main.go` wires three deploy targets behind `map[string]deploy.DeployTarget` keyed by `Kind()`** — self-describing registry, not a hand-maintained string table. New boot log line `slog.Info("deploy targets initialised", "kinds", "aws,fly,local", "fly_org", <slug>)` between `jwks initialised` and `listening addr=:8080`: three lines, three subsystems confirmed. `cfg.FlyAPIToken` + `cfg.FlyOrgSlug` finally have a runtime reader (required-since-0.1.0). `grep -rn DeployTargets backend/internal/httpsrv/` returns exactly the field declaration — no half-finished plumbing; M4 is the first reader.
- **Third Fly-touching path: `cmd/smoke-deploy/`** (108 LOC, 11.9MB binary). The codebase had two pre-Phase-7 (shell via `flyctl`; `cmd/api`'s embedded server). The third — SDK-direct via Phase 5's wrapper — exercises `internal/deploy/` in isolation from the web server's Connect/DB/auth substrate. Three-path structure makes failure-mode triangulation possible: shell ↔ `cmd/smoke-deploy` disagreement isolates `fly.go`'s wrapper code vs `flyctl`'s CLI path.
- **Phase 8 closed two load-bearing gaps + four polish items.** (1) `target_test.go` rewrote 11 → 110 LOC with **24 functional sub-tests** across `TestValidateImageRef` (7 cases — including the `contains_sha256_but_no_@` canary against §11.2 relaxation), `TestMapFlyState` (10 cases — `unknown-future-state` policy pin: fail closed), `TestAppNameFor`, `TestParseExternalRef`. (2) `Spawn` rewritten with named-return + `defer` rollback covering every error path between `CreateApp` and `Launch`; cleanup uses fresh `context.Background()` so caller-cancellation that triggered the rollback doesn't *also* cancel the rollback. (3) `Health` errors on `>1 machine` (blueprint §8 invariant: one AgentInstance = one Fly app = one Fly machine, self-validating both ways). (4) `keysOf` sorts via `sort.Strings` so the boot log emits `kinds=aws,fly,local` deterministically — runbook contract. (5) `_ = adaptersSvc` keepalive deleted. (6) `// SAFETY:` carve-out in `cmd/smoke-deploy` documents the §11.8 deviation at the call site (smoke-only env vars side-step `internal/config/` because folding them into `Config` would put smoke plumbing on every production process's fail-fast-at-boot path).
- **Hermes runtime-contract gap with §3.1.** Hermes 0.x is **CLI-shaped, not server-shaped** — no built-in `/health`, no `/chat`. Phase 7's smoke can't probe `/health` (replaced with `state == started` poll). v1.5 follow-up: sidecar HTTP wrapper exposing `POST /chat` forwarding to `hermes chat -q "..."`. Reaction is *not* to retrofit Hermes (forbidden by §11.5) nor to abandon the contract — ship the env-var translation half (independently useful), queue the sidecar. §11.4 stance applied at the harness-contract level. Flagged in `adapters/hermes/README.md` §"Known limitations".
- **`CORELLIA_MODEL_NAME` is observability-only at the adapter today.** Hermes 0.x has no env-var hook for model selection (deprecated `LLM_MODEL` was explicitly removed). Default `anthropic/claude-opus-4.6` always wins. **Real product gap**: M4's catalog model picker is visually doing something but runtime always uses upstream default. v1.5 follow-up needs `entrypoint.sh` to write a `config.yaml` fragment or pass `--model` via parsed CLI. M4 plan needs to address this explicitly.
- **Validation matrix.** `internal/deploy` flipped non-existent → `[no tests to run]` (Phases 5–7) → `ok ... 0.165s` running 24 sub-tests (Phase 8). `internal/agents`/`internal/users` cached at M2/0.2.5 baselines, no regression. FE `type-check` + `lint` clean (no FE changes). Two binaries build end-to-end: `cmd/api` (27.7MB), `cmd/smoke-deploy` (11.9MB).

### Behavior change (known)

- **`Spawn` no longer leaves orphan Fly apps on partial failure.** Pre-Phase-8 callers needed to call `Destroy` themselves after a `Spawn` error; post-Phase-8 the cleanup happens inside `Spawn` before the error returns. Operationally: any Fly account with pre-Phase-8 orphans needs one-time manual cleanup via `flyctl apps destroy <name>`.
- **`Health` returns an error for apps with >1 machine.** Pre-existing 2-machine apps surface as `(HealthUnknown, error)` rather than silently reporting machine[0]'s state.
- **`cmd/api`'s boot log emits `kinds=aws,fly,local` deterministically.** Anyone who pinned the *exact* string `"fly,local,aws"` (the pre-sort accidental default) needs to update; substring `"fly"` matchers are unaffected.
- **Live wire surface gained zero new routes.** Phase 6 wired `httpsrv.Deps.DeployTargets` but no handler reads it in M3; M4 is the first reader.
- **First production caller of any Fly-touching code path.** Every `cmd/api` boot now constructs a real `*flaps.Client`. Note: `flaps.NewWithOptions` does *not* make a network call on construction — first failure point on a stale token is `Spawn`/`Stop`/`Destroy`/`Health`, not boot.

### Resolves

- **`docs/executing/hermes-adapter-and-fly-wiring.md` (M3 plan).** Third milestone of four. All seven planned phases shipped + off-plan Phase 8.
- **Blueprint §3 first compliant member.** Configuration sub-contract (§3.2 — `CORELLIA_*` env vars) end-to-end exercised; runtime sub-contract (§3.1) is *not* exercised because Hermes is CLI-shaped (v1.5 sidecar work).
- **Blueprint §11.2 enforcement on the *adapter* digest column.** Pre-M3 was Go-level convention only; post-M3 has a CHECK matching `upstream_image_digest`'s M2 enforcement.
- **Blueprint §11.4 first encoded as type-system-enforced.** `LocalDeployTarget` + `AWSDeployTarget` exist as real interface implementations; compile-time assertions (Phase 5) + 24 functional tests (Phase 8) make the contract enforceable.
- **`config.Config.FlyAPIToken` + `FlyOrgSlug` get their first runtime reader.** Required-since-0.1.0 placeholders that the binary loaded but never used.
- **M4 (spawn flow) unblocked structurally.** Deploy primitive is rollback-safe + tested; DB has `NOT NULL` + digest-pinning CHECK on `adapter_image_ref`; registry exposed on `httpsrv.Deps`; `adapters.Service.UpdateImageRef` ready for the operator-driven digest bump path.

### Known pending work

- **Operator runtime walkthrough** before non-localhost deploy: (1) `cd backend && air` boot smoke confirming the three log lines in order; (2) `./adapters/hermes/smoke.sh`; (3) `cd backend && go run ./cmd/smoke-deploy`. Acceptance: both smokes green, both clean up Fly apps, no leaks per `fly apps list | grep corellia`.
- **Hermes runtime-contract gap (§3.1).** v1.5 sidecar HTTP wrapper exposing `POST /chat` + own `/health`. Separate plan because it touches harness-contract design.
- **`CORELLIA_MODEL_NAME` is observability-only.** M4 plan must address explicitly — model-name plumbing through the harness is the v1 product gap.
- **No real-Fly integration test for `Spawn` rollback.** Pure-function tests cover the helpers; the rollback path needs either a real Fly token + injectable failure or a `*flaps.Client` mock. Operator-time verification documented in the runbook.
- **GHCR visibility-toggle is UI-only for user packages.** Re-creation defaults back to private. `kaminocorp` org migration makes the flip scriptable.
- **Manifest-list digest non-determinism across rebuilds.** Rebuilds without source changes shouldn't re-trigger a Phase 4 migration; the DB digest is the canonical artefact. If a rebuild *is* needed, it's a real change and a new migration is appropriate.
- **Four sites hold the digest string** — Phase 4 migration, `smoke.sh`, `cmd/smoke-deploy`'s `defaultImageRef`, Phase 2's audit block. A future bump needs coordinated edits; `tools/check-digest-coherence.sh` is a 10-LOC follow-up.
- **Cosign / Sigstore provenance verification** on both digests. v2 hardening: `cosign verify-attestation` against Nous's published key + `cosign sign` on our adapter + a `signature_verified_at` column. Today's pin is "bit-identical to what we captured," not "signed by Nous's key."
- **Post-review hardening playbook doc** if Phase-8-style passes repeat at M4/M5. v1.5 candidate.
- **No CI hooks** for `bash -n`, `goose up && down && up` round-trip, or `sqlc diff`. Each is one-line; bundle when CI is set up post-v1.
- **`appNameFor` is collision-resistant but not collision-free** (8 hex chars, birthday at ~65k agents/org). v1/v2 sizing is comfortably below the threshold; widen to 12 hex chars or salt-and-retry past ~10k agents.

### Supersedes

- **Phase 6's `_ = adaptersSvc` keepalive.** Deleted by Phase 8. M4 re-introduces import + construction when the first handler wires it.
- **Phase 6's "M4 will land the first test exercising this code path"** for `validateImageRef` / `mapFlyState` / `appNameFor`. Resolved earlier than scheduled by Phase 8.
- **Phase 7's implicit §11.8 carve-out for `cmd/smoke-deploy`.** Phase 8's `// SAFETY:` block makes the carve-out auditable; the carve-out itself is unchanged.
- **Phase 6's `kinds=fly,local,aws` runbook reference.** Phase 8's `sort.Strings` makes the log emit `kinds=aws,fly,local` deterministically; this entry updates the snippet rather than editing Phase 6's completion doc.
- **The plan's literal Go snippets across Phases 4, 5, 7.** As-built diverged in three phases (`*string → string` implications, `fly-go` SDK shapes, `cmd/smoke-deploy` constructor). Per supersession-not-edit, the plan stays as-written and this changelog records the divergences. **The plan got the architecture right in every case; only the call-site Go diverged.**

---

## 0.4.0 — M2: Agent Catalog (`HarnessAdapter` + `AgentTemplate` + `/agents` page) (2026-04-25)

First product milestone. The codebase stops being scaffolding and becomes product: a real schema (`harness_adapters` + `agent_templates`), a Hermes seed pinned by upstream image digest, the first product RPC (`AgentsService.ListAgentTemplates`), and the first product UI page (`/agents`). Six phases shipped vertical-slice — schema → sqlc → proto + TS → backend domain + handler → frontend page → tests. Three blueprint §11 rules land enforced for the first time on real data: §11.2 (digest-pinning) as a Postgres CHECK *and* a Go convention; §11.4 ("deferred features stub as real interfaces") as the live-card vs. sneak-peek-card split; §11.6 (no Supabase outside `auth/` + `db/`) survives because the new packages touch `db.Queries` only. The version bump from 0.3.x to 0.4.x is the semantic signal: 0.4.0 is the first feature an end user can navigate to. Plan: `docs/executing/agent-catalog.md` (37 locked decisions). Six per-phase completion docs under `docs/completions/agent-catalog-phase-{1..6}-completion.md`.

### Index

- **Migration `20260425170000_agent_catalog.sql`** — both tables + two seed `INSERT`s in one goose transaction. `harness_adapters` carries `CHECK (upstream_image_digest LIKE 'sha256:%')` + `CHECK (source IN ('hand_written', 'generated'))`. Down block strict-LIFO with `IF EXISTS`. Idempotent: `ON CONFLICT (harness_name) DO NOTHING` for the harness; `WHERE NOT EXISTS (...)` subquery for the template (composite-key idempotency without a unique index). **First time §11.2 is enforced on real data** — Go-level validation can be bypassed by anyone with `psql`; a CHECK cannot.
- **Hermes digest captured via `crane digest ghcr.io/nousresearch/hermes-agent:<version>`** (manifest-list digest, not `:latest`). Audit-comment block above the seed records `resolved_tag`, `digest`, `captured_at`. Three governance moves: starting from a version tag means we know which release we're pinning; manifest-list digest is the right granularity for a multi-arch orchestrator; the SQL comment makes the pin auditable.
- **Schema includes v2 plumbing without v2 callers.** `agent_templates.created_by_user_id UUID NULL REFERENCES users(id)` (NULL = system seed) and `default_config JSONB NOT NULL DEFAULT '{}'::jsonb`. Three columns deliberately deferred (decisions 6 + 9): `harness_adapters.manifest_yaml`, `harness_adapters.validation_report` (land with v2's adapter-analysis pipeline), `agent_templates.org_id` (lands with user-defined templates). `adapter_image_ref` is `TEXT NULL` in M2 — M3 backfills + tightens to `NOT NULL`; an empty-string placeholder would fail §11.2 in spirit.
- **SQL queries (new, narrow projection).** `queries/agent_templates.sql` defines `ListAgentTemplates :many` projecting exactly `id, name, description, default_config` — sqlc's row type physically cannot leak `harness_adapter_id` / `created_by_user_id` / timestamps. **Column projection is API design, not optimization.** `queries/harness_adapters.sql` defines `GetHarnessAdapterByID :one` with no M2 caller — exists so M3's `UpdateAdapterImageRef` extends rather than scaffolds the package.
- **Proto (new) `shared/proto/corellia/v1/agents.proto`.** One service, one RPC (`ListAgentTemplates`), three messages. `AgentTemplate` carries `id`, `name`, `description` only — not `default_config` (M4's deploy modal), not `harness_name` (per blueprint §2 the user never sees the word "harness"). Clean to add later, painful to retract. `ListAgentTemplatesRequest {}` empty by design — no filtering, no pagination, no per-org scoping (decision 10).
- **Two new backend domain packages.** `internal/adapters/` (one method, `Get(ctx, id)`, no runtime caller — M3 wires `UpdateImageRef`); `internal/agents/` (one method, `ListAgentTemplates`). Both mirror `users/` + `organizations/`: private query interface, sentinel `ErrNotFound`, typed-row → proto conversion. `agents.ErrNotFound` is declared but unused — pre-paid for M4's `GetAgentTemplate(id)` consumer named in the plan.
- **`internal/agents/service.go`'s `make([]*…, 0, len(rows))` is load-bearing.** Without it, sqlc's `nil` zero-rows return marshals to JSON `null` over Connect's default codec; FE's `templates.length` would crash. The non-nil empty slice marshals to `[]`. Pinned by `TestListAgentTemplates_Empty` whose assertion message names the wire-shape contract explicitly so any "cleanup" to `var out []...` produces a directed test failure rather than a silent crash on first empty-catalog deploy.
- **Transport: `httpsrv/agents_handler.go`** — implements `corelliav1connect.AgentsServiceHandler`; `agentsErrToConnect` switch with `ErrNotFound` → `CodeNotFound` and a `slog.Error` + redacted `Internal` default arm (0.2.5's post-review pattern; pgx errors don't leak across the wire). Method body 7 lines, well under §11.9's <30. `httpsrv.Deps` gains `AgentsHandler` between `OrganizationsHandler` and `AllowedOrigin`; mount goes inside the existing auth-middleware group (catalog is authenticated). `adapters.NewService` is *deliberately not* wired — M3 wires it.
- **Structural typing collapses the wiring.** `*db.Queries` satisfies all four per-service interfaces (`userQueries`, `orgQueries`, `templateQueries`, `adapterQueries`) without anyone editing it. Adding a fifth service is one `service.go` + a constructor call in `main.go`; no central registry.
- **Frontend `/agents` page** — `"use client"`, four-state union (`loading | ready | empty | error`), `useEffect`-driven fetch. Render branches: skeleton cards / live-grid + sneak-peek section / sneak-peek section only / centered error card with sneak peeks suppressed (sneak peeks complement a working catalog, not a fallback for a broken one). Replaces M1's 18-LOC `<ComingSoon>` stub. Sibling `layout.tsx` carries `metadata.title` because the page is `"use client"` (recurring App Router pattern, simplified by 0.3.1's `metadata.title.template` to bare `"Agents"`).
- **`<AgentTemplateCard>` (live)** — Bot icon in `bg-primary/10`, disabled `Deploy` button + tooltip "Available in v1". Tooltip wrapper-span uses base-ui's `render={<span tabIndex={0} />}` — *not* Radix's `<TooltipTrigger asChild>` which the plan was written against. M1 already documented this convention; M2 extends it.
- **`<ComingSoonHarnessCard>` (sneak-peek)** — same shell as the live card but **no `CardFooter`, no `Button`, no `Tooltip`** (decision 25's "nothing to click means nothing to fake" — §11.4 compliance). The `<Badge variant="secondary">Coming Soon</Badge>` sits in the header where a real-time status indicator would go in an M4 fleet card. Anyone adding a click target has to add a whole new section, a far higher bar than re-enabling a disabled button.
- **Static sneak-peek manifest `lib/agents/coming-soon.ts`** — three FE-only entries (LangGraph, CrewAI, AutoGen). Not a DB seed: a placeholder row would either NULL the `harness_adapter_id` FK or violate the `sha256:%` CHECK. When a sneak-peek graduates, the migration shape is the M2 Hermes seed; the static-array entry deletes in the same PR.
- **One new shadcn primitive: `badge.tsx`.** `base-nova` registry includes Badge — unlike `form` which 0.3.0 documented as silently skipped from the same registry. Future shadcn-add invocations need post-add file-existence verification.
- **`<TooltipProvider>` mounted at *page scope*, not globally.** Page-scope is the broadest legitimate scope today — other chrome routes don't use tooltips. Promote to `(app)/layout.tsx` when a second consumer arrives (Settings has obvious candidates).
- **Tests.** `internal/agents/service_test.go` — two cases (`_HappyPath`, `_Empty`) via external test package + `fakeQueries` satisfying the private interface (same shape as `users/service_test.go`). `internal/adapters/` deliberately untested (decision 29 — testing a getter that nothing reads is busywork).
- **Validation matrix.** Backend `go vet ./... && go build ./... && go test ./...` clean — `internal/agents` flipped from `[no test files]` to `ok ... 0.333s`. Frontend `type-check && lint && build` clean — eight static routes prerendered. `/agents` is `○ Static` even though `"use client"` because the data fetch lives in `useEffect`, post-hydration.
- **Cleanup pass.** Zero `TODO/FIXME/XXX`, zero `console.*`, zero blank-identifier import keepalives across all M2 surfaces.

### Behavior change (known)

- **Live wire surface gained one route:** `POST /corellia.v1.AgentsService/ListAgentTemplates`, mounted inside the auth-middleware group. Anonymous calls return 401.
- **`/agents` is now a real product page** — Hermes card (live, DB-backed) + three sneak-peek cards. M1's placeholder is gone *for this route only*; `/fleet` and `/settings` retain it. The dashboard's "Spawn your first agent" CTA now lands on a working catalog.
- **`<TooltipProvider>` mounted somewhere for the first time** (page-scoped). If a future route adds tooltips and forgets its own provider, base-ui tooltips silently fail to position — hoist this provider when that happens.

### Resolves

- **`docs/plans/post-0.2.6-roadmap.md` §M2** — second milestone of four. Plan moves from `executing/` to `archive/` once the runtime walkthrough completes.
- **0.3.0's broken "Spawn your first agent" CTA destination** — dashboard's primary card linked to `/agents` since M1; clicking it landed on the placeholder. Now lands on a real catalog.
- **Blueprint §11.2 first enforced on real data.** CHECK constraint at the database layer + one row of seeded data exercising it. Future migrations cannot backslide without explicit constraint-violation.
- **Blueprint §9 first product schema.** First two of v1's tables land. `agent_instances`, `secrets`, `deploy_targets` deferred to M4 ("no table exists before its first reader" — roadmap §1).

### Known pending work

- **Operator runtime walkthrough** (Phase 6's three deferred checks). Runbook captured in `docs/completions/agent-catalog-phase-6-completion.md`. Run before first non-localhost deploy.
- **Plan migration `executing/agent-catalog.md` → `archive/`** once the runtime walkthrough completes.
- **No DB-error propagation test for `agents.Service`.** M4's `GetAgentTemplate(id)` lands the first test exercising `agentsErrToConnect`'s default arm.
- **No real-DB integration test for the catalog query.** Lands at M4 alongside the spawn-flow's testcontainers-go fixture.
- **No FE component tests** — FE test infrastructure isn't set up in v1 (CLAUDE.md: "No Playwright / E2E in v1").
- **Sneak-peek copy is placeholder-quality.** Worth a copy-pass when `multiagent-deployment-frameworks.md` (or its replacement) lands.
- **`adapter_image_ref` nullability** — M3 backfills + tightens to `NOT NULL`.
- **Cosign / Sigstore provenance verification** on the pinned digest. v2 hardening per the plan's risk register §6: when Nous publishes signatures, add `cosign verify` to pre-work + a `signature_verified_at` column. Today's pin is "bit-identical to what we captured," not "signed by Nous's key."
- **`<TooltipProvider>` page-scoped, not global.** Promote to `(app)/layout.tsx` when a second consumer arrives.

### Supersedes

- **0.3.0's `<ComingSoon>` placeholder at `/agents`.** `/fleet` and `/settings` retain their M1 shape; M4 replaces `/fleet`'s.
- **Phase 6 completion doc's "0.3.0" version reference** — the doc was queued under 0.3.0 before M1 took that slot. Per the supersession-not-edit convention from 0.2.6 Phase 5, the doc is left as the historical record; this entry is the supersession that lands the work under 0.4.0.

---

## 0.3.1 — M1 Hardening: Provider Memoization, Title Template, `middleware` → `proxy` (2026-04-25)

Targeted polish pass on 0.3.0's M1 deliverables, written off the back of a thorough post-milestone code-quality review. Six small fixes — the largest is the Next 16 `middleware.ts` → `proxy.ts` migration that retires a deprecation warning surfaced (and deferred) in every M1 phase doc. No behavior change visible to the end user; the fixes close real but quiet defects (provider re-render storm) and bring the codebase into line with documented project conventions (forced-redirect uses `replace`, not `push`). Entirely frontend; zero backend, schema, or proto deltas. `pnpm -C frontend type-check && lint && build` all green; build prerendered all eight static routes with no warnings (the `middleware → proxy` deprecation line is gone — confirms the migration landed cleanly).

### Index

- **`<UserProvider>` value memoized.** `frontend/src/app/(app)/layout.tsx`. The previous shape `<UserProvider value={{ user: state.user, org: state.org }}>` allocated a new object literal on every layout render, breaking referential equality and forcing every `useUser()` consumer to re-render whenever the layout did. Today the only consumer is the dashboard, so the bug is invisible — but it would surface the moment the top bar or sidebar migrates onto context (already flagged as future work in 0.3.0's "Known pending work"). Fix extracts a `<ReadyChrome>` sub-component so `useMemo` can wrap the value; props identity is now stable across re-renders.
- **`router.push` → `router.replace` in sign-in.** `frontend/src/app/sign-in/page.tsx:26`. Sign-in is a one-shot forced navigation — pressing back after success returns to a sign-in form the user has already passed. Every other forced navigation in the codebase (wizard's three branches, layout's auth/onboarding gate, top-bar sign-out) uses `replace` per the convention recorded in `docs/completions/onboarding-wizard-phase-2.md` §"Why `router.replace` (not `router.push`)". Sign-in was the lone outlier; one-character fix brings it into line.
- **Defensive throw in `lib/supabase/client.ts`.** Phase 6 fixed the `/sign-in` prerender bug by moving the `createClient()` *call site* into `onSubmit`; the underlying trap (`process.env.NEXT_PUBLIC_SUPABASE_URL!` non-null assertion) was preserved in the helper. If anyone in M2+ reintroduces a module-scope or component-scope `createClient()` in a `"use client"` page, prerender would silently fail again. Replaced both `!` assertions with an explicit env check that throws a contextful message naming the likely cause ("you called createClient() at module or component scope in a 'use client' page — move it into an event handler or useEffect"). Closes the bug *class*, not just the symptom.
- **`metadata.title.template` consolidation.** Set `title: { default: "Corellia", template: "%s — Corellia" }` on `app/layout.tsx`; collapsed five children to bare names. `agents/page.tsx` `"Agents — Corellia"` → `"Agents"`; same shape for `fleet`, `settings`, `dashboard/layout.tsx`. The wizard's `onboarding/layout.tsx` keeps its full string via `title: { absolute: "Welcome to Corellia" }` (overrides the template — the brand is in the value already, so `"Welcome — Corellia"` would read worse). Net: one root edit + five one-line simplifications, cognitive surface drops because new pages don't have to remember the suffix. Logged as a polish-pass candidate in `docs/completions/onboarding-wizard-phase-4.md` §Findings.
- **`middleware.ts` → `proxy.ts` migration.** Next 16 deprecated the `middleware` file convention in favour of `proxy`. The deprecation warning surfaced in every M1 build (Phases 1, 6) and was deferred each time. Fix is mechanical: `git mv frontend/src/middleware.ts frontend/src/proxy.ts` plus renaming the exported function from `middleware` to `proxy`. Same matcher config, same `updateSession(request)` body. The `git mv` preserves blame history. Build output now reads `ƒ Proxy (Middleware)` cleanly with no deprecation line — that single absent line is the verification. **Note for Bun/Vercel deploys:** the convention rename is a Next 16 feature; older Next versions don't recognise `proxy.ts`. We're already on 16.2.4 (per the build banner), so this is forward-compatible.
- **Validation.** `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build` all green after `rm -rf frontend/.next` (cache invalidation needed for the file rename to register). Build prerendered eight static routes (`/`, `/_not-found`, `/agents`, `/dashboard`, `/fleet`, `/onboarding`, `/settings`, `/sign-in`) with no warnings.

### Why each fix

#### Why memoize the provider value via a sub-component, not inline

`useMemo` is a hook — it can only run inside a function-component body. The layout's render branches (`loading`, `not-provisioned`, `error`, `ready`) early-return; placing `useMemo` at the top of the layout would run it on every render including the redirect/error paths where `user`/`org` aren't yet defined. Extracting the ready-state render to a `<ReadyChrome>` sub-component scopes the hook to the only branch where the inputs exist, stays clean against React's rules-of-hooks ESLint rule, and keeps the parent layout's branch logic flat. Net diff: +13 lines (the sub-component declaration), -3 (the inlined render block).

#### Why `replace` everywhere, not just sign-in

The codebase's documented rule (Phase 2 doc): *`replace` for forced navigation that shouldn't be reversible by back-button; `push` for user-initiated nav.* Sign-in is the canonical forced one-shot — once the redirect lands on `/dashboard`, there's no legitimate "I want to go back to the sign-in form" reason. The previous `push` was almost certainly leftover from the original 0.2.0 scaffold (the convention was tightened in Phase 2). Aligning the entry-point of the auth flow with the rest of it is consistency-as-defect-fix.

#### Why a throw in `client.ts`, not a typed Result

The helper has exactly one consumer family: components that need a Supabase browser client at user-interaction time. Threading a `Result<Client, ConfigError>` through every call site would be an order of magnitude more code for a failure mode that is purely a *configuration* error (env vars missing) — the right action is "crash loudly with a useful message," not "let every caller branch on it." Same fail-loud rationale that drove the JWKS verifier's `NoErrorReturnFirstHTTPReq=false` decision in 0.2.6 and `useUser()`'s out-of-provider throw in 0.3.0 Phase 5. Three load-bearing pieces of FE/BE infrastructure now share the convention: misconfiguration is a programming error, not a runtime branch.

#### Why `title: { absolute }` for the wizard, not the template default

The wizard's title is `"Welcome to Corellia"`. With the template applied, the bare title `"Welcome"` would render as `"Welcome — Corellia"` — grammatically valid but reads as a tagline rather than a route name. The `{ absolute: ... }` form bypasses the template specifically for this one route. Cost: one extra metadata key. Benefit: the full sentence "Welcome to Corellia" reads naturally to a first-time signed-in user, who is the entire audience for this title.

#### Why the `proxy` rename can't be skipped indefinitely

Two reasons beyond the obvious "deprecation warnings are noise":

1. **Next.js's `proxy` API is the forward path.** The convention rename is a precursor to capabilities that don't exist on the legacy `middleware` API (the deprecation message links to `nextjs.org/docs/messages/middleware-to-proxy`, which itself points at the new feature surface). Migrating now means we adopt new capabilities cleanly when we want them; deferring means a forced migration plus a feature adoption in one shot.
2. **The deferral was already two milestones long.** Phase 1's findings logged it; Phase 6's findings re-logged it; this entry retires it. Three log entries in two months is the threshold at which "deferred polish" becomes "ignored debt."

The migration's blast radius is genuinely small (two-line file, no consumers because Next.js auto-discovers the export), so doing it now is the cheap call.

### Behavior change

- **None visible.** Browser tabs render identically (`Agents — Corellia`, `Dashboard — Corellia`, etc. — same strings, just produced by template rather than per-page literals; verified by reading the build's prerender output). Sign-in success still lands on `/dashboard` (now via `replace` — the back-button-after-sign-in regression is the only observable difference, and it's a fix not a regression). Build no longer emits the `middleware → proxy` deprecation warning.
- **Internal:** `useUser()` consumers no longer re-render on every layout re-render. Today's only consumer (the dashboard) was unaffected because the layout doesn't re-render after the initial fetch resolves; the fix is debt prevention for M2+ when more components consume the context.

### Resolves

- **0.3.0 "Known pending work" → `metadata.title.template` consolidation.** Resolved as described.
- **0.3.0 / 0.1.x deprecation backlog → `middleware.ts` deprecation warning.** Resolved as described.
- **Provider re-render perf concern surfaced in the M1 post-milestone code review.** Resolved as described — `useMemo` wraps the value, sub-component extraction keeps the rules-of-hooks contract clean.
- **`router.push` → `router.replace` inconsistency in sign-in flow.** Resolved as described.
- **`lib/supabase/client.ts` defensive-throw item from Phase 6 findings.** Resolved as described.

### Known pending work

- **`<ThemeProvider>` mount + dark-mode toggle.** Still deferred. `next-themes` is in deps; CSS variables for both themes already exist in `globals.css`; `sonner.tsx` already calls `useTheme()` and degrades cleanly to light mode without a provider. Out of M1-hardening scope; separate plan when dark-mode lands.
- **`useUser()` setter / refresh path.** When a future settings page edits `user.name` or `org.name` without a redirect, the cached context will be stale until the next full layout remount. No current consumer hits this, so the fix is genuinely premature today; flagged for whichever M-milestone introduces a non-redirecting edit affordance (likely the polish-pass settings page).
- **Backend transactional atomicity for the wizard's `Promise.all` updates.** Half-success is recoverable (Phase 2 doc explains why) but ideally the two updates land in one transaction. Backend-side concern; out of FE scope.
- **Operator-side E2E sign-off on M1.** Still deferred per the Phase 6 runbook. Acceptable while we don't have prod users — the seven scenarios are FE-only and any failure would be reproducible at any time. Worth running before the first non-localhost deploy.
- **Stale `auth-*` doc reorg + uncommitted M2 (agent-catalog) scaffolding** still on master per 0.3.0's "Known pending work" — unchanged by this entry, surfaces in the next commit's `git status`.

### Supersedes

- **0.3.0 §"Known pending work" → `metadata.title.template` consolidation.** Marked as a polish-pass candidate; landed here.
- **0.2.6 §"Known pending work" → `middleware.ts` deprecation warning.** Logged twice across M1 phase docs; landed here.
- **0.2.0 frontend scaffold's `router.push` after sign-in** (the `replace`-vs-`push` rule was tightened in 0.3.0 Phase 2 but not retroactively applied to sign-in; applied here).

---

## 0.3.0 — M1: Onboarding Wizard + Dashboard Shell (2026-04-25)

First milestone of the post-0.2.6 roadmap (`docs/plans/post-0.2.6-roadmap.md` §M1). Closes the visible UX gap between "amber 'not provisioned' panel" and "blank email-only dashboard," and puts the navigation chrome in place that the rest of v1 plugs into. Entirely a frontend pass — zero backend, schema, or proto changes. The 0.2.5/0.2.6 RPCs (`UpdateCurrentUserName`, `UpdateOrganizationName`, `GetOrganization`) are now consumed by real FE callers; previously they shipped without one. Plan: `docs/executing/onboarding-wizard.md`. Six per-phase completion docs under `docs/completions/onboarding-wizard-phase-{1..6}.md`.

### Index

- **Six shadcn primitives added** — `sidebar`, `avatar`, `dropdown-menu`, `separator`, `skeleton`, plus transitive `sheet` + `tooltip` and the `useIsMobile` hook. `form` was silently skipped by the `base-nova` registry; wizard uses raw `useForm` + `register` matching the existing `sign-in/page.tsx` style.
- **`useIsMobile` rewritten** to canonical `React.useSyncExternalStore` shape — replaces the shadcn-shipped `useEffect` + synchronous `setState` pattern that trips the project's `react-hooks/set-state-in-effect` lint rule under React 19. Side-benefit: closes a latent SSR hydration mismatch (`useState<boolean | undefined>(undefined)` rendered as `false` on the server then re-rendered with the real value).
- **Root layout polish** — `metadata.title` `"Create Next App"` → `"Corellia"`, `metadata.description` `"Generated by create next app"` → `"Control plane for AI agents."`, `<Toaster richColors closeButton />` mounted at root so toasts work above the route group boundary (sign-in + onboarding need it as much as chrome routes do).
- **`/onboarding` route** (Phase 2) — standalone, chrome-less wizard. State machine `loading | ready | not-provisioned | error` plus a `submitting` flag inside `ready`. Sequential fetch (`getCurrentUser` → `getOrganization`, forced by data dependency — org ID comes from user row). `react-hook-form` + `zodResolver` with `.trim().min(1).max(80)` on both fields. Org name pre-filled from the trigger-generated default (`alice's Workspace`); user name empty (no good default). Submit fires `Promise.all([updateCurrentUserName, updateOrganizationName])`; on success, success toast + `router.replace('/dashboard')`; on `ConnectError`, error toast + form re-enabled. Already-named callers redirected to `/dashboard`; signed-out to `/sign-in`. Sibling `layout.tsx` owns `metadata.title = "Welcome to Corellia"` because the page is `"use client"`.
- **`(app)/` route group** (Phase 3) — Next.js parenthesised segment for "shared layout, no shared URL prefix." `dashboard/page.tsx` moved here via `git mv`; URL `/dashboard` unchanged. Chrome layout owns the auth/onboarding gate redirecting unprovisioned-name users to `/onboarding`, plus a four-state union (`loading | ready | not-provisioned | error`) mirroring the wizard.
- **`<AppSidebar>`** — wraps shadcn's `Sidebar` primitive. Four nav items (Dashboard / Agents / Fleet / Settings), active state via `usePathname()` plus `startsWith('${href}/')` prefix check (so future `/agents/<id>` lights up the parent). Non-ready items get `<SidebarMenuBadge>Soon</SidebarMenuBadge>` + `aria-disabled="true"`; the link is still navigable, the destination card corroborates "soon". `<SidebarMenuButton render={<Link>...</Link>} />` instead of Radix's `asChild` — `base-nova` is on `@base-ui/react` which uses a `useRender` hook + `render` prop. Same pattern as `<DropdownMenuTrigger render={<Button>}>` for the avatar trigger and `<Button render={<Link>}>` for dashboard CTAs.
- **`<AppTopBar>`** — `<SidebarTrigger>` (Cmd/Ctrl+B) + workspace name + user-menu avatar dropdown. Initials via `splitOn(/[\s.]+/)` so `Alice Smith` → `AS` and `alice.smith` → `AS`; falls back to first char of email; capped at two. Sign-out moved here from the dashboard.
- **Three placeholder pages** (Phase 4) — `/agents`, `/fleet`, `/settings` consume one reusable `<ComingSoon>`. Server components (no `"use client"`), each exporting `metadata.title = "<Name> — Corellia"` directly. ETA copy distinguishes "Available in v1" (Agents, Fleet — core M2/M4) from "Polish pass" (Settings — non-blocking).
- **`UserContext` + `useUser()`** (Phase 5) — `src/lib/api/user-context.tsx`. `<UserProvider>` wraps the entire `<SidebarProvider>` subtree on the layout's ready branch (hoisted broad so future sidebar/top-bar consumers can read user data without re-hoisting). `useUser()` throws if consumed outside the provider — fail-loud is correct because the contract is unconditional. Dashboard now reads `const { user } = useUser()` instead of fetching independently — one round-trip per cold mount of `/dashboard` instead of two.
- **Dashboard refresh** (Phase 5) — heading-with-subhead (`Welcome back, <FirstName>.` + one-line description) above a 2-card grid: primary `Spawn your first agent` → `/agents`, secondary `Fleet at a glance` → `/fleet`. First-name via `(user.name ?? "").trim().split(/\s+/)[0]`; falls through to `"Welcome back."` for empty names. Previous "Signed in as `<email>`" copy gone — chrome's avatar + email-in-dropdown covers the question.
- **Pre-existing `/sign-in` prerender failure fixed** (Phase 6) — `lib/supabase/client.ts`'s `createClient()` was called at component-scope inside `app/sign-in/page.tsx`, so Next.js's static-export pass evaluated it during prerender and threw on missing `NEXT_PUBLIC_SUPABASE_URL`. Moved into `onSubmit` so it only runs at user-interaction time. Found in Phase 1, fixed in Phase 6 — let `pnpm -C frontend build` pass cleanly for the first time this milestone.
- **Validation.** `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build` all green at end-of-milestone. Build prerendered all eight static routes (`/`, `/_not-found`, `/agents`, `/dashboard`, `/fleet`, `/onboarding`, `/settings`, `/sign-in`). Manual seven-scenario E2E (full sign-up → onboarding → chrome navigation → sign-out loop) deferred to operator with a runbook in `docs/completions/onboarding-wizard-phase-6.md`.

### Behavior change (known)

- **Frontend looks like a product.** Sign in → onboarding wizard (if first time) → chrome with sidebar + workspace name + user menu. Three placeholder destinations corroborate the "this is the shape of v1" framing.
- **One round-trip per cold mount of any chrome route**, not one per page-component-mount. Dashboard previously fetched `getCurrentUser` independently; now layout fetches once and dispenses via context.
- **Wizard at `/onboarding` is on the auto-flow.** Users with `public.users.name IS NULL` (post-trigger but pre-naming) are auto-redirected from any chrome route to the wizard. After successful submit, `router.replace('/dashboard')` lands them on the chrome with their name in the avatar + workspace in the top bar.
- **Browser tabs distinguish by route.** `Welcome to Corellia`, `Dashboard — Corellia`, `Agents — Corellia`, etc. Root metadata still `Corellia` for any non-app route.
- **Sign-in route prerenders cleanly** for the first time in this codebase. Closes a build-time gotcha pre-dating 0.2.0.

### Resolves

- **0.2.5 / 0.2.6 "Known pending work" → FE caller for `UpdateCurrentUserName` + `UpdateOrganizationName`.** Both RPCs shipped without a UI consumer — this milestone is the consumer. Wizard fires both in parallel on submit; verified end-to-end in `pnpm -C frontend build` + the seven-scenario E2E runbook (deferred to operator).
- **`docs/plans/post-0.2.6-roadmap.md` §M1.** First milestone of four. Plan moved from `docs/plans/onboarding-wizard.md` to `docs/executing/onboarding-wizard.md` at start of work; will move to `docs/executed/` (or be archived) when operator-side E2E completes.

### Known pending work

- **Operator-side E2E verification.** Seven scenarios in the Phase 6 completion doc. Run before first non-localhost deploy. Low-risk if mismatched (FE-only — no DB writes can corrupt anything because schema is unchanged) but high-confidence-payoff if all pass.
- **`metadata.title.template` consolidation.** Three pages declare `"<Name> — Corellia"` directly; wizard declares `"Welcome to Corellia"`; dashboard declares `"Dashboard — Corellia"`. Setting `title: { default: "Corellia", template: "%s — Corellia" }` on root layout would let each page declare just `"Agents"` etc. One-line root edit, three-line simplification across pages. Polish-pass candidate.
- **`<ThemeProvider>` mount + dark-mode toggle.** `next-themes` in deps; CSS variables for both themes already exist in `globals.css`. Out of M1 scope; separate plan when the time comes.
- **`AppTopBar` migration to `useUser()`.** Currently takes three props from the layout. Trivial when the top bar grows (workspace switcher, theme toggle, role-gated nav). One-liner.
- **Edit affordance for workspace name from the chrome.** Top bar shows `state.org.name` as static text; click does nothing. Will live in `/settings` per follow-up plan.
- **`middleware.ts` deprecation warning.** Next 16's build emits `The "middleware" file convention is deprecated. Please use "proxy" instead.` Mechanical migration; bundle alongside any other middleware-touching work.
- **Pre-existing uncommitted state on master.** Doc reorg moving `auth-*` completion files from `docs/completions/` to `docs/archive/`, plus untracked `docs/executing/agent-catalog.md` (M2 draft). Surfaced during Phase 1's `git stash` build-failure investigation. None of it conflicts with M1; flagged so it shows up cleanly in next commit's `git status` rather than mistaken for M1 output.

### Supersedes

- **0.2.0 "Frontend Scaffolding"** — dashboard's "Signed in as `<email>`" placeholder copy is replaced by the named-user welcome + 2-card grid. The four-state union shape from 0.2.5 is preserved (now lives in the layout, not per-page). The amber "not provisioned" panel is no longer per-page; it lives in the chrome layout for every route under `(app)/`.

---

## 0.2.6 — Auth Migration: HS256 Shared Secret → ES256 / JWKS (2026-04-25)

Migrated backend JWT validation from the legacy HS256 / `SUPABASE_JWT_SECRET` shared-secret path scaffolded in 0.1.0 to the asymmetric ES256 / JWKS path Supabase issues today. Backend now fetches Supabase's JWKS once at boot from `$SUPABASE_URL/auth/v1/.well-known/jwks.json`, caches it in memory, refreshes hourly in the background plus immediately on any unknown `kid` (rate-limited to one refetch per 5 min), and validates incoming tokens offline against the cached P-256 public keys. `SUPABASE_JWT_SECRET` removed from `config.Config`, `.env.example`, `backend/.env`. Frontend unaffected — access token is opaque to the client. Plan: `docs/executing/auth-es256-migration.md`. Six per-phase completion docs under `docs/completions/auth-es256-migration-phase{1..6}-completion.md`.

### Index

- **New dependency.** `github.com/MicahParks/keyfunc/v3@v3.8.0` direct (canonical JWKS adapter for `golang-jwt/jwt/v5`); `github.com/MicahParks/jwkset@v0.11.0` + `golang.org/x/time@v0.9.0` indirect.
- **New file.** `backend/internal/auth/jwks.go` — `JWKSVerifier` wrapper over keyfunc's refreshable cache; `NewJWKSVerifier(ctx, jwksURL)` performs initial fetch with `NoErrorReturnFirstHTTPReq=false` (fail-loud) + 10s `HTTPTimeout` and binds the refresh goroutine to `ctx`'s lifetime.
- **Rewritten file.** `backend/internal/auth/middleware.go` — `Middleware(verifier *JWKSVerifier)` replaces `Middleware(jwtSecret string)`; ECDSA P-256 verification via `verifier.Keyfunc()`; explicit `jwt.WithValidMethods([]string{"ES256"})` whitelist closes the algorithm-confusion attack class. `AuthClaims` shape preserved (`AuthUserID uuid.UUID`, `Email string`); `FromContext` retains `*AuthClaims` pointer return so `users.Service` doesn't ripple.
- **Removed.** `Config.SupabaseJWTSecret` field, the `SUPABASE_JWT_SECRET=` line in `.env.example` + `backend/.env`, and the corresponding rows in `docs/stack.md` §8 + `CLAUDE.md` §Environment.
- **Wiring.** `httpsrv.Deps` gains `AuthVerifier *auth.JWKSVerifier` (alongside `Config`, `UsersHandler`, `OrganizationsHandler`, `AllowedOrigin` — runtime infra grouped, parsed config kept pure); `main.go` derives `jwksURL` via `strings.TrimRight(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"`, constructs the verifier eagerly, `slog.Error`+`os.Exit(1)` on failure, emits one `slog.Info("jwks initialised", "url", jwksURL)` boot breadcrumb.
- **Doc updates.** `CLAUDE.md` §Environment + Backend-layout bullet, `docs/stack.md` §5 + §8, `docs/archive/backend-scaffolding.md` §7 (supersession blockquote). Historical docs (this changelog, completion docs, plan, archived prose) deliberately untouched.
- **Validation.** Phases 6a + 6c executed: boot smoke clean (`jwks initialised` + `listening`, ~300µs apart); algorithm-confusion forge (HS256-with-public-key) rejected at 401 by the live server. Phase 6b (interactive FE sign-in) deferred to operator with a written runbook in the Phase 6 completion doc.
- **Independent assessment.** 9/10 — solid, mergeable. Single deduction: zero Go-level test coverage of the security-critical auth path (Phase 7 follow-up; the manual Python forge in 6c proves the defence empirically but isn't CI-reproducible).
- **Stale-path docs cleanup, bundled in.** Five live-doc references to the pre-archive `docs/backend-scaffolding.md` path now point at `docs/archive/backend-scaffolding.md`: `CLAUDE.md` lines 9, 17, 44; `docs/stack.md` line 9; `docs/frontend-scaffolding.md` line 17. Flagged in the Phase 5 completion doc as out-of-scope; folded in here so the entry doesn't leave broken navigation.

### Behavior change (known)

**Breaking config change.** Operators + CI environments that previously set `SUPABASE_JWT_SECRET` must remove it; nothing reads the var any more. Go binary no longer panics at config-load if `SUPABASE_JWT_SECRET` is unset (would have, before — `caarlos0/env` honored `required`). Conversely, the binary now fails loudly at *boot* (after config-load, before listening) if `SUPABASE_URL` is missing or unreachable, with `auth: initial JWKS fetch from <url>: <err>` — same fail-fast posture, different gate.

**No request-path behavior change after a successful boot.** Valid Supabase access token validates and the request flows through to the domain layer; invalid returns 401. Wire-level error strings (`"missing bearer token"`, `"invalid token"`, `"invalid sub claim"`) unchanged. `AuthClaims` shape unchanged. Downstream services see no difference.

### Supersedes

- **0.1.0 "Auth middleware (HS256)."** The "shared secret + HMAC signature check" model is wholly retired. Rationale upgrades from "Supabase issues HS256 tokens, validate offline with the secret" to "Supabase issues ES256 tokens, validate offline with the cached public key — server-side rotations propagate within an hour without a backend restart." Post-migration posture is strictly stronger: asymmetric crypto removes the attack surface where a leak of `SUPABASE_JWT_SECRET` from operator infrastructure would have let an attacker mint arbitrary tokens — there is no symmetric secret to leak now.

### Known pending work

- **JWKS integration test (Phase 7).** Not implemented. Phase 6c's Python forge proves the defence empirically against the live server but isn't CI-reproducible. ~60–90 lines: ECDSA P-256 key-pair fixture (`crypto/ecdsa`), `httptest.Server` serving a synthetic JWKS, three table-driven cases — valid ES256 passes, HS256-signed-with-public-key rejected, expired rejected. Single deduction in the post-migration code review (9/10); land before opening to untrusted users.
- **Boot-smoke as a `cmd/api` integration test.** Build the binary, run with a mock Supabase JWKS server, assert the `jwks initialised` log line. Catches regressions at PR time. Out of scope for v1.
- **Structured logging / metrics around JWKS refresh cycles.** Currently uses keyfunc's default logger (writes to `slog.Default`'s `ErrorContext` on refresh failures only). For oncall visibility, add explicit `slog.Info` on successful refresh + a counter on refetch-rate-limit hits.
- **Key-rotation runbook.** A one-pager describing what an oncall engineer should expect when Supabase rotates server-side (TL;DR: nothing — but the runbook documents cache TTL + unknown-kid refetch behavior so the first time it happens isn't a debug session).
- **Explicit `SUPABASE_JWKS_URL` override env var.** Currently derived from `SUPABASE_URL`. If a future use case needs a non-canonical JWKS (e.g. a CI test fixture), add an optional `config.Config` field + `cmp.Or`-style fallback to the derived URL.
- **Graceful shutdown.** Pre-existing — `http.ListenAndServe` + `context.Background()` gives an abrupt exit on SIGTERM, so the keyfunc refresh goroutine never gets a clean cancellation. Not a regression from this migration; flag for a small follow-up (`signal.NotifyContext` + `srv.Shutdown(ctx)` + plumb the cancellable context to `NewJWKSVerifier`).

### Resolves

- **0.2.0 "Local bring-up unblocked once Supabase project provisioned."** With the project on ES256 (which it has been for some time — the HS256 path was structurally incompatible from day one of the new project), this migration was the missing piece for sign-in to work end-to-end against the current Supabase project. Joins 0.2.5's user-provisioning to deliver the `stack.md` §12 hour-5 milestone.

---

## 0.2.5 — Auth User Provisioning (Phases 1–4 + Post-Review Hardening) (2026-04-25)

Closes the last gap between the 0.2.0 scaffolded pipeline and a real end-to-end sign-in: a Postgres trigger pair on `auth.users` atomically creating `public.organizations` + `public.users` on signup and tearing them down on delete; the FE↔BE contract + sqlc surface for `users` (expanded) and `organizations` (new); the domain + transport + frontend layers consuming them; sentinel-based handler-boundary error mapping so the FE can distinguish "bad token" from "valid token, no provisioning row"; a discriminated-union dashboard state machine for the four resulting render states; unit tests for the service's error branching. Resolves the **0.2.1 "Behavior change"** gap (`pgx.ErrNoRows` surfaced as `Unauthenticated`) and **0.2.1 "Known pending work" → Error mapping in `users_handler.go`** + **First-admin bootstrap path**. Unblocks `stack.md` §12 hour-5 and blueprint §10 product code.

Plan: `docs/executing/auth-user-provisioning.md`. Five completion docs are the durable per-phase record: `docs/completions/auth-user-provisioning-phase-{1,2,3,4}.md` + `auth-user-provisioning-post-review-hardening.md`. This entry is the cross-phase summary.

### Index

- **Migration applied:** `backend/migrations/20260424140000_auth_user_provisioning.sql` — three atomic changes (`name TEXT NULL` column on `public.users`, `on_auth_user_created` trigger, `on_auth_user_deleted` trigger). Both functions `SECURITY DEFINER` + `SET search_path = public, pg_temp`.
- **Proto:** `users.proto` gains `UpdateCurrentUserName` + `optional string name = 5` on `User`; `organizations.proto` (new — `OrganizationsService` with `GetOrganization` + `UpdateOrganizationName`).
- **SQL queries:** `users.sql` gains `CreateUser` + `UpdateUserName` (`GetUserByAuthID` retained); `organizations.sql` (new — `GetOrganizationByID` + `UpdateOrganizationName`).
- **Generated code regenerated:** Go (`backend/internal/gen/corellia/v1/{users.pb.go, organizations.pb.go}` + `corelliav1connect/{users.connect.go, organizations.connect.go}`); Go DB layer (`backend/internal/db/{users.sql.go, organizations.sql.go, querier.go, models.go}`); TS (`frontend/src/gen/corellia/v1/{users_pb.ts, organizations_pb.ts}`). All committed.
- **Domain:** `users/service.go` rewritten — `ErrUnauthenticated` + `ErrNotProvisioned` sentinels, private `userQueries` interface (2 methods, not full 5-method `Querier`), `loadCurrentUser` helper, new `UpdateCurrentUserName` + `CallerOrgID`, `Name` mapped through to proto. `organizations/service.go` (new) — `ErrForbidden` + `ErrNotFound` sentinels, `orgQueries` + `userLookup` interfaces, `GetOrganization` + `UpdateOrganizationName`, both gated by an equality `authorize` check.
- **Transport:** `users_handler.go` rewritten with `toConnectErr` switch; `organizations_handler.go` (new) with `orgErrToConnect` switch; both <30 LOC. `server.go` mounts both inside the auth-middleware `r.Group(...)`.
- **`cmd/api/main.go`:** instantiates `organizations.Service` with `(queries, usersSvc)` (`*users.Service` satisfies `userLookup` structurally via `CallerOrgID`).
- **`auth/middleware.go`:** new exported `ContextWithClaims(ctx, AuthClaims) context.Context` — inverse of `FromContext`, closes over the same opaque `ctxKey{}`. Lets tests + admin-path handlers synthesise claims contexts without HTTP.
- **FE client:** `frontend/src/lib/api/client.ts` exposes `organizations: createConnectClient(OrganizationsService, transport)` alongside `users`.
- **FE dashboard:** `dashboard/page.tsx` rewritten — four-state discriminated union (`loading | ready | not-provisioned | error`); `ConnectError.code === Code.PermissionDenied` branches to a dedicated amber "not provisioned" panel.
- **Tests:** `users/service_test.go` (new) — three cases (`NotProvisioned`, `HappyPath`, `NoClaims`) using a `fakeQueries` that satisfies the private `userQueries` via structural typing.
- **Post-review hardening:** `default:` arm in both handler error switches now `slog.Error`s the underlying error and returns `connect.NewError(connect.CodeInternal, errors.New("internal error"))` instead of leaking raw pgx/driver text.
- **Validation:** `cd backend && go vet ./... && go build ./... && go test ./...` clean. `pnpm -C frontend type-check && pnpm -C frontend lint` clean.

### Behavior change (known)

- **First-login provisioning works without backend code.** A row landing in `auth.users` (Supabase dashboard, future signup, or admin API) atomically materialises a matching `public.organizations` + `public.users` pair. `GetCurrentUser` finds rows it previously could not. Resolves the 0.2.1 "Behavior change" gap.
- **Wire codes correctly distinguish the four auth/provisioning failure modes.** Pre: every service error became `Unauthenticated`. Post: `Unauthenticated` (no/bad token), `PermissionDenied` (valid token, no provisioning row, *or* org-cross-tenant), `NotFound` (org doesn't exist or invalid UUID), `Internal` (anything else, redacted). Dashboard's amber "not provisioned" panel is the visible payoff — pre-0.2.5 the user saw a generic auth error and was confused; post-0.2.5 they see actionable copy.
- **Internal errors no longer leak to the client.** Default arm of both handler switches replaces underlying error text with generic `"internal error"`; original logged via `slog.Error`. Operators see full detail; clients see nothing they can attack against.
- **`name` column nullable but always-set-to-non-NULL by the API.** `UpdateCurrentUserName` always passes `&name`, never `nil` — no API affordance to clear a name back to NULL. Probably fine for the wizard's needs; flagged below as polish.
- **No backfill for pre-trigger `auth.users` rows.** Triggers fire on future events only. Any pre-existing auth users without a matching `public.users` will fail `GetCurrentUser` with `PermissionDenied` indefinitely. One-shot `INSERT INTO public.users SELECT ... FROM auth.users WHERE NOT EXISTS (...)` is the fix if it becomes observable. Not currently observable (no production deploy).

### Resolves

- **0.2.1 "Behavior change."** `pgx.ErrNoRows` from `GetCurrentUser` was mapped to `connect.CodeUnauthenticated` — wrong code for "authenticated but not provisioned." Handler switch maps to `CodePermissionDenied`; FE's amber panel is the rendered result.
- **0.2.1 "Known pending work" → Error mapping in `users_handler.go`.** Implemented with sentinels + typed-switch, extended to a parallel switch in new `organizations_handler.go`.
- **0.2.1 "Known pending work" → First-admin bootstrap path.** Picked the trigger-on-`auth.users` route (plan decision 1). Every signup auto-admins their own org per Pattern A. Onboarding-wizard plan (next) lets users rename the workspace; invitation-flow plan adds Pattern C on top.
- **0.2.1 "Supersession of 0.1.0 pending item."** Local bring-up was double-blocked on `.env` *and* a provisioning path. Provisioning path now exists; only `.env` population + IPv6 reachability check remain.
- **`docs/plans/auth-user-provisioning.md` → `docs/executing/auth-user-provisioning.md`.** Plan moved at start of work; will move to `docs/executed/` (or be archived) once operator-side E2E completes.

### Known pending work

- **Operator-side trigger E2E verification (E2E-1, E2E-3 from Phase 4).** Triggers compile and are wired correctly, but runtime semantics under the Supabase auth role context have not been exercised against a live project. **Run before first non-localhost deploy.** Risk: a `SECURITY DEFINER` privilege misconfiguration would silently fail to insert and break sign-up entirely (auth.users INSERT itself rolls back on trigger exception). Low probability (standard Supabase grants this correctly), high blast radius if wrong.
- **Unit tests for `organizations.Service.authorize`.** Most security-relevant code in this pass has zero coverage (Phase 4 scoped to `users` per plan decision 13). Three cheap pinning tests using `fakeOrgQueries` + `fakeUserLookup` cover: matching org → ok; mismatched → `ErrForbidden`; malformed UUID → `ErrNotFound`. A regression that swaps `==` for `!=` in `authorize` would silently expose every org to every user — coverage on auth-adjacent code is the cheapest insurance.
- **Fold `UpdateCurrentUserName` into a single query.** Current shape is `SELECT … WHERE auth_user_id = $1` then `UPDATE … WHERE id = $1` — two round trips + small TOCTOU window. A single `UPDATE … WHERE auth_user_id = $1 RETURNING *` halves trips and removes the window. Straightforward sqlc + service simplification.
- **Input validation on `UpdateCurrentUserName` + `UpdateOrganizationName`.** Both accept any wire string: empty, multi-megabyte, control chars. Empty `""` writes a non-NULL empty value to a nullable column — diverges from "unset". Trim + min/max guards in the service should land alongside the wizard.
- **No API path to NULL out a name.** `UpdateUserName` always passes `&name`. A "clear my name" affordance (separate RPC, or `optional` on the request) is a one-way-door follow-up.
- **`CreateUser` query has `name` param but no proto plumbing.** Intentional — schema aligned so the invitation-flow plan can adopt without a regen cycle. For invitation-flow to pick up.
- **Email-sync trigger.** If `auth.users.email` changes, `public.users.email` does not update. Add a third trigger (`AFTER UPDATE OF email ON auth.users`) if drift becomes observable.
- **Onboarding-wizard plan + invitation-flow plan.** Both unblocked; both should be authored as separate `docs/plans/*.md` entries when next-round work begins.
- **Vercel + Fly deploy** (carried from 0.2.0/0.2.4). Now structurally unblocked — only remaining blocker is `.env` population + IPv6 reachability check from 0.2.4.

---

## 0.2.4 — `DATABASE_URL` Canonicalized to Direct Connection (2026-04-24)

Rewrote `DATABASE_URL`'s documented connection mode from Supabase **Session Pooler** (`*.pooler.supabase.com:5432`) to **Direct Connection** (`db.<ref>.supabase.co:5432`). Both URLs now point at the same Direct host — the split is role-and-lifecycle, not host-vs-host. Motivated by Supabase's own UI copy ("Direct Connection: ideal for applications with persistent and long-lived connections, such as those running on virtual machines or long-standing containers"), which describes a Go+Fly single-binary orchestrator exactly. Supersedes 0.1.0's "Session Pooler for app, Direct for migrations" framing and re-grounds the rationale on the missing fact: **`pgxpool` is an in-process transaction pooler**, so an external pooler on the wire is redundant.

### Index

- **Docs updated:** `CLAUDE.md` §Database connection (full rewrite with pgxpool-as-transaction-pooler rationale + ceiling math) + §Migrations heading; `docs/stack.md` §6 migrations clause + new §8 "Database URLs — both Direct Connection, split by role" subsection + `DATABASE_URL` table row; `.env.example` header comment on both URLs (example flipped to Direct); `docs/blueprints/codegen-cheatsheet.md` quick rule; `docs/completions/frontend-scaffold-completion.md` pending-work reference.
- **Code comment updated:** `backend/internal/config/config.go` — `DatabaseURL` godoc rewritten (Direct + pgxpool semantics + IPv4 fallback + Transaction Pooler red line).
- **No runtime code changed.** `pgxpool.Config` values unchanged (`MaxConns=10`, `MinConns=2`, lifetime + idle + health-check); URL shape is driver-indifferent; only the documented convention + populated value in `backend/.env` changes.
- **Session Pooler reclassified as IPv4 fallback**, not primary. Drop-in swap (different URL, same driver, same `pgxpool`); per-developer variation costs nothing and doesn't leak into committed config.
- **Transaction Pooler rule strengthened, not changed.** Reason upgrades from single-barrel ("breaks pgx") to double-barrel ("redundant *and* breaks pgx") once the in-process-equivalence framing is explicit.

### Behavior change (known)

None at runtime. No Go code touched except the `DatabaseURL` godoc. The binary reads whatever `DATABASE_URL` contains — Direct or Session Pooler — and `pgxpool` opens a pool either way. Change is documentary + conventional (what we tell a new operator to paste into `backend/.env`; what godoc + `.env.example` show as canonical). Migrations still use `DATABASE_URL_DIRECT`; the superuser-role distinction keeping it out of `config.Config` is unchanged. Pending local bring-up is unblocked (Direct is now the recommended URL), not made harder.

### Supersedes

- **0.1.0 "Two-URL DB strategy."** The line "session pooling gives IPv4 support + multiplexing + full PG feature set (prepared statements, advisory locks)" is historically accurate only for the rejected *Transaction* Pooler — Session Pooler was never actually needed for multiplexing (`pgxpool` does that) or prepared statements (Direct keeps them too). Rationale upgrade lands here.
- **0.2.0 pending-work item** naming "session-pooler `DATABASE_URL`" as a bring-up prerequisite — updated in-place in `docs/completions/frontend-scaffold-completion.md` to "Direct Connection `DATABASE_URL`."

### Known pending work

- **Local bring-up still the next blocker** (carried forward from 0.2.1/0.2.2/0.2.3). With canonical URL now Direct, verify IPv6 reachability as part of first bring-up — `dig AAAA db.<ref>.supabase.co +short` returning an IPv6 address + `psql "$DATABASE_URL" -c 'select 1'` is enough. Fall back to Session Pooler in `backend/.env` only if Direct fails; per-dev variation doesn't leak because `backend/.env` is gitignored.
- **IPv6 egress on Fly production.** Fly machines have native IPv6 and should reach Direct without config, but verify on first deploy (`fly ssh console` → `dig AAAA db.<ref>.supabase.co` → `psql`). If it fails unexpectedly, Session Pooler is the same drop-in escape hatch.
- **Supavisor session mode (not transaction) on top of Direct** worth adding when horizontal-scaling operational concerns appear — rolling-deploy connection storms, centralized connection limits across ≥10 instances, or cleaner failover routing. Not v1/v2; flag for v2+ when a second backend instance lands.

---

## 0.2.3 — direnv for Shell-Level Env Loading (2026-04-24)

Added committed `backend/.envrc` + `frontend/.envrc` (one line each — `dotenv .env` / `dotenv .env.local`) to auto-source per-app env files into the shell via `direnv` on `cd`. Resolves the `direnv` pending item from 0.2.2: `goose`, ad-hoc `go test`, and every in-directory CLI now see the same env as the Go binary, no `set -a; source; set +a` ritual. Manual sourcing retained as documented fallback.

### Index
- **Committed:** `backend/.envrc` (`dotenv .env`) + `frontend/.envrc` (`dotenv .env.local`) — one line each, zero secrets, safe to commit.
- **Gitignore fix:** `!.envrc` negation added to `frontend/.gitignore` so the default `.env*` rule (inherited from `create-next-app`) doesn't silently exclude the committed `.envrc`.
- **Docs updated:** `CLAUDE.md` §Environment (direnv recommended, manual-sourcing as fallback) + §Common commands §Migrations (`goose` examples now run from `backend/` so direnv vars are in scope); `docs/stack.md` §7 Prerequisites (direnv added) + §8 (new direnv paragraph replaces the 0.2.2 parenthetical).
- **Canonical migration command now runs from `backend/`.** Path shortened from `-dir backend/migrations` to `-dir migrations`; direnv has already exported `DATABASE_URL_DIRECT` by the time cwd is `backend/`.
- **Rationale:** direnv is the de-facto standard for per-directory env loading in Go / Rails / Node monorepos (Fly.io docs, Supabase CLI docs, 1Password CLI integration, Nix / devenv, HashiCorp Terraform). Committed `.envrc` makes onboarding one `direnv allow` per contributor per directory after first clone.

### Behavior change (known)

None at runtime — code unchanged. `godotenv/autoload` still loads `backend/.env` on Go binary start; Next.js still loads `frontend/.env.local` on `next dev` / `next build`; neither knows or cares about direnv. The only change: a developer `cd`'d into `backend/` now has `DATABASE_URL_DIRECT` + friends exported automatically, so CLI tools not reading `.env` directly (goose, sqlc, any ad-hoc command) also see those vars. Already-onboarded developers using manual sourcing keep working — direnv is purely additive.

### Resolves

- **0.2.2 pending item: "`direnv` or shell-sourcing helper for `DATABASE_URL_DIRECT`."** Picked direnv, committed the `.envrc` files, documented it as recommended across three docs, kept manual sourcing as fallback.

### Known pending work

- **CI and production untouched.** CI uses GitHub Actions secrets / platform-native injection, never `.env` or `.envrc`. Fly + Vercel inject env at runtime from dashboards. direnv is strictly a local-dev ergonomic layer; production story stays clean.
- **Secret-manager migration** (long-lead, not blocking). When team passes ~5 devs or secrets rotation becomes recurring, re-evaluate Doppler / Infisical / 1Password CLI. The direnv layer would then become a per-`.envrc` secret-fetch (`export DATABASE_URL=$(op read …)`) or be wrapped in `doppler run --`; per-app structure stays intact either way.

---

## 0.2.2 — Env File Placement: Per-App (2026-04-24)

Replaced the "single `.env` at repo root" convention with per-app files: `backend/.env` (auto-loaded by `godotenv/autoload` from the Go binary's cwd) and `frontend/.env.local` (auto-loaded by Next.js from the `frontend/` project root). Matches both loaders' defaults; the root-`.env` framing from 0.1.0 would have required symlinks or a `dotenv-cli` wrapper. Supersedes the root-`.env` story in `CLAUDE.md` §Environment, `stack.md` §8, and `.env.example` comments.

### Index
- **Committed docs:** `CLAUDE.md` §Environment + architecture diagram, `docs/stack.md` §8, `.env.example` (top comment + `--- Supabase (frontend-facing copies) ---` block) — all rewritten to describe the per-app split.
- **Gitignored files (not committed):** `backend/.env` + `frontend/.env.local` scaffolded with the relevant `.env.example` key subset; values empty for operator to populate. Covered by existing root `.gitignore` (lines 2–3: `.env`, `.env.local`) and `frontend/.gitignore` (line 34: `.env*`) — no gitignore changes.
- **Shared Supabase values duplicated by design.** Two pairs now in both files: `SUPABASE_URL` ↔ `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY` ↔ `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Rotations touch two files; accepted cost.
- **`DATABASE_URL_DIRECT`** physical home moves from a (never-created) root `.env` to `backend/.env`. 0.1.0's no-Config invariant unchanged — still absent from `config.Config`, still shell-sourced by `goose`.

### Known pending work

- **`direnv` or shell-sourcing helper for `DATABASE_URL_DIRECT`.** `goose` now needs either `set -a; source backend/.env; set +a` before the command, or a `backend/.envrc` with `dotenv .env` + `direnv allow`. Scaffolding / onboarding docs should pick one when first migration-apply happens (still blocked on populated Supabase creds — see 0.2.1 pending).
- **`.env.example` split (deferred).** Could split into `backend/.env.example` + `frontend/.env.local.example` for max locality. Kept as one repo-root file for now: simpler first-clone experience, var list still short enough that co-location isn't paying. Revisit if template grows past ~30 vars or operator confusion about "where does this value go?" shows up.

---

## 0.2.1 — Seeding Removed (2026-04-24)

Removed all backend seeding: default-org `INSERT` in the initial migration, `defaultOrgID` constant + auto-provisioning branch in `users/service.go`, now-unused `CreateUser` query + its sqlc artifacts. Supersedes 0.1.0's "seeds a default org + auto-provisions users on first login" behavior.

### Index
- Migration: default-org `INSERT` removed from `20260424120000_initial_schema.sql`.
- Query: `CreateUser` removed from `backend/queries/users.sql`; regenerated `backend/internal/db/users.sql.go` no longer contains `CreateUser` / `CreateUserParams`.
- Service: `defaultOrgID` constant + auto-provisioning branch removed from `users/service.go`; `github.com/google/uuid` import dropped.
- `go vet ./...` + `go build ./...` clean.

### Known pending work (added by 0.2.1)

- **Error mapping in `users_handler.go`.** Translate `pgx.ErrNoRows` (and a service-layer sentinel like `ErrUserNotProvisioned`) to an appropriate Connect code (likely `PermissionDenied`) so the FE can render "your account isn't provisioned — contact an admin" instead of a generic error string.
- **First-admin bootstrap path.** Replaces what seeded default-org + auto-provisioning did. Options: admin-invite flow that creates `users` rows explicitly, a separate policy migration seeding one bootstrap admin from an env var, or a one-shot CLI. Pick one when blueprint §10 admin UX is specified.
- **Supersession of 0.1.0 pending item.** 0.1.0's "Local bring-up" was blocked on populated `.env`; now also blocked on a provisioning path — signing in with a Supabase user whose `auth_user_id` isn't in `public.users` will fail.

---

## 0.2.0 — Frontend Scaffolding (2026-04-24)

FE scaffolded end-to-end through the "prove the pipeline" milestone: Next.js 16 App Router + Supabase SSR auth + Connect-ES v2 client calling the existing `GetCurrentUser` RPC. `pnpm type-check` + `pnpm lint` clean. Not yet running — needs populated `.env` + seeded Supabase test user. Codegen cheatsheet added under `docs/blueprints/`.

### Index
- Monorepo workspace plumbing: root `pnpm-workspace.yaml` + `package.json` + `Procfile.dev`.
- Frontend scaffolding §1–§13 complete: Next.js + shadcn/ui + Supabase SSR clients + Connect API client + sign-in / dashboard / session-gated root redirect.
- Tooling delta from doc: Next 16 (vs 15), Tailwind v4 (vs v3), React 19 (vs 18), Connect-ES v2 (vs v1), `sonner` (vs `toast`).
- Connect-ES v2 codegen shift: consolidated into `*_pb.ts` via `@bufbuild/protoc-gen-es` alone; no separate `protoc-gen-connect-es`.
- `buf.gen.yaml` extended with TS plugin pointing at frontend's `node_modules/.bin/protoc-gen-es`.
- `.env.example` extended with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (gap from 0.1.0 template).
- ESLint `globalIgnores` extended with `src/gen/**` (structurally enforces blueprint §11.7 on FE).
- Post-bootstrap cleanup of `create-next-app` artifacts (nested `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `AGENTS.md`, `CLAUDE.md`).
- `docs/blueprints/codegen-cheatsheet.md` added — entry-point matrix for "I want to do X, I edit Y, I run Z."
- `docs/completions/frontend-scaffold-completion.md` authored as the durable record of deviations.

### Known deviations from `docs/frontend-scaffolding.md`

All intentional; all flagged in the completion doc. Listed here for changelog completeness:

1. **Next.js 16 + Tailwind v4 + React 19** instead of Next 15 / Tailwind v3 / React 18. Structural path diffs: no `tailwind.config.ts`, `postcss.config.mjs` (not `.js`), `globals.css` at `src/app/globals.css` not `src/styles/globals.css`.
2. **Connect-ES v2** — consolidated `*_pb.ts`, no `protoc-gen-connect-es`, `createClient` instead of `createPromiseClient`.
3. **`sonner`** replaces `toast` in newer shadcn (equivalent).
4. **No `form.tsx` shadcn primitive** — registry entry silently no-ops; deferred until spawn UX.
5. **Post-bootstrap cleanup**: removed `frontend/{pnpm-workspace.yaml,pnpm-lock.yaml,AGENTS.md,CLAUDE.md}`.

### Known pending work

- **Local bring-up (FE+BE together)** — populate root `.env`, apply migration, `overmind start`, create Supabase test user via dashboard, sign in, confirm dashboard renders the email. The actual `stack.md` §12 hour-5 milestone. Supersedes 0.1.0's "local bring-up" (same `.env` bottleneck for both halves, now with FE ready to exercise it).
- **`docs/frontend-scaffolding.md` update** — bake in the five deviations so a fresh scaffold doesn't re-hit the same forks.
- **`form.tsx` shadcn primitive** — retry when spawn UX lands (blueprint §10 "RPG character creation" uses shadcn `<Form>` + zod).
- **Vercel deploy** (doc §12) — blocked on local bring-up.
- **Product code per blueprint §10** — catalog → spawn form → fleet view → agent detail. All downstream of pipeline proof.

---

## 0.1.0 — Backend Scaffolding & Docs Reconciliation (2026-04-24)

Backend scaffolding compiling end-to-end (not yet running — blocked on Supabase creds); docs reconciled across `vision.md` / `blueprint.md` / `stack.md` / `backend-scaffolding.md`.

### Index
- Doc alignment sweep: 3 real misalignments + stale path leftovers.
- Backend scaffolding §3–§11 complete: module, deps, config, db, auth, proto, users RPC, HTTP server, air.
- Two-URL DB strategy (`DATABASE_URL` = session pooler for app, `DATABASE_URL_DIRECT` = direct for migrations).
- `pgxpool` tuning (`MaxConns=10`, `MinConns=2`, lifetime + idle + health-check).
- `sqlc` UUID override (`pgtype.UUID` → `google/uuid.UUID`) — required for service layer to compile.
- `buf.yaml` authored (doc only showed `buf.gen.yaml`, insufficient for `buf generate`).
- `users.proto` + Connect-go RPC (`GetCurrentUser`) — the "prove the pipeline" artifact.
- First migration: `organizations` + `users` + default org seed; five remaining blueprint §9 tables pending.
- `.gitignore` + `.env.example` at repo root.
- Dev tools installed: `buf` (brew), `goose` + `air` (`go install`).