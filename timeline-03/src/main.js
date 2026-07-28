import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { getProject, types } from '@theatre/core';
import timelineState from './timeline-03-state.json';

// ---------------------------------------------------------------------------
// timeline-02 = star-shatter (the exploding glass glb + scroll-scrubbed
// AnimationMixer) forked and fused with paths-grid (the 4-point star mask,
// borrowed here to cut window-shaped holes in an opaque wall instead of
// paths-grid's own use of the same mask -- revealing a gradient behind a
// filled star shape).
//
// Depth order along -z, camera starts on the +z side looking down the axis:
//   camera (starts far) -> GLASS_Z (the shatter glb, closest to camera --
//                           sits just in front of the wall's center hole)
//                        -> WALL_Z (opaque, 3 star-shaped holes)
//                        -> space scene (aura veils + starfield, far back)
//
// Everything behind the glass is deliberately kept in the renderer's OPAQUE
// queue (see the wall / wisp / starfield materials), because three.js renders
// only opaque objects into the backdrop that transmissive materials refract.
// Anything left in the transparent queue is invisible through the shards.
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
  // where T comes from -- see the "Timeline input" block below. 'page' is the
  // standalone/dev default; the Webflow embed uses 'sections' (or 'external'
  // when the host page's Lenis handler calls window.seekTimelineTo itself).
  scrollSource: 'page',
  // These fractions are measured against the .scroll-spacer in style.css, which
  // was lengthened from 600vh to 700vh to give the closing galaxy fly-through
  // more runway. They were rescaled by the same factor so the zoom and shatter
  // beats still land at the same *absolute* scroll distance as before -- all of
  // the added length goes to the pass phase, not to slowing the earlier beats.
  zoomPhaseEnd: 0.29, // scroll fraction where the zoom-into-window dolly finishes
  shatterStart: 0.25, // shatter timeline starts scrubbing here (overlaps zoom's tail)
  shatterEnd: 0.58,
  passStart: 0.54, // camera resumes moving (through the wall) here (overlaps shatter's tail)
  clipStart: 0.13, // shatter clip: only this window of the glb's timeline is scrubbed through
  clipEnd: 0.29,
  autoRotateSpeed: 0,

  // -- camera path (world z) --
  cameraStartZ: 15,
  cameraMidZ: 8,
  // the shatter window used to hold the camera dead still at cameraMidZ --
  // this is where it creeps to instead, so the dolly keeps a faint forward
  // crawl through the whole shatter rather than fully stopping. Rate works
  // out to roughly half the zoom-in phase's, which reads as "slowed down",
  // not "stopped".
  cameraShatterEndZ: 5,
  // deep enough to keep travelling for the whole lengthened pass phase, but
  // still well short of SPACE_FAR_Z so the camera settles inside the galaxy
  // rather than flying out the far side of it
  cameraEndZ: -42,
  parallaxStrength: 0.3,
  parallaxDamping: 4,

  // -- wall + star windows (ported from paths-grid's 3-star layout) --
  wallColor: '#0a0f2c',
  // Proportions taken off the reference mockup, where the windows sit on grid
  // intersections rather than floating between them: the center star is on the
  // node at world origin (cols/rows are odd and the grid origin is centered, so
  // there is always a node at 0,0) and each side star is exactly one cell
  // diagonally down from it. Keep starOffset* equal to gridCellSize or they
  // drift off the lattice again.
  //
  // Measured off the mockup: center star = 1.55 cells wide, side stars = 0.87
  // of the center. starSize is left at 6 and the cell size moved instead, so
  // the glass fit and camera framing that hang off it stay put.
  starSize: 6,
  starSize2: 5.2,
  starOffsetX: 3.9, // == gridCellSize -> lands on the neighbouring grid node
  starOffsetY: 3.9,

  // -- wall grid (paths-grid's mouse-glow node/line lattice, etched onto the wall) --
  gridCellSize: 3.9, // drives starOffsetX/Y above -- change both together
  gridCols: 17,
  gridRows: 11,
  gridLineThickness: 0.01,
  gridGlowRadius: 3,
  gridGlowColor: '#00fff0', // neon cyan hotspot
  gridIntensity: 2.5,
  gridBaseColor: '#2f3551', // muted slate lattice, only lit up by the glow centers
  gridNodeColor: '#2f3551', // reticles match the lines so the lattice reads as one piece
  // the mockup's nodes are a single ring, and a larger one relative to the cell
  gridNodeSize: 0.6,
  gridRingCount: 2,

  // -- wall grid glow motion -- either 1-4 hotspots drifting on independent
  // Lissajous orbits, or (glowFollowMouse) a single hotspot raycast onto the
  // wall plane from the cursor
  glowFollowMouse: false,
  glowCenterCount: 2,
  glowSpeed: 0.4,
  glowOrbitRadiusX: 6,
  glowOrbitRadiusY: 4,
  // how much the plain wall (not just the grid lines/nodes) picks up the
  // glow color near a hotspot -- 0 keeps the wall untouched, 1 matches the
  // grid's own glow strength
  wallGlowIntensity: 0.01,

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

  // -- glass edge fresnel -- a white rim that ramps up at grazing angles.
  // The glb's material is physically fine but the shards are small and flat,
  // so their real Fresnel response only shows on the few facets angled just
  // right; this puts a consistent white edge on every shard so the silhouettes
  // read as glass instead of dissolving into whatever is behind them
  rimColor: '#eaf4ff',
  rimStrength: 0.55,
  rimPower: 4.5,

  // -- space scene behind the wall --
  showBackgroundStars: true,
  bgStarCount: 260,
  bgStarRadius: 55,
  wispCount: 10,
  wispOpacity: 0.25,
  wispColorA: '#54d8ef',
  wispColorB: '#e838ff',
  eyeStar: true,

  // -- alarm beacon -- a soft red light behind the wall, visible only through
  // the star cutouts (same depth-tested reveal that lets the starfield show
  // through), pulsing on/off like a strobe/alarm rather than a slow breathe
  alarmEnabled: true,
  // forces the alarm on regardless of Theatre's keyframed alarmLevel -- handy
  // for tuning color/speed/size without having to scrub to a lit part of the
  // sequence
  alarmManual: false,
  alarmColor: '#c70000',
  alarmSpeed: 1.05, // blinks per second
  alarmIntensity: 3.7,
  alarmSize: 32.5,
  alarmDepth: -11.4, // world z, behind WALL_Z

  // -- post --
  bloomStrength: 0.55,
  bloomRadius: 0.9,
  bloomThreshold: 0.25,
};

