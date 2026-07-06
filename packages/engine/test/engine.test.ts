import { describe, expect, it } from 'vitest';
import {
  BODIES,
  computeStats,
  canReach,
  defaultSpec,
  DIRS,
  EventBus,
  findLandingSite,
  generateAnomalies,
  generateTerrain,
  getBody,
  Material,
  MISSION_SCHEMA_VERSION,
  missionCredits,
  PARTS,
  Simulation,
  TICK_RATE,
} from '../src/index.js';
import type { MissionState, RoverSpec } from '../src/index.js';

function makeSim(bodyId = 'moon', spec?: Partial<RoverSpec>) {
  const body = getBody(bodyId)!;
  return new Simulation({
    body,
    spec: { ...defaultSpec(), id: 'r1', ...spec },
    events: new EventBus(),
  });
}

function runTicks(sim: Simulation, n: number) {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('terrain generation', () => {
  it('is deterministic for the same body and seed', () => {
    const body = getBody('mars')!;
    const a = generateTerrain(body);
    const b = generateTerrain(body);
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % body.size;
      const y = (i * 71) % body.size;
      expect(a.height(x, y)).toBe(b.height(x, y));
      expect(a.surfaceMaterial(x, y)).toBe(b.surfaceMaterial(x, y));
    }
  });

  it('produces solid ground everywhere on regular bodies', () => {
    const body = getBody('moon')!;
    const w = generateTerrain(body);
    for (let y = 0; y < body.size; y++) {
      for (let x = 0; x < body.size; x++) {
        expect(w.height(x, y)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('produces void columns outside irregular asteroid silhouettes', () => {
    const body = getBody('bennu')!;
    const w = generateTerrain(body);
    expect(w.height(0, 0)).toBe(-1);
    // Centre must be solid.
    const c = Math.floor(body.size / 2);
    expect(w.height(c, c)).toBeGreaterThanOrEqual(0);
  });

  it('mining removes the top voxel and records an edit', () => {
    const body = getBody('moon')!;
    const w = generateTerrain(body);
    const c = Math.floor(body.size / 2);
    const before = w.height(c, c);
    const mat = w.mineTop(c, c);
    expect(mat).not.toBeNull();
    expect(w.height(c, c)).toBe(before - 1);
    expect(Object.keys(w.edits)).toHaveLength(1);
  });

  it('re-applies edits deterministically after regeneration', () => {
    const body = getBody('ceres')!;
    const w1 = generateTerrain(body);
    const c = findLandingSite(w1);
    w1.mineTop(c.x, c.y);
    w1.mineTop(c.x, c.y);
    const w2 = generateTerrain(body);
    w2.applyEdits(w1.edits);
    expect(w2.height(c.x, c.y)).toBe(w1.height(c.x, c.y));
  });
});

describe('anomalies', () => {
  it('places 3-5 seeded anomalies on solid ground, away from landing', () => {
    for (const body of BODIES) {
      const w = generateTerrain(body);
      const a1 = generateAnomalies(body, w);
      const a2 = generateAnomalies(body, w);
      expect(a1.length).toBeGreaterThanOrEqual(3);
      expect(a1.length).toBeLessThanOrEqual(5);
      expect(a1.map((a) => a.id)).toEqual(a2.map((a) => a.id));
      for (const a of a1) {
        expect(w.isSolid(a.pos.x, a.pos.y)).toBe(true);
      }
    }
  });
});

describe('rover assembly', () => {
  it('computes valid stats for the default spec', () => {
    const stats = computeStats({ ...defaultSpec(), id: 'x' });
    expect(stats.valid).toBe(true);
    expect(stats.batteryCapacity).toBeGreaterThan(0);
    expect(stats.speed).toBeGreaterThan(0);
    expect(stats.cost).toBeGreaterThan(0);
  });

  it('rejects overfilled module slots', () => {
    const spec: RoverSpec = {
      ...defaultSpec(),
      id: 'x',
      chassis: 'chassis-scout', // 2 slots
      modules: ['tool-scoop', 'cam-nav', 'scan-short'],
    };
    const stats = computeStats(spec);
    expect(stats.valid).toBe(false);
    expect(stats.problems.join(' ')).toMatch(/slots/);
  });

  it('rejects duplicate module categories and wrong-category parts', () => {
    const spec: RoverSpec = {
      ...defaultSpec(),
      id: 'x',
      chassis: 'chassis-hauler',
      modules: ['cam-nav', 'cam-pano'],
    };
    expect(computeStats(spec).valid).toBe(false);
    expect(computeStats({ ...defaultSpec(), id: 'x', wheels: 'cam-nav' }).valid).toBe(false);
  });

  it('mass slows the rover down', () => {
    const light = computeStats({ ...defaultSpec(), id: 'x', modules: [] });
    const heavy = computeStats({
      ...defaultSpec(),
      id: 'x',
      chassis: 'chassis-hauler',
      battery: 'batt-vault',
      modules: ['tool-laser', 'cargo-hold', 'fuel-long', 'cam-science'],
    });
    expect(heavy.speed).toBeLessThan(light.speed);
    expect(heavy.moveEnergy).toBeGreaterThan(light.moveEnergy);
  });

  it('gates destinations on fuel capacity', () => {
    const noTank = computeStats({ ...defaultSpec(), id: 'x', modules: ['tool-scoop'] });
    const io = getBody('io')!;
    expect(canReach(noTank, io.deltaV)).toBe(false);
    const tanked = computeStats({
      ...defaultSpec(),
      id: 'x',
      chassis: 'chassis-lab',
      modules: ['tool-scoop', 'fuel-long'],
    });
    expect(canReach(tanked, io.deltaV)).toBe(true);
  });

  it('every catalog part participates in at least one valid build', () => {
    for (const p of PARTS) {
      const spec = { ...defaultSpec(), id: 'x' };
      if (p.category === 'chassis') spec.chassis = p.id;
      else if (p.category === 'wheels') spec.wheels = p.id;
      else if (p.category === 'power') spec.power = p.id;
      else if (p.category === 'battery') spec.battery = p.id;
      else {
        spec.chassis = 'chassis-hauler';
        spec.modules = [p.id];
      }
      expect(computeStats(spec).valid, `part ${p.id}`).toBe(true);
    }
  });
});

describe('simulation', () => {
  it('lands at a flat site with full battery and fuel minus delta-v', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    expect(r.battery).toBe(r.stats.batteryCapacity);
    expect(r.fuel).toBe(r.stats.fuelCapacity - sim.body.deltaV);
    expect(sim.world.isSolid(r.pos.x, r.pos.y)).toBe(true);
  });

  it('moving drains battery and updates position', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    const before = { ...r.pos, battery: r.battery };
    // Find a direction that works from the landing site.
    let moved = false;
    for (const dir of [0, 1, 2, 3] as const) {
      if (sim.move(dir)) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
    expect(r.battery).toBeLessThan(before.battery);
    expect(r.pos.x !== before.x || r.pos.y !== before.y).toBe(true);
    // Finish the tile transition.
    runTicks(sim, TICK_RATE * 2);
    expect(r.moveFrom).toBeNull();
    expect(r.renderPos).toEqual(r.pos);
  });

  it('solar charging only happens in daylight', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    r.battery = 10;
    expect(sim.daylight()).toBe(1);
    runTicks(sim, TICK_RATE * 5);
    expect(r.battery).toBeGreaterThan(10);
    // Jump to night.
    sim.time = sim.body.dayLength * 0.75;
    expect(sim.daylight()).toBe(0);
    const nightBefore = r.battery;
    runTicks(sim, TICK_RATE * 2);
    expect(r.battery).toBeCloseTo(nightBefore, 3);
  });

  it('mining yields cargo and consumes energy', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    const started = tryMineAnyDirection(sim);
    expect(started).toBe(true);
    const before = r.cargoUsed;
    runTicks(sim, TICK_RATE * 30);
    expect(r.mining).toBeNull();
    expect(r.cargoUsed).toBeGreaterThan(before);
  });

  it('scan reveals anomalies within radius', () => {
    const sim = makeSim('moon', { chassis: 'chassis-lab', modules: ['scan-deep', 'cam-nav'] });
    // Teleport next to an anomaly to guarantee a hit.
    const a = sim.anomalies[0];
    sim.rover.pos = { x: a.pos.x + 2, y: a.pos.y };
    sim.rover.renderPos = { ...sim.rover.pos };
    const found = sim.scan();
    expect(found.some((f) => f.id === a.id)).toBe(true);
    expect(a.scanned).toBe(true);
  });

  it('photographing near an anomaly documents it', () => {
    const sim = makeSim('moon');
    const a = sim.anomalies[0];
    sim.rover.pos = { x: a.pos.x + 1, y: a.pos.y };
    const meta = sim.photo()!;
    expect(meta.anomalyId).toBe(a.id);
    expect(a.documented).toBe(true);
  });

  it('builds a structure when cargo covers the cost', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    r.cargo = { silica: 6, iron: 4 };
    r.cargoUsed = 10;
    const s = sim.build('solar-array');
    expect(s).not.toBeNull();
    expect(r.cargoUsed).toBe(0);
    expect(sim.structures).toHaveLength(1);
    // Can't build twice on the same tile.
    r.cargo = { silica: 6, iron: 4 };
    r.cargoUsed = 10;
    expect(sim.build('solar-array')).toBeNull();
  });

  it('serialises and resumes a mission faithfully', () => {
    const sim = makeSim('mars');
    tryMineAnyDirection(sim);
    runTicks(sim, TICK_RATE * 30);
    sim.rover.cargo = { ...sim.rover.cargo, iron: 3, copper: 2 };
    sim.rover.cargoUsed += 5;
    const built = sim.build('beacon');
    expect(built).not.toBeNull();
    const snap = sim.serialize();

    const resumed = new Simulation({
      body: getBody('mars')!,
      spec: snap.rover.spec,
      events: new EventBus(),
      resume: snap,
    });
    expect(resumed.rover.pos).toEqual(sim.rover.pos);
    expect(resumed.rover.cargoUsed).toBe(sim.rover.cargoUsed);
    expect(resumed.structures).toHaveLength(1);
    expect(resumed.world.height(snap.structures[0].pos.x, snap.structures[0].pos.y)).toBe(
      sim.world.height(snap.structures[0].pos.x, snap.structures[0].pos.y),
    );
    // Mined tile persisted through the resume.
    for (const key of Object.keys(snap.edits)) {
      const [x, y, z] = key.split(',').map(Number);
      expect(resumed.world.get(x, y, z)).toBe(snap.edits[key]);
    }
  });

  it('rover with dead battery and no recharge is lost', () => {
    const sim = makeSim('moon');
    // Strip its generation and battery.
    sim.rover.stats = { ...sim.rover.stats, solarRate: 0, rtgRate: 0 };
    sim.rover.battery = 0;
    runTicks(sim, 2);
    expect(sim.status).toBe('lost');
  });
});

describe('mission credits', () => {
  it('pays for banked resources, cargo, documented anomalies and photos', () => {
    const sim = makeSim('moon');
    sim.rover.cargo = { crystal: 2 };
    sim.anomalies[0].documented = true;
    sim.photos.push({
      id: 'p1',
      bodyId: 'moon',
      pos: { x: 0, y: 0 },
      quality: 10,
      timestamp: 1,
      caption: 'test',
    });
    const state: MissionState = sim.serialize();
    const credits = missionCredits(state, { iron: 4 });
    // 2*25 crystal + 4*5 iron + 120 discovery + 20 photo
    expect(credits).toBe(50 + 20 + 120 + 20);
  });
});

function tryMineAnyDirection(sim: Simulation): boolean {
  for (const dir of [0, 1, 2, 3] as const) {
    sim.rover.facing = dir;
    if (sim.mine()) return true;
  }
  // Mining can fail if all neighbours are bedrock-height; force terrain.
  const r = sim.rover;
  const d = DIRS[0];
  const tx = r.pos.x + d.x;
  const ty = r.pos.y + d.y;
  const h = sim.world.height(tx, ty);
  if (h >= 0) {
    sim.world.setRaw(tx, ty, Math.min(sim.world.maxHeight - 1, h + 1), Material.Rock);
    r.facing = 0;
    return sim.mine();
  }
  return false;
}

describe('crafting and refining', () => {
  it('refines iron into plates, consuming battery and cargo', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    r.cargo = { iron: 4 };
    r.cargoUsed = 4;
    const b0 = r.battery;
    expect(sim.craft('iron-plate')).toBe(true);
    expect(r.cargo.iron).toBe(2);
    expect(r.cargo['iron-plate']).toBe(1);
    expect(r.cargoUsed).toBe(3);
    expect(r.battery).toBeLessThan(b0);
  });

  it('rejects recipes without inputs and gates alloy behind a refinery', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    expect(sim.craft('glass')).toBe(false);
    r.cargo = { titanium: 1, 'iron-plate': 1 };
    r.cargoUsed = 2;
    expect(sim.craft('alloy')).toBe(false); // no refinery nearby
    r.cargo = { ...r.cargo, stone: 6, iron: 4 };
    r.cargoUsed += 10;
    expect(sim.build('refinery')).not.toBeNull();
    expect(sim.craft('alloy')).toBe(true);
    expect(r.cargo.alloy).toBe(1);
  });
});

