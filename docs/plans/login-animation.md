# Login Screen Animation — Design Directions

> **Goal.** Drop a 3D, ultra-refined, ambient animation onto `/sign-in` that
> hits the sophistication bar set by Elephantasm's nebula
> (`docs/refs/elephantasm-animation.md`) — but reads as **Corellia**, not as
> a sister product. The form (`AUTHENTICATE` terminal container, EMAIL +
> PASSPHRASE + `› AUTHENTICATE`) stays where it is; the animation lives
> behind it as a full-bleed background.

---

## Aesthetic constraints (non-negotiable)

These come from `docs/refs/design-system.md`.

1. **Mission control, not stellar nebula.** Operators watching systems
   work. Schematics, telemetry, lattices, swarms — *not* a luminous
   pearlescent breathing organism. Pearl is the Kamino *family* register;
   Corellia's variant is more austere.
2. **Brand green `#22c55e` is load-bearing.** Cyan / violet / blue / rose
   / amber are reserved for domain wayfinding. The login screen has no
   domain — so green is the only accent that "belongs" there. Other
   colors can appear as *transient state hints* (a particle in transit
   tints cyan because it's in a "spawn" state) but must not dominate.
3. **Pure black background.** Additive blending reads cleanly on
   `#000000`; that part of the Elephantasm recipe carries over.
4. **"Alive, not showy."** Continuous ambient motion at the level of a
   monitoring dashboard's quiet hum, *not* a tech-demo screensaver. Even
   the "wow" beats emerge from a slow rhythm, not abrupt cuts.
5. **Form readability is the gating constraint.** Behind the centred
   `TerminalContainer` card the animation must drop in luminance enough
   that EMAIL / PASSPHRASE inputs stay AA-readable. Solved structurally
   in the recommended direction (silhouettes are sampled to *avoid* the
   central rectangle the form occupies — see Direction D §Layout).

## Metaphor: what Corellia is, abstractly

Corellia spawns and governs **swarms of agents across infrastructure**.
Whatever runs on the login screen should communicate, even pre-attentively:

- **Multitude** — many discrete entities, not one cloud
- **Orchestration** — they're organised, related, under coordinated control
- **Reconfigurability** — the same fleet can be reshaped to different jobs
- **Spawn dynamics** — formations come together and dissolve

A drone-swarm choreography (Olympics-grade light shows, Intel/EHang
formations) maps onto all four properties: each light is a discrete
agent; the formation is the orchestration; the morph between formations
*is* the reconfigurability and spawn dynamics. It is also the most
viscerally impressive particle pattern most viewers have actually seen
in real life, which is exactly the bar the brief sets.

---

## Direction D — Drone-Swarm Choreography (recommended)

> **One-line read.** A swarm of ~18,000 luminous points drifts in
> formless ambient cloud, then — every ~18 seconds — converges into a
> schematic 3D silhouette (a chevron, an octahedron, a torus, a network
> graph, the CORELLIA wordmark), holds the shape for a beat, dissolves
> back into formless drift, and reforms into the next silhouette.

### What you see — moment by moment

A single morph cycle (~18s), repeated through a sequence of target
shapes in irrational-period rotation:

| Phase | Duration | What happens |
|-------|----------|--------------|
| **Drift** | 4s | Amorphous swarm, low-amplitude noise displacement around each particle's *current* position (held from the prior shape). Particles meander; the silhouette quietly disintegrates from the inside. Color: pearl with subtle green tint. |
| **Travel** | 4s | Each particle accelerates toward its assigned position in the *next* shape. Trajectories are noise-perturbed straight lines (not literal straight lines — that would look mechanical), so the swarm reads as billowing toward the new formation. Color tints toward cyan during travel — a *transient state* signalling "in flight," consistent with cyan being the catalog/spawn domain color. |
| **Settle** | 3s | Trajectories ease out; particles arrive at their target positions and snap into formation. Color cross-fades back from cyan to green. |
| **Hold** | 7s | The recognisable shape sits in 3D, slowly rotating around its vertical axis (~0.05 rad/s). Each particle still has micro-jitter (Elephantasm-style high-frequency noise at amplitude 0.015) so the formation is *alive*, not frozen. The wordmark beat holds longer (~12s) when it appears. |

The cycle then repeats with the next shape in the rotation. The
*drift* phase of cycle N+1 starts from the *settled* positions of cycle
N, so the dissolve is continuous — no cuts, no fades.

### Shape rotation

A small library of schematic 3D silhouettes that read as Corellia
without descending into corporate-mascot territory:

1. **Amorphous swarm** (the rest state — never a "shape" per se, used as
   palate cleanser between any two shapes when the rhythm needs a beat)
2. **`›` chevron** — Corellia's signature glyph (per design-system.md
   §27, the universal action indicator). A 3D extruded chevron rendered
   as a particle-filled silhouette. Most instantly readable shape in
   the rotation.
