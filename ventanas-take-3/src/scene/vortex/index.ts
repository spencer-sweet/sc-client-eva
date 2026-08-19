/**
 * Vortex / background tunnel: the tube mesh built along the persisted path, the "light
 * at the far end" sprite, and the path-editing helpers the Dev UI drives.
 *
 * Tube + markers + path line share one group, so scaling moves them all together
 * (it used to scale the tube only, which desynced it from the path).
 */
import * as THREE from 'three';
import { scene } from '../../core/stage';
import { buildCurve, deletePoint, insertPoint, loadPath, path, resetPath, savePath } from './path';
import { VTX_RADIUS_DEFAULT, vortexMat, vortexUniforms } from './material';

export { VTX_RADIUS_DEFAULT, vortexUniforms } from './material';
export { path as vortexPath, savePath as saveVortexPath } from './path';

const TSEG = 240;
const RSEG = 48;
const PATH_LINE_SEGMENTS = 140;

loadPath();

/* ---------- glow at the end of the tunnel ("light at the far end") ---------- */

function glowTex(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const exitGlowMat = new THREE.SpriteMaterial({
  map: glowTex(),
  color: 0x88aaff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  opacity: 0.25,
});
const exitGlowSprite = new THREE.Sprite(exitGlowMat);
exitGlowSprite.scale.set(6, 6, 1);
exitGlowSprite.renderOrder = 0.05;
scene.add(exitGlowSprite);

/* ---------- tube + path line ---------- */

const vortexGroup = new THREE.Group();
scene.add(vortexGroup);

let radius = VTX_RADIUS_DEFAULT;

const vortexMesh = new THREE.Mesh(
  new THREE.TubeGeometry(buildCurve(), TSEG, radius, RSEG, false),
  vortexMat,
);
vortexMesh.renderOrder = 0.1;
vortexGroup.add(vortexMesh);

const pathLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(buildCurve().getPoints(PATH_LINE_SEGMENTS)),
  new THREE.LineBasicMaterial({ color: 0x2a4a7a, transparent: true, opacity: 1 }),
);
pathLine.visible = false;
vortexGroup.add(pathLine);

export function rebuildVortexTube(): void {
  const curve = buildCurve();
  vortexMesh.geometry.dispose();
  vortexMesh.geometry = new THREE.TubeGeometry(curve, TSEG, radius, RSEG, false);
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(PATH_LINE_SEGMENTS));
  exitGlowSprite.position.copy(path.ctrl[path.ctrl.length - 1]);
}
rebuildVortexTube();

let enabled = true;
let layerFade = 0;
let layerRender = true;
let lastExitGlow = 0.25;

export function isVortexEnabled(): boolean {
  return enabled && layerRender;
}

export function setVortexLayer(fade: number, render: number): void {
  layerFade = fade;
  layerRender = render >= 0.5;
  vortexUniforms.uLayerFade.value = 1 - layerFade;
  vortexMesh.visible = enabled && layerRender;
  exitGlowSprite.visible = enabled && layerRender;
  exitGlowMat.opacity = lastExitGlow * (1 - layerFade);
}

/** Apply a Theatre "Vortex Look" payload. */
export function applyVortexLook(v: {
  enabled: number;
  scale: number;
  radius: number;
  taperStart: number;
  taperEnd: number;
  colorCore: { r: number; g: number; b: number };
  colorMid: { r: number; g: number; b: number };
  colorEdge: { r: number; g: number; b: number };
  speed: number;
  swirl: number;
  noiseScale: number;
  turbulence: number;
  glow: number;
  detail: number;
  fill: number;
  exitGlow: number;
}): void {
  enabled = v.enabled >= 0.5;
  lastExitGlow = v.exitGlow;
  vortexMesh.visible = enabled && layerRender;
  vortexGroup.scale.setScalar(v.scale);
  if (v.radius !== radius) {
    radius = v.radius;
    rebuildVortexTube();
  }
  // taper rescales relative to this geometry "base" radius
  vortexUniforms.uRadiusBase.value = radius;
  vortexUniforms.uTaperStart.value = v.taperStart;
  vortexUniforms.uTaperEnd.value = v.taperEnd;
  vortexUniforms.uColorCore.value.setRGB(v.colorCore.r, v.colorCore.g, v.colorCore.b);
  vortexUniforms.uColorMid.value.setRGB(v.colorMid.r, v.colorMid.g, v.colorMid.b);
  vortexUniforms.uColorEdge.value.setRGB(v.colorEdge.r, v.colorEdge.g, v.colorEdge.b);
  vortexUniforms.uSpeed.value = v.speed;
  vortexUniforms.uSwirl.value = v.swirl * 0.04;
  vortexUniforms.uNoiseScale.value = v.noiseScale;
  vortexUniforms.uTurbulence.value = v.turbulence;
  vortexUniforms.uGlow.value = v.glow;
  vortexUniforms.uDetail.value = v.detail;
  vortexUniforms.uFill.value = v.fill;
  exitGlowMat.opacity = v.exitGlow * (1 - layerFade);
  exitGlowSprite.scale.setScalar(6 * Math.max(0.001, v.exitGlow));
  exitGlowSprite.visible = enabled && layerRender;
}

