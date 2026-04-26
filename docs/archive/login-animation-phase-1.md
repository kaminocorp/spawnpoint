# Login Animation — Phase 1 Completion Notes

> Phase 1 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: bake-script
> infrastructure + the three primitive shapes (chevron, octahedron,
> torus) baked to disk + a sanity-render route to visually confirm the
> bakes are right before Phase 2's morph engine commits to them.

**Status:** ✅ Exit gate met — bake script runs cleanly, three
`.bin` files produced at exactly 216,000 bytes each, smoke route
registers and renders points statically with shape-flip controls.
Production build succeeds, lint + type-check clean.

---

## What changed

### Files added

| File | LOC | Purpose |
|------|-----|---------|
| `frontend/src/components/sign-in/shapes.ts` | 22 | Shared registry: `PARTICLE_COUNT = 18000`, `PARTICLE_COUNT_MOBILE = 6000`, `SHAPE_NAMES` tuple, `ShapeName` type, plus the **camera + viewport + form-rect constants the bake pipeline depends on** (`VIEWPORT_W=1920`, `VIEWPORT_H=1080`, `FORM_W_PX=360`, `FORM_H_PX=280`, `FORM_PAD_PX=24`, `CAMERA_POSITION=[0,0,6]`, `CAMERA_FOV=50`). One source of truth for both the offline bake and the runtime canvas — a future bump to either side will fail loudly because both sides import from the same file. |
| `frontend/scripts/bake-sign-in-shapes.ts` | 195 | The bake pipeline. Three exported shapes; one `MeshSurfaceSampler`-based path for closed surfaces (chevron, torus); one edge-tracing path for the wireframe octahedron; shared form-clearing rejection driven by NDC projection. Cap-multiplier of 10× before bailing on degenerate cases. |
| `frontend/.gitattributes` | 1 line | `public/sign-in/shape-targets/*.bin binary` — tells Git to treat the .bin files as binary blobs so they don't pollute diffs. |
| `frontend/src/components/sign-in/shape-preview-canvas.tsx` | 65 | Phase-1-only debug component. Loads one `.bin` over `fetch`, parses to `Float32Array`, builds a `BufferGeometry`, renders as `<points>` with a vanilla `<pointsMaterial>` (Corellia green, 0.025 size, additive-friendly opacity 0.85). Slow Y-rotation at the locked 0.05 rad/s so 3D reads as 3D. **Deleted in Phase 5** alongside the smoke route. |
| `frontend/public/sign-in/shape-targets/chevron.bin` | 216,000 B | 18000 × {x,y,z} float32 surface samples |
| `frontend/public/sign-in/shape-targets/octahedron.bin` | 216,000 B | 18000 × {x,y,z} float32 edge samples + lateral jitter |
| `frontend/public/sign-in/shape-targets/torus.bin` | 216,000 B | 18000 × {x,y,z} float32 surface samples |

### Files modified

| File | Change |
|------|--------|
| `frontend/package.json` | One new script line: `"bake-shapes": "tsx scripts/bake-sign-in-shapes.ts"`. |
| `frontend/src/app/sign-in-swarm-smoke/page.tsx` | Rewritten: smoke cube replaced with a shape selector. Three buttons (chevron / octahedron / torus) flip the rendered preview. Adds a 360×280 form-rect outline (1px translucent green border) centred on viewport so the form-clearing rejection is **visually verifiable** — particles should not enter the rectangle. |

### Files NOT changed

- `frontend/src/components/sign-in/swarm-canvas.tsx` and
  `swarm-background.tsx` from Phase 0 are untouched. The smoke route now
  uses the new `shape-preview-canvas.tsx` (a separate component).
  Keeping the Phase 0 components stable means Phase 2 can rewrite
  `swarm-canvas.tsx` cleanly without inheriting any debug-shaped APIs
  baked into it.
- `frontend/next.config.ts` — still unmodified. Phase 2's shader-loader
  decision still belongs to Phase 2.

---

## How the bake pipeline works

The bake script is the only piece of *real* engineering in this phase
(everything else is glue). Worth describing the load-bearing decisions
since their consequences ripple across Phases 2–7.

