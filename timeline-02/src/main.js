import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// timeline-02 = star-shatter (the exploding glass glb + scroll-scrubbed
// AnimationMixer) forked and fused with paths-grid (the 4-point star mask,
// borrowed here to cut window-shaped holes in an opaque wall instead of
// paths-grid's own use of the same mask -- revealing a gradient behind a
// filled star shape).
//
// Depth order along -z, camera starts on the +z side looking down the axis:
//   camera (starts far) -> WALL_Z (opaque, 3 star-shaped holes)
//                        -> GLASS_Z (the shatter glb, sitting behind the
//                           center hole so it reads as "seen through the
//                           window")
//                        -> space scene (aura veils + starfield, far back)
//
// One scroll timeline drives three overlapping phases: zoom into the center
// window, shatter the glass, then push the camera through the (now-fading)
// wall into the space scene behind it.
// ---------------------------------------------------------------------------

const CONFIG = {
  // -- scroll / timeline --
  progress: 0,
  scrub: true,
  scrollDamping: 4.5,
  cameraDamping: 3.5,
  zoomPhaseEnd: 0.35, // scroll fraction where the zoom-into-window dolly finishes
  shatterStart: 0.3, // shatter timeline starts scrubbing here (overlaps zoom's tail)
  shatterEnd: 0.7,
  passStart: 0.65, // camera resumes moving (through the wall) here (overlaps shatter's tail)
  clipStart: 0.13, // shatter clip: only this window of the glb's timeline is scrubbed through
  clipEnd: 0.29,
  autoRotateSpeed: 0,

  // -- camera path (world z) --
  cameraStartZ: 15,
  cameraMidZ: 8,
  cameraEndZ: -34,
  parallaxStrength: 0.3,
  parallaxDamping: 4,

  // -- wall + star windows (ported from paths-grid's 3-star layout) --
  wallColor: '#170a2c',
  starSize: 6,
  starSize2: 3.6,
  starOffsetX: 3.1,
  starOffsetY: 3.1,

  // -- wall grid (paths-grid's mouse-glow node/line lattice, etched onto the wall) --
  gridCellSize: 4.8,
  gridCols: 17,
  gridRows: 11,
  gridLineThickness: 0.025,
  gridGlowRadius: 2.4,
  gridGlowColor: '#00fff0', // neon cyan hotspot under the cursor
  gridIntensity: 2,
  gridBaseColor: '#ff2bd6', // neon magenta lattice
  gridNodeColor: '#05d9e8', // neon cyan reticles
  gridNodeSize: 0.32,
  gridRingCount: 2,

  // -- glass material -- transmission (not opacity) is what makes this read
  // as glass: a slight roughness keeps refraction soft instead of mirror-flat,
  // and a light touch of clearcoat adds specular pop without burying the
  // see-through body under a reflective layer. attenuationDistance is kept
  // large (near-default/off) -- a shatter cluster stacks many overlapping
  // shards along each view ray, so even mild per-surface absorption compounds
  // across layers and reads as the whole cluster going opaque/dark
  // flat low-poly shards facing the camera head-on have near-zero Fresnel
  // reflectance at normal incidence -- physically-correct thin glass, but it
  // reads as "invisible/dark" rather than "glassy" without curvature to vary
  // the angle; pulling transmission back a touch keeps a base layer of
  // reflectivity everywhere, not just at grazing edges
  transmission: 0.92,
  roughness: 0.06,
  thickness: 0.3,
  ior: 1.6,
  envMapIntensity: 3.5,
  clearcoat: 0.5,
  clearcoatRoughness: 0.05,
  attenuationColor: '#ffb066',
  attenuationDistance: 25,

  // -- space scene behind the wall --
  showBackgroundStars: true,
  bgStarCount: 260,
  bgStarRadius: 55,
  wispCount: 10,
  wispOpacity: 0.35,
  wispColorA: '#54d8ef',
  wispColorB: '#e838ff',
  eyeStar: true,

  // -- post --
  bloomStrength: 0.55,
  bloomRadius: 0.9,
  bloomThreshold: 0.25,
};

const MODEL_URL = `${import.meta.env.BASE_URL}star-shatter-01.glb`;

const WALL_Z = 0;
const GLASS_Z = -0.6;
const SPACE_NEAR_Z = GLASS_Z - 14;
const SPACE_FAR_Z = GLASS_Z - 85;
const WALL_W = 34;
const WALL_H = 20;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050608, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050608, 0.02);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(4, 6, 8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.5);
fillLight.position.set(-6, -3, 4);
scene.add(fillLight);

