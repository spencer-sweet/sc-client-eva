import * as THREE from 'three';
import GUI from 'lil-gui';

// A flat field of "survey marker" nodes (circle + crosshair) joined by
// hairline edges. Both nodes and edges run through a shader that measures
// distance to the mouse (unprojected onto the z=0 plane) and blends a glow
// color in within a configurable radius — nothing lights up until the
// cursor actually gets close to it.

const params = {
  cellSize: 255,
  cols: 9,
  rows: 4,
  lineThickness: 1,
  radius: 250,
  glowColor: '#fdb4b4',
  baseColor: '#586393',
  nodeColor: '#586393',
  nodeSize: 40,
  ringCount: 2,
  background: '#0a0f2c',
  intensity: 1.6,
  showHorizontal: true,
  showVertical: true,
  showDiagonalA: true,
  showDiagonalB: true,
  showStar: true,
  starSize: 480,
  starSize2: 300,
  starOffsetX: 255,
  starOffsetY: 255,
  starColorA: '#8a5cff',
  starColorB: '#2a3bd8',
  starCore: '#e8ddff',
  panStrength: 0.06,
  parallaxStrength: 8,
  parallaxSmoothing: 0.08,
  starParallaxMultiplier2: 3,
  starParallaxMultiplier3: 2,
  cameraZ: 800,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.background);

// nodes + lines live in here so they can shift together for the parallax effect
const gridGroup = new THREE.Group();
scene.add(gridGroup);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 0, params.cameraZ);

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
    gridGroup.remove(lineGroups[key]);
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
    gridGroup.add(mesh);
  }
}
buildLines();

// ---------------------------------------------------------------
// Nodes: real flat geometry (not a canvas texture), so the ring stays crisp
// at any size instead of aliasing like a magnified raster image. Two
// instanced meshes per node: an opaque "cover" disc that blocks the grid
// lines converging underneath it, and one or more thin ring bands (drawn on
// top of the cover, in the node/glow color) for the reticle look.
// ---------------------------------------------------------------

// radii (as a fraction of the outer radius) for each ring-count preset
const RING_RADII_BY_COUNT = {
  0: [],
  1: [1],
  2: [1, 0.6],
  3: [1, 0.75, 0.5],
};

