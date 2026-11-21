import { simplex2 } from '../util/noise/index.js';
import { mulberry32 } from '../util/rng.js';
import type { Vec2 } from '../types.js';
import { getFieldDem, listFieldDems, sampleFieldDem } from './dem.js';
import type { FieldBoulder, FieldCrater, FieldDeposit, FieldStyle } from './terrain.js';

/**
 * Field PCG: terrain as a stack of layers (KES-543).
 *
 * A recipe is an ordered list of layer specs, `{ kind, ...params }`. Each kind
 * is a registered `FieldLayer` that can work in up to three passes:
 *
 * 1. `prepare` places point features before the height grid exists (craters).
 * 2. `shape` returns a per-sample function that adds height and tone.
 * 3. `place` runs on the finished surface and can read height and slope
 *    (boulders cluster on fresh rims, ore sits in hollows).
 *
 * The built-in layers use real data where it exists. `dem` lays down a window
 * of a real DTM (HiRISE on Mars, Kaguya on the Moon) in true metres;
 * `craters` draws sizes from a measured size-frequency power law; `boulders`
 * uses the Golombek–Rapp rock-abundance model. Procedural layers (`relief`,
 * `ridges`, `dunes`, `grain`) fill in where no data exists, or add detail
 * finer than the DTM resolves. Hosts register new kinds with
 * `registerFieldLayer` and compose recipes without touching the engine.
 * Everything is deterministic from `(recipe, seed)`.
 */

export interface FieldLayerSpec {
  kind: string;
  [param: string]: unknown;
}

export interface FieldRecipe {
  layers: FieldLayerSpec[];
}

/** What a layer sees while the field is generated. */
export interface FieldGenContext {
  readonly size: number;
  readonly seed: number;
  readonly style: FieldStyle;
  /** Mutable until the grid is built: a `dem` layer may move it to flat ground. */
  landing: Vec2;
  /** Radius around the landing kept flat and clear, metres. */
  readonly clear: number;
  readonly craters: FieldCrater[];
  readonly boulders: FieldBoulder[];
  readonly deposits: FieldDeposit[];
  /** Attribution for any real data used. */
  readonly sources: string[];
  /** Short HUD credits for real data used (e.g. "Jezero crater, Mars · HiRISE"). */
  readonly credits: string[];
  /** Resources the deposits draw from and how many, from the field options. */
  readonly resources: readonly string[];
  readonly depositCount: number;
  readonly depositScale: number;
  /** A seeded stream private to this layer. */
  rnd(): number;
  /** Finished-surface queries; valid in `place` only. */
  height(x: number, y: number): number;
  slope(x: number, y: number): number;
  tone(x: number, y: number): number;
  addBoulder(b: FieldBoulder): void;
  bouldersNear(x: number, y: number, r: number): FieldBoulder[];
}

/** Per-sample accumulator for `shape`. */
export interface FieldSample { h: number; tone: number }

export interface FieldLayer {
  kind: string;
  prepare?(ctx: FieldGenContext, p: FieldLayerSpec): void;
  shape?(ctx: FieldGenContext, p: FieldLayerSpec): ((x: number, y: number, s: FieldSample) => void) | null;
  place?(ctx: FieldGenContext, p: FieldLayerSpec): void;
}

const LAYERS = new Map<string, FieldLayer>();

export function registerFieldLayer(layer: FieldLayer): void {
  LAYERS.set(layer.kind, layer);
}

export function getFieldLayer(kind: string): FieldLayer | undefined {
  return LAYERS.get(kind);
}

export function listFieldLayers(): string[] {
  return [...LAYERS.keys()];
}

const num = (p: FieldLayerSpec, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);

// ── Built-in layers ────────────────────────────────────────────────────

/**
 * A window of a real DTM, in real metres. `id` picks a patch, or `body` picks
 * one of that body's patches by seed. The window position is seeded, so one
 * patch gives many different fields. If the field is wider than the patch, the
 * patch is stretched and its heights scaled by the same factor, so slopes stay
 * true. The landing moves to the flattest open ground near the middle.
 */