// rides with the glass so its shards always have a bright core to refract --
// without it a transmissive material against empty black just reads as dark
// faceted reflections instead of "seeing through" glass. A second, colored
// point light offset to one side gives the refraction something coloful to
// bend, since a single white core light alone still reads as flat gray/opaque
// once the shards scatter into mostly-empty space
const coreLight = new THREE.PointLight(0xdcebff, 30, 45, 2);
coreLight.position.set(0, 0, GLASS_Z);
scene.add(coreLight);

const accentLight = new THREE.PointLight(0xff2bd6, 16, 30, 2);
accentLight.position.set(2.5, -1.8, GLASS_Z + 1.8);
scene.add(accentLight);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 0, CONFIG.cameraStartZ);
// the glass sits on layer 1 (see below) so it can be excluded from its own
// reflection capture; the main camera needs both layers to still see it
camera.layers.enable(1);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold
);
composer.addPass(bloomPass);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Star mask texture -- exact path from paths-grid/src/4star_02.svg, baked
// once into an alpha-only canvas texture. paths-grid samples this to draw a
// filled star; the wall shader below does the inverse, punching a hole
// wherever this mask is opaque.
// ---------------------------------------------------------------------------
const STAR_PATH =
  'M418.94 6.082C421.263 -2.02639 434.026 -2.02638 436.349 6.08202C454.591 69.7607 501.161 210.898 572.777 282.514C644.393 354.13 785.53 400.7 849.209 418.942C857.317 421.265 857.317 434.028 849.209 436.351C785.53 454.593 644.393 501.163 572.777 572.779C501.161 644.395 454.591 785.532 436.349 849.211C434.026 857.319 421.263 857.319 418.94 849.211C400.698 785.532 354.128 644.395 282.512 572.779C210.896 501.163 69.7587 454.593 6.08005 436.351C-2.02835 434.028 -2.02833 421.265 6.08007 418.942C69.7587 400.7 210.896 354.13 282.512 282.514C354.128 210.898 400.698 69.7606 418.94 6.082Z';
const STAR_BOX = 856;

function makeStarMaskTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.scale(size / STAR_BOX, size / STAR_BOX);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(STAR_PATH));
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
const starMaskTexture = makeStarMaskTexture();

// the three window centers/sizes, shared between the wall shader and the
// glass-fit logic below so the glass always lines up with the center hole
function getWindowInstances() {
  return [
    { x: 0, y: 0, size: CONFIG.starSize },
    { x: -CONFIG.starOffsetX, y: -CONFIG.starOffsetY, size: CONFIG.starSize2 },
    { x: CONFIG.starOffsetX, y: -CONFIG.starOffsetY, size: CONFIG.starSize2 },
  ];
}

// ---------------------------------------------------------------------------
// Wall -- opaque plane, alpha punched to 0 inside any of the 3 star windows.
// A ShaderMaterial (not discard) so the mask's texture-filtered edges stay
// antialiased instead of hard-edged.
// ---------------------------------------------------------------------------
const wallUniforms = {
  uMaskTex: { value: starMaskTexture },
  uWallColor: { value: new THREE.Color(CONFIG.wallColor) },
  uCenters: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uSizes: { value: [1, 1, 1] },
  uOpacity: { value: 1 },
};

function syncWindowUniforms() {
  const instances = getWindowInstances();
  instances.forEach((inst, i) => {
    wallUniforms.uCenters.value[i].set(inst.x, inst.y);
    wallUniforms.uSizes.value[i] = inst.size;
  });
}
syncWindowUniforms();

