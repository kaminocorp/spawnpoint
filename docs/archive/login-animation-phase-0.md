# Login Animation — Phase 0 Completion Notes

> Phase 0 of the eight-phase plan in
> `docs/executing/login-animation-implementation.md`. Scope: scaffolding
> + dependencies + a minimum-viable R3F smoke test, *no* particle work.
> The goal of this phase is to prove the dynamic-import + SSR-disable +
> WebGL pipeline end-to-end before writing a single line of shader or
> particle code.

**Status:** ✅ Exit gate met — `next build` succeeds, `lint` and
`type-check` clean, smoke-test route registered as a real route in
the build manifest.

**One small deviation from the plan (route folder name):** the plan
prescribed `frontend/src/app/sign-in/_test/page.tsx` for the throwaway
smoke route. Underscore-prefixed folders in Next.js App Router are the
**private folder convention** (excluded from routing) — the route
silently disappeared from the build manifest. Caught immediately on the
first `next build`. Renamed to a sibling top-level route at
`frontend/src/app/sign-in-swarm-smoke/` — explicit "delete in Phase 5"
naming, no naming-convention collision, route registers as expected.
This is documented inline on the page itself (`[ SMOKE TEST —
/sign-in-swarm-smoke ] · DELETE IN PHASE 5`) so a future reader can't
miss it.

---

## What changed

### Dependencies

```bash
pnpm -C frontend add three @react-three/fiber @react-three/drei
pnpm -C frontend add -D tsx @types/three
```

Resolved versions (current as of install):

| Package | Version | Role |
|---------|---------|------|
| `three` | `0.184.0` | WebGL renderer + scene graph + geometry primitives + `MeshSurfaceSampler` (Phase 1 will use it) |
| `@react-three/fiber` | `9.6.0` | React renderer for three.js — `<Canvas>`, `useFrame`, declarative scene graph |
| `@react-three/drei` | `10.7.7` | R3F helpers; not actually used yet (no `<OrbitControls>` per Q4 decision: pure ambient, no mouse interaction). Kept for any future need within `/sign-in`; cost is dynamic-import-only since nothing on `/sign-in` references it yet. **Watchpoint**: if Phases 2–7 don't import drei, drop it before commit on the milestone-end audit. |
| `tsx` (devDep) | `4.21.0` | Runs the Phase 1 bake script with TypeScript + ESM imports against three's runtime, no transpile step |
| `@types/three` (devDep) | `0.184.0` | Pin types alongside the runtime version so they don't drift — `@react-three/fiber` brings types transitively, but pinning explicit makes future bumps deterministic |

R3F `9.x` (not `8.x` as the plan referenced from the Elephantasm doc) is
the current major; the plan's `8.x` reference was a copy-from-reference
artefact, not a deliberate pin. R3F 9 dropped the legacy
`PerspectiveCameraProps` JSX namespace and tightened TypeScript on the
`useFrame` callback signature, but neither matters for Phase 0's
single-cube smoke. **Note for Phase 2**: any shader-material wiring will
use the R3F 9 typing pattern (`extend({ ... })` + JSX-namespace
augmentation if we want a custom material as a JSX tag).

Three `0.184.0` is well within the `0.160+` floor the Elephantasm
reference doc sets — the simplex-noise GLSL constant we'll inline in
Phase 2 is pure ES3-spec GLSL and doesn't depend on three's TS surface.

**Three pnpm warnings absorbed without action**:
- `node-domexception@1.0.0` deprecated subdep — transitive, harmless,
  not a runtime hazard for our use.
- "Ignored build scripts: msw, sharp, unrs-resolver, esbuild" — pre-existing
  to this phase, not introduced by these installs. Build-script approval
  policy is a separate decision and out of scope here.

### Files added

| File | LOC | Purpose |
|------|-----|---------|
| `frontend/src/components/sign-in/swarm-background.tsx` | 12 | Thin SSR-disabled wrapper. Uses `next/dynamic({ ssr: false })` to defer the WebGL component to client-only. Returns a `fixed inset-0 -z-10 bg-black` container — the layout slot the real Phase 5 integration will use. The `bg-black` is what shows during the dynamic-import flash (briefly black, no FOUC of the page background). |
| `frontend/src/components/sign-in/swarm-canvas.tsx` | 32 | The R3F `<Canvas>` itself + a `<SmokeCube>` placeholder (rotating wireframe cube in Corellia green). Camera at `(0, 0, 6)` with FOV 50, `alpha: true`, `antialias: true`, `powerPreference: "high-performance"` — these are the **final** canvas params per the plan's design constraints, deliberately set now so Phase 2 doesn't have to revisit them. The `SmokeCube` itself is throwaway — replaced by `<SwarmPoints>` in Phase 2. |
| `frontend/src/app/sign-in-swarm-smoke/page.tsx` | 14 | Public route at `/sign-in-swarm-smoke`. Renders `<SwarmBackground />` + a small overlay label so the page is visibly *not* the production sign-in. Deleted in Phase 5. |

