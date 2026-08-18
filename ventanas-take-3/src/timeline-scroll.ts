/**
 * Production timeline / scroll driving (host-page contract).
 * Kept out of dev-helpers so Webflow embeds still work when that import is removed.
 *
 *   'page'     -- this document's own scroll
 *   'sections' -- [data-fs-card] runway (local Vite index.html)
 *   'external' -- host page calls window.seekTimelineTo(t) (e.g. Lenis)
 */
import type * as THREE from 'three';
import type { ISheet } from '@theatre/core';

export const SCROLL_SOURCES = ['page', 'sections', 'external'] as const;
export type ScrollSource = (typeof SCROLL_SOURCES)[number];

const isScrollSource = (v: unknown): v is ScrollSource =>
  SCROLL_SOURCES.includes(v as ScrollSource);

/**
 * sheet.sequence has no public .length in this @theatre/core — hardcode like timeline-04.
 * Must match `sequence.length` in the imported theatre-state_*.json: scroll T maps onto
 * 0..SEQUENCE_LENGTH, so a value below the authored length reaches every keyframe early
 * (this drifted to 14.44 against a 19.14 sequence, shifting the whole timeline later in T).
 */
export const SEQUENCE_LENGTH = 19.14;

export const scrollState: { source: ScrollSource; damping: number; syncTheatreToScroll: boolean } = {
  source: 'sections',
  damping: 4.5,
  syncTheatreToScroll: true,
};

{
  const qp = new URLSearchParams(location.search).get('scrollSource');
  if (isScrollSource(qp)) scrollState.source = qp;
}

let currentGlobalT = 0;
let targetGlobalT = 0;
let scrollTicking = false;
let clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const cardProgress = new Map<string, number>();

/** Optional Dev UI hooks (no-ops when helpers are not loaded). */
export const scrollUi: {
  onTargetChange: ((t: number) => void) | null;
  onSourceChange: (() => void) | null;
  onMeasure: ((progress: Map<string, number>, t: number) => void) | null;
  /** When it returns true, skip pushing T into the seek controls (the user is dragging). */
  isSeekDragging: (() => boolean) | null;
} = {
  onTargetChange: null,
  onSourceChange: null,
  onMeasure: null,
  isSeekDragging: null,
};

export function cardEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-fs-card]'));
}

function readPageScroll(): number {
  const maxScroll = document.documentElement.scrollHeight - innerHeight;
  return maxScroll > 0 ? clamp01(scrollY / maxScroll) : 0;
}

function measureCards(): number {
  const cards = cardEls();
  const vh = innerHeight;
  let firstTopAbs: number | null = null;
  let lastBottomAbs = 0;
  for (let i = 0; i < cards.length; i++) {
    const el = cards[i];
    const rect = el.getBoundingClientRect();
    const pct = clamp01((vh - rect.top) / rect.height) * 100;
    cardProgress.set(el.dataset.fsCard!, pct);
    if (i === 0) firstTopAbs = rect.top + scrollY;
    if (i === cards.length - 1) lastBottomAbs = rect.bottom + scrollY;
  }
  if (firstTopAbs === null) return 0;
  const startScroll = firstTopAbs - vh;
  const span = lastBottomAbs - vh - startScroll;
  return span > 0 ? clamp01((scrollY - startScroll) / span) : 0;
}

function notifyTarget(): void {
  if (scrollUi.isSeekDragging?.()) return;
  scrollUi.onTargetChange?.(targetGlobalT);
}

function onScroll(): void {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const cardsT = measureCards();
    // external: the host owns T via seekTimelineTo — still measure cards for the readout
    if (scrollState.source === 'page') window.seekTimelineTo(readPageScroll());
    else if (scrollState.source === 'sections') window.seekTimelineTo(cardsT);
    scrollUi.onMeasure?.(cardProgress, targetGlobalT);
  });
}

export function syncScrollListener(): void {
  removeEventListener('scroll', onScroll);
  // Always listen so the card % readout stays live in 'external' (Lenis / host scroll).
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (scrollState.source === 'external') {
    scrollUi.onSourceChange?.();
    notifyTarget();
  }
}

/**
 * Host-page contract (same as timeline-03). Installed at module load so a
 * Webflow/Lenis script can call these as soon as the bundle evaluates.
 */
window.seekTimelineTo = function seekTimelineTo(v: number): void {
  const n = Number(v);
  if (Number.isFinite(n)) targetGlobalT = clamp01(n);
  notifyTarget();
  // Keep the card % readout current when Lenis drives T without native scroll events
  if (scrollState.source === 'external') {
    measureCards();
    scrollUi.onMeasure?.(cardProgress, targetGlobalT);
  }
};

window.setTimelineTo = function setTimelineTo(v: number): void {
  window.seekTimelineTo(v);
  currentGlobalT = targetGlobalT;
};

window.setScrollSource = function setScrollSource(source: ScrollSource): void {
  if (!isScrollSource(source)) {
    console.warn('setScrollSource: "' + source + '" must be one of ' + SCROLL_SOURCES.join(', '));
    return;
  }
  scrollState.source = source;
  syncScrollListener();
  scrollUi.onSourceChange?.();
};

/** Optional: use THREE.MathUtils.clamp once the scene module has THREE. */
export function useThreeClamp(three: typeof THREE): void {
  if (three?.MathUtils?.clamp) {
    clamp01 = (n) => three.MathUtils.clamp(n, 0, 1);
  }
}

/** Advance scroll smoothing + optionally drive the Theatre playhead. Once per frame. */
export function tickScroll(dt: number, sheet: ISheet): void {
  if (scrollState.source === 'external') {
    currentGlobalT = targetGlobalT;
  } else {
    currentGlobalT += (targetGlobalT - currentGlobalT) * Math.min(1, dt * scrollState.damping);
  }
  if (scrollState.syncTheatreToScroll && sheet?.sequence) {
    sheet.sequence.position = currentGlobalT * SEQUENCE_LENGTH;
  }
}

export function getTimelineT(): { current: number; target: number } {
  return { current: currentGlobalT, target: targetGlobalT };
}

/** Start internal scroll listeners (call once after DOM is ready). */
export function startTimelineScroll(): void {
  syncScrollListener();
}
