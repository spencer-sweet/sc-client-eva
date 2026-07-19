import GUI from 'lil-gui';

// Liquid glass via SVG displacement mapping, after mks2508/liquid-svg-glass:
// a generated map (red gradient = X displacement, blue gradient = Y) feeds
// feDisplacementMap three times at offset scales — one per RGB channel — for
// chromatic aberration, then the channels are screen-blended back together.

const lensEl = document.getElementById('lens');
const glassEl = document.getElementById('glass');
const shardsSvg = document.getElementById('shards');
const host = document.getElementById('filter-host');

// 4-point star from assets/4star.svg (300x300 viewBox)
const STAR_PATH = 'M27.2555 144.929C97.7334 125.636 133.353 74.8901 147.143 25.3415C148.369 20.9359 156.731 20.8833 157.943 25.2926C171.829 75.7823 203.553 121.719 282.494 145.74C286.593 146.987 286.466 153.459 282.317 154.528C211.084 172.889 171.558 211.468 156.318 278.512C155.332 282.847 148.138 283.122 146.851 278.867C126.945 213.048 87.9643 172.678 27.2627 156.133C22.8036 154.918 22.7978 146.15 27.2555 144.929Z';
const STAR_BOX = 300;

const params = {
  size: 500,      // rendered star size in px
  core: 0.96,     // scale of the neutral (undistorted) inner star
  scale: 60,      // base displacement scale
  aberration: 12, // extra scale for red vs blue channel
  blur: 0.25,     // px, post-displacement smoothing
  lightness: 50,  // % of the neutral center gray
  alpha: 0.93,    // opacity of the neutral overlay (lower = wilder edges)
  background: '#0a0f2c',
  text: '#ffffff',
  fill: '#ffffff',
  fillOpacity: 0.07,
  stroke: '#e6e6e6',
  strokeWidth: 1.25,
  strokeOpacity: 0.2,
  broken: 0,
};

