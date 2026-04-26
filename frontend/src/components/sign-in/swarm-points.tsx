"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  type BufferAttribute,
  type BufferGeometry,
  type Points,
  type ShaderMaterial,
} from "three";

import { useMatchMedia } from "@/lib/use-match-media";

import { MorphScheduler, PHASE_MORPH } from "./morph-scheduler";
import { loadShapeTargets } from "./shape-loader";
import {
  PARTICLE_COUNT,
  PARTICLE_COUNT_MOBILE,
  type ShapeName,
} from "./shapes";
import { SWARM_FRAGMENT_SHADER, SWARM_VERTEX_SHADER } from "./shaders";

/**
 * Pre-slice a baked target array down to `count` points by striding
 * through it. The bake produces 18000 points; mobile renders 6000 by
 * taking every 3rd point. Stride is computed from the canonical
 * `PARTICLE_COUNT` rather than the input length, so this stays correct
 * if the loader ever returns a smaller-than-canonical array.
 */
function subsampleTargets(full: Float32Array, count: number): Float32Array {
  if (count >= PARTICLE_COUNT) return full;
  const stride = PARTICLE_COUNT / count;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const src = Math.floor(i * stride) * 3;
    out[i * 3] = full[src];
    out[i * 3 + 1] = full[src + 1];
    out[i * 3 + 2] = full[src + 2];
  }
  return out;
}

/**
 * Phase 2 swarm-points. Loads the available baked shapes, declares the
 * geometry + material via R3F's declarative JSX (so refs only get
 * touched in useFrame, never in render), and drives the ShaderMaterial
 * uniforms from the MorphScheduler each frame.
 *
 * The geometry's `position` attribute is unused by the vertex shader
 * (the shader picks `previousTarget` / `targetPosition` directly) but
 * Three requires it for the draw-call vertex count.
 */
