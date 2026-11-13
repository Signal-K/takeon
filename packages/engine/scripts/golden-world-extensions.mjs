// Expected-output capture from the explicit historical TS oracle only.
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the pre-migration compiled engine index.js (1a8ced2)');
const { writeFileSync } = await import(pathToFileURL(process.argv[2]).href);
import {
  getBody,
  generateTerrain,
  registerDem,
  registerBiome,
  registerBodyKind,
  listBiomes,
  allowedBiomesForKind,
  blueNoiseMask,
} from './oracle/index.js';
const base = {
  ...getBody('moon'),
  size: 16,
  maxHeight: 12,
  terrain: { ...getBody('moon').terrain, craters: 2, roughness: 0.5 },
};
const cases = [];
function record(name, body, extra = {}) {
  const world = generateTerrain(body, 4212),
    voxels = [];
  for (let y = 0; y < world.size; y++)
    for (let x = 0; x < world.size; x++)
      for (let z = 0; z < world.maxHeight; z++) voxels.push(world.get(x, y, z));
  cases.push({ name, body: { ...body, ...extra }, seed: 4212, voxels });
}
record('ore-bands', {
  ...base,
  terrain: {
    ...base.terrain,
    oreRichness: 10,
    bands: [{ from: 0, to: 1, minerals: { 62: 1, 7: 2 } }],
  },
});
const dem = { size: 2, source: 'fixture', heights: [0, 0.5, 0.5, 1] };
registerDem('fixture', dem);
record('dem', { ...base, dem: 'fixture' }, { coreDEM: dem });
registerBiome({
  id: 'test-only',
  label: 'Test',
  help: 'Test',
  surface: [62],
  subsurface: [63],
  climate: { min: -999, max: 999 },
});
registerBodyKind({ id: 'test-kind', label: 'Test', parent: 'moon', allowedBiomes: ['test-only'] });
const biomes = listBiomes().map((b) => ({
  ...b,
  climate: b.climate ? [b.climate.min, b.climate.max] : undefined,
}));
record(
  'custom-biome',
  { ...base, kind: 'test-kind', terrain: { ...base.terrain, biomes: true } },
  { coreBiomes: biomes, coreAllowedBiomes: allowedBiomesForKind('test-kind') },
);
record('blue-noise', {
  ...base,
  terrain: { ...base.terrain, noise: { type: 'blue', frequency: 0.2 } },
});
writeFileSync(
  new URL('../../../golden/world-extensions.json', import.meta.url),
  JSON.stringify({
    cases,
    masks: [1, 42].map((seed) => ({ seed, size: 16, values: Array.from(blueNoiseMask(16, seed)) })),
  }),
);