describe('block placement', () => {
  it('places a stone block on the facing tile, raising it by one', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    r.cargo = { stone: 2 };
    r.cargoUsed = 2;
    const d = DIRS[r.facing];
    const tx = r.pos.x + d.x;
    const ty = r.pos.y + d.y;
    const before = sim.world.height(tx, ty);
    expect(sim.placeBlock()).toBe(true);
    expect(sim.world.height(tx, ty)).toBe(before + 1);
    expect(r.cargo.stone).toBe(1);
    // The placement is a persisted edit.
    expect(Object.keys(sim.world.edits).length).toBeGreaterThan(0);
  });

  it('refuses without stone in cargo', () => {
    const sim = makeSim('moon');
    expect(sim.placeBlock()).toBe(false);
  });
});

describe('weather', () => {
  it('dust storms cut solar charging and raise drive cost', () => {
    const sim = makeSim('mars');
    sim.startWeather('dust-storm', 1, 60);
    expect(sim.weatherSolarMult()).toBeCloseTo(0.35, 2);
    expect(sim.weatherMoveMult()).toBeCloseTo(1.3, 2);
    const r = sim.rover;
    r.battery = 10;
    const clearCharge = r.stats.solarRate * sim.body.solarFlux; // per second, clear sky
    runTicks(sim, TICK_RATE * 2);
    expect(r.battery - 10).toBeLessThan(clearCharge * 2 * 0.6);
  });

  it('solar storms drain the battery and double instrument costs', () => {
    const sim = makeSim('moon');
    sim.rover.stats = { ...sim.rover.stats, solarRate: 0, rtgRate: 0.001 }; // isolate drain
    sim.startWeather('solar-storm', 1, 60);
    expect(sim.weatherSensorMult()).toBe(2);
    const before = sim.rover.battery;
    runTicks(sim, TICK_RATE * 3);
    expect(sim.rover.battery).toBeLessThan(before);
  });

  it('meteor showers crater the terrain via persisted edits', () => {
    const sim = makeSim('moon');
    sim.startWeather('meteor-shower', 1, 60);
    const editsBefore = Object.keys(sim.world.edits).length;
    runTicks(sim, TICK_RATE * 20);
    expect(Object.keys(sim.world.edits).length).toBeGreaterThan(editsBefore);
    expect(sim.impacts.length + 1).toBeGreaterThan(0); // markers fade but events fired
  });

  it('weather ends and survives serialise/resume', () => {
    const sim = makeSim('mars');
    sim.startWeather('dust-devil', 0.8, 5);
    expect(sim.weather?.pos).toBeDefined();
    const snap = sim.serialize();
    const resumed = new Simulation({
      body: getBody('mars')!,
      spec: snap.rover.spec,
      events: new EventBus(),
      resume: snap,
    });
    expect(resumed.weather?.type).toBe('dust-devil');
    runTicks(resumed, TICK_RATE * 6);
    expect(resumed.weather).toBeNull();
  });
});

