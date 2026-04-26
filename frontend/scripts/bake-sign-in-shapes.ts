/**
 * Manual shape-target bake for the sign-in swarm animation.
 *
 *   pnpm -C frontend bake-shapes
 *
 * Outputs one Float32Array buffer per shape under
 * `public/sign-in/shape-targets/<name>.bin`. Each buffer is N×3 floats
 * (PARTICLE_COUNT × {x, y, z}). Re-run when a shape's silhouette changes;
 * the .bin files are committed binaries, reviewable artefacts.
 *
 * The bake projects each candidate sample through a fixed camera matrix
 * (camera params locked in `shapes.ts`) and rejects any sample whose 2D
 * screen-projection falls inside the form's bounding rect (plus padding).
 * This is what makes the inner fill of the chevron, the centre of the
 * octahedron, and the hole of the torus naturally clear the form area
 * at runtime — no per-frame per-particle test needed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  PerspectiveCamera,
  TorusGeometry,
  Vector3,
} from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  CAMERA_FOV,
  CAMERA_POSITION,
  FORM_H_PX,
  FORM_PAD_PX,
  FORM_W_PX,
  PARTICLE_COUNT,
  VIEWPORT_H,
  VIEWPORT_W,
} from "../src/components/sign-in/shapes";

// Form half-extents in NDC. NDC ranges [-1, 1]; the form occupies a
// fraction of viewport, and that fraction *is* the NDC half-extent (the
// factors of 2 cancel: `frac * 2 / 2 === frac`).
const FORM_HALF_NDC_X = (FORM_W_PX + 2 * FORM_PAD_PX) / VIEWPORT_W;
const FORM_HALF_NDC_Y = (FORM_H_PX + 2 * FORM_PAD_PX) / VIEWPORT_H;

const SAMPLE_CAP_MULTIPLIER = 10;
const OUT_DIR = resolve(process.cwd(), "public", "sign-in", "shape-targets");

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(
    CAMERA_FOV,
    VIEWPORT_W / VIEWPORT_H,
    0.1,
    100,
  );
  camera.position.set(...CAMERA_POSITION);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function isInsideForm(p: Vector3, camera: PerspectiveCamera): boolean {
  const projected = p.clone().project(camera);
  return (
    Math.abs(projected.x) <= FORM_HALF_NDC_X &&
    Math.abs(projected.y) <= FORM_HALF_NDC_Y
  );
}

function sampleSurface(
  geometry: BufferGeometry,
  n: number,
  camera: PerspectiveCamera,
): Float32Array {
  const mesh = new Mesh(geometry);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const out = new Float32Array(n * 3);
  const target = new Vector3();
  let written = 0;
  let attempts = 0;
  const cap = n * SAMPLE_CAP_MULTIPLIER;
  while (written < n && attempts < cap) {
    attempts++;
    sampler.sample(target);
    if (isInsideForm(target, camera)) continue;
    out[written * 3] = target.x;
    out[written * 3 + 1] = target.y;
    out[written * 3 + 2] = target.z;
    written++;
  }
  if (written < n) {
    throw new Error(
      `sampleSurface: only ${written}/${n} samples after ${attempts} attempts`,
    );
  }
  return out;
}

function sampleEdges(
  edges: BufferGeometry,
  n: number,
  camera: PerspectiveCamera,
  jitterAmplitude: number,
): Float32Array {
  const positions = edges.getAttribute("position");
  const edgeCount = positions.count / 2;

  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < edgeCount; i++) {
    const a = new Vector3().fromBufferAttribute(positions, i * 2);
    const b = new Vector3().fromBufferAttribute(positions, i * 2 + 1);
    const l = a.distanceTo(b);
    lengths.push(l);
    total += l;
  }

  // Cumulative weights for inverse-CDF sampling by edge length.
  const cdf: number[] = [];
  let acc = 0;
  for (const l of lengths) {
    acc += l / total;
    cdf.push(acc);
  }

  const out = new Float32Array(n * 3);
  const target = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  let written = 0;
  let attempts = 0;
  const cap = n * SAMPLE_CAP_MULTIPLIER;
  while (written < n && attempts < cap) {
    attempts++;
    const r = Math.random();
    let edgeIdx = cdf.findIndex((c) => c >= r);
    if (edgeIdx === -1) edgeIdx = edgeCount - 1;
    a.fromBufferAttribute(positions, edgeIdx * 2);
    b.fromBufferAttribute(positions, edgeIdx * 2 + 1);
    target.lerpVectors(a, b, Math.random());
    target.x += (Math.random() - 0.5) * jitterAmplitude;
    target.y += (Math.random() - 0.5) * jitterAmplitude;
    target.z += (Math.random() - 0.5) * jitterAmplitude;
    if (isInsideForm(target, camera)) continue;
    out[written * 3] = target.x;
    out[written * 3 + 1] = target.y;
    out[written * 3 + 2] = target.z;
    written++;
  }
  if (written < n) {
    throw new Error(
      `sampleEdges: only ${written}/${n} samples after ${attempts} attempts`,
    );
  }
  return out;
}

function writeBin(name: string, data: Float32Array): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${name}.bin`);
  writeFileSync(path, Buffer.from(data.buffer));
  const kb = (data.byteLength / 1024).toFixed(1);
  console.log(`  ${name}.bin — ${data.length / 3} pts, ${kb} KB`);
}

function bakeChevron(camera: PerspectiveCamera): void {
  // Chevron `›` lying in the XY plane, apex pointing right at (+w, 0).
  // Top arm: (-w, +h) → (+w, 0).  Bottom arm: (-w, -h) → (+w, 0).
  // Sized so the arms clear the form's NDC box at form-edge X — see the
  // form-clearing rejection inside `sampleSurface`.
  const w = 2.8;
  const h = 2.6;
  const armWidth = 0.5;
  const depth = 0.4;

  const armLen = Math.hypot(2 * w, h);
  // Direction angle from arm's start to apex; top arm slopes down-right.
  const topAngle = Math.atan2(-h, 2 * w);

  function makeArm(angle: number, midY: number): BufferGeometry {
    const box = new BoxGeometry(armLen, armWidth, depth);
    const m = new Matrix4().makeRotationZ(angle).setPosition(0, midY, 0);
    box.applyMatrix4(m);
    return box;
  }

  const top = makeArm(topAngle, h / 2);
  const bottom = makeArm(-topAngle, -h / 2);
  const merged = mergeGeometries([top, bottom]);
  if (!merged) throw new Error("chevron: mergeGeometries returned null");

  writeBin("chevron", sampleSurface(merged, PARTICLE_COUNT, camera));
}

function bakeOctahedron(camera: PerspectiveCamera): void {
  // Wireframe octahedron — sample edge points only. Subdivisions=0 keeps
  // edges crisp (12 edges from 6 vertices). Small lateral jitter so the
  // wireframe reads as "particles tracing edges," not as razor-thin lines.
  const radius = 1.8;
  const octa = new OctahedronGeometry(radius, 0);
  const edges = new EdgesGeometry(octa);
  writeBin(
    "octahedron",
    sampleEdges(edges, PARTICLE_COUNT, camera, 0.04),
  );
}

function bakeTorus(camera: PerspectiveCamera): void {
  // Torus surface — the inner hole at origin naturally clears the form.
  // Major 1.6, minor 0.35: hole radius ~1.25 world units (well outside
  // the form's projected ~0.84-world-half-height central rectangle).
  const torus = new TorusGeometry(1.6, 0.35, 16, 96);
  writeBin("torus", sampleSurface(torus, PARTICLE_COUNT, camera));
}

function makeGlobeGeometry(): BufferGeometry {
  // Wireframe globe: 8 longitude meridians + 5 latitude parallels.
  // Built as line segments (consecutive vertex pairs) so the existing
  // `sampleEdges` path consumes it without modification.
  const radius = 1.9;
  const longitudes = 8;
  const latitudes = 5;
  const segPerArc = 24;

  const positions: number[] = [];

  // Meridians — full great circles in longitude planes.
  for (let i = 0; i < longitudes; i++) {
    const phi = (i / longitudes) * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let j = 0; j < segPerArc; j++) {
      const t0 = (j / segPerArc) * Math.PI * 2;
      const t1 = ((j + 1) / segPerArc) * Math.PI * 2;
      const x0 = radius * Math.sin(t0) * cosPhi;
      const y0 = radius * Math.cos(t0);
      const z0 = radius * Math.sin(t0) * sinPhi;
      const x1 = radius * Math.sin(t1) * cosPhi;
      const y1 = radius * Math.cos(t1);
      const z1 = radius * Math.sin(t1) * sinPhi;
      positions.push(x0, y0, z0, x1, y1, z1);
    }
  }

  // Parallels — equator + 2 above + 2 below; skip the poles (degenerate).
  for (let k = 1; k <= latitudes; k++) {
    const lat = (k / (latitudes + 1)) * Math.PI; // 0..π exclusive
    const y = radius * Math.cos(lat);
    const r = radius * Math.sin(lat);
    for (let j = 0; j < segPerArc; j++) {
      const t0 = (j / segPerArc) * Math.PI * 2;
      const t1 = ((j + 1) / segPerArc) * Math.PI * 2;
      positions.push(
        r * Math.cos(t0), y, r * Math.sin(t0),
        r * Math.cos(t1), y, r * Math.sin(t1),
      );
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return g;
}

function bakeGlobe(camera: PerspectiveCamera): void {
  const edges = makeGlobeGeometry();
  // Smaller jitter than the octahedron — more edges already, want each
  // meridian/parallel to read as a clean curve, not a fuzzy band.
  writeBin("globe", sampleEdges(edges, PARTICLE_COUNT, camera, 0.025));
}

type Edge = readonly [number, number];

function poissonDiskNodes(
  count: number,
  half: number,
  minDistance: number,
  camera: PerspectiveCamera,
  rng: () => number,
): Vector3[] {
  // Brute-force min-distance rejection in a 2*half cube. Candidate
  // nodes whose 2D projection falls inside the form rect (with a
  // sigma-sized margin) are also rejected — that way every surviving
  // node can host a full Gaussian cloud without form-clearing
  // starvation in the sampling loop downstream.
  const nodes: Vector3[] = [];
  const cap = count * 80;
  let attempts = 0;
  const minSq = minDistance * minDistance;
  while (nodes.length < count && attempts < cap) {
    attempts++;
    const candidate = new Vector3(
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half,
    );
    if (isInsideForm(candidate, camera)) continue;
    let ok = true;
    for (const n of nodes) {
      if (n.distanceToSquared(candidate) < minSq) {
        ok = false;
        break;
      }
    }
    if (ok) nodes.push(candidate);
  }
  if (nodes.length < count) {
    throw new Error(
      `poissonDiskNodes: only ${nodes.length}/${count} after ${attempts} attempts`,
    );
  }
  return nodes;
}

function nearestNeighborEdges(nodes: Vector3[], k: number): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const distances = nodes
      .map((n, j) => ({ j, d: nodes[i].distanceToSquared(n) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of distances) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j] as const);
    }
  }
  return edges;
}

function gaussianSample(center: Vector3, sigma: number, rng: () => number): Vector3 {
  // Box-Muller for two Gaussians at a time; we use only one each call.
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  const t = 2 * Math.PI * u2;
  const g1 = r * Math.cos(t);
  const g2 = r * Math.sin(t);
  const u3 = Math.max(rng(), 1e-9);
  const r2 = Math.sqrt(-2 * Math.log(u3));
  const t2 = 2 * Math.PI * rng();
  const g3 = r2 * Math.cos(t2);
  return new Vector3(
    center.x + g1 * sigma,
    center.y + g2 * sigma,
    center.z + g3 * sigma,
  );
}

function bakeNetwork(camera: PerspectiveCamera): void {
  // Deterministic-but-stochastic graph: ~30 nodes Poisson-disk-spaced,
  // each linked to its 2 nearest neighbors → ~50 unique edges. 60% of
  // particles are Gaussian clouds at nodes ("dense node markers"); 40%
  // trace edges with light lateral jitter ("connections").
  const rng = Math.random;
  const half = 1.7;
  const nodeCount = 30;
  const minDistance = 0.85; // governs visual breathing room

  const nodes = poissonDiskNodes(nodeCount, half, minDistance, camera, rng);
  const edges = nearestNeighborEdges(nodes, 2);

  const nodeShare = Math.floor(PARTICLE_COUNT * 0.6);
  const edgeShare = PARTICLE_COUNT - nodeShare;

  const out = new Float32Array(PARTICLE_COUNT * 3);
  let written = 0;

  // Per-loop attempt caps so a stuck node loop can't starve the edge
  // loop (or vice versa).
  const nodeCap = nodeShare * SAMPLE_CAP_MULTIPLIER;
  const edgeCap = edgeShare * SAMPLE_CAP_MULTIPLIER;

  // Node clouds — even allocation across nodes; tiny remainder absorbed
  // into the first few nodes.
  const perNode = Math.floor(nodeShare / nodes.length);
  const remainder = nodeShare - perNode * nodes.length;
  let nodeAttempts = 0;
  let nodePlaced = 0;
  for (let i = 0; i < nodes.length; i++) {
    const target = perNode + (i < remainder ? 1 : 0);
    let placed = 0;
    while (placed < target && nodeAttempts < nodeCap) {
      nodeAttempts++;
      const p = gaussianSample(nodes[i], 0.09, rng);
      if (isInsideForm(p, camera)) continue;
      out[written * 3] = p.x;
      out[written * 3 + 1] = p.y;
      out[written * 3 + 2] = p.z;
      written++;
      placed++;
      nodePlaced++;
    }
  }
  if (nodePlaced < nodeShare) {
    throw new Error(
      `bakeNetwork: nodes ${nodePlaced}/${nodeShare} after ${nodeAttempts} attempts`,
    );
  }

  // Edge particles — uniform along edges weighted by edge length, with
  // ±0.025 lateral jitter per axis so the connection reads as a soft
  // tracer beam rather than a single-pixel line.
  const edgeLengths = edges.map(([a, b]) =>
    nodes[a].distanceTo(nodes[b]),
  );
  const totalEdgeLen = edgeLengths.reduce((acc, l) => acc + l, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const l of edgeLengths) {
    acc += l / totalEdgeLen;
    cdf.push(acc);
  }

  let edgePlaced = 0;
  let edgeAttempts = 0;
  while (edgePlaced < edgeShare && edgeAttempts < edgeCap) {
    edgeAttempts++;
    const r = rng();
    let idx = cdf.findIndex((c) => c >= r);
    if (idx === -1) idx = edges.length - 1;
    const [a, b] = edges[idx];
    const t = rng();
    const p = new Vector3().lerpVectors(nodes[a], nodes[b], t);
    p.x += (rng() - 0.5) * 0.05;
    p.y += (rng() - 0.5) * 0.05;
    p.z += (rng() - 0.5) * 0.05;
    if (isInsideForm(p, camera)) continue;
    out[written * 3] = p.x;
    out[written * 3 + 1] = p.y;
    out[written * 3 + 2] = p.z;
    written++;
    edgePlaced++;
  }
  if (edgePlaced < edgeShare) {
    throw new Error(
      `bakeNetwork: edges ${edgePlaced}/${edgeShare} after ${edgeAttempts} attempts`,
    );
  }

  writeBin("network", out);
}

// 5×7 pixel-font glyphs for the eight letters of "CORELLIA". Rows top
// → bottom, columns left → right. `#` = on pixel (becomes a small box
// in the merged geometry); `.` = off. Hand-drawn for a terminal feel
// matching the rest of Corellia's design system.
const GLYPHS_5x7: Record<string, readonly string[]> = {
  C: [
    ".###.",
    "#...#",
    "#....",
    "#....",
    "#....",
    "#...#",
    ".###.",
  ],
  O: [
    ".###.",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    ".###.",
  ],
  R: [
    "####.",
    "#...#",
    "#...#",
    "####.",
    "#.#..",
    "#..#.",
    "#...#",
  ],
  E: [
    "#####",
    "#....",
    "#....",
    "####.",
    "#....",
    "#....",
    "#####",
  ],
  L: [
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#####",
  ],
  I: [
    "#####",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "#####",
  ],
  A: [
    ".###.",
    "#...#",
    "#...#",
    "#####",
    "#...#",
    "#...#",
    "#...#",
  ],
};

function bakeWordmark(camera: PerspectiveCamera): void {
  // Pixel-font path: each "on" cell becomes a small BoxGeometry, all
  // letters merged, then surface-sampled. Pixelated by design — reads
  // as a terminal/typeface-cousin to Space Mono in the rest of the chrome.
  // No font-asset dependency to ship; the bake is purely arithmetic.
  const text = "CORELLIA";
  const pixelSize = 0.16;
  const letterCols = 5;
  const letterRows = 7;
  const letterSpacingPx = 1; // blank columns between letters
  const depth = 0.18;

  const letterWidth = pixelSize * letterCols;
  const letterHeight = pixelSize * letterRows;
  const advance = pixelSize * (letterCols + letterSpacingPx);

  const totalWidth = letterWidth + advance * (text.length - 1);
  const startX = -totalWidth / 2;

  // Wordmark sits in the lower third of the canvas. Y offset chosen so
  // the wordmark's vertical centre aligns ~−1.4 in scene coords (below
  // the form's projected lower edge at z=0).
  const baseY = -1.4 - letterHeight / 2;

  const boxes: BoxGeometry[] = [];
  const box = new BoxGeometry(pixelSize, pixelSize, depth);
  for (let l = 0; l < text.length; l++) {
    const glyph = GLYPHS_5x7[text[l]];
    if (!glyph) throw new Error(`bakeWordmark: missing glyph for "${text[l]}"`);
    for (let r = 0; r < letterRows; r++) {
      const row = glyph[r];
      for (let c = 0; c < letterCols; c++) {
        if (row[c] !== "#") continue;
        const x = startX + l * advance + (c + 0.5) * pixelSize;
        const y = baseY + (letterRows - 1 - r + 0.5) * pixelSize;
        const m = new Matrix4().setPosition(x, y, 0);
        const cell = box.clone().applyMatrix4(m);
        boxes.push(cell);
      }
    }
  }

  const merged = mergeGeometries(boxes);
  if (!merged) throw new Error("bakeWordmark: mergeGeometries returned null");
  // Wordmark sits below the form, so form-clearing rejection is
  // structurally a no-op here — but kept for symmetry and as cheap
  // insurance if the Y offset ever drifts upward in tuning.
  writeBin("wordmark", sampleSurface(merged, PARTICLE_COUNT, camera));
}

function main(): void {
  const camera = makeCamera();
  console.log(
    `bake config: ${PARTICLE_COUNT} pts/shape · viewport ${VIEWPORT_W}x${VIEWPORT_H} · ` +
      `form half-NDC (${FORM_HALF_NDC_X.toFixed(3)}, ${FORM_HALF_NDC_Y.toFixed(3)})`,
  );
  console.log(`out: ${OUT_DIR}`);
  bakeChevron(camera);
  bakeOctahedron(camera);
  bakeTorus(camera);
  bakeGlobe(camera);
  bakeNetwork(camera);
  bakeWordmark(camera);
  console.log("done.");
}

main();
