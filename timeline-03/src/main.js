import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { KawaseBloomPass } from './kawase-bloom.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import Stats from 'stats.js';
import { getProject, types } from '@theatre/core';
import timelineState from './timeline-03-state.json';

const DEFAULT_MATCAP_TEXTURE = 'Crystal-2.png';

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
  // where T comes from -- see the "Timeline input" block below. 'page' is the
  // standalone/dev default; the Webflow embed uses 'sections' (or 'external'
  // when the host page's Lenis handler calls window.seekTimelineTo itself).
  scrollSource: 'page',
  // Off this decouples Theatre's OWN sequence playhead from scroll T, so
  // Studio's keyframe-nav buttons and manual playhead scrubbing actually work
  // while authoring -- see the guard in applyTimeline. Everything else
  // (shatter progress, wall fade, etc.) keeps following scroll regardless.
  syncTheatreToScroll: true,
  // These fractions are measured against the .scroll-spacer in style.css, which
  // was lengthened from 600vh to 700vh to give the closing galaxy fly-through
  // more runway. They were rescaled by the same factor so the zoom and shatter
  // beats still land at the same *absolute* scroll distance as before -- all of
  // the added length goes to the pass phase, not to slowing the earlier beats.
  shatterStart: 0.25, // shatter timeline starts scrubbing here (overlaps zoom's tail)
  shatterEnd: 0.58,
  passStart: 0.54, // camera resumes moving (through the wall) here (overlaps shatter's tail)
  clipStart: 0.13, // shatter clip: only this window of the glb's timeline is scrubbed through
  clipEnd: 0.29,
  autoRotateSpeed: 0,
  glbModel: 'jagged/Broken 60 fragments.glb',
  // multiplier on top of the auto-fit scale (see modelAutoFitScale) that lands
  // the glb's own tip-to-tip span exactly on the center window -- 0.001 steps
  // since that auto-fit is already a tight fit and even a 0.01 nudge visibly
  // drifts the shatter off the window's silhouette
  glbScale: 1.05,

  // -- camera path (world z) --
  // The camera no longer dollies procedurally off scroll T -- that whole move
  // (zoom into the window, creep through the shatter, fly through the wall)
  // is now authored entirely as Theatre keyframes on cameraOffsetZ (see
  // sceneTrack below), the same way glowIntensity/bloomStrength/alarmLevel
  // already work: open Studio (⌥/Alt+\), select Scene, and keyframe
  // cameraOffsetZ across the sequence. cameraStartZ is just the static base
  // position that offset gets added to.
  cameraStartZ: 15,
  parallaxStrength: 0.3,
  parallaxDamping: 4,

  // -- manual camera offset, added on top of the procedural dolly/parallax --
  // a constant nudge from the GUI, PLUS whatever Theatre has keyframed on the
  // same three properties (see sceneTrack below) -- the two add together
  // rather than fighting, so a Studio-authored camera move still lands on top
  // of any manual composition dialed in here.
  cameraOffsetX: 0,
  cameraOffsetY: 0,
  cameraOffsetZ: 0,
  // Free-fly preview camera (see debugCamera below) -- lets the scene be
  // orbited/tumbled while the actual timeline camera keeps animating
  // untouched, with a picture-in-picture inset showing what it currently sees.
  freeCamera: false,

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
  // World z of the wall plane. The glass sits at GLASS_Z and the space scene
  // starts at SPACE_NEAR_Z, so pushing the wall back opens up the gap between
  // wall and starfield, while pulling it forward closes on the glass -- past
  // GLASS_Z the wall crosses in front of the shards.
  wallZ: 0.6,
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
  gridGlowColor: '#5a00a3',
  gridIntensity: 2.5,
  gridBaseColor: '#2f3551', // muted slate lattice, only lit up by the glow centers
  gridNodeColor: '#2f3551', // reticles match the lines so the lattice reads as one piece
  // the mockup's nodes are a single ring, and a larger one relative to the cell
  gridNodeSize: 0.6,
  gridRingCount: 2,

  // -- wall grid glow motion -- either 1-4 hotspots drifting on independent
  // Lissajous orbits, or (glowFollowMouse) a single hotspot raycast onto the
  // wall plane from the cursor
  glowFollowMouse: true,
  glowCenterCount: 1,
  glowSpeed: 0.27,
  glowOrbitRadiusX: 9,
  glowOrbitRadiusY: 9,
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
  eyeStar: false,

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
  // dual-filter chain depth -- each level halves the resolution again, so this
  // sets how wide the blur reaches. 4 is already a very broad glow here; going
  // to 5+ costs almost nothing extra (the buffers are tiny by then) but starts
  // bleeding light across the whole frame.
  bloomLevels: 4,

  // -- performance --
  // This scene is fill-rate bound, not geometry bound (287 shards but only
  // ~6.5k triangles total), so the three knobs that actually move the needle
  // are all about how many pixels get shaded.
  //
  // 1.5 rather than 2: on a 2x display that's ~44% fewer pixels per pass, and
  // every pass benefits -- the MSAA scene target, the transmission backdrop
  // that all 287 glass shards sample, and the bloom chain.
  maxPixelRatio: 1.5,
  bloomResolutionScale: 0.5,
  // NOTE: there is deliberately no "reflect every N frames" knob here. The
  // CubeCamera re-render looks like an obvious thing to throttle, but doing so
  // makes the glass strobe -- see the comment at the reflectionCamera.update()
  // call in animate().
  // three r170+ only. Every transmissive shard samples a backdrop render
  // target of the whole opaque scene; this scales that target's resolution.
  // What the shards show is already distorted by refraction and roughness, so
  // half resolution costs a quarter of the pixels for no visible change.
  transmissionResolutionScale: 0.5,

  // -- layer / effect toggles --
  // Every one of these defaults to the scene exactly as authored; they exist
  // to isolate a layer while tuning, and to price each effect against the
  // stats.js readout.
  showWall: true,
  showGridLines: true,
  showGridNodes: true,
  glowAnimate: true, // off freezes the hotspots where they are
  showGlass: true,
  // which material the shards wear -- see GLASS_MATERIAL_MODES
  glassMaterialMode: `matcap:${DEFAULT_MATCAP_TEXTURE}`,
  showAuras: true,
  showReflection: true, // the live CubeCamera envMap on the glass
  fresnelRim: true,
  enableBloom: true,
  enableFog: true,
  enableParallax: true,
};

// A root-relative path (e.g. `${import.meta.env.BASE_URL}...`) resolves
// against whatever page loaded the script -- fine when this page's own
// index.html is what's running it, but wrong the moment the built bundle is
// imported cross-origin, e.g. a Webflow page pulling it from its Cloudflare
// Pages deployment: the browser would request
// "https://<webflow-site>/timeline-03/<file>.glb" instead of the actual host,
// a guaranteed 404. Always pointing at the live, shared /assets/ deployment
// (built.sh copies the repo's assets/ folder to dist/assets/) sidesteps that
// entirely -- the same absolute URL works from the dev server, this site's own
// build, and a cross-origin Webflow embed alike.
const STAR_SHATTER_BASE_URL = 'https://sc-client-eva.pages.dev/assets/star-shatter';

// dropdown label -> filename in assets/star-shatter/, picked by the GUI below
const GLB_OPTIONS = {
  '01 - Star Shatter': '01_star-shatter-01.glb',
  '02 - Glass Animated': '02_star-shatter-glass-animated.glb',
  '02a - Simple Glass Animated': '02a_star-shatter-simple-glass-animated.glb',
  '03 - Jagged Edges': '03_star-shatter_jagged-edges.glb',
  '04 - Jagged, 100 Shards': '04_star-shatter_jagged-100-shards.glb',
  '05 - Jagged, 120 Shards': '05_star-shatter_jagged-120-shards.glb',
  'Jagged - 60 fragments': 'jagged/Broken 60 fragments.glb',
};

