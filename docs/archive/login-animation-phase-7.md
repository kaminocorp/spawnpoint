# Login Animation — Phase 7 Completion Notes

> Phase 7 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: first
> live-browser tuning pass against the running engine. Triggered by an
> operator session that booted `/sign-in` post-Phase-6 and saw three
> distinct failure modes back-to-back: (1) the canvas painted under a
> black rectangle and was invisible; (2) once visible via Reduce Motion
> being on, the SVG fallback projected as a viewport-filling chevron;
> (3) once Reduce Motion was off, the live swarm rendered as fluffy
> overlapping clouds rather than discrete particles.

**Status:** ✅ All three failures fixed. Live swarm reads as a
pinprick particle field morphing through the shape rotation; the
reduced-motion still reads as a quiet ambient texture; the canvas is
no longer hidden by a stacking-context bug.

---

## What broke and how it was fixed

Three independent defects, surfaced in order during one live session.

### 1. Canvas hidden behind `<main>`'s background

**Symptom.** `/sign-in` rendered as a pure-black page with the form
visible — no swarm, no fallback. R3F's `THREE.Clock` deprecation
warning appeared in the console, confirming the canvas had mounted
and was driving frames; nothing visible on screen.

**Root cause.** `frontend/src/app/sign-in/page.tsx:35` — `<main
className="relative … bg-black …">`. Because `<main>` is `position:
relative` *without* an explicit `z-index`, it does not establish a
stacking context. The `SwarmBackground` child is `fixed inset-0
-z-10`, which therefore participates in the **root** stacking context
at layer −10. Per CSS painting order, the root stacking context paints
negative-z descendants *before* in-flow block backgrounds — so
`<main>`'s `bg-black` paints over the canvas.

**Fix.** Removed `bg-black` from `<main>`. The `SwarmBackground`
wrapper already carries its own `bg-black` on the fixed layer
underneath the canvas, so the page background register is unchanged
on every viewport — the only behavioural delta is that `<main>` no
longer paints a black rectangle on top of the canvas.

```diff
- <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-8">
+ <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-8">
```

**File:** `frontend/src/app/sign-in/page.tsx:35`.

**Why this didn't surface in Phases 0–6.** Visual confirmation was
deferred per each phase's "Verification" section to a later live
walk-through; structural verification (build clean, lint+types clean,
both branches present in DOM) was the exit gate. The stacking-context
bug is invisible to lint, typecheck, and `next build` — only the live
render exposes it. Phase 7 is the first phase where the live render
*is* the gate.

### 2. Reduced-motion still projected as a viewport-filling billboard

**Symptom.** With macOS Reduce Motion on, the fallback chevron filled
the viewport — a giant glowing `›` painted over most of the page,
form barely visible at centre.

**Root cause.** `reduced-motion-still.tsx`:

- `preserveAspectRatio="xMidYMid slice"` — the `slice` keyword scales
  the viewBox to fully *cover* the rendered rectangle, cropping
  whichever axis is shorter. On a tall-and-narrow viewport (which the
  operator's screen was), the 1920×1080 viewBox got scaled up so its
  height matched the screen height, with the sides cropped. Net
  effect: every viewBox unit got magnified, including the chevron.
- The chevron polygons were sized for hold-phase silhouette parity
  with the live swarm (`-440 to +240` horizontal, `-440 to +440`
  vertical = ~680×880 viewBox units around centre). Combined with
  `slice`, on a portrait viewport they projected to ~360×460 *screen*
  pixels — basically the entire visible canvas.
- Stipple density (14 px period, 1.6 px radius dots, full opacity)
  was tuned for the live-swarm cousin register but reads as a near-
  solid mass at scale.
- Halo gradient at 0.10 alpha was the appropriate "hold-phase wash"
  but added to the overwhelming brightness when stacked under the
  oversized chevron.

**Fix.** Three changes in `reduced-motion-still.tsx`:

```diff
- preserveAspectRatio="xMidYMid slice"
+ preserveAspectRatio="xMidYMid meet"
```

`meet` scales the viewBox to *fit* (no cropping). On a tall viewport
the SVG renders at the width that fits, leaving vertical letterbox
that's fine because the parent `<div>` is `bg-black`.

```diff
- <pattern id="stipple" … width="14" height="14">
-   <circle cx="7" cy="7" r="1.6" fill="rgb(178, 219, 178)" />
+ <pattern id="stipple" … width="24" height="24">
+   <circle cx="12" cy="12" r="0.9" fill="rgb(178, 219, 178)" fillOpacity="0.45" />
```

Period 14→24 px, radius 1.6→0.9 px, opacity 1.0→0.45. Silhouette now
reads as a texture suggestion, not a solid mass.

```diff
- <radialGradient id="halo" … r="60%">
-   <stop offset="0%" stopColor="rgba(34, 197, 94, 0.10)" />
+ <radialGradient id="halo" … r="55%">
+   <stop offset="0%" stopColor="rgba(34, 197, 94, 0.06)" />
```

Halo dimmed 0.10→0.06 alpha, slightly tighter radius.

```diff
- <polygon points="-440,-340 -340,-440 240,-30 140,30" />
- <polygon points="-440,340 -340,440 240,30 140,-30" />
+ <polygon points="-220,-170 -170,-220 120,-15 70,15" />
+ <polygon points="-220,170 -170,220 120,15 70,-15" />
```

Chevron polygons halved (~340 viewBox units wide, centred). Quiet
ambient presence rather than a hero element.

**File:** `frontend/src/components/sign-in/reduced-motion-still.tsx`.

### 3. Live swarm read as fluffy clouds, not discrete particles

**Symptom.** With Reduce Motion off, the actual R3F canvas rendered:
~half a dozen large glowing soft blobs drifting around, no readable
silhouettes, no per-particle individuation.

**Root cause.** `frontend/src/components/sign-in/shaders/swarm-vert.ts`:

- `gl_PointSize = 2.5 * uPixelRatio * (300.0 / -mvPosition.z)`. At
  the camera distance `z=6` and `devicePixelRatio=2`, this resolves
  to `2.5 × 2 × 50 ≈ 250 pixels per point`. The intended-but-untuned
  empirical figure (the comment in the shader literally said "the
  300.0 figure is empirical and gets a tuning pass in Phase 7")
  produced points roughly 80× too large. Each particle painted as a
  giant soft sprite, and 18,000 of them blended additively over each
  other resolved to amorphous luminous clouds rather than a swarm.
- `vAlpha = 0.85` (drift/hold) / `0.95` (morph). With additive
  blending and tens of thousands of overlapping sprites, anything
  above ~0.4 baseline saturates to white well before the silhouette
  reads.

**Fix.** Both numbers retuned in
`frontend/src/components/sign-in/shaders/swarm-vert.ts`:

```diff
- gl_PointSize = 2.5 * uPixelRatio * (300.0 / -mvPosition.z);
+ gl_PointSize = 1.0 * uPixelRatio * (8.0 / -mvPosition.z);
```

At `z=6, devicePixelRatio=2`: `1.0 × 2 × 1.33 ≈ 2.7 px per point`.
With the fragment shader's `exp(-d*d*8.0)` falloff that gives a soft
~3–4 px halo per particle — pinprick scale, individually resolvable,
swarm-density at 18,000.

```diff
-   if (uPhase == 1) {
-     vAlpha = 0.95;
-   } else if (uPhase == 2) {
-     float flicker = sin(uTime * 0.4 + morphSeed * 6.2831853) * 0.08;
-     vAlpha = 0.85 + flicker;
-   } else {
-     vAlpha = 0.85;
-   }
+   if (uPhase == 1) {
+     vAlpha = 0.45;
+   } else if (uPhase == 2) {
+     float flicker = sin(uTime * 0.4 + morphSeed * 6.2831853) * 0.04;
+     vAlpha = 0.32 + flicker;
+   } else {
+     vAlpha = 0.32;
+   }
```

Drift/hold 0.85 → 0.32, morph 0.95 → 0.45, hold-phase flicker
amplitude 0.08 → 0.04 (proportional to the new baseline). Additive
blend no longer saturates; particles read as discrete points whose
density sketches the silhouette.

**File:** `frontend/src/components/sign-in/shaders/swarm-vert.ts`.

---

## Files touched

| File | Change |
|------|--------|
| `frontend/src/app/sign-in/page.tsx` | Removed `bg-black` from `<main>` so the `-z-10` swarm canvas paints above main's background in the root stacking context. |
| `frontend/src/components/sign-in/reduced-motion-still.tsx` | `slice` → `meet`; chevron polygons halved; stipple period 14→24, radius 1.6→0.9, opacity 1.0→0.45; halo alpha 0.10→0.06. Doc-comment rewritten to describe the new register and the three corrections. |
| `frontend/src/components/sign-in/shaders/swarm-vert.ts` | `gl_PointSize` formula retuned (250 px → ~3 px at z=6, dpr=2). Alpha values lowered to additive-blending-safe levels (0.85 → 0.32, 0.95 → 0.45). Comments updated to pin the new numbers. |

No new files, no new deps, no proto/schema/env change.

---

## Decisions worth pinning (post-Phase-7 dials)

These supersede the Phase 6 "Decisions worth pinning" entries on the
same dials.

1. **`<main>` on `/sign-in` does not paint a background.** The black
   register comes from `SwarmBackground`'s wrapper div, which both
   the morph-engine and reduced-motion branches share. Future edits
   to `/sign-in/page.tsx` must not reintroduce `bg-*` on the `<main>`
   element — that re-creates the canvas-hidden bug.
2. **Reduced-motion still uses `preserveAspectRatio="meet"`, not
   `slice`.** The chevron silhouette's role is ambient texture, not
   billboard. Tuning candidates if the still ever needs to feel
   denser: stipple `width=24` / `r=0.9` / `fillOpacity="0.45"`,
   halo alpha `0.06`. Don't reach for `slice` again.
3. **`gl_PointSize` is `1.0 * uPixelRatio * (8.0 / -mvPosition.z)`.**
   At z=6, dpr=2 that's ~2.7 px. Phase-8 dial if particles read as
   too sparse: bump the `8.0` to `12.0` (~4 px) before bumping the
   `1.0` base. The base controls absolute size; the constant in the
   distance term controls how much depth-attenuation matters.
4. **Alpha baseline is 0.32 / 0.45.** Drift/hold 0.32, morph 0.45,
   hold-phase flicker amplitude 0.04. With 18,000 additive particles
   anything above ~0.4 baseline saturates the additive blend toward
   white. Don't restore the 0.85/0.95 values — those were the
   pre-tuning placeholders.
5. **Phase 7 is the first phase that gates on live render.** Phases
   0–6 gated on lint+typecheck+build and deferred visuals; the
   stacking-context, point-size, and SVG-projection bugs were all
   invisible to those gates. Future infra-style refactors here
   should still gate on a live walkthrough on at least one
   tall-and-narrow viewport.

---

## What Phase 8 inherits

- **All three primary readability blockers are gone.** Phase 8 (the
  final tuning pass per the implementation plan) is now true tuning
  rather than triage: cycle pacing, color cross-fade timing, hold-
  phase jitter amplitude, full sequence rhythm, and the bake's
  per-shape numbers.
- **Live render is now the source of truth.** With the canvas
  reliably on screen, every Phase-8 dial can be evaluated by eye.
- **The Phase 6 "what Phase 7 inherits" dial inventory still
  applies**, with the Phase 7 numbers above replacing the prior
  values for `gl_PointSize`, `vAlpha`, the stipple/halo/chevron
  parameters in `reduced-motion-still.tsx`, and the `<main>`
  background invariant.

---

## What was *not* done in Phase 7

- **No production-build perf profile.** Phase 6 §What-was-not-done
  deferred this; Phase 7 still defers it. The three fixes above are
  visual-correctness fixes; they don't move frame budget enough to
  warrant a profile pass on their own. Phase 8 is the right home.
- **No tuning of cycle pacing, easing curves, color mix, scheduler
  weights, or bake parameters.** Those are Phase 8's scope. Phase 7
  shipped *only* the three corrections needed to make the live
  render legible; everything else was left at its Phase 0–6 value.
- **No fix for the `THREE.Clock` deprecation warning.** It originates
  in `@react-three/fiber` itself (still calls `THREE.Clock`), is
  benign, and isn't ours to chase.
- **No tests.** v1's posture from earlier phases holds.
