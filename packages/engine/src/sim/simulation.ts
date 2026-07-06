import {
  Material,
  type ActiveWeather,
  type Anomaly,
  type BodyDef,
  type MissionState,
  type PhotoMeta,
  type ResourceKey,
  type RoverSpec,
  type RoverState,
  type RoverStats,
  type Structure,
  type StructureType,
  type Vec2,
  type WeatherType,
} from '../types.js';
import type { EventBus } from '../core/events.js';
import { MATERIALS } from '../world/materials.js';
import { generateAnomalies } from '../world/anomalies.js';
import { findLandingSite, generateTerrain } from '../world/terrain.js';
import { VoxelWorld } from '../world/world.js';
import { computeStats } from '../parts/assembly.js';
import { getRecipe } from './recipes.js';
import { makeId } from '../util/rng.js';
import {
  DRILL_RATE_TICKS,
  LAUNCH_COOLDOWN,
  MAX_MOBILITY_UPGRADE,
  MOBILITY_UPGRADE_COST,
  SOLAR_ARRAY_RANGE,
  SOLAR_ARRAY_RATE,
  STRUCTURES,
} from './structures.js';
import { WEATHER_INFO } from './weather.js';
import { mulberry32 } from '../util/rng.js';

export const TICK_RATE = 10; // fixed sim ticks per second
export const TICK_DT = 1 / TICK_RATE;

/** Directions in iso space: 0=SE(+x) 1=SW(+y) 2=NW(-x) 3=NE(-y). */
export const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export interface SimOptions {
  body: BodyDef;
  spec: RoverSpec;
  events: EventBus;
  seed?: number;
  /** Resume a saved mission instead of starting fresh. */
  resume?: MissionState;
}

/**
 * The deterministic game simulation: fixed-timestep, renderer-agnostic.
 * All gameplay rules live here; the renderer and UI only observe.
 */
export class Simulation {
  readonly body: BodyDef;
  readonly world: VoxelWorld;
  readonly events: EventBus;
  readonly seed: number;
  readonly missionId: string;

  time = 0;
  rover: RoverState;
  structures: Structure[] = [];
  anomalies: Anomaly[];
  photos: PhotoMeta[] = [];
  status: 'active' | 'complete' | 'lost' = 'active';
  /** Banked yield deposited into caches. */
  banked: Partial<Record<ResourceKey, number>> = {};
  /** Active weather event, if any. */
  weather: ActiveWeather | null = null;
  /** Recent meteor strikes for the renderer (fade after ~1s). */
  impacts: { pos: Vec2; t: number }[] = [];
  /** In-flight cargo rockets for the renderer (fade after ~3s). */
  launches: { pos: Vec2; t: number }[] = [];

  private drillTimers = new Map<string, number>();
  private weatherRng = mulberry32(0);
  private weatherCooldown = 20; // grace period after landing / between events
  private impactTimer = 0;
  private devilDrift: Vec2 = { x: 1, y: 0 };

