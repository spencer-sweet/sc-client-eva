import * as THREE from 'three';
import GUI from 'lil-gui';

// A small field of soft, blurry "stars" that drift in imperfect oval orbits
// (a base ellipse plus a slower wobble term, so no two loops trace the same
// path) and drag a fading trail behind them. Inspired by the glowing,
// trail-leaving sparkles in the EVA deck: additive blending on a dark navy
// field so overlapping glows bloom into each other.
//
// Each trail is a tapered *ribbon* (a triangle strip generated from the last
// N positions) shaded so it's soft at the edges and fades to nothing at the
// tail — a plain WebGL line can't be thickened, and this reads as a blurry
// streak instead of a hairline. Everything lives in pixel-ish world units
// under an orthographic camera, with orbit sizes/centers stored normalized to
// the viewport and resolved live, so the composition survives any resize.

const params = {
  count: 32,
  seed: 7,

  lifeOrbits: 0.5,      // how many times a star orbits before it fades out
  lifeFade: 0.44,       // fraction of life spent fading in / out (ephemerality)

  tunnel: 0,            // 0 = flat orbit, 1 = zoom forward through a tunnel

  rotX: -60,            // scene rotation (degrees) — tilt to view the tunnel
  rotY: 0,              //   from the side / above
  rotZ: 0,

  speed: 0.76,          // global angular speed
  orbitScale: 0.53,     // base orbit radius as a fraction of the short side
  orbitSpread: 0.06,    // how far orbit centers scatter from screen center
  ovalness: 0.12,       // how much rx and ry are allowed to differ
  wobble: 0.08,         // strength of the secondary, path-breaking term

  trailLength: 7.0,     // how far back (in orbit time) the trail reaches
  trailWidth: 8,        // ribbon half-width at the head (px)
  trailFade: 1.0,       // taper exponent — higher = quicker fade toward tail
  trailIntensity: 1.15, // overall trail brightness

  glowSize: 44,         // head glow diameter (px)
  glowIntensity: 1.05,  // head glow brightness

  colorA: '#7fe9ff',    // palette the per-star colors are drawn from
  colorB: '#4bb8ff',
  colorC: '#c9a6ff',
  background: '#070c24',
};

// Fixed ribbon resolution. The trail is resampled analytically from the orbit
// path every frame (not recorded from past frames), so it's always full-length
// and completely independent of framerate / tab throttling.
const SAMPLES = 256;
const scratch = new Float32Array(SAMPLES * 3); // reused center-point buffer (x,y,z)

// Tunnel depth: in tunnel mode a star travels along the view axis (Z) from
// Z_BACK (deep in the scene) toward Z_FRONT (near the camera). These are
// fractions of the camera distance; perspective then produces the zoom, and
// because the depth is real the tunnel can be viewed from any angle.
const Z_FRONT = 0.6;  // × camDist, just in front of the z=0 plane
const Z_BACK = -1.25; // × camDist, into the scene (less compression = longer streaks)

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.background);

// Perspective camera calibrated so the z=0 plane maps 1:1 to pixels — the
// head-on (un-rotated) view is identical to the old orthographic one.
const FOV = 55;
let halfW = window.innerWidth / 2;
let halfH = window.innerHeight / 2;
let camDist = halfH / Math.tan((FOV * Math.PI) / 360);
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 1, 1e6);
camera.position.set(0, 0, camDist);
camera.lookAt(0, 0, 0);

// reusable temporaries for per-frame billboarding math
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// ---------------------------------------------------------------
// Seeded RNG so the "seed" slider gives reproducible orbit fields
// ---------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------
// Head glow texture: a single soft, blurry radial dot (no spikes),
// baked once into a white alpha texture and tinted per-star.
// ---------------------------------------------------------------
function makeGlowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;

  // small bright core that dissolves into a wide soft halo
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
const glowTexture = makeGlowTexture();