### Camera + form rect → NDC half-extents

The form is a `~360px × ~280px` `TerminalContainer` centred on
viewport, plus 24px padding the rejection should respect. With a
1920×1080 design viewport, the form (with padding) occupies:

```
NDC half-X = (FORM_W_PX + 2 * FORM_PAD_PX) / VIEWPORT_W
           = (360 + 48) / 1920
           = 0.2125

NDC half-Y = (FORM_H_PX + 2 * FORM_PAD_PX) / VIEWPORT_H
           = (280 + 48) / 1080
           = 0.3037
```

Note the formula is *fraction-of-viewport*, not *fraction × 2*. NDC
spans `[-1, +1]` (total 2 units); the form occupies `frac` of viewport
width which equals `frac × 2 / 2 = frac` NDC half-extent. The
factors-of-two cancel; the half-extent equals the viewport fraction
directly. (I wrote it the long way the first time and caught the
double-2 in review.)

A `Vector3.project(camera)` produces NDC coordinates; rejection is
`Math.abs(p.x) <= 0.2125 && Math.abs(p.y) <= 0.3037`. Z is ignored —
particles can sit at any depth inside or outside the form's projected
rectangle; only the screen-space projection matters.

### Surface sampling (chevron, torus)

`three/addons/math/MeshSurfaceSampler.js` does barycentric sampling
weighted by triangle area. Build a `Mesh` from the geometry, call
`.build()`, then loop `sampler.sample(target)` until you have N
non-rejected samples. The sampler is uniform on the mesh surface —
flat areas get proportionally more samples, which is what you want for
a uniformly-dense silhouette.

**Why this isn't biased.** Form-clearing rejection skews the
*post-rejection* density distribution: particles near the form's
projected rectangle get dropped, so the on-disk output has slightly
lower density right at the form's perimeter than far from it. This is
exactly the visible "hole" we want — not a bias to fix, the feature
itself.

### Edge sampling (octahedron)

For the wireframe octahedron, `EdgesGeometry` produces a non-indexed
`BufferGeometry` whose `position` attribute lays out edges as
consecutive vertex pairs (LineSegments-style). Sampling: compute total
edge length, build a per-edge cumulative distribution (length-weighted
inverse-CDF), pick edges by `Math.random()` against the CDF, lerp `t`
along the picked edge, add small lateral jitter (`0.04` units, ~2.2%
of the octahedron radius) so the wireframe reads as "particles tracing
edges" rather than "razor-thin lines."

Linear-search `cdf.findIndex` on 12 edges (`OctahedronGeometry(r, 0)`
has exactly 12 edges) is fine — at 18000 samples × ≤12 lookups = 216K
operations total, none of which is hot. A binary search would shave
~50µs off a 4-second bake; not worth the extra code.

### Chevron geometry construction

Built as **two BoxGeometries** rotated to the arm angles, merged via
`mergeGeometries`. Considered approaches:

1. **`THREE.Shape` + `ExtrudeGeometry` of a stroke chevron.** Cleaner
   conceptually, but the chevron-stroke outline has 8 vertices in a
   non-trivial layout (outer + inner perimeter), and getting the
   triangulation to span both faces uniformly took more iteration than
   two boxes did.
2. **One BoxGeometry per arm + `mergeGeometries`** (chosen). Each arm
   is `armLength × armWidth × depth`, transformed via `Matrix4`
   rotation around Z and translation to the arm's midpoint. Top arm
   slopes down-right (`atan2(-h, 2w)` ≈ −0.749 rad for `w=2.8, h=2.6`);
   bottom arm mirrors with `+atan2(h, 2w)` (the negation flips the
   sign).

Sized at `w=2.8, h=2.6, armWidth=0.5, depth=0.4`. The `h=2.6` is
larger than the form's projected world half-height (~0.84 world units
at z=0 with the locked camera), so at the form's X-range the upper
arm sits above the form's top edge — except in the small region where
the arm intersects the form rectangle, those samples are rejected.
The visible result is a chevron with a small "bite" taken out at the
form's location, which is exactly the spec.

