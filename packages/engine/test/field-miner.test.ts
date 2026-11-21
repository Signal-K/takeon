import { describe, expect, it } from 'vitest';
import { FieldMiner, FieldOrbiter, FieldTerrain, ORBIT_LASER, ROVER_LASER } from '../src/field/index.js';

describe('field mining (KES-543)', () => {
  it('the orbiter drifts north, slides with the stick and comes round for another pass', () => {
    const t = new FieldTerrain({ seed: 4, size: 160 });
    const o = new FieldOrbiter(t);
    const y0 = o.y;
    o.setInput({ x: 1, y: 0 });
    for (let i = 0; i < 120; i++) o.step(1 / 60);
    expect(o.y).toBeLessThan(y0);
    expect(o.x).toBeGreaterThan(t.landing.x);
    expect(o.bank).toBeLessThan(0);
    let passes = 0;
    o.onPass = () => passes++;
    for (let i = 0; i < 60 * 60; i++) o.step(1 / 60);
    expect(passes).toBeGreaterThan(0);
    expect(o.y).toBeGreaterThan(0);
  });

  it('the laser only cuts scanned ore in range, and stops when the deposit is empty', () => {
    const t = new FieldTerrain({ seed: 7 });
    const revealed = new Set<string>();
    const m = new FieldMiner(t, revealed, ROVER_LASER);
    const d = t.deposits[0];
    expect(m.update(1, true, d.x, d.y)).toBeNull();
    revealed.add(d.id);
    expect(m.update(1, true, d.x + 200, d.y)).toBeNull();
    const cut = m.update(1, true, d.x + 3, d.y);
    expect(cut).toEqual({ resource: d.resource, amount: ROVER_LASER.rate });
    for (let i = 0; i < 200; i++) m.update(0.5, true, d.x, d.y);
    expect(m.left.get(d.id)).toBe(0);
    expect(m.update(1, true, d.x, d.y)).toBeNull();
    expect(m.total).toBeCloseTo(Math.round(d.r * 6), 5);
  });

  it('a tap aims at the scanned ore nearest the finger', () => {
    const t = new FieldTerrain({ seed: 7, size: 240, deposits: 8, depositScale: 3 });
    const revealed = new Set(t.deposits.map(d => d.id));
    const m = new FieldMiner(t, revealed, ORBIT_LASER);
    const [a, b] = t.deposits;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(Math.hypot(a.x - b.x, a.y - b.y) / 2).toBeLessThan(ORBIT_LASER.range);
    m.update(0.1, true, mid.x, mid.y, b);
    expect(m.target?.id).toBe(b.id);
  });

  it('deposit scale is opt-in: default fields are unchanged', () => {
    const a = new FieldTerrain({ seed: 11 }), b = new FieldTerrain({ seed: 11, depositScale: 1 });
    expect(b.deposits).toEqual(a.deposits);
    const big = new FieldTerrain({ seed: 11, depositScale: 3 });
    expect(big.deposits[0].r).toBeGreaterThan(a.deposits[0].r * 2);
  });
});