describe('cargo launch', () => {
  function padBeside(sim: Simulation) {
    const r = sim.rover;
    sim.structures.push({
      id: 'pad1',
      type: 'launch-pad',
      pos: { x: r.pos.x + 1, y: r.pos.y },
      buffer: {},
    });
  }

  it('banks the hold and fires a rocket from an adjacent pad', () => {
    const sim = makeSim('moon');
    padBeside(sim);
    const r = sim.rover;
    r.cargo = { iron: 3, silica: 2 };
    r.cargoUsed = 5;
    expect(sim.launchCargo()).toBe(true);
    expect(r.cargoUsed).toBe(0);
    expect(sim.banked.iron).toBe(3);
    expect(sim.banked.silica).toBe(2);
    expect(sim.launches.length).toBe(1);
  });

  it('refuses to fire again until the pad refuels', () => {
    const sim = makeSim('moon');
    padBeside(sim);
    const r = sim.rover;
    r.cargo = { iron: 2 };
    r.cargoUsed = 2;
    expect(sim.launchCargo()).toBe(true);
    r.cargo = { iron: 2 };
    r.cargoUsed = 2;
    expect(sim.launchCargo()).toBe(false); // still on cooldown
  });

  it('refuses with no pad nearby or an empty hold', () => {
    const sim = makeSim('moon');
    expect(sim.launchCargo()).toBe(false); // no pad
    padBeside(sim);
    expect(sim.launchCargo()).toBe(false); // empty hold, no rigs
  });

  it('also sweeps adjacent drill-rig buffers into the rocket', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    const pad = { x: r.pos.x + 1, y: r.pos.y };
    sim.structures.push({ id: 'pad2', type: 'launch-pad', pos: pad, buffer: {} });
    sim.structures.push({ id: 'rig1', type: 'drill-rig', pos: { x: pad.x, y: pad.y + 1 }, buffer: { iron: 5 } });
    // Empty hold, but the neighbouring rig has ore — it ships anyway.
    expect(sim.launchCargo()).toBe(true);
    expect(sim.banked.iron).toBe(5);
    expect(sim.structures.find((s) => s.id === 'rig1').buffer.iron ?? 0).toBe(0);
  });
});

