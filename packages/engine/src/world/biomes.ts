import { Material, type BodyDef } from '../types.js';
import { hash2 } from '../util/rng.js';
import { allowedBiomesForKind } from './kinds.js';

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

define({
  id: 'dust-basin',
  label: 'Dust basin',
  help: 'Fine wind-blown dust filling low ground — the default airless-body skin.',
  surface: [Material.Dust],
  subsurface: [Material.Regolith],
});

define({
  id: 'redrock-desert',
  label: 'Redrock desert',
  help: 'Oxidised regolith and drifted dust — Mars-flavoured.',
  surface: [Material.Regolith, Material.Dust],
  tint: [1.08, 0.85, 0.72],
});

define({
  id: 'crater-highlands',
  label: 'Crater highlands',
  help: 'Rockier, older terrain — impact-churned rubble instead of settled dust.',
  surface: [Material.Rock, Material.Regolith],
});

define({
  id: 'frozen-tundra',
  label: 'Frozen tundra',
  help: 'Snow-crusted ground, cold enough that dust freezes rather than drifts.',
  surface: [Material.Snow, Material.Regolith],
  subsurface: [Material.Ice, Material.Regolith],
  climate: { min: -999, max: -10 },
});

define({
  id: 'grassland-plains',
  label: 'Grassland plains',
  help: 'Open, temperate ground cover — needs a breathable-coded, mild world.',
  surface: [Material.Grass],
  climate: { min: 0, max: 32 },
});

define({
  id: 'temperate-forest',
  label: 'Temperate forest',
  help: 'Grass broken by exposed rock — the shipped renderer has no trees yet, so this reads as scrubland.',
  surface: [Material.Grass, Material.Rock],
  climate: { min: -5, max: 26 },
});

define({
  id: 'icefield',
  label: 'Icefield',
  help: 'Solid ice sheet, cracked and wind-scoured.',
  surface: [Material.Ice, Material.Snow],
});

define({
  id: 'cryovolcanic',
  label: 'Cryovolcanic',
  help: 'Ice fractured by sulfur-stained cryovolcanic vents.',
  surface: [Material.Ice, Material.Sulfur],
});

define({
  id: 'carbonaceous-rubble',
  label: 'Carbonaceous rubble',
  help: 'Dark, volatile-rich rubble pile — Bennu/Ceres-flavoured.',
  surface: [Material.Basalt, Material.Dust],
});

define({
  id: 'metallic-regolith',
  label: 'Metallic regolith',
  help: 'Dust and rubble with a metallic sheen from a nickel-iron-rich body — ore stays vein-only, this is just the skin.',
  surface: [Material.Regolith, Material.Rock],
  tint: [0.9, 0.92, 0.98],
});

define({
  id: 'cloud-platform',
  label: 'Cloud platform',
  help: 'A storm-grey floating platform world — the gas-giant "surface" TakeOn represents.',
  surface: [Material.Basalt, Material.Rock],
  tint: [0.85, 0.87, 1.02],
});

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
  const allowed = body.kind ? allowedBiomesForKind(body.kind) : undefined;
  let pool = allowed
    ? (allowed.map((id) => registered.get(id)).filter((b): b is Biome => b != null))
    : [...registered.values()];
  if (pool.length === 0) pool = [...registered.values()];

  const climate = body.climate;
  if (climate) {
    const swing = (climate.tempVariance ?? 0.5) * 60;
    const t = climate.temperature + (hash2(cx, cy, seed + 401) * 2 - 1) * swing;
    const fits = pool.filter((b) => !b.climate || (t >= b.climate.min && t <= b.climate.max));
    if (fits.length > 0) pool = fits;
  }

  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const idx = Math.min(sorted.length - 1, Math.floor(hash2(cx, cy, seed + 977) * sorted.length));
  return sorted[idx];
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