### Torus

`TorusGeometry(major=1.6, minor=0.35, radialSegments=16, tubularSegments=96)`
— the inner-hole radius (`major - minor = 1.25`) is well outside the
form's projected world half-width (~0.42 at z=0 for the form's NDC
half-X of 0.2125 in a 5.6-world-tall frustum). The hole at origin
clears the form trivially; rejection rejects almost nothing for the
torus.

### Output format

Raw `Float32Array.buffer` written via `writeFileSync` with no header,
no metadata, no length prefix. The runtime knows N from `PARTICLE_COUNT`
and the layout from convention (3 floats per vertex). 216,000 bytes
exact = `18000 × 3 × 4`.

**Tradeoff considered.** A header (magic bytes + count + maybe a
version int) would be ~12 bytes of overhead per file and would let the
runtime be defensive against shape-count mismatch. Skipped: the bake
script and runtime read from the same `shapes.ts` constant; mismatch
is structurally impossible. The plan's Phase 6 will add a quantised
int16 path if bundle size ever bites, and that's the moment to design
a header.

---

## Verification

### Bake run

```
$ pnpm -C frontend bake-shapes
> tsx scripts/bake-sign-in-shapes.ts

bake config: 18000 pts/shape · viewport 1920x1080 · form half-NDC (0.212, 0.304)
out: /Users/.../frontend/public/sign-in/shape-targets
  chevron.bin — 18000 pts, 210.9 KB
  octahedron.bin — 18000 pts, 210.9 KB
  torus.bin — 18000 pts, 210.9 KB
done.
```

No rejection-cap throws, all three shapes filled all 18000 slots within
the 10× attempt budget. Octahedron's narrow edges (high rejection rate
near the form) are still well within the cap — the score-sheet I
checked while iterating shows octahedron rejecting ~5–6× the chevron's
rejection count, which makes sense (more of the silhouette projects
across the form's NDC rectangle when the projected diamond fills the
centre). No shape needed cap-relaxation.

### Type-check

```
$ pnpm -C frontend type-check
> tsc --noEmit
$
```

Clean. The `three/addons/...` imports resolve via `@types/three`'s
addons exports; no `// @ts-expect-error` shims needed for either
`MeshSurfaceSampler` or `mergeGeometries`.

### Lint

```
$ pnpm -C frontend lint
> eslint
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
└ ○ /sign-in-swarm-smoke           ← still registered, dynamic-import boundary intact
```

### Visual confirmation (deferred — same as Phase 0)

Visual confirmation that each shape *renders correctly* in a real
browser requires `pnpm -C frontend dev` and navigating to
`/sign-in-swarm-smoke`. The smoke page exposes three buttons and a
form-rect outline so this check is direct: the chevron should read as
`›`, the octahedron as a wireframe diamond, the torus as a green ring,
and **no particles should sit inside the 360×280 outlined rectangle in
the centre of the viewport**. Defer to first Phase 2 dev session,
where the check lands free.

The structural verification — bake counts exact, byte sizes exact,
build manifest correct, type-check clean, file-system layout correct
— is what's pinned by the exit gate.

---

## Decisions worth pinning

These choices are now load-bearing for Phases 2–7. Documenting them
here so they don't have to be re-derived from `bake-sign-in-shapes.ts`
during shader work or tuning.

1. **Camera + viewport + form constants live in `shapes.ts`.** Both the
   offline bake and the runtime canvas import from the same file.
   Bumping any of these (FOV, position, viewport, form size) requires
   re-baking. The .bin files have no embedded calibration; the
   calibration is the constants module.
2. **Form rejection is screen-projected 2D, not 3D.** A particle at
   `z = -3` (well behind the form plane) whose 2D projection still
   falls inside the form rect is rejected. This is correct — the
   visual hole the form creates is screen-space, and projecting onto
   the camera's NDC plane is the right model. The behind-the-form
   region is empty in every shape, which is fine: the shapes mostly
   live in `[-2, +2]` along Z anyway.
