/**
 * Every Theatre sheet object and its wiring into the scene.
 *
 * This is the whole authoring surface in one place: adding a control means adding an
 * object here and a small `apply*` on the module that owns the visuals.
 *
 * Object creation order matters — `onValuesChange` fires synchronously while the saved
 * state loads, so anything a callback touches must already exist.
 */
import { types as t } from '@theatre/core';
import type { ISheet, ISheetObject } from '@theatre/core';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { camera } from '../core/stage';
import { setParallaxButton } from '../dev-helpers';
import { parallax } from '../interaction/parallax';
import { orbitState } from '../interaction/camera-orbit';
import { alarmLights, wallSpill } from '../scene/alarm-lights';
import { applyEvaLogo } from '../scene/eva-logo';
import { gridState } from '../scene/grid';
import {
  applyStarState,
  glow,
  onGlbLoaded,
  setShatterProgress,
  starGroup,
  starPos,
  starState,
} from '../scene/star-glb';
import { buildStars, starfieldMotion, starUniforms } from '../scene/starfield';
import { setWallColors } from '../scene/wall';
import { applyVortexLook, getVortex, VORTEX_IDS, VTX_RADIUS_DEFAULT } from '../scene/vortex';
import { applyLayerOutliner } from '../scene/layer-outliner';
import { applyWebflowDom } from '../webflow-dom';
import { applyNeon, applyWindowTransform, centerGlass, sideGlass } from '../scene/window-frames';
import { winCentersW } from '../windows/geometry';
import { centerMask, sideMask } from '../windows/mask';
import type { GlassMaterial } from '../scene/window-materials';
import { num, safeObject } from './setup';

/** Theatre rgba payloads arrive as plain 0..1 channels. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const rgbToHex = (c: Rgba): string => {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
};

/** Props shared by the "Side Windows" and "Center Window (glass)" objects. */
const glassProps = () => ({
  glassTint: t.rgba({ r: 0.1, g: 0.12, b: 0.22, a: 1 }),
  glassEdge: t.rgba({ r: 0.81, g: 0.65, b: 0.99, a: 1 }),
  glassOpacity: num(0.3, 0, 1),
  dissolve: num(0, 0, 1),
  edgeWidth: num(3.0, 0.3, 8),
  edgeIntensity: num(2.2, 0, 6),
  neonColor: t.rgba({ r: 1, g: 1, b: 1, a: 1 }),
  neonWidth: num(1.0, 0.1, 6),
  neonPulseBright: num(4.5, 0, 12),
  neonPulseSpeed: num(0.25, 0, 8),
});

type GlassValues = {
  glassTint: Rgba;
  glassEdge: Rgba;
  glassOpacity: number;
  dissolve: number;
  edgeWidth: number;
  edgeIntensity: number;
  neonColor: Rgba;
  neonWidth: number;
  neonPulseBright: number;
  neonPulseSpeed: number;
};

function applyGlass(glass: GlassMaterial, v: GlassValues): void {
  const u = glass.uniforms;
  u.uGlassTint.value.setRGB(v.glassTint.r, v.glassTint.g, v.glassTint.b);
  u.uGlassEdge.value.setRGB(v.glassEdge.r, v.glassEdge.g, v.glassEdge.b);
  u.uGlassOpacity.value = v.glassOpacity;
  u.uDissolve.value = v.dissolve;
  u.uEdgeWidth.value = v.edgeWidth;
  u.uEdgeIntensity.value = v.edgeIntensity;
}

export interface TheatreBindings {
  camObj: ISheetObject<CameraProps>;
  starObj: ISheetObject<StarProps>;
}

type CameraProps = ReturnType<typeof cameraProps>;
type StarProps = ReturnType<typeof starProps>;

const cameraProps = () => ({
  position: { x: num(0, -60, 60), y: num(0, -60, 60), z: num(18, 1, 80) },
  rotation: {
    x: num(0, -Math.PI, Math.PI),
    y: num(0, -Math.PI, Math.PI),
    z: num(0, -Math.PI, Math.PI),
  },
  fov: num(42, 15, 90),
});