  constructor(opts: SimOptions) {
    this.body = opts.body;
    this.events = opts.events;
    this.seed = opts.resume?.seed ?? opts.seed ?? opts.body.seed;
    this.missionId = opts.resume?.id ?? makeId('msn');
    this.world = generateTerrain(opts.body, this.seed);
    this.anomalies = generateAnomalies(opts.body, this.world, this.seed);
    this.weatherRng = mulberry32(this.seed ^ 0x77ea);

    if (opts.resume) {
      const r = opts.resume;
      this.time = r.time;
      this.world.applyEdits(r.edits);
      this.structures = r.structures.map((s) => ({ ...s, buffer: { ...s.buffer } }));
      this.weather = r.weather ? { ...r.weather, pos: r.weather.pos ? { ...r.weather.pos } : undefined } : null;
      this.photos = [...r.photos];
      this.status = r.status;
      for (const saved of r.anomalies) {
        const a = this.anomalies.find((x) => x.id === saved.id);
        if (a) {
          a.scanned = saved.scanned;
          a.documented = saved.documented;
        }
      }
      this.rover = {
        ...r.rover,
        upgrades: r.rover.upgrades ? { ...r.rover.upgrades } : { mobility: 0 },
        renderPos: { ...r.rover.pos },
        moveFrom: null,
        moveT: 0,
        mining: null,
        cargo: { ...r.rover.cargo },
      };
      // Stats may have been rebalanced since the save — recompute, then
      // re-apply the mission's field upgrades on top.
      this.rover.stats = this.applyMobility(
        computeStats(r.rover.spec),
        this.rover.upgrades!.mobility,
      );
    } else {
      const site = findLandingSite(this.world);
      const stats = computeStats(opts.spec);
      // Landing burns delta-v worth of fuel.
      const fuel = Math.max(0, stats.fuelCapacity - opts.body.deltaV);
      this.rover = {
        spec: opts.spec,
        stats,
        upgrades: { mobility: 0 },
        pos: { ...site },
        renderPos: { ...site },
        facing: 0,
        battery: stats.batteryCapacity,
        fuel,
        durability: stats.durabilityMax,
        cargo: {},
        cargoUsed: 0,
        moveT: 0,
        moveFrom: null,
        mining: null,
      };
    }
  }

  /** 0..1 daylight factor for the current game time. */
  daylight(): number {
    if (this.body.dayLength <= 0) return 1;
    const phase = (this.time % this.body.dayLength) / this.body.dayLength;
    // Day for 60% of the cycle with soft dawn/dusk ramps.
    if (phase < 0.5) return 1;
    if (phase < 0.6) return 1 - (phase - 0.5) * 10;
    if (phase < 0.9) return 0;
    return (phase - 0.9) * 10;
  }

  // ── Weather ───────────────────────────────────────────────────────────

  /** Solar-output multiplier from the current weather. */
  weatherSolarMult(): number {
    const w = this.weather;
    if (!w) return 1;
    if (w.type === 'dust-storm') return 1 - 0.65 * w.intensity;
    if (w.type === 'cryo-fog') return 1 - 0.55 * w.intensity;
    if (w.type === 'dust-devil' && w.pos) {
      const d = Math.hypot(w.pos.x - this.rover.pos.x, w.pos.y - this.rover.pos.y);
      if (d <= 4) return 0.5;
    }
    return 1;
  }

  /** Drive-cost multiplier from the current weather. */
  weatherMoveMult(): number {
    const w = this.weather;
    return w && w.type === 'dust-storm' ? 1 + 0.3 * w.intensity : 1;
  }

  /** Instrument (scan/photo) energy multiplier from the current weather. */
  weatherSensorMult(): number {
    const w = this.weather;
    return w && w.type === 'solar-storm' ? 2 : 1;
  }

  /** Begin a weather event (also the hook the host/tests can force). */
  startWeather(type: WeatherType, intensity?: number, duration?: number): void {
    const info = WEATHER_INFO[type];
    const i = intensity ?? 0.5 + this.weatherRng() * 0.5;
    const d = duration ?? info.minDuration + this.weatherRng() * (info.maxDuration - info.minDuration);
    const w: ActiveWeather = { type, intensity: i, duration: d, remaining: d };
    if (type === 'dust-devil') {
      // Spawn the vortex 8-14 tiles out, drifting loosely toward the rover.
      const ang = this.weatherRng() * Math.PI * 2;
      const dist = 8 + this.weatherRng() * 6;
      w.pos = {
        x: Math.round(this.rover.pos.x + Math.cos(ang) * dist),
        y: Math.round(this.rover.pos.y + Math.sin(ang) * dist),
      };
      this.devilDrift = { x: -Math.cos(ang), y: -Math.sin(ang) };
    }
    this.weather = w;
    this.impactTimer = 0;
    this.events.emit('weather', { type, phase: 'start', intensity: i });
  }

