import { simplex2 } from '../util/noise/index.js';
import { hash2, mulberry32 } from '../util/rng.js';
import type { Vec2 } from '../types.js';

/**
 * Field terrain: a continuous surface for top-down mobile scenes (KES-541).
 *
 * The voxel world is good at being dug, but drawn on a phone it is blocky and
 * its isometric projection makes direction hard to read. A field is a smooth
 * height function in metres instead: rolling relief, ridges, craters with
 * raised rims and ejecta, plus boulders and ore deposits as point features.
 * It is deterministic from `(style, seed)`, DOM-free and cheap to sample, so a
 * renderer can shade it at any resolution and a vehicle can drive on it.
 */

export type FieldStyleId = 'regolith' | 'rust' | 'carbon' | 'metal' | 'ice';

export interface FieldStyle {
  id: FieldStyleId;
  /** Colour ramp from low ground to high ground (sRGB 0-255). */
  low: [number, number, number];
  high: [number, number, number];
  /** Fresh ejecta / exposed rock, brighter than the plain. */
  bright: [number, number, number];
  /** Shadow tint, so shadows are coloured rather than black. */
  shade: [number, number, number];
  /** Crater density (craters per 1000 m²) and the largest radius in metres. */
  craters: number;
  maxCrater: number;
  /** Ridge strength 0..1 and rolling relief amplitude in metres. */
  ridges: number;
  relief: number;
  /** Boulders per 1000 m². */
  boulders: number;
  /** Surface gravity in m/s², used by vehicles. */
  gravity: number;
}

export const FIELD_STYLES: Record<FieldStyleId, FieldStyle> = {
  regolith: {
    id: 'regolith', low: [92, 90, 96], high: [178, 174, 170], bright: [214, 210, 204], shade: [24, 26, 44],
    craters: 1.1, maxCrater: 14, ridges: 0.25, relief: 3.2, boulders: 5.5, gravity: 1.62,
  },
  rust: {
    id: 'rust', low: [116, 58, 38], high: [206, 128, 84], bright: [232, 170, 120], shade: [46, 18, 30],
    craters: 0.45, maxCrater: 11, ridges: 0.6, relief: 4.5, boulders: 4.2, gravity: 3.71,
  },
  carbon: {
    id: 'carbon', low: [44, 42, 46], high: [104, 98, 96], bright: [150, 142, 134], shade: [12, 12, 24],
    craters: 0.9, maxCrater: 10, ridges: 0.35, relief: 2.6, boulders: 7.5, gravity: 0.3,
  },
  metal: {
    id: 'metal', low: [86, 80, 76], high: [170, 160, 148], bright: [222, 212, 190], shade: [26, 22, 36],
    craters: 1.0, maxCrater: 12, ridges: 0.5, relief: 3.0, boulders: 5.0, gravity: 0.6,
  },
  ice: {
    id: 'ice', low: [120, 140, 160], high: [222, 232, 240], bright: [246, 250, 255], shade: [30, 46, 86],
    craters: 0.6, maxCrater: 12, ridges: 0.45, relief: 2.4, boulders: 2.0, gravity: 0.28,
  },
};

export interface FieldCrater { x: number; y: number; r: number; depth: number; fresh: number }
export interface FieldBoulder { x: number; y: number; r: number; h: number; tone: number }
export interface FieldDeposit { id: string; x: number; y: number; r: number; resource: string }

export interface FieldOptions {
  style?: FieldStyleId | FieldStyle;
  seed?: number;
  /** Square side in metres. */
  size?: number;
  /** Resources the deposits draw from, in order of likelihood. */
  resources?: readonly string[];
  /** How many deposits to place. */
  deposits?: number;
  /** A clear, flat landing area kept free of boulders and craters. */
  landing?: Vec2;
}

/** Height grid resolution: samples per metre for the macro surface. */
const GRID = 4;
const LANDING_CLEAR = 6;

export class FieldTerrain {
  readonly size: number;
  readonly seed: number;
  readonly style: FieldStyle;
  readonly landing: Vec2;
  readonly craters: FieldCrater[] = [];
  readonly boulders: FieldBoulder[] = [];
  readonly deposits: FieldDeposit[] = [];
  /** Macro heights in metres on a (size*GRID+1)² grid. */
  private readonly h: Float32Array;
  /** 0..1 albedo variation (ejecta bright, crater floors dark), same grid. */
  private readonly albedo: Float32Array;
  private readonly n: number;
  private readonly boulderCells = new Map<number, FieldBoulder[]>();

  constructor(opts: FieldOptions = {}) {
    this.size = opts.size ?? 128;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.style = typeof opts.style === 'object' ? opts.style : FIELD_STYLES[opts.style ?? 'regolith'];
    this.landing = opts.landing ?? { x: this.size / 2, y: this.size / 2 };
    this.n = this.size * GRID + 1;
    this.h = new Float32Array(this.n * this.n);
    this.albedo = new Float32Array(this.n * this.n);
    this.placeCraters();
    this.buildGrid();
    this.placeBoulders();
    this.placeDeposits(opts.resources ?? ['iron', 'nickel', 'cobalt'], opts.deposits ?? 6);
  }