const starProps = () => ({
  posX: num(winCentersW[0][0], -20, 20),
  posY: num(winCentersW[0][1], -20, 20),
  posZ: num(3.0, -6, 10),
  scale: num(0.7, 0.1, 2),
  emissiveColor: t.rgba({ r: 0.29, g: 0.63, b: 1, a: 1 }),
  emissiveIntensity: num(1.6, 0, 6),
  opacity: num(0.9, 0.05, 1),
  glowSize: num(3.4, 0.5, 8),
  glowIntensity: num(1.25, 0, 2),
  matcapZoom: { min: num(0.85, 0.2, 4), max: num(2.8, 0.5, 8) },
  matcapRot: {
    x: num(0, -Math.PI, Math.PI),
    y: num(0, -Math.PI, Math.PI),
    z: num(0, -Math.PI, Math.PI),
  },
  shatterProgress: num(0, 0, 1),
  /**
   * Idle hover: once the shatter has played out, every shard keeps drifting and
   * turning slightly. Driven by the render clock, not the sequence, so the motion
   * continues while the timeline sits paused. Amount fades in with shatterProgress,
   * so an intact star never jitters.
   */
  hoverAmount: num(0.06, 0, 0.5),
  hoverSpeed: num(0.24, 0, 3),
});

export function bindTheatre(sheet: ISheet, bloom: UnrealBloomPass): TheatreBindings {
  /* ---------- layer outliner ---------- */

  const layerPair = () => ({
    fade: num(0, 0, 1),
    render: t.stringLiteral('on', { on: 'On', off: 'Off' }, { as: 'switch', label: 'Render' }),
  });
  safeObject(
    'Layer Outliner',
    {
      wall: layerPair(),
      grid: layerPair(),
      sideWindows: layerPair(),
      centerWindow: layerPair(),
      starGlb: layerPair(),
      starGlow: layerPair(),
      starBackground: layerPair(),
      vortex: layerPair(),
      vortex2: layerPair(),
      vortexHelpers: layerPair(),
      logo: layerPair(),
      alarm: layerPair(),
    },
    (o) =>
      o.onValuesChange((v) =>
        applyLayerOutliner(v as Parameters<typeof applyLayerOutliner>[0]),
      ),
  );

  /* ---------- scene general (bloom + parallax) ---------- */

  // num(0/1) instead of t.boolean: this avoids depending on a types API that may not
  // exist as-is in every bundle version. If t.boolean threw here the whole script would
  // stop BEFORE reaching the render loop — the real cause of an old black-screen bug.
  const sceneGeneralObj = sheet.object('Scene General', {
    bloom: t.compound(
      {
        strength: t.number(0.4, { range: [0, 3], label: 'Strength' }),
        radius: t.number(0.5, { range: [0, 2], label: 'Radius' }),
        threshold: t.number(0.4, { range: [0, 1], label: 'Threshold' }),
      },
      { label: 'Bloom' },
    ),
    parallax: t.compound(
      {
        enabled: t.number(1, { range: [0, 1], label: 'Enabled' }),
        intensity: t.number(1, { range: [0, 3], label: 'Intensity' }),
      },
      { label: 'Parallax' },
    ),
  });
  sceneGeneralObj.onValuesChange((v) => {
    bloom.strength = v.bloom.strength;
    bloom.radius = v.bloom.radius;
    bloom.threshold = v.bloom.threshold;
    parallax.enabled = v.parallax.enabled >= 0.5;
    parallax.intensity = v.parallax.intensity;
    setParallaxButton(parallax.enabled);
  });

  /* ---------- camera ---------- */

  const camObj = sheet.object('Camera', cameraProps());
  camObj.onValuesChange((v) => {
    if (orbitState.active) return;
    camera.position.set(v.position.x, v.position.y, v.position.z);
    camera.rotation.set(v.rotation.x, v.rotation.y, v.rotation.z, 'YXZ');
    if (camera.fov !== v.fov) {
      camera.fov = v.fov;
      camera.updateProjectionMatrix();
    }
  });

  /* ---------- star background ---------- */

  const bgObj = sheet.object('Star Background', {
    count: num(1400, 0, 14000),
    brightness: num(1, 0, 3),
    drift: num(0.02, 0, 0.4),
    swingRange: num(0.12, 0, 1),
  });
  bgObj.onValuesChange((v) => {
    buildStars(v.count);
    starUniforms.uBright.value = v.brightness;
    starfieldMotion.drift = v.drift;
    starfieldMotion.swingRange = v.swingRange;
  });

  /* ---------- wall + grid ---------- */

  const wallObj = sheet.object('Wall', {
    colorCenter: t.rgba({ r: 0.125, g: 0.141, b: 0.329, a: 1 }),
    colorMid: t.rgba({ r: 0.11, g: 0.122, b: 0.282, a: 1 }),
    colorEdge: t.rgba({ r: 0.098, g: 0.11, b: 0.251, a: 1 }),
    lightSpill: t.compound(
      {
        enabled: t.number(1, { range: [0, 1], label: 'Enabled' }),
        intensity: t.number(1.0, { range: [0, 3], label: 'Intensity' }),
      },
      { label: 'Light Spill' },
    ),
  });
  wallObj.onValuesChange((v) => {
    setWallColors({
      center: rgbToHex(v.colorCenter),
      mid: rgbToHex(v.colorMid),
      edge: rgbToHex(v.colorEdge),
    });
    wallSpill.intensity = v.lightSpill.enabled >= 0.5 ? v.lightSpill.intensity : 0;
  });

  const gridObj = sheet.object('Grid', {
    color: t.rgba({ r: 0.81, g: 0.65, b: 0.99, a: 1 }),
    baseOpacity: num(0.16, 0, 1),
    pulseSpeed: num(0.35, 0, 3),
    pulseWidth: num(0.22, 0.02, 1),
    pulseBright: num(2.4, 0, 8),
    nodeBaseOpacity: num(0.65, 0, 1),
    nodePulseBright: num(2.4, 0, 8),
    lineWidth: num(0.01, 0.005, 0.4),
    vignette: num(1, 0, 1),
    pulseCount: num(4, 0, 21),
    mouseRadius: num(2.8, 0.1, 14),
    mousePulse: num(2.2, 0, 8),
  });
  gridObj.onValuesChange((v) => {
    gridState.color.setRGB(v.color.r, v.color.g, v.color.b);
    gridState.baseOpacity = v.baseOpacity;
    gridState.pulseSpeed = v.pulseSpeed;
    gridState.pulseWidth = v.pulseWidth;
    gridState.pulseBright = v.pulseBright;
    gridState.nodeBaseOpacity = v.nodeBaseOpacity;
    gridState.nodePulseBright = v.nodePulseBright;
    gridState.lineWidth = v.lineWidth;
    gridState.vignette = v.vignette;
    gridState.pulseCount = v.pulseCount;
    gridState.mouseRadius = v.mouseRadius;
    gridState.mousePulse = v.mousePulse;
  });

  /* ---------- windows ---------- */

  // The center glass used to have a fixed, nearly invisible color; now it takes its own
  // so it can be pushed toward the EVA logo turquoise.
  const centerGlassObj = sheet.object('Center Window (glass)', {
    ...glassProps(),
    glassTint: t.rgba({ r: 0, g: 0, b: 0, a: 1 }),
    glassOpacity: num(0.0, 0, 1),
  });
  centerGlassObj.onValuesChange((v) => {
    applyGlass(centerGlass, v);
    applyNeon(0, v);
  });

  safeObject(
    'Center Window (mask)',
    { offsetX: num(0, -6, 6), offsetY: num(0, -6, 6), scaleX: num(1, 0.2, 3), scaleY: num(1, 0.2, 3) },
    (o) =>
      o.onValuesChange((v) => {
        centerMask.offX = v.offsetX;
        centerMask.offY = v.offsetY;
        centerMask.scX = v.scaleX;
        centerMask.scY = v.scaleY;
        applyWindowTransform(0);
      }),
  );

  const winObj = sheet.object('Side Windows', {
    ...glassProps(),
    offsetX: num(0, -4, 4),
    offsetY: num(0, -4, 4),
    scaleX: num(1, 0.2, 3),
    scaleY: num(1, 0.2, 3),
  });
  winObj.onValuesChange((v) => {
    applyGlass(sideGlass, v);
    // dissolve=1 must also kill the neon on the 2 side windows, otherwise their
    // outlines stayed visible after the glass was gone.
    applyNeon(1, v);
    applyNeon(2, v);
    sideMask.offsetX = v.offsetX;
    sideMask.offsetY = v.offsetY;
    sideMask.scX = v.scaleX;
    sideMask.scY = v.scaleY;
    applyWindowTransform(1);
    applyWindowTransform(2);
  });

  /* ---------- star (GLB) ---------- */

  const starObj = sheet.object('Star (GLB)', starProps());
  starObj.onValuesChange((v) => {
    starState.scale = v.scale;
    starState.emiColor.setRGB(v.emissiveColor.r, v.emissiveColor.g, v.emissiveColor.b);
    starState.emiInt = v.emissiveIntensity;
    starState.opacity = v.opacity;
    starState.glowSize = v.glowSize;
    starState.glowInt = v.glowIntensity;
    starPos.x = v.posX;
    starPos.y = v.posY;
    starPos.z = v.posZ;
    starGroup.position.set(v.posX, v.posY, v.posZ);
    glow.position.set(v.posX, v.posY, v.posZ - 0.2);
    starState.matcapZoomMin = v.matcapZoom.min;
    starState.matcapZoomMax = v.matcapZoom.max;
    starState.matcapRot.set(v.matcapRot.x, v.matcapRot.y, v.matcapRot.z);
    starState.hoverAmount = v.hoverAmount;
    starState.hoverSpeed = v.hoverSpeed;
    applyStarState();
    setShatterProgress(v.shatterProgress);
  });
  // A hot GLB reload must honor whatever shatterProgress the timeline currently holds.
  onGlbLoaded(() => setShatterProgress(starObj.value.shatterProgress));

  /* ---------- alarm lights ---------- */

  for (const [idx, dx] of [
    [0, -8],
    [1, 8],
  ] as const) {
    const obj = sheet.object('Alarm / Light ' + (idx + 1), {
      color: t.rgba({ r: 1, g: 0.16, b: 0.16, a: 1 }),
      intensity: num(1.4, 0, 5),
      flicker: num(0.7, 0, 1),
      speed: num(1.5, 0, 8),
      posX: num(dx, -25, 25),
      posY: num(0, -20, 20),
    });
    obj.onValuesChange((v) => {
      const l = alarmLights[idx];
      l.color.setRGB(v.color.r, v.color.g, v.color.b);
      l.intensity = v.intensity;
      l.flicker = v.flicker;
      l.speed = v.speed;
      l.x = v.posX;
      l.y = v.posY;
    });
  }

  /* ---------- vortex ---------- */

  // Vortex 1 and Vortex 2 are identical authoring surfaces over two independent tunnels;
  // which one the Dev UI draws/edits is picked with its "Editing" dropdown.
  const vortexProps = () => ({
    pathTrim: t.compound(
      { trimStart: num(0.0, 0, 1), trimEnd: num(1.0, 0, 1) },
      { label: 'Path Trim' },
    ),
    enabled: num(1, 0, 1),
    scale: num(1, 0.2, 4),
    radius: num(VTX_RADIUS_DEFAULT, 1, 40),
    taperStart: num(1.0, 0.02, 3),
    taperEnd: num(1.0, 0.02, 3),
    colorCore: t.rgba({ r: 0.851, g: 1.0, b: 1.0, a: 1 }),
    colorMid: t.rgba({ r: 0.12, g: 0.851, b: 0.878, a: 1 }),
    colorEdge: t.rgba({ r: 0.5, g: 0.278, b: 0.9, a: 1 }),
    speed: num(0.6, 0, 4),
    swirl: num(0.8, -12, 12),
    noiseScale: num(3.0, 0.5, 6),
    turbulence: num(0.8, 0, 2),
    glow: num(1.6, 0.3, 4),
    detail: num(1.0, 0.5, 6),
    fill: num(0.15, 0, 1.5),
    exitGlow: num(0.25, 0, 2),
  });

  const onVortexChange = (id: (typeof VORTEX_IDS)[number]) => {
    const uniforms = getVortex(id).uniforms;
    return (v: {
      pathTrim: { trimStart: number; trimEnd: number };
    } & import('../scene/vortex').VortexLook) => {
      uniforms.uTrimStart.value = Math.min(v.pathTrim.trimStart, v.pathTrim.trimEnd);
      uniforms.uTrimEnd.value = Math.max(v.pathTrim.trimStart, v.pathTrim.trimEnd);
      applyVortexLook(id, v);
    };
  };

  safeObject('Vortex 1', vortexProps(), (o) => o.onValuesChange(onVortexChange(1)));
  safeObject(
    'Vortex 2',
    {
      ...vortexProps(),
      translate: t.compound(
        {
          x: num(0, -80, 80),
          y: num(0, -80, 80),
          z: num(0, -80, 80),
        },
        { label: 'Translate' },
      ),
      rotation: t.compound(
        {
          x: num(0, -Math.PI, Math.PI),
          y: num(0, -Math.PI, Math.PI),
          z: num(0, -Math.PI, Math.PI),
        },
        { label: 'Rotation' },
      ),
      scaleXYZ: t.compound(
        {
          x: num(1, 0.05, 8),
          y: num(1, 0.05, 8),
          z: num(1, 0.05, 8),
        },
        { label: 'Scale' },
      ),
    },
    (o) => o.onValuesChange(onVortexChange(2)),
  );

  /* ---------- logo ---------- */

  safeObject(
    'Logo EVA',
    {
      enabled: num(1, 0, 1),
      color: t.rgba({ r: 0.094, g: 0.753, b: 0.847, a: 1 }),
      opacity: num(1.0, 0, 1),
      scale: num(1, 0.05, 6),
      posX: num(0, -30, 30),
      posY: num(0, -30, 30),
      posZ: num(5, -60, 30),
    },
    (o) => o.onValuesChange(applyEvaLogo),
  );

  /* ---------- Webflow DOM (page copy outside the canvas) ---------- */

  // Controls always exist so they can be keyed on the timeline. applyWebflowDom is a
  // no-op on localhost / *.pages.dev — it only writes CSS on eva-networks-staging
  // and evanetworks.com, where these ids live in the Webflow page.
  const webflowTranslate = (
    translate: { unit: 'px' | '%'; x?: number; y?: number; z?: number } = { unit: 'px' },
  ) =>
    t.compound(
      {
        unit: t.stringLiteral(translate.unit, { px: 'px', '%': '%' }, { as: 'switch', label: 'Unit' }),
        x: t.number(translate.x ?? 0, { range: [-800, 800], label: 'X' }),
        y: t.number(translate.y ?? 0, { range: [-800, 800], label: 'Y' }),
        z: t.number(translate.z ?? 0, { range: [-800, 800], label: 'Z' }),
      },
      { label: 'Translate' },
    );

  const webflowLayer = (
    label: string,
    opts: {
      translate?: { unit: 'px' | '%'; x?: number; y?: number; z?: number };
      /** When false, omit Blur — Webflow keeps ownership of filter (e.g. #how-*). Default true. */
      blur?: boolean;
      /**
       * Label for the 0..1 fade knob. The PROP KEY stays `opacity` whatever this says —
       * renaming it would orphan every keyframe in theatre-state. The #how-* cards call
       * it "Fade" because their value is written as a `--card-fade` custom property
       * rather than CSS opacity, which would kill the card's backdrop-filter (see
       * FadeMode in webflow-dom.ts).
       */
      fadeLabel?: string;
    } = {},
  ) => {
    const base = {
      opacity: t.number(1, { range: [0, 1], label: opts.fadeLabel ?? 'Opacity' }),
      scale: t.number(1, { range: [0, 4], label: 'Scale' }),
      translate: webflowTranslate(opts.translate ?? { unit: 'px' }),
    };
    if (opts.blur === false) return t.compound(base, { label });
    return t.compound(
      { ...base, blur: t.number(0, { range: [0, 40], label: 'Blur (px)' }) },
      { label },
    );
  };

  safeObject(
    'Webflow DOM',
    {
      textInfra: webflowLayer('#text-infra'),
      indicatorScroll: webflowLayer('#indicator-scroll', { translate: { unit: '%', x: -50 } }),
      how1: webflowLayer('#how-1', { blur: false, fadeLabel: 'Fade' }),
      how2: webflowLayer('#how-2', { blur: false, fadeLabel: 'Fade' }),
      how3: webflowLayer('#how-3', { blur: false, fadeLabel: 'Fade' }),
      how4: webflowLayer('#how-4', { blur: false, fadeLabel: 'Fade' }),
      how5: webflowLayer('#how-5', { blur: false, fadeLabel: 'Fade' }),
    },
    (o) =>
      o.onValuesChange((v) =>
        applyWebflowDom(v as Parameters<typeof applyWebflowDom>[0]),
      ),
  );

  return { camObj, starObj };
}