  private tickWeather(): void {
    const r = this.rover;
    // Fade old impact markers.
    if (this.impacts.length > 0) {
      this.impacts = this.impacts.filter((i) => this.time - i.t < 1.2);
    }

    const w = this.weather;
    if (!w) {
      if (this.weatherCooldown > 0) {
        this.weatherCooldown -= TICK_DT;
        return;
      }
      const rates = this.body.weather;
      if (!rates) return;
      for (const [type, rate] of Object.entries(rates) as [WeatherType, number][]) {
        // rate = expected events per ~10 game-minutes.
        if (this.weatherRng() < (rate * TICK_DT) / 600) {
          this.startWeather(type);
          return;
        }
      }
      return;
    }

    w.remaining -= TICK_DT;
    if (w.remaining <= 0) {
      this.events.emit('weather', { type: w.type, phase: 'end', intensity: w.intensity });
      this.weather = null;
      this.weatherCooldown = 15 + this.weatherRng() * 30;
      return;
    }

    switch (w.type) {
      case 'dust-devil': {
        if (!w.pos) break;
        // Wander: mostly keep drifting, occasionally veer.
        if (this.weatherRng() < 0.06) {
          const a = this.weatherRng() * Math.PI * 2;
          this.devilDrift = { x: Math.cos(a), y: Math.sin(a) };
        }
        if (this.weatherRng() < 0.35) {
          const nx = w.pos.x + Math.round(this.devilDrift.x + (this.weatherRng() - 0.5));
          const ny = w.pos.y + Math.round(this.devilDrift.y + (this.weatherRng() - 0.5));
          if (this.world.isSolid(nx, ny)) w.pos = { x: nx, y: ny };
        }
        // Up close it batters the chassis.
        if (Math.hypot(w.pos.x - r.pos.x, w.pos.y - r.pos.y) <= 1.6) {
          this.damage(0.35 * w.intensity, 'storm');
        }
        break;
      }
      case 'solar-storm':
        // Radiation load on the electronics.
        r.battery = Math.max(0, r.battery - 0.18 * w.intensity * TICK_DT * 10);
        break;
      case 'meteor-shower': {
        this.impactTimer += TICK_DT;
        const interval = 2.6 - w.intensity;
        if (this.impactTimer >= interval) {
          this.impactTimer = 0;
          const ang = this.weatherRng() * Math.PI * 2;
          const dist = 2 + this.weatherRng() * 16;
          const ix = Math.round(r.pos.x + Math.cos(ang) * dist);
          const iy = Math.round(r.pos.y + Math.sin(ang) * dist);
          if (this.world.isSolid(ix, iy) && !(ix === r.pos.x && iy === r.pos.y)) {
            // Small crater: knock the top voxel off (a persisted edit).
            if (this.world.height(ix, iy) > 1) this.world.mineTop(ix, iy);
            this.impacts.push({ pos: { x: ix, y: iy }, t: this.time });
            const d = Math.hypot(ix - r.pos.x, iy - r.pos.y);
            this.events.emit('meteorImpact', { pos: { x: ix, y: iy }, distance: d });
            if (d <= 2.5) this.damage(4 + 6 * w.intensity, 'impact');
          }
        }
        break;
      }
      default:
        break; // dust-storm / cryo-fog act via the multipliers only
    }
  }

