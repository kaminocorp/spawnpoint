# Roadmap — Post-0.2.6 → Demoable v1

**Status:** ✅ fully shipped. M1, M2, M3, M3.5, M3.9, and M4 (all 8 phases) all landed by 2026-04-26. The "demoable v1" definition-of-done in §5 is met — the deployed FE+BE are reachable, the spawn flow runs end-to-end against a live Fly account, and the M4 hardening tail (transactional spawn writes, handler-level sentinel tests, secrets-row policy) closed in 0.7.5. Sequencing note (historical): M3.9 was executed *out of order* (M4 landed against `localhost` first), then M3.9 retired the gap.
**Last updated:** 2026-04-26
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/changelog.md` §0.7.5 (latest, M4 Phase 8 hardening + v1.5 breadcrumbs), §0.7.4 (M3.9 control-plane deploy), §0.7.3 (M4 Phase 7 smoke), §0.7.0 (M4 Phases 1–6), §0.5.1 (M3.5), §0.5.0 (M3), §0.4.0 (M2), §0.3.0 (M1), §0.2.6, §0.2.5
- `docs/blueprint.md` §1 (MVP scope), §9 (data model), §10 (RPG-character-creation flow), §11 (architecture rules)
- `docs/vision.md` §"Garage" model, §admin model
- `docs/stack.md` §10 (deploy targets), §12 (hour-zero scaffolding order)

This is a **high-level roadmap, not an implementation plan**. Each milestone below earns its own detailed plan doc in `docs/plans/` before execution. The point of this file is to lock the *order* and the *why*, so the per-milestone plans aren't relitigating sequencing every time.

---

## 1. Sequencing principle

**Vertical slices over horizontal layers.** Each milestone closes a complete user-visible path — sign in, see something new, click something, see something else — rather than landing a layer (schema week, RPC week, FE week) that has no caller until later. This is the discipline 0.1.0 → 0.2.6 has been quietly enforcing; continuing it is what gets us to a demo.

Two derived rules for ordering:

1. **No table exists before its first reader.** Migrations land alongside the RPC + handler + UI that consume them, not as a batch.
2. **Each milestone leaves the demo strictly better than the one before it.** A new pane, a new page, a new button — visible end-to-end, not "infrastructure for the next milestone."

The 0.2.5 → 0.2.6 collision (two parallel plans both touching `internal/auth/`) is the cheap lesson worth remembering: don't open a second concurrent surface until the first is closed. Milestones run in series unless explicitly noted parallelisable.

---

## 2. Where we are (snapshot, 2026-04-26)

- **Working today.** Sign in via Supabase JS, BE validates ES256 + JWKS, auto-provisioning fires on `auth.users` insert, `GetCurrentUser` round-trips. Onboarding wizard (M1, v0.3.0) captures name + workspace name on first login, then lands on a dashboard shell with `Dashboard / Agents / Fleet / Settings` chrome. `/agents` (M2, v0.4.0) renders the Hermes catalog card backed by real `harness_adapters` + `agent_templates` rows pinned to the upstream Hermes digest. `internal/deploy/` (M3, v0.5.0) shipped — `DeployTarget` interface + `FlyDeployTarget` (real, calls Fly's HTTP API via `fly-go`/`flaps`) + `LocalDeployTarget` / `AWSDeployTarget` `NotImplemented` stubs; the Hermes adapter image is published at `ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152…` and pinned into `harness_adapters.adapter_image_ref` behind a digest-pinning CHECK constraint. `deploy.Resolver` indirection (M3.5, v0.5.1) wraps the kind-keyed registry so the v1.5 `DBResolver` swap is a one-line change. **M4 spawn flow (all 8 phases) shipped across v0.7.0 + v0.7.3 + v0.7.5** — `agent_instances` / `secrets` / `deploy_targets` tables exist, six RPCs wired, `/agents` deploy modal active, `/fleet` polls live status, end-to-end spawn against a live Fly account succeeded (0.7.3), and Phase 8 hardening closed in 0.7.5 (transactional spawn writes via `agents.Transactor` + `WithSpawnTx`; 13-case sentinel→Connect-code mapping test pinning the public wire contract; secrets-row policy pinned in code as "one row per *secret-shaped* `CORELLIA_*` var"). **M3.9 control-plane deploy shipped in v0.7.4** — `backend/Dockerfile`, `backend/fly.toml`, Vercel project rooted at `frontend/`, Fly secrets set; the deployed BE on `corellia.fly.dev` and the deployed FE on Vercel are now the live URLs.
- **Not built yet.** Nothing in the v1 sequence. The v1 surface is feature-complete; further work moves to **v1.5** (`docs/plans/v1.5-roadmap.md` — Memory → Tools → Skills) and the parallel deploy-target-credentials track (`docs/executing/deploy-target-credentials.md`, breadcrumbs already committed in 0.7.5: `// TODO(v1.5):` on `FlyCredentials` in `internal/deploy/fly.go:33` + new `blueprint.md` §11.6 codifying "never PATs from users").
- **Thin tail carried forward.** Three small follow-ups remain from the v1 work but don't gate "demoable v1": (a) `docs/plans/deploy-control-plane.md` not yet drafted — the two-BE-deploys, one-FE-deploy ordering recipe wants documenting before the next preview-environment setup forces a rediscovery; (b) old Fly PAT not yet revoked (0.7.3); (c) the `InvalidArgument` vs `NotFound` inconsistency between `SpawnAgent`'s bad-template-id path and `Stop/Get/DestroyAgentInstance`'s bad-id paths is *documented* by 0.7.5's tests but not harmonized — a public-contract decision worth a separate pass.
- **Implicitly available, no FE caller.** `UpdateCurrentUserName`, `UpdateOrganizationName`, `OrganizationsService.GetOrganization` (since 0.2.5); `agents.UpdateImageRef` (since 0.5.0). All other previously-stubbed surfaces (`deploy.Resolver.For`, the six M4 RPCs) now have real readers.

