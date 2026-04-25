# Roadmap — Post-0.2.6 → Demoable v1

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/changelog.md` §0.2.5, §0.2.6 (current state — auth + provisioning landed; ES256/JWKS validated)
- `docs/blueprint.md` §1 (MVP scope), §9 (data model), §10 (RPG-character-creation flow), §11 (architecture rules)
- `docs/vision.md` §"Garage" model, §admin model
- `docs/stack.md` §12 (hour-zero scaffolding order — we're between hour 4 and hour 5)

This is a **high-level roadmap, not an implementation plan**. Each milestone below earns its own detailed plan doc in `docs/plans/` before execution. The point of this file is to lock the *order* and the *why*, so the per-milestone plans aren't relitigating sequencing every time.

---

## 1. Sequencing principle

**Vertical slices over horizontal layers.** Each milestone closes a complete user-visible path — sign in, see something new, click something, see something else — rather than landing a layer (schema week, RPC week, FE week) that has no caller until later. This is the discipline 0.1.0 → 0.2.6 has been quietly enforcing; continuing it is what gets us to a demo.

Two derived rules for ordering:

1. **No table exists before its first reader.** Migrations land alongside the RPC + handler + UI that consume them, not as a batch.
2. **Each milestone leaves the demo strictly better than the one before it.** A new pane, a new page, a new button — visible end-to-end, not "infrastructure for the next milestone."

The 0.2.5 → 0.2.6 collision (two parallel plans both touching `internal/auth/`) is the cheap lesson worth remembering: don't open a second concurrent surface until the first is closed. Milestones run in series unless explicitly noted parallelisable.

---

## 2. Where we are (snapshot, 2026-04-25)

- **Working today.** Sign in via Supabase JS, BE validates ES256 + JWKS, `auth.users` insert auto-provisions `public.organizations` + `public.users`, `GetCurrentUser` round-trips, dashboard renders email or the four-state amber "not provisioned" panel. `UpdateCurrentUserName` + `UpdateOrganizationName` RPCs already wired but no FE caller.
- **Not built yet.** Everything blueprint §9 calls product code: `HarnessAdapter`, `AgentTemplate`, `AgentInstance`, `Secret`, `DeployTarget`. No Dockerfile, no `fly.toml`, nothing deployed.
- **Implicitly available, no FE caller.** `UpdateCurrentUserName`, `UpdateOrganizationName`, `OrganizationsService.GetOrganization`. These ship "for free" in the next milestone.

---

## 3. Milestones

Four milestones to a demoable v1. Each one is a standalone PR-sized chunk, each one earns its own `docs/plans/<milestone>.md` before work starts.

### M1 — Onboarding wizard + dashboard shell

**Goal:** a freshly-provisioned user lands on a real onboarded experience: prompted for name + workspace name on first login, then dropped on a dashboard with a navigation chrome that previews the rest of the product.

**Why first.** Cheapest visible win in the codebase. Zero new schema, zero new RPCs, zero new domain packages. `name` column already exists on `public.users`, both `Update*Name` RPCs already wired, `OrganizationsService.GetOrganization` already wired. This milestone is *pure consumption* of code 0.2.5 already shipped — closing the visible UX gap between "amber 'not provisioned' panel" and "blank email-only dashboard."

**Surfaces touched.** Frontend only. `frontend/src/app/dashboard/`, new `frontend/src/app/onboarding/` (or modal-on-dashboard, TBD in plan), `frontend/src/components/` for the layout shell.

**Demo improvement.** New user signs in → wizard prompts for "what should we call you?" + "what's your workspace called?" → submits → lands on a dashboard with a sidebar showing `Dashboard / Agents / Fleet / Settings` (last three are placeholder routes). Returning user skips the wizard. The product *looks* like a product instead of a dev scaffold.

**Out of scope.** Avatar upload, theme toggle, any actual content on `/agents` / `/fleet` / `/settings` beyond a "coming soon" stub. Nav exists; destinations don't yet — and §11.4 is satisfied because the *navigation* is real, the destination pages just haven't shipped.

**Plan doc:** `docs/plans/onboarding-wizard.md` (already named in 0.2.5's "follow-up plans" list).

---

### M2 — Catalog: `HarnessAdapter` + `AgentTemplate` + `/agents` page

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

**Plan doc:** `docs/plans/hermes-adapter-and-fly-wiring.md`.

---

### M4 — Spawn flow + fleet view (the demo moment)

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

**Plan doc:** `docs/plans/spawn-flow.md`.

---

## 4. Out of scope for this roadmap

Explicitly *not* in the M1–M4 sequence:

- **Deploying the control plane itself to Fly + Vercel.** Per `stack.md` §12 hour-5 milestone, this is technically the next box to tick after auth E2E. Slotted opportunistically — likely between M2 and M3, when there's a non-trivial backend worth deploying *and* a frontend worth previewing. Not blocking the M-sequence.
- **Onboarding-wizard backend changes.** None needed. M1 is FE-only.
- **Invitation flow / multi-user orgs.** Pattern C per 0.2.5; deferred per blueprint §13's "Multi-tenant organization isolation" line. Separate plan in `docs/plans/invitation-flow.md` when its first caller arrives.
- **Programmatic adapter generation.** v2 per blueprint §14. Not on this roadmap.
- **Audit log, observability dashboard, model gateway, skills registry, IAM.** All v1.5 / v2 per blueprint §14. Not on this roadmap.

---

## 5. Definition of done for "demoable v1"

After M4 lands, the demo we can give cold:

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
