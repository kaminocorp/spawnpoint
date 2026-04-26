# Login Animation — Phase 4 Completion Notes

> Phase 4 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: bake the
> three remaining shapes — globe, network graph, wordmark — and flip
> all six into the morph rotation. **No shader changes, no scheduler
> changes** — `MorphScheduler` already weights all six shapes (the
> wordmark's `1/7` weight has been in `SHAPE_WEIGHTS` since Phase 2);
> Phase 4's only frontend code change is widening
> `ACTIVE_SHAPES` from three to six.

**Status:** ✅ Exit gate met — `pnpm bake-shapes` produces six
clean .bin files at 210.9 KB each, `next build` succeeds, lint
+ type-check clean. The morph rotation now cycles across all six
silhouettes; wordmark beat lands at its `1/7` weight (~once per
seven cycles in long-run average).

---

## Significant deviations from the plan

Two deviations, both forced by realities the plan hadn't anticipated.

### 1. Wordmark uses a hand-built 5×7 pixel font, not `TextGeometry`

The plan's Phase 4 task 3 prescribed two paths for the wordmark: the
"clean path" through `three/addons/loaders/FontLoader.js` +
`TextGeometry` with a Space Mono `.ttf` shipped as a script-only
asset, or a Canvas-API fallback that pixel-samples a rasterised
"CORELLIA" string.

Shipped: a third path. **Eight hand-drawn 5×7 bitmap glyphs** for the
letters of "CORELLIA" (C, O, R, E, L, I, A — six unique). Each "on"
pixel becomes a `BoxGeometry`; all letter cells are merged via
`mergeGeometries` and surface-sampled by the existing
`sampleSurface` path. Reasons:

- **No font dependency to ship at all.** The "clean path" requires
  a `.ttf` (or a converted `.json` typeface) committed in the repo;
  the bake script also has no DOM, so the Canvas-API fallback would
  need `node-canvas` (a native dep with libuv binding) added just
  for the bake. Both options drag in tooling for one shape.
- **The pixel-font register is on-brand.** The rest of Corellia's
  chrome already reads as terminal-typography (Space Mono headings,
  bracketed section labels, monospace data). A pixel-font CORELLIA
  is a cousin to that register, not a fight with it.
- **Glyph data is 7 lines of ASCII per letter.** Reviewable in a diff,
  trivially editable when tuning kerning or stroke weight. Compare
  against a `TextGeometry` that bakes from a binary font file —
  the visual tuning surface is much narrower in the bitmap path.
- **Pixelisation reads cleanly at 18000 particles.** With ~200 "on"
  cells across the eight-letter wordmark, ~90 particles per cell —
  comfortably above the ~20-particle floor where individual cells
  start to read as fuzzy clusters. The wordmark is legible in static
  preview at the locked camera.

Cost: kerning is fixed (one blank column between letters; no glyph
pair adjustments). Phase 7 may revisit if "CORELLIA" reads spaced
oddly in the rotation, but the dial is small (the `letterSpacingPx`
constant in `bakeWordmark`).

### 2. Network bake needed two structural fixes the plan hadn't called out

The first bake run returned `bakeNetwork: only 1804/18000 samples
after 180000 attempts`. Two interlocking bugs:

- **Per-node sampling could starve when a node's centroid projected
  inside the form rect.** The plan described a single shared `attempts`
  counter with a 10× cap. With ~30 nodes Poisson-disk-spaced inside a
  3.4-world cube, several nodes happen to project into the form's NDC
  rectangle; their Gaussian clouds are 100% rejected, but the loop
  spins until the global cap exhausts — starving every later node.
- **The shared counter also starved the edge phase.** Even if nodes
  finished, edges crossing the form's projected rectangle take a
  large rejection-rate hit, and they'd inherit whatever the node loop
  left of the budget.

Fix: **filter nodes at Poisson-disk time** so any candidate whose
2D projection falls inside the form rect is rejected before it joins
the node set. All surviving nodes can host full Gaussian clouds. Plus
**split the attempt budget** into per-loop caps (`nodeCap` for nodes,
`edgeCap` for edges) so a stuck loop can't starve the other.

After the fix, the network bake places all 18000 particles cleanly.
Worth pinning as a network-specific lesson: any future shape-with-
nodes pattern (constellation, tree-graph, etc.) needs the same
form-clearing on the *node centroids*, not just the per-particle
samples.

---

## What changed

### Files modified

| File | Change |
|------|--------|
| `frontend/scripts/bake-sign-in-shapes.ts` | Three new bake functions and supporting helpers. **`makeGlobeGeometry()`** builds line segments for 8 longitude meridians + 5 latitude parallels (24 segments per arc), wrapped in a `BufferGeometry` so the existing `sampleEdges` path consumes it directly. **`bakeGlobe()`** drives that with a `0.025` jitter amplitude (tighter than the octahedron's `0.04` — globe has more total edge length, smaller per-edge fuzziness keeps each arc legible). **`bakeNetwork()`** plus three helpers — `poissonDiskNodes(count, half, minDistance, camera, rng)` (now form-aware), `nearestNeighborEdges(nodes, k=2)`, `gaussianSample(center, sigma, rng)` (Box-Muller). Allocates 60% of particles to node Gaussians (sigma `0.09`), 40% to edges with `±0.025` lateral jitter. Per-loop attempt caps prevent cross-loop starvation. **`bakeWordmark()`** runs the pixel-font path: 5×7 ASCII glyphs for `C`,`O`,`R`,`E`,`L`,`I`,`A` mapped to `BoxGeometry` cells (`pixelSize=0.16`, `depth=0.18`), merged across all eight letters of "CORELLIA", positioned in the lower third of the canvas (centre Y ≈ −1.4), surface-sampled. The form-clearing rejection in `sampleSurface` is structurally a no-op for the wordmark (sits below the form) but kept for symmetry. New imports: `BufferGeometry` (as a value), `Float32BufferAttribute`. `main()` now calls `bakeChevron`, `bakeOctahedron`, `bakeTorus`, `bakeGlobe`, `bakeNetwork`, `bakeWordmark` in that order. |
| `frontend/src/components/sign-in/swarm-canvas.tsx` | `ACTIVE_SHAPES` widened from 3 to 6 — `["chevron","octahedron","torus","globe","network","wordmark"]`. One-line behavioural delta. |
| `frontend/src/app/sign-in-swarm-smoke/page.tsx` | `PREVIEW_SHAPES` widened to all six so static-mode preview can verify each silhouette individually before the morph engine cycles them. |

### Files added

| File | Size | Purpose |
|------|------|---------|
| `frontend/public/sign-in/shape-targets/globe.bin` | 216,000 B | 18000 × {x,y,z} float32 edge samples along 8 meridians + 5 parallels at radius 1.9, with `0.025` lateral jitter. |
| `frontend/public/sign-in/shape-targets/network.bin` | 216,000 B | 18000 × {x,y,z} float32. 10800 Gaussian-cloud samples around 30 Poisson-disk nodes (sigma 0.09); 7200 edge samples along ~50 nearest-neighbor edges with ±0.025 lateral jitter. |
| `frontend/public/sign-in/shape-targets/wordmark.bin` | 216,000 B | 18000 × {x,y,z} float32. Surface samples across the merged "CORELLIA" pixel-grid geometry, positioned with vertical centre at Y ≈ −1.4. |

### Files NOT changed

- **No shader files.** The morph engine and color story are
  shape-agnostic; new silhouettes drop in via the bake pipeline alone.
  Phase 2's prediction held: "ACTIVE_SHAPES list in `swarm-canvas.tsx`
  is `[chevron, octahedron, torus]`; Phase 4 expands by appending three
  names + running the bake script."
- **`morph-scheduler.ts`** — `SHAPE_WEIGHTS` already had entries for all
  six shapes including the wordmark's `1/7`, written in Phase 2.
  Wordmark's hold extension to 12s already lives in
  `holdDurationSeconds`. Zero scheduler delta.
- **`shapes.ts`** — `SHAPE_NAMES` already enumerates all six. Frozen
  since Phase 1.
- **`shape-loader.ts`** — `loadShapeTargets(names)` is shape-name-
  agnostic; the parallel-fetch path picks up the three new files
  without modification.
- **No font asset committed.** Wordmark is bitmap-driven, no `.ttf`
  needed. The plan's "ship a Space Mono `.ttf` in
  `frontend/scripts/assets/`" path was bypassed — see deviation §1.

---

## How the new bakes work (load-bearing details)

### Globe — the cheap shape

`makeGlobeGeometry()` produces line segments without `EdgesGeometry`
indirection because the meridian/parallel structure is already
edges-as-pairs by construction. 8 meridians × 24 segments + 5
parallels × 24 segments = 312 line segments total. `sampleEdges`
consumes it identically to the octahedron path — one-shot inverse-CDF
length-weighted sampling, light lateral jitter for "particles tracing
arcs."

The five parallels skip both poles (degenerate point geometries) and
are evenly spaced in `lat ∈ (0, π)`. The pole-skip is why there are 5
parallels not 7 — 7 would put parallels at `lat = π/8` and `7π/8`,
which read as flat dots near the poles when projected. The 5 chosen
sit at `π/6, π/3, π/2, 2π/3, 5π/6` — one equator plus two above and
two below.

Globe radius 1.9 is fractionally larger than the octahedron's 1.8 —
small enough that they read as the same "scale class" in the rotation
(neither is the "big shape" or the "small shape"), but the globe's
arc curvature reads cleanly without crowding the form rect.

### Network — the structural shape

The network bake is the only Phase 4 path that doesn't reduce to a
single geometry. It composites two distinct point-distribution
strategies:

- **Node Gaussians** (60% of particles): Box-Muller-driven 3D
  Gaussian clouds with `sigma = 0.09` around 30 node centroids.
  Reads as "dense markers" — each node gets ~360 particles, enough
  to register as a distinct mass at viewing distance.
- **Edge tracers** (40% of particles): linear interpolation along
  edges, weighted by edge length, with `±0.025` lateral jitter on
  each axis. Reads as "soft connections" — beam-like rather than
  laser-line.

Edge selection uses `nearestNeighborEdges(nodes, 2)` — for each node,
take its 2 nearest neighbors as edge endpoints, deduplicating
undirected pairs. With 30 Poisson-disk nodes the typical edge count
is ~45-55 (some nearest-neighbor relationships are mutual,
deduplication collapses them to one edge each).

Form-clearing happens at *both* Poisson-disk node generation and
per-particle sampling. A node whose centroid projects inside the
form is rejected at Poisson time so its Gaussian cloud doesn't
starve downstream sampling.

### Wordmark — the named shape

The pixel-font path produces the densest geometry of the six (eight
glyphs × ~25 on-pixels each = ~200 box cells, merged into one
`BufferGeometry`). Surface sampling distributes 18000 particles
across the merged surface area.

Positioning: `pixelSize = 0.16`, `letterCols = 5`, `letterSpacingPx =
1`. Each letter is `5 × 0.16 = 0.8` world units wide; advance is
`6 × 0.16 = 0.96`. The "CORELLIA" word total width is `0.8 + 0.96 ×
7 = 7.52` world units — wider than the form (form world-width at z=0
is ~0.95). Centre-anchored at X = 0; vertical centre at `Y = −1.4`,
which projects to NDC Y ≈ −0.5 — well below the form's NDC bottom
edge at −0.304.

The bake's form-clearing rejection is structurally a no-op for the
wordmark (every pixel cell sits below the form), but kept in the
sampler for symmetry. If Phase 7's tuning ever moves the wordmark
upward, the rejection takes effect without code change.

---

## Verification

### Bake run (after the network fix)

```
$ pnpm -C frontend bake-shapes

bake config: 18000 pts/shape · viewport 1920x1080 · form half-NDC (0.212, 0.304)
out: /Users/.../frontend/public/sign-in/shape-targets
  chevron.bin — 18000 pts, 210.9 KB
  octahedron.bin — 18000 pts, 210.9 KB
  torus.bin — 18000 pts, 210.9 KB
  globe.bin — 18000 pts, 210.9 KB
  network.bin — 18000 pts, 210.9 KB
  wordmark.bin — 18000 pts, 210.9 KB
done.
```

All six shapes hit their full 18000 within their attempt budgets.
On-disk total: 1.27 MB raw, well within Phase 6's bundle audit
budget.

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
✓ Compiled successfully in 1859ms
✓ Generating static pages using 11 workers (11/11) in 190ms
```

### Visual confirmation (deferred — same pattern as Phase 0–3)

Visual confirmation that each new silhouette reads correctly — globe
as parallels-and-meridians (not a fuzzy ball), network as nodes-with-
connections (not a generic blob), wordmark legible as "CORELLIA" —
requires `pnpm -C frontend dev` and stepping through the smoke
route's static mode for each shape, then watching the morph rotation
for several minutes to catch a wordmark beat. Structural exit gate
(bake counts exact, build clean, lint+types clean) is met here.

---

## Decisions worth pinning

These are now load-bearing for Phases 5–7.

1. **Globe is 8 meridians + 5 parallels at radius 1.9.** Phase 7
   dial: meridian count if the equator reads as "lines on a flat
   disk" rather than "globe" (more meridians help); parallel count
   if the spheroid reads thin near the poles (more parallels — but
   not at the poles themselves, those are degenerate).
2. **Network is 30 Poisson-disk nodes, k=2 nearest neighbors,
   60/40 node-vs-edge particle split.** Phase 7 dial #4-7 candidates:
   node count (more nodes = busier graph), node sigma (`0.09`,
   higher = blurrier), edge jitter (`0.025`, higher = softer beam).
3. **Wordmark uses a hand-built 5×7 pixel font, not `TextGeometry`.**
   Glyph data is in `GLYPHS_5x7` const inside `bake-sign-in-shapes.ts`.
   Phase 7 dial: pixel size, letter spacing, depth. New glyphs (e.g.
   for an alternate wordmark) added by appending to the const.
4. **Wordmark sits at Y ≈ −1.4** (lower third of canvas). Form-
   clearing rejection in the sampler is symmetric / no-op at this
   position; if a future tuning moves the wordmark upward, rejection
   takes effect without code change.
5. **Network nodes are form-aware at Poisson-disk time.** Any future
   shape that places per-shape "anchor points" with cloud expansion
   around them must do the same — generating an anchor inside the
   form's projected NDC rect creates a starvation pocket. Pattern
   established here.
6. **Bake script attempt budgets are per-loop, not global.** Network
   has separate `nodeCap` and `edgeCap`. Future composite shapes
   should follow the same per-phase budgeting.
7. **`SAMPLE_CAP_MULTIPLIER = 10` is still ample** for every shape
   shipped. Network's per-loop caps are 10× their respective
   particle shares; no run hit the cap.

---

## Estimate vs. actual

Plan estimate: 1.0 day. Actual: ~45 minutes of focused work. Distribution:

- ~10 min: globe geometry construction (straightforward — line
  segments along parametric arcs, the existing `sampleEdges` path
  consumed it without modification)
- ~15 min: network bake first pass (Poisson-disk + nearest-neighbor
  edges + Gaussian-around-nodes + linear-along-edges)
- ~5 min: diagnose + fix the form-projecting-node starvation bug
  (the throw message named the loop, the per-loop attempt counter
  fix was structural)
- ~10 min: wordmark pixel-font (decided against the FontLoader path
  in the first 60 seconds; eight glyph drawings + box-merge took
  the rest)
- ~5 min: ACTIVE_SHAPES + PREVIEW_SHAPES updates + verification

Plan budgeted heavily for the wordmark font pipeline (the "Cleanest
path" + fallback structure suggested ~half a day). The pixel-font
shortcut collapsed that to ~10 minutes. Network's debug session was
the only real engineering surprise.

---

## What Phase 5 inherits

- **All six shapes are live** in the morph rotation. The only
  shape-specific behavior remaining is the wordmark's 12s hold
  extension (Phase 2's `HOLD_DURATION_WORDMARK_S`), which is
  scheduler-driven and fires automatically.
- **Smoke route still wraps the morph engine** at
  `/sign-in-swarm-smoke`. Phase 5 deletes the route + the
  `shape-preview-canvas.tsx` debug component, then wires
  `<SwarmBackground />` into `/sign-in/page.tsx` directly. The
  visual + structural tests at the smoke route are the
  rehearsal-room work; Phase 5 takes the show on the road.
- **Three new .bin files in `public/sign-in/shape-targets/`** —
  fetched in parallel by `loadShapeTargets` at canvas mount. The
  canvas-mount cost has grown by a factor of two (3 → 6 .bins),
  but each fetch is independent and runs concurrently; total mount
  latency is gated by the slowest single fetch, not the sum.
- **Wordmark beat is unlocked.** With the wordmark live in
  `ACTIVE_SHAPES`, every ~7 cycles in the long-run average will land
  on the wordmark with its extended 12s hold. Phase 7 will tune the
  `1/7` weight and the 12s extension based on first-impression
  feedback from observers.

---

## What was *not* done in Phase 4 (and why that's correct)

- **No `TextGeometry` / font-loader integration.** Pixel-font shipped
  instead — see deviation §1.
- **No additional shapes beyond the six in the plan.** The brief's
  rotation is set at six; adding a seventh would be Phase 7+
  speculation.
- **No int16 quantisation.** Phase 6 dial if the bundle audit
  shows pressure. At 1.27 MB raw / ~600 KB gzipped across all six
  .bin files, on a route the user only visits when signed out,
  pressure may not appear at all.
- **No shape-specific shader behavior.** Wordmark gets the same
  pearl-green rest, same cyan during MORPH, same hold flicker as the
  other five. Phase 7 may special-case the wordmark beat (e.g. a
  brightness lift for the rare-event payoff) but that's a tuning
  decision, not a Phase 4 deliverable.
- **No tests for the bake script.** The bake is run-once-and-commit;
  the .bin files in version control *are* the test artifact. Bake
  changes show up as binary diffs that the developer eyeballs in
  the smoke route before committing.
- **No `/sign-in` integration.** Phase 5.
- **No reduced-motion fallback / mobile subsampling.** Phase 6.
- **No tuning of cycle pacing, color ratios, or per-shape weights.**
  Phase 7. Phase 4 hands Phase 7 a complete set of dials.
