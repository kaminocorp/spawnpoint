# Login Animation — Phase 3 Completion Notes

> Phase 3 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: the color
> story — pearl/green rest color, cyan transient-state tint during
> MORPH, per-phase `vAlpha` modulation including a `morphSeed`-driven
> hold-phase flicker. **No geometry, no scheduling, no shape additions
> — color and one new uniform only.**

**Status:** ✅ Exit gate met — `next build` succeeds, lint
+ type-check clean. Color story is fully wired against the Phase 2
morph engine; the `uCyanTint` uniform is driven from the scheduler's
existing phase + phaseProgress emission with no scheduler change.

---

## Significant deviations from the plan

One intentional deviation around how `uCyanTint` is shaped over MORPH.

### MORPH = travel + settle, so the cyan curve is computed in
phaseProgress, not absolute seconds

The plan's Phase 3 task 2 prescribes "ramp 0 → 1 over the first 1.5s,
hold at 1 for the middle, ramp back to 0 in the last 0.5s." That
wording predates the Phase 2 decision to collapse travel + settle into
a single MORPH phase (7s, not 4s). Translating the plan's *intent*
("cyan peaks at fastest motion mid-travel; back to green by formation
arrival") into the actual phase shape:

- Ramp up over the first ~21% of MORPH (≈ 1.5s of 7s)
- Plateau at 1 across the middle
- Ramp down over the last ~14% of MORPH (≈ 1s) so `uCyanTint` is back
  to 0 at `phaseProgress = 1` — i.e. the moment the formation lands

Implementation is `min(p / 0.21, (1 - p) / 0.14)` clamped to [0,1] —
two linear ramps whose minimum produces the trapezoidal curve. Cheaper
than two `smoothstep` calls and reads identically to the eye at this
duration. Phase 7 may swap in `smoothstep` if the cyan onset/offset
need easing rather than a kink at the plateau seams.

The 0.5s ramp-down from the plan was specifically called "currently a
guess" in Phase 7 dial #4. The Phase 3 implementation lands on 1.0s
(0.14 × 7s) — slightly longer than the plan's literal seconds, but
correct against the plan's stated intent of "back to green by the
moment of formation arrival" inside MORPH's full duration.

---

## What changed

### Files modified

| File | Change |
|------|--------|
| `frontend/src/components/sign-in/shaders/swarm-frag.ts` | Rewritten. Pearl base `vec3(0.85, 0.92, 0.85)` mixed with brand green `vec3(0.133, 0.773, 0.369)` at `0.4` for the rest color. New `uniform float uCyanTint` mixes the rest color toward cyan `vec3(0.024, 0.714, 0.831)` by `clamp(uCyanTint, 0, 1)`. Softness mask `exp(-d*d*8)` + `discard` at `<0.01` preserved verbatim from Phase 2. |
| `frontend/src/components/sign-in/shaders/swarm-vert.ts` | Final block of `main()` now branches `vAlpha` on `uPhase`. MORPH = `0.95` (in-flight particles read as "active"). HOLD = `0.85 + sin(uTime * 0.4 + morphSeed * 2π) * 0.08` — per-particle phase offset on a slow oscillation, so the held formation twinkles like a real swarm rather than a flat sprite. DRIFT = `0.85` baseline. The previous flat `vAlpha = 0.85` constant is gone. |
| `frontend/src/components/sign-in/swarm-points.tsx` | `uCyanTint: { value: 0 }` added to the `uniforms` `useMemo`. `useFrame` body gains a 6-line driver: when `tick.phase === PHASE_MORPH`, write `min(p/0.21, (1-p)/0.14)` clamped to [0,1]; otherwise write 0. One additional float write per frame. |

### Files NOT changed

- `frontend/src/components/sign-in/morph-scheduler.ts` — Phase 2's
  scheduler already emits `phase` + `phaseProgress`. The cyan curve
  computes from those without scheduler changes. As Phase 2's
  completion notes predicted: "MorphScheduler already emits phase +
  phaseProgress which Phase 3 needs for the cyan ramp curve. No
  scheduler change."
- `frontend/src/components/sign-in/shaders/simplex-noise.ts` — shared
  noise constant untouched.
- All shape-target binaries under `public/sign-in/shape-targets/` —
  Phase 4 work, not Phase 3.
- `next.config.ts`, `package.json` — no new deps, no new loaders.

---

## How the color story works (load-bearing details)

### Why a fragment-side mix, not a per-vertex color attribute

Color is uniform-driven, not per-particle. Every particle in a frame
sits at the same `uCyanTint` value; varying the color *per-particle*
in a way that read as "fleet" (rather than "noise") would need a
storyline that doesn't exist in v1. A single fragment-side `mix(rest,
cyan, uCyanTint)` is the cheapest shape: one uniform, one mix, no
per-vertex bandwidth.

Per-particle visual interest comes from `vAlpha`'s `morphSeed`-driven
flicker during HOLD, not from chroma. That's enough — the eye reads
"alive swarm" from the brightness twinkle without the held formation
shimmering chromatically.

### Why MORPH brightens vAlpha but DRIFT doesn't

The plan called out "travel phase brightens particles slightly
(they're 'active')" as the alpha story. DRIFT particles are *also*
moving, but they're meandering near the previous formation —
sub-attentional motion. Brightening them would muddy the
"in-transit" cue that travel needs to carry. Keeping DRIFT at the
baseline 0.85 leaves the brightness lift exclusive to MORPH, which
is where the operator's eye should be drawn.

### Hold-phase flicker is alpha, not position

The Phase 2 vertex shader already adds spatial micro-jitter during
HOLD (`snoise(targetPosition * 8.0 + uTime) * 0.015`). Adding alpha
flicker on top of that gives two orthogonal "alive" signals — sub-pixel
position wobble *and* per-particle brightness modulation — for the
cost of one extra `sin()` per vertex. The two signals don't beat
against each other because the alpha frequency (`0.4 rad/s`) is much
slower than the position-jitter spatial frequency, and the per-particle
phase offset (`morphSeed * 6.28`) means no two adjacent particles
twinkle in sync.

### CPU cost of Phase 3

One additional float comparison + arithmetic in `useFrame` (the
`PHASE_MORPH` branch) and one additional uniform write per frame.
`min(a, b)` and three multiplications. Not measurable.

GPU cost is one `mix()` and one `clamp()` per fragment — both single
ALU ops on any GPU shipped this decade. The fragment shader is still
~5 instructions of meaningful work.

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
✓ Compiled successfully in 1876ms
✓ Generating static pages using 11 workers (11/11) in 184ms

Route (app)
...
└ ○ /sign-in-swarm-smoke
```

