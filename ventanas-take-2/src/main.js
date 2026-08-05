import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getProject, types as t, onChange } from '@theatre/core';
import studio from '@theatre/studio';
import theatreState from './ventanas-state.json';

const bail=(m)=>{ const e=document.getElementById('err'); e.style.display='grid'; e.firstElementChild.innerHTML=m; };

// Studio loads by default (same authoring workflow as the single-file HTML).
// Pass ?minify to skip it (e.g. Webflow embed).
const THEATRE_STUDIO = !new URLSearchParams(window.location.search).has('minify');
let studioReady=false;
if (THEATRE_STUDIO) {
  try{ studio.initialize({ usePersistentStorage: true }); studioReady=true; }catch(err){ console.error(err); }
}

const GLB_URL = `${import.meta.env.BASE_URL}estrella.glb`;
const LOGO_URL = `${import.meta.env.BASE_URL}eva-logo.png`;

/* =========================================================================
   DATOS VECTORIALES EXACTOS extraídos de Window_set.svg (viewBox 1440x1627)
   ========================================================================= */
const SVG_W=1440, SVG_H=1627;
const CRISP  = ["M719.309 493.4813C720.7344 488.5062 728.5656 488.5062 729.991 493.4813C741.1842 532.5542 769.7592 619.1548 813.7022 663.0978C857.6452 707.0408 944.2458 735.6158 983.3187 746.809C988.2938 748.2344 988.2938 756.0656 983.3187 757.491C944.2458 768.6842 857.6452 797.2592 813.7022 841.2022C769.7592 885.1452 741.1842 971.7458 729.991 1010.8187C728.5656 1015.7938 720.7344 1015.7938 719.309 1010.8187C708.1158 971.7458 679.5408 885.1452 635.5978 841.2022C591.6548 797.2592 505.0542 768.6842 465.9813 757.491C461.0062 756.0656 461.0062 748.2344 465.9813 746.809C505.0542 735.6158 591.6548 707.0408 635.5978 663.0978C679.5408 619.1548 708.1158 532.5542 719.309 493.4813Z","M376.8714 872.0336C378.1066 867.7221 384.8934 867.7221 386.1286 872.0336C395.8288 905.8948 420.5923 980.9442 458.674 1019.026C496.7558 1057.1077 571.8052 1081.8712 605.6664 1091.5714C609.9779 1092.8066 609.9779 1099.5934 605.6664 1100.8286C571.8052 1110.5288 496.7558 1135.2923 458.674 1173.374C420.5923 1211.4558 395.8288 1286.5052 386.1286 1320.3664C384.8934 1324.6779 378.1066 1324.6779 376.8714 1320.3664C367.1712 1286.5052 342.4077 1211.4558 304.326 1173.374C266.2442 1135.2923 191.1948 1110.5288 157.3336 1100.8286C153.0221 1099.5934 153.0221 1092.8066 157.3336 1091.5714C191.1948 1081.8712 266.2442 1057.1077 304.326 1019.026C342.4077 980.9442 367.1712 905.8948 376.8714 872.0336Z","M1060.1714 872.0336C1061.4066 867.7221 1068.1934 867.7221 1069.4286 872.0336C1079.1288 905.8948 1103.8923 980.9442 1141.974 1019.026C1180.0558 1057.1077 1255.1052 1081.8712 1288.9664 1091.5714C1293.2779 1092.8066 1293.2779 1099.5934 1288.9664 1100.8286C1255.1052 1110.5288 1180.0558 1135.2923 1141.974 1173.374C1103.8923 1211.4558 1079.1288 1286.5052 1069.4286 1320.3664C1068.1934 1324.6779 1061.4066 1324.6779 1060.1714 1320.3664C1050.4712 1286.5052 1025.7077 1211.4558 987.626 1173.374C949.5442 1135.2923 874.4948 1110.5288 840.6336 1100.8286C836.3221 1099.5934 836.3221 1092.8066 840.6336 1091.5714C874.4948 1081.8712 949.5442 1057.1077 987.626 1019.026C1025.7077 980.9442 1050.4712 905.8948 1060.1714 872.0336Z"];   // 3 estrellas nitidas (forma correcta 4star_03a)
const GHOST  = ["M450.694 741.196C613.306 701.874 687.614 593.858 715.762 477.01C717.935 467.99 734.184 467.934 736.157 476.999C762.019 595.846 815.569 689.936 999.766 742.392C1008.03 744.746 1007.9 757.506 999.537 759.509C843.939 796.776 767.394 862.741 733.408 1033.78C731.644 1042.65 717.051 1043.05 714.759 1034.3C672.547 873.064 584.443 795.59 450.57 762.703C441.536 760.484 441.653 743.382 450.694 741.196Z","M824.972 1084.11C967.056 1047.48 1029.64 953.868 1054.53 855.062C1056.8 846.066 1073.34 846.033 1075.4 855.078C1098.79 957.575 1147.21 1039.37 1305.28 1085.53C1313.53 1087.94 1313.29 1100.79 1304.95 1102.85C1170.52 1135.86 1103.91 1194.03 1073.51 1341.27C1071.68 1350.13 1056.88 1350.54 1054.51 1341.81C1016.86 1203.34 940.306 1135.5 824.938 1105.9C815.961 1103.59 815.998 1086.43 824.972 1084.11Z","M144.516 1084.72C292.433 1049.25 349.175 954.899 372.068 855.941C374.159 846.902 390.229 846.799 392.275 855.848C415.4 958.129 463.014 1040.07 620.447 1086.16C628.698 1088.57 628.46 1101.43 620.11 1103.48C485.16 1136.61 419.527 1194.82 389.681 1344.16C387.932 1352.91 374.038 1353.41 371.716 1344.79C332.157 1197.93 269.453 1136.05 144.39 1105.96C135.343 1103.79 135.467 1086.89 144.516 1084.72Z"];   // 3 estrellas grandes difusas detras (glow)
const BLOBS  = ["M999.394 742.78L985.498 746.704C988.135 748.555 987.792 752.989 985.498 754.873C986.665 754.873 999.696 759.086 999.696 759.086C1008.31 756.382 1006.48 743.849 999.394 742.78Z","M449.075 761.351L462.167 755.162C459.531 753.311 459.873 748.877 462.167 746.993C461 746.993 447.97 742.78 447.97 742.78C443.287 746.396 442.772 758.83 449.075 761.351Z","M716.464 475.857L720.478 491.208C722.328 488.572 727.151 488.481 729.036 490.775C729.036 490.073 735.729 475.857 735.729 475.857C730.554 467.518 718.313 470.162 716.464 475.857Z","M732.926 1034.3L727.497 1013.29C725.646 1015.93 721.372 1015.58 719.487 1013.29C719.487 1013.99 715.514 1034.79 715.514 1034.79C718.555 1043.13 731.602 1040.97 732.926 1034.3Z","M620.923 1087.66L608.799 1091.09C611.1 1092.7 610.801 1096.57 608.799 1098.22C609.818 1098.22 621.186 1101.89 621.186 1101.89C628.705 1099.53 627.103 1088.6 620.923 1087.66Z","M142.529 1103.87L153.952 1098.47C151.652 1096.85 151.951 1092.98 153.952 1091.34C152.934 1091.34 141.565 1087.66 141.565 1087.66C137.48 1090.82 137.03 1101.67 142.529 1103.87Z","M373.791 853.751L377.293 867.145C378.907 864.844 383.115 864.766 384.76 866.767C384.76 866.154 390.599 853.751 390.599 853.751C386.084 846.475 375.404 848.782 373.791 853.751Z","M389.492 1344.58L384.092 1323.68C382.252 1326.31 378.001 1325.97 376.127 1323.68C376.127 1324.38 372.176 1345.07 372.176 1345.07C375.2 1353.36 388.175 1351.21 389.492 1344.58Z","M1305.81 1087.11L1293.68 1090.54C1295.98 1092.15 1295.68 1096.02 1293.68 1097.66C1294.7 1097.66 1306.07 1101.34 1306.07 1101.34C1313.59 1098.98 1311.99 1088.05 1305.81 1087.11Z","M822.617 1102.87L834.04 1097.47C831.74 1095.85 832.039 1091.98 834.04 1090.34C833.022 1090.34 821.653 1086.66 821.653 1086.66C817.568 1089.82 817.118 1100.67 822.617 1102.87Z","M1056.86 853.492L1060.37 866.886C1061.98 864.586 1066.19 864.507 1067.83 866.508C1067.83 865.895 1073.67 853.492 1073.67 853.492C1069.16 846.216 1058.48 848.523 1056.86 853.492Z","M1072.55 1342.26L1067.31 1321.98C1065.53 1324.53 1061.4 1324.2 1059.58 1321.98C1059.58 1322.66 1055.75 1342.74 1055.75 1342.74C1058.68 1350.79 1071.27 1348.7 1072.55 1342.26Z"];   // 12 destellos en las puntas
const LINES  = ["M1005.88 751.015L1036.34 751.015","M1093.19 751.015L1440 751.015","M1065.27 848.06L1065.27 778.954","M1065.27 722.193L1065.27 -79.887","M443.613 751.013H410.125","M705.094 1074.31L401.569 770.785","M361.82 730.803L0.396173 369.38","M745.398 1074.31L1046.97 772.735","M1086.6 732.518L1440.17 378.946","M705.094 1113.7L-5.43758 1824.24","M745.398 1113.7L1443.53 1811.84","M353.274 751.014L-0.00440376 751.014","M381.194 848.653L381.194 778.953","M381.197 722.972L381.197 -80.0007","M724.609 1040.64L724.609 1065.55","M724.609 -80.381L724.609 470.274","M626.383 1093.98L696.745 1093.98","M-1.95518 1093.98H137.083","M753.538 1093.98H817.924","M724.609 1122.4L724.609 1442","M1311.1 1093.98L1452.57 1093.98"];   // 21 lineas finas de la grilla
const CIRCLES= [{cx:1064.77,cy:750.685,r:27.9272,tf:""},{cx:20.7487,cy:20.7487,r:20.2487,tf:"matrix(-1 0 0 1 1085.52 729.937)"},{cx:20.7487,cy:20.7487,r:20.2487,tf:"matrix(-1 0 0 1 745.86 1073.23)"},{cx:28.4272,cy:28.4272,r:27.9272,tf:"matrix(-1 0 0 1 410.125 722.256)"},{cx:20.7487,cy:20.7487,r:20.2487,tf:"matrix(-1 0 0 1 402.446 729.935)"},{cx:725.111,cy:1093.98,r:27.9272,tf:"rotate(180 725.111 1093.98)"}]; // 6 nodos (circulos), algunos con transform

