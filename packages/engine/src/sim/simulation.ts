import type {
  ActiveWeather,
  Anomaly,
  BodyDef,
  MissionState,
  PhotoMeta,
  RoverSpec,
  RoverState,
  Structure,
  StructureType,
  Vec2,
  WeatherType,
  GameEventKey,
} from '../types.js';
import { MISSION_SCHEMA_VERSION } from '../types.js';
import { EventBus } from '../util/events.js';
import { makeId } from '../util/rng.js';
import { VoxelWorld } from '../world/world.js';
import { runWorldLayers } from '../world/layers.js';
import { coreCall } from '../go/sync.js';
import { coreConfig } from './core-config.js';

export const TICK_RATE = 10;
export const TICK_DT = 1 / TICK_RATE;
export const DRIVE_SPEED_MULTIPLIER = 1.35;
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
  resume?: MissionState;
}
interface CoreState {
  time: number;
  rover: RoverState;
  structures: Structure[];
  anomalies: Anomaly[];
  photos: PhotoMeta[];
  status: 'active' | 'complete' | 'lost';
  banked: Record<string, number> | null;
  weather: ActiveWeather | null;
  edits: Record<string, number>;
  powered: string[];
  launches: { pos: Vec2; t: number }[];
  landingSite: Vec2;
}
interface CoreReply {
  result: unknown;
  state: CoreState;
  events: {
    kind: string;
    payload?: unknown;
    x?: number;
    y?: number;
    detail?: string;
    amount?: number;
  }[];
}

const releasedEngines =
  typeof FinalizationRegistry === 'undefined'
    ? undefined
    : new FinalizationRegistry<number>((id) => {
        try {
          coreCall('dispose', { engineId: id });
        } catch {
          /* already released */
        }
      });

/** Compatibility projection over the Go simulation. The host may edit public
 * fields as before; command costs, rules, world edits and ticks run only in Go. */
export class Simulation {
  readonly body: BodyDef;
  readonly events: EventBus;
  readonly seed: number;
  readonly missionId: string;
  readonly landingSite: Vec2;
  readonly world: VoxelWorld;
  private engineId: number;
  private disposed = false;
  time = 0;
  rover!: RoverState;
  structures: Structure[] = [];
  anomalies: Anomaly[] = [];
  photos: PhotoMeta[] = [];
  status: 'active' | 'complete' | 'lost' = 'active';
  banked: Record<string, number> = {};
  weather: ActiveWeather | null = null;
  impacts: { pos: Vec2; t: number }[] = [];
  launches: { pos: Vec2; t: number }[] = [];
  powered = new Set<string>();

