/**
 * Live grid (lines + nodes) in 3D — a few virtual cursors ("autoMovements", see below)
 * wander it on their own, fading in and out the same way the real mouse hover does.
 *
 * Everything is merged into TWO draw calls (one for the lines, one for the nodes)
 * rather than one per SVG path, so a single material can drive all of them. Strokes are
 * triangle ribbons so line width is real (WebGL LineSegments stay 1px).
 *
 * Fragments falling inside a window are cut by the stencil buffer (windows/stencil.ts),
 * which replaced a 312-iteration point-in-polygon loop over dynamically indexed
 * uniform arrays — the single most expensive thing this shader used to do, and a
 * genuine compile hazard on GLES2 hardware.
 */
import * as THREE from 'three';
import { CIRCLES, LINES, SVG_H, SVG_W } from '../data/svg-window-set';
import { applyTf, flattenPath, toWorld, WSCALE, type Point2 } from '../geometry/svg-path';
import { appendOpenRibbon } from '../geometry/ribbon';
import { camera, nearLayer } from '../core/stage';
import { getPointerNdc } from '../interaction/parallax';
import { cutOutWindows } from '../windows/stencil';
import { crispLocal, winCentersW } from '../windows/geometry';

/** Match the wall quad so strokes can reach the visible frame, not just the SVG box. */
const GRID_HALF_W = 26;
const GRID_HALF_H = 22;
/** World-space pad inside the SVG box — endpoints this close to the border get extended. */
const SVG_EDGE_PAD = 0.85;

function nearSvgBorder(p: Point2): boolean {
  const hx = (SVG_W / 2) * WSCALE;
  const hy = (SVG_H / 2) * WSCALE;
  return Math.abs(p[0]) > hx - SVG_EDGE_PAD || Math.abs(p[1]) > hy - SVG_EDGE_PAD;
}

/** Push a ray from `p` along unit `d` until it hits the grid bounding box. */
function rayToBox(p: Point2, d: Point2): Point2 {
  let t = Infinity;
  if (d[0] > 1e-8) t = Math.min(t, (GRID_HALF_W - p[0]) / d[0]);
  else if (d[0] < -1e-8) t = Math.min(t, (-GRID_HALF_W - p[0]) / d[0]);
  if (d[1] > 1e-8) t = Math.min(t, (GRID_HALF_H - p[1]) / d[1]);
  else if (d[1] < -1e-8) t = Math.min(t, (-GRID_HALF_H - p[1]) / d[1]);
  if (!Number.isFinite(t) || t < 0) return p;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** Keep interior node-connectors; stretch authored edge tips out to the wall. */
function extendEdgeTips(pts: readonly Point2[]): Point2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const out = pts.map((p) => [p[0], p[1]] as Point2);
  const stretch = (i: number, j: number) => {
    if (!nearSvgBorder(out[i])) return;
    const dx = out[i][0] - out[j][0];
    const dy = out[i][1] - out[j][1];
    const len = Math.hypot(dx, dy) || 1;
    out[i] = rayToBox(out[i], [dx / len, dy / len]);
  };
  stretch(0, 1);
  stretch(n - 1, n - 2);
  return out;
}

/** Each window's contour in world space (rest position — grid data was authored against it). */
const windowPolys: Point2[][] = crispLocal.map((pts, i) =>
  pts.map((p): Point2 => [p[0] + winCentersW[i][0], p[1] + winCentersW[i][1]]),
);

/** Endpoint-to-window gap this small (world units) is treated as an authoring shortfall — a
 *  connector stub meant to touch the window — rather than an unrelated line just passing by. */
const WINDOW_CONNECT_PAD = 0.35;

function distToPolygon(p: Point2, poly: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2));
    const d = Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ey * t));
    if (d < best) best = d;
  }
  return best;
}