// `import.meta.env.BASE_URL` is root-relative (e.g. "/timeline-03/"), which
// the browser resolves against whatever page loaded the script -- fine when
// this page's own index.html is what's running it, but wrong the moment the
// built bundle is imported cross-origin, e.g. a Webflow page pulling it from
// its Cloudflare Pages deployment: the browser then requests
// "https://<webflow-site>/timeline-03/star-shatter-glass-animated.glb"
// instead of the actual host, a guaranteed 404.
//
// Simplest fix for a single known deployment target: hardcode the production
// URL, and only use the local/relative path for the dev server. Update the
// hardcoded URL if the Cloudflare Pages deployment it points to changes.
const MODEL_URL = import.meta.env.DEV
  ? `${import.meta.env.BASE_URL}star-shatter-glass-animated.glb`
  : 'https://6b0cc8b9.sc-client-eva.pages.dev/timeline-03/star-shatter-glass-animated.glb'; // TODO fix this later on...

const WALL_Z = 0;
const GLASS_Z = 0.6;
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

// the composer draws into its own render target, which bypasses the canvas's
// `antialias: true` entirely -- so give that target real MSAA. Beyond just
// antialiasing the scene, the wall's window cutouts below depend on
// alpha-to-coverage, which is a no-op on a single-sampled buffer.
const composerTarget = new THREE.WebGLRenderTarget(
  window.innerWidth * renderer.getPixelRatio(),
  window.innerHeight * renderer.getPixelRatio(),
  { type: THREE.HalfFloatType, samples: 4 }
);
const composer = new EffectComposer(renderer, composerTarget);
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
  const path = new Path2D(STAR_PATH);
  ctx.fillStyle = '#fff';
  ctx.fill(path);
  // canvas's fill antialiasing leaves partial-coverage pixels along the
  // path's sharpest cusps (the star's inner waist points), which read as a
  // sub-pixel gap once sampled/thresholded downstream -- stroking over the
  // same path closes that seam
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke(path);
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
// Wall grid glow -- 1-4 hotspots that either drift on independent Lissajous
// orbits, or (glowFollowMouse) track a single raycast hit on the wall plane.
// Declared up here, ahead of the wall itself, so the wall's own shader below
// can share these same uniforms and pick up a glow spill near each hotspot.
// ---------------------------------------------------------------------------
const MAX_GLOW_CENTERS = 4;
// per-center Lissajous frequency/phase, distinct enough that centers never
// stay in lockstep with each other regardless of glowSpeed
const GLOW_FREQ_X = [1.0, 1.35, 0.8, 1.6];
const GLOW_FREQ_Y = [1.6, 0.85, 1.3, 0.55];
const GLOW_PHASE = [0, 1.9, 3.4, 5.1];

const gridUniforms = {
  uGlowCenters: { value: Array.from({ length: MAX_GLOW_CENTERS }, () => new THREE.Vector2(1e5, 1e5)) },
  uNumCenters: { value: CONFIG.glowCenterCount },
  uRadius: { value: CONFIG.gridGlowRadius },
  uGlowColor: { value: new THREE.Color(CONFIG.gridGlowColor) },
  uIntensity: { value: CONFIG.gridIntensity },
};

// drives uGlowCenters every frame in autonomous mode -- called from the
// animation loop with the clock's elapsed time. In glowFollowMouse mode the
// animation loop sets uGlowCenters[0] from a raycast instead (see animate()).
function updateGlowCenters(time) {
  const centers = gridUniforms.uGlowCenters.value;
  const t = time * CONFIG.glowSpeed;
  for (let i = 0; i < MAX_GLOW_CENTERS; i++) {
    if (i < CONFIG.glowCenterCount) {
      const x = Math.sin(t * GLOW_FREQ_X[i] + GLOW_PHASE[i]) * CONFIG.glowOrbitRadiusX;
      const y = Math.sin(t * GLOW_FREQ_Y[i] + GLOW_PHASE[i] * 1.7) * CONFIG.glowOrbitRadiusY;
      centers[i].set(x, y);
    } else {
      centers[i].set(1e5, 1e5);
    }
  }
  gridUniforms.uNumCenters.value = CONFIG.glowCenterCount;
}

