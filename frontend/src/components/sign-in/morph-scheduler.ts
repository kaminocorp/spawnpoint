import type { ShapeName } from "./shapes";

/**
 * Internal phase enum. Three phases (not the four the design brief
 * names) — the brief's "travel" and "settle" are visually distinct
 * eased segments of one continuous interpolation, encoded inside the
 * MORPH branch of the vertex shader as `smoothstep(0,1,t)`.
 */
export type Phase = 0 | 1 | 2;
export const PHASE_DRIFT = 0 as const;
export const PHASE_MORPH = 1 as const;
export const PHASE_HOLD = 2 as const;

export type SchedulerTick = {
  phase: Phase;
  /** Progress within the current phase, 0..1. */
  phaseProgress: number;
  currentShape: ShapeName;
  previousShape: ShapeName;
};

const DRIFT_DURATION_S = 4;
const DRIFT_DURATION_AMORPHOUS_S = 8;
const MORPH_DURATION_S = 7;
const HOLD_DURATION_S = 7;
const HOLD_DURATION_WORDMARK_S = 12;

const AMORPHOUS_PROBABILITY = 0.4;

/**
 * Per-shape weight in the random rotation. Wordmark at 1/7 averages
 * to ~one wordmark beat per ~7 cycles in the long run; the short-term
 * cadence isn't deterministic, which is the point.
 */
const SHAPE_WEIGHTS: Record<ShapeName, number> = {
  chevron: 1,
  octahedron: 1,
  torus: 1,
  globe: 1,
  network: 1,
  wordmark: 1 / 7,
};

function holdDurationSeconds(shape: ShapeName): number {
  return shape === "wordmark" ? HOLD_DURATION_WORDMARK_S : HOLD_DURATION_S;
}

function pickWeighted(shapes: ShapeName[], rng: () => number): ShapeName {
  const total = shapes.reduce((acc, s) => acc + SHAPE_WEIGHTS[s], 0);
  let r = rng() * total;
  for (const s of shapes) {
    r -= SHAPE_WEIGHTS[s];
    if (r <= 0) return s;
  }
  return shapes[shapes.length - 1];
}

export class MorphScheduler {
  private readonly shapes: ShapeName[];
  private readonly rng: () => number;

  private currentShape: ShapeName;
  private previousShape: ShapeName;

  private phase: Phase = PHASE_DRIFT;
  private phaseStartedAt = 0;
  private currentDriftDurationS = DRIFT_DURATION_S;
  private currentHoldDurationS = HOLD_DURATION_S;

  constructor(shapes: ShapeName[], rng: () => number = Math.random) {
    if (shapes.length === 0) {
      throw new Error("MorphScheduler: requires at least one shape");
    }
    this.shapes = shapes;
    this.rng = rng;

    // Initial pair: previous = first pick, current = different pick (if
    // we have ≥2 shapes available). Both buffers will be populated with
    // `previousShape` at canvas mount; the first morph travels prev→curr.
    this.previousShape = pickWeighted(shapes, rng);
    this.currentShape = pickWeighted(shapes, rng);
    if (shapes.length > 1) {
      let attempts = 0;
      while (this.currentShape === this.previousShape && attempts < 8) {
        this.currentShape = pickWeighted(shapes, rng);
        attempts++;
      }
    }

    // Initial drift-with-amorphous-probability so the first cycle
    // starts with the right rhythm rather than always 4s.
    if (rng() < AMORPHOUS_PROBABILITY) {
      this.currentDriftDurationS = DRIFT_DURATION_AMORPHOUS_S;
    }
    this.currentHoldDurationS = holdDurationSeconds(this.currentShape);
  }

  /** Shape that should populate both buffers at canvas mount. */
  initialShape(): ShapeName {
    return this.previousShape;
  }

  tick(elapsedSeconds: number): SchedulerTick {
    const phaseDuration = this.currentPhaseDuration();
    const elapsedInPhase = elapsedSeconds - this.phaseStartedAt;

    if (elapsedInPhase >= phaseDuration) {
      this.advance(elapsedSeconds);
    }

    const updatedPhaseDuration = this.currentPhaseDuration();
    const updatedElapsedInPhase = elapsedSeconds - this.phaseStartedAt;
    const progress =
      updatedPhaseDuration > 0
        ? Math.min(1, Math.max(0, updatedElapsedInPhase / updatedPhaseDuration))
        : 1;

    return {
      phase: this.phase,
      phaseProgress: progress,
      currentShape: this.currentShape,
      previousShape: this.previousShape,
    };
  }

  private currentPhaseDuration(): number {
    if (this.phase === PHASE_DRIFT) return this.currentDriftDurationS;
    if (this.phase === PHASE_MORPH) return MORPH_DURATION_S;
    return this.currentHoldDurationS;
  }

  private advance(elapsedSeconds: number): void {
    this.phaseStartedAt = elapsedSeconds;
    if (this.phase === PHASE_DRIFT) {
      this.phase = PHASE_MORPH;
      return;
    }
    if (this.phase === PHASE_MORPH) {
      this.phase = PHASE_HOLD;
      return;
    }
    // Hold finished — advance to next shape's drift.
    this.previousShape = this.currentShape;
    let next = pickWeighted(this.shapes, this.rng);
    if (this.shapes.length > 1) {
      let attempts = 0;
      while (next === this.previousShape && attempts < 8) {
        next = pickWeighted(this.shapes, this.rng);
        attempts++;
      }
    }
    this.currentShape = next;
    this.currentDriftDurationS =
      this.rng() < AMORPHOUS_PROBABILITY
        ? DRIFT_DURATION_AMORPHOUS_S
        : DRIFT_DURATION_S;
    this.currentHoldDurationS = holdDurationSeconds(this.currentShape);
    this.phase = PHASE_DRIFT;
  }
}