const wallMaterial = new THREE.ShaderMaterial({
  uniforms: wallUniforms,
  transparent: true,
  depthWrite: false,
  // double-sided so the glass's reflection camera (looking back from behind
  // the wall, toward the main camera) still sees it instead of culling it as
  // a backface -- otherwise the glass has nothing colorful to reflect there
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying vec2 vWorldPos;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xy;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMaskTex;
    uniform vec3 uWallColor;
    uniform vec2 uCenters[3];
    uniform float uSizes[3];
    uniform float uOpacity;
    varying vec2 vWorldPos;

    float windowMask(vec2 center, float size) {
      vec2 uv = (vWorldPos - center) / size + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
      return texture2D(uMaskTex, uv).a;
    }

    void main() {
      float hole = 0.0;
      for (int i = 0; i < 3; i++) {
        hole = max(hole, windowMask(uCenters[i], uSizes[i]));
      }
      gl_FragColor = vec4(uWallColor, (1.0 - hole) * uOpacity);
    }
  `,
});

const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), wallMaterial);
wallMesh.position.z = WALL_Z;
wallMesh.renderOrder = 10; // in front of glass/space in the transparent queue
scene.add(wallMesh);

// ---------------------------------------------------------------------------
// Wall grid -- paths-grid's node/line lattice, etched onto the wall's surface
// and lit by mouse proximity (raycast onto the wall plane each frame). Shares
// the wall's star-mask uniforms so the pattern punches the same 3 holes
// instead of floating over the exposed glass/space.
// ---------------------------------------------------------------------------
const gridUniforms = {
  uMouse: { value: new THREE.Vector2(1e5, 1e5) },
  uRadius: { value: CONFIG.gridGlowRadius },
  uGlowColor: { value: new THREE.Color(CONFIG.gridGlowColor) },
  uIntensity: { value: CONFIG.gridIntensity },
};

const windowMaskChunk = /* glsl */ `
  uniform sampler2D uMaskTex;
  uniform vec2 uCenters[3];
  uniform float uSizes[3];

  float windowMask(vec2 worldPos, vec2 center, float size) {
    vec2 uv = (worldPos - center) / size + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uMaskTex, uv).a;
  }
  float anyWindowMask(vec2 worldPos) {
    float hole = 0.0;
    for (int i = 0; i < 3; i++) hole = max(hole, windowMask(worldPos, uCenters[i], uSizes[i]));
    return hole;
  }
`;

const GRID_Z = WALL_Z + 0.01; // just in front of the wall so it reads as etched into its surface

function buildGridGraph(cellSize, cols, rows) {
  const originX = -((cols - 1) * cellSize) / 2;
  const originY = -((rows - 1) * cellSize) / 2;
  const points = [];
  const index = (c, r) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) points.push(new THREE.Vector3(originX + c * cellSize, originY + r * cellSize, 0));
  }
  const edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = index(c, r);
      if (c < cols - 1) edges.push([here, index(c + 1, r)]);
      if (r < rows - 1) edges.push([here, index(c, r + 1)]);
      if (c < cols - 1 && r < rows - 1) {
        edges.push([here, index(c + 1, r + 1)]);
        edges.push([index(c + 1, r), index(c, r + 1)]);
      }
    }
  }
  return { points, edges };
}

let gridGraph = buildGridGraph(CONFIG.gridCellSize, CONFIG.gridCols, CONFIG.gridRows);

// each edge is a flat quad (two triangles), not a GL line, so thickness is a
// real world-space width instead of being at the mercy of linewidth
function makeGridLineGeometry(graph, thickness) {
  const half = thickness / 2;
  const positions = new Float32Array(graph.edges.length * 6 * 3);
  const tmp = new THREE.Vector2();
  graph.edges.forEach(([a, b], i) => {
    const pa = graph.points[a];
    const pb = graph.points[b];
    tmp.set(pb.x - pa.x, pb.y - pa.y).normalize();
    const nx = -tmp.y * half;
    const ny = tmp.x * half;
    const v = [
      pa.x + nx, pa.y + ny, 0,
      pa.x - nx, pa.y - ny, 0,
      pb.x + nx, pb.y + ny, 0,
      pb.x + nx, pb.y + ny, 0,
      pa.x - nx, pa.y - ny, 0,
      pb.x - nx, pb.y - ny, 0,
    ];
    positions.set(v, i * 18);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

let gridLineMesh = null;
function buildGridLines() {
  if (gridLineMesh) {
    scene.remove(gridLineMesh);
    gridLineMesh.geometry.dispose();
    gridLineMesh.material.dispose();
  }
  const geometry = makeGridLineGeometry(gridGraph, CONFIG.gridLineThickness);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...gridUniforms,
      uMaskTex: wallUniforms.uMaskTex,
      uCenters: wallUniforms.uCenters,
      uSizes: wallUniforms.uSizes,
      uBaseColor: { value: new THREE.Color(CONFIG.gridBaseColor) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xy;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      ${windowMaskChunk}
      uniform vec2 uMouse;
      uniform float uRadius;
      uniform vec3 uGlowColor;
      uniform float uIntensity;
      uniform vec3 uBaseColor;
      varying vec2 vWorldPos;
      void main() {
        if (anyWindowMask(vWorldPos) > 0.5) discard;
        float d = distance(vWorldPos, uMouse);
        float g = 1.0 - smoothstep(0.0, uRadius, d);
        vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  gridLineMesh = new THREE.Mesh(geometry, material);
  gridLineMesh.position.z = GRID_Z;
  gridLineMesh.renderOrder = 11;
  scene.add(gridLineMesh);
}

// ring-band reticles at each grid node (radii as a fraction of outer radius)
const GRID_RING_RADII_BY_COUNT = { 0: [], 1: [1], 2: [1, 0.6], 3: [1, 0.75, 0.5] };

let gridNodeMesh = null;
function buildGridNodes() {
  if (gridNodeMesh) {
    scene.remove(gridNodeMesh);
    gridNodeMesh.geometry.dispose();
    gridNodeMesh.material.dispose();
  }
  const outerR = CONFIG.gridNodeSize / 2;
  const radii = (GRID_RING_RADII_BY_COUNT[CONFIG.gridRingCount] ?? GRID_RING_RADII_BY_COUNT[2]).map((f) => f * outerR);
  if (!radii.length) {
    gridNodeMesh = null;
    return;
  }

  const halfWidth = CONFIG.gridLineThickness / 2;
  const segments = 32;
  const verts = [];
  for (const radius of radii) {
    const inner = radius - halfWidth;
    const outer = radius + halfWidth;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const ci0 = Math.cos(a0), si0 = Math.sin(a0);
      const ci1 = Math.cos(a1), si1 = Math.sin(a1);
      verts.push(
        inner * ci0, inner * si0, 0, outer * ci0, outer * si0, 0, outer * ci1, outer * si1, 0,
        inner * ci0, inner * si0, 0, outer * ci1, outer * si1, 0, inner * ci1, inner * si1, 0
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...gridUniforms,
      uMaskTex: wallUniforms.uMaskTex,
      uCenters: wallUniforms.uCenters,
      uSizes: wallUniforms.uSizes,
      uBaseColor: { value: new THREE.Color(CONFIG.gridNodeColor) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xy;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      ${windowMaskChunk}
      uniform vec2 uMouse;
      uniform float uRadius;
      uniform vec3 uGlowColor;
      uniform float uIntensity;
      uniform vec3 uBaseColor;
      varying vec2 vWorldPos;
      void main() {
        if (anyWindowMask(vWorldPos) > 0.5) discard;
        float d = distance(vWorldPos, uMouse);
        float g = 1.0 - smoothstep(0.0, uRadius, d);
        vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  gridNodeMesh = new THREE.InstancedMesh(geometry, material, gridGraph.points.length);
  gridNodeMesh.position.z = GRID_Z;
  gridNodeMesh.renderOrder = 12;
  const m = new THREE.Matrix4();
  gridGraph.points.forEach((p, i) => {
    m.setPosition(p);
    gridNodeMesh.setMatrixAt(i, m);
  });
  gridNodeMesh.instanceMatrix.needsUpdate = true;
  scene.add(gridNodeMesh);
}

function regenerateGrid() {
  gridGraph = buildGridGraph(CONFIG.gridCellSize, CONFIG.gridCols, CONFIG.gridRows);
  buildGridLines();
  buildGridNodes();
}
regenerateGrid();

// ---------------------------------------------------------------------------
// Space scene behind the wall -- starfield ported from star-shatter/aura-zoom
// (sqrt-radius distribution reads as uniform density) plus a handful of
// aura-zoom's glow veils for color, all placed once rather than pooled since
// the camera only ever passes through this stretch a single time.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_BG_STARS = 400;

function makeGlowTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(220,235,255,0.8)');
  g.addColorStop(1, 'rgba(220,235,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const bgStarPositions = new Float32Array(MAX_BG_STARS * 3);
const bgStarGeo = new THREE.BufferGeometry();
bgStarGeo.setAttribute('position', new THREE.BufferAttribute(bgStarPositions, 3));

function seedBgStars() {
  const rng = mulberry32(1337);
  const pos = bgStarGeo.attributes.position;
  for (let i = 0; i < MAX_BG_STARS; i++) {
    const r = Math.sqrt(rng()) * CONFIG.bgStarRadius;
    const a = rng() * Math.PI * 2;
    const z = THREE.MathUtils.lerp(SPACE_NEAR_Z, SPACE_FAR_Z, rng());
    pos.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, z);
  }
  pos.needsUpdate = true;
  bgStarGeo.setDrawRange(0, CONFIG.bgStarCount);
}
seedBgStars();

const bgStarMaterial = new THREE.PointsMaterial({
  size: 0.35,
  map: makeGlowTexture(),
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  color: 0xdcebff,
  fog: false,
  sizeAttenuation: true,
});
const bgStars = new THREE.Points(bgStarGeo, bgStarMaterial);
bgStars.visible = CONFIG.showBackgroundStars;
scene.add(bgStars);

// aura veils -- trimmed version of aura-zoom's FBM-swirled glow plane, static
// (no travel-based reseeding) since this scene is a single pass-through, not
// an endless tunnel
const wispUniforms = {
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color(CONFIG.wispColorA) },
  uColorB: { value: new THREE.Color(CONFIG.wispColorB) },
  uOpacity: { value: CONFIG.wispOpacity },
};

const wispMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: wispUniforms.uTime,
    uColorA: wispUniforms.uColorA,
    uColorB: wispUniforms.uColorB,
    uOpacity: wispUniforms.uOpacity,
    uSeed: { value: 0 },
  },
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uSeed;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uOpacity;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(17.3, 9.1);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float t = uTime * 0.3 + uSeed * 37.0;
      float r = length(p);
      float warp = fbm(p * 0.9 + vec2(t * 0.12, -t * 0.08) + uSeed * 5.0);
      float r2 = r * (0.75 + warp * 0.6);
      float blob = pow(exp(-r2 * r2 * 2.4), 1.4);
      float flow = fbm(p * 1.2 + vec2(t * 0.1, -t * 0.07) + uSeed * 3.0);
      vec3 color = mix(uColorA, uColorB, smoothstep(0.1, 0.9, r + (flow - 0.5) * 0.3));
      color *= 0.6 + 0.7 * flow;
      gl_FragColor = vec4(color, blob * uOpacity);
    }
  `,
});

