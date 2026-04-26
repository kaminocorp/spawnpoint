/**
 * Per-harness mood palette for `<NebulaAvatar>` (Phase 2 of agents-ui-mods).
 *
 * Decision 5: per-harness divergence is *only* in palette + spatial weights.
 * Particle counts, Gaussian sigma, octave frequencies, rotation speeds stay
 * shared constants in the shader / scene — that is what makes every harness
 * read as part of the same visual family.
 *
 * Phase 3 will expand `HarnessKey` to the §3.5 roster (Hermes + 5 locked).
 * Locked harnesses use the SVG fallback (decision 13), so their palettes only
 * matter for the SVG accent stroke until they are promoted to AVAILABLE.
 */

export type Vec3 = readonly [number, number, number];

export type MoodPalette = {
  /** Pearl base — every fragment starts here, then tints mix in. */
  readonly pearl: Vec3;
  /** Four accent tints (decision 5). */
  readonly tints: readonly [Vec3, Vec3, Vec3, Vec3];
  /**
   * Mutually irrational sine frequencies driving how each tint cycles in
   * and out. Values around 0.02–0.05 keep the macro cycle minutes-long;
   * see `docs/refs/elephantasm-animation.md` for the same set.
   */
  readonly frequencies: readonly [number, number, number, number];
  /**
   * Mix intensities — how strongly each tint pushes against the pearl base.
   * Hermes' first tint (green) is the dominant per decision 6.
   */
  readonly intensities: readonly [number, number, number, number];
  /**
   * `(x, y, depth)` weights feeding the per-fragment spatial seed
   * (`vDisplaced.x*wx + vDisplaced.y*wy + vDepth*wd`). Same triple as
   * elephantasm-animation.md unless a harness has reason to differ.
   */
  readonly spatialWeights: Vec3;
  /**
   * CSS HSL string for the SVG fallback's accent stroke. Matches the
   * dominant tint perceptually so the static fallback is recognisably the
   * same harness as the live nebula.
   */
  readonly fallbackAccentHsl: string;
};

/**
 * Hermes — green-dominant per design-system §5.4 + decision 6.
 * Cyan + violet sample the system's adjacent feature colours; amber adds
 * warmth so the mix doesn't read as a single-hue gradient.
 */
const HERMES: MoodPalette = {
  pearl: [0.93, 0.91, 0.96],
  tints: [
    [0.45, 0.72, 0.5], // green — dominant (Corellia primary)
    [0.4, 0.75, 0.78], // cyan
    [0.55, 0.45, 0.8], // violet
    [0.85, 0.65, 0.35], // amber
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.3, 0.18, 0.15, 0.12],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(142 71% 45%)",
};

/**
 * Locked harness palettes — Phase 3 of `agents-ui-mods.md` §3.5.
 *
 * Locked cards render `<AvatarFallback>` (decision 13: only one canvas
 * mounts page-wide), so the *only* uniform that ships to the user today
 * is `fallbackAccentHsl`. The full mood palette is still defined so that
 * promotion to `AVAILABLE` is a one-line status flip in `harnesses.ts` —
 * no shader/palette work needed at promotion time.
 *
 * Mood signatures match `agents-ui-mods.md` §3.5 table. Tints are
 * best-guess; tunable when (if) the harness is promoted.
 */

const OPENCLAW: MoodPalette = {
  // OpenClaw vendor + brand colour TBD with operator (Phase 3 §1.1 Q13
  // resolution). Steel-grey placeholder so the card reads as honest
  // "not-yet-branded" rather than borrowing a colour from the system.
  pearl: [0.93, 0.93, 0.94],
  tints: [
    [0.55, 0.6, 0.65], // steel
    [0.42, 0.48, 0.55], // graphite
    [0.65, 0.7, 0.75], // brushed
    [0.78, 0.78, 0.8], // chrome highlight
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.28, 0.18, 0.14, 0.1],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(220 8% 62%)",
};

const CLAUDE_AGENT_SDK: MoodPalette = {
  // Warm amber + indigo — Anthropic-brand-adjacent without using their
  // exact orange (decision §3.5 row 3).
  pearl: [0.94, 0.92, 0.9],
  tints: [
    [0.88, 0.6, 0.32], // amber — dominant
    [0.42, 0.4, 0.72], // indigo
    [0.78, 0.5, 0.45], // dusk rose
    [0.6, 0.55, 0.45], // sand
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.3, 0.2, 0.14, 0.1],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(33 80% 58%)",
};

const DEEPAGENTS: MoodPalette = {
  // Cool teal + violet — LangChain green-blue family, leans cool to
  // differentiate from Hermes (decision §3.5 row 4).
  pearl: [0.91, 0.94, 0.95],
  tints: [
    [0.32, 0.7, 0.7], // teal — dominant
    [0.55, 0.45, 0.78], // violet
    [0.4, 0.62, 0.7], // marine
    [0.75, 0.78, 0.85], // mist
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.28, 0.2, 0.14, 0.1],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(180 50% 50%)",
};

const SUPERAGI: MoodPalette = {
  // Rose + amber — warm, multi-agent "swarm" reading (decision §3.5 row 5).
  pearl: [0.95, 0.92, 0.92],
  tints: [
    [0.82, 0.42, 0.55], // rose — dominant
    [0.85, 0.65, 0.35], // amber
    [0.7, 0.45, 0.6], // mauve
    [0.92, 0.78, 0.55], // peach
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.3, 0.2, 0.14, 0.1],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(345 60% 58%)",
};

const OPENFANG: MoodPalette = {
  // Steel-blue + indigo — Rust + "operating system" framing → cold,
  // structural (decision §3.5 row 6).
  pearl: [0.91, 0.93, 0.96],
  tints: [
    [0.42, 0.55, 0.72], // steel-blue — dominant
    [0.45, 0.42, 0.7], // indigo
    [0.55, 0.65, 0.78], // ice
    [0.7, 0.74, 0.82], // brushed
  ],
  frequencies: [0.037, 0.023, 0.043, 0.029],
  intensities: [0.28, 0.2, 0.14, 0.1],
  spatialWeights: [0.8, 0.6, 0.15],
  fallbackAccentHsl: "hsl(215 35% 58%)",
};

/** §3.5 lineup — Hermes active + 5 locked. Phase-3 widening of Phase 2's `"hermes"` literal. */
export type HarnessKey =
  | "hermes"
  | "openclaw"
  | "claude-agent-sdk"
  | "deepagents"
  | "superagi"
  | "openfang";

export const MOOD_PALETTES: Record<HarnessKey, MoodPalette> = {
  hermes: HERMES,
  openclaw: OPENCLAW,
  "claude-agent-sdk": CLAUDE_AGENT_SDK,
  deepagents: DEEPAGENTS,
  superagi: SUPERAGI,
  openfang: OPENFANG,
};

export function paletteFor(harness: HarnessKey): MoodPalette {
  return MOOD_PALETTES[harness];
}
