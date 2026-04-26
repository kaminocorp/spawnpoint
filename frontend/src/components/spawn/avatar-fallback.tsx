import type { HarnessKey } from "@/lib/spawn/mood-palettes";
import { paletteFor } from "@/lib/spawn/mood-palettes";

/**
 * Static SVG fallback for `<NebulaAvatar>` (decision 4 of
 * `docs/executing/agents-ui-mods.md`).
 *
 * Renders when:
 *  - `prefers-reduced-motion: reduce` is set (decision 16: no half-states),
 *  - WebGL is unavailable in the browser,
 *  - the nebula-scene dynamic import fails,
 *  - or a harness is `LOCKED` on the roster (decision 13: performance
 *    ceiling — only one canvas live per page).
 *
 * Visual: hairline concentric "pearl" ellipses in the harness's accent
 * colour over a soft radial halo. Honest motion register per design-system
 * §28 — animated or not, never half. The SVG has no JS dependencies and is
 * cheap to mount in any quantity.
 */
export function AvatarFallback({
  harness,
  size,
}: {
  harness: HarnessKey;
  size: number;
}) {
  const stroke = paletteFor(harness).fallbackAccentHsl;
  const haloId = `nebula-fallback-halo-${harness}`;
  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className="block"
    >
      <defs>
        <radialGradient id={haloId} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.12" />
          <stop offset="70%" stopColor={stroke} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="240" fill="transparent" />
      <circle cx="120" cy="120" r="105" fill={`url(#${haloId})`} />
      <ellipse
        cx="120"
        cy="120"
        rx="80"
        ry="48"
        fill="none"
        stroke={stroke}
        strokeOpacity="0.55"
        strokeWidth="0.75"
      />
      <ellipse
        cx="120"
        cy="120"
        rx="50"
        ry="30"
        fill="none"
        stroke={stroke}
        strokeOpacity="0.35"
        strokeWidth="0.5"
      />
      <circle cx="120" cy="120" r="2.5" fill={stroke} fillOpacity="0.85" />
    </svg>
  );
}
