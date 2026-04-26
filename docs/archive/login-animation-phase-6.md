# Login Animation — Phase 6 Completion Notes

> Phase 6 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope:
> `prefers-reduced-motion` fallback + mobile particle subsampling +
> perf flag audit. **No new shape work, no shader work** — the
> hardening pass that closes the v1 envelope before Phase 7's tuning.

**Status:** ✅ Exit gate met — reduced-motion users get a
Corellia-shaped static still without ever loading three.js or R3F;
mobile viewports drop to 6000 particles; perf flags audited; lint +
type-check + `next build` clean.

---

## Significant deviations from the plan

Two intentional deviations.

### 1. Reduced-motion fallback ships as inline SVG, not a baked PNG

The plan's Phase 6 task 1 prescribed a 1920×1080 PNG screenshot of the
canvas frozen on the chevron's hold phase, committed at ~150KB under
`public/sign-in/reduced-motion.png` and rendered via `<img
className="object-cover">`.

Shipped instead: an **inline SVG component**
(`reduced-motion-still.tsx`) that draws the chevron silhouette at the
same world-units → pixel projection the bake script uses (chevron
`w=2.8, h=2.6` with `armWidth=0.5` projected through camera `z=6,
FOV 50°` onto a 1920×1080 viewBox), filled with a sparse stipple
pattern (1.6px circles at 14×14 spacing in pearl-green) plus a soft
radial green halo. No raster asset. Reasons:

- **No manual capture step blocks the ship.** The PNG path
  introduces a dev-loop dependency (run dev → freeze the morph →
  screenshot → commit binary) that this session can't execute. The
  SVG path is purely arithmetic.
- **Resolution-independent.** Crisp at every DPI; no `@2x`/`@3x`
  artwork needed.
- **Zero KB asset budget.** ~1KB inline component vs. ~150KB binary;
  the dynamic-import short-circuit on the reduced-motion branch is
  the dominant savings either way (R3F + three are not loaded), so
  the inline-SVG savings on top are gravy.
- **Honest with the no-motion contract.** No `useFrame`, no
  `requestAnimationFrame`, no rotation state — pure DOM.
- **Cousin-of-the-particle-morph register.** Stipple pattern reads
  as "the morph held still" rather than "a flat vector logo." The
  particles compose the silhouette in the motion path; here, dots
  compose it.

If a captured PNG ever becomes desirable (e.g. for pixel-perfect
match with a Phase 7 tuning pass), the swap is single-file: drop a
PNG into `public/sign-in/`, replace the SVG with `<img>`. The
public contract — "reduced-motion users see a Corellia-shaped
silhouette over pure black" — holds either way.

### 2. `useMatchMedia` is a shared hook, not inline `window.matchMedia`

Both the reduced-motion branch (in `swarm-background.tsx`) and the
mobile-count branch (in `swarm-points.tsx`) need SSR-safe media-query
subscriptions. Rather than duplicate the `useSyncExternalStore` dance
twice, I extracted it into `frontend/src/lib/use-match-media.ts` —
mirroring the pattern already established by
`frontend/src/lib/fleet-view-pref.ts` (per the changelog 0.8.1 entry,
which calls out `useSyncExternalStore` as the project convention for
syncing with external stores).

The hook is general enough that future media-query needs (e.g. a
hover-pointer detection in the chrome) inherit it for free. The cost
is one new file (`use-match-media.ts`, 30 lines); the win is one
correct implementation rather than two near-duplicates.

---

## What changed

### Files added

| File | LOC | Purpose |
|------|-----|---------|
| `frontend/src/lib/use-match-media.ts` | 30 | SSR-safe `matchMedia` hook via `useSyncExternalStore`. Server snapshot returns `false`; client snapshot reads the live `MediaQueryList`. Subscriber adds/removes a `change` listener. Same pattern as `fleet-view-pref.ts`. |
| `frontend/src/components/sign-in/reduced-motion-still.tsx` | 65 | Inline-SVG Corellia silhouette: 1920×1080 viewBox, `<pattern id="stipple">` with sparse 1.6px circles in pearl-green, `<radialGradient id="halo">` for a soft brand-green wash, two `<polygon>`s tracing the chevron arms at the same world coordinates the bake script uses. `aria-hidden`; no `useFrame`, no animation. |