// The displacement map: the star filled with a red X-gradient + blue
// Y-gradient (difference-blended), with a shrunken neutral-gray star on top
// so the lens center stays undistorted and the bending happens at the points.
function buildDisplacementMap({ size, core, lightness, alpha }) {
  const k = size / STAR_BOX;
  const edge = Math.min(((1 - core) * size) / 8, size * 0.04);
  const svg = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#0000"/>
      <stop offset="100%" stop-color="red"/>
    </linearGradient>
    <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0000"/>
      <stop offset="100%" stop-color="blue"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="black"/>
  <g transform="scale(${k})">
    <path d="${STAR_PATH}" fill="url(#red)"/>
    <path d="${STAR_PATH}" fill="url(#blue)" style="mix-blend-mode:difference"/>
  </g>
  <g transform="translate(${size / 2} ${size / 2}) scale(${k * core}) translate(${-STAR_BOX / 2} ${-STAR_BOX / 2})">
    <path d="${STAR_PATH}" fill="hsl(0 0% ${lightness}% / ${alpha})" style="filter:blur(${edge}px)"/>
  </g>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildFilter(p) {
  const map = buildDisplacementMap(p);
  const chan = (name, scale, matrixRow) => `
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}"
        xChannelSelector="R" yChannelSelector="B" result="disp-${name}"/>
    <feColorMatrix in="disp-${name}" type="matrix" values="${matrixRow}" result="${name}"/>`;

  host.innerHTML = `
  <defs>
    <clipPath id="glass-clip" clipPathUnits="objectBoundingBox">
      <path d="${STAR_PATH}" transform="scale(${1 / STAR_BOX})"/>
    </clipPath>
    <filter id="glass-filter" x="-20%" y="-20%" width="140%" height="140%"
            color-interpolation-filters="sRGB">
      <feImage href="${map}" x="0" y="0" width="${p.size}" height="${p.size}"
               preserveAspectRatio="none" result="map"/>
      ${chan('red',   p.scale + p.aberration, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      ${chan('green', p.scale,                '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      ${chan('blue',  p.scale - p.aberration, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
      <feBlend in="red" in2="green" mode="screen" result="rg"/>
      <feBlend in="rg" in2="blue" mode="screen" result="rgb"/>
      <feGaussianBlur in="rgb" stdDeviation="${p.blur}"/>
    </filter>
  </defs>`;

  document.documentElement.style.setProperty('--glass-w', `${p.size}px`);
  document.documentElement.style.setProperty('--glass-h', `${p.size}px`);
  // re-trigger backdrop-filter so Chromium picks up the rebuilt filter
  const filtered = [glassEl, ...document.querySelectorAll('.shard:not(.shard-simple)')];
  filtered.forEach((el) => { el.style.backdropFilter = 'none'; });
  requestAnimationFrame(() => { filtered.forEach((el) => { el.style.backdropFilter = ''; }); });
}

buildFilter(params);

// ---- shattering ----
// 50 predetermined shards: seeded PRNG so every reload breaks identically.
const SHARD_COUNT = 18;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateShards() {
  const r = mulberry32(42);
  const star = new Path2D(STAR_PATH);
  const ctx = document.createElement('canvas').getContext('2d');
  const shards = [];
  while (shards.length < SHARD_COUNT) {
    // rejection-sample shard centers so they originate inside the star
    const cx = r() * STAR_BOX;
    const cy = r() * STAR_BOX;
    if (!ctx.isPointInPath(star, cx, cy)) continue;
    // mostly small sharp slivers, a few big plates
    const big = r() >= 0.8;
    const s = big ? 22 + r() * 26 : 7 + r() * 16;
    const n = 3 + Math.floor(r() * 3);
    const angles = Array.from({ length: n }, () => r() * Math.PI * 2).sort((a, b) => a - b);
    const pts = angles.map((a) => {
      const rad = s * (0.45 + r() * 0.75);
      return [+(cx + Math.cos(a) * rad).toFixed(2), +(cy + Math.sin(a) * rad).toFixed(2)];
    });
    // scatter radially away from the star center, with jitter
    const ang = Math.atan2(cy - STAR_BOX / 2, cx - STAR_BOX / 2) + (r() - 0.5) * 1.2;
    shards.push({
      d: `M${pts.map((p) => p.join(',')).join('L')}Z`,
      pts, cx, cy, big,
      tx: Math.cos(ang) * (80 + r() * 260),
      ty: Math.sin(ang) * (80 + r() * 260),
      rot: (r() - 0.5) * 240,
    });
  }
  return shards;
}

const shards = generateShards();

// stroke outlines (SVG, scales with the lens)
const shardEls = shards.map((s) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.setAttribute('d', s.d);
  el.setAttribute('vector-effect', 'non-scaling-stroke');
  shardsSvg.appendChild(el);
  return el;
});

// refracting bodies (divs clipped to the shard polygon, same backdrop-filter
// as the intact star — each shows its local piece of the star's refraction)
const shardDivs = shards.map((s) => {
  const el = document.createElement('div');
  // only the big plates pay for the full displacement filter; small slivers
  // get a plain blur, which reads the same at their size
  el.className = s.big ? 'shard' : 'shard shard-simple';
  el.style.clipPath = `polygon(${s.pts
    .map(([x, y]) => `${((x / STAR_BOX) * 100).toFixed(2)}% ${((y / STAR_BOX) * 100).toFixed(2)}%`)
    .join(',')})`;
  el.style.transformOrigin = `${(s.cx / STAR_BOX) * 100}% ${(s.cy / STAR_BOX) * 100}%`;
  lensEl.appendChild(el);
  return el;
});

