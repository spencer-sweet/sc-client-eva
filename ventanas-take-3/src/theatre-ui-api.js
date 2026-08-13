/**
 * Host-page Theatre Studio visibility API.
 * Kept out of dev-helpers so Webflow can call it without the Dev UI bundle.
 *
 *   window.setTheatreJSUI('visible' | 'hidden')
 */

const THEATRE_UI_MODES = ['hidden', 'visible'];

let theatreUiMode = 'visible';
let theatreStudioRef = null;
let theatreStudioReady = false;
/** @type {(() => void) | null} */
let onApplied = null;

function applyTheatreUi() {
  if (!theatreStudioReady || !theatreStudioRef?.ui) return;
  if (theatreUiMode === 'hidden') theatreStudioRef.ui.hide();
  else theatreStudioRef.ui.restore();
  onApplied?.();
}

window.setTheatreJSUI = function setTheatreJSUI(mode) {
  if (!THEATRE_UI_MODES.includes(mode)) {
    console.warn('setTheatreJSUI: "' + mode + '" must be one of ' + THEATRE_UI_MODES.join(', '));
    return;
  }
  theatreUiMode = mode;
  applyTheatreUi();
};

/** Wire Studio once it has been initialized (or skipped). */
export function bindTheatreStudio(studio, ready) {
  theatreStudioRef = studio;
  theatreStudioReady = !!ready;
  applyTheatreUi();
}

/** Dev UI button can sync its label after hide/restore. */
export function onTheatreUiApplied(fn) {
  onApplied = fn;
}

export function getTheatreUiMode() {
  return theatreUiMode;
}