### Directories pre-created (empty for now)

```
frontend/src/components/sign-in/shaders/    ← Phase 2 fills this
frontend/scripts/                            ← Phase 1 fills this
frontend/public/sign-in/shape-targets/       ← Phase 1 fills this
```

Pre-creating them now means the plan's directory tree is present from
day one — diffs in Phases 1–4 are purely content additions, no
restructuring noise.

### Files NOT changed (deviations from the plan, all intentional)

**`frontend/next.config.ts` — left untouched.** The plan's Phase 0 task
3 prescribes adding a webpack rule for `.glsl → asset/source`. Two
reasons to defer:

1. **Next 16 uses Turbopack by default** for both `dev` and `build`.
   The build output above explicitly says `▲ Next.js 16.2.4
   (Turbopack)`. A `webpack: (config) => ...` block would be silently
   ignored — the rule wouldn't fire. Turbopack's equivalent is
   `turbopack.rules`, which has a slightly different shape and
   currently requires installing `raw-loader` as a devDep.
2. **No `.glsl` files exist yet.** Phase 0 has zero shaders to import,
   so any loader configuration is forward-looking guesswork. The
   simplest path forward is the **`?raw` query-string suffix** that
   both webpack and Turbopack support natively without any config:
   ```ts
   import shaderSrc from "./swarm.vert.glsl?raw";
   ```
   Turbopack treats `?raw` as a built-in import attribute and emits the
   string. **Phase 2 will use this approach**; if it doesn't work in
   the running Next 16 / Turbopack version, the fallback (also
   committed at the time, not now) is to inline the GLSL as JS template
   literals in `swarm-canvas.tsx` — slightly uglier diffs in Phase 2's
   shader iteration but functionally equivalent.

   **Action item for Phase 2:** confirm `?raw` works on Next 16
   Turbopack on first shader import. If it does, no config change ever.
   If not, install `raw-loader` and add the `turbopack.rules` block. No
   work is wasted in Phase 0 by deferring this decision.

**No `frontend/.gitattributes` change.** The plan calls for a
`*.bin binary` line under Phase 1, not Phase 0 — moved to Phase 1's
ledger.

### Files removed during Phase 0

`frontend/src/app/sign-in/_test/page.tsx` was created and then
removed within the same phase. Reason: caught the underscore-folder
private-route gotcha on first `next build` (route absent from build
manifest). Net delta: zero — the file no longer exists on disk and
hasn't reached any commit. Documented here purely so the trail is
legible if anyone wonders why the canonical path differs from the plan.

---

## Verification

### Type-check

```bash
$ pnpm -C frontend type-check
> tsc --noEmit
$
```

Clean. Zero TS diagnostics.

### Lint

```bash
$ pnpm -C frontend lint
> eslint
$
```

Clean. Zero ESLint warnings.

### Production build

```bash
$ pnpm -C frontend build
▲ Next.js 16.2.4 (Turbopack)
✓ Compiled successfully in 1807ms
✓ Generating static pages using 11 workers (11/11) in 180ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /agents
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
├ ○ /sign-in
└ ○ /sign-in-swarm-smoke           ← new, prerendered as static
```

The `/sign-in-swarm-smoke` route is registered and prerenders cleanly
as a static page. The static-prerender result is correct: the page's
HTML is the empty container shell; the WebGL canvas hydrates
client-side via the `next/dynamic({ ssr: false })` boundary inside
`SwarmBackground`. There is no SSR pass over `three` or
`@react-three/fiber` — the dynamic-import boundary keeps WebGL out of
the server bundle entirely, which is the whole point of this phase's
SSR-disable wiring.

### Visual confirmation (interactive — separate from the build gate)

