/**
 * Production timeline / scroll driving (host-page contract).
 * Kept out of dev-helpers so Webflow embeds still work when that import is removed.
 *
 *   'page'     -- this document's own scroll
 *   'sections' -- [data-fs-card] runway (local Vite index.html)
 *   'external' -- host page calls window.seekTimelineTo(t) (e.g. Lenis)
 */

export const SCROLL_SOURCES = ['page', 'sections', 'external'];

/** sheet.sequence has no public .length in this @theatre/core — hardcode like timeline-04. */
export const SEQUENCE_LENGTH = 14.44;

export const scrollState = {
  source: 'sections',
  damping: 4.5,
  syncTheatreToScroll: true,
};

{
  const qp = new URLSearchParams(location.search).get('scrollSource');
  if (SCROLL_SOURCES.includes(qp)) scrollState.source = qp;
}

let currentGlobalT = 0;
let targetGlobalT = 0;
let scrollTicking = false;
let clamp01 = (n) => Math.min(1, Math.max(0, n));

const cardProgress = new Map();

/** Optional Dev UI hooks (no-ops when helpers are not loaded). */
export const scrollUi = {
  /** @type {((t: number) => void) | null} */
  onTargetChange: null,
  /** @type {(() => void) | null} */
  onSourceChange: null,
  /** @type {((progress: Map<string, number>, t: number) => void) | null} */
  onMeasure: null,
  /** @type {(() => boolean) | null} when true, skip pushing T into seek controls (dragging) */
  isSeekDragging: null,
};

function cardEls() {
  return Array.from(document.querySelectorAll('[data-fs-card]'));
}

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

function notifyTarget() {
  if (scrollUi.isSeekDragging?.()) return;
  scrollUi.onTargetChange?.(targetGlobalT);
}

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const cardsT = measureCards();
    if (scrollState.source === 'page') window.seekTimelineTo(readPageScroll());
    else if (scrollState.source === 'sections') window.seekTimelineTo(cardsT);
    scrollUi.onMeasure?.(cardProgress, targetGlobalT);
  });
}

export function syncScrollListener() {
  removeEventListener('scroll', onScroll);
  if (scrollState.source !== 'external') {
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  } else {
    scrollUi.onSourceChange?.();
    notifyTarget();
  }
}

/**
 * Host-page contract (same as timeline-03). Installed at module load so a
 * Webflow/Lenis script can call these as soon as the bundle evaluates.
 */
window.seekTimelineTo = function seekTimelineTo(v) {
  const n = Number(v);
  if (Number.isFinite(n)) targetGlobalT = clamp01(n);
  notifyTarget();
};

window.setTimelineTo = function setTimelineTo(v) {
  window.seekTimelineTo(v);
  currentGlobalT = targetGlobalT;
};

window.setScrollSource = function setScrollSource(source) {
  if (!SCROLL_SOURCES.includes(source)) {
    console.warn('setScrollSource: "' + source + '" must be one of ' + SCROLL_SOURCES.join(', '));
    return;
  }
  scrollState.source = source;
  syncScrollListener();
  scrollUi.onSourceChange?.();
};

/** Optional: use THREE.MathUtils.clamp once the scene module has THREE. */
export function useThreeClamp(THREE) {
  if (THREE?.MathUtils?.clamp) {
    clamp01 = (n) => THREE.MathUtils.clamp(n, 0, 1);
  }
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

export function getTimelineT() {
  return { current: currentGlobalT, target: targetGlobalT };
}

/** Start internal scroll listeners (call once after DOM is ready). */
export function startTimelineScroll() {
  syncScrollListener();
}
