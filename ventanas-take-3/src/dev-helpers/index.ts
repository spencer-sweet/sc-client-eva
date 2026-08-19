/**
 * Optional Dev UI (bar, stats, help, timeline readout).
 *
 * Production scroll / Theatre host APIs live in ../timeline-scroll.ts and
 * ../theatre-ui-api.ts, so this whole module can be dropped for tree-shaking without
 * breaking a Webflow embed.
 */
import Stats from 'stats.js';
import css from './dev-helpers.css?inline';
import { BAR_HTML, HELP_HTML } from './markup';
import { ensureStarScene } from '../scene-shell';
import { cardEls, getTimelineT, scrollState, scrollUi } from '../timeline-scroll';
import { getTheatreUiMode, onTheatreUiApplied } from '../theatre-ui-api';

const STYLE_ID = 'ventanas-dev-helpers-style';

const DEV_BAR_MODES = ['hidden', 'minified', 'expanded'] as const;
export type DevBarMode = (typeof DEV_BAR_MODES)[number];

const byId = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/* ---------- mount ---------- */

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
}

function mountFragment(html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const node = tpl.content.firstElementChild;
  if (node) document.body.appendChild(node);
}

function ensureDiv(id: string, innerHTML = ''): HTMLElement {
  const existing = byId(id);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = id;
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

let stats: Stats | null = null;
let statsDom: HTMLElement | null = null;

function ensureStats(): void {
  if (stats) return;
  stats = new Stats();
  stats.showPanel(0); // 0: fps — click the panel to cycle to ms/mb
  // stats.js hardcodes top-left; nudge right so it doesn't sit under Theatre's outline
  stats.dom.style.cssText =
    'position:fixed;top:0;left:100px;cursor:pointer;opacity:0.9;z-index:10000;';
  document.body.appendChild(stats.dom);
  statsDom = stats.dom;
}

/** Call at the start of the render loop. */
export function statsBegin(): void {
  stats?.begin();
}

/** Call at the end of the render loop. */
export function statsEnd(): void {
  stats?.end();
}

/** Sync mount. No-ops (returns false) until document.body exists. */
export function ensureDevHelpers(): boolean {
  if (!document.body) return false;
  injectStyles();
  ensureStarScene();
  if (!byId('bar')) mountFragment(BAR_HTML);
  ensureDiv('help');
  ensureDiv('err', '<div></div>');
  ensureStats();
  return true;
}

/**
 * Wait until body exists, then mount the Dev UI. Required for Webflow embeds where the
 * module can evaluate before </body> (document.body is still null).
 */
let bootPromise: Promise<void> | null = null;

export function bootDevHelpers(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = new Promise<void>((resolve) => {
    const run = () => {
      ensureDevHelpers();
      resolve();
    };
    if (document.body) run();
    else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      // readyState is interactive/complete but body is somehow missing — retry next frame
      requestAnimationFrame(run);
    }
  });
  return bootPromise;
}

/* ---------- Timeline panel UI (binds to ../timeline-scroll.ts) ---------- */

let seekTDragging = false;

function syncSeekControls(t: number): void {
  if (seekTDragging) return;
  const v = Number(t).toFixed(3);
  for (const id of ['seekTSlider', 'seekTNumber']) {
    const el = byId<HTMLInputElement>(id);
    if (el && el.value !== v) el.value = v;
  }
}

function applyScrollSourceUi(): void {
  const select = byId<HTMLSelectElement>('scrollSourceSelect');
  if (select && select.value !== scrollState.source) select.value = scrollState.source;
}

function updateScrollReadout(progress: Map<string, number> | null, t?: number): void {
  applyScrollSourceUi();
  const target = t ?? getTimelineT().target;
  syncSeekControls(target);
  const readout = byId('scrollReadout');
  if (!readout) return;
  const pct = progress ?? new Map<string, number>();
  const rows = cardEls().map((el) => {
    const id = el.dataset.fsCard!;
    const sectionTitle = el.closest<HTMLElement>('[data-fs-section]')?.dataset.fsSectionTitle;
    const label = sectionTitle ? id + ' (' + sectionTitle + ')' : id;
    return (
      '<div class="readoutRow"><span>' +
      label +
      '</span><span class="readoutDots" aria-hidden="true"></span><b>' +
      (pct.get(id) ?? 0).toFixed(0) +
      '%</b></div>'
    );
  });
  readout.innerHTML =
    rows.join('') +
    '<div class="readoutMeta">source <b>' +
    scrollState.source +
    '</b><br>T <b>' +
    target.toFixed(3) +
    '</b></div>';
}

