// Expected-output capture from the explicit historical TS oracle only.
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the pre-migration compiled engine index.js (1a8ced2)');
const {
  Simulation,
  EventBus,
  getBody,
  defaultSpec,
  PARTS,
  MATERIALS,
  STRUCTURES,
  RECIPES,
  MOBILITY_UPGRADE_COST,
  Material,
} = await import(pathToFileURL(process.argv[2]).href);
import { writeFileSync } from 'node:fs';
const config = () => ({
  body: {
    ...getBody('moon'),
    size: 16,
    maxHeight: 12,
    terrain: { ...getBody('moon').terrain, craters: 0, roughness: 0 },
  },
  spec: defaultSpec(),
  parts: PARTS,
  rules: { structures: STRUCTURES, recipes: RECIPES, mobilityCosts: MOBILITY_UPGRADE_COST },
  materials: MATERIALS,
});
const cases = [];
function scenario(name, prepare, kind, text = '', arg = 0, ticks = 0) {
  const c = config(),
    sim = new Simulation({ body: c.body, spec: c.spec, events: new EventBus(), seed: 4212 });
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 12; z++) sim.world.set(x, y, z, z <= 3 ? Material.Rock : Material.Air);
  sim.rover.pos = { x: 8, y: 8 };
  sim.rover.cargo = {
    iron: 100,
    silica: 100,
    regolith: 100,
    stone: 100,
    titanium: 100,
    copper: 100,
    'iron-plate': 100,
    alloy: 100,
    glass: 100,
  };
  sim.rover.cargoUsed = 900;
  sim.rover.stats.cargoCapacity = 2000;
  prepare(sim);
  const host = JSON.parse(
    JSON.stringify({
      ...sim,
      rover: sim.rover,
      edits: sim.world.edits,
      world: undefined,
      events: undefined,
    }),
  );
  let result;
  if (kind === 'move') result = sim.move(arg);
  else if (kind === 'mine') result = sim.mine();
  else if (kind === 'tick') {
    for (let i = 0; i < ticks; i++) sim.tick();
  } else if (text) result = sim[kind](text);
  else result = sim[kind]();
  cases.push({
    name,
    config: c,
    host,
    kind,
    text,
    arg,
    ticks,
    expected: {
      time: sim.time,
      rover: sim.rover,
      structures: sim.structures,
      photos: sim.photos,
      anomalies: sim.anomalies,
      status: sim.status,
      banked: sim.banked,
      edits: sim.world.edits,
      result,
    },
  });
}
scenario('build-cache', () => {}, 'build', 'cache');
scenario('craft-iron', () => {}, 'craft', 'iron-plate');
scenario('upgrade', () => {}, 'upgradeMobility');
scenario('repair', (s) => (s.rover.durability = 1), 'repair');
scenario('place', () => {}, 'placeBlock');
scenario(
  'scan',
  (s) => {
    s.rover.stats.scanRadius = 50;
    s.rover.stats.scanEnergy = 2;
  },
  'scan',
);
scenario('photo', (s) => (s.anomalies[0].pos = { x: 8, y: 8 }), 'photo');
scenario(
  'launch',
  (s) =>
    s.structures.push({ id: 'pad', type: 'launch-pad', pos: { x: 9, y: 8 }, buffer: { iron: 10 } }),
  'launchCargo',
);
scenario(
  'deposit',
  (s) => s.structures.push({ id: 'cache', type: 'cache', pos: { x: 9, y: 8 }, buffer: {} }),
  'depositCargo',
);
scenario(
  'powered-drill',
  (s) =>
    s.structures.push(
      { id: 'gen', type: 'generator', pos: { x: 7, y: 7 }, buffer: {} },
      { id: 'drill', type: 'drill-rig', pos: { x: 7, y: 8 }, buffer: {} },
    ),
  'tick',
  '',
  0,
  23,
);
scenario(
  'habitat',
  (s) => {
    s.rover.battery = 1;
    s.rover.durability = 1;
    s.structures.push({ id: 'hab', type: 'habitat', pos: { x: 7, y: 7 }, buffer: {} });
  },
  'tick',
  '',
  0,
  10,
);
writeFileSync(new URL('../../../golden/expanded.json', import.meta.url), JSON.stringify(cases));
