import * as THREE from 'three';
import type { Point2 } from './svg-path';

/**
 * Below this cosine (~70.5° between the miter and either segment normal) the miter
 * is bevelled instead of stretched. A star tip's interior angle is small enough that
 * 1/cos(half-angle) is still several widths long even after a generous clamp — long
 * enough to poke a visible spike past the point — so past this threshold the join
 * falls back to the plain (unstretched) bisector rather than merely capping the miter
 * length, which only shortens the spike without removing it.
 */
const MITER_COS_CUTOFF = 0.34;

/**
 * Build a triangle ribbon (real, adjustable width) around a closed contour.
 * A THREE.Line cannot thicken past 1px — that is a WebGL/browser limit — so the
 * neon outlines are real triangles. The perpendicular direction per vertex is
 * baked into an `aOffset` attribute, which lets the shader scale width live.
 *
 * `aOffset` is a MITERED normal — its length is 1/cos(half-angle), so the ribbon keeps
 * a constant perpendicular thickness through corners instead of pinching at them (the
 * star tips used to visibly narrow). `aSide` runs -1..+1 across the width, which is
 * what lets the fragment shader shade a soft tube cross-section and antialias its own
 * edge — the composer target has no MSAA, so without it the stroke is a hard-edged
 * band that crawls as soon as it is a couple of pixels wide.
 */
export function buildRibbonGeometry(loopPts: readonly Point2[]): THREE.BufferGeometry {
  const n = loopPts.length;
  const positions = new Float32Array(n * 2 * 3);
  const offsets = new Float32Array(n * 2 * 3);
  const sides = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const prev = loopPts[(k - 1 + n) % n];
    const curr = loopPts[k];
    const next = loopPts[(k + 1) % n];
    // Per-segment normals, then the bisector between them: that is the miter direction.
    let ax = curr[0] - prev[0];
    let ay = curr[1] - prev[1];
    const al = Math.hypot(ax, ay) || 1;
    ax /= al;
    ay /= al;
    let bx = next[0] - curr[0];
    let by = next[1] - curr[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const an = [-ay, ax];
    const bn = [-by, bx];
    let mx = an[0] + bn[0];
    let my = an[1] + bn[1];
    const ml = Math.hypot(mx, my);
    let nx: number;
    let ny: number;
    if (ml < 1e-6) {
      // Exact reversal (a cusp): no bisector exists, fall back to one segment's normal.
      nx = bn[0];
      ny = bn[1];
    } else {
      mx /= ml;
      my /= ml;
      const cosHalf = mx * bn[0] + my * bn[1];
      if (cosHalf < MITER_COS_CUTOFF) {
        // Bevel: the plain unit bisector, no 1/cos stretch. Slightly narrows the very
        // tip of a sharp point instead of spiking past it — the right trade at a corner
        // this acute, where a true miter would be many widths long.
        nx = mx;
        ny = my;
      } else {
        // 1/cos(half-angle) between the miter and either segment normal.
        const scale = 1 / cosHalf;
        nx = mx * scale;
        ny = my * scale;
      }
    }
    const i0 = k * 6;
    positions[i0] = curr[0];
    positions[i0 + 1] = curr[1];
    positions[i0 + 2] = 0.01;
    positions[i0 + 3] = curr[0];
    positions[i0 + 4] = curr[1];
    positions[i0 + 5] = 0.01;
    offsets[i0] = nx;
    offsets[i0 + 1] = ny;
    offsets[i0 + 2] = 0;
    offsets[i0 + 3] = -nx;
    offsets[i0 + 4] = -ny;
    offsets[i0 + 5] = 0;
    sides[k * 2] = 1;
    sides[k * 2 + 1] = -1;
  }
  const indices: number[] = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const a = k * 2;
    const b = k * 2 + 1;
    const c = k2 * 2;
    const d = k2 * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  geo.setIndex(indices);
  return geo;
}

/**
 * Same ribbon idea as {@link buildRibbonGeometry}, but for an open polyline (grid
 * strokes). Callers pack extra vertex attrs after this returns, or use the arrays
 * below to merge many strokes into one draw.
 */
export function appendOpenRibbon(
  pts: readonly Point2[],
  positions: number[],
  offsets: number[],
  indices: number[],
  onVertex?: (k: number, n: number) => void,
): void {
  const n = pts.length;
  if (n < 2) return;
  const vbase = positions.length / 3;
  for (let k = 0; k < n; k++) {
    const curr = pts[k];
    const prev = pts[k === 0 ? 0 : k - 1];
    const next = pts[k === n - 1 ? n - 1 : k + 1];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    positions.push(curr[0], curr[1], 0, curr[0], curr[1], 0);
    offsets.push(nx, ny, 0, -nx, -ny, 0);
    onVertex?.(k, n);
  }
  for (let k = 0; k < n - 1; k++) {
    const a = vbase + k * 2;
    const b = a + 1;
    const c = vbase + (k + 1) * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
}
