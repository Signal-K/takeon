import { describe, expect, it } from 'vitest';
import {
  buildScene,
  defaultSpec,
  entitiesOfKind,
  EventBus,
  getFlatPainter,
  getBody,
  listFlatPainterKinds,
  listRoverParts,
  registerRoverPart,
  roverPaintContext,
  Simulation,
  unregisterRoverPart,
} from '../src/index.js';

function makeSim(bodyId = 'moon') {
  return new Simulation({
    body: getBody(bodyId)!,
    spec: { ...defaultSpec(), id: 'r1' },
    events: new EventBus(),
  });
}

describe('scene model', () => {
  it('flattens a running sim into entities', () => {
    const sim = makeSim();
    const scene = buildScene(sim);
    expect(scene.size).toBe(sim.world.size);
    expect(scene.view).toBe('iso');
    expect(scene.home).toEqual(sim.landingSite);

    const rovers = entitiesOfKind(scene, 'rover');
    expect(rovers).toHaveLength(1);
    expect(rovers[0].pos).toEqual(sim.rover.renderPos);
    expect(rovers[0].z).toBe(sim.world.height(sim.rover.pos.x, sim.rover.pos.y));
    expect(rovers[0].ref).toBe(sim.rover);
  });

  it('hides unscanned anomalies unless asked for them', () => {
    const sim = makeSim();
    expect(sim.anomalies.length).toBeGreaterThan(0);
    expect(entitiesOfKind(buildScene(sim), 'anomaly')).toHaveLength(0);
    expect(entitiesOfKind(buildScene(sim, { includeHidden: true }), 'anomaly')).toHaveLength(
      sim.anomalies.length,
    );

    sim.anomalies[0].scanned = true;
    const scene = buildScene(sim);
    expect(entitiesOfKind(scene, 'anomaly')).toHaveLength(1);
    expect(scene.entities.find((e) => e.kind === 'anomaly')?.data?.documented).toBe(false);
  });

  it('includes structures with their power and build state', () => {
    const sim = makeSim();
    sim.rover.cargo = { silica: 20, iron: 20, regolith: 20 };
    sim.rover.cargoUsed = 60;
    const built = sim.build('cache');
    expect(built).not.toBeNull();
    const scene = buildScene(sim);
    const structures = entitiesOfKind(scene, 'structure');
    expect(structures).toHaveLength(1);
    expect(structures[0].variant).toBe('cache');
    expect(structures[0].data).toHaveProperty('powered');
  });

  it('paints entities in layer order', () => {
    const sim = makeSim();
    sim.anomalies[0].scanned = true;
    const scene = buildScene(sim);
    const layers = scene.entities.map((e) => e.layer ?? 0);
    expect([...layers].sort((a, b) => a - b)).toEqual(layers);
  });

  it('is a snapshot: mutating the sim afterwards does not move an entity', () => {
    const sim = makeSim();
    const scene = buildScene(sim);
    const before = { ...entitiesOfKind(scene, 'rover')[0].pos };
    sim.rover.renderPos.x += 5;
    expect(entitiesOfKind(scene, 'rover')[0].pos).toEqual(before);
  });
});

describe('flat painters', () => {
  it('ships painters for every built-in entity kind', () => {
    for (const kind of ['rover', 'structure', 'anomaly', 'marker']) {
      expect(getFlatPainter(kind), kind).toBeTypeOf('function');
    }
    expect(listFlatPainterKinds()).toContain('rover');
  });
});

describe('rover parts', () => {
  it('describes the build and live state in the paint context', () => {
    const sim = makeSim();
    sim.rover.battery = sim.rover.stats.batteryCapacity / 2;
    sim.rover.cargo = { iron: 4 };
    sim.rover.cargoUsed = 4;
    const p = roverPaintContext(sim.rover, 0.9, 0, 1.5);
    expect(p.charge).toBeCloseTo(0.5, 6);
    expect(p.load).toBeGreaterThan(0);
    expect(p.cargoTop).toBe('iron');
    // The starter build has a scoop and a nav cam, no scanner.
    expect(p.has.tool).toBe(true);
    expect(p.has.camera).toBe(true);
    expect(p.has.scanner).toBe(false);
  });

  it('exposes parts in painter order and accepts host parts', () => {
    const parts = listRoverParts();
    expect(parts.map((p) => p.id)).toContain('chassis');
    const orders = parts.map((p) => p.order ?? 50);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    registerRoverPart({ id: 'test-flag', order: 99, draw: () => undefined });
    expect(listRoverParts().at(-1)?.id).toBe('test-flag');
    expect(unregisterRoverPart('test-flag')).toBe(true);
    expect(listRoverParts().some((p) => p.id === 'test-flag')).toBe(false);
  });

  it('only draws parts whose conditions hold', () => {
    const sim = makeSim();
    const p = roverPaintContext(sim.rover, 1, 0, 0);
    const applicable = listRoverParts().filter((part) => !part.when || part.when(p));
    const ids = applicable.map((part) => part.id);
    expect(ids).toContain('chassis');
    expect(ids).toContain('tool-arm');
    // No scanner fitted, full hull, broad daylight, empty hold.
    expect(ids).not.toContain('scanner');
    expect(ids).not.toContain('damage');
    expect(ids).not.toContain('headlights');
    expect(ids).not.toContain('cargo');
  });
});
