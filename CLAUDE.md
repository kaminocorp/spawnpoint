# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Corellia is a control plane for AI agents — spawn, deploy, govern, and manage agents across any model, provider, or harness framework. v1 is a hackathon-scoped MVP: one harness (Hermes), one deploy target (Fly.io), Supabase auth, Go backend + Next.js frontend.

**Current state: scaffolding phase.** Backend is scaffolded through the `GetCurrentUser` RPC pipeline plus an ES256/JWKS auth middleware and an `auth.users` → `public.users` provisioning trigger; frontend is scaffolded end-to-end through sign-in + dashboard. No Dockerfile/fly.toml yet. Nothing is deployed. The historical step-by-step recipes live under `docs/archive/{backend,frontend}-scaffolding.md`; live code is authoritative.

## Doc hierarchy (read these when context is needed)

Precedence — the higher doc wins on conflict:

1. `docs/blueprint.md` — product architecture, data model (§9), **architecture rules (§11)**, MVP scope (§1)
2. `docs/stack.md` — tech picks with rationale, monorepo layout (§2), **implementation rules (§11)**, env vars (§8)
3. `docs/archive/backend-scaffolding.md` / `docs/frontend-scaffolding.md` — step-by-step recipes with starter code; backend's is archival (live code supersedes), frontend's is still live as the FE half is the more recent scaffold
4. `docs/vision.md` — product framing (admin/policy-setter model, "garage of harnesses")

Scaffolding docs are recipes; once a file is scaffolded, the live code is authoritative. Update the docs only if the *approach* changes before scaffolding. (Backend hit that point in 0.1.0 — hence the archive move; frontend is converging on it.)

## Architecture at a glance

```
corellia/
├── backend/         Go 1.26 service (Chi + Connect-go + pgx + sqlc)
├── frontend/        Next.js 15 App Router (not yet scaffolded)
├── shared/proto/    Proto IDL — the only FE↔BE contract surface
├── docs/            vision, blueprint, stack, scaffolding recipes
├── go.work          Go workspace: `use ./backend`
└── .env.example     committed template (real env: backend/.env + frontend/.env.local, both gitignored)
```

Go module path: `github.com/hejijunhao/corellia/backend` (where scaffolding docs use `<mod>`).

### Backend layout (`backend/internal/`)

