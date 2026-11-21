import { describe, expect, it } from 'vitest';
import {
  FieldPlanner, FieldTerrain, FieldVehicle, getFieldDem, listFieldDems, recipeForStyle, registerFieldLayer,
} from '../src/field/index.js';

const run = (v: FieldVehicle, seconds: number) => { for (let i = 0; i < seconds * 60; i++) v.update(1 / 60); };

describe('field DEM patches (KES-543)', () => {
  it('embeds real Moon and Mars terrain in metres', () => {
    expect(listFieldDems('mars').length).toBeGreaterThanOrEqual(2);
    expect(listFieldDems('moon').length).toBeGreaterThanOrEqual(1);
    for (const p of listFieldDems()) {
      const d = getFieldDem(p.id)!;
      expect(d.heights.length).toBe(p.size * p.size);
      let max = 0;
      for (const h of d.heights) max = Math.max(max, h);
      // Decoded heights match the relief recorded when the patch was cut.
      expect(Math.abs(max - p.relief)).toBeLessThan(0.15);
      expect(p.source).toMatch(/HiRISE|Kaguya/);
    }
  });

  it('builds Moon and Mars fields on real data, and credits the source', () => {
    expect(new FieldTerrain({ style: 'rust', seed: 4 }).sources[0]).toMatch(/HiRISE/);
    expect(new FieldTerrain({ style: 'regolith', seed: 4 }).sources[0]).toMatch(/Kaguya/);
    expect(new FieldTerrain({ style: 'ice', seed: 4 }).sources).toEqual([]);
  });
});

describe('field PCG layers (KES-543)', () => {
  it('runs a host-registered layer in the recipe', () => {
    registerFieldLayer({ kind: 'test-mesa', shape: () => (x, y, s) => { if (Math.hypot(x - 20, y - 20) < 5) s.h += 3; } });
    const t = new FieldTerrain({ seed: 2, size: 64, recipe: { layers: [{ kind: 'test-mesa' }] } });
    expect(t.height(20, 20) - t.height(40, 40)).toBeCloseTo(3, 1);
  });

  it('rejects an unknown layer', () => {
    expect(() => new FieldTerrain({ recipe: { layers: [{ kind: 'nope' }] } })).toThrow(/nope/);
  });

  it('draws more small craters than big ones, from the size-frequency law', () => {
    const t = new FieldTerrain({ seed: 5, recipe: { layers: [{ kind: 'craters', a: 0.0794, b: 2, dMin: 2 }] } });
    const small = t.craters.filter(c => c.r * 2 < 4).length, big = t.craters.filter(c => c.r * 2 >= 8).length;
    expect(small).toBeGreaterThan(big * 4);
  });

  it('places more boulders at higher rock abundance', () => {
    const at = (k: number) => new FieldTerrain({ seed: 5, recipe: { layers: [{ kind: 'boulders', k }] } }).boulders.length;
    expect(at(0.1)).toBeGreaterThan(at(0.03));
  });

  it('keeps the default recipes deterministic', () => {
    for (const style of ['regolith', 'rust', 'metal'] as const) {
      const a = new FieldTerrain({ style, seed: 11 }), b = new FieldTerrain({ style, seed: 11 });
      expect(a.recipe).toEqual(recipeForStyle(a.style));
      expect(a.height(33.3, 70.1)).toBe(b.height(33.3, 70.1));
      expect(a.landing).toEqual(b.landing);
    }
  });
});

describe('tap-to-drive (KES-543)', () => {
  it('plans round a boulder and the rover follows the route to the goal', () => {
    const t = new FieldTerrain({ seed: 3, recipe: { layers: [{ kind: 'relief', amp: 0.3 }] } });
    const L = t.landing;
    const rock = { x: L.x + 6, y: L.y, r: 1.5, h: 1.5, tone: 0.5 };
    (t as unknown as { addBoulder(b: typeof rock): void }).addBoulder(rock);
    const p = new FieldPlanner(t, { maxGrade: 0.55, clearance: 1.1 });
    const goal = { x: L.x + 12, y: L.y };
    const route = p.plan(L, goal);
    expect(route.length).toBeGreaterThan(1);
    for (let i = 0; i < route.length; i++) expect(p.clear(i ? route[i - 1] : L, route[i])).toBe(true);
    const v = new FieldVehicle(t, L, 0);
    let arrived = false;
    v.onArrive = () => { arrived = true; };
    v.follow(route);
    run(v, 12);
    expect(arrived).toBe(true);
    expect(Math.hypot(v.x - goal.x, v.y - goal.y)).toBeLessThan(1.2);
  });

  it('stops short within the requested range of the goal', () => {
    const t = new FieldTerrain({ seed: 3, recipe: { layers: [{ kind: 'relief', amp: 0.3 }] } });
    const p = new FieldPlanner(t, { maxGrade: 0.55, clearance: 1.1, within: 5 });
    const goal = { x: t.landing.x, y: t.landing.y - 20 };
    const route = p.plan(t.landing, goal);
    const end = route[route.length - 1];
    expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThanOrEqual(5);
  });

  it('manual input takes over from a route', () => {
    const t = new FieldTerrain({ seed: 3 });
    const v = new FieldVehicle(t);
    v.follow([{ x: t.landing.x, y: t.landing.y - 10 }]);
    v.setInput({ x: 1, y: 0 });
    expect(v.route).toBeNull();
  });
});
