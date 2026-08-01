import type { BodyDef } from '../types.js';

/**
 * Body **kinds**: an inheritable preset tree above `BodyDef`. `BodyType`
 * ('planet'/'moon'/'asteroid'/'gaseous') is the coarse category gameplay
 * branches on; a *kind* is a specialisation of one ('earth-like', 'ice-moon',
 * 'c-type-asteroid', …) that bundles the physics/palette/weather/climate
 * defaults for that flavour of body, inheriting from its parent kind so a
 * host only overrides what's actually different.
 *
 * This is the seam for "landscapes inherit from parent types, and a host
 * game hands in real planetary properties" — `instantiateBody()` (in
 * `world/authoring.js`, which owns draft-building) resolves a kind's full
 * ancestry into defaults, then layers the host's own overrides (a real
 * temperature reading, a chosen seed, an id) on top to produce a concrete,
 * generatable `BodyDef`.
 */

/** The mergeable subset of `BodyDef` a kind can default. Never `id`/`name`/`seed` — those are always the instantiator's job. */
export type BodyKindDefaults = Partial<Omit<BodyDef, 'id' | 'name' | 'seed' | 'kind' | 'terrain'>> & {
  terrain?: Partial<BodyDef['terrain']>;
};

export interface BodyKind {
  id: string;
  label: string;
  /** Parent kind id to inherit defaults from; absent = a root kind. */
  parent?: string;
  help: string;
  defaults: BodyKindDefaults;
  /**
   * Biome ids (`world/biomes.js`) chunks of this kind may roll when
   * `terrain.biomes` is on. Absent = any registered biome is eligible.
   */
  allowedBiomes?: string[];
}

const registered = new Map<string, BodyKind>();
const BUILTIN_KIND_IDS = new Set<string>();

function define(kind: BodyKind): void {
  registered.set(kind.id, kind);
  BUILTIN_KIND_IDS.add(kind.id);
}

define({
  id: 'body',
  label: 'Generic body',
  help: 'Root of the kind tree — no opinions of its own.',
  defaults: {},
});

// ── Planets ──────────────────────────────────────────────────────────────

define({
  id: 'planet',
  parent: 'body',
  label: 'Planet',
  help: 'A gravitationally-rounded world with a real day/night cycle.',
  defaults: { type: 'planet', dayLength: 500, terrain: { roughness: 0.55, craters: 5, iceCaps: 0.1, oreRichness: 0.4 } },
});

define({
  id: 'rocky-planet',
  parent: 'planet',
  label: 'Rocky planet',
  help: 'Bare regolith/basalt world, no atmosphere to speak of — Mars-like.',
  defaults: {
    gravity: 3.7,
    solarFlux: 0.5,
    climate: { temperature: -60, tempVariance: 0.5 },
    weather: { 'dust-devil': 1.5, 'dust-storm': 0.6 },
  },
  allowedBiomes: ['redrock-desert', 'crater-highlands', 'dust-basin', 'frozen-tundra'],
});

define({
  id: 'earth-like',
  parent: 'planet',
  label: 'Earth-like',
  help: 'Temperate, breathable-coded world — the odd one out with green biomes.',
  defaults: {
    gravity: 9.8,
    solarFlux: 1,
    climate: { temperature: 14, tempVariance: 0.6 },
    weather: {},
    terrain: { oreRichness: 0.25 },
  },
  allowedBiomes: ['grassland-plains', 'temperate-forest', 'frozen-tundra', 'redrock-desert'],
});

// ── Gas giants ───────────────────────────────────────────────────────────

define({
  id: 'gaseous',
  parent: 'body',
  label: 'Gas giant',
  help:
    'No solid surface in reality; TakeOn represents it as a flat, storm-lashed cloud-platform ' +
    'world (a floating station or cloud-city scene), not literal atmosphere physics.',
  defaults: {
    type: 'gaseous',
    gravity: 22,
    solarFlux: 0.1,
    dayLength: 300,
    climate: { temperature: -140, tempVariance: 0.3 },
    weather: { 'dust-storm': 2.5, 'solar-storm': 1 },
    terrain: { roughness: 0.15, craters: 0, iceCaps: 0, oreRichness: 0.15 },
  },
  allowedBiomes: ['cloud-platform'],
});

// ── Moons ────────────────────────────────────────────────────────────────

define({
  id: 'moon',
  parent: 'body',
  label: 'Moon',
  help: 'A smaller, usually airless satellite world.',
  defaults: { type: 'moon', dayLength: 650, terrain: { roughness: 0.4, craters: 8, oreRichness: 0.35 } },
});

define({
  id: 'rocky-moon',
  parent: 'moon',
  label: 'Rocky moon',
  help: 'Cratered, airless regolith — our own Moon.',
  defaults: {
    gravity: 1.6,
    solarFlux: 1,
    climate: { temperature: -50, tempVariance: 0.7 },
    weather: { 'solar-storm': 0.9, 'meteor-shower': 1.1 },
  },
  allowedBiomes: ['crater-highlands', 'dust-basin', 'metallic-regolith'],
});

