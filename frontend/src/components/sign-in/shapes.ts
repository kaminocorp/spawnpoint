export const PARTICLE_COUNT = 18000;
export const PARTICLE_COUNT_MOBILE = 6000;

export const SHAPE_NAMES = [
  "chevron",
  "octahedron",
  "torus",
  "globe",
  "network",
  "wordmark",
] as const;

export type ShapeName = (typeof SHAPE_NAMES)[number];

export const VIEWPORT_W = 1920;
export const VIEWPORT_H = 1080;
export const FORM_W_PX = 360;
export const FORM_H_PX = 280;
export const FORM_PAD_PX = 24;

export const CAMERA_POSITION: readonly [number, number, number] = [0, 0, 6];
export const CAMERA_FOV = 50;
