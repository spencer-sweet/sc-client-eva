/** Host-page contract installed by timeline-scroll.ts / theatre-ui-api.ts / dev-helpers. */
import type { ScrollSourceInput } from './timeline-scroll';
import type { DevBarMode } from './dev-helpers';
import type { TheatreUiMode } from './theatre-ui-api';

declare global {
  interface Window {
    /** Set the timeline target T (0..1); smoothed by tickScroll. */
    seekTimelineTo(v: number): void;
    /** Jump the timeline to T (0..1) with no smoothing. */
    setTimelineTo(v: number): void;
    /** Accepts a canonical ScrollSource or a convenience alias, e.g. 'sections-webflow'. */
    setScrollSource(source: ScrollSourceInput): void;
    /** 0 = snap straight to target every tick (use when an external source like Lenis already smooths). */
    setScrollDamping(n: number): void;
    setTheatreJSUI(mode: TheatreUiMode): void;
    /** Installed by the optional Dev UI only. */
    setDevBar?(mode: DevBarMode): void;
  }
}
