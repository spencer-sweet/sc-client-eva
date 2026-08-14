/**
 * The star: a GLB model (with a baked shatter animation) plus its additive glow sprite,
 * sitting in the center window and facing the camera.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLB_URL } from '../assets';
import { bail } from '../core/bail';
import { scene } from '../core/stage';
import { winCentersW } from '../windows/geometry';

const centerW = winCentersW[0];

/* ---------- glow sprite behind the star ---------- */

function glowSprite(): THREE.Sprite {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      color: 0x6ab0ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sp.renderOrder = 2;
  return sp;
}

export const glow = glowSprite();
glow.position.set(centerW[0], centerW[1], 0.05);
scene.add(glow);

export const starGroup = new THREE.Group();
starGroup.position.set(centerW[0], centerW[1], 3.0);
scene.add(starGroup);

/** z=3 keeps the star away from the wall so no shatter fragment ends up behind it. */
export const starPos = { x: centerW[0], y: centerW[1], z: 3.0 };

/**
 * depthWrite:false is load-bearing — without it the glass "reserved" its spot in the
 * depth buffer as if opaque and blocked the vortex behind it from drawing there, so the
 * stars (which already ignore depth) showed but the vortex did not. depthTest stays at
 * its default (true): that is what keeps the ~55 shatter fragments from blending badly
 * into each other (the black-blob bug).
 *
 * transmission=1 + EffectComposer (our Bloom) has documented Three.js bugs — the special
 * pass that "photographs" what's behind breaks with post-processing. So transmission is
 * lowered and real opacity/transparent added: classic alpha blending DOES work with
 * Bloom without relying on that fragile path, keeping stars/vortex visible.
 */
export const glbMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff0ff,
  emissive: new THREE.Color(0x4aa0ff),
  emissiveIntensity: 1.6,
  roughness: 0.12,
  transmission: 0.6,
  ior: 1.45,
  thickness: 0.6,
  metalness: 0.0,
  depthWrite: false,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
});

export const starState = {
  scale: 0.7,
  emiColor: new THREE.Color(0x4aa0ff),
  emiInt: 1.6,
  opacity: 0.4,
  glowSize: 2.6,
  glowInt: 0.85,
};

let glbRoot: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let action: THREE.AnimationAction | null = null;
let clipDuration = 1;
/** True while the shatter is playing live (a button press), not being scrubbed. */
let liveShatter = false;

export function applyStarState(): void {
  glbRoot?.scale.setScalar(starState.scale);
  glbMat.emissive.copy(starState.emiColor);
  glbMat.emissiveIntensity = starState.emiInt;
  glbMat.opacity = starState.opacity;
  const gm = glow.material as THREE.SpriteMaterial;
  gm.color.copy(starState.emiColor);
  gm.opacity = starState.glowInt;
  glow.scale.setScalar(starState.glowSize);
}

/** Scrub the exact explosion frame (ignored while a live shatter is playing). */
export function setShatterProgress(progress: number): void {
  if (!action || liveShatter) return;
  action.paused = true;
  action.time = progress * clipDuration;
  mixer?.update(0);
}

const glbLoadedHandlers: (() => void)[] = [];

/** Re-apply timeline-owned state after a (re)load — the Theatre bindings register here. */
export function onGlbLoaded(fn: () => void): void {
  glbLoadedHandlers.push(fn);
}

export function updateStarAnimation(dt: number): void {
  mixer?.update(dt);
}

/** Start the shatter animation from the beginning. */
export function activateStar(): void {
  if (!action) return;
  liveShatter = true;
  action.reset();
  action.paused = false;
}

/** Rewind to the un-shattered pose. */
export function resetStar(): void {
  if (!action) return;
  liveShatter = false;
  action.reset();
  action.paused = true;
  mixer?.update(0);
}

/** Load the initial GLB or hot-swap one picked from disk in the Dev UI. */
export function loadGLBFromBuffer(buf: ArrayBuffer): void {
  try {
    parseGlb(buf);
  } catch (err) {
    console.error(err);
  }
}

function parseGlb(buf: ArrayBuffer): void {
  new GLTFLoader().parse(
    buf,
    '',
    (gltf) => {
      if (glbRoot) starGroup.remove(glbRoot);
      glbRoot = gltf.scene;
      // Model is flat with a local +Y normal; +90° on X faces the "front" toward the camera.
      glbRoot.rotation.x = Math.PI / 2;
      glbRoot.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const mesh = o as THREE.Mesh;
        mesh.material = glbMat;
        mesh.frustumCulled = false;
        // > wall.renderOrder (1): without this the wall (transparent while fading) drew
        // afterwards and erased the glass except where a hole happened to line up.
        mesh.renderOrder = 6;
      });
      starGroup.add(glbRoot);
      applyStarState();

      mixer = null;
      action = null;
      clipDuration = 1;
      liveShatter = false;
      const clip = gltf.animations?.[0];
      if (clip) {
        mixer = new THREE.AnimationMixer(glbRoot);
        action = mixer.clipAction(clip);
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
        clipDuration = clip.duration || 1;
        action.play();
        action.paused = true;
        action.time = 0;
        mixer.update(0);
      }
      for (const fn of glbLoadedHandlers) fn();
    },
    (err) => {
      console.error('GLB', err);
      bail('Could not parse the GLB.');
    },
  );
}

export function loadInitialStarGlb(): void {
  fetch(GLB_URL)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then(loadGLBFromBuffer)
    .catch((err) => {
      console.error(err);
      bail('Could not load <code>estrella.glb</code>.');
    });
}