  /** Advance the simulation by exactly one fixed tick. */
  tick(): void {
    if (this.status !== 'active') return;
    this.time += TICK_DT;
    const r = this.rover;
    const daylight = this.daylight();

    this.tickWeather();

    // Fade spent cargo-rocket markers (renderer-only, transient).
    if (this.launches.length > 0) {
      this.launches = this.launches.filter((l) => this.time - l.t < 3);
    }

    // ── Charging ────────────────────────────────────────────────────────
    let charge =
      r.stats.rtgRate + r.stats.solarRate * daylight * this.body.solarFlux * this.weatherSolarMult();
    for (const s of this.structures) {
      if (s.type === 'solar-array' && daylight > 0) {
        if (Math.hypot(s.pos.x - r.pos.x, s.pos.y - r.pos.y) <= SOLAR_ARRAY_RANGE) {
          charge += SOLAR_ARRAY_RATE * daylight * this.body.solarFlux;
        }
      }
    }
    r.battery = Math.min(r.stats.batteryCapacity, r.battery + charge * TICK_DT);

    // ── Movement interpolation ──────────────────────────────────────────
    if (r.moveFrom) {
      r.moveT += r.stats.speed * TICK_DT;
      if (r.moveT >= 1) {
        r.moveT = 0;
        r.moveFrom = null;
        r.renderPos = { ...r.pos };
        this.collectNearbyDrillBuffers();
      } else {
        r.renderPos = {
          x: r.moveFrom.x + (r.pos.x - r.moveFrom.x) * r.moveT,
          y: r.moveFrom.y + (r.pos.y - r.moveFrom.y) * r.moveT,
        };
      }
    }

    // ── Mining progress ─────────────────────────────────────────────────
    if (r.mining) {
      r.mining.remaining -= r.stats.miningPower * TICK_DT * TICK_RATE;
      if (r.mining.remaining <= 0) {
        const { pos } = r.mining;
        r.mining = null;
        const mat = this.world.mineTop(pos.x, pos.y);
        if (mat !== null) {
          const y = MATERIALS[mat].yields;
          if (y) this.addCargo(y.resource, y.amount);
          this.events.emit('mined', {
            pos,
            resource: y?.resource ?? null,
            amount: y?.amount ?? 0,
          });
        }
      }
    }

    // ── Auto drill rigs ─────────────────────────────────────────────────
    for (const s of this.structures) {
      if (s.type !== 'drill-rig') continue;
      const t = (this.drillTimers.get(s.id) ?? 0) + 1;
      if (t >= DRILL_RATE_TICKS) {
        this.drillTimers.set(s.id, 0);
        const mat = this.world.mineTop(s.pos.x, s.pos.y);
        if (mat !== null) {
          const y = MATERIALS[mat].yields;
          if (y) s.buffer[y.resource] = (s.buffer[y.resource] ?? 0) + y.amount;
        }
      } else {
        this.drillTimers.set(s.id, t);
      }
    }

    if (r.battery <= 0.01 && r.stats.rtgRate === 0 && r.stats.solarRate === 0) {
      this.status = 'lost';
      this.events.emit('roverLost', { reason: 'Battery depleted with no way to recharge.' });
    }

    this.events.emit('tick', { time: this.time, daylight });
  }

  // ── Actions ───────────────────────────────────────────────────────────

  /** Try to move one tile in direction 0..3. Returns whether the move started. */
  move(dir: 0 | 1 | 2 | 3): boolean {
    const r = this.rover;
    if (this.status !== 'active') return false;
    r.facing = dir;
    if (r.moveFrom || r.mining) {
      this.events.emit('blocked', { reason: 'busy' });
      return false;
    }
    const d = DIRS[dir];
    const nx = r.pos.x + d.x;
    const ny = r.pos.y + d.y;
    if (!this.world.inBounds(nx, ny) || !this.world.isSolid(nx, ny)) {
      this.events.emit('blocked', { reason: 'edge' });
      return false;
    }
    const step = this.world.step(r.pos.x, r.pos.y, nx, ny);
    if (step > r.stats.maxClimb) {
      this.events.emit('blocked', { reason: 'cliff' });
      return false;
    }
    const slopeFactor = 1 + Math.max(0, step) * 0.5;
    const cost = r.stats.moveEnergy * slopeFactor * this.weatherMoveMult();
    if (r.battery < cost) {
      this.events.emit('batteryEmpty', {});
      this.events.emit('blocked', { reason: 'battery' });
      return false;
    }
    r.battery -= cost;

    // Dropping down further than maxClimb hurts, scaled by gravity.
    if (step < -r.stats.maxClimb) {
      const fall = -step - r.stats.maxClimb;
      const dmg = fall * this.body.gravity * (1.6 - r.stats.grip);
      this.damage(dmg, 'fall');
    } else if (Math.abs(step) >= 1) {
      // General terrain wear, mitigated by grip.
      this.damage(0.4 * (1 - r.stats.grip), 'terrain');
    }

    r.moveFrom = { ...r.pos };
    r.pos = { x: nx, y: ny };
    r.moveT = 0;
    this.events.emit('moved', { pos: { ...r.pos }, energyUsed: cost });
    return true;
  }

