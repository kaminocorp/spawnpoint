# Frontend Mods — Header Alignment, Avatar Dropdown, Logo, Destroyed-Filter

**Date:** 2026-04-26
**Plan:** `docs/executing/frontend-mods.md`
**Scope:** four UX fixes spanning the global chrome (top bar, sidebar header) and two routes (`/dashboard`, `/fleet`). Pure FE; zero backend/proto/schema/env change. No new dependency. Type-check + lint clean.

## Summary

Four discrete asks from the operator on first sustained use of the M4 spawn flow:

1. **Top bar height should align with the sidebar's CORELLIA section** — they were 48px (top bar `h-12`) and ~56px (sidebar header), so the `border-b` lines on the two chrome strips didn't sit at the same Y. Visible whenever both regions were on screen.
2. **Avatar (top-right) dropdown should expose Profile / Settings / Sign out** — only Sign out existed; the dropdown felt under-populated for what users expect of an account menu.
3. **CORELLIA wordmark should read as a logo, not a body-text label** — the `›` chevron prefix made it look like a nav item; the weight (`font-bold`) and tracking (`tracking-widest`) were the same register as the [ MODULES ] section label, so the eye didn't lock onto it as the brand.
4. **Destroyed instances clutter both Fleet and Dashboard** — the M4 design correctly keeps destroyed rows as audit artefacts (struck-through, line-through StatusBadge), but: (A) they shouldn't dominate the Fleet table by default, and (B) they shouldn't inflate the Dashboard's FLEET TOTAL telemetry tile (which the operator reads as "live agents").

All four landed in one pass. No phase split — the changes are independent at the file level.

## Index

### 1 — Top bar height alignment (`app-top-bar.tsx`, `app-sidebar.tsx`)

- **`app-top-bar.tsx:68` — `h-12 → h-14`.** One token change. The header is now 56px tall, matching the sidebar header.
- **`app-sidebar.tsx` — `SidebarHeader` overridden to `h-14 p-0`, inner div to `flex h-full items-center px-4`.** The shadcn `SidebarHeader` defaults to `p-2` plus an inner `py-2.5` wrapper, which produced a variable height (~56–60px depending on text size). Pinning the outer at `h-14` and letting the inner div fill via `h-full` gives an exact, deterministic match against the top bar. *Why override rather than restructure:* the `SidebarHeader`'s `border-b` and group-state hooks are load-bearing for collapse mode; replacing the component would lose those. `cn()`'s tailwind-merge resolves the override correctly (later class wins for the `p-*` family).

The two `border-b` lines now sit at `y = 56px`. Verified visually only — no automated assertion.

### 2 — Avatar dropdown: Profile + Settings (`app-top-bar.tsx`)

