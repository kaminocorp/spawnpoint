# Frontend Redesign — Phase 2 Completion: Pearl Variant + Three Primitives

**Plan:** `docs/executing/frontend-redesign.md` §4 Phase 2
**Status:** Shipped
**Diff:**
- `frontend/src/components/ui/button.tsx` — +2 / -0 LOC (one CVA variant)
- `frontend/src/components/ui/pearl-text.tsx` — **NEW** 29 LOC
- `frontend/src/components/ui/terminal-container.tsx` — **NEW** 78 LOC
- `frontend/src/components/ui/status-dot.tsx` — **NEW** 73 LOC

**Validation:** `pnpm type-check` ✓ (Phase 2 surface) · `pnpm lint` ✓ (Phase 2 surface) · `pnpm build` ✓ (Phase 2 surface, 10/10 routes). See §5 for the unrelated pre-existing M4 failures, the stash-test evidence, and why they don't block this phase.

---

## 1. What shipped

Four files touched; three new primitives that consume Phase 1's CSS material.

### 1.1 `pearl` button variant

Single line added to the CVA's `variants.variant` map in `ui/button.tsx`:

```tsx
pearl: "pearl text-foreground border-border/40 hover:border-border/70 relative overflow-hidden font-medium",
```

The `.pearl` class (Phase 1) paints the drifting gradient; `text-foreground`
overlays the gray text on top of the lighter gradient stops; the
`hover:border-border/70` upgrades the hairline on interaction; `relative
overflow-hidden` clips the `background-size: 200%` gradient to the button's
natural box (without `overflow-hidden` the drift can spill on hover via
transform interactions).

The existing `default` variant stays untouched per decision 16. Pearl is
**additive**: no consumer is migrated in Phase 2; the variant is available
for Phase 4 to switch sign-in / onboarding submits to it.

### 1.2 `<PearlText>` primitive

Thinnest of the three — a single `<span>` wrapper applying the `.pearl-text`
class:

```tsx
<span data-slot="pearl-text" className={cn("pearl-text", className)} {...props}>
  {children}
</span>
```

Consumer pattern: `<h1><PearlText>Welcome back, Alice.</PearlText></h1>`.
Heading semantics live on the wrapping element; the span is purely a
material container. Decoupling these (decision 18) is what makes the
primitive accessible at any heading level or even body text without
forcing a tag choice.

### 1.3 `<TerminalContainer>` primitive

Implements `design-system.md` §16 verbatim: `border-2 border-gray-600
bg-black/80 backdrop-blur-sm` panel with no border-radius, a `[ TITLE ]`
bracket header in `font-mono text-xs uppercase tracking-wider`, optional
feature-color accent on the title-bar bottom border + chevron.

The accent map ships as a `Record<TerminalAccent, string>` rather than a
runtime `cn(\`border-b-${accent}-500\`)` template — Tailwind's static
analyzer can't see template-string class names, so dynamic class
composition silently fails to ship the underlying CSS. The static map
is the standard idiom. Same shape for the chevron color.

### 1.4 `<StatusDot>` primitive

Implements `design-system.md` §35 verbatim. Six-state enum
(`pending | spawning | running | stopped | failed | destroyed`) maps to
two derived signals: `dotColor` (semantic class) + `pulses` (boolean).

```tsx
const STATUS_COLOR: Record<Status, string> = {
  pending: "bg-gray-500",
  spawning: "bg-green-400",
  running: "bg-green-400",
  stopped: "bg-gray-500",
  failed: "bg-red-500",
  destroyed: "bg-gray-500",
}
const STATUS_PULSES: ReadonlySet<Status> = new Set(["spawning", "running"])
```

The `data-status={status}` attribute on the wrapper makes the live status
inspectable in DOM and queryable from tests/Playwright in the future. The
inner dot is `aria-hidden` because the textual label (when shown) carries
the accessible meaning; assistive tech reading the dot's color would
double-announce.

---

## 2. Conventions inherited from existing primitives

Three conventions surfaced from reading `skeleton.tsx` and `button.tsx`
before writing the new files:

1. **`data-slot="<name>"` attribute** on every primitive. shadcn's selector
   ergonomics rely on it (e.g. `[data-slot=button]:hover { ... }` is a
   pattern used elsewhere in the codebase). All three new primitives ship
   with their slot name.
