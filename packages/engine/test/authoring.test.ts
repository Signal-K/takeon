import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeTerrain,
  BODIES,
  BODY_FIELDS,
  bodyToJson,
  bodyToTypeScript,
  clearRegisteredBodies,
  cloneBody,
  createBodyDraft,
  crossSection,
  forkBody,
  generateTerrain,
  getBody,
  getBodyField,
  heightField,
  listBodies,
  Material,
  parseBodyJson,
  reachableMask,
  registerBody,
  setBodyField,
  slopeField,
  unregisterBody,
  validateBody,
} from '../src/index.js';

afterEach(() => clearRegisteredBodies());

describe('body registry', () => {
  it('resolves built-ins when nothing is registered', () => {
    expect(getBody('mars')?.name).toBe('Mars');
    expect(listBodies().length).toBe(BODIES.length);
  });

  it('lets a registered body shadow a built-in without mutating it', () => {
    const patched = { ...getBody('mars')!, name: 'Mars (test)' };
    registerBody(patched);
    expect(getBody('mars')!.name).toBe('Mars (test)');
    expect(BODIES.find((b) => b.id === 'mars')!.name).toBe('Mars');
    expect(listBodies().length).toBe(BODIES.length);
    unregisterBody('mars');
    expect(getBody('mars')!.name).toBe('Mars');
  });

  it('appends custom bodies to the catalog', () => {
    registerBody(createBodyDraft({ id: 'test-rock', name: 'Test Rock' }));
    expect(listBodies().length).toBe(BODIES.length + 1);
    expect(getBody('test-rock')!.name).toBe('Test Rock');
  });
});

describe('body authoring', () => {
  it('drafts a body that passes validation and generates', () => {
    const draft = createBodyDraft({ id: 'draft-world', size: 48, maxHeight: 12 });
    const v = validateBody(draft);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    const world = generateTerrain(draft);
    expect(world.size).toBe(48);
    expect(world.isSolid(24, 24)).toBe(true);
  });

  it('reports the problems that would break generation', () => {
    const bad = createBodyDraft({ id: 'Bad Id', size: 4, maxHeight: 1000, gravity: 0 });
    const v = validateBody(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('id'))).toBe(true);
    expect(v.errors.some((e) => e.includes('size'))).toBe(true);
    expect(v.errors.some((e) => e.includes('maxHeight'))).toBe(true);
    expect(v.errors.some((e) => e.includes('gravity'))).toBe(true);
  });

  it('warns about legal-but-poor settings', () => {
    const draft = createBodyDraft({ terrain: { roughness: 0.95, craters: 4, iceCaps: 0, oreRichness: 0 } });
    const v = validateBody(draft);
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it('reads and writes dotted field paths immutably', () => {
    const draft = createBodyDraft();
    const next = setBodyField(draft, 'terrain.roughness', 0.83);
    expect(getBodyField(next, 'terrain.roughness')).toBe(0.83);
    expect(draft.terrain.roughness).not.toBe(0.83);

    const tinted = setBodyField(draft, 'palette.tint.1', 1.25);
    expect(tinted.palette.tint![1]).toBe(1.25);
    expect(draft.palette.tint![1]).toBe(1);

    // Clearing an optional field removes it rather than storing undefined.
    const cleared = setBodyField(createBodyDraft({ dem: 'mars-jezero' }), 'dem', '');
    expect('dem' in cleared).toBe(false);
  });

  it('exposes an inspector schema covering every editable path', () => {
    const draft = createBodyDraft();
    for (const field of BODY_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      // Every path must be resolvable (optional fields may be undefined).
      expect(() => getBodyField(draft, field.path)).not.toThrow();
    }
    expect(BODY_FIELDS.some((f) => f.path === 'terrain.roughness' && f.affectsTerrain)).toBe(true);
  });

  it('round-trips through JSON and forks cleanly', () => {
    const original = getBody('io')!;
    const { body, validation } = parseBodyJson(bodyToJson(original));
    expect(validation.ok).toBe(true);
    expect(body!.terrain).toEqual(original.terrain);
    expect(generateTerrain(body!).height(10, 10)).toBe(generateTerrain(original).height(10, 10));

    const fork = forkBody(original, 'io-2');
    fork.terrain.roughness = 0.1;
    expect(original.terrain.roughness).not.toBe(0.1);
    expect(cloneBody(original).minerals).toEqual(original.minerals);
  });

  it('rejects malformed JSON with a message instead of throwing', () => {
    const { body, validation } = parseBodyJson('{ not json');
    expect(body).toBeNull();
    expect(validation.ok).toBe(false);
  });

  it('emits a TypeScript literal for the built-in catalog', () => {
    const src = bodyToTypeScript(getBody('bennu')!);
    expect(src).toContain("id: 'bennu'".replace(/'/g, '"'));
    expect(src).toContain('irregular: true');
    expect(src.startsWith('{')).toBe(true);
    expect(src.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('terrain analysis', () => {
  const world = generateTerrain(getBody('moon')!);

  it('produces a height field matching the world', () => {
    const heights = heightField(world);
    expect(heights.length).toBe(world.size * world.size);
    expect(heights[10 * world.size + 10]).toBe(world.height(10, 10));
  });

  it('measures relief, materials and drivability', () => {
    const a = analyzeTerrain(world, { maxClimb: 2 });
    expect(a.size).toBe(world.size);
    expect(a.solidColumns).toBeGreaterThan(0);
    expect(a.maxHeight).toBeGreaterThanOrEqual(a.minHeight);
    expect(a.meanHeight).toBeGreaterThan(0);
    expect(a.relief).toBe(a.maxHeight - a.minHeight);
    expect(a.solidVoxels).toBeGreaterThan(a.solidColumns);
    // A gentle body should be almost entirely drivable from the landing site.
    expect(a.traversable.reachableFraction).toBeGreaterThan(0.8);
    expect(a.resources.stone ?? 0).toBeGreaterThan(0);
    expect(Object.keys(a.surface).length).toBeGreaterThan(1);
    expect(a.heightHistogram.reduce((s, n) => s + n, 0)).toBe(a.solidColumns);
  });

  it('is deterministic for the same world', () => {
    const a = analyzeTerrain(world);
    const b = analyzeTerrain(generateTerrain(getBody('moon')!));
    expect(b.meanHeight).toBeCloseTo(a.meanHeight, 10);
    expect(b.materials).toEqual(a.materials);
  });

  it('counts void columns on irregular worlds and never escapes them', () => {
    const bennu = generateTerrain(getBody('bennu')!);
    const a = analyzeTerrain(bennu);
    expect(a.voidFraction).toBeGreaterThan(0);
    const mask = reachableMask(bennu, a.landingSite, 2);
    for (let y = 0; y < bennu.size; y++) {
      for (let x = 0; x < bennu.size; x++) {
        if (mask[y * bennu.size + x]) expect(bennu.isSolid(x, y)).toBe(true);
      }
    }
  });

  it('flags cliffs in the slope field', () => {
    const slopes = slopeField(world);
    expect(slopes.length).toBe(world.size * world.size);
    expect(Math.max(...slopes)).toBeGreaterThan(0);
  });

  it('slices the world for cross-sections', () => {
    const slice = crossSection(world, 'y', 20);
    expect(slice.cells.length).toBe(world.maxHeight);
    expect(slice.cells[0].length).toBe(world.size);
    expect(slice.cells[0][20]).not.toBe(Material.Air); // bedrock row
  });
});
