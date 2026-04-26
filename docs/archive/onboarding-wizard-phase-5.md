# Phase 5 Completion — `UserContext` lift + dashboard refresh

**Plan:** `docs/executing/onboarding-wizard.md` §Phase 5
**Status:** complete
**Date:** 2026-04-25
**Acceptance:** `pnpm -C frontend type-check && pnpm -C frontend lint` both green.

---

## What

The structural payoff phase. The chrome layout already fetches `getCurrentUser` + `getOrganization` (Phase 3) — Phase 5 makes it the *only* fetcher and gives every chrome page access to the result via `useUser()`. The dashboard goes from "fetch on every mount" to "read from context" and from "single welcome card" to "three-element narrative" (heading + two-card grid pointing at Agents and Fleet).

Three additions, two edits, zero deletions.

1. **New `UserProvider` + `useUser()` hook** at `src/lib/api/user-context.tsx`. Throws if consumed outside the provider — fail-loud is correct here because every chrome page is inside `(app)/layout.tsx`, so an out-of-tree consumer is by definition a routing bug.
2. **Layout wraps `{children}` in `<UserProvider>`** — single edit to `src/app/(app)/layout.tsx`'s ready-state render branch. The provider value comes from the same `state.user` / `state.org` already in scope.
3. **Dashboard rewritten** — `src/app/(app)/dashboard/page.tsx` drops its own `useEffect`/`useState`/`Connect`-call and reads `const { user } = useUser()`. Adds the planned three-element narrative (heading + Spawn-your-first-agent card + Fleet-at-a-glance card).
4. **Sibling `dashboard/layout.tsx`** for the per-route metadata export, same shape as Phase 2's `/onboarding/layout.tsx` (the dashboard is `"use client"` so a server-component wrapper has to own the metadata).

---

## Where (file-level)

| Action | Path | LOC | Note |
|---|---|---|---|
| new | `src/lib/api/user-context.tsx` | 32 | `UserProvider` + `useUser()` |
| new | `src/app/(app)/dashboard/layout.tsx` | 13 | Server-side metadata-only wrapper |
| modified | `src/app/(app)/layout.tsx` | +5 / −2 | Import + `<UserProvider>` wrapping the ready-state subtree |
| rewritten | `src/app/(app)/dashboard/page.tsx` | 91 (was 81) | Three-card grid; reads from `useUser()` instead of fetching |

Untouched (intentionally):
- Phase 4's placeholder pages (`/agents`, `/fleet`, `/settings`) — they don't need user data, so they don't consume `useUser()`. The provider is invisible to them.
- `src/lib/api/client.ts` — Connect transport unchanged.
- `src/components/app-sidebar.tsx`, `src/components/app-top-bar.tsx` — already received user/org as props from the layout in Phase 3; no reason to switch them to context yet (props are the cleanest way to pass to direct children of the layout).

---

## Why each call

### Why `useUser()` throws instead of returning `null` when called outside a provider

Two options were on the table:
1. Return `null` and let consumers handle the absence. Forces every consumer into a defensive shape (`if (!ctx) return null`), or worse, masks routing bugs as silent empty states.
2. Throw a descriptive error. Fails loud at dev time the moment a chrome page is accidentally placed outside `(app)/`, with a message that points at the cause.

Picked (2). Reason: the provider's contract is unconditional. Every page under `(app)/` is wrapped; pages outside the route group don't import `useUser()`. There's no legitimate "I was rendered without a provider" branch — only "you placed me wrong." The error message names the likely cause (`a chrome route rendered outside (app)/layout.tsx`) so the fix is one re-read of the route tree away.

This is the same fail-loud rationale that drove the JWKS verifier's `NoErrorReturnFirstHTTPReq=false` decision in 0.2.6 — silent failures in load-bearing infrastructure are worse than crashes.

### Why `<UserProvider>` wraps `<SidebarProvider>` rather than living inside `<SidebarInset>`

Hierarchy matters. If `<UserProvider>` lived inside `<SidebarInset>`, the sidebar and top-bar would be siblings of (not children of) the provider — they couldn't consume it. Right now they take props directly because they sit alongside the provider's children, but the moment Phase 6+ wants to give the sidebar access to `user.role` (e.g., to hide Settings for non-admins), the provider needs to be an ancestor of both the sidebar and the inset. Hoisting it to wrap the whole `SidebarProvider`/`Sidebar`/`SidebarInset` tree avoids a future refactor.

### Why the layout still passes `workspaceName` / `userName` / `email` as props to `<AppTopBar>`