// The wall's home position. Its LIVE z is CONFIG.wallZ (Wall Z in the GUI) --
// this constant survives only as the reference depth other fixed layout
// numbers are quoted against.
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
// `antialias` is deliberately off: the composer renders into its own MSAA
// target (see composerTarget below) and the canvas's own default framebuffer
// is only ever blitted to, so a second multisampled buffer here is pure cost.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050608, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.transmissionResolutionScale = CONFIG.transmissionResolutionScale;

const scene = new THREE.Scene();
// Toggled by density rather than by nulling scene.fog: removing the fog object
// changes every material's #define set and forces a full shader recompile of
// the scene mid-frame, which stalls hard. Density 0 is a no-op at the same cost
// as no fog at all.
const FOG_DENSITY = 0.02;
scene.fog = new THREE.FogExp2(0x050608, FOG_DENSITY);

// RoomEnvironment is itself a THREE.Scene full of boxes and area-light
// materials. It's only needed for the one-shot PMREM bake, so it gets disposed
// immediately after -- left alive it lingers as a second scene holding ~20
// geometries/materials for the lifetime of the page (and shows up as a phantom
// extra Scene in three.js inspectors).
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const roomEnvironment = new RoomEnvironment();
scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;
roomEnvironment.dispose();
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
// Bloom is a wide blur, so it's purely fill-rate bound and survives being
// computed small: it runs at a fraction of the display resolution (see
// bloomResolutionScale) on top of the dual-filter chain's own halvings.
const bloomPass = new KawaseBloomPass(
  new THREE.Vector2(window.innerWidth * CONFIG.bloomResolutionScale, window.innerHeight * CONFIG.bloomResolutionScale),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold,
  CONFIG.bloomLevels
);
composer.addPass(bloomPass);

// re-applies the render resolution everywhere it's cached -- also called from
// the Perf GUI folder when maxPixelRatio / bloomResolutionScale change, so
// those are tunable live rather than only at load
function applyRenderResolution() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  debugCamera.aspect = camera.aspect;
  debugCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  // KawaseBloomPass owns its own resolution -- setSize resizes the whole mip
  // chain, so unlike UnrealBloomPass there's no separate `resolution` to poke
  bloomPass.setSize(
    Math.max(1, Math.round(window.innerWidth * CONFIG.bloomResolutionScale)),
    Math.max(1, Math.round(window.innerHeight * CONFIG.bloomResolutionScale))
  );
}

window.addEventListener('resize', applyRenderResolution);

// ---------------------------------------------------------------------------
// Free-fly preview camera -- lets the scene be orbited/tumbled by hand while
// the actual timeline `camera` keeps animating untouched underneath, the way
// Theatre's own r3f editor camera works (fly free, watch what the real camera
// sees in a small inset) even though this project is vanilla three.js rather
// than react-three-fiber and so has no access to that Studio extension.
//
// A second, fully independent PerspectiveCamera + OrbitControls rather than
// re-purposing `camera` itself -- the timeline camera's position/rotation are
// overwritten every frame by applyTimeline()/parallax, so orbiting it directly
// would just be fought over and snap back each frame.
// ---------------------------------------------------------------------------
const debugCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
// shards live only on layer 1 (see child.layers.set(1) below) -- without
// enabling it here the glass would simply be invisible from the free camera
debugCamera.layers.enable(1);

const debugControls = new OrbitControls(debugCamera, renderer.domElement);
debugControls.enableDamping = true;
debugControls.enabled = false; // only listens for drag/wheel input while Free Cam is on

// Traces the real camera's frustum in space when flying free, so it's obvious
// where the "real" shot is looking from rather than just trusting the PiP
// inset. Visibility is toggled alongside CONFIG.freeCamera (see applyFreeCameraMode).
const cameraHelper = new THREE.CameraHelper(camera);
cameraHelper.visible = false;
scene.add(cameraHelper);

// picture-in-picture: the real timeline camera's view, rendered small and
// undecorated (no bloom -- it's a monitoring readout, not the shot) into a
// corner of the same canvas after the main pass.
//
// Bottom-left rather than a true corner margin: top-left already carries the
// stats.js FPS panel AND Theatre Studio's own outline tree (both load there by
// default), and top-right/bottom-right sit under the lil-gui panel, which
// runs the full height of most viewports.
const PIP_WIDTH = 280;
const PIP_HEIGHT = 158;
const PIP_LEFT = 16;
const PIP_BOTTOM = 16;

function renderFreeCameraPip() {
  const pixelRatio = renderer.getPixelRatio();
  const x = PIP_LEFT * pixelRatio;
  const y = PIP_BOTTOM * pixelRatio;
  const w = PIP_WIDTH * pixelRatio;
  const h = PIP_HEIGHT * pixelRatio;

  // `camera`'s aspect is set to the FULL CANVAS's aspect ratio (see
  // applyRenderResolution), because that's what it needs for the real shot.
  // Rendering it into a smaller viewport whose aspect ratio differs -- 280x158
  // (~1.77) versus, say, a 1280x800 window (1.6) -- without also matching the
  // projection to that viewport stretches the image to fit, which is the
  // squish reported in the inset. Swapping to the inset's own aspect for just
  // this draw, then restoring it immediately after, keeps the real camera's
  // state exactly as the rest of the frame (main pass, reflection cube, T
  // calculations) expects it.
  const realAspect = camera.aspect;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.setScissorTest(true);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);

  camera.aspect = realAspect;
  camera.updateProjectionMatrix();
  // hand the full canvas back to whatever composer.render() left it as, so the
  // next frame's main pass isn't accidentally clipped to the inset's corner
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
}

// swaps which camera the main render pass (and its bloom/composite) draws
// from, and toggles the frustum helper + PiP inset alongside it
function applyFreeCameraMode() {
  const active = CONFIG.freeCamera;
  composer.passes[0].camera = active ? debugCamera : camera;
  debugControls.enabled = active;
  cameraHelper.visible = active;
  if (active) {
    // snap the free camera to wherever the timeline camera currently is,
    // so enabling Free Cam doesn't jump-cut the view -- it just unlocks it
    debugCamera.position.copy(camera.position);
    debugCamera.quaternion.copy(camera.quaternion);
    debugControls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -10).applyQuaternion(camera.quaternion));
    debugControls.update();
  }
}

// ---------------------------------------------------------------------------
// Star mask texture -- exact path from assets/4-pointed-star/4star_03a.svg,
// baked once into an alpha-only canvas texture. paths-grid samples this to
// draw a filled star; the wall shader below does the inverse, punching a hole
// wherever this mask is opaque.
// ---------------------------------------------------------------------------
const STAR_PATH =
  'M419.296 6.436c2.323 -8.108 15.086 -8.108 17.409 0c18.242 63.679 64.812 204.816 136.428 276.432c71.616 71.616 212.753 118.186 276.432 136.428c8.108 2.323 8.108 15.086 0 17.409c-63.679 18.242 -204.816 64.812 -276.432 136.428c-71.616 71.616 -118.186 212.753 -136.428 276.432c-2.323 8.108 -15.086 8.108 -17.409 0c-18.242 -63.679 -64.812 -204.816 -136.428 -276.432c-71.616 -71.616 -212.753 -118.186 -276.432 -136.428c-8.108 -2.323 -8.108 -15.086 0 -17.409c63.679 -18.242 204.816 -64.812 276.432 -136.428c71.616 -71.616 118.186 -212.753 136.428 -276.432Z';
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

