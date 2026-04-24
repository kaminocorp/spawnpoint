<div align="center">
  <img src="docs/assets/logo.png" alt="Corellia" width="320" />

  <h1>Corellia</h1>

  <p><b>A vendor-neutral control plane for AI agents.</b><br/>
  Spawn, deploy, govern, and manage agents across any model, any provider, any framework.</p>

  <p>
    <a href="docs/vision.md">Vision</a> ·
    <a href="docs/blueprint.md">Blueprint</a> ·
    <a href="docs/stack.md">Stack</a> ·
    <a href="docs/changelog.md">Changelog</a>
  </p>
</div>

---

## Why Corellia

Organizations want to deploy AI agents at scale — a 250-person company might want *thousands* of agents, each with different skills, tools, data access, and responsibilities. Today that looks like stitching together five tools that each own one slice:

| The slice | Point tool |
|-----------|-----------|
| Orchestration | LangGraph, CrewAI |
| Deployment | LangGraph Platform |
| Tool permissions | Arcade.dev, Composio |
| Provider routing | Portkey, LiteLLM |
| Observability | Langfuse, Helicone |

**Corellia's bet:** the unified, vendor-neutral control plane *is* the product. Deployment is a commodity — governance, fleet management, and access control across *heterogeneous* agents is the unsolved problem.

> Think of it as **IAM for a fleet of agents**, not for a fleet of users.

---

## The "Garage" model

Agents are, at the end of the day, **harnesses wrapped around models**. Corellia treats them like vehicles in a garage — you pick one and drive.

