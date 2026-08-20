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

export interface TextInfraStyle {
  opacity: number;
  /** CSS `filter: blur(Xpx)`. */
  blur: number;
  /** CSS `transform: scale()`. */
  scale: number;
  translate: { x: number; y: number; z: number };
}

/** `undefined` = not looked up yet; then cached (including `null` if missing). */
let textInfra: HTMLElement | null | undefined;
let warnedMissing = false;

/**
 * Resolve `#text-infra` once. Safe after `whenBodyReady()` — the entry module is
 * deferred, so the Webflow page HTML (including this id) is already parsed.
 */
function resolveTextInfra(): HTMLElement | null {
  if (textInfra !== undefined) return textInfra;
  textInfra = document.getElementById('text-infra');
  if (!textInfra && !warnedMissing) {
    warnedMissing = true;
    console.warn('[webflow-dom] #text-infra not found on', location.hostname);
  }
  return textInfra;
}

/** Push opacity + blur onto `#text-infra` when embedded on the EVA Webflow site. */
export function applyTextInfra(v: TextInfraStyle): void {
  if (!ON_WEBFLOW) return;
  const el = resolveTextInfra();
  if (!el) return;
  el.style.opacity = String(v.opacity);
  const px = Math.max(0, v.blur);
  el.style.filter = px > 0.001 ? `blur(${px}px)` : 'none';
  const { x, y, z } = v.translate;
  el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${v.scale})`;
}