/* ---------- parser SVG path (M/C/L/H/V/Z) -> puntos flatten ---------- */
function flattenPath(d, steps=10){
  const toks = d.match(/[MCLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  let i=0, x=0,y=0, pts=[];
  function num(){ return parseFloat(toks[i++]); }
  while(i<toks.length){
    const cmd=toks[i++];
    if(cmd==='M'){ x=num(); y=num(); pts.push([x,y]); }
    else if(cmd==='L'){ x=num(); y=num(); pts.push([x,y]); }
    else if(cmd==='H'){ x=num(); pts.push([x,y]); }
    else if(cmd==='V'){ y=num(); pts.push([x,y]); }
    else if(cmd==='C'){
      const x1=num(),y1=num(),x2=num(),y2=num(),x3=num(),y3=num();
      for(let s=1;s<=steps;s++){ const u=s/steps, iu=1-u;
        const bx=iu*iu*iu*x + 3*iu*iu*u*x1 + 3*iu*u*u*x2 + u*u*u*x3;
        const by=iu*iu*iu*y + 3*iu*iu*u*y1 + 3*iu*u*u*y2 + u*u*u*y3;
        pts.push([bx,by]); }
      x=x3; y=y3;
    } else if(cmd==='Z'){ /* close */ }
    else { i--; break; }
  }
  return pts;
}
function centroid(pts){ let cx=0,cy=0; for(const p of pts){cx+=p[0];cy+=p[1];} return [cx/pts.length, cy/pts.length]; }

const winFlat = CRISP.map(d=>flattenPath(d,12));
const winCenters = winFlat.map(centroid);
// mundo: x=SVGx-CX0 (centrado), y = SVG_H/2 - SVGy (y-up), escala 1/100
const WSCALE=1/100;
function toWorld(p){ return [ (p[0]-SVG_W/2)*WSCALE, (SVG_H/2-p[1])*WSCALE ]; }
function applyTf(tf,x,y){
  if(!tf) return [x,y];
  if(tf.startsWith('matrix')){ const m=tf.match(/-?\d+\.?\d*/g).map(Number);
    return [ m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5] ]; }
  if(tf.startsWith('rotate')){ const m=tf.match(/-?\d+\.?\d*/g).map(Number);
    const ang=m[0]*Math.PI/180, cx=m[1], cy=m[2], dx=x-cx, dy=y-cy, ca=Math.cos(ang), sa=Math.sin(ang);
    return [ cx+dx*ca-dy*sa, cy+dx*sa+dy*ca ]; }
  return [x,y];
}
const winCentersW = winCenters.map(toWorld);
const WINDOWS=[0,1,2].map(i=>({ idx:i, center:winCentersW[i], main: i===0 }));

/* =========================================================================
   TEXTURA DE PARED: dibujada con los MISMOS paths del SVG (Path2D nativo)
   ========================================================================= */
function buildWallTexture(){
  const SS=2; const W=SVG_W*SS, H=SVG_H*SS;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d'); ctx.scale(SS,SS);
  // fondo
  const cx0=SVG_W*0.5, cy0=SVG_H*0.46;
  const rad=Math.max(SVG_W,SVG_H)*0.75;
  const g=ctx.createRadialGradient(cx0,cy0,0, cx0,cy0,rad);
  g.addColorStop(0.0, WALL_COLORS.center); g.addColorStop(0.55, WALL_COLORS.mid); g.addColorStop(1.0, WALL_COLORS.edge);
  ctx.fillStyle=g; ctx.fillRect(0,0,SVG_W,SVG_H);
  // NOTA: el neon/glow/destellos de las 3 ventanas YA NO se hornean aca (antes se dibujaban con
  // Path2D a posicion fija). Ahora que las ventanas se pueden mover/escalar, viven como objetos
  // 3D vivos (ver mas abajo, per-window group) para que sigan la mascara sin desalinearse.
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=8;
  return tex;
}
let WALL_COLORS={ center:'#463a86', mid:'#0e1330', edge:'#0a0d1c' }; // antes casi identico al fondo (#020410) -> la pared 'desaparecia' en sus bordes y parecia un circulo
let wallTex=buildWallTexture();

/* =========================================================================
   THREE.JS
   ========================================================================= */
const app=document.getElementById('app');
const renderer=new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x020410);
// environment procedural (solo para que el vidrio PBR de la estrella tenga reflejos/transmision creibles;
// costo unico al arrancar, no por cuadro)
const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera=new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 500);
camera.position.set(0,0,18); camera.rotation.order='YXZ';
const clock=new THREE.Clock();

/* ---------- fondo de estrellas ---------- */
const starU={ uTime:{value:0}, uSize:{value:2.2}, uBright:{value:1.0}, uAlarm:{value:new THREE.Color(0,0,0)}, uPixelRatio:{value:renderer.getPixelRatio()} };
const starMat=new THREE.ShaderMaterial({ uniforms:starU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader:`attribute float aRand; uniform float uSize,uPixelRatio; varying float vR;
    void main(){ vR=aRand; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=uSize*uPixelRatio*(0.4+aRand*1.6); gl_Position=projectionMatrix*mv; }`,
  fragmentShader:`uniform float uTime,uBright; uniform vec3 uAlarm; varying float vR;
    void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv); if(d>0.5) discard; float g=smoothstep(0.5,0.0,d);
      float tw=0.5+0.5*sin(uTime*2.0+vR*45.0); vec3 col=mix(vec3(0.8,0.86,1.0), vec3(1.0), vR)*uBright*tw + uAlarm*0.5;
      gl_FragColor=vec4(col*g,1.0); }` });
let starGeo, starPoints, lastStarCount=-1; const starGroup=new THREE.Group(); scene.add(starGroup);
function buildStars(n){ n=Math.max(0,Math.round(n)); if(n===lastStarCount) return; lastStarCount=n;
  if(starPoints){ starGroup.remove(starPoints); starGeo.dispose(); }
  const pos=new Float32Array(n*3), rnd=new Float32Array(n);
  for(let i=0;i<n;i++){ pos[i*3]=(Math.random()*2-1)*26; pos[i*3+1]=(Math.random()*2-1)*22; pos[i*3+2]=-8-Math.random()*40; rnd[i]=Math.random(); }
  starGeo=new THREE.BufferGeometry(); starGeo.setAttribute('position',new THREE.BufferAttribute(pos,3)); starGeo.setAttribute('aRand',new THREE.BufferAttribute(rnd,1));
  starPoints=new THREE.Points(starGeo,starMat); starPoints.frustumCulled=false; starGroup.add(starPoints); }
let starDrift=0.02; let starSwingRange=0.12; // rango maximo de giro (radianes) -- antes rotation.y sumaba sin limite y las estrellas terminaban girando demasiado lejos

/* =========================================================================
   VORTEX / TUNEL DE FONDO -- puerto fiel de vortex-interior-theatre_4.html
   (shader real: ruido simplex + fbm + domain-warp/turbulencia, formacion de haces
   con "detail" ajustable, "fill", tinte cian/violeta por region angular, nucleo
   caliente en los haces mas brillantes, trim con corte duro + punta brillante).
   Reusa la camara y el fondo de estrellas de ESTA escena (sin Camara/Background propios).
   ========================================================================= */
const TAU=Math.PI*2;
const VTX_RADIUS_DEFAULT=8, TSEG=240, RSEG=48;

/* ---------- PATH: independiente de Theatre, igual que el original ---------- */
let CTRL=[ new THREE.Vector3(0,0,15), new THREE.Vector3(0,0,-17), new THREE.Vector3(0,0,-49), new THREE.Vector3(0,0,-81) ];
let pathTension=0.5;
function saveVortexPath(){ try{ localStorage.setItem('vortexPath_ventanas_v2', JSON.stringify({ p:CTRL.map(v=>[v.x,v.y,v.z]), tension:pathTension })); }catch(e){} }
function loadVortexPath(){ try{ const s=localStorage.getItem('vortexPath_ventanas_v2'); if(s){ const o=JSON.parse(s);
  if(o.p&&o.p.length>=2){ CTRL=o.p.map(a=>new THREE.Vector3(a[0],a[1],a[2])); } if(typeof o.tension==='number') pathTension=o.tension; } }catch(e){} }
loadVortexPath();

/* ---------- glow al final del tunel ("la luz al fondo") ---------- */
function vortexGlowTex(){ const s=256,c=document.createElement('canvas'); c.width=c.height=s; const x=c.getContext('2d');
  const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.4,'rgba(255,255,255,.35)'); g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,s,s); return new THREE.CanvasTexture(c); }
const vortexGlowMat=new THREE.SpriteMaterial({ map:vortexGlowTex(), color:0x88aaff, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.25 });
const vortexGlowSprite=new THREE.Sprite(vortexGlowMat); vortexGlowSprite.scale.set(6,6,1); vortexGlowSprite.renderOrder=0.05; scene.add(vortexGlowSprite);

/* ---------- shader del tunel (puerto fiel: simplex noise + fbm + turbulencia) ---------- */
const vortexU={
  uTime:{value:0},
  uColorCore:{value:new THREE.Color(0xd9ffff)}, uColorMid:{value:new THREE.Color(0x1fd9e0)}, uColorEdge:{value:new THREE.Color(0x7f47e6)},
  uSpeed:{value:0.6}, uNoiseScale:{value:3.0}, uTurbulence:{value:0.8}, uGlow:{value:1.6}, uDetail:{value:1.0}, uFill:{value:0.15}, uSwirl:{value:0.032},
  uTrimStart:{value:0.0}, uTrimEnd:{value:1.0},
  uDispAmount:{value:0.0}, uDispScale:{value:0.3}, uDispSpeed:{value:0.15},
  uRadiusBase:{value:VTX_RADIUS_DEFAULT}, uTaperStart:{value:1.0}, uTaperEnd:{value:1.0},
};
const vortexMat=new THREE.ShaderMaterial({
  uniforms:vortexU, side:THREE.DoubleSide, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader:`varying vec2 vUv;
    uniform float uTime, uDispAmount, uDispScale, uDispSpeed, uRadiusBase, uTaperStart, uTaperEnd;
    float dhash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453123); }
    float dnoise(vec3 p){
      vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float n000=dhash(i+vec3(0.0,0.0,0.0)), n100=dhash(i+vec3(1.0,0.0,0.0)), n010=dhash(i+vec3(0.0,1.0,0.0)), n110=dhash(i+vec3(1.0,1.0,0.0));
      float n001=dhash(i+vec3(0.0,0.0,1.0)), n101=dhash(i+vec3(1.0,0.0,1.0)), n011=dhash(i+vec3(0.0,1.0,1.0)), n111=dhash(i+vec3(1.0,1.0,1.0));
      return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y), mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
    }
    void main(){
      vUv=uv.yx;
      vec3 pos=position;
      // taper: radio distinto en el extremo inicial (uv.x=0) vs el final (uv.x=1) del recorrido.
      // "normal" en TubeGeometry apunta radialmente hacia afuera del eje, asi que reconstruimos
      // el punto de la "columna" (spine) y volvemos a aplicar el radio ya escalado por el taper.
      float taperMul = mix(uTaperStart, uTaperEnd, uv.x);
      pos += normal * uRadiusBase * (taperMul - 1.0);
      // "displace": empuja cada vertice a lo largo de su normal segun ruido -- deforma la forma
      // EXTERIOR real del tubo (geometria de verdad, no un efecto de shader plano), tipo Spline.
      if(uDispAmount>0.0001){
        float n=dnoise(pos*uDispScale + vec3(0.0,0.0,uTime*uDispSpeed));
        pos += normal * ((n-0.5)*2.0*uDispAmount);
      }
      gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
    }`,
  fragmentShader:`
    precision highp float; varying vec2 vUv;
    uniform float uTime; uniform vec3 uColorCore; uniform vec3 uColorMid; uniform vec3 uColorEdge;
    uniform float uSpeed; uniform float uNoiseScale; uniform float uTurbulence; uniform float uGlow; uniform float uDetail; uniform float uFill; uniform float uSwirl;
    uniform float uTrimStart; uniform float uTrimEnd;
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
    float fbm(vec3 p){ float total=0.0; float amp=0.5; for(int i=0;i<4;i++){ total+=amp*snoise(p); p*=2.0; amp*=0.5; } return total; }
    void main(){
      float ang=vUv.x + uSwirl*uTime;
      float len=vUv.y;
      vec2 circ=vec2(cos(ang*6.2831853), sin(ang*6.2831853));
      float flow = len*0.9 + uTime*uSpeed*0.4;
      vec3 Pp = vec3(circ*uNoiseScale, flow);
      vec3 w = vec3(fbm(Pp+vec3(0.0,0.0,uTime*0.05)), fbm(Pp+vec3(3.1,1.7,0.0)), fbm(Pp+vec3(8.2,4.4,0.0)));
      float f = fbm(Pp + uTurbulence*3.0*w);
      float v = clamp(f*0.5+0.5, 0.0, 1.0);
      float beam = smoothstep(0.42, 0.90, v);
      beam = pow(beam, mix(2.6, 1.0, clamp(uDetail/3.0,0.0,1.0)));
      beam = max(beam, v*uFill*0.5);
      float env = smoothstep(0.0,0.18,len) * smoothstep(1.0,0.82,len);
      float hue = fbm(vec3(circ*uNoiseScale*0.6+7.0, flow*0.5))*0.5+0.5;
      vec3 tint = mix(uColorMid, uColorEdge, smoothstep(0.35,0.65,hue));
      vec3 color = tint*beam;
      color += uColorCore*pow(beam,3.0)*0.6;
      color *= uGlow;
      float alpha = clamp(beam*env*1.5, 0.0, 1.0);
      float inRange=step(uTrimStart,vUv.y)*step(vUv.y,uTrimEnd);
      float tipE=1.0-smoothstep(0.0,0.03,abs(vUv.y-uTrimEnd));
      float tipS=1.0-smoothstep(0.0,0.03,abs(vUv.y-uTrimStart));
      float tip=max(tipE,tipS);
      alpha*=inRange; alpha=max(alpha,tip*0.95);
      color=mix(color,uColorCore,tip); color*=1.0+tip*1.5;
      gl_FragColor=vec4(color,alpha);
    }`,
});