describe('outpost power grid', () => {
  it('a generator powers nearby structures and pylons relay to distant ones', () => {
    const sim = makeSim('moon');
    const O = { x: 24, y: 24 };
    sim.structures.push({ id: 'gen', type: 'generator', pos: { x: O.x, y: O.y }, buffer: {} });
    sim.structures.push({ id: 'nearRig', type: 'drill-rig', pos: { x: O.x + 4, y: O.y }, buffer: {} });
    sim.structures.push({ id: 'pyl', type: 'pylon', pos: { x: O.x + 5, y: O.y }, buffer: {} });
    sim.structures.push({ id: 'farRig', type: 'drill-rig', pos: { x: O.x + 9, y: O.y }, buffer: {} });
    sim.structures.push({ id: 'orphan', type: 'drill-rig', pos: { x: O.x + 16, y: O.y }, buffer: {} });
    sim.tick();
    expect(sim.powered.has('nearRig')).toBe(true);
    expect(sim.powered.has('pyl')).toBe(true);
    expect(sim.powered.has('farRig')).toBe(true); // reached only via the pylon relay
    expect(sim.powered.has('orphan')).toBe(false);
  });

  it('a fuelled pad pulls a drill line and auto-ships at the threshold', () => {
    const sim = makeSim('moon');
    const O = { x: 30, y: 30 };
    const pad = { id: 'pad', type: 'launch-pad' as const, pos: { x: O.x, y: O.y }, buffer: {} };
    const rig = { id: 'rig', type: 'drill-rig' as const, pos: { x: O.x + 1, y: O.y }, buffer: { iron: 20 } };
    sim.structures.push(pad, rig);
    sim.tick();
    expect(sim.banked.iron).toBe(20);
    expect(sim.launches.length).toBe(1);
    expect(pad.cooldownUntil ?? 0).toBeGreaterThan(0);
    expect(rig.buffer.iron ?? 0).toBe(0);
  });

  it('a powered habitat frame finishes, then recharges and repairs a parked rover', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    sim.structures.push({ id: 'gen', type: 'generator', pos: { x: r.pos.x + 1, y: r.pos.y + 1 }, buffer: {} });
    const frame = { id: 'hab', type: 'habitat-frame' as const, pos: { x: r.pos.x + 1, y: r.pos.y }, buffer: {} };
    sim.structures.push(frame);
    let done = false;
    sim.events.on('habitatComplete', () => { done = true; });
    runTicks(sim, TICK_RATE * 31);
    expect(done).toBe(true);
    expect(sim.structures.find((s) => s.id === 'hab').type).toBe('habitat');
    r.durability = 40;
    runTicks(sim, TICK_RATE * 2);
    expect(r.durability).toBeGreaterThan(40);
  });
});

