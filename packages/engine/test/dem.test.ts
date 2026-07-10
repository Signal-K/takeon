import { describe, expect, it } from 'vitest';
import { BODIES, getDem } from '../src/index.js';
import { GENERATED_DEMS } from '../src/world/dem/generated.js';
import { EXPECTED_DEM_IDS } from '../src/world/dem/expected.js';

/**
 * Real-planetary-data regression guard.
 *
 * scripts/fetch-dem.mjs writes generated.ts (the height grids) and
 * expected.ts (the manifest of ids) together. Asserting generated against
 * expected means a lone revert of the data file back to `{}` fails here
 * instead of silently degrading Mars/Moon to procedural terrain.
 *
 * Until the fetch has been run (needs network access to trek.nasa.gov) both
 * files are empty and these checks are trivially green — they arm themselves
 * the moment real data is committed.
 */
describe('dem data integrity', () => {
  it('every patch promised by the manifest is embedded and well-formed', () => {
    for (const id of EXPECTED_DEM_IDS) {
      const patch = GENERATED_DEMS[id];
      expect(patch, `manifest expects '${id}' — re-run scripts/fetch-dem.mjs`).toBeDefined();
      expect(patch.size).toBeGreaterThanOrEqual(16);
      expect(patch.heights).toHaveLength(patch.size * patch.size);
      let min = Infinity;
      let max = -Infinity;
      for (const h of patch.heights) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
        if (h < min) min = h;
        if (h > max) max = h;
      }
      // Real terrain has relief — a constant grid means a decode failure.
      expect(max - min, `'${id}' grid is flat — bad decode?`).toBeGreaterThan(0.1);
      expect(patch.source).toContain('NASA');
    }
  });

  it('bodies that declare real terrain resolve their patch once data is embedded', () => {
    // Bodies may declare a dem id before the data lands (procedural fallback
    // is by design), but once the manifest promises data, every body-declared
    // id must resolve.
    if (EXPECTED_DEM_IDS.length === 0) return;
    for (const body of BODIES) {
      if (!body.dem) continue;
      expect(
        getDem(body.dem),
        `body '${body.id}' declares dem '${body.dem}' but no patch is embedded`,
      ).toBeDefined();
    }
  });

  it('manifest and data files agree (they are generated together)', () => {
    expect(Object.keys(GENERATED_DEMS).sort()).toEqual([...EXPECTED_DEM_IDS].sort());
  });
});