const vortexGroup=new THREE.Group(); scene.add(vortexGroup); // tubo + marcadores + linea del recorrido -> "scale" los mueve a todos juntos
let vortexRadius=VTX_RADIUS_DEFAULT;
function buildVortexCurve(){ return new THREE.CatmullRomCurve3(CTRL.map(v=>v.clone()), false, 'catmullrom', pathTension); }
let vortexMesh=new THREE.Mesh(new THREE.TubeGeometry(buildVortexCurve(),TSEG,vortexRadius,RSEG,false), vortexMat);
vortexMesh.renderOrder=0.1; vortexGroup.add(vortexMesh);
let vortexPathLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(buildVortexCurve().getPoints(140)), new THREE.LineBasicMaterial({ color:0x2a4a7a }));
vortexPathLine.visible=false; vortexGroup.add(vortexPathLine);
function rebuildVortexTube(){
  const curve=buildVortexCurve();
  vortexMesh.geometry.dispose(); vortexMesh.geometry=new THREE.TubeGeometry(curve,TSEG,vortexRadius,RSEG,false);
  vortexPathLine.geometry.dispose(); vortexPathLine.geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(140));
  vortexGlowSprite.position.copy(CTRL[CTRL.length-1]);
}
rebuildVortexTube();
let vortexEnabled=true;
let seqPlayingMain=false; // oculta marcadores/gizmo durante el play del (unico) timeline

/* ---------- editor: marcadores + gizmo + dibujar + agregar/quitar ---------- */
const vortexMarkerGroup=new THREE.Group(); vortexGroup.add(vortexMarkerGroup);
let vortexMarkers=[], vortexSelected=-1, vortexEditMode=false, vortexDrawMode=false, vortexDrawing=false, vortexStroke=[], vortexDrawDepth=110;
let vortexGizmo=null;
function rebuildVortexMarkers(){
  vortexMarkers.forEach(m=>{ vortexMarkerGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }); vortexMarkers=[];
  for(let i=0;i<CTRL.length;i++){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.6,18,14),
    new THREE.MeshBasicMaterial({ color: i===vortexSelected?0xffffff:0x66d2ff, depthTest:false })); m.position.copy(CTRL[i]); m.userData={i}; m.renderOrder=10; vortexMarkerGroup.add(m); vortexMarkers.push(m); }
  if(vortexGizmo){ if(vortexSelected>=0 && vortexSelected<vortexMarkers.length) vortexGizmo.attach(vortexMarkers[vortexSelected]); else vortexGizmo.detach(); }
}
function selectVortexPoint(i){ vortexSelected=i; for(let k=0;k<vortexMarkers.length;k++) vortexMarkers[k].material.color.set(k===i?0xffffff:0x66d2ff);
  if(vortexGizmo){ if(i>=0) vortexGizmo.attach(vortexMarkers[i]); else vortexGizmo.detach(); } }
rebuildVortexMarkers();
function setVortexDrawMode(on){ vortexDrawMode=on; if(on) selectVortexPoint(-1); }
function addVortexPoint(){
  if(CTRL.length>=12) return;
  const i=vortexSelected>=0?vortexSelected:CTRL.length-1;
  const a=CTRL[i], b=CTRL[Math.min(i+1,CTRL.length-1)]; const np=a.clone().add(b).multiplyScalar(0.5);
  if(i===CTRL.length-1) np.copy(a).add(new THREE.Vector3(0,0,-16));
  CTRL.splice(i+1,0,np); vortexSelected=i+1; rebuildVortexTube(); rebuildVortexMarkers(); saveVortexPath();
}
function removeVortexPoint(){
  if(CTRL.length<=2 || vortexSelected<0) return;
  CTRL.splice(vortexSelected,1); vortexSelected=-1; rebuildVortexTube(); rebuildVortexMarkers(); saveVortexPath();
}
function resetVortexPath(){
  CTRL=[ new THREE.Vector3(0,0,15), new THREE.Vector3(0,0,-17), new THREE.Vector3(0,0,-49), new THREE.Vector3(0,0,-81) ];
  pathTension=0.5; const ti=document.getElementById('vortexTensionInput'); if(ti) ti.value=0.5;
  vortexSelected=-1; rebuildVortexTube(); rebuildVortexMarkers(); saveVortexPath();
}
function vortexScreenToWorldAtDist(v2, dist){ const v=new THREE.Vector3(v2.x,v2.y,0.5).unproject(camera);
  const dir=v.sub(camera.position).normalize(); return camera.position.clone().add(dir.multiplyScalar(dist)); }


/* ---------- luces de alarma (estado) ---------- */
const L=[ { color:new THREE.Color(0xff2a2a), intensity:1.4, flicker:0.7, speed:2.2, x:-8, y:0, z:-8 },
         { color:new THREE.Color(0xff2a2a), intensity:1.4, flicker:0.7, speed:1.5, x: 8, y:0, z:-8 } ];
const tmpC0=new THREE.Color(), tmpC1=new THREE.Color(), tmpW=new THREE.Color();
function flick(time,speed,amt){ let b=0.5+0.5*Math.sin(time*speed*Math.PI*2); b=b*b; return (1-amt)+amt*b; }

/* ---------- pared (textura fiel al SVG) con agujeros REALES y RECALCULABLES ----------
   Cada ventana puede moverse/escalarse (mascara). Como recalcular una ShapeGeometry con
   ~3 agujeros de unos pocos cientos de vertices es barato (sub-milisegundo), reconstruimos
   la pared entera cada vez que cambia un offset/escala -- sin shaders de mascara, sin los
   bugs de arrays truncados que tuvimos antes. Simple y robusto. */
const crispLocal = winFlat.map((flat,i)=>{ const c=winCentersW[i]; return flat.map(toWorld).map(p=>[p[0]-c[0], p[1]-c[1]]); });

// estado de mascara: central independiente (offset+escala propios), laterales compartido
const winMask=[ {offX:0,offY:0,scX:1,scY:1} ]; // solo la central usa esto directamente
const sideState={ offsetX:0, offsetY:0, scale:1 }; // izquierda(1)/derecha(2) comparten esto

function winTransform(i){
  if(i===0) return { ox:winMask[0].offX, oy:winMask[0].offY, sx:winMask[0].scX, sy:winMask[0].scY };
  // izquierda(1): offsetX positivo = se aleja (mas a la izquierda); derecha(2): offsetX positivo = se aleja (mas a la derecha)
  // offsetY: ambas suben/bajan juntas (mismo sentido). scale: comparten el mismo tamaño.
  const dirX = (i===1) ? -1 : 1;
  return { ox: dirX*sideState.offsetX, oy: sideState.offsetY, sx: sideState.scale, sy: sideState.scale };
}

const wallMat=new THREE.MeshBasicMaterial({ map:wallTex, transparent:false, opacity:1 }); // arranca opaca de verdad; el fundido la pasa a transparent:true SOLO mientras blackout>0
let wallGeo=null;
const nearLayer=new THREE.Group(); scene.add(nearLayer); // pared+grilla+vidrios+neon: todo junto, para que el parallax no los desalinee
const wall=new THREE.Mesh(new THREE.BufferGeometry(), wallMat); wall.position.z=0; wall.renderOrder=1; nearLayer.add(wall);

function currentHolePoints(i){
  const t=winTransform(i); const c=winCentersW[i];
  return crispLocal[i].map(p=>[ c[0]+t.ox+p[0]*t.sx, c[1]+t.oy+p[1]*t.sy ]);
}
function rebuildWall(){
  const wallShape=new THREE.Shape();
  wallShape.moveTo(-26,-22); wallShape.lineTo(26,-22); wallShape.lineTo(26,22); wallShape.lineTo(-26,22); wallShape.lineTo(-26,-22);
  for(let i=0;i<3;i++){
    const flat=currentHolePoints(i);
    const hp=new THREE.Path(); hp.moveTo(flat[0][0],flat[0][1]); for(let k=1;k<flat.length;k++) hp.lineTo(flat[k][0],flat[k][1]);
    wallShape.holes.push(hp);
  }
  const newGeo=new THREE.ShapeGeometry(wallShape,4);
  { const uv=newGeo.attributes.uv, pos=newGeo.attributes.position;
    for(let i=0;i<pos.count;i++){ const x=pos.getX(i), y=pos.getY(i);
      const sx=(x/WSCALE)+SVG_W/2, sy=SVG_H/2-(y/WSCALE);
      uv.setXY(i, sx/SVG_W, 1-sy/SVG_H); } uv.needsUpdate=true; }
  const old=wallGeo; wall.geometry=newGeo; wallGeo=newGeo; if(old) old.dispose();
}
rebuildWall();

/* ---------- grupos por ventana: vidrio + neon vivo, siguen la mascara ---------- */
const winGroups=[];
function applyWinTransform(i){
  const t=winTransform(i); const c=winCentersW[i];
  winGroups[i].position.set(c[0]+t.ox, c[1]+t.oy, 0);
  winGroups[i].scale.set(t.sx, t.sy, 1);
  // mantiene sincronizado el recorte de la grilla con la posicion/escala real de la ventana
  if(typeof maskUniformsShared !== 'undefined'){
    maskUniformsShared['uOff'+i].value.set(t.ox, t.oy);
    maskUniformsShared['uScale'+i].value.set(t.sx, t.sy);
  }
  rebuildWall();
}

/* =========================================================================
   GRILLA VIVA (lineas + nodos) en 3D — el color circula solo cada tanto.
   Se recorta (discard) donde caiga dentro de cualquiera de las 3 ventanas -- comparte
   los MISMOS datos de mascara (centro/offset/escala) que ya usan las ventanas, asi que
   si las movés/escalás desde el timeline el recorte las sigue automaticamente.
   ========================================================================= */
