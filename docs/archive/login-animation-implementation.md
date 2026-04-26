# Login Animation — Implementation Plan

Companion to `docs/executing/login-animation.md` (the design brief). This
doc is the *how*. Where the brief stops at "Direction D, here's the
shader sketch," this plan turns it into discrete, ordered, ship-able
phases with files-touched, success criteria, and exit gates per phase.

Single milestone, frontend-only, scoped to `/sign-in`. No backend, no
proto, no schema, no env-var, no migration.

---

## Decisions locked (the 9 open questions)

The brief's Q&A section is closed with these picks; don't re-litigate
during implementation. Tuning of *amounts* (timings, amplitudes, mix
ratios) belongs in Phase 7, not in arguments about which feature to
ship.

| # | Question | Pick | Reason |
|---|----------|------|--------|
| 1 | Shape rotation roster | All 7 (amorphous + chevron + octahedron + torus + network + globe + wordmark) | Variety is what makes the rotation read as "fleet under orchestration" rather than "one shape on loop." No mascots/cloud-logos — those break the no-marketing register. |
| 2 | Wordmark cadence | Once per ~7 cycles (~2 min between beats) | The rarer it is, the harder it lands. Every ~3 cycles already starts to feel like a sizzle reel. |
| 3 | Travel-phase color | Cyan tint (transient state hint), back to green at settle | Carries the literal `pending → running` storytelling. Design-system §5 carves out transient-state hints as the explicit exception; this is the canonical use of that exception. |
| 4 | Mouse parallax | None (strictly ambient) | Matches the "monitoring dashboard" register over "tech demo." The form is the only interactive surface on this page; the canvas is wallpaper. |
| 5 | Hold-phase rotation | Slow Y-axis rotation at ~0.05 rad/s + per-particle micro-jitter | A frozen silhouette flattens within 2s. Both motions are sub-attentional and stack cleanly. |
| 6 | Cycle pacing | 18s per cycle (4 drift + 4 travel + 3 settle + 7 hold), wordmark beat extends hold to 12s | Trust the brief's instinct; revisit only in Phase 7 with the engine running. |
| 7 | Reduced-motion fallback | Static PNG of settled chevron, no animation | More on-brand than `grid-bg`; users who opt out of motion still get a Corellia-shaped login screen. |
| 8 | Bundle budget | Accept ~750KB gzipped (R3F + three + 6 binaries) on `/sign-in` only | One-shot per session, lazy-loaded, behind a route the user only visits when signed out. Trimming hurts the rotation more than it saves bytes. |
| 9 | Bake script location | Manual pre-commit script, binaries committed | Reviewable artefacts; shape edits are infrequent in v1. Build-time bake can come later if shapes start changing weekly. |

---

## Architecture overview

What gets built, in one diagram:

```
frontend/src/app/sign-in/page.tsx
  └─ <SwarmBackground />          ← lazy-loaded R3F canvas (Phase 5)
  └─ <main>                       ← existing layout
      └─ <header>                 ← unchanged
      └─ <TerminalContainer>      ← unchanged form

frontend/src/components/sign-in/
  ├─ swarm-background.tsx         ← thin SSR-disabled wrapper, viewport sizing,
  │                                  prefers-reduced-motion fallback
  ├─ swarm-canvas.tsx             ← R3F <Canvas>, scene, useFrame loop
  ├─ swarm-points.tsx             ← <THREE.Points> + ShaderMaterial
  ├─ shape-loader.ts              ← fetch + parse the .bin target buffers
  ├─ morph-scheduler.ts           ← cycle clock, phase machine, shape rotation
  ├─ shaders/
  │   ├─ swarm.vert.glsl          ← morph + jitter (the load-bearing shader)
  │   ├─ swarm.frag.glsl          ← color, point softness
  │   └─ simplex-noise.glsl       ← Ashima 3D simplex (inlined constant)
  └─ shapes.ts                    ← shape registry, bake order, metadata

frontend/scripts/
  └─ bake-sign-in-shapes.ts       ← one-shot bake script (tsx + three runtime)

frontend/public/sign-in/
  ├─ shape-targets/
  │   ├─ chevron.bin              ← 18000 × vec3 = 216KB each
  │   ├─ octahedron.bin
  │   ├─ torus.bin
  │   ├─ globe.bin
  │   ├─ network.bin
  │   └─ wordmark.bin
  └─ reduced-motion.png           ← static fallback frame
```

