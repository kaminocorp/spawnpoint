/**
 * Fragment shader for the swarm — Phase 3 color story.
 *
 * Rest color: pearl base (#d9ebd9-ish) mixed with brand green (#22c55e)
 * at 0.4. During MORPH the scheduler ramps `uCyanTint` 0 → 1 → 0; we mix
 * the rest color toward cyan (#06b6d4) by that amount. Cyan reads as
 * "in flight" (the design system's transient-state hint, per
 * implementation plan decision §3); particles settle back into green.
 *
 * Point softness via `exp(-d*d*8.0)`, discard at <0.01 to keep the
 * additive blend from haloing across half-transparent pixels.
 */
export const SWARM_FRAGMENT_SHADER = /* glsl */ `
uniform float uCyanTint;

varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float soft = exp(-d * d * 8.0);
  if (soft < 0.01) discard;

  vec3 pearl = vec3(0.85, 0.92, 0.85);
  vec3 green = vec3(0.133, 0.773, 0.369);
  vec3 cyan  = vec3(0.024, 0.714, 0.831);

  vec3 rest = mix(pearl, green, 0.4);
  vec3 color = mix(rest, cyan, clamp(uCyanTint, 0.0, 1.0));

  gl_FragColor = vec4(color, vAlpha * soft);
}
`;