// ---------------------------------------------------------------
// Trail ribbon shader — soft across the width, faded along the length
// ---------------------------------------------------------------
const trailVertex = `
  attribute float aSide;
  attribute float aT;
  varying float vSide;
  varying float vT;
  void main() {
    vSide = aSide;
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const trailFragment = `
  uniform vec3 uColor;
  uniform float uFade;
  uniform float uIntensity;
  varying float vSide;
  varying float vT;
  void main() {
    float edge = exp(-3.2 * vSide * vSide); // gaussian across width -> very soft/blurred
    float lenFade = pow(clamp(1.0 - vT, 0.0, 1.0), uFade);
    float a = edge * lenFade * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// ---------------------------------------------------------------
// Stars
// ---------------------------------------------------------------
const starGroup = new THREE.Group();
scene.add(starGroup);

let stars = [];
let time = 0;
// respawns draw from a persistent stream so a given seed stays reproducible
let spawnRng = mulberry32(1);

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function paletteColor(rng) {
  // pick one of the three palette anchors, then nudge its hue a little so
  // stars sharing an anchor still read as individuals
  const anchors = [params.colorA, params.colorB, params.colorC];
  const base = new THREE.Color(anchors[Math.floor(rng() * anchors.length) % anchors.length]);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  hsl.h = (hsl.h + (rng() - 0.5) * 0.06 + 1) % 1;
  hsl.l = Math.min(1, hsl.l * (0.9 + rng() * 0.25));
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
}

function disposeStars() {
  for (const s of stars) {
    s.ribbon.geometry.dispose();
    s.ribbon.material.dispose();
    s.sprite.material.dispose();
  }
  starGroup.clear();
  stars = [];
}

function buildStars() {
  disposeStars();
  // reseed the shared spawn stream so the field (and its respawns) is
  // reproducible for a given seed
  spawnRng = mulberry32(params.seed * 2654435761);

  for (let i = 0; i < params.count; i++) {
    // --- trail ribbon: 2 verts per sample, indexed triangle strip ---
    // aSide (±1 across width) and aT (0=head → 1=tail) are constant per vertex,
    // so they're filled once here; only the positions move each frame.
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(SAMPLES * 2 * 3);
    const side = new Float32Array(SAMPLES * 2);
    const tAttr = new Float32Array(SAMPLES * 2);
    const indices = new Uint32Array((SAMPLES - 1) * 6);
    const denom = SAMPLES - 1;
    for (let k = 0; k < SAMPLES; k++) {
      side[k * 2] = 1;
      side[k * 2 + 1] = -1;
      tAttr[k * 2] = k / denom;
      tAttr[k * 2 + 1] = k / denom;
    }
    for (let k = 0; k < SAMPLES - 1; k++) {
      const v = k * 2;
      const o = k * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 3;
      indices[o + 5] = v + 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const ribbonMat = new THREE.ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uFade: { value: params.trailFade },
        uIntensity: { value: params.trailIntensity },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide, // winding flips with orbit direction; never cull
    });
    const ribbon = new THREE.Mesh(geo, ribbonMat);
    ribbon.frustumCulled = false;
    starGroup.add(ribbon);

    // --- head glow sprite ---
    const spriteMat = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    starGroup.add(sprite);

    const s = { ribbon, sprite, positions };
    randomizeOrbit(s);
    // stagger initial lives so they don't all fade together, and give each a
    // full-grown trail right away (born far enough in the past to fill it)
    s.age = spawnRng() * params.lifeOrbits * s.lifeMul;
    s.birthT = time - params.trailLength;
    stars.push(s);
  }
}