const gridState={ color:new THREE.Color(0.81,0.65,0.99), baseOpacity:0.16, pulseSpeed:0.35, pulseWidth:0.22, pulseBright:2.4,
  nodeBaseOpacity:0.21, nodePulseBright:2.4 }; // independientes del brillo de las lineas
let wallGridBlackout=0; // 0 = normal, 1 = pared+grilla totalmente a negro (solo quedan las ventanas)
let gridPulseTime=0; // acumulador propio del pulso, compensado por la distancia de la camara a la pared
const GRID_REF_DIST=18; // distancia de referencia (posicion inicial de la camara) para la que la velocidad se ve "normal"

const MAXN=104; // las 3 ventanas tienen 97 puntos c/u (8 curvas a steps=12); dejamos margen
function padPoly(pts){ const out=new Float32Array(MAXN*2); const n=Math.min(pts.length,MAXN);
  for(let i=0;i<n;i++){ out[i*2]=pts[i][0]; out[i*2+1]=pts[i][1]; }
  for(let i=n;i<MAXN;i++){ out[i*2]=pts[n-1][0]; out[i*2+1]=pts[n-1][1]; } return {arr:out, n}; }
function toVec2Array(f32){ const a=[]; for(let i=0;i<MAXN;i++) a.push(new THREE.Vector2(f32[i*2],f32[i*2+1])); return a; }
const polyPad=[0,1,2].map(i=>padPoly(crispLocal[i]));
const maskUniformsShared = {};
for(let i=0;i<3;i++){
  maskUniformsShared['uC'+i]={ value:new THREE.Vector2(winCentersW[i][0], winCentersW[i][1]) };
  maskUniformsShared['uOff'+i]={ value:new THREE.Vector2(0,0) };
  maskUniformsShared['uScale'+i]={ value:new THREE.Vector2(1,1) };
  maskUniformsShared['uPoly'+i]={ value:toVec2Array(polyPad[i].arr) };
  maskUniformsShared['uN'+i]={ value:polyPad[i].n };
  const rad=Math.max(...crispLocal[i].map(p=>Math.hypot(p[0],p[1])));
  maskUniformsShared['uRad'+i]={ value:rad*1.05 };
}
const MASK_GLSL = `
  uniform vec2 uC0,uOff0,uScale0; uniform vec2 uPoly0[${MAXN}]; uniform int uN0; uniform float uRad0;
  uniform vec2 uC1,uOff1,uScale1; uniform vec2 uPoly1[${MAXN}]; uniform int uN1; uniform float uRad1;
  uniform vec2 uC2,uOff2,uScale2; uniform vec2 uPoly2[${MAXN}]; uniform int uN2; uniform float uRad2;
  bool gridInPoly(vec2 p, vec2 poly[${MAXN}], int n){
    bool inside=false; int j=n-1;
    for(int i=0;i<${MAXN};i++){
      if(i>=n) break;
      vec2 pi=poly[i]; vec2 pj=poly[j];
      if( ((pi.y>p.y)!=(pj.y>p.y)) && (p.x < (pj.x-pi.x)*(p.y-pi.y)/(pj.y-pi.y)+pi.x) ){ inside=!inside; }
      j=i;
    }
    return inside;
  }
  bool insideAnyWindow(vec2 world){
    vec2 d0=world-uC0-uOff0; float rr0=max(uScale0.x,uScale0.y)*uRad0;
    if(dot(d0,d0)<rr0*rr0 && gridInPoly(d0/uScale0,uPoly0,uN0)) return true;
    vec2 d1=world-uC1-uOff1; float rr1=max(uScale1.x,uScale1.y)*uRad1;
    if(dot(d1,d1)<rr1*rr1 && gridInPoly(d1/uScale1,uPoly1,uN1)) return true;
    vec2 d2=world-uC2-uOff2; float rr2=max(uScale2.x,uScale2.y)*uRad2;
    if(dot(d2,d2)<rr2*rr2 && gridInPoly(d2/uScale2,uPoly2,uN2)) return true;
    return false;
  }
`;

