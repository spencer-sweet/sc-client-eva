import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// KawaseBloomPass -- a drop-in, much cheaper replacement for UnrealBloomPass.
//
// UnrealBloomPass builds its blur from 5 mip levels of a separable gaussian:
// a horizontal and a vertical draw per level (10 draws) with up to 11 taps
// each, plus a high-pass and a composite that samples all 5 mips at once. In
// this scene that measured ~5.2ms of a 21.6ms frame even at half resolution.
//
// This uses the dual-filter ("dual Kawase") blur instead -- the approach most
// modern engines ship. Rather than blurring at each level, it exploits the
// bilinear filtering hardware: a downsample chain where each step is a 5-tap
// box that lands *between* texels, then an upsample chain where each step is a
// 9-tap tent that accumulates additively into the level above. The repeated
// half-resolution steps compound into a very wide, very smooth kernel for a
// fraction of the samples, and every draw after the first is on a buffer a
// quarter the size of the previous one.
//
// The public surface deliberately matches the part of UnrealBloomPass this
// project uses -- strength / radius / threshold / resolution / setSize --
// so the GUI bindings and Theatre's keyframed bloomStrength need no changes.
// ---------------------------------------------------------------------------

// High pass, deliberately gating rather than subtracting.
//
// The textbook soft-knee prefilter scales a pixel by (brightness - threshold) /
// brightness, which dims everything near the threshold to nothing. That reads
// as a much weaker bloom for the same strength value. UnrealBloomPass instead
// passes the colour through at FULL brightness once it clears the threshold,
// and since bloomStrength here is both hand-tuned and Theatre-keyframed against
// that behaviour, this matches it -- a smoothstep gate over a narrow band, so
// the value is preserved but pixels still fade in rather than popping as they
// cross (very visible otherwise on the drifting starfield).
const PREFILTER_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uThreshold: { value: 0.25 },
    uKnee: { value: 0.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uThreshold;
    uniform float uKnee;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float brightness = max(c.r, max(c.g, c.b));
      float knee = max(uKnee, 1e-4);
      float gate = smoothstep(uThreshold - knee, uThreshold + knee, brightness);
      gl_FragColor = vec4(c * gate, 1.0);
    }
  `,
};

// 5 taps, but each of the 4 corner taps sits exactly on a texel corner so
// bilinear filtering averages 4 texels for free -- effectively a 17-texel box.
const DOWNSAMPLE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uHalfTexel: { value: new THREE.Vector2() },
  },
  vertexShader: PREFILTER_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uHalfTexel;
    varying vec2 vUv;
    void main() {
      vec4 sum = texture2D(tDiffuse, vUv) * 4.0;
      sum += texture2D(tDiffuse, vUv - uHalfTexel);
      sum += texture2D(tDiffuse, vUv + uHalfTexel);
      sum += texture2D(tDiffuse, vUv + vec2(uHalfTexel.x, -uHalfTexel.y));
      sum += texture2D(tDiffuse, vUv - vec2(uHalfTexel.x, -uHalfTexel.y));
      gl_FragColor = sum / 8.0;
    }
  `,
};

