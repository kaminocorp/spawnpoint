# Completion — Spawn page redesign, Phase 1: Route rename + sidebar copy + redirect shim

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 1
**Date:** 2026-04-26
**Scope:** FE-only. Zero backend, proto, schema, env, or dependency change. Pure structural rename + nav-label flip + one-release redirect shim.
**Validation:** `pnpm -C frontend type-check && lint && build` all green.

---

## What Phase 1 delivers (per plan)

> The `/agents` route becomes `/spawn` everywhere, with **no behaviour change yet**. The page still renders the M4-shape grid + modal — the visual redesign (nebula avatars, roster, wizard) lands in Phases 2–5.

This phase is the cheapest, safest, fully-shippable slice: it gets the URL + nav vocabulary aligned with the operator's mental model so subsequent phases can build the new page shape on the new route name without an in-flight rename.

---

## Files touched

### Moved (git mv — preserves blame)

- `frontend/src/app/(app)/agents/page.tsx` → `frontend/src/app/(app)/spawn/page.tsx`
- `frontend/src/app/(app)/agents/layout.tsx` → `frontend/src/app/(app)/spawn/layout.tsx`

### New

- `frontend/src/app/(app)/agents/page.tsx` — **redirect shim**. Five lines:
  ```tsx
  import { redirect } from "next/navigation";

  export default function AgentsRedirect() {
    redirect("/spawn");
  }
  ```
  Server component (no `"use client"`), so `next/navigation`'s `redirect()` issues a server-side 308 redirect — no flash of an empty `/agents` page on the client. Per plan decision 1, this shim lives for **one release only** and gets deleted in Phase 6 (tracked there). Matches the dimensions and lifetime the plan specifies.

### Edited