---

## 3. Milestones

Five milestones to a demoable v1 (M3.9 promoted from §4 once M3.5's structural pre-payment closed; the deploy is no longer "opportunistic between M2 and M3" because that window has passed and M4's demo path strictly requires a deployed FE+BE). Each one is a standalone PR-sized chunk, each one earns its own `docs/plans/<milestone>.md` before work starts.

### M1 — Onboarding wizard + dashboard shell

**Status:** ✅ Shipped in v0.3.0 (M1) + v0.3.1 (M1 hardening — provider memoisation, title template, `middleware` → `proxy`).

**Goal:** a freshly-provisioned user lands on a real onboarded experience: prompted for name + workspace name on first login, then dropped on a dashboard with a navigation chrome that previews the rest of the product.

**Why first.** Cheapest visible win in the codebase. Zero new schema, zero new RPCs, zero new domain packages. `name` column already exists on `public.users`, both `Update*Name` RPCs already wired, `OrganizationsService.GetOrganization` already wired. This milestone is *pure consumption* of code 0.2.5 already shipped — closing the visible UX gap between "amber 'not provisioned' panel" and "blank email-only dashboard."

**Surfaces touched.** Frontend only. `frontend/src/app/dashboard/`, new `frontend/src/app/onboarding/` (or modal-on-dashboard, TBD in plan), `frontend/src/components/` for the layout shell.

**Demo improvement.** New user signs in → wizard prompts for "what should we call you?" + "what's your workspace called?" → submits → lands on a dashboard with a sidebar showing `Dashboard / Agents / Fleet / Settings` (last three are placeholder routes). Returning user skips the wizard. The product *looks* like a product instead of a dev scaffold.

**Out of scope.** Avatar upload, theme toggle, any actual content on `/agents` / `/fleet` / `/settings` beyond a "coming soon" stub. Nav exists; destinations don't yet — and §11.4 is satisfied because the *navigation* is real, the destination pages just haven't shipped.