// Drives the drifting Lissajous hotspots into slots [0, driftCount) every
// frame -- called from the animation loop with the clock's elapsed time.
// `driftCount` (rather than reading CONFIG.glowCenterCount directly) lets the
// caller reserve a trailing slot for the mouse hotspot when glowFollowMouse is
// on, so the two sources run at once instead of the mouse replacing the drift.
// Does not touch uNumCenters -- the caller owns that, since it also accounts
// for whether the mouse slot is actually active this frame.
function updateGlowCenters(time, driftCount) {
  const centers = gridUniforms.uGlowCenters.value;
  const t = time * CONFIG.glowSpeed;
  for (let i = 0; i < MAX_GLOW_CENTERS; i++) {
    if (i < driftCount) {
      const x = Math.sin(t * GLOW_FREQ_X[i] + GLOW_PHASE[i]) * CONFIG.glowOrbitRadiusX;
      const y = Math.sin(t * GLOW_FREQ_Y[i] + GLOW_PHASE[i] * 1.7) * CONFIG.glowOrbitRadiusY;
      centers[i].set(x, y);
    } else {
      centers[i].set(1e5, 1e5);
    }
  }
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
  // The window cutout itself is a `discard` in the fragment shader below --
  // matching the grid lines/nodes materials further down, which have always
  // cut their own copies of these same holes this way. The wall used to punch
  // its hole via alphaToCoverage instead (mask alpha as MSAA sample coverage,
  // antialiasing the edge for free), but that only works when the surface
  // actually lands on a multisampled target -- true for the main render
  // (the composer's target is explicitly built with samples:4), but NOT for
  // the free-cam PiP or for the main pass itself once bloom is disabled: both
  // render straight to the canvas context, which runs `antialias:false` (the
  // composer target is where MSAA lives; a second multisampled canvas would
  // just be redundant cost). Off that path, alphaToCoverage silently did
  // nothing and the "hole" rendered as solid wall. `discard` has no such
  // dependency -- it drops the fragment (color and depth both) on any target,
  // multisampled or not, so the cutout now works identically everywhere.
  transparent: false,
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
      if (hole > 0.5) discard;
      g = clamp(g, 0.0, 1.0);
      vec3 color = mix(uWallColor, uGlowColor, g * uIntensity * uWallGlowIntensity);
      // uOpacity is the pass-through dissolve (see setWallFading) -- unrelated
      // to the window cutout above, which is unconditional regardless of it
      gl_FragColor = vec4(color, uOpacity);
      // Every material here is a raw ShaderMaterial, so none of them get the
      // sRGB output encode three's built-in materials bake into their own
      // shader templates automatically. That's invisible while bloom is on,
      // because KawaseBloomPass's composite (which DOES encode) ends up as the
      // last pass rendering to the canvas -- this material only ever renders
      // into its linear intermediate target, where encoding would be wrong.
      // Disable bloom, though, and EffectComposer promotes RenderPass itself
      // to render straight to the canvas (see EffectComposer.isLastEnabledPass) --
      // at that point this shader's un-encoded linear output IS the final
      // pixel, and a colour authored as sRGB #0a0f2c but never re-encoded reads
      // roughly half as bright as intended. Three recompiles this shader
      // per render target automatically (WebGLPrograms keys on the target's
      // expected colour space), so include is a no-op into the linear
      // composer target and a real encode straight to the canvas -- both
      // paths handled by the one line, no bloom-state branching needed.
      #include <colorspace_fragment>
    }
  `,
});

const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), wallMaterial);
wallMesh.position.z = CONFIG.wallZ;
// no renderOrder: as an opaque mesh it sorts front-to-back naturally, which
// draws it before the space scene and lets its depth reject those far wisps
// everywhere except inside the window cutouts
scene.add(wallMesh);

// The pass-through fade is the one moment the wall needs genuine alpha
// blending, to dissolve the remaining (non-cutout) surface smoothly rather
// than the hard on/off a discard would give it. It leaves the opaque queue
// only for that stretch, by which point the glass has already shattered and
// no longer needs it in the backdrop.
function setWallFading(fading) {
  if (wallMaterial.transparent === fading) return;
  wallMaterial.transparent = fading;
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

// the grid rides just in front of the wall so it reads as etched into its
// surface -- an offset rather than an absolute z, so it follows the Wall Z
// slider (see applyWallZ) instead of detaching when the wall moves
const GRID_Z_OFFSET = 0.01;

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
        // see the wall material's identical include, a few hundred lines up --
        // same raw-ShaderMaterial-missing-its-output-encode fix
        #include <colorspace_fragment>
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
  gridLineMesh.position.z = CONFIG.wallZ + GRID_Z_OFFSET;
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
        // see the wall material's identical include, a few hundred lines up --
        // same raw-ShaderMaterial-missing-its-output-encode fix
        #include <colorspace_fragment>
      }
    `,
    // opaque for the same reason as the grid lines above -- this also fixes
    // depthTest:false previously making the node rings draw on top of
    // literally everything (including glass shards flying in front of them)
    // regardless of actual depth
    side: THREE.DoubleSide,
  });

  gridNodeMesh = new THREE.InstancedMesh(geometry, material, gridGraph.points.length);
  gridNodeMesh.position.z = CONFIG.wallZ + GRID_Z_OFFSET;
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
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
  });

  gridNodeFillMesh = new THREE.InstancedMesh(fillGeometry, fillMaterial, gridGraph.points.length);
  gridNodeFillMesh.position.z = CONFIG.wallZ + GRID_Z_OFFSET;
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
      #include <colorspace_fragment>
    }
  `,
});

const MAX_WISPS = 24;
const wispPlaneGeo = new THREE.PlaneGeometry(1, 1);
// Grown on demand rather than pre-filled to MAX_WISPS: the pool used to park
// 24 permanently-invisible meshes in the scene, all of which still had to be
// walked (and matrix-updated) on every one of the 7 scene traversals per
// frame. The GUI slider can still take it up to MAX_WISPS -- it just allocates
// when asked instead of up front.
const wisps = [];
function ensureWispPool(n) {
  while (wisps.length < n) {
    const mesh = new THREE.Mesh(wispPlaneGeo, wispMaterial);
    mesh.visible = false;
    scene.add(mesh);
    wisps.push(mesh);
  }
}

// Reference depth for the perspective compensation below -- roughly where the
// camera sits while the wall/windows are actually being looked at during the
// shatter (now an authored cameraOffsetZ keyframe rather than a fixed
// procedural stop, so this can't read the real value off CONFIG anymore --
// same numeric depth as before, just no longer derived). Wisps are seeded
// once, independent of the live scroll-driven camera, so this has to be a
// fixed stand-in rather than the camera's current position.
const WISP_REF_CAM_Z = 9;

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

  ensureWispPool(CONFIG.wispCount);

  for (let i = 0; i < wisps.length; i++) {
    const wisp = wisps[i];
    if (!CONFIG.showAuras || i >= CONFIG.wispCount) {
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
// 64 rather than 256: these 6 face renders happen every single frame (see the
// reflectionCamera.update() call in animate(), which must not be throttled),
// so resolution is the main lever on their cost. three PMREM-prefilters this
// into a roughness-blurred envMap before the shards ever sample it, and the
// shards are small and rough, so the fine detail is blurred away regardless.
const reflectionTarget = new THREE.WebGLCubeRenderTarget(64, {
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
});
const reflectionCamera = new THREE.CubeCamera(0.1, 100, reflectionTarget);
reflectionCamera.position.set(0, 0, GLASS_Z);
// The CubeCamera only exists to render *from* -- it has no visual
// representation, so keeping it out of the scene graph saves 7 objects (itself
// plus its 6 face cameras) from every traversal. Its world matrix is static,
// so one manual update is all it ever needs.
reflectionCamera.updateMatrixWorld();

// populated from the glb's own material once it loads (KHR_materials_transmission
// / _volume / _clearcoat authored in Blender) -- see the GLTFLoader callback below
let glassMaterial = null;

// --- the shard material options, all single shared instances -----------------
// Swapping between them is a pointer assignment per mesh, with no recompile
// beyond the first switch to each. They cost wildly different amounts, so the
// dropdown doubles as the scene's biggest perf lever: transmission (the two
// glass options) is by far the most expensive thing here, since every shard
// samples a full-scene backdrop render target.

// The albedo is far darker than the grey it actually renders as: coreLight is a
// 30-intensity point light sitting *inside* the shard cluster, so with inverse
// -square decay the irradiance here is enormous and a mid-grey albedo tone-maps
// to blown-out white. flatShading counteracts the computeVertexNormals() call
// on load, which is there to sell the glass but would otherwise smear the grey
// shards into one indistinct blob.
const solidGlassMaterial = new THREE.MeshStandardMaterial({
  color: 0x24272c,
  roughness: 0.9,
  metalness: 0,
  flatShading: true,
});

// A stock three.js glass, built from MeshPhysicalMaterial defaults rather than
// the glb's authored values -- useful as a neutral reference for what the
// Blender-authored material is actually doing differently.
const threeGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.05,
  transmission: 1,
  thickness: 0.5,
  ior: 1.5,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
});

// Matcap of a shiny glass sphere, generated rather than loaded so the scene
// stays dependency-free. A matcap bakes the entire lighting response into a
// lookup keyed by view-space normal, so it costs one texture fetch and no
// lighting maths at all -- by far the cheapest of the four, and it keeps a
// convincing glassy read because the rim and specular are painted in.
function makeGlassMatcapTexture() {
  // TODO import a matcamp PNG + try various sizes, 256, 128, 64 
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;

  // corners are outside the sampled disc, but fill them so bilinear filtering
  // at the silhouette doesn't drag in stray pixels
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, size, size);

  // the disc becomes the current path and stays it, so every gradient below is
  // clipped to the sphere without needing a separate clip()
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.closePath();

  // body: cool and dark where it faces the camera, brightening toward the
  // lower right where the environment bounces back into view
  const body = ctx.createLinearGradient(0, 0, size, size);
  body.addColorStop(0, '#1b2434');
  body.addColorStop(0.55, '#2c3a52');
  body.addColorStop(1, '#7f9dc4');
  ctx.fillStyle = body;
  ctx.fill();

  // fresnel rim hugging the silhouette -- this is what actually reads as glass
  // rather than plastic
  const rim = ctx.createRadialGradient(r, r, r * 0.7, r, r, r);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.8, 'rgba(190,220,255,0.5)');
  rim.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = rim;
  ctx.fill();

  // key specular, upper left
  const key = ctx.createRadialGradient(r * 0.62, r * 0.5, 0, r * 0.62, r * 0.5, r * 0.6);
  key.addColorStop(0, 'rgba(255,255,255,1)');
  key.addColorStop(0.22, 'rgba(255,255,255,0.7)');
  key.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = key;
  ctx.fill();

  // small warm counter-glint, lower right, so the sphere doesn't read as lit
  // by a single lamp
  const glint = ctx.createRadialGradient(r * 1.38, r * 1.44, 0, r * 1.38, r * 1.44, r * 0.36);
  glint.addColorStop(0, 'rgba(255,214,170,0.85)');
  glint.addColorStop(1, 'rgba(255,214,170,0)');
  ctx.fillStyle = glint;
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  // colour data, not a data map -- without this it renders washed out
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const matcapGlassMaterial = new THREE.MeshMatcapMaterial({ matcap: makeGlassMatcapTexture() });

// The see-through sibling of the matcap above. Painted for a CLEAR pane rather
// than a shiny solid: a real sheet of glass reflects almost nothing head-on, so
// the middle of the disc is near-black (and, via the alpha patch below, barely
// there at all) while everything interesting happens at grazing angles.
function makeClearGlassMatcapTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.closePath();

  // body: almost nothing facing the camera, picking up a cool cast only as it
  // turns away
  const body = ctx.createRadialGradient(r, r, 0, r, r, r);
  body.addColorStop(0, '#04070d');
  body.addColorStop(0.6, '#0d1a2b');
  body.addColorStop(1, '#3c6289');
  ctx.fillStyle = body;
  ctx.fill();

  // Fresnel rim -- tighter and brighter than the opaque matcap's, because with
  // a clear body this edge is essentially the whole read
  const rim = ctx.createRadialGradient(r, r, r * 0.78, r, r, r);
  rim.addColorStop(0, 'rgba(150,200,255,0)');
  rim.addColorStop(0.65, 'rgba(190,225,255,0.6)');
  rim.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = rim;
  ctx.fill();

  // two tight glints rather than one broad highlight: small hard speculars are
  // what sell a polished, hard surface
  const key = ctx.createRadialGradient(r * 0.66, r * 0.5, 0, r * 0.66, r * 0.5, r * 0.3);
  key.addColorStop(0, 'rgba(255,255,255,1)');
  key.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  key.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = key;
  ctx.fill();

  const glint = ctx.createRadialGradient(r * 1.3, r * 1.36, 0, r * 1.3, r * 1.36, r * 0.22);
  glint.addColorStop(0, 'rgba(214,236,255,0.9)');
  glint.addColorStop(1, 'rgba(214,236,255,0)');
  ctx.fillStyle = glint;
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// How clear the pane is where it faces the camera, and how sharply it ramps to
// solid at the silhouette. Baked into the shader rather than exposed as
// uniforms -- these are the material's identity, not a per-scene tuning knob.
const CLEAR_GLASS_CENTER_ALPHA = 0.07;
const CLEAR_GLASS_RIM_POWER = 2.2;

// A matcap is opaque by construction: it looks up a baked lighting response by
// view-space normal and has no notion of what lies behind the surface. This
// patches in the missing half -- a Fresnel-driven alpha, nearly clear head-on
// and solid at grazing angles, which is both how real glass behaves and what
// stops the shards reading as shiny opaque pebbles.
//
// `uv` is three's own matcap lookup coordinate, a point on the unit disc of
// radius 0.495; its distance from the centre IS the grazing-angle term, so the
// Fresnel falls out of the existing maths for free.
function addMatcapGlassAlpha(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassRim = clamp(length(uv - 0.5) / 0.495, 0.0, 1.0);
       diffuseColor.a *= mix(${CLEAR_GLASS_CENTER_ALPHA.toFixed(3)}, 1.0, pow(glassRim, ${CLEAR_GLASS_RIM_POWER.toFixed(2)}));
       #include <opaque_fragment>`
    );
  };
  material.needsUpdate = true;
}

