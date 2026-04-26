On the FLEETS page, the list view of agents is good, but I always want a gallery view, where each card/block/section (or whatever we implement design-wise) represents an Agent.

Get what I mean?

Users can then toggle between current list view and gallery view.

If all clear, go ahead and propose/outline a detailed imeplemtnation plan to achieve this, in this md file.

Questions, if any, list out at the end fo the file for my review.

---

# Plan — Fleet view: list ↔ gallery toggle

## 1. Intent

Today `/fleet` renders one shape: a `FleetTable` of rows (`fleet/page.tsx:138`). Each `AgentInstance` is a horizontal strip — dense, scannable, but one-line-per-agent. We add a **second shape** — a gallery of square panel cards, one per agent — and a **toggle** in the header strip that flips between the two without losing polling, filter state, or RPC traffic. **Gallery is the default**; list is a one-click flip away and the choice persists across reloads.

The toggle is a *presentation* decision. The data layer (`fetchInstances`, `state`, polling, `showDestroyed`, `visibleInstances`) is unchanged. Only the rendered tree below the header strip swaps.

## 2. Scope (what changes / what doesn't)

**Changes (frontend-only):**
- `frontend/src/app/(app)/fleet/page.tsx` — add `view: "list" | "gallery"` state; add toggle control in the header strip; branch on `view` to render `FleetTable` or new `FleetGallery`.
- `frontend/src/components/fleet/agent-card.tsx` — **new.** One card = one `AgentInstance`, `TerminalContainer`-styled to match the design system.
- `frontend/src/components/fleet/fleet-gallery.tsx` — **new.** Responsive CSS grid wrapping N `<AgentCard>`s.
- `frontend/src/components/fleet/view-toggle.tsx` — **new.** Two-button segmented control (`[ ▤ LIST ] [ ▦ GALLERY ]`), terminal aesthetic.
- `frontend/src/lib/fleet-view-pref.ts` — **new** (~12 LOC). Tiny localStorage helper (`getFleetView`, `setFleetView`) so the toggle survives reload. SSR-safe (`typeof window` guard).

**Unchanged:**
- All proto / RPCs / generated code. Zero `shared/proto` change.
- All BE code. Zero migration, zero env, zero dependency.
- `agent-row-actions.tsx` is reused inside `AgentCard` as-is (it's already presentation-agnostic — it takes an `instance` and an `onChanged` callback; doesn't care if it lives in a `<TableCell>` or a card footer).
- `status-badge.tsx` is reused inside `AgentCard` as-is.
- Polling logic, `showDestroyed`, `visibleInstances`, `destroyedCount`, `count`, `polling` derivations all stay where they are. They drive both views identically.

**Deliberately not in scope (call out for confirmation in §8):**
- URL persistence (`?view=gallery`) — localStorage is the v1 stand-in; URL persistence is a separate decision (matches the existing `showDestroyed` precedent which is also session-local per 0.8.0 *Known pending work*).
- Per-card detail expansion / drawer / inline expanded state. Cards stay summary-only.
- Bulk-select / multi-select / batch actions across cards.
- Sort / filter beyond the existing `showDestroyed` toggle.
- Density toggle within gallery (compact / comfortable).

## 3. Component contracts

### 3.1 `view-toggle.tsx`

```tsx
type FleetView = "list" | "gallery";
type Props = { value: FleetView; onChange: (v: FleetView) => void };
```

