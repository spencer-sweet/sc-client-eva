/**
 * Production timeline / scroll driving (host-page contract).
 * Kept out of dev-helpers so Webflow embeds still work when that import is removed.
 *
 *   'page'     -- this document's own scroll
 *   'sections' -- [data-fs-card] runway (local Vite index.html)
 *   'external' -- host page calls window.seekTimelineTo(t) (e.g. Lenis)
 *
 * window.setScrollSource() also accepts convenience aliases (SCROLL_SOURCE_ALIASES)
 * that set a canonical source above plus a damping override in one call, e.g.
 * 'sections-webflow' for a Webflow host whose Lenis instance already smooths native
 * window scroll: it's 'sections' (real layout + the data-fs-duration ruler) with
 * damping forced to 0 so this module doesn't smooth on top of Lenis's own smoothing.
 */
import type * as THREE from 'three';
import type { ISheet } from '@theatre/core';

export const SCROLL_SOURCES = ['page', 'sections', 'external'] as const;
export type ScrollSource = (typeof SCROLL_SOURCES)[number];

const isScrollSource = (v: unknown): v is ScrollSource =>
  SCROLL_SOURCES.includes(v as ScrollSource);

const SCROLL_SOURCE_ALIASES = {
  'sections-webflow': { source: 'sections', damping: 0 },
} as const satisfies Record<string, { source: ScrollSource; damping: number }>;

export type ScrollSourceAlias = keyof typeof SCROLL_SOURCE_ALIASES;
export type ScrollSourceInput = ScrollSource | ScrollSourceAlias;

const DEFAULT_DAMPING = 4.5;

/** Resolve a canonical source or convenience alias into {source, damping}, or null if unknown. */
function resolveScrollSource(v: unknown): { source: ScrollSource; damping: number } | null {
  if (isScrollSource(v)) return { source: v, damping: DEFAULT_DAMPING };
  if (typeof v === 'string' && v in SCROLL_SOURCE_ALIASES) {
    return SCROLL_SOURCE_ALIASES[v as ScrollSourceAlias];
  }
  return null;
}

/**
 * sheet.sequence has no public .length in this @theatre/core — hardcode like timeline-04.
 * This is the Theatre sequence's total length in seconds (sequence.position is a plain
 * seconds value). Each [data-fs-card]'s `data-fs-duration` is real seconds on this same
 * timeline (see measureSegments() below), so SEQUENCE_LENGTH must be >= the sum of every
 * card's duration — set it generously above what's currently authored (e.g. 200) so
 * adding/lengthening cards later doesn't require bumping it every time. If the card total
 * ever exceeds SEQUENCE_LENGTH, the tail compresses and keyframes get reached early; if
 * it's under, scrolling through the last card simply stops short of the sequence's end
 * (harmless — Theatre holds the last keyframe value).
 */
export const SEQUENCE_LENGTH = 200;

export const scrollState: {
  source: ScrollSource;
  /** What the host / dropdown last asked for (may be an alias). */
  input: ScrollSourceInput;
  damping: number;
  syncTheatreToScroll: boolean;
} = {
  source: 'sections',
  input: 'sections',
  damping: DEFAULT_DAMPING,
  syncTheatreToScroll: true,
};

{
  const qp = new URLSearchParams(location.search).get('scrollSource');
  const resolved = resolveScrollSource(qp);
  if (resolved && qp) {
    scrollState.input = qp as ScrollSourceInput;
    scrollState.source = resolved.source;
    scrollState.damping = resolved.damping;
  }
}

let currentGlobalT = 0;
let targetGlobalT = 0;
let scrollTicking = false;
let clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const cardProgress = new Map<string, number>();

/**
 * Single knob for "where in the viewport does a card cross the ruler":
 * 0 = card top hits viewport top, 1 = card top hits viewport bottom.
 * 0 is the right default for a full-bleed, edge-to-edge deck like this one --
 * each card's tEnd is the next card's tStart with no gap, so segments tile
 * perfectly against a "top hits top" line. (Note: the per-card fill %
 * readout below uses its own fixed bottom-anchored formula -- that's an
 * unrelated, purely cosmetic metric and doesn't need to match ANCHOR.)
 */
const ANCHOR = 0;

/** Default seconds a card claims on the Theatre sequence if it has no `data-fs-duration`. */
const DEFAULT_CARD_DURATION_S = 10;

/**
 * Piecewise map: document pixels -> Theatre sequence seconds -> normalized T (0..1).
 * Each [data-fs-card] is a segment whose pixel extent comes from layout (so 100svh
 * sections that grow on mobile/tablet just get scrubbed slower) and whose timeline
 * share comes from `data-fs-duration` -- real seconds on the Theatre sequence, same
 * units as SEQUENCE_LENGTH, default 10. `data-fs-duration="15"` means that card scrubs
 * through 15 seconds of the sequence, however tall it renders. This decouples "how tall"
 * a section is from "how much of the sequence" it drives. Segments are cached and only
 * rebuilt on load/resize, since pxStart/pxEnd are already scroll-position-independent
 * (rect.top + scrollY == document-space top).
 */
