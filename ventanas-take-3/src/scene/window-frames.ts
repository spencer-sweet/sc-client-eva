/**
 * Per-window 3D objects: glass fill, live neon outline (halo + core) and the alarm
 * light spill painted on the wall around each opening.
 *
 * Each window owns a Group, so moving/scaling it can never misalign the neon from the
 * hole. `applyWindowTransform` is the single place that pushes a mask change into the
 * group, the shared grid uniforms and the wall geometry.
 */
import * as THREE from 'three';
import { nearLayer } from '../core/stage';
import { buildRibbonGeometry } from '../geometry/ribbon';
import { crispLocal, winCentersW, winRadii, WINDOW_INDICES, type WindowIndex } from '../windows/geometry';
import { syncMaskUniforms, winTransform } from '../windows/mask';
import { rebuildWall } from './wall';
import { makeGlass, makeNeonMat } from './window-materials';

/** Sides (1, 2): normal glass. */
export const sideGlass = makeGlass(0x1a1f38, 0.3);
/** Center (0): invisible at rest so it never covers the GLB, but reacts to the alarm. */
export const centerGlass = makeGlass(0x000000, 0.0);

export interface NeonPair {
  halo: THREE.ShaderMaterial;
  core: THREE.ShaderMaterial;
  haloWidthBase: number;
  coreWidthBase: number;
  /** Shared phase — all three rims pulse in sync. */
  phase0: number;
  pulseBright: number;
  pulseSpeed: number;
}

/** Per-window neon materials, so the outline can dissolve and rescale independently. */
export const neonMats: NeonPair[] = [];

const winGroups: THREE.Group[] = [];

for (const i of WINDOW_INDICES) {
  const grp = new THREE.Group();

  const shp = new THREE.Shape(crispLocal[i].map((p) => new THREE.Vector2(p[0], p[1])));
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shp), i === 0 ? centerGlass.mat : sideGlass.mat);
  fill.position.z = -0.02;
  fill.renderOrder = 2;
  fill.frustumCulled = false;
  grp.add(fill);

  // Live neon (real-width outline) in the same group -> never misaligns from the hole.
  const ribbon = buildRibbonGeometry(crispLocal[i]);
  const haloWidthBase = 0.1;
  const coreWidthBase = 0.035;
  const haloMat = makeNeonMat(0xcea7fc, 0.35, haloWidthBase);
  const coreMat = makeNeonMat(0xffffff, 0.9, coreWidthBase);
  const halo = new THREE.Mesh(ribbon, haloMat);
  halo.renderOrder = 3.5;
  halo.frustumCulled = false;
  grp.add(halo);
  const core = new THREE.Mesh(ribbon, coreMat);
  core.renderOrder = 4;
  core.frustumCulled = false;
  grp.add(core);
  neonMats.push({
    halo: haloMat,
    core: coreMat,
    haloWidthBase,
    coreWidthBase,
    phase0: 0,
    pulseBright: 4.5,
    pulseSpeed: 1.1,
  });

  nearLayer.add(grp);
  winGroups.push(grp);
}

/* ---------- alarm light spill on the wall around each window ---------- */

function wallSpillTex(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const spillTex = wallSpillTex();

export const wallSpillSprites: THREE.Sprite[] = WINDOW_INDICES.map((i) => {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: spillTex,
      color: 0x000000,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  );
  sp.scale.set(winRadii[i] * 3.2, winRadii[i] * 3.2, 1);
  sp.position.set(winCentersW[i][0], winCentersW[i][1], 0.02);
  sp.renderOrder = 1.2; // just above the wall, below glass/neon
  nearLayer.add(sp);
  return sp;
});

export function setWindowLayer(i: WindowIndex, fade: number, render: number): void {
  const vis = 1 - fade;
  const glass = i === 0 ? centerGlass : sideGlass;
  glass.uniforms.uLayerFade.value = vis;
  const nm = neonMats[i];
  nm.halo.uniforms.uLayerFade.value = vis;
  nm.core.uniforms.uLayerFade.value = vis;
  winGroups[i].visible = render >= 0.5;
}

/** Apply a window's current mask to its group, the grid uniforms and the wall holes. */
export function applyWindowTransform(i: WindowIndex): void {
  const t = winTransform(i);
  const c = winCentersW[i];
  winGroups[i].position.set(c[0] + t.ox, c[1] + t.oy, 0);
  winGroups[i].scale.set(t.sx, t.sy, 1);
  syncMaskUniforms(i);
  rebuildWall();
}

/** Push a Theatre "Windows"/"Center Window (glass)" payload onto one window's neon. */
export function applyNeon(
  i: WindowIndex,
  v: {
    dissolve: number;
    neonColor: { r: number; g: number; b: number };
    neonWidth: number;
    neonPulseBright?: number;
    neonPulseSpeed?: number;
  },
): void {
  const nm = neonMats[i];
  for (const m of [nm.halo, nm.core]) {
    m.uniforms.uDissolve.value = v.dissolve;
    (m.uniforms.uColor.value as THREE.Color).setRGB(v.neonColor.r, v.neonColor.g, v.neonColor.b);
  }
  nm.halo.uniforms.uWidth.value = nm.haloWidthBase * v.neonWidth;
  nm.core.uniforms.uWidth.value = nm.coreWidthBase * v.neonWidth;
  if (v.neonPulseBright !== undefined) nm.pulseBright = v.neonPulseBright;
  if (v.neonPulseSpeed !== undefined) nm.pulseSpeed = v.neonPulseSpeed;
}

/**
 * Gaussian brightness pulse on the neon rims — all windows share phase0 so they
 * flash in sync (same pattern the old grid nodes used, without stagger).
 */
export function updateNeonPulse(time: number): void {
  for (const nm of neonMats) {
    const ph = (nm.phase0 + time * nm.pulseSpeed * 0.2) % 1.0;
    const bright =
      1.0 + nm.pulseBright * Math.exp(-Math.pow((ph - 0.5) / 0.28, 2.0));
    nm.halo.uniforms.uBright.value = bright;
    nm.core.uniforms.uBright.value = bright;
  }
}
