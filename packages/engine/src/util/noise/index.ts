/**
 * Noise library.
 *
 * `value.ts` holds the original field the shipped worlds were generated with —
 * it must keep producing identical output, so every built-in body regenerates
 * byte-for-byte. Everything else is opt-in through `NoiseConfig`.
 */

export { valueNoise2, fbm2 } from './value.js';
export { perlin2, simplex2 } from './gradient.js';
export { worley2, type WorleyMode } from './worley.js';
export {
  poissonDisk,
  scatterPoints,
  blueNoiseMask,
  blueNoise2,
  clearBlueNoiseCache,
} from './blue.js';
export {
  makeNoise,
  fractal2,
  describeNoise,
  DEFAULT_NOISE,
  NOISE_TYPES,
  FRACTAL_KINDS,
  type NoiseConfig,
  type NoiseType,
  type FractalKind,
} from './config.js';
