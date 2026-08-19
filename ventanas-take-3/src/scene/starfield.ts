/** Twinkling point-sprite starfield behind everything. */
import * as THREE from 'three';
import { scene } from '../core/stage';

export const starUniforms = {
  uTime: { value: 0 },
  uSize: { value: 2.2 },
  uBright: { value: 1.0 },
  uLayerFade: { value: 1.0 },
  uAlarm: { value: new THREE.Color(0, 0, 0) },
  uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
};

const starMat = new THREE.ShaderMaterial({
  uniforms: starUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /*glsl*/ `attribute float aRand; uniform float uSize,uPixelRatio; varying float vR;
    void main(){ vR=aRand; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=uSize*uPixelRatio*(0.4+aRand*1.6); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: /*glsl*/ `uniform float uTime,uBright,uLayerFade; uniform vec3 uAlarm; varying float vR;
    void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv); if(d>0.5) discard; float g=smoothstep(0.5,0.0,d);
      float tw=0.5+0.5*sin(uTime*2.0+vR*45.0); vec3 col=mix(vec3(0.8,0.86,1.0), vec3(1.0), vR)*uBright*uLayerFade*tw + uAlarm*0.5;
      gl_FragColor=vec4(col*g,1.0); }`,
});

/** Parallax/drift is applied to this group, never to the points themselves. */
export const starGroup = new THREE.Group();
scene.add(starGroup);

export const starfieldMotion = {
  drift: 0.02,
  /** Max swing range in radians — rotation.y used to accumulate uncapped and spun too far. */
  swingRange: 0.12,
};

let starGeo: THREE.BufferGeometry | null = null;
let starPoints: THREE.Points | null = null;
let lastStarCount = -1;

export function buildStars(count: number): void {
  const n = Math.max(0, Math.round(count));
  if (n === lastStarCount) return;
  lastStarCount = n;
  if (starPoints) {
    starGroup.remove(starPoints);
    starGeo?.dispose();
  }
  const pos = new Float32Array(n * 3);
  const rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 26;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * 22;
    pos[i * 3 + 2] = -8 - Math.random() * 40;
    rnd[i] = Math.random();
  }
  starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  starPoints = new THREE.Points(starGeo, starMat);
  starPoints.frustumCulled = false;
  starGroup.add(starPoints);
}

export function setStarfieldLayer(fade: number, render: number): void {
  starUniforms.uLayerFade.value = 1 - fade;
  starGroup.visible = render >= 0.5;
}