export function SwarmPoints({ shapes }: { shapes: readonly ShapeName[] }) {
  const pointsRef = useRef<Points>(null);
  const geometryRef = useRef<BufferGeometry>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const schedulerRef = useRef<MorphScheduler | null>(null);
  const lastSigRef = useRef<string>("");

  // Mobile viewports drop to PARTICLE_COUNT_MOBILE (6000) — the .bin
  // files are oversized for desktop, mobile just strides through them.
  // Detected at mount; the canonical `count` is captured into `data`
  // so a viewport resize across the breakpoint doesn't reallocate
  // mid-flight (the form is the only interactive surface; the canvas
  // is wallpaper).
  const isMobile = useMatchMedia("(max-width: 768px)");

  const [data, setData] = useState<{
    targets: Map<ShapeName, Float32Array>;
    initial: Float32Array;
    morphSeeds: Float32Array;
    trajectoryNoise: Float32Array;
    count: number;
  } | null>(null);

  // Async load shape targets, build per-particle attributes, and seed
  // the scheduler ref. All of this runs once per `shapes` change.
  useEffect(() => {
    let cancelled = false;
    const count = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT;
    loadShapeTargets(shapes)
      .then((targets) => {
        if (cancelled) return;
        const scheduler = new MorphScheduler(shapes as ShapeName[]);
        schedulerRef.current = scheduler;

        const initialTargets = targets.get(scheduler.initialShape());
        if (!initialTargets) {
          console.error(
            `swarm-points: missing targets for initial shape ${scheduler.initialShape()}`,
          );
          return;
        }

        // Subsample every shape down to `count` once, up-front — keeps
        // the per-frame buffer-swap path identical to desktop (one
        // `Float32Array.set(source)` per swap; source is already the
        // right size).
        const sampledTargets = new Map<ShapeName, Float32Array>();
        for (const [name, full] of targets) {
          sampledTargets.set(name, subsampleTargets(full, count));
        }

        const sampledInitial = sampledTargets.get(scheduler.initialShape())!;

        const morphSeeds = new Float32Array(count);
        const trajectoryNoise = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          morphSeeds[i] = Math.random();
          // Uniform random unit vector — perpendicular bend direction
          // during morph, keeping the swarm billowing rather than flying
          // in straight lines.
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const sinPhi = Math.sin(phi);
          trajectoryNoise[i * 3] = sinPhi * Math.cos(theta);
          trajectoryNoise[i * 3 + 1] = sinPhi * Math.sin(theta);
          trajectoryNoise[i * 3 + 2] = Math.cos(phi);
        }

        setData({
          targets: sampledTargets,
          initial: new Float32Array(sampledInitial),
          morphSeeds,
          trajectoryNoise,
          count,
        });
      })
      .catch((err) => {
        console.error("swarm-points: failed to load shape targets", err);
      });
    return () => {
      cancelled = true;
    };
  }, [shapes, isMobile]);

  // Three buffer copies of the initial positions — one becomes
  // `position` (kept stable for the vertex count), the other two are
  // mutated each shape change to flip previous ↔ target.
  const buffers = useMemo(() => {
    if (!data) return null;
    return {
      position: new Float32Array(data.initial),
      previousTarget: new Float32Array(data.initial),
      targetPosition: new Float32Array(data.initial),
      morphSeed: data.morphSeeds,
      trajectoryNoise: data.trajectoryNoise,
    };
  }, [data]);

  const uniforms = useMemo(
    () => ({
      uPhase: { value: 0 },
      uPhaseProgress: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: {
        value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      uCyanTint: { value: 0 },
    }),
    [],
  );

  useFrame((state, delta) => {
    const scheduler = schedulerRef.current;
    const geometry = geometryRef.current;
    const material = materialRef.current;
    const points = pointsRef.current;
    if (!scheduler || !geometry || !material || !data) return;

    const tick = scheduler.tick(state.clock.elapsedTime);

    const sig = `${tick.previousShape}|${tick.currentShape}`;
    if (sig !== lastSigRef.current) {
      const prev = data.targets.get(tick.previousShape);
      const next = data.targets.get(tick.currentShape);
      if (prev && next) {
        const prevAttr = geometry.attributes.previousTarget as BufferAttribute;
        const nextAttr = geometry.attributes.targetPosition as BufferAttribute;
        (prevAttr.array as Float32Array).set(prev);
        (nextAttr.array as Float32Array).set(next);
        prevAttr.needsUpdate = true;
        nextAttr.needsUpdate = true;
      }
      lastSigRef.current = sig;
    }

    material.uniforms.uPhase.value = tick.phase;
    material.uniforms.uPhaseProgress.value = tick.phaseProgress;
    material.uniforms.uTime.value = state.clock.elapsedTime;

    // Cyan tint reads as transient state — only during MORPH. Ramp up
    // over the first ~21% of the phase (≈1.5s of 7s), plateau through
    // the fastest-motion middle, decay back to 0 by phaseProgress=1
    // so the formation arrives in green, not cyan.
    if (tick.phase === PHASE_MORPH) {
      const p = tick.phaseProgress;
      const rampUp = Math.min(1, p / 0.21);
      const rampDown = Math.min(1, (1 - p) / 0.14);
      material.uniforms.uCyanTint.value = Math.max(0, Math.min(rampUp, rampDown));
    } else {
      material.uniforms.uCyanTint.value = 0;
    }

    // Slow Y-axis rotation during drift + hold; freezes during morph
    // so the morph reads cleanly. 0.05 rad/s ≈ 1 revolution per ~2 min.
    if (points && tick.phase !== PHASE_MORPH) {
      points.rotation.y += 0.05 * delta;
    }
  });

  if (!buffers) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[buffers.position, 3]}
        />
        <bufferAttribute
          attach="attributes-previousTarget"
          args={[buffers.previousTarget, 3]}
        />
        <bufferAttribute
          attach="attributes-targetPosition"
          args={[buffers.targetPosition, 3]}
        />
        <bufferAttribute
          attach="attributes-morphSeed"
          args={[buffers.morphSeed, 1]}
        />
        <bufferAttribute
          attach="attributes-trajectoryNoise"
          args={[buffers.trajectoryNoise, 3]}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={SWARM_VERTEX_SHADER}
        fragmentShader={SWARM_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
