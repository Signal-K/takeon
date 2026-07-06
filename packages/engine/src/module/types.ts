import type { Vec2 } from '../types.js';

/**
 * Takeon "module contract" — a small, framework-agnostic, offline-first
 * exploration model that a host (Landnam or any Star Sailors spoke) can embed
 * and persist without pulling in the full voxel simulation.
 *
 * Everything here is pure and DOM-free: the host owns storage and rendering;
 * this module owns the state shape and the deterministic rules.
 */

/** Bumped whenever the persisted shape changes; `parseWorldState` migrates. */
export const TAKEON_SCHEMA_VERSION = 2;

/** Suggested localStorage key for hosts (they may choose their own). */
export const TAKEON_WORLD_KEY = 'takeon.world.v2';

/** What an objective measures. */
export type TakeonObjectiveKind = 'explore' | 'data' | 'samples';

export interface TakeonObjective {
  kind: TakeonObjectiveKind;
  /** Short in-game label, e.g. "Survey sites". */
  label: string;
  /** Threshold that satisfies the objective. */
  target: number;
}

export interface TakeonMission {
  id: string;
  name: string;
  objectives: TakeonObjective[];
}

/**
 * The persisted world: where you are, what you've explored, and what you're
 * carrying (`held*`) versus what you've banked back at base (`banked*`).
 */
export interface TakeonWorldState {
  schemaVersion: number;
  /** Landing / home tile. Pre-counted as explored. */
  base: Vec2;
  /** Current rover tile. */
  rover: Vec2;
  /** Distinct visited tile keys ("x,y"), including the base. */
  explored: string[];
  /** Field-collected but not yet returned to base. */
  heldData: number;
  heldSamples: number;
  /** Banked at base — this is what objectives count. */
  bankedData: number;
  bankedSamples: number;
  mission: TakeonMission;
}

/** One objective with its live value folded in. */
export interface TakeonObjectiveProgress extends TakeonObjective {
  current: number;
  complete: boolean;
}

export interface TakeonMissionProgress {
  missionId: string;
  name: string;
  objectives: TakeonObjectiveProgress[];
  /** True only when every objective is satisfied. */
  complete: boolean;
}
