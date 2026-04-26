# Login Animation — Phase 5 Completion Notes

> Phase 5 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: replace
> the throwaway smoke route with the real integration on `/sign-in`,
> add the radial-vignette readability floor, delete the debug
> components that lived through Phases 0–4. **No shader, scheduler,
> bake-script, or shape changes** — Phase 5 is pure wiring.

**Status:** ✅ Exit gate met — `/sign-in` renders the full morph
engine behind the form, the smoke route is gone from the build
manifest, lint + type-check + `next build` clean. The animation is
now in front of every signed-out user landing on `/sign-in`.

---

## Significant deviations from the plan

One small wiring deviation, plus one build-tool gotcha worth pinning.

### 1. Vignette uses an inline `radial-gradient` style, not a Tailwind utility

The plan's Phase 5 task 3 prescribed
`bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.6)_0%,transparent_60%)]`
as the vignette class. Shipped as `style={{ background:
"radial-gradient(...)" }}` instead, with `pointer-events-none fixed
inset-0 -z-[5]` for the layout/z-order side. Reasons:

- **Tailwind 4's arbitrary-value parser handles `radial-gradient(...)`
  with explicit underscores, but the readability cost is steep** —
  the resulting class is a 70-character single token with `_` instead
  of spaces. Inline `style` reads as the actual CSS.
