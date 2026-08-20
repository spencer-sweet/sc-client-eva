/**
 * Mouse parallax across 3 depth layers.
 *
 * wall + grid + glass + neon travel TOGETHER (they share `nearLayer`, one group) so they
 * can never misalign. The star GLB and the background move separately and with less
 * magnitude, which reads as being farther away.
 */
import { nearLayer } from '../core/stage';
import { starGroup as starfieldGroup, starfieldMotion } from '../scene/starfield';
import { glow, starGroup, starPos } from '../scene/star-glb';

export const parallax = {
  enabled: true,
  intensity: 1,
};

let mouseNX = 0;
let mouseNY = 0;
/** False once the pointer has left the browser window — no more `pointermove` events fire then,
 *  so without this the last position before it left would stay "hovered" forever. */
let pointerInWindow = true;

/** NDC pointer: x left/right −1..1, y up/down −1..1 (matches Three.js). Far off-screen once the
 *  pointer has left the window, so hover-glow effects reading it naturally fade to nothing. */
export function getPointerNdc(): { x: number; y: number } {
  if (!pointerInWindow) return { x: 1e4, y: 1e4 };
  return { x: mouseNX, y: -mouseNY };
}

let paraX = 0;
let paraY = 0;

export function installParallaxPointer(): void {
  addEventListener('pointermove', (ev) => {
    pointerInWindow = true;
    mouseNX = (ev.clientX / innerWidth) * 2 - 1;
    mouseNY = (ev.clientY / innerHeight) * 2 - 1;
  });
  // `mouseout` with no relatedTarget fires when the pointer leaves the whole window, not just
  // an element inside it — the standard trick for detecting "cursor left the browser".
  document.addEventListener('mouseout', (ev) => {
    if (ev.relatedTarget === null) pointerInWindow = false;
  });
}

export function updateParallax(time: number): void {
  const tX = parallax.enabled ? mouseNX : 0;
  const tY = parallax.enabled ? mouseNY : 0;
  paraX += (tX - paraX) * 0.06;
  paraY += (tY - paraY) * 0.06;
  const wallK = 0.18 * parallax.intensity;
  const glbK = 0.09 * parallax.intensity;
  const bgK = 0.03 * parallax.intensity;
  nearLayer.position.set(paraX * wallK, paraY * wallK * 0.6, 0);
  starGroup.position.set(starPos.x + paraX * glbK, starPos.y + paraY * glbK * 0.6, starPos.z);
  glow.position.set(starPos.x + paraX * glbK, starPos.y + paraY * glbK * 0.6, starPos.z - 0.2);
  starfieldGroup.position.x = Math.sin(time * starfieldMotion.drift) * 0.5 + paraX * bgK;
  starfieldGroup.position.y = paraY * bgK * 0.6;
}
