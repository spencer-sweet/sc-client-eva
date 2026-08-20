/**
 * Materials for the window glass and the live neon outlines.
 *
 * Both react to the two alarm lights via shared `uLightPos` / `uLightColI` uniform
 * arrays that scene/alarm-lights.ts refreshes once per frame.
 */
import * as THREE from 'three';

/** Two alarm lights feed every glass/neon shader. */
export interface LightUniforms {
  uLightPos: THREE.IUniform<THREE.Vector3[]>;
  uLightColI: THREE.IUniform<THREE.Color[]>;
}

function makeLightUniforms(): LightUniforms {
  return {
    uLightPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uLightColI: { value: [new THREE.Color(), new THREE.Color()] },
  };
}

const LIGHT_TINT_GLSL = /*glsl*/ `
  vec3 alarmTint(vec3 worldPos, vec3 lightPos[2], vec3 lightColI[2]){
    vec3 tint=vec3(0.0);
    for(int i=0;i<2;i++){ vec3 Ld=lightPos[i]-worldPos; float att=1.0/(1.0+dot(Ld,Ld)*0.02); tint+=lightColI[i]*att; }
    return tint;
  }`;

export interface GlassMaterial {
  mat: THREE.ShaderMaterial;
  uniforms: LightUniforms & {
    uGlassTint: THREE.IUniform<THREE.Color>;
    uGlassEdge: THREE.IUniform<THREE.Color>;
    uGlassOpacity: THREE.IUniform<number>;
    uLayerFade: THREE.IUniform<number>;
    uDissolve: THREE.IUniform<number>;
    uEdgeWidth: THREE.IUniform<number>;
    uEdgeIntensity: THREE.IUniform<number>;
  };
}

/**
 * Fresnel-rimmed glass in the EXACT SVG shape.
 *
 * Reusable factory: the center window uses a near-transparent-at-rest variant (so it
 * doesn't cover the GLB) that still reacts to the alarm light — otherwise the alarm red
 * never showed on the center window.
 */
export function makeGlass(tint: number, opacity: number): GlassMaterial {
  const uniforms = {
    uGlassTint: { value: new THREE.Color(tint) },
    uGlassEdge: { value: new THREE.Color(0.81, 0.65, 0.99) },
    uGlassOpacity: { value: opacity },
    uLayerFade: { value: 1.0 },
    uDissolve: { value: 0.0 },
    uEdgeWidth: { value: 3.0 },
    uEdgeIntensity: { value: 2.2 },
    ...makeLightUniforms(),
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /*glsl*/ `precision highp float; varying vec3 vW;
      uniform vec3 uGlassTint,uGlassEdge; uniform float uGlassOpacity,uLayerFade,uDissolve,uEdgeWidth,uEdgeIntensity; uniform vec3 uLightPos[2]; uniform vec3 uLightColI[2];
      ${LIGHT_TINT_GLSL}
      void main(){
        vec3 N=vec3(0.0,0.0,1.0); vec3 V=normalize(cameraPosition-vW);
        // uEdgeWidth is the fresnel exponent: SMALL values widen the rim (covers more
        // surface), LARGE values thin it (sharper edge hugging the contour).
        float fres=pow(1.0-clamp(dot(N,V),0.0,1.0),uEdgeWidth);
        vec3 tint=alarmTint(vW,uLightPos,uLightColI);
        vec3 col=uGlassTint + tint + uGlassEdge*fres*uEdgeIntensity;
        // uDissolve kills COMPLETE alpha (including the rim/fresnel glow) — unlike
        // lowering only uGlassOpacity, this leaves no visible outline at all.
        float alpha=clamp(uGlassOpacity + fres*0.55 + (tint.r+tint.g+tint.b)*0.15, 0.0, 0.95) * (1.0-uDissolve) * uLayerFade;
        gl_FragColor=vec4(col,alpha);
      }`,
  });
  return { mat, uniforms };
}

/**
 * Light uniforms SHARED by all 3 windows' neon — updated once per frame and referenced
 * by every frame material, the same pattern the glass uniforms use.
 */
export const neonLightU = makeLightUniforms();

/**
 * One neon stroke.
 *
 * `softness` picks the cross-section the fragment shader shades across the ribbon's
 * width: 0 is a solid band with an antialiased edge (the bright filament), 1 is a
 * gaussian tube (the halo). Shading the profile analytically is what makes the outline
 * look like glass tubing rather than two flat quads — and it antialiases itself from
 * `fwidth`, which matters because the composer target has no MSAA and adaptive
 * resolution can drop the buffer to 55%, where a hard-edged 2px stroke crawls.
 */
export function makeNeonMat(
  colorHex: number,
  opacityBase: number,
  widthBase: number,
  softness: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacityBase: { value: opacityBase },
      uBright: { value: 1.0 },
      uLayerFade: { value: 1.0 },
      uDissolve: { value: 0.0 },
      uWidth: { value: widthBase },
      uSoftness: { value: softness },
      ...neonLightU,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /*glsl*/ `attribute vec3 aOffset; attribute float aSide;
      uniform float uWidth; varying vec3 vW; varying float vSide;
      void main(){
        // "aOffset" is the stroke's precomputed mitered perpendicular; width stays fully real-time
        vec3 pos = position + aOffset*uWidth;
        vSide = aSide;
        vW=(modelMatrix*vec4(pos,1.0)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader: /*glsl*/ `precision highp float; varying vec3 vW; varying float vSide;
      uniform vec3 uColor; uniform float uOpacityBase,uBright,uLayerFade,uDissolve,uSoftness; uniform vec3 uLightPos[2]; uniform vec3 uLightColI[2];
      ${LIGHT_TINT_GLSL}
      void main(){
        float s = clamp(abs(vSide), 0.0, 1.0);
        // Screen-space width of one "side" unit -> the edge fades over exactly one pixel
        // whatever the stroke width, the camera distance or the current resolution step.
        float aa = clamp(fwidth(vSide)*1.5, 0.004, 1.0);
        float band = 1.0 - smoothstep(1.0-aa, 1.0, s);
        // The gaussian is still multiplied by "band" so it is cut cleanly at the quad
        // edge — exp() alone leaves a ~4% step there, which reads as a hard outline.
        float profile = mix(band, exp(-s*s*3.2)*band, uSoftness);
        // frame/neon "reflects" the alarm light when nearby
        vec3 col=uColor + alarmTint(vW,uLightPos,uLightColI)*1.4;
        // uBright is applied ONCE. It used to multiply the colour AND the alpha, and
        // additive blending multiplies the two — so the pulse was really uBright^2 and
        // its peak (30x) sat far past where ACES flattens out. The visible part of the
        // curve was the ramp only, which read as a strobe rather than a breath.
        float a=uOpacityBase*profile*uBright*(1.0-uDissolve)*uLayerFade;
        gl_FragColor=vec4(col, a);
      }`,
  });
}
