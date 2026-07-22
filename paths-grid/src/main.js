import * as THREE from 'three';
import GUI from 'lil-gui';

// A flat field of "survey marker" nodes (circle + crosshair) joined by
// hairline edges. Both nodes and edges run through a shader that measures
// distance to the mouse (unprojected onto the z=0 plane) and blends a glow
// color in within a configurable radius — nothing lights up until the
// cursor actually gets close to it.

const params = {
  cellSize: 255,
  cols: 4,
  rows: 4,
  lineThickness: 1,
  radius: 250,
  glowColor: '#7fdfff',
  baseColor: '#616161',
  nodeColor: '#9aa0ad',
  background: '#000000',
  intensity: 1.6,
  showHorizontal: true,
  showVertical: true,
  showDiagonalA: true,
  showDiagonalB: true,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.background);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 0, 800);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// ---- shared uniforms driving the glow-near-mouse effect ----
const uniforms = {
  uMouse: { value: new THREE.Vector2(1e5, 1e5) },
  uRadius: { value: params.radius },
  uGlowColor: { value: new THREE.Color(params.glowColor) },
  uIntensity: { value: params.intensity },
};

const glowChunk = `
  varying vec3 vWorldPos;
  uniform vec2 uMouse;
  uniform float uRadius;
  uniform vec3 uGlowColor;
  uniform float uIntensity;

  float glowFactor() {
    float d = distance(vWorldPos.xy, uMouse);
    float t = 1.0 - smoothstep(0.0, uRadius, d);
    return t;
  }
`;

// ---------------------------------------------------------------
// Node layout: jittered grid, connected to nearby neighbors
// ---------------------------------------------------------------
// An orderly square grid of nodes; the only paths between them are the
// 45-degree diagonals of each grid cell (an X through every cell), which is
// what produces the four-pointed "star" shapes where diagonals cross.
function buildGraph(cellSize, cols, rows) {
  const originX = -((cols - 1) * cellSize) / 2;
  const originY = -((rows - 1) * cellSize) / 2;

  const points = [];
  const index = (c, r) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push(new THREE.Vector3(originX + c * cellSize, originY + r * cellSize, 0));
    }
  }

  const horizontal = [];
  const vertical = [];
  const diagonalA = []; // top-left \ bottom-right
  const diagonalB = []; // top-right / bottom-left
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = index(c, r);
      if (c < cols - 1) horizontal.push([here, index(c + 1, r)]);
      if (r < rows - 1) vertical.push([here, index(c, r + 1)]);
      if (c < cols - 1 && r < rows - 1) {
        diagonalA.push([here, index(c + 1, r + 1)]);
        diagonalB.push([index(c + 1, r), index(c, r + 1)]);
      }
    }
  }

  return { points, horizontal, vertical, diagonalA, diagonalB };
}

let graph = buildGraph(params.cellSize, params.cols, params.rows);

// ---------------------------------------------------------------
// Edges: LineSegments with a custom glow shader
// ---------------------------------------------------------------
let lineMaterial;
let lineGroups = {};

