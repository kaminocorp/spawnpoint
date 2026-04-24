# Changelog

- [0.2.1 — Seeding Removed](#021--seeding-removed-2026-04-24)
- [0.2.0 — Frontend Scaffolding](#020--frontend-scaffolding-2026-04-24)
- [0.1.0 — Backend Scaffolding & Docs Reconciliation](#010--backend-scaffolding--docs-reconciliation-2026-04-24)

Latest on top. Each release has a tight index followed by detail entries (**What / Where / Why** inlined). When a decision contradicts an earlier one, note the supersession in the new entry rather than editing the old one.

---

## 0.2.1 — Seeding Removed (2026-04-24)

Removed all seeding from the backend: the default-org `INSERT` in the initial migration, the `defaultOrgID` constant and auto-provisioning branch in `users/service.go`, and the now-unused `CreateUser` query + its sqlc-generated artifacts. Supersedes 0.1.0's "seeds a default org + auto-provisions users on first login" behavior.

### Index
- Migration: default-org `INSERT` removed from `20260424120000_initial_schema.sql`.
- Query: `CreateUser` removed from `backend/queries/users.sql`; regenerated `backend/internal/db/users.sql.go` no longer contains `CreateUser` / `CreateUserParams`.
- Service: `defaultOrgID` constant and the auto-provisioning branch removed from `users/service.go`; `github.com/google/uuid` import dropped.
- `go vet ./...` + `go build ./...` clean.

### Details

**Seeding removed from migration.** Deleted the two-line `INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org');` and its comment from `backend/migrations/20260424120000_initial_schema.sql`. The `organizations` and `users` tables remain; only the seed row is gone. *Where:* `backend/migrations/20260424120000_initial_schema.sql`. *Why:* seeded rows are policy smuggled into schema. Provisioning the first org (and the first admin user) is a product decision that should live in an explicit bootstrap flow (admin invite, CLI, or a distinct policy migration), not a silent `INSERT` in the schema migration every dev applies.

**Auto-provisioning removed from domain service.** `users.Service.GetCurrentUser` no longer silently creates a `users` row when `GetUserByAuthID` returns no rows — the sqlc error bubbles up as-is. `defaultOrgID = uuid.MustParse("00000000-0000-0000-0000-000000000001")` constant removed; `github.com/google/uuid` import dropped (was only used by the constant). *Where:* `backend/internal/users/service.go`. *Why:* same rationale as the migration — provisioning is an admin decision, not a side effect of first login. A valid JWT with no matching `users` row should fail visibly rather than auto-granting membership to the seeded default org, which amounted to "anyone who signs in becomes an admin."

**`CreateUser` query removed.** The `-- name: CreateUser :one ...` block removed from `backend/queries/users.sql`; `sqlc generate` regenerated `backend/internal/db/users.sql.go` without `CreateUser` or `CreateUserParams`. *Where:* `backend/queries/users.sql`, `backend/internal/db/users.sql.go`. *Why:* auto-provisioning was the only caller. Per CLAUDE.md's "if you are certain that something is unused, delete it completely" rule, leaving `CreateUser` in place as a latent helper would be premature — when an actual provisioning flow arrives (admin invite, bootstrap migration, etc.), it'll define the INSERT it actually needs, which may or may not match today's shape.

### Behavior change (known)

A valid-JWT-but-no-`users`-row request to `GetCurrentUser` now returns `pgx.ErrNoRows` through the domain service. The handler (`httpsrv/users_handler.go`) currently wraps all service errors as `connect.CodeUnauthenticated`, which is the wrong Connect code for "authenticated but not provisioned" — the right code is `CodePermissionDenied` or `CodeFailedPrecondition`. Effect on the FE: the dashboard's `useEffect` catch branch displays the raw error, and the root `/` redirect still routes authenticated users to `/dashboard`, so the user sees an error page rather than an infinite sign-in loop. Not fixed in this pass to keep scope tight; tracked below.

### Known pending work (added by 0.2.1)

- **Error mapping in `users_handler.go`.** Translate `pgx.ErrNoRows` (and a service-layer sentinel like `ErrUserNotProvisioned`) to an appropriate Connect code (likely `PermissionDenied`), so the FE can render a meaningful "your account isn't provisioned — contact an admin" state instead of a generic error string.
- **First-admin bootstrap path.** Replace what the seeded default-org + auto-provisioning used to do. Options: an admin-invite flow that creates `users` rows explicitly, a separate policy migration that seeds a single bootstrap admin from an env var, or a one-shot CLI command. Pick one when the admin UX in blueprint §10 is specified.
- **Supersession of 0.1.0 pending item.** 0.1.0 listed "Local bring-up" as blocked on populated `.env`. It's now additionally blocked on a provisioning path — signing in with a Supabase user whose `auth_user_id` isn't in `public.users` will fail.

---

## 0.2.0 — Frontend Scaffolding (2026-04-24)

Frontend scaffolded end-to-end through the "prove the pipeline" milestone: Next.js 16 App Router + Supabase SSR auth + Connect-ES v2 client calling the existing `GetCurrentUser` RPC. `pnpm type-check` and `pnpm lint` both clean. Not yet running — requires populated `.env` + seeded Supabase test user. Codegen cheatsheet added under `docs/blueprints/`.

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

### Details

**Monorepo workspace plumbing.** Root `pnpm-workspace.yaml` declares `frontend` as the only workspace; root `package.json` exposes `pnpm proto:generate` (wraps `cd shared/proto && buf generate`) plus `frontend:dev|build|type-check|lint` passthroughs; `Procfile.dev` encodes the overmind-driven `web`/`api` split. *Where:* `/pnpm-workspace.yaml`, `/package.json`, `/Procfile.dev`. *Why:* `CLAUDE.md` §Common commands and `stack.md` §12 both assume `pnpm proto:generate` runs from repo root — a root `package.json` is the idiomatic way to expose that. Workspace file is what enables `pnpm -C frontend` from root and keeps a single authoritative lockfile at `/pnpm-lock.yaml` rather than one per package.

**Bootstrap via `create-next-app`.** `pnpm create next-app@latest frontend --typescript --tailwind --app --src-dir --eslint --import-alias "@/*" --use-pnpm --yes` produced Next 16.2.4 + React 19.2.4 + Tailwind v4.2.4 + TS 5.9. Nested `frontend/pnpm-workspace.yaml`, `frontend/pnpm-lock.yaml`, `frontend/AGENTS.md`, `frontend/CLAUDE.md` were deleted post-bootstrap to avoid workspace-inside-workspace drift and redundant meta files. Added `type-check` (`tsc --noEmit`) and `proto:generate` scripts to `frontend/package.json`. *Where:* `/frontend/**`. *Why:* current `pnpm create next-app@latest` resolves to Next 16 / Tailwind v4 / React 19, not the Next 15 / Tailwind v3 baseline assumed by `frontend-scaffolding.md`. Supersedes doc §2 & §3 for structural paths (see **Known deviations** below); architecture rules and end-state behavior are unchanged.

**Tooling delta vs `frontend-scaffolding.md`.** (1) **Next.js 16** — App Router API is stable across majors; no change to how Supabase SSR or Connect-ES integrates. (2) **Tailwind v4** — configuration-less; no `tailwind.config.ts` emitted, `postcss.config.mjs` (not `.js`), `globals.css` uses `@import "tailwindcss"` (not `@tailwind base/components/utilities`), lives at `src/app/globals.css` (not `src/styles/globals.css` as doc §2 claimed). (3) **React 19** — affects nothing in this scaffold. (4) **`sonner` primitive replaces `toast`** — newer shadcn's canonical toast; functionally equivalent; no call sites yet. *Where:* `frontend/src/app/globals.css`, `frontend/postcss.config.mjs`, `frontend/src/components/ui/sonner.tsx`. *Why:* no meaningful benefit to forcing older versions at scaffold time. Flagged in `docs/completions/frontend-scaffold-completion.md` so a future rescaffold doesn't re-hit the same forks; `frontend-scaffolding.md` update is pending.

**Connect-ES v2 adaptation.** Installed versions (`@connectrpc/connect@2.1.1`, `@connectrpc/connect-web@2.1.1`, `@bufbuild/protobuf@2.12.0`, `@bufbuild/protoc-gen-es@2.12.0`) consolidate message types + service descriptors into a single `*_pb.ts` — no separate `@connectrpc/protoc-gen-connect-es` codegen plugin, no `*_connect.ts` file. API call shape changed from `createPromiseClient(UsersService, transport)` (v1, `@connectrpc/connect`) to `createClient(UsersService, transport)` where `UsersService` is a `GenService` descriptor exported from `users_pb.ts`. *Where:* `shared/proto/buf.gen.yaml` (TS plugin), `frontend/src/gen/corellia/v1/users_pb.ts` (output), `frontend/src/lib/api/client.ts` (consumer). *Why:* v2 is the current release line; v1 is in maintenance. Adapting now avoids a gratuitous migration later. `docs/frontend-scaffolding.md` §4, §7.1, §8 need updating to match — tracked in completion doc.

**Proto TS codegen.** Extended `shared/proto/buf.gen.yaml` with a local plugin entry (`../../frontend/node_modules/.bin/protoc-gen-es`, `target=ts`) alongside the existing remote Go plugins. `pnpm proto:generate` now round-trips both halves: Go emits unchanged to `backend/internal/gen/corellia/v1/` and TS emits to `frontend/src/gen/corellia/v1/users_pb.ts`. *Where:* `shared/proto/buf.gen.yaml`, `frontend/src/gen/corellia/v1/users_pb.ts`. *Why:* single source of truth for the FE↔BE contract per `stack.md` §3. The `local:` resolution depends on `frontend/node_modules/` existing, which is fine because `buf generate` is always run from the workspace where `pnpm install` has run first — same assumption as `protoc-gen-es`'s canonical usage.

**Supabase SSR client triad + Next.js middleware.** Three files under `frontend/src/lib/supabase/` — `client.ts` (browser), `server.ts` (server component, reads `next/headers.cookies()`), `middleware.ts` (session-refresh helper) — plus `frontend/src/middleware.ts` that delegates to the helper with matcher `/((?!_next/static|_next/image|favicon.ico).*)`. *Where:* `frontend/src/lib/supabase/{client,server,middleware}.ts`, `frontend/src/middleware.ts`. *Why:* canonical `@supabase/ssr` pattern for Next.js App Router. Cookie-based SSR auth is what makes `/` a server-side redirect without a client-side auth flash. Per `stack.md` §11.10 the Supabase client is auth-only — `api/client.ts` extracts only the access token from the session, never uses Supabase for application data.

**Connect API client + routes.** `frontend/src/lib/api/client.ts` exposes `createApiClient()` → `{ users: createClient(UsersService, transport) }` where the transport's `fetch` injects `Authorization: Bearer <access_token>` from the Supabase session on every request. Routes: `/` is an async server component that redirects to `/dashboard` or `/sign-in` based on `supabase.auth.getUser()`; `/sign-in` is a client component with plain React form calling `signInWithPassword`; `/dashboard` is a client component that calls `api.users.getCurrentUser({})` in `useEffect` and renders the email. *Where:* `frontend/src/lib/api/client.ts`, `frontend/src/app/{page.tsx,sign-in/page.tsx,dashboard/page.tsx}`. *Why:* this is the literal end of the pipeline described in `stack.md` §12 hour 5 — JWT → Go middleware → `users.Service` → sqlc → wire mapping → Connect response → React render. Deliberately uses `useEffect` (not RSC `fetch`) per `frontend-scaffolding.md` §15 known deferrals.

**shadcn/ui init + primitives.** `shadcn init --defaults --yes --force` detected Tailwind v4, rewrote `src/app/globals.css`, generated `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`. `shadcn add input label select card sonner --yes` added five more. `shadcn add form` silently no-ops in the current registry version (reproduced with `--overwrite`; `--force`/`--reinstall` flags don't exist) — left out deliberately since the doc §9.1 sign-in page uses plain React form markup and `react-hook-form` + `zod` + `@hookform/resolvers` are already installed. *Where:* `frontend/components.json`, `frontend/src/components/ui/`, `frontend/src/lib/utils.ts`. *Why:* minimum primitive set needed for the sign-in page and the upcoming v1 agent-spawn form (blueprint §10). `form.tsx` will land with the spawn UX when the registry entry resolves.

**`.env.example` extended.** Added `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` after the existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` block, with a comment documenting why the values mirror their non-prefixed twins. *Where:* `.env.example`. *Why:* Next.js only inlines `NEXT_PUBLIC_*` vars into the client bundle — without these, the browser Supabase client would see `undefined` at runtime. This was a real gap in the 0.1.0 committed template (the Go backend never needed them, so they weren't added then); flagged in the pre-scaffold alignment audit.

**ESLint ignores generated code.** Added `src/gen/**` to `globalIgnores([...])` in `frontend/eslint.config.mjs`. *Where:* `frontend/eslint.config.mjs`. *Why:* first `pnpm lint` flagged a harmless `Unused eslint-disable` warning inside `users_pb.ts`. Blueprint §11.7 / `stack.md` §11.7 require generated code be treated like `node_modules` — ignoring in ESLint is the mechanical enforcement of that rule on the FE side (the mirror of the BE side's "never hand-edit `backend/internal/gen/` or `backend/internal/db/`").

**Codegen cheatsheet.** Added `docs/blueprints/codegen-cheatsheet.md` as the first entry under `docs/blueprints/` (previously empty). Short reference mapping the two codegen pipelines (proto → Go + TS; SQL → Go), an entry-point matrix keyed by goal ("I want to X, I edit Y"), a new-domain walkthrough (example: `agents`), five quick rules, and relative file pointers for ctrl-click navigation. *Where:* `docs/blueprints/codegen-cheatsheet.md`. *Why:* `stack.md` and `blueprint.md` answer *why* each codegen choice exists; neither answers "I'm adding a new column, what files do I touch and in what order?" efficiently. The cheatsheet fills that gap without duplicating the canonical docs — it's organized by goal, they're organized by concept.

**Completion record.** Authored `docs/completions/frontend-scaffold-completion.md` (the first entry under `docs/completions/`) as a durable record of the five deviations (Next 16, Tailwind v4, Connect v2, sonner, no `form.tsx`) and the cleanup steps. *Where:* `docs/completions/frontend-scaffold-completion.md`. *Why:* this changelog entry summarizes; the completion doc serves as the exhaustive one-stop reference for anyone trying to understand why the live frontend code drifts from `frontend-scaffolding.md`. Same pattern should apply to future scaffolding passes.

### Known deviations from `docs/frontend-scaffolding.md`

All intentional; all flagged in the completion doc. Listed here for changelog completeness:

1. **Next.js 16 + Tailwind v4 + React 19** instead of Next 15 / Tailwind v3 / React 18. Structural path differences: no `tailwind.config.ts`, `postcss.config.mjs` (not `.js`), `globals.css` at `src/app/globals.css` not `src/styles/globals.css`.
2. **Connect-ES v2** — consolidated `*_pb.ts`, no `protoc-gen-connect-es`, `createClient` instead of `createPromiseClient`.
3. **`sonner`** replaces `toast` in newer shadcn (equivalent).
4. **No `form.tsx` shadcn primitive** — registry entry silently no-ops; deferred until spawn UX arrives.
5. **Post-bootstrap cleanup**: removed `frontend/{pnpm-workspace.yaml,pnpm-lock.yaml,AGENTS.md,CLAUDE.md}`.

### Validation

- `pnpm -C frontend type-check` — clean.
- `pnpm -C frontend lint` — clean after `src/gen/**` ignore.
- `pnpm proto:generate` — round-trips on both sides; generated Go is byte-identical to 0.1.0 (same `.proto` source).

Not validated in this pass (deliberately): end-to-end sign-in round-trip, `pnpm build` — both require populated `.env` + seeded Supabase test user.

### Known pending work

- **Local bring-up (FE+BE together)** — populate root `.env`, apply migration, `overmind start`, create Supabase test user via dashboard, sign in, confirm dashboard renders the email. The actual hour-5 milestone from `stack.md` §12. Supersedes 0.1.0's "local bring-up" (now bottlenecked on the same populated `.env` for both halves, but with the FE ready to exercise it).
- **`docs/frontend-scaffolding.md` update** — bake in the five deviations above so a fresh scaffold doesn't re-hit the same forks.
- **`form.tsx` shadcn primitive** — retry when the spawn UX lands (blueprint §10 "RPG character creation" uses shadcn `<Form>` + zod).
- **Vercel deploy** (doc §12) — blocked on local bring-up.
- **Product code per blueprint §10** — catalog → spawn form → fleet view → agent detail. All downstream of pipeline proof.

---

## 0.1.0 — Backend Scaffolding & Docs Reconciliation (2026-04-24)

Backend scaffolding brought up end-to-end (compiling, not yet running — blocked on Supabase creds); docs reconciled across `vision.md` / `blueprint.md` / `stack.md` / `backend-scaffolding.md`.

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

### Details

**Doc alignment sweep.** Fixed three real misalignments + two trailing stale references. (1) `FRONTEND_ORIGIN` bypassed the config package via direct `os.Getenv` in `main.go` — violated stack.md §11 rule 8; moved to `Config.FrontendOrigin`, added row to stack.md §8 table. (2) Generated-code path inconsistency: doc said `gen/corelliav1/` but `paths=source_relative` + proto at `corellia/v1/` emits to `gen/corellia/v1/`; fixed `go_package` to `<mod>/internal/gen/corellia/v1;corelliav1` (keeps `corelliav1` Go identifier while path matches buf output) and updated every reference. (3) Auth middleware spec divergence: stack.md §5 said middleware loads/provisions the `users` row, scaffolding correctly kept middleware pure JWT and pushed load/provision into `users.Service`; amended stack.md §5 to match — transport/domain split is cleaner. Plus stale `gen/corelliav1/` bullet text in §8 cleaned up. *Where:* `docs/stack.md` §5, §8; `docs/backend-scaffolding.md` §2, §5, §8, §9.1–§10.3. *Why:* blueprint §11 rules are blocking only if their source of truth is unambiguous; every unresolved inconsistency becomes a "which doc wins?" debate in review.

**Backend scaffolding §3–§11.** Complete Go service skeleton: module + workspace, deps, config, DB connection + first migration + first sqlc queries, JWT middleware, Connect-go RPC + codegen + first service, Chi HTTP server with CORS + auth gating, main with explicit DI wiring, air hot-reload. *Where:* `backend/{go.mod, .air.toml, sqlc.yaml, cmd/api/main.go, migrations/, queries/, internal/{config,db,auth,httpsrv,users,gen}}`, `shared/proto/{buf.yaml, buf.gen.yaml, corellia/v1/users.proto}`, `go.work`, `.gitignore`, `.env.example`. `go vet ./...` and `go build ./...` both clean. *Why:* matches stack.md §12 hour-zero plan — prove auth + RPC + deploy before writing product code; §14 post-scaffolding roadmap (harness adapters, templates, deploy targets, spawn flow) picks up from here.

**Two-URL DB strategy.** Split `DATABASE_URL` into two roles: app uses Supabase **Session Pooler** (Supavisor, `*.pooler.supabase.com:5432`) via `Config.DatabaseURL`; migrations use direct connection (`db.<ref>.supabase.co:5432`) via shell-only `DATABASE_URL_DIRECT`, **deliberately absent from `Config`** so the Go binary never holds superuser credentials. Both use `postgres` role in v1; `DATABASE_URL` will later switch to a restricted `corellia_app` role (non-RLS-bypassing), `DATABASE_URL_DIRECT` stays on `postgres`. *Where:* `backend/internal/config/config.go`, `docs/backend-scaffolding.md` §5/§6.1/§6.2, `docs/stack.md` §6/§7/§8, `.env.example`. *Why:* session pooling gives IPv4 support + multiplexing + full PG feature set (prepared statements, advisory locks) that pgx + sqlc rely on. Transaction pooling rejected — breaks pgx's prepared-statement cache, which is the basis of sqlc's typed query path (FastAPI-era pattern for Python async / serverless, wrong shape for a long-lived Go server). Separating migration creds from app creds is a real security boundary — enforced structurally by no `Config` field + blueprint §11 rule 8 forbidding `os.Getenv` outside the config package.

**pgxpool tuning.** Starter values in `db.NewPool`:

| Setting | Value | Purpose |
|---|---|---|
| `MaxConns` | 10 | Per-process cap; with Supabase free tier (~200 pooler slots) supports ~20 Fly machines. |
| `MinConns` | 2 | Warm pool; avoids ~50ms TLS+auth cold-start after idle. |
| `MaxConnLifetime` | 1h | Hourly recycle; prevents drift through server restarts + pooler upgrades. |
| `MaxConnIdleTime` | 30m | Frees pooler slots during low-traffic windows. |
| `HealthCheckPeriod` | 1m | Detects silent drops before the next real request sees them. |

*Where:* `backend/internal/db/pool.go`, `docs/backend-scaffolding.md` §6.1. *Why:* avoids the worst pathologies (cold-start latency, stale connections, silent drops) without being tuned to a specific workload; revisit once real traffic shape is known.

**sqlc UUID type override.** Added `overrides:` block in `sqlc.yaml` mapping `uuid` → `github.com/google/uuid.UUID` instead of sqlc's default `pgtype.UUID`. *Where:* `backend/sqlc.yaml`; regenerated `backend/internal/db/{models,users.sql}.go`. *Why:* without the override, `users.Service.GetCurrentUser` fails to compile — `auth.AuthClaims.AuthUserID` is `uuid.UUID` but `db.GetUserByAuthID` would expect `pgtype.UUID`. Native `uuid.UUID` also keeps the hot path free of wrapper conversions and the prepared-statement cache compact. Doc defect worth backporting into the scaffolding recipe.

**`buf.yaml` module config.** Authored alongside the doc-specified `buf.gen.yaml`; enabled `lint: STANDARD` + `breaking: FILE`. *Where:* `shared/proto/buf.yaml`. *Why:* `buf.gen.yaml` alone is insufficient — `buf generate` needs a module declaration to discover protos; first `buf generate` would silently emit nothing without it.

**First proto + Connect-go RPC.** `users.proto` defines `UsersService.GetCurrentUser` with `User { id, email, org_id, role }`. Generates Go messages (`corelliav1.User`) + Connect interfaces (`corelliav1connect.UsersServiceHandler`); implemented by `users.Service.GetCurrentUser` (loads user by auth ID from claims, auto-provisions on first login against seeded default org); wrapped by `httpsrv.UsersHandler` (thin transport glue, <30 lines). *Where:* `shared/proto/corellia/v1/users.proto`, `backend/internal/users/service.go`, `backend/internal/httpsrv/users_handler.go`, `backend/internal/gen/corellia/v1/*`. *Why:* stack.md §12 hour-zero milestone — one authenticated RPC end-to-end proves the whole pipeline (JWT → service → DB → wire) before any product code. The `db.User → corelliav1.User` mapping in the service layer establishes the wire-vs-schema separation pattern every future RPC follows.

**First migration + initial schema.** `20260424120000_initial_schema.sql` creates `organizations` + `users` tables, seeds a default org (`00000000-0000-0000-0000-000000000001`) for single-tenant v1. `users` includes `auth_user_id UUID UNIQUE` (Supabase bridge), `email`, `org_id` FK, `role` (default `'admin'`). Remaining blueprint §9 tables (`harness_adapters`, `agent_templates`, `agent_instances`, `secrets`, `deploy_targets`) intentionally deferred per scaffolding §14 — each lands with the code that uses it. *Where:* `backend/migrations/20260424120000_initial_schema.sql`, `backend/queries/users.sql`. *Why:* minimum schema to support the "prove the pipeline" RPC; deferred tables avoid a fat initial migration whose shape would be decided before the code using them exists.

**`.gitignore` + `.env.example`.** Both at repo root. `.gitignore` covers `.env`, `backend/tmp/`, Node output dirs (for forthcoming frontend), editor dotfiles. `.env.example` documents every env var both halves will read, with Supabase dashboard navigation hints per var. *Where:* `.gitignore`, `.env.example`. *Why:* scaffolding doc references both but didn't specify contents; committing them early means the first clone is immediately runnable after `.env` is populated.

**Dev tooling.** Installed `buf` (`brew install bufbuild/buf/buf`), `goose` + `air` (`go install @latest`). System Go is 1.26.2 (above doc's 1.22 minimum). `go install` binaries land in `$HOME/go/bin`, NOT on `$PATH` by default — user should add `export PATH="$HOME/go/bin:$PATH"` to `~/.zshrc`; until then, full paths used as workaround.

### Known pending work
- **Local bring-up** — apply migration, start server, verify `/healthz`. Blocked on populated `.env`.
- **Blueprint §9 tables 2–6** — `harness_adapters`, `agent_templates`, `agent_instances`, `secrets`, `deploy_targets`. Pending decision on staged-vs-bulk approach.
- **Deploy pipeline** (scaffolding §12) — Dockerfile, `fly.toml`, `fly launch`. Out of Pass 1 scope; after local bring-up works.
- **`tools.go` / `go tool` migration** — tool versions currently global, not per-project pinned. Deferred until team size > 1.