  // ── Sampling ──────────────────────────────────────────────────────────

  /** Surface height in metres at a continuous point (bilinear over the macro grid). */
  height(x: number, y: number): number {
    return this.bilinear(this.h, x, y);
  }

  /** 0..1 albedo variation at a point. */
  tone(x: number, y: number): number {
    return this.bilinear(this.albedo, x, y);
  }

  /** Height gradient (dh/dx, dh/dy), i.e. rise per metre. */
  gradient(x: number, y: number): [number, number] {
    const e = 0.35;
    return [
      (this.height(x + e, y) - this.height(x - e, y)) / (2 * e),
      (this.height(x, y + e) - this.height(x, y - e)) / (2 * e),
    ];
  }

  /** Unit surface normal (x east, y south, z up). */
  normal(x: number, y: number): [number, number, number] {
    const [gx, gy] = this.gradient(x, y);
    const l = Math.hypot(gx, gy, 1);
    return [-gx / l, -gy / l, 1 / l];
  }

  /** Boulders whose footprint may touch a circle at (x, y) of radius r. */
  bouldersNear(x: number, y: number, r: number): FieldBoulder[] {
    const out: FieldBoulder[] = [];
    const c0 = Math.floor((x - r - 2) / 4), c1 = Math.floor((x + r + 2) / 4);
    const d0 = Math.floor((y - r - 2) / 4), d1 = Math.floor((y + r + 2) / 4);
    for (let cy = d0; cy <= d1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const list = this.boulderCells.get(cy * 4096 + cx);
        if (list) out.push(...list);
      }
    return out;
  }

  /** The deposit under a point, if any. */
  depositAt(x: number, y: number): FieldDeposit | null {
    for (const d of this.deposits) if (Math.hypot(d.x - x, d.y - y) <= d.r) return d;
    return null;
  }

  private bilinear(grid: Float32Array, x: number, y: number): number {
    const max = this.n - 1;
    const gx = Math.max(0, Math.min(max - 1e-4, x * GRID));
    const gy = Math.max(0, Math.min(max - 1e-4, y * GRID));
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const i = iy * this.n + ix;
    const a = grid[i], b = grid[i + 1], c = grid[i + this.n], d = grid[i + this.n + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // ── Generation ────────────────────────────────────────────────────────

  private placeCraters(): void {
    const rnd = mulberry32(this.seed ^ 0xc4a7e5);
    const count = Math.round((this.size * this.size / 1000) * this.style.craters);
    for (let i = 0; i < count * 3; i++) {
      // Many small craters, few big ones (power law).
      const r = 0.8 + Math.pow(rnd(), 3.4) * (this.style.maxCrater - 0.8);
      const x = rnd() * this.size, y = rnd() * this.size;
      if (Math.hypot(x - this.landing.x, y - this.landing.y) < LANDING_CLEAR + r) continue;
      this.craters.push({ x, y, r, depth: r * (0.2 + rnd() * 0.1), fresh: rnd() });
    }
  }

  private buildGrid(): void {
    const s = this.style;
    const seed = this.seed;
    const cellSize = 16;
    const cells = new Map<number, FieldCrater[]>();
    for (const c of this.craters) {
      const reach = c.r * 2.2;
      for (let cy = Math.floor((c.y - reach) / cellSize); cy <= Math.floor((c.y + reach) / cellSize); cy++)
        for (let cx = Math.floor((c.x - reach) / cellSize); cx <= Math.floor((c.x + reach) / cellSize); cx++) {
          const k = cy * 4096 + cx;
          (cells.get(k) ?? cells.set(k, []).get(k)!).push(c);
        }
    }
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const x = i / GRID, y = j / GRID;
        // Rolling relief: two octaves of simplex, broad and gentle.
        let h = (simplex2(x * 0.018, y * 0.018, seed) - 0.5) * s.relief * 2
          + (simplex2(x * 0.05, y * 0.05, seed + 7) - 0.5) * s.relief * 0.6;
        // Ridges: folded noise, sharp crests.
        if (s.ridges > 0) {
          const r = 1 - Math.abs(simplex2(x * 0.03, y * 0.03, seed + 13) * 2 - 1);
          h += Math.pow(r, 3) * s.ridges * s.relief * 1.4;
        }
        // Fine undulation so slopes are never perfectly planar.
        h += (simplex2(x * 0.22, y * 0.22, seed + 29) - 0.5) * 0.35;
        let tone = 0.5 + (simplex2(x * 0.04, y * 0.04, seed + 41) - 0.5) * 0.8 + (simplex2(x * 0.13, y * 0.13, seed + 43) - 0.5) * 0.25;
        const list = cells.get(Math.floor(y / cellSize) * 4096 + Math.floor(x / cellSize));
        if (list) {
          for (const c of list) {
            const d = Math.hypot(x - c.x, y - c.y) / c.r;
            if (d > 2.2) continue;
            if (d < 1) {
              // Bowl: parabolic floor rising to the rim.
              h += c.depth * (d * d - 1) + c.depth * 0.35;
              tone -= (1 - d) * 0.18;
            } else {
              // Raised rim that falls off into ejecta.
              const t = (d - 1) / 1.2;
              h += c.depth * 0.35 * Math.exp(-t * t * 6);
              tone += c.fresh * 0.35 * Math.exp(-(d - 1) * 2.2) * (0.6 + 0.4 * simplex2(x * 0.6, y * 0.6, seed + 3));
            }
          }
        }
        // Flatten the landing area smoothly.
        const ld = Math.hypot(x - this.landing.x, y - this.landing.y);
        if (ld < LANDING_CLEAR) {
          const k = smooth(1 - ld / LANDING_CLEAR);
          const flat = this.flatHeight();
          h = h * (1 - k) + flat * k;
        }
        this.h[j * this.n + i] = h;
        this.albedo[j * this.n + i] = Math.max(0, Math.min(1, tone));
      }
    }
  }

