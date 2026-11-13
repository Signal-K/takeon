import type { Anomaly, BodyDef } from '../types.js';
import type { VoxelWorld } from './world.js';
import { coreCall } from '../go/sync.js';
import { coreBody } from './core-data.js';
export function generateAnomalies(body: BodyDef, world: VoxelWorld, seed = body.seed): Anomaly[] {
  return coreCall<Anomaly[]>('anomalies', {
    seed: seed >>> 0,
    config: { body: coreBody(body) },
    voxels: world.toCoreData(),
  });
}
