import { describe, expect, it } from 'vitest';
import { BuildSite, clipModel, constructionParts, getAsset, listAssets, lPath, modelBounds, PhysicsWorld, pointAlong, segmentHitsBox } from '../src/kit/index.js';

describe('kit assets', () => {
  it('every catalogue asset builds a model inside about its footprint', () => {
    for (const def of listAssets()) {
      const parts = def.model({ time: 1 });
      expect(parts.length, def.id).toBeGreaterThan(0);
      const [f0, f1, s0, s1] = modelBounds(parts);
      expect(Math.max(f1 - f0, s1 - s0), def.id).toBeLessThanOrEqual(def.footprint + 0.5);
    }
  });

  it('a pad drops its rocket while it is away', () => {
    const pad = getAsset('launch-pad')!;
    expect(pad.model({ time: 0, rocket: false }).length).toBeLessThan(pad.model({ time: 0 }).length);
  });
});

describe('kit construction', () => {
  const model = getAsset('agency-hq')!.model({ time: 0 });
  it('starts with stakes, rises through scaffold, ends as the model', () => {
    expect(constructionParts(model, 0).every((p) => p.kind === 'beam' || p.kind === 'box' || p.kind === 'flat')).toBe(true);
    const mid = constructionParts(model, 0.5);
    expect(mid.length).toBeGreaterThan(model.length / 2);
    expect(constructionParts(model, 1)).toEqual(model);
  });
  it('clips parts to the build height', () => {
    const top = modelBounds(clipModel(model, 0.3).filter((p) => p.kind !== 'flat'))[5];
    expect(top).toBeLessThanOrEqual(0.33);
  });
});

describe('kit site', () => {
  const area = { center: { x: 10, y: 10 }, radius: 4 };
  it('clears from the centre out over its duration', () => {
    const site = new BuildSite(3);
    expect(site.clear(area, { dur: 2 })).toBe(2);
    site.setTime(0.6);
    expect(site.cleared(10, 10)).toBeGreaterThan(0.9);
    expect(site.cleared(14, 10)).toBe(0);
    site.setTime(2);
    expect(site.cleared(14, 10)).toBe(1);
  });
  it('queues jobs one after another and grades rough ground level', () => {
    const site = new BuildSite(3).roughen(area, 2);
    site.clear(area, { dur: 1 });
    expect(site.flatten(area, 5, { dur: 1 })).toBe(2);
    site.setTime(1);
    const bumpy = [0, 1, 2, 3].map((i) => site.heightAt(9 + i, 10, 5));
    expect(new Set(bumpy.map((h) => h.toFixed(2))).size).toBeGreaterThan(1);
    site.setTime(2);
    for (let i = 0; i < 4; i++) expect(site.heightAt(9 + i, 10, 5)).toBeCloseTo(5, 5);
    expect(site.heightAt(30, 30, 7)).toBe(7);
  });
  it('instant jobs stand finished and the terrain key follows the work', () => {
    const site = new BuildSite(1);
    const before = site.terrainKey();
    site.build('agency-hq', { x: 1, y: 1 }, { instant: true });
    expect(site.buildProgress(site.buildings[0])).toBe(1);
    site.flatten(area, 3, { dur: 1 });
    site.setTime(0.5);
    expect(site.terrainKey()).not.toBe(before);
  });
  it('roads run along tiles with a paver at the tip', () => {
    const path = lPath({ x: 0, y: 0 }, { x: 3, y: 2 });
    expect(path).toHaveLength(6);
    const end = pointAlong(path, 1);
    expect(end.x).toBeCloseTo(3, 4);
    expect(end.y).toBeCloseTo(2, 4);
    const site = new BuildSite(1);
    site.road(path, { dur: 2 });
    site.setTime(1);
    expect(site.vehicles().map((v) => v.kind)).toEqual(['paver']);
  });
});