function wireTimelineScrollUi(): void {
  scrollUi.onTargetChange = (t) => syncSeekControls(t);
  scrollUi.onSourceChange = () => {
    applyScrollSourceUi();
    updateScrollReadout(null);
  };
  scrollUi.onMeasure = (progress, t) => updateScrollReadout(progress, t);
  scrollUi.isSeekDragging = () => seekTDragging;
}

function wireTimelinePanel(): void {
  const select = byId<HTMLSelectElement>('scrollSourceSelect');
  const syncCheckbox = byId<HTMLInputElement>('syncTheatreToScroll');
  const slider = byId<HTMLInputElement>('seekTSlider');
  const number = byId<HTMLInputElement>('seekTNumber');

  select?.addEventListener('change', () => {
    window.setScrollSource(select.value as typeof scrollState.source);
  });
  if (syncCheckbox) {
    syncCheckbox.checked = scrollState.syncTheatreToScroll;
    syncCheckbox.addEventListener('change', () => {
      scrollState.syncTheatreToScroll = syncCheckbox.checked;
    });
  }
  const onSeekTInput = (ev: Event) => {
    const src = ev.target as HTMLInputElement;
    const n = Number(src.value);
    if (!Number.isFinite(n)) return;
    seekTDragging = true;
    if (slider && src !== slider) slider.value = String(n);
    if (number && src !== number) number.value = String(n);
    window.setTimelineTo(n);
  };
  const endSeekTDrag = () => {
    seekTDragging = false;
    syncSeekControls(getTimelineT().target);
  };
  slider?.addEventListener('input', onSeekTInput);
  number?.addEventListener('input', onSeekTInput);
  slider?.addEventListener('pointerup', endSeekTDrag);
  slider?.addEventListener('change', endSeekTDrag);
  number?.addEventListener('change', endSeekTDrag);
  applyScrollSourceUi();
}

/* ---------- bar UI helpers (called from scene / Theatre callbacks) ---------- */

export function setParallaxButton(on: boolean): void {
  const btn = byId('paraxBtn');
  if (!btn) return;
  btn.textContent = 'Parallax: ' + (on ? 'ON' : 'OFF');
  btn.classList.toggle('on', on);
}

export function setVortexDrawButton(on: boolean): void {
  byId('vortexDrawBtn')?.classList.toggle('on', on);
}

/** Flash a temporary label on a button, then restore the original. */
function flashButton(btn: HTMLElement | null, text: string, ms: number): void {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, ms);
}

/* ---------- dev bar collapse + stats visibility ---------- */

const startExpanded = new URLSearchParams(location.search).has('dev');
let devBarMode: DevBarMode = startExpanded ? 'expanded' : 'minified';
let statsVisible = true; // Dev UI toggle; also forced off when setDevBar('hidden')

function applyStatsVisibility(): void {
  if (statsDom) statsDom.style.display = statsVisible && devBarMode !== 'hidden' ? '' : 'none';
  const btn = byId('statsToggleBtn');
  if (!btn) return;
  btn.textContent = 'Stats: ' + (statsVisible ? 'ON' : 'OFF');
  btn.classList.toggle('on', statsVisible);
}

function applyDevBar(): void {
  const bar = byId('bar');
  if (bar) bar.dataset.devBar = devBarMode;
  applyStatsVisibility();
  const toggle = byId('devBarToggleBtn');
  if (!toggle) return;
  if (devBarMode === 'expanded') {
    toggle.textContent = '▾ Dev UI';
    toggle.title = 'Collapse dev ui bar';
    toggle.classList.add('on');
  } else if (devBarMode === 'minified') {
    toggle.textContent = '▸ Dev UI';
    toggle.title = 'Expand dev ui bar';
    toggle.classList.remove('on');
  }
}

function wireDevBarCollapse(): void {
  window.setDevBar = function setDevBar(mode: DevBarMode): void {
    if (!DEV_BAR_MODES.includes(mode)) {
      console.warn('setDevBar: "' + mode + '" must be one of ' + DEV_BAR_MODES.join(', '));
      return;
    }
    devBarMode = mode;
    applyDevBar();
  };
  byId('devBarToggleBtn')?.addEventListener('click', () => {
    window.setDevBar?.(devBarMode === 'expanded' ? 'minified' : 'expanded');
  });
  applyDevBar();
}

/* ---------- wire all controls ---------- */

/** A camera keyframe: position + YXZ euler + fov. */
export interface CameraPose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fov: number;
}

/**
 * The Theatre prop pointers captureCameraPose writes to. Pointers are opaque proxies,
 * so `any` here is the honest type — studio.scrub()'s `set` validates them at runtime.
 */
type CameraObjProps = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  position: { x: any; y: any; z: any };
  rotation: { x: any; y: any; z: any };
  fov: any;
};