/** First point where the ray `p + t*d` (t>0) crosses `poly`, or null if it never does. */
function rayToPolygon(p: Point2, d: Point2, poly: readonly Point2[]): Point2 | null {
  let bestT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denom = ex * d[1] - ey * d[0];
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / -denom;
    const s = (d[0] * (a[1] - p[1]) - d[1] * (a[0] - p[0])) / -denom;
    if (t > 1e-6 && t < bestT && s >= 0 && s <= 1) bestT = t;
  }
  return Number.isFinite(bestT) ? [p[0] + d[0] * bestT, p[1] + d[1] * bestT] : null;
}

/**
 * The SVG grid art and the window star shapes were authored independently and don't quite
 * line up — several connector stubs fall short of the window edge by a small, consistent
 * margin. Stretch those specific endpoints out to actually touch the window, the same way
 * `extendEdgeTips` stretches border-facing ones out to the wall.
 */
function extendToWindowEdges(pts: readonly Point2[]): Point2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const out = pts.map((p) => [p[0], p[1]] as Point2);
  const stretch = (i: number, j: number) => {
    let nearest = -1;
    let nearestD = WINDOW_CONNECT_PAD;
    for (let w = 0; w < windowPolys.length; w++) {
      const d = distToPolygon(out[i], windowPolys[w]);
      if (d < nearestD) {
        nearestD = d;
        nearest = w;
      }
    }
    if (nearest < 0) return;
    const dx = out[i][0] - out[j][0];
    const dy = out[i][1] - out[j][1];
    const len = Math.hypot(dx, dy) || 1;
    const hit = rayToPolygon(out[i], [dx / len, dy / len], windowPolys[nearest]);
    if (hit) out[i] = hit;
  };
  stretch(0, 1);
  stretch(n - 1, n - 2);
  return out;
}

export const gridState = {
  color: new THREE.Color(0.81, 0.65, 0.99),
  baseOpacity: 0.16,
  pulseSpeed: 0.35,
  pulseWidth: 0.22,
  pulseBright: 2.4,
  /** World-space half-width of each stroke (LineSegments cannot thicken in WebGL). */
  lineWidth: 0.01,
  /** Solid node stroke brightness (independent of the line pulse). */
  nodeBaseOpacity: 0.65,
  nodePulseBright: 2.4,
  /** 0 = even brightness to the rim, 1 = fade out toward the screen edge. */
  vignette: 1,
  /** How many lines carry a traveling pulse (the rest stay at base opacity). */
  pulseCount: 4,
  /** World-space radius of the mouse-follow highlight on nearby strokes. */
  mouseRadius: 2.8,
  mousePulse: 2.2,
};

/** 0 = normal, 1 = fully faded (Layer Outliner → grid.fade). */
let outlinerFade = 0;

export const gridGroup = new THREE.Group();
gridGroup.position.z = 0.06;
nearLayer.add(gridGroup);

export function setGridLayer(fade: number, render: number): void {
  outlinerFade = fade;
  gridGroup.visible = render >= 0.5;
}

/**
 * "autoMovements" are a handful of virtual cursors that wander the grid on their own — each
 * lit with the exact same radius-based glow formula as the real mouse hover (see
 * uMouse/uMouseR/uMouseB below), so a line and any node it runs into always light up
 * together at the same rate. Unlike a real cursor they fade in, wander, fade out, and
 * vanish for a while before reappearing elsewhere — see updateAutoMovements below.
 */
const MAX_PULSES = 8;

/* ---------- lines: one merged ribbon mesh (real width) ---------- */

const linePos: number[] = [];
const lineOff: number[] = [];
const lineIdx: number[] = [];

const STROKE_N = LINES.length;
for (let li = 0; li < STROKE_N; li++) {
  const flat = extendToWindowEdges(extendEdgeTips(flattenPath(LINES[li], 1).map(toWorld)));
  if (flat.length < 2) continue;
  appendOpenRibbon(flat, linePos, lineOff, lineIdx);
}

const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
lineGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(lineOff, 3));
lineGeo.setIndex(lineIdx);

