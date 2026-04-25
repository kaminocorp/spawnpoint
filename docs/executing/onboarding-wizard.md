# Plan — M1: Onboarding wizard + dashboard shell

**Status:** approved, ready to execute
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/plans/post-0.2.6-roadmap.md` §M1 (parent roadmap; this is its detailed plan)
- `docs/changelog.md` §0.2.5 (provisioning + `Update*Name` RPCs landed; FE caller still missing — this plan is that caller)
- `docs/blueprint.md` §10 (RPG-character-creation flow — the chrome we land here is what step 9 redirects into), §11.4 (deferred features stub as real interfaces, not fake buttons — applies to placeholder nav)
- `docs/stack.md` §1 (FE stack), §4 (FE↔BE contract — Supabase only for auth, all data via Connect RPCs), §11.10 (FE never hits Supabase for app data)

---

## 1. Objective

Close the visible UX gap between "amber 'not provisioned' panel" and "blank dashboard with just an email," and put the navigation chrome in place that the rest of v1 will plug into. This is the cheapest visible win in the codebase right now: every backend dependency already shipped in 0.2.5; the entire milestone is FE consumption.

After this pass:

1. **A new user signs in → wizard prompts for name + workspace name → submits → lands on a real dashboard.** The wizard at `/onboarding` consumes `users.UpdateCurrentUserName` + `organizations.UpdateOrganizationName` (both RPCs already wired, no FE caller before this).
2. **Returning users skip the wizard.** The chrome layout's onboarding gate detects `user.name` is set and renders directly.
3. **The dashboard has navigation chrome.** Sidebar with `Dashboard / Agents / Fleet / Settings`, top bar with workspace name and user menu. Three of the four destinations are placeholder routes ("Coming soon" cards) — but the *navigation* is real per blueprint §11.4. The product looks like a product instead of a dev scaffold.

After M1 lands, M2 (catalog) can be implemented as a single edit to `/agents/page.tsx` plus a backend slice — the chrome doesn't change.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Wizard surface | Dedicated `/onboarding` route (not a modal on `/dashboard`) | Cleanly separable from the chrome we're adding in the same milestone; back-button-friendly; standard Next.js pattern; one less coupling between two pieces shipping together |
| 2 | "Is this user onboarded?" signal | `user.name` is non-empty (proto `optional string name = 5`) | No new DB column needed — `name` already exists from 0.2.5; semantically correct (you're onboarded once you've named yourself); `name` is `*string` in Go, `string \| undefined` in TS, so the empty check is `!user.name?.trim()` |
| 3 | Onboarding-gate location | Client-side check in `app/(app)/layout.tsx` (the new chrome layout) | Mirrors existing dashboard four-state pattern; no SSR Connect setup needed; redirect happens once for the whole protected subtree |
| 4 | Wizard auth check | Wizard's own client-side check before showing the form | Defence in depth; wizard is reachable directly via URL; root `middleware.ts` only refreshes the session, doesn't gate routes |
| 5 | Org-name field default | Pre-fill from `organizations.GetOrganization` (auto-generated `alice's Workspace` from the trigger) | Reveals what the trigger did; lets the user keep or replace; trim + min(1) before submit |
| 6 | User-name field default | Empty | No reasonable default; we don't have first/last name on `auth.users` and the email local-part is a poor proxy ("alice.smith@example.com" → "alice.smith" reads like a username, not a display name) |
| 7 | Submit shape | `Promise.all([updateCurrentUserName, updateOrganizationName])` | Independent updates; either succeeds independently; partial success leaves the user in a defined state (re-entering the wizard pre-fills with whichever already persisted) |
| 8 | Validation | zod schema: `.trim().min(1).max(80)` on both fields | Standard form validation; matches the BE input-validation follow-up flagged in 0.2.5 "Known pending work"; max(80) is generous and well below any DB constraint |
| 9 | Form lib | `react-hook-form` + `@hookform/resolvers` + `zod` | All three already in `package.json`; idiomatic shadcn pairing |
| 10 | Toasts | `sonner` (`<Toaster />` added to root layout) | Already installed; not yet mounted; one-line addition |
| 11 | Route group | New `app/(app)/` containing `dashboard`, `agents`, `fleet`, `settings`. Sign-in + onboarding stay outside | Route group is Next.js's idiomatic mechanism for "shared layout for some routes, none for others"; the parens prevent it from appearing in the URL |
| 12 | Sidebar component | shadcn's `Sidebar` primitive (collapsible) | `components.json` already declares style `base-nova`; shadcn's `Sidebar` is the canonical pick and saves ~200 LOC of custom layout work |
| 13 | Disabled nav items | Visible link with a small `Soon` badge in muted text + `aria-disabled` | Both signals at once: nav structure is real, destination isn't ready. *Not* a blocked-link with a fake-feeling tooltip |
| 14 | Settings page in M1 | Placeholder ("Coming soon" card) — same shape as Agents/Fleet | Tempting to wire a basic name/workspace edit form here, but that re-opens scope and the wizard already covers both fields. Defer to a later polish plan |
| 15 | Dark mode | Out of scope | `next-themes` is already in deps; mounting a `ThemeProvider` + a toggle is a clean follow-up. CSS variables already exist for both themes (`globals.css` has the `.dark` block) |
| 16 | User menu | Avatar with initials (from `user.name` or `user.email[0].toUpperCase()`) + dropdown with `Sign out` | Standard pattern; no real avatar storage in v1; initials look intentional, not placeholder |
| 17 | Workspace name in top bar | Fetched once via `organizations.GetOrganization`, no edit affordance in M1 | Edit lives in the wizard; "rename your workspace" from the chrome itself is settings-page work (deferred per #14) |
| 18 | Already-onboarded user visiting `/onboarding` | Client-side redirect to `/dashboard` on mount | Idempotent; defence against bookmarked-onboarding URL; no duplicate-onboarding state possible |
| 19 | Page titles | Update root metadata to "Corellia"; per-route `metadata` exports for `/onboarding` ("Welcome to Corellia"), `/dashboard`, `/agents`, etc. | Cheap polish; helpful for demo-watchers and tab management |
| 20 | Auto-refresh `getCurrentUser` after wizard submit | Cache-bust by re-fetching on dashboard mount, OR pass through hash/state | Simplest: dashboard `useEffect` already re-fetches on mount; `router.replace('/dashboard')` produces a full mount, so no extra plumbing needed |

### Decisions deferred (revisit when named caller arrives)

- **Edit-name affordance from chrome.** Shipping behind `/settings` later. M1 ships a one-shot wizard.
- **Avatar uploads.** Out of v1.
- **Real-time session-expiry handling.** If the access token expires mid-session, current behaviour is a 401 toast; deferring proper refresh-on-401 to a later polish pass.
- **Server-side render of the onboarding gate.** Currently client-side for parity with dashboard. SSR would require a Connect client running in a Server Component — viable, but a refactor of broader scope.

### Follow-up plans (to be written after this lands)

- **`docs/plans/agent-catalog.md`** (M2). Single edit to `/agents/page.tsx` plus the backend slice.
- **`docs/plans/settings-page.md`** (polish). Real settings content: rename, sign out, eventually invite members.
- **`docs/plans/dark-mode.md`** (polish). `next-themes` provider + toggle in user menu.

---

## 3. Pre-work checklist

Before Phase 1, confirm:

- [ ] Backend running locally with the 0.2.5/0.2.6 changes (`overmind start` or `cd backend && air`). Verify by hitting `/healthz` → 200, `POST /corellia.v1.UsersService/GetCurrentUser` without a header → 401.
- [ ] Frontend builds clean today (`pnpm -C frontend type-check && pnpm -C frontend lint`).
- [ ] At least one test user provisioned in the target Supabase project, signed-in once, so the trigger has fired and `public.users` + `public.organizations` rows exist.
- [ ] That test user's `public.users.name` is `NULL` (not yet onboarded). If it isn't, `UPDATE public.users SET name = NULL WHERE auth_user_id = '<uuid>';` to reset, or sign up a fresh user.

---

## 4. Implementation phases

Six phases. Each one is independently runnable — at the end of each phase the app boots, type-checks, lints, and demos a partial-but-coherent improvement. Phase 2 can be merged ahead of Phase 3 if scope splits.

### Phase 1 — shadcn additions + root layout polish

**Goal:** non-behavioral foundation. New shadcn primitives in `components/ui/`, `<Toaster />` mounted, page metadata fixed. Nothing user-visible changes; this is the "we're working in this codebase now" preamble.

**Tasks**

1. **Install missing shadcn primitives.** From `frontend/`:
   ```bash
   pnpm dlx shadcn@latest add sidebar avatar dropdown-menu separator skeleton form
   ```
   Lands in `src/components/ui/`. Adds zero runtime deps not already present (`@base-ui/react`, `class-variance-authority`, `lucide-react`, `react-hook-form` are already in `package.json`).

2. **Update root metadata.** `src/app/layout.tsx`:
   - `metadata.title`: `"Create Next App"` → `"Corellia"`.
   - `metadata.description`: `"Generated by create next app"` → `"Control plane for AI agents."` (one short sentence — vision.md's framing).

3. **Mount sonner Toaster.** Inside `<body>` in `src/app/layout.tsx`, after `{children}`:
   ```tsx
   <Toaster richColors closeButton />
   ```
   Import from `@/components/ui/sonner`.

4. **Type-check + lint baseline.** `pnpm -C frontend type-check && pnpm -C frontend lint` — both must pass before moving on. Captures any shadcn-add fallout.

**Acceptance**

- New components exist under `src/components/ui/` and import cleanly.
- Browser tab shows "Corellia" instead of "Create Next App."
- Toasting from any component works end-to-end (verify by adding a temporary `toast.success("hi")` somewhere, then deleting).

---

### Phase 2 — Onboarding wizard at `/onboarding`

**Goal:** a freshly-provisioned user can navigate to `/onboarding` (or be redirected there in Phase 3), fill the form, submit, and land on `/dashboard` with both names persisted. Standalone — does not depend on chrome.

**Tasks**

1. **New file: `src/app/onboarding/page.tsx`.** Client component. Layout-less (the existing root `<body className="min-h-full flex flex-col">` provides centering on a card).

2. **State machine.** Mirror dashboard's four-state union; add a `submitting` state for in-flight:
   ```ts
   type State =
     | { kind: "loading" }              // initial getCurrentUser + getOrganization
     | { kind: "ready"; defaultOrgName: string }
     | { kind: "submitting"; defaultOrgName: string }
     | { kind: "not-provisioned" }
     | { kind: "error"; message: string };
   ```

3. **Initial fetch on mount.** Parallel `Promise.all([getCurrentUser, getOrganization])` — but `getOrganization` requires `id`, so we sequence: `getCurrentUser` first, extract `user.orgId`, then `getOrganization({id: user.orgId})`.
   - If `getCurrentUser` returns `PermissionDenied` → state `not-provisioned`. Render the same amber panel pattern dashboard uses; provisioning trigger should have fired but if it didn't this is the safety net.
   - If `getCurrentUser` returns `Unauthenticated` → `router.replace('/sign-in')`.
   - If `user.name?.trim()` is non-empty → already onboarded; `router.replace('/dashboard')`. (Locks decision #18.)
   - Else state `ready` with `defaultOrgName = org.name`.

4. **Form.** `react-hook-form` + `zodResolver`. Schema:
   ```ts
   const schema = z.object({
     name: z.string().trim().min(1, "Required").max(80),
     orgName: z.string().trim().min(1, "Required").max(80),
   });
   ```
   Two text inputs (`name`, `orgName`), labels, error messages, a single primary `Continue` button. Use the shadcn `Form` primitive added in Phase 1 for consistency.

5. **Submit handler.** Parallel update via `Promise.all`:
   ```ts
   await Promise.all([
     api.users.updateCurrentUserName({ name: values.name }),
     api.organizations.updateOrganizationName({ id: user.orgId, name: values.orgName }),
   ]);
   ```
   On success: `toast.success("Welcome to Corellia, <name>")` → `router.replace('/dashboard')`. On `ConnectError`: surface `err.message` via `toast.error(...)` and stay on the form (state flips back from `submitting` → `ready`).

6. **Copy.** Headline: "Welcome to Corellia." Subhead: "Just two things before we get started." Field 1 label: "What should we call you?" Field 2 label: "What's this workspace called?" Field 2 helper text: "We've started with a default — feel free to change it." `Continue` button.

7. **Per-route metadata.** Export `export const metadata = { title: "Welcome to Corellia" }` from a sibling layout (`app/onboarding/layout.tsx`) — *not* the page itself, since `"use client"` pages can't export `metadata`.

**Acceptance**

- Direct visit to `/onboarding` while signed-out redirects to `/sign-in`.
- Direct visit to `/onboarding` while signed-in but unprovisioned shows the amber panel.
- Direct visit while signed-in and unprovisioned-name renders the form with org name pre-filled.
- Direct visit while signed-in and already-named redirects to `/dashboard`.
- Submit with both fields valid → both rows updated in DB (verify via `psql`), toast appears, redirected to `/dashboard`.
- Submit with empty name → zod validation message appears inline, no RPC call.
- Submit during a backend outage → red toast surfaces the Connect error string; form remains.

---

### Phase 3 — Chrome layout via `(app)/` route group

**Goal:** dashboard and the placeholder routes share a sidebar + top bar; onboarding gate moves into the layout.

**Tasks**

1. **Create the route group.** New directory `src/app/(app)/`. Move `src/app/dashboard/page.tsx` to `src/app/(app)/dashboard/page.tsx`. URL is unchanged (Next.js route groups don't affect paths).

2. **New file: `src/app/(app)/layout.tsx`.** Client component. Hosts the sidebar + top bar shell *and* the onboarding gate.

3. **Layout state machine.** Mirror dashboard's pattern:
   ```ts
   type State =
     | { kind: "loading" }
     | { kind: "ready"; user: User; org: Organization }
     | { kind: "not-provisioned" }
     | { kind: "error"; message: string };
   ```
   On mount: `getCurrentUser` → if `PermissionDenied` → `not-provisioned`; if `Unauthenticated` → redirect `/sign-in`; if `!user.name?.trim()` → `router.replace('/onboarding')`; else fetch `getOrganization({id: user.orgId})` and flip to `ready`.

4. **Render branches.**
   - `loading`: skeleton chrome (sidebar + content area with `Skeleton` blocks).
   - `not-provisioned`: amber panel, full-page (no sidebar — the user has no workspace yet, so chrome would be lying).
   - `ready`: sidebar + top bar + `<main>{children}</main>`.
   - `error`: full-page error card with sign-out button.

5. **New file: `src/components/app-sidebar.tsx`.** Wraps shadcn's `Sidebar` primitive. Items array:
   ```ts
   const items = [
     { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, ready: true },
     { href: "/agents",    label: "Agents",    icon: Sparkles,        ready: false },
     { href: "/fleet",     label: "Fleet",     icon: Box,             ready: false },
     { href: "/settings",  label: "Settings",  icon: Settings,        ready: false },
   ];
   ```
   - Active state: `usePathname()` === `item.href`.
   - `ready: false` items render with a `Soon` badge after the label and `aria-disabled="true"` — the link is still navigable (clicking lands on the placeholder page), but visually marked as not-ready.

6. **New file: `src/components/app-top-bar.tsx`.** Right-aligned: workspace name (plain text, from `org.name`) + user menu. User menu is a shadcn `DropdownMenu`:
   - Trigger: `Avatar` showing initials (`getInitials(user.name ?? user.email)` — first letter of name, or first letter of email; cap at 2 chars).
   - Items: display name + email (read-only), separator, `Sign out` (calls existing supabase signOut, then `router.push('/sign-in')`).

7. **Move sign-out logic.** Remove the inline `Sign out` button + `signOut` function from `(app)/dashboard/page.tsx` — now lives in the user menu.

**Acceptance**

- Direct visit to `/dashboard` while signed-out → `/sign-in`.
- Direct visit to `/dashboard` while signed-in unprovisioned-name → `/onboarding`.
- Direct visit to `/dashboard` while signed-in and named → renders chrome with active sidebar item, user's initials in avatar, workspace name in top bar.
- Sidebar nav clicks update URL and active state without full reload (`<Link>` from `next/link`).
- Sign-out from user menu lands on `/sign-in` and the session cookie is cleared (verify via DevTools).

---

### Phase 4 — Placeholder pages for Agents / Fleet / Settings

**Goal:** the three "Coming soon" destinations exist as real routes inside the chrome, satisfying blueprint §11.4 in spirit (the navigation is real; only the destination content is stubbed).

**Tasks**

1. **New file: `src/components/coming-soon.tsx`.** Reusable. Props: `{ title: string; description: string; eta?: string }`. Renders a centered `Card` with the lucide `Construction` icon + a one-line description + optional ETA chip ("Available in v1" / "Available in v1.5"). Used by all three placeholder pages.

2. **New file: `src/app/(app)/agents/page.tsx`.**
   ```tsx
   <ComingSoon
     title="Agents"
     description="Pick a harness, configure it, and deploy. Hermes ships first; more harnesses follow."
     eta="Available in v1"
   />
   ```
   Per-route `metadata.title` = "Agents".

3. **New file: `src/app/(app)/fleet/page.tsx`.**
   ```tsx
   <ComingSoon
     title="Fleet"
     description="Every spawned agent, with status and logs. Fills in once spawn lands."
     eta="Available in v1"
   />
   ```

4. **New file: `src/app/(app)/settings/page.tsx`.**
   ```tsx
   <ComingSoon
     title="Settings"
     description="Workspace name, members, billing. For now, you can rename your workspace from sign-up."
     eta="Polish pass"
   />
   ```

**Acceptance**

- Three new routes render their `ComingSoon` card inside the chrome, with the correct sidebar item active.
- Tab title changes per route.

---

### Phase 5 — Dashboard refresh

**Goal:** the dashboard is no longer a debug page showing only the email. It welcomes the named user and previews the rest of the product, so the demo at the end of M1 is coherent.

**Tasks**

1. **Strip page-level header.** `(app)/dashboard/page.tsx` no longer renders its own `<h1>Corellia</h1>` or sign-out button (both moved to the chrome).

2. **State machine simplification.** Layout already gates `not-provisioned` and `loading`. Dashboard can assume an authenticated, provisioned, named user and just consume `getCurrentUser` for the welcome name. Or — cleaner — accept user data via React context (`UserContext` provided by the layout). Decision: **lift to context.** Saves a duplicate fetch on every chrome page.
   - New file: `src/lib/api/user-context.tsx` exporting `UserProvider` (used by `(app)/layout.tsx`) and `useUser()` hook returning `{ user: User; org: Organization }`.

3. **Dashboard content.** Three cards in a grid:
   - Welcome card: `Welcome back, {user.name}.` + one-line description of what Corellia is.
   - "Spawn your first agent" card: brief copy + a primary `Browse harnesses` button that links to `/agents` (works today — lands on the Coming soon page; in M2 lands on the catalog).
   - "Fleet at a glance" card: brief copy + secondary `View fleet` button linking to `/fleet`. Empty-state copy: "No agents yet."

4. **Per-route metadata.** `metadata.title` = "Dashboard".

**Acceptance**

- Dashboard renders three cards inside the chrome.
- Clicking `Browse harnesses` navigates to `/agents` and the sidebar's `Agents` item becomes active.
- No duplicate `getCurrentUser` fetch (verify via Network tab — exactly one call on first chrome render, none on subsequent route changes within the chrome).

---

### Phase 6 — Validation matrix + cleanup

**Goal:** prove the milestone end-to-end before declaring done.

**Tasks**

1. **Run the full FE check matrix.**
   ```bash
   pnpm -C frontend type-check
   pnpm -C frontend lint
   pnpm -C frontend build
   ```
   All clean.

2. **Manual E2E run-through, in this order, against a live Supabase + local backend.**
   - **E2E-1.** Fresh user signup via Supabase dashboard (sets `public.users.name = NULL` via the trigger). Sign in via `/sign-in`. Expect: redirect through `/dashboard` → `/onboarding`. Submit form. Expect: toast, land on `/dashboard` with chrome, name visible in top bar avatar, workspace name in top bar.
   - **E2E-2.** Sign out via user menu. Sign back in. Expect: direct land on `/dashboard`, no wizard re-prompt.
   - **E2E-3.** While signed in, navigate manually to `/onboarding`. Expect: immediate redirect to `/dashboard`.
   - **E2E-4.** Navigate to `/agents`, `/fleet`, `/settings`. Expect: each renders a Coming soon card; sidebar active state updates.
   - **E2E-5.** Open DevTools, kill the local backend, click around. Expect: errors surface as red toasts (or amber not-provisioned panel for that specific code), the chrome doesn't crash.
   - **E2E-6.** Bring backend back up, refresh. Expect: clean render, no stale error state.
   - **E2E-7.** SQL check: `SELECT auth_user_id, name FROM public.users WHERE name IS NOT NULL;` should include the test user with their chosen name. `SELECT id, name FROM public.organizations;` should include the renamed workspace.

3. **Delete the original `src/app/dashboard/`** if Phase 3's move left an empty stub. (`git status` should already show this as part of the Phase 3 commit; check.)

4. **Cleanup pass.** Search for `// TODO`, `console.log`, leftover `setState({ kind: "ready", email: ... })` shapes from before context-lifting. Remove.

5. **Update `docs/changelog.md`.** Per-CLAUDE.md / changelog convention — index entry plus a per-phase summary. Out of strict plan scope (decision 14 of 0.2.5 sets the precedent: user writes changelog manually after the pass lands), but worth flagging here so it isn't forgotten.

**Acceptance**

- All seven E2E scenarios pass.
- `pnpm -C frontend build` produces a clean production build.
- No new ESLint warnings or `tsc` complaints.
- Changelog entry drafted (or queued).

---

## 5. Files touched

New:
- `frontend/src/app/onboarding/page.tsx`
- `frontend/src/app/onboarding/layout.tsx` (just for `metadata` export)
- `frontend/src/app/(app)/layout.tsx`
- `frontend/src/app/(app)/dashboard/page.tsx` (moved from `src/app/dashboard/page.tsx` + refreshed)
- `frontend/src/app/(app)/agents/page.tsx`
- `frontend/src/app/(app)/fleet/page.tsx`
- `frontend/src/app/(app)/settings/page.tsx`
- `frontend/src/components/app-sidebar.tsx`
- `frontend/src/components/app-top-bar.tsx`
- `frontend/src/components/coming-soon.tsx`
- `frontend/src/lib/api/user-context.tsx`
- `frontend/src/components/ui/{sidebar,avatar,dropdown-menu,separator,skeleton,form}.tsx` (shadcn-added)

Modified:
- `frontend/src/app/layout.tsx` (metadata + Toaster mount)

Deleted:
- `frontend/src/app/dashboard/page.tsx` (moved into route group)

Untouched (intentionally):
- `frontend/src/app/page.tsx` (root SSR redirect — still correct)
- `frontend/src/app/sign-in/page.tsx`
- `frontend/src/middleware.ts`
- `frontend/src/lib/supabase/*`
- `frontend/src/lib/api/client.ts`
- All proto-generated code under `frontend/src/gen/`
- Backend (zero changes — entire milestone is FE)

---

## 6. Risk register

- **shadcn-add fallout.** Adding six primitives in one shot may pull in additional `@base-ui/react` sub-packages. Mitigation: Phase 1 ends with a clean `type-check + lint` before any logic lands. If a primitive's API has shifted from the version expected, fix in Phase 1 rather than mid-Phase-3.
- **`Sidebar` API shape on Next 16 + React 19.** The shadcn `Sidebar` primitive depends on context providers; verify it works under React 19's stricter rendering rules. If it doesn't, fall back to a hand-rolled flex sidebar — adds ~80 LOC, no architectural change.
- **Race between `(app)/layout.tsx` onboarding gate and Phase 2's standalone wizard auth check.** Both check the same conditions. If the layout redirects first and the wizard re-checks, that's fine — both arrive at the same answer. The duplication is intentional defence-in-depth, not a bug.
- **Stale `User` data after wizard submit.** Wizard updates the row, then `router.replace('/dashboard')` triggers a fresh `getCurrentUser` from the layout — no caching layer between us and the BE, so this just works. If we add SWR or React Query later, *that* plan needs cache-invalidation logic.
- **Partial submit success.** Wizard's `Promise.all` rejects on first failure but the other update may have already landed. Retrying the wizard re-fetches and pre-fills with current state, so the user finishes the unfinished half. Accepted; not a blocker.
- **Disabled-link UX.** Decision #13 keeps placeholder nav items navigable. If user testing reveals confusion ("why does Agents take me to nothing useful?"), revisit by either (a) graying out the nav item with `pointer-events-none` or (b) showing a tooltip on hover. Both are one-liner adjustments.

---

## 7. Out of scope (explicit)

- Any backend change. Zero proto edits, zero migrations, zero handler edits.
- Settings page real content (form for renaming, etc.) — separate plan.
- Dark mode toggle — separate plan.
- Avatar upload — out of v1.
- Real-time session-expiry / refresh-on-401 — separate polish plan.
- Skeleton-based optimistic rendering of the chrome before `getCurrentUser` returns. Phase 3 uses shadcn's `Skeleton` for the loading state, but isn't doing fancy SSR pre-fill.
- Localization. Copy is plain English.
- Any analytics / telemetry hooks.

---

## 8. Definition of done

A new user can sign up via the Supabase dashboard, navigate to the running frontend, sign in, complete the onboarding wizard, land on a dashboard with sidebar nav and a populated top bar, sign out, sign back in, skip the wizard, navigate to all four nav destinations, and have all of it look like a real product instead of a dev scaffold. The full FE check matrix is green. The backend is unchanged.

This is what M1 was scoped for. M2 (the agent catalog) becomes a single page-level edit on top.