type Segment = { id: string; pxStart: number; pxEnd: number; tStart: number; tEnd: number };
let segments: Segment[] = [];

function cardDuration(el: HTMLElement): number {
  const n = parseFloat(el.dataset.fsDuration ?? '');
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CARD_DURATION_S;
}

function measureSegments(): void {
  const cards = cardEls();
  let t = 0;
  segments = cards.map((el) => {
    const rect = el.getBoundingClientRect();
    const pxStart = rect.top + scrollY;
    const pxEnd = pxStart + rect.height;
    const tStart = t;
    t += cardDuration(el);
    return { id: el.dataset.fsCard!, pxStart, pxEnd, tStart, tEnd: t };
  });
}

/** Look up normalized T (0..1) for the current scroll position against the cached segment ruler. */
function segmentsT(): number {
  if (segments.length === 0) return 0;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const s = scrollY + innerHeight * ANCHOR;
  if (s <= first.pxStart) return 0;
  if (s >= last.pxEnd) return clamp01(last.tEnd / SEQUENCE_LENGTH);
  for (const seg of segments) {
    if (s >= seg.pxStart && s < seg.pxEnd) {
      const local = seg.pxEnd > seg.pxStart ? clamp01((s - seg.pxStart) / (seg.pxEnd - seg.pxStart)) : 0;
      const seconds = seg.tStart + (seg.tEnd - seg.tStart) * local;
      return clamp01(seconds / SEQUENCE_LENGTH);
    }
  }
  return clamp01(last.tEnd / SEQUENCE_LENGTH);
}

// Ignore mobile URL-bar show/hide (viewport height changes without a real layout change);
// only rebuild the ruler on a real resize.
let lastResizeW = -1;
let lastResizeH = -1;
function onResize(): void {
  const dh = Math.abs(innerHeight - lastResizeH);
  if (innerWidth === lastResizeW && dh < 120) return;
  lastResizeW = innerWidth;
  lastResizeH = innerHeight;
  measureSegments();
}

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

/** Per-card fill % for the debug readout (discrete-ish, independent of the T ruler). */
function measureCardProgress(): void {
  const vh = innerHeight;
  for (const el of cardEls()) {
    const rect = el.getBoundingClientRect();
    const pct = clamp01((vh - rect.top) / rect.height) * 100;
    cardProgress.set(el.dataset.fsCard!, pct);
  }
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
    // external: the host owns T via seekTimelineTo — still measure cards for the readout
    measureCardProgress();
    if (scrollState.source === 'page') window.seekTimelineTo(readPageScroll());
    else if (scrollState.source === 'sections') window.seekTimelineTo(segmentsT());
    scrollUi.onMeasure?.(cardProgress, targetGlobalT);
  });
}

export function syncScrollListener(): void {
  removeEventListener('scroll', onScroll);
  removeEventListener('resize', onResize);
  // Always listen so the card % readout stays live in 'external' (Lenis / host scroll).
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  measureSegments();
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
    measureCardProgress();
    scrollUi.onMeasure?.(cardProgress, targetGlobalT);
  }
};

window.setTimelineTo = function setTimelineTo(v: number): void {
  window.seekTimelineTo(v);
  currentGlobalT = targetGlobalT;
};

window.setScrollSource = function setScrollSource(source: ScrollSourceInput): void {
  const resolved = resolveScrollSource(source);
  if (!resolved) {
    const allowed = [...SCROLL_SOURCES, ...Object.keys(SCROLL_SOURCE_ALIASES)].join(', ');
    console.warn('setScrollSource: "' + source + '" must be one of ' + allowed);
    return;
  }
  scrollState.input = source;
  scrollState.source = resolved.source;
  scrollState.damping = resolved.damping;
  syncScrollListener();
  scrollUi.onSourceChange?.();
};

window.setScrollDamping = function setScrollDamping(n: number): void {
  const v = Number(n);
  if (Number.isFinite(v) && v >= 0) scrollState.damping = v;
};

/** Optional: use THREE.MathUtils.clamp once the scene module has THREE. */
export function useThreeClamp(three: typeof THREE): void {
  if (three?.MathUtils?.clamp) {
    clamp01 = (n) => three.MathUtils.clamp(n, 0, 1);
  }
}

/** Advance scroll smoothing + optionally drive the Theatre playhead. Once per frame. */
export function tickScroll(dt: number, sheet: ISheet): void {
  // damping <= 0 means "snap straight to target" -- for when an external source (native
  // scroll driven by Lenis, or the 'external' source) already smooths, so this loop
  // doesn't smooth on top of that smoothing.
  if (scrollState.source === 'external' || scrollState.damping <= 0) {
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