// ---------------------------------------------------------------------------
// Wall -- opaque plane, alpha punched to 0 inside any of the 3 star windows.
// A ShaderMaterial (not discard) so the mask's texture-filtered edges stay
// antialiased instead of hard-edged. Also picks up a glow spill from the grid's
// hotspots (uGlowCenters etc., shared by reference with gridUniforms) so the
// plain wall around a glowing line/node reads as lit too, not just the lattice.
// ---------------------------------------------------------------------------
const wallUniforms = {
  uMaskTex: { value: starMaskTexture },
  uWallColor: { value: new THREE.Color(CONFIG.wallColor) },
  uCenters: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uSizes: { value: [1, 1, 1] },
  uOpacity: { value: 1 },
  uGlowCenters: gridUniforms.uGlowCenters,
  uNumCenters: gridUniforms.uNumCenters,
  uRadius: gridUniforms.uRadius,
  uGlowColor: gridUniforms.uGlowColor,
  uIntensity: gridUniforms.uIntensity,
  uWallGlowIntensity: { value: CONFIG.wallGlowIntensity },
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
  // Opaque on purpose. three.js builds the backdrop that transmissive
  // materials refract from the OPAQUE render queue only, so anything left in
  // the transparent queue is simply invisible through the glass. Keeping the
  // wall opaque puts it (and, via the depth it writes, the space scene showing
  // through its windows) into what the shards actually see.
  //
  // alphaToCoverage is what lets it stay opaque and still punch holes: the
  // shader's mask alpha becomes MSAA sample coverage, so the window edges stay
  // antialiased instead of going stair-stepped the way a hard discard would.
  transparent: false,
  alphaToCoverage: true,
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
    uniform vec2 uGlowCenters[4];
    uniform int uNumCenters;
    uniform float uRadius;
    uniform vec3 uGlowColor;
    uniform float uIntensity;
    uniform float uWallGlowIntensity;
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
      float g = 0.0;
      for (int i = 0; i < 4; i++) {
        if (i < uNumCenters) {
          float d = distance(vWorldPos, uGlowCenters[i]);
          g += 1.0 - smoothstep(0.0, uRadius, d);
        }
      }
      g = clamp(g, 0.0, 1.0);
      vec3 color = mix(uWallColor, uGlowColor, g * uIntensity * uWallGlowIntensity);
      gl_FragColor = vec4(color, (1.0 - hole) * uOpacity);
    }
  `,
});

const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), wallMaterial);
wallMesh.position.z = WALL_Z;
// no renderOrder: as an opaque mesh it sorts front-to-back naturally, which
// draws it before the space scene and lets its depth reject those far wisps
// everywhere except inside the window cutouts
scene.add(wallMesh);

// The pass-through fade is the one moment the wall needs genuine alpha
// blending -- alpha-to-coverage would dither a partial fade into a visible
// screen door at 4 samples. It leaves the opaque queue only for that stretch,
// by which point the glass has already shattered and no longer needs it in
// the backdrop.
function setWallFading(fading) {
  if (wallMaterial.transparent === fading) return;
  wallMaterial.transparent = fading;
  wallMaterial.alphaToCoverage = !fading;
  wallMaterial.depthWrite = !fading;
  wallMaterial.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Wall grid -- paths-grid's node/line lattice, etched onto the wall's surface.
// Shares the wall's star-mask uniforms so the pattern punches the same 3
// holes instead of floating over the exposed glass/space.
// ---------------------------------------------------------------------------
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
      uniform vec2 uGlowCenters[4];
      uniform int uNumCenters;
      uniform float uRadius;
      uniform vec3 uGlowColor;
      uniform float uIntensity;
      uniform vec3 uBaseColor;
      varying vec2 vWorldPos;
      void main() {
        if (anyWindowMask(vWorldPos) > 0.5) discard;
        float g = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i < uNumCenters) {
            float d = distance(vWorldPos, uGlowCenters[i]);
            g += 1.0 - smoothstep(0.0, uRadius, d);
          }
        }
        g = clamp(g, 0.0, 1.0);
        vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    // fragments are either discarded (window cutouts) or fully opaque -- no
    // partial alpha, so this can be a real opaque material. That matters
    // because the glass's transmission only samples the renderer's *opaque*
    // list for what's "behind" it; leaving this transparent silently made
    // the grid invisible through the glass and left it out of depth testing
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
let gridNodeFillMesh = null;
function buildGridNodes() {
  if (gridNodeMesh) {
    scene.remove(gridNodeMesh);
    gridNodeMesh.geometry.dispose();
    gridNodeMesh.material.dispose();
  }
  if (gridNodeFillMesh) {
    scene.remove(gridNodeFillMesh);
    gridNodeFillMesh.geometry.dispose();
    gridNodeFillMesh.material.dispose();
    gridNodeFillMesh = null;
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
      uniform vec2 uGlowCenters[4];
      uniform int uNumCenters;
      uniform float uRadius;
      uniform vec3 uGlowColor;
      uniform float uIntensity;
      uniform vec3 uBaseColor;
      varying vec2 vWorldPos;
      void main() {
        if (anyWindowMask(vWorldPos) > 0.5) discard;
        float g = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i < uNumCenters) {
            float d = distance(vWorldPos, uGlowCenters[i]);
            g += 1.0 - smoothstep(0.0, uRadius, d);
          }
        }
        g = clamp(g, 0.0, 1.0);
        vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    // opaque for the same reason as the grid lines above -- this also fixes
    // depthTest:false previously making the node rings draw on top of
    // literally everything (including glass shards flying in front of them)
    // regardless of actual depth
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

  // Solid disc behind the whole reticle, matching the wall color -- without
  // it, each ring was just an empty annulus with the crossing lines showing
  // straight through, including the GAP between rings when gridRingCount > 1
  // (sizing the disc to only the innermost ring's inner edge, as before, left
  // that gap uncovered). One disc sized to the outermost ring's outer edge,
  // sitting under all the rings, is simpler than a disc per gap and covers
  // everything in one pass. Reads off wallUniforms.uWallColor (not a copy of
  // CONFIG.wallColor) so it stays in sync if Wall Color is tweaked later
  // without needing to rebuild the grid.
  const fillR = radii[0] + halfWidth;
  const fillVerts = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    fillVerts.push(0, 0, 0, Math.cos(a0) * fillR, Math.sin(a0) * fillR, 0, Math.cos(a1) * fillR, Math.sin(a1) * fillR, 0);
  }
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));

  const fillMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMaskTex: wallUniforms.uMaskTex,
      uCenters: wallUniforms.uCenters,
      uSizes: wallUniforms.uSizes,
      uWallColor: wallUniforms.uWallColor,
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
      uniform vec3 uWallColor;
      varying vec2 vWorldPos;
      void main() {
        if (anyWindowMask(vWorldPos) > 0.5) discard;
        gl_FragColor = vec4(uWallColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  gridNodeFillMesh = new THREE.InstancedMesh(fillGeometry, fillMaterial, gridGraph.points.length);
  gridNodeFillMesh.position.z = GRID_Z;
  // between the lines (11) and the ring (12) -- drawn after the lines so it
  // covers them, and before the ring so the ring still renders on top of it
  gridNodeFillMesh.renderOrder = 11.5;
  gridGraph.points.forEach((p, i) => {
    m.setPosition(p);
    gridNodeFillMesh.setMatrixAt(i, m);
  });
  gridNodeFillMesh.instanceMatrix.needsUpdate = true;
  scene.add(gridNodeFillMesh);
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
  // `transparent: false` puts these in the opaque queue so the glass's
  // transmission backdrop picks them up -- it does NOT make them opaque,
  // because three only forces NoBlending when blending is *also* the default
  // NormalBlending. Additive survives, and being order-independent it doesn't
  // care that the opaque queue sorts front-to-back instead of back-to-front.
  transparent: false,
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
  // opaque queue for the same reason as the starfield above -- additive
  // blending is preserved, and depthWrite stays off so the veils still stack
  // and sum into each other rather than occluding one another
  transparent: false,
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

// Reference depth for the perspective compensation below -- roughly where the
// camera sits while the wall/windows are actually being looked at (the zoom
// settles at cameraMidZ for the whole shatter phase). Wisps are seeded once,
// independent of the live scroll-driven camera, so this has to be a fixed
// stand-in rather than the camera's current position.
const WISP_REF_CAM_Z = CONFIG.cameraMidZ + 1;

function placeWisp(wisp, rng, x, y, z, sizeMul) {
  wisp.visible = true;
  // Position and size were both independent of z, so a wisp got exactly as
  // wide and exactly as far out in world space regardless of how deep it
  // sat. Perspective then shrinks the far ones toward the screen center and
  // toward invisibility. Scaling both position and plane size by distance
  // from WISP_REF_CAM_Z keeps a wisp's apparent screen footprint roughly
  // constant across the whole depth range.
  const depthScale = (WISP_REF_CAM_Z - z) / (WISP_REF_CAM_Z - SPACE_NEAR_Z);
  wisp.position.set(x * depthScale, y * depthScale, z);
  const s = (16 + rng() * 20) * depthScale * sizeMul;
  wisp.userData.scaleX = s;
  wisp.userData.scaleY = s * (0.6 + rng() * 0.4);
  wisp.rotation.z = rng() * Math.PI * 2;
  wisp.userData.breathePhase = rng() * Math.PI * 2;
  wisp.scale.set(wisp.userData.scaleX, wisp.userData.scaleY, 1);
  wisp.material.uniforms.uSeed.value = rng() * 100;
}

function seedWisps() {
  const rng = mulberry32(4242);

  // Random placement alone left this to luck: the fixed random seed never
  // reliably put a wisp's world-space footprint over the two off-center
  // windows, so they read as unlit next to the glowing center one. Anchoring
  // one wisp directly behind each window (at a near depth, so it's bright and
  // in focus) guarantees all three read as equally lit, matching the
  // reference mockup; the rest of the budget still scatters randomly for
  // ambient depth/texture.
  const anchors = [
    { x: 0, y: 0 },
    { x: CONFIG.starOffsetX, y: -CONFIG.starOffsetY },
    { x: -CONFIG.starOffsetX, y: -CONFIG.starOffsetY },
  ];

  for (let i = 0; i < MAX_WISPS; i++) {
    const wisp = wisps[i];
    if (i >= CONFIG.wispCount) {
      wisp.visible = false;
      continue;
    }
    if (i < anchors.length) {
      const a = anchors[i];
      const z = THREE.MathUtils.lerp(SPACE_NEAR_Z, SPACE_NEAR_Z + 10, rng());
      placeWisp(wisp, rng, a.x, a.y, z, 1);
      continue;
    }
    const angle = rng() * Math.PI * 2;
    const z = THREE.MathUtils.lerp(SPACE_NEAR_Z, SPACE_FAR_Z, rng());
    const radial = 4 + rng() * 22;
    placeWisp(wisp, rng, Math.cos(angle) * radial, Math.sin(angle) * radial, z, 1);
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

// alarm beacon -- a big soft red sprite parked just behind the wall. It's
// depth-tested against the wall's opaque surface like everything else back
// here, so it only actually shows through the star cutouts, reading as a
// light flashing behind the wall rather than a flat color wash over it.
const alarmMaterial = new THREE.SpriteMaterial({
  map: makeGlowTexture(),
  color: new THREE.Color(CONFIG.alarmColor),
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const alarmLight = new THREE.Sprite(alarmMaterial);
alarmLight.position.set(0, -1.2, CONFIG.alarmDepth);
alarmLight.scale.setScalar(CONFIG.alarmSize);
alarmLight.visible = CONFIG.alarmEnabled;
scene.add(alarmLight);

// bakes alarmIntensity into the sprite's base color so the per-frame pulse
// below only has to drive opacity 0-1, not recompute color from the hex
// string every frame
function syncAlarmColor() {
  alarmMaterial.color.set(CONFIG.alarmColor).multiplyScalar(CONFIG.alarmIntensity);
}
syncAlarmColor();

// classic strobe shape -- quick rise, quick fall, long dark gap -- rather
// than a smooth sine pulse, which reads as "breathing" instead of "alarm"
function alarmPulse(time) {
  const period = 1 / Math.max(CONFIG.alarmSpeed, 0.01);
  const phase = (((time % period) + period) % period) / period;
  const attack = 0.12;
  const decay = 0.28;
  if (phase < attack) return phase / attack;
  if (phase < attack + decay) return 1 - (phase - attack) / decay;
  return 0;
}

// ---------------------------------------------------------------------------
// Glass -- the star-shatter glb, fit to the center window and parked at
// GLASS_Z, just in front of the wall's center hole, so it reads as the pane
// sitting in the window rather than something seen behind it.
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

// populated from the glb's own material once it loads (KHR_materials_transmission
// / _volume / _clearcoat authored in Blender) -- see the GLTFLoader callback below
let glassMaterial = null;

// Fresnel rim, patched into whatever material the glb ships rather than baked
// into the file, so it stays tunable from the GUI alongside the authored
// values. Kept as standalone uniform objects so those GUI handlers can write
// to them without needing to reach into the compiled shader.
const rimUniforms = {
  uRimColor: { value: new THREE.Color(CONFIG.rimColor) },
  uRimStrength: { value: CONFIG.rimStrength },
  uRimPower: { value: CONFIG.rimPower },
};

function addFresnelRim(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;
         void main() {`
      )
      // geometryNormal / geometryViewDir are declared by <lights_fragment_begin>
      // in main()'s scope, so they're still live by the time the final color is
      // assembled here -- no need to recompute the view vector
      .replace(
        '#include <opaque_fragment>',
        `float rimFresnel = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), uRimPower);
         outgoingLight += uRimColor * rimFresnel * uRimStrength;
         #include <opaque_fragment>`
      );
  };
  material.needsUpdate = true;
}

