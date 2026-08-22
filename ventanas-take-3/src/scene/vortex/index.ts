/**
 * The two vortex tunnels (Vortex 1 / Vortex 2) and the editing façade the Dev UI drives.
 *
 * Each instance owns its own path, uniforms, tube, markers and exit glow (see
 * ./instance.ts). Path editing — draw mode, the transform gizmo, add/remove point —
 * is single-target: it always applies to the *active* vortex, chosen by the Dev UI
 * dropdown.
 */
import * as THREE from 'three';
import { createVortexInstance, type VortexInstance, type VortexLook } from './instance';
import type { VortexPathSnapshot } from './path';

export { VTX_RADIUS_DEFAULT } from './material';
export type { VortexLook } from './instance';

/** 1-based, matching the "Vortex 1" / "Vortex 2" Theatre objects and the Dev UI dropdown. */
export type VortexId = 1 | 2;
export const VORTEX_IDS: VortexId[] = [1, 2];

const instances: Record<VortexId, VortexInstance> = {
  // Geometric fallbacks only. Live spines are applied from theatre-state
  // `ventanasVortexPaths` in hydrateVortexPathsFromTheatre().
  1: createVortexInstance(1, 'vortexPath_ventanas_v2', () => [
    new THREE.Vector3(0, 0, 15),
    new THREE.Vector3(0, 0, -17),
    new THREE.Vector3(0, 0, -49),
    new THREE.Vector3(0, 0, -81),
  ]),
  // Offset sideways so a fresh Vortex 2 is visible instead of hiding inside Vortex 1.
  2: createVortexInstance(2, 'vortexPath2_ventanas_v2', () => [
    new THREE.Vector3(-0.744818839856193, 0.9811897501610632, 12.127818840501075),
    new THREE.Vector3(11.174668262262495, 12.029273041252445, -37.627541553868625),
    new THREE.Vector3(29.649460168119887, 9.561093553712366, -87.49642174877891),
  ]),
};

export function getVortex(id: VortexId): VortexInstance {
  return instances[id];
}

/* ---------- active target for path editing ---------- */

let activeId: VortexId = 1;
let drawMode = false;
let gizmo: { attach(o: THREE.Object3D): void; detach(): void } | null = null;

export function getActiveVortexId(): VortexId {
  return activeId;
}

export function setActiveVortexId(id: VortexId): void {
  if (id === activeId) return;
  active().select(-1);
  activeId = id;
  syncGizmo();
}

const active = (): VortexInstance => instances[activeId];

function syncGizmo(): void {
  if (!gizmo) return;
  const inst = active();
  const i = inst.getSelected();
  if (i >= 0 && i < inst.markers.length) gizmo.attach(inst.markers[i]);
  else gizmo.detach();
}

export function setVortexGizmo(g: typeof gizmo): void {
  gizmo = g;
  syncGizmo();
}

for (const id of VORTEX_IDS) {
  instances[id].onSelectionChange = () => {
    if (id === activeId) syncGizmo();
  };
}

/* ---------- per-frame + layer ---------- */

/** Advance the shader clock of every vortex that is actually drawing. */
export function updateVortexTime(time: number): void {
  for (const id of VORTEX_IDS) {
    if (instances[id].isEnabled()) instances[id].uniforms.uTime.value = time;
  }
}

export function isVortexEnabled(id: VortexId): boolean {
  return instances[id].isEnabled();
}

export function setVortexLayer(id: VortexId, fade: number, render: number): void {
  instances[id].setLayer(fade, render);
}

/** Apply a Theatre "Vortex Look" payload to one vortex. */
export function applyVortexLook(id: VortexId, v: VortexLook): void {
  instances[id].applyLook(v);
}

/** Helpers (markers + path line) are shared dev chrome — one setting drives both. */
export function setVortexHelpersLayer(fade: number, render: number): void {
  for (const id of VORTEX_IDS) instances[id].setHelpersLayer(fade, render);
}

let vortexWireframe = false;

export function isVortexWireframe(): boolean {
  return vortexWireframe;
}

/** Swap the noise shader for a cheap tube wireframe (both vortices). */
export function setVortexWireframe(on: boolean): void {
  vortexWireframe = on;
  for (const id of VORTEX_IDS) instances[id].setWireframe(on);
}

/** Show the editor for the active vortex only; the other one's helpers stay hidden. */
export function setVortexEditorVisible(visible: boolean): void {
  for (const id of VORTEX_IDS) instances[id].setEditorVisible(visible && id === activeId);
}

/* ---------- editing (always targets the active vortex) ---------- */

export const activeVortexMarkers = (): THREE.Object3D[] => active().markers;

export function selectVortexPoint(i: number): void {
  active().select(i);
}

export function getSelectedVortexPoint(): number {
  return active().getSelected();
}

export function commitSelectedMarker(): void {
  active().commitSelectedMarker();
}

export function setVortexPathPoints(pts: THREE.Vector3[]): void {
  active().setPathPoints(pts);
}

export function addVortexPoint(): void {
  active().addPoint();
}

export function removeVortexPoint(): void {
  active().removePoint();
}

export function resetVortexPath(): void {
  active().resetPath();
}

export function setVortexPathTension(v: number): void {
  active().setTension(v);
}

export function getVortexPathTension(): number {
  return active().path.tension;
}

export function rebuildVortexTube(): void {
  active().rebuildTube();
}

export function saveVortexPath(): void {
  active().savePath();
}

/** Live spines for both tunnels — attached to Theatre JSON on save. */
export function snapshotAllVortexPaths(): Record<VortexId, VortexPathSnapshot> {
  return {
    1: instances[1].snapshotPath(),
    2: instances[2].snapshotPath(),
  };
}

/**
 * Apply spines from the committed theatre-state file. That JSON is the source of
 * truth (the points in this module are only fallbacks). localStorage is used when
 * the file has no entry for a vortex yet.
 */
export function hydrateVortexPathsFromTheatre(state: unknown): void {
  const extra = (state as { ventanasVortexPaths?: Partial<Record<string, VortexPathSnapshot>> })
    .ventanasVortexPaths;
  for (const id of VORTEX_IDS) {
    const snap = extra?.[String(id)];
    if (snap) {
      instances[id].applyPathSnapshot(snap);
      instances[id].savePath();
    }
  }
}

export function isVortexDrawMode(): boolean {
  return drawMode;
}

export function setVortexDrawMode(on: boolean): void {
  drawMode = on;
  if (on) active().select(-1);
}
