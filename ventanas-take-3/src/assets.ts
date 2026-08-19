/**
 * Public-asset URLs resolved against THIS module's URL — NOT import.meta.env.BASE_URL.
 *
 * BASE_URL is root-relative ("/ventanas-take-3/…"), so a Webflow host page would
 * request https://<webflow-site>/ventanas-take-3/Broken-Jagged-60f_2026-08-18.glb
 * (404). import.meta.url
 * is the CDN script (…/ventanas-take-3/assets/index-*.js) and public assets sit one
 * directory up.
 *
 * KEEP THIS FILE DIRECTLY IN /src. In a production build every module shares the
 * bundle's URL (dist/assets/index-*.js → ../ is dist/), but in dev `import.meta.url`
 * is this file's own path, so "../" only lands on the public root from /src.
 */
export const GLB_URL = new URL(
  /* @vite-ignore */ '../Broken-Jagged-60f_2026-08-18.glb',
  import.meta.url,
).href;
/**
 * 2048px WebP — sharper than the 1024px source, which was reading as blocky once the
 * matcap zoom (see updateMatcapZoom in scene/star-glb.ts) magnified it up to ~2.8x on
 * a shard viewed head-on. Still under half the original PNG's size.
 */
export const MATCAP_URL = new URL(
  /* @vite-ignore */ '../textures/Crystal-2a.webp',
  import.meta.url,
).href;
export const LOGO_URL = new URL(/* @vite-ignore */ '../eva-logo.png', import.meta.url).href;
