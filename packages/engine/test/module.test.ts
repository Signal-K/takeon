import { describe, expect, it } from 'vitest';
import {
  TAKEON_SCHEMA_VERSION,
  createDemoMission,
  createWorldState,
  deriveMissionProgress,
  explore,
  parseWorldState,
  resetWorld,
  returnToBase,
  serializeWorldState,
  type TakeonMissionProgress,
  type TakeonObjectiveKind,
} from '../src/index.js';

const prog = (p: TakeonMissionProgress, kind: TakeonObjectiveKind) =>
  p.objectives.find((o) => o.kind === kind)!;

describe('takeon objective module', () => {
  it('starts at zero except the pre-explored base tile', () => {
    const p = deriveMissionProgress(createWorldState());
    expect(prog(p, 'explore').current).toBe(1); // base counts as explored
    expect(prog(p, 'data').current).toBe(0);
    expect(prog(p, 'samples').current).toBe(0);
    expect(p.complete).toBe(false);
  });

  it('holds field yield until returning to base banks it', () => {
    let s = createWorldState({ x: 5, y: 5 });
    s = explore(s, { x: 6, y: 5 }, { data: 5, samples: 2 });
    s = explore(s, { x: 7, y: 5 }, { data: 4, samples: 1 });

    let p = deriveMissionProgress(s);
    expect(prog(p, 'explore').current).toBe(3); // base + 2 new sites
    expect(prog(p, 'data').current).toBe(0); // still held, not banked
    expect(prog(p, 'samples').current).toBe(0);

    s = returnToBase(s);
    p = deriveMissionProgress(s);
    expect(prog(p, 'data').current).toBe(8); // clamped to target (9 collected)
    expect(prog(p, 'samples').current).toBe(3);
    expect(p.complete).toBe(true);
  });

  it('re-visiting a tile does not double-count exploration', () => {
    let s = createWorldState({ x: 0, y: 0 });
    s = explore(s, { x: 1, y: 0 });
    s = explore(s, { x: 1, y: 0 });
    expect(deriveMissionProgress(s).objectives.find((o) => o.kind === 'explore')!.current).toBe(2);
  });

  it('is complete only when every objective threshold is met', () => {
    let s = createWorldState();
    // Bank plenty of data + samples but never leave the base tile.
    s = explore(s, s.base, { data: 8, samples: 3 });
    s = returnToBase(s);
    const p = deriveMissionProgress(s);
    expect(prog(p, 'data').complete).toBe(true);
    expect(prog(p, 'samples').complete).toBe(true);
    expect(prog(p, 'explore').current).toBe(1);
    expect(prog(p, 'explore').complete).toBe(false);
    expect(p.complete).toBe(false);
  });

  it('reset restores the default world for the same base + mission', () => {
    let s = createWorldState({ x: 1, y: 1 });
    s = explore(s, { x: 2, y: 1 }, { data: 3, samples: 1 });
    s = returnToBase(s);
    expect(resetWorld(s)).toEqual(createWorldState({ x: 1, y: 1 }));
  });

  it('parses old v1 payloads safely and round-trips v2', () => {
    const v1 = {
      schemaVersion: 1,
      base: { x: 2, y: 3 },
      rover: { x: 4, y: 3 },
      explored: ['2,3', '3,3'],
      data: 6,
      samples: 2,
    };
    const s = parseWorldState(v1);
    expect(s.schemaVersion).toBe(TAKEON_SCHEMA_VERSION);
    expect(s.base).toEqual({ x: 2, y: 3 });
    expect(s.explored).toEqual(['2,3', '3,3']);
    expect(s.bankedData).toBe(6); // v1 flat counters treated as banked
    expect(s.bankedSamples).toBe(2);
    expect(s.mission.objectives).toHaveLength(3);

    // Round-trips through serialise/parse without loss.
    const round = parseWorldState(serializeWorldState(s));
    expect(round).toEqual(s);
  });

  it('never throws on garbage or empty input', () => {
    expect(parseWorldState('not json').mission.id).toBe(createDemoMission().id);
    expect(parseWorldState(null).schemaVersion).toBe(TAKEON_SCHEMA_VERSION);
    expect(parseWorldState(42).explored.length).toBe(1);
    expect(parseWorldState({}).mission.objectives).toHaveLength(3);
  });
});
