# Phase 6 Completion — Validation matrix + cleanup + sign-in fix

**Plan:** `docs/executing/onboarding-wizard.md` §Phase 6
**Status:** complete (operator-side E2E run-through deferred per runbook below)
**Date:** 2026-04-25
**Acceptance:** `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build` all green; cleanup pass clean.

---

## What

Closing pass on M1. Three categories of work:

1. **Fixed** the pre-existing `/sign-in` prerender failure flagged in Phase 1's findings — Phase 1 had explicitly scoped it to "either Phase 6 or a separate hardening task." Doing it here lets the build pass cleanly for the first time in this milestone (and arguably this codebase).
2. **Validated** the full FE check matrix: `type-check` + `lint` + `build` all clean. Build prerendered all eight static routes.
3. **Cleaned up** any drift: zero TODOs, zero `console.log`s, old `src/app/dashboard/` directory confirmed removed (Phase 3's `git mv` did the work cleanly).
4. **Drafted** the changelog entry for M1 — `docs/changelog.md` 0.2.7. Per CLAUDE.md / 0.2.5 precedent the changelog is "out of strict plan scope," but the user opened the file in the IDE during this phase; interpreting the signal.
5. **Authored** the operator-side E2E runbook (this doc, §Manual E2E runbook below). The seven scenarios from the M1 plan §Phase 6 task 2 — what to run, what to expect, how to recover.

---

## Where (file-level)

| Action | Path | LOC | Note |
|---|---|---|---|
| modified | `frontend/src/app/sign-in/page.tsx` | +1 / −1 | `createClient()` moved from component-scope into `onSubmit` |
| modified | `docs/changelog.md` | +60 | New 0.2.7 entry; index pointer; supersession note for 0.2.0 |
| new | `docs/completions/onboarding-wizard-phase-6.md` | this file | Phase 6 record + E2E runbook |

Untouched (intentionally):
- All Phase 1–5 application code. Cleanup grep found nothing requiring edits.
- `frontend/src/lib/supabase/client.ts` — the `process.env.NEXT_PUBLIC_SUPABASE_URL!` non-null assertion still exists; the fix moves the *call site*, not the helper. The helper is correct as-is for non-prerender use.
- `frontend/src/app/page.tsx` (root SSR redirect) — also calls `createClient()` server-side, but via `lib/supabase/server.ts` which uses `createServerClient` and never throws on empty env at module load. Different code path; unaffected.

---

## Why each call

### Why fix `/sign-in` here, not in a separate hardening pass

Phase 1 logged the failure with: *"The fix belongs to either (a) Phase 6, or (b) a separate hardening task that pre-dates this milestone."* By the time Phase 6 ran, options (a) was a 1-line fix that legitimately let the milestone declare a clean build, and (b) was a separate doc + commit + review cycle for the same outcome. The bias toward (a) is a matter of cycle time, not of scope creep.

The fix is also strictly within the FE-only spirit of M1. No backend changes, no schema, no proto. Pure FE bug-fix wedged into the milestone that touched the sign-in surface anyway (the wizard's redirect target is `/sign-in` on signed-out callers).

### Why move `createClient()` into `onSubmit` instead of marking the route `dynamic = "force-dynamic"`

Two options Phase 1 listed:
1. Move `createClient()` into the `onSubmit` handler — only runs at user-interaction time, never at prerender.
2. Add `export const dynamic = "force-dynamic"` to skip prerender entirely.

Picked (1). Reasons:
- **Smaller blast radius.** Option (2) makes the entire route runtime-rendered. Sign-in is a static form — every byte that comes back from the server is identical until JS hydrates. Marking it dynamic forfeits the prerender + CDN caching for no functional gain.
- **Honest about the dependency.** Option (1) makes it visible *that* the supabase client is only needed at submit time. Anyone reading the file later can see "ah, this only matters when the user clicks the button" rather than "ah, the route is dynamic for some reason."
- **Closes the bug class, not just the symptom.** Option (2) silences the prerender error but leaves the same module-scope-level call. If a future page calls `createClient()` at module scope and is *not* explicitly marked dynamic, the same error returns. Option (1) sets a precedent: never construct supabase clients eagerly in client components — construct them at use site.

The cost of option (1) is one extra `createClient()` call per submit. Negligible; client construction is a few hundred microseconds on cached transport state.

### Why the changelog entry is in 0.2.7, not a 0.3.0

The 0.2.x series captures incremental work toward the post-0.2.0 frontend goals: `0.2.1` seeding removed, `0.2.2` env file placement, `0.2.5` provisioning, `0.2.6` ES256, `0.2.7` first roadmap milestone. Each is a sub-bump because the milestone itself is sub-1.0 (we're in scaffolding/M1 territory; 0.3.0 would suggest something bigger like "first major feature complete," which is closer to M4). Following the existing rhythm.

The minor-bump-vs-major-bump call here is convention, not policy — there's no automated tooling consuming the version number yet. Worth a one-line note in the changelog header if a versioning policy ever crystallises.

### Why the changelog draft sits alongside the completion doc rather than replacing it

The completion docs are an audit trail of *engineering* decisions per phase. The changelog is the project-wide narrative for *what shipped and why* in human-friendly form. Same source material, different audience: a future contributor reading the completion docs is debugging an architectural choice; a future contributor reading the changelog is asking "what was the project up to in April 2026?" Both are load-bearing; neither replaces the other.

---

## Validation log

```
$ pnpm -C frontend type-check
> tsc --noEmit
(exit 0, no output)

$ pnpm -C frontend lint
> eslint
(exit 0, no output)

$ pnpm -C frontend build
✓ Compiled successfully in 1578ms
✓ Generating static pages using 11 workers (10/10) in 256ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /agents
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
└ ○ /sign-in

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Eight routes. Six listed as static (`○`) plus `_not-found`; root (`/`) is dynamic because of the SSR-side auth check that decides between `/dashboard` and `/sign-in`. Middleware annotated as `Proxy` per the Next 16 deprecation warning ("The 'middleware' file convention is deprecated. Please use 'proxy' instead.") — flagged in the changelog as Known Pending Work; not a regression from anything M1 did.

Cleanup grep:
```
$ grep -rn "TODO\|FIXME\|XXX" frontend/src --exclude-dir=gen --exclude-dir=ui
(no output)

$ grep -rn "console\.\(log\|warn\|error\|debug\)" frontend/src --exclude-dir=gen --exclude-dir=ui
(no output)

$ ls frontend/src/app/dashboard 2>/dev/null
(directory does not exist — removed cleanly by Phase 3's git mv)
```

---

## Manual E2E runbook (operator-side, deferred from automated)

Seven scenarios. Run against a local backend (`overmind start` or `cd backend && air`) plus a real Supabase project (the one referenced by `frontend/.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`). Estimated total time: 10–15 minutes for a clean pass.

### Pre-flight

- [ ] `overmind start` (or `cd backend && air` plus `pnpm -C frontend dev` in another shell). Backend on `:8080`, FE on `:3000`. Both heartbeats clean — no startup errors in either log stream.
- [ ] At least one Supabase project user exists. If signing up a fresh user, do it via the Supabase dashboard (not the FE — sign-up isn't yet a route). The provisioning trigger from 0.2.5 will create matching `public.users` + `public.organizations` rows automatically.
- [ ] DB is on a state where the test user's `public.users.name` is `NULL`. `psql "$DATABASE_URL_DIRECT" -c "SELECT auth_user_id, name FROM public.users WHERE email = '<test-email>';"` should return `name = (null)`. If it isn't null, reset with `UPDATE public.users SET name = NULL WHERE email = '<test-email>';`.
- [ ] Browser DevTools open with Network + Console tabs visible.

### E2E-1 — Fresh user happy path

1. Navigate to `http://localhost:3000`. Expect: redirect to `/sign-in` (root SSR redirect for unauthenticated visitors).
2. Sign in with the test user's email + password.
3. Expect: redirect chain `/sign-in` → `/dashboard` → `/onboarding` (the chrome layout's gate detects the empty `name` and forwards). Final URL: `/onboarding`.
4. Expect: form renders. Name field empty + autofocused. Workspace field pre-filled with the auto-generated `<email-local-part>'s Workspace` value from the trigger.
5. Type a name (e.g., "Alice"). Optionally edit the workspace name.
6. Click `Continue`.
7. Expect: success toast `Welcome to Corellia, Alice.` (top-right or bottom-right per sonner default). URL replaces to `/dashboard`. Page renders chrome with sidebar + top bar.
8. Verify chrome shows: Corellia brand mark in sidebar, four nav items (Dashboard active), workspace name in top bar (whatever you submitted), avatar with `A` (or two-letter initials if name has multiple words) in top right.
9. Verify dashboard renders: `Welcome back, Alice.` heading, two-card grid (`Spawn your first agent` primary, `Fleet at a glance` outlined).

### E2E-2 — Returning user skips wizard

1. From the dashboard, click the avatar → `Sign out`. Expect: redirect to `/sign-in`.
2. Sign in again with the same user.
3. Expect: redirect chain `/sign-in` → `/dashboard`. **Crucially: no `/onboarding` step.** The chrome layout's gate sees `user.name` non-empty and renders directly.
4. Verify: dashboard renders as in E2E-1 step 9.

### E2E-3 — Already-onboarded user manually visits `/onboarding`

1. From the dashboard, manually navigate to `http://localhost:3000/onboarding`.
2. Expect: brief flash of `Loading…` (the wizard's own initial fetch), then `router.replace('/dashboard')` fires. Final URL: `/dashboard`. Wizard form *should not* appear.
3. Verify by URL: back-button doesn't return you to `/onboarding` (forced redirect via `replace`, not `push`).

### E2E-4 — Placeholder pages

1. Click `Agents` in the sidebar. Expect: navigation to `/agents`. URL updates without full reload (Next `<Link>`). Sidebar `Agents` item gains active highlight.
2. Verify `/agents` renders a `Coming Soon` card with title "Agents," ETA chip "Available in v1," and the description copy "Pick a harness, configure it, and deploy. Hermes ships first; more harnesses follow." Browser tab title: `Agents — Corellia`.
3. Repeat for `Fleet` (ETA "Available in v1") and `Settings` (ETA "Polish pass").
4. Confirm sidebar's "Soon" badges render in muted text on all three nav items.

### E2E-5 — Backend down → graceful errors

1. From any chrome route, kill the backend process (Ctrl-C in the terminal running `overmind start` or `air`).
2. Refresh the browser.
3. Expect: layout's loading skeleton briefly, then either a layout-level error card (`Something went wrong`) with a sign-out button, or a transient transport error toast. **The chrome should not crash to a blank page or a React unhandled-error boundary.**
4. (Optional sub-case) On the dashboard, trigger a refresh in the network tab while backend is down — error path should resolve via the layout's fail-loud branches.

### E2E-6 — Backend back up

1. Restart the backend (`air` or `overmind start`).
2. Refresh the browser.
3. Expect: clean render of the chrome plus dashboard content. No stale error state.
4. Verify by Network tab: exactly *one* `/corellia.v1.UsersService/GetCurrentUser` call and *one* `/corellia.v1.OrganizationsService/GetOrganization` call on layout mount; *no* additional fetches from the dashboard page itself (Phase 5's `UserContext` lift verified).

### E2E-7 — DB row check

```bash
psql "$DATABASE_URL_DIRECT" <<'EOF'
SELECT auth_user_id, email, name, role FROM public.users WHERE email = '<test-email>';
SELECT id, name FROM public.organizations;
EOF
```

Expect:
- `public.users.name` is the value submitted in E2E-1 step 5.
- `public.organizations.name` is the value submitted in E2E-1 step 5 (whether you kept the default or edited it).
- `public.users.role` is `admin` (Pattern A — every signup admins their own org per 0.2.5 decision 5).

### Failure recovery

- **E2E-1 step 3 doesn't redirect to `/onboarding`.** Likely cause: `public.users.name` is not actually NULL. Run the reset SQL from the pre-flight, sign out, sign back in.
- **E2E-1 step 7 lands on `/dashboard` but greeting is generic ("Welcome back.").** The `UpdateCurrentUserName` RPC failed. Check the backend log for the request — if the row updated but the response failed, re-running E2E-1 from step 1 will redirect you back to onboarding (the layout sees `name` is now set, so the redirect won't fire — meaning the update did succeed, just the response was lost). If the backend log shows the update did *not* land, it's a backend-side bug (out of M1 scope).
- **E2E-3 doesn't redirect.** Likely cause: stale browser cache. Hard refresh (Cmd-Shift-R / Ctrl-Shift-R). If still doesn't redirect, check browser DevTools console for runtime errors in `/onboarding/page.tsx`'s mount effect.
- **E2E-5 crashes the page entirely.** Bug. File against M1; would have been caught in this run-through.

### Sign-off

If all seven scenarios pass with the expected outcomes, M1 is shippable. Mark this doc's status to `complete (operator verified)` and move `docs/executing/onboarding-wizard.md` to `docs/executed/` (or `docs/archive/`).

---

## Findings (out of M1 scope)

### Build emits `middleware → proxy` deprecation warning

```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
```

Already flagged in Phase 1's findings; surfaces again in Phase 6's build output. Not a regression. Mechanical migration when convenient.

### Build worker count varies

The build runs across 11 workers in this verification (was 7 in Phase 1). Next.js scales workers to available CPU cores at build time — observed-behaviour, not configurable in any meaningful way. Mentioning so a future build that shows fewer workers isn't mistaken for a regression.

### `lib/supabase/client.ts` non-null assertion still hides build-time failures

The `createClient()` helper still does:
```ts
return createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

If anyone *re-introduces* a module-scope `createClient()` call in a `"use client"` page later, the same prerender failure returns. The Phase 6 fix moves the call site, not the trap. A more defensive approach — throw a contextful error at the helper level when env vars are missing — is logged for the polish pass.

---

## Sign-off (this completion doc)

M1 is **engineering-complete**. The full FE check matrix is green. The cleanup pass is clean. The sign-in prerender bug is closed. The changelog entry is drafted. The seven-scenario E2E runbook above is the final gate; running it is the last operator-side action before M1 can be declared shipped.

After E2E sign-off:
- `docs/executing/onboarding-wizard.md` moves to `docs/executed/` (or `docs/archive/`).
- The next plan (`docs/plans/agent-catalog.md` for M2 — already drafted per Phase 1's findings on pre-existing master state) starts.