// (Re)roll a star's orbit + lifespan. Used at build time and on every respawn,
// so a dying star is replaced by a fresh one on a slightly different path.
function randomizeOrbit(s) {
  const rng = spawnRng;
  s.color = paletteColor(rng);
  // normalized orbit params (resolved to pixels every frame)
  s.ncx = (rng() * 2 - 1) * params.orbitSpread;
  s.ncy = (rng() * 2 - 1) * params.orbitSpread;
  s.radMul = 0.55 + rng() * 0.6;
  s.aspect = 1 + (rng() * 2 - 1) * params.ovalness;
  s.speedMul = 0.6 + rng() * 0.9;
  s.dir = rng() < 0.5 ? -1 : 1;
  s.phase = rng() * Math.PI * 2;
  s.head = s.phase; // accumulated head angle (advanced each frame)
  s.omega = 0;      // current signed angular rate (set per frame)
  // epicycle: a small circle riding the main orbit -> gentle swirl, not loops
  s.epiFreq = 1 + Math.floor(rng() * 2); // 1–2 -> a slow sway rather than petals
  s.epiMul = 0.55 + rng() * 0.5;
  s.epiDir = rng() < 0.5 ? -1 : 1;
  s.epiPhase = rng() * Math.PI * 2;
  s.lifeMul = 0.6 + rng() * 0.8; // per-star lifespan variation
  // tunnel mode: fixed heading out from center + how far out it flies
  s.warpAngle = rng() * Math.PI * 2;
  s.warpRad = 0.7 + rng() * 0.7;
}

// Position of a star at parametric time t, in current pixel space. Blends its
// flat elliptical orbit (with epicyclic swirl) into a tunnel-zoom path as
// `params.tunnel` rises. Returns the star's age fraction at time t (0=birth,
// 1=death), which the tunnel path uses as its forward depth.
function starPositionInto(s, t, out, o) {
  const minHalf = Math.min(halfW, halfH);
  const cx = s.ncx * halfW;
  const cy = s.ncy * halfH;
  const rBase = params.orbitScale * minHalf * s.radMul;

  // age fraction at time t (extrapolated from the current age)
  const life = Math.max(0.01, params.lifeOrbits * s.lifeMul);
  const rate = (Math.abs(params.speed) * s.speedMul) / (Math.PI * 2); // revs / t-unit
  let a = (s.age + (t - time) * rate) / life;
  a = a < 0 ? 0 : a > 1 ? 1 : a;

  // travel direction: speed > 0 flies out toward the camera, speed < 0 flies
  // in toward the vanishing point (down the tunnel). "depth" is proximity to
  // the camera (0 = deep in the scene, 1 = near the camera).
  const depth = params.speed < 0 ? 1 - a : a;

  const w = params.tunnel;

  // One unified trajectory rather than a blend of two moving points (which
  // beat against each other and curl into loops mid-transition):
  //  - angular speed eases from the orbit rate down to the tunnel's slow spin
  //  - the flat ellipse becomes a fixed-radius ring travelling along Z
  //  - the ellipse rounds to a circle, epicycle + centre offset fade out
  //
  // The head angle (s.head) is *accumulated* per frame, not recomputed from
  // absolute time, so changing speed/tunnel eases the motion smoothly instead
  // of teleporting every star (omega * large-t would jump on any change).
  // Trail samples are offset back from the head by the current angular rate.
  const theta = s.head + (t - time) * s.omega;

  // in-plane radius blends ellipse -> tunnel ring; depth becomes a real Z so
  // perspective (not a fake 1/z) does the zoom, and the tunnel has true depth.
  const ringR = minHalf * 0.5 * s.warpRad;
  const R = rBase + (ringR - rBase) * w;
  const asp = 1 + (s.aspect - 1) * (1 - w);
  const zAxis = w * camDist * (Z_BACK + (Z_FRONT - Z_BACK) * depth);

  const phi = theta * s.epiFreq * s.epiDir + s.epiPhase;
  const er = params.wobble * rBase * s.epiMul * (1 - w);

  out[o] = cx * (1 - w) + R * Math.cos(theta) + er * Math.cos(phi);
  out[o + 1] = cy * (1 - w) + R * asp * Math.sin(theta) + er * Math.sin(phi);
  out[o + 2] = zAxis;
  return depth;
}

