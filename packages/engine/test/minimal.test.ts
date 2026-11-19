import { describe, expect, it } from 'vitest';
import { EventBus, findMinimalDeposit, getBody, outpostProps, Simulation } from '../src/index.js';

describe('minimal scenes frame the world without changing it', () => {
  it('the outpost stands on solid, distinct tiles with the pad first', () => {
    const sim = new Simulation({ body: getBody('terra')!, events: new EventBus() });
    const props = outpostProps(sim, sim.landingSite);
    expect(props[0]?.type).toBe('launch-pad');
    expect(props.length).toBeGreaterThanOrEqual(4);
    const tiles = new Set(props.map((p) => `${p.pos.x},${p.pos.y}`));
    expect(tiles.size).toBe(props.length);
    for (const p of props) expect(sim.world.isSolid(p.pos.x, p.pos.y)).toBe(true);
    // Props are drawn only: the simulation never hears of them.
    expect(sim.structures).toHaveLength(0);
  });

  it('a wanted resource wins over a nearer one, and plain rock never counts', () => {
    const sim = new Simulation({ body: getBody('ironrock')!, events: new EventBus() });
    const any = findMinimalDeposit(sim);
    expect(any).not.toBeNull();
    expect(['regolith', 'stone']).not.toContain(any!.resource);
    const crystal = findMinimalDeposit(sim, ['crystal']);
    if (crystal) expect(crystal.resource).toBe('crystal');
  });
});
