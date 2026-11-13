import type { Vec2 } from '../types.js';
import type { TakeonMission, TakeonMissionProgress, TakeonWorldState } from './types.js';
import { coreCall } from '../go/sync.js';
export interface TakeonGain {
  data?: number;
  samples?: number;
}
export function tileKey(x: number, y: number) {
  return `${x},${y}`;
}
export function createDemoMission(): TakeonMission {
  return coreCall('module', { kind: 'demo' });
}
export function createWorldState(
  base: Vec2 = { x: 0, y: 0 },
  mission: TakeonMission = createDemoMission(),
): TakeonWorldState {
  return coreCall('module', { kind: 'create', base, mission });
}
export function explore(
  state: TakeonWorldState,
  tile: Vec2,
  gain: TakeonGain = {},
): TakeonWorldState {
  return coreCall('module', { kind: 'explore', module: state, tile, gain });
}
export function returnToBase(state: TakeonWorldState): TakeonWorldState {
  return coreCall('module', { kind: 'bank', module: state });
}
export function resetWorld(state: TakeonWorldState): TakeonWorldState {
  return coreCall('module', { kind: 'reset', module: state });
}
export function deriveMissionProgress(state: TakeonWorldState): TakeonMissionProgress {
  return coreCall('module', { kind: 'progress', module: state });
}
export function serializeWorldState(state: TakeonWorldState): string {
  return coreCall('module', { kind: 'serialize', module: state });
}
export function parseWorldState(raw: unknown, base: Vec2 = { x: 0, y: 0 }): TakeonWorldState {
  try {
    return coreCall('module', { kind: 'parse', raw, base });
  } catch {
    return createWorldState(base);
  }
}
