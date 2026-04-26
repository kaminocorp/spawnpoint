"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  type Group,
  type ShaderMaterial,
  Vector3,
  Vector4,
} from "three";

import {
  CORE_FRAGMENT_SHADER,
  CORE_VERTEX_SHADER,
  PRIMARY_FRAGMENT_SHADER,
  PRIMARY_VERTEX_SHADER,
} from "./nebula-shaders";
import type { MoodPalette } from "@/lib/spawn/mood-palettes";

/**
 * Inner R3F scene for `<NebulaAvatar>`. Dynamic-imported with `ssr: false`
 * by the wrapper so the three.js bundle never loads on the server and only
 * loads on the client when the avatar is in viewport (decision 15).
 *
 * Two layers per `docs/executing/agents-ui-mods.md` §4 Phase 2:
 *   PrimaryCloud — 2.5K Gaussian-distributed particles, 3-octave noise
 *                  displacement, irrational-frequency uniform modulation.
 *   CoreMotes    — 500 tight-Gaussian particles, high-freq micro-jitter.
 *
 * The auto-rotate matches plan §4 Phase 2 (`y = t*0.05`, `x = t*0.02`) and
 * is gentler than elephantasm's source rate — at 240×240 the avatar is
 * small, so a slower spin reads as a calm signature rather than a spinner.
 */

const PRIMARY_COUNT = 2500;
const CORE_COUNT = 500;
const PRIMARY_SIGMA = 0.42;
const CORE_SIGMA = 0.098;

/**
 * Box-Muller Gaussian sphere — radius from `r * sqrt(-2 ln u)`, angles
 * uniformly over the sphere. Most particles cluster near the centre with a
 * natural density falloff.
 */
function gaussianSphere(count: number, sigma: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.max(1e-6, Math.random());
    const v = Math.random();
    const r = sigma * Math.sqrt(-2 * Math.log(u));
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const sinPhi = Math.sin(phi);
    out[i * 3] = r * sinPhi * Math.cos(theta);
    out[i * 3 + 1] = r * sinPhi * Math.sin(theta);
    out[i * 3 + 2] = r * Math.cos(phi);
  }
  return out;
}

function randomFloats(count: number, min: number, max: number): Float32Array {
  const out = new Float32Array(count);
  const span = max - min;
  for (let i = 0; i < count; i++) out[i] = min + Math.random() * span;
  return out;
}

function PrimaryCloud({ palette }: { palette: MoodPalette }) {
  const materialRef = useRef<ShaderMaterial>(null);
  const groupRef = useRef<Group>(null);

  const buffers = useMemo(
    () => ({
      position: gaussianSphere(PRIMARY_COUNT, PRIMARY_SIGMA),
      phase: randomFloats(PRIMARY_COUNT, 0, Math.PI * 2),
      pSize: randomFloats(PRIMARY_COUNT, 2.2, 5.6),
    }),
    [],
  );

  // Palette-derived uniforms are baked once per `palette` change. The
  // animation uniforms (uTime / uLowAmp / uMidAmp / uCoherence) update per
  // frame and intentionally live outside this memo so the material itself
  // is stable.
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLowAmp: { value: 0.45 },
      uMidAmp: { value: 0.18 },
      uCoherence: { value: 1 },
      uPixelRatio: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      uPearl: { value: new Vector3(...palette.pearl) },
      uTint0: { value: new Vector3(...palette.tints[0]) },
      uTint1: { value: new Vector3(...palette.tints[1]) },
      uTint2: { value: new Vector3(...palette.tints[2]) },
      uTint3: { value: new Vector3(...palette.tints[3]) },
      uTintFreq: { value: new Vector4(...palette.frequencies) },
      uTintIntensity: { value: new Vector4(...palette.intensities) },
      uSpatialWeights: { value: new Vector3(...palette.spatialWeights) },
    }),
    [palette],
  );

  useFrame((state) => {
    const material = materialRef.current;
    const group = groupRef.current;
    if (!material || !group) return;
    const t = state.clock.elapsedTime;

    // Irrational-frequency macro modulation — see elephantasm-animation.md
    // §"CPU-side animation loop". Two sines per uniform, never synchronise,
    // so the cloud has minutes-long rhythm without a perceptible loop.
    const lowAmp = 0.45 + 0.22 * Math.sin(t * 0.031) + 0.12 * Math.sin(t * 0.053 + 1.2);
    const midAmp = 0.18 + 0.10 * Math.sin(t * 0.047 + 0.7) + 0.06 * Math.sin(t * 0.073);
    const coherence = 1.0 + 0.22 * Math.sin(t * 0.019) + 0.14 * Math.sin(t * 0.041 + 2.0);

    material.uniforms.uTime.value = t;
    material.uniforms.uLowAmp.value = lowAmp;
    material.uniforms.uMidAmp.value = midAmp;
    material.uniforms.uCoherence.value = coherence;

    group.rotation.y = t * 0.05;
    group.rotation.x = t * 0.02;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buffers.position, 3]} />
          <bufferAttribute attach="attributes-phase" args={[buffers.phase, 1]} />
          <bufferAttribute attach="attributes-pSize" args={[buffers.pSize, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={PRIMARY_VERTEX_SHADER}
          fragmentShader={PRIMARY_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  );
}

function CoreMotes() {
  const materialRef = useRef<ShaderMaterial>(null);
  const groupRef = useRef<Group>(null);

  const buffers = useMemo(
    () => ({
      position: gaussianSphere(CORE_COUNT, CORE_SIGMA),
      phase: randomFloats(CORE_COUNT, 0, Math.PI * 2),
    }),
    [],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
    }),
    [],
  );

  // Core spins faster than the primary cloud — slight differential creates
  // inner-body parallax (elephantasm §"Layer 3 // Rotation").
  useFrame((state) => {
    const material = materialRef.current;
    const group = groupRef.current;
    if (!material || !group) return;
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    group.rotation.y = t * 0.07;
    group.rotation.x = t * 0.025;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buffers.position, 3]} />
          <bufferAttribute attach="attributes-phase" args={[buffers.phase, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={CORE_VERTEX_SHADER}
          fragmentShader={CORE_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  );
}

export default function NebulaScene({ palette }: { palette: MoodPalette }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.15} />
      <PrimaryCloud palette={palette} />
      <CoreMotes />
    </Canvas>
  );
}
