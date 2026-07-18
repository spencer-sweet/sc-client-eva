import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// Live-tunable config, driven by the lil-gui panel
// ---------------------------------------------------------------------------
const CONFIG = {
  preset: 'Aurora Green',
  colorA: '#46e879', // dominant glow
  colorB: '#2438e8', // deep secondary
  colorC: '#7fd8ff', // highlight shimmer
  background: '#04050e',
  wispCount: 11, // soft aura veils per tunnel segment
  wispScale: 22,
  softness: 2.6, // higher = dreamier, more feathered edges
  flowSpeed: 0.35, // how fast the auras swirl internally
  breathe: 0.16, // slow scale pulsing
  opacity: 0.42,
  grain: 0.09, // film-grain amount for the analog texture
  bloomStrength: 0.55,
  bloomRadius: 1.1,
  bloomThreshold: 0.2,
  movementSpeed: 0.16,
  zoomMultiplier: 0.6,
  motionBlur: 0.35,
  dotCount: 70, // drifting sparkle motes per segment
  driftAmount: 1, // gentle camera sway
};

const PRESETS = {
  'Aurora Green': { colorA: '#46e879', colorB: '#2438e8', colorC: '#7fd8ff', background: '#04050e' },
  'Cosmic Violet': { colorA: '#9fb2ff', colorB: '#4a3f8f', colorC: '#cfe4ff', background: '#141329' },
  'Ember Rose': { colorA: '#ff8f6b', colorB: '#7a1f4d', colorC: '#ffd9a0', background: '#120711' },
  'Ice Drift': { colorA: '#8ef0ff', colorB: '#1e4fd8', colorC: '#e8fbff', background: '#040a16' },
};

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------
const SEGMENT_LENGTH = 70; // depth (world units) of one repeating tunnel chunk
const POOL_SIZE = 4; // how many chunks are kept alive around the camera
const MAX_WISPS = 24; // per-chunk mesh pool ceiling (GUI slider max)
const MAX_MOTES = 400;

// simple seeded PRNG so each chunk layout is stable as segments recycle
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const BG_COLOR = new THREE.Color(CONFIG.background);
scene.fog = new THREE.FogExp2(BG_COLOR, 0.011);
renderer.setClearColor(BG_COLOR, 1);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 0, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const afterimagePass = new AfterimagePass(CONFIG.motionBlur);
afterimagePass.enabled = CONFIG.motionBlur > 0;
composer.addPass(afterimagePass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold
);
composer.addPass(bloomPass);

// animated film grain — the analog texture layered over both reference shots
const grainPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: CONFIG.grain },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 43.7) * 43758.5453);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float n = hash(gl_FragCoord.xy) - 0.5;
      col.rgb += n * uAmount;
      gl_FragColor = col;
    }
  `,
});
composer.addPass(grainPass);

// ---------------------------------------------------------------------------
// Aura veil material — a plane whose fragment shader draws a soft, FBM-swirled
// gradient blob. Layered additively they read as flowing curtains of light
// instead of solid geometry.
// ---------------------------------------------------------------------------
const sharedWispUniforms = {
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color(CONFIG.colorA) },
  uColorB: { value: new THREE.Color(CONFIG.colorB) },
  uColorC: { value: new THREE.Color(CONFIG.colorC) },
  uSoftness: { value: CONFIG.softness },
  uFlowSpeed: { value: CONFIG.flowSpeed },
  uOpacity: { value: CONFIG.opacity },
};

const wispVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const wispFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uDim;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uSoftness;
  uniform float uFlowSpeed;
  uniform float uOpacity;
  uniform float fogDensity;
  varying vec2 vUv;
  varying float vFogDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
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
    float t = uTime * uFlowSpeed + uSeed * 37.0;

    // gently warp the silhouette so the veil never reads as a plain disc.
    // low frequency keeps it a smooth flowing wash, not spiky
    float ang = atan(p.y, p.x);
    float r = length(p);
    float warp = fbm(vec2(cos(ang), sin(ang)) * 0.9 + vec2(t * 0.12, -t * 0.08) + uSeed * 5.0);
    float r2 = r * (0.75 + warp * 0.6);

    // gaussian falloff — smooth peak, no flat saturated plateau in the core
    float g = exp(-r2 * r2 * 2.4);
    float blob = pow(g, uSoftness * 0.45);

    // interior color currents drifting through the veil
    float flowA = fbm(p * 0.9 + vec2(t * 0.10, -t * 0.07) + uSeed * 3.0);
    float flowB = fbm(p * 1.4 - vec2(t * 0.06, t * 0.09) + uSeed * 7.0);

    // radial color banding: deep hue at the halo, primary through the body,
    // highlight shimmer only in noisy patches near the core
    vec3 col = mix(uColorB, uColorA, smoothstep(0.08, 0.75, g + (flowA - 0.5) * 0.4));
    col = mix(col, uColorC, smoothstep(0.78, 1.0, g * (0.4 + 0.8 * flowB)) * 0.65);
    col *= 0.8 + 0.4 * flowA; // internal brightness currents

    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    // dissolve veils as the camera closes in, so flying through one reads as
    // drifting through mist instead of a full-screen color flood
    float nearFade = smoothstep(8.0, 32.0, vFogDepth);
    float alpha = blob * uOpacity * uDim * nearFade * (1.0 - fogFactor);
    // additive blending already multiplies rgb by alpha — don't premultiply
    // here too, or the soft mid-tones fall off as alpha^2 and disappear
    gl_FragColor = vec4(col, alpha);
  }
`;

function makeWispMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedWispUniforms.uTime,
      uColorA: sharedWispUniforms.uColorA,
      uColorB: sharedWispUniforms.uColorB,
      uColorC: sharedWispUniforms.uColorC,
      uSoftness: sharedWispUniforms.uSoftness,
      uFlowSpeed: sharedWispUniforms.uFlowSpeed,
      uOpacity: sharedWispUniforms.uOpacity,
      uSeed: { value: 0 },
      uDim: { value: 1 },
      fogDensity: { value: scene.fog.density },
    },
    vertexShader: wispVertexShader,
    fragmentShader: wispFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Sparkle motes — tiny drifting stars for depth cues
// ---------------------------------------------------------------------------
function makeMoteTexture() {
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
const moteTexture = makeMoteTexture();
const moteMaterial = new THREE.PointsMaterial({
  size: 0.28,
  map: moteTexture,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  color: new THREE.Color(CONFIG.colorC),
});

// ---------------------------------------------------------------------------
// Pool of tunnel chunks. Each pool slot is a group of veil planes + a mote
// cloud; when the camera crosses into a new segment the slot is re-seeded so
// the corridor of auras is endless.
// ---------------------------------------------------------------------------
const chunkSlots = [];
const planeGeo = new THREE.PlaneGeometry(1, 1);

for (let k = 0; k < POOL_SIZE; k++) {
  const group = new THREE.Group();
  const wisps = [];
  for (let i = 0; i < MAX_WISPS; i++) {
    const mesh = new THREE.Mesh(planeGeo, makeWispMaterial());
    mesh.visible = false;
    group.add(mesh);
    wisps.push(mesh);
  }

  const motePositions = new Float32Array(MAX_MOTES * 3);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  moteGeo.setDrawRange(0, CONFIG.dotCount);
  const motes = new THREE.Points(moteGeo, moteMaterial);
  group.add(motes);

  scene.add(group);
  chunkSlots.push({ group, wisps, motes, moteGeo, segIndex: null });
}

function seedChunk(slot, segIndex) {
  slot.segIndex = segIndex;
  slot.group.position.z = -segIndex * SEGMENT_LENGTH;
  const rng = mulberry32(segIndex * 7919 + 13);

  for (let i = 0; i < MAX_WISPS; i++) {
    const wisp = slot.wisps[i];
    if (i >= CONFIG.wispCount) {
      wisp.visible = false;
      continue;
    }
    wisp.visible = true;
    const angle = rng() * Math.PI * 2;
    // veil 0 is a huge dim backdrop on the tunnel axis that washes the whole
    // frame with color; the rest are biased off-axis so the center stays airy
    // and the camera glides between them instead of punching through cores
    const isBackdrop = i === 0;
    const radial = isBackdrop ? rng() * 2 : 4 + rng() * 14;
    const z = isBackdrop ? -SEGMENT_LENGTH * (0.65 + rng() * 0.35) : -rng() * SEGMENT_LENGTH;
    wisp.position.set(Math.cos(angle) * radial, Math.sin(angle) * radial * 0.75, z);
    const s = CONFIG.wispScale * (isBackdrop ? 3.2 : 0.55 + rng() * 0.9);
    wisp.material.uniforms.uDim.value = isBackdrop ? 0.4 : 1;
    wisp.userData.baseScale = s;
    wisp.userData.breathePhase = rng() * Math.PI * 2;
    wisp.userData.spin = (rng() - 0.5) * 0.06;
    wisp.scale.set(s, s * 0.85, 1);
    wisp.rotation.z = rng() * Math.PI * 2;
    wisp.material.uniforms.uSeed.value = rng() * 100;
  }

  const pos = slot.moteGeo.attributes.position;
  for (let i = 0; i < MAX_MOTES; i++) {
    const r = 1 + rng() * 14;
    const a = rng() * Math.PI * 2;
    pos.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r * 0.8, -rng() * SEGMENT_LENGTH);
  }
  pos.needsUpdate = true;
  slot.moteGeo.setDrawRange(0, CONFIG.dotCount);
}

