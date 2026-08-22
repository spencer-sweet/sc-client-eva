/**
 * Drive Webflow page DOM from Theatre — only on the live EVA sites, never on
 * localhost / Cloudflare Pages standalone previews.
 */

const WEBFLOW_HOSTS = new Set([
  'eva-networks-staging.webflow.io',
  'evanetworks.com',
  'www.evanetworks.com',
]);

/** Hostname is fixed for the life of the page — no need to re-check per tick. */
const ON_WEBFLOW = WEBFLOW_HOSTS.has(location.hostname.toLowerCase());

export function isEvaWebflowHost(): boolean {
  return ON_WEBFLOW;
}

export interface WebflowLayerStyle {
  /**
   * 0..1. Applied as CSS `opacity` for most layers, but as the `--card-fade`
   * custom property for `fade: 'card'` layers — see FadeMode.
   */
  opacity: number;
  /** CSS `filter: blur(Xpx)`. Omitted for layers that leave filter alone (e.g. #how-*). */
  blur?: number;
  /** CSS `transform: scale()`. */
  scale: number;
  translate: {
    /** `'px'` or `'%'` for X/Y. Z is always px (percent is invalid on translateZ). */
    unit: 'px' | '%';
    x: number;
    y: number;
    z: number;
  };
}

/**
 * How a layer's 0..1 fade value reaches CSS.
 *
 * `'opacity'` is the obvious one and is right for ordinary copy.
 *
 * `'card'` writes a `--card-fade` custom property instead, and exists for one
 * specific reason: the #how-* cards contain an element with `backdrop-filter`
 * (`.how_card`, blurring the WebGL canvas behind it). Per CSS Filter Effects 2 an
 * element with `opacity < 1` becomes a **Backdrop Root**, and a backdrop-filter can
 * only sample pixels painted INSIDE its backdrop root. The canvas is `position: fixed`
 * in a completely different subtree, so the instant we wrote `opacity: 0.999` onto a
 * card wrapper there was nothing left behind the card to blur — the frosted panel went
 * flat. Worse, Chromium keeps the promoted layer after the tween lands back on exactly
 * 1, so the blur stayed dead until something forced a re-composite (resizing the
 * window was the usual accidental cure).
 *
 * Measured on the staging page, stripe contrast through a card over a striped
 * backdrop (~2 = blurred, >150 = blur dead):
 *
 *   wrapper opacity: 1                ->    2   blur alive
 *   wrapper opacity: 0.999            ->  166   blur dead
 *   card's own opacity: 0.99          ->  167   blur dead
 *   wrapper will-change: opacity      ->  166   blur dead (opacity still exactly 1)
 *   DESCENDANT opacity: 0.4           ->    2   blur alive
 *
 * A custom property promotes nothing, so the Webflow CSS fades the card by driving
 * alpha and blur radius off `--card-fade` instead:
 *
 *   .how_card {
 *     background-color: rgb(from var(--brand--blue-dark) r g b / calc(.4 * var(--card-fade, 1)));
 *     border-color:     rgb(from var(--brand--blue-light-stroke) r g b / var(--card-fade, 1));
 *     backdrop-filter:  blur(calc(.5rem * var(--card-fade, 1)));
 *   }
 *   .how_card > * { opacity: var(--card-fade, 1); }
 *
 * The children keep plain `opacity` — a descendant cannot form a backdrop root for
 * its own ancestor, so that is safe and covers the texts and the image in one rule.
 */
type FadeMode = 'opacity' | 'card';

/**
 * At or below this the layer is invisible, so it is taken out of painting entirely
 * with `visibility: hidden`.
 *
 * This is not just tidiness. `backdrop-filter: blur(0px)` is still a backdrop-filter:
 * the compositor allocates and resolves a pass for it every frame, on an element
 * covering a good part of the screen, whether or not the result is visible. Five cards
 * spend most of the timeline faded out, so skipping them is most of their cost gone.
 * `visibility` (not `display`) so nothing reflows and Webflow's layout is untouched.
 */
const HIDE_AT = 0.001;

/** `undefined` = not looked up yet; then cached (including `null` if missing). */
const els = new Map<string, HTMLElement | null>();
const warned = new Set<string>();

/**
 * Resolve an id once. Safe after `whenBodyReady()` — the entry module is
 * deferred, so the Webflow page HTML is already parsed.
 */
function resolveEl(id: string): HTMLElement | null {
  if (els.has(id)) return els.get(id)!;
  const el = document.getElementById(id);
  els.set(id, el);
  if (!el && !warned.has(id)) {
    warned.add(id);
    console.warn('[webflow-dom] #' + id + ' not found on', location.hostname);
  }
  return el;
}