const gridLineObjs=[]; const gridGroup=new THREE.Group(); gridGroup.position.z=0.06; nearLayer.add(gridGroup);
for(let li=0; li<LINES.length; li++){
  const flat=flattenPath(LINES[li],1).map(toWorld);
  if(flat.length<2) continue;
  const geo=new THREE.BufferGeometry();
  const N=flat.length, pos=new Float32Array(N*3), prog=new Float32Array(N);
  for(let k=0;k<N;k++){ pos[k*3]=flat[k][0]; pos[k*3+1]=flat[k][1]; pos[k*3+2]=0; prog[k]=k/(N-1); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('aProg', new THREE.BufferAttribute(prog,1));
  const mat=new THREE.ShaderMaterial({
    uniforms:{ uColor:{value:gridState.color}, uBase:{value:gridState.baseOpacity}, uPhase:{value:(li*0.61)%1.0},
      uPulseW:{value:gridState.pulseWidth}, uPulseB:{value:gridState.pulseBright}, ...maskUniformsShared },
    transparent:true, depthWrite:false, depthTest:false, blending:THREE.AdditiveBlending,
    vertexShader:`attribute float aProg; varying float vProg; varying vec3 vW;
      void main(){ vProg=aProg; vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`precision highp float; uniform vec3 uColor; uniform float uBase,uPhase,uPulseW,uPulseB; varying float vProg; varying vec3 vW;
      ${MASK_GLSL}
      void main(){
        if(insideAnyWindow(vW.xy)) discard;
        float d=abs(vProg-uPhase); d=min(d,1.0-d); float pulse=exp(-pow(d/uPulseW,2.0))*uPulseB;
        gl_FragColor=vec4(uColor*(uBase+pulse), uBase+pulse); }`,
  });
  const line=new THREE.Line(geo,mat); line.renderOrder=1.5; gridGroup.add(line); gridLineObjs.push({mat,phase0:(li*0.61)%1.0});
}
const gridNodeObjs=[];
for(let ci=0; ci<CIRCLES.length; ci++){
  const cir=CIRCLES[ci]; const [wx,wy]=applyTf(cir.tf, parseFloat(cir.cx), parseFloat(cir.cy));
  const c=toWorld([wx,wy]); const r=parseFloat(cir.r)*WSCALE;
  const geo=new THREE.RingGeometry(r*0.82, r, 40);
  const mat=new THREE.ShaderMaterial({
    uniforms:{ uColor:{value:gridState.color}, uBase:{value:gridState.baseOpacity+0.05}, uBright:{value:gridState.baseOpacity+0.05}, ...maskUniformsShared },
    transparent:true, depthWrite:false, depthTest:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:`varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`precision highp float; uniform vec3 uColor; uniform float uBright; varying vec3 vW;
      ${MASK_GLSL}
      void main(){ if(insideAnyWindow(vW.xy)) discard; gl_FragColor=vec4(uColor*uBright,uBright); }`,
  });
  const ring=new THREE.Mesh(geo,mat); ring.position.set(c[0],c[1],0); ring.renderOrder=1.5; gridGroup.add(ring);
  gridNodeObjs.push({mat, phase0:(ci*0.37)%1.0});
}
function updateGrid(time){
  const spd=gridState.pulseSpeed, k=(1-wallGridBlackout);
  for(const g of gridLineObjs){ g.mat.uniforms.uColor.value.copy(gridState.color); g.mat.uniforms.uBase.value=gridState.baseOpacity*k;
    g.mat.uniforms.uPulseW.value=gridState.pulseWidth; g.mat.uniforms.uPulseB.value=gridState.pulseBright*k;
    g.mat.uniforms.uPhase.value=(g.phase0 + time*spd*0.15)%1.0; }
  for(const n of gridNodeObjs){ const ph=(n.phase0 + time*spd*0.2)%1.0; const b=(gridState.nodeBaseOpacity + gridState.nodePulseBright*0.5*Math.exp(-Math.pow((ph-0.5)/0.35,2.0)))*k;
    n.mat.uniforms.uColor.value.copy(gridState.color); n.mat.uniforms.uBright.value=b; }
}


/* ---------- vidrios (Fresnel + tinte por luces), forma EXACTA del SVG ----------
   Fabrica reusable: la central usa una variante casi transparente en reposo (para no
   tapar el GLB) pero que SI reacciona a la luz de alarma -- asi el rojo de la alarma
   se nota tambien en la ventana central, que antes quedaba completamente muda. */
function makeGlass(tint, opacity){
  const u={ uGlassTint:{value:new THREE.Color(tint)}, uGlassEdge:{value:new THREE.Color(0.81,0.65,0.99)},
    uGlassOpacity:{value:opacity}, uDissolve:{value:0.0}, uEdgeWidth:{value:3.0}, uEdgeIntensity:{value:2.2},
    uLightPos:{value:[new THREE.Vector3(),new THREE.Vector3()]}, uLightColI:{value:[new THREE.Color(),new THREE.Color()]} };
  const m=new THREE.ShaderMaterial({ uniforms:u, transparent:true, depthWrite:false, side:THREE.DoubleSide,
    vertexShader:`varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`precision highp float; varying vec3 vW;
      uniform vec3 uGlassTint,uGlassEdge; uniform float uGlassOpacity,uDissolve,uEdgeWidth,uEdgeIntensity; uniform vec3 uLightPos[2]; uniform vec3 uLightColI[2];
      void main(){
        vec3 N=vec3(0.0,0.0,1.0); vec3 V=normalize(cameraPosition-vW);
        // uEdgeWidth es el exponente del fresnel: valores CHICOS ensanchan el borde (cubre mas
        // superficie), valores GRANDES lo afinan (un filo mas nitido, pegado al contorno).
        float fres=pow(1.0-clamp(dot(N,V),0.0,1.0),uEdgeWidth);
        vec3 tint=vec3(0.0);
        for(int i=0;i<2;i++){ vec3 Ld=uLightPos[i]-vW; float att=1.0/(1.0+dot(Ld,Ld)*0.02); tint+=uLightColI[i]*att; }
        vec3 col=uGlassTint + tint + uGlassEdge*fres*uEdgeIntensity;
        // uDissolve apaga el alfa COMPLETO (incluido el brillo de borde/fresnel) -- a diferencia de
        // bajar solo uGlassOpacity, esto asegura que no quede ningun contorno visible en absoluto.
        float alpha=clamp(uGlassOpacity + fres*0.55 + (tint.r+tint.g+tint.b)*0.15, 0.0, 0.95) * (1.0-uDissolve);
        gl_FragColor=vec4(col,alpha);
      }`,
  });
  return {mat:m, uniforms:u};
}
const glassInst=makeGlass(0x1a1f38, 0.30);       // laterales: vidrio normal
const glassU=glassInst.uniforms, glassMat=glassInst.mat;
const centralInst=makeGlass(0x000000, 0.0);       // central: invisible en reposo, pero SI reacciona a la alarma
const centralU=centralInst.uniforms, centralMat=centralInst.mat;

// uniforms COMPARTIDOS de luz para el neon de las 3 ventanas -- se actualizan una sola vez por
// cuadro (en tick) y los 3 marcos los referencian, igual patron que ya usan glassU/centralU.
const neonLightU = { uLightPos:{value:[new THREE.Vector3(),new THREE.Vector3()]}, uLightColI:{value:[new THREE.Color(),new THREE.Color()]} };
function makeNeonMat(colorHex, opacityBase, widthBase){
  const u = { uColor:{value:new THREE.Color(colorHex)}, uOpacityBase:{value:opacityBase}, uDissolve:{value:0.0}, uWidth:{value:widthBase}, ...neonLightU };
  return new THREE.ShaderMaterial({ uniforms:u, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:`attribute vec3 aOffset; uniform float uWidth; varying vec3 vW;
      void main(){
        vec3 pos = position + aOffset*uWidth; // "aOffset" es la direccion perpendicular al trazo (precalculada); el ancho es 100% tiempo real
        vW=(modelMatrix*vec4(pos,1.0)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
      }`,
    fragmentShader:`precision highp float; varying vec3 vW;
      uniform vec3 uColor; uniform float uOpacityBase,uDissolve; uniform vec3 uLightPos[2]; uniform vec3 uLightColI[2];
      void main(){
        vec3 tint=vec3(0.0);
        for(int i=0;i<2;i++){ vec3 Ld=uLightPos[i]-vW; float att=1.0/(1.0+dot(Ld,Ld)*0.02); tint+=uLightColI[i]*att; }
        vec3 col=uColor + tint*1.4; // el marco/neon "refleja" la luz de la alarma cuando esta cerca
        gl_FragColor=vec4(col, uOpacityBase*(1.0-uDissolve));
      }`,
  });
}
// construye una cinta de triangulos (ancho real, no una THREE.Line -- en WebGL las lineas NO
// pueden engrosarse mas alla de 1px, es una limitacion del navegador) alrededor de un contorno cerrado.
function buildRibbonGeometry(loopPts){
  const n=loopPts.length, positions=new Float32Array(n*2*3), offsets=new Float32Array(n*2*3);
  for(let k=0;k<n;k++){
    const prev=loopPts[(k-1+n)%n], curr=loopPts[k], next=loopPts[(k+1)%n];
    let tx=next[0]-prev[0], ty=next[1]-prev[1]; const tl=Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
    const nx=-ty, ny=tx; // perpendicular al trazo
    const i0=k*6;
    positions[i0]=curr[0]; positions[i0+1]=curr[1]; positions[i0+2]=0.01;
    positions[i0+3]=curr[0]; positions[i0+4]=curr[1]; positions[i0+5]=0.01;
    offsets[i0]=nx; offsets[i0+1]=ny; offsets[i0+2]=0;
    offsets[i0+3]=-nx; offsets[i0+4]=-ny; offsets[i0+5]=0;
  }
  const indices=[];
  for(let k=0;k<n;k++){ const k2=(k+1)%n; const a=k*2,b=k*2+1,c=k2*2,d=k2*2+1; indices.push(a,b,c, b,d,c); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets,3));
  geo.setIndex(indices);
  return geo;
}

const fillMeshes=[];
const neonMats=[]; // { halo, core, haloBase, coreBase } por ventana -- para poder disolver el contorno
for(let i=0;i<3;i++){
  const shp=new THREE.Shape(crispLocal[i].map(p=>new THREE.Vector2(p[0],p[1])));
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shp), i===0 ? centralMat : glassMat);
  mesh.position.z=-0.02; mesh.renderOrder=2; mesh.userData.main=(i===0); mesh.frustumCulled=false;
  const grp=new THREE.Group(); grp.add(mesh);
  // neon vivo (contorno con ancho real), sigue el mismo grupo -> nunca se desalinea del agujero
  { const geo=buildRibbonGeometry(crispLocal[i]);
    const haloBase=0.35, coreBase=0.9, haloWidthBase=0.10, coreWidthBase=0.035;
    const haloMat=makeNeonMat(0xcea7fc, haloBase, haloWidthBase);
    const coreMat=makeNeonMat(0xffffff, coreBase, coreWidthBase);
    const halo=new THREE.Mesh(geo, haloMat); halo.renderOrder=3.5; halo.frustumCulled=false; grp.add(halo);
    const core=new THREE.Mesh(geo, coreMat); core.renderOrder=4; core.frustumCulled=false; grp.add(core);
    neonMats.push({ halo:haloMat, core:coreMat, haloBase, coreBase, haloWidthBase, coreWidthBase });
  }
  nearLayer.add(grp); winGroups.push(grp); fillMeshes.push(mesh);
  applyWinTransform(i);
}

/* ---------- derrame de luz sobre la pared, alrededor de cada ventana (sobre todo la de alarma) ---------- */
function wallSpillTex(){ const s=256,c=document.createElement('canvas'); c.width=c.height=s; const x=c.getContext('2d');
  const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.5,'rgba(255,255,255,0.35)'); g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,s,s); return new THREE.CanvasTexture(c); }
const wallSpillMat=new THREE.SpriteMaterial({ map:wallSpillTex(), color:0x000000, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0 });
const wallSpillSprites=[0,1,2].map(i=>{
  const sp=new THREE.Sprite(wallSpillMat.clone()); const rad=Math.max(...crispLocal[i].map(p=>Math.hypot(p[0],p[1])));
  sp.scale.set(rad*3.2, rad*3.2, 1); sp.position.set(winCentersW[i][0], winCentersW[i][1], 0.02); sp.renderOrder=1.2; // justo encima de la pared, debajo del vidrio/neon
  nearLayer.add(sp); return sp;
});

/* =========================================================================
   LOGO EVA -- imagen del logo (un solo tono turquesa, con transparencia) usada
   SOLO como mascara de forma (canal alfa). El color se rellena con un uniform
   propio, asi se puede recolorear a CUALQUIER color (no solo variaciones del
   turquesa original) -- color/tamaño/posicion, todo controlable.
   ========================================================================= */
const evaLogoTex = (function(){
  const tex = new THREE.TextureLoader().load(LOGO_URL);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const evaLogoU = { uMap:{value:evaLogoTex}, uColor:{value:new THREE.Color(0x18c0d8)}, uOpacity:{value:1.0} };
const evaLogoMat = new THREE.ShaderMaterial({ uniforms:evaLogoU, transparent:true, depthWrite:false, side:THREE.DoubleSide,
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`precision highp float; varying vec2 vUv; uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
    void main(){ float a=texture2D(uMap,vUv).a; gl_FragColor=vec4(uColor, a*uOpacity); }`,
});
const evaLogoGeo = new THREE.PlaneGeometry(4,4*311/320); // relacion de aspecto real del recorte (320x311)
const evaLogoMesh = new THREE.Mesh(evaLogoGeo, evaLogoMat);
evaLogoMesh.position.set(0,0,5); evaLogoMesh.renderOrder=7; scene.add(evaLogoMesh);

/* =========================================================================
   TRAZO HORIZONTAL entre las 3 ventanas -- el arco que en el logo EVA conecta
   las 3 estrellitas, pero acomodado a las 3 ventanas reales de la pared.
   Crece de izquierda a derecha con trim (igual tecnica que el trim del vortex).
   ========================================================================= */
const traceSideCenters = [WINDOWS[1].center, WINDOWS[2].center].sort((a,b)=>a[0]-b[0]); // [izquierda, derecha]
const traceLeft = traceSideCenters[0], traceRight = traceSideCenters[1];
const traceMidTop = [WINDOWS[0].center[0], WINDOWS[0].center[1] + (WINDOWS[0].center[1]-traceLeft[1])*0.15 + 3.5]; // arco por ENCIMA de las ventanas, como en el logo
const traceCurve = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(traceLeft[0], traceLeft[1], 6),
  new THREE.Vector3(traceMidTop[0], traceMidTop[1], 6),
  new THREE.Vector3(traceRight[0], traceRight[1], 6)
);
const traceN = 120;
const tracePts = traceCurve.getPoints(traceN);
const traceProg = new Float32Array(tracePts.length);
const tracePos = new Float32Array(tracePts.length*3);
for(let k=0;k<tracePts.length;k++){ tracePos[k*3]=tracePts[k].x; tracePos[k*3+1]=tracePts[k].y; tracePos[k*3+2]=tracePts[k].z; traceProg[k]=k/(tracePts.length-1); }
const traceGeo = new THREE.BufferGeometry();
traceGeo.setAttribute('position', new THREE.BufferAttribute(tracePos,3));
traceGeo.setAttribute('aProg', new THREE.BufferAttribute(traceProg,1));
const traceU = { uColor:{value:new THREE.Color(0x18c0d8)}, uGrowStart:{value:0.0}, uGrowEnd:{value:1.0}, uOpacity:{value:1.0} };
function makeTraceMat(width, opacityMul){
  return new THREE.ShaderMaterial({ uniforms:traceU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader:`attribute float aProg; varying float vProg; void main(){ vProg=aProg; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`precision highp float; varying float vProg; uniform vec3 uColor; uniform float uGrowStart,uGrowEnd,uOpacity;
      void main(){
        if(vProg<uGrowStart || vProg>uGrowEnd) discard; // trim: solo se dibuja el tramo ya "crecido"
        float tipW=0.03;
        float tip=1.0-smoothstep(0.0,tipW,abs(vProg-uGrowEnd)); // punta brillante justo donde va creciendo
        gl_FragColor=vec4(uColor, (${opacityMul}+tip*0.8)*uOpacity);
      }`,
  });
}
const traceHalo=new THREE.Line(traceGeo, makeTraceMat(0.35,'0.35')); traceHalo.renderOrder=7; traceHalo.frustumCulled=false;
const traceCore=new THREE.Line(traceGeo, makeTraceMat(0.9,'0.9')); traceCore.renderOrder=7.1; traceCore.frustumCulled=false;
scene.add(traceHalo); scene.add(traceCore);

/* ---------- GLB estrella (central, fija, de frente) ---------- */
const glow=(function(){ const s=256,c=document.createElement('canvas'); c.width=c.height=s; const x=c.getContext('2d');
  const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2); g.addColorStop(0,'rgba(255,255,255,0.9)'); g.addColorStop(0.35,'rgba(255,255,255,0.25)'); g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,s,s); const m=new THREE.SpriteMaterial({ map:new THREE.CanvasTexture(c), color:0x6ab0ff, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false });
  const sp=new THREE.Sprite(m); sp.renderOrder=2; return sp; })();
const mainC=WINDOWS[0].center;
glow.position.set(mainC[0], mainC[1], 0.05); scene.add(glow);
const starGroup2=new THREE.Group(); starGroup2.position.set(mainC[0], mainC[1], 3.0); scene.add(starGroup2);
const starPos={ x:mainC[0], y:mainC[1], z:3.0 }; // lejos de la pared (z=0): asi ningun fragmento del shatter queda detras de ella al dispersarse
const glbMat=new THREE.MeshPhysicalMaterial({ color:0xdff0ff, emissive:new THREE.Color(0x4aa0ff), emissiveIntensity:1.6,
  roughness:0.12, transmission:0.6, ior:1.45, thickness:0.6, metalness:0.0, depthWrite:false,
  // depthWrite:false (NUEVO): sin esto, el vidrio "reservaba" su lugar en el buffer de profundidad como si
  // fuera opaco y bloqueaba que el vortex (detras) se dibujara ahi -- por eso las estrellas (que ya
  // ignoraban profundidad) se veian pero el vortex no. depthTest se deja en su default (true): eso es
  // lo que evita que los ~55 fragmentos del shatter se mezclen mal entre si (el bug de manchas negras).
  // OJO: transmission=1 + EffectComposer (nuestro Bloom) tiene bugs documentados en Three.js
  // (la pasada especial que "fotografia" lo de atras se rompe con postproceso). Por eso bajamos
  // transmission y sumamos opacity/transparent real: el alpha blending clasico SI funciona
  // siempre con Bloom, sin depender de ese mecanismo fragil -- asi las estrellas/vortex se ven seguro.
  transparent:true, opacity:0.4, side:THREE.DoubleSide }); // depthTest queda en su default (true) -- eso arreglo las manchas negras la vez pasada
scene.add(new THREE.AmbientLight(0x99aadd,1.1)); const dl=new THREE.DirectionalLight(0xffffff,1.4); dl.position.set(0.3,0.4,1); scene.add(dl);
const starState={ scale:0.7, emiColor:new THREE.Color(0x4aa0ff), emiInt:1.6, opacity:0.4, glowSize:2.6, glowInt:0.85 };
let glbRoot=null, mixer=null, action=null, clipDuration=1, liveShatter=false;
function applyStar(){ if(glbRoot) glbRoot.scale.setScalar(starState.scale); glbMat.emissive.copy(starState.emiColor); glbMat.emissiveIntensity=starState.emiInt; glbMat.opacity=starState.opacity;
  glow.material.color.copy(starState.emiColor); glow.material.opacity=starState.glowInt; glow.scale.setScalar(starState.glowSize); }
// funcion reusable: permite cargar el GLB inicial Y tambien reemplazarlo en caliente (ver selector de archivo mas abajo)
function loadGLBFromBuffer(buf){
  try{
    new GLTFLoader().parse(buf, '', gltf=>{
      if(glbRoot){ starGroup2.remove(glbRoot); }
      glbRoot=gltf.scene;
      // El modelo es plano con normal en +Y local; +90 en X lo orienta con la cara "frontal" mirando +Z (hacia la camara)
      glbRoot.rotation.x = Math.PI/2;
      glbRoot.traverse(o=>{ if(o.isMesh){ o.material=glbMat; o.frustumCulled=false; o.renderOrder=6; } }); // > que wall.renderOrder(1): sin esto, la pared (transparent:true por el fundido) dibujaba DESPUES y borraba el vidrio salvo donde coincidia con un agujero
      starGroup2.add(glbRoot); applyStar();
      mixer=null; action=null; clipDuration=1; liveShatter=false;
      if(gltf.animations && gltf.animations.length){ mixer=new THREE.AnimationMixer(glbRoot);
        action=mixer.clipAction(gltf.animations[0]); action.loop=THREE.LoopOnce; action.clampWhenFinished=true;
        clipDuration=gltf.animations[0].duration||1;
        action.play(); action.paused=true; action.time=0; mixer.update(0);
        // si ya existe el control de timeline (recarga de GLB en caliente), respetar el valor actual
        try{ const p=starObj.value.shatterProgress||0; action.time=p*clipDuration; mixer.update(0); }catch(e){} }
    }, err=>{ console.error('GLB',err); bail('No se pudo interpretar el GLB.'); });
  }catch(err){ console.error(err); }
}
fetch(GLB_URL)
  .then((r)=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.arrayBuffer(); })
  .then((buf)=> loadGLBFromBuffer(buf))
  .catch((err)=>{ console.error(err); bail('No se pudo cargar <code>estrella.glb</code>.'); });