const clearMatcapGlassMaterial = new THREE.MeshMatcapMaterial({
  matcap: makeClearGlassMatcapTexture(),
  transparent: true,
  // shards overlap heavily in the shatter; without this the nearest one would
  // occlude the rest and the cluster would lose all its depth
  depthWrite: false,
});
addMatcapGlassAlpha(clearMatcapGlassMaterial);

function matcapTextureLabel(filename) {
  return `${filename.replace(/\.(jpg|jpeg|png)$/i, '').replace(/[-_]/g, ' ')} (matcap)`;
}

function makeImportedMatcapGlassMaterial(url) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshMatcapMaterial({
    matcap: tex,
    transparent: true,
    depthWrite: false,
  });
  addMatcapGlassAlpha(mat);
  return mat;
}

// Every image in src/textures/ becomes a see-through matcap glass option.
const MATCAP_TEXTURE_URLS = import.meta.glob('./textures/*.{jpg,png,JPG,PNG}', {
  eager: true,
  import: 'default',
});
const importedMatcapGlassMaterials = {};
const importedMatcapGlassModes = {};
for (const [path, url] of Object.entries(MATCAP_TEXTURE_URLS)) {
  const filename = path.split('/').pop();
  const mode = `matcap:${filename}`;
  importedMatcapGlassMaterials[mode] = makeImportedMatcapGlassMaterial(url);
  importedMatcapGlassModes[matcapTextureLabel(filename)] = mode;
}