/** Everything the Dev UI needs from the scene. */
export interface DevHelpersApi {
  studio: typeof import('@theatre/studio').default;
  studioReady: boolean;
  /** Theatre project id, for createContentOfSaveFile. */
  projectId: string;
  /** Theatre "Camera" sheet object, for keyframe capture. */
  camObj: { props: CameraObjProps };
  /** The live camera pose, for "Capture camera → keyframe". */
  cameraPose(): CameraPose;
  /** Snap the camera back to its default and return that pose so it can be keyframed. */
  resetCamera(): CameraPose;
  isOrbiting(): boolean;
  /** Returns false when OrbitControls failed to construct (button then does nothing). */
  setOrbiting(on: boolean): boolean;
  activateStar(): void;
  resetStar(): void;
  loadGLBFromBuffer(buffer: ArrayBuffer): void;
  isParallaxEnabled(): boolean;
  setParallaxEnabled(on: boolean): void;
  isVortexDrawMode(): boolean;
  setVortexDrawMode(on: boolean): void;
  /** Which vortex (1 or 2) the path-editing controls target. */
  getActiveVortexId(): 1 | 2;
  setActiveVortexId(id: 1 | 2): void;
  getVortexPathTension(): number;
  setVortexPathTension(v: number): void;
  setVortexDrawDepth(v: number): void;
  rebuildVortexTube(): void;
  saveVortexPath(): void;
  snapshotVortexPaths(): ReturnType<typeof import('../scene/vortex').snapshotAllVortexPaths>;
  addVortexPoint(): void;
  removeVortexPoint(): void;
  resetVortexPath(): void;
  /** Live post-FX flags (EffectComposer + passes). */
  getPostFx(): {
    composerEnabled: boolean;
    renderPassEnabled: boolean;
    bloomEnabled: boolean;
    outputPassEnabled: boolean;
  };
  setPostFx(partial: {
    composerEnabled?: boolean;
    renderPassEnabled?: boolean;
    bloomEnabled?: boolean;
    outputPassEnabled?: boolean;
  }): void;
}

function timestampedStateFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `theatre-state_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

function wireTheatreUiButton(api: DevHelpersApi): void {
  const btn = byId<HTMLButtonElement>('theatreUiBtn');
  const sync = () => {
    if (!btn) return;
    if (!api.studioReady) {
      btn.textContent = 'Theatre UI: N/A';
      btn.disabled = true;
      btn.classList.remove('on');
      return;
    }
    const hidden = getTheatreUiMode() === 'hidden' || !!api.studio.ui.isHidden;
    btn.textContent = 'Theatre UI: ' + (hidden ? 'OFF' : 'ON');
    btn.classList.toggle('on', !hidden);
  };
  onTheatreUiApplied(sync);
  btn?.addEventListener('click', () => {
    if (!api.studioReady) return;
    window.setTheatreJSUI(getTheatreUiMode() === 'hidden' ? 'visible' : 'hidden');
  });
  sync();
}

function wireSaveTheatreState(api: DevHelpersApi): void {
  const btn = byId<HTMLButtonElement>('saveTheatreBtn');
  if (!btn) return;
  if (!api.studioReady) {
    btn.disabled = true;
    btn.title = 'Studio unavailable — remove ?minify to save Theatre state';
  }
  btn.addEventListener('click', () => {
    if (!api.studioReady || !api.studio?.createContentOfSaveFile) {
      console.warn('Save Theatre JSON: Studio is not available (try without ?minify).');
      return;
    }
    try {
      const json = api.studio.createContentOfSaveFile(api.projectId) as Record<string, unknown>;
      json.ventanasVortexPaths = api.snapshotVortexPaths();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = timestampedStateFilename();
      a.click();
      URL.revokeObjectURL(url);
      flashButton(btn, '✓ Saved', 1200);
    } catch (err) {
      console.error('Save Theatre JSON failed', err);
    }
  });
}

/** Write a camera pose into the Theatre "Camera" object as a keyframe. */
function captureCameraPose(api: DevHelpersApi, pose: CameraPose): void {
  if (!api.studioReady) return;
  const props = api.camObj.props;
  const scrub = api.studio.scrub();
  scrub.capture(({ set }) => {
    set(props.position.x, pose.position.x);
    set(props.position.y, pose.position.y);
    set(props.position.z, pose.position.z);
    set(props.rotation.x, pose.rotation.x);
    set(props.rotation.y, pose.rotation.y);
    set(props.rotation.z, pose.rotation.z);
    set(props.fov, pose.fov);
  });
  scrub.commit();
}

function wireCameraButtons(api: DevHelpersApi): void {
  const navBtn = byId('navBtn');
  navBtn?.addEventListener('click', () => {
    const next = !api.isOrbiting();
    if (!api.setOrbiting(next)) return; // OrbitControls unavailable
    navBtn.textContent = 'Orbit: ' + (next ? 'ON' : 'OFF');
    navBtn.classList.toggle('on', next);
  });

  byId('grabBtn')?.addEventListener('click', () => {
    captureCameraPose(api, api.cameraPose());
    flashButton(byId('grabBtn'), '✓ keyframe', 900);
  });

  byId('resetCamBtn')?.addEventListener('click', () => {
    captureCameraPose(api, api.resetCamera());
  });
}

function wireGlbPicker(api: DevHelpersApi): void {
  const input = byId<HTMLInputElement>('glbFileInput');
  byId('loadGlbBtn')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      api.loadGLBFromBuffer(reader.result as ArrayBuffer);
      flashButton(byId('loadGlbBtn'), '✓ ' + file.name, 1500);
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  });
}

function wireVortexButtons(api: DevHelpersApi): void {
  const tensionInput = byId<HTMLInputElement>('vortexTensionInput');
  const syncTension = () => {
    if (tensionInput) tensionInput.value = String(api.getVortexPathTension());
  };

  const target = byId<HTMLSelectElement>('vortexTargetSelect');
  if (target) {
    target.value = String(api.getActiveVortexId());
    target.addEventListener('change', () => {
      // Switching targets cancels an in-progress stroke so it can't land on the wrong path.
      if (api.isVortexDrawMode()) {
        api.setVortexDrawMode(false);
        setVortexDrawButton(false);
      }
      api.setActiveVortexId(target.value === '2' ? 2 : 1);
      syncTension();
    });
  }

  byId('vortexDrawBtn')?.addEventListener('click', () => {
    const on = !api.isVortexDrawMode();
    api.setVortexDrawMode(on);
    setVortexDrawButton(on);
  });
  tensionInput?.addEventListener('input', (ev) => {
    api.setVortexPathTension(parseFloat((ev.target as HTMLInputElement).value));
    api.rebuildVortexTube();
    api.saveVortexPath();
  });
  byId<HTMLInputElement>('vortexDepthInput')?.addEventListener('input', (ev) => {
    api.setVortexDrawDepth(parseFloat((ev.target as HTMLInputElement).value));
  });
  byId('vortexAddBtn')?.addEventListener('click', api.addVortexPoint);
  byId('vortexRemoveBtn')?.addEventListener('click', api.removeVortexPoint);
  byId('vortexResetPathBtn')?.addEventListener('click', () => {
    api.resetVortexPath();
    syncTension();
  });
  syncTension();
}

function wirePostFxPanel(api: DevHelpersApi): void {
  const fx = api.getPostFx();
  const bindings: Array<{
    id: string;
    key: keyof ReturnType<DevHelpersApi['getPostFx']>;
  }> = [
    { id: 'postFxComposer', key: 'composerEnabled' },
    { id: 'postFxRenderPass', key: 'renderPassEnabled' },
    { id: 'postFxBloom', key: 'bloomEnabled' },
    { id: 'postFxOutput', key: 'outputPassEnabled' },
  ];
  for (const { id, key } of bindings) {
    const el = byId<HTMLInputElement>(id);
    if (!el) continue;
    el.checked = fx[key];
    el.addEventListener('change', () => {
      api.setPostFx({ [key]: el.checked });
    });
  }
}

export function initDevHelpers(api: DevHelpersApi): void {
  ensureDevHelpers();
  wireDevBarCollapse();
  wireTimelineScrollUi();
  wireTimelinePanel();

  byId('actBtn')?.addEventListener('click', api.activateStar);
  byId('resetBtn')?.addEventListener('click', api.resetStar);
  wireTheatreUiButton(api);
  wireSaveTheatreState(api);
  wireCameraButtons(api);
  wireGlbPicker(api);
  wireVortexButtons(api);
  wirePostFxPanel(api);

  byId('paraxBtn')?.addEventListener('click', () => {
    const on = !api.isParallaxEnabled();
    api.setParallaxEnabled(on);
    setParallaxButton(on);
  });
  setParallaxButton(api.isParallaxEnabled());

  byId('statsToggleBtn')?.addEventListener('click', () => {
    statsVisible = !statsVisible;
    applyStatsVisibility();
  });
  applyStatsVisibility();

  const help = byId('help');
  byId('helpToggleBtn')?.addEventListener('click', () => help?.classList.toggle('on'));
  if (help) {
    help.innerHTML = api.studioReady ? HELP_HTML : '⚠ Timeline failed to start. ' + HELP_HTML;
  }

  updateScrollReadout(null);
}