registerFieldLayer({
  kind: 'dem',
  prepare(ctx, p) {
    const id = typeof p.id === 'string' ? p.id : pickByBody(ctx, String(p.body ?? ''));
    const dem = id ? getFieldDem(id) : undefined;
    if (!dem) return;
    const stretch = Math.max(1, ctx.size / dem.extent);
    const span = dem.extent * stretch;
    const ox = ctx.rnd() * (span - ctx.size), oy = ctx.rnd() * (span - ctx.size);
    const vscale = num(p, 'scale', 1) / stretch;
    const sample = (x: number, y: number) => sampleFieldDem(dem, (x + ox) / stretch, (y + oy) / stretch) * vscale;
    let mean = 0;
    for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) mean += sample(ctx.size * i / 8, ctx.size * j / 8);
    mean /= 81;
    state.set(ctx, { ...(state.get(ctx) ?? {}), dem: (x: number, y: number) => sample(x, y) - mean, gsd: dem.gsd * stretch });
    ctx.sources.push(dem.source);
    ctx.credits.push(dem.label);
    if (p.landing !== false) ctx.landing = flattest(ctx, (x, y) => sample(x, y));
  },
  shape(ctx) {
    const s = state.get(ctx);
    if (!s?.dem) return null;
    const dem = s.dem;
    return (x, y, out) => { out.h += dem(x, y); };
  },
});

/** Rolling relief: two octaves of broad simplex. The procedural base. */
registerFieldLayer({
  kind: 'relief',
  shape(ctx, p) {
    const amp = num(p, 'amp', ctx.style.relief), seed = ctx.seed;
    return (x, y, out) => {
      out.h += (simplex2(x * 0.018, y * 0.018, seed) - 0.5) * amp * 2 + (simplex2(x * 0.05, y * 0.05, seed + 7) - 0.5) * amp * 0.6;
    };
  },
});

/** Folded-noise ridges with sharp crests. */
registerFieldLayer({
  kind: 'ridges',
  shape(ctx, p) {
    const amp = num(p, 'amp', ctx.style.ridges * ctx.style.relief * 1.4), f = num(p, 'freq', 0.03), seed = ctx.seed + 13;
    if (amp <= 0) return null;
    return (x, y, out) => {
      const r = 1 - Math.abs(simplex2(x * f, y * f, seed) * 2 - 1);
      out.h += Math.pow(r, 3) * amp;
    };
  },
});

/**
 * Transverse dunes: asymmetric ridges (gentle stoss, steep lee) across a wind
 * direction, warped by noise so crests wander and fork like Martian ripples.
 */
registerFieldLayer({
  kind: 'dunes',
  shape(ctx, p) {
    const wave = num(p, 'wavelength', 9), amp = num(p, 'amp', 0.5), wind = num(p, 'wind', ctx.rnd() * Math.PI);
    const cx = Math.cos(wind), cy = Math.sin(wind), seed = ctx.seed + 61;
    return (x, y, out) => {
      const warp = (simplex2(x * 0.04, y * 0.04, seed) - 0.5) * wave * 1.6;
      const ph = ((x * cx + y * cy + warp) / wave) % 1;
      const t = ph < 0 ? ph + 1 : ph;
      // Rise over 75% of the wavelength, fall over 25%.
      const prof = t < 0.75 ? t / 0.75 : (1 - t) / 0.25;
      const fade = simplex2(x * 0.02, y * 0.02, seed + 5);
      out.h += (prof * prof * (3 - 2 * prof) - 0.5) * amp * fade;
      out.tone += (prof - 0.5) * 0.08 * fade;
    };
  },
});