const MAX_WISPS = 24;
const wispPlaneGeo = new THREE.PlaneGeometry(1, 1);
const wisps = [];
for (let i = 0; i < MAX_WISPS; i++) {
  const mesh = new THREE.Mesh(wispPlaneGeo, wispMaterial);
  mesh.visible = false;
  scene.add(mesh);
  wisps.push(mesh);
}

function seedWisps() {
  const rng = mulberry32(4242);
  for (let i = 0; i < MAX_WISPS; i++) {
    const wisp = wisps[i];
    if (i >= CONFIG.wispCount) {
      wisp.visible = false;
      continue;
    }
    wisp.visible = true;
    const angle = rng() * Math.PI * 2;
    const radial = 4 + rng() * 22;
    const z = THREE.MathUtils.lerp(SPACE_NEAR_Z, SPACE_FAR_Z, rng());
    wisp.position.set(Math.cos(angle) * radial, Math.sin(angle) * radial, z);
    const s = 16 + rng() * 20;
    wisp.userData.scaleX = s;
    wisp.userData.scaleY = s * (0.6 + rng() * 0.4);
    wisp.rotation.z = angle;
    wisp.userData.breathePhase = rng() * Math.PI * 2;
    wisp.scale.set(wisp.userData.scaleX, wisp.userData.scaleY, 1);
    wisp.material.uniforms.uSeed.value = rng() * 100;
  }
}
seedWisps();

