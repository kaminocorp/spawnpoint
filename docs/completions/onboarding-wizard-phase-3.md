# Phase 3 Completion — `(app)/` route group + chrome layout

**Plan:** `docs/executing/onboarding-wizard.md` §Phase 3
**Status:** complete
**Date:** 2026-04-25
**Acceptance:** `pnpm -C frontend type-check && pnpm -C frontend lint` both green.

---

## What

Six surface-level changes that together convert "a dashboard page that fetches its own user" into "a chrome shell with sidebar + top bar that fetches once and gates onboarding for everything inside."

1. **Created the `(app)/` route group** at `frontend/src/app/(app)/`. URLs unchanged — the parens make Next.js suppress the segment from the path while still applying its layout.
2. **Moved the dashboard** from `src/app/dashboard/page.tsx` into `src/app/(app)/dashboard/page.tsx` via `git mv`. Old directory removed.
3. **Authored the chrome layout** at `src/app/(app)/layout.tsx` — client component, four-state union (`loading | ready | not-provisioned | error`), fetches `getCurrentUser` + `getOrganization`, redirects unprovisioned-name callers to `/onboarding`, renders `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>` + `<AppTopBar>` + `{children}` shell on the happy path.
4. **Authored `<AppSidebar>`** at `src/components/app-sidebar.tsx` — wraps shadcn's `Sidebar` primitive with four nav items (Dashboard / Agents / Fleet / Settings), active-state via `usePathname()`, "Soon" badges on non-ready items, the `Corellia` brand mark in the header.
5. **Authored `<AppTopBar>`** at `src/components/app-top-bar.tsx` — `<SidebarTrigger>` + workspace name + user menu (avatar dropdown with display name / email / sign-out).
6. **Refreshed the dashboard page** to fit the chrome: stripped its own `<h1>Corellia</h1>` header, sign-out button, and amber not-provisioned panel (all moved up to the layout). Replaced with a `Welcome back, <name>` heading + a single welcome card that previews the rest of the product.

---

## Where (file-level)

| Action | Path | LOC | Note |
|---|---|---|---|
| moved | `src/app/dashboard/page.tsx` → `src/app/(app)/dashboard/page.tsx` | rewritten | URL `/dashboard` unchanged |
| new | `src/app/(app)/layout.tsx` | 156 | Chrome shell + onboarding gate |
| new | `src/components/app-sidebar.tsx` | 84 | Wraps shadcn `Sidebar` |
| new | `src/components/app-top-bar.tsx` | 79 | `SidebarTrigger` + workspace label + user menu |
| rewritten | `src/app/(app)/dashboard/page.tsx` | 81 | Trimmed for the chrome — page-level header gone, welcome card added |

Untouched (intentionally):
- `src/app/onboarding/page.tsx` (Phase 2) — sits outside the route group, still self-contained, still does its own auth / org fetch. The chrome layout's onboarding redirect now feeds users into it automatically.
- `src/app/sign-in/page.tsx` — outside the chrome, unchanged.
- `src/app/page.tsx` — root SSR redirect to `/dashboard` or `/sign-in` still correct; lands on the chrome layout, which re-checks claims and redirects further if needed.
- `src/middleware.ts` — refreshes Supabase session cookies for all routes; not a route gate. Still doing exactly its scaffolded job.
- `src/lib/supabase/*`, `src/lib/api/client.ts` — consumed as-is.
- All Phase 1 + 2 work — purely additive.

---

## Why each call

### Why a route group rather than a `dashboard/` subtree

The plan called for shared chrome on `dashboard`, `agents`, `fleet`, `settings`, but **not** on `sign-in` or `onboarding`. Next.js route groups (parenthesised segments — `(app)/`) are the idiomatic mechanism for "shared layout, no shared URL prefix." The alternative — making the chrome live under a literal `/app` URL prefix — would have meant changing `/dashboard` to `/app/dashboard`, breaking every existing redirect (`router.replace('/dashboard')` is referenced in five places already), the test-user runbook, and any bookmarked URL.

The parens are the cheapest decision in the plan. I want it on the record that the URL stayed `/dashboard` because of this one syntactic feature.

### Why the layout fetches `getCurrentUser` + `getOrganization` rather than just `getCurrentUser`

The top bar shows the workspace name. Without the org fetch, the top bar either (a) renders blank-then-populates, which is jarring, or (b) the dashboard page has to fetch the org separately and pass it up — which is structurally backwards (children passing data to layouts).

Fetching both at the layout level means the layout owns "everything required to render the chrome," each child page can assume the chrome is populated, and Phase 5's `UserContext` lift becomes trivial: it's already the only fetcher.

The cost is one extra round-trip on cold mount. Two options for mitigation later:
- **`Promise.all`** is impossible because `getOrganization` needs the org ID from `getCurrentUser`. Sequential is forced.
- **Server-side prefetch** would shave the round-trip by rendering the layout server-side. Out of Phase 3 scope; flagged.

