import type { BodyDef } from '../types.js';

/**
 * Built-in destination catalog. A backend can extend/override this list —
 * anything matching BodyDef renders and simulates without engine changes.
 * Values are gameplay-scaled but keep the real relative ordering
 * (gravity, sunlight, delta-v) of the actual bodies.
 */
export const BODIES: BodyDef[] = [
  {
    id: 'moon',
    name: 'The Moon',
    type: 'moon',
    gravity: 1.62,
    solarFlux: 1.0,
    dayLength: 600,
    deltaV: 30,
    size: 96,
    maxHeight: 14,
    seed: 1969,
    palette: { sky: '#10131c', skyNight: '#05060c' },
    terrain: { roughness: 0.45, craters: 9, iceCaps: 0.06, oreRichness: 0.35 },
    description: 'Close, well-lit and gentle. Titanium in the maria, ice in shadowed polar craters.',
  },
  {
    id: 'mars',
    name: 'Mars',
    type: 'planet',
    gravity: 3.71,
    solarFlux: 0.43,
    dayLength: 500,
    deltaV: 55,
    size: 112,
    maxHeight: 18,
    seed: 4212,
    palette: { sky: '#c98b62', skyNight: '#1a0f12' },
    terrain: { roughness: 0.6, craters: 5, iceCaps: 0.12, oreRichness: 0.45 },
    description: 'Rusty canyons and dust. Iron-rich, with polar ice and long, dim days.',
  },
  {
    id: 'europa',
    name: 'Europa',
    type: 'moon',
    gravity: 1.31,
    solarFlux: 0.14,
    dayLength: 850,
    deltaV: 80,
    size: 96,
    maxHeight: 10,
    seed: 1610,
    palette: { sky: '#233043', skyNight: '#0a0d16' },
    terrain: { roughness: 0.3, craters: 2, iceCaps: 0.85, oreRichness: 0.25 },
    description: 'A shell of fractured ice over a hidden ocean. Solar power is scarce out here.',
  },
  {
    id: 'ceres',
    name: 'Ceres',
    type: 'asteroid',
    gravity: 0.28,
    solarFlux: 0.15,
    dayLength: 220,
    deltaV: 65,
    size: 80,
    maxHeight: 12,
    seed: 1801,
    palette: { sky: '#171a20', skyNight: '#07080c' },
    terrain: { roughness: 0.5, craters: 12, iceCaps: 0.2, oreRichness: 0.55 },
    description: 'The belt’s dwarf planet. Bright salt flats, buried brines and easy launches.',
  },
  {
    id: 'bennu',
    name: 'Bennu',
    type: 'asteroid',
    gravity: 0.06,
    solarFlux: 0.9,
    dayLength: 130,
    deltaV: 45,
    size: 56,
    maxHeight: 10,
    seed: 1999,
    palette: { sky: '#0d0f14', skyNight: '#05060a' },
    terrain: { roughness: 0.85, craters: 4, iceCaps: 0, oreRichness: 0.7, irregular: true },
    description: 'A rubble pile you could jump off of. Rich, rough and unforgiving to wheels.',
  },
  {
    id: 'io',
    name: 'Io',
    type: 'moon',
    gravity: 1.8,
    solarFlux: 0.14,
    dayLength: 620,
    deltaV: 85,
    size: 96,
    maxHeight: 20,
    seed: 1979,
    palette: { sky: '#4a3b28', skyNight: '#120b08' },
    terrain: { roughness: 0.75, craters: 3, iceCaps: 0, oreRichness: 0.6, sulfurFields: 0.5 },
    description: 'Volcanic and sulfur-stained. Steep terrain chews through durability.',
  },
];

export function getBody(id: string): BodyDef | undefined {
  return BODIES.find((b) => b.id === id);
}
