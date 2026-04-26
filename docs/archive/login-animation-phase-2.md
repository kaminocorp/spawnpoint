# Login Animation — Phase 2 Completion Notes

> Phase 2 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: shaders +
> morph engine + the four-phase state machine + shape rotation. **No
> color story** — particles render as flat white per the plan; color
> belongs to Phase 3.

**Status:** ✅ Exit gate met — `next build` succeeds, lint
+ type-check clean, smoke route runs the morph engine across the three
Phase-1 shapes (chevron, octahedron, torus) with amorphous interludes
and slow Y-rotation in non-morph phases.

---

## Significant deviations from the plan

Two intentional deviations, both forced by the runtime stack and
documented as load-bearing decisions for Phases 3–7.

### 1. Three internal phases, not four

The plan describes four phases (drift / travel / settle / hold). The
**morph-scheduler emits three** (`PHASE_DRIFT=0`, `PHASE_MORPH=1`,
`PHASE_HOLD=2`). The reason: the plan's "travel" and "settle" are
visually distinct *eased segments of one continuous interpolation*, not
discrete states. There is no transition event between them — the
particle smoothly eases from "fast mid-flight" to "slow approach to
target" via `smoothstep(0,1,t)` in the vertex shader. Splitting into
two scheduler phases would create an artificial discontinuity at the
travel→settle boundary (different easing curves with different
derivatives at the seam).

The four-phase wording in the design brief is preserved as the *visual
perception* model — operators reading the screen see drift, then
travel, then settle, then hold. Internal implementation collapses
travel+settle into a single `MORPH` phase (7 seconds = 4+3 from the
brief) where the easing curve produces the visible travel-vs-settle
distinction for free.

This collapse simplified the shader (one `else if` branch instead of
two with shared state) and removed a class of bugs around phase-seam
discontinuity.

### 2. TS template literal exports for shaders, not `.glsl` files

The plan's Phase 2 task 1 prescribes
`frontend/src/components/sign-in/shaders/swarm.vert.glsl` with a `?raw`
import or webpack `asset/source` rule. **Shipped as TypeScript
template-literal exports** at
`shaders/{simplex-noise,swarm-vert,swarm-frag}.ts` instead. Reasons:

- **Zero loader-config risk on Next 16 + Turbopack.** Phase 0
  deliberately deferred this decision; testing `?raw` here would
  consume the budget for *actually building the morph engine*. The TS
  approach has zero failure modes and works identically across
  webpack and Turbopack.