// a bright pinprick far down the axis, marking the vanishing point beyond the
// wall -- gives the eye something to travel toward during the pass-through
function makeEyeStarTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const glow = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.15, 'rgba(235,245,255,0.85)');
  glow.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const eyeStar = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeEyeStarTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
eyeStar.position.set(0, 0, SPACE_FAR_Z + 10);
eyeStar.scale.setScalar(14);
eyeStar.visible = CONFIG.eyeStar;
scene.add(eyeStar);

// ---------------------------------------------------------------------------
// Glass -- the star-shatter glb, fit to the center window and parked at
// GLASS_Z so it reads as sitting just behind that hole in the wall.
//
// A live CubeCamera parked at the glass's position feeds the material a real
// reflection of the actual scene (wall grid, other shards, space) instead of
// the static RoomEnvironment IBL -- with mostly-empty space behind small
// scattered shards, transmission alone has little to refract, so reflection
// is what actually sells "glass" rather than "solid grey chunk."
// ---------------------------------------------------------------------------
const reflectionTarget = new THREE.WebGLCubeRenderTarget(256, {
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
});
const reflectionCamera = new THREE.CubeCamera(0.1, 100, reflectionTarget);
reflectionCamera.position.set(0, 0, GLASS_Z);
scene.add(reflectionCamera);

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: CONFIG.roughness,
  transmission: CONFIG.transmission,
  thickness: CONFIG.thickness,
  ior: CONFIG.ior,
  envMap: reflectionTarget.texture,
  envMapIntensity: CONFIG.envMapIntensity,
  clearcoat: CONFIG.clearcoat,
  clearcoatRoughness: CONFIG.clearcoatRoughness,
  // colors the light that survives a long path through the glass, so only
  // the thicker parts of the bunny/star pick up a warm tint while thin edges
  // stay clear -- this is what reads as "glossy glass" rather than tinted plastic
  attenuationColor: new THREE.Color(CONFIG.attenuationColor),
  attenuationDistance: CONFIG.attenuationDistance,
});

