"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, type ShaderMaterial } from "three";

import { SIMPLEX_NOISE_GLSL } from "@/lib/shaders/simplex-noise";

/**
 * Inner R3F scene for `<GalaxyOfAgents>`. Dynamic-imported with
 * `ssr: false` by the wrapper so three.js never enters the server
 * bundle and only loads when the slide is in viewport.
 *
 * Particle count is fixed at `MAX_COUNT`; what scales with the
 * count-up is `uVisible`, a uniform threshold the vertex shader
 * compares per-particle index against. Particles below the threshold
 * render; above it, they are clipped by setting `gl_Position` to
 * outside the clip volume — cheaper than rebuilding the buffer.
 *
 * The camera distance scales linearly with the visible fraction, so
 * the viewer reads "the more agents materialise, the further out we
 * need to be to see them all" rather than "agents pop in over a fixed
 * frame."
 */

const MAX_COUNT = 1500;

const VERTEX_SHADER = /* glsl */ `
attribute float aIndex;
attribute float aPhase;
attribute float aSize;

uniform float uTime;
uniform float uVisible;
uniform float uPixelRatio;

varying float vAlpha;

${SIMPLEX_NOISE_GLSL}

void main() {
  if (aIndex > uVisible) {
    // clip particle outside the frustum; cheap and stable
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }

  vec3 bp = position;
  float t = uTime;

  // gentle drift so the galaxy feels alive at rest
  vec3 drift = vec3(
    snoise(bp * 0.5 + vec3(t * 0.04)),
    snoise(bp * 0.5 + vec3(t * 0.05 + 30.0)),
    snoise(bp * 0.5 + vec3(t * 0.03 + 60.0))
  );
  vec3 displaced = bp + drift * 0.06;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // birth fade: particles whose aIndex is just below uVisible fade in
  float age = clamp(uVisible - aIndex, 0.0, 1.0);
  float twinkle = 0.6 + 0.4 * sin(t * 0.5 + aPhase);
  vAlpha = age * twinkle;

  gl_PointSize = aSize * uPixelRatio * (1.4 / -mvPosition.z);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float soft = exp(-d * d * 9.0);
  if (soft < 0.01) discard;

  // Pearl-white core, slightly cool — same family as the nebula but
  // monochrome (the galaxy is "all the agents," not a single mood).
  vec3 color = vec3(0.93, 0.95, 1.0);
  gl_FragColor = vec4(color, vAlpha * soft * 0.85);
}
`;

/**
 * Deterministic mulberry32 PRNG. Replaces `Math.random()` for buffer
 * generation so (a) record-mode is reproducible across takes (Phase 6)
 * and (b) `react-hooks/purity` doesn't flag the call site as impure.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianSphere(
  count: number,
  sigma: number,
  rng: () => number,
): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.max(1e-6, rng());
    const v = rng();
    const r = sigma * Math.sqrt(-2 * Math.log(u));
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const sinPhi = Math.sin(phi);
    out[i * 3] = r * sinPhi * Math.cos(theta);
    out[i * 3 + 1] = r * sinPhi * Math.sin(theta);
    out[i * 3 + 2] = r * Math.cos(phi);
  }
  return out;
}

function Galaxy({ count, target }: { count: number; target: number }) {
  const materialRef = useRef<ShaderMaterial>(null);

  const buffers = useMemo(() => {
    const rng = mulberry32(0xC0FEFE);
    const positions = gaussianSphere(MAX_COUNT, 1.4, rng);
    const indices = new Float32Array(MAX_COUNT);
    const phases = new Float32Array(MAX_COUNT);
    const sizes = new Float32Array(MAX_COUNT);
    for (let i = 0; i < MAX_COUNT; i++) {
      indices[i] = i;
      phases[i] = rng() * Math.PI * 2;
      sizes[i] = 1.5 + rng() * 2.4;
    }
    return { positions, indices, phases, sizes };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uVisible: { value: 0 },
      uPixelRatio: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
    }),
    [],
  );

  useFrame((state) => {
    const m = materialRef.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    m.uniforms.uTime.value = t;
    // visible-particle threshold tracks the count-up
    const fraction = Math.min(count / Math.max(1, target), 1);
    m.uniforms.uVisible.value = fraction * MAX_COUNT;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[buffers.positions, 3]}
        />
        <bufferAttribute
          attach="attributes-aIndex"
          args={[buffers.indices, 1]}
        />
        <bufferAttribute
          attach="attributes-aPhase"
          args={[buffers.phases, 1]}
        />
        <bufferAttribute attach="attributes-aSize" args={[buffers.sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

function CameraDolly({ count, target }: { count: number; target: number }) {
  // Manual lerp on the default camera so we don't need <PerspectiveCamera>
  // boilerplate. Distance scales with the visible fraction: starts at 1.5
  // (single-point view), ends at 4.5 (galaxy from outside).
  useFrame(({ camera }) => {
    const fraction = Math.min(count / Math.max(1, target), 1);
    const targetZ = 1.5 + fraction * 3.0;
    camera.position.z += (targetZ - camera.position.z) * 0.04;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function GalaxyOfAgentsScene({
  count,
  target,
}: {
  count: number;
  target: number;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 1.5], fov: 55 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <CameraDolly count={count} target={target} />
      <Galaxy count={count} target={target} />
    </Canvas>
  );
}
