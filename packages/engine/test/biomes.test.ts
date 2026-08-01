import { describe, expect, it } from 'vitest';
import {
  chunkBiome,
  CHUNK_SIZE,
  generateTerrain,
  getBiome,
  getBody,
  instantiateBody,
  listBiomes,
  Material,
  MATERIALS,
  registerBiome,
  unregisterBiome,
  validateBody,
} from '../src/index.js';

describe('chunked biomes', () => {
  it('is opt-in — a shipped body without terrain.biomes ignores it entirely', () => {
    const body = getBody('mars')!;
    expect(body.terrain.biomes).toBeUndefined();
    const a = generateTerrain(body);
    const b = generateTerrain(body);
    // Same determinism guarantee as every other body: unaffected by this feature existing.
    expect(a.get(10, 10, a.height(10, 10))).toBe(b.get(10, 10, b.height(10, 10)));
  });

  it('chunkBiome is deterministic for the same body/seed/chunk', () => {
    const body = instantiateBody('rocky-planet', { id: 'chunk-test', name: 'Chunk Test', seed: 5 });
    const a = chunkBiome(body, 2, 3, body.seed);
    const b = chunkBiome(body, 2, 3, body.seed);
    expect(a.id).toBe(b.id);
  });

  it('respects the kind allow-list — a rocky-planet never rolls grassland', () => {
    const body = instantiateBody('rocky-planet', { id: 'allow-test', name: 'Allow Test', seed: 99 });
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = 0; cy < 6; cy++) {
        const b = chunkBiome(body, cx, cy, body.seed);
        expect(b.id).not.toBe('grassland-plains');
      }
    }
  });

  it('spreads more than one biome across a large enough world when climate allows it', () => {
    const body = instantiateBody('rocky-planet', { id: 'spread-test', name: 'Spread Test', seed: 3, size: 128 });
    const seen = new Set<string>();
    const chunks = Math.floor(body.size / CHUNK_SIZE);
    for (let cx = 0; cx < chunks; cx++) {
      for (let cy = 0; cy < chunks; cy++) seen.add(chunkBiome(body, cx, cy, body.seed).id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('generateTerrain actually paints biome materials onto the world when terrain.biomes is on', () => {
    const body = instantiateBody('rocky-planet', {
      id: 'paint-test',
      name: 'Paint Test',
      seed: 11,
      size: 48,
      maxHeight: 12,
      terrain: { roughness: 0.5, craters: 3, iceCaps: 0, oreRichness: 0.2, biomes: true },
    });
    expect(validateBody(body).ok).toBe(true);
    const world = generateTerrain(body);
    const surfaceMats = new Set<number>();
    for (let x = 0; x < world.size; x++) {
      for (let y = 0; y < world.size; y++) {
        const h = world.height(x, y);
        if (h >= 0) surfaceMats.add(world.get(x, y, h));
      }
    }
    // rocky-planet's allowed biomes never include Silica — the old flat skin's material.
    expect(surfaceMats.has(Material.Silica)).toBe(false);
  });

  it('custom biomes register, resolve and cannot clobber a built-in', () => {
    registerBiome({
      id: 'lava-flow',
      label: 'Lava flow',
      help: 'test biome',
      surface: [Material.Basalt],
    });
    expect(getBiome('lava-flow')?.surface).toEqual([Material.Basalt]);
    expect(listBiomes().some((b) => b.id === 'lava-flow')).toBe(true);
    expect(unregisterBiome('dust-basin')).toBe(false);
    expect(unregisterBiome('lava-flow')).toBe(true);
    expect(getBiome('lava-flow')).toBeUndefined();
  });

  it('every registered biome only references materials that actually exist', () => {
    for (const biome of listBiomes()) {
      for (const m of [...biome.surface, ...(biome.subsurface ?? [])]) {
        expect(MATERIALS[m]).toBeDefined();
      }
    }
  });
});