const modelGroup = new THREE.Group();
modelGroup.position.z = GLASS_Z;
scene.add(modelGroup);

// cancels the perspective overhang from the glass sitting in front of the
// wall -- see the registration block in applyTimeline()
let glassRegistrationScale = 1;

let mixer = null;
let action = null;
let clipDuration = 1;
let currentShatterProgress = 0;

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        // all shards share the glb's single authored material ("Thick Glossy
        // Glass") -- grab a reference to it once so the GUI/reflection setup
        // below can still tweak it live
        glassMaterial = child.material;
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

    // the glb material has no envMap of its own -- feed it the live scene
    // reflection so shards still pick up the wall/other-shard/space reflection
    if (glassMaterial) {
      glassMaterial.envMap = reflectionTarget.texture;
      glassMaterial.envMapIntensity = CONFIG.envMapIntensity;
      addFresnelRim(glassMaterial);

      // mirror the glb-authored values back into CONFIG so the GUI sliders
      // reflect what's actually on the material instead of the old hand-tuned
      // defaults, then refresh the displayed slider positions
      CONFIG.transmission = glassMaterial.transmission;
      CONFIG.roughness = glassMaterial.roughness;
      CONFIG.thickness = glassMaterial.thickness;
      CONFIG.ior = glassMaterial.ior;
      CONFIG.clearcoat = glassMaterial.clearcoat;
      CONFIG.clearcoatRoughness = glassMaterial.clearcoatRoughness;
      CONFIG.attenuationColor = `#${glassMaterial.attenuationColor.getHexString()}`;
      CONFIG.attenuationDistance = glassMaterial.attenuationDistance;
      glassFolder.controllers.forEach((c) => c.updateDisplay());
    }

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
  (err) => console.error('Failed to load star-shatter glb', err)
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

