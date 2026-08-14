/** SVG path flattening + SVG->world coordinate helpers. */
import { SVG_H, SVG_W } from '../data/svg-window-set';

/** A 2D point as a plain tuple — cheap to build in bulk, no THREE allocation. */
export type Point2 = [number, number];

/**
 * Minimal SVG path parser (M/C/L/H/V/Z) that flattens to a point list.
 * Cubic segments are sampled with `steps` subdivisions.
 */
export function flattenPath(d: string, steps = 10): Point2[] {
  const toks = d.match(/[MCLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!toks) return [];
  let i = 0;
  let x = 0;
  let y = 0;
  const pts: Point2[] = [];
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    const cmd = toks[i++];
    if (cmd === 'M' || cmd === 'L') {
      x = num();
      y = num();
      pts.push([x, y]);
    } else if (cmd === 'H') {
      x = num();
      pts.push([x, y]);
    } else if (cmd === 'V') {
      y = num();
      pts.push([x, y]);
    } else if (cmd === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x3 = num();
      const y3 = num();
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const iu = 1 - u;
        const bx = iu * iu * iu * x + 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u * x3;
        const by = iu * iu * iu * y + 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u * y3;
        pts.push([bx, by]);
      }
      x = x3;
      y = y3;
    } else if (cmd === 'Z') {
      /* close — the contour is already implicitly closed by consumers */
    } else {
      i--;
      break;
    }
  }
  return pts;
}

export function centroid(pts: readonly Point2[]): Point2 {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / pts.length, cy / pts.length];
}

/** SVG units -> world units. */
export const WSCALE = 1 / 100;

/** world: x = SVGx - SVG_W/2 (centered), y = SVG_H/2 - SVGy (y-up), scaled by WSCALE. */
export function toWorld(p: Point2): Point2 {
  return [(p[0] - SVG_W / 2) * WSCALE, (SVG_H / 2 - p[1]) * WSCALE];
}

/** Apply an SVG `transform` attribute (only matrix()/rotate() appear in our data). */
export function applyTf(tf: string, x: number, y: number): Point2 {
  if (!tf) return [x, y];
  const m = tf.match(/-?\d+\.?\d*/g)?.map(Number);
  if (!m) return [x, y];
  if (tf.startsWith('matrix')) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  if (tf.startsWith('rotate')) {
    const ang = (m[0] * Math.PI) / 180;
    const cx = m[1];
    const cy = m[2];
    const dx = x - cx;
    const dy = y - cy;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
  }
  return [x, y];
}