// Persistent, shared across every loaded model -- loadModel() must not dispose
// these when swapping glbs (the authored material is per-glb and IS disposed).
const SHARED_GLASS_MATERIALS = new Set([
  solidGlassMaterial,
  threeGlassMaterial,
  matcapGlassMaterial,
  clearMatcapGlassMaterial,
  ...Object.values(importedMatcapGlassMaterials),
]);

// label -> CONFIG.glassMaterialMode value, for the GUI dropdown
const GLASS_MATERIAL_MODES = {
  'PBR Glass (from GLB)': 'authored',
  'Three.js Glass': 'physical',
  'Solid Grey': 'grey',
  'Shiny Matcap': 'matcap',
  'Shiny Glass Matcap': 'glassmatcap',
  ...importedMatcapGlassModes,
};

function activeGlassMaterial() {
  const imported = importedMatcapGlassMaterials[CONFIG.glassMaterialMode];
  if (imported) return imported;
  switch (CONFIG.glassMaterialMode) {
    case 'physical':
      return threeGlassMaterial;
    case 'grey':
      return solidGlassMaterial;
    case 'matcap':
      return matcapGlassMaterial;
    case 'glassmatcap':
      return clearMatcapGlassMaterial;
    default:
      // null until the glb finishes loading; applyGlassMaterial() no-ops then
      // and loadModel() re-applies once it has one
      return glassMaterial;
  }
}

function applyGlassMaterial() {
  const target = activeGlassMaterial();
  if (!target) return;
  modelGroup.traverse((child) => {
    if (child.isMesh) child.material = target;
  });
  syncGlassControllers();
}

// assigned once the GUI exists; syncGlassControllers no-ops before then, which
// matters because the initial loadModel() can in principle resolve first
let glassFolderRef = null;

// Mirrors the ACTIVE material's real values back into CONFIG so the sliders
// show what is actually on the shards rather than stale defaults. Guarded
// per-property because the four options genuinely differ: the grey and matcap
// materials have no transmission or attenuation at all, and not every glb in
// the model dropdown authors a full MeshPhysicalMaterial (the jagged-edge
// variants ship without KHR_materials_transmission/_volume, so those fields
// come back undefined rather than a number/Color).
function syncGlassControllers() {
  const m = activeGlassMaterial();
  if (!m) return;
  if (m.transmission !== undefined) CONFIG.transmission = m.transmission;
  if (m.roughness !== undefined) CONFIG.roughness = m.roughness;
  if (m.thickness !== undefined) CONFIG.thickness = m.thickness;
  if (m.ior !== undefined) CONFIG.ior = m.ior;
  if (m.envMapIntensity !== undefined) CONFIG.envMapIntensity = m.envMapIntensity;
  if (m.clearcoat !== undefined) CONFIG.clearcoat = m.clearcoat;
  if (m.clearcoatRoughness !== undefined) CONFIG.clearcoatRoughness = m.clearcoatRoughness;
  if (m.attenuationColor) CONFIG.attenuationColor = `#${m.attenuationColor.getHexString()}`;
  // MeshPhysicalMaterial defaults attenuationDistance to Infinity ("no
  // absorption"), which is off the end of the slider and displays as the
  // literal text Infinity -- leave the control where it was in that case
  if (Number.isFinite(m.attenuationDistance)) CONFIG.attenuationDistance = m.attenuationDistance;
  glassFolderRef?.controllers.forEach((c) => c.updateDisplay());
}

// Writes a slider's value onto whichever material is active, skipping
// properties that material doesn't have -- so the transmission/IOR sliders
// simply do nothing while Solid Grey or Shiny Matcap is selected instead of
// silently editing a material you can't see.
function setGlassProp(key, value) {
  const m = activeGlassMaterial();
  if (!m || !(key in m)) return;
  if (m[key] && m[key].isColor) m[key].set(value);
  else m[key] = value;
}

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

// The rim patch keys off geometryNormal / geometryViewDir / <opaque_fragment>,
// which only exist in the lit (physical/standard) shader -- so it goes on the
// stock glass but never on the matcap, whose shader has none of them.
addFresnelRim(threeGlassMaterial);

// Feeds the stock glass the same live cube reflection the authored one gets,
// so switching between them compares materials rather than lighting setups.
threeGlassMaterial.envMap = reflectionTarget.texture;
threeGlassMaterial.envMapIntensity = CONFIG.envMapIntensity;

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
const gltfLoader = new GLTFLoader();

// The scale that lands THIS glb's own tip-to-tip span on the center window
// (computed fresh per model, since each glb's authored size differs) --
// CONFIG.glbScale multiplies on top of it. Recorded so the GUI slider can
// rescale the already-loaded model live without needing a full reload.
let modelAutoFitScale = 1;
function applyGlbScale() {
  const loaded = modelGroup.children[0];
  if (loaded) loaded.scale.setScalar(modelAutoFitScale * CONFIG.glbScale);
}

// disposes the previously loaded glb (if any) and loads `filename` from
// assets/star-shatter/ in its place -- shared by the initial load below and
// the GUI's model-switching dropdown
function loadModel(filename) {
  while (modelGroup.children.length) {
    const child = modelGroup.children[0];
    modelGroup.remove(child);
    child.traverse((node) => {
      if (node.isMesh) {
        node.geometry.dispose();
        // the grey/stock-glass/matcap materials are shared across every model
        // and outlive them -- disposing one here would blank that option for
        // good the first time the model dropdown is used while it's selected
        if (!SHARED_GLASS_MATERIALS.has(node.material)) node.material.dispose();
      }
    });
  }
  mixer = null;
  action = null;
  glassMaterial = null;

  gltfLoader.load(
    `${STAR_SHATTER_BASE_URL}/${encodeURI(filename)}`,
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
        glassMaterial.envMap = CONFIG.showReflection ? reflectionTarget.texture : null;
        glassMaterial.envMapIntensity = CONFIG.envMapIntensity;
        addFresnelRim(glassMaterial);
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
      modelAutoFitScale = CONFIG.starSize / tipToTip;
      gltf.scene.scale.setScalar(modelAutoFitScale * CONFIG.glbScale);

      modelGroup.add(gltf.scene);
      // the shards arrive wearing the glb's own material, so re-assert whatever
      // the dropdown is actually set to, and refresh the sliders from it
      applyGlassMaterial();

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
    (err) => console.error(`Failed to load star-shatter glb "${filename}"`, err)
  );
}

loadModel(CONFIG.glbModel);

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

// A Webflow <script type="module"> that just `import`s the built bundle (as
// opposed to this repo's own index.html/GUI) has no other hook into the
// module to flip this before the scene starts driving itself off page scroll
// -- hence the query-param fallback below, checked once at load.
if (SCROLL_SOURCES.includes(new URLSearchParams(window.location.search).get('scrollSource'))) {
  CONFIG.scrollSource = new URLSearchParams(window.location.search).get('scrollSource');
}

// set once the GUI folder below is built, so setScrollSource can keep its
// dropdown in sync with a source switched programmatically
let scrollSourceController = null;

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

// Lets a plain `import 'https://.../index-*.js'` embed (no access to this
// module's internals, and loaded before the GUI/gui folder even exist) switch
// off page-scroll driving and hand T entirely to its own Lenis bridge. Safe to
// call before or after the GUI is built.
window.setScrollSource = function setScrollSource(source) {
  if (!SCROLL_SOURCES.includes(source)) {
    console.warn(`setScrollSource: "${source}" must be one of ${SCROLL_SOURCES.join(', ')}`);
    return;
  }
  CONFIG.scrollSource = source;
  syncScrollListener();
  scrollSourceController?.updateDisplay();
};

// Same host-page contract as setScrollSource: a plain Webflow <script> can hide
// (or restore) Theatre Studio without importing this module. Safe to call before
// Studio finishes loading -- the mode is remembered and applied on initialize.
const THEATRE_UI_MODES = ['hidden', 'visible'];
let theatreStudio = null;
let theatreUiMode = 'visible';

