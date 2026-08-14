import * as THREE from 'three';
import type { Point2 } from './svg-path';

/**
 * Build a triangle ribbon (real, adjustable width) around a closed contour.
 * A THREE.Line cannot thicken past 1px — that is a WebGL/browser limit — so the
 * neon outlines are real triangles. The perpendicular direction per vertex is
 * baked into an `aOffset` attribute, which lets the shader scale width live.
 */
export function buildRibbonGeometry(loopPts: readonly Point2[]): THREE.BufferGeometry {
  const n = loopPts.length;
  const positions = new Float32Array(n * 2 * 3);
  const offsets = new Float32Array(n * 2 * 3);
  for (let k = 0; k < n; k++) {
    const prev = loopPts[(k - 1 + n) % n];
    const curr = loopPts[k];
    const next = loopPts[(k + 1) % n];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty; // perpendicular to the stroke
    const ny = tx;
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
  geo.setIndex(indices);
  return geo;
}
