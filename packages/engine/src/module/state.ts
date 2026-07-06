import type { Vec2 } from '../types.js';
import {
  TAKEON_SCHEMA_VERSION,
  type TakeonMission,
  type TakeonMissionProgress,
  type TakeonObjectiveProgress,
  type TakeonWorldState,
} from './types.js';

/** Packed tile key, matching the sim's edit-key convention. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The bundled demo objective: prove the exploration → bank loop. */
export function createDemoMission(): TakeonMission {
  return {
    id: 'demo-survey',
    name: 'Field Survey',
    objectives: [
      { kind: 'explore', label: 'Survey sites', target: 3 },
      { kind: 'data', label: 'Bank data', target: 8 },
      { kind: 'samples', label: 'Bank samples', target: 3 },
    ],
  };
}

/** A fresh world at `base`, with only the base tile explored. */
export function createWorldState(base: Vec2 = { x: 0, y: 0 }, mission: TakeonMission = createDemoMission()): TakeonWorldState {
  return {
    schemaVersion: TAKEON_SCHEMA_VERSION,
    base: { ...base },
    rover: { ...base },
    explored: [tileKey(base.x, base.y)],
    heldData: 0,
    heldSamples: 0,
    bankedData: 0,
    bankedSamples: 0,
    mission: cloneMission(mission),
  };
}

/** Field yield collected when first visiting a tile (deterministic). */
export interface TakeonGain {
  data?: number;
  samples?: number;
}

/**
 * Move the rover to `tile`, marking it explored, and pocket any field yield.
 * Pure: returns a new state. Yield is *held* until returned to base.
 * Re-visiting an already-explored tile still collects the passed gain (a host
 * may choose to pass zero for known tiles).
 */
export function explore(state: TakeonWorldState, tile: Vec2, gain: TakeonGain = {}): TakeonWorldState {
  const key = tileKey(tile.x, tile.y);
  const explored = state.explored.includes(key) ? state.explored : [...state.explored, key];
  return {
    ...state,
    rover: { x: tile.x, y: tile.y },
    explored,
    heldData: state.heldData + (gain.data ?? 0),
    heldSamples: state.heldSamples + (gain.samples ?? 0),
  };
}

/**
 * Drive back to base and bank everything currently held. Objectives only
 * count banked yield, so this is what advances the data/sample goals.
 */
export function returnToBase(state: TakeonWorldState): TakeonWorldState {
  return {
    ...state,
    rover: { ...state.base },
    heldData: 0,
    heldSamples: 0,
    bankedData: state.bankedData + state.heldData,
    bankedSamples: state.bankedSamples + state.heldSamples,
  };
}

/** Restore the default world (keeping the same base + mission). */
export function resetWorld(state: TakeonWorldState): TakeonWorldState {
  return createWorldState(state.base, state.mission);
}

/** Live value backing each objective kind. */
function objectiveValue(state: TakeonWorldState, kind: TakeonObjectiveProgress['kind']): number {
  switch (kind) {
    case 'explore':
      return state.explored.length; // base is pre-counted
    case 'data':
      return state.bankedData;
    case 'samples':
      return state.bankedSamples;
    default:
      return 0;
  }
}

/**
 * Derive objective progress + overall completion from a world state. Pure and
 * deterministic — the single source of truth for any progress UI.
 */
export function deriveMissionProgress(state: TakeonWorldState): TakeonMissionProgress {
  const objectives: TakeonObjectiveProgress[] = state.mission.objectives.map((o) => {
    const current = objectiveValue(state, o.kind);
    return { ...o, current: Math.min(current, o.target), complete: current >= o.target };
  });
  return {
    missionId: state.mission.id,
    name: state.mission.name,
    objectives,
    complete: objectives.length > 0 && objectives.every((o) => o.complete),
  };
}

// ── Persistence (host owns the actual storage) ────────────────────────────

/** Serialise for the host to persist (e.g. into localStorage). */
export function serializeWorldState(state: TakeonWorldState): string {
  return JSON.stringify(state);
}

/**
 * Parse a persisted payload back into a valid world, tolerating older shapes.
 * Accepts a JSON string, a parsed object, or null/garbage — always returns a
 * usable state (falling back to a fresh default) and never throws.
 *
 * v1 payloads (pre-held/banked split) are migrated: their flat `data`/`samples`
 * counters are treated as already banked, and a mission is attached if missing.
 */
export function parseWorldState(raw: unknown, base: Vec2 = { x: 0, y: 0 }): TakeonWorldState {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = null;
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return createWorldState(base);

  const fallback = createWorldState(readVec(obj.base) ?? base);
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;

  const explored = Array.isArray(obj.explored)
    ? (obj.explored.filter((k) => typeof k === 'string') as string[])
    : fallback.explored;

  // v1 stored flat `data`/`samples`; v2 splits held vs banked.
  const bankedData = num(obj.bankedData, version < 2 ? num(obj.data, 0) : 0);
  const bankedSamples = num(obj.bankedSamples, version < 2 ? num(obj.samples, 0) : 0);

  const mission = isMission(obj.mission) ? cloneMission(obj.mission) : fallback.mission;

  return {
    schemaVersion: TAKEON_SCHEMA_VERSION,
    base: readVec(obj.base) ?? fallback.base,
    rover: readVec(obj.rover) ?? readVec(obj.base) ?? fallback.base,
    explored: explored.length > 0 ? explored : fallback.explored,
    heldData: num(obj.heldData, 0),
    heldSamples: num(obj.heldSamples, 0),
    bankedData,
    bankedSamples,
    mission,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────

function cloneMission(m: TakeonMission): TakeonMission {
  return { id: m.id, name: m.name, objectives: m.objectives.map((o) => ({ ...o })) };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readVec(v: unknown): Vec2 | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: o.y };
  }
  return null;
}

function isMission(v: unknown): v is TakeonMission {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && Array.isArray(o.objectives);
}
