import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import GUI from 'lil-gui';
import { getProject, types } from '@theatre/core';
import studio from '@theatre/studio';

// ---------------------------------------------------------------------------
// Live-tunable config, driven by the lil-gui panel. The camera dolly itself
// (zoom curve / fov / tilt) is NOT in here -- that's authored as a Theatre.js
// sequence further down, scrubbed by scroll position instead of a slider.
// ---------------------------------------------------------------------------
const CONFIG = {
  color: '#3658ff',
  bloomStrength: 0.85,
  bloomRadius: 1.25,
  bloomThreshold: 0.42,
  movementSpeed: 0.16,
  zoomMultiplier: 0.6,
  motionBlur: 0.25,
  lineCount: 24,
  dotCount: 90,
  softLines: true,
  wireframe: false,
  edgeSoftness: 1.6,
  tubeBrightness: 1.8,
  tubeOpacity: 0.92,
  pulseMode: true,
  pulseSpeed: 1.2,
  curvature: 1,
  tunnelCurve: 1,
  lineThickness: 1,
  // aura veils, brought in from aura-zoom
  veilColorA: '#f051c6',
  veilColorB: '#1dc2d7',
  veilCount: 17,
  veilScale: 11.5,
  veilSoftness: 2.85,
  veilFlowSpeed: 0.32,
  veilOpacity: 0.77,
  // background starfield, brought in from aura-zoom -- a wider, sparser
  // sqrt-distributed field than the tube-hugging dots, so it reads as a
  // distant backdrop rather than debris clinging to the tunnel walls
  bgStarCount: 240,
  bgStarRadius: 32,
  // layer visibility toggles
  showTubes: true,
  showStars: true,
  showAuras: true,
  showBackgroundStars: true,
};

// ---------------------------------------------------------------------------
// Tunnel path -- the whole tunnel bends along a smooth sinusoidal 3D path.
// The same math runs in JS (camera, sprites) and GLSL (tubes, motes, veils),
// driven by one shared uniform so the GUI slider bends everything in lockstep.
// ---------------------------------------------------------------------------
const tunnelCurveUniform = { value: CONFIG.tunnelCurve };

const TUNNEL_PATH_GLSL = /* glsl */ `
  uniform float uCurveAmp;
  vec2 tunnelOffset(float z) {
    return uCurveAmp * vec2(6.0 * sin(z * 0.025), 4.0 * sin(z * 0.017 + 2.0));
  }
`;

function tunnelOffsetX(z) {
  return tunnelCurveUniform.value * 6 * Math.sin(z * 0.025);
}
function tunnelOffsetY(z) {
  return tunnelCurveUniform.value * 4 * Math.sin(z * 0.017 + 2.0);
}

// bend three.js built-in materials (solid tubes, dot clouds) with the same path
function addTunnelBend(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCurveAmp = tunnelCurveUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TUNNEL_PATH_GLSL)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 bentWorldPos = modelMatrix * vec4(transformed, 1.0);
        bentWorldPos.xy += tunnelOffset(bentWorldPos.z);
        vec4 mvPosition = viewMatrix * bentWorldPos;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
  };
}

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------
const SEGMENT_LENGTH = 70; // depth (world units) of one repeating tunnel chunk
const POOL_SIZE = 4; // how many chunks are kept alive around the camera

const NEAR_COLOR = new THREE.Color();
const FAR_COLOR = new THREE.Color();
const CORE_COLOR = new THREE.Color();
const MOTE_COLOR = new THREE.Color();

function updateColorScheme() {
  const primary = new THREE.Color(CONFIG.color);
  NEAR_COLOR.copy(primary).lerp(new THREE.Color(0xffffff), 0.15);
  FAR_COLOR.copy(primary).lerp(new THREE.Color(0x000000), 0.85);
  CORE_COLOR.copy(primary).lerp(new THREE.Color(0xffffff), 0.4);
  MOTE_COLOR.copy(primary).lerp(new THREE.Color(0xffffff), 0.35);
}
updateColorScheme();

// simple seeded PRNG so each chunk variant is stable across rebuilds
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
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.014);

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