  /** Begin mining the top voxel of the tile the rover is facing. */
  mine(): boolean {
    const r = this.rover;
    if (this.status !== 'active' || r.moveFrom || r.mining) return false;
    if (r.stats.miningPower <= 0) return false;
    const d = DIRS[r.facing];
    const tx = r.pos.x + d.x;
    const ty = r.pos.y + d.y;
    if (!this.world.isSolid(tx, ty)) return false;
    const h = this.world.height(tx, ty);
    if (h <= 0) return false; // bedrock
    // Don't mine a column so tall its top is unreachable.
    if (h - this.world.height(r.pos.x, r.pos.y) > r.stats.maxClimb + 2) return false;
    if (r.cargoUsed >= r.stats.cargoCapacity) {
      this.events.emit('cargoFull', {});
      return false;
    }
    const mat = this.world.get(tx, ty, h);
    const hardness = MATERIALS[mat].hardness;
    if (r.battery < r.stats.miningEnergy) {
      this.events.emit('blocked', { reason: 'battery' });
      return false;
    }
    r.battery -= r.stats.miningEnergy;
    r.mining = { pos: { x: tx, y: ty }, remaining: hardness, total: hardness };
    this.events.emit('miningStarted', { pos: { x: tx, y: ty }, total: hardness });
    return true;
  }

  /** Scanner sweep: reveals anomalies within radius. */
  scan(): Anomaly[] {
    const r = this.rover;
    if (this.status !== 'active' || r.stats.scanRadius <= 0) return [];
    const scanCost = r.stats.scanEnergy * this.weatherSensorMult();
    if (r.battery < scanCost) {
      this.events.emit('blocked', { reason: 'battery' });
      return [];
    }
    r.battery -= scanCost;
    const found: Anomaly[] = [];
    for (const a of this.anomalies) {
      if (a.scanned) continue;
      if (Math.hypot(a.pos.x - r.pos.x, a.pos.y - r.pos.y) <= r.stats.scanRadius) {
        a.scanned = true;
        found.push(a);
      }
    }
    this.events.emit('scan', { found, energyUsed: scanCost });
    return found;
  }

  /**
   * Take a photo. The renderer supplies the actual image; the sim decides
   * cost, quality and whether an anomaly was captured (within 6 tiles).
   */
  photo(): PhotoMeta | null {
    const r = this.rover;
    if (this.status !== 'active' || r.stats.photoQuality <= 0) return null;
    const photoCost = r.stats.photoEnergy * this.weatherSensorMult();
    if (r.battery < photoCost) {
      this.events.emit('blocked', { reason: 'battery' });
      return null;
    }
    r.battery -= photoCost;
    let captured: Anomaly | undefined;
    for (const a of this.anomalies) {
      if (Math.hypot(a.pos.x - r.pos.x, a.pos.y - r.pos.y) <= 6) {
        captured = a;
        break;
      }
    }
    const meta: PhotoMeta = {
      id: makeId('pho'),
      bodyId: this.body.id,
      pos: { ...r.pos },
      quality: r.stats.photoQuality,
      timestamp: this.time,
      anomalyId: captured?.id,
      caption: captured
        ? `${captured.name} — ${this.body.name}`
        : `Surface survey — ${this.body.name}`,
    };
    this.photos.push(meta);
    if (captured && !captured.documented) {
      captured.documented = true;
      captured.scanned = true;
      this.events.emit('anomalyDocumented', { anomaly: captured });
    }
    return meta;
  }

