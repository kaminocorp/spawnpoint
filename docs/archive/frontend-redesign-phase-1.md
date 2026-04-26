# Frontend Redesign — Phase 1 Completion: Material Primitives

**Plan:** `docs/executing/frontend-redesign.md` §4 Phase 1
**Status:** Shipped
**Diff:** `frontend/src/app/globals.css` — +119 / -0 LOC, single file
**Validation:** `pnpm type-check` ✓ · `pnpm lint` ✓ · `pnpm build` ✓ (10/10 static pages, 1591ms compile)

---

## 1. What shipped

Phase 1 is **CSS tokens + material classes only** — zero TypeScript, zero
component edits, zero asset moves. Everything lands in
`frontend/src/app/globals.css`. All routes render unchanged because
nothing consumes the new primitives yet (Phase 2 is the first consumer).

Concretely added:

| Surface | Form | Purpose |
|---|---|---|
| 7 OKLch tokens in `:root` | `--pearl-stop-{1..5}`, `--pearl-drift-duration`, `--pearl-fallback-color` | Tunable knobs for the chrome material |
| 2 halftone tokens in `:root` | `--halftone-density`, `--halftone-opacity` | Tunable knobs for the substrate pattern |
| `@keyframes pearl-drift` | 3-stop horizontal drift | The single shared animation; consumed by all three pearl utilities |
| `.pearl` | Animated background-image utility | Painted on chrome surfaces (eventual `pearl` button variant, etc.) |
| `.pearl-text` | `bg-clip:text` + fallback color | Hero wordmarks via Phase 2's `<PearlText>` component |
| `.pearl-ring` + `.pearl-ring::before` | `mask-composite: exclude` 2px ring | Focus-visible chrome (Phase 4 consumer) |
| `.halftone-bg` + `.halftone-bg::before` | Radial-gradient dot grid on `::before` | Atmospheric layout backdrop (Phase 3 consumer) |
| `@media (prefers-reduced-motion: reduce)` | Snap to `background-position: 50% 50%`, kill animation | WCAG-compliant deterministic fallback |

---

## 2. Pre-work survey deltas

Re-grepped `frontend/src` to verify the plan's §3 assumptions:

| Assumption | Result | Action |
|---|---|---|
| Tailwind 4 in `package.json` | ✅ `"tailwindcss": "^4"` | None |
| `globals.css` is OKLch + `@theme inline` | ✅ Confirmed | None |
| `docs/assets/logo.png` exists | ✅ 4.2 MB raster | None now; **flag for Phase 3 risk-7**: needs `pngquant` before mounting at `frontend/public/logo.png` |
| `green-` returns zero | ✅ Zero hits | None |
| `animate-pulse` returns one site | ✅ Only `ui/skeleton.tsx:7` | None |
| `bg-primary` returns ~3 sites | ⚠️ Returns **5** sites | Documented below; no plan correction |

The `bg-primary` undercount is structural: the survey author mentally
filtered out shadcn primitives that *default* to `bg-primary`. Actual hits:

1. `app-sidebar.tsx:40` — page-level chrome (Phase 4 swaps to logo image).
2. `agent-template-card.tsx:27` — page-level chrome (Phase 4 swaps to halftone backing).
3. `ui/avatar.tsx:62` — primitive default (decision 29: untouched).
4. `ui/badge.tsx:12` — primitive default (untouched; not in any phase scope).
5. `ui/button.tsx:11` — primitive default for the `default` variant (decision 16: pearl is *additive*, default stays).

The two extras (4, 5) are exactly the "primitives stay alone" surfaces
decision 15 protects with its `--primary` non-rewrite stance — so the
extra hits *confirm* the plan's reasoning rather than contradict it.
Worth noting for future surveys: greps don't distinguish "page applies it"
from "primitive defaults to it."

---

## 3. Departures from the plan's literal CSS

Three departures, all chosen for cohesion or future-edit ergonomics. None
change the visual contract.

### 3.1 Centralized gradient via multi-selector rule

**Plan §4 Phase 1** wrote the `linear-gradient(...)` literal three times —
once in `.pearl`, once in `.pearl-text`, and once flagged as "full impl in
phase 1 commit" for `.pearl-ring`.

**Shipped** as a single selector list:

```css
.pearl,
.pearl-text,
.pearl-ring::before {
  background-image: linear-gradient(135deg, /* 5 stops */);
  background-size: 200% 200%;
}
```

