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
  /**
   * Octaves in the MAIN noise field. This is the one that decides how the tunnel reads:
   * `beam = smoothstep(0.42, 0.90, v)` carves filaments out of it, so a field with fine
   * structure gives many thin filaments and a smooth one gives a few fat blobs. Dropping
   * it was what made the low tier look like a different effect rather than a softer one,
   * so both tiers now run the authored 4.
   */
  fbmOctaves: number;
  /**
   * Octaves in each domain-warp sample. The warp only has to MOVE the field around, not
   * add visible detail, so one octave reads almost the same as four — this is where the
   * low tier buys back what the main field spends.
   */
  warpOctaves: number;
  /**
   * Independent noise samples feeding the 3-axis warp vector. Three is one field per
   * axis (the authored look). Two builds the third axis from the difference of the other
   * two — not a new field, but still a genuinely different direction, which is all the
   * warp needs and is what keeps the filaments braiding rather than shearing.
   */
  warpSamples: number;
  /**
   * Octaves in the hue field, which only picks a blend between uColorMid and uColorEdge.
   * A low-frequency choice; extra octaves are invisible.
   */
  hueOctaves: number;
  /**
   * The tunnel is viewed from inside, so its back faces are the ones you see. Drawing
   * DoubleSide shades every pixel twice (additively) for a denser fog; single-sided
   * halves the fullscreen cost, and the shader compensates by combining the beam with
   * itself the way two independent layers would overlap (see SINGLE_SIDED in material.ts).
   */
  singleSided: boolean;
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
      // Same main field as the high tier — see fbmOctaves. The saving comes from the
      // warp and hue fields instead, which is a far better trade: 7 noise samples per
      // fragment against the high tier's 20, for a tunnel that reads the same.
      fbmOctaves: 4,
      warpOctaves: 1,
      warpSamples: 2,
      hueOctaves: 1,
      singleSided: true,
      // Tessellation is NOT tiered any more. The whole tube is under 2k triangles at
      // the high-tier counts, which is nothing against a fullscreen fragment shader —
      // but `ang` comes from vUv.x, interpolated linearly across each quad, so a coarse
      // ring count put visible angular kinks in every filament. Free quality.
      tubeSegments: 72,
      tubeSegmentsMin: 24,
      tubeSegmentSpacing: 2.5,
      radialSegments: 12,
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
      warpOctaves: 4,
      warpSamples: 3,
      hueOctaves: 4,
      singleSided: false,
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
