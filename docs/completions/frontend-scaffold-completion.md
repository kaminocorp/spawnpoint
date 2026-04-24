# Frontend Scaffolding — Completion Record

Date: 2026-04-24
Source recipe: `docs/frontend-scaffolding.md`
Source of truth going forward: the live code under `frontend/` (per scaffolding-doc convention).

## Outcome

Next.js 16 App Router frontend scaffolded end-to-end through the "prove the pipeline" milestone (doc §10, stack.md §12 hour 5). `pnpm type-check` and `pnpm lint` both pass. Scaffold is wire-compatible with the existing Go backend (`UsersService.GetCurrentUser`); all that's missing to actually run is a populated `.env` and a seeded Supabase test user.

## Index
- Monorepo plumbing: `pnpm-workspace.yaml`, root `package.json` with `proto:generate`, `Procfile.dev` at repo root.
- Next.js app bootstrapped via `create-next-app` (Next 16.2.4 + React 19 + Tailwind v4, **not** the doc's Next 15 + Tailwind v3 baseline).
- Supabase clients (browser / server / middleware-helper) per doc §6; root Next.js middleware at `src/middleware.ts`.
- Proto TS codegen added to `shared/proto/buf.gen.yaml`; regenerated both Go + TS; `frontend/src/gen/corellia/v1/users_pb.ts` committed.
- Connect-ES **v2** API client (deviation — see below): `createClient(UsersService, transport)` with Bearer-token fetch wrapper.
- Routes: `/` server-side redirect based on session, `/sign-in` (email/password via Supabase), `/dashboard` (calls `GetCurrentUser`, renders email).
- `.env.example` extended with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (doc §11 required these but they were missing from the committed template).
- ESLint config ignores `src/gen/**` (consistent with blueprint §11 rule 7 — treat generated code like `node_modules`).

## Details

**Monorepo root files.** Added `pnpm-workspace.yaml` listing `frontend` as the only workspace; added a root `package.json` exposing `pnpm proto:generate` (wraps `cd shared/proto && buf generate`) plus convenience `frontend:dev|build|type-check|lint` passthroughs; added `Procfile.dev` for overmind per doc §11. *Where:* `/pnpm-workspace.yaml`, `/package.json`, `/Procfile.dev`. *Why:* CLAUDE.md §Common commands and stack.md §12 assume `pnpm proto:generate` runs from repo root — a root `package.json` is the idiomatic way to expose that. Workspace file is what enables `pnpm -C frontend <cmd>` from root. Procfile.dev is the one-line FE+BE boot.

**Bootstrap.** `pnpm create next-app@latest frontend --typescript --tailwind --app --src-dir --eslint --import-alias "@/*" --use-pnpm --yes`. Next 16.2.4 + React 19.2.4 + Tailwind v4.2.4 + TS 5.9. Post-bootstrap cleanup: deleted `frontend/pnpm-workspace.yaml`, `frontend/AGENTS.md`, `frontend/CLAUDE.md` (generator artifacts that collide with the monorepo's existing ones). Later removed `frontend/pnpm-lock.yaml` in favor of the root workspace lockfile. Added `type-check` (`tsc --noEmit`) and `proto:generate` to `frontend/package.json`. *Where:* `frontend/`, `frontend/package.json`. *Why:* Next/Tailwind/TS are the versions pnpm's latest tag currently resolves to — see **Deviations** for the impact.

**Shadcn/ui initialized + primitives.** `shadcn init --defaults --yes --force` auto-detected Tailwind v4, rewrote `src/app/globals.css`, generated `components.json`, `src/lib/utils.ts`, and `src/components/ui/button.tsx`. Then `shadcn add input label select card sonner --yes` installed five more primitives. *Where:* `frontend/components.json`, `frontend/src/components/ui/`, `frontend/src/lib/utils.ts`. *Why:* minimum surface needed by the sign-in page (Button/Input/Label) and the v1 agent-spawn form that comes next (Select/Card). `sonner` replaces `toast` in newer shadcn — semantically equivalent. See **Pending** for `form`.

**Supabase clients.** Three files under `src/lib/supabase/` + the Next.js root middleware — exactly the `@supabase/ssr` canonical pattern from doc §6. Middleware matcher `/((?!_next/static|_next/image|favicon.ico).*)` refreshes the session on every non-asset request. *Where:* `frontend/src/lib/supabase/{client,server,middleware}.ts`, `frontend/src/middleware.ts`. *Why:* cookie-based SSR auth is what makes a server-side `/` redirect (session-gated) possible without a client-side flash. Per stack.md §11.10, the Supabase client is auth-only — never for application data.

**Proto TS codegen.** Extended `shared/proto/buf.gen.yaml` with a local `protoc-gen-es` plugin pointing at `../../frontend/node_modules/.bin/protoc-gen-es`, `target=ts`. Ran `pnpm proto:generate` from root; TS landed at `frontend/src/gen/corellia/v1/users_pb.ts`, backend Go regenerated cleanly (byte-identical to the committed version per existing mtime). *Where:* `shared/proto/buf.gen.yaml`, `frontend/src/gen/corellia/v1/users_pb.ts`. *Why:* single source of truth for the FE↔BE contract per stack.md §3. With Connect-ES v2, message types + service descriptors all emit into the single `*_pb.ts` file — **no separate connect-es codegen plugin**, unlike the doc's recipe.

**API client.** `frontend/src/lib/api/client.ts` exposes `createApiClient()` returning `{ users: createClient(UsersService, transport) }` where the transport's `fetch` injects `Authorization: Bearer <access_token>` from the Supabase session on every request. *Where:* `frontend/src/lib/api/client.ts`. *Why:* the auth handoff is the whole point of the hour-5 milestone — the Go middleware validates this exact header and loads `public.users` via `AuthClaims.AuthUserID`. This file is the **only** path for application data per stack.md §11.10.

**Routes.** `/` is an async server component that calls `supabase.auth.getUser()` and redirects to `/dashboard` or `/sign-in` (replaced the create-next-app boilerplate). `/sign-in` is a client component with email/password form using Supabase's `signInWithPassword` (plain React form, not shadcn `<Form>`; see **Pending**). `/dashboard` is a client component that calls `api.users.getCurrentUser({})` in `useEffect` and renders `res.user?.email` — the literal end of the pipeline described in stack.md §12 hour 5. *Where:* `frontend/src/app/{page.tsx,sign-in/page.tsx,dashboard/page.tsx}`. *Why:* smallest possible surface that exercises the entire signed-in RPC round-trip. Deliberately uses `useEffect` (not RSC `fetch`) per frontend-scaffolding.md §15 known deferrals.

**`.env.example` extended.** Added `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` after the existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` block, with a comment explaining why the values mirror their non-prefixed twins. *Where:* `.env.example`. *Why:* Next.js only inlines `NEXT_PUBLIC_*` vars into the client bundle — without these, `process.env.NEXT_PUBLIC_SUPABASE_URL!` in the browser client is `undefined` at runtime. This was a real gap in the pre-scaffold template (flagged in the audit that preceded this work).

**ESLint ignores generated code.** Added `src/gen/**` to `globalIgnores([...])` in `eslint.config.mjs`. *Where:* `frontend/eslint.config.mjs`. *Why:* the first `pnpm lint` flagged a harmless `Unused eslint-disable` warning inside `users_pb.ts`. Blueprint §11.7 / stack.md §11.7 require generated code be treated like `node_modules` — ignoring it in ESLint is the mechanical enforcement of that rule on this side of the stack.

## Deviations from `docs/frontend-scaffolding.md`

Not in priority order — all non-blocking, all intentional:

1. **Next.js 16 + Tailwind v4 + React 19** (doc baselined Next 15 / Tailwind v3 / React 18). Impact: (a) no `tailwind.config.ts` — v4 is config-less and uses `@import "tailwindcss"` in `globals.css`; (b) `postcss.config.mjs` instead of `.js`; (c) `globals.css` lives at `src/app/globals.css`, not `src/styles/globals.css` as doc §2 claimed. Neither the architecture rules nor the end-state behavior change.
2. **Connect-ES v2 instead of v1.** Doc §4 and §7.1 expected a separate `@connectrpc/protoc-gen-connect-es` codegen plugin emitting `users_connect.ts`, and a `createPromiseClient()` call importing `UsersService` from that file. Installed versions (`@connectrpc/connect@2.1.1`, `@bufbuild/protobuf@2.12.0`, `@bufbuild/protoc-gen-es@2.12.0`) consolidate everything into `users_pb.ts` with a `GenService` descriptor; the API shape changed to `createClient(UsersService, transport)` from `@connectrpc/connect`. Code adapted accordingly; the doc should be updated if v2 is the long-term choice.
3. **`shadcn toast` → `shadcn sonner`.** Newer shadcn ships `sonner` as the canonical toast primitive. Functionally equivalent for v1's success/failure notifications. No call sites use it yet.
4. **No shadcn `form` primitive.** The `shadcn add form` command silently no-ops in the current registry version (reproduced with `--overwrite`; checked registry lookup with `--help`, no other flag works). Left out deliberately — the doc §9.1 sign-in page uses plain React form markup with Input/Label/Button and does not require shadcn's `<Form>` wrapper. `react-hook-form` + `zod` + `@hookform/resolvers` are all installed; adding `form.tsx` later is one command away.
5. **Removed nested `frontend/pnpm-workspace.yaml`, `frontend/pnpm-lock.yaml`, `frontend/AGENTS.md`, `frontend/CLAUDE.md`.** All artifacts of `create-next-app` running before the monorepo workspace existed. The authoritative lockfile is `/pnpm-lock.yaml` at root.

## Files changed

```
New:
  /package.json
  /pnpm-workspace.yaml
  /pnpm-lock.yaml                                (generated)
  /Procfile.dev
  /docs/completions/frontend-scaffold-completion.md
  /frontend/**                                   (entire tree)
    ├── src/app/{page,layout,globals.css}        create-next-app + edits
    ├── src/app/sign-in/page.tsx
    ├── src/app/dashboard/page.tsx
    ├── src/components/ui/{button,input,label,select,card,sonner}.tsx
    ├── src/gen/corellia/v1/users_pb.ts          generated
    ├── src/lib/supabase/{client,server,middleware}.ts
    ├── src/lib/api/client.ts
    ├── src/lib/utils.ts                         (shadcn)
    ├── src/middleware.ts
    ├── components.json, eslint.config.mjs, next.config.ts,
    │   postcss.config.mjs, tsconfig.json, package.json

Modified:
  /.env.example                                  + NEXT_PUBLIC_SUPABASE_*
  /shared/proto/buf.gen.yaml                     + TS plugin

Removed (post-bootstrap cleanup):
  /frontend/pnpm-workspace.yaml
  /frontend/pnpm-lock.yaml
  /frontend/AGENTS.md
  /frontend/CLAUDE.md
```

## Validation

- `pnpm -C frontend type-check` — clean (zero errors).
- `pnpm -C frontend lint` — clean after `src/gen/**` ignore (zero errors, zero warnings).
- `pnpm proto:generate` — round-trips successfully; both Go and TS emit.
- `go build ./...` / `go vet ./...` in `backend/` unchanged by this work (the committed Go `gen/` is byte-identical to pre-scaffold).

**Not validated** (deliberately out of scope for this scaffold pass):
- End-to-end sign-in → RPC round-trip. Requires a populated `.env` and a seeded Supabase test user (stack.md §9 suggests creating one via the Supabase dashboard).
- `pnpm build` (production Next.js build). Would fail today on the non-null-asserted `process.env.NEXT_PUBLIC_SUPABASE_*` without a real `.env`; belongs to the local-bring-up milestone.

## Pending / next

Still open, roughly in order the §14 post-scaffold roadmap would consume them:

1. **Local bring-up.** Populate root `.env` (Supabase URL/anon/JWT-secret, BE `DATABASE_URL` session-pooler, `DATABASE_URL_DIRECT`); run `goose up`; `overmind start`; create a test user in Supabase dashboard; sign in; confirm dashboard renders the email. This is the actual hour-5 milestone from stack.md §12.
2. **Add `form.tsx` shadcn primitive** (and retry when the registry entry resolves) before the agent-spawn UX lands — blueprint §10 "RPG character creation" form uses zod + react-hook-form + shadcn `<Form>`.
3. **Update `docs/frontend-scaffolding.md`** to bake in the deviations above (Connect v2 API, Tailwind v4, sonner instead of toast, Next 16 path differences) — so the next fresh scaffold doesn't re-hit the same forks.
4. **Vercel deploy** (doc §12) — blocked on local bring-up passing first.
5. **Product code** per blueprint §10: catalog → spawn form → fleet view → agent detail. All downstream of the pipeline being proven end-to-end.

## Alignment with architecture rules (blueprint §11 / stack.md §11)

Spot-check of the rules that touch this scaffold:

- §11.3 `CORELLIA_*` env naming — N/A (backend-only concern).
- §11.6 No Supabase specifics outside `auth/` / `db/` (backend) — mirrors on FE as "Supabase only for auth, never for app data"; the `api/client.ts` path enforces this structurally (only RPC calls for data).
- §11.7 Generated code never hand-edited — enforced in ESLint via `src/gen/**` ignore; import paths from `@/gen/corellia/v1/users_pb` are the only permitted dependency direction.
- §11.10 Frontend never reaches Supabase for app data — `createApiClient()` is the single permitted path; the Supabase client import in `client.ts` is scoped to extracting the session token only.
