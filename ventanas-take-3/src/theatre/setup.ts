/**
 * Theatre bootstrap: Studio, then the project/sheet.
 *
 * Order matters, so nothing here happens at import time — `initTheatre()` is called
 * from main.ts once <body> exists (Studio mounts its UI there) and before any sheet
 * object is created.
 *
 * Studio is imported DYNAMICALLY. It is the editor, roughly the size of the rest of the
 * bundle put together, and a `?minify` embed never runs it — but a static import still
 * shipped, parsed and executed all of it on every phone that loaded the page.
 */
import { getProject, onChange, types as t } from '@theatre/core';
import type { ISheet, ISheetObject, UnknownShorthandCompoundProps } from '@theatre/core';
import theatreState from '../theatre-state/theatre-state_2026-08-22-0045_gus.json';
import { bindTheatreStudio } from '../theatre-ui-api';

export const PROJECT_ID = 'Ventanas 3D SVG';
/** Imported project JSON (keyframes + `ventanasVortexPaths` extras). */
export { theatreState };

/** Shorthand for a ranged number prop. */
export const num = (v: number, a: number, b: number) => t.number(v, { range: [a, b] });

/**
 * persistenceKey is versioned: Studio's localStorage state WINS over the `state` passed
 * to getProject, so a stale entry silently masks the committed JSON — edits to the file
 * then appear to do nothing. Bump this on every theatre-state_*.json swap; that retires
 * the old entry and lets the imported keyframes actually take effect.
 */
const PERSISTENCE_KEY = 'theatrejs:ventanas-take-3:en-v40';

let sheetRef: ISheet | null = null;
let playing = false;

export type Studio = typeof import('@theatre/studio').default;

export interface TheatreRuntime {
  /** False when Studio was skipped (?minify) or failed to initialize. */
  studioReady: boolean;
  sheet: ISheet;
  /** null when Studio was skipped — the chunk is then never fetched at all. */
  studio: Studio | null;
}

/**
 * Studio loads by default (same authoring workflow as the single-file HTML).
 * Pass ?minify to skip it (e.g. a Webflow embed).
 */
export async function initTheatre(): Promise<TheatreRuntime> {
  let studioReady = false;
  let studio: Studio | null = null;
  if (!new URLSearchParams(window.location.search).has('minify')) {
    try {
      studio = (await import('@theatre/studio')).default;
      studio.initialize({ usePersistentStorage: true, persistenceKey: PERSISTENCE_KEY });
      studioReady = true;
    } catch (err) {
      console.error(err);
    }
  }
  bindTheatreStudio(studio, studioReady);

  const { ventanasVortexPaths: _paths, ...projectState } = theatreState as {
    ventanasVortexPaths?: unknown;
  } & Record<string, unknown>;
  const project = getProject(PROJECT_ID, { state: projectState as never });
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

  return { studioReady, sheet, studio };
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