  /** Build a structure on the tile the rover is facing. */
  build(type: StructureType): Structure | null {
    const r = this.rover;
    if (this.status !== 'active' || r.moveFrom || r.mining) return null;
    const def = STRUCTURES[type];
    const d = DIRS[r.facing];
    const tx = r.pos.x + d.x;
    const ty = r.pos.y + d.y;
    if (!this.world.isSolid(tx, ty)) {
      this.events.emit('buildFailed', { reason: 'No ground there.' });
      return null;
    }
    if (Math.abs(this.world.step(r.pos.x, r.pos.y, tx, ty)) > 1) {
      this.events.emit('buildFailed', { reason: 'Ground too uneven.' });
      return null;
    }
    if (this.structures.some((s) => s.pos.x === tx && s.pos.y === ty)) {
      this.events.emit('buildFailed', { reason: 'Something is already built there.' });
      return null;
    }
    for (const [res, qty] of Object.entries(def.cost) as [ResourceKey, number][]) {
      if ((r.cargo[res] ?? 0) < qty) {
        this.events.emit('buildFailed', { reason: `Needs ${qty} ${res} in cargo.` });
        return null;
      }
    }
    for (const [res, qty] of Object.entries(def.cost) as [ResourceKey, number][]) {
      this.removeCargo(res, qty);
    }
    const s: Structure = { id: makeId('str'), type, pos: { x: tx, y: ty }, buffer: {} };
    this.structures.push(s);
    this.events.emit('built', { structure: s });
    return s;
  }

  /** Deposit all cargo into an adjacent cache, banking it as mission yield. */
  depositCargo(): number {
    const r = this.rover;
    const cache = this.structures.find(
      (s) =>
        s.type === 'cache' &&
        Math.abs(s.pos.x - r.pos.x) <= 1 &&
        Math.abs(s.pos.y - r.pos.y) <= 1,
    );
    if (!cache) return 0;
    let moved = 0;
    for (const [res, qty] of Object.entries(r.cargo) as [ResourceKey, number][]) {
      if (!qty) continue;
      this.banked[res] = (this.banked[res] ?? 0) + qty;
      moved += qty;
      delete r.cargo[res];
    }
    r.cargoUsed = 0;
    if (moved > 0) this.events.emit('stateChanged', {});
    return moved;
  }

  /**
   * Fire the hold home on a cargo rocket from an adjacent launch pad. Banks
   * everything in cargo as mission yield (same payout path as a cache) and
   * kicks off the launch animation. The pad then refuels before it can fire
   * again. Returns whether a rocket left the ground.
   */
  launchCargo(): boolean {
    const r = this.rover;
    if (this.status !== 'active' || r.moveFrom || r.mining) return false;
    const pad = this.structures.find(
      (s) =>
        s.type === 'launch-pad' &&
        Math.abs(s.pos.x - r.pos.x) <= 1 &&
        Math.abs(s.pos.y - r.pos.y) <= 1,
    );
    if (!pad) {
      this.events.emit('launchFailed', { reason: 'Park beside a launch pad.' });
      return false;
    }
    if (pad.cooldownUntil != null && this.time < pad.cooldownUntil) {
      this.events.emit('launchFailed', { reason: 'The pad is still refuelling.' });
      return false;
    }
    if (r.cargoUsed <= 0) {
      this.events.emit('launchFailed', { reason: 'The hold is empty.' });
      return false;
    }
    const manifest: Partial<Record<ResourceKey, number>> = {};
    let total = 0;
    for (const [res, qty] of Object.entries(r.cargo) as [ResourceKey, number][]) {
      if (!qty) continue;
      this.banked[res] = (this.banked[res] ?? 0) + qty;
      manifest[res] = qty;
      total += qty;
      delete r.cargo[res];
    }
    r.cargoUsed = 0;
    pad.cooldownUntil = this.time + LAUNCH_COOLDOWN;
    this.launches.push({ pos: { ...pad.pos }, t: this.time });
    this.events.emit('cargoLaunched', { pos: { ...pad.pos }, manifest, total });
    this.events.emit('stateChanged', {});
    return true;
  }