// ---------------------------------------------------------------------------
// Tendril chunk builder -- smooth, sinuous tube "veins" radiating outward,
// thick and near the camera, tapering to a point deep in the tunnel.
// ---------------------------------------------------------------------------
function radiusProfile(t, rng) {
  const base = THREE.MathUtils.lerp(1, 0.08, t);
  const bump = 1 + 0.12 * CONFIG.curvature * Math.sin(t * (2 + rng() * 1.2) * Math.PI + rng() * 10);
  return Math.max(0.15, base * bump);
}

function taperTube(geometry, curve, tubularSegments, radialSegments, rng) {
  const pos = geometry.attributes.position;
  const ringSize = radialSegments + 1;
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const tangents = new Float32Array(pos.count * 4);
  const phase = rng();
  const phases = new Float32Array(pos.count).fill(phase);
  for (let r = 0; r <= tubularSegments; r++) {
    const t = r / tubularSegments;
    curve.getPointAt(Math.min(t, 1), center);
    curve.getTangentAt(Math.min(t, 1), tangent);
    const factor = radiusProfile(t, rng);
    for (let j = 0; j < ringSize; j++) {
      const idx = r * ringSize + j;
      if (idx >= pos.count) continue;
      const x = pos.getX(idx);
      const y = pos.getY(idx);
      const z = pos.getZ(idx);
      pos.setXYZ(idx, center.x + (x - center.x) * factor, center.y + (y - center.y) * factor, center.z + (z - center.z) * factor);
      tangents[idx * 4] = tangent.x;
      tangents[idx * 4 + 1] = tangent.y;
      tangents[idx * 4 + 2] = tangent.z;
      tangents[idx * 4 + 3] = t;
    }
  }
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 4));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  pos.needsUpdate = true;
}