- `auth/` — Supabase JWT middleware (ES256, offline validation via cached JWKS from Supabase's well-known endpoint; initial fetch at boot, background hourly refresh, unknown-`kid` refetch rate-limited to one per 5 min). Attaches `AuthClaims{AuthUserID, Email}` to request context. No DB access here — user provisioning is a domain concern.
- `config/` — env var loading via `caarlos0/env`. The **only** place that touches `os.Getenv`. Panics on missing required vars at startup.
- `db/` — sqlc-generated types + queries. `pool.go` is the only hand-written file here; everything else is generated from `migrations/` + `queries/`.
- `gen/corellia/v1/` — buf-generated Go from `shared/proto/`. Never hand-edit.
- `httpsrv/` — Chi router, CORS, auth middleware wiring, Connect handler mounts. Handlers are thin (<30 lines); they parse → call domain → marshal response.
- `users/` — domain service (first example). Domain packages own business logic.
- Planned packages (blueprint §9, not yet present): `agents/`, `adapters/`, `deploy/`.

### The contract boundary

Frontend and backend communicate **exclusively via Connect-go RPCs** over HTTP/1.1. Proto files in `shared/proto/corellia/v1/` are the single source of truth; `buf generate` emits Go (`backend/internal/gen/`) and TS (`frontend/src/gen/`, eventually) simultaneously. **Both generated trees are committed** and CI fails on drift.

Frontend uses Supabase client **only for auth** (sign-in, session). All application data flows through Connect RPCs. No direct SQL, no Supabase REST for app data. See stack.md §4 and rule §11.10.

### Database connection — two URLs, both Direct Connection

Both `DATABASE_URL` and `DATABASE_URL_DIRECT` point at Supabase's **Direct Connection** host (`db.<project-ref>.supabase.co:5432`, IPv6). The split is *role and lifecycle*, not host:

- `DATABASE_URL` — app runtime, read by `config.Load()` at boot, consumed by `pgxpool`. Will later downgrade to a restricted `corellia_app` role (non-RLS-bypassing).
- `DATABASE_URL_DIRECT` — migration-only, shell-sourced by `goose`. Stays on the `postgres` superuser role (needed for DDL on Supabase's `auth` schema triggers). Deliberately **not in `config.Config`** so the Go binary never holds superuser credentials.

**Why Direct, not an external pooler.** `pgxpool` is an in-process transaction pooler: each `db.QueryContext` call leases a backend for the query's duration only and returns it immediately; a `BeginTx` block leases for the transaction's duration. A single Go process serves thousands of concurrent HTTP goroutines off a bounded pool (`MaxConns=10`), so Postgres backend count scales with *Go instance count*, not user count. An external transaction pooler (Supavisor `:6543`) would stack a redundant multiplexer across a network hop *and* break pgx's prepared-statement cache (which sqlc relies on). **Never transaction pooling.** The Session Pooler (`*.pooler.supabase.com:5432`) is the **IPv4 fallback** only — swap `DATABASE_URL` for the Session Pooler form if your local network can't reach the Direct host over IPv6; drop-in compatible, no code change.

**Ceiling math.** Postgres caps concurrent backends at ~500 on managed instances. With `pgxpool.MaxConns=10`, we exhaust that only at ~50 Go backend instances — well past any v1/v2 scale. The eventual jump from Direct to Supavisor **session** mode (not transaction mode) happens when horizontal-scaling operational concerns bite (connection storms on rolling deploys, centralized limits across many instances), not before.

## Architecture rules (blocking — treated as defects if broken)

From `blueprint.md` §11 and `stack.md` §11. The non-obvious ones:

1. **No Fly-specific code outside `internal/deploy/FlyDeployTarget`.** Everything else sees only the `DeployTarget` interface.
2. **AgentTemplates pin by Docker image digest, never by mutable tag.** Governance primitive — no exceptions.
3. **Harness configuration flows through `CORELLIA_*` env vars.** Adapters translate these to harness-native names; Corellia code never reaches into a harness's native env var names.
4. **Deferred features are stubbed as real interface implementations, not fake UI buttons.** A `DeployTarget` returning `NotImplemented` is acceptable; a non-functional button is not.
5. **No forking of upstream harnesses.** Capabilities are added via adapter wrappers or sidecars.
6. **No Supabase specifics outside `internal/auth/` and `internal/db/`.**
7. **Generated code (`internal/gen/`, `internal/db/` — every file except `db/pool.go`) is never hand-edited.** Treat it like `node_modules`.
8. **All env vars read through `internal/config/`.** Config validates and panics at startup; domain code receives a typed `Config` struct.
9. **Business logic never in Connect handlers.** Handlers stay <30 lines — parse, call domain, marshal.
10. **Frontend never reaches Supabase for application data** — RPCs only.

## Common commands

Run from the indicated directory.

### Codegen (run after changing proto or SQL)

```bash
# Proto → Go + TS (from repo root; script wraps `buf generate shared/proto`)
pnpm proto:generate

# SQL → Go (from backend/)
sqlc generate
```

Both generated trees are committed. CI runs generation and diffs against HEAD.

### Migrations (always via DATABASE_URL_DIRECT)

```bash
# Run from backend/ — direnv auto-loads DATABASE_URL_DIRECT from backend/.env on cd
goose -dir migrations postgres "$DATABASE_URL_DIRECT" up
goose -dir migrations postgres "$DATABASE_URL_DIRECT" down
goose -dir migrations create <name> sql
```

### Running locally

```bash
# Backend with hot reload (from backend/). Auto-loads .env via godotenv/autoload.
air

# Or plain build/run
cd backend && go build -o bin/api ./cmd/api && ./bin/api

# Once both halves exist, from repo root:
overmind start                # reads Procfile.dev; boots FE + BE together
```

### Testing + checks

```bash
cd backend && go vet ./...
cd backend && go test ./...                   # all packages
cd backend && go test ./internal/users -run TestX   # single test

# Once frontend/ exists:
pnpm -C frontend type-check
pnpm -C frontend lint
pnpm -C frontend build
```

## Testing conventions

- Table-driven unit tests for `internal/*` packages with branching logic; colocated `<file>_test.go`.
- **No DB mocks.** sqlc generates thin SQL wrappers — mocking them tests nothing. Use real Postgres via testcontainers-go or a local dev DB.
- No Playwright / E2E in v1. The deployed RPC round-trip is the integration smoke test.

## Environment

Per-app env files, both gitignored: `backend/.env` (backend vars; auto-loaded by `godotenv/autoload` from the Go binary's cwd) and `frontend/.env.local` (frontend vars; auto-loaded by Next.js from the `frontend/` project root). `.env.example` at repo root is the single committed template documenting every var both halves read. **Recommended local setup: install `direnv` (`brew install direnv` + `eval "$(direnv hook zsh)"` in `~/.zshrc`) and `direnv allow` in `backend/` and `frontend/` once.** The committed `backend/.envrc` and `frontend/.envrc` auto-load the appropriate env file into your shell on `cd`, so `goose`, `go test`, and any other in-directory CLI tool sees the same env as the Go binary. Without direnv, `goose` migrations require manual sourcing: `set -a; source backend/.env; set +a`. Required backend vars (panic-on-missing): `DATABASE_URL`, `SUPABASE_URL`, `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN`. The JWKS URL for JWT validation is derived from `SUPABASE_URL` — no separate secret needed. `DATABASE_URL_DIRECT` lives in `backend/.env` but is shell-sourced for `goose`, never read by `config.Load()`. Shared Supabase values (`SUPABASE_URL` / `SUPABASE_ANON_KEY` ↔ their `NEXT_PUBLIC_*` twins) are duplicated across the two files by design; values must match.