3. **Wireframe octahedron** — schematic primitive. Reads as
   "one deployable unit." Particles trace edges + sparse interior fill.
4. **Torus** — fleet / orbit. Particles distributed around a thin
   toroidal volume; rotates around its own axis (in addition to the
   scene rotation), reads as an actively running ring of agents.
5. **Network graph** — ~30 large "node" clusters in 3D space, each a
   tight Gaussian of particles, with thin particle-traced edges between
   nearest neighbors. Reads as control-plane topology. Most literal
   product reference in the rotation.
6. **Wireframe globe** (latitude-longitude grid) — multi-region deploy.
   Particles trace the 8 longitude meridians + 5 latitude parallels.
7. **Wordmark `CORELLIA`** — brand beat. Uppercase Space Mono,
   `tracking-[0.3em]`, particle-traced from a 3D-extruded text
   silhouette. Only appears every ~2 minutes (one in seven cycles), not
   every loop — too frequent and the screen feels like a brand
   sizzle reel.

Sequence example (irrational-period scheduler picks the next shape;
this is just a representative slice): `amorphous → chevron → amorphous
→ octahedron → torus → amorphous → network → globe → amorphous →
chevron → amorphous → wordmark → ...`. The amorphous interludes are
not every cycle; they break the rhythm at unpredictable beats.

### Layout — how the swarm composes around the form

The login form (a ~360px-wide `TerminalContainer` card) sits at viewport
centre. The animation canvas is full-bleed behind it. **Silhouettes are
target-baked to avoid the central card region**: when sampling N target
positions from each shape's volume, any sample whose 2D screen-projection
falls inside the card's bounding rect (plus 24px padding) is rejected
and resampled outside. This is done once per shape at bake time, not
per frame.

The structural consequence is that the chevron's inner fill,
the octahedron's centre, the torus's inner hole, etc. all naturally clear
the form area. The wordmark beat is *positioned below the form*
(silhouette baked centred in the lower third of the canvas), so when
"CORELLIA" reads, it reads as the floor caption to the AUTHENTICATE
panel — not as a logo behind the form.

The amorphous drift state has no central density, so it composes
trivially.

### Why it reads as Corellia

- The swarm itself is the agent fleet (multitude ✓)
- Formation morphs are the control plane reconfiguring the fleet
  (orchestration + reconfigurability ✓)
- The cyan-tinted travel phase is the literal `pending` state from
  `agent_instances.status` — particles "in flight" before they
  "register" with the next formation (spawn dynamics ✓)
- The shape vocabulary is the product's iconography (chevron, network
  graph, wordmark) — visual proof that this is *Corellia*, not generic

A user who has never read the docs sees "an enormous coordinated swarm
that keeps reshaping itself under invisible orchestration." A user who
has read the docs sees the literal product.

### Technical sketch

#### Particle system

- Single `THREE.Points` with ~18,000 particles (counts adjustable per
  perf tier; mobile drops to ~6,000).
- Per-particle attributes (all set once at init, mutated on
  shape-change only — never per frame on CPU):
  - `currentPosition` (vec3) — where the particle is *now* (lives in
    the buffer, updated by writeback at end of each cycle)
  - `targetPosition` (vec3) — where it's heading in the current morph
  - `previousTarget` (vec3) — where it came from
  - `morphSeed` (float) — per-particle constant for staggered easing,
    so the swarm doesn't move in unison (the same trick Elephantasm
    uses with its `phase` attribute)
  - `trajectoryNoise` (vec3) — per-particle constant offset that bends
    its travel-phase path so the swarm billows rather than flying in
    straight lines

