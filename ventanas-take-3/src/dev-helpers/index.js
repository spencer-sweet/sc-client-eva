/**
 * Dev UI mount + wiring + scroll/timeline controls.
 * Works in local Vite HTML and when only the built main.js is loaded from CDN.
 */
import css from './dev-helpers.css?inline';

const STYLE_ID = 'ventanas-dev-helpers-style';
const DEV_BAR_MODES = ['hidden', 'minified', 'expanded'];
const SCROLL_SOURCES = ['page', 'sections', 'external'];
/** sheet.sequence has no public .length in this @theatre/core — hardcode like timeline-04. */
export const SEQUENCE_LENGTH = 14.44;

const HELP_HTML =
  '<b>Center window</b>: nearly invisible at rest (clear for the GLB), but reacts to the alarm. Normal glass on the side windows. <b>Trigger:</b> ✦ Activate star (live preview). ' +
  '<b>Star (GLB) → shatterProgress</b>: scrub the exact explosion frame from the timeline. <b>Load another GLB…</b>: pick any .glb from disk to try it in the same spot. ' +
  '<b>Parallax</b>: button or the timeline boolean; moves wall+glass+neon, star, and background at different depths with the mouse. ' +
  '<b>Masks</b>: <b>Center Window</b> = its own offset/scale; <b>Side Windows</b> = one control for both. ' +
  '<b>Star background → swingRange</b>: limits how far the stars rotate (they used to spin without a cap). ' +
  '<b>Wall & Grid Fade → blackout</b>: fades ONLY the wall and grid to black, leaving glass, neon, and the GLB visible. The grid already clips itself around whatever window positions you set. ' +
  '<b>Orbit</b> = free-look; <b>Capture</b> = camera keyframe; <b>Reset camera</b> if it drifted too far/near.';

const BAR_HTML = /*html*/ `
<div id="bar" data-dev-bar="expanded">
  <button id="devBarToggleBtn" type="button" title="Collapse / expand dev bar">▾ Dev UI</button>
  <div id="barControls">
    <div id="barTools">
      <button id="actBtn" class="act">✦ Activate star</button>
      <button id="theatreUiBtn">Theatre UI: ON</button>
      <button id="saveTheatreBtn" type="button" title="Download current Theatre project state as JSON">Save Theatre JSON</button>
      <button id="resetBtn">Reset</button>
      <button id="navBtn">Orbit: OFF</button>
      <button id="grabBtn">Capture camera → keyframe</button>
      <button id="resetCamBtn">Reset camera</button>
      <button id="loadGlbBtn">Load another GLB…</button>
      <input type="file" id="glbFileInput" accept=".glb" style="display:none" />
      <button id="paraxBtn">Parallax: OFF</button>
      <button id="vortexDrawBtn">✎ Draw</button>
      <button id="vortexAddBtn">+ Point</button>
      <button id="vortexRemoveBtn">− Point (selected)</button>
      <label class="barField"
        >Tension <input type="range" id="vortexTensionInput" min="0" max="1" step="0.05" value="0.5"
      /></label>
      <label class="barField"
        >Draw depth <input type="range" id="vortexDepthInput" min="20" max="200" value="110"
      /></label>
      <button id="vortexResetPathBtn">Reset path</button>
      <button id="helpToggleBtn">?</button>
    </div>

    <div id="timelinePanel">
      <div class="timelineTitle">Timeline</div>
      <label class="barField barFieldCol"
        >Scroll Source
        <select id="scrollSourceSelect">
          <option value="page">page</option>
          <option value="sections" selected>sections</option>
          <option value="external">external</option>
        </select>
      </label>
      <label class="barField barCheck"
        ><input type="checkbox" id="syncTheatreToScroll" checked /> Sync Theatre to Scroll
      </label>
      <label class="barField barFieldCol"
        >Seek T (manual)
        <span class="seekRow">
          <input type="range" id="seekTSlider" min="0" max="1" step="0.001" value="0" />
          <input type="number" id="seekTNumber" min="0" max="1" step="0.001" value="0" />
        </span>
      </label>
      <div id="scrollReadout"></div>
    </div>
  </div>
</div>
`.trim();

const $ = (id) => document.getElementById(id);

/* ---------- mount ---------- */

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureSceneCanvas() {
  let canvas = $('scene');
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.id = 'scene';
  document.body.prepend(canvas);
  return canvas;
}

function mountFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const node = tpl.content.firstElementChild;
  document.body.appendChild(node);
  return node;
}

function ensureHelp() {
  let help = $('help');
  if (help) return help;
  help = document.createElement('div');
  help.id = 'help';
  document.body.appendChild(help);
  return help;
}

function ensureErr() {
  let err = $('err');
  if (err) return err;
  err = document.createElement('div');
  err.id = 'err';
  err.innerHTML = '<div></div>';
  document.body.appendChild(err);
  return err;
}

export function ensureDevHelpers() {
  injectStyles();
  ensureSceneCanvas();
  if (!$('bar')) mountFragment(BAR_HTML);
  ensureHelp();
  ensureErr();
}

ensureDevHelpers();

/* ---------- scroll / timeline state ---------- */

export const scrollState = { source: 'sections', damping: 4.5, syncTheatreToScroll: true };

{
  const qp = new URLSearchParams(location.search).get('scrollSource');
  if (SCROLL_SOURCES.includes(qp)) scrollState.source = qp;
}

let currentGlobalT = 0;
let targetGlobalT = 0;
let seekTDragging = false;
let scrollTicking = false;
let clamp01 = (n) => Math.min(1, Math.max(0, n));

const cardEls = () => Array.from(document.querySelectorAll('[data-fs-card]'));
const cardProgress = new Map();

function readPageScroll() {
  const maxScroll = document.documentElement.scrollHeight - innerHeight;
  return maxScroll > 0 ? clamp01(scrollY / maxScroll) : 0;
}

function measureCards() {
  const cards = cardEls();
  const vh = innerHeight;
  let firstTopAbs = null;
  let lastBottomAbs = null;
  for (let i = 0; i < cards.length; i++) {
    const el = cards[i];
    const rect = el.getBoundingClientRect();
    const pct = clamp01((vh - rect.top) / rect.height) * 100;
    cardProgress.set(el.dataset.fsCard, pct);
    if (i === 0) firstTopAbs = rect.top + scrollY;
    if (i === cards.length - 1) lastBottomAbs = rect.bottom + scrollY;
  }
  if (firstTopAbs === null) return 0;
  const startScroll = firstTopAbs - vh;
  const endScroll = lastBottomAbs - vh;
  const span = endScroll - startScroll;
  return span > 0 ? clamp01((scrollY - startScroll) / span) : 0;
}

function syncSeekControls(t) {
  if (seekTDragging) return;
  const v = Number(t).toFixed(3);
  const seekTSlider = $('seekTSlider');
  const seekTNumber = $('seekTNumber');
  if (seekTSlider && seekTSlider.value !== v) seekTSlider.value = v;
  if (seekTNumber && seekTNumber.value !== v) seekTNumber.value = v;
}

function applyScrollSourceUi() {
  const scrollSourceSelect = $('scrollSourceSelect');
  const scrollReadoutEl = $('scrollReadout');
  if (scrollSourceSelect && scrollSourceSelect.value !== scrollState.source) {
    scrollSourceSelect.value = scrollState.source;
  }
  if (scrollReadoutEl) scrollReadoutEl.hidden = scrollState.source === 'external';
}

function updateScrollReadout() {
  applyScrollSourceUi();
  syncSeekControls(targetGlobalT);
  const scrollReadoutEl = $('scrollReadout');
  if (!scrollReadoutEl || scrollReadoutEl.hidden) return;
  const cards = cardEls();
  const rows = cards.map((el) => {
    const id = el.dataset.fsCard;
    return (
      '<div class="readoutRow"><span>' +
      id +
      '</span><span class="readoutDots" aria-hidden="true"></span><b>' +
      (cardProgress.get(id) ?? 0).toFixed(0) +
      '%</b></div>'
    );
  });
  scrollReadoutEl.innerHTML =
    rows.join('') +
    '<div class="readoutMeta">source <b>' +
    scrollState.source +
    '</b><br>T <b>' +
    targetGlobalT.toFixed(3) +
    '</b></div>';
}

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const cardsT = measureCards();
    if (scrollState.source === 'page') window.seekTimelineTo(readPageScroll());
    else if (scrollState.source === 'sections') window.seekTimelineTo(cardsT);
    updateScrollReadout();
  });
}