  /**
   * Spend refined materials to bolt on a mobility kit: each level raises the
   * rover's climb, grip and speed so a stranded rover can get moving again.
   */
  upgradeMobility(): boolean {
    const r = this.rover;
    if (this.status !== 'active') return false;
    const up = (r.upgrades ??= { mobility: 0 });
    if (up.mobility >= MAX_MOBILITY_UPGRADE) {
      this.events.emit('upgradeFailed', { reason: 'Mobility is already maxed out.' });
      return false;
    }
    const cost = MOBILITY_UPGRADE_COST[up.mobility] ?? {};
    for (const [res, qty] of Object.entries(cost) as [ResourceKey, number][]) {
      if ((r.cargo[res] ?? 0) < qty) {
        this.events.emit('upgradeFailed', { reason: `Needs ${qty} ${res} in cargo.` });
        return false;
      }
    }
    for (const [res, qty] of Object.entries(cost) as [ResourceKey, number][]) {
      this.removeCargo(res, qty);
    }
    up.mobility += 1;
    r.stats = this.applyMobility(computeStats(r.spec), up.mobility);
    this.events.emit('upgraded', { kind: 'mobility', level: up.mobility });
    this.events.emit('stateChanged', {});
    return true;
  }

  /**
   * Craft/refine from cargo. Recipes with a `near` requirement need the
   * matching structure on one of the 8 surrounding tiles.
   */
  craft(recipeId: string): boolean {
    const r = this.rover;
    if (this.status !== 'active') return false;
    const rec = getRecipe(recipeId);
    if (!rec) return false;
    if (rec.near) {
      const ok = this.structures.some(
        (s) =>
          s.type === rec.near &&
          Math.abs(s.pos.x - r.pos.x) <= 1 &&
          Math.abs(s.pos.y - r.pos.y) <= 1,
      );
      if (!ok) {
        this.events.emit('craftFailed', { reason: `Needs an adjacent ${rec.near}.` });
        return false;
      }
    }
    if (r.battery < rec.energy) {
      this.events.emit('craftFailed', { reason: 'Not enough battery.' });
      return false;
    }
    for (const [res, qty] of Object.entries(rec.input) as [ResourceKey, number][]) {
      if ((r.cargo[res] ?? 0) < qty) {
        this.events.emit('craftFailed', { reason: `Needs ${qty} ${res} in cargo.` });
        return false;
      }
    }
    r.battery -= rec.energy;
    for (const [res, qty] of Object.entries(rec.input) as [ResourceKey, number][]) {
      this.removeCargo(res, qty);
    }
    this.addCargo(rec.output.resource, rec.output.amount);
    this.events.emit('crafted', {
      recipe: rec.id,
      resource: rec.output.resource,
      amount: rec.output.amount,
    });
    return true;
  }

  /**
   * Place a stone block on the tile the rover faces (1 stone from cargo).
   * Raises the column by one voxel — bridges, ramps, walls.
   */
  placeBlock(): boolean {
    const r = this.rover;
    if (this.status !== 'active' || r.moveFrom || r.mining) return false;
    const d = DIRS[r.facing];
    const tx = r.pos.x + d.x;
    const ty = r.pos.y + d.y;
    if (!this.world.isSolid(tx, ty)) return false;
    if (this.structures.some((s) => s.pos.x === tx && s.pos.y === ty)) {
      this.events.emit('buildFailed', { reason: 'Something is already built there.' });
      return false;
    }
    if ((r.cargo.stone ?? 0) < 1) {
      this.events.emit('buildFailed', { reason: 'Needs 1 stone in cargo.' });
      return false;
    }
    const energy = 2;
    if (r.battery < energy) {
      this.events.emit('blocked', { reason: 'battery' });
      return false;
    }
    const placed = this.world.placeTop(tx, ty, Material.Rock);
    if (placed < 0) {
      this.events.emit('buildFailed', { reason: 'Column is at max height.' });
      return false;
    }
    r.battery -= energy;
    this.removeCargo('stone', 1);
    this.events.emit('blockPlaced', { pos: { x: tx, y: ty } });
    return true;
  }