- Per-frame uniforms (CPU updates 4–5 floats per frame, nothing more):
  - `uMorphProgress` (0–1, eased by phase) — the master clock for the
    drift/travel/settle interpolation
  - `uPhase` (0/1/2/3 for drift/travel/settle/hold) — picks the
    appropriate easing curve in the vertex shader
  - `uTime` — for ambient micro-jitter during the hold phase
  - `uCyanTint` (0–1) — drives travel-phase color shift

#### Vertex shader (the load-bearing part)

```glsl
// Per-particle staggered timing — last 25% of particles arrive after first 25%
float t = clamp((uMorphProgress - morphSeed * 0.25) / 0.75, 0.0, 1.0);
float eased = smoothstep(0.0, 1.0, t);

// Bezier-like path: linear interpolate, then add per-particle bend perpendicular
// to the path so the swarm billows rather than flying straight
vec3 straight = mix(previousTarget, targetPosition, eased);
float bendStrength = sin(eased * 3.14159);  // peaks at midpath, zero at endpoints
vec3 bent = straight + trajectoryNoise * bendStrength * 0.6;

// Hold-phase ambient jitter (Elephantasm's high-frequency octave, scaled tiny)
vec3 jitter = vec3(
  snoise(targetPosition * 8.0 + vec3(uTime * 0.7)),
  snoise(targetPosition * 8.0 + vec3(uTime * 0.6 + 10.0)),
  snoise(targetPosition * 8.0 + vec3(uTime * 0.8 + 20.0))
) * 0.015 * float(uPhase == 3);

displaced = bent + jitter;
```

The `morphSeed` stagger is what makes the formation *coalesce* visibly
rather than snap — the leading 25% of particles arrive while the
trailing 25% are still mid-travel, so the silhouette draws itself in a
visibly time-extended sweep.

#### Target baking (offline pipeline)

For each shape in the rotation, generate an array of N=18,000 target
positions:

- **Chevron, octahedron, torus, globe, wordmark.** Build a
  `THREE.Mesh` from the silhouette (extruded geometry for chevron and
  wordmark; primitive geometry for the rest). Sample N points uniformly
  on the mesh surface using a barycentric sampler weighted by triangle
  area. Reject samples whose 2D screen-projection (under the scene's
  fixed camera matrix) falls inside the form's bounding rect. Refill
  to N.
- **Network graph.** Generate ~30 node positions in 3D via
  Poisson-disk sampling within a viewport-fitting volume; assign
  N×0.6 particles to nodes (Gaussian distribution per node), N×0.4
  particles to edges (linear distribution along ~50 nearest-neighbor
  edges).
- **Amorphous.** No bake — target = currentPosition + low-frequency
  noise drift.

Bake outputs are written to `frontend/public/sign-in/shape-targets/*.bin`
as raw `Float32Array` buffers (one file per shape, ~216KB each: 18K
points × 3 floats × 4 bytes). Total bundle adds ~1.3MB across 6 shapes,
loaded lazily on `/sign-in` only, parsed once into typed arrays.

The bake script lives at
`frontend/scripts/bake-sign-in-shapes.ts` and is run manually before
commit (not on every build — targets are committed binaries). Re-bake
is needed only when a shape's silhouette changes.

#### Color

- **Drift / settle / hold:** pearl base `vec3(0.85, 0.92, 0.85)`
  tinted toward brand green `#22c55e` by `mix(pearl, green, 0.4)`.
- **Travel:** color cross-fades from green toward cyan `#06b6d4` and
  back over the 4-second travel phase, controlled by the `uCyanTint`
  uniform.
- No spatial iridescence (Elephantasm's 4-mood palette belongs to the
  pearlescent register; Corellia's mission-control register does not
  want it).

#### Rotation, camera, scene

- Camera fixed at `(0, 0, 6)` with FOV 50, no `OrbitControls`. The
  interactive surface on this page is the form, not the canvas.
- Scene-level rotation: very slow, `y = t * 0.05`, `x = 0`. Just
  enough that held shapes don't read as flat.
- Optional subtle parallax: camera nudges 1–2° in response to cursor
  position (decision pending — see Question 4 below).
- Canvas is 100vw × 100vh, `alpha: true` so it composes against the
  page's `#000000` background, `antialias: true`,
  `powerPreference: 'high-performance'`.