// a flat disc, built as a triangle fan
function buildDiscGeometry(radius, segments = 48) {
  const verts = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    verts.push(
      0, 0, 0,
      radius * Math.cos(a0), radius * Math.sin(a0), 0,
      radius * Math.cos(a1), radius * Math.sin(a1), 0
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geometry;
}

// one or more concentric ring bands (annuli), merged into a single geometry
function buildRingsGeometry(radii, halfWidth, segments = 64) {
  const verts = [];
  for (const radius of radii) {
    const inner = radius - halfWidth;
    const outer = radius + halfWidth;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const ci0 = Math.cos(a0), si0 = Math.sin(a0);
      const ci1 = Math.cos(a1), si1 = Math.sin(a1);
      verts.push(
        inner * ci0, inner * si0, 0,
        outer * ci0, outer * si0, 0,
        outer * ci1, outer * si1, 0,

        inner * ci0, inner * si0, 0,
        outer * ci1, outer * si1, 0,
        inner * ci1, inner * si1, 0
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geometry;
}

function instanceAtPoints(mesh, points) {
  const m = new THREE.Matrix4();
  points.forEach((p, i) => {
    m.setPosition(p);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

// Nodes that fall inside a star's silhouette get fully hidden underneath it
// anyway, so skip instancing them there rather than letting their rings poke
// out past the star's narrow points.
function visibleNodePoints() {
  const instances = params.showStar ? getStarInstances() : [];
  if (!instances.length) return graph.points;
  return graph.points.filter(
    (p) => !instances.some((s) => pointInStar(p.x - s.x, p.y - s.y, s.size))
  );
}

let nodeCoverMesh;
let nodeRingMesh;
function buildNodes() {
  if (nodeCoverMesh) {
    gridGroup.remove(nodeCoverMesh);
    nodeCoverMesh.geometry.dispose();
    nodeCoverMesh.material.dispose();
  }
  if (nodeRingMesh) {
    gridGroup.remove(nodeRingMesh);
    nodeRingMesh.geometry.dispose();
    nodeRingMesh.material.dispose();
  }

  const outerR = params.nodeSize / 2;
  const radii = (RING_RADII_BY_COUNT[params.ringCount] ?? RING_RADII_BY_COUNT[2]).map((f) => f * outerR);

  const coverGeometry = buildDiscGeometry(outerR);
  const coverMaterial = new THREE.ShaderMaterial({
    uniforms: { uHoleColor: { value: new THREE.Color(params.background) } },
    vertexShader: `
      void main() {
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uHoleColor;
      void main() {
        gl_FragColor = vec4(uHoleColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
    // must be in the same transparent render queue as the (transparent) grid
    // lines, otherwise the opaque queue draws first regardless of renderOrder
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = visibleNodePoints();

  nodeCoverMesh = new THREE.InstancedMesh(coverGeometry, coverMaterial, points.length);
  nodeCoverMesh.renderOrder = 6;
  instanceAtPoints(nodeCoverMesh, points);
  gridGroup.add(nodeCoverMesh);

  if (radii.length) {
    const ringGeometry = buildRingsGeometry(radii, params.lineThickness / 2);
    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uBaseColor: { value: new THREE.Color(params.nodeColor) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
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
      depthTest: false,
      depthWrite: false,
    });
    nodeRingMesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, points.length);
    nodeRingMesh.renderOrder = 7;
    instanceAtPoints(nodeRingMesh, points);
    gridGroup.add(nodeRingMesh);
  } else {
    nodeRingMesh = null;
  }
}

// ---------------------------------------------------------------
// Star mask: the 4-point star from svg-glass/assets/4star.svg acts as a
// fixed stencil floating in front of the grid. Its silhouette (baked once
// into an alpha-only texture) never moves; what's shown *through* it is a
// procedural gradient + sparkle field sampled with a mouse-driven offset,
// so panning the mouse pans the "background" visible through the hole.
// ---------------------------------------------------------------
const STAR_PATH =
  'M418.94 6.082C421.263 -2.02639 434.026 -2.02638 436.349 6.08202C454.591 69.7607 501.161 210.898 572.777 282.514C644.393 354.13 785.53 400.7 849.209 418.942C857.317 421.265 857.317 434.028 849.209 436.351C785.53 454.593 644.393 501.163 572.777 572.779C501.161 644.395 454.591 785.532 436.349 849.211C434.026 857.319 421.263 857.319 418.94 849.211C400.698 785.532 354.128 644.395 282.512 572.779C210.896 501.163 69.7587 454.593 6.08005 436.351C-2.02835 434.028 -2.02833 421.265 6.08007 418.942C69.7587 400.7 210.896 354.13 282.512 282.514C354.128 210.898 400.698 69.7606 418.94 6.082Z';
const STAR_BOX = 856;
const starHitPath = new Path2D(STAR_PATH);
const starHitCtx = document.createElement('canvas').getContext('2d');

// The three star instances (main + two smaller ones below), shared between
// the mesh builder and the node-visibility filter so they never drift apart.
function getStarInstances() {
  return [
    { x: 0, y: 0, size: params.starSize },
    { x: -params.starOffsetX, y: -params.starOffsetY, size: params.starSize2 },
    { x: params.starOffsetX, y: -params.starOffsetY, size: params.starSize2 },
  ];
}

// Hit-tests a point (relative to a star's center) against the exact star
// silhouette, reusing the same path used to bake the mask texture.
function pointInStar(dx, dy, size) {
  const u = dx / size + 0.5;
  const v = dy / size + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  return starHitCtx.isPointInPath(starHitPath, u * STAR_BOX, v * STAR_BOX);
}

function makeStarMaskTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.scale(size / STAR_BOX, size / STAR_BOX);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(STAR_PATH));

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const starMaskTexture = makeStarMaskTexture();

const starUniforms = {
  uMaskTex: { value: starMaskTexture },
  uPanOffset: { value: new THREE.Vector2(0, 0) },
  uCore: { value: new THREE.Color(params.starCore) },
  uColorA: { value: new THREE.Color(params.starColorA) },
  uColorB: { value: new THREE.Color(params.starColorB) },
};

const starMaterial = new THREE.ShaderMaterial({
  uniforms: starUniforms,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uMaskTex;
    uniform vec2 uPanOffset;
    uniform vec3 uCore;
    uniform vec3 uColorA;
    uniform vec3 uColorB;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      float maskAlpha = texture2D(uMaskTex, vUv).a;
      if (maskAlpha < 0.05) discard;

      vec2 uv = vUv + uPanOffset;
      float d = distance(uv, vec2(0.5));
      vec3 color = mix(uCore, uColorA, smoothstep(0.0, 0.45, d));
      color = mix(color, uColorB, smoothstep(0.45, 1.0, d));

      // procedural sparkle dust, panning along with the background
      vec2 grid = uv * 18.0;
      vec2 cellUv = fract(grid);
      float h = hash(floor(grid));
      float dist = distance(cellUv, vec2(0.5));
      float sparkle = step(0.92, h) * smoothstep(0.5, 0.0, dist) * (h - 0.92) * 12.0;
      color += vec3(sparkle);

      gl_FragColor = vec4(color, maskAlpha);
    }
  `,
});

let starMeshes = [];
function buildStar() {
  for (const mesh of starMeshes) {
    gridGroup.remove(mesh);
    mesh.geometry.dispose();
  }
  starMeshes = [];

  for (const { x, y, size } of getStarInstances()) {
    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, starMaterial);
    mesh.position.set(x, y, 5);
    mesh.userData.basePos = { x, y };
    mesh.visible = params.showStar;
    mesh.renderOrder = 10;
    gridGroup.add(mesh);
    starMeshes.push(mesh);
  }
}
buildStar();
buildNodes();

// ---------------------------------------------------------------
// Mouse tracking: unproject onto the z=0 plane
// ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(1e5, 1e5);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();
let pointerActive = false;

// smoothed toward the target each frame so the parallax drifts back to
// center (rather than snapping) once the pointer leaves the window
const smoothedPointer = new THREE.Vector2(0, 0);

window.addEventListener('pointermove', (e) => {
  pointerActive = true;
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('pointerleave', () => {
  pointerActive = false;
});

function updateMouseWorld() {
  raycaster.setFromCamera(pointerNDC, camera);
  if (pointerActive && raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    uniforms.uMouse.value.set(hitPoint.x, hitPoint.y);
  } else {
    uniforms.uMouse.value.set(1e5, 1e5);
  }

  const targetX = pointerActive ? THREE.MathUtils.clamp(pointerNDC.x, -1, 1) : 0;
  const targetY = pointerActive ? THREE.MathUtils.clamp(pointerNDC.y, -1, 1) : 0;
  smoothedPointer.x += (targetX - smoothedPointer.x) * params.parallaxSmoothing;
  smoothedPointer.y += (targetY - smoothedPointer.y) * params.parallaxSmoothing;

  starUniforms.uPanOffset.value.set(
    smoothedPointer.x * params.panStrength,
    smoothedPointer.y * params.panStrength
  );
  gridGroup.position.set(
    smoothedPointer.x * params.parallaxStrength,
    smoothedPointer.y * params.parallaxStrength,
    0
  );

  // small stars get their own parallax multiplier layered on top of the
  // shared gridGroup movement (main star just moves with the grid at 1x)
  const starMultipliers = [1, params.starParallaxMultiplier2, params.starParallaxMultiplier3];
  for (let i = 0; i < starMeshes.length; i++) {
    const mesh = starMeshes[i];
    const base = mesh.userData.basePos;
    const extra = (starMultipliers[i] ?? 1) - 1;
    mesh.position.x = base.x + smoothedPointer.x * params.parallaxStrength * extra;
    mesh.position.y = base.y + smoothedPointer.y * params.parallaxStrength * extra;
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
  if (nodeRingMesh) nodeRingMesh.material.uniforms.uBaseColor.value.set(v);
});
gui.add(params, 'nodeSize', 6, 80, 1).name('circle size').onFinishChange(buildNodes);
gui.add(params, 'ringCount', 0, 3, 1).name('num circles').onFinishChange(buildNodes);
gui.addColor(params, 'background').name('background').onChange((v) => {
  scene.background.set(v);
  nodeCoverMesh.material.uniforms.uHoleColor.value.set(v);
});
gui.add(params, 'cellSize', 60, 320, 5).name('grid spacing').onFinishChange(regenerate);
gui.add(params, 'cols', 2, 40, 1).name('columns').onFinishChange(regenerate);
gui.add(params, 'rows', 2, 40, 1).name('rows').onFinishChange(regenerate);
gui.add(params, 'cameraZ', 100, 3000, 10).name('camera zoom (z)').onChange((v) => {
  camera.position.z = v;
});
gui.add(params, 'lineThickness', 0.5, 12, 0.5).name('line thickness').onFinishChange(() => {
  buildLines();
  buildNodes();
});

const pathsFolder = gui.addFolder('paths');
pathsFolder.add(params, 'showHorizontal').name('horizontal').onChange((v) => (lineGroups.horizontal.visible = v));
pathsFolder.add(params, 'showVertical').name('vertical').onChange((v) => (lineGroups.vertical.visible = v));
pathsFolder.add(params, 'showDiagonalA').name('diagonal \\').onChange((v) => (lineGroups.diagonalA.visible = v));
pathsFolder.add(params, 'showDiagonalB').name('diagonal /').onChange((v) => (lineGroups.diagonalB.visible = v));

const starFolder = gui.addFolder('star mask');
function rebuildStar() {
  buildStar();
  buildNodes();
}
starFolder.add(params, 'showStar').name('visible').onChange((v) => {
  for (const mesh of starMeshes) mesh.visible = v;
  buildNodes();
});
starFolder.add(params, 'starSize', 100, 1000, 10).name('size').onFinishChange(rebuildStar);
starFolder.add(params, 'starSize2', 60, 800, 10).name('size (small)').onFinishChange(rebuildStar);
starFolder.add(params, 'starOffsetX', 0, 600, 5).name('offset x').onFinishChange(rebuildStar);
starFolder.add(params, 'starOffsetY', 0, 600, 5).name('offset y').onFinishChange(rebuildStar);
starFolder.addColor(params, 'starCore').name('core color').onChange((v) => starUniforms.uCore.value.set(v));
starFolder.addColor(params, 'starColorA').name('gradient A').onChange((v) => starUniforms.uColorA.value.set(v));
starFolder.addColor(params, 'starColorB').name('gradient B').onChange((v) => starUniforms.uColorB.value.set(v));
starFolder.add(params, 'panStrength', 0, 0.6, 0.01).name('pan strength');
starFolder.add(params, 'parallaxStrength', 0, 80, 1).name('grid parallax');
starFolder.add(params, 'parallaxSmoothing', 0.02, 1, 0.01).name('parallax smoothing');
starFolder.add(params, 'starParallaxMultiplier2', 0, 3, 0.05).name('parallax x (star 2)');
starFolder.add(params, 'starParallaxMultiplier3', 0, 3, 0.05).name('parallax x (star 3)');

// ---------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  updateMouseWorld();
  renderer.render(scene, camera);
}
animate();