/** Fine undulation and albedo mottling, so no slope is ever a flat plane. */
registerFieldLayer({
  kind: 'grain',
  shape(ctx, p) {
    const amp = num(p, 'amp', 0.35), seed = ctx.seed;
    return (x, y, out) => {
      out.h += (simplex2(x * 0.22, y * 0.22, seed + 29) - 0.5) * amp;
      out.tone += (simplex2(x * 0.04, y * 0.04, seed + 41) - 0.5) * 0.8 + (simplex2(x * 0.13, y * 0.13, seed + 43) - 0.5) * 0.25;
    };
  },
});

/**
 * Craters from a cumulative size-frequency power law, N(≥D) = a·D^-b per m²
 * (D in metres). The default is the lunar small-crater equilibrium (Trask,
 * a = 0.0794, b = 2); younger surfaces such as Jezero take a smaller `a`.
 * `degraded` (0..1) is how worn the population is: old craters are shallow
 * with soft rims, fresh ones are deep with bright ejecta.
 */
registerFieldLayer({
  kind: 'craters',
  prepare(ctx, p) {
    const a = num(p, 'a', 0.0794), b = num(p, 'b', 2);
    // Wide (orbit) fields are seen from higher up: skip craters too small to read.
    const dMin = Math.max(num(p, 'dMin', 2), ctx.size / 64);
    const dMax = Math.min(num(p, 'dMax', ctx.style.maxCrater * 2), ctx.size / 3);
    const degraded = num(p, 'degraded', 0.5);
    const count = Math.min(1500, Math.round(ctx.size * ctx.size * a * Math.pow(dMin, -b)));
    for (let i = 0; i < count; i++) {
      // Inverse-CDF sample of a Pareto law, truncated at dMax.
      const d = Math.min(dMax, dMin * Math.pow(1 - ctx.rnd(), -1 / b));
      const r = d / 2, x = ctx.rnd() * ctx.size, y = ctx.rnd() * ctx.size;
      const fresh = Math.pow(ctx.rnd(), 1 + degraded * 3);
      if (Math.hypot(x - ctx.landing.x, y - ctx.landing.y) < ctx.clear + r) continue;
      // Depth/diameter: ~0.2 fresh, ~0.06 degraded.
      ctx.craters.push({ x, y, r, depth: d * (0.06 + 0.14 * fresh), fresh });
    }
  },
  shape(ctx) {
    if (!ctx.craters.length) return null;
    const cell = 16, cells = new Map<number, FieldCrater[]>();
    for (const c of ctx.craters) {
      const reach = c.r * 2.2;
      for (let cy = Math.floor((c.y - reach) / cell); cy <= Math.floor((c.y + reach) / cell); cy++)
        for (let cx = Math.floor((c.x - reach) / cell); cx <= Math.floor((c.x + reach) / cell); cx++) {
          const k = cy * 4096 + cx;
          (cells.get(k) ?? cells.set(k, []).get(k)!).push(c);
        }
    }
    const seed = ctx.seed;
    return (x, y, out) => {
      const list = cells.get(Math.floor(y / cell) * 4096 + Math.floor(x / cell));
      if (!list) return;
      for (const c of list) {
        const d = Math.hypot(x - c.x, y - c.y) / c.r;
        if (d > 2.2) continue;
        if (d < 1) {
          out.h += c.depth * (d * d - 1) + c.depth * 0.35;
          out.tone -= (1 - d) * 0.18;
        } else {
          const t = (d - 1) / 1.2;
          out.h += c.depth * 0.35 * Math.exp(-t * t * 6);
          out.tone += c.fresh * 0.35 * Math.exp(-(d - 1) * 2.2) * (0.6 + 0.4 * simplex2(x * 0.6, y * 0.6, seed + 3));
        }
      }
    };
  },
});

/**
 * Boulders from the Golombek–Rapp rock-abundance model: the fraction of ground
 * covered by rocks of diameter ≥ D is F(D) = k·exp(−q·D), q = 1.79 + 0.152/k.
 * `k` is the total rock abundance (Moon mare ~0.01–0.03, Mars landing sites
 * ~0.03–0.15). Only rocks of `dMin` and up become obstacles; smaller ones are
 * the renderer's grain. Some cluster on fresh crater rims as ejecta blocks.
 */