/* ---------- editor: markers, selection, add/remove, draw mode ---------- */

const markerGroup = new THREE.Group();
vortexGroup.add(markerGroup);

export const vortexMarkers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];

let selected = -1;
let drawMode = false;
let gizmo: { attach(o: THREE.Object3D): void; detach(): void } | null = null;
let editorWanted = false;
let helpersRender = true;
let helpersFade = 0;

export function setVortexGizmo(g: typeof gizmo): void {
  gizmo = g;
}

function syncGizmo(): void {
  if (!gizmo) return;
  if (selected >= 0 && selected < vortexMarkers.length) gizmo.attach(vortexMarkers[selected]);
  else gizmo.detach();
}

export function rebuildVortexMarkers(): void {
  for (const m of vortexMarkers) {
    markerGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  vortexMarkers.length = 0;
  for (let i = 0; i < path.ctrl.length; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 18, 14),
      new THREE.MeshBasicMaterial({
        color: i === selected ? 0xffffff : 0x66d2ff,
        depthTest: false,
        transparent: true,
        opacity: 1 - helpersFade,
      }),
    );
    m.position.copy(path.ctrl[i]);
    m.userData = { i };
    m.renderOrder = 10;
    markerGroup.add(m);
    vortexMarkers.push(m);
  }
  syncGizmo();
}
rebuildVortexMarkers();

export function selectVortexPoint(i: number): void {
  selected = i;
  for (let k = 0; k < vortexMarkers.length; k++) {
    vortexMarkers[k].material.color.set(k === i ? 0xffffff : 0x66d2ff);
  }
  syncGizmo();
}

export function getSelectedVortexPoint(): number {
  return selected;
}

/** Commit a gizmo drag of the selected marker back into the path. */
export function commitSelectedMarker(): void {
  if (selected < 0) return;
  path.ctrl[selected].copy(vortexMarkers[selected].position);
  rebuildVortexTube();
  savePath();
}

export function isVortexDrawMode(): boolean {
  return drawMode;
}

export function setVortexDrawMode(on: boolean): void {
  drawMode = on;
  if (on) selectVortexPoint(-1);
}

/** Replace the whole path (used when a freehand stroke is finished). */
export function setVortexPathPoints(pts: THREE.Vector3[]): void {
  path.ctrl = pts;
  selectVortexPoint(-1);
  rebuildVortexTube();
  rebuildVortexMarkers();
  savePath();
}

export function addVortexPoint(): void {
  const next = insertPoint(selected);
  if (next === null) return;
  selected = next;
  rebuildVortexTube();
  rebuildVortexMarkers();
  savePath();
}

export function removeVortexPoint(): void {
  if (!deletePoint(selected)) return;
  selected = -1;
  rebuildVortexTube();
  rebuildVortexMarkers();
  savePath();
}

export function resetVortexPath(): void {
  resetPath();
  selected = -1;
  rebuildVortexTube();
  rebuildVortexMarkers();
  savePath();
}

export function setVortexPathTension(v: number): void {
  path.tension = v;
}

export function setVortexHelpersLayer(fade: number, render: number): void {
  helpersFade = fade;
  helpersRender = render >= 0.5;
  applyVortexHelpers();
}

function applyVortexHelpers(): void {
  const on = editorWanted && helpersRender;
  markerGroup.visible = on;
  pathLine.visible = on;
  const vis = 1 - helpersFade;
  const lineMat = pathLine.material as THREE.LineBasicMaterial;
  lineMat.opacity = vis;
  for (const m of vortexMarkers) {
    m.material.transparent = vis < 0.999;
    m.material.opacity = vis;
  }
}

/** Show markers / path line only while not drawing, not playing, and the outliner allows it. */
export function setVortexEditorVisible(visible: boolean): void {
  editorWanted = visible;
  applyVortexHelpers();
}
