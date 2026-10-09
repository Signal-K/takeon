/**
 * Golden-vector dump for the Go core spike (docs/go-core-spike.md).
 * Reads the engine; changes nothing in it.
 *
 *   npx -y esbuild packages/engine/scripts/golden.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/takeon-golden.mjs && node /tmp/takeon-golden.mjs golden
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mulberry32, hash2, hash3 } from '../src/util/rng.js';
import { valueNoise2, fbm2, perlin2, simplex2, worley2, makeNoise } from '../src/util/noise/index.js';
import type { NoiseConfig } from '../src/util/noise/index.js';
import { BODIES } from '../src/world/bodies.js';
import { generateTerrain, findLandingSite } from '../src/world/terrain.js';
import { generateAnomalies } from '../src/world/anomalies.js';
import { Simulation } from '../src/sim/simulation.js';
import { defaultSpec } from '../src/parts/assembly.js';
import { EventBus } from '../src/util/events.js';
import { CHUNK_SIZE } from '../src/world/biomes.js';
import { PARTS } from '../src/parts/catalog.js';

const out = process.argv[2] ?? 'golden';
mkdirSync(out, { recursive: true });
const dump = (name: string, data: unknown) => writeFileSync(`${out}/${name}.json`, JSON.stringify(data));

// (a) rng + hashes -------------------------------------------------------
const RNG_SEEDS = [0, 1, 4212, 3735928559, -7];
dump('rng', {
  mulberry32: RNG_SEEDS.map((seed) => {
    const r = mulberry32(seed);
    return { seed, out: Array.from({ length: 1000 }, () => r()) };
  }),
});

const hashSeeds = [0, 1, 1969, 4212, 0x51ab, -1, 3735928559];
const coords = [0, 1, 2, 7, 15, 16, 63, 111, 127, -1, -5, 1000, 123457, -98765, 3999999, 5000000, 123456789];
const h2: number[][] = [];
const h3: number[][] = [];
for (const s of hashSeeds)
  for (const x of coords)
    for (const y of coords.slice(0, 12)) {
      h2.push([x, y, s, hash2(x, y, s)]);
      h3.push([x, y, (x + y) & 31, s, hash3(x, y, (x + y) & 31, s)]);
    }
dump('hash', { hash2: h2, hash3: h3 });

// (b) noise grids --------------------------------------------------------
const grid: [number, number][] = [];
for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) grid.push([i * 0.731 - 3.17, j * 0.613 + 0.29]);
// extra samples at lattice points / near cell boundaries
for (const v of [0, 1, 2, 5, -1, 10.5]) grid.push([v, v], [v + 1e-9, v - 1e-9]);
const NSEEDS = [1969, 4212, 77];
const noise: Record<string, number[][]> = {};
const fns: Record<string, (x: number, y: number, s: number) => number> = {
  value: valueNoise2,
  fbm: (x, y, s) => fbm2(x, y, s, 4),
  perlin: perlin2,
  simplex: simplex2,
  worley_f1: (x, y, s) => worley2(x, y, s, 'f1'),
  worley_f2f1: (x, y, s) => worley2(x, y, s, 'f2f1'),
  worley_cells: (x, y, s) => worley2(x, y, s, 'cells'),
};
for (const [name, fn] of Object.entries(fns)) {
  noise[name] = [];
  for (const s of NSEEDS) for (const [x, y] of grid) noise[name].push([x, y, s, fn(x, y, s)]);
}
const cfgs: Record<string, NoiseConfig> = {
  perlin_ridged: { type: 'perlin', fractal: 'ridged', frequency: 0.04, octaves: 5 },
  simplex_billow_warp: { type: 'simplex', fractal: 'billow', warp: 6, frequency: 0.03 },
  worley_cracks: { type: 'worley-cracks', frequency: 0.06, octaves: 3 },
  value_default: {},
};
const makeNoiseOut: Record<string, unknown> = {};
for (const [name, cfg] of Object.entries(cfgs)) {
  const pts: number[][] = [];
  for (const seed of [1969, 4212]) {
    const f = makeNoise(cfg, seed);
    for (let y = 0; y < 96; y += 5) for (let x = 0; x < 96; x += 5) pts.push([x, y, seed, f(x, y)]);
  }
  makeNoiseOut[name] = { cfg, pts };
}
const hyp: number[][] = [];
{
  const r = mulberry32(99);
  for (let i = 0; i < 2000; i++) {
    const a = (r() - 0.5) * 200, b = (r() - 0.5) * 200;
    hyp.push([a, b, Math.hypot(a, b)]);
  }
}
const trig: number[][] = [];
{
  const r = mulberry32(5);
  for (let i = 0; i < 5000; i++) {
    const a = r() * Math.PI * 2;
    trig.push([a, Math.sin(a), Math.cos(a)]);
  }
}
dump('noise', { noise, makeNoise: makeNoiseOut, hypot: hyp, trig });

// (c) terrain ------------------------------------------------------------
function fnv(h: number, b: number): number {
  return Math.imul(h ^ b, 16777619) >>> 0;
}
const T_BODIES = ['mars', 'ironrock', 'terra', 'io', 'frostmoon'];
const T_SEEDS = (id: string) => {
  const b = BODIES.find((x) => x.id === id)!;
  return [b.seed, 12345, 987654321];
};
const terrain: unknown[] = [];
for (const id of T_BODIES) {
  const body = BODIES.find((b) => b.id === id)!;
  for (const seed of T_SEEDS(id)) {
    const w = generateTerrain(body, seed);
    const n = Math.ceil(body.size / CHUNK_SIZE);
    const chunks: number[] = [];
    for (let cy = 0; cy < n; cy++)
      for (let cx = 0; cx < n; cx++) {
        let h = 2166136261;
        for (let y = cy * CHUNK_SIZE; y < Math.min(body.size, (cy + 1) * CHUNK_SIZE); y++)
          for (let x = cx * CHUNK_SIZE; x < Math.min(body.size, (cx + 1) * CHUNK_SIZE); x++)
            for (let z = 0; z < body.maxHeight; z++) h = fnv(h, w.get(x, y, z));
        chunks.push(h);
      }
    const heights: number[] = [];
    const surface: number[] = [];
    for (let y = 0; y < body.size; y++)
      for (let x = 0; x < body.size; x++) {
        heights.push(w.height(x, y));
        surface.push(w.surfaceMaterial(x, y));
      }
    const landing = findLandingSite(w);
    const anomalies = generateAnomalies(body, w, seed);
    terrain.push({ body: id, seed, size: body.size, maxHeight: body.maxHeight, chunks, heights, surface, landing, anomalies });
  }
}
dump('terrain', terrain);

// (d) scripted run -------------------------------------------------------
type Order = { tick: number; op: 'move' | 'mine'; dir?: 0 | 1 | 2 | 3 };
const SCRIPT: Order[] = [
  { tick: 0, op: 'mine' },
  { tick: 8, op: 'move', dir: 0 },
  { tick: 14, op: 'move', dir: 1 },
  { tick: 20, op: 'mine' },
  { tick: 30, op: 'move', dir: 1 },
  { tick: 36, op: 'move', dir: 2 },
  { tick: 42, op: 'mine' },
  { tick: 55, op: 'move', dir: 3 },
  { tick: 60, op: 'move', dir: 3 },
  { tick: 66, op: 'mine' },
  { tick: 80, op: 'move', dir: 0 },
  { tick: 86, op: 'mine' },
];
const runs: unknown[] = [];
for (const id of ['moon', 'mars', 'ironrock', 'terra']) {
  const body = BODIES.find((b) => b.id === id)!;
  const sim = new Simulation({ body, spec: { ...defaultSpec(), id: 'r1' }, events: new EventBus() });
  const snaps: unknown[] = [];
  const results: [number, boolean][] = [];
  const snap = (tick: number) =>
    snaps.push({
      tick,
      time: sim.time,
      pos: { ...sim.rover.pos },
      facing: sim.rover.facing,
      battery: sim.rover.battery,
      durability: sim.rover.durability,
      fuel: sim.rover.fuel,
      cargo: { ...sim.rover.cargo },
      cargoUsed: sim.rover.cargoUsed,
      moveT: sim.rover.moveT,
      moving: sim.rover.moveFrom != null,
      mining: sim.rover.mining ? { pos: { ...sim.rover.mining.pos }, remaining: sim.rover.mining.remaining } : null,
      edits: { ...sim.world.edits },
      status: sim.status,
    });
  snap(0);
  for (let t = 0; t < 100; t++) {
    for (const o of SCRIPT.filter((s) => s.tick === t)) {
      const ok = o.op === 'move' ? sim.move(o.dir!) : sim.mine();
      results.push([t, ok]);
    }
    sim.tick();
    if ((t + 1) % 10 === 0) snap(t + 1);
  }
  runs.push({
    body: id,
    seed: body.seed,
    spec: defaultSpec(),
    stats: sim.rover.stats,
    landing: sim.landingSite,
    anomalies: sim.anomalies,
    script: SCRIPT,
    results,
    snapshots: snaps,
  });
}
dump('run', runs);

// (d2) long run: 2400 ticks (240 s) so natural weather (cooldown 20 s) fires.
const longRuns: unknown[] = [];
for (const id of ['mars', 'moon', 'europa']) {
  const body = BODIES.find((b) => b.id === id)!;
  const sim = new Simulation({ body, spec: { ...defaultSpec(), id: 'r1' }, events: new EventBus() });
  const snaps: unknown[] = [];
  for (let t = 0; t < 2400; t++) {
    if (t === 300 && id === 'mars') sim.startWeather('dust-devil');
    if (t === 300 && id === 'moon') sim.startWeather('meteor-shower');
    if (t % 40 === 0) sim.move(((t / 40) % 4) as 0 | 1 | 2 | 3);
    if (t % 40 === 20) sim.mine();
    sim.tick();
    if ((t + 1) % 100 === 0)
      snaps.push({
        tick: t + 1,
        time: sim.time,
        pos: { ...sim.rover.pos },
        battery: sim.rover.battery,
        durability: sim.rover.durability,
        cargo: { ...sim.rover.cargo },
        cargoUsed: sim.rover.cargoUsed,
        edits: Object.keys(sim.world.edits).length,
        weather: sim.weather ? { ...sim.weather } : null,
        status: sim.status,
      });
  }
  longRuns.push({ body: id, snapshots: snaps });
}
dump('run_long', longRuns);

// Data the Go port embeds (single-sourced from the engine, not retyped).
mkdirSync('go/data', { recursive: true });
writeFileSync('go/data/bodies.json', JSON.stringify(BODIES, null, 1));
writeFileSync('go/data/parts.json', JSON.stringify(PARTS, null, 1));
console.log('golden written to', out);

if (process.env.TAKEON_BENCH) {
  const body = BODIES.find((b) => b.id === 'terra')!;
  generateTerrain(body);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) generateTerrain(body);
  console.log('ts terra generateTerrain ms/op', ((performance.now() - t0) / 20).toFixed(2));
}
