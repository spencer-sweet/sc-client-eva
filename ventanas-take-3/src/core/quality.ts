/**
 * One device quality tier, resolved once at import time.
 *
 * Everything that has a "cheaper on a phone" dial reads it from here instead of
 * sprinkling `isMobile` checks through the scene: the renderer takes the pixel-ratio
 * cap and the bloom resolution, the vortex shader takes its noise settings as GLSL
 * `#define`s (so the cost disappears at compile time rather than being branched over
 * per fragment), and the tube takes its segment counts.
 *
 * Override with `?quality=low` / `?quality=high` — the low tier is the only way to
 * see on a desktop what a phone actually renders.
 */

export type QualityTier = 'low' | 'high';

export interface VortexQuality {
  /** fbm octaves. 4 = authored look, 2 = same shapes, softer detail, half the noise cost. */
  fbmOctaves: number;
  /** The domain-warp costs 3 of the shader's 5 fbm calls; the low tier drops it. */
  domainWarp: boolean;
  /**
   * The tunnel is viewed from inside, so its back faces are the ones you see. Drawing
   * DoubleSide shades every pixel twice (additively) for a denser fog; single-sided
   * halves the fullscreen cost and compensates the lost density with `glowCompensation`.
   */
  singleSided: boolean;
  glowCompensation: number;
  /** Upper cap on tubular segments — actual count scales with path length. */
  tubeSegments: number;
  tubeSegmentsMin: number;
  /** Target world-units between tubular samples along the spine. */
  tubeSegmentSpacing: number;
  radialSegments: number;
  /** Dev wireframe: rings along the path × spokes per ring (LineSegments, not mesh wireframe). */
  wireRings: number;
  wireSpokes: number;
}

export interface Quality {
  tier: QualityTier;
  /** Upper bound for renderer.setPixelRatio — DPR 2 -> 1 is a flat 4x on fill rate. */
  pixelRatioCap: number;
  /** Multiplier on the bloom's CSS-pixel resolution. 1 = the authored look. */
  bloomResolutionScale: number;
  /** Multiplier on the authored starfield count — 14k additive sprites is a lot of fill. */
  starCountScale: number;
  vortex: VortexQuality;
}

function detectTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;

  const nav = navigator as Navigator & { deviceMemory?: number };
  const touchFirst = matchMedia('(pointer: coarse)').matches;
  const smallScreen = Math.min(innerWidth, innerHeight) <= 900;
  // Both are optional and Safari reports neither, hence the optimistic defaults —
  // the pointer/screen test is what actually catches phones there.
  const fewCores = (nav.hardwareConcurrency ?? 8) <= 6;
  const lowMemory = (nav.deviceMemory ?? 8) <= 4;

  if (touchFirst && smallScreen) return 'low';
  return fewCores || lowMemory ? 'low' : 'high';
}

const TIERS: Record<QualityTier, Omit<Quality, 'tier'>> = {
  low: {
    pixelRatioCap: 1,
    bloomResolutionScale: 0.5,
    starCountScale: 0.45,
    vortex: {
      fbmOctaves: 2,
      domainWarp: false,
      singleSided: true,
      glowCompensation: 1.6,
      tubeSegments: 48,
      tubeSegmentsMin: 16,
      tubeSegmentSpacing: 3,
      radialSegments: 8,
      wireRings: 20,
      wireSpokes: 6,
    },
  },
  high: {
    pixelRatioCap: 2,
    bloomResolutionScale: 1,
    starCountScale: 1,
    vortex: {
      fbmOctaves: 4,
      domainWarp: true,
      singleSided: false,
      glowCompensation: 1,
      tubeSegments: 72,
      tubeSegmentsMin: 24,
      tubeSegmentSpacing: 2.5,
      radialSegments: 12,
      wireRings: 28,
      wireSpokes: 8,
    },
  },
};

const tier = detectTier();

export const quality: Quality = { tier, ...TIERS[tier] };

export const isLowQuality = tier === 'low';
