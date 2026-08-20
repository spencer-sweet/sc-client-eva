/**
 * Scene graph + renderer.
 *
 * `scene` / `camera` / `clock` / `nearLayer` are constructed at import time — none
 * of them touch the DOM, so scene modules can safely build their objects while the
 * host page is still parsing. Everything that needs the real <canvas> (WebGL
 * context, PMREM environment, post-processing) is deferred to `createRenderer()`,
 * which main.ts calls only after `ensureStarScene()` has run.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { quality } from './quality';

// No scene.background: it would be drawn into the linear render target and then run
// through ACESFilmicToneMapping in OutputPass, which crushes a near-black navy like
// #040718 toward true black. Leaving the canvas transparent lets the CSS body
// background (style.css) show the untouched color instead.
export const scene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 0, 18);
camera.rotation.order = 'YXZ';

export const clock = new THREE.Clock();

/**
 * wall + grid + glass + neon live in ONE group so parallax can never misalign them.
 */
export const nearLayer = new THREE.Group();
scene.add(nearLayer);

export interface PostFxState {
  /** When false, skip EffectComposer and draw with renderer.render. */
  composerEnabled: boolean;
  renderPassEnabled: boolean;
  bloomEnabled: boolean;
  outputPassEnabled: boolean;
}

/**
 * Adaptive resolution: the pixel ratio steps down when frames run long and back up
 * when they are comfortably fast. This is what survives thermal throttling — a phone
 * that starts at 45fps and settles at 20 is not hitting a different scene, it is
 * hitting a slower GPU clock, and only fewer pixels help.
 */
const RES_STEPS = [1, 0.85, 0.7, 0.55] as const;
/**
 * Thresholds on the DELIVERED frame interval, not on CPU time (see reportFrameTime).
 * 22ms = missing 60fps often enough to judder; 17.5ms = essentially locked to vsync.
 */
const SLOW_MS = 22;
const FAST_MS = 17.5;
/** Frames per decision window. */
const WINDOW_FRAMES = 45;
/**
 * Asymmetric hysteresis. Stepping down is cheap insurance so it needs one bad window;
 * stepping back up reallocates every render target, so it waits for sustained headroom.
 * Without this the governor ping-pongs between two steps on any scene sitting near a
 * threshold, and the resolution flip is far more visible than the frame it saves.
 */
const SLOW_WINDOWS_TO_DROP = 1;
const FAST_WINDOWS_TO_RAISE = 4;

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  outputPass: OutputPass;
  postFx: PostFxState;
  /** Apply the current postFx flags and draw one frame. */
  renderFrame(): void;
  setPostFx(partial: Partial<PostFxState>): void;
  /** Feed the interval since the previous frame (ms) so resolution can adapt. */
  reportFrameTime(ms: number): void;
}

export function createRenderer(): Renderer {
  const canvas = document.getElementById('star-scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('ventanas-take-3: #star-scene canvas missing');
  }
  // antialias is deliberately off: RenderPass draws into the composer's own target, so
  // an MSAA backbuffer would be allocated and never sampled. stencil is required — the
  // window cutouts for the wall and the grid are stencil tests (windows/stencil.ts).
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    stencil: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearAlpha(0);
  const basePixelRatio = Math.min(devicePixelRatio, quality.pixelRatioCap);
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // NOTE: there used to be a PMREM/RoomEnvironment here "so the star's PBR glass gets
  // reflections". The star is a MeshMatcapMaterial now and every other material is a
  // ShaderMaterial/MeshBasic/Sprite — nothing samples scene.environment, so generating
  // it only cost VRAM and a startup stall.

  // EffectComposer's default target has no stencil buffer, and the window cutouts need
  // one, so supply our own.
  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composerTarget = new THREE.WebGLRenderTarget(drawSize.x, drawSize.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: true,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  const renderPass = new RenderPass(scene, camera);
  // Bloom is a blur: running it at a fraction of the CSS resolution is invisible and
  // saves a dozen fullscreen passes' worth of bandwidth. scale 1 = the authored look.
  const bloomScale = quality.bloomResolutionScale;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth * bloomScale, innerHeight * bloomScale),
    0.9,
    0.7,
    0.1,
  );
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);

  const postFx: PostFxState = {
    composerEnabled: true,
    renderPassEnabled: true,
    bloomEnabled: true,
    outputPassEnabled: true,
  };

  function applyPassFlags(): void {
    renderPass.enabled = postFx.renderPassEnabled;
    bloom.enabled = postFx.bloomEnabled;
    outputPass.enabled = postFx.outputPassEnabled;
  }

  function renderFrame(): void {
    if (!postFx.composerEnabled) {
      renderer.render(scene, camera);
      return;
    }
    applyPassFlags();
    composer.render();
  }

  function setPostFx(partial: Partial<PostFxState>): void {
    Object.assign(postFx, partial);
    applyPassFlags();
  }

  /* ---------- adaptive resolution ---------- */

  let resStep = 0;
  let sampleSum = 0;
  let sampleCount = 0;
  let slowRun = 0;
  let fastRun = 0;
  /** Frames to ignore after a resize — the reallocation frame is always a spike. */
  let settleFrames = 0;

  function applySize(): void {
    const pr = basePixelRatio * RES_STEPS[resStep];
    renderer.setPixelRatio(pr);
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(pr);
    composer.setSize(innerWidth, innerHeight);
    // After composer.setSize, which resets every pass to the full drawing-buffer size.
    bloom.setSize(innerWidth * bloomScale, innerHeight * bloomScale);
    sampleSum = 0;
    sampleCount = 0;
    slowRun = 0;
    fastRun = 0;
    settleFrames = 10;
  }

  /**
   * `ms` is the interval between frame STARTS, i.e. how long the browser actually took
   * to present. It used to be the main loop's own CPU duration, which is the one number
   * that cannot see this problem: the scene is GPU-bound, so a device stuck at 30fps
   * still reported a comfortable ~5ms of JS and the governor never dropped a step. The
   * interval is what the eye sees, and it goes up whether the stall is CPU, GPU or
   * compositor.
   */
  function reportFrameTime(ms: number): void {
    if (settleFrames > 0) {
      settleFrames--;
      return;
    }
    // A tab regaining focus, a GC pause or a scroll-anchor reflow can hand us a
    // hundreds-of-ms outlier; clamp so one of those cannot decide a whole window.
    sampleSum += Math.min(ms, 100);
    if (++sampleCount < WINDOW_FRAMES) return;
    const avg = sampleSum / sampleCount;
    sampleSum = 0;
    sampleCount = 0;

    if (avg > SLOW_MS) {
      fastRun = 0;
      slowRun++;
    } else if (avg < FAST_MS) {
      slowRun = 0;
      fastRun++;
    } else {
      slowRun = 0;
      fastRun = 0;
      return;
    }

    if (slowRun >= SLOW_WINDOWS_TO_DROP && resStep < RES_STEPS.length - 1) resStep++;
    else if (fastRun >= FAST_WINDOWS_TO_RAISE && resStep > 0) resStep--;
    else return;
    applySize();
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applySize();
  });

  applyPassFlags();
  return {
    renderer,
    composer,
    renderPass,
    bloom,
    outputPass,
    postFx,
    renderFrame,
    setPostFx,
    reportFrameTime,
  };
}

/**
 * Nothing in this scene is lit any more: the star is matcap, the windows/grid/vortex
 * are ShaderMaterials and the wall is MeshBasic. The ambient + directional pair that
 * used to live here had no receiver, so it was removed rather than left to be
 * uploaded and ignored every frame.
 */
