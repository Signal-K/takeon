import { describe, expect, it, vi } from 'vitest';
import { Simulation, getBody, defaultSpec, EventBus } from '../src/index.js';
function create(resume?: ReturnType<Simulation['serialize']>) {
  const body = { ...getBody('moon')!, size: 16, maxHeight: 12, weather: {} };
  return new Simulation({ body, spec: defaultSpec(), events: new EventBus(), resume });
}
describe('shared Go simulation compatibility', () => {
  it('keeps render interpolation intact when renderers read daylight and weather', () => {
    const sim = create();
    expect(([0, 1, 2, 3] as const).some((d) => sim.move(d))).toBe(true);
    sim.tick();
    sim.interpolateRender(0.04);
    const position = { ...sim.rover.renderPos };
    sim.daylight();
    sim.weatherMoveMult();
    sim.weatherSolarMult();
    sim.weatherSensorMult();
    expect(sim.rover.renderPos).toEqual(position);
    sim.dispose();
    sim.dispose();
  });
  it('stores the core continuation and preserves fractional weather durations', () => {
    const sim = create();
    sim.startWeather('dust-storm', 0.4, 0.35);
    sim.tick();
    const saved = sim.serialize();
    expect(JSON.parse(saved.coreSnapshot!).time).toBe(sim.time);
    const restored = create(saved);
    expect(restored.weather?.remaining).toBeCloseTo(0.25);
    for (let i = 0; i < 3; i++) restored.tick();
    expect(restored.weather).toBeNull();
    sim.dispose();
    restored.dispose();
  });
  it('resumes the legacy state when an optional core snapshot is malformed', () => {
    const sim = create();
    sim.rover.cargo = { iron: 3 };
    sim.rover.cargoUsed = 3;
    const saved = sim.serialize();
    saved.coreSnapshot = '{';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = create(saved);
    expect(restored.rover.cargo.iron).toBe(3);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
    sim.dispose();
    restored.dispose();
  });
});
