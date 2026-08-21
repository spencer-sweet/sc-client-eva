/**
 * Minimal production shell: ensure #star-scene exists before WebGL boots.
 * Independent of dev-helpers so the canvas works when that import is removed.
 */

const SCENE_ID = 'star-scene';
const SCENE_STYLE_ID = 'ventanas-star-scene-style';

function injectSceneCss(): void {
  if (document.getElementById(SCENE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SCENE_STYLE_ID;
  style.textContent = `#${SCENE_ID}{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0}`;
  (document.head || document.documentElement).appendChild(style);
}

export function ensureStarScene(): HTMLCanvasElement {
  injectSceneCss();
  const existing = document.getElementById(SCENE_ID);
  if (existing instanceof HTMLCanvasElement) return existing;
  const canvas = document.createElement('canvas');
  canvas.id = SCENE_ID;
  // Webflow authors a placeholder (a plain <div id="star-scene">) as the mount
  // point so it can be positioned/found in Designer; swap it out in place rather
  // than leaving it behind, or it sits on top of the real canvas and eats every
  // pointer event site-wide (orbit drags included).
  if (existing) {
    existing.replaceWith(canvas);
    return canvas;
  }
  const root = document.body;
  if (!root) {
    throw new Error('ventanas-take-3: document.body missing — cannot create #' + SCENE_ID);
  }
  root.prepend(canvas);
  return canvas;
}

export async function whenBodyReady(): Promise<void> {
  if (document.body) return;
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
  if (!document.body) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
