/**
 * The tunnel shader: simplex noise + fbm + domain-warp/turbulence, beam formation with
 * adjustable "detail"/"fill", cyan/violet tint by angular region, a hot core in the
 * brightest beams, and a trim with a hard cut plus a bright tip.
 *
 * Faithful port of vortex-interior-theatre_4.html — it reuses THIS scene's camera and
 * starfield rather than bringing its own.
 *
 * This is the most expensive shader in the scene by a wide margin: it is viewed from
 * INSIDE the tube, so it covers the whole screen. Its cost is therefore tiered
 * (core/quality.ts) and compiled in rather than branched on:
 *  - fbm octaves: 4 authored / 2 on the low tier,
 *  - the domain warp costs 3 of the 5 fbm calls and is dropped on the low tier,
 *  - DoubleSide shades every pixel twice (both tube walls, additively); the low tier
 *    draws back faces only — the ones you actually look at from inside — and scales
 *    the color back up to keep a comparable density.
 */
import * as THREE from 'three';
import { quality } from '../../core/quality';

export const VTX_RADIUS_DEFAULT = 8;

/** Per-instance uniforms — every vortex owns its own set so their looks stay independent. */
export function createVortexUniforms() {
  return {
    uTime: { value: 0 },
    uColorCore: { value: new THREE.Color(0xd9ffff) },
    uColorMid: { value: new THREE.Color(0x1fd9e0) },
    uColorEdge: { value: new THREE.Color(0x7f47e6) },
    uSpeed: { value: 0.6 },
    uNoiseScale: { value: 3.0 },
    uTurbulence: { value: 0.8 },
    uGlow: { value: 1.6 },
    uDetail: { value: 1.0 },
    uFill: { value: 0.15 },
    uSwirl: { value: 0.032 },
    uTrimStart: { value: 0.0 },
    uTrimEnd: { value: 1.0 },
    uRadiusBase: { value: VTX_RADIUS_DEFAULT },
    uTaperStart: { value: 1.0 },
    uTaperEnd: { value: 1.0 },
    uLayerFade: { value: 1.0 },
  };
}

export type VortexUniforms = ReturnType<typeof createVortexUniforms>;

export function createVortexMaterial(uniforms: VortexUniforms): THREE.ShaderMaterial {
  const q = quality.vortex;
  return new THREE.ShaderMaterial({
  uniforms,
  side: q.singleSided ? THREE.BackSide : THREE.DoubleSide,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /*glsl*/ `varying vec2 vUv;
    uniform float uRadiusBase, uTaperStart, uTaperEnd;
    void main(){
      vUv=uv.yx;
      vec3 pos=position;
      float taperMul = mix(uTaperStart, uTaperEnd, uv.x);
      pos += normal * uRadiusBase * (taperMul - 1.0);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
    }`,
  fragmentShader: /*glsl*/ `
    #define FBM_OCTAVES ${q.fbmOctaves}
    #define GLOW_COMP ${q.glowCompensation.toFixed(2)}
    ${q.domainWarp ? '#define DOMAIN_WARP' : ''}
    precision highp float; varying vec2 vUv;
    uniform float uTime; uniform vec3 uColorCore; uniform vec3 uColorMid; uniform vec3 uColorEdge;
    uniform float uSpeed; uniform float uNoiseScale; uniform float uTurbulence; uniform float uGlow; uniform float uDetail; uniform float uFill; uniform float uSwirl;
    uniform float uTrimStart; uniform float uTrimEnd; uniform float uLayerFade;
    vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
      vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
      float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
      vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
      vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
      vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
      return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
    float fbm(vec3 p){ float total=0.0; float amp=0.5; for(int i=0;i<FBM_OCTAVES;i++){ total+=amp*snoise(p); p*=2.0; amp*=0.5; } return total; }
    void main(){
      float ang=vUv.x + uSwirl*uTime;
      float len=vUv.y;
      vec2 circ=vec2(cos(ang*6.2831853), sin(ang*6.2831853));
      float flow = len*0.9 + uTime*uSpeed*0.4;
      vec3 Pp = vec3(circ*uNoiseScale, flow);
      #ifdef DOMAIN_WARP
        vec3 w = vec3(fbm(Pp+vec3(0.0,0.0,uTime*0.05)), fbm(Pp+vec3(3.1,1.7,0.0)), fbm(Pp+vec3(8.2,4.4,0.0)));
        float f = fbm(Pp + uTurbulence*3.0*w);
      #else
        // One warp sample reused on all three axes: the beams still swim and braid,
        // for 2 fbm calls instead of 5.
        float wn = fbm(Pp+vec3(0.0,0.0,uTime*0.05));
        float f = fbm(Pp + uTurbulence*3.0*vec3(wn, wn*0.7+0.3, wn*-0.5));
      #endif
      float v = clamp(f*0.5+0.5, 0.0, 1.0);
      float beam = smoothstep(0.42, 0.90, v);
      beam = pow(beam, mix(2.6, 1.0, clamp(uDetail/3.0,0.0,1.0)));
      beam = max(beam, v*uFill*0.5);
      float env = smoothstep(0.0,0.18,len) * smoothstep(1.0,0.82,len);
      float hue = fbm(vec3(circ*uNoiseScale*0.6+7.0, flow*0.5))*0.5+0.5;
      vec3 tint = mix(uColorMid, uColorEdge, smoothstep(0.35,0.65,hue));
      vec3 color = tint*beam;
      color += uColorCore*pow(beam,3.0)*0.6;
      color *= uGlow * GLOW_COMP;
      float alpha = clamp(beam*env*1.5, 0.0, 1.0);
      float inRange=step(uTrimStart,vUv.y)*step(vUv.y,uTrimEnd);
      float tipE=1.0-smoothstep(0.0,0.03,abs(vUv.y-uTrimEnd));
      float tipS=1.0-smoothstep(0.0,0.03,abs(vUv.y-uTrimStart));
      float tip=max(tipE,tipS);
      alpha*=inRange; alpha=max(alpha,tip*0.95);
      color=mix(color,uColorCore,tip); color*=1.0+tip*1.5;
      gl_FragColor=vec4(color,alpha*uLayerFade);
    }`,
  });
}
