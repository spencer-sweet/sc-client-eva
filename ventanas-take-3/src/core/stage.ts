/**
 * Scene graph + renderer.
 *
 * `scene` / `camera` / `timer` / `nearLayer` are constructed at import time — none
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
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { quality } from './quality';
import { refreshPeriodMs } from './refresh-rate';

// No scene.background: it would be drawn into the linear render target and then run
// through ACESFilmicToneMapping in OutputPass, which crushes a near-black navy like
// #040718 toward true black. Leaving the canvas transparent lets the CSS body
// background (style.css) show the untouched color instead.
export const scene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 0, 18);
camera.rotation.order = 'YXZ';

export const timer = new THREE.Timer();

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
  /** SMAA, after bloom and before OutputPass (linear-srgb). */
  antialiasEnabled: boolean;
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
 * Thresholds on the DELIVERED frame interval, not on CPU time (see reportFrameTime),
 * and expressed as MULTIPLES of the frame budget rather than in absolute ms.
 *
 * They used to be a flat 22ms / 17.5ms, which silently assumed a 60Hz panel. On a
 * 30Hz-capped device — iOS Low Power Mode is the common one — a perfectly delivered
 * frame arrives every 33.3ms, so every window read as "slow": the governor fell to the
 * bottom step within two seconds and could never climb back, because recovery needed
 * an average under 17.5ms that a 30Hz vsync cannot produce. The result was a scene
 * permanently rendering at 55% resolution while hitting its target frame rate.
 *
 * 1.32x and 1.05x of the budget reproduce the original 22 / 17.5 exactly at 60Hz, so
 * behaviour on a normal display is unchanged.
 */
const SLOW_FACTOR = 1.32;
const FAST_FACTOR = 1.05;
/**
 * The governor chases 60fps at most, even on a 120Hz panel: a scene that cannot hit
 * 120 no matter how few pixels it draws would otherwise walk down to the bottom step
 * chasing a target that was never available. On a slower display the panel's own
 * period wins, since nothing can be delivered faster than it can be presented.
 */
const MAX_TARGET_FPS = 60;

/**
 * The frame budget the governor is currently judging against, and the two thresholds
 * derived from it. Exported so the policy can be inspected rather than inferred: on a
 * 60Hz panel this must read back 22.0 / 17.5 — the exact constants it replaced.
 */
export function frameBudget(): { budgetMs: number; slowMs: number; fastMs: number } {
  const budgetMs = Math.max(refreshPeriodMs(), 1000 / MAX_TARGET_FPS);
  return { budgetMs, slowMs: budgetMs * SLOW_FACTOR, fastMs: budgetMs * FAST_FACTOR };
}
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
  smaa: SMAAPass;
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
  // powerPreference is a context-creation hint only: low-power prefers the iGPU / a
  // cooler clock on phones; high-performance asks for the discrete GPU on desktops.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    stencil: true,
    alpha: true,
    powerPreference: quality.tier === 'low' ? 'low-power' : 'high-performance',
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
  const smaa = new SMAAPass();
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  // SMAA is linear-srgb — it has to run before OutputPass's ACES tone map.
  composer.addPass(smaa);
  composer.addPass(outputPass);

  const postFx: PostFxState = {
    composerEnabled: true,
    renderPassEnabled: true,
    bloomEnabled: true,
    antialiasEnabled: quality.tier === 'high',
    outputPassEnabled: true,
  };

  function applyPassFlags(): void {
    renderPass.enabled = postFx.renderPassEnabled;
    bloom.enabled = postFx.bloomEnabled;
    smaa.enabled = postFx.antialiasEnabled;
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

    const { slowMs, fastMs } = frameBudget();
    if (avg > slowMs) {
      fastRun = 0;
      slowRun++;
    } else if (avg < fastMs) {
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
    smaa,
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