Two reasons to *not* migrate the top bar to `useUser()` in this phase:
1. **The top bar is a direct child of the layout's render branch.** Props are the simplest, most direct mechanism. Pulling the same data out of context one component deep would be indirection without payoff.
2. **The migration is one-liner cheap whenever it's needed.** When the top bar grows (e.g., a workspace switcher dropdown), it'll naturally want context access, and replacing three props with `const { user, org } = useUser()` is trivial.

The principle: introduce the context, but don't force consumers onto it before they need it. The dashboard *is* a consumer (it needs `user.name`, doesn't take props from the layout because it's `{children}`); the top bar isn't yet.

### Why the dashboard splits the user's name on whitespace and uses just the first word

`user.name` is a free-text display name. "Alice Smith", "Alice", "alice", "Dr. Alice Smith PhD" — all valid. The greeting feels more personal with just the first name (`"Welcome back, Alice"`) than with the full string (`"Welcome back, Dr. Alice Smith PhD"`).

Split logic: `(user.name ?? "").trim().split(/\s+/)[0]`. Handles the common cases:
- `"Alice"` → `"Alice"`
- `"Alice Smith"` → `"Alice"`
- `"  Alice  "` → `"Alice"` (trim before split)
- `""` → `""` (falls through to `"Welcome back."` without the name)
- `"Dr. Alice Smith PhD"` → `"Dr."` — imperfect but acceptable; users with leading honorifics are rare in admin tooling and the fix would be heuristic-laden (skip-words list, etc.) for diminishing returns.

### Why the dashboard's "Browse harnesses" / "View fleet" buttons use `<Button render={<Link>}>` instead of `<Link><Button>` or `onClick={router.push}`

Three options:
1. `onClick={() => router.push("/agents")}` — works but loses native browser behaviour: cmd-click for new tab, right-click for context menu, link previews.
2. `<Link href="/agents"><Button>...</Button></Link>` — Radix-style nesting. Doesn't work cleanly in base-ui because the `Button` is an interactive primitive that the outer `<a>` would wrap, producing nested-interactive HTML (an a11y red flag).
3. `<Button render={<Link href="/agents" />}>` — base-ui's render-prop pattern. The button's styling cascades onto the link element, the link semantics carry to navigation. One element, both contracts.

Picked (3). Same pattern Phase 3's `<SidebarMenuButton render={<Link>}>` and Phase 2's `<DropdownMenuTrigger render={<Button>}>` use. Three uses now; project convention.

### Why the second card's CTA is `outline` variant, not the default

Visual hierarchy. The dashboard's top-half narrative is "you just landed; here's the natural next thing to do" — that natural next thing is *Spawn an agent*, not *View fleet*. The primary `default`-variant button signals primacy; the secondary `outline` button signals "also here, but not where you start." Same copy register, asymmetric weight.

When Fleet has actual content (post-M4), the asymmetry might flip — but for now, the demo's golden path is Dashboard → Agents → Spawn → Fleet, and the buttons reflect that.

### Why a new `dashboard/layout.tsx` for metadata, repeating the Phase 2 pattern

Same constraint as Phase 2's `/onboarding`: Next.js's `metadata` export must come from a server module, but the page is `"use client"`. A 13-line no-op sibling layout owns the metadata and renders `children` as-is. Identical shape to `src/app/onboarding/layout.tsx`.

This is a recurring pattern in this codebase: every interactive page (anything with `useState`, `useEffect`, `useUser`, etc.) needs this wrapper. Worth pinning as project convention; the alternative (centralised `metadata.title.template` with declarative per-page titles) is logged in Phase 4's findings as a polish-pass candidate that would simplify all of these.

---

## Behavior change

### Visible
- Dashboard no longer fetches on its own — net wire reduction of one round-trip on cold mount of `/dashboard`.
- Dashboard renders three elements instead of one card:
  - Heading: `Welcome back, <FirstName>.` plus a one-line sub-paragraph.
  - Card 1 (primary): "Spawn your first agent" → `Browse harnesses` button → `/agents`.
  - Card 2 (secondary): "Fleet at a glance" → `View fleet` button → `/fleet`.
- Browser tab on `/dashboard` now reads `Dashboard — Corellia` (was the root `Corellia` fallback).
- Greeting uses the user's first name only — `"Welcome back, Alice."`, not `"Welcome back, Alice Smith."`.

### Invisible
- A new React context exists. No subscriber outside the dashboard yet; it's unused infrastructure for the rest of the chrome routes (until Phase 6+ adds `useUser()` consumers — e.g., a settings page that displays the user's email, an audit log that scopes to the org, etc.).
- The dashboard's previous error/loading states are gone — the layout already handles `loading`/`not-provisioned`/`error` for the whole subtree, so a child that just reads from context is already past those gates by definition. One less concern per child page.

