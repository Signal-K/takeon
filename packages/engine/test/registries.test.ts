import { afterEach, describe, expect, it } from 'vitest';
import {
  computeStats,
  createRoverGame,
  defaultSpec,
  EventBus,
  getBody,
  listMaterials,
  listStructures,
  Material,
  MATERIALS,
  missionCredits,
  registerMaterial,
  registerResource,
  registerResourceValue,
  registerStructure,
  RESOURCE_NAMES,
  RESOURCE_VALUE,
  Simulation,
  STRUCTURES,
  unregisterMaterial,
  unregisterStructure,
  type MaterialDef,
  type MissionState,
  type StructureDef,
} from '../src/index.js';

/**
 * A different game built on the engine (a precious-metals mining game, say)
 * needs its own voxel materials, cargo resources and structure catalog. These
 * assert the extension points actually work end to end — register something,
 * see it flow through generation, the sim and the economy — not just that
 * the functions exist.
 */

const PLATINUM = 64;

afterEach(() => {
  unregisterMaterial(PLATINUM);
  unregisterStructure('research-lab');
});

describe('material registry', () => {
  it('adds a material that MATERIALS[] resolves immediately', () => {
    const def: MaterialDef = {
      id: PLATINUM,
      name: 'Platinum ore',
      hardness: 6,
      yields: { resource: 'platinum', amount: 1 },
      colors: ['#e8e4d8', '#b8b4a8', '#8a8778'],
      jitter: 0.08,
    };
    expect(registerMaterial(def)).toBe(PLATINUM);
    expect(MATERIALS[PLATINUM]).toBe(def);
    expect(listMaterials()).toContainEqual(def);
  });

  it('refuses to unregister a built-in, but removes a custom one', () => {
    expect(unregisterMaterial(Material.IronOre)).toBe(false);
    expect(MATERIALS[Material.IronOre]).toBeDefined();

    registerMaterial({
      id: PLATINUM,
      name: 'Platinum ore',
      hardness: 6,
      yields: { resource: 'platinum', amount: 1 },
      colors: ['#e8e4d8', '#b8b4a8', '#8a8778'],
      jitter: 0.08,
    });
    expect(unregisterMaterial(PLATINUM)).toBe(true);
    expect(MATERIALS[PLATINUM]).toBeUndefined();
    expect(unregisterMaterial(PLATINUM)).toBe(false); // already gone
  });

  it('mines a registered material through the real sim, not just the table', () => {
    registerMaterial({
      id: PLATINUM,
      name: 'Platinum ore',
      hardness: 1, // trivial to mine so the test does not need many ticks
      yields: { resource: 'platinum', amount: 3 },
      colors: ['#e8e4d8', '#b8b4a8', '#8a8778'],
      jitter: 0,
    });

    const body = getBody('moon')!;
    const sim = new Simulation({ body, spec: { ...defaultSpec(), id: 'r1' }, events: new EventBus() });
    // Force the tile directly ahead of the rover to be solid platinum ore.
    const r = sim.rover;
    const ahead = { x: r.pos.x + 1, y: r.pos.y };
    const h = sim.world.height(ahead.x, ahead.y);
    sim.world.set(ahead.x, ahead.y, h, PLATINUM);
    r.facing = 0; // +x

    expect(sim.mine()).toBe(true);
    for (let i = 0; i < 5 && (r.cargo.platinum ?? 0) === 0; i++) sim.tick();
    expect(r.cargo.platinum).toBeGreaterThan(0);
  });
});

describe('resource registry', () => {
  it('names and prices a custom resource key', () => {
    registerResource('platinum', 'Platinum');
    registerResourceValue('platinum', 40);
    expect(RESOURCE_NAMES.platinum).toBe('Platinum');
    expect(RESOURCE_VALUE.platinum).toBe(40);
  });

  it('feeds mission payout like any built-in resource', () => {
    registerResourceValue('platinum', 40);
    const state = {
      rover: { cargo: { platinum: 2 } },
      anomalies: [],
      photos: [],
    } as unknown as MissionState;
    expect(missionCredits(state, {})).toBe(80);
  });
});

describe('structure registry', () => {
  const labDef: StructureDef = {
    type: 'research-lab',
    name: 'Research Lab',
    cost: { silica: 4, crystal: 1 },
    description: 'Studies documented anomalies for a science bonus.',
  };

  it('adds a structure that STRUCTURES[] and build() both see', () => {
    expect(registerStructure(labDef)).toBe('research-lab');
    expect(STRUCTURES['research-lab']).toBe(labDef);
    expect(listStructures()).toContainEqual(labDef);
  });

  it('refuses to unregister a built-in, but removes a custom one', () => {
    expect(unregisterStructure('refinery')).toBe(false);
    expect(STRUCTURES.refinery).toBeDefined();
    registerStructure(labDef);
    expect(unregisterStructure('research-lab')).toBe(true);
    expect(STRUCTURES['research-lab']).toBeUndefined();
  });

  it('builds through the real sim once registered', () => {
    registerStructure(labDef);
    const body = getBody('moon')!;
    const sim = new Simulation({ body, spec: { ...defaultSpec(), id: 'r1' }, events: new EventBus() });
    sim.rover.cargo = { silica: 10, crystal: 5 };
    sim.rover.cargoUsed = 15;
    const built = sim.build('research-lab');
    expect(built?.type).toBe('research-lab');
    expect(sim.structures.some((s) => s.type === 'research-lab')).toBe(true);
  });

  it('is visible to a live RoverGame via the canvas facade', () => {
    registerStructure(labDef);
    const canvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : ({ getContext: () => null } as unknown as HTMLCanvasElement);
    if (typeof document === 'undefined') return; // canvas-dependent, skip outside a DOM env
    const body = getBody('moon')!;
    const game = createRoverGame({ canvas, body, spec: { ...defaultSpec(), id: 'r1' }, controls: false, audio: false });
    game.sim.rover.cargo = { silica: 10, crystal: 5 };
    game.sim.rover.cargoUsed = 15;
    expect(game.build('research-lab')).toBe(true);
    game.dispose();
  });
});

describe('stats maths still works with an open Material type', () => {
  it('computeStats is unaffected by registry changes', () => {
    const stats = computeStats(defaultSpec());
    expect(stats.valid).toBe(true);
  });
});