// ---------------------------------------------------------------------------
// Timeline input -- the single entry point everything funnels through.
//
// This scene is meant to run as a Webflow custom-embed alongside a separately
// loaded Lenis script, so the scroll source is deliberately pluggable rather
// than hardwired to window.scrollY:
//
//   'page'     -- this page's own scroll (dev/standalone, index.html sections)
//   'sections' -- [data-fs-section] intersection math, same as the Spline embed
//   'external' -- nothing internal drives it; the host page calls
//                 window.seekTimelineTo(t) itself (e.g. from a Lenis
//                 'scroll' handler, or Webflow interactions)
//
// In all three cases the value lands here, so Theatre's playhead and the
// procedural phases below stay in sync no matter who is driving.
// ---------------------------------------------------------------------------
const SCROLL_SOURCES = ['page', 'sections', 'external'];

// The public API. T is a 0..1 fraction of the whole timeline. Kept on `window`
// (not just exported) precisely so a plain <script> in Webflow -- which cannot
// import from this module -- can still drive it.
window.seekTimelineTo = function seekTimelineTo(t) {
  const v = Number(t);
  if (!Number.isFinite(v)) return;
  targetGlobalT = THREE.MathUtils.clamp(v, 0, 1);
};

// convenience for the host page: skip the damping and land on T immediately
// (useful when snapping, or when restoring a scroll position on load)
window.setTimelineTo = function setTimelineTo(t) {
  window.seekTimelineTo(t);
  currentGlobalT = targetGlobalT;
};

// -- 'page' source ----------------------------------------------------------
function readPageScroll() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  return maxScroll > 0 ? THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1) : 0;
}

// -- 'sections' source ------------------------------------------------------
// Same measurement the Spline embed uses: each [data-fs-section] reports how
// far it has travelled up through the viewport, and the first/last sections'
// absolute bounds give an overall progress across the whole run. We take that
// overall value as T, so the timeline spans the section group rather than the
// document.
const sectionEls = Array.from(document.querySelectorAll('[data-fs-section]'));
const sectionProgress = new Map();

// optional dev readouts -- absent in the Webflow embed unless the page happens
// to include the same [data-fs-dev-*] hooks, hence the null guards at use sites
const devScrollsOut = document.querySelector('[data-fs-dev-scrolls]');
const devTimelineOut = document.querySelector('[data-fs-dev-timeline]');

