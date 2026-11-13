import { rules } from '../data/core-catalog.js';
import { coreCall } from '../go/sync.js';
import type { PartDef, RoverSpec, RoverStats } from '../types.js';
import { PARTS } from './catalog.js';

/** Base fuel every rover carries even without an aux tank. */
const BASE_FUEL = 30;

/**
 * Compute a rover's derived stats from its part list.
 * Pure and deterministic — the customiser, the sim and the backend
 * can all agree on the same numbers.
 */
export function computeStats(spec: RoverSpec, catalog: PartDef[] = PARTS): RoverStats {
  return coreCall<RoverStats>('stats', { config: { spec, parts: catalog } });
}

/** Can this rover reach the given delta-v with its fuel tank? */
export function canReach(stats: RoverStats, deltaV: number): boolean {
  return stats.fuelCapacity >= deltaV;
}

export function defaultSpec(): RoverSpec {
  return { ...rules.defaultSpec, modules: [...rules.defaultSpec.modules] } as RoverSpec;
}