const lineMat = cutOutWindows(
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: gridState.color.clone() },
      uBase: { value: gridState.baseOpacity },
      uWidth: { value: gridState.lineWidth },
      uVignette: { value: gridState.vignette },
      uMouse: { value: new THREE.Vector2() },
      uMouseInvR2: { value: 1 / gridState.mouseRadius ** 2 },
      uMouseB: { value: gridState.mousePulse },
      uPulsePos: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector2(1e4, 1e4)) },
      uPulseAmt: { value: new Array(MAX_PULSES).fill(0) },
      uPulseInvR2: { value: 1 / gridState.mouseRadius ** 2 },
      uPulseBright: { value: gridState.pulseBright },
      uActiveCount: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute vec3 aOffset; uniform float uWidth;
      varying vec2 vNdc, vXY;
      void main(){
        vec3 pos=position+aOffset*uWidth;
        vXY=pos.xy;
        vec4 clip=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
        vNdc=clip.xy/clip.w;
        gl_Position=clip;
      }`,
    // Squared-distance math avoids a sqrt (length()) and a pow() per pulse per fragment;
    // uActiveCount lets the loop skip slots beyond pulseCount instead of always doing all 8.
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBase,uVignette,uMouseInvR2,uMouseB,uPulseInvR2,uPulseBright; uniform int uActiveCount; uniform vec2 uMouse; uniform vec2 uPulsePos[${MAX_PULSES}]; uniform float uPulseAmt[${MAX_PULSES}]; varying vec2 vNdc, vXY;
      void main(){
        float pulse=0.0;
        for (int i=0;i<${MAX_PULSES};i++){
          if (i>=uActiveCount) break;
          vec2 d=vXY-uPulsePos[i];
          pulse=max(pulse, exp(-dot(d,d)*uPulseInvR2)*uPulseBright*uPulseAmt[i]);
        }
        vec2 dm=vXY-uMouse;
        float mouse=exp(-dot(dm,dm)*uMouseInvR2)*uMouseB;
        float vig=mix(1.0, 1.0-smoothstep(0.42,0.98,length(vNdc)), uVignette);
        float a=(uBase+pulse+mouse)*vig;
        float ac=min(a,1.0);
        gl_FragColor=vec4(uColor*ac, ac); }`,
  }),
);

const gridLines = new THREE.Mesh(lineGeo, lineMat);
gridLines.renderOrder = 1.5;
gridLines.frustumCulled = false;
gridGroup.add(gridLines);

/* ---------- nodes: one merged ribbon mesh ---------- */

const NODE_SEG = 64;
const nodePos: number[] = [];
const nodeOff: number[] = [];
const nodeIdx: number[] = [];

for (let ci = 0; ci < CIRCLES.length; ci++) {
  const cir = CIRCLES[ci];
  const [wx, wy] = applyTf(cir.tf, cir.cx, cir.cy);
  const c: Point2 = toWorld([wx, wy]);
  const r = cir.r * WSCALE;

  const loop: Point2[] = [];
  for (let i = 0; i <= NODE_SEG; i++) {
    const a = (i / NODE_SEG) * Math.PI * 2;
    loop.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  appendOpenRibbon(loop, nodePos, nodeOff, nodeIdx);
}

const nodeGeo = new THREE.BufferGeometry();
nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePos, 3));
nodeGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(nodeOff, 3));
nodeGeo.setIndex(nodeIdx);