registerFieldLayer({
  kind: 'boulders',
  place(ctx, p) {
    const k = num(p, 'k', 0.04), q = 1.79 + 0.152 / k, dMax = num(p, 'dMax', 3.2);
    const dMin = Math.max(num(p, 'dMin', 0.6), ctx.size / 260);
    const rim = num(p, 'rim', 0.55), maxSlope = num(p, 'maxSlope', 0.6);
    const area = ctx.size * ctx.size;
    const F = (d: number) => k * Math.exp(-q * d);
    const rims = ctx.craters.filter(c => c.fresh > 0.4 && c.r > 1.5);
    for (let d0 = dMin; d0 < dMax; d0 += 0.2) {
      const d1 = d0 + 0.2, dm = d0 + 0.1;
      const n = Math.min(600, Math.round(area * (F(d0) - F(d1)) / (Math.PI * dm * dm / 4)));
      for (let i = 0; i < n; i++) {
        let x = ctx.rnd() * ctx.size, y = ctx.rnd() * ctx.size;
        if (rims.length && ctx.rnd() < rim) {
          const c = rims[Math.floor(ctx.rnd() * rims.length)];
          const a = ctx.rnd() * Math.PI * 2, r = c.r * (1.05 + ctx.rnd() * 0.8);
          x = c.x + Math.cos(a) * r; y = c.y + Math.sin(a) * r;
        }
        if (x < 1 || y < 1 || x > ctx.size - 1 || y > ctx.size - 1) continue;
        if (Math.hypot(x - ctx.landing.x, y - ctx.landing.y) < ctx.clear) continue;
        if (ctx.slope(x, y) > maxSlope) continue;
        const r = (d0 + ctx.rnd() * 0.2) / 2;
        ctx.addBoulder({ x, y, r, h: r * (0.7 + ctx.rnd() * 0.5), tone: ctx.rnd() });
      }
    }
  },
});

/**
 * Ore deposits: the first two a short drive from the landing, the rest in
 * hollows (crater floors, low ground on a real DTM) where they would collect.
 */
registerFieldLayer({
  kind: 'deposits',
  place(ctx, p) {
    const count = num(p, 'count', ctx.depositCount), scale = num(p, 'scale', ctx.depositScale);
    const resources = Array.isArray(p.resources) ? (p.resources as string[]) : ctx.resources;
    const L = ctx.landing;
    let tries = 0;
    while (ctx.deposits.length < count && tries++ < count * 60) {
      let x: number, y: number;
      if (ctx.deposits.length < 2) {
        const a = ctx.rnd() * Math.PI * 2, d = (7 + ctx.rnd() * 4) * scale;
        x = L.x + Math.cos(a) * d; y = L.y + Math.sin(a) * d;
      } else {
        // Best of a few candidates by how far below its surroundings it sits.
        let best = -Infinity; x = 0; y = 0;
        for (let c = 0; c < 6; c++) {
          let cx: number, cy: number;
          if (ctx.craters.length && ctx.rnd() < 0.4) {
            const cr = ctx.craters[Math.floor(ctx.rnd() * ctx.craters.length)];
            cx = cr.x + (ctx.rnd() - 0.5) * cr.r; cy = cr.y + (ctx.rnd() - 0.5) * cr.r;
          } else {
            const a = ctx.rnd() * Math.PI * 2, d = 12 + ctx.rnd() * ctx.size * 0.38;
            cx = L.x + Math.cos(a) * d; cy = L.y + Math.sin(a) * d;
          }
          const ring = 6 * scale;
          const around = (ctx.height(cx + ring, cy) + ctx.height(cx - ring, cy) + ctx.height(cx, cy + ring) + ctx.height(cx, cy - ring)) / 4;
          const score = around - ctx.height(cx, cy) - ctx.slope(cx, cy) * 4;
          if (score > best) { best = score; x = cx; y = cy; }
        }
      }
      if (x < 4 || y < 4 || x > ctx.size - 4 || y > ctx.size - 4) continue;
      if (ctx.slope(x, y) > 0.35) continue;
      if (ctx.deposits.some(d => Math.hypot(d.x - x, d.y - y) < 10 * scale)) continue;
      if (ctx.bouldersNear(x, y, 1.5).some(b => Math.hypot(b.x - x, b.y - y) < b.r + 1.5)) continue;
      // The first seam, a short drive away, is always the first resource (a host lists what the order wants first).
      const ri = ctx.deposits.length === 0 ? 0 : Math.min(resources.length - 1, Math.floor(Math.pow(ctx.rnd(), 1.6) * resources.length));
      ctx.deposits.push({ id: `dep-${ctx.deposits.length}`, x, y, r: (1.6 + ctx.rnd() * 1.4) * scale, resource: resources[ri] });
    }
  },
});

