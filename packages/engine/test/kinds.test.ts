import { describe, expect, it } from 'vitest';
import {
  allowedBiomesForKind,
  bodyKindChain,
  generateTerrain,
  getBodyKind,
  instantiateBody,
  listBodyKinds,
  registerBodyKind,
  resolveBodyKind,
  unregisterBodyKind,
  validateBody,
} from '../src/index.js';

describe('body kinds', () => {
  it('ships a kind tree rooted at "body" covering every BodyType', () => {
    const ids = listBodyKinds().map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(['body', 'planet', 'moon', 'asteroid', 'gaseous']));
    expect(getBodyKind('earth-like')?.parent).toBe('planet');
  });

  it('resolves a chain root-to-leaf and merges defaults, leaf wins', () => {
    const chain = bodyKindChain('earth-like');
    expect(chain.map((k) => k.id)).toEqual(['body', 'planet', 'earth-like']);

    const defaults = resolveBodyKind('earth-like');
    // earth-like overrides planet's climate; both set terrain, so terrain
    // must be a *merge*, not a replace (oreRichness from earth-like, iceCaps
    // inherited from planet).
    expect(defaults.climate?.temperature).toBe(14);
    expect(defaults.terrain?.oreRichness).toBe(0.25);
    expect(defaults.terrain?.iceCaps).toBe(0.1); // inherited from 'planet'
  });

  it('an unknown kind id resolves to an empty chain, not a throw', () => {
    expect(bodyKindChain('does-not-exist')).toEqual([]);
    expect(resolveBodyKind('does-not-exist')).toEqual({});
  });

  it('instantiateBody layers host overrides on top of kind defaults', () => {
    const body = instantiateBody('rocky-planet', {
      id: 'kepler-1',
      name: 'Kepler Test World',
      seed: 42,
      climate: { temperature: -30 }, // host's own model overrides the kind default (-60)
    });
    expect(body.type).toBe('planet');
    expect(body.kind).toBe('rocky-planet');
    expect(body.climate?.temperature).toBe(-30);
    expect(body.climate?.tempVariance).toBe(0.5); // inherited, not overridden
    expect(validateBody(body).ok).toBe(true);
  });

  it('an instantiated body generates like any hand-authored one', () => {
    const body = instantiateBody('ice-moon', { id: 'ice-test', name: 'Ice Test', seed: 7, size: 32, maxHeight: 10 });
    const world = generateTerrain(body);
    expect(world.size).toBe(32);
  });

  it('allowedBiomesForKind walks up to the nearest ancestor that declares any', () => {
    expect(allowedBiomesForKind('c-type-asteroid')).toEqual(['carbonaceous-rubble', 'icefield']);
    // 'asteroid' itself declares none; 'body' declares none either.
    expect(allowedBiomesForKind('asteroid')).toBeUndefined();
  });

  it('custom kinds register, resolve and cannot be used to clobber a built-in', () => {
    registerBodyKind({
      id: 'lava-moon',
      parent: 'moon',
      label: 'Lava moon',
      help: 'Tidally-heated volcanic moon.',
      defaults: { climate: { temperature: 400 }, terrain: { sulfurFields: 0.6 } },
    });
    const defaults = resolveBodyKind('lava-moon');
    expect(defaults.climate?.temperature).toBe(400);
    expect(defaults.terrain?.craters).toBe(8); // inherited from 'moon'

    expect(unregisterBodyKind('moon')).toBe(false); // built-in, refused
    expect(unregisterBodyKind('lava-moon')).toBe(true);
    expect(getBodyKind('lava-moon')).toBeUndefined();
  });
});
