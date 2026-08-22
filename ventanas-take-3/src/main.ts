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
import { camera, timer, createRenderer } from './core/stage';
// Type-only: erased at build time, so it does not pull the Dev UI back into the bundle.
import type { DevHelpersApi } from './dev-helpers';
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
  setMatcapAnisotropy,
  updateMatcapZoom,
  updateStarAnimation,
  updateStarHover,
} from './scene/star-glb';
import { starGroup, starfieldMotion, starUniforms } from './scene/starfield';
import {
  addVortexPoint,
  getActiveVortexId,
  getVortexPathTension,
  hydrateVortexPathsFromTheatre,
  isVortexDrawMode,
  isVortexWireframe,
  rebuildVortexTube,
  removeVortexPoint,
  resetVortexPath,
  saveVortexPath,
  setActiveVortexId,
  setVortexDrawMode,
  setVortexEditorVisible,
  setVortexPathTension,
  setVortexWireframe,
  snapshotAllVortexPaths,
  updateVortexTime,
} from './scene/vortex';
import { isLayerRendered } from './scene/layer-outliner';
import { applyWindowTransform, updateNeonPulse } from './scene/window-frames';
import { WINDOW_INDICES } from './windows/geometry';
import { bindTheatre } from './theatre/bindings';
import { initTheatre, isSequencePlaying, PROJECT_ID, theatreState } from './theatre/setup';

useThreeClamp(THREE);

/**
 * The whole boot lives in a function rather than at module top level.
 *
 * That is load-bearing, not style. With top-level `await` the entry module evaluates
 * ASYNCHRONOUSLY, and anything that statically imports it has to wait for that
 * evaluation to finish. `@theatre/studio` statically imports `@theatre/core`, which
 * the bundler puts in this entry chunk — so `await import('@theatre/studio')` below
 * would wait on the studio chunk, while the studio chunk waited on this chunk to
 * finish evaluating. A circular wait that never rejects: the scene simply never
 * rendered, with an empty console. Keeping evaluation synchronous breaks the cycle.
 */
async function boot(): Promise<void> {
  // Webflow can evaluate this module before <body> exists.
  await whenBodyReady();
  ensureStarScene();
  startTimelineScroll();

  /**
   * Dev UI (bar / help / err / stats) and Theatre Studio are both editor-only, and both
   * are loaded DYNAMICALLY behind the same `?minify` check a Webflow embed uses — so a
   * production visitor never downloads or parses either chunk.
   */
  const devUiWanted = !new URLSearchParams(location.search).has('minify');
  const dev = devUiWanted ? await import('./dev-helpers') : null;
  await dev?.bootDevHelpers();
  const statsBegin = dev?.statsBegin ?? (() => {});
  const statsEnd = dev?.statsEnd ?? (() => {});

  const { studioReady, sheet, studio } = await initTheatre();
  hydrateVortexPathsFromTheatre(theatreState);
  const { renderer, bloom, postFx, renderFrame, setPostFx, reportFrameTime } = createRenderer();
  starUniforms.uPixelRatio.value = renderer.getPixelRatio();
  setMatcapAnisotropy(renderer);

  // Position the 3 windows once (which also places their stencil cutouts) before
  // Theatre can move them.
  for (const i of WINDOW_INDICES) applyWindowTransform(i);

  const { camObj, starObj } = bindTheatre(sheet, bloom);
  loadInitialStarGlb();

  try {
    if (studioReady && studio) studio.setSelection([starObj]);
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

  const devApi: DevHelpersApi | null = studio && {
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
    isVortexWireframe,
    setVortexWireframe,
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
  };
  if (dev && devApi) dev.initDevHelpers(devApi);

  /* ---------- render loop ---------- */

  /** Distance (the camera's start position) at which the grid pulse speed looks "normal". */
  const GRID_REF_DIST = 18;
  let gridPulseTime = 0;

  /**
   * Frame governance: never render into a hidden tab or an off-screen canvas, and feed
   * every frame's cost back to the renderer so it can drop resolution when the device
   * throttles. The clock is still advanced while paused so resuming does not hand the
   * animations one enormous delta.
   */
  let canvasOnScreen = true;
  /** Start of the previous rendered frame, for the adaptive-resolution governor. */
  let prevFrameStart = 0;
  new IntersectionObserver(
    ([entry]) => {
      canvasOnScreen = entry.isIntersecting;
    },
    { threshold: 0 },
  ).observe(renderer.domElement);

  document.addEventListener('visibilitychange', () => {
    // Skipped frames leave the pending delta holding the whole pause; drop it on resume.
    if (!document.hidden) timer.update();
  });

  function tick(): void {
    requestAnimationFrame(tick);
    if (document.hidden || !canvasOnScreen) {
      timer.update();
      prevFrameStart = 0;
      return;
    }
    const frameStart = performance.now();
    statsBegin();
    timer.update(frameStart);
    const dt = timer.getDelta();
    const time = timer.getElapsed();

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
    // Plain wall clock, NOT gridPulseTime: the neon pulse is a fixed-tempo breath, so
    // it must not be re-timed by the camera distance the grid accumulator compensates
    // for. See updateNeonPulse.
    if (isLayerRendered('sideWindows') || isLayerRendered('centerWindow')) updateNeonPulse(time);
    if (isLayerRendered('alarm')) updateAlarmLights(time);

    if (orbitState.active) orbitState.controls?.update();
    tickScroll(dt, sheet);
    // After tickScroll: a sequence move fires the Theatre bindings, and those rewrite
    // every shard transform via setShatterProgress. The hover has to be the last word.
    // Unconditional: the shards run with matrixAutoUpdate off, so skipping a frame would
    // leave their matrices stale rather than merely un-hovered.
    updateStarHover(time);
    renderFrame();
    statsEnd();
    // The DELIVERED interval, not this callback's own duration — the scene is
    // GPU-bound, so its CPU cost says nothing about whether frames are landing.
    if (prevFrameStart > 0) reportFrameTime(frameStart - prevFrameStart);
    prevFrameStart = frameStart;
  }

  tick();
}

void boot();
