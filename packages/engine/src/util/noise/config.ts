import { hash2 } from '../rng.js';
import { blueNoise2 } from './blue.js';
import { perlin2, simplex2 } from './gradient.js';
import { valueNoise2 } from './value.js';
import { worley2 } from './worley.js';

/**
 * One description of a noise field, and a factory that turns it into a
 * sampler. This is what makes noise *authorable*: a body carries a
 * `NoiseConfig`, the editor edits it with sliders, and generation, previews
 * and analysis all read the same field.
 */

export type NoiseType =
  | 'value'
  | 'perlin'
  | 'simplex'
  | 'worley'
  | 'worley-cracks'
  | 'blue'
  | 'white';

export type FractalKind = 'fbm' | 'ridged' | 'billow';

export interface NoiseConfig {
  type?: NoiseType;
  /** Base frequency in cycles per tile. Higher = smaller features. */
  frequency?: number;
  octaves?: number;
  /** Frequency multiplier per octave. */
  lacunarity?: number;
  /** Amplitude multiplier per octave. */
  gain?: number;
  fractal?: FractalKind;
  /** Domain warp strength, in tiles. 0 disables the extra sampling pass. */
  warp?: number;
  /** Offset added to the seed, so several fields on one body differ. */
  seedOffset?: number;
}

export const DEFAULT_NOISE: Required<NoiseConfig> = {
  type: 'value',
  frequency: 0.05,
  octaves: 4,
  lacunarity: 2,
  gain: 0.5,
  fractal: 'fbm',
  warp: 0,
  seedOffset: 0,
};

/** Editor metadata: what each type is good for. */
export const NOISE_TYPES: { id: NoiseType; label: string; help: string }[] = [
  { id: 'value', label: 'Value', help: 'The original TakeOn field: soft, lumpy relief. Cheapest.' },
  { id: 'perlin', label: 'Perlin', help: 'Gradient noise — flowing dunes and rolling ridges.' },
  { id: 'simplex', label: 'Simplex', help: 'Isotropic gradient noise: organic, no grid artefacts.' },
  { id: 'worley', label: 'Worley', help: 'Cellular distance field — craters, bubbles, pans.' },
  { id: 'worley-cracks', label: 'Worley cracks', help: 'F2−F1 seams: fractured plates and fault lines.' },
  { id: 'blue', label: 'Blue', help: 'Evenly spread randomness — scatter and dithering, not relief.' },
  { id: 'white', label: 'White', help: 'Raw hash. Reference/comparison field.' },
];

export const FRACTAL_KINDS: { id: FractalKind; label: string; help: string }[] = [
  { id: 'fbm', label: 'fBm', help: 'Standard sum of octaves — natural, balanced terrain.' },
  { id: 'ridged', label: 'Ridged', help: 'Inverted absolute value: sharp ridgelines and canyons.' },
  { id: 'billow', label: 'Billow', help: 'Absolute value: puffy, dune-like mounds.' },
];

type Sampler = (x: number, y: number, seed: number) => number;

function baseSampler(type: NoiseType): Sampler {
  switch (type) {
    case 'perlin':
      return perlin2;
    case 'simplex':
      return simplex2;
    case 'worley':
      return (x, y, seed) => worley2(x, y, seed, 'f1');
    case 'worley-cracks':
      return (x, y, seed) => worley2(x, y, seed, 'f2f1');
    case 'blue':
      return (x, y, seed) => blueNoise2(x, y, seed);
    case 'white':
      return (x, y, seed) => hash2(Math.floor(x), Math.floor(y), seed);
    case 'value':
    default:
      return valueNoise2;
  }
}

/**
 * Fractal stack over any base sampler. `fbm` sums octaves; `ridged` and
 * `billow` fold each octave around its midpoint first, which is what turns a
 * smooth field into ridgelines or dunes.
 */
export function fractal2(
  sample: Sampler,
  x: number,
  y: number,
  seed: number,
  opts: { octaves?: number; lacunarity?: number; gain?: number; kind?: FractalKind } = {},
): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5, kind = 'fbm' } = opts;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < Math.max(1, octaves); i++) {
    const raw = sample(x * freq, y * freq, seed + i * 101);
    let v = raw;
    if (kind === 'ridged') v = 1 - Math.abs(raw * 2 - 1);
    else if (kind === 'billow') v = Math.abs(raw * 2 - 1);
    sum += amp * v;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Build a sampler from a config. The returned function takes *tile*
 * coordinates and returns [0,1]; frequency and warping are already folded in,
 * so callers never repeat the plumbing.
 */
export function makeNoise(config: NoiseConfig | undefined, seed: number): (x: number, y: number) => number {
  const cfg = { ...DEFAULT_NOISE, ...config };
  const base = baseSampler(cfg.type);
  const s = seed + cfg.seedOffset;
  const f = cfg.frequency;
  const fractalOpts = {
    octaves: cfg.octaves,
    lacunarity: cfg.lacunarity,
    gain: cfg.gain,
    kind: cfg.fractal,
  };

  if (cfg.warp > 0) {
    // Domain warp: displace the sample point by a second, coarser field. This
    // is what turns regular fBm into something that looks eroded.
    return (x, y) => {
      const wx = (valueNoise2(x * f * 0.5, y * f * 0.5, s + 771) - 0.5) * 2 * cfg.warp;
      const wy = (valueNoise2(x * f * 0.5 + 31.7, y * f * 0.5 - 11.3, s + 913) - 0.5) * 2 * cfg.warp;
      return fractal2(base, (x + wx) * f, (y + wy) * f, s, fractalOpts);
    };
  }
  return (x, y) => fractal2(base, x * f, y * f, s, fractalOpts);
}

/** Human-readable one-liner for editors and tooltips. */
export function describeNoise(config: NoiseConfig | undefined): string {
  const cfg = { ...DEFAULT_NOISE, ...config };
  const type = NOISE_TYPES.find((t) => t.id === cfg.type)?.label ?? cfg.type;
  const parts = [`${type} · ${cfg.fractal} ×${cfg.octaves}`, `freq ${cfg.frequency.toFixed(3)}`];
  if (cfg.warp > 0) parts.push(`warp ${cfg.warp.toFixed(1)}`);
  return parts.join(' · ');
}