function syncScrollListener() {
  removeEventListener('scroll', onScroll);
  if (scrollState.source !== 'external') {
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  updateScrollReadout();
}

function installScrollWindowApi(THREE) {
  if (THREE?.MathUtils?.clamp) {
    clamp01 = (n) => THREE.MathUtils.clamp(n, 0, 1);
  }

  window.seekTimelineTo = function (v) {
    const n = Number(v);
    if (Number.isFinite(n)) targetGlobalT = clamp01(n);
    syncSeekControls(targetGlobalT);
  };
  window.setTimelineTo = function (v) {
    window.seekTimelineTo(v);
    currentGlobalT = targetGlobalT;
  };
  window.setScrollSource = function (source) {
    if (!SCROLL_SOURCES.includes(source)) {
      console.warn('setScrollSource: "' + source + '" must be one of ' + SCROLL_SOURCES.join(', '));
      return;
    }
    scrollState.source = source;
    syncScrollListener();
  };
}

/** Advance scroll smoothing + optionally drive Theatre playhead. Call once per frame. */
export function tickScroll(dt, sheet) {
  if (scrollState.source === 'external') {
    currentGlobalT = targetGlobalT;
  } else {
    currentGlobalT += (targetGlobalT - currentGlobalT) * Math.min(1, dt * scrollState.damping);
  }
  if (scrollState.syncTheatreToScroll && sheet?.sequence) {
    sheet.sequence.position = currentGlobalT * SEQUENCE_LENGTH;
  }
}

/* ---------- bar UI helpers (used from scene / Theatre callbacks) ---------- */

export function setParallaxButton(on) {
  const paraxBtn = $('paraxBtn');
  if (!paraxBtn) return;
  paraxBtn.textContent = 'Parallax: ' + (on ? 'ON' : 'OFF');
  paraxBtn.classList.toggle('on', on);
}

export function setVortexDrawButton(on) {
  const btn = $('vortexDrawBtn');
  if (!btn) return;
  btn.classList.toggle('on', !!on);
}

export function setVortexTensionInput(value) {
  const ti = $('vortexTensionInput');
  if (ti) ti.value = String(value);
}

/* ---------- wire all controls ---------- */

let devBarMode = 'expanded';

function applyDevBar() {
  const barEl = $('bar');
  const devBarToggleBtn = $('devBarToggleBtn');
  if (!barEl) return;
  barEl.dataset.devBar = devBarMode;
  if (!devBarToggleBtn) return;
  if (devBarMode === 'expanded') {
    devBarToggleBtn.textContent = '▾ Dev UI';
    devBarToggleBtn.title = 'Collapse dev ui bar';
    devBarToggleBtn.classList.add('on');
  } else if (devBarMode === 'minified') {
    devBarToggleBtn.textContent = '▸ Dev UI';
    devBarToggleBtn.title = 'Expand dev ui bar';
    devBarToggleBtn.classList.remove('on');
  }
}

function wireDevBarCollapse() {
  const devBarToggleBtn = $('devBarToggleBtn');
  window.setDevBar = function setDevBar(mode) {
    if (!DEV_BAR_MODES.includes(mode)) {
      console.warn('setDevBar: "' + mode + '" must be one of ' + DEV_BAR_MODES.join(', '));
      return;
    }
    devBarMode = mode;
    applyDevBar();
  };
  devBarToggleBtn?.addEventListener('click', () => {
    window.setDevBar(devBarMode === 'expanded' ? 'minified' : 'expanded');
  });
  applyDevBar();
}

function wireTimelinePanel() {
  const scrollSourceSelect = $('scrollSourceSelect');
  const syncTheatreCheckbox = $('syncTheatreToScroll');
  const seekTSlider = $('seekTSlider');
  const seekTNumber = $('seekTNumber');

  scrollSourceSelect?.addEventListener('change', () => {
    window.setScrollSource(scrollSourceSelect.value);
  });
  if (syncTheatreCheckbox) {
    syncTheatreCheckbox.checked = scrollState.syncTheatreToScroll;
    syncTheatreCheckbox.addEventListener('change', () => {
      scrollState.syncTheatreToScroll = syncTheatreCheckbox.checked;
    });
  }
  function onSeekTInput(ev) {
    const n = Number(ev.target.value);
    if (!Number.isFinite(n)) return;
    seekTDragging = true;
    if (seekTSlider && ev.target !== seekTSlider) seekTSlider.value = String(n);
    if (seekTNumber && ev.target !== seekTNumber) seekTNumber.value = String(n);
    window.setTimelineTo(n);
  }
  function endSeekTDrag() {
    seekTDragging = false;
    syncSeekControls(targetGlobalT);
  }
  seekTSlider?.addEventListener('input', onSeekTInput);
  seekTNumber?.addEventListener('input', onSeekTInput);
  seekTSlider?.addEventListener('pointerup', endSeekTDrag);
  seekTSlider?.addEventListener('change', endSeekTDrag);
  seekTNumber?.addEventListener('change', endSeekTDrag);
  applyScrollSourceUi();
}

/**
 * @param {object} api
 * @param {typeof import('three')} api.THREE
 * @param {import('@theatre/studio').default | null} api.studio
 * @param {boolean} api.studioReady
 * @param {string} api.projectId Theatre project id for createContentOfSaveFile
 * @param {import('three').PerspectiveCamera} api.camera
 * @param {any} api.camObj Theatre camera object
 * @param {import('three').OrbitControls | null} api.orbit
 * @param {() => boolean} api.isOrbiting
 * @param {(v: boolean) => void} api.setOrbiting
 * @param {() => void} api.activate
 * @param {() => void} api.resetStar
 * @param {(buffer: ArrayBuffer) => void} api.loadGLBFromBuffer
 * @param {() => boolean} api.isParallaxEnabled
 * @param {(v: boolean) => void} api.setParallaxEnabled
 * @param {() => boolean} api.isVortexDrawMode
 * @param {(on: boolean) => void} api.setVortexDrawMode
 * @param {(v: number) => void} api.setPathTension
 * @param {(v: number) => void} api.setVortexDrawDepth
 * @param {() => void} api.rebuildVortexTube
 * @param {() => void} api.saveVortexPath
 * @param {() => void} api.addVortexPoint
 * @param {() => void} api.removeVortexPoint
 * @param {() => void} api.resetVortexPath
 */
export function initDevHelpers(api) {
  ensureDevHelpers();
  installScrollWindowApi(api.THREE);
  wireDevBarCollapse();
  wireTimelinePanel();

  const {
    THREE,
    studio,
    studioReady,
    projectId,
    camera,
    camObj,
    orbit,
    isOrbiting,
    setOrbiting,
    activate,
    resetStar,
    loadGLBFromBuffer,
    isParallaxEnabled,
    setParallaxEnabled,
    isVortexDrawMode,
    setVortexDrawMode,
    setPathTension,
    setVortexDrawDepth,
    rebuildVortexTube,
    saveVortexPath,
    addVortexPoint,
    removeVortexPoint,
    resetVortexPath,
  } = api;

  $('actBtn')?.addEventListener('click', activate);
  $('resetBtn')?.addEventListener('click', resetStar);

  const theatreUiBtn = $('theatreUiBtn');
  function syncTheatreUiBtn() {
    if (!theatreUiBtn) return;
    if (!studioReady) {
      theatreUiBtn.textContent = 'Theatre UI: N/A';
      theatreUiBtn.disabled = true;
      theatreUiBtn.classList.remove('on');
      return;
    }
    const hidden = !!studio.ui.isHidden;
    theatreUiBtn.textContent = 'Theatre UI: ' + (hidden ? 'OFF' : 'ON');
    theatreUiBtn.classList.toggle('on', !hidden);
  }
  theatreUiBtn?.addEventListener('click', () => {
    if (!studioReady) return;
    if (studio.ui.isHidden) studio.ui.restore();
    else studio.ui.hide();
    syncTheatreUiBtn();
  });
  syncTheatreUiBtn();

  const saveTheatreBtn = $('saveTheatreBtn');
  function theatreStateFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
      'theatre-state_' +
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      '.json'
    );
  }
  function downloadTheatreState() {
    if (!studioReady || !studio?.createContentOfSaveFile) {
      console.warn('Save Theatre JSON: Studio is not available (try without ?minify).');
      return;
    }
    if (!projectId) {
      console.warn('Save Theatre JSON: missing projectId.');
      return;
    }
    try {
      const json = studio.createContentOfSaveFile(projectId);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = theatreStateFilename();
      a.click();
      URL.revokeObjectURL(url);
      if (saveTheatreBtn) {
        const o = saveTheatreBtn.textContent;
        saveTheatreBtn.textContent = '✓ Saved';
        setTimeout(() => (saveTheatreBtn.textContent = o), 1200);
      }
    } catch (err) {
      console.error('Save Theatre JSON failed', err);
    }
  }
  if (saveTheatreBtn) {
    if (!studioReady) {
      saveTheatreBtn.disabled = true;
      saveTheatreBtn.title = 'Studio unavailable — remove ?minify to save Theatre state';
    }
    saveTheatreBtn.addEventListener('click', downloadTheatreState);
  }

  const navBtn = $('navBtn');
  navBtn?.addEventListener('click', () => {
    if (!orbit) return;
    const next = !isOrbiting();
    setOrbiting(next);
    orbit.enabled = next;
    if (next) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      orbit.target.copy(camera.position).add(f.multiplyScalar(18));
      orbit.update();
    }
    navBtn.textContent = 'Orbit: ' + (next ? 'ON' : 'OFF');
    navBtn.classList.toggle('on', next);
  });

  $('grabBtn')?.addEventListener('click', () => {
    if (!studioReady) return;
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const scr = studio.scrub();
    scr.capture(({ set }) => {
      set(camObj.props.position.x, camera.position.x);
      set(camObj.props.position.y, camera.position.y);
      set(camObj.props.position.z, camera.position.z);
      set(camObj.props.rotation.x, e.x);
      set(camObj.props.rotation.y, e.y);
      set(camObj.props.rotation.z, e.z);
      set(camObj.props.fov, camera.fov);
    });
    scr.commit();
    const b = $('grabBtn');
    if (!b) return;
    const o = b.textContent;
    b.textContent = '✓ keyframe';
    setTimeout(() => (b.textContent = o), 900);
  });

  $('resetCamBtn')?.addEventListener('click', () => {
    camera.position.set(0, 0, 18);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.fov = 42;
    camera.updateProjectionMatrix();
    if (orbit) {
      orbit.target.set(0, -0.4, 0);
      orbit.update();
    }
    if (!studioReady) return;
    const scr = studio.scrub();
    scr.capture(({ set }) => {
      set(camObj.props.position.x, 0);
      set(camObj.props.position.y, 0);
      set(camObj.props.position.z, 18);
      set(camObj.props.rotation.x, 0);
      set(camObj.props.rotation.y, 0);
      set(camObj.props.rotation.z, 0);
      set(camObj.props.fov, 42);
    });
    scr.commit();
  });

  $('loadGlbBtn')?.addEventListener('click', () => $('glbFileInput')?.click());
  $('glbFileInput')?.addEventListener('change', (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadGLBFromBuffer(reader.result);
      const b = $('loadGlbBtn');
      if (!b) return;
      const o = b.textContent;
      b.textContent = '✓ ' + f.name;
      setTimeout(() => (b.textContent = o), 1500);
    };
    reader.readAsArrayBuffer(f);
    ev.target.value = '';
  });

  $('paraxBtn')?.addEventListener('click', () => {
    const on = !isParallaxEnabled();
    setParallaxEnabled(on);
    setParallaxButton(on);
  });
  setParallaxButton(isParallaxEnabled());

  $('vortexDrawBtn')?.addEventListener('click', () => {
    const on = !isVortexDrawMode();
    setVortexDrawMode(on);
    setVortexDrawButton(on);
  });
  $('vortexTensionInput')?.addEventListener('input', (ev) => {
    setPathTension(parseFloat(ev.target.value));
    rebuildVortexTube();
    saveVortexPath();
  });
  $('vortexDepthInput')?.addEventListener('input', (ev) => {
    setVortexDrawDepth(parseFloat(ev.target.value));
  });
  $('vortexAddBtn')?.addEventListener('click', addVortexPoint);
  $('vortexRemoveBtn')?.addEventListener('click', removeVortexPoint);
  $('vortexResetPathBtn')?.addEventListener('click', () => {
    resetVortexPath();
    setVortexTensionInput(0.5);
  });

  const help = $('help');
  $('helpToggleBtn')?.addEventListener('click', () => help?.classList.toggle('on'));
  if (help) {
    help.innerHTML = HELP_HTML;
    if (!studioReady) help.innerHTML = '⚠ Timeline failed to start. ' + help.innerHTML;
  }

  syncScrollListener();
}

export default ensureDevHelpers;
