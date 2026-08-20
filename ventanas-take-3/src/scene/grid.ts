/**
 * Live grid (lines + nodes) in 3D — the color travels along each line every so often.
 *
 * Everything is merged into TWO draw calls (one for the lines, one for the nodes)
 * rather than one per SVG path: the per-line pulse offset rides along as a vertex
 * attribute, so a single material can drive all of them. Strokes are triangle
 * ribbons so line width is real (WebGL LineSegments stay 1px).
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

/* ---------- lines: one merged ribbon mesh (real width) ---------- */

const linePos: number[] = [];
const lineOff: number[] = [];
const lineProg: number[] = [];
const linePhase: number[] = [];
const lineRank: number[] = [];
const lineIdx: number[] = [];

const STROKE_N = LINES.length;
for (let li = 0; li < STROKE_N; li++) {
  const flat = extendEdgeTips(flattenPath(LINES[li], 1).map(toWorld));
  if (flat.length < 2) continue;
  const phase0 = (li * 0.61) % 1.0;
  /** Spread ranks so the first N pulses are not all clustered on adjacent strokes. */
  const rank = (li * 7) % STROKE_N;
  appendOpenRibbon(flat, linePos, lineOff, lineIdx, (k, n) => {
    lineProg.push(k / (n - 1), k / (n - 1));
    linePhase.push(phase0, phase0);
    lineRank.push(rank, rank);
  });
}

const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
lineGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(lineOff, 3));
lineGeo.setAttribute('aProg', new THREE.Float32BufferAttribute(lineProg, 1));
lineGeo.setAttribute('aPhase0', new THREE.Float32BufferAttribute(linePhase, 1));
lineGeo.setAttribute('aRank', new THREE.Float32BufferAttribute(lineRank, 1));
lineGeo.setIndex(lineIdx);

const lineMat = cutOutWindows(
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: gridState.color.clone() },
      uBase: { value: gridState.baseOpacity },
      uTime: { value: 0 },
      uSpeed: { value: gridState.pulseSpeed },
      uPulseW: { value: gridState.pulseWidth },
      uPulseB: { value: gridState.pulseBright },
      uWidth: { value: gridState.lineWidth },
      uVignette: { value: gridState.vignette },
      uPulseCount: { value: gridState.pulseCount },
      uMouse: { value: new THREE.Vector2() },
      uMouseR: { value: gridState.mouseRadius },
      uMouseB: { value: gridState.mousePulse },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute float aProg, aPhase0, aRank; attribute vec3 aOffset; uniform float uWidth;
      varying float vProg, vPhase, vRank; varying vec2 vNdc, vXY;
      void main(){
        vProg=aProg; vPhase=aPhase0; vRank=aRank;
        vec3 pos=position+aOffset*uWidth;
        vXY=pos.xy;
        vec4 clip=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
        vNdc=clip.xy/clip.w;
        gl_Position=clip;
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBase,uTime,uSpeed,uPulseW,uPulseB,uVignette,uPulseCount,uMouseR,uMouseB; uniform vec2 uMouse; varying float vProg, vPhase, vRank; varying vec2 vNdc, vXY;
      void main(){
        float phase = fract(vPhase + uTime*uSpeed*0.15);
        float d=abs(vProg-phase); d=min(d,1.0-d);
        float traveling=step(vRank, uPulseCount-0.5);
        float pulse=exp(-pow(d/uPulseW,2.0))*uPulseB*traveling;
        float mouse=exp(-pow(length(vXY-uMouse)/max(uMouseR,0.0001),2.0))*uMouseB;
        float vig=mix(1.0, 1.0-smoothstep(0.42,0.98,length(vNdc)), uVignette);
        float a=(uBase+pulse+mouse)*vig;
        gl_FragColor=vec4(uColor*a, a); }`,
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
      uMouseR: { value: gridState.mouseRadius },
      uMouseB: { value: gridState.nodePulseBright },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute vec3 aOffset; uniform float uWidth;
      varying vec2 vXY;
      void main(){
        vec3 pos=position+aOffset*uWidth;
        vXY=pos.xy;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBright,uMouseR,uMouseB; uniform vec2 uMouse; varying vec2 vXY;
      void main(){
        float mouse=exp(-pow(length(vXY-uMouse)/max(uMouseR,0.0001),2.0))*uMouseB;
        float a=uBright+mouse;
        gl_FragColor=vec4(uColor*a, a); }`,
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

export function updateGrid(time: number): void {
  const k = 1 - outlinerFade;
  const u = lineMat.uniforms;
  (u.uColor.value as THREE.Color).copy(gridState.color);
  u.uBase.value = gridState.baseOpacity * k;
  u.uPulseW.value = gridState.pulseWidth;
  u.uPulseB.value = gridState.pulseBright * k;
  u.uSpeed.value = gridState.pulseSpeed;
  u.uTime.value = time;
  u.uWidth.value = gridState.lineWidth;
  u.uVignette.value = gridState.vignette;
  u.uPulseCount.value = gridState.pulseCount;
  u.uMouseR.value = gridState.mouseRadius;
  u.uMouseB.value = gridState.mousePulse * k;
  mouseInGridLocal(u.uMouse.value as THREE.Vector2);

  (nodeMat.uniforms.uColor.value as THREE.Color).copy(gridState.color);
  nodeMat.uniforms.uBright.value = gridState.nodeBaseOpacity * k;
  nodeMat.uniforms.uWidth.value = gridState.lineWidth;
  (nodeMat.uniforms.uMouse.value as THREE.Vector2).copy(u.uMouse.value as THREE.Vector2);
  nodeMat.uniforms.uMouseR.value = gridState.mouseRadius;
  nodeMat.uniforms.uMouseB.value = gridState.nodePulseBright * k;
}