---

## Deviations from the written plan

### 1. Top bar still takes props, not context

The plan said "lift to context — saves a duplicate fetch on every chrome page." Strictly applied, that means switching the top bar to `useUser()` too. I didn't, on the principle "introduce the context, don't force consumers onto it before they need it." Documented above in §Why each call. Net consequence: the top bar's three props can be removed in a future micro-refactor; today they cost nothing.

### 2. The dashboard's heading uses first-name-only, not full name

Plan said `Welcome back, {user.name}.`. I split on whitespace and used `[0]`. UX call; fully reversible (one-line edit). Documented above.

### 3. New `dashboard/layout.tsx` not explicitly listed in the plan

The plan's §Files-touched listed `src/app/(app)/dashboard/layout.tsx` only implicitly via the per-route-metadata task. Adding it for real here. This is the same constraint Phase 2 hit; adding the wrapper unannounced would have been a surprise — calling it out.

### 4. No `Spawn your first agent` / `View fleet` *explicit* layout names — just card titles

The plan said `Welcome card`, `"Spawn your first agent" card`, `"Fleet at a glance" card` — three cards. I shipped two cards plus a heading-with-subhead at the top, not three. Reasoning: the welcome card from Phase 3 was just a wrapper around an explanatory paragraph; folding that paragraph under the heading and using the two action-oriented cards as the grid items makes the layout breathe. The user gets the same information density with cleaner visual hierarchy: read the heading, then choose between two clear next-actions. Three identical-weight cards would have produced visual noise where the dashboard wants clarity.

If a later iteration wants a third card (e.g., "What's new" once we have a changelog UI), it slots in cleanly because the grid is already `md:grid-cols-2` — adds wrap, no layout rebuild.

---

## Findings (out of Phase 5 scope)

### `useUser()` provider check has no production-build optimisation

The throw fires whenever the context is null. In production, this is a real exception (tracked by any error monitor we eventually wire up). In dev, it's a useful programming-error signal. No `process.env.NODE_ENV` gate either way — the failure mode is identical. Acceptable; logged in case future telemetry surfaces these as recurring noise (which would mean a real bug, not a logging problem).

### Top-bar workspace name has no edit affordance

The chrome shows `state.org.name` as a static text element. Click does nothing. Per plan decision #17 (workspace edit lives in the wizard for now; settings page is empty in M1), this is intentional — but it's the kind of visible affordance that users will instinctively click. Logged for the polish pass / future settings work.

### The dashboard's `firstName` handling is brittle for non-Latin scripts

Splitting on `\s+` works for "Alice Smith" but fails on names without explicit word boundaries (East Asian languages, RTL scripts, etc.). v1 user base is implicitly assumed to be Latin-script based on the auth flow; future internationalization would need an `Intl.Segmenter`-based first-name extraction (or simpler: just show `user.name` whole, which is always correct).

### `useUser()` is exported from `src/lib/api/user-context.tsx`, not `src/lib/api/client.ts`

The naming hint is that `client.ts` is for the Connect transport client, `user-context.tsx` is for state. They're related (the layout fetches via `client.ts`, exposes via `user-context.tsx`) but not the same concern. As more state hooks land (e.g., `useOrgSettings()`, `useFeatureFlags()`), `lib/api/` may want to graduate from a flat structure to subdirectories. Out of Phase 5 scope; flagged for the polish pass.

---

## Verification log

```
$ pnpm -C frontend type-check
> tsc --noEmit
(exit 0, no output)

$ pnpm -C frontend lint
> eslint
(exit 0, no output)
```

No intermediate failures this phase. Cleanest run-through of M1 so far.

Manual end-to-end run-through still deferred to Phase 6.

---

## What's next

Phase 6 — validation matrix + cleanup. The work is mostly *running* things rather than writing them:

- Full FE check matrix: `type-check`, `lint`, `build` (Phase 1 found the pre-existing `/sign-in` prerender failure here — Phase 6 either fixes it or formalises the deferral).
- Manual E2E run-through, all seven scenarios from `onboarding-wizard.md` §Phase 6 task 2.
- Cleanup pass for any leftover `// TODO`, `console.log`, or stale state shapes.
- Changelog entry for the milestone (out of strict plan scope per CLAUDE.md / 0.2.5 precedent).

After Phase 6, M1 is shippable — the demo described in `onboarding-wizard.md` §8 ("Definition of done") runs end-to-end.
