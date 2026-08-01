import { afterEach, describe, expect, it } from 'vitest';
import {
  generateTerrain,
  getBody,
  listWorldLayerIds,
  registerWorldLayer,
  unregisterWorldLayer,
} from '../src/index.js';

/**
 * The layer extension seam: TakeOn ships no layers of its own (mining stays
 * top-down, deposits + ice), but a module built on top can register a
 * generator and have it ride along with every `generateTerrain()` call
 * without forking core generation.
 */
describe('world layer extension seam', () => {
  afterEach(() => {
    unregisterWorldLayer('test-caves');
  });

  it('ships with nothing registered — a shipped body carries no extra layer data', () => {
    expect(listWorldLayerIds()).toEqual([]);
    const world = generateTerrain(getBody('moon')!);
    expect(Object.keys(world.layers)).toEqual([]);
  });

  it('a registered generator runs and attaches its result by id', () => {
    registerWorldLayer('test-caves', (body, seed, world) => ({
      tunnels: body.size,
      seedEcho: seed,
      surfaceSize: world.size,
    }));
    expect(listWorldLayerIds()).toContain('test-caves');

    const body = getBody('moon')!;
    const world = generateTerrain(body);
    expect(world.layers['test-caves']).toEqual({ tunnels: body.size, seedEcho: body.seed, surfaceSize: body.size });
  });

  it('is deterministic like the rest of generation', () => {
    registerWorldLayer('test-caves', (body, seed) => `${body.id}:${seed}`);
    const body = getBody('mars')!;
    const a = generateTerrain(body);
    const b = generateTerrain(body);
    expect(a.layers['test-caves']).toEqual(b.layers['test-caves']);
  });

  it('unregistering stops it from running on the next generation', () => {
    registerWorldLayer('test-caves', () => 'present');
    expect(generateTerrain(getBody('moon')!).layers['test-caves']).toBe('present');
    expect(unregisterWorldLayer('test-caves')).toBe(true);
    expect(generateTerrain(getBody('moon')!).layers['test-caves']).toBeUndefined();
  });
});
