import type { ResourceKey, StructureDef, StructureType } from '../types.js';

import { rules } from '../data/core-catalog.js';
export const STRUCTURES = rules.structures as unknown as Record<StructureType, StructureDef>;

/**
 * Runtime structure registry.
 *
 * `StructureType` is an open string type so a host's own construction
 * catalog — a settlement core, a research lab, a fuel depot, whatever its
 * economy needs — can be added without forking the engine. `STRUCTURES` is a
 * plain mutable object, so registering (or replacing) an entry here is picked
 * up everywhere a structure type is looked up: `Simulation.build()`, the
 * build menu (`@takeon/ui`'s `BuildPanel`), the flat view's entity glyphs
 * (register a matching `registerFlatPainter('structure', …)` variant keyed
 * off `entity.variant` for a custom look), and save/load.
 */

/** Add or replace a structure definition. Returns the type that was registered. */
export function registerStructure(def: StructureDef): StructureType {
  STRUCTURES[def.type] = def;
  return def.type;
}

/** Remove a registered structure type. The 10 built-ins refuse to unregister. */
export function unregisterStructure(type: StructureType): boolean {
  if (type in BUILTIN_STRUCTURE_TYPES) return false;
  if (!(type in STRUCTURES)) return false;
  delete STRUCTURES[type];
  return true;
}

/** Every structure definition currently known, built-in and registered. */
export function listStructures(): StructureDef[] {
  return Object.values(STRUCTURES);
}

const BUILTIN_STRUCTURE_TYPES: Record<string, true> = Object.fromEntries(
  Object.keys(STRUCTURES).map((type) => [type, true as const]),
);

/** Structure footprint must be flat within this height spread. */
export const BUILD_RADIUS = 2;
export const SOLAR_ARRAY_RANGE = 4;
export const SOLAR_ARRAY_RATE = 5;
export const DRILL_RATE_TICKS = 40; // sim ticks per voxel mined
export const DRILL_RATE_TICKS_POWERED = 22; // powered drills run faster
/** Game-seconds a launch pad refuels before it can fire again. */
export const LAUNCH_COOLDOWN = 40;

// ── Outpost power grid ─────────────────────────────────────────────────────
/** Chebyshev tile radius a power source (or relaying pylon) energises. */
export const POWER_RANGE = 5;
/** Units a launch pad must accumulate from drill lines before it auto-fires. */
export const AUTO_LAUNCH_THRESHOLD = 12;
/** Habitat-frame construction: fraction of progress gained per second when powered. */
export const HABITAT_BUILD_RATE = 1 / 30; // ~30s to finish once powered
/** A finished habitat services a rover parked within this Chebyshev radius. */
export const HABITAT_SERVICE_RANGE = 2;
/** Habitat passive support while a rover is parked in range. */
export const HABITAT_RECHARGE = 6; // battery/sec
export const HABITAT_REPAIR = 1.5; // durability/sec
/** Mobility upgrades cap out here; each level adds climb, grip and speed. */
export const MAX_MOBILITY_UPGRADE = 3;
/** Refined-material cost to buy the next mobility level (index = current level). */
export const MOBILITY_UPGRADE_COST = rules.mobilityCosts as Partial<Record<ResourceKey, number>>[];

/** Cost of the next mobility upgrade for a rover at `level`, or null if maxed. */
export function nextMobilityUpgradeCost(
  level: number,
): Partial<Record<ResourceKey, number>> | null {
  if (level >= MAX_MOBILITY_UPGRADE) return null;
  return MOBILITY_UPGRADE_COST[level] ?? null;
}
