# Completion — Spawn page redesign, Phase 2: `<NebulaAvatar>` component (visual scaffold, no integration yet)

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 2
**Date:** 2026-04-26
**Scope:** FE-only, **component-only**. Zero backend, proto, schema, env, or dependency change. The component is built and validated in isolation; it is **not yet imported** into any route — that wiring lives in Phase 3 when the roster page is rewritten.
**Validation:** `pnpm -C frontend type-check && lint && build` all green.

---

## What Phase 2 delivers (per plan)

> A drop-in `<NebulaAvatar harness="hermes" size={240} />` component that renders a green-dominant volumetric particle nebula, lazy-mounted on intersection, gracefully degrading to SVG.

The phase is a **visual scaffold**: the component is the building block. Phase 3 hands it to the active card on the new roster grid; Phase 4 hands a smaller copy to the wizard's Step 1 confirmation. The component is operator-side dark today — no live route renders it yet.

---

## Files added (5 new)

### `frontend/src/lib/spawn/mood-palettes.ts` — typed `MoodPalette` + Hermes data

The palette type per decision 5: per-harness divergence is *only* in colour palette + spatial weights. Particle counts, Gaussian sigma, octave frequencies, rotation speeds stay shared constants in the shader/scene so every harness reads as part of the same visual family.

The `MoodPalette` shape codifies five things: `pearl` base RGB, four accent `tints`, four mutually-irrational sine `frequencies` (the same set elephantasm uses — 0.037 / 0.023 / 0.043 / 0.029 — so the macro colour cycle is minutes-long with no perceptible loop), four mix `intensities` (Hermes' first tint is dominant per decision 6), `(x, y, depth)` `spatialWeights` for the per-fragment seed, and a `fallbackAccentHsl` CSS string for the SVG fallback's stroke.

Hermes' palette is the literal table from decision 6 — green dominant `(0.45, 0.72, 0.50)` (Corellia's `--primary`/`--status-running` `142 71% 45%`), cyan accent `(0.40, 0.75, 0.78)`, violet accent `(0.55, 0.45, 0.80)`, amber warmth `(0.85, 0.65, 0.35)`, pearl base `(0.93, 0.91, 0.96)`. Intensities `(0.30, 0.18, 0.15, 0.12)` push green hardest so the cloud reads as "agents-feature green" per design-system §5.4 even when the other tints are momentarily peaking.

`HarnessKey` is currently the literal type `"hermes"` — Phase 3 widens it to the `§3.5` six-harness lineup (Hermes + OpenClaw + Claude Agent SDK + DeepAgents + SuperAGI + OpenFang). Locked harnesses use the SVG fallback (decision 13), so those palettes only matter for the fallback's accent stroke until a harness gets promoted to `AVAILABLE`.

### `frontend/src/components/spawn/avatar-fallback.tsx` — static SVG fallback

A 240×240 SVG schematic: hairline concentric "pearl" ellipses + a soft radial halo, all in the harness's accent stroke. No JS, no canvas, no shader compile — cheap to mount in any quantity. Used by:

- The wrapper when `prefers-reduced-motion: reduce` is set (decision 16: no half-states; honest motion register per design-system §28).
- The wrapper when WebGL isn't available on `window`.
- Phase 3's `<RosterCard locked />` for every locked harness (decision 13: performance ceiling).

Accent colour comes from `paletteFor(harness).fallbackAccentHsl`, so even though the component doesn't animate, it's still recognisably "the same harness" as the live nebula would render.

### `frontend/src/components/spawn/nebula-shaders.ts` — vertex + fragment GLSL strings

Adapted from `docs/refs/elephantasm-animation.md`, downsized for a card-sized avatar. **Two layers**, not three (Wisp Tendrils dropped per Phase 2 plan — too soft to read at 240px):

