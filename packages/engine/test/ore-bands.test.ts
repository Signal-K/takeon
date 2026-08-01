import { describe, expect, it } from 'vitest';
import {
  BODIES,
  createBodyDraft,
  generateTerrain,
  getBody,
  Material,
  registerMaterial,
  unregisterMaterial,
  validateBody,
} from '../src/index.js';

/**
 * Depth-stratified ore, opt-in per body — the mechanic behind an "underground
 * cross-section" that actually shows different minerals at different depths
 * (topsoil / subsoil / bedrock), instead of one flat mix everywhere.
 */

const PLATINUM = 64;
const PALLADIUM = 65;

function registerPGMs(): void {
  registerMaterial({
    id: PLATINUM,
    name: 'Platinum ore',
    hardness: 5,
    yields: { resource: 'platinum', amount: 1 },
    colors: ['#e8e4d8', '#b8b4a8', '#8a8778'],
    jitter: 0.06,
  });
  registerMaterial({
    id: PALLADIUM,
    name: 'Palladium ore',
    hardness: 6,
    yields: { resource: 'palladium', amount: 1 },
    colors: ['#d4cce8', '#a8a0c8', '#7c74a0'],
    jitter: 0.06,
  });
}

describe('depth-banded terrain', () => {
  it('leaves every shipped body byte-identical (none set bands)', () => {
    for (const body of BODIES) expect(body.terrain.bands).toBeUndefined();
  });

  it('is absent by default, keeping the flat iron/copper/titanium mix', () => {
    const plain = createBodyDraft({ id: 'plain', size: 48, terrain: { roughness: 0.6, craters: 3, iceCaps: 0, oreRichness: 0.6 } });
    const world = generateTerrain(plain);
    let sawOre = false;
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const h = world.height(x, y);
        for (let z = 0; z <= h; z++) {
          const m = world.get(x, y, z);
          if (m === Material.IronOre || m === Material.CopperOre || m === Material.TitaniumOre) sawOre = true;
        }
      }
    }
    expect(sawOre).toBe(true);
  });

  it('stratifies ore by depth once bands are set', () => {
    registerPGMs();
    try {
      const body = createBodyDraft({
        id: 'strata',
        size: 56,
        maxHeight: 20,
        terrain: {
          roughness: 0.7,
          craters: 2,
          iceCaps: 0,
          oreRichness: 0.9, // rich, so the test sees plenty of ore
          bands: [
            { from: 0, to: 0.5, label: 'Topsoil', minerals: { [PLATINUM]: 1 } },
            { from: 0.5, to: 1, label: 'Bedrock', minerals: { [PALLADIUM]: 1 } },
          ],
        },
      });
      const world = generateTerrain(body);

      let shallowPt = 0;
      let shallowPd = 0;
      let deepPt = 0;
      let deepPd = 0;
      for (let y = 0; y < world.size; y++) {
        for (let x = 0; x < world.size; x++) {
          const h = world.height(x, y);
          if (h < 1) continue;
          for (let z = 0; z <= h; z++) {
            const depth = h - z;
            const frac = depth / h;
            const m = world.get(x, y, z);
            if (m === PLATINUM) frac <= 0.5 ? shallowPt++ : deepPt++;
            if (m === PALLADIUM) frac <= 0.5 ? shallowPd++ : deepPd++;
          }
        }
      }

      expect(shallowPt).toBeGreaterThan(0);
      expect(deepPd).toBeGreaterThan(0);
      // The bands are exclusive: platinum stays shallow, palladium stays deep.
      expect(deepPt).toBe(0);
      expect(shallowPd).toBe(0);
    } finally {
      unregisterMaterial(PLATINUM);
      unregisterMaterial(PALLADIUM);
    }
  });

  it('is deterministic for the same body and seed', () => {
    registerPGMs();
    try {
      const body = createBodyDraft({
        id: 'strata-det',
        size: 40,
        seed: 55,
        terrain: {
          roughness: 0.5,
          craters: 1,
          iceCaps: 0,
          oreRichness: 0.7,
          bands: [{ from: 0, to: 1, minerals: { [PLATINUM]: 2, [PALLADIUM]: 1 } }],
        },
      });
      const a = generateTerrain(body);
      const b = generateTerrain(body);
      for (let i = 0; i < 300; i++) {
        const x = (i * 7) % 40;
        const y = (i * 13) % 40;
        expect(a.height(x, y)).toBe(b.height(x, y));
        for (let z = 0; z <= a.height(x, y); z++) expect(a.get(x, y, z)).toBe(b.get(x, y, z));
      }
    } finally {
      unregisterMaterial(PLATINUM);
      unregisterMaterial(PALLADIUM);
    }
  });

  it('validates band ranges and mineral weights', () => {
    const bad = createBodyDraft({
      terrain: {
        roughness: 0.5,
        craters: 2,
        iceCaps: 0,
        oreRichness: 0.5,
        bands: [
          { from: -0.2, to: 1.4, minerals: {} },
          { from: 0.6, to: 0.2, minerals: { [Material.IronOre]: 1 } },
        ],
      },
    });
    const v = validateBody(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('.from must be between 0 and 1'))).toBe(true);
    expect(v.errors.some((e) => e.includes('.to must be between 0 and 1'))).toBe(true);
    expect(v.errors.some((e) => e.includes('at least one mineral'))).toBe(true);
    expect(v.errors.some((e) => e.includes('must not be greater than .to'))).toBe(true);
  });

  it('warns about overlapping or uncovered bands but still validates', () => {
    const overlap = createBodyDraft({
      terrain: {
        roughness: 0.5,
        craters: 2,
        iceCaps: 0,
        oreRichness: 0.5,
        bands: [
          { from: 0, to: 0.6, minerals: { [Material.IronOre]: 1 } },
          { from: 0.4, to: 1, minerals: { [Material.CopperOre]: 1 } },
        ],
      },
    });
    const v = validateBody(overlap);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.includes('overlap'))).toBe(true);

    const gap = createBodyDraft({
      terrain: {
        roughness: 0.5,
        craters: 2,
        iceCaps: 0,
        oreRichness: 0.5,
        bands: [{ from: 0, to: 0.3, minerals: { [Material.IronOre]: 1 } }],
      },
    });
    expect(validateBody(gap).warnings.some((w) => w.includes('uncovered'))).toBe(true);
  });

  it('works alongside a custom noise field on the same body', () => {
    registerPGMs();
    try {
      const body = createBodyDraft({
        id: 'strata-noise',
        size: 40,
        terrain: {
          roughness: 0.6,
          craters: 0,
          iceCaps: 0,
          oreRichness: 0.8,
          noise: { type: 'simplex', frequency: 0.06, octaves: 3 },
          bands: [{ from: 0, to: 1, minerals: { [PLATINUM]: 1 } }],
        },
      });
      expect(() => generateTerrain(body)).not.toThrow();
      const world = generateTerrain(body);
      expect(world.isSolid(20, 20)).toBe(true);
    } finally {
      unregisterMaterial(PLATINUM);
    }
  });
});
