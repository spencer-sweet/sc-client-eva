/**
 * The wall: an SVG-faithful painted texture on a ShapeGeometry with REAL holes.
 *
 * Rebuilding a ShapeGeometry with 3 holes of a few hundred vertices is cheap
 * (sub-millisecond), so the whole wall is rebuilt whenever a window offset/scale
 * changes. That avoids mask shaders and the truncated-uniform-array bugs they bring.
 *
 * Note the neon/glow/flares for the windows are NOT baked into the texture (they used
 * to be drawn with Path2D at fixed positions). Now that windows can move and scale,
 * they live as real 3D objects — see scene/window-frames.ts.
 */
import * as THREE from 'three';
import { SVG_H, SVG_W } from '../data/svg-window-set';
import { WSCALE } from '../geometry/svg-path';
import { nearLayer } from '../core/stage';
import { currentHolePoints } from '../windows/mask';
import { WINDOW_INDICES } from '../windows/geometry';

export interface WallColors {
  center: string;
  mid: string;
  edge: string;
}

/**
 * Defaults nearly match the scene background (#020410) — with a darker edge the wall
 * "vanished" at its borders and read as a circle instead of a wall.
 */
let wallColors: WallColors = { center: '#463a86', mid: '#0e1330', edge: '#0a0d1c' };

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
 * Starts TRULY opaque. The fade (see setWallBlackout) flips `transparent` on only
 * while blackout > 0 — an always-transparent wall joins the ambiguous draw queue next
 * to the GLB's glass and can erase it.
 */
export const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, transparent: false, opacity: 1 });

export const wall = new THREE.Mesh(new THREE.BufferGeometry(), wallMat);
wall.position.z = 0;
wall.renderOrder = 1;
nearLayer.add(wall);

let wallGeo: THREE.BufferGeometry | null = null;

export function rebuildWall(): void {
  const wallShape = new THREE.Shape();
  wallShape.moveTo(-26, -22);
  wallShape.lineTo(26, -22);
  wallShape.lineTo(26, 22);
  wallShape.lineTo(-26, 22);
  wallShape.lineTo(-26, -22);
  for (const i of WINDOW_INDICES) {
    const flat = currentHolePoints(i);
    const hp = new THREE.Path();
    hp.moveTo(flat[0][0], flat[0][1]);
    for (let k = 1; k < flat.length; k++) hp.lineTo(flat[k][0], flat[k][1]);
    wallShape.holes.push(hp);
  }
  const newGeo = new THREE.ShapeGeometry(wallShape, 4);
  // Re-derive UVs from world position so the painted SVG stays pinned to the wall.
  const uv = newGeo.attributes.uv;
  const pos = newGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i) / WSCALE + SVG_W / 2;
    const sy = SVG_H / 2 - pos.getY(i) / WSCALE;
    uv.setXY(i, sx / SVG_W, 1 - sy / SVG_H);
  }
  uv.needsUpdate = true;
  const old = wallGeo;
  wall.geometry = newGeo;
  wallGeo = newGeo;
  old?.dispose();
}

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
 * blackout=0 the wall must be truly opaque so it always draws BEFORE any transparent
 * object, without depending on renderOrder or distance sorting — that is what used to
 * make the GLB's glass disappear. While fading it also stops writing depth, so it
 * cannot compete for order with the GLB glass in the intermediate range either.
 */
let sequenceBlackout = 0;
let outlinerFade = 0;

export function setWallBlackout(blackout: number): void {
  sequenceBlackout = blackout;
  applyWallFade();
}

export function setWallLayer(fade: number, render: number): void {
  outlinerFade = fade;
  wall.visible = render >= 0.5;
  applyWallFade();
}

function applyWallFade(): void {
  const blackout = 1 - (1 - sequenceBlackout) * (1 - outlinerFade);
  wallMat.opacity = 1 - blackout;
  const shouldBeTransparent = blackout > 0.001;
  if (wallMat.transparent !== shouldBeTransparent) {
    wallMat.transparent = shouldBeTransparent;
    wallMat.needsUpdate = true;
  }
  wallMat.depthWrite = !shouldBeTransparent;
}
