/**
 * Theatre bootstrap: Studio, then the project/sheet.
 *
 * Order matters, so nothing here happens at import time — `initTheatre()` is called
 * from main.ts once <body> exists (Studio mounts its UI there) and before any sheet
 * object is created.
 */
import { getProject, onChange, types as t } from '@theatre/core';
import type { ISheet, ISheetObject, UnknownShorthandCompoundProps } from '@theatre/core';
import studio from '@theatre/studio';
import theatreState from '../theatre-state/theatre-state_2026-08-13-1728.json';
import { bindTheatreStudio } from '../theatre-ui-api';

export const PROJECT_ID = 'Ventanas 3D SVG';

/** Shorthand for a ranged number prop. */
export const num = (v: number, a: number, b: number) => t.number(v, { range: [a, b] });

/**
 * persistenceKey is versioned: bumping it discards Studio's old localStorage (which
 * still held Spanish object names like Escena / Estrella (GLB) after the English
 * rename) so the committed theatre-state_*.json keyframes actually win instead of
 * flashing once and then being overwritten by empty defaults.
 */
const PERSISTENCE_KEY = 'theatrejs:ventanas-take-3:en-v5';

let sheetRef: ISheet | null = null;
let playing = false;

export interface TheatreRuntime {
  /** False when Studio was skipped (?minify) or failed to initialize. */
  studioReady: boolean;
  sheet: ISheet;
}

/**
 * Studio loads by default (same authoring workflow as the single-file HTML).
 * Pass ?minify to skip it (e.g. a Webflow embed).
 */
export function initTheatre(): TheatreRuntime {
  let studioReady = false;
  if (!new URLSearchParams(window.location.search).has('minify')) {
    try {
      studio.initialize({ usePersistentStorage: true, persistenceKey: PERSISTENCE_KEY });
      studioReady = true;
    } catch (err) {
      console.error(err);
    }
  }
  bindTheatreStudio(studio, studioReady);

  const project = getProject(PROJECT_ID, { state: theatreState as never });
  // One sheet for everything, so there is a single timeline.
  const sheet = project.sheet('Scene');
  sheetRef = sheet;

  try {
    onChange(sheet.sequence.pointer.playing, (p) => {
      playing = !!p;
    });
  } catch (err) {
    console.error('sequence.playing', err);
  }

  return { studioReady, sheet };
}

/** Markers/gizmo hide while the timeline is playing. */
export function isSequencePlaying(): boolean {
  return playing;
}

/**
 * Create a sheet object, logging (instead of throwing) if Theatre rejects it.
 * A throw here used to abort the whole module before the render loop started — the
 * real cause of an all-black screen.
 */
export function safeObject<Props extends UnknownShorthandCompoundProps>(
  name: string,
  props: Props,
  bind: (obj: ISheetObject<Props>) => void,
): void {
  if (!sheetRef) throw new Error('theatre/setup: initTheatre() must run first');
  try {
    bind(sheetRef.object(name, props));
  } catch (err) {
    console.error(name, err);
  }
}