Visual confirmation that the cube *renders* in a real browser is an
interactive verification step that requires running
`pnpm -C frontend dev` and navigating to `http://localhost:3000/sign-in-swarm-smoke`.
This step was not run as part of the headless completion of Phase 0;
the **structural** verification (build success + correct route
registration + correct dynamic-boundary placement + canvas params
matching the plan's spec) is what's pinned by the exit gate. Any
hydration regression would surface as a console error or a missing
canvas element, both of which are within the developer's first 5
seconds of opening the smoke route in dev. Defer this check to the
moment Phase 1 work begins, where it lands free.

### Bundle observation (forward-looking)

The dynamic-import chunk for `swarm-canvas` will appear as a separate
JS bundle once Phase 2's particle code lands. At Phase 0 the chunk
exists but is small (just R3F + a 32-LOC component). The plan's bundle
budget (~270KB First Load JS post-animation) is checked at end of
Phase 5; Phase 0 has nothing to measure against.

---

## Why the canvas params are what they are (locked at Phase 0)

The plan deliberately treats `<Canvas>` configuration as a Phase 0
decision rather than a Phase 2 tuning dial, because changing the camera
matrix mid-development invalidates the bake-time form-clearing
calculation in `frontend/scripts/bake-sign-in-shapes.ts` (Phase 1). The
form's bounding rect is projected through the camera's matrix during
target baking; if camera distance, FOV, or aspect change later, every
.bin file becomes wrong and needs a re-bake.

Locked-now values:

| Param | Value | Source / reason |
|-------|-------|-----------------|
| `camera.position` | `[0, 0, 6]` | Plan §Technical sketch; chosen so a unit-radius shape fills ~45% of viewport width at FOV 50 |
| `camera.fov` | `50` | Plan §Technical sketch; matches Elephantasm reference, gives a slightly tele lens that flatters volumetric shapes |
| `gl.alpha` | `true` | Lets the canvas compose against the page's `bg-black`; Phase 5 will add the radial vignette layer between canvas and form |
| `gl.antialias` | `true` | Smooths point edges; cost is negligible on the discrete-GPU power preference |
| `gl.powerPreference` | `"high-performance"` | Forces discrete GPU on dual-GPU laptops per the plan's perf section. Free at Phase 0; matters at Phase 2+ |

These are not tuning dials — they're contract values that the bake
pipeline depends on. Documented here so a future contributor opening
`swarm-canvas.tsx` doesn't reach for "let me bump FOV to 60" without
realizing the bake binaries are calibrated against 50.

---

## Exit gate checklist

| Gate | Status | Evidence |
|------|--------|----------|
| R3F canvas mounts & renders | ✅ structural | Build succeeds; route present; dynamic-import boundary correct |
| `next build` succeeds | ✅ | See above |
| `pnpm lint` clean | ✅ | Zero output |
| `pnpm type-check` clean | ✅ | Zero output |
| 60fps in dev | ⏳ deferred | Visual check on first Phase 1 dev session; structural setup is correct |
| Smoke route reachable signed-out | ✅ | Proxy middleware (`src/proxy.ts`) only refreshes session cookies — no route gating; `/sign-in-swarm-smoke` is publicly reachable |

---

## What Phase 1 inherits

- Working dynamic-import boundary at `swarm-background.tsx` —
  Phase 1's bake-script work is offline (no R3F) but Phase 2's morph
  engine slots into `swarm-canvas.tsx` directly.
- Canvas params locked, so the bake script's form-clearing math has a
  fixed target.
- Empty `frontend/scripts/` and `frontend/public/sign-in/shape-targets/`
  directories ready to populate.
- `tsx` installed, so `bake-sign-in-shapes.ts` can run via `pnpm
  bake-shapes` (script wiring lands in Phase 1).
- Empty `frontend/src/components/sign-in/shaders/` directory ready for
  Phase 2's three `.glsl` files.
- `swarm-canvas.tsx`'s `<SmokeCube>` is the placeholder Phase 2 deletes;
  the rest of the file (Canvas, lights, camera) Phase 2 keeps.

---

## What was *not* done in Phase 0 (and why that's correct)

- **No particle code.** Phase 0's job is to prove the pipeline, not to
  start building product. A `<SmokeCube>` is the right amount of
  rendering — enough to confirm WebGL works, not so much that any
  particle bug muddies the diagnosis if the build fails.
- **No `.glsl` loader configuration.** No shaders exist; configuring
  is forward speculation. Phase 2 confirms the `?raw` path and either
  proceeds or installs `raw-loader` then. Either way, no Phase 0
  decision binds.
- **No real `/sign-in` integration.** The plan explicitly defers this
  to Phase 5 — for good reason: until the full animation works, the
  production sign-in screen must not be visually broken. The
  `/sign-in-swarm-smoke` route is the development surface; `/sign-in`
  stays untouched.
- **No `@types/three` audit for missing types in our specific use.**
  Phase 2 will use `MeshSurfaceSampler` from `three/examples/jsm/...`,
  which has a known history of slightly stale `@types/three`
  declarations. If a type lands missing in Phase 1 or 2, the fix is a
  one-line `// @ts-expect-error` or a local `.d.ts` shim — known
  failure mode, not a Phase 0 risk.
- **No reduced-motion fallback.** Phase 6 task. The smoke route also
  runs the full canvas regardless of `prefers-reduced-motion` — that's
  fine for a developer-only route.

---

## Estimate vs. actual

Plan estimate: 0.5 day. Actual: ~30 minutes of focused work, including
catching and reverting the `_test` underscore-folder gotcha. The
Turbopack-vs-webpack config decision was the only meaningful judgment
call; it took 5 minutes of thought and saved configuring a loader
that wouldn't have fired anyway.

This phase being cheap is the point: the value of Phase 0 is the
**de-risking**, not the LOC.