const modelGroup = new THREE.Group();
modelGroup.position.z = GLASS_Z;
scene.add(modelGroup);

let mixer = null;
let action = null;
let clipDuration = 1;
let currentShatterProgress = 0;

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = glassMaterial;
        child.frustumCulled = true;
        // the shatter chunks are low-poly with hard per-face normals, which
        // makes a transmissive material read as flat opaque mirror tiles
        // (each facet reflects/refracts a single direction); smoothing the
        // normals blends adjacent faces so light bends continuously across
        // each shard instead, which is what actually reads as "glass"
        child.geometry.computeVertexNormals();
        // layer 1, excluded from reflectionCamera's default layer-0 capture --
        // otherwise every shard would reflect itself/its siblings recursively
        child.layers.set(1);
      }
    });

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    // measured pre-rotation, while the star is still flat in the XZ plane: X
    // stays horizontal after the tip-upright rotation below, Z becomes the
    // new vertical -- a bounding-sphere diameter would overshoot by ~sqrt(2)
    // since it covers the box's diagonal, not its tip-to-tip span
    const tipToTip = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    gltf.scene.position.sub(center);
    gltf.scene.rotation.x = Math.PI / 2; // authored flat in XZ (Y-up); tip upright to face the camera

    // scale so the glass's own points land exactly on the center window's
    // silhouette
    const scale = CONFIG.starSize / tipToTip;
    gltf.scene.scale.setScalar(scale);

    modelGroup.add(gltf.scene);

    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const clip = gltf.animations[0];
      clipDuration = clip.duration;
      action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      setShatterProgress(currentShatterProgress);
    }
  },
  undefined,
  (err) => console.error('Failed to load star-shatter-01.glb', err)
);

function setShatterProgress(p) {
  currentShatterProgress = THREE.MathUtils.clamp(p, 0, 1);
  if (mixer && action) {
    action.time = THREE.MathUtils.lerp(CONFIG.clipStart * clipDuration, CONFIG.clipEnd * clipDuration, currentShatterProgress);
    mixer.update(0);
  }
}

// ---------------------------------------------------------------------------
// Scroll-driven timeline: one global fraction split into three overlapping
// phases -- zoom into the window, shatter the glass, pass through the wall.
// ---------------------------------------------------------------------------
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

let targetGlobalT = 0;
let currentGlobalT = 0;

function updateScrollTarget() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  targetGlobalT = maxScroll > 0 ? THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1) : 0;
}
window.addEventListener('scroll', updateScrollTarget, { passive: true });
updateScrollTarget();

function applyTimeline(t) {
  const zoomT = easeInOutCubic(THREE.MathUtils.clamp(t / CONFIG.zoomPhaseEnd, 0, 1));
  const shatterT = easeInOutCubic(
    THREE.MathUtils.clamp((t - CONFIG.shatterStart) / (CONFIG.shatterEnd - CONFIG.shatterStart), 0, 1)
  );
  const passT = easeInOutCubic(THREE.MathUtils.clamp((t - CONFIG.passStart) / (1 - CONFIG.passStart), 0, 1));

  // camera holds at cameraMidZ through the shatter window, then continues
  // its dolly through the wall during the pass phase
  const zoomedZ = THREE.MathUtils.lerp(CONFIG.cameraStartZ, CONFIG.cameraMidZ, zoomT);
  camera.userData.targetZ = THREE.MathUtils.lerp(zoomedZ, CONFIG.cameraEndZ, passT);

  setShatterProgress(shatterT);

  // wall fades out as the camera pushes through it, so there's no visible
  // clipping/pop when the camera's z crosses the wall's z=0 plane
  wallUniforms.uOpacity.value = 1 - passT;
  wallMesh.visible = passT < 0.995;
}
camera.userData.targetZ = CONFIG.cameraStartZ;

// ---------------------------------------------------------------------------
// Mouse parallax -- camera dolly (not rotation), reused from star-shatter --
// plus a raycast onto the wall plane so the grid's glow shader knows where
// the cursor lands in the wall's own world space.
// ---------------------------------------------------------------------------
let targetMouseX = 0;
let targetMouseY = 0;
let mouseX = 0;
let mouseY = 0;

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(1e5, 1e5);
const wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -WALL_Z);
const wallHitPoint = new THREE.Vector3();
let pointerActive = false;

window.addEventListener('pointermove', (e) => {
  pointerActive = true;
  targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
  targetMouseY = (e.clientY / window.innerHeight) * 2 - 1;
  pointerNDC.set(targetMouseX, -targetMouseY);
});

window.addEventListener('pointerleave', () => {
  pointerActive = false;
});