2. **`React.ComponentProps<"...">` spread typing** — not `forwardRef`,
   not custom `Props` types from scratch. The plain DOM-element prop
   spread is the lowest-ceremony shape and matches `Skeleton`'s exact
   pattern.
3. **`cn(...)` from `@/lib/utils`** — `clsx` + `tailwind-merge`. Required
   so consumer-supplied `className` overrides our defaults instead of
   double-adding conflicting classes.

---

## 3. Departures from the plan's literal sketches

Three structural decisions worth noting; none change the visual contract.

### 3.1 Plan's `<TerminalContainer>` `Props` type spread typing

**Plan §4 Phase 2:**

```tsx
type Props = { title: string; accent?: ...; children: ReactNode; className?: string };
```

**Shipped:**

```tsx
type TerminalContainerProps = React.ComponentProps<"section"> & {
  title: string
  accent?: TerminalAccent
}
```

**Why:** `React.ComponentProps<"section">` includes `children`, `className`,
`id`, `style`, all `aria-*`, all `data-*`, all DOM event handlers, and
ref typing — for free. The plan's hand-written shape would force
consumers to wrap the component (or extend `Props`) just to attach an
`id` or an `onClick`. The same convention is in use across `skeleton.tsx`,
which I treated as the canonical shape.

The `TerminalContainerProps` and `Status` / `StatusDotProps` types are
exported alongside the components, so consumers (M4's eventual `/fleet`
table and `/spawn` flow) can typecheck their props without re-deriving.

### 3.2 `<StatusDot>` derives signals from two lookups, not six branches

**Plan §4 Phase 2** is silent on internal shape; the natural temptation
is a `switch (status)` with six cases each returning JSX.

**Shipped:** Two small lookup tables (`STATUS_COLOR` record + `STATUS_PULSES`
set) and one render path. Pulses on `running` / `spawning`; flat
otherwise; color from the record. Six cases collapsed into three
visually-distinct outputs without repeating render JSX three times.

**Why:** Avoids the "six branches each returning a copy of the same JSX
with one class swapped" anti-pattern. Future-cheap to add a new state
(e.g., a v1.5 `paused`): one record entry + maybe a set entry — no
branch to write.

### 3.3 `<PearlText>` is `React.ComponentProps<"span">`, not bespoke

**Plan §4 Phase 2:**

```tsx
type Props = { children: ReactNode; className?: string };
```

**Shipped:** `React.ComponentProps<"span">` — same reasoning as §3.1.
Consumer can attach `aria-label`, `id`, `onClick`, etc. without the
primitive needing to grow new props.

---

## 4. Decision-driven shape choices

| Decision | Phase 2 manifestation |
|---|---|
| 16 (additive `pearl` variant) | `default` untouched; `pearl` slotted in next to `link` |
| 17 (pearl is for commit actions) | Variant exists but no consumer in Phase 2; Phase 4 wires sign-in / onboarding submits |
| 18 (`<PearlText>` is `<span>`, not `<h1>`) | Shipped as `<span>` with `data-slot="pearl-text"` |
| 19 (`bg-clip:text` fallback) | Already encoded in Phase 1's `.pearl-text` (color: `var(--pearl-fallback-color)`) — `<PearlText>` inherits |
| 22 (`<TerminalContainer>` ships now) | New file; M4 first consumer per plan §1 |
| 23 (`<TerminalContainer>` accent map) | Static `Record<TerminalAccent, string>` — Tailwind-friendly |
| 24 (`<StatusDot>` ships now) | New file; pulses on `running` / `spawning` only |

---

## 5. Pre-existing failures discovered (not Phase 2's fault)

Running `pnpm type-check` against the full repo surfaces **2 type errors
in `frontend/src/components/agents/deploy-modal.tsx`** (lines 240, 273).
The error chain involves `react-hook-form`'s `Resolver<TFieldValues>` /
`SubmitHandler<TFieldValues>` against a Zod-derived schema where one
field's input type widens to `unknown`.

### 5.1 Stash-test evidence

To prove these errors are pre-existing rather than introduced by Phase 2,
I ran:

```bash
git stash push -m "phase2-changes" frontend/
pnpm type-check  # → still fails with the same deploy-modal.tsx errors
git stash pop
```