describe('kit physics', () => {
  it('drops a body onto the ground and lets it rest', () => {
    const w = new PhysicsWorld();
    w.ground = () => 1;
    const b = w.add({ id: 'crate', type: 'dynamic', shape: { kind: 'box', hx: 0.1, hy: 0.1 }, x: 0, y: 0, z: 3, settle: false });
    w.advance(3);
    expect(b.z).toBeCloseTo(1, 3);
    expect(b.sleeping).toBe(true);
  });
  it('slides down a steep slope and holds on a gentle one', () => {
    const steep = new PhysicsWorld();
    steep.ground = (x) => -x * 1.2;
    const a = steep.add({ id: 'a', type: 'dynamic', shape: { kind: 'circle', r: 0.1 }, x: 0, y: 0, friction: 0.5 });
    steep.advance(1);
    expect(a.x).toBeGreaterThan(0.5);
    const gentle = new PhysicsWorld();
    gentle.ground = (x) => -x * 0.1;
    const b = gentle.add({ id: 'b', type: 'dynamic', shape: { kind: 'circle', r: 0.1 }, x: 0, y: 0, friction: 0.5 });
    gentle.advance(1);
    expect(b.x).toBeCloseTo(0, 3);
  });
  it('a moving machine shoves a rock, and a wall stops it', () => {
    const w = new PhysicsWorld();
    const rock = w.add({ id: 'rock', type: 'dynamic', shape: { kind: 'circle', r: 0.2 }, x: 1, y: 0, sleeping: true });
    w.add({ id: 'wall', type: 'static', shape: { kind: 'box', hx: 0.5, hy: 2 }, x: 3, y: 0, h: 2 });
    const dozer = w.add({ id: 'dozer', type: 'kinematic', shape: { kind: 'circle', r: 0.3 }, x: 0, y: 0 });
    w.beforeStep = (t) => {
      const x = Math.min(1.5, t * 2);
      dozer.vx = (x - dozer.x) * 60;
      dozer.x = x;
    };
    w.advance(3);
    expect(rock.x).toBeGreaterThan(1.9);
    expect(rock.x).toBeLessThanOrEqual(2.5 - 0.2 + 1e-6);
  });
});

describe('kit site objects', () => {
  it('tests cable spans against building footprints', () => {
    expect(segmentHitsBox(-2, 0, 2, 0, 0, 0, 0.5, 0.5)).toBe(true);
    expect(segmentHitsBox(-2, 1, 2, 1, 0, 0, 0.5, 0.5)).toBe(false);
    expect(segmentHitsBox(-2, -2, -1, -1, 0, 0, 0.5, 0.5)).toBe(false);
    expect(segmentHitsBox(0, -2, 0, 2, 0, 0, 0.5, 0.5)).toBe(true);
  });

  const area = { center: { x: 10, y: 10 }, radius: 4 };
  it('every thing on the site is an object with a body', () => {
    const site = new BuildSite(5);
    site.scatter(area, () => true, 0.5);
    site.build('warehouse', { x: 10, y: 10 }, { instant: true, id: 'wh' });
    site.road(lPath({ x: 4, y: 4 }, { x: 4, y: 12 }), { instant: true, power: true });
    site.setTime(0.1);
    const kinds = new Set(site.objects().map((o) => o.kind));
    for (const k of ['debris', 'building', 'crate', 'lamp', 'pole']) expect(kinds.has(k as never), k).toBe(true);
    for (const o of site.objects()) expect(site.physics.get(o.id)).toBe(o.body);
    expect(site.wires().length).toBeGreaterThan(0);
    expect(site.pick(10, 10)?.id).toBe('wh');
  });
  it('the clearing pushes the debris out to the rim instead of deleting it', () => {
    const site = new BuildSite(5);
    site.scatter(area, () => true, 0.5);
    const count = site.standingDebris().length;
    site.clear(area, { dur: 2 });
    site.setTime(4);
    const debris = site.standingDebris();
    expect(debris.length).toBe(count);
    for (const o of debris) expect(Math.hypot(o.body.x - 10, o.body.y - 10)).toBeGreaterThan(area.radius);
  });
  it('a finished store has its delivery dropped beside it', () => {
    const site = new BuildSite(5);
    site.build('warehouse', { x: 10, y: 10 }, { dur: 1, id: 'wh' });
    site.setTime(1.05);
    const crate = site.objects().find((o) => o.kind === 'crate')!;
    expect(crate.body.z).toBeGreaterThan(0.2);
    site.setTime(5);
    expect(crate.body.z).toBeCloseTo(0, 3);
  });
});