// ---------------------------------------------------------------
// Per-frame update: resample each orbit path backwards in time into a
// tapered ribbon, then place the head glow at the leading sample.
// ---------------------------------------------------------------
const DEG = Math.PI / 180;

// numeric params that feed the position math; a non-finite one (e.g. an empty
// GUI text field) would spread NaN into every vertex, so they're clamped first
const NUMERIC_PARAMS = [
  'speed', 'tunnel', 'orbitScale', 'orbitSpread', 'ovalness', 'wobble',
  'trailLength', 'trailWidth', 'trailFade', 'trailIntensity',
  'glowSize', 'glowIntensity', 'lifeOrbits', 'lifeFade', 'rotX', 'rotY', 'rotZ',
];

function updateStars(dt) {
  time += dt;
  const denom = SAMPLES - 1;

  // safety net: never let a stray non-finite value reach the geometry
  for (const k of NUMERIC_PARAMS) {
    if (!Number.isFinite(params[k])) params[k] = 0;
  }

  // apply the scene rotation, then find the camera's "toward-camera" direction
  // in the group's local space so trail ribbons can billboard to face it
  starGroup.rotation.set(params.rotX * DEG, params.rotY * DEG, params.rotZ * DEG);
  _q.copy(starGroup.quaternion).invert();
  _v.set(0, 0, 1).applyQuaternion(_q);
  const vx = _v.x;
  const vy = _v.y;
  const vz = _v.z;

  for (const s of stars) {
    // --- lifecycle: age in revolutions, fade in/out, respawn when spent ---
    // always ages forward, regardless of travel direction (speed sign)
    s.age += (Math.abs(params.speed) * s.speedMul * dt) / (Math.PI * 2);
    const life = Math.max(0.01, params.lifeOrbits * s.lifeMul);
    if (s.age >= life) {
      randomizeOrbit(s); // reborn as a fresh star on a new path
      s.age = 0;
      s.birthT = time;
    }
    const p = s.age / life;
    const lifeAlpha = smoothstep(0, params.lifeFade, p) * (1 - smoothstep(1 - params.lifeFade, 1, p));

    // advance the accumulated head angle at the current (speed/tunnel-eased)
    // rate; sampling reads s.omega so changes stay smooth, never a jump
    s.omega = params.speed * s.speedMul * (1 - 0.5 * params.tunnel) * s.dir;
    s.head += s.omega * dt;

    // trail only reaches back to the star's birth, so a newborn's trail grows
    // in from nothing rather than appearing fully formed
    const span = Math.min(params.trailLength, time - s.birthT);

    // sample the path: k=0 is the head (now), k=denom is the tail (oldest)
    for (let k = 0; k < SAMPLES; k++) {
      const tk = time - (k / denom) * span;
      starPositionInto(s, tk, scratch, k * 3);
    }

    // Build the ribbon by offsetting each sample ±perp with a tapering width.
    // perp = tangent × view, so the ribbon always faces the camera (from any
    // scene rotation); perspective alone handles near-thick / far-thin.
    let px = 0;
    let py = 1;
    let pz = 0; // fallback perpendicular
    for (let k = 0; k < SAMPLES; k++) {
      const cx = scratch[k * 3];
      const cy = scratch[k * 3 + 1];
      const cz = scratch[k * 3 + 2];
      const pk = k > 0 ? k - 1 : k;
      const nk = k < denom ? k + 1 : k;
      // tangent along the path (prev sample is toward the head)
      const tx = scratch[pk * 3] - scratch[nk * 3];
      const ty = scratch[pk * 3 + 1] - scratch[nk * 3 + 1];
      const tz = scratch[pk * 3 + 2] - scratch[nk * 3 + 2];
      // perp = tangent × viewDir (local space)
      let ex = ty * vz - tz * vy;
      let ey = tz * vx - tx * vz;
      let ez = tx * vy - ty * vx;
      const el = Math.hypot(ex, ey, ez);
      if (el > 1e-4) {
        px = ex / el;
        py = ey / el;
        pz = ez / el;
      }
      const frac = k / denom;
      const halfWidth = params.trailWidth * (0.12 + 0.88 * (1 - frac));

      const a = k * 6;
      s.positions[a] = cx + px * halfWidth;
      s.positions[a + 1] = cy + py * halfWidth;
      s.positions[a + 2] = cz + pz * halfWidth;
      s.positions[a + 3] = cx - px * halfWidth;
      s.positions[a + 4] = cy - py * halfWidth;
      s.positions[a + 5] = cz - pz * halfWidth;
    }

    const geo = s.ribbon.geometry;
    geo.attributes.position.needsUpdate = true;
    s.ribbon.material.uniforms.uColor.value.copy(s.color);
    s.ribbon.material.uniforms.uFade.value = params.trailFade;
    s.ribbon.material.uniforms.uIntensity.value = params.trailIntensity * lifeAlpha;

    // head glow at the leading sample (perspective scales it with depth)
    s.sprite.position.set(scratch[0], scratch[1], scratch[2]);
    s.sprite.scale.setScalar(params.glowSize);
    s.sprite.material.color.copy(s.color);
    s.sprite.material.opacity = params.glowIntensity * lifeAlpha;
  }
}