// the intact star swaps out for the shards inside the first FLIP of the slider
const FLIP = 0.05;
const easeOut = (t) => 1 - (1 - t) ** 3;
function applyBroken() {
  const b = params.broken;
  const t = Math.min(1, b / FLIP); // crossfade progress
  const e = easeOut(b);            // scatter progress
  const k = params.size / STAR_BOX; // star units -> px

  glassEl.style.opacity = String(1 - t);
  glassEl.style.visibility = t >= 1 ? 'hidden' : '';
  shardsSvg.style.display = b > 0 ? '' : 'none';

  shards.forEach((s, i) => {
    const div = shardDivs[i];
    div.style.display = b > 0 ? '' : 'none';
    div.style.opacity = String(t);
    div.style.transform = `translate(${s.tx * e * k}px, ${s.ty * e * k}px) rotate(${s.rot * e}deg)`;
    const path = shardEls[i];
    path.setAttribute('transform', `translate(${s.tx * e} ${s.ty * e}) rotate(${s.rot * e} ${s.cx} ${s.cy})`);
    path.setAttribute('opacity', t);
  });
}

// ---- dragging ----
let drag = null;
lensEl.addEventListener('pointerdown', (e) => {
  const rect = lensEl.getBoundingClientRect();
  drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  lensEl.setPointerCapture(e.pointerId);
});
lensEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  lensEl.style.left = `${e.clientX - drag.dx}px`;
  lensEl.style.top = `${e.clientY - drag.dy}px`;
});
lensEl.addEventListener('pointerup', () => { drag = null; });

// ---- controls ----
const gui = new GUI({ title: 'glass', width: 380 });
const rebuild = () => { buildFilter(params); applyBroken(); };
gui.add(params, 'size', 120, 640, 1).onChange(rebuild);
gui.add(params, 'core', 0, 1, 0.01).onChange(rebuild);
gui.add(params, 'scale', 0, 200, 1).onChange(rebuild);
gui.add(params, 'aberration', 0, 60, 1).onChange(rebuild);
gui.add(params, 'blur', 0, 4, 0.05).onChange(rebuild);
gui.add(params, 'lightness', 0, 100, 1).onChange(rebuild);
gui.add(params, 'alpha', 0, 1, 0.01).onChange(rebuild);
const brokenCtrl = gui.add(params, 'broken', 0, 0.25, 0.01).onChange(applyBroken);
brokenCtrl.domElement.classList.add('wide-slider');

const applyColors = () => {
  document.documentElement.style.setProperty('--bg', params.background);
  document.documentElement.style.setProperty('--fg', params.text);
  glassEl.style.background = hexToRgba(params.fill, params.fillOpacity);
  const strokePath = document.getElementById('glass-stroke-path');
  strokePath.setAttribute('d', STAR_PATH);
  strokePath.setAttribute('stroke', params.stroke);
  // stroke sits centered on the clip edge, so double it to keep the visible
  // (inner) half at the requested width
  strokePath.setAttribute('stroke-width', params.strokeWidth * 2);
  strokePath.setAttribute('stroke-opacity', params.strokeOpacity);
  shardsSvg.setAttribute('fill', 'none');
  shardsSvg.setAttribute('stroke', params.stroke);
  shardsSvg.setAttribute('stroke-width', params.strokeWidth);
  shardsSvg.setAttribute('stroke-opacity', params.strokeOpacity);
  shardDivs.forEach((el) => { el.style.background = hexToRgba(params.fill, params.fillOpacity); });
};
gui.addColor(params, 'background').onChange(applyColors);
gui.addColor(params, 'text').onChange(applyColors);
gui.addColor(params, 'fill').onChange(applyColors);
gui.add(params, 'fillOpacity', 0, 1, 0.01).onChange(applyColors);
gui.addColor(params, 'stroke').onChange(applyColors);
gui.add(params, 'strokeWidth', 0, 5, 0.25).onChange(applyColors);
gui.add(params, 'strokeOpacity', 0, 1, 0.01).onChange(applyColors);
applyColors();
applyBroken();

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