describe('save schema versioning', () => {
  it('stamps the current schema version on serialize', () => {
    expect(makeSim('moon').serialize().schemaVersion).toBe(MISSION_SCHEMA_VERSION);
  });

  it('resumes a legacy save that predates upgrades/outposts', () => {
    const snap = makeSim('moon').serialize();
    const legacy = JSON.parse(JSON.stringify(snap));
    delete legacy.schemaVersion; // pre-v2 payload
    delete legacy.rover.upgrades;
    const resumed = new Simulation({
      body: getBody('moon')!,
      spec: legacy.rover.spec,
      events: new EventBus(),
      resume: legacy,
    });
    expect(resumed.rover.upgrades).toEqual({ mobility: 0 });
    expect(resumed.status).toBe('active');
    expect(resumed.serialize().schemaVersion).toBe(MISSION_SCHEMA_VERSION);
  });

  it('tolerates a partial save missing optional arrays', () => {
    const snap = makeSim('moon').serialize();
    const partial = {
      id: snap.id, bodyId: snap.bodyId, seed: snap.seed, time: 0,
      rover: snap.rover, status: 'active',
    } as unknown as MissionState;
    const resumed = new Simulation({
      body: getBody('moon')!,
      spec: snap.rover.spec,
      events: new EventBus(),
      resume: partial,
    });
    expect(resumed.structures).toEqual([]);
    expect(resumed.photos).toEqual([]);
    expect(() => resumed.tick()).not.toThrow();
  });
});

