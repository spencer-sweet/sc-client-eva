/**
 * The two flickering alarm lights.
 *
 * They are not real THREE lights — every surface that should react (glass, neon, the
 * wall spill sprites, the starfield tint) reads the same two color/position pairs from
 * uniforms refreshed here once per frame.
 */
import * as THREE from 'three';
import { winCentersW, WINDOW_INDICES } from '../windows/geometry';
import { starUniforms } from './starfield';
import { neonLightU } from './window-materials';
import { centerGlass, sideGlass, wallSpillSprites } from './window-frames';

export interface AlarmLight {
  color: THREE.Color;
  intensity: number;
  flicker: number;
  speed: number;
  x: number;
  y: number;
  z: number;
}

export const alarmLights: AlarmLight[] = [
  { color: new THREE.Color(0xff2a2a), intensity: 1.4, flicker: 0.7, speed: 2.2, x: -8, y: 0, z: -8 },
  { color: new THREE.Color(0xff2a2a), intensity: 1.4, flicker: 0.7, speed: 1.5, x: 8, y: 0, z: -8 },
];

/** 0 disables the wall spill entirely; otherwise a multiplier on its opacity. */
export const wallSpill = { intensity: 1.0 };

function flick(time: number, speed: number, amt: number): number {
  let b = 0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2);
  b = b * b;
  return 1 - amt + amt * b;
}

const tmp0 = new THREE.Color();
const tmp1 = new THREE.Color();
const tmpSum = new THREE.Color();
const lit = [tmp0, tmp1];

const lightTargets = [sideGlass.uniforms, centerGlass.uniforms, neonLightU];

export function updateAlarmLights(time: number): void {
  for (let i = 0; i < 2; i++) {
    const l = alarmLights[i];
    lit[i].copy(l.color).multiplyScalar(l.intensity * flick(time, l.speed, l.flicker));
  }

  for (const u of lightTargets) {
    for (let i = 0; i < 2; i++) {
      u.uLightColI.value[i].copy(lit[i]);
      u.uLightPos.value[i].set(alarmLights[i].x, alarmLights[i].y, alarmLights[i].z);
    }
  }

  // Spill on the wall around each window, using the same distance falloff as the glass.
  for (const wi of WINDOW_INDICES) {
    const c = winCentersW[wi];
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let li = 0; li < 2; li++) {
      const dx = alarmLights[li].x - c[0];
      const dy = alarmLights[li].y - c[1];
      const dz = alarmLights[li].z;
      const att = 1.0 / (1.0 + (dx * dx + dy * dy + dz * dz) * 0.02);
      sr += lit[li].r * att;
      sg += lit[li].g * att;
      sb += lit[li].b * att;
    }
    const mat = wallSpillSprites[wi].material as THREE.SpriteMaterial;
    mat.color.setRGB(sr, sg, sb);
    mat.opacity = Math.min(1, (sr + sg + sb) * 0.5 * wallSpill.intensity);
  }

  starUniforms.uAlarm.value.copy(tmpSum.copy(tmp0).add(tmp1).multiplyScalar(0.14));
}
