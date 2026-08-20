/**
 * Derived geometry for the 3 windows: flattened SVG contours, their world-space
 * centers, and the same contours re-expressed local to each center (so a window can
 * be moved/scaled by transforming its group instead of rebuilding its points).
 */
import { CRISP } from '../data/svg-window-set';
import { centroid, flattenPath, toWorld, type Point2 } from '../geometry/svg-path';

/** Window indices: 0 = center (holds the GLB star), 1 = left, 2 = right. */
export const WINDOW_INDICES = [0, 1, 2] as const;
export type WindowIndex = (typeof WINDOW_INDICES)[number];

/**
 * 12 steps per cubic left the contour at ~145 points, i.e. roughly an 8px chord on a
 * desktop viewport — enough to see the neon as a polyline where the star tips curve
 * hardest. This is a one-time cost at import (a few hundred more verts in a 290-tri
 * ribbon and one extra triangulation pass), so it buys smooth curves for free.
 */
const winFlat = CRISP.map((d) => flattenPath(d, 32));

/** World-space center of each window contour. */
export const winCentersW: Point2[] = winFlat.map((flat) => toWorld(centroid(flat)));

/** Each window's contour in world units, relative to its own center. */
export const crispLocal: Point2[][] = winFlat.map((flat, i) => {
  const c = winCentersW[i];
  return flat.map(toWorld).map((p): Point2 => [p[0] - c[0], p[1] - c[1]]);
});

/** Bounding radius of each local contour — used for mask early-outs and spill size. */
export const winRadii: number[] = crispLocal.map((pts) =>
  Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))),
);
