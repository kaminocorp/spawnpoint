# Deploy Target Credentials — Problem & Proposed Solutions

**Status:** problem statement, pre-plan. Not yet scoped to a milestone.
**Surfaced by:** M4 Phase 7 smoke run (2026-04-26) — `flaps.CreateApp` returned `unauthorized` against `api.machines.dev` with a token that succeeds against Fly's GraphQL API.
**Related:** `internal/deploy/fly.go` (`FlyCredentials`, `NewFlyDeployTarget`); `internal/deploy/resolver.go` (the M3.5 indirection layer); `blueprint.md` §11.1 (no Fly outside `FlyDeployTarget`); changelog 0.5.1 (resolver structural pre-payment).

---

## Problem statement

Corellia's v1 boot path reads **one** Fly credential pair from env (`FLY_API_TOKEN`, `FLY_ORG_SLUG`) and uses it for every spawn. This is correct for a hackathon-scoped operator-run instance, but it is the wrong shape for the product Corellia is becoming. The vision (`vision.md`) is a vendor-neutral control plane where users add **their own** infrastructure accounts — Fly today, AWS / Hetzner / NixOS / on-prem next — and Corellia spawns agents into them.

Three concrete problems block that evolution:

- **One credential serves all users.** The boot-time token is platform-global. There is no path for "user A's agents deploy to user A's Fly org; user B's agents deploy to user B's AWS account."
- **The token shape we'd ask users to paste is wrong.** Phase 7 surfaced that Fly has two APIs (GraphQL + Machines) with asymmetric token-scope gates. Personal Access Tokens (PATs) work against both but grant full account power forever — equivalent to handing Corellia an AWS root key. The provider-correct answer is *org-scoped macaroons* (Fly), *IAM roles via STS* (AWS), *project API tokens* (Hetzner), each acquired through that provider's narrowest-capability flow.
- **Credentials must never live in Corellia's database.** The same rule M4 applied to the model API key (`secrets` table holds `storage_ref` not `value`, decision 7) extends to deploy-target credentials. The DB references a secret-store entry; the raw token never touches Postgres.

The structural pre-payment from M3.5 (`deploy.Resolver`) anticipated this — but the credential surface itself was never designed past "two env vars on the operator's machine."

## What we actually need (capability list)

`FlyDeployTarget` exercises exactly these flaps endpoints: `CreateApp`, `DeleteApp`, `SetAppSecret`, `Launch`, `List`, `Stop`. The narrowest token that satisfies all of these is an **org-scoped Fly token** (e.g. `fly tokens create org -o <slug>`). Any future deploy target's adapter will declare its own minimum-capability set; the credential acquisition flow asks the provider for a token that satisfies exactly that.

## Proposed solutions

### Operator-loop fix (Phase 7 unblocker — today)

Stop using PATs even in dev. Switch the operator's `backend/.env` to an **org-scoped Fly token** minted via `fly tokens create org -o personal`. This is byte-compatible with the v1 code path (still one token, still env-loaded) **and** is the same token *shape* users will eventually supply via the connect flow. We dogfood the production credential model from day one without changing any code.

- ✅ Unblocks Phase 7 immediately.
- ✅ Validates the Machines API path with the production-correct token shape, not a dev shortcut.
- ✅ Zero code change.

### v1.5 — Per-user deploy targets (the real product evolution)

Three additive changes, none of which require touching `agents.Service` (the resolver indirection from 0.5.1 is exactly what shields it):

- **Schema.** Extend `deploy_targets` with `owner_org_id`, `display_name`, `credentials_storage_ref`. One row per user-supplied destination. Today's seed row (`('fly', 'fly', true)`) becomes the operator-fallback target; user-added targets are additional rows. RLS deferred per v1 baseline; authorization stays in `agents.Service` (must own the target to spawn into it).
- **Resolver.** `resolver.For(ctx, kind)` evolves to `resolver.For(ctx, deployTargetID)`. The resolver loads the row, fetches credentials from the secret store via `credentials_storage_ref`, constructs a per-call `FlyDeployTarget` with those creds, and hands it to the service. Service-layer code is unchanged — this is the value of the M3.5 indirection.
- **Connect flow (UI + adapter-specific).** Each provider declares its credential acquisition method:
  - **Fly:** OAuth flow (Fly supports it). User clicks "Connect Fly account" → redirected to Fly → Fly mints an org-scoped macaroon with the capability caveats Corellia's adapter declares → token returned to Corellia → stored in secret store. **No paste-the-token UX.**
  - **AWS (post-v1.5):** IAM role assumption via STS. User pastes role ARN + external ID; Corellia assumes the role per-spawn. No long-lived credentials in Corellia.
  - **Hetzner / fallback providers:** paste-the-token UX is acceptable when no OAuth equivalent exists, but the UI labels capability scope explicitly ("This token allows: create/destroy servers in project X").

The credential-acquisition method is the variable; the storage shape (`credentials_storage_ref` → secret store) is invariant.

### What does **not** change

- `internal/deploy/fly.go` is still the only place that imports `fly-go` (blueprint §11.1 holds).
- `agents.Service` never sees a credential — it only sees a `DeployTarget` interface.
- The model API key (per `AgentInstance`) and the deploy credential (per `DeployTarget`) are independent secrets in independent rows. Stay that way.

## Hand-off items to record now

Two breadcrumbs worth committing before they evaporate:

- **`// TODO(v1.5):`** on `FlyCredentials` in `internal/deploy/fly.go:33` — "v1.5 splits this: per-target credentials loaded by resolver from secret store; boot-time `FLY_API_TOKEN`/`FLY_ORG_SLUG` becomes the operator-only fallback for the platform's own service-account."
- **`blueprint.md`** §X — new section: "Deploy target credentials are per-user, secret-store-backed, OAuth-acquired where the provider supports it, paste-as-fallback otherwise. Never PATs from users. The macaroon/role caveats define the capability contract; the adapter declares the minimum set it needs."

## Open questions

- **Operator-fallback policy.** When v1.5 lands, does the boot-time `FLY_API_TOKEN` env path stay (as the platform's own service-account, e.g. for Corellia's own dogfood deployments) or get retired in favour of all targets being row-backed? Probable answer: stay, but treat it as a hidden built-in `deploy_target` row.
- **Token rotation UX.** How does a user rotate / revoke a connected account? Lifecycle of the secret-store entry vs the `deploy_targets` row.
- **Caveat declaration.** Does each `DeployTarget` implementation need a formal `RequiredCapabilities()` method that the connect flow consumes? Or is the capability set hardcoded per-provider in the connect-flow handler? Probably the latter for v1.5; former is a v2 abstraction.
