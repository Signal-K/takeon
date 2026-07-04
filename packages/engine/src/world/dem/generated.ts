/**
 * GENERATED FILE — run `node scripts/fetch-dem.mjs` to populate.
 *
 * That script samples real elevation tiles (NASA MGS MOLA for Mars, LRO LOLA
 * for the Moon) from the NASA Trek tile services and rewrites this module
 * with real height grids. It needs direct network access to trek.nasa.gov,
 * which sandboxed CI environments may not have — the engine falls back to
 * procedural terrain for any body whose patch is missing here.
 */
import type { DemPatch } from './index.js';

export const GENERATED_DEMS: Record<string, DemPatch> = {};
