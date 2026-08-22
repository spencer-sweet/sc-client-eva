/**
 * The wall: an SVG-faithful radial gradient on a plain quad, with the window openings
 * cut out by the stencil buffer (see windows/stencil.ts).
 *
 * This used to be a ShapeGeometry carrying 3 real holes, re-triangulated from scratch
 * whenever a window offset/scale changed — which, with those props on the timeline,
 * meant three earcut passes plus three geometry uploads on every scrolled frame. The
 * stencil cutout gives the same hard-edged opening for two static triangles and zero
 * per-frame CPU, so a window can now be moved or scaled purely by transforming its own
 * group.
 *
 * The gradient itself used to be PAINTED, into a canvas the full size of the source SVG
 * at 2x supersample — 2880 x 3254, about 47MB of VRAM once mipped, and re-uploaded in
 * full every time `setWallColors` ran. For three colour stops. It is three `mix`es, so
 * it is computed in the fragment shader now: no texture, no upload, no memory, and no
 * 8-bit banding across a very large smooth ramp. Recolouring is a uniform write.
 *
 * Note the neon/glow/flares for the windows are NOT baked in here — they live as real
 * 3D objects, see scene/window-frames.ts.
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
const DEFAULT_COLORS: WallColors = { center: '#202454', mid: '#1c1f48', edge: '#191c40' };

/** Gradient geometry, in the SVG's own coordinate space — the values the canvas used. */
const GRAD_CX = SVG_W * 0.5;
const GRAD_CY = SVG_H * 0.46;
const GRAD_RADIUS = Math.max(SVG_W, SVG_H) * 0.75;
/** Where the mid stop sits between center (0) and edge (1). */
const GRAD_MID_STOP = 0.55;

/**
 * Colour stops are held as RAW sRGB triples, NOT as three's usual linear working
 * values: a canvas gradient interpolates in sRGB, so to land on the same pixels the
 * shader has to mix in sRGB and convert once at the end. `LinearSRGBColorSpace` here
 * means "the input is already in the working space", i.e. don't convert on the way in —
 * which leaves the literal 0..1 sRGB numerals in r/g/b.
 */
function srgbTriple(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}

const uniforms = {
  uCenter: { value: srgbTriple(DEFAULT_COLORS.center) },
  uMid: { value: srgbTriple(DEFAULT_COLORS.mid) },
  uEdge: { value: srgbTriple(DEFAULT_COLORS.edge) },
  uOpacity: { value: 1 },
};

/**
 * Starts TRULY opaque. The fade (see setWallLayer) flips `transparent` on only
 * while blackout > 0 — an always-transparent wall joins the ambiguous draw queue next
 * to the GLB's glass and can erase it.
 */
export const wallMat = cutOutWindows(
  new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    depthWrite: true,
    // Position -> SVG pixel space, exactly the mapping the baked UVs used to carry.
    // The quad has four vertices, so this interpolates the gradient coordinate exactly.
    vertexShader: /*glsl*/ `varying vec2 vSvg;
      void main(){
        vSvg = vec2(position.x / ${WSCALE.toFixed(8)} + ${(SVG_W * 0.5).toFixed(1)},
                    ${(SVG_H * 0.5).toFixed(1)} - position.y / ${WSCALE.toFixed(8)});
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /*glsl*/ `precision mediump float; varying vec2 vSvg;
      uniform vec3 uCenter, uMid, uEdge; uniform float uOpacity;
      // The scene renders into a linear half-float target, so the sRGB-space mix has to
      // be decoded on the way out — the same thing sampling an sRGB-tagged texture did.
      vec3 srgbToLinear(vec3 c){
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
      }
      void main(){
        float t = clamp(distance(vSvg, vec2(${GRAD_CX.toFixed(1)}, ${GRAD_CY.toFixed(1)})) / ${GRAD_RADIUS.toFixed(1)}, 0.0, 1.0);
        const float mid = ${GRAD_MID_STOP.toFixed(2)};
        vec3 srgb = t < mid
          ? mix(uCenter, uMid, t / mid)
          : mix(uMid, uEdge, (t - mid) / (1.0 - mid));
        gl_FragColor = vec4(srgbToLinear(srgb), uOpacity);
      }`,
  }),
);

const WALL_W = 52;
const WALL_H = 44;

export const wall = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), wallMat);
wall.position.z = 0;
wall.renderOrder = 1;
// One quad that always covers the view; culling it per frame buys nothing.
wall.frustumCulled = false;
nearLayer.add(wall);

/** Recolour the gradient. Three uniform writes — nothing is rebuilt or re-uploaded. */
export function setWallColors(next: WallColors): void {
  uniforms.uCenter.value.setStyle(next.center, THREE.LinearSRGBColorSpace);
  uniforms.uMid.value.setStyle(next.mid, THREE.LinearSRGBColorSpace);
  uniforms.uEdge.value.setStyle(next.edge, THREE.LinearSRGBColorSpace);
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
  uniforms.uOpacity.value = 1 - blackout;
  const shouldBeTransparent = blackout > 0.001;
  if (wallMat.transparent !== shouldBeTransparent) {
    wallMat.transparent = shouldBeTransparent;
    wallMat.needsUpdate = true;
  }
  wallMat.depthWrite = !shouldBeTransparent;
}