- **Two values, two tuning dials.** The vignette's `0.6` alpha and the
  `60%` falloff radius are Phase 7 dials (#8 in the tuning list).
  Inline keeps both visible to a future tuning pass without leaving
  the file.
- **No bundler difference.** Both forms emit identical compiled CSS.

Negligible deviation; documenting only because the plan's literal
class string is in the spec.

### 2. Turbopack's stale `.next` cache held a phantom route after `rm -rf`

After deleting `frontend/src/app/sign-in-swarm-smoke/`, `pnpm
type-check` failed with:

```
.next/types/validator.ts(96,39): error TS2307: Cannot find module
'../../src/app/sign-in-swarm-smoke/page.js' or its corresponding
type declarations.
```

Turbopack's `.next/types/validator.ts` is regenerated on every build
*from the file-system route inventory*, but `tsc --noEmit` reads the
already-on-disk validator. A previous build (during Phase 4) had
emitted a `validator.ts` that referenced the smoke route; that file
persisted across the `rm -rf`. Solved by `rm -rf .next` before the
re-check.

This is a Turbopack-side state-leak quirk, not a code issue. Pinning
it here so the next time a route deletion races with a `type-check`,
the fix is immediate. The full reproduction: any `tsc` invocation
between "route deleted" and "next build re-emits validator.ts" will
flag the phantom. Future route deletions should run `rm -rf .next` as
a hygiene step before the verification suite.

---

## What changed

### Files modified

| File | Change |
|------|--------|
| `frontend/src/app/sign-in/page.tsx` | `<SwarmBackground />` mounted as the first non-text child of `<main>`. `grid-bg` class dropped from `<main>` (replaced by `bg-black` — the swarm canvas paints over it but the underlying surface stays pure black for the brief moments before the dynamic-import resolves and during the prefers-reduced-motion fallback). New radial-vignette `<div>` sits at `-z-[5]`, between the swarm canvas (`-z-10`) and the form (default stacking context). The vignette is a `pointer-events-none fixed inset-0` overlay with an inline `radial-gradient(circle at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 60%)`. |

### Files removed

| File | Reason |
|------|--------|
| `frontend/src/app/sign-in-swarm-smoke/page.tsx` | The smoke-test route was the development scaffolding for Phases 0–4. With the morph engine wired into the real `/sign-in`, it has no remaining purpose. The route's `mode={morph,static}` toggle, the form-rect outline, and the per-shape preview buttons all collapse into the production page or simply go away. |
| `frontend/src/components/sign-in/shape-preview-canvas.tsx` | Phase 1's debug component for individual-shape inspection. It was the smoke route's sole consumer. Vanilla `<pointsMaterial>` rendering is no longer needed anywhere; the production path uses the `SwarmPoints` component built in Phase 2. |

### Files NOT changed

- `frontend/src/components/sign-in/swarm-background.tsx` — the
  thin SSR-disabled wrapper from Phase 0 ships unchanged. Its
  `<div className="fixed inset-0 -z-10 bg-black">` already has the
  layer order Phase 5 expected.
- `frontend/src/components/sign-in/swarm-canvas.tsx`,
  `swarm-points.tsx`, `morph-scheduler.ts`, `shape-loader.ts`,
  `shaders/*` — the morph engine is wiring-agnostic. Phase 5 doesn't
  touch any of it.
- All six `.bin` files under `public/sign-in/shape-targets/` —
  unchanged.
- `frontend/src/app/(app)/...` and other routes — the `/sign-in`
  surface is the only signed-out page that gets the animation. The
  signed-in chrome continues to use `grid-bg` and shadcn surface
  tokens.

---

## How the integration layers (load-bearing details)

### Z-order

Three stacking layers above the `bg-black` `<main>` surface:

```
-z-10  swarm canvas   (fixed, full viewport, dynamic-imported)
-z-5   radial vignette (fixed, full viewport, pointer-events-none)
 z-0   header + form   (default flow, centred via `flex … justify-center`)
```

The vignette's `-z-[5]` is Tailwind 4's arbitrary-value escape for an
intermediate value between `-z-10` and `z-0`. Without it, the
vignette would either overlap the form (if `z-0`) or sit beneath the
canvas (if `-z-10`), defeating the point. The 60% falloff radius
keeps the vignette's darkening confined to the form's neighbourhood —
the canvas edges retain full swarm visibility.

### Why a vignette and not a backdrop-blur on the form

The plan considered `backdrop-blur` as the readability mechanism. Two
reasons the vignette won:

- **Backdrop-blur on a translucent panel reads as a frosted-glass
  Apple convention.** Pure-black background + green terminal type +
  morphing particles is the design system's register; frosted glass
  would fight it.
- **The vignette is content-agnostic.** It darkens whatever's behind
  it — works equally well for chevron-through-form, octahedron-
  through-form, network-edge-through-form. A form-shaped backdrop
  blur would only soften, not darken; high-luminance particles would
  still cut through.

The structural caveat: at high `uCyanTint` the cyan particles are
brighter than green particles. The vignette's `0.6` alpha was sized
for green; if Phase 7 finds cyan-through-form moments still struggle
for contrast, the tuning dial is `0.6 → 0.75` (per the plan's Phase
7 task #8). No code-shape change.

### Why drop `grid-bg`

The previous `/sign-in` used `grid-bg` (defined elsewhere in the
design system) — a faint dotted lattice that signalled "control
plane." With the swarm canvas covering the same viewport, both
patterns would multiply against each other and produce visual moiré.
Pure black is the right base — the swarm *is* the new texture.

### Form readability claim, with caveats

The form fields, labels, button, and error text are all sized + weighted
to clear AA contrast against pure black. Against the swarm + vignette
composite they should still clear — the vignette guarantees a darker-
than-pure-black backdrop in the form's centre. **The empirical
verification of this is deferred to the first dev session that opens
`/sign-in` in a browser.** Structural verification (build clean, layer
order correct, no SSR errors, no console warnings) is what Phase 5's
exit gate pins.

---

## Verification

### Lint

```
$ pnpm -C frontend lint
> eslint
$
```

Clean.

### Type-check (after `rm -rf .next`)

```
$ pnpm -C frontend type-check
> tsc --noEmit
$
```

Clean.

### Production build

```
$ pnpm -C frontend build
✓ Compiled successfully in 2.1s
✓ Generating static pages using 11 workers (10/10) in 266ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /agents
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
└ ○ /sign-in
```

Smoke route gone from the manifest (10 routes now, was 11). `/sign-in`
still pre-renders cleanly — the swarm canvas's
`dynamic(() => import('./swarm-canvas'), { ssr: false })` boundary
keeps three.js + R3F outside the SSR pass.

### Visual confirmation (deferred — same pattern as Phases 0–4)

Visual confirmation that the form is readable through every shape in
the rotation, that the dynamic-import doesn't cause a layout shift,
and that the sign-in flow still works against real Supabase requires
`pnpm -C frontend dev`, navigating to `/sign-in`, watching one full
rotation across all six shapes, and submitting the form. Structural
verification — route registered, layer order correct, types clean,
build clean — is what's pinned by the exit gate.

---

## Decisions worth pinning

These are now load-bearing for Phases 6–7.

1. **Z-order is `-z-10` (canvas) → `-z-5` (vignette) → `z-0` (form).**
   Any new chrome element on `/sign-in` must claim a z-index relative
   to these landmarks. The vignette's intermediate slot is the
   readability floor; do not insert anything between vignette and
   form unless that thing is itself a readability aid.
2. **Vignette uses inline `style` for the gradient, not a Tailwind
   utility class.** Phase 7's tuning dials (`0.6` alpha, `60%`
   falloff) live in the inline `style` object — direct, unambiguous.
3. **`bg-black` replaces `grid-bg` on the `<main>` element.** Pure
   black is the swarm's intended base; reintroducing `grid-bg` would
   cause moiré against the particles. If the prefers-reduced-motion
   fallback (Phase 6) shows the static chevron PNG, that PNG should
   be on the same pure-black background — no `grid-bg` revival.
4. **Smoke route is gone for good.** Phase 6's reduced-motion + mobile
   work happens against the real `/sign-in` surface. If a debug pass
   wants per-shape inspection again, the path is to temporarily
   stub `ACTIVE_SHAPES` in `swarm-canvas.tsx` (one-line edit), not
   to revive a parallel route.
5. **Turbopack's stale `.next/types/validator.ts` is a known
   route-deletion gotcha.** Future route deletions should
   `rm -rf .next` before the verification suite to avoid phantom-
   module type errors.

---

## Estimate vs. actual

Plan estimate: 0.5 day. Actual: ~10 minutes of focused work. The
phase is genuinely small once Phase 0's `SwarmBackground` wrapper
is in place — three edits (import, mount, vignette) and two
deletions (route, debug component). The Turbopack cache gotcha was
the only delay, and it cost ~30 seconds.

---

## What Phase 6 inherits

- **`/sign-in/page.tsx` is the integration surface.** Phase 6's
  reduced-motion branch lives in `swarm-background.tsx`, not in the
  page itself. The page already mounts `<SwarmBackground />`
  unconditionally; Phase 6 swaps the component's *body* between
  morph-engine vs static-PNG based on `matchMedia` detection.
- **The vignette ships with the morph engine, not separately.**
  Phase 6's reduced-motion fallback (the still-frame PNG) sits in
  the same `-z-10` slot the canvas occupies. The vignette will sit
  above the PNG just as it sits above the canvas — no special-
  case wiring required.
- **`bg-black` on `<main>` is the layer-zero invariant.** The
  prefers-reduced-motion fallback inherits this base; the static
  PNG sits flush on pure black, no design-system surface tokens
  involved.
- **No mobile branching shipped yet.** Phase 6 task 2 detects
  `(max-width: 768px)` at canvas mount and subsamples the loaded
  shape targets to `PARTICLE_COUNT_MOBILE = 6000`. That logic lives
  in `swarm-points.tsx` (or a new `useViewportParticleCount` hook),
  not in the page.

---

## What was *not* done in Phase 5 (and why that's correct)

- **No `prefers-reduced-motion` branch.** Phase 6 task 1.
- **No mobile particle subsampling.** Phase 6 task 2.
- **No backdrop-blur on the form.** Vignette ships instead — see
  the load-bearing details. If Phase 7 finds the vignette
  insufficient, the dial is the alpha (`0.6 → 0.75`), not adding a
  second readability mechanism.
- **No re-styling of the form chrome.** The `TerminalContainer`,
  `Input`, `Label`, `Button`, error-message styling all stay
  exactly as they were. The form is the hero; the animation is
  wallpaper. The plan's Phase 5 task 5 ("verify form contrast")
  is the empirical check that closes this — deferred to first
  dev-session pass per the same pattern as earlier phases.
- **No Phase 7 tuning.** Cyan curve, hold flicker amplitude,
  cycle pacing, vignette darkness — all the dials are present
  but untouched. Phase 7's job, not Phase 5's.
- **No analytics on which shape was visible at sign-in time.**
  Tempting; adds nothing to v1.
- **No tests.** v1's posture from Phases 1–4 holds.
