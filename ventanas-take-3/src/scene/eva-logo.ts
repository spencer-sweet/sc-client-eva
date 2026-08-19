/**
 * EVA logo — the logo image (single turquoise tone + transparency) is used ONLY as a
 * shape mask (its alpha channel). The fill color comes from a uniform, so it can be
 * recolored to ANY color, not just variants of the original turquoise.
 */
import * as THREE from 'three';
import { LOGO_URL } from '../assets';
import { scene } from '../core/stage';

const tex = new THREE.TextureLoader().load(LOGO_URL);
tex.colorSpace = THREE.SRGBColorSpace;

const uniforms = {
  uMap: { value: tex },
  uColor: { value: new THREE.Color(0x18c0d8) },
  uOpacity: { value: 1.0 },
};

const mat = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: /*glsl*/ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /*glsl*/ `precision highp float; varying vec2 vUv; uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
    void main(){ float a=texture2D(uMap,vUv).a; gl_FragColor=vec4(uColor, a*uOpacity); }`,
});

// 4 units wide at the real crop aspect ratio (320x311)
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, (4 * 311) / 320), mat);
mesh.position.set(0, 0, 5);
mesh.renderOrder = 7;
scene.add(mesh);

let layerFade = 0;
let layerRender = true;
let lastLook: Parameters<typeof applyEvaLogo>[0] | null = null;

export function setLogoLayer(fade: number, render: number): void {
  layerFade = fade;
  layerRender = render >= 0.5;
  if (lastLook) applyEvaLogo(lastLook);
  else {
    mesh.visible = layerRender;
    uniforms.uOpacity.value = 1 - layerFade;
  }
}

/** Apply a Theatre "Logo EVA" payload. */
export function applyEvaLogo(v: {
  enabled: number;
  color: { r: number; g: number; b: number };
  opacity: number;
  scale: number;
  posX: number;
  posY: number;
  posZ: number;
}): void {
  lastLook = v;
  mesh.visible = v.enabled >= 0.5 && layerRender;
  uniforms.uColor.value.setRGB(v.color.r, v.color.g, v.color.b);
  uniforms.uOpacity.value = v.opacity * (1 - layerFade);
  mesh.scale.setScalar(v.scale);
  mesh.position.set(v.posX, v.posY, v.posZ);
}