function measureSections() {
  const viewportHeight = window.innerHeight;
  let firstTopAbs = null;
  let lastBottomAbs = null;

  for (let i = 0; i < sectionEls.length; i++) {
    const el = sectionEls[i];
    const rect = el.getBoundingClientRect();
    const pct = THREE.MathUtils.clamp(((viewportHeight - rect.top) / rect.height) * 100, 0, 100);
    sectionProgress.set(el.dataset.fsSection, pct);

    if (i === 0) firstTopAbs = rect.top + window.scrollY;
    if (i === sectionEls.length - 1) lastBottomAbs = rect.bottom + window.scrollY;
  }

  if (firstTopAbs === null) return 0;
  const startScroll = firstTopAbs - viewportHeight;
  const endScroll = lastBottomAbs - viewportHeight;
  const span = endScroll - startScroll;
  return span > 0 ? THREE.MathUtils.clamp((window.scrollY - startScroll) / span, 0, 1) : 0;
}

// rAF-throttled, so a burst of scroll events collapses into one measure per
// rendered frame -- matches the embed script's `ticking` guard
let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    // measured unconditionally so the per-section dev readout stays live in
    // 'page' mode too -- only which value drives T depends on the source
    const sectionsT = measureSections();
    if (CONFIG.scrollSource === 'page') {
      window.seekTimelineTo(readPageScroll());
    } else if (CONFIG.scrollSource === 'sections') {
      window.seekTimelineTo(sectionsT);
    }
  });
}

