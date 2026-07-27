import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// Live-tunable config, driven by the lil-gui panel. `progress` is the one
// that matters most: it scrubs the glb's embedded animation timeline (0..1)
// and is kept in sync with scroll position further down.
// ---------------------------------------------------------------------------
const CONFIG = {
  progress: 0,
  scrub: true, // when true, scroll drives progress; turn off to drag the slider freely
  scrollDamping: 4.5, // higher = snappier tracking of scroll position
  scrollSpeedMultiplier: 0.25, // scales scroll fraction -> timeline progress, so the playhead advances slower than raw scroll
  progressStart: 0.13, // progress=0 maps to this fraction of the clip's duration, not to time=0
  autoRotateSpeed: 0.12,
  cameraDistance: 6.5,
  transmission: 1,
  roughness: 0.05,
  thickness: 0.6,
  ior: 1.5,
  envMapIntensity: 1.3,
  parallaxStrength: 1.6, // world-unit camera offset, not a rotation -- see note by its use below
  parallaxDamping: 4,
};

const MODEL_URL = '/star-shatter-01.glb';

// ---------------------------------------------------------------------------
// Renderer / scene / camera. Real refraction (shards bending the shards
// behind them) needs three's transmission pass, which renders the scene to
// an offscreen buffer once per frame for transmissive materials to sample --
// one extra pass total, not one per shard, so 60fps still holds with 287
// shard meshes.
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050608, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050608, 0.035);

// soft studio-style environment so the glass has something to reflect/refract
// beyond the other shards -- generated once, cheap to sample per-frame
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(4, 6, 8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.5);
fillLight.position.set(-6, -3, 4);
scene.add(fillLight);

// against an empty black void there's nothing for transmission to bend --
// this core light rides with the shatter's origin so every shard has a bright
// point to refract, which is what actually reads as "seeing through" glass
// instead of just dark faceted reflections
const coreLight = new THREE.PointLight(0xdcebff, 18, 40, 2);
scene.add(coreLight);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, CONFIG.cameraDistance);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Real transmissive glass -- MeshPhysicalMaterial's `transmission` triggers
// three's built-in transmission render pass, which captures the scene behind
// each shard (i.e. the *other* shards) into an offscreen buffer and refracts
// it through the surface. That's what actually shows shards through shards,
// which a matcap (a baked, view-independent shading trick) never could.
// ---------------------------------------------------------------------------
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: CONFIG.roughness,
  transmission: CONFIG.transmission,
  thickness: CONFIG.thickness,
  ior: CONFIG.ior,
  envMapIntensity: CONFIG.envMapIntensity,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
});

// ---------------------------------------------------------------------------
// Load the shatter model, apply the glass matcap to every shard, and wire up
// its embedded animation clip to an AnimationMixer we drive manually (no
// mixer.update(dt) autoplay -- progress is set explicitly from the GUI/scroll
// so scrubbing stays frame-accurate in both directions).
// ---------------------------------------------------------------------------
let mixer = null;
let action = null;
let clipDuration = 1;
let currentProgress = 0;

const progressController = { controller: null };

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = glassMaterial;
        child.frustumCulled = true;
      }
    });

    // frame the model: center it and back the camera off by its bounding radius
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    gltf.scene.position.sub(center);
    gltf.scene.rotation.x = Math.PI / 2; // the star plate is authored flat in the XZ plane (Y-up); tip it upright to face the camera
    CONFIG.cameraDistance = sphere.radius * 2.4;
    camera.position.set(0, 0, CONFIG.cameraDistance);

    modelGroup.add(gltf.scene);

    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const clip = gltf.animations[0];
      clipDuration = clip.duration;
      action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      setProgress(currentProgress);
    }
  },
  undefined,
  (err) => console.error('Failed to load star-shatter-01.glb', err)
);

function setProgress(p) {
  currentProgress = THREE.MathUtils.clamp(p, 0, 1);
  CONFIG.progress = currentProgress;
  if (mixer && action) {
    // progress=0 lands at progressStart*duration (not the clip's true start),
    // so the timeline skips the dead air before the shatter kicks off
    action.time = THREE.MathUtils.lerp(CONFIG.progressStart * clipDuration, clipDuration, currentProgress);
    mixer.update(0);
  }
  if (progressController.controller) progressController.controller.updateDisplay();
}