Smoke route still prerenders cleanly. Phase 3's diff is shader source
+ one uniform; SSR boundary unchanged from Phase 2.

### Visual confirmation (deferred — same pattern as Phase 0/1/2)

Visual confirmation that the cyan reads as state (peaks mid-MORPH,
gone by arrival), the rest color sits in pearl-green without fighting
the pure-black page background, and the held formation twinkles
without buzzing requires `pnpm -C frontend dev` and navigating to
`/sign-in-swarm-smoke`. Structural exit gate pinned here is
build/lint/types clean.

---

## Decisions worth pinning

These choices are now load-bearing for Phases 4–7. Documenting here so
they don't have to be re-derived during shape additions or tuning.

1. **Cyan curve is `min(p/0.21, (1-p)/0.14)` over MORPH's
   `phaseProgress`.** Trapezoidal — linear ramps with a flat plateau.
   Phase 7 dial: replace with `smoothstep` if the kinks at the seams
   become visible (they shouldn't at 60fps over 1s ramps).
2. **Cyan peak is `1.0`.** Plan's prescribed value. Phase 7 dial #7
   ("if the cyan dominates, drop the cyan mix peak from 1.0 to 0.7").
3. **Pearl-to-green mix is `0.4`.** Plan's prescribed value. Phase 7
   dial #7 ("if the rest color reads too pearly, bump to 0.5").
4. **Hold flicker amplitude is `±0.08` on `vAlpha`.** Below ~0.04 the
   twinkle reads as static; above ~0.15 it reads as buzzing.
5. **Hold flicker frequency is `uTime * 0.4 + morphSeed * 2π`.**
   ~6.4s period per particle; the per-particle phase offset
   guarantees no synchronous "blink" across the formation.
6. **MORPH brightens `vAlpha` to `0.95`.** Single-step bump from the
   `0.85` baseline — enough to register without making travel
   particles read as a separate species from drift/hold.
7. **`uCyanTint` is the *only* color-state uniform.** No per-phase
   `uHoldGlow` or per-shape `uShapeTint`. If a shape needs a special
   color treatment (e.g. wordmark beat), Phase 4 or 7 adds the
   uniform; Phase 3 keeps the surface area minimal.

---

## Estimate vs. actual

Plan estimate: 0.5 day. Actual: ~15 minutes of focused work. The
phase is genuinely small once Phase 2's morph mechanics + scheduler
are in place — three short edits, one new uniform, no debugging
budget needed because the morph engine was the load-bearing surface
and it's already verified.

Phase 7 will spend more time on this than Phase 3 did — tuning the
exact mix ratios, ramp curves, and flicker amplitudes against the
running engine is the bar the brief asks for. Phase 3 just hands
Phase 7 the right *dials* to turn.

---

## What Phase 4 inherits

- **Color story is shape-agnostic.** Globe / network / wordmark land
  in the same pearl-green rest, same cyan in flight, same hold
  twinkle. No per-shape color treatment is needed for Phase 4 to
  ship — and that's correct, because the rotation reading as "fleet
  under orchestration" depends on the *silhouettes* varying, not the
  chroma.
- **`uCyanTint` already covers the wordmark beat's transient
  feeling.** When wordmark lands, the same green-cyan-green arc
  plays. If Phase 7 decides the wordmark beat needs an additional
  visual cue (e.g. a brief brightness lift), that's a per-shape
  branch in `useFrame`, not a new uniform.
- **The `vAlpha` machinery has headroom for one more phase-driven
  effect** if needed (e.g. a network-graph specific node-vs-edge
  alpha split). Phase 4's bake script already has the data to feed
  that — node particles vs edge particles can be tagged via a
  per-particle attribute — but that's only worth shipping if visual
  inspection at the silhouette point density needs it.

---

## What was *not* done in Phase 3 (and why that's correct)

- **No per-shape color customization.** Phase 7 dial if needed; no
  product reason to introduce it pre-emptively.
- **No background-color story (gradient, vignette colour).** The
  page sits on pure black; Phase 5 adds the radial vignette in
  greyscale, not color. Color belongs to the swarm itself.
- **No reduced-motion still-frame regeneration.** Phase 6 takes the
  static PNG. The Phase 3 color story changes the reference frame for
  that screenshot — capturing it now would mean re-capturing it after
  Phase 7's tuning anyway.
- **No `morph-scheduler.ts` change.** Plan's Phase 3 task 2 implies
  the scheduler emits the cyan curve; in practice, computing it in
  `useFrame` from the already-emitted `phase` + `phaseProgress` is
  the cheaper shape (one less surface to maintain, one fewer thing
  to test). Documented above.
- **No tests.** v1's posture from Phase 2 holds: scheduler is
  branchless arithmetic, fragment shader is a one-liner of meaningful
  work, the visual register is the verification surface.