// ---------------------------------------------------------------------------
// lil-gui control panel
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Timeline 02 Controls' });

const timelineFolder = gui.addFolder('Timeline');
timelineFolder.add(CONFIG, 'zoomPhaseEnd', 0.1, 0.6, 0.01).name('Zoom Ends');
timelineFolder.add(CONFIG, 'shatterStart', 0.1, 0.8, 0.01).name('Shatter Starts');
timelineFolder.add(CONFIG, 'shatterEnd', 0.2, 0.9, 0.01).name('Shatter Ends');
timelineFolder.add(CONFIG, 'passStart', 0.3, 0.95, 0.01).name('Pass Starts');
timelineFolder.add(CONFIG, 'clipStart', 0, 1, 0.01).name('Clip Start %');
timelineFolder.add(CONFIG, 'clipEnd', 0, 1, 0.01).name('Clip End %');
timelineFolder.add(CONFIG, 'autoRotateSpeed', 0, 1, 0.01).name('Auto Rotate');

const wallFolder = gui.addFolder('Wall & Windows');
wallFolder.addColor(CONFIG, 'wallColor').name('Wall Color').onChange((v) => wallUniforms.uWallColor.value.set(v));
wallFolder.add(CONFIG, 'starSize', 2, 14, 0.1).name('Center Size').onChange(syncWindowUniforms);
wallFolder.add(CONFIG, 'starSize2', 1, 10, 0.1).name('Side Size').onChange(syncWindowUniforms);
wallFolder.add(CONFIG, 'starOffsetX', 0, 10, 0.1).name('Side Offset X').onChange(syncWindowUniforms);
wallFolder.add(CONFIG, 'starOffsetY', 0, 10, 0.1).name('Side Offset Y').onChange(syncWindowUniforms);

const gridFolder = gui.addFolder('Wall Grid');
gridFolder.add(CONFIG, 'gridGlowRadius', 0.2, 8, 0.1).name('Glow Radius').onChange((v) => (gridUniforms.uRadius.value = v));
gridFolder.addColor(CONFIG, 'gridGlowColor').name('Glow Color').onChange((v) => gridUniforms.uGlowColor.value.set(v));
gridFolder.add(CONFIG, 'gridIntensity', 0.2, 3, 0.05).name('Glow Intensity').onChange((v) => (gridUniforms.uIntensity.value = v));
gridFolder.addColor(CONFIG, 'gridBaseColor').name('Line Color').onFinishChange(buildGridLines);
gridFolder.addColor(CONFIG, 'gridNodeColor').name('Node Color').onFinishChange(buildGridNodes);
gridFolder.add(CONFIG, 'gridNodeSize', 0.05, 1.5, 0.01).name('Node Size').onFinishChange(buildGridNodes);
gridFolder.add(CONFIG, 'gridRingCount', 0, 3, 1).name('Node Rings').onFinishChange(buildGridNodes);
gridFolder.add(CONFIG, 'gridLineThickness', 0.005, 0.15, 0.005).name('Line Thickness').onFinishChange(() => {
  buildGridLines();
  buildGridNodes();
});
gridFolder.add(CONFIG, 'gridCellSize', 0.8, 6, 0.1).name('Cell Size').onFinishChange(regenerateGrid);
gridFolder.add(CONFIG, 'gridCols', 4, 40, 1).name('Columns').onFinishChange(regenerateGrid);
gridFolder.add(CONFIG, 'gridRows', 4, 30, 1).name('Rows').onFinishChange(regenerateGrid);

const glassFolder = gui.addFolder('Glass Material');
glassFolder.add(CONFIG, 'transmission', 0, 1, 0.01).name('Transmission').onChange((v) => (glassMaterial.transmission = v));
glassFolder.add(CONFIG, 'roughness', 0, 0.5, 0.005).name('Roughness').onChange((v) => (glassMaterial.roughness = v));
glassFolder.add(CONFIG, 'thickness', 0, 2, 0.01).name('Thickness').onChange((v) => (glassMaterial.thickness = v));
glassFolder.add(CONFIG, 'ior', 1, 2.33, 0.01).name('IOR').onChange((v) => (glassMaterial.ior = v));
glassFolder
  .add(CONFIG, 'envMapIntensity', 0, 6, 0.05)
  .name('Env Intensity')
  .onChange((v) => (glassMaterial.envMapIntensity = v));
glassFolder.add(CONFIG, 'clearcoat', 0, 1, 0.01).name('Clearcoat').onChange((v) => (glassMaterial.clearcoat = v));
glassFolder
  .add(CONFIG, 'clearcoatRoughness', 0, 0.5, 0.005)
  .name('Clearcoat Roughness')
  .onChange((v) => (glassMaterial.clearcoatRoughness = v));
