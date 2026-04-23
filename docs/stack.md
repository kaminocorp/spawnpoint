# Corellia — Implementation Stack (v1)

Concrete engineering picks for v1. Companion docs:

- `vision.md` — the product vision
- `blueprint.md` — *what* we're building and the architecture rules (esp. §11)
- `stack.md` (this doc) — *how* we're building it: tools, layout, pipelines,
  deploy. The "why these picks" reference.
- `backend-scaffolding.md` — step-by-step recipe for creating `backend/`,
  with starter file contents
- `frontend-scaffolding.md` — step-by-step recipe for creating `frontend/`,
  with starter file contents

When picks change, update this document. Blueprint rules (especially §11)
still win when any rule in this doc conflicts with them. The scaffolding
docs are recipes; once scaffolding is complete, the live code is
authoritative.

---

## 1. Stack summary

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend framework | Next.js 15 (App Router) + TypeScript | RSC streaming for fleet view; pure FE role (no Server Actions doing business logic) |
| Frontend styling | Tailwind + shadcn/ui | Form-heavy admin UI; shadcn + react-hook-form + zod for §10 flow |
| Frontend auth client | `@supabase/supabase-js` + `@supabase/ssr` | Cookie-based SSR sessions; native to Next.js App Router |
| API contract | Protobuf + Connect-go (Buf toolchain) | Single `.proto`, generates Go server + TS client; HTTP/1.1 wire format |
| Backend language | Go 1.22+ | Idiomatic fit for an orchestrator: goroutines for "spawn N agents" fan-out, strong typing, single static binary |
| Backend router | Chi | Stdlib-shaped, minimal magic; mounts Connect-go handlers as `http.Handler` |
| Backend ORM | sqlc | Write SQL, get typed Go — no runtime query-builder surprises |
| Migrations | goose | Simple, Go-native, owned by the backend project |
| Auth issuer | Supabase Auth | JWTs validated in Go middleware via shared HMAC secret |
| Database | Supabase Postgres | Hosted, pooled, branching; shares vendor with auth |
| JS package manager | pnpm (workspaces) | Monorepo ergonomics, strict hoisting |
| Go workspace | `go.work` → `backend/` | Standard Go multi-module setup |
| Local orchestration | overmind + `Procfile.dev` | One command boots FE + BE with hot reload |
| Backend hot reload | [air](https://github.com/air-verse/air) | Go file-watcher |
| Frontend deploy | Vercel | One-click Next.js; preview URLs per PR |
| Backend deploy | Fly.io | Dogfood the infrastructure we're orchestrating |

---

## 2. Monorepo layout

```
corellia/
├── frontend/                   Next.js 15 App Router
│   ├── src/
│   │   ├── app/                routes, layouts, pages
│   │   ├── components/         UI components (shadcn + custom)
│   │   ├── lib/                FE-only utilities (supabase client, hooks, etc.)
│   │   └── gen/                generated Connect-go TS client (do not hand-edit)
│   ├── public/
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                    Go service
│   ├── cmd/
│   │   └── api/
│   │       └── main.go         HTTP server entrypoint
│   ├── internal/
│   │   ├── agents/             domain: spawnAgent, stopAgent, ...
│   │   ├── adapters/           HarnessAdapter resolution, digest pinning
│   │   ├── deploy/             DeployTarget interface + FlyDeployTarget
│   │   ├── db/                 sqlc-generated types + queries
│   │   ├── auth/               Supabase JWT middleware
│   │   ├── config/             env var loading + validation (fails fast)
│   │   ├── httpsrv/            Chi setup, middleware stack, Connect handler mount
│   │   └── gen/                generated Connect-go Go server code (do not hand-edit)
│   ├── queries/                sqlc input (raw SQL per domain)
│   ├── migrations/             goose-managed SQL migrations
│   ├── Dockerfile              for Fly deploy
│   ├── fly.toml                Fly app config
│   └── go.mod
│
├── shared/                     language-neutral contracts (Proto IDL, future OpenAPI, etc.)
│   └── proto/
│       ├── buf.yaml
│       ├── buf.gen.yaml
│       └── corellia/v1/*.proto
│
├── docs/                       vision, blueprint, stack (this file), research
├── Procfile.dev                overmind config: web + api
├── pnpm-workspace.yaml         declares `frontend` as a workspace
├── go.work                     Go workspace file: `use ./backend`
├── turbo.json                  (optional) task caching for FE builds
├── .env.example                committed template; real .env is gitignored
├── .gitignore
└── README.md
```

### Layout rules

1. **No cross-contamination.** `frontend/` never imports from `backend/` or
   vice versa. The *only* shared surface is code generated from
   `shared/proto/` into `frontend/src/gen/` and `backend/internal/gen/`.
2. **`shared/` is contract-only, no source code.** Proto IDL, OpenAPI
   specs, JSON Schema, and similar language-neutral contracts live here.
   Never Go, never TS, never any language-specific implementation code. If
   you feel the urge to add `shared/utils/` or `shared/types/`, stop —
   that code belongs in `frontend/` or `backend/` (or, if truly shared,
   needs a rethink about what "shared" means).
3. **Generated code is committed.** Both `frontend/src/gen/` and
   `backend/internal/gen/` are checked in. This keeps builds reproducible
   without requiring every environment to run codegen.
4. **Generated code is never hand-edited.** Anyone editing it is treated
   the same as editing `node_modules`: the change will be blown away by the
   next `buf generate` and the diff should be rejected in review.

---

## 3. API contract: Proto + Connect-go

### Why Connect-go (not gRPC, not OpenAPI)

- **Single source of truth.** The `.proto` file defines service, methods,
  request shapes, and response shapes in one place. Both halves of the
  stack import from it.
- **HTTP/1.1 wire format.** Connect speaks plain HTTP/1.1 with JSON or
  Protobuf bodies. No gRPC ingress, no HTTP/2 requirement, `curl`-able in
  a terminal.
- **First-class TS and Go codegen.** The Buf ecosystem generates idiomatic
  clients for both — no OpenAPI-style "close enough" translation.
- **Streaming ready.** Unary-only for v1, but server-streaming is free if
  v2 needs "tail agent logs" over a single long-lived call.

### Where .proto files live

Authored in `shared/proto/corellia/v1/`. Placed under the root `shared/`
folder (not `backend/proto/`) to signal that Proto is a **language-neutral
contract between the two halves**, not a backend-owned artifact. The `v1`
package namespace is permanent — breaking changes go to `v2`, never
silent edits to `v1`.

### Codegen pipeline

Driven by `buf.gen.yaml` in `shared/proto/`. Emits:

- `backend/internal/gen/` — Go server interfaces and types
- `frontend/src/gen/` — TS client + message classes

Trigger:

```bash
# from repo root
pnpm proto:generate     # wraps `buf generate shared/proto`
```

A `buf generate` runs in CI on every PR; drift between `.proto` changes
and committed generated code fails the build.

### File organization convention

- One `.proto` file per domain area: `agents.proto`, `adapters.proto`,
  `deploy.proto`, `auth.proto`.
- One service per file. Messages used only by that service also live in
  that file; messages shared across services live in `shared.proto`.

---

## 4. Frontend / Backend contract boundary

The two halves communicate exclusively through Connect-go RPCs. No direct
SQL from FE, no Supabase REST calls from FE for application data (only for
auth). This keeps the BE as the single enforcement point for application
logic.

Supabase client on FE is used strictly for:

- Sign-in / sign-up / password reset / session management
- Reading the current session to obtain the access token

Every RPC call attaches the Supabase access token as
`Authorization: Bearer <token>`. The Go middleware validates and loads the
corresponding user from `public.users`.

---

## 5. Auth flow (Supabase ↔ Go)

### Sign-in (frontend)

1. User enters credentials in the Supabase Auth UI (or a custom form).
2. `@supabase/supabase-js` issues the sign-in call, receives a session
   (access token JWT + refresh token).
3. `@supabase/ssr` persists the session as an HTTP-only cookie so SSR
   renders can read it.
4. All subsequent RPC calls read the access token from the Supabase client
   and attach it as a Bearer header.

### Request validation (backend)

1. Chi middleware reads `Authorization: Bearer <token>`.
2. Validates JWT signature against `SUPABASE_JWT_SECRET` (HS256).
3. Extracts `sub` (Supabase auth user UUID) and `email`.
4. Loads the corresponding row from `public.users` (by `auth_user_id`
   column). If not found, auto-provisions the row on first request.
5. Attaches the loaded `User` to the request context.

### JWT validation is offline

No network call to Supabase to validate a token. Shared secret + HMAC
signature check is enough. Token expiry is enforced (default: 1 hour),
refresh happens on the FE via `@supabase/supabase-js`.

---

## 6. Data model ↔ Supabase

Blueprint §9 defines the schema. Implementation specifics:

- All Corellia tables live in Postgres' default `public` schema.
- `public.users` holds a FK `auth_user_id UUID REFERENCES auth.users(id)`.
  The Supabase `auth` schema is read-only from application code.
- **Row-Level Security (RLS) is disabled in v1.** Go BE has full DB
  access via the connection string; authorization is enforced in
  application code in `backend/internal/agents/` etc.
- Migrations live in `backend/migrations/` and are run by `goose`:
  ```bash
  goose -dir backend/migrations postgres "$DATABASE_URL" up
  ```
  Committed SQL files; no Supabase CLI dependency.
- sqlc reads from `backend/queries/*.sql` + `backend/sqlc.yaml` and emits
  typed Go query functions into `backend/internal/db/`.

---

## 7. Local development

### Prerequisites

- Node 20+ via [Volta](https://volta.sh) or nvm
- pnpm 9+
- Go 1.22+
- [air](https://github.com/air-verse/air): `go install github.com/air-verse/air@latest`
- [goose](https://github.com/pressly/goose): `go install github.com/pressly/goose/v3/cmd/goose@latest`
- [overmind](https://github.com/DarthSim/overmind): `brew install overmind`
- [buf](https://buf.build): `brew install bufbuild/buf/buf`
- A Supabase project (dev) with credentials in `.env`

### First-time setup

```bash
pnpm install                                 # installs frontend deps
go work sync                                 # syncs Go workspace
pnpm proto:generate                          # emits generated Go + TS
goose -dir backend/migrations postgres "$DATABASE_URL" up
```

### Running locally

```bash
overmind start                               # boots both halves with hot reload
# — or individually —
pnpm -C frontend dev                         # Next.js on :3000
cd backend && air                            # Go API on :8080
```

Both processes read `.env` (repo-root, gitignored). `.env.example` is the
committed template.

---

## 8. Environment variables

Single `.env` at repo root, read by both halves. Validated on startup — Go
config package panics on missing required vars; Next.js fails the build.

| Var | Consumer | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | backend | Postgres connection string (Supabase pooler URL) |
| `SUPABASE_URL` | both | Supabase project URL |
| `SUPABASE_ANON_KEY` | frontend | Public anon key, safe for client bundle |
| `SUPABASE_SERVICE_KEY` | backend (rare) | Service-role key for admin ops; avoid if possible |
| `SUPABASE_JWT_SECRET` | backend | HMAC secret for validating access tokens |
| `FLY_API_TOKEN` | backend | Calls Fly's GraphQL API to spawn apps/machines |
| `FLY_ORG_SLUG` | backend | Fly organization to create apps under |
| `PORT` | backend | HTTP listen port (default 8080) |
| `NEXT_PUBLIC_API_URL` | frontend | BE base URL (e.g., `http://localhost:8080`) |

---

## 9. Build pipelines

### Codegen (must run before build on any proto change)

```bash
pnpm proto:generate     # wraps `buf generate` for both FE and BE
pnpm sqlc:generate      # regenerates sqlc Go code from queries/*.sql
```

### Frontend build

```bash
pnpm -C frontend build
```

Produces `.next/` output. Deployed by Vercel automatically on push.

### Backend build

```bash
cd backend && go build -o bin/api ./cmd/api
```

Fly's Dockerfile runs this inside a multi-stage build and produces a
static binary.

### CI checks (per PR)

- `pnpm install --frozen-lockfile`
- `pnpm proto:generate` + `pnpm sqlc:generate` + `git diff --exit-code`
  (fails if generated code is stale)
- `pnpm -C frontend type-check`
- `pnpm -C frontend lint`
- `cd backend && go vet ./... && go test ./...`
- `cd backend && go build ./...`

---

## 10. Deploy

### Frontend (Vercel)

- Connect GitHub repo, set project root to `frontend/`.
- Env vars configured in Vercel dashboard.
- Auto-deploys `main`; preview URLs per PR.

### Backend (Fly.io)

- App name: `corellia-api`.
- Config lives in `backend/fly.toml`.
- Deploy:
  ```bash
  cd backend && fly deploy
  ```
- Secrets stored as Fly app secrets (`fly secrets set KEY=VALUE`), never
  in `fly.toml` or git.

### Agent Fly apps (spawned by Corellia itself)

These are separate Fly apps, one per `AgentInstance`, created
programmatically by `FlyDeployTarget`. Naming:
`corellia-agent-<instance-uuid>`. Lifecycle is fully owned by Corellia.

---

## 11. Architecture rules — implementation additions

Extends blueprint §11. Same blocking-rule status.

6. **No Supabase-specific code outside `backend/internal/auth/` and
   `backend/internal/db/`.** Domain code sees `User` structs and repository
   interfaces, not raw Supabase clients or JWT internals.
7. **Generated code (`*/gen/`) is committed but never hand-edited.**
   Treat as read-only. Drift is caught in CI.
8. **All env vars read through `backend/internal/config/`.** The config
   package is the single place that reads `os.Getenv`; it validates at
   startup and panics on missing required vars. Domain code receives a
   typed `Config` struct.
9. **Business logic never lives in Connect handlers.** Handlers in
   `backend/internal/httpsrv/` (or wherever the handler glue lives) parse
   the RPC request, call into domain packages (`agents`, `deploy`, etc.),
   and marshal the response. Handlers should be <30 lines each.
10. **Frontend never reaches into Supabase for application data.**
    Application data flows through Connect-go RPCs exclusively. Supabase
    client is for auth (sign-in, session) only.

---

## 12. Hour-zero scaffolding order

The "prove the pipeline works before writing product code" milestone.

1. **Hour 0–1.** Monorepo skeleton: `frontend/` scaffolded via
   `create-next-app`, `backend/` with `go mod init`, `shared/proto/`
   with first `.proto` file, `Procfile.dev`, `.env.example`, `.gitignore`.
2. **Hour 1–2.** Supabase project created. First migration applied
   (users + organizations + agent_templates + agent_instances from
   blueprint §9). sqlc emits typed queries.
3. **Hour 2–3.** Auth end-to-end: Next.js sign-in page (Supabase), Go
   middleware validates JWT and loads user.
4. **Hour 3–4.** First Connect-go RPC: `GetCurrentUser`. FE calls it
   with the session token, BE returns the user row, FE renders the
   email.
5. **Hour 4–5.** Both halves deployed. FE on Vercel with preview URL,
   BE on Fly with its own URL. CORS configured, end-to-end works in
   production.
6. **Hour 5+.** Start product code — `HarnessAdapter`, `AgentTemplate`,
   `FlyDeployTarget.spawn()`, the RPG character-creation flow, fleet
   view.

If we hit end of hour 5 with "deployed, signed-in, RPC working," the
hackathon is already in a winning position. If we're behind at hour 8,
we triage scope — never plumbing.

---

## 13. Known deferrals (implementation-specific)

Things deliberately left out of v1 beyond blueprint §13:

- No shared UI package between apps (frontend owns its components).
- No GitHub Actions or Turbo remote caching in v1 — ship without CI
  if necessary.
- No end-to-end tests (Playwright) in v1 — Go unit tests on domain
  packages only.
- No observability stack beyond Fly's native logs.
- No feature flagging.
- No internationalization.
- No dark mode beyond whatever shadcn gives us for free.
