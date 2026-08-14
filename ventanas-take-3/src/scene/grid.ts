/**
 * Live grid (lines + nodes) in 3D — the color travels along each line every so often.
 *
 * Fragments are discarded wherever they fall inside any of the 3 windows. The grid
 * shares the SAME mask data (center/offset/scale) the windows use, so moving or
 * scaling a window from the timeline makes the cutout follow automatically.
 */
import * as THREE from 'three';
import { CIRCLES, LINES } from '../data/svg-window-set';
import { applyTf, flattenPath, toWorld, WSCALE, type Point2 } from '../geometry/svg-path';
import { nearLayer } from '../core/stage';
import { MASK_GLSL, maskUniforms } from '../windows/mask';

export const gridState = {
  color: new THREE.Color(0.81, 0.65, 0.99),
  baseOpacity: 0.16,
  pulseSpeed: 0.35,
  pulseWidth: 0.22,
  pulseBright: 2.4,
  /** Solid node stroke brightness (independent of the line pulse). */
  nodeBaseOpacity: 0.65,
  nodePulseBright: 2.4,
};

/** 0 = normal, 1 = wall + grid fully black (only the windows remain). */
let blackout = 0;

export function setGridBlackout(v: number): void {
  blackout = v;
}

const gridGroup = new THREE.Group();
gridGroup.position.z = 0.06;
nearLayer.add(gridGroup);

interface PulsingMat {
  mat: THREE.ShaderMaterial;
  phase0: number;
}

const gridLineObjs: PulsingMat[] = [];
const gridNodeObjs: PulsingMat[] = [];

for (let li = 0; li < LINES.length; li++) {
  const flat = flattenPath(LINES[li], 1).map(toWorld);
  if (flat.length < 2) continue;
  const N = flat.length;
  const pos = new Float32Array(N * 3);
  const prog = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    pos[k * 3] = flat[k][0];
    pos[k * 3 + 1] = flat[k][1];
    pos[k * 3 + 2] = 0;
    prog[k] = k / (N - 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aProg', new THREE.BufferAttribute(prog, 1));
  const phase0 = (li * 0.61) % 1.0;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: gridState.color },
      uBase: { value: gridState.baseOpacity },
      uPhase: { value: phase0 },
      uPulseW: { value: gridState.pulseWidth },
      uPulseB: { value: gridState.pulseBright },
      ...maskUniforms,
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /*glsl*/ `attribute float aProg; varying float vProg; varying vec3 vW;
      void main(){ vProg=aProg; vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /*glsl*/ `precision highp float; uniform vec3 uColor; uniform float uBase,uPhase,uPulseW,uPulseB; varying float vProg; varying vec3 vW;
      ${MASK_GLSL}
      void main(){
        if(insideAnyWindow(vW.xy)) discard;
        float d=abs(vProg-uPhase); d=min(d,1.0-d); float pulse=exp(-pow(d/uPulseW,2.0))*uPulseB;
        gl_FragColor=vec4(uColor*(uBase+pulse), uBase+pulse); }`,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 1.5;
  gridGroup.add(line);
  gridLineObjs.push({ mat, phase0 });
}

for (let ci = 0; ci < CIRCLES.length; ci++) {
  const cir = CIRCLES[ci];
  const [wx, wy] = applyTf(cir.tf, cir.cx, cir.cy);
  const c: Point2 = toWorld([wx, wy]);
  const r = cir.r * WSCALE;
  // Device-pixel LineLoop (not a thin Ring mesh) so the stroke stays visible;
  // additive + solid brightness matches the grid lines without a color pulse.
  const SEG = 64;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(new THREE.Vector3(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: gridState.color.clone() },
      uBright: { value: gridState.nodeBaseOpacity },
      ...maskUniforms,
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /*glsl*/ `varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /*glsl*/ `precision highp float; uniform vec3 uColor; uniform float uBright; varying vec3 vW;
      ${MASK_GLSL}
      void main(){ if(insideAnyWindow(vW.xy)) discard; gl_FragColor=vec4(uColor*uBright,uBright); }`,
  });
  const ring = new THREE.LineLoop(geo, mat);
  ring.renderOrder = 1.5;
  gridGroup.add(ring);
  gridNodeObjs.push({ mat, phase0: 0 });
}

export function updateGrid(time: number): void {
  const spd = gridState.pulseSpeed;
  const k = 1 - blackout;
  for (const g of gridLineObjs) {
    const u = g.mat.uniforms;
    (u.uColor.value as THREE.Color).copy(gridState.color);
    u.uBase.value = gridState.baseOpacity * k;
    u.uPulseW.value = gridState.pulseWidth;
    u.uPulseB.value = gridState.pulseBright * k;
    u.uPhase.value = (g.phase0 + time * spd * 0.15) % 1.0;
  }
  for (const n of gridNodeObjs) {
    (n.mat.uniforms.uColor.value as THREE.Color).copy(gridState.color);
    n.mat.uniforms.uBright.value = gridState.nodeBaseOpacity * k;
  }
}