/**
 * Does the page's CSS actually respond to `--card-fade`?
 *
 * The custom property only does anything if the Webflow stylesheet has been updated to
 * consume it. If it has not, writing `--card-fade` would silently do nothing and the
 * cards would sit at full strength for the whole timeline — a much louder bug than the
 * one it fixes. So probe once per card: drive the property to both ends and see whether
 * the card's computed backdrop-filter moves. Two forced style recalcs per card, once,
 * at first apply.
 */
function detectCardFadeSupport(wrap: HTMLElement): boolean {
  const card = wrap.querySelector<HTMLElement>('.how_card');
  if (!card) return false;
  const had = wrap.style.getPropertyValue('--card-fade');
  wrap.style.setProperty('--card-fade', '0');
  const at0 = getComputedStyle(card).backdropFilter;
  wrap.style.setProperty('--card-fade', '1');
  const at1 = getComputedStyle(card).backdropFilter;
  if (had) wrap.style.setProperty('--card-fade', had);
  else wrap.style.removeProperty('--card-fade');
  return at0 !== at1;
}

/** Resolved once per id on first apply: 'card' downgrades to 'opacity' if unsupported. */
const fadeModes = new Map<string, FadeMode>();

function resolveFadeMode(id: string, el: HTMLElement, wanted: FadeMode): FadeMode {
  const cached = fadeModes.get(id);
  if (cached) return cached;
  let mode = wanted;
  if (wanted === 'card' && !detectCardFadeSupport(el)) {
    mode = 'opacity';
    console.warn(
      '[webflow-dom] #' + id + ' has no --card-fade CSS; falling back to opacity. ' +
        'The card will animate but its backdrop-filter will drop out mid-fade — ' +
        'add the --card-fade rules to the Webflow stylesheet (see FadeMode).',
    );
  }
  fadeModes.set(id, mode);
  return mode;
}

/**
 * Last values actually WRITTEN to each element.
 *
 * Theatre fires onValuesChange on every sequence move, so without this a scrolled frame
 * rewrites five elements' styles whether or not anything changed. Style writes are not
 * free — and for these layers each one can retrigger compositing.
 */
interface LayerWrite {
  hidden: boolean;
  fade?: number;
  blur?: number;
  transform?: string;
}
const lastWrite = new Map<string, LayerWrite>();

function applyLayer(id: string, v: WebflowLayerStyle, wanted: FadeMode = 'opacity'): void {
  if (!ON_WEBFLOW) return;
  const el = resolveEl(id);
  if (!el) return;
  const mode = resolveFadeMode(id, el, wanted);
  const prev = lastWrite.get(id);

  const fade = Math.min(1, Math.max(0, v.opacity));
  const hidden = fade <= HIDE_AT;

  if (hidden) {
    if (!prev?.hidden) {
      el.style.visibility = 'hidden';
      // Forget everything else: nothing was written while hidden, so the next visible
      // frame has to write the whole style back rather than diff against stale values.
      lastWrite.set(id, { hidden: true });
    }
    return;
  }
  if (prev?.hidden !== false) el.style.visibility = '';

  if (prev?.fade !== fade) {
    if (mode === 'card') el.style.setProperty('--card-fade', String(fade));
    else el.style.opacity = String(fade);
  }

  if (v.blur !== undefined) {
    const px = Math.max(0, v.blur);
    if (prev?.blur !== px) el.style.filter = px > 0.001 ? `blur(${px}px)` : 'none';
  }

  const { unit, x, y, z } = v.translate;
  const u = unit === '%' ? '%' : 'px';
  const transform = `translate3d(${x}${u}, ${y}${u}, ${z}px) scale(${v.scale})`;
  if (prev?.transform !== transform) el.style.transform = transform;

  lastWrite.set(id, { hidden: false, fade, blur: v.blur === undefined ? undefined : Math.max(0, v.blur), transform });
}

/** Push fade + blur + transform onto Webflow layers when embedded on EVA. */
export function applyWebflowDom(v: {
  textInfra: WebflowLayerStyle;
  indicatorScroll: WebflowLayerStyle;
  how1: WebflowLayerStyle;
  how2: WebflowLayerStyle;
  how3: WebflowLayerStyle;
  how4: WebflowLayerStyle;
  how5: WebflowLayerStyle;
}): void {
  applyLayer('text-infra', v.textInfra);
  applyLayer('indicator-scroll', v.indicatorScroll);
  // 'card': these wrap a backdrop-filter panel, so their fade must not be `opacity`.
  applyLayer('how-1', v.how1, 'card');
  applyLayer('how-2', v.how2, 'card');
  applyLayer('how-3', v.how3, 'card');
  applyLayer('how-4', v.how4, 'card');
  applyLayer('how-5', v.how5, 'card');
}
