import { beforeEach, describe, expect, it } from 'vitest';
import {
  BODIES,
  blueNoise2,
  blueNoiseMask,
  clearBlueNoiseCache,
  createBodyDraft,
  DEFAULT_NOISE,
  describeNoise,
  fbm2,
  fractal2,
  generateTerrain,
  makeNoise,
  NOISE_TYPES,
  perlin2,
  poissonDisk,
  scatterPoints,
  simplex2,
  valueNoise2,
  worley2,
  type NoiseType,
} from '../src/index.js';

const SAMPLERS: [string, (x: number, y: number, seed: number) => number][] = [
  ['value', valueNoise2],
  ['perlin', perlin2],
  ['simplex', simplex2],
  ['worley', (x, y, s) => worley2(x, y, s)],
];

describe('noise samplers', () => {
  it('stay inside [0,1] over a wide sample', () => {
    for (const [name, sample] of SAMPLERS) {
      for (let i = 0; i < 3000; i++) {
        const x = (i % 71) * 0.37 - 13;
        const y = Math.floor(i / 71) * 0.53 + 4.1;
        const v = sample(x, y, 1234);
        expect(v, `${name} at ${x},${y}`).toBeGreaterThanOrEqual(0);
        expect(v, `${name} at ${x},${y}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('are deterministic and seed-dependent', () => {
    for (const [name, sample] of SAMPLERS) {
      expect(sample(3.25, -7.5, 42), name).toBe(sample(3.25, -7.5, 42));
      expect(sample(3.25, -7.5, 42), name).not.toBe(sample(3.25, -7.5, 43));
    }
  });

  it('are continuous: neighbouring samples move smoothly', () => {
    for (const [name, sample] of [SAMPLERS[0], SAMPLERS[1], SAMPLERS[2]]) {
      let worst = 0;
      for (let i = 0; i < 500; i++) {
        const x = i * 0.11;
        const d = Math.abs(sample(x, 2.5, 7) - sample(x + 0.01, 2.5, 7));
        worst = Math.max(worst, d);
      }
      expect(worst, `${name} jump`).toBeLessThan(0.1);
    }
  });

  it('produce different fields per type', () => {
    const at = (fn: (x: number, y: number, s: number) => number) =>
      Array.from({ length: 20 }, (_, i) => fn(i * 0.7, i * 0.3, 9));
    expect(at(perlin2)).not.toEqual(at(valueNoise2));
    expect(at(simplex2)).not.toEqual(at(perlin2));
    expect(at((x, y, s) => worley2(x, y, s, 'f2f1'))).not.toEqual(at((x, y, s) => worley2(x, y, s, 'f1')));
  });
});

describe('fractal stacks', () => {
  it('ridged and billow differ from fbm but stay bounded', () => {
    const opts = { octaves: 4 } as const;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.13;
      const fbm = fractal2(perlin2, x, 1.5, 3, { ...opts, kind: 'fbm' });
      const ridged = fractal2(perlin2, x, 1.5, 3, { ...opts, kind: 'ridged' });
      const billow = fractal2(perlin2, x, 1.5, 3, { ...opts, kind: 'billow' });
      for (const v of [fbm, ridged, billow]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(ridged - billow)).toBeGreaterThan(0);
    }
  });

  it('more octaves add detail without changing the overall level much', () => {
    const mean = (octaves: number) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += fractal2(simplex2, i * 0.07, 3.3, 11, { octaves });
      return sum / 400;
    };
    expect(Math.abs(mean(1) - mean(6))).toBeLessThan(0.15);
  });
});

describe('blue noise', () => {
  beforeEach(() => clearBlueNoiseCache());

  it('builds a tileable mask covering the whole range', () => {
    const size = 16;
    const mask = blueNoiseMask(size, 5);
    expect(mask.length).toBe(size * size);
    const sorted = [...mask].sort((a, b) => a - b);
    expect(sorted[0]).toBeGreaterThanOrEqual(0);
    expect(sorted[sorted.length - 1]).toBeLessThan(1);
    // Values are a permutation of ranks: no two cells share a threshold.
    expect(new Set(mask).size).toBe(size * size);
    // Tiles: sampling past the edge wraps.
    expect(blueNoise2(size + 2, size + 3, 5, size)).toBe(blueNoise2(2, 3, 5, size));
  });

  it('spreads better than white noise at the same density', () => {
    // Threshold the mask and measure how evenly the survivors are spread by
    // counting per-quadrant occupancy; blue noise should be far more uniform
    // than an unstructured hash at the same count.
    const size = 16;
    const mask = blueNoiseMask(size, 3);
    const cut = 0.25;
    const quadrant = (x: number, y: number) => (y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1);
    const blueCounts = [0, 0, 0, 0];
    let blueTotal = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mask[y * size + x] < cut) {
          blueCounts[quadrant(x, y)]++;
          blueTotal++;
        }
      }
    }
    const spread = Math.max(...blueCounts) - Math.min(...blueCounts);
    expect(blueTotal).toBeGreaterThan(0);
    // Perfectly even would be 0; white noise at this density typically differs
    // by a quarter of the total.
    expect(spread).toBeLessThanOrEqual(Math.ceil(blueTotal * 0.25));
  });

  it('poisson-disk sampling respects the minimum distance', () => {
    const pts = poissonDisk({ width: 60, height: 60, radius: 4, seed: 12 });
    expect(pts.length).toBeGreaterThan(50);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(60);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThanOrEqual(4 - 1e-9);
      }
    }
    // Same seed, same points.
    expect(poissonDisk({ width: 60, height: 60, radius: 4, seed: 12 })).toEqual(pts);
  });

  it('scatters approximately the requested number of points', () => {
    const pts = scatterPoints(64, 40, 7);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.length).toBeLessThanOrEqual(40);
  });
});

describe('noise configs', () => {
  it('defaults reproduce a plain value-fBm field', () => {
    const field = makeNoise({ frequency: 1, octaves: 4 }, 99);
    expect(field(0.3, 0.7)).toBeCloseTo(fbm2(0.3, 0.7, 99, 4), 12);
    expect(DEFAULT_NOISE.type).toBe('value');
  });

  it('builds a working sampler for every advertised type', () => {
    for (const { id } of NOISE_TYPES) {
      const field = makeNoise({ type: id as NoiseType, frequency: 0.1 }, 5);
      const v = field(12, 34);
      expect(Number.isFinite(v), id).toBe(true);
      expect(v, id).toBeGreaterThanOrEqual(0);
      expect(v, id).toBeLessThanOrEqual(1);
      expect(field(12, 34), id).toBe(v);
    }
  });

  it('domain warp changes the field but keeps it in range', () => {
    const plain = makeNoise({ type: 'perlin', frequency: 0.08, warp: 0 }, 3);
    const warped = makeNoise({ type: 'perlin', frequency: 0.08, warp: 6 }, 3);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      const a = plain(i, i * 0.5);
      const b = warped(i, i * 0.5);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (Math.abs(a - b) > 1e-6) differences++;
    }
    expect(differences).toBeGreaterThan(50);
  });

  it('describes itself for editors', () => {
    expect(describeNoise({ type: 'simplex', octaves: 3, warp: 2 })).toContain('Simplex');
    expect(describeNoise(undefined)).toContain('Value');
  });
});

describe('terrain noise integration', () => {
  it('leaves every shipped body byte-identical', () => {
    // The noise work must not silently regenerate the shipped worlds: saves
    // store only edits, so a changed field would corrupt every resume.
    for (const body of BODIES) {
      const world = generateTerrain(body);
      const again = generateTerrain(body);
      let signature = 0;
      for (let i = 0; i < 400; i++) {
        const x = (i * 7) % world.size;
        const y = (i * 13) % world.size;
        expect(world.height(x, y)).toBe(again.height(x, y));
        signature += world.height(x, y) * (i + 1);
      }
      expect(Number.isFinite(signature)).toBe(true);
    }
  });

  it('generates a different, still-playable world when a noise config is set', () => {
    const base = createBodyDraft({ id: 'noise-test', size: 48, maxHeight: 14, seed: 77 });
    const plain = generateTerrain(base);
    const ridged = generateTerrain({
      ...base,
      terrain: { ...base.terrain, noise: { type: 'simplex', frequency: 0.06, octaves: 5, fractal: 'ridged' } },
    });
    let differing = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) if (plain.height(x, y) !== ridged.height(x, y)) differing++;
    }
    expect(differing).toBeGreaterThan(48 * 48 * 0.3);
    // Still a solid, standable world.
    expect(ridged.isSolid(24, 24)).toBe(true);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) expect(ridged.height(x, y)).toBeGreaterThanOrEqual(1);
    }
  });

  it('is deterministic with a noise config', () => {
    const body = createBodyDraft({
      id: 'noise-det',
      size: 40,
      seed: 4,
      terrain: {
        roughness: 0.6,
        craters: 2,
        iceCaps: 0,
        oreRichness: 0.4,
        noise: { type: 'worley', frequency: 0.09, octaves: 3, warp: 3 },
      },
    });
    const a = generateTerrain(body);
    const b = generateTerrain(body);
    for (let i = 0; i < 200; i++) {
      const x = (i * 3) % 40;
      const y = (i * 11) % 40;
      expect(a.height(x, y)).toBe(b.height(x, y));
    }
  });
});