// Only attached for the two internal sources; 'external' leaves the page
// scroll alone entirely so a host-page Lenis handler is the sole driver.
function syncScrollListener() {
  window.removeEventListener('scroll', onScroll);
  if (CONFIG.scrollSource !== 'external') {
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}
syncScrollListener();

// ---------------------------------------------------------------------------
// Theatre.js -- an authored sequence whose playhead is driven by T rather than
// by a clock, exactly as in timeline-01. The procedural phases in
// applyTimeline() below still own the broad choreography (zoom / shatter /
// pass-through); Theatre layers scroll-authored overrides on top of it, so
// keyframing is additive rather than a rewrite.
//
// Open the Studio panel (⌥/Alt + \) to keyframe; it autosaves to localStorage
// while open.
//
// Studio loads by DEFAULT -- in dev and in the built output alike -- so a
// deployed build is authorable as-is. Pass `?minify` to leave it out, which is
// what the Webflow embed should use: the editor is dead weight on a real page.
//
// Dynamically imported, not statically, so `?minify` genuinely saves the
// bytes: @theatre/studio is ~760 kB raw (~240 kB gzipped), roughly doubling
// this bundle, and as a separate chunk it's simply never fetched when skipped.
// (A static `import.meta.env.DEV` guard was the original bug -- Vite folds it
// to a literal `false`, the branch becomes dead code, and Rollup drops the
// module outright, which is why Studio was missing from the build entirely.)
// ---------------------------------------------------------------------------
const THEATRE_STUDIO = !new URLSearchParams(window.location.search).has('minify');

if (THEATRE_STUDIO) {
  // fire-and-forget: the scene doesn't need the editor to finish loading before
  // it starts rendering, so this deliberately isn't awaited
  import('@theatre/studio')
    .then(({ default: studio }) => studio.initialize())
    .catch((err) => console.error('Failed to load Theatre Studio', err));
}

const SEQUENCE_LENGTH = 24; // seconds -- just the T(0..1) -> playhead mapping range

// The authored state is passed in every time, not just in production: without
// it @theatre/core throws once it detects no studio and no state after 1s, and
// passing it unconditionally is also what lets `?theatre` on a deployed build
// open the *committed* keyframes rather than an empty sheet. Studio's own
// localStorage autosave still takes precedence while it's open, so authoring
// in dev behaves as before.
const sceneSheet = getProject('Timeline 03', { state: timelineState }).sheet('Wall Scene');

const sceneTrack = sceneSheet.object('Scene', {
  // multiplies the scroll-driven camera travel, so a keyframed dip here reads
  // as the dolly hesitating without touching the phase fractions
  dollyCurve: types.number(1, { range: [0, 3], nudgeMultiplier: 0.01 }),
  fov: types.number(50, { range: [25, 100] }),
  // scales the grid's glow hotspots and the wall spill together
  glowIntensity: types.number(CONFIG.gridIntensity, { range: [0, 4], nudgeMultiplier: 0.01 }),
  glowColor: types.rgba({ r: 0, g: 1, b: 0.941, a: 1 }),
  // 0..1 multiplier on the alarm beacon's pulse, for keyframing the alarm in
  // partway through the scroll rather than having it blink from the start
  alarmLevel: types.number(0, { range: [0, 1], nudgeMultiplier: 0.01 }),
  bloomStrength: types.number(CONFIG.bloomStrength, { range: [0, 3], nudgeMultiplier: 0.01 }),
});

const theatreColorScratch = new THREE.Color();
let theatreValues = sceneTrack.value;
sceneTrack.onValuesChange((v) => {
  theatreValues = v;

  camera.fov = v.fov;
  camera.updateProjectionMatrix();

  gridUniforms.uIntensity.value = v.glowIntensity;
  const { r, g, b } = v.glowColor;
  gridUniforms.uGlowColor.value.copy(theatreColorScratch.setRGB(r, g, b));

  bloomPass.strength = v.bloomStrength;
});

function applyTimeline(t) {
  // Drive Theatre's playhead from the same T, so the authored sequence and the
  // procedural phases below always describe the same instant.
  sceneSheet.sequence.position = t * SEQUENCE_LENGTH;

  const zoomT = easeInOutCubic(THREE.MathUtils.clamp(t / CONFIG.zoomPhaseEnd, 0, 1));
  const shatterT = easeInOutCubic(
    THREE.MathUtils.clamp((t - CONFIG.shatterStart) / (CONFIG.shatterEnd - CONFIG.shatterStart), 0, 1)
  );
  // fills the gap between the zoom and pass phases (previously nothing drove
  // the camera there, so it sat dead still at cameraMidZ for the whole
  // shatter window) with a slow continuous creep toward cameraShatterEndZ
  const driftT = easeInOutCubic(
    THREE.MathUtils.clamp((t - CONFIG.zoomPhaseEnd) / (CONFIG.passStart - CONFIG.zoomPhaseEnd), 0, 1)
  );
  const passT = easeInOutCubic(THREE.MathUtils.clamp((t - CONFIG.passStart) / (1 - CONFIG.passStart), 0, 1));

  // Each term below is gated by its own eased progress (0 until that phase
  // starts, 1 once it ends), so this is really 3 waypoint-to-waypoint moves
  // chained additively rather than nested lerps -- nesting was what caused
  // the freeze: lerp(lerp(start,mid,zoomT), end, passT) collapses to a flat
  // `mid` for the entire span where zoomT has already saturated to 1 but
  // passT hasn't yet started rising.
  const dollyZ =
    CONFIG.cameraStartZ +
    (CONFIG.cameraMidZ - CONFIG.cameraStartZ) * zoomT +
    (CONFIG.cameraShatterEndZ - CONFIG.cameraMidZ) * driftT +
    (CONFIG.cameraEndZ - CONFIG.cameraShatterEndZ) * passT;

  // Theatre's dollyCurve scales the travel measured from the start point, so a
  // keyframed dip reads as the dolly hesitating mid-move rather than the whole
  // path shifting -- at 1 (its default) this is exactly dollyZ.
  camera.userData.targetZ =
    CONFIG.cameraStartZ + (dollyZ - CONFIG.cameraStartZ) * theatreValues.dollyCurve;

  setShatterProgress(shatterT);

  // The glass is fit to starSize in world units, which matches the cutout
  // exactly -- but it's parked GLASS_Z in front of the wall, so perspective
  // projects it larger than the hole it's meant to fill: 4% at cameraStartZ,
  // growing to 8.5% by cameraMidZ. Scaling by the ratio of the two depths
  // cancels that, so the intact star registers with the SVG cutout at every
  // camera distance instead of drifting bigger as the dolly closes in.
  //
  // Frozen once the shatter starts: there's nothing left to register against
  // by then, and the factor collapses to zero (then flips negative) as the
  // fly-through carries the camera onto and past the glass plane.
  if (shatterT <= 0) {
    const camZ = camera.position.z;
    glassRegistrationScale = camZ > GLASS_Z ? 1 - GLASS_Z / camZ : 1;
  }
  modelGroup.scale.setScalar(glassRegistrationScale);

  // wall fades out as the camera pushes through it, so there's no visible
  // clipping/pop when the camera's z crosses the wall's z=0 plane
  wallUniforms.uOpacity.value = 1 - passT;
  wallMesh.visible = passT < 0.995;
  setWallFading(passT > 0.001);
}
camera.userData.targetZ = CONFIG.cameraStartZ;

// ---------------------------------------------------------------------------
// Mouse parallax -- camera dolly (not rotation), reused from star-shatter --
// plus (when glowFollowMouse is on) a raycast onto the wall plane so the
// grid's glow hotspot tracks the cursor instead of drifting on its own.
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
const gui = new GUI({ title: 'Timeline 03 Controls' });

const tips = { theatreTip: '⌥/Alt + \\ toggles Theatre UI (?minify omits it)' };
gui.add(tips, 'theatreTip').name('Tip').disable();

const timelineFolder = gui.addFolder('Timeline');
timelineFolder
  .add(CONFIG, 'scrollSource', SCROLL_SOURCES)
  .name('Scroll Source')
  .onChange(syncScrollListener);
// live scrub, so the whole sequence can be inspected without scrolling -- and a
// direct demo of the same entry point the Webflow/Lenis host page calls
timelineFolder
  .add(CONFIG, 'progress', 0, 1, 0.001)
  .name('Seek T (manual)')
  .onChange((v) => window.setTimelineTo(v));
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

gridFolder.add(CONFIG, 'glowFollowMouse').name('Mouse Hover Glow');
gridFolder
  .add(CONFIG, 'glowCenterCount', 1, MAX_GLOW_CENTERS, 1)
  .name('Glow Centers')
  .onChange((v) => (gridUniforms.uNumCenters.value = v));
gridFolder.add(CONFIG, 'glowSpeed', 0, 2, 0.01).name('Glow Speed');
gridFolder.add(CONFIG, 'glowOrbitRadiusX', 0, 12, 0.1).name('Orbit Radius X');
gridFolder.add(CONFIG, 'glowOrbitRadiusY', 0, 12, 0.1).name('Orbit Radius Y');
gridFolder
  .add(CONFIG, 'wallGlowIntensity', 0, 1, 0.01)
  .name('Wall Spill')
  .onChange((v) => (wallUniforms.uWallGlowIntensity.value = v));

const glassFolder = gui.addFolder('Glass Material');
glassFolder
  .add(CONFIG, 'transmission', 0, 1, 0.01)
  .name('Transmission')
  .onChange((v) => glassMaterial && (glassMaterial.transmission = v));
glassFolder
  .add(CONFIG, 'roughness', 0, 0.5, 0.005)
  .name('Roughness')
  .onChange((v) => glassMaterial && (glassMaterial.roughness = v));
glassFolder
  .add(CONFIG, 'thickness', 0, 2, 0.01)
  .name('Thickness')
  .onChange((v) => glassMaterial && (glassMaterial.thickness = v));
glassFolder
  .add(CONFIG, 'ior', 1, 2.33, 0.01)
  .name('IOR')
  .onChange((v) => glassMaterial && (glassMaterial.ior = v));
glassFolder
  .add(CONFIG, 'envMapIntensity', 0, 6, 0.05)
  .name('Env Intensity')
  .onChange((v) => glassMaterial && (glassMaterial.envMapIntensity = v));
glassFolder
  .add(CONFIG, 'clearcoat', 0, 1, 0.01)
  .name('Clearcoat')
  .onChange((v) => glassMaterial && (glassMaterial.clearcoat = v));
glassFolder
  .add(CONFIG, 'clearcoatRoughness', 0, 0.5, 0.005)
  .name('Clearcoat Roughness')
  .onChange((v) => glassMaterial && (glassMaterial.clearcoatRoughness = v));
glassFolder
  .addColor(CONFIG, 'attenuationColor')
  .name('Tint Color')
  .onChange((v) => glassMaterial && glassMaterial.attenuationColor.set(v));
glassFolder
  .add(CONFIG, 'attenuationDistance', 0.5, 30, 0.5)
  .name('Tint Distance')
  .onChange((v) => glassMaterial && (glassMaterial.attenuationDistance = v));
glassFolder.addColor(CONFIG, 'rimColor').name('Edge Color').onChange((v) => rimUniforms.uRimColor.value.set(v));
glassFolder
  .add(CONFIG, 'rimStrength', 0, 3, 0.05)
  .name('Edge Fresnel')
  .onChange((v) => (rimUniforms.uRimStrength.value = v));
glassFolder
  .add(CONFIG, 'rimPower', 0.5, 8, 0.1)
  .name('Edge Falloff')
  .onChange((v) => (rimUniforms.uRimPower.value = v));

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

const alarmFolder = gui.addFolder('Alarm Light');
// visibility itself is driven per-frame in animate() (it also depends on
// Theatre's alarmLevel), so these two are plain flags with no side effect here
alarmFolder.add(CONFIG, 'alarmEnabled').name('Enabled');
alarmFolder.add(CONFIG, 'alarmManual').name('Ignore Keyframes');
alarmFolder.addColor(CONFIG, 'alarmColor').name('Color').onChange(syncAlarmColor);
alarmFolder.add(CONFIG, 'alarmSpeed', 0.1, 4, 0.05).name('Blink Speed');
alarmFolder.add(CONFIG, 'alarmIntensity', 0.2, 5, 0.1).name('Intensity').onChange(syncAlarmColor);
alarmFolder.add(CONFIG, 'alarmSize', 4, 40, 0.5).name('Size').onChange((v) => alarmLight.scale.setScalar(v));
alarmFolder.add(CONFIG, 'alarmDepth', SPACE_NEAR_Z, WALL_Z, 0.5).name('Depth').onChange((v) => (alarmLight.position.z = v));

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

  // 'external' (the Webflow/Lenis embed) skips this lerp entirely and tracks
  // seekTimelineTo's target 1:1. Lenis already smooths its own scroll value
  // (its `lerp` option) before ever calling seekTimelineTo, so lerping again
  // here was smoothing already-smoothed input -- a second EMA stacked on top
  // of Lenis' own inertia, which reads as the timeline laggily chasing the
  // page instead of tracking it, particularly once Lenis overshoots on
  // flicks/snaps and this lerp then has to visibly catch back up. 'page' and
  // 'sections' still lerp: they read window.scrollY directly, which jumps in
  // native per-tick increments with no smoothing of its own.
  if (CONFIG.scrollSource === 'external') {
    currentGlobalT = targetGlobalT;
  } else {
    currentGlobalT += (targetGlobalT - currentGlobalT) * Math.min(1, dt * CONFIG.scrollDamping);
  }
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

  if (CONFIG.glowFollowMouse) {
    // re-raycast after the camera moves, so the hotspot tracks where the
    // cursor actually lands on the wall plane from the current view
    raycaster.setFromCamera(pointerNDC, camera);
    const centers = gridUniforms.uGlowCenters.value;
    if (pointerActive && raycaster.ray.intersectPlane(wallPlane, wallHitPoint)) {
      centers[0].set(wallHitPoint.x, wallHitPoint.y);
    } else {
      centers[0].set(1e5, 1e5);
    }
    for (let i = 1; i < MAX_GLOW_CENTERS; i++) centers[i].set(1e5, 1e5);
    gridUniforms.uNumCenters.value = 1;
  } else {
    updateGlowCenters(time);
  }

  // Theatre's alarmLevel gates the pulse, so the alarm can be keyframed to
  // ramp in partway through the scroll instead of blinking from frame one.
  // With no keyframes authored it sits at 0, hence the GUI toggle acting as
  // the manual override.
  const alarmGate = CONFIG.alarmEnabled ? Math.max(theatreValues.alarmLevel, CONFIG.alarmManual ? 1 : 0) : 0;
  alarmMaterial.opacity = alarmGate > 0 ? alarmPulse(time) * alarmGate : 0;
  alarmLight.visible = CONFIG.alarmEnabled && alarmGate > 0;

  if (devTimelineOut) devTimelineOut.textContent = currentGlobalT.toFixed(3);
  if (devScrollsOut && sectionEls.length) {
    devScrollsOut.textContent = sectionEls
      .map((el) => `${el.dataset.fsSection}: ${(sectionProgress.get(el.dataset.fsSection) || 0).toFixed(0)}%`)
      .join(' | ');
  }

  // refresh the glass's reflection before the visible render, so it shows the
  // wall grid/other shards/space scene as they are this frame, not last frame
  reflectionCamera.update(renderer, scene);

  composer.render();
}

animate();