**Critical invariants:**

- `swarm-canvas.tsx` is the only place that imports `three` /
  `@react-three/fiber` / `@react-three/drei`. Everything else imports
  from `swarm-canvas` — no diamond-imports of three from sibling files.
- The shaders live in `.glsl` files imported as raw strings (Next.js +
  webpack's built-in `asset/source` rule, or a `?raw` import via
  Turbopack). Inlining as JS template strings is acceptable fallback
  if the loader configuration fights us — keep an escape hatch.
- Target binaries are read once via `fetch` + `arrayBuffer` on canvas
  mount and parsed into `Float32Array`s. No re-fetching across morph
  cycles.
- Per-particle attributes (`previousTarget`, `targetPosition`,
  `morphSeed`, `trajectoryNoise`) are written to the buffer **once
  per shape change**, never per frame. Per-frame CPU cost is 4–5
  uniform writes and one rotation update — that's it.

---

## Phase 0 — Scaffolding & Dependencies (~0.5 day)

The cheapest phase, but ship-or-die: if the dynamic-import + WebGL +
SSR setup doesn't work, nothing else does. Prove it with a black canvas
that renders one rotating cube before writing a line of particle code.

### Tasks

1. **Add deps.** `pnpm -C frontend add three @react-three/fiber @react-three/drei`. Pin major versions (R3F 8.x, three 0.160+) per the Elephantasm reference doc.
2. **Add bake-script deps as devDeps.** `pnpm -C frontend add -D tsx @types/three`. `tsx` runs the bake script with TS + ESM imports against three's runtime. `@types/three` is already a transitive type dep but pinning it explicit avoids version skew when three updates.
3. **Configure raw-text import for `.glsl` files.** Add to `next.config.ts`:
   ```ts
   webpack: (config) => {
     config.module.rules.push({
       test: /\.glsl$/,
       type: "asset/source",
     });
     return config;
   }
   ```
   For Turbopack (`next dev` uses it by default in Next 16), use the `turbopack.rules` field with `loaders: ["raw-loader"]` or fall back to `?raw` import suffixes — whichever the running version actually supports.
4. **Create directory tree.** Empty `frontend/src/components/sign-in/` and `frontend/src/components/sign-in/shaders/` and `frontend/scripts/` and `frontend/public/sign-in/shape-targets/`.
5. **Create `swarm-background.tsx` stub.**
   ```tsx
   "use client";
   import dynamic from "next/dynamic";
   const SwarmCanvas = dynamic(() => import("./swarm-canvas"), { ssr: false });
   export function SwarmBackground() {
     return <div className="fixed inset-0 -z-10 bg-black"><SwarmCanvas /></div>;
   }
   ```
6. **Create `swarm-canvas.tsx` smoke-test.** R3F `<Canvas>` with a single rotating green wireframe cube. Camera at `(0, 0, 6)`, FOV 50, `alpha: true`, `antialias: true`. **Do not** wire it into `/sign-in` yet — render it on a throwaway `/sign-in/_test` page so the real auth route isn't visually broken if the smoke fails.
7. **Verify.** `pnpm -C frontend dev`, navigate to the test route, see the cube. `pnpm -C frontend build` succeeds (no SSR errors). `pnpm -C frontend type-check` clean. `pnpm -C frontend lint` clean.

### Exit gate

A black-background R3F canvas rendering at 60fps in dev mode. `next build` succeeds. Lint/type-check clean. **No feature work proceeds until this is true.**

### Files touched

- `frontend/package.json` (deps)
- `frontend/next.config.ts` (.glsl loader)
- `frontend/src/components/sign-in/swarm-background.tsx` (new)
- `frontend/src/components/sign-in/swarm-canvas.tsx` (new, smoke-test version)
- Throwaway: `frontend/src/app/sign-in/_test/page.tsx` (deleted in Phase 5)

---

## Phase 1 — Bake Script + 3 Primitive Shapes (~1 day)

Get the offline pipeline producing real binary target files before any
shader work. The morph engine is useless without targets to morph
between, and the bake script is independently testable.

### Tasks