function colorizeByDepth(geometry) {
  const pos = geometry.attributes.position;
  const existing = geometry.getAttribute('color');
  const colors = existing ? existing.array : new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(-pos.getZ(i) / SEGMENT_LENGTH, 0, 1);
    c.copy(NEAR_COLOR).lerp(FAR_COLOR, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  if (existing) {
    existing.needsUpdate = true;
  } else {
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

function buildStrand(rng, angle0, steps, tubularSegments, radialSegments) {
  let angle = angle0;
  const zStart = -rng() * SEGMENT_LENGTH * 0.55;
  const spanLen = SEGMENT_LENGTH * (0.35 + rng() * 0.55);
  const zEnd = Math.max(zStart - spanLen, -SEGMENT_LENGTH);
  const nearRadius = 1.8 + rng() * 2.2;
  const farRadius = 0.08 + rng() * 0.12;
  const points = [];
  for (let s = 0; s <= steps; s++) {
    const localT = s / steps;
    const z = THREE.MathUtils.lerp(zStart, zEnd, localT);
    const radius =
      THREE.MathUtils.lerp(nearRadius, farRadius, localT * localT) +
      (rng() - 0.5) * 0.2 * (1 - localT) * CONFIG.curvature;
    angle += (rng() - 0.5) * 0.16 * CONFIG.curvature;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubularSegments, (0.14 + rng() * 0.08) * CONFIG.lineThickness, radialSegments, false);
  taperTube(geo, curve, tubularSegments, radialSegments, rng);
  return { geo, points, curve };
}

function buildChunk(seed) {
  const rng = mulberry32(seed);
  const geometries = [];
  const lineCount = CONFIG.lineCount;

  for (let i = 0; i < lineCount; i++) {
    const angle0 = (i / lineCount) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const main = buildStrand(rng, angle0, 10, 40, 12);
    geometries.push(main.geo);

    if (rng() < 0.35) {
      const branchFrom = Math.floor(main.points.length * (0.35 + rng() * 0.25));
      const startPt = main.points[branchFrom];
      const endPt = main.points[main.points.length - 1];
      const branchAngle = Math.atan2(startPt.y, startPt.x) + (rng() - 0.5) * 1.2;
      const steps = 6;
      let angle = branchAngle;
      const startRadius = Math.hypot(startPt.x, startPt.y);
      const farRadius = 0.08 + rng() * 0.12;
      const pts = [startPt.clone()];
      for (let s = 1; s <= steps; s++) {
        const localT = s / steps;
        const z = THREE.MathUtils.lerp(startPt.z, endPt.z, localT);
        const radius =
          THREE.MathUtils.lerp(startRadius, farRadius, localT * localT) +
          (rng() - 0.5) * 0.2 * (1 - localT) * CONFIG.curvature;
        angle += (rng() - 0.5) * 0.2 * CONFIG.curvature;
        pts.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
      }
      const bCurve = new THREE.CatmullRomCurve3(pts);
      const bGeo = new THREE.TubeGeometry(bCurve, 24, (0.14 + rng() * 0.08) * CONFIG.lineThickness, 12, false);
      taperTube(bGeo, bCurve, 24, 12, rng);
      geometries.push(bGeo);
    }
  }

  const merged = mergeGeometries(geometries, false);
  merged.computeVertexNormals();
  colorizeByDepth(merged);

  const moteCount = CONFIG.dotCount;
  const motePositions = new Float32Array(Math.max(moteCount, 1) * 3);
  for (let i = 0; i < moteCount; i++) {
    const t = rng();
    const r = 0.4 + rng() * 3.2;
    const a = rng() * Math.PI * 2;
    motePositions[i * 3] = Math.cos(a) * r;
    motePositions[i * 3 + 1] = Math.sin(a) * r;
    motePositions[i * 3 + 2] = -t * SEGMENT_LENGTH;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  moteGeo.setDrawRange(0, moteCount);

  return { tendrilGeo: merged, moteGeo };
}

const CHUNK_VARIANTS = [buildChunk(1337), buildChunk(9001)];

function rebuildChunks() {
  const stale = CHUNK_VARIANTS.slice();
  CHUNK_VARIANTS[0] = buildChunk(1337);
  CHUNK_VARIANTS[1] = buildChunk(9001);
  stale.forEach((variant) => {
    variant.tendrilGeo.dispose();
    variant.moteGeo.dispose();
  });
}

const tendrilMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uOpacity: { value: CONFIG.tubeOpacity },
    uSoftness: { value: CONFIG.edgeSoftness },
    uIntensity: { value: CONFIG.tubeBrightness },
    uTime: { value: 0 },
    uPulseOn: { value: CONFIG.pulseMode ? 1 : 0 },
    uPulseSpeed: { value: CONFIG.pulseSpeed },
    uCurveAmp: tunnelCurveUniform,
  },
  vertexShader: /* glsl */ `
    ${TUNNEL_PATH_GLSL}
    varying vec3 vColor;
    varying vec3 vWorldNormal;
    varying vec3 vWorldTangent;
    varying vec3 vWorldPos;
    varying float vFogDepth;
    varying float vAxialT;
    varying float vPhase;
    attribute vec3 color;
    attribute vec4 aTangent;
    attribute float aPhase;
    void main() {
      vColor = color;
      vAxialT = aTangent.w;
      vPhase = aPhase;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vWorldTangent = normalize(mat3(modelMatrix) * aTangent.xyz);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      worldPos.xy += tunnelOffset(worldPos.z);
      vWorldPos = worldPos.xyz;
      vec4 mvPosition = viewMatrix * worldPos;
      vFogDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform float uSoftness;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uPulseOn;
    uniform float uPulseSpeed;
    uniform vec3 fogColor;
    uniform float fogDensity;
    varying vec3 vColor;
    varying vec3 vWorldNormal;
    varying vec3 vWorldTangent;
    varying vec3 vWorldPos;
    varying float vFogDepth;
    varying float vAxialT;
    varying float vPhase;
    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float tv = dot(normalize(vWorldTangent), viewDir);
      float denom = max(sqrt(1.0 - tv * tv), 0.08);
      float facing = clamp(abs(dot(normalize(vWorldNormal), viewDir)) / denom, 0.0, 1.0);
      float edge = pow(facing, uSoftness);
      float endFade = smoothstep(0.0, 0.18, vAxialT) * (1.0 - smoothstep(0.85, 1.0, vAxialT));
      float p = fract(vAxialT - uTime * uPulseSpeed * 0.35 + vPhase);
      float burst = exp(-p * 9.0);
      float pulseFactor = mix(1.0, 0.18 + 3.0 * burst, uPulseOn);
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      vec3 col = mix(vColor * uIntensity * pulseFactor, fogColor, fogFactor);
      gl_FragColor = vec4(col, edge * endFade * uOpacity);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
tendrilMaterial.uniforms.fogColor = { value: scene.fog.color };
tendrilMaterial.uniforms.fogDensity = { value: scene.fog.density };

const solidTendrilMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.92,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
addTunnelBend(solidTendrilMaterial);

function activeTubeMaterial() {
  return CONFIG.softLines ? tendrilMaterial : solidTendrilMaterial;
}

function applyTubeMaterial() {
  tendrilMaterial.wireframe = CONFIG.wireframe;
  solidTendrilMaterial.wireframe = CONFIG.wireframe;
  const mat = activeTubeMaterial();
  tendrilMeshes.forEach((mesh) => (mesh.material = mat));
}

function makeMoteTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(160,240,255,0.8)');
  g.addColorStop(1, 'rgba(160,240,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const moteTexture = makeMoteTexture();
const moteMaterial = new THREE.PointsMaterial({
  size: 0.22,
  map: moteTexture,
  transparent: true,
  opacity: 0.75,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  color: MOTE_COLOR,
});
addTunnelBend(moteMaterial);

// ---------------------------------------------------------------------------
// Pool of live tunnel chunks + glowing core nodes, recycled as we travel
// ---------------------------------------------------------------------------
const tendrilMeshes = [];
const moteClouds = [];
for (let k = 0; k < POOL_SIZE; k++) {
  const mesh = new THREE.Mesh(CHUNK_VARIANTS[0].tendrilGeo, tendrilMaterial);
  scene.add(mesh);
  tendrilMeshes.push(mesh);

  const motes = new THREE.Points(CHUNK_VARIANTS[0].moteGeo, moteMaterial);
  scene.add(motes);
  moteClouds.push(motes);
}

const coreSpriteMaterial = new THREE.SpriteMaterial({
  map: moteTexture,
  color: CORE_COLOR,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const coreSprites = [];
for (let k = 0; k < POOL_SIZE; k++) {
  const sprite = new THREE.Sprite(coreSpriteMaterial);
  sprite.scale.set(3.2, 3.2, 1);
  scene.add(sprite);
  coreSprites.push(sprite);
}

function refreshColors() {
  updateColorScheme();
  CHUNK_VARIANTS.forEach((variant) => colorizeByDepth(variant.tendrilGeo));
  moteMaterial.color.copy(MOTE_COLOR);
  coreSpriteMaterial.color.copy(CORE_COLOR);
}

// ---------------------------------------------------------------------------
// Aura veils, brought in from aura-zoom -- soft FBM-swirled glow planes that
// drift through the tunnel alongside the tendrils, pooled per segment the
// same way the tendrils/motes are. The tunnel bend is baked into the veil's
// own vertex shader (instead of moving the group) so it stays correct
// everywhere along a veil's plane, not just at its center.
// ---------------------------------------------------------------------------
const MAX_VEILS_PER_CHUNK = 24;

const sharedVeilUniforms = {
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color(CONFIG.veilColorA) },
  uColorB: { value: new THREE.Color(CONFIG.veilColorB) },
  uSoftness: { value: CONFIG.veilSoftness },
  uFlowSpeed: { value: CONFIG.veilFlowSpeed },
  uOpacity: { value: CONFIG.veilOpacity },
  uCurveAmp: tunnelCurveUniform,
};

const veilVertexShader = /* glsl */ `
  ${TUNNEL_PATH_GLSL}
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    worldPos.xy += tunnelOffset(worldPos.z);
    vec4 mvPosition = viewMatrix * worldPos;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const veilFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
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

    float ang = atan(p.y, p.x);
    float r = length(p);
    float warp = fbm(vec2(cos(ang), sin(ang)) * 0.9 + vec2(t * 0.12, -t * 0.08) + uSeed * 5.0);
    float r2 = r * (0.75 + warp * 0.6);

    float g = exp(-r2 * r2 * 2.4);
    float blob = pow(g, uSoftness * 0.45);

    float flowA = fbm(p * 0.9 + vec2(t * 0.10, -t * 0.07) + uSeed * 3.0);
    vec3 col = mix(uColorA, uColorB, flowA) * (0.5 + 0.8 * flowA);

    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    float nearFade = smoothstep(6.0, 26.0, vFogDepth);
    float alpha = blob * uOpacity * nearFade * (1.0 - fogFactor);
    gl_FragColor = vec4(col, alpha);
  }
`;

function makeVeilMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedVeilUniforms.uTime,
      uColorA: sharedVeilUniforms.uColorA,
      uColorB: sharedVeilUniforms.uColorB,
      uSoftness: sharedVeilUniforms.uSoftness,
      uFlowSpeed: sharedVeilUniforms.uFlowSpeed,
      uOpacity: sharedVeilUniforms.uOpacity,
      uCurveAmp: tunnelCurveUniform,
      uSeed: { value: 0 },
      fogDensity: { value: scene.fog.density },
    },
    vertexShader: veilVertexShader,
    fragmentShader: veilFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const veilPlaneGeo = new THREE.PlaneGeometry(1, 1);
const veilSlots = [];
for (let k = 0; k < POOL_SIZE; k++) {
  const group = new THREE.Group();
  const veils = [];
  for (let i = 0; i < MAX_VEILS_PER_CHUNK; i++) {
    const mesh = new THREE.Mesh(veilPlaneGeo, makeVeilMaterial());
    mesh.visible = false;
    group.add(mesh);
    veils.push(mesh);
  }
  scene.add(group);
  veilSlots.push({ group, veils, segIndex: null });
}

function seedVeilChunk(slot, segIndex) {
  slot.segIndex = segIndex;
  slot.group.position.z = -segIndex * SEGMENT_LENGTH;
  const rng = mulberry32(segIndex * 6151 + 41);

  for (let i = 0; i < MAX_VEILS_PER_CHUNK; i++) {
    const veil = slot.veils[i];
    if (i >= CONFIG.veilCount) {
      veil.visible = false;
      continue;
    }
    veil.visible = true;
    const angle = rng() * Math.PI * 2;
    const radial = 2.5 + rng() * 5.5;
    const z = -rng() * SEGMENT_LENGTH;
    veil.position.set(Math.cos(angle) * radial, Math.sin(angle) * radial, z);
    const s = CONFIG.veilScale * (0.5 + rng() * 0.9);
    veil.userData.scaleX = s;
    veil.userData.scaleY = s * (0.6 + rng() * 0.4);
    veil.rotation.z = rng() * Math.PI * 2;
    veil.userData.spin = (rng() - 0.5) * 0.03;
    veil.userData.breathePhase = rng() * Math.PI * 2;
    veil.scale.set(veil.userData.scaleX, veil.userData.scaleY, 1);
    veil.material.uniforms.uSeed.value = rng() * 100;
  }
}

function reseedVeils() {
  veilSlots.forEach((slot) => {
    if (slot.segIndex !== null) seedVeilChunk(slot, slot.segIndex);
  });
}

function refreshVeilColors() {
  sharedVeilUniforms.uColorA.value.set(CONFIG.veilColorA);
  sharedVeilUniforms.uColorB.value.set(CONFIG.veilColorB);
}

// ---------------------------------------------------------------------------
// Background starfield, brought in from aura-zoom -- unlike the tube-hugging
// motes above (radius capped near the tunnel walls), this uses a sqrt-radius
// distribution spanning well past the tubes so it reads as a distant backdrop
// rather than debris riding along the tendrils.
// ---------------------------------------------------------------------------
const MAX_BG_STARS = 400;

function makeBgStarTexture() {
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
const bgStarMaterial = new THREE.PointsMaterial({
  size: 0.16,
  map: makeBgStarTexture(),
  transparent: true,
  opacity: 0.7,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  color: 0xdcebff,
});
addTunnelBend(bgStarMaterial);

const bgStarSlots = [];
for (let k = 0; k < POOL_SIZE; k++) {
  const positions = new Float32Array(MAX_BG_STARS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, CONFIG.bgStarCount);
  const points = new THREE.Points(geo, bgStarMaterial);
  scene.add(points);
  bgStarSlots.push({ points, geo, segIndex: null });
}

function seedBgStars(slot, segIndex) {
  slot.segIndex = segIndex;
  slot.points.position.z = -segIndex * SEGMENT_LENGTH;
  const rng = mulberry32(segIndex * 2003 + 77);
  const pos = slot.geo.attributes.position;
  for (let i = 0; i < MAX_BG_STARS; i++) {
    const r = Math.sqrt(rng()) * CONFIG.bgStarRadius;
    const a = rng() * Math.PI * 2;
    pos.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, -rng() * SEGMENT_LENGTH);
  }
  pos.needsUpdate = true;
  slot.geo.setDrawRange(0, CONFIG.bgStarCount);
}

function reseedBgStars() {
  bgStarSlots.forEach((slot) => {
    if (slot.segIndex !== null) seedBgStars(slot, slot.segIndex);
  });
}

// ---------------------------------------------------------------------------
// Theatre.js -- the camera dolly is authored as a sequence, but instead of
// playing on a clock its playhead position is driven directly by scroll
// progress. That's the "animation track linked to scroll": Theatre owns the
// zoom curve / fov punches / tilt, scroll owns where on that timeline we are.
// Open the Studio panel (dev only) to add keyframes; while it's open it
// autosaves the authored curve to localStorage.
// ---------------------------------------------------------------------------
if (import.meta.env.DEV) {
  studio.initialize();
}

const SEQUENCE_LENGTH = 24; // seconds -- just the scroll(0..1) -> position(0..SEQUENCE_LENGTH) mapping range

const dollySheet = getProject('Timeline 01').sheet('Tunnel Camera');
const dollyTrack = dollySheet.object('Dolly', {
  zoomCurve: types.number(1, { range: [0, 3], nudgeMultiplier: 0.01 }), // multiplies the scroll-driven travel distance
  fov: types.number(65, { range: [40, 100] }),
  tilt: types.compound({
    x: types.number(0, { range: [-0.6, 0.6] }),
    y: types.number(0, { range: [-0.6, 0.6] }),
    z: types.number(0, { range: [-0.6, 0.6] }),
  }),
});

let dollyValues = dollyTrack.value;
dollyTrack.onValuesChange((v) => {
  dollyValues = v;
});

// ---------------------------------------------------------------------------
// Scroll-driven travel
// ---------------------------------------------------------------------------
let targetDistance = 0;
let currentDistance = 0;

function updateScrollTarget() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  dollySheet.sequence.position = progress * SEQUENCE_LENGTH;
  const baseDistance = progress * maxScroll * CONFIG.movementSpeed * CONFIG.zoomMultiplier;
  targetDistance = baseDistance * dollyValues.zoomCurve;
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
const gui = new GUI({ title: 'Tunnel Controls' });

const tips = { theatreTip: '⌥/Alt + \\ toggles Theatre UI' };
gui.add(tips, 'theatreTip').name('Tip').disable();

function setTubesVisible(v) {
  tendrilMeshes.forEach((m) => (m.visible = v));
  coreSprites.forEach((s) => (s.visible = v));
}
function setStarsVisible(v) {
  moteClouds.forEach((m) => (m.visible = v));
}
function setAurasVisible(v) {
  veilSlots.forEach((slot) => (slot.group.visible = v));
}
function setBackgroundStarsVisible(v) {
  bgStarSlots.forEach((slot) => (slot.points.visible = v));
}
setTubesVisible(CONFIG.showTubes);
setStarsVisible(CONFIG.showStars);
setAurasVisible(CONFIG.showAuras);
setBackgroundStarsVisible(CONFIG.showBackgroundStars);

const layersFolder = gui.addFolder('Layers');
layersFolder.add(CONFIG, 'showTubes').name('Tubes / Lines').onChange(setTubesVisible);
layersFolder.add(CONFIG, 'showStars').name('Stars (dots)').onChange(setStarsVisible);
layersFolder.add(CONFIG, 'showAuras').name('Aura Veils').onChange(setAurasVisible);
layersFolder.add(CONFIG, 'showBackgroundStars').name('Background Stars').onChange(setBackgroundStarsVisible);

gui.addColor(CONFIG, 'color').name('Line Color').onChange(refreshColors);
gui.add(CONFIG, 'softLines').name('✨ SOFT LINES (fresnel) — off = solid tubes').onChange(applyTubeMaterial);
gui.add(CONFIG, 'wireframe').name('Wireframe').onChange(applyTubeMaterial);

const tubeFolder = gui.addFolder('Tube Material (Fresnel)');
tubeFolder
  .add(CONFIG, 'edgeSoftness', 0.3, 6, 0.05)
  .name('Line Blur')
  .onChange((v) => (tendrilMaterial.uniforms.uSoftness.value = v));
tubeFolder
  .add(CONFIG, 'tubeBrightness', 0.2, 5, 0.05)
  .name('Brightness')
  .onChange((v) => (tendrilMaterial.uniforms.uIntensity.value = v));
tubeFolder
  .add(CONFIG, 'tubeOpacity', 0, 1, 0.01)
  .name('Opacity')
  .onChange((v) => {
    tendrilMaterial.uniforms.uOpacity.value = v;
    solidTendrilMaterial.opacity = v;
  });

const pulseFolder = gui.addFolder('Electric Pulse');
pulseFolder
  .add(CONFIG, 'pulseMode')
  .name('⚡ Pulse Mode')
  .onChange((v) => (tendrilMaterial.uniforms.uPulseOn.value = v ? 1 : 0));
pulseFolder
  .add(CONFIG, 'pulseSpeed', 0.1, 5, 0.05)
  .name('Pulse Speed')
  .onChange((v) => (tendrilMaterial.uniforms.uPulseSpeed.value = v));

const veilFolder = gui.addFolder('Aura Veils');
veilFolder.addColor(CONFIG, 'veilColorA').name('Inner Color').onChange(refreshVeilColors);
veilFolder.addColor(CONFIG, 'veilColorB').name('Outer Color').onChange(refreshVeilColors);
veilFolder.add(CONFIG, 'veilCount', 0, MAX_VEILS_PER_CHUNK, 1).name('Veils per Chunk').onFinishChange(reseedVeils);
veilFolder.add(CONFIG, 'veilScale', 4, 40, 0.5).name('Veil Size').onFinishChange(reseedVeils);
veilFolder
  .add(CONFIG, 'veilSoftness', 0.6, 6, 0.05)
  .name('Softness')
  .onChange((v) => (sharedVeilUniforms.uSoftness.value = v));
veilFolder
  .add(CONFIG, 'veilFlowSpeed', 0, 1.5, 0.01)
  .name('Flow Speed')
  .onChange((v) => (sharedVeilUniforms.uFlowSpeed.value = v));
veilFolder
  .add(CONFIG, 'veilOpacity', 0, 1, 0.01)
  .name('Opacity')
  .onChange((v) => (sharedVeilUniforms.uOpacity.value = v));

const bgStarFolder = gui.addFolder('Background Stars');
bgStarFolder.add(CONFIG, 'bgStarCount', 0, MAX_BG_STARS, 1).name('Star Count').onFinishChange(reseedBgStars);
bgStarFolder.add(CONFIG, 'bgStarRadius', 8, 80, 1).name('Field Radius').onFinishChange(reseedBgStars);

const bloomFolder = gui.addFolder('Bloom & Glow');
bloomFolder
  .add(CONFIG, 'bloomStrength', 0, 3, 0.01)
  .name('Strength')
  .onChange((v) => (bloomPass.strength = v));
bloomFolder
  .add(CONFIG, 'bloomRadius', 0, 1.5, 0.01)
  .name('Blur')
  .onChange((v) => (bloomPass.radius = v));
bloomFolder
  .add(CONFIG, 'bloomThreshold', 0, 1, 0.01)
  .name('Threshold')
  .onChange((v) => (bloomPass.threshold = v));

const motionFolder = gui.addFolder('Motion');
motionFolder
  .add(CONFIG, 'tunnelCurve', 0, 3, 0.01)
  .name('Tunnel Curve')
  .onChange((v) => (tunnelCurveUniform.value = v));
motionFolder.add(CONFIG, 'movementSpeed', 0.02, 0.6, 0.01).name('Movement Speed').onChange(updateScrollTarget);
motionFolder.add(CONFIG, 'zoomMultiplier', 0.1, 2, 0.01).name('Zoom Multiplier').onChange(updateScrollTarget);
motionFolder
  .add(CONFIG, 'motionBlur', 0, 0.95, 0.01)
  .name('Motion Blur')
  .onChange((v) => {
    afterimagePass.uniforms['damp'].value = v;
    afterimagePass.enabled = v > 0;
  });

const geometryFolder = gui.addFolder('Geometry');
geometryFolder.add(CONFIG, 'lineCount', 4, 80, 1).name('Number of Lines').onFinishChange(rebuildChunks);
geometryFolder.add(CONFIG, 'dotCount', 0, 400, 1).name('Number of Dots/Stars').onFinishChange(rebuildChunks);
geometryFolder.add(CONFIG, 'curvature', 0, 2, 0.01).name('Line Curvature').onFinishChange(rebuildChunks);
geometryFolder.add(CONFIG, 'lineThickness', 0.05, 3, 0.05).name('Line Thickness').onFinishChange(rebuildChunks);

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  currentDistance += (targetDistance - currentDistance) * Math.min(1, dt * 4.5);
  tendrilMaterial.uniforms.uTime.value = time;
  sharedVeilUniforms.uTime.value = time;

  if (camera.fov !== dollyValues.fov) {
    camera.fov = dollyValues.fov;
    camera.updateProjectionMatrix();
  }

  const camZ = -currentDistance;
  const driftX = Math.sin(time * 0.35) * 0.18;
  const driftY = Math.cos(time * 0.27) * 0.14;
  camera.position.set(tunnelOffsetX(camZ) + driftX, tunnelOffsetY(camZ) + driftY, camZ);
  const aheadZ = camZ - 14;
  camera.lookAt(tunnelOffsetX(aheadZ) + driftX, tunnelOffsetY(aheadZ) + driftY, aheadZ);
  camera.rotation.x += dollyValues.tilt.x;
  camera.rotation.y += dollyValues.tilt.y;
  camera.rotation.z += Math.sin(time * 0.15) * 0.04 + dollyValues.tilt.z;

  const baseIndex = Math.floor(currentDistance / SEGMENT_LENGTH) - Math.floor(POOL_SIZE / 2);
  for (let k = 0; k < POOL_SIZE; k++) {
    const segIndex = baseIndex + k;
    const variant = CHUNK_VARIANTS[((segIndex % 2) + 2) % 2];
    const z = -segIndex * SEGMENT_LENGTH;

    const mesh = tendrilMeshes[k];
    mesh.position.z = z;
    mesh.geometry = variant.tendrilGeo;
    mesh.rotation.z = segIndex * 0.9 + time * 0.025;

    const motes = moteClouds[k];
    motes.position.z = z;
    motes.geometry = variant.moteGeo;
    motes.rotation.z = mesh.rotation.z;

    const core = coreSprites[k];
    const coreZ = z - SEGMENT_LENGTH;
    core.position.set(tunnelOffsetX(coreZ), tunnelOffsetY(coreZ), coreZ);
    const pulse = 1 + 0.18 * Math.sin(time * 1.6 + segIndex * 1.7);
    const coreDist = Math.abs(coreZ - camera.position.z);
    const proximityFade = THREE.MathUtils.smoothstep(coreDist, 6, 30);
    core.scale.setScalar(3.4 * pulse * proximityFade);

    const veilSlot = veilSlots[((segIndex % POOL_SIZE) + POOL_SIZE) % POOL_SIZE];
    if (veilSlot.segIndex !== segIndex) seedVeilChunk(veilSlot, segIndex);

    const bgStarSlot = bgStarSlots[((segIndex % POOL_SIZE) + POOL_SIZE) % POOL_SIZE];
    if (bgStarSlot.segIndex !== segIndex) seedBgStars(bgStarSlot, segIndex);
  }

  for (const slot of veilSlots) {
    for (const veil of slot.veils) {
      if (!veil.visible) continue;
      const b = 1 + Math.sin(time * 0.6 + veil.userData.breathePhase) * 0.15;
      veil.scale.set(veil.userData.scaleX * b, veil.userData.scaleY * b, 1);
      veil.rotation.z += veil.userData.spin * dt;
    }
  }

  composer.render();
}

animate();
