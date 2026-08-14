/**
 * Window mask state + the GLSL any-window test shared by the grid shaders.
 *
 * The center window has its own offset/scale; the two side windows share one set of
 * controls (mirrored on X). Because these uniforms are the SAME objects the wall
 * holes are computed from, moving a window from the timeline keeps the grid cutout,
 * the hole and the glass/neon perfectly in sync.
 */
import * as THREE from 'three';
import type { Point2 } from '../geometry/svg-path';
import { crispLocal, winCentersW, winRadii, type WindowIndex } from './geometry';

/** Center window (index 0) only — its own offset and non-uniform scale. */
export const centerMask = { offX: 0, offY: 0, scX: 1, scY: 1 };

/**
 * Left (1) / right (2) share this. positive offsetX pushes each window OUTWARD
 * (left goes further left, right further right); offsetY moves both the same way.
 */
export const sideMask = { offsetX: 0, offsetY: 0, scale: 1 };

export interface WindowTransform {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

export function winTransform(i: WindowIndex): WindowTransform {
  if (i === 0) {
    return { ox: centerMask.offX, oy: centerMask.offY, sx: centerMask.scX, sy: centerMask.scY };
  }
  const dirX = i === 1 ? -1 : 1;
  return {
    ox: dirX * sideMask.offsetX,
    oy: sideMask.offsetY,
    sx: sideMask.scale,
    sy: sideMask.scale,
  };
}

/** The window's contour in absolute world space, with its current mask applied. */
export function currentHolePoints(i: WindowIndex): Point2[] {
  const t = winTransform(i);
  const c = winCentersW[i];
  return crispLocal[i].map((p): Point2 => [c[0] + t.ox + p[0] * t.sx, c[1] + t.oy + p[1] * t.sy]);
}

/* ---------- shared mask uniforms (grid lines + grid nodes) ---------- */

/** The 3 windows have 97 points each (8 cubics at steps=12); leave headroom. */
const MAXN = 104;

function padPoly(pts: readonly Point2[]): { arr: Float32Array; n: number } {
  const arr = new Float32Array(MAXN * 2);
  const n = Math.min(pts.length, MAXN);
  for (let i = 0; i < n; i++) {
    arr[i * 2] = pts[i][0];
    arr[i * 2 + 1] = pts[i][1];
  }
  // Repeat the last point so the fixed-size GLSL loop stays degenerate past `n`.
  for (let i = n; i < MAXN; i++) {
    arr[i * 2] = pts[n - 1][0];
    arr[i * 2 + 1] = pts[n - 1][1];
  }
  return { arr, n };
}

function toVec2Array(f32: Float32Array): THREE.Vector2[] {
  const a: THREE.Vector2[] = [];
  for (let i = 0; i < MAXN; i++) a.push(new THREE.Vector2(f32[i * 2], f32[i * 2 + 1]));
  return a;
}

export const maskUniforms: Record<string, THREE.IUniform> = {};
for (const i of [0, 1, 2] as const) {
  const pad = padPoly(crispLocal[i]);
  maskUniforms['uC' + i] = { value: new THREE.Vector2(winCentersW[i][0], winCentersW[i][1]) };
  maskUniforms['uOff' + i] = { value: new THREE.Vector2(0, 0) };
  maskUniforms['uScale' + i] = { value: new THREE.Vector2(1, 1) };
  maskUniforms['uPoly' + i] = { value: toVec2Array(pad.arr) };
  maskUniforms['uN' + i] = { value: pad.n };
  maskUniforms['uRad' + i] = { value: winRadii[i] * 1.05 };
}

/** Push a window's current mask transform into the shared grid uniforms. */
export function syncMaskUniforms(i: WindowIndex): void {
  const t = winTransform(i);
  (maskUniforms['uOff' + i].value as THREE.Vector2).set(t.ox, t.oy);
  (maskUniforms['uScale' + i].value as THREE.Vector2).set(t.sx, t.sy);
}

/**
 * GLSL prelude declaring the mask uniforms and `insideAnyWindow(worldXY)`.
 * Anything that must be cut away where a window is (the grid) discards on it.
 */
export const MASK_GLSL = `
  uniform vec2 uC0,uOff0,uScale0; uniform vec2 uPoly0[${MAXN}]; uniform int uN0; uniform float uRad0;
  uniform vec2 uC1,uOff1,uScale1; uniform vec2 uPoly1[${MAXN}]; uniform int uN1; uniform float uRad1;
  uniform vec2 uC2,uOff2,uScale2; uniform vec2 uPoly2[${MAXN}]; uniform int uN2; uniform float uRad2;
  bool gridInPoly(vec2 p, vec2 poly[${MAXN}], int n){
    bool inside=false; int j=n-1;
    for(int i=0;i<${MAXN};i++){
      if(i>=n) break;
      vec2 pi=poly[i]; vec2 pj=poly[j];
      if( ((pi.y>p.y)!=(pj.y>p.y)) && (p.x < (pj.x-pi.x)*(p.y-pi.y)/(pj.y-pi.y)+pi.x) ){ inside=!inside; }
      j=i;
    }
    return inside;
  }
  bool insideAnyWindow(vec2 world){
    vec2 d0=world-uC0-uOff0; float rr0=max(uScale0.x,uScale0.y)*uRad0;
    if(dot(d0,d0)<rr0*rr0 && gridInPoly(d0/uScale0,uPoly0,uN0)) return true;
    vec2 d1=world-uC1-uOff1; float rr1=max(uScale1.x,uScale1.y)*uRad1;
    if(dot(d1,d1)<rr1*rr1 && gridInPoly(d1/uScale1,uPoly1,uN1)) return true;
    vec2 d2=world-uC2-uOff2; float rr2=max(uScale2.x,uScale2.y)*uRad2;
    if(dot(d2,d2)<rr2*rr2 && gridInPoly(d2/uScale2,uPoly2,uN2)) return true;
    return false;
  }
`;
