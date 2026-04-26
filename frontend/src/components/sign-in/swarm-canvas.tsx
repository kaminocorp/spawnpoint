"use client";

import { Canvas } from "@react-three/fiber";

import { CAMERA_FOV, CAMERA_POSITION, type ShapeName } from "./shapes";
import { SwarmPoints } from "./swarm-points";

/** All six baked shapes are live in the rotation as of Phase 4. */
const ACTIVE_SHAPES: readonly ShapeName[] = [
  "chevron",
  "octahedron",
  "torus",
  "globe",
  "network",
  "wordmark",
];

export default function SwarmCanvas() {
  return (
    <Canvas
      camera={{ position: [...CAMERA_POSITION], fov: CAMERA_FOV }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.15} />
      <SwarmPoints shapes={ACTIVE_SHAPES} />
    </Canvas>
  );
}
