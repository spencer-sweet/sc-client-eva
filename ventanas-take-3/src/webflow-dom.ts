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
  /** 0..1. Applied as CSS `opacity`, or as `--card-fade` for 'card' layers. */
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
 * How a layer's 0..1 fade reaches CSS.
 *
 * `'card'` writes a `--card-fade` custom property instead of `opacity`, because the
 * #how-* cards contain a `backdrop-filter` panel. Any `opacity < 1` on an ancestor
 * makes it a Backdrop Root, and a backdrop-filter can only sample inside its backdrop
 * root — the canvas is `position: fixed` elsewhere, so the frost went flat and stayed
 * flat (Chromium keeps the layer even back at opacity 1; a window resize was the cure).
 * Descendant opacity is fine, so the Webflow CSS fades children that way and drives the
 * panel's alpha + blur radius off the same property. See css_how-card-fade.html.
 */
type FadeMode = 'opacity' | 'card';

/**
 * Below this the layer is taken out of painting. `backdrop-filter: blur(0px)` is still
 * a full compositor pass on a large element, and the cards are faded out for most of
 * the timeline. `visibility`, not `display`, so nothing reflows.
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
 * Does the stylesheet actually consume `--card-fade`? If it does not, writing the
 * property would silently do nothing and the cards would never fade at all — worse than
 * the bug it fixes. Drive it to both ends once and see if the card's blur moves.
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

const fadeModes = new Map<string, FadeMode>();

function resolveFadeMode(id: string, el: HTMLElement, wanted: FadeMode): FadeMode {
  const cached = fadeModes.get(id);
  if (cached) return cached;
  let mode = wanted;
  if (wanted === 'card' && !detectCardFadeSupport(el)) {
    mode = 'opacity';
    console.warn(
      '[webflow-dom] #' + id + ' has no --card-fade CSS; using opacity, so its ' +
        'backdrop-filter will drop out mid-fade. Add css_how-card-fade.html in Webflow.',
    );
  }
  fadeModes.set(id, mode);
  return mode;
}

/**
 * Last values actually written. Theatre fires onValuesChange on every sequence move, so
 * without diffing a scrolled frame restyles five elements whether or not anything
 * changed — and each write can retrigger compositing.
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
  const blur = v.blur === undefined ? undefined : Math.max(0, v.blur);

  if (fade <= HIDE_AT) {
    if (!prev?.hidden) {
      el.style.visibility = 'hidden';
      // Nothing else is written while hidden, so drop the cache: the next visible frame
      // must rewrite in full rather than diff against values it never applied.
      lastWrite.set(id, { hidden: true });
    }
    return;
  }
  if (prev?.hidden !== false) el.style.visibility = '';

  if (prev?.fade !== fade) {
    if (mode === 'card') el.style.setProperty('--card-fade', String(fade));
    else el.style.opacity = String(fade);
  }
  if (blur !== undefined && prev?.blur !== blur) {
    el.style.filter = blur > 0.001 ? `blur(${blur}px)` : 'none';
  }

  const { unit, x, y, z } = v.translate;
  const u = unit === '%' ? '%' : 'px';
  const transform = `translate3d(${x}${u}, ${y}${u}, ${z}px) scale(${v.scale})`;
  if (prev?.transform !== transform) el.style.transform = transform;

  lastWrite.set(id, { hidden: false, fade, blur, transform });
}

/** Push fade + blur + transform onto Webflow layers when embedded on EVA. */
export function applyWebflowDom(v: {
  textInfra: WebflowLayerStyle;
  gridRisk: WebflowLayerStyle;
  howIntroTitle: WebflowLayerStyle;
  howIntroEyebrow: WebflowLayerStyle;
  indicatorScroll: WebflowLayerStyle;
  how1: WebflowLayerStyle;
  how2: WebflowLayerStyle;
  how3: WebflowLayerStyle;
  how4: WebflowLayerStyle;
  how5: WebflowLayerStyle;
}): void {
  applyLayer('text-infra', v.textInfra);
  applyLayer('grid_risk', v.gridRisk);
  applyLayer('how-intro-title', v.howIntroTitle);
  applyLayer('how-intro-eyebrow', v.howIntroEyebrow);
  applyLayer('indicator-scroll', v.indicatorScroll);
  // 'card': these wrap a backdrop-filter panel, so their fade must not be `opacity`.
  applyLayer('how-1', v.how1, 'card');
  applyLayer('how-2', v.how2, 'card');
  applyLayer('how-3', v.how3, 'card');
  applyLayer('how-4', v.how4, 'card');
  applyLayer('how-5', v.how5, 'card');
}
