/**
 * Entry point: boot order + the render loop.
 *
 * Everything visual lives in scene/*, its authoring surface in theatre/*, and the
 * optional Dev UI in dev-helpers/*. This file only wires them together, so the boot
 * sequence — body ready -> canvas -> renderer -> Theatre -> input -> loop — stays
 * readable in one screen.
 */
import * as THREE from 'three';

import { whenBodyReady, ensureStarScene } from './scene-shell';
import { startTimelineScroll, tickScroll, useThreeClamp } from './timeline-scroll';
import { addSceneLights, camera, clock, createRenderer } from './core/stage';
// Optional Dev UI — remove this import (and the calls below) to tree-shake bar/stats/help.
import { bootDevHelpers, initDevHelpers, statsBegin, statsEnd } from './dev-helpers';
import { createOrbit, orbitState, setOrbiting } from './interaction/camera-orbit';
import { installParallaxPointer, parallax, updateParallax } from './interaction/parallax';
import { drawDepth, installVortexInput, setVortexGizmoVisible } from './interaction/vortex-input';
import { updateAlarmLights } from './scene/alarm-lights';
import { updateGrid } from './scene/grid';
import {
  activateStar,
  loadGLBFromBuffer,
  loadInitialStarGlb,
  resetStar,
  updateMatcapZoom,
  updateStarAnimation,
} from './scene/star-glb';
import { starGroup, starfieldMotion, starUniforms } from './scene/starfield';
import {
  addVortexPoint,
  getActiveVortexId,
  getVortexPathTension,
  hydrateVortexPathsFromTheatre,
  isVortexDrawMode,
  rebuildVortexTube,
  removeVortexPoint,
  resetVortexPath,
  saveVortexPath,
  setActiveVortexId,
  setVortexDrawMode,
  setVortexEditorVisible,
  setVortexPathTension,
  snapshotAllVortexPaths,
  updateVortexTime,
} from './scene/vortex';
import { isLayerRendered } from './scene/layer-outliner';
import { applyWindowTransform, updateNeonPulse } from './scene/window-frames';
import { WINDOW_INDICES } from './windows/geometry';
import { bindTheatre } from './theatre/bindings';
import { initTheatre, isSequencePlaying, PROJECT_ID, theatreState } from './theatre/setup';
import studio from '@theatre/studio';

useThreeClamp(THREE);

// Webflow can evaluate this module before <body> exists.
await whenBodyReady();
ensureStarScene();
startTimelineScroll();

// Dev UI mount (bar / help / err / stats). Safe to delete with the import above.
await bootDevHelpers();

const { studioReady, sheet } = initTheatre();
hydrateVortexPathsFromTheatre(theatreState);
const { renderer, bloom, postFx, renderFrame, setPostFx } = createRenderer();
addSceneLights();
starUniforms.uPixelRatio.value = renderer.getPixelRatio();

// Position the 3 windows once (and cut the wall's holes) before Theatre can move them.
for (const i of WINDOW_INDICES) applyWindowTransform(i);

const { camObj, starObj } = bindTheatre(sheet, bloom);
loadInitialStarGlb();

try {
  if (studioReady) studio.setSelection([starObj]);
} catch (err) {
  console.error('studio.setSelection', err);
}

/* ---------- input ---------- */

createOrbit(renderer.domElement);
installVortexInput(renderer.domElement);
installParallaxPointer();

const CAMERA_DEFAULT_POSE = {
  position: { x: 0, y: 0, z: 18 },
  rotation: { x: 0, y: 0, z: 0 },
  fov: 42,
};

initDevHelpers({
  studio,
  studioReady,
  projectId: PROJECT_ID,
  camObj,
  cameraPose: () => {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      rotation: { x: e.x, y: e.y, z: e.z },
      fov: camera.fov,
    };
  },
  resetCamera: () => {
    camera.position.set(0, 0, 18);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.fov = 42;
    camera.updateProjectionMatrix();
    orbitState.controls?.target.set(0, -0.4, 0);
    orbitState.controls?.update();
    return CAMERA_DEFAULT_POSE;
  },
  isOrbiting: () => orbitState.active,
  setOrbiting: (on) => {
    if (!orbitState.controls) return false;
    setOrbiting(on);
    return true;
  },
  activateStar,
  resetStar,
  loadGLBFromBuffer,
  isParallaxEnabled: () => parallax.enabled,
  setParallaxEnabled: (on) => {
    parallax.enabled = on;
  },
  isVortexDrawMode,
  setVortexDrawMode,
  getActiveVortexId,
  setActiveVortexId,
  getVortexPathTension,
  setVortexPathTension,
  setVortexDrawDepth: (v) => {
    drawDepth.value = v;
  },
  rebuildVortexTube,
  saveVortexPath,
  snapshotVortexPaths: snapshotAllVortexPaths,
  addVortexPoint,
  removeVortexPoint,
  resetVortexPath,
  getPostFx: () => ({ ...postFx }),
  setPostFx,
});

/* ---------- render loop ---------- */

/** Distance (the camera's start position) at which the grid pulse speed looks "normal". */
const GRID_REF_DIST = 18;
let gridPulseTime = 0;

function tick(): void {
  requestAnimationFrame(tick);
  statsBegin();
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  // The grid pulse advances at a constant PERCEIVED speed: closer to the wall than the
  // reference distance, the accumulator grows slower (up close the same physical speed
  // fills more of the screen); farther away, it grows faster.
  gridPulseTime += dt * (GRID_REF_DIST / Math.max(1, camera.position.length()));

  if (isLayerRendered('starGlb')) {
    updateStarAnimation(dt);
    updateMatcapZoom();
  }
  updateParallax(time);

  if (isLayerRendered('starBackground')) {
    starUniforms.uTime.value = time;
    starGroup.rotation.y = Math.sin(time * starfieldMotion.drift * 0.5) * starfieldMotion.swingRange;
  }
  updateVortexTime(time);

  // Path editor stays visible/clickable except while drawing or playing the sequence.
  const editable =
    !isVortexDrawMode() && !isSequencePlaying() && isLayerRendered('vortexHelpers');
  setVortexEditorVisible(editable);
  setVortexGizmoVisible(editable);

  if (isLayerRendered('grid')) updateGrid(gridPulseTime);
  if (isLayerRendered('sideWindows') || isLayerRendered('centerWindow')) updateNeonPulse(gridPulseTime);
  if (isLayerRendered('alarm')) updateAlarmLights(time);

  if (orbitState.active) orbitState.controls?.update();
  tickScroll(dt, sheet);
  renderFrame();
  statsEnd();
}

tick();
