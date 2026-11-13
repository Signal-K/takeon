import { materials } from '../data/core-catalog.js';
import { Material, type MaterialDef, type ResourceKey } from '../types.js';

/**
 * Saturated, stylised material palette (Crashlands-adjacent): warm golds and
 * ochres for soils, oxidised teal copper, vivid crystal. Deliberately not
 * grey — side faces darken toward purple rather than desaturating.
 */
export const MATERIALS = materials as unknown as Record<Material, MaterialDef>;

export const RESOURCE_NAMES: Record<ResourceKey, string> = {
  regolith: 'Regolith',
  stone: 'Stone',
  ice: 'Water ice',
  iron: 'Iron',
  silica: 'Silica',
  copper: 'Copper',
  titanium: 'Titanium',
  crystal: 'Crystal',
  sulfur: 'Sulfur',
  'iron-plate': 'Iron plate',
  glass: 'Glass',
  water: 'Water',
  alloy: 'Ti-alloy',
};

/**
 * Runtime material/resource registry.
 *
 * TakeOn ships a Mars-rover-flavoured catalog (regolith, iron, copper…), but a
 * different game built on the engine — a precious-metals mining game, say —
 * needs its own voxel materials and cargo resource keys. `Material` and
 * `ResourceKey` are open types precisely so this doesn't require a fork:
 * register new entries and every built-in lookup (`MATERIALS[id]`, terrain
 * generation, both renderers, the editor's maps/analysis) picks them up with
 * no other change, because `MATERIALS`/`RESOURCE_NAMES` are plain mutable
 * objects, not closed enums.
 *
 * Use ids at or above `CUSTOM_MATERIAL_BASE` (64) so a body shared between
 * hosts never collides with another game's custom materials.
 */

/** Add or replace a voxel material. Returns the id that was registered. */
export function registerMaterial(def: MaterialDef): Material {
  MATERIALS[def.id] = def;
  return def.id;
}

/** Remove a registered material. Built-ins (id < `CUSTOM_MATERIAL_BASE`) refuse to unregister. */
export function unregisterMaterial(id: Material): boolean {
  if (id < 64 || !(id in MATERIALS)) return false;
  delete MATERIALS[id];
  return true;
}

/** Every material currently known, built-in and registered. */
export function listMaterials(): MaterialDef[] {
  return Object.values(MATERIALS);
}

/**
 * Give a resource key a display name (`RESOURCE_NAMES[key]`). Pair with
 * `registerResourceValue` (`net/sync.js`) to price it for mission payouts.
 */
export function registerResource(key: ResourceKey, name: string): void {
  RESOURCE_NAMES[key] = name;
}