const nodeMat = cutOutWindows(
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: gridState.color.clone() },
      uBright: { value: gridState.nodeBaseOpacity },
      uWidth: { value: gridState.lineWidth },
      uMouse: { value: new THREE.Vector2() },
      uMouseInvR2: { value: 1 / gridState.mouseRadius ** 2 },
      uMouseB: { value: gridState.mousePulse },
      uPulsePos: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector2(1e4, 1e4)) },
      uPulseAmt: { value: new Array(MAX_PULSES).fill(0) },
      uPulseInvR2: { value: 1 / gridState.mouseRadius ** 2 },
      uPulseBright: { value: gridState.pulseBright },
      uActiveCount: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute vec3 aOffset; uniform float uWidth;
      varying vec2 vXY;
      void main(){
        vec3 pos=position+aOffset*uWidth;
        vXY=pos.xy;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBright,uMouseInvR2,uMouseB,uPulseInvR2,uPulseBright; uniform int uActiveCount; uniform vec2 uMouse; uniform vec2 uPulsePos[${MAX_PULSES}]; uniform float uPulseAmt[${MAX_PULSES}]; varying vec2 vXY;
      void main(){
        float pulse=0.0;
        for (int i=0;i<${MAX_PULSES};i++){
          if (i>=uActiveCount) break;
          vec2 d=vXY-uPulsePos[i];
          pulse=max(pulse, exp(-dot(d,d)*uPulseInvR2)*uPulseBright*uPulseAmt[i]);
        }
        vec2 dm=vXY-uMouse;
        float mouse=exp(-dot(dm,dm)*uMouseInvR2)*uMouseB;
        float a=uBright+pulse+mouse;
        float ac=min(a,1.0);
        gl_FragColor=vec4(uColor*ac, ac); }`,
  }),
);

const gridNodes = new THREE.Mesh(nodeGeo, nodeMat);
gridNodes.renderOrder = 1.5;
gridNodes.frustumCulled = false;
gridGroup.add(gridNodes);

const _ndc = new THREE.Vector2();
const _ray = new THREE.Ray();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _normal = new THREE.Vector3();

function mouseInGridLocal(out: THREE.Vector2): void {
  const p = getPointerNdc();
  _ndc.set(p.x, p.y);
  _ray.origin.copy(camera.position);
  _ray.direction.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  gridGroup.getWorldPosition(_origin);
  _normal.set(0, 0, 1).transformDirection(gridGroup.matrixWorld);
  _plane.setFromNormalAndCoplanarPoint(_normal, _origin);
  if (!_ray.intersectPlane(_plane, _hit)) {
    out.set(0, 0);
    return;
  }
  gridGroup.worldToLocal(_hit);
  out.set(_hit.x, _hit.y);
}

/* ---------- autoMovements: virtual cursors that wander, fade, and vanish on their own ---------- */

/** Roughly the visible SVG box, so autoMovements wander where the grid actually is. */
const WANDER_HALF_W = (SVG_W / 2) * WSCALE * 0.9;
const WANDER_HALF_H = (SVG_H / 2) * WSCALE * 0.9;
/** Seconds to fade in or out. */
const FADE_TIME = 1.2;
/** How close to a target counts as "arrived" — picks a new wander target. */
const ARRIVE_DIST = 0.3;

function randomPointInBounds(out: THREE.Vector2): void {
  out.set((Math.random() * 2 - 1) * WANDER_HALF_W, (Math.random() * 2 - 1) * WANDER_HALF_H);
}

type MovementPhase = 'in' | 'active' | 'out' | 'hidden';

interface AutoMovement {
  pos: THREE.Vector2;
  target: THREE.Vector2;
  /** Brightness multiplier, 0 (invisible) to 1 (full pulseBright). */
  amt: number;
  phase: MovementPhase;
  /** Seconds remaining in the current phase. */
  timer: number;
}

function spawnHidden(): AutoMovement {
  const pos = new THREE.Vector2();
  const target = new THREE.Vector2();
  randomPointInBounds(pos);
  randomPointInBounds(target);
  // Stagger first appearances so all movements don't fade in together.
  return { pos, target, amt: 0, phase: 'hidden', timer: Math.random() * 5 };
}

const autoMovements: AutoMovement[] = Array.from({ length: MAX_PULSES }, spawnHidden);

/** Random duration (seconds) an autoMovement stays fully visible before fading out again. */
function randomActiveDuration(): number {
  return 3 + Math.random() * 5;
}
/** Random duration (seconds) an autoMovement stays vanished before reappearing elsewhere. */
function randomHiddenDuration(): number {
  return 2 + Math.random() * 4;
}

function updateAutoMovements(dt: number, wanderSpeed: number, activeCount: number): void {
  for (let i = 0; i < autoMovements.length; i++) {
    const m = autoMovements[i];
    if (i >= activeCount) {
      m.phase = 'hidden';
      m.amt = 0;
      continue;
    }

    m.timer -= dt;
    switch (m.phase) {
      case 'hidden':
        m.amt = 0;
        if (m.timer <= 0) {
          randomPointInBounds(m.pos);
          randomPointInBounds(m.target);
          m.phase = 'in';
          m.timer = FADE_TIME;
        }
        break;
      case 'in':
        m.amt = 1 - Math.max(0, m.timer) / FADE_TIME;
        if (m.timer <= 0) {
          m.phase = 'active';
          m.timer = randomActiveDuration();
          m.amt = 1;
        }
        break;
      case 'active':
        m.amt = 1;
        if (m.timer <= 0) {
          m.phase = 'out';
          m.timer = FADE_TIME;
        }
        break;
      case 'out':
        m.amt = Math.max(0, m.timer) / FADE_TIME;
        if (m.timer <= 0) {
          m.phase = 'hidden';
          m.timer = randomHiddenDuration();
          m.amt = 0;
        }
        break;
    }

    if (m.phase === 'hidden') continue;
    const dx = m.target.x - m.pos.x;
    const dy = m.target.y - m.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_DIST) {
      randomPointInBounds(m.target);
    } else {
      const step = Math.min(wanderSpeed * dt, dist);
      m.pos.x += (dx / dist) * step;
      m.pos.y += (dy / dist) * step;
    }
  }
}

/**
 * Sync a material's shared "point + radius" glow uniforms — the same formula drives the
 * mouse hover and every autoMovement, on both the line and node meshes, so nothing can
 * light up at a different rate or fail to light up together.
 */
function syncGlowUniforms(mat: THREE.ShaderMaterial, k: number, activeCount: number): void {
  (mat.uniforms.uColor.value as THREE.Color).copy(gridState.color);
  const invR2 = 1 / Math.max(gridState.mouseRadius, 0.0001) ** 2;
  mat.uniforms.uMouseInvR2.value = invR2;
  mat.uniforms.uMouseB.value = gridState.mousePulse * k;
  mat.uniforms.uPulseInvR2.value = invR2;
  mat.uniforms.uPulseBright.value = gridState.pulseBright * k;
  mat.uniforms.uActiveCount.value = activeCount;
  const destPos = mat.uniforms.uPulsePos.value as THREE.Vector2[];
  const destAmt = mat.uniforms.uPulseAmt.value as number[];
  for (let i = 0; i < activeCount; i++) {
    destPos[i].copy(autoMovements[i].pos);
    destAmt[i] = autoMovements[i].amt;
  }
}

let lastUpdateTime = -1;

export function updateGrid(time: number): void {
  const k = 1 - outlinerFade;

  // `time` is the distance-compensated accumulator from main.ts, not wall-clock — treat the
  // delta between calls as this frame's dt. Clamp so a tab coming back from background/a
  // dev-reload doesn't make every movement jump or fast-forward through its whole lifecycle.
  const dt = lastUpdateTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - lastUpdateTime));
  lastUpdateTime = time;

  const activeCount = Math.min(MAX_PULSES, Math.max(0, Math.round(gridState.pulseCount)));
  const wanderSpeed = Math.max(0, gridState.pulseSpeed) * 1.2;
  updateAutoMovements(dt, wanderSpeed, activeCount);

  const u = lineMat.uniforms;
  u.uBase.value = gridState.baseOpacity * k;
  u.uWidth.value = gridState.lineWidth;
  u.uVignette.value = gridState.vignette;
  mouseInGridLocal(u.uMouse.value as THREE.Vector2);
  syncGlowUniforms(lineMat, k, activeCount);

  nodeMat.uniforms.uBright.value = gridState.nodeBaseOpacity * k;
  nodeMat.uniforms.uWidth.value = gridState.lineWidth;
  (nodeMat.uniforms.uMouse.value as THREE.Vector2).copy(u.uMouse.value as THREE.Vector2);
  syncGlowUniforms(nodeMat, k, activeCount);
}
