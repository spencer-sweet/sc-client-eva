/**
 * Minimal production shell: ensure #star-scene exists before WebGL boots.
 * Independent of dev-helpers so the canvas works when that import is removed.
 */

const SCENE_ID = 'star-scene';
const SCENE_STYLE_ID = 'ventanas-star-scene-style';

function injectSceneCss() {
  if (document.getElementById(SCENE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SCENE_STYLE_ID;
  style.textContent =
    '#' +
    SCENE_ID +
    '{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0}';
  (document.head || document.documentElement).appendChild(style);
}

export function ensureStarScene() {
  injectSceneCss();
  let canvas = document.getElementById(SCENE_ID);
  if (canvas) return canvas;
  const root = document.body;
  if (!root) {
    throw new Error('ventanas-take-3: document.body missing — cannot create #' + SCENE_ID);
  }
  canvas = document.createElement('canvas');
  canvas.id = SCENE_ID;
  root.prepend(canvas);
  return canvas;
}

export async function whenBodyReady() {
  if (document.body) return;
  if (document.readyState === 'loading') {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  if (!document.body) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}