With Phase 2 stashed away, the same errors appear (plus a third
`spawnNAgents` RPC method-not-found error that the in-flight branch was
about to address). This confirms the breakage predates Phase 2.

### 5.2 Provenance

`git status -- src/components/agents/deploy-modal.tsx` returns `??` —
the file is **untracked**. It's the in-flight artifact of M4's spawn-flow
work (sibling: the also-untracked `docs/completions/spawn-flow-phase-4.md`).
This explains why Phase 1's build was clean despite identical type
infrastructure: the file was added between Phase 1 and Phase 2.

### 5.3 Why Phase 2 doesn't fix it

Per `docs/executing/frontend-redesign.md` §1 ("What this redesign does
*not* deliver"):

> **No spawn-modal UI work.** `docs/executing/spawn-flow.md` owns that.

Fixing `deploy-modal.tsx` would be cross-plan scope creep and would
bundle two milestones into one diff. The right move is to leave M4's
in-flight work alone and surface the failure for the spawn-flow plan
owner to address in their own next phase.

### 5.4 Phase 2 surface validation

To validate Phase 2's *own* surface is clean, I temporarily parked
`deploy-modal.tsx` (`mv` to `/tmp`), re-ran the full validation matrix,
and restored:

| Check | Phase 2 surface result |
|---|---|
| `pnpm type-check` (deploy-modal parked) | ✓ Clean |
| `pnpm lint` (deploy-modal parked) | ✓ Clean (pre-existing parked-out-of-scope lint warnings are also in `deploy-modal.tsx`) |
| `pnpm build` (deploy-modal parked) | ✓ 10/10 static pages, 1579ms compile |

This is the canonical attribution method: stash isolates uncommitted
work; parking the offending file isolates its blast radius. The
combination proves Phase 2's diff doesn't introduce or interact with
the failures.

### 5.5 Hand-off to spawn-flow plan owner

Errors to resolve (in `frontend/src/components/agents/deploy-modal.tsx`):

- **Line 240 / 273** — Zod `count` field's input-side type resolves to
  `unknown` instead of `number`. Likely a `z.coerce.number()` /
  `z.number()` mismatch where the `Resolver<TInput, TContext, TOutput>`
  generics diverge between input and output. Fix is usually either
  `useForm<ManyValues, unknown, ManyValues>` to thread the parameters
  explicitly, or align the schema with `.pipe()` so input and output
  match.
- **Line 254** — `spawnNAgents` RPC method missing from the generated
  Connect-go client. Likely needs a proto regen + import refresh; the
  M4 Phase 4 work was probably mid-flight on this.

These belong to spawn-flow Phase 4's hand-off note, not this completion
doc.

---

## 6. Validation matrix (Phase 2 row of plan §7)

| Check | Result |
|---|---|
| `pnpm type-check` (Phase 2 surface only) | ✓ Clean |
| `pnpm lint` (Phase 2 surface only) | ✓ Clean (0 errors, 0 warnings on Phase 2 files) |
| `pnpm build` (Phase 2 surface only) | ✓ 10/10 static pages |
| `pnpm dev` boots | Not run in this session — Phase 2 ships unconsumed primitives; Phase 3 will exercise dev-boot for the first time as it wires the first consumers |
| Pearl drift visible (Chrome) | Deferred to Phase 3 (first consumer) |
| Pearl drift visible (Safari) | Deferred to Phase 3 |
| Pearl `bg-clip:text` fallback | Deferred to Phase 3 |
| `<StatusDot>` pulses on `running`/`spawning` | Implemented; deferred visual confirmation to first M4 consumer |
| `<TerminalContainer>` `[ BRACKETS ]` look right | Implemented; deferred visual confirmation to first M4 consumer |
| `prefers-reduced-motion` snap | Inherited from Phase 1's CSS; no Phase 2 surface change |

The plan §4 Phase 2 also mentioned a "throwaway `/dev/preview` page" for
isolated visual confirmation. **Skipped** — the per-component visual
verification is more honestly tested when first consumed in Phase 3
(real route, real layout, real type hierarchy). Building a throwaway
page that gets deleted before merge introduces a temporary file in the
git history with no future audit value. Decision OQ8 already commits
to "no Storybook"; the throwaway page is the same idea by another name.

---

## 7. Drift from plan, summarized

| Item | Plan says | Shipped | Reason |
|---|---|---|---|
| `pearl` button variant | `bg-pearl text-foreground border border-border/40 ...` | `pearl text-foreground border-border/40 ...` | The plan's `bg-pearl` is a Tailwind-color shape (which decision 2 forbids); `pearl` (no prefix) is the utility class from Phase 1 — single source of pearl truth. Also dropped redundant `border` (CVA base classes already include `border border-transparent` so we only need to override the color half). |
| Props typing | Bespoke `{ children: ReactNode; className?: string }` | `React.ComponentProps<"span">` / `<"section">` | Inherits children, className, aria-*, events, ref typing; matches `Skeleton`'s convention |
| `data-slot` attribute | Not specified | Added on all three primitives | Convention in this codebase per `Skeleton` and `Button` |
| `<StatusDot>` internal shape | Not specified | Two-table lookup (color record + pulse set) | Avoids 6-branch JSX; future-cheap for new states |
| Accent class composition | Not specified | Static `Record<>` lookups | Tailwind static analyzer can't see template-string classnames |
| `/dev/preview` throwaway page | Optional, in plan validation | Skipped | Phase 3's first consumer is the better visual test |

No drift on: which primitive does what (verbatim), which file holds it
(verbatim), which decisions guide it (verbatim).

---

## 8. Hand-off to Phase 3

Phase 3 is **the first phase with a visible visual change** — Phases 1
and 2 were silent. Phase 3 wires the logo asset into the FE and adds
hero treatments to the four live routes.

What Phase 3 needs from Phase 2:

- `<PearlText>` ready at `@/components/ui/pearl-text` — Phase 3 wraps
  hero titles in it on sign-in, onboarding, dashboard.
- `pearl` button variant available — Phase 3 doesn't actually wire this
  yet (Phase 4 does); listed here for completeness.

What Phase 3 must do that Phase 2 deliberately deferred:

- **First `pnpm dev` boot of the redesign** — visit each of the four
  live routes, verify the new atmosphere renders.
- **First Safari fallback verification** — `bg-clip:text` should work
  in modern Safari; if not, the fallback lavender-white shows.
- **First `prefers-reduced-motion` smoke test** — toggle OS setting,
  verify the pearl text on heroes snaps to midpoint.
- **`pngquant` the logo** — `docs/assets/logo.png` is 4.2 MB; risk-7
  mitigation must run before mounting at `frontend/public/logo.png`.

Phase 3 is also where the first **screenshot capture** is mandatory per
plan §7 — committed to the per-phase completion doc as the visual audit
trail.

---

## 9. Risk register revisits

| # | Risk | Phase 2 impact |
|---|---|---|
| 1 | Pearl reads as Y2K Winamp | Still no rendered surface; first read in Phase 3 |
| 2 | Animation jank | Will manifest first when Phase 3 mounts heroes; Phase 2 doesn't render any animated surface |
| 6 | Contributor adds pearl to forbidden surface | The `pearl` button variant is now the second pearl entry-point (after Phase 1's classes). Both still require explicit opt-in; no Tailwind shortcut path |
| 8 | M4 reinvents primitives | **Removed** — `<TerminalContainer>` and `<StatusDot>` now exist at known imports. M4's `deploy-modal.tsx` is in flight and currently can't even type-check; when its owner unblocks it they have the option to consume our primitives. Worth surfacing in the spawn-flow plan's Phase 4 hand-off |
| 9 | Phase 5 doc drift | Phase 5 will need to point at the actual exported types (`TerminalAccent`, `Status`, `TerminalContainerProps`, `StatusDotProps`) as the canonical shapes |

---

## 10. Files touched

```
frontend/src/components/ui/button.tsx              +2  /  -0
frontend/src/components/ui/pearl-text.tsx          +29 / NEW
frontend/src/components/ui/terminal-container.tsx  +78 / NEW
frontend/src/components/ui/status-dot.tsx          +73 / NEW
                                       ────────────────────────
                                       Total: 4 files, ~182 LOC
```

No deletions. No edits to other components. The redesign continues to
be additive-only through Phase 2 — no live route renders any of the new
primitives yet. Phase 3 is the first visible visual change.