// ── Recipes ────────────────────────────────────────────────────────────

/**
 * The default recipe for a style. Moon and Mars start from real DTMs; bodies
 * with no surface data (asteroids, icy moons) are fully procedural.
 */
export function recipeForStyle(style: FieldStyle): FieldRecipe {
  const tail: FieldLayerSpec[] = [{ kind: 'deposits' }];
  switch (style.id) {
    case 'regolith':
      return { layers: [
        { kind: 'dem', body: 'moon' }, { kind: 'relief', amp: style.relief * 0.35 }, { kind: 'grain' },
        { kind: 'craters', a: 0.0794, b: 2, dMin: 2.5, degraded: 0.55 }, { kind: 'boulders', k: 0.025, dMin: 0.5 }, ...tail,
      ] };
    case 'rust':
      return { layers: [
        { kind: 'dem', body: 'mars' }, { kind: 'dunes', wavelength: 7, amp: 0.25 }, { kind: 'grain', amp: 0.2 },
        { kind: 'craters', a: 0.012, b: 2, dMin: 2.5, degraded: 0.75 }, { kind: 'boulders', k: 0.07, dMin: 0.6 }, ...tail,
      ] };
    default:
      return { layers: [
        { kind: 'relief' }, { kind: 'ridges' }, { kind: 'grain' },
        { kind: 'craters', a: 0.0794 * style.craters, b: 2, dMin: 2 }, { kind: 'boulders', k: Math.max(0.02, 0.005 * style.boulders), dMin: 0.6 }, ...tail,
      ] };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Per-generation scratch shared between a layer's passes. */
const state = new WeakMap<FieldGenContext, { dem?: (x: number, y: number) => number; gsd?: number }>();

function pickByBody(ctx: FieldGenContext, body: string): string | undefined {
  const list = listFieldDems(body);
  return list.length ? list[Math.floor(ctx.rnd() * list.length)].id : undefined;
}

/** The flattest spot on a coarse grid within the middle third. */
function flattest(ctx: FieldGenContext, h: (x: number, y: number) => number): Vec2 {
  const s = ctx.size, r = ctx.clear;
  let best = { x: s / 2, y: s / 2 }, bestScore = Infinity;
  for (let j = 0; j <= 6; j++)
    for (let i = 0; i <= 6; i++) {
      const x = s * (0.35 + 0.3 * i / 6), y = s * (0.4 + 0.3 * j / 6);
      const c = h(x, y);
      let dev = 0;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        dev += Math.abs(h(x + Math.cos(a) * r, y + Math.sin(a) * r) - c);
      }
      // A crater floor is flat too: penalise sitting below the ground around it, so the
      // rover does not start in a bowl with a rim between it and the camera.
      let ring = 0;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + Math.PI / 8;
        ring += h(x + Math.cos(a) * r * 3, y + Math.sin(a) * r * 3);
      }
      const sunk = Math.max(0, ring / 8 - c);
      // Prefer the middle a little so the rover is not pinned to an edge.
      const score = dev + sunk * 6 + Math.hypot(x - s / 2, y - s / 2) * 0.01;
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
  return best;
}
