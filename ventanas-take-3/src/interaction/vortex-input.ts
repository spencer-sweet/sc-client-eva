/**
 * Vortex path editing input: click to select a waypoint, drag the gizmo to move it, or
 * freehand-draw a whole new path across the screen.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { camera, scene } from '../core/stage';
import { setVortexDrawButton } from '../dev-helpers';
import {
  activeVortexMarkers,
  commitSelectedMarker,
  getSelectedVortexPoint,
  isVortexDrawMode,
  selectVortexPoint,
  setVortexDrawMode,
  setVortexGizmo,
  setVortexPathPoints,
} from '../scene/vortex';
import { orbitState } from './camera-orbit';

/** How far into the scene a freehand stroke's far end lands. */
export const drawDepth = { value: 110 };

let gizmo: TransformControls | null = null;
let drawing = false;
let stroke: THREE.Vector2[] = [];

/** Where a non-draw pointerdown started, so pointerup can tell a click from an orbit drag. */
let pointerDownAt: THREE.Vector2 | null = null;
/** Past this NDC distance, a pointerdown→up pair is a drag (orbiting the camera), not a click. */
const CLICK_MOVE_THRESHOLD = 0.01;

const ray = new THREE.Raycaster();
const ndc = (ev: PointerEvent) =>
  new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);

/** Unproject a normalized-device point onto a plane `dist` units in front of the camera. */
function screenToWorldAtDist(v2: THREE.Vector2, dist: number): THREE.Vector3 {
  const v = new THREE.Vector3(v2.x, v2.y, 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  return camera.position.clone().add(dir.multiplyScalar(dist));
}

function finishDraw(): void {
  if (!drawing) return;
  drawing = false;
  if (stroke.length >= 2) {
    // Resample the raw stroke down to 3..9 control points spread along its length.
    const K = Math.min(9, Math.max(3, Math.round(stroke.length / 6)));
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < K; j++) {
      const f = j / (K - 1);
      const idx = Math.round(f * (stroke.length - 1));
      pts.push(screenToWorldAtDist(stroke[idx], 6 + (drawDepth.value - 6) * f));
    }
    setVortexPathPoints(pts);
  }
  setVortexDrawMode(false);
  setVortexDrawButton(false);
}

export function installVortexInput(domElement: HTMLElement): void {
  domElement.addEventListener('pointerdown', (ev) => {
    if (isVortexDrawMode()) {
      drawing = true;
      stroke = [ndc(ev)];
      ev.preventDefault();
      return;
    }
    // Orbiting stays a candidate click until pointerup proves it was a drag — see below.
    // That lets markers stay pickable while orbit mode is on, instead of blocking every
    // click just because a drag *could* start.
    pointerDownAt = ndc(ev);
  });

  domElement.addEventListener('pointerup', (ev) => {
    if (isVortexDrawMode()) return;
    const down = pointerDownAt;
    pointerDownAt = null;
    if (!down || gizmo?.dragging) return;
    const up = ndc(ev);
    // Moved past the threshold: this was an orbit drag, not a click on a marker.
    if (Math.hypot(up.x - down.x, up.y - down.y) > CLICK_MOVE_THRESHOLD) return;
    ray.setFromCamera(up, camera);
    // Only the active vortex's markers are pickable — see setActiveVortexId.
    const hit = ray.intersectObjects(activeVortexMarkers(), false)[0];
    // Click a path point to select it; click empty space to deselect.
    selectVortexPoint(hit ? (hit.object.userData.i as number) : -1);
  });

  domElement.addEventListener('pointermove', (ev) => {
    if (!isVortexDrawMode() || !drawing) return;
    const p = ndc(ev);
    const last = stroke[stroke.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.012) stroke.push(p);
  });

  domElement.addEventListener('pointerup', finishDraw);
  domElement.addEventListener('pointerleave', finishDraw);

  try {
    gizmo = new TransformControls(camera, domElement);
    gizmo.setSize(0.8);
    // three r169+: TransformControls is no longer an Object3D — add its helper instead.
    scene.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', (ev) => {
      const controls = orbitState.controls;
      if (controls) controls.enabled = ev.value ? false : orbitState.active;
    });
    gizmo.addEventListener('objectChange', commitSelectedMarker);
    setVortexGizmo(gizmo);
  } catch (err) {
    console.error('TransformControls', err);
  }
}

/** Show/hide the gizmo along with the rest of the path editor. */
export function setVortexGizmoVisible(editable: boolean): void {
  if (!gizmo) return;
  gizmo.getHelper().visible = editable && getSelectedVortexPoint() >= 0;
  gizmo.enabled = editable;
}