1. **Write `frontend/src/components/sign-in/shapes.ts`.** Single registry export:
   ```ts
   export const PARTICLE_COUNT = 18000;
   export const PARTICLE_COUNT_MOBILE = 6000;
   export const SHAPE_NAMES = ["chevron", "octahedron", "torus", "globe", "network", "wordmark"] as const;
   export type ShapeName = typeof SHAPE_NAMES[number];
   ```
   The `amorphous` "shape" has no bake — it's computed at runtime as `currentPosition + low-freq-noise drift`, so it doesn't appear here.
2. **Write `frontend/scripts/bake-sign-in-shapes.ts`.** One file, three exports for now (chevron, octahedron, torus). Per shape:
   - Build a `THREE.BufferGeometry` representing the silhouette:
     - **Chevron:** `THREE.ExtrudeGeometry` of a 2D `THREE.Shape` traced out as a `›`. Apex points right; aspect ratio chosen so the silhouette occupies roughly 45% of viewport width when rendered at z=6 with FOV 50.
     - **Octahedron:** `THREE.OctahedronGeometry(1.5, 0)` — radius 1.5, 0 subdivisions for crisp wireframe edges. Particles sample edges (not faces) to get the wireframe look.
     - **Torus:** `THREE.TorusGeometry(1.4, 0.35, 16, 96)` — major radius 1.4, minor 0.35.
   - Sample N=18,000 points uniformly on the geometry's surface using a barycentric sampler weighted by triangle area. Util: `MeshSurfaceSampler` from `three/addons/math/MeshSurfaceSampler.js`.
   - Reject samples whose 2D screen-projection (under the fixed camera matrix `(0, 0, 6)` + FOV 50 + viewport 1920×1080) falls inside the form's bounding rect. **Form bounding rect** = `360px × ~280px` centred on viewport, plus 24px padding on each side. Convert to NDC via the camera's projection matrix, reject in NDC space.
   - Refill rejected samples by re-sampling. Cap iterations at 10× the desired count to bail on degenerate cases (e.g. a shape entirely behind the form).
   - Write `Float32Array` of `N × 3` floats to `public/sign-in/shape-targets/<name>.bin`.
3. **Add npm script.** `frontend/package.json`:
   ```json
   "bake-shapes": "tsx scripts/bake-sign-in-shapes.ts"
   ```
4. **Run + commit binaries.** `pnpm -C frontend bake-shapes`. Three .bin files appear under `public/sign-in/shape-targets/`. Commit them. Add a comment at the top of `bake-sign-in-shapes.ts` documenting the manual workflow ("run this when shapes change; commit the .bin outputs").
5. **Add `.gitattributes` entry** so the .bin files don't pollute diffs:
   ```
   public/sign-in/shape-targets/*.bin binary
   ```
6. **Sanity-render the targets.** Quickest validation: write a 50-line throwaway script (or extend the smoke-test route from Phase 0) that loads `chevron.bin` and renders the points as a static `THREE.Points` cloud. The chevron silhouette should be visible. Same for octahedron, torus. Catch bugs (wrong aspect ratio, form-clearing rejection too aggressive, sampling biased) here, where the failure is just "wrong shape" rather than entangled with morph timing.

### Exit gate

Three binary files committed under `public/sign-in/shape-targets/`. Static render of each in the smoke-test route shows the recognisable silhouette with the form-area cleared. Each file is ~216KB.

### Files touched

- `frontend/scripts/bake-sign-in-shapes.ts` (new)
- `frontend/src/components/sign-in/shapes.ts` (new)
- `frontend/package.json` (one script line)
- `frontend/.gitattributes` (one line; create if missing)
- `frontend/public/sign-in/shape-targets/{chevron,octahedron,torus}.bin` (new, committed)

---

## Phase 2 — Morph Engine (Drift / Travel / Settle / Hold) (~1.5 days)

The load-bearing phase. Particle system, vertex shader, the four-phase
state machine, the shape rotation loop. **No color story yet** —
particles render as flat white. Color belongs to Phase 3, where it can
be tuned without re-debugging the morph mechanics.

### Tasks