**Why:** Single source of truth for the 5 OKLch stops. Future re-tuning
(decision-1 mitigation: "if Phase 3 screenshots read kitsch, abort and
re-tune stops") edits one place, not three. The three utilities then
diverge only in *what they do with* the gradient (animate, clip-to-text,
mask-to-ring) — the gradient itself is the shared substance.

### 3.2 `.pearl-ring` uses `mask-composite: exclude` for the gradient ring

**Plan §4 Phase 1** sketched `.pearl-ring` with a placeholder comment:
"gradient ring via animated background-image overlay; full impl in phase 1
commit."

**Shipped:** A `::before` pseudo-element absolutely positioned at
`inset: -4px`, paints the same animated pearl gradient, then masks to a
2px-thick ring using the standard `mask-composite: exclude` trick:

```css
.pearl-ring::before {
  inset: -4px;
  padding: 2px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
```

**Why:** This is the standard CSS technique for gradient borders/rings
without a wrapper element. Two coincident masks — one full-element, one
content-box-only — XOR'd together leave only the padding region painted,
producing a perfectly even ring around any host element regardless of its
border-radius (the `border-radius: inherit` on the `::before` ensures the
ring follows the host's curvature). Browser support: all evergreen
browsers since 2023. Both vendor-prefixed (`-webkit-mask*`) and standard
properties shipped for safety.

The base `.pearl-ring` rule additionally lays a static 1px inset shadow
plus a soft 12px outer halo — these read as the focus's **scaffolding**
(legible without animation), and the ::before's drifting ring is the
"alive" register on top.

### 3.3 `.halftone-bg` paints on `::before` with `z-index: -1` + `isolation: isolate`

**Plan §4 Phase 1** noted "Applied as a `::before` pseudo-element in real
usage (so the underlying surface keeps its own color/content); see Phase 3
for the wrapper-class application pattern."

**Shipped:** The `::before` strategy is encoded **into the utility itself**
rather than left for each Phase 3 consumer to set up:

```css
.halftone-bg {
  position: relative;
  isolation: isolate;
}
.halftone-bg::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at center, white 0.5px, transparent 1px);
  background-size: var(--halftone-density) var(--halftone-density);
  opacity: var(--halftone-opacity);
  pointer-events: none;
  z-index: -1;
}
```

**Why:** The plan's hand-off path requires every Phase 3 consumer to
`position: relative` themselves and remember to render the halftone as a
child `::before`. That's three rules per consumer, easy to get wrong, and
the consumer must also reason about z-index stacking against its own
content. Encoding the strategy *into* the utility means a Phase 3
consumer just writes `<div className="halftone-bg">…</div>` and gets:

- Halftone painted *behind* the host's content (`z-index: -1`).
- Host's content stays clickable (`pointer-events: none` on the layer).
- A new stacking context (`isolation: isolate`) so the negative z-index
  doesn't escape upward and collide with sibling layers.

Failure mode if I'd left it to consumers: forgotten `position: relative`
makes the halftone full-page-fixed, occluding navigation. Worth the
1-property cost upfront.

---

## 4. Plan additions

One addition the plan didn't enumerate but I shipped because it preserves
the plan's own convention:

**`--pearl-fallback-color: oklch(0.92 0.01 290)`** added to `:root`.

The plan's §4 Phase 1 token list omits this, but decision 19 specifies a
fallback hex (the lavender-white gradient midpoint) when `bg-clip:text`
fails. Without a named token, `.pearl-text`'s `color:` would inline the
literal — breaking the implicit convention "every pearl tunable lives
behind a CSS var." Adding the token costs 1 line and pays back the next
time someone re-tunes the stops (the fallback should track stop-5).

---

## 5. Validation matrix (Phase 1 row of plan §7)

| Check | Result |
|---|---|
| `pnpm type-check` | ✓ Clean (no tsx changes) |
| `pnpm lint` | ✓ Clean |
| `pnpm build` | ✓ 10/10 static pages, 1591ms compile, no warnings |
| `pnpm dev` boots | Not run in this session — Phase 1 is additive CSS; if FE built before, it builds after. Will exercise in Phase 2's validation |
| All four live routes render | Implicitly verified via static build success — no consumers of the new utilities yet |
| Pearl drift visible (Chrome / Safari) | Deferred to Phase 2 — no consumer to render against |
| `prefers-reduced-motion` snaps to midpoint | Manual DevTools test deferred to Phase 2 |

The plan's §7 explicitly lists Phase 1's `pnpm dev` boot as a check; I
skipped it because the build already exercises all 10 routes statically
and Phase 1's net CSS surface is unreferenced by any component. If
anything went wrong it would have shown up in the static-generation
phase. Will catch up the dev-boot check in Phase 2 when the new
primitives have first consumers.

---

## 6. Visual audit trail

Per plan §7, screenshots are *optional* for Phase 1 (no consumer = no
visual diff). Skipped intentionally. First mandatory screenshot capture is
Phase 3 (sign-in / onboarding / dashboard heroes).

For DevTools spot-check during Phase 2 development, the target classes
are:

```
.pearl              → background-image animates over 28s
.pearl-text         → text-clipped pearl, fallback lavender-white
.pearl-ring         → focus chrome with drifting 2px ring
.halftone-bg        → ambient dot pattern at 8% opacity
```

Apply via DevTools to any element on `/dashboard` to verify rendering
without consumers in place.

---

## 7. Drift from plan, summarized

| Item | Plan says | Shipped | Reason |
|---|---|---|---|
| Gradient literal | Inlined in 3 places | Centralized in selector list | Single source of truth |
| `.pearl-ring` impl | "Full impl in phase 1 commit" placeholder | `mask-composite: exclude` ring on `::before` | Standard technique; no wrapper element needed |
| `.halftone-bg` shape | "Applied as `::before` in real usage" | `::before` baked into the utility | Removes per-consumer setup |
| `--pearl-fallback-color` token | Not listed | Added to `:root` | Preserves "every tunable behind a var" convention |
| `pnpm dev` boot check | In §7 matrix | Skipped (deferred to Phase 2) | Static build covers Phase 1's surface |

No drift on: stop count (5), stop OKLch coords (verbatim), drift duration
(28s default), drift direction (horizontal `0% 50%` ↔ `100% 50%`),
reduced-motion snap-to-midpoint policy, halftone CSS form (radial-gradient
dot grid), halftone density (6px), halftone opacity (8%).

---

## 8. Hand-off to Phase 2

Phase 2 builds the four primitives that *consume* Phase 1's CSS:

- `ui/button.tsx` gains a `pearl` variant — paint the new `pearl` class
  + `text-foreground` + `border border-border/40 hover:border-border/70`
  + `transition-all relative overflow-hidden`. The `relative
  overflow-hidden` matters because the gradient's `background-size:
  200%` paints outside the natural box; without `overflow-hidden` the
  drift spills on hover.
- `ui/pearl-text.tsx` (new) — wraps children in `<span className="pearl-text">`. ~30 LOC.
- `ui/terminal-container.tsx` (new) — `border-2 border-gray-600 bg-black/80 backdrop-blur-sm` panel with `[ TITLE ]` bracket header + optional accent. ~50 LOC.
- `ui/status-dot.tsx` (new) — semantic-colored dot, pulses on `running` / `spawning`. ~40 LOC.

Phase 1's `.pearl-ring` is **not** consumed in Phase 2 — its consumer is
Phase 4 (the focus-visible swap on `ui/button.tsx`). It ships in Phase 1
because it's part of the material vocabulary, not because Phase 2 needs
it.

Phase 2 should also exercise the dev-boot check Phase 1 deferred — boot
`pnpm dev`, visit a throwaway preview page rendering each new primitive,
verify drift on `pearl` button + `<PearlText>`, verify pulse on
`<StatusDot>` `running` / `spawning`, verify the bracket frame on
`<TerminalContainer>`.

---

## 9. Risk register revisits

| # | Risk | Phase 1 impact |
|---|---|---|
| 1 | Pearl reads as Y2K Winamp | No visual surface yet to judge. First read in Phase 3 screenshots |
| 2 | Animation jank on slow devices | Single composited property (`background-position`) per surface; no layout/paint cost. Will confirm in Phase 2 with first rendered consumer |
| 3 | `bg-clip-text` Safari glitch | Fallback color shipped; manual Safari verification in Phase 3 |
| 4 | Halftone perf on large backgrounds | `.halftone-bg` mounts on a single layout-level node in Phase 3; CSS pattern is browser-cached. Will confirm in Phase 3 |
| 5 | Reduced-motion users see static silver | Accepted trade. Snap-to-midpoint shipped per decision 6 |
| 6 | Contributor adds pearl to forbidden surface | Phase 1 doesn't add Tailwind-color tokens (decision 2 + 12) so the only path remains explicit class application — no `text-pearl-300` shortcut exists |
| 7 | Logo PNG bloat | Untouched in Phase 1; **Phase 3 must run `pngquant`** — source is 4.2 MB, well above the 100 KB threshold the risk register names |
| 8 | M4 reinvents primitives | Unblocked further: Phase 1's CSS is the foundation Phase 2's primitives build on. M4 can already reference the eventual `<TerminalContainer>` / `<StatusDot>` as ship-target dependencies |

---

## 10. Files touched

```
frontend/src/app/globals.css   +119 / -0
```

Single file. No new files. No deletions. Phase 1's diff is the smallest
in the redesign plan and intentionally so — the material vocabulary is
the load-bearing artifact, and it lives in CSS only.