function activate(){ if(action){ liveShatter=true; action.reset(); action.paused=false; } }
function resetStar(){ if(action){ liveShatter=false; action.reset(); action.paused=true; mixer.update(0); } }

/* ---------- post ---------- */
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.9, 0.7, 0.1); composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- THEATRE ---------- */
const num=(v,a,b)=>t.number(v,{range:[a,b]});
const project=getProject('Ventanas 3D SVG', { state: theatreState }); const sheet=project.sheet('Escena');
// vortexSheet eliminado: todo vive en el MISMO sheet ('Escena') para que haya un solo timeline
try{ onChange(sheet.sequence.pointer.playing, p=>{ seqPlayingMain=!!p; }); }catch(e){}

try{
  const trimObj=sheet.object('Trim del Recorrido',{ trimStart:num(0.0,0,1), trimEnd:num(1.0,0,1) });
  trimObj.onValuesChange(v=>{ vortexU.uTrimStart.value=Math.min(v.trimStart,v.trimEnd); vortexU.uTrimEnd.value=Math.max(v.trimStart,v.trimEnd); });
}catch(err){ console.error('Trim del Recorrido', err); }

try{
  const lookObj=sheet.object('Look del Vortex',{
    enabled:num(1,0,1), scale:num(1,0.2,4), radius:num(VTX_RADIUS_DEFAULT,1,40),
    taperStart:num(1.0,0.02,3), taperEnd:num(1.0,0.02,3),
    colorCore:t.rgba({r:.851,g:1.0,b:1.0,a:1}), colorMid:t.rgba({r:.12,g:.851,b:.878,a:1}), colorEdge:t.rgba({r:.5,g:.278,b:.9,a:1}),
    speed:num(0.6,0,4), swirl:num(0.8,-12,12), noiseScale:num(3.0,0.5,6), turbulence:num(0.8,0,2),
    glow:num(1.6,0.3,4), detail:num(1.0,0.5,6), fill:num(0.15,0,1.5), exitGlow:num(0.25,0,2),
  });
  lookObj.onValuesChange(v=>{
    vortexEnabled=v.enabled>=0.5; vortexMesh.visible=vortexEnabled;
    vortexGroup.scale.setScalar(v.scale); // afecta tubo Y marcadores juntos (antes solo el tubo, por eso se desincronizaba del path)
    if(v.radius!==vortexRadius){ vortexRadius=v.radius; rebuildVortexTube(); }
    vortexU.uRadiusBase.value=vortexRadius; // el taper reescala relativo a este radio "base" de la geometria
    vortexU.uTaperStart.value=v.taperStart; vortexU.uTaperEnd.value=v.taperEnd; // tramo inicial vs final: vertices mas chicos/grandes
    vortexU.uColorCore.value.setRGB(v.colorCore.r,v.colorCore.g,v.colorCore.b);
    vortexU.uColorMid.value.setRGB(v.colorMid.r,v.colorMid.g,v.colorMid.b);
    vortexU.uColorEdge.value.setRGB(v.colorEdge.r,v.colorEdge.g,v.colorEdge.b);
    vortexU.uSpeed.value=v.speed; vortexU.uSwirl.value=v.swirl*0.04; vortexU.uNoiseScale.value=v.noiseScale;
    vortexU.uTurbulence.value=v.turbulence; vortexU.uGlow.value=v.glow; vortexU.uDetail.value=v.detail; vortexU.uFill.value=v.fill;
    vortexGlowMat.opacity=v.exitGlow; vortexGlowSprite.scale.setScalar(6*Math.max(0.001,v.exitGlow));
  });
}catch(err){ console.error('Look del Vortex', err); }

try{
  const dispObj=sheet.object('Distorsión (Displace)',{ amount:num(0,0,4), scale:num(0.3,0.02,2), speed:num(0.15,-2,2) });
  dispObj.onValuesChange(v=>{ vortexU.uDispAmount.value=v.amount; vortexU.uDispScale.value=v.scale; vortexU.uDispSpeed.value=v.speed; });
}catch(err){ console.error('Distorsión (Displace)', err); }

let orbiting=false;
const camObj=sheet.object('Camara',{ position:{x:num(0,-60,60),y:num(0,-60,60),z:num(18,1,80)},
  rotation:{x:num(0,-Math.PI,Math.PI),y:num(0,-Math.PI,Math.PI),z:num(0,-Math.PI,Math.PI)}, fov:num(42,15,90) });
camObj.onValuesChange(v=>{ if(orbiting) return; camera.position.set(v.position.x,v.position.y,v.position.z);
  camera.rotation.set(v.rotation.x,v.rotation.y,v.rotation.z,'YXZ'); if(camera.fov!==v.fov){ camera.fov=v.fov; camera.updateProjectionMatrix(); } });

const winObj=sheet.object('Ventanas',{ glassTint:t.rgba({r:.10,g:.12,b:.22,a:1}), glassEdge:t.rgba({r:.81,g:.65,b:.99,a:1}), glassOpacity:num(0.30,0,1), dissolve:num(0,0,1),
  edgeWidth:num(3.0,0.3,8), edgeIntensity:num(2.2,0,6), neonColor:t.rgba({r:1,g:1,b:1,a:1}), neonWidth:num(1.0,0.1,6) });
winObj.onValuesChange(v=>{ glassU.uGlassTint.value.setRGB(v.glassTint.r,v.glassTint.g,v.glassTint.b); glassU.uGlassEdge.value.setRGB(v.glassEdge.r,v.glassEdge.g,v.glassEdge.b); glassU.uGlassOpacity.value=v.glassOpacity;
  glassU.uDissolve.value=v.dissolve; glassU.uEdgeWidth.value=v.edgeWidth; glassU.uEdgeIntensity.value=v.edgeIntensity;
  // dissolve=1: ademas del vidrio, apaga tambien el neon de las 2 ventanas laterales (indices 1 y 2) -- sin esto quedaba el contorno visible igual
  [1,2].forEach(i=>{ const nm=neonMats[i];
    nm.halo.uniforms.uDissolve.value=v.dissolve; nm.core.uniforms.uDissolve.value=v.dissolve;
    nm.halo.uniforms.uColor.value.setRGB(v.neonColor.r,v.neonColor.g,v.neonColor.b); nm.core.uniforms.uColor.value.setRGB(v.neonColor.r,v.neonColor.g,v.neonColor.b);
    nm.halo.uniforms.uWidth.value=nm.haloWidthBase*v.neonWidth; nm.core.uniforms.uWidth.value=nm.coreWidthBase*v.neonWidth; }); });

// antes el vidrio central tenia color fijo (casi invisible); ahora tambien puede tomar color propio,
// por ejemplo para acercarlo al turquesa del Logo EVA
const centralWinObj=sheet.object('Ventana Central (vidrio)',{ glassTint:t.rgba({r:0,g:0,b:0,a:1}), glassEdge:t.rgba({r:.81,g:.65,b:.99,a:1}), glassOpacity:num(0.0,0,1), dissolve:num(0,0,1),
  edgeWidth:num(3.0,0.3,8), edgeIntensity:num(2.2,0,6), neonColor:t.rgba({r:1,g:1,b:1,a:1}), neonWidth:num(1.0,0.1,6) });
centralWinObj.onValuesChange(v=>{ centralU.uGlassTint.value.setRGB(v.glassTint.r,v.glassTint.g,v.glassTint.b); centralU.uGlassEdge.value.setRGB(v.glassEdge.r,v.glassEdge.g,v.glassEdge.b); centralU.uGlassOpacity.value=v.glassOpacity;
  centralU.uDissolve.value=v.dissolve; centralU.uEdgeWidth.value=v.edgeWidth; centralU.uEdgeIntensity.value=v.edgeIntensity;
  const nm=neonMats[0];
  nm.halo.uniforms.uDissolve.value=v.dissolve; nm.core.uniforms.uDissolve.value=v.dissolve;
  nm.halo.uniforms.uColor.value.setRGB(v.neonColor.r,v.neonColor.g,v.neonColor.b); nm.core.uniforms.uColor.value.setRGB(v.neonColor.r,v.neonColor.g,v.neonColor.b);
  nm.halo.uniforms.uWidth.value=nm.haloWidthBase*v.neonWidth; nm.core.uniforms.uWidth.value=nm.coreWidthBase*v.neonWidth; });

try{
  const centralMaskObj=sheet.object('Ventana Central (máscara)',{
    offsetX:num(0,-6,6), offsetY:num(0,-6,6), scaleX:num(1,0.2,3), scaleY:num(1,0.2,3) });
  centralMaskObj.onValuesChange(v=>{ winMask[0].offX=v.offsetX; winMask[0].offY=v.offsetY; winMask[0].scX=v.scaleX; winMask[0].scY=v.scaleY; applyWinTransform(0); });
}catch(err){ console.error('Ventana Central (máscara)', err); }

