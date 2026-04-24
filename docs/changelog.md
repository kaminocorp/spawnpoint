# Changelog

- [0.2.4 — `DATABASE_URL` Canonicalized to Direct Connection](#024--database_url-canonicalized-to-direct-connection-2026-04-24)
- [0.2.3 — direnv for Shell-Level Env Loading](#023--direnv-for-shell-level-env-loading-2026-04-24)
- [0.2.2 — Env File Placement: Per-App](#022--env-file-placement-per-app-2026-04-24)
- [0.2.1 — Seeding Removed](#021--seeding-removed-2026-04-24)
- [0.2.0 — Frontend Scaffolding](#020--frontend-scaffolding-2026-04-24)
- [0.1.0 — Backend Scaffolding & Docs Reconciliation](#010--backend-scaffolding--docs-reconciliation-2026-04-24)

Latest on top. Each release has a tight index followed by detail entries (**What / Where / Why** inlined). When a decision contradicts an earlier one, note the supersession in the new entry rather than editing the old one.

---

## 0.2.4 — `DATABASE_URL` Canonicalized to Direct Connection (2026-04-24)

Rewrote `DATABASE_URL`'s documented connection mode from Supabase **Session Pooler** (`*.pooler.supabase.com:5432`) to **Direct Connection** (`db.<ref>.supabase.co:5432`). Both `DATABASE_URL` and `DATABASE_URL_DIRECT` now point at the same Direct host — the split is role-and-lifecycle, not host-vs-host. Motivated by Supabase's own UI copy ("Direct Connection: ideal for applications with persistent and long-lived connections, such as those running on virtual machines or long-standing containers"), which describes a Go+Fly single-binary orchestrator exactly. Supersedes 0.1.0's "Session Pooler for app, Direct for migrations" framing and re-grounds the rationale on the missing architectural fact: **`pgxpool` is an in-process transaction pooler**, so an external pooler on the wire is redundant.

### Index

- **Docs updated:** `CLAUDE.md` §Database connection (full rewrite with the pgxpool-as-transaction-pooler rationale + ceiling math) and §Migrations heading; `docs/stack.md` §6 migrations clause + new §8 "Database URLs — both Direct Connection, split by role" subsection + `DATABASE_URL` table row; `.env.example` header comment on both URLs (example URL flipped to Direct); `docs/blueprints/codegen-cheatsheet.md` quick rule; `docs/completions/frontend-scaffold-completion.md` pending-work reference.
- **Code comment updated:** `backend/internal/config/config.go` — `DatabaseURL` godoc rewritten (now names Direct + pgxpool semantics + IPv4 fallback + Transaction Pooler red line).
- **No runtime code changed.** `pgxpool.Config` values unchanged (`MaxConns=10`, `MinConns=2`, lifetime + idle + health-check); connection URL shape is indifferent to the driver; only the documented convention + the populated value in `backend/.env` changes.
- **Session Pooler reclassified as the IPv4 fallback**, not the primary. Swap is drop-in — different URL, same driver, same `pgxpool` — so per-developer variation costs nothing and doesn't leak into committed config.
- **Transaction Pooler rule strengthened, not changed.** Reason upgrades from single-barrel ("breaks pgx") to double-barrel ("redundant *and* breaks pgx") once the in-process-equivalence framing is explicit.

### Details

**The missing link: `pgxpool` is a transaction pooler.** The 0.1.0 entry justified Session Pooling with "prepared statements + IPv4 + full PG feature set" and dismissed Transaction Pooling as "wrong shape for a long-lived Go server." True, but incomplete — it didn't name *why* transaction pooling was wrong-shape, which is: `pgxpool.QueryContext` already leases a backend for the single query's duration and returns it immediately; a `BeginTx` block leases for the transaction's duration. That is transaction-mode pooling semantics, implemented inside the Go process. Supavisor in transaction mode would sit on the wire and do the same job, one layer up and across a network hop, while breaking pgx's prepared-statement cache. Naming the in-process equivalence makes the architectural fit between Go + Direct Connection *positive* instead of framing "we picked Session Pooler" as a compromise. *Where:* new paragraph in `CLAUDE.md` §Database connection; new subsection in `stack.md` §8 ("Database URLs — both Direct Connection, split by role"). *Why:* during a stack review the "FastAPI + PgBouncer transaction mode" pattern was raised as the canonical SaaS default and the implicit challenge was "why aren't we doing that?". The honest answer isn't "we're a special-case orchestrator" (we aren't — v1 Corellia is closer to CRUD-with-two-side-trips-to-Fly than a true 24/7 orchestrator), it's "our driver is doing transaction pooling for us, so the external pooler would be redundant" — a cleaner, more durable framing that survives re-examination.

**Connection count ceiling stated as `instances × pool_size`, not user count.** The direct corollary of the in-process-pooling framing is that Postgres backend count scales with horizontal deployment shape, not traffic. For a single Go binary at `MaxConns=10`, 100 concurrent admin requests use 10 backends held for ~5ms each; they do not use 100. Commercial-scale Corellia (10k orgs) at ~2–5 instances holds 20–50 backends — well under Postgres's ~500 ceiling. The inflection where we'd need Supavisor *session* mode on top is ~50 backend instances, far past v1/v2. Documented explicitly in the new `CLAUDE.md` block and `stack.md` §8 paragraph so future readers don't conflate "high user count" with "connection pressure." *Where:* `CLAUDE.md` §Database connection "Ceiling math" paragraph; `stack.md` §8 new subsection. *Why:* the "scales with users" intuition is load-bearing in the industry-default transaction-pooling argument (Rails/Django/FastAPI shops use it because each request holds a connection for its whole lifetime — a framework-level constraint we don't share). Naming the actual scaling axis (instances, not users) closes the conceptual loop and makes the "when would we add a pooler?" trigger concrete.

**Session Pooler reframed as IPv4 fallback.** Previously the primary recommendation; now named as the specific mitigation for local-dev networks that can't reach the Direct Connection host over IPv6 (Supabase removed IPv4 from the Direct endpoint on the free tier in Jan 2024 — this is also why the Session Pooler exists as a product). Swap is drop-in: same driver, same `pgxpool`, different URL — so per-developer variation costs nothing and doesn't leak into committed config. *Where:* `.env.example` `DATABASE_URL` comment; `CLAUDE.md` §Database connection; `stack.md` §8; `config.go` godoc; `codegen-cheatsheet.md` quick rule. *Why:* the Session Pooler option was overbilled as the "safe default" when it's really just a portability escape hatch. Making the decision tree explicit — try Direct first, fall back only if your network forces it — clarifies the recommendation operationally.

**`.env.example` DATABASE_URL comment rewritten; example URL flipped to Direct.** The committed example now shows `postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require` (matching what the Supabase dashboard's "Direct connection" tab copies out), with the Session Pooler form retained as an IPv4-fallback paragraph further down the block. `DATABASE_URL_DIRECT`'s example is unchanged (same URL; always was Direct). *Where:* `.env.example` lines 13–30 (replaces the prior SP-primary block). *Why:* the `.env.example` is the first thing a new contributor copies; showing the Direct URL as the canonical example makes the recommendation operational, not just documentary.

**`config.go` godoc rewritten.** Three-paragraph structure preserved (what the var is, what `DATABASE_URL_DIRECT`'s role is, a practical caveat). Content flipped to name Direct + `pgxpool`'s role + the IPv4 fallback + the Transaction Pooler red line. *Where:* `backend/internal/config/config.go` lines 13–26. *Why:* this is the doc comment a developer reads via IDE hover; keeping it aligned with the canonical Markdown explanation avoids drift.

**CLAUDE.md §Migrations heading cleaned up.** Was "always use DATABASE_URL_DIRECT, not the pooler URL"; now "always via DATABASE_URL_DIRECT." The "not the pooler URL" framing was meaningful under the old convention (pooler-vs-direct was a user-facing choice); under the new convention both URLs are Direct and the split is by *role*, so the warning no longer parses correctly. *Where:* `CLAUDE.md` §Common commands §Migrations subheading. *Why:* the old wording would have misled a reader into thinking there was a pooler URL in `.env` to accidentally mistype.

### Behavior change (known)

None at runtime. No Go code was touched except the godoc comment on `DatabaseURL`. The Go binary reads whatever `DATABASE_URL` contains — Direct or Session Pooler — and `pgxpool` opens a pool against it either way. The change is documentary and conventional (what we tell a new operator to paste into `backend/.env`, and what the godoc + `.env.example` show as the canonical example). Migrations continue to use `DATABASE_URL_DIRECT`; the superuser role distinction that keeps `DATABASE_URL_DIRECT` out of `config.Config` is unchanged. The pending local bring-up is unblocked by this (populating `DATABASE_URL` with the Direct URL is now the recommended path), not made harder.

### Supersedes

- **0.1.0 "Two-URL DB strategy."** The line "session pooling gives IPv4 support + multiplexing + full PG feature set (prepared statements, advisory locks)" is historically accurate only for the rejected *Transaction* Pooler — Session Pooler was never actually needed for multiplexing (`pgxpool` does that) or prepared statements (Direct keeps them too). The rationale upgrade lands here.
- **0.2.0 pending-work item** naming "session-pooler `DATABASE_URL`" as a bring-up prerequisite — updated in-place in `docs/completions/frontend-scaffold-completion.md` to read "Direct Connection `DATABASE_URL`."

### Known pending work

- **Local bring-up is still the next blocker** (carried forward from 0.2.1/0.2.2/0.2.3). With the canonical URL now Direct, verify IPv6 reachability from the local network as part of first bring-up — a quick `dig AAAA db.<ref>.supabase.co +short` returning an IPv6 address, plus a one-shot `psql "$DATABASE_URL" -c 'select 1'` smoke test, is enough. Fall back to Session Pooler in `backend/.env` only if Direct fails to connect; the per-developer variation doesn't leak because `backend/.env` is gitignored.
- **IPv6 egress on Fly production.** Fly machines have native IPv6 and should reach the Direct host without configuration, but this needs to be verified during the first Fly deploy (`fly ssh console` → `dig AAAA db.<ref>.supabase.co` → `psql`). If it fails unexpectedly, Session Pooler is the same drop-in escape hatch in production as locally.
- **Supavisor session mode (not transaction mode) on top of Direct** becomes worth adding when horizontal-scaling operational concerns appear — connection storms during rolling deploys, centralized connection limits across ≥10 instances, or cleaner failover routing. Not a v1 or v2 concern; flag for v2+ when a second backend instance lands.

---

## 0.2.3 — direnv for Shell-Level Env Loading (2026-04-24)

Added committed `backend/.envrc` and `frontend/.envrc` (one line each — `dotenv .env` / `dotenv .env.local`) to auto-source the per-app env files into the shell via `direnv` on `cd`. Resolves the `direnv` pending item from 0.2.2: `goose` migrations, ad-hoc `go test`, and every other in-directory CLI tool now see the same env as the Go binary, with no `set -a; source; set +a` ritual. Manual sourcing retained as the documented fallback for contributors who don't install direnv.

### Index
- **Committed:** `backend/.envrc` (`dotenv .env`) and `frontend/.envrc` (`dotenv .env.local`) — one line each, zero secrets, safe to commit.
- **Gitignore fix:** added `!.envrc` negation to `frontend/.gitignore` so the default `.env*` rule (inherited from `create-next-app`) doesn't silently exclude the committed `.envrc`.
- **Docs updated:** `CLAUDE.md` §Environment (direnv marked recommended; manual-sourcing retained as fallback) and §Common commands §Migrations (`goose` examples now run from `backend/` so direnv-loaded vars are in scope); `docs/stack.md` §7 Prerequisites (direnv added) and §8 Environment variables (new direnv paragraph replaces the parenthetical mention from 0.2.2).
- **Canonical migration command now runs from `backend/`.** Path shortened from `-dir backend/migrations` to `-dir migrations`; direnv has already exported `DATABASE_URL_DIRECT` into the shell by the time cwd is `backend/`.
- **Rationale:** direnv is the de-facto standard for per-directory env loading in Go / Rails / Node monorepos (Fly.io docs, Supabase CLI docs, 1Password CLI integration, Nix / devenv, HashiCorp Terraform). Committed `.envrc` means onboarding is a single `direnv allow` per contributor, per directory, after first clone.

### Details

**`backend/.envrc` and `frontend/.envrc` added.** One line each — `dotenv .env` and `dotenv .env.local` respectively. No shell logic, no secrets, no platform-specific code. Committed to git so onboarding is one-time per contributor: `direnv allow` in each directory after first clone. *Where:* `backend/.envrc`, `frontend/.envrc`. *Why:* direnv's `dotenv` directive reads a `KEY=value` file and exports every entry into the shell environment; exports propagate to child processes like `goose`, `sqlc`, `go test`. The `direnv allow` gate is direnv's trust mechanism — re-required on every content change, which is exactly why committing `.envrc` files is safe (the contents are auditable and the gate forces conscious approval). Keeping `.envrc` content to a single `dotenv` directive means the approval covers only that directive; any future addition of shell code requires a fresh `direnv allow`.

**Gitignore fix for `frontend/.envrc`.** `frontend/.gitignore` inherited `.env*` from `create-next-app`'s default template, which unfortunately also matches `.envrc`. Added `!.envrc` negation (with a short comment explaining why committing it is safe) so git tracks the committed file. *Where:* `frontend/.gitignore`. *Why:* caught by `git status` check after creating the file — would otherwise silently not be committed and the onboarding story would break for every new contributor. Root `.gitignore` has specific `.env` + `.env.local` entries (not a glob), so `backend/.envrc` needed no equivalent fix.

**CLAUDE.md §Environment rewritten to recommend direnv.** The 0.2.2 phrasing mentioned direnv as an aside ("or use `direnv`") alongside the manual sourcing form. Flipped the emphasis: direnv is the recommended path (bolded install command + `direnv allow` step), manual sourcing is documented as the fallback for contributors who don't install it. *Where:* `CLAUDE.md` §Environment. *Why:* the aside treatment undersold direnv's actual role. "Install one tool once" is a meaningfully better onboarding story than "remember to prefix every migration with an incantation" — and the committed `.envrc` files make direnv zero-configuration after the initial install.

**`goose` examples relocated to `backend/`.** Previously: `goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up` run from repo root. Now: same command run from `backend/` with the shortened `-dir migrations`, prefixed with a comment documenting that direnv loads `DATABASE_URL_DIRECT` on `cd`. *Where:* `CLAUDE.md` §Common commands §Migrations. *Why:* direnv's per-app `.envrc` scope means `DATABASE_URL_DIRECT` is only exported when cwd is within `backend/`. Running goose from repo root would either find an empty `$DATABASE_URL_DIRECT` (silent failure with a confusing connection error) or require a workaround like `direnv exec backend goose …`. Relocating the canonical invocation inside `backend/` keeps the command short, direnv-native, and conceptually aligned — migrations are a backend concern; the tool that applies them should run from the directory that owns the schema.

**stack.md §7 + §8 updated.** §7 Prerequisites gains a `direnv` bullet (install command + shell-hook line) alongside the existing `air` / `goose` / `overmind` / `buf` installs, and corrects the stale "credentials in `.env`" reference to the per-app paths from 0.2.2. §8 Environment variables gains a full paragraph on shell-level loading — mechanism (cd-triggered `.envrc` source via direnv), first-time setup, security-gate behavior on content changes, and the manual-sourcing fallback. The parenthetical mention of direnv added in the 0.2.2 §8 edit was removed in favor of this paragraph. *Where:* `docs/stack.md` §7 Prerequisites bullet, §8 (replaced the last paragraph with a new direnv paragraph + simplified `DATABASE_URL_DIRECT` clause). *Why:* §7 is the "what do I install on a fresh machine?" contract; §8 is the "how is env loading structured?" contract. direnv belongs in both — the 0.2.2 parenthetical wasn't doing the recommendation justice in either.

### Behavior change (known)

None at runtime — code unchanged. `godotenv/autoload` still loads `backend/.env` when the Go binary starts; Next.js still loads `frontend/.env.local` on `next dev` / `next build`; neither knows or cares about direnv. The only change is that the shell environment of a developer `cd`'d into `backend/` now has `DATABASE_URL_DIRECT` + friends exported automatically, so CLI tools that weren't reading `.env` directly (goose, sqlc, any ad-hoc command) now also see those vars. For already-onboarded developers using manual sourcing, their existing workflow still works and remains documented — direnv is purely additive.

### Resolves

- **0.2.2 pending item: "`direnv` or shell-sourcing helper for `DATABASE_URL_DIRECT`."** Picked direnv, committed the `.envrc` files, documented it as recommended across three docs, kept manual sourcing as fallback.

### Known pending work

- **CI and production are untouched.** CI runs env vars from GitHub Actions secrets / platform-native injection, never from `.env` or `.envrc`. Fly + Vercel inject env at runtime from their dashboards. direnv is strictly a local-dev ergonomic layer and the production story stays clean.
- **Secret-manager migration** (long-lead, not blocking). When team size passes ~5 developers or secrets-rotation becomes a recurring concern, re-evaluate Doppler / Infisical / 1Password CLI. The direnv layer would then become a per-`.envrc` secret-fetch (e.g. `export DATABASE_URL=$(op read …)`) or be wrapped in `doppler run --`; the per-app structure stays intact either way.

---

## 0.2.2 — Env File Placement: Per-App (2026-04-24)

Replaced the "single `.env` at repo root" convention with per-app env files: `backend/.env` (auto-loaded by `godotenv/autoload` from the Go binary's cwd) and `frontend/.env.local` (auto-loaded by Next.js from the `frontend/` project root). Matches the default loader behavior of both halves without fighting either — the root-`.env` framing in 0.1.0 would have required symlinks or a `dotenv-cli` wrapper in practice. Supersedes the root-`.env` story across `CLAUDE.md` §Environment, `stack.md` §8, and the `.env.example` comments.

### Index
- **Committed docs:** `CLAUDE.md` §Environment + architecture diagram, `docs/stack.md` §8, and `.env.example` (top comment + `--- Supabase (frontend-facing copies) ---` block) — all rewritten to describe the per-app split.
- **Gitignored files (not committed):** `backend/.env` and `frontend/.env.local` scaffolded with the relevant subset of keys from `.env.example`; values left empty for the operator to populate. Covered by existing root `.gitignore` (lines 2–3: `.env`, `.env.local`) and `frontend/.gitignore` (line 34: `.env*`) — no gitignore changes needed.
- **Shared Supabase values duplicated by design.** Two value pairs now live in both files: `SUPABASE_URL` ↔ `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY` ↔ `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Rotations touch two files; accepted cost.
- **`DATABASE_URL_DIRECT`** physical home moves from a (never-created) root `.env` to `backend/.env`. The no-Config invariant from 0.1.0 is unchanged — still absent from `config.Config`, still shell-sourced by `goose`.

### Details

**Per-app convention documented.** `CLAUDE.md` §Environment, `docs/stack.md` §8, and the header comment in `.env.example` previously all said "Single `.env` at repo root, read by both halves." Rewritten to describe `backend/.env` for backend vars and `frontend/.env.local` for frontend vars, with the repo-root `.env.example` as the single committed template documenting every var. The mid-file comment in `.env.example` (originally justifying `NEXT_PUBLIC_*` duplicates "so the same .env file feeds both halves") was rewritten to describe the split and frame the duplication as the intentional cost of it. The architecture diagram in `CLAUDE.md` was updated in the same pass so the `.env.example` line reflects the new real-env paths. *Where:* `CLAUDE.md` (§Environment + architecture diagram line), `docs/stack.md` §8, `.env.example` (top + `--- Supabase (frontend-facing copies) ---` block). *Why:* the single-root-file story was already fighting loader defaults in both halves. `godotenv/autoload` (imported in `backend/cmd/api/main.go:10`) reads `.env` from the process's cwd — and `Procfile.dev` line 2 runs `cd backend && air`, so cwd is `backend/`, not repo root. Next.js's built-in dotenv loader reads `.env` / `.env.local` from the Next project root (`frontend/`), never walking up to a monorepo parent. Reconciling the single-root framing would have required either symlinks (`backend/.env → ../.env`, `frontend/.env.local → ../.env`) or a `dotenv-cli` wrapper in frontend scripts — neither conventional in Next.js or Go monorepos (Turborepo's own docs warn against root `.env` because it interferes with task-hashing). Per-app files match both loaders' defaults, match ecosystem norms (create-t3-turbo, Cal.com, Supabase's own example repos), and cost two duplicated shared Supabase values — an acceptable trade.

**Local env files scaffolded.** `backend/.env` and `frontend/.env.local` created with the relevant subset of keys from `.env.example`, values left empty. *Where:* `backend/.env`, `frontend/.env.local` (both gitignored — not in the commit). *Why:* prefilling placeholder values risks an accidental commit of a nonsense `SUPABASE_JWT_SECRET` that then has to be rotated on Supabase's side. Leaving values empty makes the "not yet populated" state visible — the Go config package will panic on `Load()` with a clear missing-var message on first run, which is the intended failure mode.

### Behavior change (known)

None at runtime — no codepath moved. `godotenv/autoload` was already reading from process cwd; Next.js was already reading from `frontend/`. The only change is that the documented convention now matches where the files actually live. The `DATABASE_URL_DIRECT` ∉ `config.Config` boundary from 0.1.0 is preserved — the struct did not change.

### Known pending work

- **`direnv` or shell-sourcing helper for `DATABASE_URL_DIRECT`.** Running `goose` now requires either `set -a; source backend/.env; set +a` before the command, or a `backend/.envrc` with `dotenv .env` + `direnv allow`. Scaffolding / onboarding docs should pick one and document it when the first migration-apply happens (still blocked on populated Supabase creds — see 0.2.1 pending).
- **`.env.example` split (deferred).** Could be broken into `backend/.env.example` + `frontend/.env.local.example` for maximum locality with the files they template. Kept as one repo-root file for now: simpler first-clone experience, and the var list is still short enough that co-location isn't paying its way. Revisit if the template grows past ~30 vars or operator confusion about "where does this value go?" shows up.

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