1. **Write `simplex-noise.glsl`.** Copy the Ashima 3D simplex GLSL constant verbatim from the Elephantasm reference. This is shared by both the vertex and fragment shaders. Inline as raw string import in `swarm-canvas.tsx` (or import via `?raw` if the loader is configured).
2. **Write `swarm.vert.glsl`** per the brief's vertex-shader sketch (login-animation.md §Technical sketch). Inputs: `previousTarget`, `targetPosition`, `morphSeed`, `trajectoryNoise` (per-particle attributes); `uMorphProgress`, `uPhase`, `uTime` (uniforms). Output: `gl_Position` from displaced position; `vAlpha` for fragment.
3. **Write `swarm.frag.glsl`** placeholder. For Phase 2, just `gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * exp(-d*d*8.0))` — flat white with circular point softness. Color comes in Phase 3.
4. **Write `morph-scheduler.ts`.** Plain TS module, no React. Owns the cycle clock, phase machine, and shape rotation queue. API:
   ```ts
   class MorphScheduler {
     constructor(shapes: ShapeName[]);
     tick(elapsedSeconds: number): {
       phase: 0 | 1 | 2 | 3;        // drift / travel / settle / hold
       progress: number;             // 0-1 within current phase
       currentShape: ShapeName;
       nextShape: ShapeName;
       shapeChanged: boolean;        // true on the frame the shape transitions
     };
   }
   ```
   - 18s cycle: 4s drift, 4s travel, 3s settle, 7s hold. Wordmark beat extends hold to 12s (so its cycle is 23s).
   - Shape rotation: irrational-period scheduler. Use a deterministic-but-aperiodic sequence — e.g. weighted random sampler with seed; weights `{chevron: 1, octahedron: 1, torus: 1, globe: 1, network: 1, wordmark: 1/7}`. After every shape, with probability ~0.4 insert an `amorphous` interlude (drift-only "shape" — just don't load a new target, keep the current positions and let the noise drift dominate). Amorphous interludes are 8 seconds (one drift + one settle, no travel/hold).
   - Wordmark gets the 1/7 frequency baked into its weight. It will average ~once per 7 cycles in the long run; the short-term cadence isn't deterministic, which is the point (operator never predicts when it lands).
5. **Write `shape-loader.ts`.** `loadShapeTargets(names: ShapeName[]): Promise<Map<ShapeName, Float32Array>>`. One `fetch` per shape, all in parallel via `Promise.all`. Returns a map; failures throw — no silent fallback.
6. **Wire into `swarm-canvas.tsx`.** On mount: load all shape targets in parallel, initialise `BufferGeometry` with N=18000 particles (positions = first shape's targets, all set to a starting amorphous swarm via `morph-scheduler` initial state), wire up `useFrame` to:
   - call `scheduler.tick(elapsedTime)`
   - on `shapeChanged === true`: copy `targetPosition` buffer → `previousTarget` buffer, copy new shape's targets → `targetPosition` buffer, mark both `BufferAttribute.needsUpdate = true`.
   - per frame: write `uMorphProgress`, `uPhase`, `uTime` uniforms; update scene rotation `y = elapsedTime * 0.05` during hold phase only (rotation freezes during travel so the morph reads cleanly).
7. **Verify.** Smoke-test route shows: ~18K white particles morphing chevron → octahedron → torus → amorphous → repeat. Particles billow through travel (per-particle bend visible), arrive in stagger (formation draws itself in), hold rotates slowly, drift dissolves the form. **No color, no cyan tint, no per-particle phase offsets in color — just monochrome morph.**

### Exit gate

Recognisable morph cycle running in browser. Each phase reads as itself: drift visibly disintegrates, travel billows (not flies straight), settle eases, hold rotates. 60fps on dev hardware.

### Files touched

- `frontend/src/components/sign-in/shaders/simplex-noise.glsl` (new)
- `frontend/src/components/sign-in/shaders/swarm.vert.glsl` (new)
- `frontend/src/components/sign-in/shaders/swarm.frag.glsl` (new, placeholder)
- `frontend/src/components/sign-in/morph-scheduler.ts` (new)
- `frontend/src/components/sign-in/shape-loader.ts` (new)
- `frontend/src/components/sign-in/swarm-points.tsx` (new — geometry + material wiring)
- `frontend/src/components/sign-in/swarm-canvas.tsx` (rewritten from Phase 0 smoke-test)

---

## Phase 3 — Color Story (~0.5 day)

Pearl base + green tint, cyan travel-phase tint, hold-phase
micro-jitter, alpha-by-density. Self-contained: nothing here changes
geometry or scheduling, only the fragment shader and one new vertex
uniform.

### Tasks

1. **Rewrite `swarm.frag.glsl`.** Pearl base `vec3(0.85, 0.92, 0.85)` mixed with brand green `#22c55e` (`vec3(0.133, 0.773, 0.369)`) at 0.4 — that's the rest color. Add `uCyanTint` uniform (0–1): when nonzero, mix the rest color toward cyan `#06b6d4` (`vec3(0.024, 0.714, 0.831)`) by `uCyanTint`. Apply the same `exp(-d*d*8.0)` point-softness mask as Phase 2.
2. **Drive `uCyanTint` from the morph scheduler.** Travel phase: ramp 0 → 1 over the first 1.5s, hold at 1 for the middle, ramp back to 0 in the last 0.5s. Settle phase: cross-fade 0 (already 0). Drift / hold: 0. The CPU writes one float per frame.
3. **Add hold-phase micro-jitter to the vertex shader.** Per the brief's sketch: `jitter = snoise(targetPosition * 8.0 + ...) * 0.015 * float(uPhase == 3)`. Multiplied by `uPhase == 3` so jitter only affects the held formation, not the morph paths (which would smear the trajectories).
4. **Add per-particle alpha modulation.** Travel phase brightens particles slightly (they're "active"); hold phase has a subtle `sin(uTime * 0.4 + morphSeed * 6.28) * 0.08` flicker baked into `vAlpha`, so the held formation twinkles like a real swarm rather than reading as a flat sprite. Drift + settle: baseline alpha.
5. **Verify.** Smoke route: morph cycle now reads in pearl-green at rest, cyan when in transit, with a held formation that subtly twinkles. The cyan reads as state, not as decoration — at the moment of formation arrival, the tint should already be ramping back to green so the formation "settles into" green, not cyan.

### Exit gate

Color story communicates without legend: the operator's eye reads "in flight" during travel and "registered" at settle without being told. Pearl/green palette doesn't fight the page's pure-black background. Held formations don't read as frozen.

### Files touched

- `frontend/src/components/sign-in/shaders/swarm.frag.glsl` (rewritten)
- `frontend/src/components/sign-in/shaders/swarm.vert.glsl` (jitter term added)
- `frontend/src/components/sign-in/swarm-canvas.tsx` (one new uniform driven from `useFrame`)

---

## Phase 4 — Add Globe, Network Graph, Wordmark (~1 day)

Phase 1's bake script gets three more shape generators. The morph
engine doesn't change. This phase is mostly bake-script work + visual
review of the new silhouettes.

### Tasks

1. **Globe.** In bake script: build a `THREE.BufferGeometry` of 8 longitude meridians + 5 latitude parallels (line segments, no surface). Sample N=18000 points uniformly along the line lengths (not surface area, since this geometry has no surface). Same form-clearing rejection.
2. **Network graph.** New code path in bake script, no `MeshSurfaceSampler`.
   - Generate ~30 node positions in 3D via Poisson-disk sampling within a 3×3×3 cube. Util: implement a simple 3D Bridson Poisson-disk (or hand-code 30 randomised positions with min-distance rejection — 30 is small enough that brute force is fine).
   - For each node, find its 2-3 nearest neighbors → ~50 edges total. Store edge list.
   - Allocate N×0.6 = 10800 particles to nodes (Gaussian distribution per node, sigma ~0.08), N×0.4 = 7200 to edges (linear distribution along edges, with small lateral jitter).
   - Apply form-clearing rejection.
3. **Wordmark.** In bake script: build `THREE.ExtrudeGeometry` from a `THREE.ShapeGeometry` of the text "CORELLIA" rendered in Space Mono at the appropriate weight. Two options:
   - **Cleanest path:** ship a Space Mono font as `.ttf` in `frontend/scripts/assets/`, parse it with `three/addons/loaders/FontLoader.js` + `TextGeometry`. Adds one font file (~80KB) to the repo (not bundled — script-only, never reaches public/).
   - **Fallback:** if the Three font pipeline fights us, use HTML5 Canvas to render the text + `getImageData()` + sample N pixels weighted by alpha as 2D points → extrude depth via small Z jitter. Less crisp but no font dep. Try the clean path first; budget one hour before falling back.
   - Wordmark target is positioned in the lower third of the canvas (Y offset −1.5 in scene coords) — bake-time positioning, not runtime translation, so it composes "below the form" without runtime work.
4. **Re-run bake.** `pnpm -C frontend bake-shapes`. Six .bin files now under `public/sign-in/shape-targets/`. Total ~1.3MB raw, ~600KB gzipped on the wire. Commit.
5. **Verify each shape statically** via the Phase 1 smoke-render route extended to all six. Wordmark legibility is the gate that often fails first — if "CORELLIA" doesn't read at the silhouette's point density, the bake parameters need tuning (kerning, extrusion depth, point count allocated to wordmark vs other shapes).
6. **Update `morph-scheduler.ts`** weights to include the three new shapes. Wordmark stays at weight 1/7; globe and network at weight 1.

### Exit gate

All six shapes visibly land in the rotation. Wordmark is the rarest — appears once in roughly every 7 cycles when watching for 5+ minutes. Network graph reads as nodes-and-edges, not as a generic blob.

### Files touched

- `frontend/scripts/bake-sign-in-shapes.ts` (extended)
- `frontend/scripts/assets/SpaceMono-Bold.ttf` (new, script-only)
- `frontend/public/sign-in/shape-targets/{globe,network,wordmark}.bin` (new, committed)
- `frontend/src/components/sign-in/morph-scheduler.ts` (rotation weights updated)

---

## Phase 5 — Wire to `/sign-in` + Form Readability (~0.5 day)

Replace the throwaway test route with the real integration on `/sign-in`. Make sure the form stays AA-readable above the densest possible composition.

### Tasks

1. **Edit `frontend/src/app/sign-in/page.tsx`.**
   - Add `<SwarmBackground />` as the first child of `<main>`, before the existing `<header>`.
   - Change `<main>`'s class from `grid-bg` to a transparent equivalent — the swarm canvas replaces the grid-bg as the page background. Keep `relative` (the form is positioned relative to it).
2. **Layer order.** `<SwarmBackground />` is `fixed inset-0 -z-10`. `<header>` and `<TerminalContainer>` sit above it via the implicit `z-0`. The `TerminalContainer`'s existing translucent backdrop (or add a faint backdrop-blur if needed) provides the readability floor over any moments where the silhouette projects through the form.
3. **Add a faint radial vignette** behind the form via a single absolutely-positioned `<div>` with a CSS radial gradient: `bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.6)_0%,transparent_60%)]`. Sits between the canvas and the form (`-z-5`). This is the safety net for the worst case — e.g. octahedron at certain rotation angles projecting through the card centre.
4. **Delete `_test` smoke route.** `frontend/src/app/sign-in/_test/page.tsx` and any helpers used only by it.
5. **Verify form contrast.** Open `/sign-in` in dev. Watch one full rotation through chevron + octahedron + torus + globe + network + wordmark. EMAIL and PASSPHRASE labels readable throughout. Submit button readable. Error message readable. The form is the hero; the animation is wallpaper. If the form ever struggles, increase the vignette darkness from 0.6 to 0.75 — don't reduce particle count.

### Exit gate

`/sign-in` renders the full animation behind the form. Sign-in works. Form fields are AA-contrast through every shape in the rotation. No layout shift, no flash-of-unstyled-content during dynamic import (a brief black canvas while loading is acceptable; a layout flicker is not).

### Files touched

- `frontend/src/app/sign-in/page.tsx` (background + vignette wired in)
- `frontend/src/app/sign-in/_test/page.tsx` (deleted)
- (no other files)

---

## Phase 6 — Reduced Motion + Mobile + Perf Pass (~0.5 day)

Accessibility, mobile envelope, and a final perf check before tuning.

### Tasks

1. **`prefers-reduced-motion` fallback.** In `swarm-background.tsx`: detect via `window.matchMedia('(prefers-reduced-motion: reduce)')`. When true, skip the dynamic import entirely and render `<img src="/sign-in/reduced-motion.png" />` filling the viewport with `object-cover bg-black`. Generate the PNG by running the canvas in dev with the chevron forced to its hold phase, taking a 1920×1080 screenshot, and committing the file. ~150KB.
2. **Mobile particle count.** In `swarm-canvas.tsx`: detect viewport width via `window.matchMedia('(max-width: 768px)')` at mount. If true, use `PARTICLE_COUNT_MOBILE = 6000` from `shapes.ts`. Subsample the loaded shape targets — every Nth particle, pre-sliced once on load. No re-bake needed; the binaries are oversized for desktop and the mobile path takes a deterministic stride through them.
3. **`powerPreference: 'high-performance'`** on the WebGLRenderer config (if not already set in Phase 0). Forces discrete GPU on dual-GPU laptops.
4. **`depthWrite: false`** on the swarm material — particles use additive blending; depth-write costs cycles for nothing here.
5. **Throttle when tab not visible.** `useFrame` already pauses when the tab is inactive (R3F's default). Verify: open `/sign-in`, switch tabs, return — no time-jump artefacts (shape mid-morph at return).
6. **Perf measurement.** Open `/sign-in` in production mode (`pnpm -C frontend build && pnpm -C frontend start`). Chrome DevTools Performance recording, 10 seconds. Confirm: GPU frame time <8ms (well under the 16.67ms 60fps budget), no GC spikes, JS heap stable. If GPU is the bottleneck, the dial is `PARTICLE_COUNT` (drop to 12000 first). If CPU is the bottleneck, the dial is the morph scheduler's per-frame work — but it shouldn't be: 4 uniform writes is rounding error.

### Exit gate

Reduced-motion users see the static chevron PNG. Mobile users get 6K particles, still smooth. Production build profile shows comfortable headroom on a mid-range laptop. No console errors, no memory leak across 5+ minutes of running.

### Files touched

- `frontend/src/components/sign-in/swarm-background.tsx` (reduced-motion branch)
- `frontend/src/components/sign-in/swarm-canvas.tsx` (mobile particle count, perf flags)
- `frontend/public/sign-in/reduced-motion.png` (new, ~150KB)

---

## Phase 7 — Tuning Pass (~1 day)

The make-or-break. Everything before this phase produces a *technically
working* animation. This phase produces *the right* animation. The
brief flags this honestly: it sounds like polish, it isn't.

### Tasks (each is "look, decide, adjust")

The order matters: gross motion first, then color, then micro-detail.

1. **Cycle pacing.** Watch ten cycles. Is 18s per cycle right? Hold of 7s — long enough to *read* the formation, short enough not to bore? Travel of 4s — enough for the billow to register, fast enough to feel alive? Tune by feel. The dials live in `morph-scheduler.ts`.
2. **Trajectory bend strength.** Watch the travel phase. Bends too gentle → reads mechanical. Bends too strong → reads chaotic. The dial is the `* 0.6` constant on `trajectoryNoise * bendStrength` in the vertex shader. Aim for "billowing toward formation," not "swirling cloud" or "straight march."
3. **Stagger amount.** The `morphSeed * 0.25` term in `t = clamp((uMorphProgress - morphSeed * 0.25) / 0.75, 0, 1)`. Higher → more dramatic "drawing in" effect. Lower → formation snaps faster. Aim for the silhouette becoming legible roughly halfway through the settle phase, fully resolved by phase end.
4. **Cyan tint timing curve.** The 1.5s ramp-up + 0.5s ramp-down on `uCyanTint` is currently a guess. Watch ten travel-phase transitions. The cyan should peak around the moment of fastest particle motion (midway through travel) and be back to green by the moment of formation arrival. If the formation is still cyan when it reads as a chevron, the timing is wrong.
5. **Hold-phase rotation speed.** 0.05 rad/s = ~2 minutes per revolution. Faster → busier. Slower → flatter. Tune so a held shape is visibly rotating but not drawing the eye to the rotation itself.
6. **Hold-phase jitter amplitude.** 0.015 currently. Higher → buzzing. Lower → still. Aim for sub-pixel motion that's only visible when you stare at a single particle for 2+ seconds.
7. **Color mix ratios.** Pearl-to-green at 0.4, mix-to-cyan at travel peak. If the rest color reads too pearly (insufficiently Corellia), bump green mix to 0.5. If the cyan dominates, drop the cyan mix peak from 1.0 to 0.7.
8. **Vignette darkness.** From Phase 5. If the form ever struggles for contrast against the dense centre of the chevron silhouette, this is the dial.
9. **Wordmark frequency.** If it lands too often (more than 1 in 5 cycles in casual viewing), drop its weight from 1/7 to 1/10. If it never seems to land (you watched for 5 minutes), bump to 1/5. Adjust empirically.
10. **Amorphous interlude rate.** Currently 0.4 probability after each shape. If the rotation feels too busy, raise to 0.6. If it feels under-eventful, drop to 0.25.

### Exit gate

Watch the animation for 3 minutes without flinching. Show a colleague who hasn't seen it; they describe it as "alive, organised, expensive-looking" without being told what it is. The form is readable throughout. **The bar to clear is the brief's stated bar: matches Elephantasm's nebula in sophistication, reads as Corellia not as a sister product.** That's the success criterion; commit when it's met.

### Files touched

- All shader files (mostly numeric constants)
- `morph-scheduler.ts` (cycle timings, weights)
- `swarm-canvas.tsx` (uniform driver curves)
- `frontend/src/app/sign-in/page.tsx` (vignette darkness)

---

## Cross-cutting checks (every phase)

Run before every commit:

```bash
pnpm -C frontend type-check
pnpm -C frontend lint
pnpm -C frontend build           # only on phase-end commits
```

Visual smoke (every phase):

- `/sign-in` route loads without errors
- Sign-in flow still works against real Supabase (the animation cannot break the form)
- No console errors / warnings in the browser
- 60fps in dev mode on the dev machine

Bundle audit (Phase 5 + Phase 7 ends):

- `pnpm -C frontend build` output: `/sign-in` First Load JS budget. Pre-animation baseline ~120KB. Acceptable post-animation: ~270KB First Load JS (the R3F + three additions are dynamic-imported, so they show as a separate chunk, not in First Load). The 6 binary targets are not in the JS bundle at all — they're public/ static assets.

---

## Total estimate & shippability

| Phase | Estimate | Cumulative |
|-------|----------|-----------|
| 0 — Scaffolding | 0.5d | 0.5d |
| 1 — Bake + 3 shapes | 1.0d | 1.5d |
| 2 — Morph engine | 1.5d | 3.0d |
| 3 — Color | 0.5d | 3.5d |
| 4 — 3 more shapes | 1.0d | 4.5d |
| 5 — Wire to `/sign-in` | 0.5d | 5.0d |
| 6 — Reduced motion + mobile + perf | 0.5d | 5.5d |
| 7 — Tuning | 1.0d | 6.5d |

~6.5 focused days end-to-end. Realistically with context-switch
overhead, plan for 8–10 calendar days.

**Shippability checkpoints** — the work can ship at any of these
without the next phase being done:

- **End of Phase 5** is the minimum ship: full animation working on `/sign-in` with all six shapes, no a11y fallback, no mobile tuning, no Phase-7 polish. *Acceptable* if the schedule pinches; not the bar the brief asks for.
- **End of Phase 6** is the responsible ship: a11y + mobile + perf headroom. Reads as "complete v1" even without Phase 7's tuning.
- **End of Phase 7** is the brief's bar: matches the Elephantasm sophistication ceiling.

If the schedule is tight, **don't skip Phase 7** — skip a shape (drop `globe` or `network` from the rotation, ship 5 instead of 6). Polish-and-fewer beats unpolished-and-more on a screen this load-bearing for first impressions.

---

## What's deliberately not in this plan

- **No backend / proto / schema work.** Pure frontend.
- **No design-system token additions.** All colors come from existing `--primary` (green) and the cyan/pearl values are inline shader constants — they don't escape `/sign-in`, so they don't need to be tokens.
- **No new shadcn primitives.** The form is already shadcn; the canvas is direct three.js. They don't share styling concerns.
- **No tests.** v1 has no Playwright; the animation is verified visually each phase. A unit test of `morph-scheduler.ts`'s phase math would be the only sensible candidate, but at 100 LOC of branchless arithmetic, the test costs more than it saves. Defer until the scheduler grows behaviour worth pinning.
- **No Storybook / component playground.** The smoke-test route from Phase 0–4 is the playground; it's deleted in Phase 5.
- **No analytics on which shape the user saw.** Tempting to track but adds nothing to v1.