// ---------------------------------------------------------------------------
// Scroll-driven timeline scrubbing
// ---------------------------------------------------------------------------
let targetProgress = 0;

function updateScrollTarget() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const scrollFraction = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  targetProgress = THREE.MathUtils.clamp(scrollFraction * CONFIG.scrollSpeedMultiplier, 0, 1);
}
window.addEventListener('scroll', updateScrollTarget, { passive: true });
updateScrollTarget();

// ---------------------------------------------------------------------------
// Mouse-driven parallax -- a small camera TRANSLATION (not rotation) damped
// toward the cursor position. Panning (rotating the camera in place) shifts
// every depth by the same screen amount, so it can't read as depth; only a
// sideways dolly re-aimed at a fixed point makes near shards sweep across
// the screen faster than far ones, which is the actual parallax cue.
// ---------------------------------------------------------------------------
let targetMouseX = 0;
let targetMouseY = 0;
let mouseX = 0;
let mouseY = 0;

window.addEventListener('pointermove', (e) => {
  targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
  targetMouseY = (e.clientY / window.innerHeight) * 2 - 1;
});

// ---------------------------------------------------------------------------
// lil-gui control panel
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Star Shatter Controls' });

gui.add(CONFIG, 'scrub').name('Scroll Drives Timeline');
progressController.controller = gui
  .add(CONFIG, 'progress', 0, 1, 0.001)
  .name('Timeline')
  .onChange((v) => {
    if (!CONFIG.scrub) setProgress(v);
  });
gui
  .add(CONFIG, 'scrollSpeedMultiplier', 0.05, 2, 0.01)
  .name('Scroll Speed')
  .onChange(updateScrollTarget);
gui
  .add(CONFIG, 'progressStart', 0, 0.9, 0.01)
  .name('Timeline Start')
  .onChange(() => setProgress(currentProgress));
gui.add(CONFIG, 'autoRotateSpeed', 0, 1, 0.01).name('Auto Rotate');
gui.add(CONFIG, 'parallaxStrength', 0, 6, 0.05).name('Mouse Parallax');

const glassFolder = gui.addFolder('Glass Material');
glassFolder
  .add(CONFIG, 'transmission', 0, 1, 0.01)
  .name('Transmission')
  .onChange((v) => (glassMaterial.transmission = v));
glassFolder
  .add(CONFIG, 'roughness', 0, 0.5, 0.005)
  .name('Roughness')
  .onChange((v) => (glassMaterial.roughness = v));
glassFolder
  .add(CONFIG, 'thickness', 0, 2, 0.01)
  .name('Thickness')
  .onChange((v) => (glassMaterial.thickness = v));
glassFolder
  .add(CONFIG, 'ior', 1, 2.33, 0.01)
  .name('IOR')
  .onChange((v) => (glassMaterial.ior = v));
glassFolder
  .add(CONFIG, 'envMapIntensity', 0, 3, 0.05)
  .name('Env Intensity')
  .onChange((v) => (glassMaterial.envMapIntensity = v));

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  if (CONFIG.scrub) {
    const damped = currentProgress + (targetProgress - currentProgress) * Math.min(1, dt * CONFIG.scrollDamping);
    setProgress(damped);
  }

  // spin around Z (the axis pointing at the camera) so the star stays face-on
  // instead of tumbling edge-on the way a Y spin would
  modelGroup.rotation.z = time * CONFIG.autoRotateSpeed;

  // mouse parallax -- dolly the camera sideways off-axis and re-aim at the
  // shatter origin every frame, so shards closer to the camera sweep across
  // the screen more than distant ones (real motion parallax, unlike a pan)
  mouseX += (targetMouseX - mouseX) * Math.min(1, dt * CONFIG.parallaxDamping);
  mouseY += (targetMouseY - mouseY) * Math.min(1, dt * CONFIG.parallaxDamping);
  camera.position.x = mouseX * CONFIG.parallaxStrength;
  camera.position.y = -mouseY * CONFIG.parallaxStrength;
  camera.position.z = CONFIG.cameraDistance;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

animate();