  constructor(opts: SimOptions) {
    this.body = opts.body;
    this.events = opts.events;
    this.seed = opts.resume?.seed ?? opts.seed ?? opts.body.seed;
    this.missionId = opts.resume?.id ?? makeId('msn');
    this.engineId = coreCall<number>('create', {
      seed: this.seed >>> 0,
      config: coreConfig(opts.body, opts.resume?.rover.spec ?? opts.spec),
    });
    const stored = (opts.resume as (MissionState & { coreSnapshot?: string }) | undefined)
      ?.coreSnapshot;
    let restored = false;
    if (stored) {
      try {
        coreCall('restore', { engineId: this.engineId, snapshot: stored });
        restored = true;
      } catch (error) {
        console.warn('takeon-core: using legacy save after rejected snapshot', error);
      }
    }

    const world = coreCall<{ size: number; maxHeight: number; voxels: number[] }>('world', {
      engineId: this.engineId,
    });
    this.world = new VoxelWorld(world.size, world.maxHeight);
    for (let y = 0; y < world.size; y++)
      for (let x = 0; x < world.size; x++)
        for (let z = 0; z < world.maxHeight; z++) {
          const m = world.voxels[(y * world.size + x) * world.maxHeight + z];
          if (m) this.world.setRaw(x, y, z, m);
        }
    runWorldLayers(opts.body, this.seed, this.world);
    const initial = coreCall<CoreState>('hostState', { engineId: this.engineId });
    this.landingSite = initial.landingSite;
    this.adopt(initial);
    if (opts.resume && !restored) {
      const s = opts.resume;
      this.time = s.time ?? 0;
      this.structures = (s.structures ?? []).map((v) => ({ ...v, buffer: { ...v.buffer } }));
      this.photos = [...(s.photos ?? [])];
      this.weather = s.weather ?? null;
      this.status = s.status ?? 'active';
      this.world.applyEdits(s.edits ?? {});
      for (const a of s.anomalies ?? []) {
        const current = this.anomalies.find((v) => v.id === a.id);
        if (current) {
          current.scanned = a.scanned;
          current.documented = a.documented;
        }
      }
      const currentStats = this.rover.stats;
      Object.assign(this.rover, s.rover, {
        stats: currentStats,
        cargo: { ...s.rover.cargo },
        moveFrom: null,
        moveT: 0,
        mining: null,
        renderPos: { ...s.rover.pos },
      });
      this.invoke('refreshStats');
    }
    releasedEngines?.register(this, this.engineId, this);
  }
  private host() {
    return {
      time: this.time,
      rover: this.rover,
      structures: this.structures,
      anomalies: this.anomalies,
      photos: this.photos,
      status: this.status,
      banked: this.banked,
      weather: this.weather,
      edits: this.world.edits,
    };
  }
  private adopt(s: CoreState) {
    this.time = s.time;
    // Preserve references used by host/render code (e.g. const r=sim.rover).
    if (this.rover) {
      const stats = this.rover.stats;
      Object.assign(stats, s.rover.stats);
      Object.assign(this.rover, s.rover, { stats });
    } else this.rover = s.rover;
    this.rover.renderPos = this.rover.moveFrom
      ? {
          x: this.rover.moveFrom.x + (this.rover.pos.x - this.rover.moveFrom.x) * this.rover.moveT,
          y: this.rover.moveFrom.y + (this.rover.pos.y - this.rover.moveFrom.y) * this.rover.moveT,
        }
      : { ...this.rover.pos };
    const previous = new Map(this.structures.map((v) => [v.id, v]));
    this.structures = s.structures.map((v) => {
      const existing = previous.get(v.id);
      return existing ? Object.assign(existing, v) : v;
    });
    const anomalies = new Map(this.anomalies.map((a) => [a.id, a]));
    this.anomalies = s.anomalies.map((a) => {
      const current = anomalies.get(a.id);
      return current ? Object.assign(current, a) : a;
    });
    this.photos = s.photos;
    this.status = s.status;
    this.banked = s.banked ?? {};
    this.weather = s.weather;
    this.impacts = this.impacts.filter((i) => this.time - i.t < 1.1);
    this.powered = new Set(s.powered);
    this.launches = s.launches;
    for (const [key, mat] of Object.entries(s.edits)) {
      if (this.world.edits[key] !== mat) {
        const [x, y, z] = key.split(',').map(Number);
        this.world.set(x, y, z, mat);
      }
    }
  }
  private invoke<T>(kind: string, text = '', arg = 0, dt = 0): T {
    const reply = coreCall<CoreReply>('sim', {
      engineId: this.engineId,
      kind,
      text,
      arg,
      dt,
      host: this.host(),
    });
    this.adopt(reply.state);
    for (const event of reply.events) {
      let payload = event.payload;
      if (payload === undefined) {
        if (event.kind === 'moved')
          payload = { pos: { x: event.x ?? 0, y: event.y ?? 0 }, energyUsed: event.amount ?? 0 };
        else if (event.kind === 'blocked' || event.kind === 'roverLost')
          payload = { reason: event.detail ?? '' };
        else if (event.kind === 'cargoFull') payload = {};
        else continue;
      }
      if (event.kind === 'meteorImpact')
        this.impacts.push({ pos: (payload as { pos: Vec2 }).pos, t: this.time });
      this.events.emit(event.kind as GameEventKey, payload as never);
    }
    if (kind === 'build' && reply.result) {
      return this.structures.find((s) => s.id === (reply.result as Structure).id) as T;
    }
    return reply.result as T;
  }
  tick() {
    this.invoke('tick');
  }
  move(dir: 0 | 1 | 2 | 3) {
    return this.invoke<boolean>('move', '', dir);
  }
  mine() {
    return this.invoke<boolean>('mine');
  }
  scan() {
    return this.invoke<Anomaly[]>('scan');
  }
  photo() {
    return this.invoke<PhotoMeta | null>('photo');
  }
  build(type: StructureType) {
    return this.invoke<Structure | null>('build', type);
  }
  rotateStructure(id: string) {
    return this.invoke<boolean>('rotateStructure', id);
  }
  demolish(id: string) {
    return this.invoke<boolean>('demolish', id);
  }
  depositCargo() {
    return this.invoke<number>('depositCargo');
  }
  launchCargo() {
    return this.invoke<boolean>('launchCargo');
  }
  upgradeMobility() {
    return this.invoke<boolean>('upgradeMobility');
  }
  craft(id: string) {
    return this.invoke<boolean>('craft', id);
  }
  placeBlock() {
    return this.invoke<boolean>('placeBlock');
  }
  repair() {
    return this.invoke<boolean>('repair');
  }
  private query(kind: string): number {
    return coreCall<CoreReply>('sim', { engineId: this.engineId, kind, host: this.host() })
      .result as number;
  }
  daylight() {
    return this.query('daylight');
  }
  weatherSolarMult() {
    return this.query('weatherSolarMult');
  }
  weatherMoveMult() {
    return this.query('weatherMoveMult');
  }
  weatherSensorMult() {
    return this.query('weatherSensorMult');
  }
  startWeather(type: WeatherType, intensity?: number, duration?: number) {
    this.invoke(
      'startWeather',
      JSON.stringify({ type, intensity: intensity ?? -1, duration: duration ?? -1 }),
    );
  }
  interpolateRender(remainder: number) {
    const r = this.rover;
    if (!r.moveFrom) {
      r.renderPos = { ...r.pos };
      return;
    }
    const t = Math.min(
      0.999,
      r.moveT + r.stats.speed * DRIVE_SPEED_MULTIPLIER * Math.max(0, remainder),
    );
    r.renderPos = {
      x: r.moveFrom.x + (r.pos.x - r.moveFrom.x) * t,
      y: r.moveFrom.y + (r.pos.y - r.moveFrom.y) * t,
    };
  }
  serialize(): MissionState {
    this.invoke('sync');
    const coreSnapshot = coreCall<string>('snapshot', { engineId: this.engineId });
    return {
      schemaVersion: MISSION_SCHEMA_VERSION,
      id: this.missionId,
      bodyId: this.body.id,
      seed: this.seed,
      time: this.time,
      rover: {
        ...this.rover,
        upgrades: { ...this.rover.upgrades! },
        cargo: { ...this.rover.cargo },
        renderPos: { ...this.rover.pos },
        moveFrom: null,
        moveT: 0,
        mining: null,
      },
      structures: this.structures.map((s) => ({ ...s, buffer: { ...s.buffer } })),
      anomalies: this.anomalies.map((a) => ({ ...a, pos: { ...a.pos } })),
      photos: [...this.photos],
      edits: { ...this.world.edits },
      weather: this.weather,
      status: this.status,
      coreSnapshot,
    } as MissionState;
  }
  dispose() {
    if (this.disposed) return;
    coreCall('dispose', { engineId: this.engineId });
    this.disposed = true;
    releasedEngines?.unregister(this);
  }
}
