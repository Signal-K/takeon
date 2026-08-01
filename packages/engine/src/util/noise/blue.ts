import type { Vec2 } from '../../types.js';
import { mulberry32 } from '../rng.js';

/**
 * Blue noise: randomness with the low frequencies removed, so points are
 * *evenly* scattered instead of clumping the way white noise does.
 *
 * It is the right tool for placing things — boulders, flora, anomalies,
 * sampling sites, dither patterns — where "random" from a plain hash leaves
 * visible clumps and bald patches. Two forms are provided: a tileable mask of
 * per-cell thresholds (for fields and dithering) and Poisson-disk point sets
 * (for placement with a guaranteed minimum spacing).
 */

/**
 * Bridson's Poisson-disk sampling: uniform points no closer than `radius`,
 * generated in O(n). Deterministic for a given seed.
 */
export function poissonDisk(opts: {
  width: number;
  height: number;
  /** Minimum distance between points, in the same units as width/height. */
  radius: number;
  seed?: number;
  /** Candidates tried per active point before it is retired (default 24). */
  tries?: number;
  /** Hard cap on points, for pathological inputs. */
  limit?: number;
}): Vec2[] {
  const { width, height, radius, seed = 1, tries = 24, limit = 20000 } = opts;
  if (radius <= 0 || width <= 0 || height <= 0) return [];
  const rng = mulberry32(seed ^ 0x9e37);
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const grid = new Int32Array(cols * rows).fill(-1);
  const points: Vec2[] = [];
  const active: number[] = [];

  const insert = (p: Vec2): void => {
    const gx = Math.min(cols - 1, Math.floor(p.x / cell));
    const gy = Math.min(rows - 1, Math.floor(p.y / cell));
    grid[gy * cols + gx] = points.length;
    active.push(points.length);
    points.push(p);
  };

  const fits = (p: Vec2): boolean => {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return false;
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    for (let y = Math.max(0, gy - 2); y <= Math.min(rows - 1, gy + 2); y++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(cols - 1, gx + 2); x++) {
        const idx = grid[y * cols + x];
        if (idx < 0) continue;
        const q = points[idx];
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < radius * radius) return false;
      }
    }
    return true;
  };

  insert({ x: rng() * width, y: rng() * height });

  while (active.length > 0 && points.length < limit) {
    const pick = Math.floor(rng() * active.length);
    const origin = points[active[pick]];
    let placed = false;
    for (let i = 0; i < tries; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = radius * (1 + rng());
      const candidate = { x: origin.x + Math.cos(angle) * dist, y: origin.y + Math.sin(angle) * dist };
      if (!fits(candidate)) continue;
      insert(candidate);
      placed = true;
      break;
    }
    if (!placed) active.splice(pick, 1);
  }

  return points;
}

/**
 * Scatter roughly `count` points over a square grid with blue-noise spacing.
 * The radius is solved from the target count, then trimmed/topped up — handy
 * when a designer thinks in "about 40 boulders", not in minimum distances.
 */
export function scatterPoints(size: number, count: number, seed = 1): Vec2[] {
  if (count <= 0 || size <= 0) return [];
  // Packing density of a Poisson-disk set is ~0.7 of the hexagonal bound.
  const radius = Math.max(0.5, Math.sqrt((size * size * 0.75) / count));
  const points = poissonDisk({ width: size, height: size, radius, seed });
  if (points.length <= count) return points;
  // Deterministic trim: keep an evenly spread subset rather than the first N.
  const step = points.length / count;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) out.push(points[Math.floor(i * step)]);
  return out;
}

const maskCache = new Map<string, Float32Array>();

/**
 * Tileable blue-noise threshold mask built by void-and-cluster: every cell
 * gets a value in [0,1) such that thresholding at any level leaves an evenly
 * spread pattern. Cached per (size, seed) — building one is the expensive part.
 *
 * Keep `size` small (32 or 64); cost grows with size².
 */
export function blueNoiseMask(size = 32, seed = 1): Float32Array {
  const key = `${size}:${seed}`;
  const cached = maskCache.get(key);
  if (cached) return cached;

  const n = size * size;
  const rng = mulberry32(seed ^ 0x51f3);
  const binary = new Uint8Array(n);
  const energy = new Float32Array(n);

  // Gaussian energy kernel with wraparound, so the mask tiles seamlessly.
  const sigma = 1.5;
  const reach = Math.min(size >> 1, 4);
  const kernel: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue;
      kernel.push({ dx, dy, w: Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) });
    }
  }

  const stamp = (index: number, sign: number): void => {
    const x = index % size;
    const y = (index - x) / size;
    for (const k of kernel) {
      const nx = (x + k.dx + size) % size;
      const ny = (y + k.dy + size) % size;
      energy[ny * size + nx] += sign * k.w;
    }
  };

  const tightestCluster = (): number => {
    let best = -1;
    let bestE = -Infinity;
    for (let i = 0; i < n; i++) {
      if (binary[i] === 1 && energy[i] > bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  const largestVoid = (): number => {
    let best = -1;
    let bestE = Infinity;
    for (let i = 0; i < n; i++) {
      if (binary[i] === 0 && energy[i] < bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  // Seed pattern: a tenth of the cells, then relax it until removing the
  // tightest cluster and filling the largest void stops moving anything.
  const initial = Math.max(1, Math.round(n * 0.1));
  let placed = 0;
  while (placed < initial) {
    const i = Math.floor(rng() * n);
    if (binary[i]) continue;
    binary[i] = 1;
    stamp(i, 1);
    placed++;
  }
  for (let guard = 0; guard < n * 2; guard++) {
    const cluster = tightestCluster();
    if (cluster < 0) break;
    binary[cluster] = 0;
    stamp(cluster, -1);
    const voidCell = largestVoid();
    if (voidCell < 0 || voidCell === cluster) {
      binary[cluster] = 1;
      stamp(cluster, 1);
      break;
    }
    binary[voidCell] = 1;
    stamp(voidCell, 1);
  }

  const rank = new Int32Array(n).fill(-1);
  // Phase 1: remove points from the prototype, ranking downward.
  const proto = Uint8Array.from(binary);
  const protoEnergy = Float32Array.from(energy);
  for (let r = placed - 1; r >= 0; r--) {
    const cluster = tightestCluster();
    if (cluster < 0) break;
    binary[cluster] = 0;
    stamp(cluster, -1);
    rank[cluster] = r;
  }
  // Phase 2: restore the prototype and add points, ranking upward.
  binary.set(proto);
  energy.set(protoEnergy);
  for (let r = placed; r < n; r++) {
    const voidCell = largestVoid();
    if (voidCell < 0) break;
    binary[voidCell] = 1;
    stamp(voidCell, 1);
    rank[voidCell] = r;
  }

  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) mask[i] = (rank[i] < 0 ? 0 : rank[i]) / n;
  maskCache.set(key, mask);
  return mask;
}

/** Sample the tileable blue-noise mask at integer-ish coordinates. */
export function blueNoise2(x: number, y: number, seed = 1, size = 32): number {
  const mask = blueNoiseMask(size, seed);
  const xi = ((Math.floor(x) % size) + size) % size;
  const yi = ((Math.floor(y) % size) + size) % size;
  return mask[yi * size + xi];
}

/** Drop cached masks (tests, or when memory matters more than rebuild cost). */
export function clearBlueNoiseCache(): void {
  maskCache.clear();
}
