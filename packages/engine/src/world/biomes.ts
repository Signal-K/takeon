import { coreCall } from '../go/sync.js';
import { coreBody } from './core-data.js';
import { biomes } from '../data/core-catalog.js';
import { Material, type BodyDef } from '../types.js';

/**
 * Simple, chunk-scale biomes: the surface skin every shipped body has always
 * painted (a single organic patch pattern of two or three materials) split
 * into named, registered variants and assigned per-chunk instead of
 * per-body. A biome only dresses the top couple of surface voxels — ore
 * veins and depth strata stay `OreBand`'s job (`terrain.bands`), so the two
 * "layers" (a surface skin, a mineral economy underneath) stay independent
 * and composable.
 *
 * Purely additive and opt-in: a body only gets chunked biomes when its
 * `terrain.biomes` flag is set (`world/terrain.js`); every shipped body
 * keeps its original single-skin generation byte-identical.
 */

/** Region size, in voxels, that rolls one biome. */
export const CHUNK_SIZE = 16;

export interface Biome {
  id: string;
  label: string;
  help: string;
  /** Top-voxel material(s); a chunk picks among these by internal patch noise for texture, not one flat colour. */
  surface: Material[];
  /** Materials for the shallow subsurface (roughly the next 2 voxels down). Defaults to `surface`. */
  subsurface?: Material[];
  /** Inclusive gameplay-scaled °C range this biome may roll in. Absent = climate-agnostic, always eligible. */
  climate?: { min: number; max: number };
  /** Per-channel RGB multiplier layered on top of the body's own `palette.tint` for this biome's chunks. */
  tint?: [number, number, number];
}

const registered = new Map<string, Biome>();
const BUILTIN_BIOME_IDS = new Set<string>();

function define(biome: Biome): void {
  registered.set(biome.id, biome);
  BUILTIN_BIOME_IDS.add(biome.id);
}

for (const biome of biomes) define(biome as unknown as Biome);

/** Add or replace a biome at runtime. */
export function registerBiome(biome: Biome): Biome {
  registered.set(biome.id, biome);
  return biome;
}

/** Remove a runtime-registered biome. Built-ins are never removed, only shadowed by `registerBiome`. */
export function unregisterBiome(id: string): boolean {
  if (BUILTIN_BIOME_IDS.has(id)) return false;
  return registered.delete(id);
}

export function getBiome(id: string): Biome | undefined {
  return registered.get(id);
}

export function listBiomes(): Biome[] {
  return [...registered.values()];
}

/** Which chunk a voxel column belongs to. */
export function chunkCoords(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

/**
 * Deterministic biome pick for one chunk: gated by the body's `kind` (via
 * `allowedBiomesForKind`) and, if the body carries `climate`, by a per-chunk
 * temperature sampled around `climate.temperature` — swung by
 * `climate.tempVariance` so a single body can roll several climate-
 * compatible biomes across its chunks rather than one uniform one.
 * Always returns a biome; a pool that ends up empty (a typo'd kind allow-
 * list, a climate nothing fits) falls back to the full registry rather than
 * throwing.
 */
export function chunkBiome(body: BodyDef, cx: number, cy: number, seed: number): Biome {
  const id = coreCall<string>('biome', {
    seed: seed >>> 0,
    x: cx,
    y: cy,
    config: { body: coreBody(body) },
  });
  return registered.get(id)!;
}

/** Biome for the chunk containing voxel column (x, y). */
export function biomeAt(body: BodyDef, x: number, y: number, seed: number): Biome {
  const { cx, cy } = chunkCoords(x, y);
  return chunkBiome(body, cx, cy, seed);
}

/** Pick among a biome's material list by a 0..1 texture value (from the existing surface-patch noise). */
export function pickBiomeMaterial(materials: Material[], t: number): Material {
  if (materials.length === 0) return Material.Regolith;
  const idx = Math.min(materials.length - 1, Math.max(0, Math.floor(t * materials.length)));
  return materials[idx];
}
