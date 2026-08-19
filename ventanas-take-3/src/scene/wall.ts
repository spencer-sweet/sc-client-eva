/**
 * The wall: an SVG-faithful painted texture on a plain quad, with the window openings
 * cut out by the stencil buffer (see windows/stencil.ts).
 *
 * This used to be a ShapeGeometry carrying 3 real holes, re-triangulated from scratch
 * whenever a window offset/scale changed — which, with those props on the timeline,
 * meant three earcut passes plus three geometry uploads on every scrolled frame. The
 * stencil cutout gives the same hard-edged opening for two static triangles and zero
 * per-frame CPU, so a window can now be moved or scaled purely by transforming its own
 * group.
 *
 * Note the neon/glow/flares for the windows are NOT baked into the texture — they live
 * as real 3D objects, see scene/window-frames.ts.
 */
import * as THREE from 'three';
import { SVG_H, SVG_W } from '../data/svg-window-set';
import { WSCALE } from '../geometry/svg-path';
import { nearLayer } from '../core/stage';
import { cutOutWindows } from '../windows/stencil';

export interface WallColors {
  center: string;
  mid: string;
  edge: string;
}

/**
 * Center matches the muted indigo from the still; mid/edge stay in the same family
 * so the wall does not vignette to black.
 */
let wallColors: WallColors = { center: '#202454', mid: '#1c1f48', edge: '#191c40' };

function buildWallTexture(): THREE.CanvasTexture {
  const SS = 2; // supersample
  const c = document.createElement('canvas');
  c.width = SVG_W * SS;
  c.height = SVG_H * SS;
  const ctx = c.getContext('2d')!;
  ctx.scale(SS, SS);
  const cx0 = SVG_W * 0.5;
  const cy0 = SVG_H * 0.46;
  const rad = Math.max(SVG_W, SVG_H) * 0.75;
  const g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, rad);
  g.addColorStop(0.0, wallColors.center);
  g.addColorStop(0.55, wallColors.mid);
  g.addColorStop(1.0, wallColors.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SVG_W, SVG_H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let wallTex = buildWallTexture();

/**
 * Starts TRULY opaque. The fade (see setWallLayer) flips `transparent` on only
 * while blackout > 0 — an always-transparent wall joins the ambiguous draw queue next
 * to the GLB's glass and can erase it.
 */
export const wallMat = cutOutWindows(
  new THREE.MeshBasicMaterial({ map: wallTex, transparent: false, opacity: 1 }),
);

const WALL_W = 52;
const WALL_H = 44;

/** UVs come from world position so the painted SVG stays pinned to the wall. */
function buildWallGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(WALL_W, WALL_H);
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i) / WSCALE + SVG_W / 2;
    const sy = SVG_H / 2 - pos.getY(i) / WSCALE;
    uv.setXY(i, sx / SVG_W, 1 - sy / SVG_H);
  }
  uv.needsUpdate = true;
  return geo;
}

export const wall = new THREE.Mesh(buildWallGeometry(), wallMat);
wall.position.z = 0;
wall.renderOrder = 1;
// One quad that always covers the view; culling it per frame buys nothing.
wall.frustumCulled = false;
nearLayer.add(wall);

export function setWallColors(next: WallColors): void {
  wallColors = next;
  const old = wallTex;
  wallTex = buildWallTexture();
  wallMat.map = wallTex;
  wallMat.needsUpdate = true;
  old.dispose();
}

/**
 * Fade the wall toward black. `transparent` is toggled rather than left on: at
 * fade=0 the wall must be truly opaque so it always draws BEFORE any transparent
 * object, without depending on renderOrder or distance sorting — that is what used to
 * make the GLB's glass disappear. While fading it also stops writing depth, so it
 * cannot compete for order with the GLB glass in the intermediate range either.
 */
let outlinerFade = 0;

export function setWallLayer(fade: number, render: number): void {
  outlinerFade = fade;
  wall.visible = render >= 0.5;
  applyWallFade();
}

function applyWallFade(): void {
  const blackout = outlinerFade;
  wallMat.opacity = 1 - blackout;
  const shouldBeTransparent = blackout > 0.001;
  if (wallMat.transparent !== shouldBeTransparent) {
    wallMat.transparent = shouldBeTransparent;
    wallMat.needsUpdate = true;
  }
  wallMat.depthWrite = !shouldBeTransparent;
}