// 9-tap tent. Written straight to the larger target with additive blending, so
// each level's contribution sums into the one above without a separate combine.
//
// uWeight tapers each step of that accumulation. Because the chain cascades
// (level 0 ends up holding level 1 + level 2 + level 3 ...), an untapered sum
// weights the widest, haziest levels exactly as heavily as the tight core --
// which reads as a flat wash. A weight below 1 gives the falloff that
// UnrealBloomPass gets from its per-mip bloomFactors.
const UPSAMPLE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uHalfTexel: { value: new THREE.Vector2() },
    uRadius: { value: 1.0 },
    uWeight: { value: 1.0 },
  },
  vertexShader: PREFILTER_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uHalfTexel;
    uniform float uRadius;
    uniform float uWeight;
    varying vec2 vUv;
    void main() {
      vec2 h = uHalfTexel * uRadius;
      vec4 sum = texture2D(tDiffuse, vUv + vec2(-h.x * 2.0, 0.0));
      sum += texture2D(tDiffuse, vUv + vec2(-h.x, h.y)) * 2.0;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, h.y * 2.0));
      sum += texture2D(tDiffuse, vUv + vec2(h.x, h.y)) * 2.0;
      sum += texture2D(tDiffuse, vUv + vec2(h.x * 2.0, 0.0));
      sum += texture2D(tDiffuse, vUv + vec2(h.x, -h.y)) * 2.0;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -h.y * 2.0));
      sum += texture2D(tDiffuse, vUv + vec2(-h.x, -h.y)) * 2.0;
      gl_FragColor = (sum / 12.0) * uWeight;
    }
  `,
};

// The composite is the pass that actually reaches the canvas, which makes it
// responsible for the output colour space encode.
//
// The scene's materials only sRGB-encode when they render straight to the
// default framebuffer. Rendering through EffectComposer they write into a
// linear HalfFloat target instead, so without the encode here those linear
// values land on an sRGB canvas untouched and everything renders too dark --
// most visibly on large low-luminance areas like the wall's navy, which
// crushes to near-black.
//
// `colorspace_fragment` is three's own chunk and is target-aware: three
// generates linearToOutputTexel() from the current render target, so this is
// an sRGB encode when drawing to the canvas and a no-op when drawing into a
// linear buffer. That keeps the pass correct wherever it sits in the chain.
const COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uStrength: { value: 1.0 },
  },
  vertexShader: PREFILTER_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uStrength;
    varying vec2 vUv;
    // no <common> / <colorspace_pars_fragment> here on purpose: both declare
    // the sRGB transfer functions, and three already injects
    // linearToOutputTexel() into every fragment prefix, so including either
    // one redeclares them and the shader fails to compile
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 bloom = texture2D(tBloom, vUv).rgb;
      gl_FragColor = vec4(base.rgb + bloom * uStrength, base.a);
      #include <colorspace_fragment>
    }
  `,
};

export class KawaseBloomPass extends Pass {
  static MAX_LEVELS = 6;

