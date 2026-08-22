/**
 * Theatre "Layer Outliner": fade (look) + render (draw/update) per visual group.
 *
 * fade=0 is full strength; render Off skips the GPU draw and matching per-frame work.
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
  /** Theatre switch — was a 0/1 number; still accept that from old saved state. */
  render: 'on' | 'off' | number;
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

function renderFlag(render: LayerPair['render']): number {
  if (render === 'on') return 1;
  if (render === 'off') return 0;
  return render >= 0.5 ? 1 : 0;
}

function remember(id: LayerId, render: LayerPair['render']): void {
  rendered[id] = renderFlag(render) >= 0.5;
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
  const apply = (id: LayerId, pair: LayerPair, set: (fade: number, render: number) => void) => {
    const r = renderFlag(pair.render);
    remember(id, pair.render);
    set(pair.fade, r);
  };

  apply('wall', v.wall, setWallLayer);
  apply('grid', v.grid, setGridLayer);

  remember('sideWindows', v.sideWindows.render);
  {
    const r = renderFlag(v.sideWindows.render);
    setWindowLayer(1, v.sideWindows.fade, r);
    setWindowLayer(2, v.sideWindows.fade, r);
  }

  remember('centerWindow', v.centerWindow.render);
  setWindowLayer(0, v.centerWindow.fade, renderFlag(v.centerWindow.render));

  apply('starGlb', v.starGlb, setStarGlbLayer);
  apply('starGlow', v.starGlow, setStarGlowLayer);
  apply('starBackground', v.starBackground, setStarfieldLayer);

  remember('vortex', v.vortex.render);
  setVortexLayer(1, v.vortex.fade, renderFlag(v.vortex.render));
  remember('vortex2', v.vortex2.render);
  setVortexLayer(2, v.vortex2.fade, renderFlag(v.vortex2.render));

  apply('vortexHelpers', v.vortexHelpers, setVortexHelpersLayer);
  apply('logo', v.logo, setLogoLayer);
  apply('alarm', v.alarm, setAlarmLayer);
}