- **PrimaryCloud** vertex shader: 3-octave noise displacement (low / mid / high frequencies at 0.8 / 2.2 / 6.0 spatial scale) modulated by `uLowAmp`, `uMidAmp`, `uCoherence` uniforms; bright-core / faint-edge alpha curve via `smoothstep` + a dual-sine flicker keyed off per-particle `phase` so particles don't twinkle in unison; per-particle `pSize` for natural size variance. Outputs `vAlpha`, `vDisplaced`, `vDepth` to the fragment.
- **PrimaryCloud** fragment shader: pearl base + 4-tint mix where each tint's mood oscillates at its irrational `uTintFreq.x/y/z/w` and the **spatial seed** `vDisplaced.x*wx + vDisplaced.y*wy + vDepth*wd` makes colour flow through the form rather than uniformly pulse. The whole palette ships as uniforms so per-harness tuning is data, not GLSL — Phase 3's other harnesses won't need a shader recompile per palette.
- **CoreMotes** vertex shader: high-freq jitter only (8.0 spatial scale, 0.7–0.9 time speed, 0.04 amplitude) — the buzzing-core contrast against the slow-moving primary; brighter alpha range (0.30–0.85) with a phase-keyed flicker.
- **CoreMotes** fragment shader: simple warm/cool oscillation between `(1.00, 0.88, 0.78)` and `(0.82, 0.88, 1.00)` — no per-harness palette here; the core is the heartbeat, deliberately consistent across harnesses.

Both layers share the **same** `SIMPLEX_NOISE_GLSL` constant via import from `@/components/sign-in/shaders/simplex-noise`. See *Open seam* below for the rationale.

### `frontend/src/components/spawn/nebula-scene.tsx` — inner R3F scene