function reseedAllChunks() {
  chunkSlots.forEach((slot) => {
    if (slot.segIndex !== null) seedChunk(slot, slot.segIndex);
  });
}

// ---------------------------------------------------------------------------
// Color handling
// ---------------------------------------------------------------------------
function refreshColors() {
  sharedWispUniforms.uColorA.value.set(CONFIG.colorA);
  sharedWispUniforms.uColorB.value.set(CONFIG.colorB);
  sharedWispUniforms.uColorC.value.set(CONFIG.colorC);
  moteMaterial.color.set(CONFIG.colorC);
  BG_COLOR.set(CONFIG.background);
  renderer.setClearColor(BG_COLOR, 1);
  scene.fog.color.copy(BG_COLOR);
  document.body.style.background = CONFIG.background;
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.assign(CONFIG, p);
  refreshColors();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

// ---------------------------------------------------------------------------
// Scroll-driven travel
// ---------------------------------------------------------------------------
let targetDistance = 0;
let currentDistance = 0;

function updateScrollTarget() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  targetDistance = progress * maxScroll * CONFIG.movementSpeed * CONFIG.zoomMultiplier;
}
window.addEventListener('scroll', updateScrollTarget, { passive: true });
updateScrollTarget();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  updateScrollTarget();
});

// ---------------------------------------------------------------------------
// lil-gui control panel
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Aura Controls' });

gui.add(CONFIG, 'preset', Object.keys(PRESETS)).name('🎨 Preset').onChange(applyPreset);

const colorFolder = gui.addFolder('Colors');
colorFolder.addColor(CONFIG, 'colorA').name('Aura Primary').onChange(refreshColors);
colorFolder.addColor(CONFIG, 'colorB').name('Aura Deep').onChange(refreshColors);
colorFolder.addColor(CONFIG, 'colorC').name('Highlight').onChange(refreshColors);
colorFolder.addColor(CONFIG, 'background').name('Background').onChange(refreshColors);

const auraFolder = gui.addFolder('Aura Veils');
auraFolder.add(CONFIG, 'wispCount', 1, MAX_WISPS, 1).name('Veils per Chunk').onFinishChange(reseedAllChunks);
auraFolder.add(CONFIG, 'wispScale', 6, 60, 0.5).name('Veil Size').onFinishChange(reseedAllChunks);
auraFolder
  .add(CONFIG, 'softness', 0.6, 6, 0.05)
  .name('Softness')
  .onChange((v) => (sharedWispUniforms.uSoftness.value = v));
