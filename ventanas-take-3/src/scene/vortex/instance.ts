/**
 * One vortex: the tube mesh built along its persisted path, the "light at the far end"
 * sprite, and the path-editing helpers (markers + path line) the Dev UI drives.
 *
 * Tube + markers + path line share one group, so scaling moves them all together
 * (it used to scale the tube only, which desynced it from the path).
 *
 * The scene owns two of these (Vortex 1 / Vortex 2) — see ./index.ts.
 */
import * as THREE from 'three';
import { quality } from '../../core/quality';
import { scene } from '../../core/stage';
import { createVortexPath, type VortexPath, type VortexPathSnapshot } from './path';
import {
  createVortexMaterial,
  createVortexUniforms,
  VTX_RADIUS_DEFAULT,
  type VortexUniforms,
} from './material';

/** Tube tessellation — halved on the low tier; the noise shader hides the difference. */
const TSEG = quality.vortex.tubeSegments;
const RSEG = quality.vortex.radialSegments;
const PATH_LINE_SEGMENTS = 140;

/* ---------- glow at the end of the tunnel ("light at the far end") ---------- */

let glowTexture: THREE.CanvasTexture | null = null;

function glowTex(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
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
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

/** A Theatre "Vortex" payload. */
export interface VortexLook {
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
  translate?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  /** Per-axis scale (Vortex 2). Multiplies the uniform `scale`. */
  scaleXYZ?: { x: number; y: number; z: number };
}

export interface VortexInstance {
  readonly id: number;
  readonly path: VortexPath;
  readonly uniforms: VortexUniforms;
  readonly markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  /** Fired after `select()` so the shared gizmo can re-attach. */
  onSelectionChange: (() => void) | null;
  isEnabled(): boolean;
  applyLook(v: VortexLook): void;
  setLayer(fade: number, render: number): void;
  setHelpersLayer(fade: number, render: number): void;
  setEditorVisible(visible: boolean): void;
  rebuildTube(): void;
  rebuildMarkers(): void;
  select(i: number): void;
  getSelected(): number;
  commitSelectedMarker(): void;
  setPathPoints(pts: THREE.Vector3[]): void;
  addPoint(): void;
  removePoint(): void;
  resetPath(): void;
  setTension(v: number): void;
  savePath(): void;
  applyPathSnapshot(o: VortexPathSnapshot): void;
  snapshotPath(): VortexPathSnapshot;
}

export function createVortexInstance(
  id: number,
  storageKey: string,
  defaultCtrl: () => THREE.Vector3[],
): VortexInstance {
  const path = createVortexPath(storageKey, defaultCtrl);
  path.load();

  const uniforms = createVortexUniforms();
  const material = createVortexMaterial(uniforms);

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

  const group = new THREE.Group();
  scene.add(group);
  group.add(exitGlowSprite);

  let radius = VTX_RADIUS_DEFAULT;

  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(path.buildCurve(), TSEG, radius, RSEG, false),
    material,
  );
  mesh.renderOrder = 0.1;
  group.add(mesh);

  const pathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(path.buildCurve().getPoints(PATH_LINE_SEGMENTS)),
    new THREE.LineBasicMaterial({ color: 0x2a4a7a, transparent: true, opacity: 1 }),
  );
  pathLine.visible = false;
  group.add(pathLine);

  const markerGroup = new THREE.Group();
  group.add(markerGroup);

  let enabled = true;
  let layerFade = 0;
  let layerRender = true;
  let lastExitGlow = 0.25;

  let selected = -1;
  let editorWanted = false;
  let helpersRender = true;
  let helpersFade = 0;

  const markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];

  const inst: VortexInstance = {
    id,
    path,
    uniforms,
    markers,
    onSelectionChange: null,

    isEnabled: () => enabled && layerRender,

    applyLook(v) {
      enabled = v.enabled >= 0.5;
      lastExitGlow = v.exitGlow;
      mesh.visible = enabled && layerRender;
      const tx = v.translate?.x ?? 0;
      const ty = v.translate?.y ?? 0;
      const tz = v.translate?.z ?? 0;
      group.position.set(tx, ty, tz);
      group.rotation.set(v.rotation?.x ?? 0, v.rotation?.y ?? 0, v.rotation?.z ?? 0, 'YXZ');
      const ax = v.scaleXYZ?.x ?? 1;
      const ay = v.scaleXYZ?.y ?? 1;
      const az = v.scaleXYZ?.z ?? 1;
      group.scale.set(v.scale * ax, v.scale * ay, v.scale * az);
      if (v.radius !== radius) {
        radius = v.radius;
        inst.rebuildTube();
      }
      // taper rescales relative to this geometry "base" radius
      uniforms.uRadiusBase.value = radius;
      uniforms.uTaperStart.value = v.taperStart;
      uniforms.uTaperEnd.value = v.taperEnd;
      uniforms.uColorCore.value.setRGB(v.colorCore.r, v.colorCore.g, v.colorCore.b);
      uniforms.uColorMid.value.setRGB(v.colorMid.r, v.colorMid.g, v.colorMid.b);
      uniforms.uColorEdge.value.setRGB(v.colorEdge.r, v.colorEdge.g, v.colorEdge.b);
      uniforms.uSpeed.value = v.speed;
      uniforms.uSwirl.value = v.swirl * 0.04;
      uniforms.uNoiseScale.value = v.noiseScale;
      uniforms.uTurbulence.value = v.turbulence;
      uniforms.uGlow.value = v.glow;
      uniforms.uDetail.value = v.detail;
      uniforms.uFill.value = v.fill;
      exitGlowMat.opacity = v.exitGlow * (1 - layerFade);
      exitGlowSprite.scale.setScalar(6 * Math.max(0.001, v.exitGlow));
      exitGlowSprite.visible = enabled && layerRender;
    },

    setLayer(fade, render) {
      layerFade = fade;
      layerRender = render >= 0.5;
      uniforms.uLayerFade.value = 1 - layerFade;
      mesh.visible = enabled && layerRender;
      exitGlowSprite.visible = enabled && layerRender;
      exitGlowMat.opacity = lastExitGlow * (1 - layerFade);
    },

    setHelpersLayer(fade, render) {
      helpersFade = fade;
      helpersRender = render >= 0.5;
      applyHelpers();
    },

    /** Show markers / path line only while not drawing, not playing, and the outliner allows it. */
    setEditorVisible(visible) {
      editorWanted = visible;
      applyHelpers();
    },

    rebuildTube() {
      const curve = path.buildCurve();
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(curve, TSEG, radius, RSEG, false);
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(
        curve.getPoints(PATH_LINE_SEGMENTS),
      );
      exitGlowSprite.position.copy(path.ctrl[path.ctrl.length - 1]);
    },

    rebuildMarkers() {
      for (const m of markers) {
        markerGroup.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      markers.length = 0;
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
        m.userData = { i, vortexId: id };
        m.renderOrder = 10;
        markerGroup.add(m);
        markers.push(m);
      }
      inst.onSelectionChange?.();
    },

    select(i) {
      selected = i;
      for (let k = 0; k < markers.length; k++) {
        markers[k].material.color.set(k === i ? 0xffffff : 0x66d2ff);
      }
      inst.onSelectionChange?.();
    },

    getSelected: () => selected,

    /** Commit a gizmo drag of the selected marker back into the path. */
    commitSelectedMarker() {
      if (selected < 0) return;
      path.ctrl[selected].copy(markers[selected].position);
      inst.rebuildTube();
      path.save();
    },

    /** Replace the whole path (used when a freehand stroke is finished). */
    setPathPoints(pts) {
      path.ctrl = pts;
      inst.select(-1);
      inst.rebuildTube();
      inst.rebuildMarkers();
      path.save();
    },

    addPoint() {
      const next = path.insertPoint(selected);
      if (next === null) return;
      selected = next;
      inst.rebuildTube();
      inst.rebuildMarkers();
      path.save();
    },

    removePoint() {
      if (!path.deletePoint(selected)) return;
      selected = -1;
      inst.rebuildTube();
      inst.rebuildMarkers();
      path.save();
    },

    resetPath() {
      path.reset();
      selected = -1;
      inst.rebuildTube();
      inst.rebuildMarkers();
      path.save();
    },

    setTension(v) {
      path.tension = v;
    },

    savePath: () => path.save(),

    snapshotPath: () => path.snapshot(),

    applyPathSnapshot(o) {
      if (!path.applySnapshot(o)) return;
      selected = -1;
      inst.rebuildTube();
      inst.rebuildMarkers();
    },
  };

  function applyHelpers(): void {
    const on = editorWanted && helpersRender;
    markerGroup.visible = on;
    pathLine.visible = on;
    const vis = 1 - helpersFade;
    (pathLine.material as THREE.LineBasicMaterial).opacity = vis;
    for (const m of markers) {
      m.material.transparent = vis < 0.999;
      m.material.opacity = vis;
    }
  }

  inst.rebuildTube();
  inst.rebuildMarkers();
  return inst;
}
