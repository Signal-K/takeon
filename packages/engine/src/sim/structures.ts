import type { ResourceKey, StructureDef, StructureType } from '../types.js';

export const STRUCTURES: Record<StructureType, StructureDef> = {
  'solar-array': {
    type: 'solar-array',
    name: 'Solar Array',
    cost: { silica: 6, iron: 4 },
    description: 'Fixed panel farm. Recharges the rover quickly within 4 tiles (daylight only).',
  },
  beacon: {
    type: 'beacon',
    name: 'Nav Beacon',
    cost: { iron: 3, copper: 2 },
    description: 'Marks a site on the map and lights the area at night.',
  },
  'drill-rig': {
    type: 'drill-rig',
    name: 'Auto-Drill Rig',
    cost: { iron: 8, titanium: 2 },
    description: 'Slowly mines the column beneath it. Drive adjacent to collect its buffer.',
  },
  cache: {
    type: 'cache',
    name: 'Supply Cache',
    cost: { regolith: 4, iron: 2 },
    description: 'Deposit cargo here to bank it as mission yield and free up the hold.',
  },
  refinery: {
    type: 'refinery',
    name: 'Refinery',
    cost: { stone: 6, iron: 4 },
    description: 'Furnace module. Unlocks alloy smelting when the rover is parked beside it.',
  },
  'habitat-frame': {
    type: 'habitat-frame',
    name: 'Habitat Frame',
    cost: { 'iron-plate': 4, glass: 2, titanium: 2 },
    description: 'The first bones of a permanent outpost, raised from refined materials.',
  },
  'launch-pad': {
    type: 'launch-pad',
    name: 'Launch Pad',
    cost: { 'iron-plate': 5, alloy: 2, silica: 4 },
    description: 'Fuelled gantry. Park beside it and fire the hold home for instant yield — then it refuels before the next launch.',
  },
};

/** Structure footprint must be flat within this height spread. */
export const BUILD_RADIUS = 2;
export const SOLAR_ARRAY_RANGE = 4;
export const SOLAR_ARRAY_RATE = 5;
export const DRILL_RATE_TICKS = 40; // sim ticks per voxel mined
/** Game-seconds a launch pad refuels before it can fire again. */
export const LAUNCH_COOLDOWN = 40;
/** Mobility upgrades cap out here; each level adds climb, grip and speed. */
export const MAX_MOBILITY_UPGRADE = 3;
/** Refined-material cost to buy the next mobility level (index = current level). */
export const MOBILITY_UPGRADE_COST: Partial<Record<ResourceKey, number>>[] = [
  { 'iron-plate': 2, alloy: 1 },
  { 'iron-plate': 3, alloy: 2 },
  { 'iron-plate': 4, alloy: 3, titanium: 2 },
];

/** Cost of the next mobility upgrade for a rover at `level`, or null if maxed. */
export function nextMobilityUpgradeCost(level: number): Partial<Record<ResourceKey, number>> | null {
  if (level >= MAX_MOBILITY_UPGRADE) return null;
  return MOBILITY_UPGRADE_COST[level] ?? null;
}
