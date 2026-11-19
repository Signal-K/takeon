import { describe, expect, it } from 'vitest';
import { BuildSite, clipModel, constructionParts, getAsset, listAssets, lPath, modelBounds, pointAlong } from '../src/kit/index.js';

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
