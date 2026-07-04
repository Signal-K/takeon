import type { Anomaly, AnomalyType, BodyDef } from '../types.js';
import { mulberry32 } from '../util/rng.js';
import type { VoxelWorld } from './world.js';

const NAMES: Record<AnomalyType, string[]> = {
  wreckage: ['Downed probe', 'Impactor debris', 'Lost lander stage'],
  'crystal-formation': ['Crystal spires', 'Geode field', 'Prismatic outcrop'],
  'magnetic-anomaly': ['Magnetic mascon', 'Compass sink', 'Iron whisper'],
  'fossil-traces': ['Layered sediments', 'Microfossil bed', 'Ancient shoreline'],
  'ice-vent': ['Cryo-geyser', 'Vapor plume vent', 'Brine seep'],
  monolith: ['The Monolith', 'Anomalous slab', 'Silent marker'],
};

function typesFor(body: BodyDef): AnomalyType[] {
  const pool: AnomalyType[] = ['wreckage', 'magnetic-anomaly', 'crystal-formation'];
  if (body.terrain.iceCaps > 0.1) pool.push('ice-vent', 'ice-vent');
  if (body.type === 'planet' || body.id === 'ceres') pool.push('fossil-traces', 'fossil-traces');
  pool.push('monolith'); // rare everywhere
  return pool;
}

/**
 * Seeded anomaly placement: same body + seed => same anomalies.
 * Anomalies start hidden; scanners reveal them, photos document them.
 */
export function generateAnomalies(body: BodyDef, world: VoxelWorld, seedOverride?: number): Anomaly[] {
  const seed = (seedOverride ?? body.seed) ^ 0xa11e5;
  const rng = mulberry32(seed);
  const count = 3 + Math.floor(rng() * 3);
  const pool = typesFor(body);
  const placed: Anomaly[] = [];
  const c = world.size / 2;

  let attempts = 0;
  while (placed.length < count && attempts < 400) {
    attempts++;
    const x = Math.floor(rng() * world.size);
    const y = Math.floor(rng() * world.size);
    if (!world.isSolid(x, y)) continue;
    // Not on the landing zone, not clustered together.
    if (Math.hypot(x - c, y - c) < world.size * 0.12) continue;
    if (placed.some((a) => Math.hypot(a.pos.x - x, a.pos.y - y) < world.size * 0.18)) continue;
    const type = pool[Math.floor(rng() * pool.length)];
    const names = NAMES[type];
    placed.push({
      id: `anom_${body.id}_${placed.length}`,
      type,
      name: names[Math.floor(rng() * names.length)],
      pos: { x, y },
      scanned: false,
      documented: false,
    });
  }
  return placed;
}
