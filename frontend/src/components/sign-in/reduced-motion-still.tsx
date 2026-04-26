/**
 * Reduced-motion fallback for the `/sign-in` swarm background.
 *
 * Read as ambient wallpaper, not as a billboard. Three corrections from
 * the first cut, which projected as a viewport-filling chevron whenever
 * the page was tall-and-narrow:
 *
 *  - `preserveAspectRatio` flipped from `slice` to `meet` so the SVG
 *    scales to fit (no cropping that magnifies the silhouette on
 *    portrait-ish viewports).
 *  - Chevron scale halved (parallelograms shrunk to ~340×340 around
 *    centre vs the prior ~680×880). Quiet presence, not a hero.
 *  - Stipple sparser + dimmer (24px period, 0.9px radius, 0.45 opacity)
 *    so the silhouette reads as a texture suggestion rather than a
 *    solid mass.
 *
 * Pure DOM, no asset, no JS — the `prefers-reduced-motion` branch in
 * `swarm-background.tsx` short-circuits the R3F dynamic import, so the
 * three.js bundle never loads here.
 */
export function ReducedMotionStill() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center bg-black"
    >
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="presentation"
      >
        <defs>
          <pattern
            id="stipple"
            x="0"
            y="0"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx="12"
              cy="12"
              r="0.9"
              fill="rgb(178, 219, 178)"
              fillOpacity="0.45"
            />
          </pattern>
          <radialGradient id="halo" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(34, 197, 94, 0.06)" />
            <stop offset="60%" stopColor="rgba(0, 0, 0, 0)" />
          </radialGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#halo)" />
        <g fill="url(#stipple)" transform="translate(960 540)">
          <polygon points="-220,-170 -170,-220 120,-15 70,15" />
          <polygon points="-220,170 -170,220 120,15 70,-15" />
        </g>
      </svg>
    </div>
  );
}
