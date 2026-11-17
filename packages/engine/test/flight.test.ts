import { describe, expect, it } from 'vitest';
import { FlightSim, flightHud, flightTouchSteer } from '../src/flight/sim.js';
import { BodyRaster, bodyTexture, FLIGHT_LOOKS, flightLookForBody } from '../src/flight/look.js';
import { flightSnapshot } from '../src/flight/scene.js';
import { defaultCraftLook, project } from '../src/flight/craft.js';
import { getBody } from '../src/world/registry.js';

const run = (sim: FlightSim, seconds: number) => {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...sim.step(1 / 60));
  return events;
};

describe('space flight', () => {
  it('flies departure, cruise, approach and orbit from the Go core, the same way every time', () => {
    const config = { seed: 21, duration: 20, debris: 0.4, pickups: 0.4 };
    const a = new FlightSim(config);
    const b = new FlightSim(config);
    const ea = run(a, 30);
    const eb = run(b, 30);
    expect(a.state).toEqual(b.state);
    expect(ea).toEqual(eb);
    expect(ea.filter((e) => e.kind === 'phase').map((e) => e.detail)).toEqual(['cruise', 'approach', 'orbit']);
    expect(a.state.phase).toBe('orbit');
    a.dispose();
    b.dispose();
    expect(() => a.step(1)).toThrow(/disposed/);
  });

  it('keeps the craft inside its corridor however hard it is steered', () => {
    const sim = new FlightSim({ seed: 2, duration: 60 });
    sim.steer(5, -5);
    run(sim, 6);
    expect(sim.state.x).toBe(1);
    expect(sim.state.y).toBe(-1);
    sim.dispose();
  });

  it('lets the host own the trip clock', () => {
    const sim = new FlightSim({ seed: 3, hostPaced: true });
    run(sim, 2);
    expect(sim.state.progress).toBe(0);
    sim.setProgress(0.5);
    run(sim, 1);
    expect(sim.state.phase).toBe('cruise');
    sim.setProgress(1);
    run(sim, 1);
    expect(flightSnapshot(sim.state).phase).toBe('orbit');
    sim.dispose();
  });

  it('marks orbit sites and resumes from a save', () => {
    const config = { seed: 4, startPhase: 'orbit' as const, orbitPeriod: 10, sites: [{ id: 'a', angle: 1 }] };
    const sim = new FlightSim(config);
    expect(sim.mark()).toBe(false);
    let prompt = '';
    for (let i = 0; i < 600 && !sim.state.marked.length; i++) {
      sim.step(1 / 60);
      const snap = flightSnapshot(sim.state, 1);
      if (snap.canMark) { prompt = snap.prompt; sim.mark(); }
    }
    expect(prompt).toMatch(/Mark/);
    expect(sim.state.marked).toEqual(['a']);
    const resumed = new FlightSim(config, { resume: sim.snapshot() });
    sim.step(2);
    resumed.step(2);
    expect(resumed.state).toEqual(sim.state);
    sim.dispose();
    resumed.dispose();
  });

  it('paints a seamless, deterministic surface for every kind of body', () => {
    for (const kind of Object.keys(FLIGHT_LOOKS) as (keyof typeof FLIGHT_LOOKS)[]) {
      const look = { ...FLIGHT_LOOKS[kind], seed: 9 };
      const a = bodyTexture(look, 64, 32);
      expect(Array.from(bodyTexture(look, 64, 32).data)).toEqual(Array.from(a.data));
      // The left and right edges meet on the sphere, so they must nearly match.
      let seam = 0;
      for (let y = 0; y < 32; y++) for (let c = 0; c < 3; c++) seam += Math.abs(a.data[(y * 64) * 3 + c]! - a.data[(y * 64 + 63) * 3 + c]!);
      expect(seam / (32 * 3)).toBeLessThan(40);
    }
    expect(Array.from(bodyTexture({ ...FLIGHT_LOOKS.rocky, seed: 10 }, 64, 32).data)).not.toEqual(Array.from(bodyTexture({ ...FLIGHT_LOOKS.rocky, seed: 9 }, 64, 32).data));
  });

  it('lights a globe from the sun side and turns it', () => {
    const look = { ...FLIGHT_LOOKS.ice, seed: 3 };
    const raster = new BodyRaster(bodyTexture(look, 128, 64), look, { radius: 40, light: [-1, 0, 0.2] });
    const first = Array.from(raster.draw(0));
    const at = (x: number, y: number) => ((y - raster.originY) * raster.width + (x - raster.originX)) * 4;
    const lum = (px: number[], o: number) => px[o]! + px[o + 1]! + px[o + 2]!;
    expect(lum(first, at(-25, 0))).toBeGreaterThan(lum(first, at(25, 0)) * 2);
    expect(first[at(0, 0) + 3]).toBe(255);
    expect(first[at(-raster.originX - 1, -raster.originY - 1) + 3]).toBe(0);
    expect(Array.from(raster.draw(1))).not.toEqual(first);
    // An orbit view rasters only the limb it shows.
    const limb = new BodyRaster(bodyTexture(look, 128, 64), look, { radius: 400, window: { x: -100, y: -410, width: 200, height: 60 } });
    expect(limb.width * limb.height).toBe(200 * 60);
  });

  it('derives a look from a TakeOn body and projects with perspective', () => {
    expect(flightLookForBody(getBody('bennu')!).kind).toBe('asteroid');
    expect(flightLookForBody(getBody('europa')!).kind).toBe('ice');
    expect(flightLookForBody(getBody('mars')!).colors).toHaveLength(FLIGHT_LOOKS.rocky.colors.length);
    const cam = { cx: 100, cy: 50, f: 200 };
    expect(project(cam, [1, 1, 10]).s).toBeCloseTo(project(cam, [1, 1, 20]).s * 2);
    expect(project(cam, [1, 0, 10]).x).toBeGreaterThan(project(cam, [1, 0, 20]).x);
    expect(defaultCraftLook().sections.at(-1)!.id).toBe('nose');
  });

  it('takes its picture, HUD words and touch steering from the Go core', () => {
    const sim = new FlightSim({ seed: 9, duration: 20, debris: 0.5, pickups: 0.5 });
    sim.setCraft({ sections: [{ id: 'hull', length: 1, r0: 0.2, r1: 0.1, color: '#dfd3cc' }], scale: 1.2 });
    expect(() => sim.setCraft({ sections: [] })).toThrow(/sections/);
    run(sim, 6);
    const draw = sim.draw(390, 844, 1 / 60);
    expect(draw.width).toBe(390);
    expect(draw.shapes[0]!.k).toBe('sky');
    expect(draw.shapes.some((s) => s.k === 'globe')).toBe(true);
    expect(draw.shapes.some((s) => s.k === 'ellipse' && s.fill === '#dfd3cc' && s.lit)).toBe(true);
    expect(sim.hud()).toEqual(flightHud(sim.state));
    expect(sim.hud().prompt.length).toBeGreaterThan(0);
    const [x] = flightTouchSteer({ ...sim.state, phase: 'cruise', x: 0.5 }, 0.5, 0);
    expect(x).toBeCloseTo(0.225);
    sim.dispose();
  });
});
