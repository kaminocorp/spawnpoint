import type { HarnessKey, MoodPalette, Vec3 } from "@/lib/spawn/mood-palettes";
import { paletteFor } from "@/lib/spawn/mood-palettes";

/**
 * Static SVG fallback for `<NebulaAvatar>`.
 *
 * Renders when:
 *  - `prefers-reduced-motion: reduce` is set,
 *  - WebGL is unavailable in the browser,
 *  - the nebula-scene dynamic import fails,
 *  - or a harness is `LOCKED` on the roster (decision 21: only one WebGL
 *    canvas mounts page-wide).
 *
 * Visual: a frozen particle cloud — Gaussian-distributed dots in the
 * harness's palette tints, layered over a soft halo. Same visual family as
 * the live R3F nebula, rendered as deterministic static SVG so it costs no
 * GPU and reads as the *same signature, paused*. No animations.
 */

const PARTICLE_COUNT = 520;
const CORE_COUNT = 90;
const PRIMARY_SIGMA = 0.42;
const CORE_SIGMA = 0.098;

export function AvatarFallback({
  harness,
  size,
}: {
  harness: HarnessKey;
  size: number;
}) {
  const palette = paletteFor(harness);
  const haloId = `nebula-fallback-halo-${harness}`;
  const seed = seedFor(harness);
  const cloud = buildCloud(seed, palette);
  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox="-1.2 -1.2 2.4 2.4"
      width={size}
      height={size}
      className="block"
    >
      <defs>
        <radialGradient id={haloId} cx="0" cy="0" r="1.1" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.fallbackAccentHsl} stopOpacity="0.18" />
          <stop offset="60%" stopColor={palette.fallbackAccentHsl} stopOpacity="0.04" />
          <stop offset="100%" stopColor={palette.fallbackAccentHsl} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="1.1" fill={`url(#${haloId})`} />
      <g style={{ mixBlendMode: "screen" }}>
        {cloud.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill={p.fill}
            fillOpacity={p.opacity}
          />
        ))}
      </g>
    </svg>
  );
}

type Particle = {
  x: number;
  y: number;
  r: number;
  fill: string;
  opacity: number;
};

function buildCloud(seed: number, palette: MoodPalette): Particle[] {
  const rng = mulberry32(seed);
  const out: Particle[] = [];
  // Primary cloud — broad Gaussian, palette-tinted, soft.
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const [x, y] = gaussian2D(rng, PRIMARY_SIGMA);
    const tint = pickTint(rng, palette);
    const dist = Math.hypot(x, y);
    // Particles further from centre fade — same density falloff the live
    // nebula gets from additive blending against a transparent backdrop.
    const opacity = Math.max(0.05, 0.55 - dist * 0.5);
    out.push({
      x,
      y,
      r: 0.008 + rng() * 0.016,
      fill: rgbCss(tint),
      opacity,
    });
  }
  // Core motes — tight Gaussian near centre, pearl-bright.
  const pearl = rgbCss(palette.pearl);
  for (let i = 0; i < CORE_COUNT; i++) {
    const [x, y] = gaussian2D(rng, CORE_SIGMA);
    out.push({
      x,
      y,
      r: 0.005 + rng() * 0.01,
      fill: pearl,
      opacity: 0.7,
    });
  }
  return out;
}

function gaussian2D(rng: () => number, sigma: number): [number, number] {
  const u = Math.max(1e-6, rng());
  const v = rng();
  const r = sigma * Math.sqrt(-2 * Math.log(u));
  const theta = v * Math.PI * 2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function pickTint(rng: () => number, palette: MoodPalette): Vec3 {
  // Weighted pick over the four tints by their intensity uniforms — matches
  // the live shader's tint dominance (Hermes green leads, others trail).
  const weights = palette.intensities;
  const total = weights[0] + weights[1] + weights[2] + weights[3];
  let pick = rng() * total;
  for (let i = 0; i < 4; i++) {
    pick -= weights[i];
    if (pick <= 0) return palette.tints[i];
  }
  return palette.tints[0];
}

function rgbCss(v: Vec3): string {
  return `rgb(${Math.round(v[0] * 255)}, ${Math.round(v[1] * 255)}, ${Math.round(v[2] * 255)})`;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(harness: HarnessKey): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < harness.length; i++) {
    h ^= harness.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
