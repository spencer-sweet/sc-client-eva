/**
 * Per-window 3D objects: glass fill, live neon outline (halo + core) and the alarm
 * light spill painted on the wall around each opening.
 *
 * Each window owns a Group, so moving/scaling it can never misalign the neon from the
 * hole. Each group also carries the stencil stamp that cuts the wall and the grid open,
 * which is why `applyWindowTransform` now only has to move the group: the opening
 * follows the same transform as the glass and the neon, by construction.
 */
import * as THREE from 'three';
import { nearLayer } from '../core/stage';
import { buildRibbonGeometry } from '../geometry/ribbon';
import { crispLocal, winCentersW, winRadii, WINDOW_INDICES, type WindowIndex } from '../windows/geometry';
import { winTransform } from '../windows/mask';
import { makeWindowStencilWriter, STENCIL_WRITER_ORDER } from '../windows/stencil';
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
  const shapeGeo = new THREE.ShapeGeometry(shp);

  // Stamps this window into the stencil buffer so the wall and the grid can test
  // against it. Drawn first, writes no color and no depth — see windows/stencil.ts.
  const stencilStamp = new THREE.Mesh(shapeGeo, makeWindowStencilWriter());
  stencilStamp.renderOrder = STENCIL_WRITER_ORDER;
  stencilStamp.frustumCulled = false;
  grp.add(stencilStamp);

  const fill = new THREE.Mesh(shapeGeo, i === 0 ? centerGlass.mat : sideGlass.mat);
  fill.position.z = -0.02;
  fill.renderOrder = 2;
  fill.frustumCulled = false;
  grp.add(fill);

  // Live neon (real-width outline) in the same group -> never misaligns from the hole.
  const ribbon = buildRibbonGeometry(crispLocal[i]);
  // Both strokes are wider and brighter at rest than they used to be, to land on the
  // same overall presence now that the shader shades a real cross-section: a gaussian
  // carries roughly half a flat band's energy over the same width, and uBright is
  // applied once instead of squared. Net effect is a rim that reads the same from a
  // distance but no longer clips its own peak. See makeNeonMat.
  const haloWidthBase = 0.3;
  const coreWidthBase = 0.04;
  const haloMat = makeNeonMat(0xcea7fc, 0.7, haloWidthBase, 1.0);
  const coreMat = makeNeonMat(0xffffff, 1.0, coreWidthBase, 0.2);
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
    pulseSpeed: 0.25,
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

/**
 * Apply a window's current mask to its group.
 *
 * This is now a pure transform write — the stencil stamp lives in the same group, so
 * the wall opening and the grid cutout follow with it. It used to re-triangulate the
 * whole wall on every call, three times per timeline update.
 */
export function applyWindowTransform(i: WindowIndex): void {
  const t = winTransform(i);
  const c = winCentersW[i];
  winGroups[i].position.set(c[0] + t.ox, c[1] + t.oy, 0);
  winGroups[i].scale.set(t.sx, t.sy, 1);
}

/** Push a Theatre "Side Windows"/"Center Window (glass)" payload onto one window's neon. */
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

/** 1 / (2 * sigma^2) for the sigma=0.28 pulse, so the hot loop has no pow(). */
const PULSE_FALLOFF = 1 / (0.28 * 0.28);

/**
 * Gaussian brightness pulse on the neon rims — all windows share phase0 so they
 * flash in sync (same pattern the old grid nodes used, without stagger).
 *
 * `time` MUST be a plain monotonic wall clock. It used to be handed the grid's
 * `gridPulseTime`, an accumulator whose rate is scaled by camera distance so the grid
 * pulse keeps a constant PERCEIVED speed — which meant every camera dolly in the
 * timeline frequency-modulated the neon, and every jitter in the scroll-driven camera
 * showed up as a hitch in the glow. Brightness is a pure function of wall time now, so
 * an uneven frame does not knock the pulse off its curve.
 */
export function updateNeonPulse(time: number): void {
  for (const nm of neonMats) {
    const ph = (nm.phase0 + time * nm.pulseSpeed) % 1.0;
    const d = ph - 0.5;
    const bright = 1.0 + nm.pulseBright * Math.exp(-d * d * PULSE_FALLOFF);
    nm.halo.uniforms.uBright.value = bright;
    nm.core.uniforms.uBright.value = bright;
  }
}