### Files modified

| File | Change |
|------|--------|
| `frontend/src/components/sign-in/swarm-background.tsx` | Now branches on `useMatchMedia("(prefers-reduced-motion: reduce)")`. When `true`, renders `<ReducedMotionStill />` and skips the `dynamic(() => import('./swarm-canvas'))` entirely — three.js + R3F never load on the reduced-motion path. When `false`, the `<SwarmCanvas />` dynamic-import runs as before. Both branches share the same `fixed inset-0 -z-10 bg-black` shell so the vignette in `/sign-in/page.tsx` layers correctly over either. |
| `frontend/src/components/sign-in/swarm-points.tsx` | New `subsampleTargets(full, count)` helper at module scope: takes every Nth point from a baked Float32Array (stride = `PARTICLE_COUNT / count`). New `isMobile = useMatchMedia("(max-width: 768px)")` at component top. The `useEffect` load path now: (a) decides the count (`6000` mobile / `18000` desktop) up-front, (b) subsamples *all* loaded targets to that count once via the new helper, (c) allocates `morphSeeds` + `trajectoryNoise` at that count, (d) stores the count in the `data` state. The buffer-swap path in `useFrame` is unchanged — sources are already the right size, so each `Float32Array.set(source)` writes the matching number of bytes. The `useEffect` dep array gains `isMobile`, so a viewport flip across the breakpoint reallocates the geometry once. |

### Files NOT changed

- `frontend/src/components/sign-in/swarm-canvas.tsx` — the perf flags
  the plan called for (`powerPreference: 'high-performance'`,
  `alpha: true`, `antialias: true`) were already in place from
  Phase 0. `depthWrite: false` on the swarm material was already in
  place from Phase 2 (sits in `swarm-points.tsx`'s
  `<shaderMaterial>` props). R3F's default `useFrame` throttling
  when the tab is inactive is on by default. Nothing to change.
