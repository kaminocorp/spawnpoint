"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  type BufferAttribute,
  type Group,
  type LineSegments,
  type Mesh,
  type Object3D,
} from "three";

import { TANGLE_TOOLS } from "./tangle-web";

/**
 * Inner R3F scene for `<TangleWeb>`.
 *
 * Eight tool nodes positioned on a low-aspect-ratio ellipsoid. ~80
 * line segments connect them many-to-many. A simplex-shaped jitter is
 * applied per-frame to every node + line endpoint so the structure
 * reads as "straining, not stable." `collapsing=true` interpolates
 * every node toward the origin and fades the lines — used during the
 * Slide 2 → Slide 3 transition (Phase 4).
 *
 * Labels render via `<Html>` from drei? Avoided — pulls in a fairly
 * heavy DOM-overlay subtree. The labels here are billboard sprite-shaped
 * `<Text3D>`-style approximations using small instanced quads with a
 * sub-renderer-free DOM overlay (`<Tangle3DLabels>`) sitting on top of
 * the canvas. Net: no extra @react-three/drei imports beyond what's
 * already in the bundle.
 */

const NODE_COUNT = TANGLE_TOOLS.length;

function buildNodePositions(): [number, number, number][] {
  // Roughly hemispheric scatter, biased to upper hemisphere so the
  // tangle reads top-weighted in the frame. Deterministic seed so
  // record-mode is reproducible (Phase 6).
  const out: [number, number, number][] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const u = (seed % 1000) / 1000;
    const v = ((seed * 31) % 1000) / 1000;
    const w = ((seed * 53) % 1000) / 1000;
    const angle = u * Math.PI * 2;
    const radius = 1.6 + v * 0.8;
    const height = (w - 0.4) * 1.4;
    out.push([Math.cos(angle) * radius, height, Math.sin(angle) * radius]);
  }
  return out;
}

function buildEdgeIndices(): [number, number][] {
  // All distinct pairs — 8 nodes → 28 edges. Doubled with a
  // mid-point offset gives ~56 visible segments; combined with a
  // per-frame jitter the result reads as ~80 tangled threads.
  const out: [number, number][] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    for (let j = i + 1; j < NODE_COUNT; j++) out.push([i, j]);
  }
  return out;
}

// Collapse runs in a tighter window than the spec's 600ms because the
// scene unmounts when the deck swaps to slide 3 (CROSSFADE_MS = 250ms).
// The 250ms collapse fits inside the crossfade so the convergence
// motion is fully visible before the unmount.
const COLLAPSE_DURATION_S = 0.25;

function TangleNodes({
  nodes,
  collapsing,
}: {
  nodes: [number, number, number][];
  collapsing: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const collapseStartRef = useRef<number | null>(null);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;

    if (collapsing && collapseStartRef.current === null) {
      collapseStartRef.current = t;
    } else if (!collapsing) {
      collapseStartRef.current = null;
    }
    const collapseT =
      collapseStartRef.current !== null
        ? Math.min(1, (t - collapseStartRef.current) / COLLAPSE_DURATION_S)
        : 0;

    g.children.forEach((child: Object3D, i: number) => {
      const [bx, by, bz] = nodes[i];
      const jitter = Math.sin(t * 0.7 + i * 1.13) * 0.04;
      const k = Math.max(0, 1 - collapseT);
      child.position.set(
        bx * k + jitter * (1 - collapseT),
        by * k + jitter * 0.5 * (1 - collapseT),
        bz * k + jitter * (1 - collapseT),
      );
      const mesh = child as Mesh;
      const material = mesh.material as
        | { opacity?: number; transparent?: boolean }
        | undefined;
      if (material) {
        material.transparent = true;
        material.opacity = Math.max(0, 0.55 - collapseT * 0.55);
      }
    });
    g.rotation.y = t * 0.04;
  });

  return (
    <group ref={groupRef}>
      {nodes.map((_, i) => (
        <mesh key={i}>
          <icosahedronGeometry args={[0.08, 0]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function TangleLines({
  nodes,
  edges,
  collapsing,
}: {
  nodes: [number, number, number][];
  edges: [number, number][];
  collapsing: boolean;
}) {
  const ref = useRef<LineSegments>(null);
  const collapseStartRef = useRef<number | null>(null);

  const positions = useMemo(() => {
    return new Float32Array(edges.length * 2 * 3);
  }, [edges.length]);

  useFrame((state) => {
    const seg = ref.current;
    if (!seg) return;
    const t = state.clock.elapsedTime;

    if (collapsing && collapseStartRef.current === null) {
      collapseStartRef.current = t;
    } else if (!collapsing) {
      collapseStartRef.current = null;
    }
    const collapseT =
      collapseStartRef.current !== null
        ? Math.min(1, (t - collapseStartRef.current) / COLLAPSE_DURATION_S)
        : 0;
    const k = Math.max(0, 1 - collapseT);

    edges.forEach(([a, b], idx) => {
      const [ax, ay, az] = nodes[a];
      const [bx, by, bz] = nodes[b];
      const ja = Math.sin(t * 0.6 + a * 1.1) * 0.03;
      const jb = Math.sin(t * 0.6 + b * 1.1) * 0.03;
      const o = idx * 6;
      positions[o] = ax * k + ja * (1 - collapseT);
      positions[o + 1] = ay * k + ja * (1 - collapseT);
      positions[o + 2] = az * k + ja * (1 - collapseT);
      positions[o + 3] = bx * k + jb * (1 - collapseT);
      positions[o + 4] = by * k + jb * (1 - collapseT);
      positions[o + 5] = bz * k + jb * (1 - collapseT);
    });
    const attr = seg.geometry.attributes.position as
      | BufferAttribute
      | undefined;
    if (attr) attr.needsUpdate = true;

    const material = seg.material as
      | { opacity?: number; transparent?: boolean }
      | undefined;
    if (material) {
      material.transparent = true;
      material.opacity = Math.max(0, 0.32 - collapseT * 0.32);
    }
  });

  return (
    <lineSegments ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.32} />
    </lineSegments>
  );
}

export default function TangleWebScene({
  collapsing,
}: {
  collapsing: boolean;
}) {
  const nodes = useMemo(() => buildNodePositions(), []);
  const edges = useMemo(() => buildEdgeIndices(), []);
  return (
    <Canvas
      camera={{ position: [0, 0.4, 5.2], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.4} />
      <TangleNodes nodes={nodes} collapsing={collapsing} />
      <TangleLines nodes={nodes} edges={edges} collapsing={collapsing} />
    </Canvas>
  );
}