auraFolder
  .add(CONFIG, 'flowSpeed', 0, 1.5, 0.01)
  .name('Flow Speed')
  .onChange((v) => (sharedWispUniforms.uFlowSpeed.value = v));
auraFolder.add(CONFIG, 'breathe', 0, 0.5, 0.01).name('Breathe');
auraFolder
  .add(CONFIG, 'opacity', 0.05, 1, 0.01)
  .name('Opacity')
  .onChange((v) => (sharedWispUniforms.uOpacity.value = v));

const atmosphereFolder = gui.addFolder('Atmosphere');
atmosphereFolder
  .add(CONFIG, 'grain', 0, 0.35, 0.005)
  .name('Film Grain')
  .onChange((v) => (grainPass.uniforms.uAmount.value = v));
atmosphereFolder
  .add(CONFIG, 'bloomStrength', 0, 3, 0.01)
  .name('Bloom Strength')
  .onChange((v) => (bloomPass.strength = v));
atmosphereFolder
  .add(CONFIG, 'bloomRadius', 0, 1.5, 0.01)
  .name('Bloom Blur')
  .onChange((v) => (bloomPass.radius = v));
atmosphereFolder
  .add(CONFIG, 'bloomThreshold', 0, 1, 0.01)
  .name('Bloom Threshold')
  .onChange((v) => (bloomPass.threshold = v));
atmosphereFolder.add(CONFIG, 'dotCount', 0, MAX_MOTES, 1).name('Sparkle Motes').onFinishChange(reseedAllChunks);

const motionFolder = gui.addFolder('Motion');
motionFolder.add(CONFIG, 'movementSpeed', 0.02, 0.6, 0.01).name('Movement Speed').onChange(updateScrollTarget);
motionFolder.add(CONFIG, 'zoomMultiplier', 0.1, 2, 0.01).name('Zoom Multiplier').onChange(updateScrollTarget);
motionFolder.add(CONFIG, 'driftAmount', 0, 2, 0.01).name('Camera Drift');
motionFolder
  .add(CONFIG, 'motionBlur', 0, 0.95, 0.01)
  .name('Motion Blur')
  .onChange((v) => {
    afterimagePass.uniforms['damp'].value = v;
    afterimagePass.enabled = v > 0;
  });

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  currentDistance += (targetDistance - currentDistance) * Math.min(1, dt * 3.5);
  camera.position.z = -currentDistance;
  sharedWispUniforms.uTime.value = time;
  grainPass.uniforms.uTime.value = time;

  // slow, weightless drift — dreamier than the tunnel's tighter sway
  camera.position.x = Math.sin(time * 0.22) * 0.5 * CONFIG.driftAmount;
  camera.position.y = Math.cos(time * 0.17) * 0.35 * CONFIG.driftAmount;
  camera.rotation.z = Math.sin(time * 0.09) * 0.05 * CONFIG.driftAmount;

  // assign segments to slots round-robin so a slot only re-seeds when its
  // segment index actually changes (no churn while gliding within a segment)
  const baseIndex = Math.floor(currentDistance / SEGMENT_LENGTH) - Math.floor(POOL_SIZE / 2);
  for (let k = 0; k < POOL_SIZE; k++) {
    const segIndex = baseIndex + k;
    const slot = chunkSlots[((segIndex % POOL_SIZE) + POOL_SIZE) % POOL_SIZE];
    if (slot.segIndex !== segIndex) seedChunk(slot, segIndex);
  }

  // breathing + slow spin per veil, gentle roll per chunk
  for (const slot of chunkSlots) {
    for (const wisp of slot.wisps) {
      if (!wisp.visible) continue;
      const b = 1 + Math.sin(time * 0.6 + wisp.userData.breathePhase) * CONFIG.breathe;
      const s = wisp.userData.baseScale * b;
      wisp.scale.set(s, s * 0.85, 1);
      wisp.rotation.z += wisp.userData.spin * dt;
    }
    slot.group.rotation.z = Math.sin(time * 0.05 + slot.group.position.z * 0.01) * 0.08;
  }

  composer.render();
}

animate();
