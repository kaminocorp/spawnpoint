# Nebula Swarm Animation — Technical Blueprint

> Replication guide for the volumetric particle nebula on the Elephantasm landing page hero section.
> Source: `frontend/src/components/framework/InteractiveSphere.tsx`

---

## Table of Contents

1. [Overview](#overview)
2. [Visual Character](#visual-character)
3. [Architecture](#architecture)
4. [Dependencies](#dependencies)
5. [Layer 1: Primary Cloud](#layer-1-primary-cloud)
6. [Layer 2: Wisp Tendrils](#layer-2-wisp-tendrils)
7. [Layer 3: Core Motes](#layer-3-core-motes)
8. [Composite Scene & Camera](#composite-scene--camera)
9. [Integration Pattern](#integration-pattern)
10. [Shader Reference: Simplex 3D Noise](#shader-reference-simplex-3d-noise)
11. [Tuning Guide](#tuning-guide)
12. [Performance Notes](#performance-notes)

---

## Overview

The animation is a **3-layer volumetric particle nebula** rendered entirely with `THREE.Points` and custom GLSL shaders. No mesh geometry, no textures, no post-processing — just ~17,300 point particles displaced by 3D simplex noise, colored by slow iridescent mood cycling, and composited via additive blending into a luminous, organic cloud.

It runs at 60fps on mid-range hardware with no visible frame drops.

### Key Properties

| Property | Value |
|----------|-------|
| Total particles | 17,300 (14,000 + 2,500 + 800) |
| Rendering | `THREE.Points` with custom `ShaderMaterial` |
| Blending | `THREE.AdditiveBlending` (all layers) |
| Noise | Ashima 3D Simplex (GLSL, inlined) |
| Color system | Pearl base + 4-mood iridescent tinting |
| Effective cycle | ~7+ minutes before near-repetition |
| Interaction | OrbitControls (drag-rotate, scroll-zoom, auto-rotate) |
| Framework | React Three Fiber + drei |

---

## Visual Character

**What it looks like:** A luminous, breathing cloud of pearlescent particles — somewhere between a stellar nebula and a bioluminescent organism. The form continuously reshapes itself: expanding, contracting, stretching into tendrils, then coalescing back. Colors shift slowly through indigo, amber, rose, and teal tints that wash across the form spatially (not uniformly), creating depth.

**What makes it feel alive:**

1. **No repetition** — Overlapping sine waves with irrational frequency ratios (0.031, 0.053, 0.047, 0.073...) modulate displacement amplitude. The effective period before near-repetition is ~7+ minutes. A viewer watching for 2-3 minutes never sees the same shape twice.

2. **Layered depth** — Three particle populations at different radii, densities, and animation speeds create parallax and volumetric depth. The core is bright and tight; the middle is the main cloud; the outer wisps dissolve into nothingness.

3. **Spatial color** — Color isn't uniform or time-only. The iridescence is driven by `vDisplaced.x * 0.8 + vDisplaced.y * 0.6 + vDepth * 0.15`, so different regions of the cloud shift through different hues simultaneously. Color literally flows through the form.

4. **Breathing** — A `uCoherence` uniform scales all displaced positions toward/away from the origin, creating a rhythmic expansion-contraction that reads as respiration.

5. **Additive blending** — Overlapping particles accumulate light rather than occluding. Dense regions glow brighter; sparse edges fade transparently. No hard silhouettes.

---

## Architecture

```
InteractiveSphere (exported component)
  └─ Canvas (R3F)
       ├─ ambientLight (intensity: 0.15)
       ├─ NebulaEntity (group)
       │    ├─ PrimaryCloud   — 14,000 pts, Gaussian volume, 3-octave noise
       │    ├─ WispTendrils   —  2,500 pts, outer shell, radial drift
       │    └─ CoreMotes      —    800 pts, tight core, micro-jitter
       └─ OrbitControls
```

Each layer is an independent `<points>` object with:
- Its own `BufferGeometry` (positions, phases, optional sizes)
- Its own `ShaderMaterial` (custom vertex + fragment shaders)
- Its own `useFrame` animation loop updating uniforms and rotation

All three share the same inlined simplex noise GLSL function.

---

## Dependencies

```json
{
  "@react-three/fiber": "^8.x",
  "@react-three/drei": "^9.x",
  "three": "^0.160+"
}
```

React Three Fiber provides the `<Canvas>`, `useFrame`, and declarative scene graph. drei provides `<OrbitControls>`. All particle logic is custom — no particle libraries needed.

### Next.js Integration

The component must be dynamically imported with `ssr: false` (WebGL requires a browser context):

```tsx
const InteractiveSphere = dynamic(
  () => import('@/components/framework/InteractiveSphere'),
  { ssr: false }
)
```

---

## Layer 1: Primary Cloud

**Role:** The main body of the nebula — the large, soft, reshaping cloud that dominates the visual.

### Particle Distribution

```
Count:  14,000
Method: Gaussian-weighted spherical volume (Box-Muller transform)
Radius: r = 1.3 * sqrt(-2 * ln(u)) * 0.42   (u ∈ (0,1))
Angles: θ uniform [0, 2π], φ = acos(2v - 1) for uniform spherical coverage
```

Box-Muller gives a radial Gaussian falloff — most particles cluster near the center, with a natural density gradient toward the edges. No hard boundary.

### Per-Particle Attributes

| Attribute | Type | Range | Purpose |
|-----------|------|-------|---------|
| `position` | vec3 | Gaussian sphere | Initial spawn position |
| `phase` | float | [0, 2π] | Per-particle time offset (prevents unison flicker) |
| `size` | float | [2.2, 5.6] | Base point size before modulation |

### Vertex Shader: 3-Octave Noise Displacement

The vertex shader displaces each particle's base position using three octaves of 3D simplex noise, each at a different spatial frequency and animation speed:

```glsl
// Low frequency — large-scale form reshaping
vec3 low = vec3(
  snoise(bp * 0.8 + vec3(t * 0.12, t * 0.09, t * 0.07)),
  snoise(bp * 0.8 + vec3(t * 0.08 + 50.0, t * 0.11, t * 0.06)),
  snoise(bp * 0.8 + vec3(t * 0.10, t * 0.07 + 80.0, t * 0.13))
);

// Mid frequency — medium-scale turbulence
vec3 mid = vec3(
  snoise(bp * 2.2 + vec3(t * 0.25, t * 0.2, t * 0.18)),
  snoise(bp * 2.2 + vec3(t * 0.22 + 30.0, t * 0.28, t * 0.15)),
  snoise(bp * 2.2 + vec3(t * 0.19, t * 0.23 + 60.0, t * 0.27))
);

// High frequency — fine detail shimmer
vec3 high = vec3(
  snoise(bp * 6.0 + vec3(t * 0.5)),
  snoise(bp * 6.0 + vec3(t * 0.45 + 20.0)),
  snoise(bp * 6.0 + vec3(t * 0.55 + 40.0))
);

vec3 displaced = bp + low * uLowAmp + mid * uMidAmp + high * 0.035;
displaced *= uCoherence;  // breathing scale factor
```

**Octave breakdown:**

| Octave | Spatial freq | Time speed | Amplitude (uniform) | Visual role |
|--------|-------------|------------|---------------------|-------------|
| Low | `0.8` | `0.07–0.13` | `uLowAmp` (~0.23–0.79) | Grand form changes |
| Mid | `2.2` | `0.15–0.28` | `uMidAmp` (~0.02–0.34) | Turbulence detail |
| High | `6.0` | `0.45–0.55` | `0.035` (fixed) | Surface shimmer |

The constant offsets (+50.0, +30.0, +80.0, etc.) in the noise seeds ensure each axis samples a different region of the noise field — otherwise x/y/z would displace in correlated directions.

### Alpha Computation

```glsl
float coreAlpha = smoothstep(1.8, 0.0, dist) * 0.55;  // bright toward center
float edgeAlpha = smoothstep(0.0, 1.4, dist) * 0.12;  // faint at edges
float flicker   = sin(t * 0.4 + phase) * 0.12
                + sin(t * 0.17 + phase * 2.3) * 0.08;  // dual-wave shimmer
vAlpha = clamp(coreAlpha + edgeAlpha + flicker, 0.012, 0.65);
```

Two overlapping `smoothstep` curves create a density gradient: bright core fading to transparent edges. The `flicker` term adds per-particle variation using two sine waves at different frequencies. Clamping prevents any particle from becoming fully opaque or fully invisible.

### Fragment Shader: Iridescent Color

```glsl
// Soft circular point shape
float soft = exp(-d * d * 8.0);

// Spatial seed — position-dependent, not just time-dependent
float spatial = vDisplaced.x * 0.8 + vDisplaced.y * 0.6 + vDepth * 0.15;

// Pearl base + 4 mood tints
vec3 pearl  = vec3(0.93, 0.91, 0.96);
vec3 indigo = vec3(0.45, 0.35, 0.75);
vec3 amber  = vec3(0.85, 0.65, 0.35);
vec3 rose   = vec3(0.80, 0.45, 0.55);
vec3 teal   = vec3(0.35, 0.70, 0.72);

// Each mood oscillates at a different irrational period
float moodA = sin(uTime * 0.037 + spatial * 1.5) * 0.5 + 0.5;        // indigo
float moodB = sin(uTime * 0.023 + spatial * 1.2 + 1.8) * 0.5 + 0.5;  // amber
float moodC = sin(uTime * 0.043 + spatial * 1.8 + 3.5) * 0.5 + 0.5;  // rose
float moodD = sin(uTime * 0.029 + spatial * 1.0 + 5.1) * 0.5 + 0.5;  // teal

vec3 color = pearl;
color = mix(color, indigo, moodA * 0.25);
color = mix(color, amber,  moodB * 0.18);
color = mix(color, rose,   moodC * 0.15);
color = mix(color, teal,   moodD * 0.20);
```

**Why this works:** The `spatial` variable ties color to position, so the left side of the cloud can be amber while the right is indigo, and this mapping itself drifts over time. The four `sin()` frequencies (0.037, 0.023, 0.043, 0.029) are mutually irrational — they never synchronize, creating an endlessly shifting palette.

The `mix()` intensities (0.25, 0.18, 0.15, 0.20) are deliberately low — moods **tint** the pearl base rather than dominating it. The result is subtle, not garish.

### CPU-Side Animation Loop

```ts
useFrame(({ clock }) => {
  const t = clock.elapsedTime

  // Long-period modulation with irrational frequency ratios
  const lowAmp   = 0.45 + 0.22 * Math.sin(t * 0.031) + 0.12 * Math.sin(t * 0.053 + 1.2)
  const midAmp   = 0.18 + 0.10 * Math.sin(t * 0.047 + 0.7) + 0.06 * Math.sin(t * 0.073)
  const coherence = 1.0 + 0.22 * Math.sin(t * 0.019) + 0.14 * Math.sin(t * 0.041 + 2.0)

  material.uniforms.uTime.value = t
  material.uniforms.uLowAmp.value = lowAmp
  material.uniforms.uMidAmp.value = midAmp
  material.uniforms.uCoherence.value = coherence

  // Gentle rotation
  ref.current.rotation.y = t * 0.06
  ref.current.rotation.x = t * 0.02
})
```

The three uniforms (`lowAmp`, `midAmp`, `coherence`) each combine two sine waves with irrational periods. This creates macro-level "events" — moments where the cloud expands dramatically, or turbulence spikes, or the form compresses — all without scripted keyframes.

**Amplitude ranges (computed from the formula):**

| Uniform | Min | Max | Effect |
|---------|-----|-----|--------|
| `lowAmp` | 0.11 | 0.79 | Grand form plasticity |
| `midAmp` | 0.02 | 0.34 | Turbulence intensity |
| `coherence` | 0.64 | 1.36 | Breathing scale |

---

## Layer 2: Wisp Tendrils

**Role:** Outer dissolving edges — faint particles that drift outward from the main body, creating a gaseous, unbounded feel.

### Particle Distribution

```
Count:  2,500
Method: Uniform spherical shell
Radius: r ∈ [0.6, 1.5]  (the gap between core and outer boundary)
```

Unlike PrimaryCloud's Gaussian, this is a **uniform shell** — particles spawn in a band rather than clustering at center.

### Displacement: Radial Drift + Tangential Noise

```glsl
float drift = snoise(bp * 1.2 + t * 0.08) * 0.55 + 0.3;
vec3 dir = normalize(bp + vec3(0.001));  // outward direction
vec3 tangent = vec3(
  snoise(bp * 1.5 + vec3(t * 0.15, 0.0, 0.0)),
  snoise(bp * 1.5 + vec3(0.0, t * 0.12, 0.0)),
  snoise(bp * 1.5 + vec3(0.0, 0.0, t * 0.18))
);
vec3 displaced = bp + dir * drift + tangent * 0.35;
```

Two forces: **radial drift** pushes outward along each particle's direction from origin (modulated by noise so some regions billow out more than others), and **tangential noise** creates lateral swirl. The `0.001` epsilon prevents `normalize(vec3(0))` for particles near the origin.

### Visual Properties

- **Very faint:** Alpha range [0.005, 0.09] — barely visible, creating an atmospheric haze
- **Large point sizes:** 4.5–10.5px — soft, diffuse dots
- **Same mood palette as PrimaryCloud** but with time offsets (+2.0, +3.8, +5.5) — colors "trail behind" the core, as if carried outward by drift
- **Only 3 moods** (indigo, amber, rose) — no teal, slightly higher mix intensities (0.30, 0.22, 0.18) to compensate for low alpha

### Rotation

Slower than PrimaryCloud: `y = t * 0.04`, `x = t * 0.015`. The differential rotation rate creates subtle parallax between layers.

---

## Layer 3: Core Motes

**Role:** Bright, dense core that acts as the "heartbeat" — a small tight cluster of sharply defined particles.

### Particle Distribution

```
Count:  800
Method: Gaussian (very tight)
Radius: r = 0.28 * sqrt(-2 * ln(u)) * 0.35   (effective sigma ~0.098)
```

Much tighter than PrimaryCloud. These particles rarely extend beyond r=0.3.

### Displacement: High-Frequency Micro-Jitter Only

```glsl
vec3 jitter = vec3(
  snoise(bp * 8.0 + vec3(t * 0.8)),
  snoise(bp * 8.0 + vec3(t * 0.7 + 10.0)),
  snoise(bp * 8.0 + vec3(t * 0.9 + 20.0))
);
vec3 displaced = bp + jitter * 0.04;
```

- Spatial frequency `8.0` — very fine grain
- Time speeds `0.7–0.9` — fast, nervous movement
- Amplitude `0.04` — tiny displacement

This creates a buzzing, energetic core that contrasts with the slow-moving outer layers.

### Visual Properties

- **Bright:** Alpha range [0.3, 0.85] — the brightest particles in the scene
- **Small points:** 2.2px base — sharp, star-like
- **Simpler color:** No spatial iridescence. Just pearl base shifting between "candlelight" warm `(1.0, 0.88, 0.78)` and "moonlight" cool `(0.82, 0.88, 1.0)` on slow cycles

### Rotation

Fastest layer: `y = t * 0.07`, `x = t * 0.025`. The slight speed differential from the other layers creates inner-body parallax.

---

## Composite Scene & Camera

### Canvas Configuration

```tsx
<Canvas
  camera={{ position: [0, 0, 5.8], fov: 50 }}
  gl={{
    antialias: true,
    alpha: true,                      // transparent background
    powerPreference: 'high-performance'
  }}
>
```

- Camera at z=5.8 with 50deg FOV — frames the nebula to fill ~60% of the viewport
- `alpha: true` — the nebula floats over the page background (no black rectangle)
- `antialias: true` — smooths point edges

### Oversized Container

```tsx
<div className="relative w-full h-[700px]">
  <div style={{
    width: '2000px', height: '2000px',
    left: '50%', top: '50%',
    transform: 'translate(-50%, -50%)'
  }}>
    <Canvas .../>
  </div>
</div>
```

The canvas is **2000x2000px**, centered in a 700px-tall container with `overflow: hidden` (from parent). This ensures the nebula extends beyond the visible area — wisps and tendrils that drift outward aren't clipped by a tight viewport. The effect is that the nebula has no visible boundary.

### OrbitControls

```tsx
<OrbitControls
  enableZoom={true}
  enablePan={false}
  minDistance={1.25}
  maxDistance={20}
  rotateSpeed={0.5}
  zoomSpeed={0.5}
  autoRotate={true}
  autoRotateSpeed={0.3}
/>
```

- **Auto-rotate** at 0.3 speed — gentle ambient rotation
- **Drag-to-rotate** at 0.5 sensitivity — responsive but not twitchy
- **Zoom** allowed (1.25–20 distance) — users can zoom into the core or pull back for full view
- **No pan** — keeps the nebula centered

### Lighting

```tsx
<ambientLight intensity={0.15} />
```

Minimal ambient light. Since all materials use `ShaderMaterial` with custom fragment shaders, the light has negligible effect — it's present mainly as a fallback.

---

## Integration Pattern

### Landing Page Usage

```tsx
// page.tsx — dynamic import, SSR disabled
const InteractiveSphere = dynamic(
  () => import('@/components/framework/InteractiveSphere'),
  { ssr: false }
)

// In the JSX — right side of a 2-column hero grid
<div className="order-1 lg:order-2 relative -mx-8 lg:mx-0">
  <InteractiveSphere />
</div>
```

The component is self-contained — no props, no context, no external state. Drop it in and it runs.

### Adapting for Other Applications

**Standalone (vanilla Three.js):** Replace R3F declarative syntax with imperative Three.js:
- `<Canvas>` → `new THREE.WebGLRenderer({ alpha: true, antialias: true })`
- `<points>` → `new THREE.Points(geometry, material)`
- `useFrame` → `renderer.setAnimationLoop(callback)`
- `<OrbitControls>` → `new OrbitControls(camera, renderer.domElement)`

**Different frameworks:** The GLSL shaders and particle math are framework-agnostic. Only the React/R3F wrapper needs replacement.

---

## Shader Reference: Simplex 3D Noise

The noise function is the Ashima/webgl-noise implementation of 3D Simplex noise, inlined as a GLSL string constant shared across all three layers:

```glsl
// Core functions:
vec3 mod289(vec3 x)             // modular arithmetic
vec4 mod289(vec4 x)
vec4 permute(vec4 x)            // hash permutation
vec4 taylorInvSqrt(vec4 r)      // fast inverse sqrt
float snoise(vec3 v)            // → [-1, 1] simplex noise
```

**Why inlined:** Each `ShaderMaterial` compiles independently. Sharing via GLSL `#include` requires a custom shader chunk system. Inlining the same string constant (`SIMPLEX_NOISE_GLSL`) is simpler and has zero runtime cost — the GPU compiles each shader once at init.

---

## Tuning Guide

### Mood & Color

| Parameter | Location | Effect |
|-----------|----------|--------|
| Pearl base RGB | Fragment shaders | Overall base tone (warm/cool/neutral) |
| Mood colors (indigo/amber/rose/teal) | Fragment shaders | Accent palette |
| Mood mix intensities (0.25/0.18/0.15/0.20) | Fragment shaders | How strongly moods tint the base |
| Mood frequencies (0.037/0.023/0.043/0.029) | Fragment shaders | Speed of color cycling |
| Spatial weights (x\*0.8 + y\*0.6 + depth\*0.15) | Fragment shader | How much color varies by position |

### Shape & Motion

| Parameter | Location | Effect |
|-----------|----------|--------|
| Particle count | Component constants | Density/performance tradeoff |
| Gaussian sigma (the `* 0.42` factor) | `useMemo` init | Cloud radius |
| Noise spatial frequencies (0.8/2.2/6.0) | Vertex shader | Scale of displacement features |
| Noise time speeds (0.07–0.55) | Vertex shader | Animation speed per octave |
| Amplitude modulation frequencies | `useFrame` loop | How often macro "events" occur |
| `uCoherence` range | `useFrame` loop | Breathing intensity |
| Rotation speeds | `useFrame` loop | Ambient spin rate |

### Visibility

| Parameter | Location | Effect |
|-----------|----------|--------|
| `smoothstep` bounds in alpha | Vertex shaders | Core brightness vs edge fade |
| Alpha clamp range | Vertex shaders | Min/max particle visibility |
| Point size base + modulation | Vertex shaders | Particle apparent size |
| `exp(-d*d*N)` falloff in fragment | Fragment shaders | Point softness (higher N = sharper) |

---

## Performance Notes

### GPU Load

- 17,300 points is very lightweight for modern GPUs — well under 100K particle threshold
- No texture sampling, no shadows, no post-processing
- Simplex noise is the costliest operation — 3 octaves × 3 axes = 9 noise evaluations per vertex per frame in PrimaryCloud. Still fast for 14K vertices on any discrete GPU
- `depthWrite: false` on all materials avoids depth buffer writes (particles don't need z-sorting with additive blending)

### CPU Load

- `useFrame` runs once per frame per layer (3 total) — just uniform updates and rotation, negligible cost
- Particle positions are computed entirely on GPU (vertex shader) — no JS-side position updates per frame
- The `useMemo` initialization runs once on mount

### Memory

- Buffer memory: ~17,300 × (3 floats position + 1 float phase + optional 1 float size) × 4 bytes ≈ 350 KB
- Three `ShaderMaterial` instances with compiled shader programs
- Total: well under 1 MB GPU memory

### Mobile Considerations

- Reduce particle counts (e.g., 7K/1.2K/400) for mobile GPUs
- Consider disabling the high-frequency octave in PrimaryCloud (remove the `high` term)
- The oversized 2000×2000 canvas may cause issues on low-memory devices — consider reducing to 1200×1200
- `powerPreference: 'high-performance'` requests the discrete GPU on laptops with dual GPUs

---

*"Not a sphere. Not a mesh. A cloud of light that breathes, drifts, and slowly changes its mind about what color it wants to be."*
