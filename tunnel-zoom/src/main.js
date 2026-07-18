import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// Live-tunable config, driven by the lil-gui panel
// ---------------------------------------------------------------------------
const CONFIG = {
  color: '#3658ff',
  bloomStrength: 0.85,
  bloomRadius: 1.25,
  bloomThreshold: 0.42,
  movementSpeed: 0.16,
  zoomMultiplier: 0.6,
  motionBlur: 0.5,
  lineCount: 24,
  dotCount: 90,
  softLines: true, // fresnel soft-streak material vs the original solid tubes
  wireframe: false,
  edgeSoftness: 1.6,
  tubeBrightness: 1.8,
  tubeOpacity: 0.92,
  pulseMode: true, // electric bursts travelling down each line
  pulseSpeed: 1.2,
  curvature: 1, // 0 = dead-straight lines, 1 = current organic wiggle
};

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------
const SEGMENT_LENGTH = 70; // depth (world units) of one repeating tunnel chunk
const POOL_SIZE = 4; // how many chunks are kept alive around the camera

// colors derived from CONFIG.color -- near/far/core/mote are tints & shades
// of a single primary hue, recomputed whenever the color picker changes.
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
// Tendril chunk builder — smooth, sinuous tube "veins" radiating outward,
// thick and near the camera, tapering to a point deep in the tunnel.
// ---------------------------------------------------------------------------
function radiusProfile(t, rng) {
  // t = 0 at the near mouth of the chunk, 1 at the deep/far end
  const base = THREE.MathUtils.lerp(1, 0.08, t);
  const bump = 1 + 0.12 * CONFIG.curvature * Math.sin(t * (2 + rng() * 1.2) * Math.PI + rng() * 10);
  return Math.max(0.15, base * bump);
}

function taperTube(geometry, curve, tubularSegments, radialSegments, rng) {
  const pos = geometry.attributes.position;
  const ringSize = radialSegments + 1;
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  // per-vertex tube-axis direction (xyz) + normalized position along the tube
  // (w), used by the edge-fade shader to soften silhouettes and open tube ends
  const tangents = new Float32Array(pos.count * 4);
  // one random phase per tube so pulse bursts don't travel in lockstep
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
  // Each strand's "wide mouth" (near the camera) is staggered to a random
  // depth within the chunk's front half, instead of every strand peaking at
  // the same z -- otherwise all strands flare to max width in lockstep and
  // the camera periodically punches through a synchronized wall of tubes.
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
  const geo = new THREE.TubeGeometry(curve, tubularSegments, 0.14 + rng() * 0.08, radialSegments, false);
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
      const bGeo = new THREE.TubeGeometry(bCurve, 24, 0.14 + rng() * 0.08, 12, false);
      taperTube(bGeo, bCurve, 24, 12, rng);
      geometries.push(bGeo);
    }
  }

  const merged = mergeGeometries(geometries, false);
  merged.computeVertexNormals(); // taper displaced the verts, so rebuild normals for the edge-fade shader
  colorizeByDepth(merged);

  // sparse drifting motes/stars inside the chunk for depth cues
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

// Custom shader: brightness peaks where the tube surface faces the camera and
// falls off toward the silhouette edges, so each tube reads as a soft blurred
// streak of light instead of a hard-edged solid mesh.
const tendrilMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uOpacity: { value: CONFIG.tubeOpacity },
    uSoftness: { value: CONFIG.edgeSoftness },
    uIntensity: { value: CONFIG.tubeBrightness },
    uTime: { value: 0 },
    uPulseOn: { value: CONFIG.pulseMode ? 1 : 0 },
    uPulseSpeed: { value: CONFIG.pulseSpeed },
  },
  vertexShader: /* glsl */ `
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
      // A tube's silhouette is where the surface normal is perpendicular to
      // the view ray. Dividing by the view ray's off-axis component keeps the
      // center-bright / edge-fade profile stable even when the tube points
      // almost straight into the screen (the usual case in this tunnel).
      float tv = dot(normalize(vWorldTangent), viewDir);
      float denom = max(sqrt(1.0 - tv * tv), 0.08);
      float facing = clamp(abs(dot(normalize(vWorldNormal), viewDir)) / denom, 0.0, 1.0);
      float edge = pow(facing, uSoftness);
      // dissolve the open tube mouths instead of showing a hard rim
      float endFade = smoothstep(0.0, 0.18, vAxialT) * (1.0 - smoothstep(0.85, 1.0, vAxialT));
      // electric burst: a bright head with an exponential tail racing from the
      // line's near mouth toward its far tip, offset per-strand by vPhase
      float p = fract(vAxialT - uTime * uPulseSpeed * 0.35 + vPhase);
      float burst = exp(-p * 9.0);
      float pulseFactor = mix(1.0, 0.18 + 3.0 * burst, uPulseOn);
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      // boost color BEFORE fog so bright cores can exceed the bloom threshold
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

// the original solid tube look, kept around so the GUI can flip between modes
const solidTendrilMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.92,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

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
const gui = new GUI({ title: 'Tunnel Controls' });

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

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  currentDistance += (targetDistance - currentDistance) * Math.min(1, dt * 4.5);
  camera.position.z = -currentDistance;
  tendrilMaterial.uniforms.uTime.value = time;

  // gentle organic drift
  camera.position.x = Math.sin(time * 0.35) * 0.18;
  camera.position.y = Math.cos(time * 0.27) * 0.14;
  camera.rotation.z = Math.sin(time * 0.15) * 0.04;

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
    core.position.set(0, 0, coreZ);
    const pulse = 1 + 0.18 * Math.sin(time * 1.6 + segIndex * 1.7);
    // shrink cores as the camera closes in so passing one reads as a soft
    // glow drifting by instead of a full-screen whiteout
    const coreDist = Math.abs(coreZ - camera.position.z);
    const proximityFade = THREE.MathUtils.smoothstep(coreDist, 6, 30);
    core.scale.setScalar(3.4 * pulse * proximityFade);
  }

  composer.render();
}

animate();
