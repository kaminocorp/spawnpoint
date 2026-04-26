# Phase 4 Completion — Placeholder pages for Agents / Fleet / Settings

**Plan:** `docs/executing/onboarding-wizard.md` §Phase 4
**Status:** complete
**Date:** 2026-04-25
**Acceptance:** `pnpm -C frontend type-check && pnpm -C frontend lint` both green.

---

## What

The smallest user-visible phase in the milestone. Four new files; no edits anywhere else. Every sidebar nav item now lands on a real route — three of them on `<ComingSoon>` cards that contextualise *what* is coming and *when*.

1. **Reusable `<ComingSoon>` component** at `src/components/coming-soon.tsx`. Props: `{ title, description, eta? }`. Renders a centered card with the lucide `Construction` icon, a title, an optional ETA chip in muted text, and a description body.
2. **`/agents` page** at `src/app/(app)/agents/page.tsx` — "Pick a harness, configure it, and deploy. Hermes ships first; more harnesses follow." ETA: *Available in v1*.
3. **`/fleet` page** at `src/app/(app)/fleet/page.tsx` — "Every spawned agent, with status and logs. Fills in once spawn lands." ETA: *Available in v1*.
4. **`/settings` page** at `src/app/(app)/settings/page.tsx` — "Workspace name, members, billing. For now, you can rename your workspace from sign-up." ETA: *Polish pass*.

Each page exports a `metadata.title` for the browser tab.

---

## Where (file-level)

| Action | Path | LOC | Note |
|---|---|---|---|
| new | `src/components/coming-soon.tsx` | 38 | Server component; no `"use client"` needed |
| new | `src/app/(app)/agents/page.tsx` | 16 | Server component with `metadata` export |
| new | `src/app/(app)/fleet/page.tsx` | 16 | Same shape |
| new | `src/app/(app)/settings/page.tsx` | 16 | Same shape |

Untouched (intentionally):
- `src/components/app-sidebar.tsx` — its `items` array already references `/agents`, `/fleet`, `/settings`. The pages now exist; the nav links resolve to real routes instead of 404.
- `(app)/layout.tsx` — chrome already wraps anything under `(app)/`; placeholder pages get the chrome for free.
- Phase 1 / 2 / 3 work — purely additive.

---

## Why each call

### Why a single reusable `<ComingSoon>` rather than three bespoke pages

Three near-identical layouts in three files would triple the surface area for inconsistency. As the v1 / v1.5 / v2 ETAs shift over the milestone sequence, *one* central place to update copy structure, padding, icon, ETA-chip styling — that beats touching three files with three slightly different shapes.

The component is also future-proof against the M2 / M4 swap-in: when `/agents` becomes the real catalog page in M2, replacing it is a one-file edit. When `/fleet` becomes real in M4, same. The `<ComingSoon>` component itself stays put for the *next* round of stubbed features (skills, audit log, IAM in v2 per blueprint §14).

### Why pages are server components, not `"use client"`

