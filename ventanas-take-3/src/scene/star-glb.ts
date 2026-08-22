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
/**
 * DoubleSide + transparent makes three render the mesh TWICE — back faces, then front —
 * so the shards were costing two draw calls each. Measured on the low tier, that pair
 * was 112 of the scene's 144 draw calls, and switching to a single pass cut total frame
 * time by ~60%: the star was draw-call bound, not fill bound (shrinking it to a dot
 * saved nothing at all).
 *
 * The two-pass order exists to layer a surface's own back faces behind its front faces.
 * These shards are thin, near-flat fragments of glass whose two sides land within a
 * fraction of a unit of each other, so the pass split was buying almost no visible
 * depth ordering for its price.
 */
glbMat.forceSinglePass = true;
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
  /** Idle-hover drift amplitude, in the model's local units (its radius is ~2.6). */
  hoverAmount: 0.06,
  /** Idle-hover cycles per second-ish. Low values read as floating, high as jitter. */
  hoverSpeed: 0.24,
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

/* ---------- idle hover: drift + rotate, layered ON TOP of the shatter clip ---------- */

/**
 * Radians of wobble per unit of drift. Tuned so the default `hoverAmount` (0.08 local
 * units, ~3% of the model radius) pairs with roughly 5° of rotation — enough to catch
 * the matcap and read as "alive" without looking like the shard is tumbling.
 */
const HOVER_SPIN_PER_UNIT = 1.2;

interface Shard {
  mesh: THREE.Object3D;
  /** Slot in `batched` this shard draws through. */
  instanceId: number;
  /**
   * Ancestors between glbRoot and this shard, outermost first. Empty for the flat
   * layout every export so far has produced; walked per frame when it is not, because
   * a BatchedMesh instance matrix is relative to the batch, not to the shard's parent.
   */
  chain: THREE.Object3D[];
  /** Per-shard phase + frequency, so 56 fragments never bob in unison. */
  phase: THREE.Vector3;
  freq: THREE.Vector3;
  axis: THREE.Vector3;
  spinPhase: number;
  spinFreq: number;
}

const shards: Shard[] = [];
const hoverPos = new THREE.Vector3();
const hoverQuat = new THREE.Quaternion();
const spinQuat = new THREE.Quaternion();
const _local = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

/**
 * Every shard drawn through ONE draw call.
 *
 * The shatter is 56 separate meshes sharing a single material, which is the exact shape
 * THREE.BatchedMesh exists for: the geometries go into one pair of buffers and each
 * shard becomes an instance whose transform is a matrix slot. The AnimationMixer still
 * animates the original Object3Ds — it just drives matrices we copy in, instead of
 * driving 56 draw calls.
 */
let batched: THREE.BatchedMesh | null = null;

/** Stable seeded random: a reload always gives every shard the same wobble. */
function hoverRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Ancestors from just under `root` down to `o`'s parent, outermost first. */
function ancestorChain(o: THREE.Object3D, root: THREE.Object3D): THREE.Object3D[] {
  const chain: THREE.Object3D[] = [];
  for (let p = o.parent; p && p !== root; p = p.parent) chain.unshift(p);
  return chain;
}

/**
 * Only position + normal, which is all MeshMatcapMaterial reads (the matcap lookup is
 * built from the normal, not from a uv). BatchedMesh requires every geometry to share
 * one attribute layout, and a GLB shard may arrive carrying uv/tangent/colour sets that
 * differ between fragments — stripping to the two attributes that matter makes the
 * layout uniform AND keeps the shared buffers small.
 */
function batchableGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', src.getAttribute('position'));
  geo.setAttribute('normal', src.getAttribute('normal'));
  if (src.index) geo.setIndex(src.index);
  return geo;
}

function disposeBatched(): void {
  if (!batched) return;
  batched.removeFromParent();
  batched.dispose();
  batched = null;
}

