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
    palette: { sky: '#2c2650', skyNight: '#0a0920', tint: [0.82, 0.84, 0.9] },
    terrain: { roughness: 0.45, craters: 9, iceCaps: 0.06, oreRichness: 0.35 },
    // Real relief: LRO LOLA patch (run scripts/fetch-dem.mjs to embed).
    dem: 'moon-imbrium',
    // Clementine UVVIS / M3: ilmenite-rich maria — titanium-heavy veins.
    minerals: { iron: 0.3, copper: 0.15, titanium: 0.55 },
    // Airless: radiation and impactors are the hazards.
    weather: { 'solar-storm': 0.9, 'meteor-shower': 1.1 },
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
    palette: { sky: '#d97e4a', skyNight: '#221026', tint: [1.06, 0.9, 0.8] },
    terrain: { roughness: 0.6, craters: 5, iceCaps: 0.12, oreRichness: 0.45 },
    // Real relief: MGS MOLA patch of the Jezero region (scripts/fetch-dem.mjs).
    dem: 'mars-jezero',
    // TES/GRS surveys: hematite-rich surface — iron-dominated veins.
    minerals: { iron: 0.62, copper: 0.23, titanium: 0.15 },
    // Thin CO2 atmosphere: dust is the story.
    weather: { 'dust-devil': 2.2, 'dust-storm': 0.8, 'meteor-shower': 0.3 },
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
    palette: { sky: '#2b4a8f', skyNight: '#0c1230', tint: [0.78, 0.95, 1.12] },
    terrain: { roughness: 0.3, craters: 2, iceCaps: 0.85, oreRichness: 0.25 },
    // Sublimating ice hazes; the odd stray impactor.
    weather: { 'cryo-fog': 1.6, 'meteor-shower': 0.4 },
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
    palette: { sky: '#3d3178', skyNight: '#100b2c', tint: [0.88, 0.9, 0.97] },
    terrain: { roughness: 0.5, craters: 12, iceCaps: 0.2, oreRichness: 0.55 },
    weather: { 'solar-storm': 0.7, 'meteor-shower': 0.8, 'cryo-fog': 0.5 },
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
    palette: { sky: '#2f2266', skyNight: '#0c0824', tint: [0.72, 0.72, 0.78] },
    terrain: { roughness: 0.85, craters: 4, iceCaps: 0, oreRichness: 0.7, irregular: true },
    weather: { 'solar-storm': 1.1, 'meteor-shower': 1.4 },
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
    palette: { sky: '#a85a2e', skyNight: '#1c0d20', tint: [1.12, 1.02, 0.68] },
    terrain: { roughness: 0.75, craters: 3, iceCaps: 0, oreRichness: 0.6, sulfurFields: 0.5 },
    // Jovian radiation belt + volcanic ejecta raining back down.
    weather: { 'solar-storm': 1.3, 'meteor-shower': 1.5 },
    description: 'Volcanic and sulfur-stained. Steep terrain chews through durability.',
  },
];

// `getBody` lives in ./registry.ts so runtime-registered bodies (editor
// drafts, backend rows) can shadow these built-ins.
