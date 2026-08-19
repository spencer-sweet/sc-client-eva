/**
 * The vortex spine: control points, tension and localStorage persistence.
 *
 * The points in index.ts are only fallbacks. On boot, hydrateVortexPathsFromTheatre()
 * overwrites them from theatre-state `ventanasVortexPaths`. localStorage is a scratch
 * copy updated while you edit; "Save Theatre JSON" is what commits the spine.
 *
 * One path per vortex instance: `createVortexPath` takes its own storage key so
 * Vortex 1 and Vortex 2 never overwrite each other.
 */
import * as THREE from 'three';

const MAX_POINTS = 12;

export interface VortexPathSnapshot {
  p: [number, number, number][];
  tension: number;
}

export interface VortexPath {
  ctrl: THREE.Vector3[];
  tension: number;
  save(): void;
  load(): boolean;
  snapshot(): VortexPathSnapshot;
  applySnapshot(o: VortexPathSnapshot): boolean;
  buildCurve(): THREE.CatmullRomCurve3;
  reset(): void;
  /** Insert a point after `afterIdx` (or extend past the end). Returns the new index. */
  insertPoint(afterIdx: number): number | null;
  /** Remove a point; refuses to drop below the 2 needed for a curve. */
  deletePoint(idx: number): boolean;
}

export function createVortexPath(
  storageKey: string,
  defaultCtrl: () => THREE.Vector3[],
): VortexPath {
  const path: VortexPath = {
    ctrl: defaultCtrl(),
    tension: 0.5,

    snapshot(): VortexPathSnapshot {
      return { p: path.ctrl.map((v) => [v.x, v.y, v.z]), tension: path.tension };
    },

    applySnapshot(o: VortexPathSnapshot): boolean {
      if (!o?.p || o.p.length < 2) return false;
      path.ctrl = o.p.map((a) => new THREE.Vector3(a[0], a[1], a[2]));
      if (typeof o.tension === 'number') path.tension = o.tension;
      return true;
    },

    save(): void {
      try {
        localStorage.setItem(storageKey, JSON.stringify(path.snapshot()));
      } catch {
        /* private mode / quota — the path just isn't remembered */
      }
    },

    /** Returns true when a stored path was applied. */
    load(): boolean {
      try {
        const s = localStorage.getItem(storageKey);
        if (!s) return false;
        return path.applySnapshot(JSON.parse(s) as VortexPathSnapshot);
      } catch {
        return false;
      }
    },

    buildCurve(): THREE.CatmullRomCurve3 {
      return new THREE.CatmullRomCurve3(
        path.ctrl.map((v) => v.clone()),
        false,
        'catmullrom',
        path.tension,
      );
    },

    reset(): void {
      path.ctrl = defaultCtrl();
      path.tension = 0.5;
    },

    insertPoint(afterIdx: number): number | null {
      if (path.ctrl.length >= MAX_POINTS) return null;
      const i = afterIdx >= 0 ? afterIdx : path.ctrl.length - 1;
      const a = path.ctrl[i];
      const b = path.ctrl[Math.min(i + 1, path.ctrl.length - 1)];
      const np = a.clone().add(b).multiplyScalar(0.5);
      if (i === path.ctrl.length - 1) np.copy(a).add(new THREE.Vector3(0, 0, -16));
      path.ctrl.splice(i + 1, 0, np);
      return i + 1;
    },

    deletePoint(idx: number): boolean {
      if (path.ctrl.length <= 2 || idx < 0) return false;
      path.ctrl.splice(idx, 1);
      return true;
    },
  };

  return path;
}