Default-exported (so it's `dynamic()`-importable as a single chunk). Three pieces:

- `gaussianSphere(count, sigma)` — Box-Muller radial Gaussian + uniform spherical angles. Most particles cluster near centre with a natural density falloff, no hard boundary.
- `<PrimaryCloud palette>` — 2.5K particles, sigma 0.42, palette-derived uniforms baked once via `useMemo`, animation uniforms updated per frame in `useFrame` from the elephantasm CPU loop verbatim (`lowAmp = 0.45 + 0.22*sin(t*0.031) + 0.12*sin(t*0.053+1.2)`, etc.). Group rotation `y = t*0.05`, `x = t*0.02` per Phase 2 plan — gentler than elephantasm's source rate because the avatar is small and a slower spin reads as "calm signature" rather than "spinner."
- `<CoreMotes>` — 500 particles, sigma 0.098 (very tight, per elephantasm's "effective sigma ~0.098"), no palette prop (decision 5: core is shared across harnesses). Rotation `y = t*0.07`, `x = t*0.025` — slightly faster than the primary cloud, so the differential creates inner-body parallax.
- Default-exported `<NebulaScene palette>` wraps both in a `<Canvas>` at `position: [0, 0, 3.2]`, `fov: 50` (frames the cloud to ~70% of the 240px square), `gl: { antialias: true, alpha: true, powerPreference: "high-performance" }`. `<ambientLight intensity={0.15} />` is essentially decorative — the `ShaderMaterial`s ignore lighting — but mirrors the elephantasm reference and matches the existing sign-in canvas convention.

Both materials use `transparent`, `depthWrite={false}`, `blending={AdditiveBlending}` — overlapping particles accumulate light rather than occlude, so dense regions glow brighter without hard silhouettes (the trick that makes the nebula read as "luminous cloud" instead of "stippled sphere").

### `frontend/src/components/spawn/nebula-avatar.tsx` — public wrapper

The branch ladder (decision 4 + decision 16):

1. `prefers-reduced-motion: reduce` → SVG fallback. No canvas mount, no dynamic import.
2. WebGL2 not detected on `window` → SVG fallback. No canvas mount.
3. Off-screen with IO available → render `null` (lazy mount). Canvas mounts when the IO callback fires inside `rootMargin: 120px` so the cloud is already breathing by the time the operator scrolls it into view.
4. Otherwise → live R3F canvas (`<NebulaScene palette={paletteFor(harness)}>`).

Three subtleties worth recording:

- **`useSyncExternalStore` for static feature flags.** The first cut used `useEffect` + `setState` for both the WebGL availability check and the no-IO eager-mount fallback. Eslint's `react-hooks/set-state-in-effect` rejected both — same rule, same correct reason as 0.8.1's fleet-view-pref encounter (synchronous setState in an effect body cascades a re-render). Fix: move both feature checks behind `useSyncExternalStore` with a no-op subscribe (`() => () => undefined`), since neither WebGL availability nor `IntersectionObserver` presence changes within a session. This also resolves the SSR/hydration mismatch concern — `getServerSnapshot` returns `true` (optimistic) so the server HTML matches the most-likely-correct client first render. The IntersectionObserver subscription itself stays in `useEffect` because that *is* a real external-system subscription, and `setInView(true)` lives inside the observer callback (not the effect body) which is the sanctioned pattern.
- **No-IO browsers fail open.** Old browsers without `IntersectionObserver` skip the lazy-mount optimisation entirely and render the scene immediately (`shouldRenderScene = !showFallback && (inView || !hasIO)`). They are rare enough that a third branch with a polyfill or scroll-listener fallback isn't worth the code; the conservative path of "if you can't lazy-mount, eager-mount" is correct.
- **Decision 21 is a page-level concern.** The wrapper will mount more than one canvas if the parent asks. Phase 3's roster page enforces "one canvas per page" by only handing `<NebulaAvatar>` to the active harness card; locked cards render `<AvatarFallback>` directly.

The dynamic import lives outside the component body, so the three.js chunk only enters the bundle once per route, not per `<NebulaAvatar>` instance. `loading: () => null` gives the IO lazy-mount window something to render while the chunk fetches.

---

## Why this exact set of files, and not more

Plan §4 Phase 2 is precise — five things ship, in the listed shape:

- ✅ `nebula-avatar.tsx` (default-exporting `NebulaAvatar` wrapper, RM gate, IO lazy-mount, dynamic import)
- ✅ `nebula-scene.tsx` (inner R3F scene, dynamic-imported, two-layer composition)
- ✅ `mood-palettes.ts` (typed `MoodPalette`, Hermes per decision 6)
- ✅ `avatar-fallback.tsx` (SVG schematic with palette-derived accent)
- ✅ Shaders inlined as string constants (per the elephantasm convention — one file each for primary + core, both vertex and fragment)

Things I deliberately did **not** do:

- **No new dependencies installed.** `three`, `@react-three/fiber`, `@react-three/drei` were all already in `package.json` from the sign-in animation. Decision 2 budget (≤200 KB gzip from R3F + three) was already paid by sign-in; Phase 2's marginal cost is just the shader strings + scene component (~3 KB minified). Decision 18's audit lever is therefore not active for this phase — there's nothing to audit. Phase 3 will re-check when the roster page actually pulls the chunk into a route.
- **No drei.** Plan §4 Phase 2 explicitly says: *"Drop drei unless decision 18's audit requires it for `<OrbitControls>` — we don't use OrbitControls per decision 16."* I confirmed: zero drei imports in the new files. `pnpm` keeps drei installed because sign-in might still use it; we don't touch its sign-in usage.
- **No dev preview page.** Plan mentioned an optional `/spawn/_dev/page.tsx` for visual side-by-side review, with the explicit instruction "Delete before merge." Skipped entirely — the wrapper is independently testable in Phase 3 by just running the dev server with the roster wired up.
- **No `<NebulaAvatar>` import anywhere yet.** Phase 3 wires it into the roster page; Phase 4 wires a smaller copy into the wizard's Step 1. The component is dark today.
- **No changes to sign-in's existing R3F surface.** `swarm-canvas.tsx`, `swarm-points.tsx`, `swarm-vert.ts`, `swarm-frag.ts`, `simplex-noise.ts`, `swarm-background.tsx`, `reduced-motion-still.tsx` — all unchanged. The new spawn nebula is a sibling under `components/`, not a refactor of an existing one.
- **No CLAUDE.md / changelog update.** Phase 6 owns the doc reconciliation. Updating now would create drift if Phases 3–5 introduce additional component-shape changes.

---

## Open seam: simplex-noise constant lives under `sign-in/`

`nebula-shaders.ts` imports `SIMPLEX_NOISE_GLSL` from `@/components/sign-in/shaders/simplex-noise`. Two callers (sign-in's swarm + spawn's nebula) now share one constant — a generic Ashima/webgl-noise GLSL string, not a sign-in-specific implementation detail. This is a known seam:

- **Why import (vs duplicate):** Two ~70-line copies of the exact same GLSL would be true duplication. Importing keeps a single source of truth for the noise function; if it ever needs a fix (it won't — it's stable Ashima reference code), one edit propagates.
- **Why import (vs lift to `lib/shaders/`):** Lifting now would require touching two files in the sign-in tree — `swarm-vert.ts`'s import path and `shaders/index.ts`'s re-export — for a refactor that is not required by Phase 2. Per project convention, refactors stay out of feature work unless the feature requires them.
- **What to do when the third caller arrives:** Lift the constant to `frontend/src/lib/shaders/simplex-noise.ts`, update both the sign-in vert shader and the spawn nebula shader to import from the new path. Three-line refactor; no behaviour change.

Recording this here so the next contributor doesn't re-litigate the decision when they see a `spawn/` file importing from `sign-in/`.

---

## Validation evidence

```
pnpm -C frontend type-check    # tsc --noEmit, exit 0
pnpm -C frontend lint           # eslint, exit 0 (after the useSyncExternalStore refactor)
pnpm -C frontend build          # next build, exit 0
```

`next build` route table is **byte-identical** to Phase 1's — no new pages, no new client chunks pulled into any route. That's the expected outcome: the component is built but not imported anywhere yet.

The first lint pass failed with two `react-hooks/set-state-in-effect` errors (logged in the conversation) on the WebGL detection effect and the IO-fallback eager-mount call. The fix — see *nebula-avatar.tsx* above — moved the static feature flags behind `useSyncExternalStore` and removed the synchronous `setInView(true)` from the effect body in favour of a render-time `(inView || !hasIO)` predicate. This is the same pattern 0.8.1 used for `useFleetView`; the lesson the 0.8.1 completion notes flagged ("don't regress to the effect pattern when adding the next localStorage-backed preference") generalised cleanly to "don't regress to the effect pattern when adding the next static feature flag."

A bundle-size delta audit per decision 18 is **deferred to Phase 3** — Phase 2 produces no route-level delta, so the audit number would be zero. Phase 3's `pnpm -C frontend build` will show the spawn page pulling the R3F chunk for the first time and that's the audit point that matters.

---

## Phase 2 exit criteria — status

Per plan §4 Phase 2:

- ✅ Deps unchanged (`three`, `@react-three/fiber` already present from sign-in).
- ✅ `nebula-avatar.tsx` exists with `prefers-reduced-motion`, IntersectionObserver lazy-mount, SVG fallback.
- ✅ `nebula-scene.tsx` is dynamic-imported with `ssr: false`.
- ✅ Two layers: `<PrimaryCloud>` (~2.5K pts) + `<CoreMotes>` (~500 pts). Wisp Tendrils dropped.
- ✅ Uniforms `uTime`, `uLowAmp`, `uMidAmp`, `uCoherence` per the recipe; animation loop matches elephantasm's irrational-frequency pattern.
- ✅ Auto-rotate `y = t * 0.05`, `x = t * 0.02`; no `<OrbitControls>`.
- ✅ `prefers-reduced-motion` short-circuits before the dynamic import (the dynamic-imported chunk never loads on reduced-motion clients).
- ✅ `mood-palettes.ts` defines `MoodPalette` + Hermes per decision 6.
- ✅ `avatar-fallback.tsx` ships as the static SVG schematic.
- ✅ `pnpm -C frontend type-check && lint && build` all green.

Bundle-size budget audit (decision 18): not applicable yet — no route imports the component. Will run in Phase 3.

Visual review with `prefers-reduced-motion: reduce`: not run (no live route renders it yet). Phase 3 is the natural moment for the first manual smoke pass.

---

## What unblocks Phase 3

Phase 3 (`Roster page`) imports `<NebulaAvatar harness="hermes" size={240} />` into the new `<RosterCard>` for the active card, and `<AvatarFallback harness={...} size={240} />` directly into each locked card. The component contracts are stable: no breaking changes are anticipated as the harness palette set widens to the §3.5 lineup (just additions to `MOOD_PALETTES` + `HarnessKey`).

The two open scope notes Phase 3 will absorb naturally:

- **Bundle-size audit.** Run `pnpm -C frontend build` and note the spawn route's gzipped JS delta vs Phase 1's. Decision 18 budget: ≤200 KB gzip.
- **Visual smoke pass.** First moment a real route renders the nebula. Worth checking on a mid-range desktop profile + with DevTools' `prefers-reduced-motion: reduce` rendering toggle to confirm the fallback path.

---

## Known pending work (Phase-2 scope)

- **No automated test for the component.** Consistent with v1's testing posture (no Playwright; the deployed RPC round-trip is the integration smoke).
- **`HarnessKey` is `"hermes"` only.** Phase 3 widens it to the six-harness §3.5 lineup along with the per-harness palettes. The shape of `MoodPalette` is stable; additions are pure data.
- **Bundle-size delta is unmeasured.** Until a route imports the component, the delta is zero. Phase 3 audit covers this.
- **No live render path tested.** Component compiles cleanly but has not been pixel-validated. Phase 3's manual smoke pass is the first opportunity.

---

## Supersedes

Nothing — Phase 2 is purely additive. The existing `frontend/src/components/agent-template-card.tsx` and `frontend/src/components/coming-soon-harness-card.tsx` are still in use on the spawn page (which Phase 1 left in M4 shape). Phase 3 replaces them with `<RosterCard>`; this phase doesn't touch them.