- **Curated library** — pre-integrated harnesses ready to spawn. First one: the [Hermes Agent](https://github.com/NousResearch/hermes-agent) from Nous Research.
- **Bring your own** *(post-v1)* — import a custom agent or point Corellia at a public GitHub repo.

This works because of a **harness interface contract** — a spec for how Corellia talks to *any* agent, regardless of framework. Conceptually: LSP, but for agents. Define the spec once; every new framework becomes a one-time integration.

---

## Core pillars

1. **Agent lifecycle** — spawn, deploy, update, decommission
2. **Skills library** — reusable capabilities agents can be equipped with
3. **Context management** — files, documents, structured context
4. **Memory** — via third-party providers (Elephantasm, etc.)
5. **Permissions & access control** — IAM-style governance over tools, DBs, APIs
6. **Auditing & observability** — centralized visibility into what every agent is doing

---

## Who it's for

The **admin / policy-setter**, not the agent operator:

- Founders and co-owners
- Heads of department
- Solopreneurs running agents for themselves

Admins don't control agent behavior in real time. They define the **guardrails** within which agents operate autonomously — mirroring how AWS IAM or Okta work: the admin defines what is *possible*; the principal decides what *happens*.

---

## Status

**Scaffolding phase.** Building toward a hackathon-scoped v1 MVP.

| Area | State |
|------|-------|
| Backend scaffolding | ✓ Compiling; `GetCurrentUser` RPC pipeline wired |
| Frontend scaffolding | ✓ Next.js 16 + Supabase SSR + Connect-ES v2; `type-check` + `lint` clean |
| First migration | ✓ `organizations` + `users` tables |
| Auth (Supabase JWT) | ✓ Middleware validates; domain service provisions |
| Local bring-up (FE + BE) | ⏳ Needs populated env + seeded Supabase user |
| User provisioning flow | ⏳ Planned (see `docs/plans/auth-user-provisioning.md`) |
| Fly.io deploy target | ⏳ Interface exists; `FlyDeployTarget` not implemented |
| "RPG character creation" spawn flow | ⏳ Not started |
| Fleet view | ⏳ Not started |

See [`docs/changelog.md`](docs/changelog.md) for the full trail.

---

## Stack

| Layer | Pick |
|-------|------|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind v4 + shadcn/ui |
| API contract | Protobuf + Connect (Go server, ES client) |
| Backend | Go 1.26 + Chi router |
| ORM / queries | sqlc (typed Go from SQL) |
| Migrations | goose |
| Auth | Supabase Auth (HS256 JWT, offline validation) |
| Database | Supabase Postgres (Direct Connection; `pgxpool` pools in-process) |
| Frontend deploy | Vercel |
| Backend deploy | Fly.io (we dogfood the infra we're orchestrating) |
| Local orchestration | overmind + `Procfile.dev` |
| Env loading | `godotenv/autoload` + `direnv` |

---

## Repo layout

```
corellia/
├── backend/              Go service (Chi + Connect + pgx + sqlc)
│   ├── cmd/api/          HTTP entrypoint
│   ├── internal/
│   │   ├── agents/       domain: spawn, stop, list
│   │   ├── adapters/     HarnessAdapter resolution + digest pinning
│   │   ├── deploy/       DeployTarget interface + FlyDeployTarget
│   │   ├── auth/         Supabase JWT middleware
│   │   ├── config/       env loading (the ONLY place os.Getenv is allowed)
│   │   ├── db/           sqlc-generated queries (never hand-edit)
│   │   ├── gen/          buf-generated Connect server (never hand-edit)
│   │   ├── httpsrv/      Chi setup, Connect handler mounts (<30 lines each)
│   │   └── users/        domain service
│   ├── queries/          sqlc input — raw SQL per domain
│   └── migrations/       goose-managed SQL
│
├── frontend/             Next.js 16 App Router
│   └── src/
│       ├── app/          routes, layouts, pages
│       ├── components/   UI (shadcn + custom)
│       ├── lib/          supabase + connect clients
│       └── gen/          buf-generated TS client (never hand-edit)
│
├── shared/proto/         Proto IDL — the ONLY FE↔BE contract surface
├── docs/                 vision, blueprint, stack, changelog, scaffolding recipes
├── Procfile.dev          `overmind start` boots FE + BE together
└── go.work               Go workspace
```

---

## Getting started

### Prerequisites

```bash
# runtimes
node 20+                                           # via volta or nvm
pnpm 9+                                            # corepack enable
go 1.22+

# dev tools
go install github.com/air-verse/air@latest          # backend hot reload
go install github.com/pressly/goose/v3/cmd/goose@latest
brew install overmind bufbuild/buf/buf direnv
```

Add this once to `~/.zshrc`, then open a new shell:

```bash
eval "$(direnv hook zsh)"
```

### First-time setup

```bash
git clone <this repo> && cd corellia

# 1. Install deps
pnpm install
go work sync

# 2. Configure env — copy the template into per-app files
cp .env.example backend/.env                        # fill in DATABASE_URL, SUPABASE_*, etc.
cp .env.example frontend/.env.local                 # fill in NEXT_PUBLIC_* vars

# 3. Trust direnv in both app dirs (one-time)
direnv allow backend
direnv allow frontend

# 4. Generate code (commits in-repo, so this is a freshness check)
pnpm proto:generate

# 5. Apply migrations (DATABASE_URL_DIRECT is exported by direnv on `cd backend`)
cd backend && goose -dir migrations postgres "$DATABASE_URL_DIRECT" up
```

### Run it

```bash
# From repo root — boots FE (:3000) + BE (:8080) with hot reload
overmind start

# — or, individually —
pnpm -C frontend dev            # Next.js on :3000
cd backend && air               # Go API on :8080
```

Sign in at `http://localhost:3000/sign-in` with a user you created in the Supabase dashboard, and the dashboard will call `GetCurrentUser` over Connect — rendering the email it gets back is the "pipeline works" milestone.

### Everyday commands

```bash
# After editing a .proto file
pnpm proto:generate

# After editing a .sql file in backend/queries/
cd backend && sqlc generate

# New migration
cd backend && goose -dir migrations create <name> sql

# Checks
cd backend && go vet ./... && go test ./...
pnpm -C frontend type-check && pnpm -C frontend lint
```

---

## Architecture rules

These are **blocking** — breaking them is treated as a defect:

1. No Fly-specific code outside `internal/deploy/FlyDeployTarget`.
2. AgentTemplates pin by Docker image **digest**, never by mutable tag.
3. Harness config flows through `CORELLIA_*` env vars — adapters translate to harness-native names.
4. Deferred features are stubbed as real `NotImplemented` interface impls, not dead UI buttons.
5. No forking upstream harnesses — capabilities come via adapter wrappers or sidecars.
6. No Supabase specifics outside `internal/auth/` and `internal/db/`.
7. Generated code (`internal/gen/`, `internal/db/`) is never hand-edited — treat like `node_modules`.
8. All env vars read through `internal/config/` — panic at startup on missing required vars.
9. Connect handlers are <30 lines: parse → call domain → marshal.
10. Frontend uses Supabase *only* for auth — app data flows through Connect RPCs.

Full rationale in [`docs/blueprint.md §11`](docs/blueprint.md) and [`docs/stack.md §11`](docs/stack.md).

---

## Roadmap

**v1 (hackathon MVP)** — one harness (Hermes), one deploy target (Fly.io), catalog spawn flow, fleet view.

**v1.5** — repo linking with build pipeline, basic audit log, sidecar logging to a memory provider, per-agent cost visibility.

**v2** — programmatic adapter generation + validation suite, second deploy target (bare-metal / SkyPilot / AWS), LiteLLM model gateway, skills registry, IAM-style tool permissions.

**v3** — local / edge / on-prem via NixOS flakes, custom harness end-to-end, full observability pipeline, organizational policy layer (per-department / per-role / org-wide).

---

## The strategic framing

> **Deployment is a commodity; governance is the product.**

Every cloud solves deployment. Management, governance, access control, and fleet visibility across *heterogeneous* agents is the unsolved problem — and that's where engineering effort compounds.

Two tests applied to any decision:

1. **Is it reversible?** If yes (good abstraction shields the rest), pick the easiest option. If no, invest in making it reversible first.
2. **Does it differentiate?** Yes — harness contract, fleet view, IAM, audit — invest deeply. No — VM provider, container runtime — minimum viable attention.

---

## License

See [`LICENSE`](LICENSE).
