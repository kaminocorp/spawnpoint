# Toolchain Overview

One-liner reference for every framework, library, and CLI tool the Corellia codebase touches. Grouped by role. When a pick changes, update the matching entry here.

Companion docs:
- `stack.md` — the *why* behind each pick, with rationale and tradeoffs
- `CLAUDE.md` — operational rules (env loading, commands, conventions)

---

## Build & dev orchestration

- **overmind** — `tmux`-based Procfile runner. Reads `Procfile.dev` (`web:` + `api:`) and boots both halves in one command, with per-process panes you can attach to and `Ctrl-c` independently. Replacement for Heroku's `foreman`, but better.
- **air** — Go file-watcher with hot reload. Watches `backend/**/*.go`, rebuilds the binary, restarts it on change. The Go equivalent of `nodemon`.
- **direnv** — Per-directory env auto-loader. `cd backend/` → it auto-`source`s `backend/.env` into your shell; `cd ..` → unloads. Makes `goose` and ad-hoc CLI tools see the same env as the Go binary.
- **godotenv/autoload** — Go library imported as `_ "github.com/joho/godotenv/autoload"`. Auto-reads `.env` from the binary's cwd at process start. The reason `air` Just Works without sourcing.

## Codegen toolchain

- **buf** — Protobuf build tool. Wraps `protoc`, manages plugins via `buf.gen.yaml`, runs `buf generate` to emit Go + TS from `shared/proto/`. Modern replacement for raw `protoc` invocations.
- **Connect-go** — RPC framework on top of Protobuf. Generates idiomatic Go server interfaces and TS clients; speaks plain HTTP/1.1 with JSON or protobuf bodies (curl-able, no HTTP/2 ingress requirement).
- **sqlc** — SQL → Go codegen. Reads `backend/queries/*.sql` + the migration schema, emits typed Go query functions into `backend/internal/db/`. You write SQL, not query-builder DSLs.
- **goose** — Go-native SQL migration runner. Applies versioned `.sql` files in `backend/migrations/`, tracks state in `goose_db_version` table.

## Backend (Go)

- **Chi** — Stdlib-shaped HTTP router. Hosts the Connect handler mounts under `r.Group(auth.Middleware(...))`; minimal magic.
- **pgx / pgxpool** — Postgres driver + in-process connection pool for Go. The pool acts as a transaction-level multiplexer; thousands of goroutines share a bounded pool of ~10 backends.
- **caarlos0/env** — Struct-tag-based env var parser. Powers `internal/config/`; panics at startup if required vars are missing.
- **golang-jwt/jwt** — JWT parsing + validation. Used by the auth middleware to verify Supabase ES256 tokens against the cached JWKS.
- **slog** — Go 1.21+ stdlib structured logger. Used everywhere; the redacted-default error pattern in handlers funnels driver errors through `slog.Error(...)` before returning `Internal` to the wire.

## Frontend (Next.js)

- **Next.js 15 (App Router)** — React metaframework. RSC streaming, file-based routing under `frontend/src/app/`, route groups like `(app)/` for shared layouts.
- **Tailwind CSS** — Utility-class CSS framework. The `className="grid grid-cols-1 md:grid-cols-2"` style.
- **shadcn/ui** — *Not* a library — a CLI that copies React component source into your repo. Lives under `frontend/src/components/ui/`. You own the code, no version-bump surprises.
- **base-ui** — Headless UI primitives (Radix-style) that shadcn's `base-nova` registry uses under the hood. Why your `<TooltipTrigger render={<span/>}>` works instead of Radix's `asChild`.
- **@supabase/supabase-js** — Supabase client SDK. Used *only* for sign-in / session / token reading per `stack.md` §4.
- **@supabase/ssr** — Cookie-based session helper for Next.js App Router. Persists the Supabase session as an HTTP-only cookie so SSR renders can read it.
- **Connect-ES** — TS counterpart to Connect-go. Generates the typed RPC client (`api.agents.listAgentTemplates({})`) imported from `frontend/src/gen/`.
- **react-hook-form + zod** — Form state + schema validation. The "RPG character creation" deploy form (M4) will use these.
- **pnpm** — JS package manager with strict hoisting and workspace support. Faster + smaller `node_modules` than npm/yarn classic.

## Auth & DB

- **Supabase Auth** — JWT issuer. Issues ES256-signed access tokens; backend validates offline against cached JWKS.
- **Supabase Postgres** — Hosted Postgres with branching. Direct Connection host for app + migrations; auth schema bundled in same DB.

## Deploy

- **Fly.io** — VM platform built on Firecracker microVMs. Backend deploys here as one app (`corellia-api`); spawned agents will each get their own Fly app (`corellia-agent-<uuid>`).
- **Vercel** — Next.js hosting. One-click deploy of `frontend/`, preview URL per PR.
