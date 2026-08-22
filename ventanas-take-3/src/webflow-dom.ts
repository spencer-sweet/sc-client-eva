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

function applyLayer(id: string, v: WebflowLayerStyle): void {
  if (!ON_WEBFLOW) return;
  const el = resolveEl(id);
  if (!el) return;
  el.style.opacity = String(v.opacity);
  if (v.blur !== undefined) {
    const px = Math.max(0, v.blur);
    el.style.filter = px > 0.001 ? `blur(${px}px)` : 'none';
  }
  const { unit, x, y, z } = v.translate;
  const u = unit === '%' ? '%' : 'px';
  el.style.transform = `translate3d(${x}${u}, ${y}${u}, ${z}px) scale(${v.scale})`;
}

/** Push opacity + blur + transform onto Webflow layers when embedded on EVA. */
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
  applyLayer('how-1', v.how1);
  applyLayer('how-2', v.how2);
  applyLayer('how-3', v.how3);
  applyLayer('how-4', v.how4);
  applyLayer('how-5', v.how5);
}