try{
  const sideMaskObj=sheet.object('Ventanas Laterales',{
    offsetX:num(0,-4,4), offsetY:num(0,-4,4), scale:num(1,0.3,2) });
  sideMaskObj.onValuesChange(v=>{ sideState.offsetX=v.offsetX; sideState.offsetY=v.offsetY; sideState.scale=v.scale; applyWinTransform(1); applyWinTransform(2); });
}catch(err){ console.error('Ventanas Laterales', err); }

const fadeEl=document.getElementById('fadeOverlay');
fadeEl.style.opacity='0'; // default seguro antes de que Theatre confirme el valor real
try{
  const fadeObj=sheet.object('Fundido',{ blackOpacity:num(0,0,1) });
  fadeObj.onValuesChange(v=>{ fadeEl.style.opacity=String(v.blackOpacity); });
}catch(err){ console.error('Fundido', err); }

// fundido de PARED + GRILLA solamente (deja las ventanas -- vidrio, neon, GLB -- intactas)
try{
  const wallGridFadeObj=sheet.object('Fundido Pared y Grilla',{ blackout:num(0,0,1) });
  wallGridFadeObj.onValuesChange(v=>{ wallGridBlackout=v.blackout; wallMat.opacity=1-v.blackout;
    // clave: la pared solo es "transparent" (entra en la cola de dibujado ambigua junto al vidrio del GLB)
    // MIENTRAS se esta desvaneciendo de verdad. En blackout=0 (su estado normal/default) vuelve a ser
    // opaca de verdad -> se dibuja SIEMPRE antes que cualquier objeto transparente, sin depender de
    // renderOrder ni de sorteos por distancia. Esto es lo que hacia que el vidrio del GLB desapareciera.
    const shouldBeTransparent = v.blackout > 0.001;
    if(wallMat.transparent !== shouldBeTransparent){ wallMat.transparent = shouldBeTransparent; wallMat.needsUpdate = true; }
    // mientras esta desvaneciendo (transparent=true), tampoco escribe profundidad -> asi no puede
    // competir por el orden contra el vidrio del GLB ni en ese tramo intermedio (0 < blackout < 1)
    wallMat.depthWrite = !shouldBeTransparent; });
}catch(err){ console.error('Fundido Pared y Grilla', err); }

const wallObj=sheet.object('Pared',{
  colorCenter:t.rgba({r:.275,g:.227,b:.525,a:1}), colorMid:t.rgba({r:.055,g:.075,b:.19,a:1}), colorEdge:t.rgba({r:.04,g:.05,b:.11,a:1}),
});
function rgbToHex(c){ const h=v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0'); return '#'+h(c.r)+h(c.g)+h(c.b); }
wallObj.onValuesChange(v=>{
  WALL_COLORS={ center:rgbToHex(v.colorCenter), mid:rgbToHex(v.colorMid), edge:rgbToHex(v.colorEdge) };
  const old=wallTex; wallTex=buildWallTexture(); wallMat.map=wallTex; wallMat.needsUpdate=true; old.dispose();
});

let wallSpillIntensity=1.0;
try{
  const spillObj=sheet.object('Derrame de luz en Pared',{ enabled:num(1,0,1), intensity:num(1.0,0,3) });
  spillObj.onValuesChange(v=>{ wallSpillIntensity = v.enabled>=0.5 ? v.intensity : 0; });
}catch(err){ console.error('Derrame de luz en Pared', err); }

const gridObj=sheet.object('Grilla',{
  color:t.rgba({r:.81,g:.65,b:.99,a:1}), baseOpacity:num(0.16,0,1), pulseSpeed:num(0.35,0,3), pulseWidth:num(0.22,0.02,1), pulseBright:num(2.4,0,8),
  nodeBaseOpacity:num(0.21,0,1), nodePulseBright:num(2.4,0,8),
});
gridObj.onValuesChange(v=>{ gridState.color.setRGB(v.color.r,v.color.g,v.color.b); gridState.baseOpacity=v.baseOpacity;
  gridState.pulseSpeed=v.pulseSpeed; gridState.pulseWidth=v.pulseWidth; gridState.pulseBright=v.pulseBright;
  gridState.nodeBaseOpacity=v.nodeBaseOpacity; gridState.nodePulseBright=v.nodePulseBright; });

function alarmObj(idx,dx){ const o=sheet.object('Alarma / Foco '+(idx+1),{
    color:t.rgba({r:1,g:.16,b:.16,a:1}), intensity:num(1.4,0,5), flicker:num(0.7,0,1), speed:num(idx?1.5:2.2,0,8), posX:num(dx,-25,25), posY:num(0,-20,20) });
  o.onValuesChange(v=>{ L[idx].color.setRGB(v.color.r,v.color.g,v.color.b); L[idx].intensity=v.intensity; L[idx].flicker=v.flicker; L[idx].speed=v.speed; L[idx].x=v.posX; L[idx].y=v.posY; }); }
alarmObj(0,-8); alarmObj(1,8);

const bgObj=sheet.object('Fondo estrellas',{ count:num(1400,0,6000), brightness:num(1,0,3), drift:num(0.02,0,0.4), swingRange:num(0.12,0,1) });
bgObj.onValuesChange(v=>{ buildStars(v.count); starU.uBright.value=v.brightness; starDrift=v.drift; starSwingRange=v.swingRange; });

try{
  const logoObj=sheet.object('Logo EVA',{
    enabled:num(1,0,1), color:t.rgba({r:.094,g:.753,b:.847,a:1}), opacity:num(1.0,0,1),
    scale:num(1,0.05,6), posX:num(0,-30,30), posY:num(0,-30,30), posZ:num(5,-60,30) });
  logoObj.onValuesChange(v=>{
    evaLogoMesh.visible = v.enabled>=0.5;
    evaLogoU.uColor.value.setRGB(v.color.r,v.color.g,v.color.b);
    evaLogoU.uOpacity.value=v.opacity;
    evaLogoMesh.scale.setScalar(v.scale);
    evaLogoMesh.position.set(v.posX,v.posY,v.posZ);
  });
}catch(err){ console.error('Logo EVA', err); }

try{
  const traceObj=sheet.object('Trazo Horizontal',{
    enabled:num(1,0,1), color:t.rgba({r:.094,g:.753,b:.847,a:1}), opacity:num(1.0,0,1),
    growStart:num(0.0,0,1), growEnd:num(1.0,0,1) }); // growEnd 0->1 anima el crecimiento de izquierda a derecha
  traceObj.onValuesChange(v=>{
    const on=v.enabled>=0.5; traceHalo.visible=on; traceCore.visible=on;
    traceU.uColor.value.setRGB(v.color.r,v.color.g,v.color.b);
    traceU.uOpacity.value=v.opacity;
    traceU.uGrowStart.value=Math.min(v.growStart,v.growEnd); traceU.uGrowEnd.value=Math.max(v.growStart,v.growEnd);
  });
}catch(err){ console.error('Trazo Horizontal', err); }

const starObj=sheet.object('Estrella (GLB)',{
  posX:num(mainC[0],-20,20), posY:num(mainC[1],-20,20), posZ:num(3.0,-6,10),
  scale:num(0.7,0.1,2), emissiveColor:t.rgba({r:.29,g:.63,b:1,a:1}), emissiveIntensity:num(1.6,0,6), opacity:num(0.4,0.05,1), glowSize:num(2.6,0.5,8), glowIntensity:num(0.85,0,2),
  transmission:num(0.6,0,1), roughness:num(0.12,0,1), ior:num(1.45,1,2.4), thickness:num(0.6,0,3),
  shatterProgress:num(0,0,1) });
starObj.onValuesChange(v=>{ starState.scale=v.scale; starState.emiColor.setRGB(v.emissiveColor.r,v.emissiveColor.g,v.emissiveColor.b); starState.emiInt=v.emissiveIntensity; starState.opacity=v.opacity; starState.glowSize=v.glowSize; starState.glowInt=v.glowIntensity;
  starPos.x=v.posX; starPos.y=v.posY; starPos.z=v.posZ;
  starGroup2.position.set(v.posX,v.posY,v.posZ); glow.position.set(v.posX,v.posY,v.posZ-0.2);
  glbMat.transmission=v.transmission; glbMat.roughness=v.roughness; glbMat.ior=v.ior; glbMat.thickness=v.thickness;
  applyStar();
  // shatterProgress: controla el frame exacto de la explosion desde el timeline (no solo un boton de una vez)
  if(action && !liveShatter){ action.paused=true; action.time = v.shatterProgress*clipDuration; mixer.update(0); } });

const bloomObj=sheet.object('Bloom',{ strength:num(0.4,0,3), radius:num(0.5,0,2), threshold:num(0.4,0,1) });

// nota: uso num(0/1) en vez de t.boolean para no depender de una API de tipos que podria no
// existir tal cual en esta version del bundle -- si t.boolean tirara una excepcion aca, todo el
// script se frena ANTES de llegar al loop de render (esa fue la causa real de la pantalla negra).
// Hoisted before sheet.object('Parallax') — onValuesChange fires sync when state loads,
// so these must exist before that callback runs (TDZ otherwise).
let parallaxEnabled=false, mouseNX=0, mouseNY=0, paraX=0, paraY=0;
let paraxIntensity=1;
const paraxBtn=document.getElementById('paraxBtn');
try{
  const paraxObj=sheet.object('Parallax',{ enabled:num(0,0,1), intensity:num(1,0,3) });
  paraxObj.onValuesChange(v=>{ const on=v.enabled>=0.5; parallaxEnabled=on; paraxBtn.textContent='Parallax: '+(on?'ON':'OFF'); paraxBtn.classList.toggle('on',on); paraxIntensity=v.intensity; });
}catch(err){ console.error('Parallax Theatre object', err); }
bloomObj.onValuesChange(v=>{ bloom.strength=v.strength; bloom.radius=v.radius; bloom.threshold=v.threshold; });

try{ if(studioReady) studio.setSelection([starObj]); }catch(e){}

/* ---------- editor cámara + triggers ---------- */
let orbit=null;
try{
  orbit=new OrbitControls(camera, renderer.domElement); orbit.target.set(0,-0.4,0); orbit.enableDamping=true; orbit.enabled=false; orbit.update();
  const navBtn=document.getElementById('navBtn');
  navBtn.addEventListener('click', ()=>{ orbiting=!orbiting; orbit.enabled=orbiting;
    if(orbiting){ const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion); orbit.target.copy(camera.position).add(f.multiplyScalar(18)); orbit.update(); }
    navBtn.textContent='Navegar: '+(orbiting?'ON':'OFF'); navBtn.classList.toggle('on',orbiting); });
  document.getElementById('grabBtn').addEventListener('click', ()=>{ const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
    if(!studioReady) return; const scr=studio.scrub(); scr.capture(({set})=>{ set(camObj.props.position.x,camera.position.x); set(camObj.props.position.y,camera.position.y); set(camObj.props.position.z,camera.position.z);
      set(camObj.props.rotation.x,e.x); set(camObj.props.rotation.y,e.y); set(camObj.props.rotation.z,e.z); set(camObj.props.fov,camera.fov); }); scr.commit();
    const b=document.getElementById('grabBtn'), o=b.textContent; b.textContent='✓ keyframe'; setTimeout(()=>b.textContent=o,900); });
  document.getElementById('resetCamBtn').addEventListener('click', ()=>{
    camera.position.set(0,0,18); camera.rotation.set(0,0,0,'YXZ'); camera.fov=42; camera.updateProjectionMatrix();
    if(orbit){ orbit.target.set(0,-0.4,0); orbit.update(); }
    if(!studioReady) return; const scr=studio.scrub(); scr.capture(({set})=>{ set(camObj.props.position.x,0); set(camObj.props.position.y,0); set(camObj.props.position.z,18);
      set(camObj.props.rotation.x,0); set(camObj.props.rotation.y,0); set(camObj.props.rotation.z,0); set(camObj.props.fov,42); }); scr.commit();
  });
}catch(err){ console.error('orbit',err); }
document.getElementById('actBtn').addEventListener('click', activate);
document.getElementById('resetBtn').addEventListener('click', resetStar);
document.getElementById('loadGlbBtn').addEventListener('click', ()=> document.getElementById('glbFileInput').click());
document.getElementById('glbFileInput').addEventListener('change', ev=>{
  const f=ev.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=()=>{ loadGLBFromBuffer(reader.result);
    const b=document.getElementById('loadGlbBtn'), o=b.textContent; b.textContent='✓ '+f.name; setTimeout(()=>b.textContent=o,1500); };
  reader.readAsArrayBuffer(f);
  ev.target.value=''; // permite volver a elegir el mismo archivo despues
});
const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
const vortexNdc=(ev)=>new THREE.Vector2((ev.clientX/innerWidth)*2-1, -(ev.clientY/innerHeight)*2+1);
renderer.domElement.addEventListener('pointerdown', ev=>{
  if(vortexDrawMode){ vortexDrawing=true; vortexStroke=[vortexNdc(ev)]; ev.preventDefault(); return; }
  if(orbiting || (vortexGizmo && vortexGizmo.dragging)) return;
  ptr.copy(vortexNdc(ev)); ray.setFromCamera(ptr,camera);
  const hMarker=ray.intersectObjects(vortexMarkers,false)[0];
  if(hMarker){ selectVortexPoint(hMarker.object.userData.i); return; } // click en un punto del recorrido: seleccionarlo (siempre disponible, como el original)
  selectVortexPoint(-1); // click en vacio: deseleccionar
  const h=ray.intersectObjects(fillMeshes,false)[0]; if(h && h.object.userData.main) activate(); });
