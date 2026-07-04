/** Shared engine types. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Voxel material ids. 0 is always air. */
export enum Material {
  Air = 0,
  Regolith = 1,
  Rock = 2,
  Basalt = 3,
  Ice = 4,
  IronOre = 5,
  Silica = 6,
  CopperOre = 7,
  TitaniumOre = 8,
  Crystal = 9,
  Dust = 10,
  Sulfur = 11,
}

/** Mined resource keys (what ends up in cargo / inventory). */
export type ResourceKey =
  | 'regolith'
  | 'stone'
  | 'ice'
  | 'iron'
  | 'silica'
  | 'copper'
  | 'titanium'
  | 'crystal'
  | 'sulfur';

export interface MaterialDef {
  id: Material;
  name: string;
  /** Mining ticks at power 1. */
  hardness: number;
  /** Resource yielded when mined, and how much. */
  yields: { resource: ResourceKey; amount: number } | null;
  /** Base face colors [top, left, right] as css colors. */
  colors: [string, string, string];
  /** 0..1 amount of per-voxel color jitter for texture. */
  jitter: number;
}

export type BodyType = 'planet' | 'moon' | 'asteroid';

export interface BodyDef {
  id: string;
  name: string;
  type: BodyType;
  /** Surface gravity, m/s^2. Affects fall damage and landing fuel. */
  gravity: number;
  /** Solar irradiance multiplier vs Earth orbit (gameplay-scaled). */
  solarFlux: number;
  /** Game-seconds for a full day/night cycle. 0 = no night. */
  dayLength: number;
  /** Fuel units required to reach and land on this body. */
  deltaV: number;
  /** World edge length in voxels. */
  size: number;
  /** Max terrain height in voxels. */
  maxHeight: number;
  seed: number;
  palette: { sky: string; skyNight: string };
  terrain: {
    roughness: number; // 0..1
    craters: number; // approx count
    iceCaps: number; // 0..1 fraction of map edge covered by ice
    oreRichness: number; // 0..1
    /** 0..1 coverage of surface sulfur fields (volcanic bodies). */
    sulfurFields?: number;
    /** Irregular island-shaped world (asteroids). */
    irregular?: boolean;
  };
  description: string;
}

export type PartCategory =
  | 'chassis'
  | 'wheels'
  | 'power'
  | 'battery'
  | 'tool'
  | 'camera'
  | 'scanner'
  | 'cargo'
  | 'fuel';

export interface PartDef {
  id: string;
  category: PartCategory;
  name: string;
  tier: 1 | 2 | 3;
  mass: number;
  /** Credit cost in the customiser. */
  cost: number;
  description: string;
  stats: Partial<{
    slots: number; // chassis: how many optional parts fit
    durability: number; // chassis
    speed: number; // wheels: tiles per second (before mass penalty)
    maxClimb: number; // wheels: max voxel height step
    grip: number; // wheels: reduces wear 0..1
    solarRate: number; // power: charge/sec at flux 1 in daylight
    rtgRate: number; // power: constant charge/sec
    batteryCapacity: number;
    miningPower: number; // tool
    miningEnergy: number; // tool: energy per mining action
    photoQuality: number; // camera 1..10
    photoEnergy: number;
    scanRadius: number; // scanner, tiles
    scanEnergy: number;
    cargoCapacity: number;
    fuelCapacity: number;
  }>;
}

/** A rover build: one part id per required category + optional module part ids. */
export interface RoverSpec {
  id: string;
  name: string;
  chassis: string;
  wheels: string;
  power: string;
  battery: string;
  /** Optional module part ids (tool/camera/scanner/cargo/fuel), limited by chassis slots. */
  modules: string[];
  /** Hull tint for the customiser, css color. */
  color: string;
}

export interface RoverStats {
  mass: number;
  batteryCapacity: number;
  solarRate: number;
  rtgRate: number;
  speed: number; // tiles/sec after mass penalty
  maxClimb: number;
  grip: number;
  miningPower: number;
  miningEnergy: number;
  photoQuality: number;
  photoEnergy: number;
  scanRadius: number;
  scanEnergy: number;
  cargoCapacity: number;
  fuelCapacity: number;
  durabilityMax: number;
  /** Battery cost to move one tile on flat ground. */
  moveEnergy: number;
  cost: number;
  valid: boolean;
  problems: string[];
}

export type AnomalyType =
  | 'wreckage'
  | 'crystal-formation'
  | 'magnetic-anomaly'
  | 'fossil-traces'
  | 'ice-vent'
  | 'monolith';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  name: string;
  pos: Vec2;
  /** Revealed by a scanner sweep. */
  scanned: boolean;
  /** Photographed / documented => counts as a discovery. */
  documented: boolean;
}

export type StructureType = 'solar-array' | 'beacon' | 'drill-rig' | 'cache' | 'habitat-frame';

export interface StructureDef {
  type: StructureType;
  name: string;
  cost: Partial<Record<ResourceKey, number>>;
  description: string;
}

export interface Structure {
  id: string;
  type: StructureType;
  pos: Vec2;
  /** drill-rig: buffered resources awaiting pickup. */
  buffer: Partial<Record<ResourceKey, number>>;
}

export interface PhotoMeta {
  id: string;
  bodyId: string;
  pos: Vec2;
  quality: number;
  timestamp: number;
  /** Anomaly captured in frame, if any. */
  anomalyId?: string;
  caption: string;
}

export interface RoverState {
  spec: RoverSpec;
  stats: RoverStats;
  /** Tile position. */
  pos: Vec2;
  /** Interpolated render position. */
  renderPos: Vec2;
  facing: 0 | 1 | 2 | 3; // SE, SW, NW, NE in iso space
  battery: number;
  fuel: number;
  durability: number;
  cargo: Partial<Record<ResourceKey, number>>;
  cargoUsed: number;
  /** Current tile-move in progress (0..1). */
  moveT: number;
  moveFrom: Vec2 | null;
  /** Mining progress on target column, ticks remaining. */
  mining: { pos: Vec2; remaining: number; total: number } | null;
}

export interface MissionState {
  id: string;
  bodyId: string;
  seed: number;
  /** Game time in seconds since landing. */
  time: number;
  rover: RoverState;
  structures: Structure[];
  anomalies: Anomaly[];
  photos: PhotoMeta[];
  /** Voxel edits as packed "x,y,z" keys -> material (0 = mined out). */
  edits: Record<string, number>;
  status: 'active' | 'complete' | 'lost';
}

export interface GameEvents {
  tick: { time: number; daylight: number };
  moved: { pos: Vec2; energyUsed: number };
  blocked: { reason: 'cliff' | 'battery' | 'edge' | 'busy' };
  mined: { pos: Vec2; resource: ResourceKey | null; amount: number };
  miningStarted: { pos: Vec2; total: number };
  cargoFull: {};
  photo: { photo: PhotoMeta; dataUrl: string | null };
  scan: { found: Anomaly[]; energyUsed: number };
  anomalyDocumented: { anomaly: Anomaly };
  built: { structure: Structure };
  buildFailed: { reason: string };
  repaired: { amount: number };
  damaged: { amount: number; reason: 'fall' | 'terrain' };
  batteryEmpty: {};
  roverLost: { reason: string };
  stateChanged: {};
}

export type GameEventKey = keyof GameEvents;