**Plan doc:** `docs/plans/onboarding-wizard.md` (already named in 0.2.5's "follow-up plans" list).

---

### M2 — Catalog: `HarnessAdapter` + `AgentTemplate` + `/agents` page

**Status:** ✅ Shipped in v0.4.0.

**Goal:** the `/agents` route stops being a placeholder and renders one real card — "Hermes" — backed by a real `agent_templates` row pinned to a real `harness_adapters` row at a real Docker image digest.

**Why second.** This is the *first* milestone where blueprint §9's product schema earns its keep — there's now a real reader for it (the catalog page). Migrating these two tables before M2 would be schema-without-callers; migrating them in M2 keeps the data model honest.

**Surfaces touched.**
- Migration adding `harness_adapters` + `agent_templates` per blueprint §9 (with the `source` column from §4 so generated adapters slot in later).
- One-row seed: the Hermes adapter, `harness_name = "hermes"`, digest pinned per blueprint §5.
- New domain packages `internal/adapters/` + `internal/agents/` (per CLAUDE.md "Planned packages" list).
- Proto: `corellia.v1.AgentsService.ListAgentTemplates`.
- Handler in `httpsrv/`, registered inside the auth group, <30 LOC per §11.9.
- Frontend `/agents` page consumes `api.agents.listAgentTemplates()` and renders cards.

**Demo improvement.** "Agents" sidebar tab shows one real "Hermes" card with a description, model defaults, and a *disabled* "Deploy" button (the deploy flow is M4). Other harnesses appear grayed out as "Coming soon" per blueprint §10 step 3.

**Architectural earner.** This is where the §11.2 rule (digest-pinning) gets exercised for the first time on real data — the seed row stores `upstream_image_digest = sha256:...`, never a tag. Sets the precedent before any future migration can backslide.

**Out of scope.** No `AgentInstance` table yet — that's M4. No spawn handler. No Fly client. The "Deploy" button is non-functional and *grayed out* — not a fake button, but a visibly-disabled one with hover-tooltip "Available in v1."

**Plan doc:** `docs/plans/agent-catalog.md`.

---

### M3 — Hermes adapter image + Fly account wiring

**Status:** ✅ Shipped in v0.5.0 (Phases 1–7 + Phase 8 post-review hardening) + v0.5.1 (M3.5 — `deploy.Resolver` indirection, structural pre-payment for v1.5 user-configurable targets).

**Goal:** the Hermes adapter image actually exists in a registry, the Fly account is configured for programmatic spawn, and the BE has a `DeployTarget` interface with `FlyDeployTarget` as one real impl + at least one `NotImplemented` stub (per §11.4).

**Why third, before M4.** The schema and UI for spawn (M4) are useless if the adapter image doesn't exist or the Fly API token isn't wired. This milestone is the unglamorous infrastructure step that M4 depends on. Splitting it out keeps M4's plan focused on application code rather than registry-pushing and Fly-account-setup.

**Surfaces touched.**
- New `corellia/hermes-adapter` Dockerfile (`FROM ghcr.io/nousresearch/hermes-agent@sha256:...`), wrapper script translating `CORELLIA_*` → Hermes-native env vars per blueprint §4 (v1, hand-written).
- Image built + pushed to a registry; digest captured.
- M2's seed row updated to point `adapter_image_ref` at the real digest.
- `internal/deploy/` package: `DeployTarget` interface + `FlyDeployTarget` (real impl, machinegun and apps API) + `LocalDeployTarget` and/or `AWSDeployTarget` as `NotImplemented` stubs to exercise the abstraction.
- `FLY_API_TOKEN` + `FLY_ORG_SLUG` already in `.env.example`; verify still wired and reachable.

**Demo improvement.** Visible to the developer, not the end user. We can `fly machines run` the adapter image manually with `CORELLIA_*` env vars set and watch a Hermes process boot. The harness contract (blueprint §3) is exercised end-to-end *outside* the control plane before the control plane drives it.

**Out of scope.** No spawn flow from the UI yet. No `AgentInstance` writes. No fleet view.

**Plan doc:** `docs/archive/hermes-adapter-and-fly-wiring.md` (archived post-completion).

---

### M3.9 — Deploy the control plane itself (FE → Vercel, BE → Fly)

**Status:** ✅ Shipped in v0.7.4. Sequencing was inverted — M4 (v0.7.0 + v0.7.3) landed first against `localhost` + prod Supabase + live Fly, then M3.9 retired the gap by shipping `backend/Dockerfile`, `backend/.dockerignore`, `backend/fly.toml`, the Vercel project rooted at `frontend/`, and the Fly secrets (`DATABASE_URL`, `SUPABASE_URL`, `FLY_API_TOKEN` org-scoped per 0.7.3, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`). Pure infra artefacts + dashboard config; zero code change in `backend/` or `frontend/`. The de-risking argument the roadmap originally cited (CORS / JWKS / cookie-domain / env-drift surfacing on a deployed substrate) was retired empirically rather than prophylactically — the failure modes either didn't materialize or were resolved during the artefact PR.

**Goal:** the running `corellia-api` Fly app and the `corellia-frontend` Vercel project replace `localhost:8080` and `localhost:3000` as the source of truth. Sign-in, `GetCurrentUser`, the onboarding wizard, and the `/agents` catalog all work end-to-end against deployed URLs. M4's demo (§5) becomes runnable cold from a fresh browser session.

**Why now (was §4 "opportunistic"; promoted).** When the roadmap was drafted post-0.2.6, the deploy was slotted "between M2 and M3" because at that point the BE was the lightest thing to ship. That window has closed — M2, M3, and M3.5 all landed without it, and the demo §5 sequence ("Open the deployed FE in a browser") strictly requires it before M4 can be exercised cold. **Reordering M3.9 ahead of M4 also de-risks M4**: the spawn flow's failure modes (CORS rejection, JWKS reachability across origins, Supabase cookie domain, environment drift between local and deployed config) all surface on a deployed substrate, not in `localhost`. Hitting them in an empty M3.9 is cheaper than hitting them tangled with spawn-state-machine bugs in M4.

**Surfaces touched.**
- `backend/Dockerfile` — multi-stage Go 1.26 build producing a static `cmd/api` binary in a distroless or scratch final stage. Standard pattern; `cmd/smoke-deploy` deliberately not included in the deployed image.
- `backend/fly.toml` — app `corellia` under org `crimson-sun-technologies`, internal port 8080, `[[http_service]]` on `:443` with `force_https = true`, `[[http_service.checks]]` against `/healthz` (already exposed outside the auth group at `httpsrv/server.go:32`), `auto_stop_machines = "stop"` + `auto_start_machines = true` to match blueprint §8's idle-cost stance for *agent* apps (different surface, same operator instinct).
- Fly secrets set via `fly secrets set` — `DATABASE_URL`, `SUPABASE_URL`, `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`. Never committed to `fly.toml`.
- Vercel project rooted at `frontend/`, env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (the latter pointing at the deployed BE).
- `FRONTEND_ORIGIN` (BE) and `NEXT_PUBLIC_API_URL` (FE) cross-reference each other — the deploy-order chicken-and-egg is the only subtle bit.

**Deploy-order subtlety.** First `fly deploy` with a placeholder `FRONTEND_ORIGIN` to get a stable BE URL → set `NEXT_PUBLIC_API_URL` in Vercel to that URL → first Vercel deploy → set `FRONTEND_ORIGIN` in Fly to the Vercel URL → `fly deploy` again so CORS picks up the deployed origin. Two BE deploys, one FE deploy. Document in the plan doc so future deploys (or a fresh teammate setting up a preview environment) don't rediscover the order.

**Demo improvement.** Visible to the developer first, then end users via the URL. Sign in works against the deployed FE, dashboard renders against the deployed BE, the `/agents` catalog renders the Hermes card. **The deploy itself is the demo improvement** — no new product features, but every prior milestone's UI is now reachable from a phone, an iPad, or a teammate's laptop. The Vercel preview URL per PR also unblocks design review on the unmerged FE branches.

**Out of scope.** No CI/CD pipeline beyond Vercel's auto-deploy on push to `main`; Fly stays on manual `fly deploy`. No GitHub Actions for backend deploy yet — that's a v1.5 follow-up if/when manual deploys become friction. No staging environment; one production app per side. No custom domains in v1 — the auto-generated `corellia.fly.dev` and `<vercel-slug>.vercel.app` URLs are sufficient until a brand decision is made.

**Plan doc:** `docs/plans/deploy-control-plane.md` (to draft alongside the artefact PR).

---

### M4 — Spawn flow + fleet view (the demo moment)

**Status:** ✅ All 8 phases shipped. v0.7.0 (Phases 1–6: schema, service, proto, handlers, deploy modal, fleet page) + v0.7.3 (Phase 7: first integration smoke against live Fly + PAT → org-scoped token swap) + v0.7.5 (Phase 8 hardening: transactional spawn writes via `agents.Transactor` + `WithSpawnTx`; `agents_handler_test.go` with 13-case sentinel→Connect-code mapping pinning the public wire contract; secrets-row policy pinned in code at the `InsertSecret` call site). Sequencing note (historical): this milestone landed *before* M3.9 against `localhost` rather than after a deployed substrate; the failure modes M3.9 was originally meant to flush (CORS, cookie domain, JWKS reachability across origins) didn't surface because M3.9's artefact PR (v0.7.4) carried them out cleanly post-hoc.

**Goal:** blueprint §10 end-to-end. Admin clicks "Deploy" on a Hermes card → wizard collects name + provider + API key + model → backend creates `AgentInstance` row → `FlyDeployTarget.spawn()` creates the Fly app + secrets + machine → on `/health` passing, status flips to `running` → admin redirects to `/fleet` and sees the new agent.

**Why last.** This is the milestone every prior one was setting up. By the time M4's plan is written, the catalog renders (M2), the adapter image exists (M3), the wizard pattern is reusable (M1), and `FlyDeployTarget` is a real type. The plan doc can focus entirely on the *flow* — state machine, error paths, secret handling, the `/health` poll loop — without relitigating any infrastructure.

**Surfaces touched.**
- Migration adding `agent_instances` + `secrets` + `deploy_targets` per blueprint §9.
- Proto: `AgentsService.SpawnAgent` (unary), `ListAgentInstances`, `GetAgentInstance`. Streaming for log-tail is post-v1 per blueprint §13.
- `agents.Service.Spawn` orchestrates: row insert → `FlyDeployTarget.spawn` → poll for healthy → status flip. CLAUDE.md §11.9 says handlers stay <30 LOC, so the orchestration lives in `agents/`, not `httpsrv/`.
- Secret handling per blueprint §9: `Secret.storage_ref` references Fly's secret store; raw values never persist in our DB.
- Frontend: deploy modal/wizard, `/fleet` page consuming `ListAgentInstances` with status badges and a logs link (Fly dashboard URL is fine for v1 per §7).
- **"Spawn N agents" demo affordance** per blueprint §10 last paragraph: same form with a count + name-prefix field, parallelised in `agents.Service.SpawnN` via goroutine fan-out (Go's idiomatic fit for an orchestrator per `stack.md` §1).

**Demo improvement.** This *is* the demo. Sign in → click Hermes → name "alice-research-01" → paste key → deploy → watch status flip pending → running → click logs → see Hermes booting. Then "Deploy 5" → five agents fan out in parallel, all five appear in fleet view within seconds.

**Out of scope.** Stop / start / destroy lifecycle (covered in v1.5 per blueprint §14, but a basic "destroy" should probably bundle in here — TBD in plan). Skills, tools, memory, audit log — all explicitly deferred per §13.

**Plan doc:** `docs/executing/spawn-flow.md` (per-phase completions under `docs/completions/spawn-flow-phase-{1..6}.md`; Phase 7 runbook at `docs/completions/spawn-flow-phase-7-runbook.md`).

---

## 4. Out of scope for this roadmap

Explicitly *not* in the M1–M4 sequence:

- **Onboarding-wizard backend changes.** None needed. M1 is FE-only. (Shipped in v0.3.0.)
- **Invitation flow / multi-user orgs.** Pattern C per 0.2.5; deferred per blueprint §13's "Multi-tenant organization isolation" line. Separate plan in `docs/plans/invitation-flow.md` when its first caller arrives.
- **Programmatic adapter generation.** v2 per blueprint §14. Not on this roadmap.
- **Audit log, observability dashboard, model gateway, skills registry, IAM.** All v1.5 / v2 per blueprint §14. Not on this roadmap.

---

## 5. Definition of done for "demoable v1"

**Status as of 2026-04-26: ✅ met.** All seven steps below are reachable against the deployed URLs (`corellia.fly.dev` BE, Vercel-hosted FE) following M3.9 (v0.7.4) + M4 Phase 8 (v0.7.5). The cold-browser walkthrough as a *recorded artefact* is the only loose thread — useful for the next preview-environment setup or a teammate's first run-through, but not gating v1's shippability.

The demo we can give cold:

1. Open the deployed FE in a browser. Sign in.
2. Onboarding wizard captures name + workspace name. Dashboard appears.
3. Click "Agents" — Hermes card visible, others "Coming soon."
4. Click Hermes → "Deploy" → wizard → submit.
5. Redirect to `/fleet`. Agent in `pending` for ~30s, flips to `running`.
6. Click logs link → Fly dashboard shows Hermes booting.
7. Back to `/agents` → "Deploy 5" → five agents fan out in parallel, all visible in `/fleet`.

This is what blueprint §1 calls "an end-to-end demonstrable slice." If we're at this point, v1 is shippable.

---

## 6. Open questions for the per-milestone plans

Surface here so the per-milestone plans can answer them rather than rediscover them:

- **M1.** Wizard as a dedicated `/onboarding` route or a modal on `/dashboard`? (Modal is simpler; route is more conventional and back-button-friendly.)
- **M2.** Should `AgentTemplate.default_config` be a typed proto message or a `JsonValue`? (§9 says JSON; might want stricter shapes for the catalog form.)
- **M3.** Where does the adapter image live — GitHub Container Registry under the user's account, or a dedicated org? (Affects pull-secret config on Fly.)
- **M4.** Polling vs. webhook for the `pending → running` transition? (Fly supports both; polling is simpler, webhook is more elegant. v1 likely polling.)
- **M4.** Does v1 need a "destroy" affordance, or is "stop" enough? (Blueprint §10 step 8 doesn't mention destroy from the UI; but a demo without one feels incomplete.)

These are not blockers for approving the sequence — just flagged so each plan doc opens with them on the table.
