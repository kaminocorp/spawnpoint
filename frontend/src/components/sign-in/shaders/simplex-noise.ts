/**
 * Re-export shim. The canonical home for the Ashima simplex-noise GLSL
 * constant is `@/lib/shaders/simplex-noise` (lifted in the
 * presentation-polish Phase 2 — three callers now: sign-in, spawn
 * nebula, presentation scenes). Sign-in's existing shader bundle keeps
 * this re-export so the local `./simplex-noise` import in `swarm-vert.ts`
 * (and any external `@/components/sign-in/shaders` consumer) keeps
 * working without churn.
 */
export { SIMPLEX_NOISE_GLSL } from "@/lib/shaders/simplex-noise";