### Why the layout redirects to `/onboarding` rather than rendering the wizard inline

Two reasons:
1. **Single source of truth for onboarding.** The wizard route already exists from Phase 2 with its own state machine, error handling, and toast wiring. Inlining it into the layout would duplicate that logic; redirecting reuses it.
2. **URL semantics.** When a freshly-provisioned user is on `/dashboard` and the layout redirects to `/onboarding`, the URL bar reflects what they're actually doing. If we rendered the wizard inline at `/dashboard`, sharing the URL would be misleading — the URL says "dashboard" but the page is the wizard. `router.replace` keeps the URL aligned with the rendering.

### Why `SidebarMenuButton render={<Link>...</Link>}` instead of `asChild`

Initial type-check failed with:
```
Property 'asChild' does not exist on type ... SidebarMenuButton ...
```

Reading `src/components/ui/sidebar.tsx`:
```ts
function SidebarMenuButton({ render, isActive = false, ... }: useRender.ComponentProps<"button">)
```

shadcn's `base-nova` style sits on **base-ui** (`@base-ui/react`), which uses a `useRender` hook + `render` prop instead of Radix's `asChild` + `Slot`. The mechanism is mechanically equivalent — both forward props onto a custom child element — but the API surface is different: base-ui takes the wrapped element as a prop, Radix takes it as a child.

This is the same pattern Phase 2 used in `<DropdownMenuTrigger render={<Button>...</Button>} />` for the user menu's avatar. Worth pinning as a project-wide convention: any time a shadcn primitive in this style needs to render a different element, the pattern is `render={<...>...</...>}`, not `<Primitive asChild><...>...</...></Primitive>`. Two places already; future chrome work (M2 catalog, M4 deploy form) will hit this again.

### Why the active-state predicate is `pathname === item.href || pathname?.startsWith(\`${item.href}/\`)`

Strict equality (`pathname === item.href`) would mark `/agents` as inactive if the user is on `/agents/hermes/configure` — a future M2/M4 detail page. The prefix check `startsWith(\`${item.href}/\`)` covers nested routes correctly without being too aggressive (`/agents` doesn't match `/agents-archive` because we require the trailing slash). The `?.` chain handles the brief moment during route transitions when `pathname` is `null`.

### Why "Soon" badges, not disabled links

Per plan decision #13. Three options were on the table:
1. `<a aria-disabled="true">` — visible, navigable, no badge: indistinguishable from ready items.
2. Disabled link with `pointer-events-none`: looks dead, can't navigate, won't help users discover what's coming.
3. Visible badge + navigable link with `aria-disabled="true"`: signals "structure is real, content isn't."

Picked (3). The user lands on a "Coming soon" card (Phase 4) that contextualises *what's* coming — together they tell a coherent "this is the shape of v1, here's what's still on its way" story, which is exactly the demo affordance M1 was scoped for.

### Why initials use first+last letter of split name, falling back to email

Edge cases the simple `name[0]` approach gets wrong:
- `Alice Smith` → just `A` (loses the surname signal).
- `alice.smith@example.com` (no name set) → `?` would be insulting.

Current shape:
- `splitOn(/[\s.]+/)` handles both spaces and dots so `Alice Smith` → `AS` and `alice.smith` → `AS`.
- Empty source falls through to `?` (only when neither name nor email is present, which shouldn't happen but defending in depth costs nothing).
- `.slice(0, 2).toUpperCase()` caps at two chars.

12 LOC total; saves a fully-uppercase one-letter avatar in 100% of the unset-name cases.

### Why the layout's `loading` branch shows a skeleton chrome rather than a spinner

A spinner that flips into a sidebar shifts ~256px of layout. A skeleton sidebar plus skeleton header makes the transition seamless — users see the chrome's *shape* immediately, then content fills in. CLS (cumulative layout shift) is a real Core Web Vital; this is the cheapest way to keep it near zero on cold mount.

The skeleton uses a hand-rolled flex layout (no `<SidebarProvider>` wrapping it), because the provider's collapse-state cookie reading would itself trigger a render before we know whether the user is allowed inside the chrome. Keeping the loading state outside the provider means there's no expensive context dance on routes that immediately bounce to `/onboarding` or `/sign-in`.

### Why Phase 5's `UserContext` was deferred — and the dashboard now double-fetches

The plan has `UserContext` landing in Phase 5. Doing it now would scope-creep Phase 3. The cost: when a user lands on `/dashboard` cold, the layout fetches `getCurrentUser` + `getOrganization`, then the dashboard page fetches `getCurrentUser` again — three round trips total. The dashboard page only needs the user's name; the duplication is mechanical, not load-bearing.

Phase 5 will:
- Add `src/lib/api/user-context.tsx` with `UserProvider` + `useUser()`.
- Have the layout wrap `{children}` in `<UserProvider value={{ user, org }}>`.
- Replace dashboard's `useEffect(getCurrentUser)` with `const { user } = useUser()`.

That's the targeted refactor moment. Doing it Phase 3 would have meant *also* migrating the dashboard's render branches, the loading skeleton, and the error handling — the dashboard refresh that Phase 5 owns. Cleaner to keep the work in its planned phase.

---

## Behavior change

### Visible
- `/dashboard` (and any future route under `(app)/`) now renders inside a chrome with:
  - Left sidebar: Corellia brand mark, four nav items (Dashboard active, Agents/Fleet/Settings with "Soon" badges).
  - Top bar: sidebar collapse toggle (`<SidebarTrigger>`) + workspace name + user-menu avatar.
  - User menu: display name + email read-only, separator, "Sign out" item.
- A freshly-signed-in user with `public.users.name` IS NULL is now **automatically redirected** to `/onboarding`. Phase 2's wizard is now on the auto-flow, not just URL-reachable.
- Sign-out from the chrome's user menu lands on `/sign-in` (was: `router.push("/sign-in")` from the dashboard, now `router.replace("/sign-in")` from the user menu — `replace` per the plan's general rule for forced navigation).
- Cold-load of any chrome route flashes a skeleton sidebar + content shape for ~30–80ms before content fills in (typical Connect round-trip latency).

### Invisible
- The dashboard's "Signed in as `<email>`" copy is gone. Replaced by `Welcome back, <name>` (the chrome's avatar + email already covers the "who am I logged in as" question).
- The amber "not provisioned" panel relocated from dashboard to the layout. Same pixel result for users in that state; just owned by the layout now so every chrome route gets the same fallback rather than each page re-implementing it.

