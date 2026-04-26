# Fleet UI Mods — List ↔ Gallery Toggle

**Date:** 2026-04-26
**Plan:** `docs/executing/fleet-ui-mods.md`
**Scope:** add a gallery view to `/fleet` and a header-strip toggle to flip between list and gallery. Gallery is the default; the choice persists across reloads via localStorage. Pure FE; zero backend / proto / schema / env / dependency change. Type-check + lint clean.

## Summary

The Fleet route had one shape — a `FleetTable` of horizontal rows. Operator wanted a card-per-agent gallery as the always-available alternative, with a visible toggle to flip between the two. Decision matrix landed on:

- **Gallery as the default** (operator preference; cards are the "first impression" surface for a fleet of N agents).
- **localStorage persistence** (matches the `showDestroyed` session-local precedent in 0.8.0).
- **Lucide `LayoutGridIcon` / `Rows3Icon`** for the toggle glyphs (consistent with the chrome's existing icon register since 0.8.0's avatar dropdown).
- **`opacity-50` on destroyed cards** to match the "audit artefact, not active fleet member" semantic shift in 0.8.0.
- **Drop the `[ CREATED ]` micro-label** the plan originally proposed — the timestamp is self-evident at the card's top-right; the bracketed micro-label was redundant chrome density.
- **1 / 2 / 3 / 4 columns** across `sm` / `lg` / `xl` breakpoints — a "Deploy 5" demo lays out as a tidy 2×3 / 3×2 grid on a typical laptop.
- **Empty / error states stay identical** across views.
- **Toggle is always visible** — chrome control, not data control; renders even during loading / empty / error.

The data layer (`fetchInstances`, polling, `showDestroyed`, `visibleInstances`, `destroyedCount`, `count`, `polling`) is byte-equivalent to 0.8.0. Only the rendered tree below the header strip changes.

## Index

### 1 — Format helpers extracted (`lib/fleet-format.ts`, **new**)

`providerLabel(p: ModelProvider): string` and `formatCreated(rfc3339: string): string` moved out of `fleet/page.tsx` into `frontend/src/lib/fleet-format.ts`. The table cell and the new card now render the same provider/timestamp strings without copy-paste between component trees. Zero behaviour change at the call sites — same function bodies, new module path.

### 2 — View preference helper (`lib/fleet-view-pref.ts`, **new**)

Tiny module that exposes the read/write surface and a React hook:

```ts
export type FleetView = "list" | "gallery";
export function setFleetView(v: FleetView): void;
export function useFleetView(): FleetView;
```

Backed by **`useSyncExternalStore`** (React-blessed primitive for syncing with external stores). Three callbacks:

- `subscribe(cb)` — registers `cb` in a module-local `Set<() => void>`; returns the unsubscribe function.
- `getSnapshot()` (= `read()`) — reads `localStorage["corellia.fleet.view"]`; returns `"gallery"` (the default) on bad/missing values or when `typeof window === "undefined"`.
- `getServerSnapshot()` — returns the literal default `"gallery"`. React uses this for SSR and the very first client render *before* hydration completes, so the SSR HTML and the initial CSR render agree byte-for-byte even if localStorage holds `"list"` — no hydration warning.