- **`frontend/src/app/(app)/spawn/layout.tsx`** — two renames:
  - `metadata.title`: `"Agents — Corellia"` → `"Spawn — Corellia"` (browser tab text on the new route).
  - Component name: `AgentsLayout` → `SpawnLayout` (cosmetic; matches the file's new home).
- **`frontend/src/app/(app)/spawn/page.tsx`** — three renames, all per plan §4 Phase 1 bullets:
  - Component name: `AgentsPage` → `SpawnPage`.
  - Decorative section tag (the small uppercase tag above the H1): `[ DEPLOY ]` → `[ LAUNCHPAD ]`. Mirrors the 0.7.2 rationale (intent-as-label) and the plan's framing of `/spawn` as a launchpad rather than a list.
  - Page H1: `AGENTS` → `SPAWN`.
  - **Deliberately untouched at this phase:** the `[ AVAILABLE HARNESSES ]` and `[ PLANNED HARNESSES ]` `TerminalContainer`s, the loading/error/empty/ready branches, the two-grid stack, the existing card components (`AgentTemplateCard`, `ComingSoonHarnessCard`), and the deploy modal flow. Phases 2–6 replace those wholesale.
- **`frontend/src/components/app-sidebar.tsx`** — one-line nav item swap:
  - `{ href: "/agents", label: "Agents", ready: true }` → `{ href: "/spawn", label: "Spawn", ready: true }`.
  - The active-state predicate (`pathname === item.href || pathname?.startsWith(${item.href}/)`) now resolves correctly for `/spawn` and any future `/spawn/[templateId]` wizard sub-route (Phase 4) — no extra wiring needed.
- **`frontend/src/app/(app)/dashboard/page.tsx`** — two `<Link href="/agents" />` references swapped to `<Link href="/spawn" />`. These are the "OPEN CATALOG" and "DEPLOY FIRST AGENT" CTAs in the dashboard's empty-fleet zero-state and the harness-list tile.
- **`frontend/src/app/(app)/fleet/page.tsx`** — one `<Link href="/agents" />` → `<Link href="/spawn" />`. The "OPEN CATALOG" CTA in the empty-fleet zero-state on the fleet page.

---

## Why this exact set of edits, and not more

The plan's Phase 1 bullet list is: route move, redirect shim, sidebar label, page H1 + section tag, and a sweep for any other `/agents` references. I executed exactly that — nothing absorbed forward, nothing scoped out.

- **No card-component edits** in this phase. `AgentTemplateCard` / `ComingSoonHarnessCard` keep their names and shapes. Phase 3 replaces them with `<RosterCard>`.
- **No deploy-modal edits.** `frontend/src/components/agents/deploy-modal.tsx` stays put; Phase 6 deletes it after Phase 5 ships the wizard.
- **No `coming-soon.ts` data move.** `frontend/src/lib/agents/coming-soon.ts` keeps its current path; Phase 3 replaces it with `frontend/src/lib/spawn/harnesses.ts` (the §3.5 lineup).
- **No copy changes** to the harness-card spec sheets, the deploy modal, the dashboard tile labels, or the fleet zero-state messaging beyond the link `href`. Those land naturally as their owning components are rewritten in later phases.
- **CLAUDE.md / changelog not updated yet.** Phase 6 owns those (per plan §4 Phase 6). Updating them now would create a doc/code drift if Phases 2–5 introduce additional renames or layout shifts.

The point of this phase is *no behaviour change*. Anyone navigating to `/agents` lands on `/spawn` via 308; anyone clicking "Spawn" in the sidebar lands on the same M4-shape catalog page they had before, just at a new URL with new chrome copy. Phases 2–5 then turn that page into the roster + wizard.

---

## Sweep notes (other `/agents` references)

`grep -rn "/agents" frontend/src` after the swap shows only:
- Generated-code references in `frontend/src/gen/corellia/v1/agents_pb.ts` — comments referencing the proto file path (`corellia/v1/agents.proto`). Not user-facing routes; not touched.
- Component file paths under `frontend/src/components/agents/` (the `deploy-modal.tsx` directory) and `frontend/src/components/agent-template-card.tsx` — file/folder names, not URLs. Phase 6 deletes these.
- Type-import paths from `@/gen/corellia/v1/agents_pb` — RPC client types. Not URLs.
- `frontend/src/lib/agents/coming-soon.ts` — module path, not URL.

So the URL sweep is complete. The directory/module renames (`components/agents/`, `lib/agents/`) are intentionally deferred to the phases that own those files (Phase 3 / 6).

---

## Validation evidence

All three frontend gates green from a clean `.next/` cache:

```
pnpm -C frontend type-check    # tsc --noEmit, exit 0
pnpm -C frontend lint           # eslint, exit 0
pnpm -C frontend build          # next build, exit 0
```

`next build` route table shows **both** `/agents` and `/spawn` registered as static routes — `/spawn` as the live page, `/agents` as the redirect shim. That matches the plan's Phase 1 exit criterion ("navigating to `/agents` 308-redirects to `/spawn`; nav highlights correctly on both URLs during the redirect window").

One stale-cache gotcha worth recording: the **first** type-check run after the `git mv` failed because Next.js's `.next/types/validator.ts` still referenced `agents/layout.js`. Solution: `rm -rf .next` before re-running. The validator regenerates from the live filesystem on the next `next build`. Worth knowing if this rename pattern recurs (it will — Phase 6 deletes `agents/` outright).

---

## Phase 1 exit criteria — status

Per plan §4 Phase 1:

- ✅ `/agents` directory contents moved to `/spawn`, one-line component renames applied.
- ✅ Shim at `/agents/page.tsx` redirects to `/spawn` via `next/navigation`'s server-side `redirect()`.
- ✅ Sidebar nav label flipped from `Agents` to `Spawn`, `href` from `/agents` to `/spawn`.
- ✅ `[ DEPLOY ]` → `[ LAUNCHPAD ]` and `AGENTS` → `SPAWN` on the page.
- ✅ Internal sweep — three `<Link href="/agents" />` references in `dashboard/page.tsx` (×2) and `fleet/page.tsx` (×1) repointed.
- ✅ `pnpm -C frontend type-check && lint && build` all green.
- ✅ `next build` route table shows both routes registered.

Manual smoke pass in a browser is owed but not in scope for the phase exit (no behaviour change, type/lint/build is the contract).

---

## What unblocks Phase 2

The route + label + entry-points are settled. Phase 2 (`<NebulaAvatar>` component) can be authored under `frontend/src/components/spawn/nebula-avatar.tsx` and tested in isolation; Phase 3 imports it into the (already-renamed) `/spawn/page.tsx` when replacing the catalog grid with the roster grid. No further URL or nav churn is needed at any later phase — the shim is the only thing that gets removed (Phase 6).

---

## Known pending work (Phase-1 scope)

- **Manual UI smoke pass.** Type/lint/build catch shape errors, not nav behaviour. Worth a `overmind start` walkthrough — sign in → sidebar shows `Spawn` → click → land on `/spawn` with `[ LAUNCHPAD ] / SPAWN` chrome → manually nav to `/agents` → 308 to `/spawn`. Five-minute job; deferred to first time the dev server is up for any reason.
- **`/agents` shim deletion.** Tracked in Phase 6 (per decision 1: "one release only"). Not appropriate to delete now — the whole point of the shim is to bridge the changeover.

---

## Supersedes (within the working tree)

- **0.7.2's nav label `Catalog → Agents`** — the same shape of move, now extended one rename further (`Agents → Spawn`) for the same operator-mental-model reason. 0.7.2's rationale (URL slug ↔ nav-label ↔ H1 alignment, sibling naming convention) carries through unchanged.
- **0.7.2's section tag `[ HARNESS CATALOG ] → [ DEPLOY ]`** — superseded by `[ LAUNCHPAD ]` on the same page. The intent-as-label rationale 0.7.2 introduced still applies; "launchpad" reads as the spawn entrypoint better than "deploy."