renderer.domElement.addEventListener('pointermove', ev=>{ if(!vortexDrawMode||!vortexDrawing) return; const p=vortexNdc(ev);
  const last=vortexStroke[vortexStroke.length-1]; if(!last||Math.hypot(p.x-last.x,p.y-last.y)>0.012) vortexStroke.push(p); });
const vortexFinishDraw=()=>{ if(!vortexDrawing) return; vortexDrawing=false;
  if(vortexStroke.length>=2){ const K=Math.min(9,Math.max(3,Math.round(vortexStroke.length/6))); const pts=[];
    for(let j=0;j<K;j++){ const f=j/(K-1); const idx=Math.round(f*(vortexStroke.length-1)); pts.push(vortexScreenToWorldAtDist(vortexStroke[idx], 6+(vortexDrawDepth-6)*f)); }
    CTRL=pts; vortexSelected=-1; rebuildVortexTube(); rebuildVortexMarkers(); saveVortexPath(); }
  setVortexDrawMode(false); const b=document.getElementById('vortexDrawBtn'); b.classList.remove('on'); };
renderer.domElement.addEventListener('pointerup', vortexFinishDraw);
renderer.domElement.addEventListener('pointerleave', vortexFinishDraw);

/* ---------- gizmo para arrastrar los waypoints del recorrido del vortex ---------- */
try{
  vortexGizmo=new TransformControls(camera, renderer.domElement);
  // three r169+: TransformControls is no longer an Object3D — add its helper instead
  vortexGizmo.setSize(0.8); scene.add(vortexGizmo.getHelper());
  vortexGizmo.addEventListener('dragging-changed', ev=>{ if(orbit) orbit.enabled = ev.value ? false : orbiting; });
  vortexGizmo.addEventListener('objectChange', ()=>{
    if(vortexSelected<0) return;
    CTRL[vortexSelected].copy(vortexMarkers[vortexSelected].position); rebuildVortexTube(); saveVortexPath();
  });
}catch(err){ console.error('TransformControls', err); }
document.getElementById('vortexDrawBtn').addEventListener('click', ()=>{
  setVortexDrawMode(!vortexDrawMode); document.getElementById('vortexDrawBtn').classList.toggle('on',vortexDrawMode);
});
document.getElementById('vortexTensionInput').addEventListener('input', ev=>{ pathTension=parseFloat(ev.target.value); rebuildVortexTube(); saveVortexPath(); });
document.getElementById('vortexDepthInput').addEventListener('input', ev=>{ vortexDrawDepth=parseFloat(ev.target.value); });
document.getElementById('vortexAddBtn').addEventListener('click', addVortexPoint);
document.getElementById('vortexRemoveBtn').addEventListener('click', removeVortexPoint);
document.getElementById('vortexResetPathBtn').addEventListener('click', resetVortexPath);
document.getElementById('helpToggleBtn').addEventListener('click', ()=> document.getElementById('help').classList.toggle('on'));

/* ---------- efecto parallax (activar/desactivar), en base al mouse ---------- */
addEventListener('pointermove', ev=>{ mouseNX=(ev.clientX/innerWidth)*2-1; mouseNY=(ev.clientY/innerHeight)*2-1; });
paraxBtn.addEventListener('click', ()=>{ parallaxEnabled=!parallaxEnabled; paraxBtn.textContent='Parallax: '+(parallaxEnabled?'ON':'OFF'); paraxBtn.classList.toggle('on',parallaxEnabled); });

document.getElementById('help').innerHTML='<b>Ventana central</b>: casi invisible en reposo (libre para el GLB), pero reacciona a la alarma. Vidrio normal en las laterales. <b>Trigger:</b> ✦ Activar o click en la central (preview en vivo). '+
  '<b>Estrella (GLB) → shatterProgress</b>: controla el frame exacto de la explosion desde el timeline. <b>Cargar otro GLB…</b>: elegí cualquier .glb de tu disco para probarlo en el mismo lugar. '+
  '<b>Parallax</b>: botón o el booleano en el timeline; mueve pared+vidrios+neón, estrella y fondo a distinta profundidad segun el mouse. '+
  '<b>Máscaras</b>: <b>Ventana Central</b> = offset/escala propios; <b>Ventanas Laterales</b> = un control para ambas. '+
  '<b>Fondo estrellas → swingRange</b>: acota cuánto giran las estrellas (antes giraban sin límite). <b>Fundido → blackOpacity</b> para entrar desde negro. '+
  '<b>Fundido Pared y Grilla → blackout</b>: funde SOLO la pared y la grilla a negro, dejando visibles el vidrio, el neón y el GLB. La grilla ya se recorta sola donde estén las ventanas, sigan donde sigan. '+
  '<b>Navegar</b> = orbitá; <b>Capturar</b> = keyframe de cámara; <b>Reset cámara</b> si quedó lejos/cerca.';
if(!studioReady){ const h=document.getElementById('help'); h.innerHTML='⚠ Timeline no arrancó. '+h.innerHTML; }

addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight); bloom.setSize(innerWidth,innerHeight); });

function tick(){
  requestAnimationFrame(tick);
  const dt=clock.getDelta(), time=clock.elapsedTime;
  // el pulso de la grilla avanza a velocidad PERCIBIDA constante: si la camara esta mas cerca de la
  // pared que la distancia de referencia, el acumulador crece mas lento (compensa que de cerca la
  // misma velocidad fisica ocupa mas pantalla); si esta mas lejos, crece mas rapido.
  const camDistToWall=Math.max(1, camera.position.length());
  gridPulseTime += dt * (GRID_REF_DIST/camDistToWall);
  if(mixer) mixer.update(dt);
  // parallax: 3 capas a distinta profundidad. pared+grilla+vidrios+neon viajan JUNTOS (nearLayer,
  // un solo grupo) para que nunca se desalineen entre si; la estrella GLB y el fondo se mueven aparte,
  // con menos magnitud (sensacion de estar mas lejos).
  { const tX=parallaxEnabled?mouseNX:0, tY=parallaxEnabled?mouseNY:0;
    paraX += (tX-paraX)*0.06; paraY += (tY-paraY)*0.06;
    const wallK=0.18*paraxIntensity, glbK=0.09*paraxIntensity, bgK=0.03*paraxIntensity;
    nearLayer.position.set(paraX*wallK, paraY*wallK*0.6, 0);
    starGroup2.position.set(starPos.x+paraX*glbK, starPos.y+paraY*glbK*0.6, starPos.z);
    glow.position.set(starPos.x+paraX*glbK, starPos.y+paraY*glbK*0.6, starPos.z-0.2);
    starGroup.position.x=Math.sin(time*starDrift)*0.5 + paraX*bgK; starGroup.position.y=paraY*bgK*0.6;
  }
  starU.uTime.value=time; starGroup.rotation.y=Math.sin(time*starDrift*0.5)*starSwingRange;
  if(vortexEnabled) vortexU.uTime.value=time;
  { const editVis = !vortexDrawMode && !seqPlayingMain; // siempre visibles/clickeables, como el original
    vortexMarkerGroup.visible=editVis; vortexPathLine.visible=editVis;
    if(vortexGizmo){ const helper=vortexGizmo.getHelper(); helper.visible=editVis && vortexSelected>=0; vortexGizmo.enabled=editVis; } }
  updateGrid(gridPulseTime);
  const i0=L[0].intensity*flick(time,L[0].speed,L[0].flicker), i1=L[1].intensity*flick(time,L[1].speed,L[1].flicker);
  tmpC0.copy(L[0].color).multiplyScalar(i0); tmpC1.copy(L[1].color).multiplyScalar(i1);
  glassU.uLightColI.value[0].copy(tmpC0); glassU.uLightColI.value[1].copy(tmpC1);
  glassU.uLightPos.value[0].set(L[0].x,L[0].y,L[0].z); glassU.uLightPos.value[1].set(L[1].x,L[1].y,L[1].z);
  centralU.uLightColI.value[0].copy(tmpC0); centralU.uLightColI.value[1].copy(tmpC1);
  centralU.uLightPos.value[0].set(L[0].x,L[0].y,L[0].z); centralU.uLightPos.value[1].set(L[1].x,L[1].y,L[1].z);
  neonLightU.uLightColI.value[0].copy(tmpC0); neonLightU.uLightColI.value[1].copy(tmpC1);
  neonLightU.uLightPos.value[0].set(L[0].x,L[0].y,L[0].z); neonLightU.uLightPos.value[1].set(L[1].x,L[1].y,L[1].z);
  // derrame de luz de alarma sobre la pared, alrededor de cada ventana (misma atenuacion por distancia que el vidrio)
  for(let wi=0; wi<3; wi++){
    const c=winCentersW[wi]; let sr=0,sg=0,sb=0;
    for(let li=0; li<2; li++){ const dx=L[li].x-c[0], dy=L[li].y-c[1], dz=L[li].z-0, d2=dx*dx+dy*dy+dz*dz;
      const att=1.0/(1.0+d2*0.02); const col=(li===0?tmpC0:tmpC1);
      sr+=col.r*att; sg+=col.g*att; sb+=col.b*att; }
    const sp=wallSpillSprites[wi]; sp.material.color.setRGB(sr,sg,sb); sp.material.opacity=Math.min(1,(sr+sg+sb)*0.5*wallSpillIntensity);
  }
  tmpW.copy(tmpC0).add(tmpC1).multiplyScalar(0.14); starU.uAlarm.value.copy(tmpW);
  if(orbit && orbiting) orbit.update();
  composer.render();
}
tick();