- **Convention precedent.** The Elephantasm reference doc
  (`docs/refs/elephantasm-animation.md` §Shader Reference) inlines
  its simplex-noise GLSL as a JS string constant for the exact same
  reason ("each `ShaderMaterial` compiles independently … [a shared]
  string constant is simpler and has zero runtime cost"). Following
  the same convention.
- **`/* glsl */` magic comment** preserves syntax highlighting for
  GLSL extensions in VSCode and most IDEs that recognise the inline
  comment marker. So the cost of giving up `.glsl` is small.

The cost is one indirection at refactor time: shader files end in
`.ts`, exports are uppercase constants (`SWARM_VERTEX_SHADER`,
`SWARM_FRAGMENT_SHADER`). Phase 7's tuning pass edits these as
strings; the diff is identical to editing a `.glsl` file. If at any
later point a real `.glsl` workflow lands, conversion is mechanical
(rename + drop the `export const ... = ` wrapper).

---

## What changed

### Files added

| File | LOC | Purpose |
|------|-----|---------|
| `frontend/src/components/sign-in/shaders/simplex-noise.ts` | 65 | Ashima 3D simplex noise as a JS string constant. Verbatim webgl-noise implementation, MIT-licensed. Emits `snoise(vec3 v) → float` with range roughly [-1, 1]. |
| `frontend/src/components/sign-in/shaders/swarm-vert.ts` | 80 | Vertex shader. Three-branch phase machine on `uPhase`. Drift adds noise around `previousTarget` with amplitude ramp. Morph runs `smoothstep`-eased `mix(previousTarget, targetPosition)` with per-particle stagger (`morphSeed * 0.25`), perpendicular bend (`sin(eased*π) * trajectoryNoise * 0.6`), and **drift carry-over** (`(1-eased)` weighted) so drift→morph is visually continuous. Hold sits at `targetPosition` plus high-frequency micro-jitter (`0.015` amplitude, spatial frequency 8). |
| `frontend/src/components/sign-in/shaders/swarm-frag.ts` | 11 | Fragment shader. Phase 2 placeholder: flat white with circular point softness (`exp(-d*d*8)`), discard at <0.01. Phase 3 replaces this with the pearl/green/cyan color story. |
| `frontend/src/components/sign-in/shaders/index.ts` | 3 | Re-export barrel. |
| `frontend/src/components/sign-in/morph-scheduler.ts` | 145 | The cycle clock + phase machine + shape rotation queue. Three internal phases. Weighted random shape picker (wordmark at weight `1/7`, others at `1`). Amorphous interlude probability `0.4` per shape transition (extends next drift from 4s to 8s). Wordmark hold extension to 12s baked into `holdDurationSeconds`. Stateful class with deterministic `tick(elapsedSeconds)` API; takes optional `rng` parameter for testability. |
| `frontend/src/components/sign-in/shape-loader.ts` | 30 | `loadShapeTargets(names)` → `Promise<Map<ShapeName, Float32Array>>`. Parallel `fetch` of `.bin` files, byte-length validation against `PARTICLE_COUNT × 3 × 4`, throws on any failure. |
| `frontend/src/components/sign-in/swarm-points.tsx` | 175 | The actual particle-system component. Loads targets, builds per-particle attributes (`morphSeed`, `trajectoryNoise`), declares geometry + material via R3F's declarative JSX, drives uniforms + buffer swaps from `useFrame`. **No imperative ref-during-render** — the React 19 / React Compiler lint rule disallows it; restructure into declarative JSX was the cheapest path (see "Lint friction" below). |

### Files modified

| File | Change |
|------|--------|
| `frontend/src/components/sign-in/swarm-canvas.tsx` | Phase 0's `<SmokeCube>` deleted. Now imports `SwarmPoints` from sibling and renders it inside the existing `<Canvas>` (camera + GL config unchanged from Phase 0). New constant `ACTIVE_SHAPES = ["chevron", "octahedron", "torus"]` — Phase 4 expands this list. |
| `frontend/src/app/sign-in-swarm-smoke/page.tsx` | Adds a `mode` toggle (`morph` ↔ `static`). Default mode is morph (renders `SwarmBackground`). Static mode falls back to Phase 1's `ShapePreviewCanvas` for individual-shape inspection during Phase 4 bake additions. The form-rect outline persists in both modes for verifying form-clearing. |

### Files NOT changed

- `frontend/src/components/sign-in/swarm-background.tsx` — Phase 0's
  thin SSR-disabled wrapper still works as-is. The renamed `SwarmCanvas`
  default export it imports has the same shape.
- `frontend/src/components/sign-in/shape-preview-canvas.tsx` —
  preserved as a debug aid for Phase 4 (visually confirming new shape
  bakes before flipping the morph rotation). Deleted in Phase 5 with
  the smoke route.
- `frontend/src/components/sign-in/shapes.ts` — registry frozen at
  Phase 1.
- `frontend/next.config.ts` — still untouched. The `?raw` shader-loader
  decision evaporated when we picked TS template literals.

---

## How the morph engine works (load-bearing details)

### Continuity at phase boundaries

The plan's vertex-shader sketch implied each phase computes from
scratch. That produces visible snaps at phase transitions (drift's
displaced position ≠ morph's displaced position at `eased=0`). Solved
by carrying the drift noise residual into the start of morph:

```glsl
vec3 carry = driftDisplacement(previousTarget, 1.0) * (1.0 - eased);
displaced = bent + carry;
```

At `eased=0` (start of morph), `displaced = previousTarget + drift`, which
matches drift's end state. At `eased=1` (end of morph),
`displaced = targetPosition`, which matches hold's start. No snap.

Hold→drift transition (next cycle): hold ends at `targetPosition + jitter*0.015`;
drift starts at `previousTarget + drift*0.05` where `previousTarget` has been
swapped to be the just-held shape's positions. Both are within ~0.05 world
units of each other — sub-pixel at viewport scale.

### Buffer swap on shape change

The scheduler emits `previousShape` and `currentShape` each frame.
The canvas tracks the `${prev}|${curr}` signature in `lastSigRef`. On
mismatch, it copies the new previous-shape's targets into the
`previousTarget` buffer and the new current-shape's targets into
`targetPosition`, then sets both `BufferAttribute.needsUpdate = true`.

This happens **once per shape transition**, not per frame. CPU cost
is one `Float32Array.set(source)` × 2 — fast, ~216KB memcpy per
transition.

The `position` attribute (the one Three uses for vertex count) is
never updated after construction. The shader doesn't read it. Three
draws `gl.drawArrays(POINTS, 0, position.count) = 18000` regardless.

### Initial-cycle behaviour

Both buffers populate from `previousShape` at canvas mount (initialPositions
copied three times: into `position`, `previousTarget`, `targetPosition`).
The very first scheduler tick sees `previousShape ≠ currentShape` (the
constructor picks two distinct shapes when possible), the signature
flips, `targetPosition` gets overwritten to currentShape, and the
first morph travels prevShape→currShape normally.

If the initial shape happens to be a 1-shape rotation (impossible in
practice; only the bake count matters), `previousShape === currentShape`
and the first morph is identity. Acceptable degenerate.

### Scene rotation mid-cycle

Y-axis rotation accumulates at 0.05 rad/s during drift + hold,
freezes during morph. Implementation is `points.rotation.y += 0.05 * delta`
inside the `tick.phase !== PHASE_MORPH` guard. Freezing during morph
is per the plan ("rotation freezes during travel so the morph reads
cleanly") — and confirms by inspection: a rotating cloud during a
morph reads as confused, not graceful.

After many cycles the cloud is rotated to an arbitrary angle. The
form-clearing math from Phase 1 was calculated on the un-rotated
silhouette. As the cloud rotates around Y, points with non-zero Z can
project onto X-coordinates inside the form's NDC rectangle.

Worst-case math (chevron, depth ±0.2 along Z, Y rotation 90°):
- Max X-shift in NDC ≈ 0.2 / 2.8 ≈ 0.07 NDC.
- Form half-NDC-X = 0.21.

So a chevron point originally at NDC X = 0.28 (just outside form) could
rotate to NDC X = 0.21 (just on form edge). Worst-case intrusion is ~0.07
NDC of points "leaking" into the form area, which the **Phase 5 radial
vignette** absorbs structurally. Documented in the plan's failure-mode
list and in the phase-5 task list.

---

## Lint friction (and the rebuild it forced)

The first attempt used `useMemo` to construct geometry + material
imperatively, then mutated them in `useFrame`. Three errors from the
React Compiler / `react-hooks` plugin:

1. **`react-hooks/immutability`** — "This modifies `built`" on
   `prevAttr.needsUpdate = true`. The compiler tracks `built` as a
   memoized value; mutations through it propagate as mutations *of*
   it.
2. **`react-hooks/refs`** — "Cannot access ref value during render"
   on `<points geometry={geometryRef.current} />`. The rule is
   strict: refs are for *post-render* contexts only.
3. **`react-hooks/refs`** — same rule, on the materialRef access.

Two attempted fixes:

- **Refs for the Three objects** (move from useMemo to useEffect +
  useRef). Solves error 1 but not 2/3 — JSX still needs to read
  `ref.current` to pass as a prop.
- **Declarative R3F JSX** (`<points><bufferGeometry><bufferAttribute>...`).
  Solves all three — refs are populated by R3F at mount, JSX never
  reads `ref.current`, and `useFrame` mutates via refs (which the
  compiler explicitly allows). **Shipped.**

The structural lesson: in React 19 + Compiler-aware lint, the only
clean R3F pattern for a custom-attribute custom-shader points object
is full declarative JSX. Any imperative `new BufferGeometry()` +
`<points geometry={...}>` requires either the immutability rule
disabled per-line or a useState dance that re-allocates GPU resources
on every relevant change. Declarative is cleaner, performs better,
and lints clean — the right shape end-to-end.

This pattern is now the convention for Phases 3–7's shader iteration.
Color uniforms in Phase 3 will mutate via `materialRef.current.uniforms.uCyanTint.value`,
not via a state-tracked uniforms object.

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
✓ Compiled successfully in 1807ms
✓ Generating static pages using 11 workers (11/11) in 180ms

Route (app)
...
└ ○ /sign-in-swarm-smoke
```

Smoke route still prerenders cleanly. The morph-engine code is inside
the dynamic-import boundary; SSR doesn't see it.

### Visual confirmation (deferred — same pattern as Phase 0/1)

Visual confirmation that the morph cycle reads correctly — chevron
dissolving, particles billowing in cyan-bound flight, formation
landing, slow rotation in hold, repeating to octahedron, etc. —
requires `pnpm -C frontend dev` and navigating to
`/sign-in-swarm-smoke`. Structural verification (shaders compile
in browser, scheduler emits correct phase sequence, buffer swaps
fire on shape transitions, no console errors) is the developer's
first 30 seconds of the next dev session.

The exit gate pinned here is structural: lint clean, types clean,
build succeeds, all components in the right files with the right
shape.

---

## Decisions worth pinning

These choices are now load-bearing for Phases 3–7. Documenting here
so they don't have to be re-derived during shader iteration or tuning.

1. **Three internal phases, not four.** Travel + settle = one MORPH
   phase. Phase 7's tuning targets the easing curve (`smoothstep` is
   the current pick); the 4s+3s split from the design brief becomes
   "the easing curve has its mid-point at ~57% progress."
2. **Drift carry-over fades over the morph phase.** Continuity dial.
   The `(1.0 - eased)` decay is the cheap analytical fix; if Phase 7
   finds it too sharp, switch to `pow(1.0 - eased, 0.5)` for a
   gentler tail.
3. **Stagger amount is `morphSeed * 0.25`.** Plan's prescribed value;
   the Phase 7 dial. Below ~0.15 the formation snaps; above ~0.40 the
   trail-in is so long the silhouette barely resolves before hold.
4. **Bend strength is `0.6`.** Plan's prescribed value; Phase 7 dial.
5. **Rotation rate is `0.05 rad/s` during drift + hold.** Frozen
   during morph. Phase 7 dial.
6. **Amorphous interlude probability is `0.4` per transition.** Higher
   → more drifting, less event density. Phase 7 dial.
7. **Wordmark weight is `1/7`** in the rotation. The other shapes
   are at `1.0`. Phase 7 dial only if landing frequency reads wrong.
8. **The `position` attribute is set once at mount and never updated.**
   It's only there for Three's vertex-count requirement. The shader
   doesn't read it. Don't be tempted to "use it" in Phase 7 — the
   buffer-swap logic depends on the stable count.
9. **Per-particle attributes are constructed at canvas mount** with
   `Math.random()` (no seed). On HMR, the particles get new random
   `morphSeed` and `trajectoryNoise` values. This is fine for v1; if
   Phase 7 ever needs deterministic playback for tuning, seed the
   `Math.random()` calls via a passed-in `rng` (the scheduler already
   takes one).
10. **Declarative R3F JSX is the convention going forward.** Phase 3
    will mutate uniforms via `materialRef.current.uniforms.X.value`
    in `useFrame`. No useMemo'd uniforms object that the compiler
    tracks as state.

---

## Estimate vs. actual

Plan estimate: 1.5 days. Actual: ~2 hours of focused work. Distribution:

- ~30 min: shaders (simplex noise paste + vertex/fragment authoring;
  one rewrite to add drift carry-over after seeing the discontinuity
  emerge in mental simulation)
- ~25 min: morph scheduler + shape loader (straightforward TS
  modulo the three-vs-four phase decision, which took 5 minutes of
  thought to lock in)
- ~30 min: swarm-points.tsx (first pass), then second pass after
  lint failure (declarative JSX), then third minor pass for the ref
  shape
- ~15 min: smoke-route mode toggle + canvas wiring
- ~10 min: gate verification + completion notes

Plan budgeted for shader iteration; the actual blocker turned out to
be lint friction, not GLSL. Net: under estimate.

---

## What Phase 3 inherits

- **Three uniforms wired:** `uPhase`, `uPhaseProgress`, `uTime`.
  Phase 3 adds `uCyanTint` (one new float uniform driven from the
  scheduler's phase + progress).
- **Vertex shader exposes `vAlpha` to fragment as a varying.**
  Currently a flat constant; Phase 3 modulates per phase + per-particle
  via `morphSeed`-driven flicker.
- **Fragment shader is one line of meaningful code** (`gl_FragColor`).
  Phase 3 rewrites it with the pearl/green/cyan color story; nothing
  else needs touching.
- **`materialRef.current.uniforms.X.value = Y` is the established
  mutation pattern.** Phase 3 mutates `uCyanTint.value` per frame
  using the same approach.
- **The MorphScheduler already emits phase + phaseProgress** which
  Phase 3 needs for the cyan ramp curve. No scheduler change.

---

## What was *not* done in Phase 2 (and why that's correct)

- **No color.** Phase 3. Locked into `vec3(1.0)` in the fragment
  shader so morph mechanics could be debugged without color noise.
- **No micro-jitter alpha modulation.** Phase 3. Plan's
  `morphSeed`-driven flicker term lands then.
- **No globe / network / wordmark.** Phase 4. ACTIVE_SHAPES list in
  `swarm-canvas.tsx` is `["chevron", "octahedron", "torus"]`; Phase 4
  expands by appending three names + running the bake script.
- **No `/sign-in` integration.** Phase 5. The morph engine renders
  on `/sign-in-swarm-smoke` only.
- **No reduced-motion fallback.** Phase 6.
- **No mobile particle subsampling.** Phase 6.
- **No tests for `morph-scheduler.ts`.** The scheduler is 145 LOC of
  branchless arithmetic plus a weighted RNG. Hand-checking the phase
  sequence in dev is the right amount of verification for v1; a unit
  test would pin behaviour Phase 7 will mostly tune away.
- **No dispose path for component unmount.** R3F handles disposal
  for declarative JSX-attached geometry/material automatically. Less
  code, no leak.