Visual register: matches the existing `SHOW DESTROYED` button in the header strip (`border border-border px-2 py-1 font-display text-[10px] uppercase tracking-widest`). Two buttons sit side-by-side as a segmented control; the active button gets `text-foreground` + a subtle inset (`bg-muted/30` or `ring-1 ring-border`), the inactive one stays `text-muted-foreground hover:text-foreground`. Glyphs: `▤` for list, `▦` for gallery (Unicode block characters; readable at the chrome's tracking-widest setting; no Lucide import needed). Labels: `LIST` and `GALLERY` after the glyph.

Accessibility: each button is a `<button type="button" aria-pressed={...}>`; the pair is wrapped in `<div role="group" aria-label="Fleet view">`. Keyboard: native button focus ring (already styled by the design system).

### 3.2 `agent-card.tsx`

```tsx
type Props = { instance: AgentInstance; onChanged: () => void };
```

Square-corner panel (`border border-border` — matches `TerminalContainer`'s aesthetic without the title bar, since the title bar is the agent's name). Layout:

```
┌──────────────────────────────────┐
│ [ status-badge ]    ⋯ created    │  ← top strip: status left, timestamp right
│                                  │
│ alpha-3                          │  ← H2: instance name, font-mono, larger
│ HERMES · ANTHROPIC / claude-...  │  ← meta line: template · provider / model
│                                  │
│ ─────────────────────────────    │  ← hairline
│                  [Logs][Stop][⌫] │  ← AgentRowActions, bottom-right justified
└──────────────────────────────────┘
```

- Top strip: `flex justify-between items-center`; status-badge on the left (reuses `<StatusBadge status={instance.status} />`), `formatCreated(...)` on the right with `font-mono text-[10px] text-muted-foreground` and a `[ CREATED ]` micro-label above it (echoes the chrome's bracket convention).
- Name: `font-mono text-sm text-foreground`. If `instance.status === "destroyed"`, gets `line-through text-muted-foreground/70` (parallel to the badge variant in `status-badge.tsx`).
- Meta line: `font-mono text-xs text-muted-foreground`. Template name, provider label (via the existing `providerLabel` helper — extract it from `page.tsx` to a co-located util or keep it in `page.tsx` and pass the string as a prop; **prefer extracting to `frontend/src/lib/fleet-format.ts`** so both the table cell and the card render it identically without prop-drilling).
- Footer: `border-t border-border/50 pt-2 flex justify-end`; `<AgentRowActions instance={instance} onChanged={onChanged} />` drops in unmodified.
- Hover: subtle `hover:border-border/80` (no background fill — design system avoids hover surfaces in the dark register).

Polling-pulse parity: when this card's `instance.status` is non-terminal, the status-badge already animates per `status-badge.tsx`; no additional motion on the card itself.

### 3.3 `fleet-gallery.tsx`

```tsx
type Props = { instances: AgentInstance[]; onChanged: () => void };
```

A CSS grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3`. Wrapped in the same `TerminalContainer` `FleetTable` uses (`title="AGENT INSTANCES"`, `accent="running"`, `meta={\`${instances.length} CARDS\`}`) so the surface chrome is identical between views — only the contents change. Inside the container, `<AgentCard>` per instance, `key={i.id}`.

The grid breakpoints map to: phone = 1 col, small tablet = 2, large desktop = 3, ultrawide = 4. Chosen so a "Deploy 5" demo fans out as a 2×3 / 3×2 grid on a typical 13–15" laptop, which is the canonical viewport.

## 4. State + persistence

In `fleet/page.tsx`:

```tsx
const [view, setView] = useState<FleetView>("list");        // SSR-safe default

useEffect(() => {
  setView(getFleetView());                                  // hydrate on mount
}, []);

const handleViewChange = useCallback((v: FleetView) => {
  setView(v);
  setFleetView(v);                                          // persist
}, []);
```

`getFleetView` / `setFleetView` live in `lib/fleet-view-pref.ts`:

```tsx
const KEY = "corellia.fleet.view";
export type FleetView = "list" | "gallery";
export function getFleetView(): FleetView {
  if (typeof window === "undefined") return "list";
  return window.localStorage.getItem(KEY) === "gallery" ? "gallery" : "list";
}
export function setFleetView(v: FleetView): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, v);
}
```

**Why two-step (default `"list"` then hydrate from localStorage in an effect)?** Avoids SSR/CSR hydration mismatch. The first paint is always `"list"`; the toggle reflects the stored preference after mount. A 1-frame flicker is acceptable here — the alternative (reading localStorage during render) trips React's hydration warning.

**Why localStorage, not URL?** Consistent with the `showDestroyed` precedent (also session-local). URL persistence is a single-line lift (`useSearchParams` + `router.replace`) when audit deep-linking matters. Flagged in §8.

## 5. Header strip layout (post-change)

Current (`fleet/page.tsx:101`):

```
[show-destroyed]  ·  [polling-dot] POLLING  ·  N REGISTERED
```

After:

```
[view-toggle]  ·  [show-destroyed]  ·  [polling-dot] POLLING  ·  N REGISTERED
```

The view toggle goes first (leftmost): it's the most-used affordance and reading order is left-to-right; everything to its right is contextual telemetry. Same `font-display text-[10px] uppercase tracking-widest` and `·` separators. The whole strip is flex-wrap-tolerant — on a narrow viewport the toggle wraps to its own line cleanly because each item is its own flex child.

## 6. The render branch

Replace the single line:

```tsx
{state.kind === "ready" && (
  <FleetTable instances={visibleInstances} onChanged={fetchInstances} />
)}
```

with:

```tsx
{state.kind === "ready" && view === "list" && (
  <FleetTable instances={visibleInstances} onChanged={fetchInstances} />
)}
{state.kind === "ready" && view === "gallery" && (
  <FleetGallery instances={visibleInstances} onChanged={fetchInstances} />
)}
```

`LoadingTable`, `EmptyState`, `ErrorState` are view-agnostic — they keep rendering as-is regardless of `view`. (Empty / error states don't need a list-vs-gallery distinction; the surface chrome already handles both registers.)

## 7. Implementation order (vertical-slice, ~1 sitting)

1. **Extract `providerLabel` + `formatCreated`** from `fleet/page.tsx` into `frontend/src/lib/fleet-format.ts`. Update the `FleetTable` call sites to import from there. Type-check + lint clean. No behaviour change. *Reason: prevents copy-paste between the table cell and the card.*
2. **Add `lib/fleet-view-pref.ts`** with `getFleetView` / `setFleetView` / `FleetView` type.
3. **Add `components/fleet/view-toggle.tsx`** — pure presentational, takes `value` + `onChange`. Storybook isn't on the project, so verify by dropping it into the page in step 5.
4. **Add `components/fleet/agent-card.tsx`** — composes `StatusBadge` + `AgentRowActions` + the format helpers from step 1. Standalone visual review at this point.
5. **Add `components/fleet/fleet-gallery.tsx`** — wraps cards in `TerminalContainer` + responsive grid.
6. **Wire into `fleet/page.tsx`** — `view` state + hydration effect + toggle in header + render branch. The diff in `page.tsx` is small (~15 lines added, 3 lines changed).
7. **Manual verification:** `pnpm -C frontend type-check`, `pnpm -C frontend lint`, then `overmind start` and walk the page through: (a) loads default list, (b) toggle to gallery and back, (c) reload — gallery preference persists, (d) `showDestroyed` toggle still works in both views, (e) polling still pulses + cards/rows update on transition, (f) `Deploy 5` from `/agents` then return — gallery shows 5 cards in a tidy grid, polling stops once all 5 reach `running`, (g) Stop / Destroy actions inside a card fire the same RPCs and refetch the same way as the row actions.

## 8. Resolved decisions

1. **Default view = gallery.** First paint shows the gallery; operator can flip to list and the preference sticks. `lib/fleet-view-pref.ts` defaults to `"gallery"` when localStorage has no entry.
2. **Persistence = localStorage.** Matches the `showDestroyed` session-local precedent. URL persistence remains a one-line lift if audit deep-linking ever matters.
3. **Toggle glyphs = Lucide `Rows3Icon` + `LayoutGridIcon`.** Already in the project's icon set (`app-top-bar.tsx` etc. use Lucide); visually consistent with the chrome's existing icon register.
4. **Destroyed cards = `opacity-50` on the whole card.** Greys the entire surface so the card reads as "audit artefact, not active fleet member" — matches the dashboard/fleet semantic shift in 0.8.0. The `StatusBadge` itself already line-throughs the `destroyed` label via `status-dot.tsx`'s tone map; the card-level opacity is the additional whole-card greying. No `line-through` on the name itself (the name stays scannable so the operator can read what was there).
5. **Breakpoints = 1/2/3/4 across `sm/lg/xl`.** A "Deploy 10" lays out as 3 rows × 4 cols on ultrawide, 4 rows × 3 cols on a typical laptop, 5 rows × 2 cols on a small tablet, 10 rows × 1 col on phone. Cards stay readable at every breakpoint.
6. **Drop `[ CREATED ]` micro-label.** Top strip is just status (left) + timestamp (right). The timestamp is self-evident; the bracketed micro-label was redundant chrome density. Operator reads the card top-to-bottom as: status → name → model/template → actions. Created date is peripheral context, not a primary attribute.
7. **Empty / error states = identical across views.** Same `<EmptyState>` and `<ErrorState>` regardless of `view`. Revisit only if the empty state ever grows view-specific affordances.
8. **Toggle = always visible.** Chrome control, not a per-data control. Renders even during loading / empty / error so the operator can pre-set their preference before the data arrives.