// Builds each edge as a flat quad (two triangles) rather than a GL line, so
// thickness is an actual world-space width instead of being at the mercy of
// LineBasicMaterial's mostly-ignored linewidth.
function makeLineGeometry(edges, thickness) {
  const half = thickness / 2;
  const positions = new Float32Array(edges.length * 6 * 3);
  const tmp = new THREE.Vector2();

  edges.forEach(([a, b], i) => {
    const pa = graph.points[a];
    const pb = graph.points[b];
    tmp.set(pb.x - pa.x, pb.y - pa.y).normalize();
    const nx = -tmp.y * half;
    const ny = tmp.x * half;

    const v = [
      pa.x + nx, pa.y + ny, 0,
      pa.x - nx, pa.y - ny, 0,
      pb.x + nx, pb.y + ny, 0,
      pb.x + nx, pb.y + ny, 0,
      pa.x - nx, pa.y - ny, 0,
      pb.x - nx, pb.y - ny, 0,
    ];
    positions.set(v, i * 18);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

const EDGE_KEYS = {
  horizontal: 'showHorizontal',
  vertical: 'showVertical',
  diagonalA: 'showDiagonalA',
  diagonalB: 'showDiagonalB',
};

function buildLines() {
  for (const key of Object.keys(lineGroups)) {
    scene.remove(lineGroups[key]);
    lineGroups[key].geometry.dispose();
  }
  lineGroups = {};

  if (!lineMaterial) {
    lineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uBaseColor: { value: new THREE.Color(params.baseColor) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        ${glowChunk}
        uniform vec3 uBaseColor;
        void main() {
          float g = glowFactor();
          vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }

  for (const key of Object.keys(EDGE_KEYS)) {
    const geometry = makeLineGeometry(graph[key], params.lineThickness);
    const mesh = new THREE.Mesh(geometry, lineMaterial);
    mesh.visible = params[EDGE_KEYS[key]];
    lineGroups[key] = mesh;
    scene.add(mesh);
  }
}
buildLines();

// ---------------------------------------------------------------
// Nodes: instanced billboard circles (ring + crosshair, drawn on a canvas)
// ---------------------------------------------------------------
function makeNodeTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const r = size * 0.28;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.03;

  // crosshair ticks, reaching almost to the edge, gapped at the ring
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.48, cx);
  ctx.lineTo(cx - r * 0.7, cx);
  ctx.moveTo(cx + r * 0.7, cx);
  ctx.lineTo(cx + size * 0.48, cx);
  ctx.moveTo(cx, cx - size * 0.48);
  ctx.lineTo(cx, cx - r * 0.7);
  ctx.moveTo(cx, cx + r * 0.7);
  ctx.lineTo(cx, cx + size * 0.48);
  ctx.stroke();

  // single thin ring, like a survey/target reticle
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const nodeTexture = makeNodeTexture();

let nodeMesh;
function buildNodes() {
  if (nodeMesh) {
    scene.remove(nodeMesh);
    nodeMesh.geometry.dispose();
    nodeMesh.material.dispose();
  }

  const nodeSize = 26;
  const geometry = new THREE.PlaneGeometry(nodeSize, nodeSize);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uBaseColor: { value: new THREE.Color(params.nodeColor) },
      uMap: { value: nodeTexture },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vWorldPos = center.xyz;

        // billboard: keep the quad facing the camera regardless of instance rotation
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 worldPos = instancePos + camRight * position.x + camUp * position.y;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: `
      ${glowChunk}
      varying vec2 vUv;
      uniform vec3 uBaseColor;
      uniform sampler2D uMap;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.05) discard;
        float g = glowFactor();
        vec3 color = mix(uBaseColor, uGlowColor, g * uIntensity);
        gl_FragColor = vec4(color, tex.a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  nodeMesh = new THREE.InstancedMesh(geometry, material, graph.points.length);
  const m = new THREE.Matrix4();
  graph.points.forEach((p, i) => {
    m.setPosition(p);
    nodeMesh.setMatrixAt(i, m);
  });
  nodeMesh.instanceMatrix.needsUpdate = true;
  scene.add(nodeMesh);
}
buildNodes();

// ---------------------------------------------------------------
// Mouse tracking: unproject onto the z=0 plane
// ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(1e5, 1e5);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

window.addEventListener('pointermove', (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('pointerleave', () => {
  pointerNDC.set(1e5, 1e5);
});

function updateMouseWorld() {
  raycaster.setFromCamera(pointerNDC, camera);
  if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    uniforms.uMouse.value.set(hitPoint.x, hitPoint.y);
  } else {
    uniforms.uMouse.value.set(1e5, 1e5);
  }
}

// ---------------------------------------------------------------
// Resize / regenerate
// ---------------------------------------------------------------
function regenerate() {
  graph = buildGraph(params.cellSize, params.cols, params.rows);
  buildLines();
  buildNodes();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  regenerate();
});

// ---------------------------------------------------------------
// GUI
// ---------------------------------------------------------------
const gui = new GUI();
gui.add(params, 'radius', 20, 500, 1).name('glow radius').onChange((v) => (uniforms.uRadius.value = v));
gui.addColor(params, 'glowColor').name('glow color').onChange((v) => uniforms.uGlowColor.value.set(v));
gui.add(params, 'intensity', 0.2, 3, 0.05).name('glow intensity').onChange((v) => (uniforms.uIntensity.value = v));
gui.addColor(params, 'baseColor').name('inactive color').onChange((v) => {
  lineMaterial.uniforms.uBaseColor.value.set(v);
});
gui.addColor(params, 'nodeColor').name('node color').onChange((v) => {
  nodeMesh.material.uniforms.uBaseColor.value.set(v);
});
gui.addColor(params, 'background').name('background').onChange((v) => scene.background.set(v));
gui.add(params, 'cellSize', 60, 320, 5).name('grid spacing').onFinishChange(regenerate);
gui.add(params, 'cols', 2, 40, 1).name('columns').onFinishChange(regenerate);
gui.add(params, 'rows', 2, 40, 1).name('rows').onFinishChange(regenerate);
gui.add(params, 'lineThickness', 0.5, 12, 0.5).name('line thickness').onFinishChange(buildLines);

const pathsFolder = gui.addFolder('paths');
pathsFolder.add(params, 'showHorizontal').name('horizontal').onChange((v) => (lineGroups.horizontal.visible = v));
pathsFolder.add(params, 'showVertical').name('vertical').onChange((v) => (lineGroups.vertical.visible = v));
pathsFolder.add(params, 'showDiagonalA').name('diagonal \\').onChange((v) => (lineGroups.diagonalA.visible = v));
pathsFolder.add(params, 'showDiagonalB').name('diagonal /').onChange((v) => (lineGroups.diagonalB.visible = v));

// ---------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  updateMouseWorld();
  renderer.render(scene, camera);
}
animate();
