# Changelog

- [0.1.0 — Backend Scaffolding & Docs Reconciliation](#010--backend-scaffolding--docs-reconciliation-2026-04-24)

Latest on top. Each release has a tight index followed by detail entries (**What / Where / Why** inlined). When a decision contradicts an earlier one, note the supersession in the new entry rather than editing the old one.

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