- Single ambient light at intensity 0.15 (vestigial — the
  ShaderMaterial does its own lighting math).

### Failure modes / honest risks

1. **Brand-sizzle-reel risk.** If the shape rotation features the
   wordmark every cycle, or if the shapes are too literally "logo-y,"
   the screen reads as a marketing splash, not a control-plane login.
   *Mitigation:* the rotation is dominated by *schematic* primitives
   (chevron, octahedron, torus, network graph, globe — all neutral
   technical iconography); the wordmark beat appears once per ~7
   cycles. Network graph and chevron carry the product story; the
   wordmark is the rarest beat, not the climax.
2. **"Settled" formations look frozen.** A static silhouette betrays
   the drone-swarm illusion within 2 seconds of holding. *Mitigation:*
   high-frequency micro-jitter during the hold phase (the
   `uPhase == 3` term in the vertex shader) keeps every particle
   alive at sub-pixel amplitude, plus the slow scene rotation gives
   parallax. The hold is *steady*, never *still*.
3. **Travel-phase trajectory legibility.** If all particles take
   straight paths, the morph reads as mechanical (dot-matrix
   re-lighting). If trajectories are too noisy, the swarm reads as
   chaotic. *Mitigation:* the `bendStrength = sin(eased * π)` curve
   gives every particle a parabolic arc with maximum perpendicular
   deviation at the midpoint of its travel, decaying to exact target
   at arrival. Per-particle `trajectoryNoise` direction is
   randomised so the swarm billows organically. This is the most
   tuning-sensitive part of the implementation.
4. **Form readability during dense holds.** The chevron and wordmark
   silhouettes have high particle density in their mass; if they
   compose over the form card the inputs become illegible. *Mitigation
   already structural:* targets are baked with the form's bounding rect
   excluded. Worst case (e.g. octahedron's silhouette projects through
   the card centre at certain rotation angles) is handled by a faint
   radial CSS vignette layered between canvas and form.
5. **Bundle size.** 6 shape-target binaries × ~216KB = ~1.3MB of
   binary data, lazy-loaded only on `/sign-in`. *Mitigation:* gzipped
   `Float32Array` of mostly-bounded values compresses to ~45% — total
   ~600KB on the wire. Acceptable for an auth route that's hit once
   per session. If we want to be aggressive, a quantised int16 format
   (with 0.0001 unit precision over a [-3, 3] coordinate range)
   halves it again.
6. **Bake script is a real piece of code.** Generating clean
   wordmark and network-graph targets is non-trivial. *Mitigation:*
   start with chevron + octahedron + torus (all primitives, ~30 LOC
   to bake); add globe + network + wordmark in a second pass once
   the morph engine is proven.

---

## Considered and superseded

Three earlier directions were drafted before the drone-swarm steer
came in. Documenting them briefly so the rationale isn't lost:

- **A — Constellation Swarm.** Static volume of ~8K green points with
  drawn mesh edges between near-neighbors and periodic spawn pulses
  from a central locus. *Superseded by D:* Direction D's network-graph
  shape *is* this concept, but as one beat in a richer rotation
  rather than the entire animation. The mesh-edge tech survives there.
- **B — Orbital Fleet Choreography.** Bright core + three concentric
  noise-jittered shells (cyan/green/violet for pending/running/stopped
  lifecycle states), with periodic emissions from the core. *Superseded
  by D:* the lifecycle-color storytelling survives in D as the
  travel-phase cyan tint (particles "in flight" between formations
  read as `pending`). The orbital-shell metaphor itself is too
  visually static for the brief.
- **C — Schematic Lattice Membrane.** ~12K-vertex 3D lattice deformed
  by noise with propagating spherical activation pulses. *Superseded
  by D:* the lattice register doesn't communicate *agents* or
  *swarms* strongly enough — it reads as "monitored substrate," not
  as "fleet under orchestration."

---

## Implementation cost

