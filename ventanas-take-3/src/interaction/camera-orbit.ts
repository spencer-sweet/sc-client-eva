/** Free-look camera editing (OrbitControls). Off unless the Dev UI turns it on. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { camera } from '../core/stage';

export interface OrbitState {
  controls: OrbitControls | null;
  /** While true, the Theatre Camera object stops writing to the camera. */
  active: boolean;
}

export const orbitState: OrbitState = { controls: null, active: false };

export function createOrbit(domElement: HTMLElement): void {
  try {
    const controls = new OrbitControls(camera, domElement);
    controls.target.set(0, -0.4, 0);
    controls.enableDamping = true;
    controls.enabled = false;
    controls.update();
    orbitState.controls = controls;
  } catch (err) {
    console.error('orbit', err);
  }
}

/** Toggle free-look; entering it re-aims the orbit target 18 units ahead of the camera. */
export function setOrbiting(on: boolean): void {
  const controls = orbitState.controls;
  if (!controls) return;
  orbitState.active = on;
  controls.enabled = on;
  if (on) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).add(forward.multiplyScalar(18));
    controls.update();
  }
}
