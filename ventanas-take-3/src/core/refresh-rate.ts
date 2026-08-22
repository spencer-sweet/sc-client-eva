/**
 * The display's refresh period, measured once while the page is still cheap to draw.
 *
 * The adaptive-resolution governor (core/stage.ts) needs to know what "keeping up"
 * even means on this device, and that CANNOT be recovered from the steady state: a
 * scene delivering 33.3ms frames looks identical whether the panel refreshes at 30Hz
 * (perfect) or at 60Hz (missing every other vsync). The two want opposite responses,
 * so the measurement has to happen before the scene is heavy enough to miss a vsync —
 * i.e. during boot, while the GLB and Theatre are still loading and rAF is idle.
 *
 * This matters on phones specifically: iOS Low Power Mode caps Safari to 30fps, as do
 * several Android battery savers. Judged against a hard-coded 60Hz budget every one of
 * those frames reads as "too slow", and the governor throws away resolution it can
 * never win back.
 */

/** Assumed when the probe has not finished (or produced nothing plausible). */
const FALLBACK_MS = 1000 / 60;
/** Guard rails: below is a timer glitch, above is a stall, neither is a refresh rate. */
const MIN_PLAUSIBLE_MS = 6;
const MAX_PLAUSIBLE_MS = 40;

let measuredMs = 0;
let probing = false;

/**
 * `?fps=30` / `?refresh=33.3` pretend the panel runs at that rate, the same way
 * `?quality=low` pretends the device is a phone (core/quality.ts). A 30Hz panel is the
 * case this whole module exists for and it is not something a desktop display can be
 * talked into, so forcing it is the only way to see the governor's behaviour there.
 *
 * Two spellings of one number: `fps` is the rate (30, 60, 120), `refresh` is the period
 * between frames in milliseconds (33.3, 16.7, 8.3). `fps` wins if both are given.
 * Anything outside the plausible range is ignored, so a typo falls back to measuring.
 */
function forcedPeriodMs(): number {
  const params = new URLSearchParams(location.search);

  const fps = Number(params.get('fps'));
  if (fps > 0) {
    const period = 1000 / fps;
    if (period >= MIN_PLAUSIBLE_MS && period <= MAX_PLAUSIBLE_MS) return period;
  }

  const refresh = Number(params.get('refresh'));
  if (refresh >= MIN_PLAUSIBLE_MS && refresh <= MAX_PLAUSIBLE_MS) return refresh;

  return 0;
}

/**
 * Sample rAF intervals for `frames` frames and keep the result in module state.
 *
 * Safe to call more than once; only the first call does any work. Start it as early
 * in boot as possible — every frame it spends next to a fully built scene is a frame
 * that can be stretched by the scene rather than by the display.
 */
export function probeRefreshRate(frames = 24): void {
  if (probing || measuredMs > 0) return;

  const forced = forcedPeriodMs();
  if (forced > 0) {
    measuredMs = forced;
    return;
  }

  probing = true;

  const intervals: number[] = [];
  let prev = 0;

  const step = (t: number): void => {
    if (prev > 0) intervals.push(t - prev);
    prev = t;
    if (intervals.length < frames) {
      requestAnimationFrame(step);
      return;
    }
    intervals.sort((a, b) => a - b);
    // Median of the FASTEST half. A plain minimum is one timer glitch away from
    // claiming a 240Hz panel; a plain median is dragged up by any frame that had to
    // wait on a load. The fast half is all vsync-limited frames, and its median is
    // the period itself.
    const fastHalf = intervals.slice(0, Math.max(1, intervals.length >> 1));
    const candidate = fastHalf[fastHalf.length >> 1];
    if (candidate >= MIN_PLAUSIBLE_MS && candidate <= MAX_PLAUSIBLE_MS) {
      measuredMs = candidate;
    }
    probing = false;
  };

  requestAnimationFrame(step);
}

/** The measured refresh period in ms, or a 60Hz assumption until the probe lands. */
export function refreshPeriodMs(): number {
  return measuredMs > 0 ? measuredMs : FALLBACK_MS;
}