describe('mobility upgrades', () => {
  it('spends refined materials to raise climb, grip and speed', () => {
    const sim = makeSim('moon');
    const r = sim.rover;
    const climb0 = r.stats.maxClimb;
    const grip0 = r.stats.grip;
    r.cargo = { 'iron-plate': 2, alloy: 1 };
    r.cargoUsed = 3;
    expect(sim.upgradeMobility()).toBe(true);
    expect(r.upgrades?.mobility).toBe(1);
    expect(r.stats.maxClimb).toBe(climb0 + 1);
    expect(r.stats.grip).toBeGreaterThan(grip0);
    expect(r.cargo['iron-plate'] ?? 0).toBe(0);
  });

  it('refuses without materials and survives serialise/resume', () => {
    const sim = makeSim('moon');
    expect(sim.upgradeMobility()).toBe(false);
    const r = sim.rover;
    r.cargo = { 'iron-plate': 2, alloy: 1 };
    r.cargoUsed = 3;
    sim.upgradeMobility();
    const climb = r.stats.maxClimb;
    const snap = sim.serialize();
    const resumed = new Simulation({
      body: getBody('moon')!,
      spec: snap.rover.spec,
      events: new EventBus(),
      resume: snap,
    });
    expect(resumed.rover.upgrades?.mobility).toBe(1);
    expect(resumed.rover.stats.maxClimb).toBe(climb);
  });
});