These pages do nothing dynamic — no hooks, no event handlers, no data fetching. Default server-component rendering is the canonical Next.js shape for static content. The chrome layout above them is `"use client"` (it has to be, for the auth/onboarding gate's `useEffect`), but children of a client component can still be server components — the boundary is honoured per-file, not per-tree.

A server component also lets us export `metadata` from the page directly. Phase 2's wizard needed a sibling `layout.tsx` for the metadata export because the wizard itself was a client component; here we don't need that wrapper. Same outcome via a simpler shape.

### Why `metadata.title` is `"Agents — Corellia"` rather than just `"Agents"`

The root layout sets `metadata.title = "Corellia"`. Per-route metadata *replaces* (not concatenates) the parent's title — Next.js doesn't have an automatic title chain unless you opt in via the `template` field on the parent. Setting `"Agents — Corellia"` keeps the brand visible in the browser tab + bookmarks while telling the user where they are. The em-dash is a small typographic flourish; en-dash or hyphen would work equally well.

For the wizard (Phase 2) I wrote just `"Welcome to Corellia"` because the brand is in the value already; same energy here, different syntactic shape.

A tidier follow-up would be to set `metadata.title.template = "%s — Corellia"` on the root layout once and let each child set just `"Agents"`. Out of Phase 4 scope; flagged below.

### Why ETA copy distinguishes "Available in v1" from "Polish pass"

Per blueprint §14 (post-v1 roadmap):
- `/agents` and `/fleet` are core M2 + M4 work — they ship inside v1, so "Available in v1" is accurate to the roadmap document.
- `/settings` real content (rename, members, billing) lives in a "polish plan" called out explicitly in `onboarding-wizard.md` §"Follow-up plans" — "Polish pass" matches that framing without committing to a specific version number.

The wording matters because the user sees this card every time they click the nav item. Saying "v1" sets an expectation that the milestone-document scope reinforces; saying "polish pass" sets a softer expectation appropriate for a non-blocking feature.

### Why the icon is `Construction` rather than `Sparkles` / `Clock` / `Hammer`

`Construction` reads as "we're working on this," not "we're excited about this" (`Sparkles`) or "this exists somewhere" (`Clock`). Visual semiotics of stub pages: be honest about the state. `Hammer` was the runner-up but skews more toward "fixing something broken" than "building something new."

Strictly cosmetic; can be swapped without consequence.

---

## Behavior change

### Visible
- `/agents`, `/fleet`, `/settings` now resolve to real routes inside the chrome (was: 404 from the sidebar links in Phase 3).
- Browser tab title changes per route: `"Agents — Corellia"`, `"Fleet — Corellia"`, `"Settings — Corellia"`, `"Corellia"` for the dashboard.
- Sidebar's `Soon` badges now match a destination that *also* says "coming soon" — the two affordances corroborate each other.

### Invisible
- Page-level metadata is the only meaningful semantic addition. SEO doesn't matter here (auth-gated routes), but bookmarks and tab management get clearer.

---

## Deviations from the written plan

### 1. ETA copy diverges slightly from plan wording

Plan said `"Available in v1"` for Agents and Fleet, `"Polish pass"` for Settings — kept verbatim. No deviation here, just confirming.

### 2. Pages are server components, not client components

The plan didn't specify, but the implication of `<ComingSoon>` being purely presentational was that pages needn't carry `"use client"`. Default server rendering keeps bundle size out and lets `metadata` export from the page directly. Worth flagging because Phases 2 and 3 set the precedent of `"use client"` at the page level — Phase 4 deliberately doesn't, and that's intentional for the static content here.

### 3. Two unused imports across the surface (caught by lint)

Initial pass imported `CardDescription` from `@/components/ui/card` in `<ComingSoon>` because the title-then-description pattern often uses it. Settled on a flat structure (icon + title + ETA chip in the header, description in the body) that doesn't need `CardDescription`. Lint flagged it; dropped the import. Common minor friction; one-line fix.

---

## Findings (out of Phase 4 scope)

### `metadata.title.template` would let pages declare just `"Agents"`

Next.js supports the pattern `title: { default: "Corellia", template: "%s — Corellia" }` on the root layout, after which any child setting `title: "Agents"` automatically expands to `"Agents — Corellia"`. The current shape duplicates `— Corellia` across each page.

Cost of refactoring: 1 line in `src/app/layout.tsx`, 3 lines simplified across the placeholder pages. Net diff size identical; *cognitive* surface drops because new pages don't have to remember the suffix.

Out of Phase 4 scope. Logged as a polish-pass candidate.

### `<ComingSoon>` could accept a `Link` prop for "ping me when ready"

A natural future direction: each card has a "Notify me" button that subscribes the user to a release notification when the feature ships. Out of v1 scope per blueprint §13 (no email subsystem). Logged for the eventual v1.5 scope.

### Sidebar's `items.ready: false` and `<ComingSoon eta>` could share a single source of truth

Right now: the sidebar marks `Agents / Fleet / Settings` as `ready: false`, *and* each page declares its own ETA copy. Two places to keep in sync as features land. Could centralise in a small `routes.ts` map: `{ "/agents": { label: "Agents", ready: false, eta: "Available in v1" }, ... }`. Both the sidebar and the placeholder pages would import from it.

Cost: ~30 LOC of indirection. Benefit: single edit to flip a feature from "Soon" to "shipped." Marginal at four routes; valuable at twenty. Defer until the route table grows.

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

Intermediate state: first lint pass flagged `CardDescription` as unused in `<ComingSoon>`. Dropped the import; second pass clean. Captured in §Deviations.

Manual end-to-end run-through still deferred to Phase 6.

---

## What's next

Phase 5 — dashboard refresh + `UserContext` lift. The dashboard currently double-fetches `getCurrentUser` (once in the layout, once in the page); Phase 5 introduces `src/lib/api/user-context.tsx`, has the layout provide `{ user, org }` via context, and replaces the dashboard's `useEffect` with `useUser()`. Net effect: one fetch on cold mount, no duplication, dashboard becomes ~25 LOC instead of 81.

Phase 5 is also where the dashboard content gets fleshed out — the Phase 3 single-card welcome becomes the planned three-card grid (welcome, "Spawn your first agent" linking to `/agents`, "Fleet at a glance" linking to `/fleet`).
