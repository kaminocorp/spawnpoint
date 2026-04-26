import { PARTICLE_COUNT, type ShapeName } from "./shapes";

/**
 * Fetch each shape's baked Float32Array in parallel, parse to typed
 * arrays, and return a Map. Failures throw — there is no partial mode
 * (a missing shape would leave a hole in the rotation that the morph
 * engine has no contract for).
 *
 * The .bin files are committed binaries under
 * `public/sign-in/shape-targets/`. Each is `PARTICLE_COUNT × 3 × 4` bytes.
 */
export async function loadShapeTargets(
  names: readonly ShapeName[],
): Promise<Map<ShapeName, Float32Array>> {
  const expectedBytes = PARTICLE_COUNT * 3 * 4;
  const entries = await Promise.all(
    names.map(async (name): Promise<[ShapeName, Float32Array]> => {
      const url = `/sign-in/shape-targets/${name}.bin`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`shape-loader: ${url} returned HTTP ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength !== expectedBytes) {
        throw new Error(
          `shape-loader: ${url} is ${buf.byteLength} bytes, expected ${expectedBytes}`,
        );
      }
      return [name, new Float32Array(buf)];
    }),
  );
  return new Map(entries);
}
