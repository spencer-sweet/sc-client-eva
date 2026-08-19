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
import { CIRCLES, LINES } from '../data/svg-window-set';
import { applyTf, flattenPath, toWorld, WSCALE, type Point2 } from '../geometry/svg-path';
import { appendOpenRibbon } from '../geometry/ribbon';
import { nearLayer } from '../core/stage';
import { cutOutWindows } from '../windows/stencil';

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
const lineIdx: number[] = [];

for (let li = 0; li < LINES.length; li++) {
  const flat = flattenPath(LINES[li], 1).map(toWorld);
  if (flat.length < 2) continue;
  const phase0 = (li * 0.61) % 1.0;
  appendOpenRibbon(flat, linePos, lineOff, lineIdx, (k, n) => {
    lineProg.push(k / (n - 1), k / (n - 1));
    linePhase.push(phase0, phase0);
  });
}

const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
lineGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(lineOff, 3));
lineGeo.setAttribute('aProg', new THREE.Float32BufferAttribute(lineProg, 1));
lineGeo.setAttribute('aPhase0', new THREE.Float32BufferAttribute(linePhase, 1));
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
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute float aProg, aPhase0; attribute vec3 aOffset; uniform float uWidth;
      varying float vProg, vPhase;
      void main(){
        vProg=aProg; vPhase=aPhase0;
        vec3 pos=position+aOffset*uWidth;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBase,uTime,uSpeed,uPulseW,uPulseB; varying float vProg, vPhase;
      void main(){
        float phase = fract(vPhase + uTime*uSpeed*0.15);
        float d=abs(vProg-phase); d=min(d,1.0-d); float pulse=exp(-pow(d/uPulseW,2.0))*uPulseB;
        gl_FragColor=vec4(uColor*(uBase+pulse), uBase+pulse); }`,
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
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute vec3 aOffset; uniform float uWidth;
      void main(){
        vec3 pos=position+aOffset*uWidth;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; uniform vec3 uColor; uniform float uBright;
      void main(){ gl_FragColor=vec4(uColor*uBright,uBright); }`,
  }),
);

const gridNodes = new THREE.Mesh(nodeGeo, nodeMat);
gridNodes.renderOrder = 1.5;
gridNodes.frustumCulled = false;
gridGroup.add(gridNodes);

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

  (nodeMat.uniforms.uColor.value as THREE.Color).copy(gridState.color);
  nodeMat.uniforms.uBright.value = gridState.nodeBaseOpacity * k;
  nodeMat.uniforms.uWidth.value = gridState.lineWidth;
}