function applyTheatreUi() {
  if (!theatreStudio) return;
  if (theatreUiMode === 'hidden') theatreStudio.ui.hide();
  else theatreStudio.ui.restore();
}

window.setTheatreJSUI = function setTheatreJSUI(mode) {
  if (!THEATRE_UI_MODES.includes(mode)) {
    console.warn(`setTheatreJSUI: "${mode}" must be one of ${THEATRE_UI_MODES.join(', ')}`);
    return;
  }
  theatreUiMode = mode;
  applyTheatreUi();
};

// Same host-page contract for lil-gui: hide/show the debug panel from a plain
// Webflow <script>. Safe before the GUI is constructed -- mode is remembered
// and applied when `new GUI(...)` runs.
const LIL_GUI_UI_MODES = ['hidden', 'visible'];
let lilGui = null;
let lilGuiUiMode = 'visible';

function applyLilGuiUi() {
  if (!lilGui) return;
  if (lilGuiUiMode === 'hidden') lilGui.hide();
  else lilGui.show();
}

window.setLilGUIVisibility = function setLilGUIVisibility(mode) {
  if (!LIL_GUI_UI_MODES.includes(mode)) {
    console.warn(`setLilGUIVisibility: "${mode}" must be one of ${LIL_GUI_UI_MODES.join(', ')}`);
    return;
  }
  lilGuiUiMode = mode;
  applyLilGuiUi();
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
    .then(({ default: studio }) => {
      studio.initialize();
      theatreStudio = studio;
      // honor any setTheatreJSUI() call that landed before Studio was ready
      applyTheatreUi();
    })
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
  fov: types.number(50, { range: [25, 100] }),
  // scales the grid's glow hotspots and the wall spill together
  glowIntensity: types.number(CONFIG.gridIntensity, { range: [0, 4], nudgeMultiplier: 0.01 }),
  glowColor: types.rgba({ r: 0.353, g: 0, b: 0.639, a: 1 }), // #5a00a3
  // 0..1 multiplier on the alarm beacon's pulse, for keyframing the alarm in
  // partway through the scroll rather than having it blink from the start
  alarmLevel: types.number(0, { range: [0, 1], nudgeMultiplier: 0.01 }),
  bloomStrength: types.number(CONFIG.bloomStrength, { range: [0, 3], nudgeMultiplier: 0.01 }),
  // Keyframable camera position, added on top of the GUI's own
  // cameraOffsetX/Y/Z (see the animate() loop) rather than replacing it, so a
  // shot can be composed with a manual GUI offset AND a Theatre-authored move
  // together. cameraOffsetZ is THE camera's whole scroll-driven journey now --
  // what used to be a procedural zoom-in/shatter-creep/pass-through-the-wall
  // formula (t -> z) is authored here instead: open Studio (⌥/Alt+\), select
  // Scene, and keyframe cameraOffsetZ across the sequence. Range spans roughly
  // the old dolly's full travel (start 15 down to end -42, relative to
  // cameraStartZ) with room either side for overshoot.
  cameraOffsetX: types.number(0, { range: [-10, 10], nudgeMultiplier: 0.01 }),
  cameraOffsetY: types.number(0, { range: [-10, 10], nudgeMultiplier: 0.01 }),
  cameraOffsetZ: types.number(0, { range: [-70, 30], nudgeMultiplier: 0.05 }),
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
  // procedural phases below always describe the same instant -- except while
  // CONFIG.syncTheatreToScroll is off. With it on (the default, and what a
  // deployed/scroll-driven page always wants), this runs every single frame,
  // which fights any manual scrub of Theatre's OWN playhead: Studio's
  // next/previous-keyframe nav (and dragging the playhead directly) moves
  // sequence.position for an instant, then the very next animate() frame
  // snaps it straight back to match scroll T. Turning sync off while
  // authoring leaves Theatre's playhead alone so those controls -- and
  // keyframing itself -- actually work; turn it back on to resume scrubbing
  // the sequence by scrolling the page.
  if (CONFIG.syncTheatreToScroll) sceneSheet.sequence.position = t * SEQUENCE_LENGTH;

  const shatterT = easeInOutCubic(
    THREE.MathUtils.clamp((t - CONFIG.shatterStart) / (CONFIG.shatterEnd - CONFIG.shatterStart), 0, 1)
  );
  // The camera's own scroll-driven journey (zoom into the window, creep
  // through the shatter, fly through the wall) no longer lives here as a
  // procedural formula -- it's authored as Theatre keyframes on
  // cameraOffsetZ instead (see sceneTrack above and the animate() loop, which
  // is where cameraOffsetZ actually gets applied to camera.position.z).
  // `passT` survives purely as the wall's own fade-out timing below, which
  // needs a phase fraction regardless of what's driving the camera.
  const passT = easeInOutCubic(THREE.MathUtils.clamp((t - CONFIG.passStart) / (1 - CONFIG.passStart), 0, 1));

  setShatterProgress(shatterT);

  // The glass is fit to starSize in world units, which matches the cutout
  // exactly -- but it's parked GLASS_Z in front of the wall, so perspective
  // projects it larger than the hole it's meant to fill, growing as the
  // camera dollies closer. Scaling by the ratio of the two depths cancels
  // that, so the intact star registers with the SVG cutout at every camera
  // distance instead of drifting bigger as the dolly closes in.
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
  // the timeline's own fade-out ANDed with the Layers & Effects switches, so a
  // manual toggle can't be undone by the next frame's timeline update
  wallMesh.visible = CONFIG.showWall && passT < 0.995;
  // the grid needs no timeline gating of its own -- it sits on the wall plane,
  // so the fly-through leaves it behind the camera and frustum culling drops it
  if (gridLineMesh) gridLineMesh.visible = CONFIG.showGridLines;
  if (gridNodeMesh) gridNodeMesh.visible = CONFIG.showGridNodes;
  if (gridNodeFillMesh) gridNodeFillMesh.visible = CONFIG.showGridNodes;
  modelGroup.visible = CONFIG.showGlass;
  setWallFading(passT > 0.001);
}

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
// kept in sync with CONFIG.wallZ by applyWallZ() so the Mouse Hover Glow
// raycast still lands on the wall after it's been moved
const wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -CONFIG.wallZ);
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
const stats = new Stats();
stats.showPanel(0); // 0: fps -- click the panel to cycle to ms/mb
// stats.js hardcodes position:fixed;top:0;left:0 in its own constructor --
// overridden here (after construction, so this wins) to shift it clear of the
// Theatre Studio outline panel that occupies the top-left corner
stats.dom.style.cssText = 'position:fixed;top:0;left:80px;cursor:pointer;opacity:0.9;z-index:10000;';
document.body.appendChild(stats.dom);

const gui = new GUI({ title: 'Timeline 03 Controls' });
lilGui = gui;
// honor any setLilGUIVisibility() call that landed before the GUI existed
applyLilGuiUi();

const tips = { theatreTip: '⌥/Alt + \\ toggles Theatre UI (?minify omits it)' };
gui.add(tips, 'theatreTip').name('Tip').disable();

const timelineFolder = gui.addFolder('Timeline');
scrollSourceController = timelineFolder
  .add(CONFIG, 'scrollSource', SCROLL_SOURCES)
  .name('Scroll Source')
  .onChange(syncScrollListener);
// off while authoring in Studio -- otherwise every animate() frame snaps
// Theatre's playhead back to scroll T, so keyframe-nav and manual scrubbing
// in the Sequence panel never actually go anywhere
timelineFolder.add(CONFIG, 'syncTheatreToScroll').name('Sync Theatre to Scroll');
// live scrub, so the whole sequence can be inspected without scrolling -- and a
// direct demo of the same entry point the Webflow/Lenis host page calls
timelineFolder
  .add(CONFIG, 'progress', 0, 1, 0.001)
  .name('Seek T (manual)')
  .onChange((v) => window.setTimelineTo(v));
