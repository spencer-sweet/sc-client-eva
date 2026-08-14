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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020410);

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
}

export function createRenderer(): Renderer {
  const canvas = document.getElementById('star-scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('ventanas-take-3: #star-scene canvas missing');
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Procedural environment, generated once at startup (not per frame): only so the
  // star's PBR glass gets believable reflections/transmission.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.7, 0.1);
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

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
  });

  applyPassFlags();
  return { renderer, composer, renderPass, bloom, outputPass, postFx, renderFrame, setPostFx };
}

/** Ambient + key light for the GLB star's physical material. */
export function addSceneLights(): void {
  scene.add(new THREE.AmbientLight(0x99aadd, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4);
  dl.position.set(0.3, 0.4, 1);
  scene.add(dl);
}