| Item | Cost |
|------|------|
| Add `three` + `@react-three/fiber` + `@react-three/drei` to `frontend/package.json` (lazy-loaded only on `/sign-in`) | ~150KB gzipped |
| Dynamic-import wrapper for SSR-disable | trivial |
| Inline Ashima simplex GLSL constant | copy-paste from Elephantasm |
| Morph-engine component (`frontend/src/components/sign-in/swarm-canvas.tsx`) | ~600 LOC |
| Shape-target bake script (`frontend/scripts/bake-sign-in-shapes.ts`) | ~250 LOC |
| 6 baked target binaries committed under `frontend/public/sign-in/shape-targets/` | ~600KB gzipped wire size |
| Wire into `src/app/sign-in/page.tsx` as a positioned background layer | ~10 LOC |
| `prefers-reduced-motion` fallback (no animation; static screenshot of one settled shape, e.g. the chevron, baked to PNG) | ~15 LOC + one PNG |
| Mobile particle-count reduction (~18K → ~6K via `useMediaQuery`) | one prop switch |

No backend change. No proto change. No schema change. No env var. Pure
frontend, pure `/sign-in` route.

A reasonable phased plan:

- **Phase 1.** Morph engine + 3 primitive shapes (chevron, octahedron,
  torus). Proves the technique end-to-end. ~2 days of focused work.
- **Phase 2.** Add globe, network graph, wordmark + bake script
  productisation. ~1.5 days.
- **Phase 3.** Tuning pass — easing curves, trajectory noise
  parameters, color cross-fade timing, hold-phase jitter amplitude,
  full sequence rhythm. The make-or-break pass; budget ~1 day even
  though it sounds like polish.

---

## Questions for review

1. **Shape rotation roster.** Of the seven proposed (amorphous,
   chevron, octahedron, torus, network graph, globe, wordmark): all in,
   subset, or different shapes entirely? Anything you'd swap out?
   Anything to add (a stylised Hermes mascot? an AWS/Fly logo as a
   "deploy target" beat? an abstract Möbius strip?)?
2. **Wordmark cadence.** Once per ~7 cycles (~2 minutes between
   wordmark beats), once per ~3 cycles (~1 min), or never (too
   on-the-nose for a control-plane login)? My instinct is once per
   ~7; the rarer it is the more it lands.
3. **Color discipline during travel.** Cyan tint on travel-phase
   particles is the strongest storytelling beat (it *means* "these
   agents are in `pending` state, mid-spawn") but it bends the
   "green-only on auth" reading of design-system §5. Alternative:
   particles stay green throughout and just dim during travel.
   The cyan version is more legible as a system in motion.
4. **Subtle mouse-parallax.** Camera nudges 1–2° in response to cursor
   position, or strictly ambient (no mouse interaction whatsoever)?
   No `OrbitControls` either way — the form is the only interactive
   surface. Parallax adds presence; pure-ambient is more austere.
5. **Hold-phase scene rotation.** Held shapes slowly rotate around
   their vertical axis (proposed: 0.05 rad/s, ~2 minutes per
   revolution), giving parallax that proves the silhouette is 3D not
   2D. Or: held shapes are perfectly still and parallax comes only
   from per-particle micro-jitter. Rotation is more legibly 3D;
   stillness is more controlled.
6. **Cycle pacing.** Proposed 18s per cycle (4s drift + 4s travel +
   3s settle + 7s hold). Faster (12s — punchier, more events per
   minute, more sizzle) or slower (25s — more contemplative, more
   time to *read* each shape, more "monitoring dashboard")? My
   instinct is the proposed 18s, but it's the kind of thing that
   only feels right when you see it.
7. **Reduced-motion fallback.** Static PNG of one settled shape
   (chevron is the strongest single frame), or just the existing
   `grid-bg` with no shape? PNG is more on-brand; grid-bg is more
   honest about what `prefers-reduced-motion` users are missing.
8. **Bundle budget.** Total cost on `/sign-in` is ~750KB gzipped
   (R3F + three + 6 shape-target binaries). Acceptable for a route
   visited once per session, or do we need to trim — e.g. drop to
   3 shapes and ~12K particles to halve it?
9. **Bake script location.** `frontend/scripts/bake-sign-in-shapes.ts`
   run manually pre-commit, with the binaries committed. Or make it
   a build-time step (runs in CI; binaries gitignored). Manual is
   simpler and means the binaries are reviewable artefacts; build-time
   is more reproducible. Manual feels right for v1; build-time can
   come later if shape edits become frequent.
