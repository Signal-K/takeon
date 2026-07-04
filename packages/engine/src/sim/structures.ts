import type { StructureDef, StructureType } from '../types.js';

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
  'habitat-frame': {
    type: 'habitat-frame',
    name: 'Habitat Frame',
    cost: { iron: 10, titanium: 4, silica: 6 },
    description: 'The first bones of a permanent outpost. Prestige construction.',
  },
};

/** Structure footprint must be flat within this height spread. */
export const BUILD_RADIUS = 2;
export const SOLAR_ARRAY_RANGE = 4;
export const SOLAR_ARRAY_RATE = 5;
export const DRILL_RATE_TICKS = 40; // sim ticks per voxel mined
