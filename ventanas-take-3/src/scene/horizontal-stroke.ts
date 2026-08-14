/**
 * Horizontal stroke between the 3 windows — the arc that connects the 3 stars in the
 * EVA logo, fitted to the wall's real windows. It grows left-to-right via a trim, the
 * same technique the vortex trim uses.
 */
import * as THREE from 'three';
import { scene } from '../core/stage';
import { winCentersW } from '../windows/geometry';

const SEGMENTS = 120;

const [left, right] = [winCentersW[1], winCentersW[2]].sort((a, b) => a[0] - b[0]);
const center = winCentersW[0];
// arc ABOVE the windows, like in the logo
const midTop: [number, number] = [center[0], center[1] + (center[1] - left[1]) * 0.15 + 3.5];

const curve = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(left[0], left[1], 6),
  new THREE.Vector3(midTop[0], midTop[1], 6),
  new THREE.Vector3(right[0], right[1], 6),
);

const pts = curve.getPoints(SEGMENTS);
const pos = new Float32Array(pts.length * 3);
const prog = new Float32Array(pts.length);
for (let k = 0; k < pts.length; k++) {
  pos[k * 3] = pts[k].x;
  pos[k * 3 + 1] = pts[k].y;
  pos[k * 3 + 2] = pts[k].z;
  prog[k] = k / (pts.length - 1);
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aProg', new THREE.BufferAttribute(prog, 1));

/** Halo and core share one uniform set — they only differ in base opacity. */
const uniforms = {
  uColor: { value: new THREE.Color(0x18c0d8) },
  uGrowStart: { value: 0.0 },
  uGrowEnd: { value: 1.0 },
  uOpacity: { value: 1.0 },
};

function makeMat(opacityMul: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /*glsl*/ `attribute float aProg; varying float vProg; void main(){ vProg=aProg; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /*glsl*/ `precision highp float; varying float vProg; uniform vec3 uColor; uniform float uGrowStart,uGrowEnd,uOpacity;
      void main(){
        if(vProg<uGrowStart || vProg>uGrowEnd) discard; // trim: only draw the already-"grown" segment
        float tipW=0.03;
        float tip=1.0-smoothstep(0.0,tipW,abs(vProg-uGrowEnd)); // bright tip right where growth is advancing
        gl_FragColor=vec4(uColor, (${opacityMul}+tip*0.8)*uOpacity);
      }`,
  });
}

const halo = new THREE.Line(geo, makeMat('0.35'));
halo.renderOrder = 7;
halo.frustumCulled = false;
const core = new THREE.Line(geo, makeMat('0.9'));
core.renderOrder = 7.1;
core.frustumCulled = false;
scene.add(halo, core);

/** Apply a Theatre "Horizontal Stroke" payload. */
export function applyHorizontalStroke(v: {
  enabled: number;
  color: { r: number; g: number; b: number };
  opacity: number;
  growStart: number;
  growEnd: number;
}): void {
  const on = v.enabled >= 0.5;
  halo.visible = on;
  core.visible = on;
  uniforms.uColor.value.setRGB(v.color.r, v.color.g, v.color.b);
  uniforms.uOpacity.value = v.opacity;
  uniforms.uGrowStart.value = Math.min(v.growStart, v.growEnd);
  uniforms.uGrowEnd.value = Math.max(v.growStart, v.growEnd);
}