  /** Spend 2 stone + 1 iron to restore 25 durability. */
  repair(): boolean {
    const r = this.rover;
    if ((r.cargo.stone ?? 0) < 2 || (r.cargo.iron ?? 0) < 1) return false;
    if (r.durability >= r.stats.durabilityMax) return false;
    this.removeCargo('stone', 2);
    this.removeCargo('iron', 1);
    const amount = Math.min(25, r.stats.durabilityMax - r.durability);
    r.durability += amount;
    this.events.emit('repaired', { amount });
    return true;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Fold the mission's mobility upgrade level into a base stat block. */
  private applyMobility(stats: RoverStats, level: number): RoverStats {
    if (level <= 0) return stats;
    return {
      ...stats,
      maxClimb: stats.maxClimb + level,
      grip: Math.min(0.95, stats.grip + 0.12 * level),
      speed: Math.round(stats.speed * (1 + 0.08 * level) * 100) / 100,
    };
  }

  private damage(amount: number, reason: 'fall' | 'terrain' | 'impact' | 'storm'): void {
    if (amount <= 0.01) return;
    const r = this.rover;
    r.durability = Math.max(0, r.durability - amount);
    this.events.emit('damaged', { amount, reason });
    if (r.durability <= 0) {
      this.status = 'lost';
      this.events.emit('roverLost', { reason: 'Chassis destroyed.' });
    }
  }

  private addCargo(res: ResourceKey, amount: number): void {
    const r = this.rover;
    const space = r.stats.cargoCapacity - r.cargoUsed;
    const take = Math.min(space, amount);
    if (take <= 0) {
      this.events.emit('cargoFull', {});
      return;
    }
    r.cargo[res] = (r.cargo[res] ?? 0) + take;
    r.cargoUsed += take;
  }

  private removeCargo(res: ResourceKey, amount: number): void {
    const r = this.rover;
    const have = r.cargo[res] ?? 0;
    const take = Math.min(have, amount);
    r.cargo[res] = have - take;
    if (r.cargo[res] === 0) delete r.cargo[res];
    r.cargoUsed = Math.max(0, r.cargoUsed - take);
  }

  private collectNearbyDrillBuffers(): void {
    const r = this.rover;
    for (const s of this.structures) {
      if (s.type !== 'drill-rig') continue;
      if (Math.abs(s.pos.x - r.pos.x) > 1 || Math.abs(s.pos.y - r.pos.y) > 1) continue;
      for (const [res, qty] of Object.entries(s.buffer) as [ResourceKey, number][]) {
        if (!qty) continue;
        const space = r.stats.cargoCapacity - r.cargoUsed;
        const take = Math.min(space, qty);
        if (take <= 0) break;
        this.addCargo(res, take);
        s.buffer[res] = qty - take;
        if (s.buffer[res] === 0) delete s.buffer[res];
      }
    }
  }

  /** Serialisable snapshot for persistence. */
  serialize(): MissionState {
    return {
      id: this.missionId,
      bodyId: this.body.id,
      seed: this.seed,
      time: this.time,
      rover: {
        ...this.rover,
        upgrades: this.rover.upgrades ? { ...this.rover.upgrades } : { mobility: 0 },
        renderPos: { ...this.rover.pos },
        moveFrom: null,
        moveT: 0,
        mining: null,
        cargo: { ...this.rover.cargo },
      },
      structures: this.structures.map((s) => ({ ...s, buffer: { ...s.buffer } })),
      anomalies: this.anomalies.map((a) => ({ ...a, pos: { ...a.pos } })),
      photos: [...this.photos],
      edits: { ...this.world.edits },
      weather: this.weather
        ? { ...this.weather, pos: this.weather.pos ? { ...this.weather.pos } : undefined }
        : null,
      status: this.status,
    };
  }
}