function collectShards(root: THREE.Object3D): void {
  shards.length = 0;
  disposeBatched();

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length === 0) return;

  const geometries = meshes.map((m) => batchableGeometry(m.geometry));
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.index ? g.index.count : 0;
  }

  batched = new THREE.BatchedMesh(meshes.length, vertexCount, indexCount, glbMat);
  // The star is always on screen when it is enabled, and per-instance culling would
  // walk 56 bounding spheres a frame to conclude exactly that.
  batched.frustumCulled = false;
  batched.perObjectFrustumCulled = false;
  // > wall.renderOrder (1): without this the wall (transparent while fading) drew
  // afterwards and erased the glass except where a hole happened to line up.
  batched.renderOrder = 6;
  root.add(batched);

  const rand = hoverRandom(0x51a2d3e7);
  for (let i = 0; i < meshes.length; i++) {
    const o = meshes[i];
    // The hover composes this matrix by hand every frame (see updateStarHover), so
    // three must not recompose it from position/quaternion/scale and wipe the offset.
    o.matrixAutoUpdate = false;
    // The shard Object3D stays in the graph purely as the AnimationMixer's target; the
    // BatchedMesh is what actually draws.
    o.visible = false;
    const geometryId = batched.addGeometry(geometries[i]);
    const instanceId = batched.addInstance(geometryId);
    const axis = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    shards.push({
      mesh: o,
      instanceId,
      chain: ancestorChain(o, root),
      phase: new THREE.Vector3(rand(), rand(), rand()).multiplyScalar(Math.PI * 2),
      // Irrational-ish spread keeps the three axes from re-syncing into a straight line.
      freq: new THREE.Vector3(0.7 + rand() * 0.6, 0.9 + rand() * 0.7, 0.6 + rand() * 0.5),
      axis: axis.normalize(),
      spinPhase: rand() * Math.PI * 2,
      spinFreq: 0.5 + rand() * 0.6,
    });
  }
}

/**
 * Add a second level of displacement on top of wherever the shatter clip has each
 * shard at the current timeline position.
 *
 * The offset is applied when COMPOSING the shard's matrix — `position`/`quaternion`/
 * `scale` are left untouched and stay owned entirely by the AnimationMixer. That
 * separation is the whole design:
 *
 * An earlier version wrote the offset into `mesh.position` and tried to rewind it each
 * frame by restoring a cached rest pose and re-running `mixer.update(0)`. It does not
 * work, because `PropertyMixer.apply()` compares its own frame-interleaved accumulators
 * — what the mixer last COMPUTED — and skips `binding.setValue()` when they match. It
 * has no idea the object was clobbered behind its back, so on a paused timeline (values
 * unchanged frame to frame) it never re-wrote the clip pose, and the shards ended up
 * hovering around their REST pose rather than their shattered one.
 *
 * Driven by the render clock rather than the timeline, so the shards keep breathing
 * while the sequence sits paused. `hoverAmount` is the only gate: how far into the clip
 * the shards separate is content, not something this code should guess at.
 *
 * Must run AFTER anything that can rewrite shard transforms — the mixer, and
 * `setShatterProgress` via a Theatre value change during the scroll tick. It also must
 * run EVERY frame, since matrixAutoUpdate is off: see the call site in main.ts.
 */
export function updateStarHover(time: number): void {
  if (!batched) return;
  const drift = starState.hoverAmount;
  const t = time * starState.hoverSpeed;
  const spin = drift * HOVER_SPIN_PER_UNIT;
  for (const s of shards) {
    const mesh = s.mesh;
    if (drift <= 0) {
      _local.compose(mesh.position, mesh.quaternion, mesh.scale);
    } else {
      hoverPos.set(
        mesh.position.x + Math.sin(t * s.freq.x + s.phase.x) * drift,
        mesh.position.y + Math.sin(t * s.freq.y + s.phase.y) * drift,
        mesh.position.z + Math.sin(t * s.freq.z + s.phase.z) * drift,
      );
      spinQuat.setFromAxisAngle(s.axis, Math.sin(t * s.spinFreq + s.spinPhase) * spin);
      hoverQuat.copy(mesh.quaternion).multiply(spinQuat);
      _local.compose(hoverPos, hoverQuat, mesh.scale);
    }
    // An instance matrix is relative to the BatchedMesh, which sits at glbRoot. For the
    // flat layout that is the shard's own matrix; a nested one has to fold its
    // ancestors in first.
    if (s.chain.length === 0) {
      batched.setMatrixAt(s.instanceId, _local);
    } else {
      _rel.identity();
      for (const anc of s.chain) {
        anc.updateMatrix();
        _rel.multiply(anc.matrix);
      }
      batched.setMatrixAt(s.instanceId, _rel.multiply(_local));
    }
  }
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
      });
      starGroup.add(glbRoot);
      applyStarState();
      // Builds the BatchedMesh the shards actually draw through, and hides the
      // originals — material, render order and culling now live on the batch.
      collectShards(glbRoot);

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
      bail('Could not load <code>Broken-Jagged-60f_2026-08-20.glb</code>.');
    });
}
