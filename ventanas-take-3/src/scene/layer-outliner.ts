/**
 * Theatre "Layer Outliner": fade (look) + render (draw/update) per visual group.
 *
 * fade=0 is full strength; render=0 skips the GPU draw and matching per-frame work.
 */
import { setAlarmLayer } from './alarm-lights';
import { setLogoLayer } from './eva-logo';
import { setGridLayer } from './grid';
import { setStarGlbLayer, setStarGlowLayer } from './star-glb';
import { setStarfieldLayer } from './starfield';
import { setVortexHelpersLayer, setVortexLayer } from './vortex';
import { setWallLayer } from './wall';
import { setWindowLayer } from './window-frames';

export type LayerId =
  | 'wall'
  | 'grid'
  | 'sideWindows'
  | 'centerWindow'
  | 'starGlb'
  | 'starGlow'
  | 'starBackground'
  | 'vortex'
  | 'vortex2'
  | 'vortexHelpers'
  | 'logo'
  | 'alarm';

export interface LayerPair {
  fade: number;
  render: number;
}

const rendered: Record<LayerId, boolean> = {
  wall: true,
  grid: true,
  sideWindows: true,
  centerWindow: true,
  starGlb: true,
  starGlow: true,
  starBackground: true,
  vortex: true,
  vortex2: true,
  vortexHelpers: true,
  logo: true,
  alarm: true,
};

export function isLayerRendered(id: LayerId): boolean {
  return rendered[id];
}

function remember(id: LayerId, render: number): void {
  rendered[id] = render >= 0.5;
}

export function applyLayerOutliner(v: {
  wall: LayerPair;
  grid: LayerPair;
  sideWindows: LayerPair;
  centerWindow: LayerPair;
  starGlb: LayerPair;
  starGlow: LayerPair;
  starBackground: LayerPair;
  vortex: LayerPair;
  vortex2: LayerPair;
  vortexHelpers: LayerPair;
  logo: LayerPair;
  alarm: LayerPair;
}): void {
  remember('wall', v.wall.render);
  setWallLayer(v.wall.fade, v.wall.render);

  remember('grid', v.grid.render);
  setGridLayer(v.grid.fade, v.grid.render);

  remember('sideWindows', v.sideWindows.render);
  setWindowLayer(1, v.sideWindows.fade, v.sideWindows.render);
  setWindowLayer(2, v.sideWindows.fade, v.sideWindows.render);

  remember('centerWindow', v.centerWindow.render);
  setWindowLayer(0, v.centerWindow.fade, v.centerWindow.render);

  remember('starGlb', v.starGlb.render);
  setStarGlbLayer(v.starGlb.fade, v.starGlb.render);

  remember('starGlow', v.starGlow.render);
  setStarGlowLayer(v.starGlow.fade, v.starGlow.render);

  remember('starBackground', v.starBackground.render);
  setStarfieldLayer(v.starBackground.fade, v.starBackground.render);

  remember('vortex', v.vortex.render);
  setVortexLayer(1, v.vortex.fade, v.vortex.render);

  remember('vortex2', v.vortex2.render);
  setVortexLayer(2, v.vortex2.fade, v.vortex2.render);

  remember('vortexHelpers', v.vortexHelpers.render);
  setVortexHelpersLayer(v.vortexHelpers.fade, v.vortexHelpers.render);

  remember('logo', v.logo.render);
  setLogoLayer(v.logo.fade, v.logo.render);

  remember('alarm', v.alarm.render);
  setAlarmLayer(v.alarm.fade, v.alarm.render);
}
