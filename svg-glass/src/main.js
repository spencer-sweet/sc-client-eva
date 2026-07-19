import GUI from 'lil-gui';

// Liquid glass via SVG displacement mapping, after mks2508/liquid-svg-glass:
// a generated map (red gradient = X displacement, blue gradient = Y) feeds
// feDisplacementMap three times at offset scales — one per RGB channel — for
// chromatic aberration, then the channels are screen-blended back together.

const glassEl = document.getElementById('glass');
const host = document.getElementById('filter-host');

const params = {
  width: 320,
  height: 180,
  radius: 90,
  border: 0.07,   // edge falloff fraction of min dimension
  scale: 60,      // base displacement scale
  aberration: 12, // extra scale for red vs blue channel
  blur: 0.25,     // px, post-displacement smoothing
  lightness: 50,  // % of the neutral center gray
  alpha: 0.93,    // opacity of the neutral overlay (lower = wilder edges)
};

// The displacement map: red X-gradient + blue Y-gradient (screen-blended),
// with a neutral-gray rounded rect inset on top so the center of the lens
// stays undistorted and all the bending happens at the border ring.
function buildDisplacementMap({ width, height, radius, border, lightness, alpha }) {
  const inset = border * Math.min(width, height);
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
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
  <rect width="${width}" height="${height}" fill="black"/>
  <rect width="${width}" height="${height}" rx="${radius}" fill="url(#red)"/>
  <rect width="${width}" height="${height}" rx="${radius}" fill="url(#blue)" style="mix-blend-mode:difference"/>
  <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}"
        rx="${Math.max(0, radius - inset)}"
        fill="hsl(0 0% ${lightness}% / ${alpha})" style="filter:blur(${inset / 2}px)"/>
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
    <filter id="glass-filter" x="-20%" y="-20%" width="140%" height="140%"
            color-interpolation-filters="sRGB">
      <feImage href="${map}" x="0" y="0" width="${p.width}" height="${p.height}"
               preserveAspectRatio="none" result="map"/>
      ${chan('red',   p.scale + p.aberration, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      ${chan('green', p.scale,                '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      ${chan('blue',  p.scale - p.aberration, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
      <feBlend in="red" in2="green" mode="screen" result="rg"/>
      <feBlend in="rg" in2="blue" mode="screen" result="rgb"/>
      <feGaussianBlur in="rgb" stdDeviation="${p.blur}"/>
    </filter>
  </defs>`;

  document.documentElement.style.setProperty('--glass-w', `${p.width}px`);
  document.documentElement.style.setProperty('--glass-h', `${p.height}px`);
  document.documentElement.style.setProperty('--glass-r', `${p.radius}px`);
  // re-trigger backdrop-filter so Chromium picks up the rebuilt filter
  glassEl.style.backdropFilter = 'none';
  requestAnimationFrame(() => { glassEl.style.backdropFilter = ''; });
}

buildFilter(params);

// ---- dragging ----
let drag = null;
glassEl.addEventListener('pointerdown', (e) => {
  const rect = glassEl.getBoundingClientRect();
  drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  glassEl.setPointerCapture(e.pointerId);
});
glassEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  glassEl.style.left = `${e.clientX - drag.dx}px`;
  glassEl.style.top = `${e.clientY - drag.dy}px`;
});
glassEl.addEventListener('pointerup', () => { drag = null; });

// ---- controls ----
const gui = new GUI({ title: 'glass' });
const rebuild = () => buildFilter(params);
gui.add(params, 'width', 120, 640, 1).onChange(rebuild);
gui.add(params, 'height', 80, 480, 1).onChange(rebuild);
gui.add(params, 'radius', 0, 240, 1).onChange(rebuild);
gui.add(params, 'border', 0, 0.3, 0.005).onChange(rebuild);
gui.add(params, 'scale', 0, 200, 1).onChange(rebuild);
gui.add(params, 'aberration', 0, 60, 1).onChange(rebuild);
gui.add(params, 'blur', 0, 4, 0.05).onChange(rebuild);
gui.add(params, 'lightness', 0, 100, 1).onChange(rebuild);
gui.add(params, 'alpha', 0, 1, 0.01).onChange(rebuild);