  private flatCache: number | null = null;
  private flatHeight(): number {
    if (this.flatCache !== null) return this.flatCache;
    const { x, y } = this.landing;
    const s = this.style;
    this.flatCache = (simplex2(x * 0.018, y * 0.018, this.seed) - 0.5) * s.relief * 2;
    return this.flatCache;
  }

  private placeBoulders(): void {
    const rnd = mulberry32(this.seed ^ 0xb0d1e5);
    const count = Math.round((this.size * this.size / 1000) * this.style.boulders);
    for (let i = 0; i < count; i++) {
      let x = rnd() * this.size, y = rnd() * this.size;
      // Boulders cluster round crater rims (ejecta blocks).
      if (this.craters.length && rnd() < 0.55) {
        const c = this.craters[Math.floor(rnd() * this.craters.length)];
        const a = rnd() * Math.PI * 2, d = c.r * (1.05 + rnd() * 0.8);
        x = c.x + Math.cos(a) * d; y = c.y + Math.sin(a) * d;
      }
      if (x < 1 || y < 1 || x > this.size - 1 || y > this.size - 1) continue;
      if (Math.hypot(x - this.landing.x, y - this.landing.y) < LANDING_CLEAR) continue;
      const r = 0.25 + Math.pow(rnd(), 3) * 1.6;
      const b: FieldBoulder = { x, y, r, h: r * (0.7 + rnd() * 0.5), tone: rnd() };
      this.boulders.push(b);
      const k = Math.floor(y / 4) * 4096 + Math.floor(x / 4);
      (this.boulderCells.get(k) ?? this.boulderCells.set(k, []).get(k)!).push(b);
    }
  }

  private placeDeposits(resources: readonly string[], count: number): void {
    const rnd = mulberry32(this.seed ^ 0xd3905);
    let tries = 0;
    while (this.deposits.length < count && tries++ < count * 40) {
      // Ore sits in crater floors and low ground, a short drive from the pad.
      let x: number, y: number;
      if (this.deposits.length < 2) {
        const a = rnd() * Math.PI * 2, d = 7 + rnd() * 4;
        x = this.landing.x + Math.cos(a) * d; y = this.landing.y + Math.sin(a) * d;
      } else if (this.craters.length && rnd() < 0.5) {
        const c = this.craters[Math.floor(rnd() * this.craters.length)];
        x = c.x + (rnd() - 0.5) * c.r; y = c.y + (rnd() - 0.5) * c.r;
      } else {
        const a = rnd() * Math.PI * 2, d = 12 + rnd() * this.size * 0.35;
        x = this.landing.x + Math.cos(a) * d; y = this.landing.y + Math.sin(a) * d;
      }
      if (x < 4 || y < 4 || x > this.size - 4 || y > this.size - 4) continue;
      if (this.deposits.some(d => Math.hypot(d.x - x, d.y - y) < 10)) continue;
      if (this.bouldersNear(x, y, 1.5).some(b => Math.hypot(b.x - x, b.y - y) < b.r + 1.5)) continue;
      const ri = Math.min(resources.length - 1, Math.floor(Math.pow(rnd(), 1.6) * resources.length));
      this.deposits.push({ id: `dep-${this.deposits.length}`, x, y, r: 1.6 + rnd() * 1.4, resource: resources[ri] });
    }
  }
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Stable per-point hash for renderers (pebbles, grain). */
export function fieldHash(x: number, y: number, seed: number): number {
  return hash2(x | 0, y | 0, seed);
}
