import { describe, expect, it } from 'vitest';
import { defaultSpec, EventBus, getBody, Simulation } from '../src/index.js';

describe('a scene only has a rover when it brings one', () => {
  it('a simulation with no spec still runs, on the default rover', () => {
    const sim = new Simulation({ body: getBody('moon')!, events: new EventBus() });
    expect(sim.rover.spec.id).toBe(defaultSpec().id);
  });

  it('a given spec is the one that is used', () => {
    const spec = { ...defaultSpec(), id: 'mine' };
    const sim = new Simulation({ body: getBody('moon')!, spec, events: new EventBus() });
    expect(sim.rover.spec.id).toBe('mine');
  });
});
