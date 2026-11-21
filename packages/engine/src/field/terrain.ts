import { hash2, mulberry32 } from '../util/rng.js';
import type { Vec2 } from '../types.js';
import { getFieldLayer, recipeForStyle, type FieldGenContext, type FieldRecipe, type FieldSample } from './pcg.js';

/**
 * Field terrain: a continuous surface for top-down mobile scenes (KES-541).
 * Since KES-543 the surface is built by a recipe of PCG layers (`pcg.ts`),
 * starting from a real DTM on the Moon and Mars.
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
  /** Multiplies deposit size and spacing; orbit fields use bigger veins (default 1). */
  depositScale?: number;
  /** A clear, flat landing area kept free of boulders and craters. A `dem` layer picks one if unset. */
  landing?: Vec2;
  /** The layer stack (see `pcg.ts`). Defaults to `recipeForStyle(style)`. */
  recipe?: FieldRecipe;
}

const LANDING_CLEAR = 6;

export class FieldTerrain {
  readonly size: number;
  readonly seed: number;
  readonly style: FieldStyle;
  readonly recipe: FieldRecipe;
  landing: Vec2;
  readonly craters: FieldCrater[] = [];
  readonly boulders: FieldBoulder[] = [];
  readonly deposits: FieldDeposit[] = [];
  /** Attribution for real data in this field (DTM products). */
  readonly sources: string[] = [];
  /** Short HUD credits for that data, e.g. "Jezero crater, Mars · HiRISE". */
  readonly credits: string[] = [];
  /** Macro heights in metres on a (size*this.res+1)² grid. */
  private readonly h: Float32Array;
  /** 0..1 albedo variation (ejecta bright, crater floors dark), same grid. */
  private readonly albedo: Float32Array;
  private readonly n: number;
  /** Height grid samples per metre: 4 for surface fields, 2 for wide orbit fields. */
  private readonly res: number;
  private readonly boulderCells = new Map<number, FieldBoulder[]>();

  constructor(opts: FieldOptions = {}) {
    this.size = opts.size ?? 128;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.style = typeof opts.style === 'object' ? opts.style : FIELD_STYLES[opts.style ?? 'regolith'];
    this.recipe = opts.recipe ?? recipeForStyle(this.style);
    this.landing = opts.landing ?? { x: this.size / 2, y: this.size / 2 };
    this.res = this.size > 200 ? 2 : 4;
    this.n = this.size * this.res + 1;
    this.h = new Float32Array(this.n * this.n);
    this.albedo = new Float32Array(this.n * this.n);
    this.generate(opts);
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

  /** Rise per metre in the steepest direction. */
  slope(x: number, y: number): number {
    const [gx, gy] = this.gradient(x, y);
    return Math.hypot(gx, gy);
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
    const gx = Math.max(0, Math.min(max - 1e-4, x * this.res));
    const gy = Math.max(0, Math.min(max - 1e-4, y * this.res));
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const i = iy * this.n + ix;
    const a = grid[i], b = grid[i + 1], c = grid[i + this.n], d = grid[i + this.n + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // ── Generation ────────────────────────────────────────────────────────

  /** Run the recipe: prepare every layer, build the grid from their shapes, then place. */
  private generate(opts: FieldOptions): void {
    const layers = this.recipe.layers.map((spec, i) => {
      const layer = getFieldLayer(spec.kind);
      if (!layer) throw new Error(`Unknown field layer '${spec.kind}'`);
      return { spec, layer, rnd: mulberry32((this.seed ^ Math.imul(i + 1, 0x9e3779b1) ^ hashKind(spec.kind)) >>> 0) };
    });
    let current = layers[0]?.rnd ?? Math.random;
    const self = this;
    const ctx: FieldGenContext = {
      size: this.size, seed: this.seed, style: this.style, clear: LANDING_CLEAR,
      get landing() { return self.landing; },
      set landing(v: Vec2) { if (!opts.landing) self.landing = v; },
      craters: this.craters, boulders: this.boulders, deposits: this.deposits, sources: this.sources, credits: this.credits,
      resources: opts.resources ?? ['iron', 'nickel', 'cobalt'], depositCount: opts.deposits ?? 6, depositScale: opts.depositScale ?? 1,
      rnd: () => current(),
      height: (x, y) => this.height(x, y),
      slope: (x, y) => this.slope(x, y),
      tone: (x, y) => this.tone(x, y),
      addBoulder: b => this.addBoulder(b),
      bouldersNear: (x, y, r) => this.bouldersNear(x, y, r),
    };
    for (const l of layers) { current = l.rnd; l.layer.prepare?.(ctx, l.spec); }
    const shapes: ((x: number, y: number, s: FieldSample) => void)[] = [];
    for (const l of layers) { current = l.rnd; const f = l.layer.shape?.(ctx, l.spec); if (f) shapes.push(f); }
    const s: FieldSample = { h: 0, tone: 0.5 };
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        s.h = 0; s.tone = 0.5;
        const x = i / this.res, y = j / this.res;
        for (const f of shapes) f(x, y, s);
        this.h[j * this.n + i] = s.h;
        this.albedo[j * this.n + i] = Math.max(0, Math.min(1, s.tone));
      }
    }
    this.flattenLanding();
    for (const l of layers) { current = l.rnd; l.layer.place?.(ctx, l.spec); }
  }

  /** Blend the landing area smoothly to its mean height. */
  private flattenLanding(): void {
    const { x: lx, y: ly } = this.landing;
    let sum = 0, cnt = 0;
    for (let a = 0; a < 12; a++)
      for (const r of [0, LANDING_CLEAR * 0.5, LANDING_CLEAR]) {
        sum += this.height(lx + Math.cos(a) * r, ly + Math.sin(a) * r); cnt++;
      }
    const flat = sum / cnt;
    const r = Math.ceil((LANDING_CLEAR + 1) * this.res);
    const ci = Math.round(lx * this.res), cj = Math.round(ly * this.res);
    for (let j = Math.max(0, cj - r); j <= Math.min(this.n - 1, cj + r); j++)
      for (let i = Math.max(0, ci - r); i <= Math.min(this.n - 1, ci + r); i++) {
        const d = Math.hypot(i / this.res - lx, j / this.res - ly);
        if (d >= LANDING_CLEAR) continue;
        const k = smooth((1 - d / LANDING_CLEAR) * 1.6);
        const idx = j * this.n + i;
        this.h[idx] = this.h[idx] * (1 - k) + flat * k;
      }
  }

  private addBoulder(b: FieldBoulder): void {
    this.boulders.push(b);
    const k = Math.floor(b.y / 4) * 4096 + Math.floor(b.x / 4);
    (this.boulderCells.get(k) ?? this.boulderCells.set(k, []).get(k)!).push(b);
  }
}

function hashKind(kind: string): number {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  return h >>> 0;
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Stable per-point hash for renderers (pebbles, grain). */
export function fieldHash(x: number, y: number, seed: number): number {
  return hash2(x | 0, y | 0, seed);
}
