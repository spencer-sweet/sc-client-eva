/**
 * Window mask state: where each window sits and how big it is.
 *
 * The center window has its own offset/scale; the two side windows share one set of
 * controls (mirrored on X, including non-uniform scale). This is now purely transform
 * bookkeeping — the actual
 * cutout of the wall and the grid is done by the stencil buffer (see ./stencil.ts),
 * which follows the window groups automatically, so nothing here has to be pushed
 * into shaders or re-triangulated.
 */
import type { WindowIndex } from './geometry';

/** Center window (index 0) only — its own offset and non-uniform scale. */
export const centerMask = { offX: 0, offY: 0, scX: 1, scY: 1 };

/**
 * Left (1) / right (2) share this. positive offsetX pushes each window OUTWARD
 * (left goes further left, right further right); offsetY moves both the same way.
 */
export const sideMask = { offsetX: 0, offsetY: 0, scX: 1, scY: 1 };

export interface WindowTransform {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

export function winTransform(i: WindowIndex): WindowTransform {
  if (i === 0) {
    return { ox: centerMask.offX, oy: centerMask.offY, sx: centerMask.scX, sy: centerMask.scY };
  }
  const dirX = i === 1 ? -1 : 1;
  return {
    ox: dirX * sideMask.offsetX,
    oy: sideMask.offsetY,
    sx: sideMask.scX,
    sy: sideMask.scY,
  };
}