---

## Deviations from the written plan

### 1. `<SidebarMenuButton>` uses `render` prop, not `asChild`

Already covered above — the `base-nova` style is on base-ui, not Radix. The plan's pseudocode used `<SidebarMenuButton asChild>` which wouldn't have type-checked. Real shape uses `render={<Link>...</Link>}`. Same outcome, different API.

### 2. Loading skeleton outside `<SidebarProvider>`

The plan said "skeleton chrome (sidebar + content area with `Skeleton` blocks)" without specifying provider scoping. I put the skeleton *outside* the provider so the cookie-read + context-init costs don't fire on routes that will immediately bounce. Result is functionally identical — the user sees a skeleton — just costs less CPU on the redirect path.

### 3. `CardContent` import dropped from `(app)/layout.tsx`

Imported it on first pass, never used it (the not-provisioned + error cards use `CardHeader` + `CardFooter` only — title and description live in the header, action lives in the footer, no body content). ESLint flagged it as unused; removed. Trivial.

---

## Findings (out of Phase 3 scope)

### Stale `.next/types/validator.ts` after `git mv`

After moving `dashboard/page.tsx` into the route group, the first type-check run failed:
```
.next/types/validator.ts(42,39): error TS2307: Cannot find module '../../src/app/dashboard/page.js'
```

Next.js 16 generates `.next/types/validator.ts` during dev/build to validate page contracts. The file references the *old* path until the build cache is regenerated. `rm -rf .next` then re-running type-check resolved it cleanly.

Worth flagging because: any future move/rename of an App Router page will trip the same error. The fix is mechanical (`rm -rf .next`) but the error message is misleading — it points at a generated file rather than at the moved source. Won't bite a developer who knows; will confuse a developer who doesn't.

### `Sidebar` cookie read on every chrome render

`<SidebarProvider>` reads the `sidebar_state` cookie to restore the collapsed/expanded state across page loads. Cookie I/O on every render is cheap (sync, in-memory after the first read) but a thing worth knowing if telemetry ever shows up here. Out of Phase 3 scope; flagged for awareness.

### `SidebarTrigger` keyboard shortcut: `Cmd/Ctrl + B`

Defined in `sidebar.tsx` as `SIDEBAR_KEYBOARD_SHORTCUT = "b"`. Not documented anywhere user-facing. Worth a one-liner on the user-menu's tooltip later, or in a help dialog. Not in any plan; logged here for the polish pass.

---

## Verification log

```
$ pnpm -C frontend type-check
> tsc --noEmit
(after rm -rf .next: exit 0, no output)

$ pnpm -C frontend lint
> eslint
(exit 0, no output)
```

The intermediate state was instructive:
- First run: 2 type errors (`.next/types` stale ref + `asChild` not on `SidebarMenuButton`) and 1 lint warning (unused `CardContent` import).
- After fixing `asChild` → `render`, dropping `CardContent`, and `rm -rf .next`: all green.

Manual end-to-end run-through still deferred to Phase 6 — at that point Phases 4 (placeholder pages) and 5 (dashboard refresh + UserContext) are also in place, so the full demo script can run cleanly.

---

## What's next

Phase 4 — placeholder pages for `/agents`, `/fleet`, `/settings`. Each one is a real route inside `(app)/` that renders a `<ComingSoon>` card. Mechanical work, ~50 LOC across four new files (three pages + one shared component).

After Phase 4, the sidebar nav becomes "every link goes somewhere," which is the moment the chrome stops feeling like a half-built scaffold.