define({
  id: 'ice-moon',
  parent: 'moon',
  label: 'Ice moon',
  help: 'Fractured ice shell over a hidden ocean — Europa-like.',
  defaults: {
    gravity: 1.3,
    solarFlux: 0.14,
    climate: { temperature: -160, tempVariance: 0.2 },
    weather: { 'cryo-fog': 1.6, 'meteor-shower': 0.4 },
    terrain: { iceCaps: 0.85, roughness: 0.3, craters: 2 },
  },
  allowedBiomes: ['icefield', 'cryovolcanic'],
});

// ── Asteroids ────────────────────────────────────────────────────────────

define({
  id: 'asteroid',
  parent: 'body',
  label: 'Asteroid',
  help: 'Small, irregular, low-gravity rubble pile.',
  defaults: {
    type: 'asteroid',
    dayLength: 220,
    gravity: 0.28,
    solarFlux: 0.15,
    terrain: { irregular: true, roughness: 0.5, craters: 3, iceCaps: 0, oreRichness: 0.5 },
  },
});

define({
  id: 'c-type-asteroid',
  parent: 'asteroid',
  label: 'C-type asteroid',
  help: 'Carbonaceous — dark, volatile-rich rubble (Ceres/Bennu-like).',
  defaults: { climate: { temperature: -100, tempVariance: 0.1 }, minerals: { iron: 0.4, copper: 0.35, titanium: 0.25 } },
  allowedBiomes: ['carbonaceous-rubble', 'icefield'],
});

define({
  id: 'm-type-asteroid',
  parent: 'asteroid',
  label: 'M-type asteroid',
  help: 'Metallic — nickel-iron rich, the richest ore veins in the belt.',
  defaults: {
    climate: { temperature: -80, tempVariance: 0.1 },
    terrain: { oreRichness: 0.7 },
    minerals: { iron: 0.6, copper: 0.15, titanium: 0.25 },
  },
  allowedBiomes: ['metallic-regolith'],
});

define({
  id: 's-type-asteroid',
  parent: 'asteroid',
  label: 'S-type asteroid',
  help: 'Silicaceous/stony — the middle ground between C and M types.',
  defaults: { climate: { temperature: -90, tempVariance: 0.1 }, minerals: { iron: 0.45, copper: 0.3, titanium: 0.25 } },
  allowedBiomes: ['carbonaceous-rubble', 'metallic-regolith'],
});

/** Add or replace a kind at runtime. Built-ins can be shadowed but not removed (see `unregisterBodyKind`). */
export function registerBodyKind(kind: BodyKind): BodyKind {
  registered.set(kind.id, kind);
  return kind;
}

/** Remove a runtime-registered kind. Built-ins are never removed, only shadowed by `registerBodyKind`. */
export function unregisterBodyKind(id: string): boolean {
  if (BUILTIN_KIND_IDS.has(id)) return false;
  return registered.delete(id);
}

export function getBodyKind(id: string): BodyKind | undefined {
  return registered.get(id);
}

export function listBodyKinds(): BodyKind[] {
  return [...registered.values()];
}

/** Root-to-leaf ancestry of a kind (inclusive); `[]` for an unknown id or a cycle. */
export function bodyKindChain(id: string): BodyKind[] {
  const chain: BodyKind[] = [];
  const seen = new Set<string>();
  let cur = registered.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent ? registered.get(cur.parent) : undefined;
  }
  return chain;
}

/** Merge a kind's defaults down its ancestry, root first so the leaf kind wins conflicts. */
export function resolveBodyKind(id: string): BodyKindDefaults {
  let merged: BodyKindDefaults = {};
  for (const kind of bodyKindChain(id)) merged = mergeDefaults(merged, kind.defaults);
  return merged;
}

/** Biome ids allowed for a kind, walking up to the nearest ancestor that declares any. `undefined` = unrestricted. */
export function allowedBiomesForKind(id: string): string[] | undefined {
  const chain = bodyKindChain(id);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].allowedBiomes) return chain[i].allowedBiomes;
  }
  return undefined;
}

/**
 * Merge two default patches, deep-merging the nested objects (leaf/`patch`
 * wins per field). Careful not to assign an explicit `key: undefined` when
 * neither side sets it — `createBodyDraft`'s `Object.assign` would then
 * clobber its own default with `undefined` instead of leaving it alone.
 */
export function mergeDefaults(base: BodyKindDefaults, patch: BodyKindDefaults): BodyKindDefaults {
  const out: BodyKindDefaults = { ...base, ...patch };
  for (const key of ['palette', 'terrain', 'minerals', 'weather', 'climate'] as const) {
    const merged = { ...(base[key] as object | undefined), ...(patch[key] as object | undefined) };
    if (Object.keys(merged).length > 0) (out as Record<string, unknown>)[key] = merged;
    else delete (out as Record<string, unknown>)[key];
  }
  return out;
}