`setFleetView(v)` writes to localStorage **and** calls every subscriber, so the same-tab toggle press triggers an immediate re-render of the page (the cross-tab `storage` event is not enough — it doesn't fire in the originating tab).

**Why `useSyncExternalStore` and not the conventional `useState` + hydration-effect pattern.** First implementation was the textbook pattern:

```tsx
const [view, setView] = useState<FleetView>("gallery");
useEffect(() => { setView(getFleetView()); }, []);
```

ESLint's `react-hooks/set-state-in-effect` rule blocks this — *"Calling setState synchronously within an effect can trigger cascading renders."* The rule is correct in the general case; the localStorage-hydration shape is the canonical exception. `useSyncExternalStore` is React's blessed answer for exactly this problem: it has a separate `getServerSnapshot` path that resolves the SSR/CSR mismatch *and* the read-from-external-store call site doesn't trip any setState-in-effect heuristic. Call site stays one line: `const view = useFleetView()`.

### 3 — View toggle (`components/fleet/view-toggle.tsx`, **new**)

A two-button segmented control:

```
┌──────────────────┐
│ [▦ GALLERY] [▤ LIST] │
└──────────────────┘
```

Outer wrapper: `<div role="group" aria-label="Fleet view" className="flex items-center border border-border">`. Each button is a `<button type="button" aria-pressed={…}>` with the standard chrome typography (`font-display text-[10px] uppercase tracking-widest`). Active state gets `bg-muted/40 text-foreground`; inactive gets `text-muted-foreground hover:text-foreground`. Lucide `LayoutGridIcon` / `Rows3Icon` at `size-3` left of the label.

Props: `{ value: FleetView, onChange: (v: FleetView) => void }`. Stateless; the parent owns persistence via the hook above.

### 4 — Agent card (`components/fleet/agent-card.tsx`, **new**)

One `AgentInstance` → one square-corner panel. Layout:

```
┌──────────────────────────────────┐
│ [● running]              Apr 26  │  ← header strip
├──────────────────────────────────┤
│                                  │
│ alpha-3                          │  ← name (font-mono text-sm)
│ Hermes                           │  ← template
│ anthropic / claude-opus-4-7      │  ← provider / model
│                                  │
├──────────────────────────────────┤
│              [Logs][Stop][⌫ Destroy] │  ← AgentRowActions
└──────────────────────────────────┘
```

- **Header strip** (`flex items-center justify-between border-b border-border/50 px-3 py-2`): `<StatusBadge status={instance.status} />` left, `formatCreated(instance.createdAt)` right (`font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70`).
- **Body** (`flex flex-1 flex-col gap-1 px-3 pt-3 pb-2`): name as `<h2 className="font-mono text-sm text-foreground">`, then template, then `${providerLabel} / ${modelName}` — both in `font-mono text-[11px] text-muted-foreground`.
- **Footer** (`flex items-center justify-end border-t border-border/50 px-2 py-1.5`): `<AgentRowActions instance={instance} onChanged={onChanged} />` drops in **unmodified**. The component is presentation-agnostic — it took `instance` + `onChanged` from day one (M4); it doesn't care if it lives in a `<TableCell>` or a card footer.
- **Destroyed treatment:** whole card gets `opacity-50` when `instance.status === "destroyed"`. `StatusBadge` already line-throughs the `destroyed` label inside `status-dot.tsx`'s tone map; the card-level opacity is the additional whole-card greying. The name itself does **not** get `line-through` — it stays scannable so the operator can read what was there at a glance.
- **Hover:** subtle `hover:border-border/80`. No fill swap (the design system's dark register avoids hover surfaces).

`StatusBadge` is reused as-is; its existing pulse animation (via `StatusDot`'s `animate-telemetry`) carries through automatically — the card needs no motion of its own.

### 5 — Fleet gallery (`components/fleet/fleet-gallery.tsx`, **new**)

Wraps the cards in the same `TerminalContainer` the table uses, so the surface chrome — `[ AGENT INSTANCES ]` title, `›` chevron, `running` accent — is identical between views. Only the contents differ.

```tsx
<TerminalContainer title="AGENT INSTANCES" accent="running" meta={`${n} CARDS`}>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {instances.map((i) => <AgentCard key={i.id} instance={i} onChanged={onChanged} />)}
  </div>
</TerminalContainer>
```

The container's `meta` prop reads `N CARDS` (vs the table's `N ROWS`) — chrome counts the unit being shown.

**Breakpoint reasoning.** 1 col on phone, 2 on small tablet (`sm:`), 3 on large desktop (`lg:`), 4 on ultrawide (`xl:`). A "Deploy 10" produces 3 rows × 4 cols on ultrawide, 4 rows × 3 cols on a typical 13–15" laptop, 5 rows × 2 cols on a small tablet, 10 rows × 1 col on phone. Cards stay readable at every breakpoint without a density toggle.

### 6 — Fleet page wiring (`app/(app)/fleet/page.tsx`)

- **Imports:** `FleetGallery` and `FleetViewToggle`; `formatCreated` + `providerLabel` from `@/lib/fleet-format` (the in-file copies are deleted); `useFleetView` + `setFleetView` from `@/lib/fleet-view-pref`.
- **State delta:** add `const view = useFleetView();`. No new `useState`, no `useEffect`, no `useCallback` for the change handler — the hook owns subscription, the setter owns notification, the consumer just reads.
- **Header strip:** `<FleetViewToggle value={view} onChange={setFleetView} />` is the new leftmost item, separated from the rest by a `·` divider. The `setFleetView` reference is stable across renders (it's a module-level function), so passing it directly as `onChange` is safe.
- **Render branch:** the single line
  ```tsx
  {state.kind === "ready" && (
    <FleetTable instances={visibleInstances} onChanged={fetchInstances} />
  )}
  ```
  becomes two lines:
  ```tsx
  {state.kind === "ready" && view === "list" && (
    <FleetTable instances={visibleInstances} onChanged={fetchInstances} />
  )}
  {state.kind === "ready" && view === "gallery" && (
    <FleetGallery instances={visibleInstances} onChanged={fetchInstances} />
  )}
  ```
- **Loading / empty / error states** are unchanged. They render regardless of `view`. Per §8 of the plan: revisit only if those states ever grow view-specific affordances.
- **Polling logic, `showDestroyed`, `visibleInstances`, `destroyedCount`, `count`, `polling`** — all byte-equivalent to 0.8.0. Both views consume the same `visibleInstances` array, so the `showDestroyed` toggle works identically across views and the polling cadence (`POLL_MS = 3000`, stops when every row is terminal) is unaffected.

## Decisions worth preserving

1. **`useSyncExternalStore` over `useState` + hydration-effect.** The lint rule is correct in the general case; the React-blessed primitive is the right shape for "sync with external store." Don't regress to the effect pattern when adding the next localStorage-backed preference.
2. **Default = gallery.** Empty localStorage resolves to `"gallery"`. If a future preference seeder writes anything other than `"list"` or `"gallery"` to the key, the helper falls back to the default — no crash, no broken state.
3. **Opacity vs line-through for destroyed.** Card-level `opacity-50` greys the whole card; the badge's tone map handles the `destroyed` label's `line-through`. Two layers, two semantics: the card says "audit artefact," the badge says "this status is terminal." The name is not struck through — operator should still be able to *read* what the agent was called.
4. **`AgentRowActions` reused without modification.** The component is presentation-agnostic — `instance` + `onChanged` props, no parent-shape assumption. This is the M4 design paying off. Both views share the *exact* same Stop / Destroy / Logs button stack, modal flow, error-toast surface, and refetch trigger. Zero divergence between views in user-visible behaviour.
5. **Toggle always visible.** Even during loading / empty / error. Operator can pre-set their preference before the data arrives. No conditional render around the toggle itself.
6. **`N CARDS` vs `N ROWS` in the container `meta`.** The chrome count names the unit being rendered. Small touch; reads as deliberate.

## Files

**New:**
- `frontend/src/lib/fleet-format.ts` (~25 LOC)
- `frontend/src/lib/fleet-view-pref.ts` (~32 LOC)
- `frontend/src/components/fleet/view-toggle.tsx` (~62 LOC)
- `frontend/src/components/fleet/agent-card.tsx` (~45 LOC)
- `frontend/src/components/fleet/fleet-gallery.tsx` (~24 LOC)

**Changed:**
- `frontend/src/app/(app)/fleet/page.tsx` — imports updated, `providerLabel` + `formatCreated` deleted in-file (now imported), `useFleetView` consumed, render branch split between table and gallery, toggle wired into header. ~10-line net delta; no other behaviour change.

## Verified

- `pnpm -C frontend type-check` → clean.
- `pnpm -C frontend lint` → clean (after the `useSyncExternalStore` refactor; the original `useState` + effect pattern tripped `react-hooks/set-state-in-effect`).
- Manual UI walk-through (toggle persistence across reloads, `showDestroyed` interaction in both views, `Deploy 5` round-trip, Stop / Destroy from a card vs from a row) — **owed**, not yet done in this session.

## Known pending work

- **Manual UI walk-through.** Type-check and lint catch shape errors, not feature behaviour. The eight smoke checks listed in the plan's §7 step 7 still need a live `overmind start` pass before the change can be considered shipped.
- **No automated test for the toggle.** Consistent with the v1 testing posture (no Playwright; the FE is exercised by the deployed RPC round-trip, not by E2E).
- **URL persistence (`?view=gallery`) deliberately not implemented.** localStorage is the v1 stand-in, matching the `showDestroyed` precedent. One-line lift via `useSearchParams` + `router.replace` if audit deep-linking ever matters.
- **Per-card detail expansion / drawer / inline expanded state** — out of scope. Cards stay summary-only.
- **Bulk-select / multi-select / batch actions across cards** — out of scope.
- **Sort / filter beyond `showDestroyed`** — out of scope.

## Supersedes

- **0.7.0's fleet page render shape** — was a single `FleetTable`-or-nothing branch. Now branches on `view` between `FleetTable` and `FleetGallery`, both consuming the same filtered instance list.
- **0.7.0's `providerLabel` + `formatCreated` colocation** in `fleet/page.tsx` — extracted to `lib/fleet-format.ts` so both the table cell and the new card render identically without prop-drilling or copy-paste.