timelineFolder.add(CONFIG, 'shatterStart', 0.1, 0.8, 0.01).name('Shatter Starts');
timelineFolder.add(CONFIG, 'shatterEnd', 0.2, 0.9, 0.01).name('Shatter Ends');
timelineFolder.add(CONFIG, 'passStart', 0.3, 0.95, 0.01).name('Pass Starts');
timelineFolder.add(CONFIG, 'clipStart', 0, 1, 0.01).name('Clip Start %');
timelineFolder.add(CONFIG, 'clipEnd', 0, 1, 0.01).name('Clip End %');
timelineFolder.add(CONFIG, 'autoRotateSpeed', 0, 1, 0.01).name('Auto Rotate');
timelineFolder.add(CONFIG, 'glbModel', GLB_OPTIONS).name('Shatter GLB').onChange(loadModel);
timelineFolder.add(CONFIG, 'glbScale', 0.5, 2, 0.001).name('GLB Scale').onChange(applyGlbScale);

const cameraFolder = gui.addFolder('Camera');
// Flies free of the timeline camera to inspect/compose the scene from any
// angle, with a picture-in-picture inset (top-left of the canvas) showing what
// the real, animating camera currently sees -- see debugCamera/renderFreeCameraPip.
cameraFolder.add(CONFIG, 'freeCamera').name('Free Cam (Preview)').onChange(applyFreeCameraMode);
// Constant nudge added on top of the procedural dolly/parallax -- the
// matching cameraOffsetX/Y/Z track in Theatre (keyframable in Studio, ⌥/Alt+\)
// adds on top of these rather than overriding them.
cameraFolder.add(CONFIG, 'cameraOffsetX', -10, 10, 0.01).name('Offset X');
cameraFolder.add(CONFIG, 'cameraOffsetY', -10, 10, 0.01).name('Offset Y');
cameraFolder.add(CONFIG, 'cameraOffsetZ', -20, 20, 0.01).name('Offset Z');

// moves the wall and its etched grid together, and re-seats the raycast plane
// the Mouse Hover Glow uses
function applyWallZ() {
  wallMesh.position.z = CONFIG.wallZ;
  const gridZ = CONFIG.wallZ + GRID_Z_OFFSET;
  if (gridLineMesh) gridLineMesh.position.z = gridZ;
  if (gridNodeMesh) gridNodeMesh.position.z = gridZ;
  if (gridNodeFillMesh) gridNodeFillMesh.position.z = gridZ;
  // Plane(normal (0,0,1), constant) satisfies dot(n, p) + c = 0, so a plane
  // sitting at z = wallZ has constant -wallZ
  wallPlane.constant = -CONFIG.wallZ;
}

const wallFolder = gui.addFolder('Wall & Windows');
wallFolder.addColor(CONFIG, 'wallColor').name('Wall Color').onChange((v) => wallUniforms.uWallColor.value.set(v));
wallFolder.add(CONFIG, 'wallZ', SPACE_NEAR_Z, GLASS_Z + 4, 0.1).name('Wall Z').onChange(applyWallZ);
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

gridFolder.add(CONFIG, 'glowFollowMouse').name('Mouse Hover Glow (+1 center)');
// uNumCenters is now recomputed every frame in animate() -- it depends on
// glowFollowMouse and whether the cursor is currently over the wall, not just
// on this count -- so there's no separate onChange to keep in sync here.
gridFolder.add(CONFIG, 'glowCenterCount', 1, MAX_GLOW_CENTERS, 1).name('Drifting Centers');
gridFolder.add(CONFIG, 'glowSpeed', 0, 2, 0.01).name('Glow Speed');
gridFolder.add(CONFIG, 'glowOrbitRadiusX', 0, 12, 0.1).name('Orbit Radius X');
gridFolder.add(CONFIG, 'glowOrbitRadiusY', 0, 12, 0.1).name('Orbit Radius Y');
gridFolder
  .add(CONFIG, 'wallGlowIntensity', 0, 1, 0.01)
  .name('Wall Spill')
  .onChange((v) => (wallUniforms.uWallGlowIntensity.value = v));

const glassFolder = gui.addFolder('Glass Material');
glassFolderRef = glassFolder;
// Which material the shards wear. Also the scene's biggest perf control: the
// two transmissive options each make every shard sample a full-scene backdrop,
// while the matcap is a single texture fetch with no lighting maths at all.
glassFolder
  .add(CONFIG, 'glassMaterialMode', GLASS_MATERIAL_MODES)
  .name('Material')
  .onChange(applyGlassMaterial);
// The sliders below drive whichever material is selected (see setGlassProp),
// and no-op for properties it doesn't have -- so they go inert on Solid Grey
// and Shiny Matcap rather than editing something off-screen.
glassFolder
  .add(CONFIG, 'transmission', 0, 1, 0.01)
  .name('Transmission')
  .onChange((v) => setGlassProp('transmission', v));
glassFolder
  .add(CONFIG, 'roughness', 0, 0.5, 0.005)
  .name('Roughness')
  .onChange((v) => setGlassProp('roughness', v));
glassFolder
  .add(CONFIG, 'thickness', 0, 2, 0.01)
  .name('Thickness')
  .onChange((v) => setGlassProp('thickness', v));
glassFolder
  .add(CONFIG, 'ior', 1, 2.33, 0.01)
  .name('IOR')
  .onChange((v) => setGlassProp('ior', v));
glassFolder
  .add(CONFIG, 'envMapIntensity', 0, 6, 0.05)
  .name('Env Intensity')
  .onChange((v) => setGlassProp('envMapIntensity', v));
glassFolder
  .add(CONFIG, 'clearcoat', 0, 1, 0.01)
  .name('Clearcoat')
  .onChange((v) => setGlassProp('clearcoat', v));
glassFolder
  .add(CONFIG, 'clearcoatRoughness', 0, 0.5, 0.005)
  .name('Clearcoat Roughness')
  .onChange((v) => setGlassProp('clearcoatRoughness', v));
glassFolder
  .addColor(CONFIG, 'attenuationColor')
  .name('Tint Color')
  .onChange((v) => setGlassProp('attenuationColor', v));
glassFolder
  .add(CONFIG, 'attenuationDistance', 0.5, 30, 0.5)
  .name('Tint Distance')
  .onChange((v) => setGlassProp('attenuationDistance', v));
glassFolder.addColor(CONFIG, 'rimColor').name('Edge Color').onChange((v) => rimUniforms.uRimColor.value.set(v));
glassFolder
  .add(CONFIG, 'rimStrength', 0, 3, 0.05)
  .name('Edge Fresnel')
  .onChange((v) => (rimUniforms.uRimStrength.value = v));
glassFolder
  .add(CONFIG, 'rimPower', 0.5, 8, 0.1)
  .name('Edge Falloff')
  .onChange((v) => (rimUniforms.uRimPower.value = v));

// on/off switches for this folder's layers live in "Layers & Effects" below,
// so each property has exactly one controller and they can't drift out of sync
const spaceFolder = gui.addFolder('Space Scene');
spaceFolder.add(CONFIG, 'bgStarCount', 0, MAX_BG_STARS, 1).name('Star Count').onFinishChange(seedBgStars);
spaceFolder.add(CONFIG, 'bgStarRadius', 8, 100, 1).name('Star Field Radius').onFinishChange(seedBgStars);
spaceFolder.add(CONFIG, 'wispCount', 0, MAX_WISPS, 1).name('Aura Count').onFinishChange(seedWisps);
spaceFolder
  .add(CONFIG, 'wispOpacity', 0, 1, 0.01)
  .name('Aura Opacity')
  .onChange((v) => (wispUniforms.uOpacity.value = v));