glassFolder
  .addColor(CONFIG, 'attenuationColor')
  .name('Tint Color')
  .onChange((v) => glassMaterial.attenuationColor.set(v));
glassFolder
  .add(CONFIG, 'attenuationDistance', 0.5, 30, 0.5)
  .name('Tint Distance')
  .onChange((v) => (glassMaterial.attenuationDistance = v));

const spaceFolder = gui.addFolder('Space Scene');
spaceFolder.add(CONFIG, 'showBackgroundStars').name('Show Stars').onChange((v) => (bgStars.visible = v));
spaceFolder.add(CONFIG, 'bgStarCount', 0, MAX_BG_STARS, 1).name('Star Count').onFinishChange(seedBgStars);
spaceFolder.add(CONFIG, 'bgStarRadius', 8, 100, 1).name('Star Field Radius').onFinishChange(seedBgStars);
spaceFolder.add(CONFIG, 'wispCount', 0, MAX_WISPS, 1).name('Aura Count').onFinishChange(seedWisps);
spaceFolder
  .add(CONFIG, 'wispOpacity', 0, 1, 0.01)
  .name('Aura Opacity')
  .onChange((v) => (wispUniforms.uOpacity.value = v));
spaceFolder.addColor(CONFIG, 'wispColorA').name('Aura Color A').onChange((v) => wispUniforms.uColorA.value.set(v));
spaceFolder.addColor(CONFIG, 'wispColorB').name('Aura Color B').onChange((v) => wispUniforms.uColorB.value.set(v));
spaceFolder.add(CONFIG, 'eyeStar').name('Eye Star').onChange((v) => (eyeStar.visible = v));

const postFolder = gui.addFolder('Post');
postFolder.add(CONFIG, 'bloomStrength', 0, 3, 0.01).name('Bloom Strength').onChange((v) => (bloomPass.strength = v));
postFolder.add(CONFIG, 'bloomRadius', 0, 1.5, 0.01).name('Bloom Blur').onChange((v) => (bloomPass.radius = v));
postFolder
  .add(CONFIG, 'bloomThreshold', 0, 1, 0.01)
  .name('Bloom Threshold')
  .onChange((v) => (bloomPass.threshold = v));

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  currentGlobalT += (targetGlobalT - currentGlobalT) * Math.min(1, dt * CONFIG.scrollDamping);
  applyTimeline(currentGlobalT);

  wispUniforms.uTime.value = time;
  for (const wisp of wisps) {
    if (!wisp.visible) continue;
    const b = 1 + Math.sin(time * 0.5 + wisp.userData.breathePhase) * 0.12;
    wisp.scale.set(wisp.userData.scaleX * b, wisp.userData.scaleY * b, 1);
  }

  // spin around Z (the axis pointing at the camera) so the star stays
  // face-on instead of tumbling edge-on the way a Y spin would
  modelGroup.rotation.z = time * CONFIG.autoRotateSpeed;

  // mouse parallax -- dolly sideways and re-aim at the axis every frame, so
  // near geometry sweeps across the screen more than far geometry (real
  // motion parallax, unlike a pan)
  mouseX += (targetMouseX - mouseX) * Math.min(1, dt * CONFIG.parallaxDamping);
  mouseY += (targetMouseY - mouseY) * Math.min(1, dt * CONFIG.parallaxDamping);
  camera.position.x = mouseX * CONFIG.parallaxStrength;
  camera.position.y = -mouseY * CONFIG.parallaxStrength;
  camera.position.z += (camera.userData.targetZ - camera.position.z) * Math.min(1, dt * CONFIG.cameraDamping);
  // look a fixed distance ahead of wherever the camera currently sits (not at
  // a fixed world point) -- otherwise once the camera's z passes GLASS_Z
  // during the pass-through phase, a fixed lookAt target flips the view
  // around to face back the way it came
  camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 10);

  // re-raycast after the camera moves, so the grid's mouse-glow spot tracks
  // where the cursor actually lands on the wall plane from the current view
  raycaster.setFromCamera(pointerNDC, camera);
  if (pointerActive && raycaster.ray.intersectPlane(wallPlane, wallHitPoint)) {
    gridUniforms.uMouse.value.set(wallHitPoint.x, wallHitPoint.y);
  } else {
    gridUniforms.uMouse.value.set(1e5, 1e5);
  }

  // refresh the glass's reflection before the visible render, so it shows the
  // wall grid/other shards/space scene as they are this frame, not last frame
  reflectionCamera.update(renderer, scene);

  composer.render();
}

animate();
