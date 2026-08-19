/**
 * The star: a GLB model (with a baked shatter animation) plus its additive glow sprite,
 * sitting in the center window and facing the camera.
 *
 * Default look matches timeline-03: jagged 60-fragment shatter + Crystal-2 matcap glass
 * (see-through via Fresnel alpha on the matcap lookup).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLB_URL, MATCAP_URL } from '../assets';
import { bail } from '../core/bail';
import { camera, scene } from '../core/stage';
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

/** Clear head-on, solid at the silhouette — stronger than timeline-03 so Crystal-2 reads on dark. */
const CLEAR_GLASS_CENTER_ALPHA = 0.28;
const CLEAR_GLASS_RIM_POWER = 2.0;

/** Wide-shot distance camera→star; matcap zoom is 1 here and grows as we dolly in. */
const MATCAP_REF_DIST = 12;
const matcapZoom = { value: 1 };
const matcapRot = { value: new THREE.Vector3(0, 0, 0) };

function addMatcapGlassAlpha(material: THREE.MeshMatcapMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMatcapZoom = matcapZoom;
    shader.uniforms.uMatcapRot = matcapRot;
    shader.fragmentShader =
      'uniform float uMatcapZoom;\nuniform vec3 uMatcapRot;\n' + shader.fragmentShader;

    const uvLine =
      'vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;';
    if (shader.fragmentShader.includes(uvLine)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        uvLine,
        `vec3 matN = normal;
         float cx = cos(uMatcapRot.x), sx = sin(uMatcapRot.x);
         matN = vec3(matN.x, cx * matN.y - sx * matN.z, sx * matN.y + cx * matN.z);
         float cy = cos(uMatcapRot.y), sy = sin(uMatcapRot.y);
         matN = vec3(cy * matN.x + sy * matN.z, matN.y, -sy * matN.x + cy * matN.z);
         float cz = cos(uMatcapRot.z), sz = sin(uMatcapRot.z);
         matN = vec3(cz * matN.x - sz * matN.y, sz * matN.x + cz * matN.y, matN.z);
         vec2 uv = vec2( dot( x, matN ), dot( y, matN ) ) * 0.495 + 0.5;
         vec2 matcapUv = 0.5 + (uv - 0.5) / max(uMatcapZoom, 0.08);`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('texture2D( matcap, uv )', 'texture2D( matcap, matcapUv )')
        .replace('texture( matcap, uv )', 'texture( matcap, matcapUv )');
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassRim = clamp(length(uv - 0.5) / 0.495, 0.0, 1.0);
       diffuseColor.a *= mix(${CLEAR_GLASS_CENTER_ALPHA.toFixed(3)}, 1.0, pow(glassRim, ${CLEAR_GLASS_RIM_POWER.toFixed(2)}));
       #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'matcap-zoom-rot-v1';
  material.needsUpdate = true;
}

const matcapTex = new THREE.TextureLoader().load(MATCAP_URL);
matcapTex.colorSpace = THREE.SRGBColorSpace;
matcapTex.wrapS = THREE.ClampToEdgeWrapping;
matcapTex.wrapT = THREE.ClampToEdgeWrapping;

/**
 * anisotropy defaults to 1 (off). The matcap UV comes from the per-fragment normal on
 * hard-faceted (non-smoothed) shards, so at the shallow angles those facets are often
 * seen from, the texture-space derivative is large in one direction — exactly the case
 * anisotropic filtering exists for. At aniso=1 that minification just falls back to the
 * mip level for the WORST axis, which looks blocky/pixelated well before the shard is
 * small on screen. main.ts calls setMatcapAnisotropy() once the renderer exists so this
 * can be clamped to what the GPU actually supports.
 */
export function setMatcapAnisotropy(renderer: THREE.WebGLRenderer): void {
  matcapTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  matcapTex.needsUpdate = true;
}

/**
 * depthWrite:false is load-bearing — without it overlapping shards occlude each other
 * and the glass "reserved" its spot in the depth buffer as if opaque.
 */
export const glbMat = new THREE.MeshMatcapMaterial({
  matcap: matcapTex,
  transparent: true,
  depthWrite: false,
  opacity: 0.9,
  side: THREE.DoubleSide,
});
addMatcapGlassAlpha(glbMat);

export const starState = {
  scale: 0.7,
  emiColor: new THREE.Color(0x4aa0ff),
  emiInt: 1.6,
  opacity: 0.9,
  glowSize: 3.4,
  glowInt: 1.25,
  matcapZoomMin: 0.85,
  matcapZoomMax: 2.8,
  matcapRot: new THREE.Vector3(0, 0, 0),
};

let glbRoot: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let action: THREE.AnimationAction | null = null;
let clipDuration = 1;
/** True while the shatter is playing live (a button press), not being scrubbed. */
let liveShatter = false;

let glbLayerFade = 0;
let glowLayerFade = 0;

export function applyStarState(): void {
  glbRoot?.scale.setScalar(starState.scale);
  glbMat.opacity = starState.opacity * (1 - glbLayerFade);
  const gm = glow.material as THREE.SpriteMaterial;
  gm.color.copy(starState.emiColor);
  gm.opacity = starState.glowInt * (1 - glowLayerFade);
  glow.scale.setScalar(starState.glowSize);
  matcapRot.value.copy(starState.matcapRot);
}

export function setStarGlbLayer(fade: number, render: number): void {
  glbLayerFade = fade;
  starGroup.visible = render >= 0.5;
  applyStarState();
}

export function setStarGlowLayer(fade: number, render: number): void {
  glowLayerFade = fade;
  glow.visible = render >= 0.5;
  applyStarState();
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

/** Magnify Crystal-2 with camera dolly so the lighting doesn't look glued in view space. */
export function updateMatcapZoom(): void {
  const dist = camera.position.distanceTo(starGroup.position);
  const lo = starState.matcapZoomMin;
  const hi = Math.max(lo, starState.matcapZoomMax);
  matcapZoom.value = THREE.MathUtils.clamp(
    Math.pow(MATCAP_REF_DIST / Math.max(dist, 1.5), 0.45),
    lo,
    hi,
  );
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
        // Jagged shards are hard-faceted; smoothed normals read as glass instead of tiles.
        mesh.geometry.computeVertexNormals();
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
      bail('Could not load <code>Broken-Jagged-60f_2026-08-18.glb</code>.');
    });
}