spaceFolder.addColor(CONFIG, 'wispColorA').name('Aura Color A').onChange((v) => wispUniforms.uColorA.value.set(v));
spaceFolder.addColor(CONFIG, 'wispColorB').name('Aura Color B').onChange((v) => wispUniforms.uColorB.value.set(v));

const alarmFolder = gui.addFolder('Alarm Light');
// visibility itself is driven per-frame in animate() (it also depends on
// Theatre's alarmLevel), so this is a plain flag with no side effect here
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
postFolder
  .add(CONFIG, 'bloomLevels', 2, KawaseBloomPass.MAX_LEVELS, 1)
  .name('Bloom Spread')
  .onChange((v) => (bloomPass.levels = v));

const perfFolder = gui.addFolder('Performance');
perfFolder
  .add(CONFIG, 'maxPixelRatio', 0.5, 2, 0.25)
  .name('Max Pixel Ratio')
  .onFinishChange(applyRenderResolution);
perfFolder
  .add(CONFIG, 'bloomResolutionScale', 0.25, 1, 0.05)
  .name('Bloom Resolution')
  .onFinishChange(applyRenderResolution);
perfFolder
  .add(CONFIG, 'transmissionResolutionScale', 0.25, 1, 0.05)
  .name('Transmission Res')
  .onFinishChange((v) => (renderer.transmissionResolutionScale = v));

// ---------------------------------------------------------------------------
// Layers & effects -- one place to switch any single layer or pass off, both
// for isolating a look while tuning and for pricing each one against the
// stats.js readout. Every default matches the scene as authored.
// ---------------------------------------------------------------------------
const layersFolder = gui.addFolder('Layers & Effects');
layersFolder.add(CONFIG, 'showWall').name('Wall');
layersFolder.add(CONFIG, 'showGridLines').name('Grid Lines');
layersFolder.add(CONFIG, 'showGridNodes').name('Grid Nodes');
layersFolder.add(CONFIG, 'glowAnimate').name('Glow Drift');
layersFolder.add(CONFIG, 'showGlass').name('Glass Shards');
// the old "Realistic Glass" switch lives on as the Material dropdown in the
// Glass Material folder, where Solid Grey is one of four options
layersFolder
  .add(CONFIG, 'showReflection')
  .name('Live Reflection')
  .onChange((v) => {
    // both lit glass options carry the cube reflection; the matcap has its
    // environment baked into its texture and the grey stand-in has none
    for (const m of [glassMaterial, threeGlassMaterial]) {
      if (!m) continue;
      m.envMap = v ? reflectionTarget.texture : null;
      m.needsUpdate = true;
    }
  });
layersFolder
  .add(CONFIG, 'fresnelRim')
  .name('Edge Fresnel')
  .onChange((v) => (rimUniforms.uRimStrength.value = v ? CONFIG.rimStrength : 0));
layersFolder.add(CONFIG, 'showAuras').name('Aura Veils').onChange(seedWisps);
layersFolder.add(CONFIG, 'showBackgroundStars').name('Starfield').onChange((v) => (bgStars.visible = v));
layersFolder.add(CONFIG, 'eyeStar').name('Eye Star').onChange((v) => (eyeStar.visible = v));
layersFolder.add(CONFIG, 'alarmEnabled').name('Alarm Beacon');
layersFolder.add(CONFIG, 'enableBloom').name('Bloom Pass').onChange((v) => (bloomPass.enabled = v));
layersFolder.add(CONFIG, 'enableFog').name('Fog').onChange((v) => (scene.fog.density = v ? FOG_DENSITY : 0));
layersFolder.add(CONFIG, 'enableParallax').name('Mouse Parallax');

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
// advances only while glowAnimate is on, so freezing leaves the hotspots
// exactly where they were rather than snapping when re-enabled
let glowTime = 0;

function animate() {
  requestAnimationFrame(animate);
  stats.begin();
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
  // toggling parallax off eases the offset back to zero rather than snapping,
  // so flipping the switch mid-scene doesn't jolt the camera
  const parallaxX = CONFIG.enableParallax ? targetMouseX : 0;
  const parallaxY = CONFIG.enableParallax ? targetMouseY : 0;
  mouseX += (parallaxX - mouseX) * Math.min(1, dt * CONFIG.parallaxDamping);
  mouseY += (parallaxY - mouseY) * Math.min(1, dt * CONFIG.parallaxDamping);

  // Manual GUI nudge and Theatre's keyframed version of the same three
  // properties add together rather than fighting -- see cameraOffsetX/Y/Z in
  // CONFIG and in sceneTrack. cameraOffsetZ carries the camera's ENTIRE
  // scroll-driven journey now (see applyTimeline/sceneTrack) -- there's no
  // procedural dolly underneath it anymore, just the static cameraStartZ.
  camera.position.x = mouseX * CONFIG.parallaxStrength + CONFIG.cameraOffsetX + theatreValues.cameraOffsetX;
  camera.position.y = -mouseY * CONFIG.parallaxStrength + CONFIG.cameraOffsetY + theatreValues.cameraOffsetY;
  camera.position.z = CONFIG.cameraStartZ + CONFIG.cameraOffsetZ + theatreValues.cameraOffsetZ;

  // look a fixed distance ahead of wherever the camera currently sits (not at
  // a fixed world point) -- otherwise once the camera's z passes GLASS_Z
  // during the pass-through phase, a fixed lookAt target flips the view
  // around to face back the way it came
  camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 10);

  // The drifting Lissajous centers and the mouse hotspot now run together:
  // when glowFollowMouse is on, one slot is reserved off the top of
  // glowCenterCount for the mouse rather than the mouse replacing the drift
  // entirely, so hovering adds a hotspot on top of the ones already orbiting.
  const driftCount = CONFIG.glowFollowMouse
    ? Math.min(CONFIG.glowCenterCount, MAX_GLOW_CENTERS - 1)
    : Math.min(CONFIG.glowCenterCount, MAX_GLOW_CENTERS);
  if (CONFIG.glowAnimate) glowTime += dt;
  updateGlowCenters(glowTime, driftCount);

  let numCenters = driftCount;
  if (CONFIG.glowFollowMouse) {
    // re-raycast after the camera moves, so the hotspot tracks where the
    // cursor actually lands on the wall plane from the current view
    raycaster.setFromCamera(pointerNDC, camera);
    const centers = gridUniforms.uGlowCenters.value;
    const mouseIdx = driftCount; // the slot updateGlowCenters left reserved
    if (pointerActive && raycaster.ray.intersectPlane(wallPlane, wallHitPoint)) {
      centers[mouseIdx].set(wallHitPoint.x, wallHitPoint.y);
      numCenters = driftCount + 1;
    } else {
      // cursor off the wall/window -- leave the reserved slot parked far away
      // rather than counting it, so the shader doesn't glow at the origin
      centers[mouseIdx].set(1e5, 1e5);
    }
  }
  gridUniforms.uNumCenters.value = numCenters;

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

  // Refresh the glass's reflection before the visible render, so it shows the
  // wall grid/space scene as they are this frame.
  //
  // This MUST run every frame. It is 6 full scene renders and throttling it is
  // tempting, but the shards render visibly darker on frames that immediately
  // follow a cube update than on frames that don't -- the cube camera sits
  // inside the shard cluster and captures mostly unlit wall and space, and
  // three regenerates the envMap's PMREM on the update frame. Updating every
  // frame keeps every frame on the same side of that difference; updating
  // every Nth makes the glass strobe between the two, which is far more
  // objectionable than the ~4ms saved.
  reflectionCamera.update(renderer, scene);

  if (CONFIG.freeCamera) {
    debugControls.update();
    // keeps the wireframe frustum in sync with the timeline camera's motion --
    // CameraHelper only rebuilds from the tracked camera's matrix on demand
    cameraHelper.update();
  }

  composer.render();
  if (CONFIG.freeCamera) renderFreeCameraPip();
  stats.end();
}

animate();
