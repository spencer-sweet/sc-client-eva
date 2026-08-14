/**
 * The vortex spine: control points, tension and localStorage persistence.
 * Deliberately independent of Theatre (same as the original) — the path is authored
 * with the Dev UI and remembered per browser.
 */
import * as THREE from 'three';

const STORAGE_KEY = 'vortexPath_ventanas_v2';
const MAX_POINTS = 12;

function defaultCtrl(): THREE.Vector3[] {
  return [
    new THREE.Vector3(0, 0, 15),
    new THREE.Vector3(0, 0, -17),
    new THREE.Vector3(0, 0, -49),
    new THREE.Vector3(0, 0, -81),
  ];
}

export const path = {
  ctrl: defaultCtrl(),
  tension: 0.5,
};

export function savePath(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ p: path.ctrl.map((v) => [v.x, v.y, v.z]), tension: path.tension }),
    );
  } catch {
    /* private mode / quota — the path just isn't remembered */
  }
}

export function loadPath(): void {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return;
    const o = JSON.parse(s) as { p?: [number, number, number][]; tension?: number };
    if (o.p && o.p.length >= 2) path.ctrl = o.p.map((a) => new THREE.Vector3(a[0], a[1], a[2]));
    if (typeof o.tension === 'number') path.tension = o.tension;
  } catch {
    /* corrupt payload — fall back to the defaults */
  }
}

export function buildCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    path.ctrl.map((v) => v.clone()),
    false,
    'catmullrom',
    path.tension,
  );
}

export function resetPath(): void {
  path.ctrl = defaultCtrl();
  path.tension = 0.5;
}

/** Insert a point after `afterIdx` (or extend past the end). Returns the new index. */
export function insertPoint(afterIdx: number): number | null {
  if (path.ctrl.length >= MAX_POINTS) return null;
  const i = afterIdx >= 0 ? afterIdx : path.ctrl.length - 1;
  const a = path.ctrl[i];
  const b = path.ctrl[Math.min(i + 1, path.ctrl.length - 1)];
  const np = a.clone().add(b).multiplyScalar(0.5);
  if (i === path.ctrl.length - 1) np.copy(a).add(new THREE.Vector3(0, 0, -16));
  path.ctrl.splice(i + 1, 0, np);
  return i + 1;
}

/** Remove a point; refuses to drop below the 2 needed for a curve. */
export function deletePoint(idx: number): boolean {
  if (path.ctrl.length <= 2 || idx < 0) return false;
  path.ctrl.splice(idx, 1);
  return true;
}
