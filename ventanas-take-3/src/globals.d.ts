/** Host-page contract installed by timeline-scroll.ts / theatre-ui-api.ts / dev-helpers. */
import type { ScrollSource } from './timeline-scroll';
import type { DevBarMode } from './dev-helpers';
import type { TheatreUiMode } from './theatre-ui-api';

declare global {
  interface Window {
    /** Set the timeline target T (0..1); smoothed by tickScroll. */
    seekTimelineTo(v: number): void;
    /** Jump the timeline to T (0..1) with no smoothing. */
    setTimelineTo(v: number): void;
    setScrollSource(source: ScrollSource): void;
    setTheatreJSUI(mode: TheatreUiMode): void;
    /** Installed by the optional Dev UI only. */
    setDevBar?(mode: DevBarMode): void;
  }
}