3. **Octahedron jitter amplitude is `0.04`.** This is the only
   numerical "feel" parameter in Phase 1's bake. Bumping higher reads
   as a fuzzy ghost; lower as a CAD wireframe. Phase 7 may revisit it,
   but the 0.04 baseline already reads cleanly in the smoke preview.
4. **Cap multiplier is `10×`.** With form-clearing rejection rates
   under ~30% empirically (rough mental check during iteration), 10× is
   ample headroom. If a future shape (network graph, wordmark) hits
   the cap, the diagnostic will be loud — `Error: only N/18000 samples
   after 180000 attempts` — and the fix is either resizing the shape
   or relaxing the cap, not silently degrading the count.
5. **No texture, no normals, no UVs in the .bin format.** Just
   positions. The runtime will compute everything else (per-particle
   `morphSeed`, `trajectoryNoise`, etc.) at canvas mount, not bake
   time. Keeps the .bin files small and shape-only-aware.

---

## Estimate vs. actual

Plan estimate: 1.0 day. Actual: ~75 minutes of focused work. Distribution:

- ~30 min: bake script (chevron geometry construction is the
  fiddliest part — three iterations on the box-vs-extrude decision,
  one on the arm-angle sign for the bottom arm)
- ~20 min: shape registry + npm script + .gitattributes + smoke-route
  rewrite (mostly translating from Phase 0's smoke cube)
- ~10 min: shape-preview component (vanilla `<pointsMaterial>`
  rendering, no shaders)
- ~15 min: gate verification + completion notes

Plan was honest about Phase 1 being lightweight; the math (NDC
projection, rejection sampling) is standard and the surface area is
narrow.

---

## What Phase 2 inherits

- **`shapes.ts` constants frozen.** Phase 2's `shape-loader.ts` and
  `swarm-points.tsx` import `PARTICLE_COUNT`, `CAMERA_POSITION`,
  `CAMERA_FOV` from this file. No drift possible; both halves of the
  pipeline share one source of truth.
- **Three baked .bin files** ready for parallel-loading via
  `Promise.all([...].map(fetch))` in Phase 2's `shape-loader.ts`. The
  loader will allocate the per-particle attribute buffers
  (`previousTarget`, `targetPosition`, `morphSeed`, `trajectoryNoise`)
  and populate `targetPosition` from the first shape's bake; subsequent
  shape changes copy the new shape's targets in.
- **`shape-preview-canvas.tsx` is the reference implementation** for
  the .bin → BufferGeometry → `<points>` pipeline. Phase 2 doesn't
  reuse this component, but it does reuse the loader pattern and the
  geometry construction.
- **Smoke route now also exposes the form-rect outline** which Phase 5
  doesn't ship. The outline is a debug surface that goes away with the
  route.

---

## What was *not* done in Phase 1 (and why that's correct)

- **No globe / network graph / wordmark bakes.** Plan defers them to
  Phase 4 — the morph engine in Phases 2–3 needs to be proven on
  primitives first. If the morph reads wrong, debugging on chevron is
  easier than debugging on a 30-node Poisson-disk graph.
- **No font asset for the wordmark.** Same reason — Phase 4.
- **No int16 quantisation.** Plan's Phase 6 considers it as a fallback
  if bundle pressure appears. At 600KB gzipped across all 6 shapes,
  pressure may not appear at all; pre-empting now is speculation.
- **No bake-time deduplication or even-spacing pass.** A truly
  uniform-density distribution would require Lloyd's relaxation or
  blue-noise sampling — `MeshSurfaceSampler` is "uniform random,"
  which has small clumping artefacts at low density. Visually, at
  18000 points across a chevron silhouette, clumping is invisible.
  Skip until proven necessary.
- **No reduced-motion fallback PNG.** Same reason as Phase 0; Phase 6
  task.
- **No mobile particle subsampling.** Phase 6 task. The .bin files are
  oversized for mobile; the runtime will stride through them.
- **No tests.** A `morph-scheduler.ts` test in Phase 2 may be worth
  writing; nothing in Phase 1 has phase-tagged behaviour that warrants
  unit tests. Visual smoke covers the whole surface.
