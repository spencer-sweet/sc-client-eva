/**
 * Host-page Theatre Studio visibility API.
 * Kept out of dev-helpers so Webflow can call it without the Dev UI bundle.
 *
 *   window.setTheatreJSUI('visible' | 'hidden')
 */
import type studio from '@theatre/studio';

const THEATRE_UI_MODES = ['hidden', 'visible'] as const;
export type TheatreUiMode = (typeof THEATRE_UI_MODES)[number];

type Studio = typeof studio;

let theatreUiMode: TheatreUiMode = 'visible';
let studioRef: Studio | null = null;
let studioReady = false;
let onApplied: (() => void) | null = null;

function applyTheatreUi(): void {
  if (!studioReady || !studioRef?.ui) return;
  if (theatreUiMode === 'hidden') studioRef.ui.hide();
  else studioRef.ui.restore();
  onApplied?.();
}

window.setTheatreJSUI = function setTheatreJSUI(mode: TheatreUiMode): void {
  if (!THEATRE_UI_MODES.includes(mode)) {
    console.warn(
      'setTheatreJSUI: "' + mode + '" must be one of ' + THEATRE_UI_MODES.join(', '),
    );
    return;
  }
  theatreUiMode = mode;
  applyTheatreUi();
};

/** Wire Studio once it has been initialized (or skipped). */
export function bindTheatreStudio(studioInstance: Studio, ready: boolean): void {
  studioRef = studioInstance;
  studioReady = !!ready;
  applyTheatreUi();
}

/** Dev UI button can sync its label after hide/restore. */
export function onTheatreUiApplied(fn: () => void): void {
  onApplied = fn;
}

export function getTheatreUiMode(): TheatreUiMode {
  return theatreUiMode;
}