// ---------------------------------------------------------------
// GUI
// ---------------------------------------------------------------
const gui = new GUI({ title: 'spiraling stars' });
gui.add(params, 'count', 1, 40, 1).name('star count').onFinishChange(buildStars);
gui.add(params, 'seed', 1, 999, 1).name('seed').onFinishChange(buildStars);
gui.add(params, 'tunnel', 0, 1, 0.01).name('orbit → tunnel');

const life = gui.addFolder('life');
life.add(params, 'lifeOrbits', 0.5, 20, 0.5).name('orbits before fade');
life.add(params, 'lifeFade', 0.05, 0.5, 0.01).name('fade in / out');

const motion = gui.addFolder('motion');
motion.add(params, 'speed', -1.5, 1.5, 0.01).name('speed (– = into tunnel)');
motion.add(params, 'orbitScale', 0.05, 0.6, 0.01).name('orbit size');
motion.add(params, 'orbitSpread', 0, 0.7, 0.01).name('orbit scatter').onFinishChange(buildStars);
motion.add(params, 'ovalness', 0, 1, 0.01).name('ovalness').onFinishChange(buildStars);
motion.add(params, 'wobble', 0, 1.2, 0.01).name('loop size');

const trail = gui.addFolder('trail');
trail.add(params, 'trailLength', 0.5, 24, 0.1).name('length');
trail.add(params, 'trailWidth', 1, 60, 1).name('width');
trail.add(params, 'trailFade', 0.4, 4, 0.05).name('fade taper');
trail.add(params, 'trailIntensity', 0.1, 2, 0.05).name('brightness');

const glow = gui.addFolder('glow');
glow.add(params, 'glowSize', 10, 160, 1).name('size');
glow.add(params, 'glowIntensity', 0.1, 2.5, 0.05).name('brightness');

const view = gui.addFolder('scene rotation');
view.add(params, 'rotX', -180, 180, 1).name('rotate X');
view.add(params, 'rotY', -180, 180, 1).name('rotate Y');
view.add(params, 'rotZ', -180, 180, 1).name('rotate Z');

const color = gui.addFolder('color');
color.addColor(params, 'colorA').name('palette A').onFinishChange(buildStars);
color.addColor(params, 'colorB').name('palette B').onFinishChange(buildStars);
color.addColor(params, 'colorC').name('palette C').onFinishChange(buildStars);
color.addColor(params, 'background').name('background').onChange((v) => scene.background.set(v));

// ---------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------
function onResize() {
  halfW = window.innerWidth / 2;
  halfH = window.innerHeight / 2;
  camDist = halfH / Math.tan((FOV * Math.PI) / 360);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.z = camDist;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

buildStars();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateStars(dt);
  renderer.render(scene, camera);
}
animate();