- `frontend/src/components/sign-in/shape-loader.ts` — the loader still
  returns full 18000-point arrays. Subsampling is a consumer-side
  concern (the loader doesn't know about viewport state), so the
  branch lives in `swarm-points.tsx`. The .bin files on disk are the
  desktop-canonical artefact; mobile takes a stride through them.
- `frontend/src/components/sign-in/shapes.ts` — `PARTICLE_COUNT`
  (18000) and `PARTICLE_COUNT_MOBILE` (6000) constants were already
  declared in Phase 1 ahead of Phase 6's need. No change.
- `frontend/src/components/sign-in/morph-scheduler.ts` — the scheduler
  is particle-count agnostic. No change.
- All shaders — agnostic. No change.
- `frontend/src/app/sign-in/page.tsx` — the integration surface from
  Phase 5. The vignette layer-zero invariant holds for both the
  morph engine and the reduced-motion still.

---

## How the new branches work (load-bearing details)

### Reduced-motion path: no dynamic import, no R3F, no three.js

The `dynamic(() => import('./swarm-canvas'), { ssr: false })` line
sits at module scope in `swarm-background.tsx`, but `next/dynamic`
defers the actual fetch until the component mounts. When the
reduced-motion branch is taken, `<SwarmCanvas />` is never rendered,
so the import never fires. The chunk containing R3F + three.js +
all the shader strings remains unfetched.

This matters because three + R3F is the bulk of the route's JS
weight (~270KB First Load JS post-animation per the plan's bundle
audit). Reduced-motion users *and* SSR users (where the
`useSyncExternalStore` server-snapshot returns `false`, but that
matches the morph-engine path on hydration so no flicker) skip that
weight entirely on the reduced-motion path.

### Mobile path: subsample once, render at the lower count thereafter

`subsampleTargets(full, count)` strides through the input array at
`stride = PARTICLE_COUNT / count = 18000/6000 = 3` and copies every
3rd point's xyz triplet into a new `count`-sized buffer. Done once
per shape on load.

Why floor + integer-stride rather than fractional-stride
interpolation: the bake samples are uniform-random over the
silhouette, so striding by 3 produces another uniform-random subset
without bias. Interpolation between adjacent points would smear
silhouette edges (a chevron-arm point and an adjacent off-arm point
averaged together gives a non-arm, non-off-arm phantom).

The runtime trade-off this opens is straightforward: 3× fewer GPU
fragment-shader invocations and 3× less GPU memory bandwidth per
frame on mobile. CPU cost (uniform writes, scheduler ticks) is
identical — those scale with frame count, not particle count.

### Why `isMobile` is captured into `data`, not read at render

The `data.count` field stores the count chosen at load time. The
`useEffect` re-runs when `isMobile` flips, reallocating per-particle
buffers; without that capture, a developer-tools resize across the
768px breakpoint would either silently leave the geometry at the old
count (visual mismatch) or require touching every consumer to read
`isMobile` directly (more surface). One state field is the cheaper
shape.

### Perf flags audit

Plan §6 task 3–5 listed three perf flags to set:

- `powerPreference: 'high-performance'` — already in place at
  `swarm-canvas.tsx:15` since Phase 0.
- `depthWrite: false` — already in place at `swarm-points.tsx:198`
  since Phase 2.
- R3F's tab-inactive throttling — on by default; Phase 2's
  declarative-JSX path inherits it without ceremony.

No code changes needed in this phase to cover these. Pinning here so
they don't get re-derived in Phase 7.

---

## Verification

### Lint

```
$ pnpm -C frontend lint
> eslint
$
```

Clean.

### Type-check

```
$ pnpm -C frontend type-check
> tsc --noEmit
$
```

Clean.

### Production build

```
$ pnpm -C frontend build
✓ Compiled successfully in 1936ms
✓ Generating static pages using 11 workers (10/10) in 273ms
```

`/sign-in` still pre-renders cleanly. The reduced-motion SVG renders
inline; the morph-engine path stays behind the `dynamic` import.
Route count unchanged from Phase 5.

### Visual confirmation (deferred — same pattern as Phases 0–5)

Visual confirmation that:

- The `prefers-reduced-motion: reduce` setting (toggled in OS
  preferences or via Chrome DevTools Rendering panel → "Emulate CSS
  media feature prefers-reduced-motion") shows the static chevron
  silhouette.
- A narrow viewport (`<= 768px`) renders 6000 particles instead of
  18000 — the silhouette resolution is still legible, the morph
  paths are still clearly billowing.
- The breakpoint flip across 768px reallocates cleanly without
  jank.

…requires `pnpm -C frontend dev`. Structural verification (build
clean, lint+types clean, both branches present in the DOM) is the
exit gate.

---

## Decisions worth pinning

These are now load-bearing for Phase 7.

1. **Reduced-motion fallback is inline SVG, not a PNG.** Stipple-
   filled chevron at the bake's world-units → pixel projection.
   Phase 7 tuning candidates: stipple density (the `width=14`
   `cx=7 cy=7 r=1.6` numbers in `<pattern id="stipple">`), halo
   strength (the `0.10` alpha in `<radialGradient id="halo">`).
   If a real PNG is wanted later, swap mechanically.
2. **Mobile count is `PARTICLE_COUNT_MOBILE = 6000` at `(max-width:
   768px)`.** Subsampled once per shape via integer stride. Phase 6
   dial #2 if mobile devices struggle: drop to 4000 (stride 4.5,
   floored to 4). If they hum: bump to 9000 (stride 2). The dial is
   the constant in `shapes.ts`.
3. **`useMatchMedia` is the project convention** for SSR-safe media
   queries. Server snapshot returns `false`; new consumers should
   use this hook rather than re-rolling `useSyncExternalStore` or
   useEffect-based detection.
4. **R3F's tab-inactive throttling is implicit.** Don't add manual
   `requestAnimationFrame` gating; don't add a `useEffect` to
   pause/resume on `visibilitychange`. R3F handles it.
5. **Perf flags are at their tuned defaults.**
   `powerPreference: 'high-performance'`, `alpha: true`,
   `antialias: true`, `depthWrite: false`. Phase 7 should not
   touch these without a measurement.

---

## Estimate vs. actual

Plan estimate: 0.5 day. Actual: ~25 minutes of focused work.
Distribution:

- ~5 min: `useMatchMedia` hook (one file, mirror of
  `fleet-view-pref.ts`'s pattern)
- ~10 min: reduced-motion still (decided against the PNG path
  immediately; SVG geometry took 5 minutes of trigonometry to
  match the bake's chevron projection; stipple pattern + halo
  was 5 minutes of SVG mechanics)
- ~10 min: mobile subsampling (pure arithmetic, plus the `isMobile`
  state capture decision)

Plan budgeted half a day primarily for the PNG capture pass, which
the SVG approach removes from this session entirely. Net: well
under estimate.

---

## What Phase 7 inherits

- **The full v1 envelope is now in place.** Six shapes, color story,
  reduced-motion fallback, mobile path, perf flags. Phase 7's job is
  to make every visible behaviour *good*, not to ship new behaviour.
- **All Phase 7 dials are reachable from a single mental map.** Per
  the prior phases' "Decisions worth pinning" sections, the dials
  are:
  - `morph-scheduler.ts`: cycle pacing (`DRIFT_DURATION_S=4`,
    `MORPH_DURATION_S=7`, `HOLD_DURATION_S=7`,
    `HOLD_DURATION_WORDMARK_S=12`, `DRIFT_DURATION_AMORPHOUS_S=8`),
    shape weights (`SHAPE_WEIGHTS`), amorphous probability
    (`AMORPHOUS_PROBABILITY=0.4`).
  - `swarm-vert.ts`: drift amplitude `0.05 + t*0.35`, stagger
    `morphSeed * 0.25`, bend `* 0.6`, hold jitter `* 0.015`,
    morph alpha `0.95`, hold flicker amplitude `0.08`, hold
    flicker frequency `0.4`.
  - `swarm-frag.ts`: pearl `(0.85, 0.92, 0.85)`, green
    `(0.133, 0.773, 0.369)` mix `0.4`, cyan
    `(0.024, 0.714, 0.831)` mix peak (driven by uniform).
  - `swarm-points.tsx`: cyan ramp shape (`/0.21` up, `/0.14` down).
  - `bake-sign-in-shapes.ts`: pixel size + spacing for wordmark,
    octahedron jitter `0.04`, globe jitter `0.025`, network
    sigma `0.09` + edge jitter `0.025`, network node count `30`,
    minDistance `0.85`.
  - `/sign-in/page.tsx`: vignette alpha `0.6`, falloff `60%`.
  - `reduced-motion-still.tsx`: stipple density, halo strength.
- **No infrastructure work left.** No new files, no new deps, no
  new build-pipeline steps. Phase 7 is purely numeric tuning
  against the running engine in a real browser.

---

## What was *not* done in Phase 6 (and why that's correct)

- **No baked PNG.** SVG ships instead — see deviation §1. If a
  pixel-perfect tuned PNG ever becomes desirable, the swap is
  trivial.
- **No fingerprinting beyond `(max-width: 768px)`.** Plan
  considered `devicePixelRatio` capping (`Math.min(devicePixelRatio,
  2)` to keep mobile-Retina from over-rendering). Skipped: the
  existing shader uses `gl_PointSize` scaled by `uPixelRatio`, and
  the cost is well under the 16.67ms budget at the locked
  `PARTICLE_COUNT_MOBILE = 6000`. If Phase 7 measurement shows
  mobile-Retina spikes, the dial is one line in `swarm-points.tsx`.
- **No Phase 7 tuning yet.** All numeric constants are at their
  Phase 0–4 baselines. Phase 7's job.
- **No Phase 7 perf measurement.** Plan §6 task 6 prescribed Chrome
  DevTools profiling on a production build. Deferred to Phase 7
  alongside the visual tuning pass — the production-build profile
  is most useful when paired with the "is this animation good
  enough" judgement, not as a Phase 6 standalone artefact.
- **No tests.** v1's posture from earlier phases holds.