  /**
   * @param {THREE.Vector2} resolution base resolution the mip chain is sized from
   * @param {number} strength   multiplier on the bloom added back to the scene
   * @param {number} radius     widens the upsample tent (roughly UnrealBloomPass's radius)
   * @param {number} threshold  luminance above which pixels bloom
   * @param {number} levels     mip chain depth; each level halves the resolution
   */
  constructor(resolution = new THREE.Vector2(256, 256), strength = 1, radius = 1, threshold = 0.25, levels = 4) {
    super();
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
    this.levels = levels;
    // per-step taper of the upsample accumulation (see UPSAMPLE_SHADER)
    this.levelFalloff = 0.7;
    this.resolution = new THREE.Vector2(resolution.x, resolution.y);
    // `needsSwap` stays true: the composite writes base+bloom into writeBuffer
    // and lets EffectComposer swap, rather than UnrealBloomPass's trick of
    // additively blending back over readBuffer in place.
    this.needsSwap = true;

    const makeMaterial = (def) =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(def.uniforms),
        vertexShader: def.vertexShader,
        fragmentShader: def.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });

    this.prefilterMaterial = makeMaterial(PREFILTER_SHADER);
    this.downsampleMaterial = makeMaterial(DOWNSAMPLE_SHADER);
    this.upsampleMaterial = makeMaterial(UPSAMPLE_SHADER);
    // additive so each upsample step accumulates into the level above instead
    // of needing its own combine draw
    this.upsampleMaterial.blending = THREE.AdditiveBlending;
    this.compositeMaterial = makeMaterial(COMPOSITE_SHADER);

    this.fsQuad = new FullScreenQuad(null);

    // HalfFloat to match the composer's HDR scene target -- an 8-bit chain
    // would clip the very values bloom exists to spread. No depth/stencil:
    // these are pure image buffers.
    // Always allocate the maximum chain rather than exactly `levels`, so the
    // depth stays live-tunable from the GUI without rebuilding the pass. The
    // deep levels are a few hundred bytes each -- by mip 5 the buffer is
    // 1/64th of the input in each axis.
    this.mips = [];
    for (let i = 0; i < KawaseBloomPass.MAX_LEVELS; i++) {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
      target.texture.name = `KawaseBloom.mip${i}`;
      this.mips.push(target);
    }

    this.setSize(this.resolution.x, this.resolution.y);
  }

  setSize(width, height) {
    this.resolution.set(width, height);
    // the chain starts at half the given resolution -- the prefilter doubles as
    // the first downsample, so nothing is ever processed at full size
    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    for (let i = 0; i < this.mips.length; i++) {
      this.mips[i].setSize(w, h);
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // how deep to walk this frame -- at least 2 so there's something to
    // upsample back from
    const levels = Math.max(2, Math.min(Math.round(this.levels), this.mips.length));

    // 1. bright-pass straight into mip 0 (already half resolution)
    this.prefilterMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.prefilterMaterial.uniforms.uThreshold.value = this.threshold;
    this.fsQuad.material = this.prefilterMaterial;
    renderer.setRenderTarget(this.mips[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. downsample chain -- each step reads the level above at half its size
    this.fsQuad.material = this.downsampleMaterial;
    for (let i = 1; i < levels; i++) {
      const src = this.mips[i - 1];
      this.downsampleMaterial.uniforms.tDiffuse.value = src.texture;
      this.downsampleMaterial.uniforms.uHalfTexel.value.set(0.5 / src.width, 0.5 / src.height);
      renderer.setRenderTarget(this.mips[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
    }

    // 3. upsample chain -- additive, so the wide low-frequency levels sum into
    // the tighter ones on the way back up
    this.fsQuad.material = this.upsampleMaterial;
    this.upsampleMaterial.uniforms.uRadius.value = this.radius;
    this.upsampleMaterial.uniforms.uWeight.value = this.levelFalloff;
    for (let i = levels - 1; i > 0; i--) {
      const src = this.mips[i];
      this.upsampleMaterial.uniforms.tDiffuse.value = src.texture;
      this.upsampleMaterial.uniforms.uHalfTexel.value.set(0.5 / src.width, 0.5 / src.height);
      renderer.setRenderTarget(this.mips[i - 1]);
      this.fsQuad.render(renderer);
    }

    // 4. add the accumulated bloom back onto the untouched scene colour
    // The cascade leaves mip 0 holding the geometric series
    // 1 + w + w^2 + ... + w^(levels-1) times a single level's energy. Dividing
    // that out makes `strength` mean the same thing whatever the level count
    // and falloff are, so changing spread no longer silently rescales
    // brightness.
    //
    // It is then re-scaled by REFERENCE_GAIN rather than left at 1. That is not
    // arbitrary: UnrealBloomPass does NOT normalise -- its composite sums five
    // mips whose lerpBloomFactor weights total ~3.0 at radius 0.9. Normalising
    // to 1.0 therefore renders ~3x darker than the strength values this scene
    // was authored (and keyframed in Theatre) against. Matching its gain keeps
    // bloomStrength 0.55 looking like bloomStrength 0.55.
    const REFERENCE_GAIN = 3.0;
    const w = this.levelFalloff;
    const seriesSum = w === 1 ? levels : (1 - Math.pow(w, levels)) / (1 - w);
    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.mips[0].texture;
    this.compositeMaterial.uniforms.uStrength.value = (this.strength * REFERENCE_GAIN) / seriesSum;
    this.fsQuad.material = this.compositeMaterial;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);

    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    for (const mip of this.mips) mip.dispose();
    this.prefilterMaterial.dispose();
    this.downsampleMaterial.dispose();
    this.upsampleMaterial.dispose();
    this.compositeMaterial.dispose();
    this.fsQuad.dispose();
  }
}
