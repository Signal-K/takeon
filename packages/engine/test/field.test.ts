import { describe, expect, it } from 'vitest';
import { FieldTerrain, FieldVehicle } from '../src/field/index.js';

const run = (v: FieldVehicle, seconds: number) => { for (let i = 0; i < seconds * 60; i++) v.update(1 / 60); };

describe('field terrain (KES-541)', () => {
  it('is deterministic from style and seed', () => {
    const a = new FieldTerrain({ style: 'rust', seed: 9 });
    const b = new FieldTerrain({ style: 'rust', seed: 9 });
    expect(a.height(40.3, 71.9)).toBe(b.height(40.3, 71.9));
    expect(a.deposits).toEqual(b.deposits);
    expect(a.boulders.length).toBe(b.boulders.length);
    expect(new FieldTerrain({ style: 'rust', seed: 10 }).height(40.3, 71.9)).not.toBe(a.height(40.3, 71.9));
  });

  it('keeps the landing area flat and clear, with a deposit a short drive away', () => {
    const t = new FieldTerrain({ seed: 3 });
    const [gx, gy] = t.gradient(t.landing.x, t.landing.y);
    expect(Math.hypot(gx, gy)).toBeLessThan(0.05);
    expect(t.bouldersNear(t.landing.x, t.landing.y, 3).filter(b => Math.hypot(b.x - t.landing.x, b.y - t.landing.y) < 4)).toEqual([]);
    const nearest = Math.min(...t.deposits.map(d => Math.hypot(d.x - t.landing.x, d.y - t.landing.y)));
    expect(nearest).toBeLessThan(12);
  });
});

describe('field vehicle (KES-541)', () => {
  it('drives in the direction of the input, turning first', () => {
    const t = new FieldTerrain({ seed: 3 });
    const v = new FieldVehicle(t, t.landing, -Math.PI / 2);
    v.setInput({ x: 1, y: 0 });
    run(v, 1.5);
    expect(Math.abs(v.heading)).toBeLessThan(0.05);
    expect(v.x).toBeGreaterThan(t.landing.x + 2);
    expect(Math.abs(v.y - t.landing.y)).toBeLessThan(1);
  });

  it('stops against a boulder instead of passing through it', () => {
    const t = new FieldTerrain({ seed: 3 });
    const rock = { x: t.landing.x + 5, y: t.landing.y, r: 1, h: 1, tone: 0.5 };
    t.boulders.push(rock);
    (t as unknown as { boulderCells: Map<number, unknown[]> }).boulderCells
      .set(Math.floor(rock.y / 4) * 4096 + Math.floor(rock.x / 4), [rock]);
    const v = new FieldVehicle(t, t.landing, 0);
    v.setInput({ x: 1, y: 0 });
    run(v, 4);
    expect(v.x).toBeLessThan(rock.x - rock.r);
  });
});