Added two `DropdownMenuItem`s above the existing Sign out item, both routed to `/settings` via `<Link>`. Lucide icons: `UserIcon` for Profile, `SettingsIcon` for Settings (already in the project's icon set; no new dep). A `<DropdownMenuSeparator>` divides them from Sign out — the destructive-ish action gets its own visual lane.

**Why both link to `/settings`:** there is no dedicated profile route in v1; `/settings` is currently the `<ComingSoon>` placeholder (per the sidebar's `ready: false` flag on Settings). Per blueprint architecture rule §11.4 — *deferred features are stubbed as real interface implementations, not as fake UI buttons* — wiring both menu items to a real route that lands on a real (if "coming soon") page is honest. The user clicks, navigates, sees the placeholder. They don't click and have nothing happen.

When the real `/profile` route ships, swap Profile's `href`. One-line change.

The render-prop pattern (`<DropdownMenuItem render={<Link href="/settings" />}>`) follows the same Base UI convention used elsewhere in the chrome (sidebar nav items, the dropdown trigger itself). Keeps Next.js client-side navigation; no full page reload.

### 3 — Logo redesign (`app-sidebar.tsx`)

- **Removed the `›` chevron prefix.** It read as a nav-item bullet, not as a brand mark.
- **Wordmark restyled:** `text-base font-black uppercase tracking-[0.3em]`. The bump from `font-bold` → `font-black` (700 → 900) and from `tracking-widest` (0.1em) → `tracking-[0.3em]` is the visual delta that makes CORELLIA stop reading as a label and start reading as a logo. The `text-sm → text-base` (14px → 16px) gives it a hair more presence without making it loud.
- **Collapsed-mode monogram:** when the sidebar collapses to icon mode (`group-data-[collapsible=icon]:`), the full wordmark hides and a single `C` appears in its place at the same weight/tracking. The previous `›` had the same role — without a replacement, the collapsed sidebar header would have been visually empty.

Aesthetic register matches the design-system.md spec: uppercase, mono `font-display`, generous letter-spacing. The change is a register-shift inside the existing token system, not a token change — so no `globals.css` edit was needed.

### 4A — Fleet page: hide-destroyed filter (`fleet/page.tsx`)

- **New state:** `const [showDestroyed, setShowDestroyed] = useState(false);` — defaults to **hidden** (the operator's request).
- **`visibleInstances`** derived from `state.instances`: identity when `showDestroyed`, filtered when not. **`destroyedCount`** computed once for the toggle's badge.
- **Toggle UI** in the header strip alongside the existing POLLING indicator and N REGISTERED count. Renders only when `destroyedCount > 0` — no toggle when there's nothing to toggle. Format: `[✓] SHOW DESTROYED (N)` / `[ ] SHOW DESTROYED (N)`. The bracket-checkmark idiom matches the design-system's terminal aesthetic (mono brackets are already used for `[ MODULES ]`, `[ UTC ]`, `[ ONLINE ]` etc.). Bordered button (`border border-border px-2 py-1`), hover swaps the muted-foreground for full foreground — same affordance language as the M4 fleet row actions.
- **Header N REGISTERED count now reflects `visibleInstances.length`**, not the raw total — so toggling instantly updates both the table and the count. This is the right semantic: "N agents currently visible to you," not "N agents in the org's history."
- **Polling unchanged.** The `polling` boolean still derives from `state.instances` (the unfiltered set) — a destroyed row that gets filtered out doesn't change whether *any* row is non-terminal. Polling stops only when all real instances reach a terminal state.
- **`<FleetTable instances={visibleInstances} />`** — the table receives the filtered list directly; no second prop, no per-row filter inside the table component. Keeps the table dumb.

### 4B — Dashboard FLEET TOTAL excludes destroyed (`dashboard/page.tsx`)

One filter in the FLEET TOTAL telemetry tile:

```ts
state.instances.filter((i) => i.status !== "destroyed").length
```

The other three tiles (RUNNING, PENDING, FAILED) already filter by status, so no change needed there. Destroyed rows now contribute to nothing — they're audit artefacts, not active fleet members.

**FLEET STATUS matrix below the telemetry strip is unchanged.** It groups by status and only shows rows where `count > 0`, so destroyed instances will still appear if present — but as one row labelled DESTROYED, not as silent inflation of a top-line number. That's the right level of visibility for an audit category: countable on demand, not hidden, but also not headlining.

## Files touched

- `frontend/src/components/app-top-bar.tsx` — `h-12 → h-14`; two new `DropdownMenuItem`s; two new icon imports (`UserIcon`, `SettingsIcon`); new `Link` import.
- `frontend/src/components/app-sidebar.tsx` — `SidebarHeader` size + padding overrides; chevron removed; wordmark restyled; collapsed-mode monogram added.
- `frontend/src/app/(app)/fleet/page.tsx` — `showDestroyed` state; `visibleInstances` + `destroyedCount` derivations; new toggle button in header strip; `count` now derives from `visibleInstances`; `<FleetTable>` receives filtered list.
- `frontend/src/app/(app)/dashboard/page.tsx` — FLEET TOTAL filter excludes `status === "destroyed"`.

## Validation

- `pnpm -C frontend type-check` — clean.
- `pnpm -C frontend lint` — clean.
- No proto change → no codegen run needed.
- No backend touch → no `go vet` / `go test` needed.
- No new dependency.

## Behavior change (known)

- **Top bar is 8px taller.** Page content area below it is 8px shorter. No layout breakage observed; the `flex-1` content region absorbs the delta.
- **Avatar dropdown has three items** (was one). Profile and Settings both navigate to `/settings`.
- **Sidebar shows CORELLIA without a chevron prefix**, in heavier/wider type. Collapsed mode shows `C`.
- **Fleet table hides destroyed instances by default.** A toggle in the header strip surfaces them on demand. The toggle is invisible when there are no destroyed instances (zero noise for fresh workspaces).
- **Dashboard FLEET TOTAL drops by however many destroyed rows the org has.** RUNNING / PENDING / FAILED tiles are unaffected. The FLEET STATUS matrix below still includes destroyed if any exist.

## Resolves

- **`docs/executing/frontend-mods.md` items 1–4.** All four asks shipped.

## Known pending work

- **No automated test for the height alignment.** v1 has no Playwright; the verification was visual. If the SidebarHeader's default padding ever changes upstream (shadcn updates), the alignment could drift silently. The override is explicit enough (`h-14 p-0`) that a future reviewer would notice the override exists for a reason.
- **Profile menu item points at `/settings`.** Acceptable v1 stand-in (per rule §11.4); a real `/profile` route is a future-milestone item, not a v1 scope addition.
- **The fleet filter is not URL-persisted.** Refresh resets to "hide destroyed." For v1's session-length workflow that's correct; if/when audit workflows want to deep-link to a destroyed-included view, lift state into `useSearchParams`.

## Supersedes

- **0.7.1's logo treatment** — the `›` prefix + `text-sm font-bold tracking-widest` styling for the CORELLIA wordmark is replaced by the heavier, wider, chevron-less treatment.
- **0.7.0's fleet header strip** — the strip still has POLLING and N REGISTERED, but now also conditionally shows the SHOW DESTROYED toggle when applicable. N REGISTERED now reflects the *visible* count, not the raw `state.instances.length`.
- **0.7.0's dashboard FLEET TOTAL definition** — was "all rows ever created in the org," now "all non-destroyed rows." Closer to the operator's mental model of "fleet."
