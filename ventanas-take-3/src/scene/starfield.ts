/** Twinkling point-sprite starfield behind everything. */
import * as THREE from 'three';
import { quality } from '../core/quality';
import { scene } from '../core/stage';

export const starUniforms = {
  uTime: { value: 0 },
  uSize: { value: 2.2 },
  uBright: { value: 1.0 },
  uCount: { value: 0 },
  uLayerFade: { value: 1.0 },
  uAlarm: { value: new THREE.Color(0, 0, 0) },
  uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
};

const starMat = new THREE.ShaderMaterial({
  uniforms: starUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /*glsl*/ `attribute float aRand,aRank; uniform float uSize,uPixelRatio; varying float vR,vRank;
    void main(){ vR=aRand; vRank=aRank; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=uSize*uPixelRatio*(0.4+aRand*1.6); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: /*glsl*/ `uniform float uTime,uBright,uLayerFade,uCount; uniform vec3 uAlarm; varying float vR,vRank;
    void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv); if(d>0.5) discard; float g=smoothstep(0.5,0.0,d);
      float countFade=smoothstep(vRank,vRank+120.0,uCount);
      float tw=0.5+0.5*sin(uTime*2.0+vR*45.0); vec3 col=mix(vec3(0.8,0.86,1.0), vec3(1.0), vR)*uBright*uLayerFade*tw + uAlarm*0.5;
      gl_FragColor=vec4(col*g*countFade,countFade); }`,
});

/** Parallax/drift is applied to this group, never to the points themselves. */
export const starGroup = new THREE.Group();
scene.add(starGroup);

export const starfieldMotion = {
  drift: 0.02,
  /** Max swing range in radians — rotation.y used to accumulate uncapped and spun too far. */
  swingRange: 0.12,
};

const STAR_CAPACITY = 14_000;

let starGeo: THREE.BufferGeometry | null = null;
let starPoints: THREE.Points | null = null;
let lastStarCount = -1;

/** Stable seeded random: changing count never relocates an existing star. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function ensureStarfield(): void {
  if (starPoints) return;
  const rand = random(0xe7a5_2026);
  const pos = new Float32Array(STAR_CAPACITY * 3);
  const rnd = new Float32Array(STAR_CAPACITY);
  const rank = new Float32Array(STAR_CAPACITY);
  for (let i = 0; i < STAR_CAPACITY; i++) {
    pos[i * 3] = (rand() * 2 - 1) * 26;
    pos[i * 3 + 1] = (rand() * 2 - 1) * 22;
    pos[i * 3 + 2] = -8 - rand() * 40;
    rnd[i] = rand();
    rank[i] = i;
  }
  starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  starGeo.setAttribute('aRank', new THREE.BufferAttribute(rank, 1));
  starGeo.setDrawRange(0, 0);
  starPoints = new THREE.Points(starGeo, starMat);
  starPoints.frustumCulled = false;
  starGroup.add(starPoints);
}

export function buildStars(count: number): void {
  ensureStarfield();
  // The count is authored on the timeline; the tier scales it, so a phone draws far
  // fewer additive sprites while the fade-in/out keyframes still read the same.
  const n = THREE.MathUtils.clamp(
    Math.round(count * quality.starCountScale),
    0,
    STAR_CAPACITY,
  );
  if (n === lastStarCount) return;
  lastStarCount = n;
  starUniforms.uCount.value = n;
  starGeo!.setDrawRange(0, Math.ceil(n));
}

export function setStarfieldLayer(fade: number, render: number): void {
  starUniforms.uLayerFade.value = 1 - fade;
  starGroup.visible = render >= 0.5;
}
