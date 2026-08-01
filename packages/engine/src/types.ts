/** Shared engine types. */

import type { NoiseConfig } from './util/noise/index.js';

export type { NoiseConfig };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Voxel material ids. 0 is always air.
 *
 * This is a plain object of numeric constants, not a TS `enum` — the `type
 * Material = number` alias below means any number is a valid material id, so
 * a host can mint its own ids (see `registerMaterial` in `world/materials.js`)
 * without a cast or a fork. `Material.Air` / `Material.Regolith` / … still
 * work exactly as before; only truly custom code that relied on TS enum
 * reverse-mapping (`Material[5]`) or exhaustiveness checking would notice.
 * Built-ins occupy 0–63; register custom materials at 64 or above so a body
 * shared between games never collides with another host's ids.
 */
export const Material = {
  Air: 0,
  Regolith: 1,
  Rock: 2,
  Basalt: 3,
  Ice: 4,
  IronOre: 5,
  Silica: 6,
  CopperOre: 7,
  TitaniumOre: 8,
  Crystal: 9,
  Dust: 10,
  Sulfur: 11,
  Grass: 12,
  Sand: 13,
  Snow: 14,
} as const;
export type Material = number;

/** First id a host's custom materials should use; see `Material` above. */
export const CUSTOM_MATERIAL_BASE = 64;

/**
 * Mined resource keys (what ends up in cargo / inventory). The built-ins are
 * listed for autocomplete; `(string & {})` keeps the union open so a host can
 * key its own resources (e.g. a mineral economy of platinum/palladium/…)
 * without extending this type. See `registerResource` in `world/materials.js`.
 */
export type ResourceKey =
  | 'regolith'
  | 'stone'
  | 'ice'
  | 'iron'
  | 'silica'
  | 'copper'
  | 'titanium'
  | 'crystal'
  | 'sulfur'
  // Refined via crafting:
  | 'iron-plate'
  | 'glass'
  | 'water'
  | 'alloy'
  | (string & {});

/** A crafting/refining recipe. */
export interface Recipe {
  id: string;
  name: string;
  description: string;
  input: Partial<Record<ResourceKey, number>>;
  output: { resource: ResourceKey; amount: number };
  energy: number;
  /** Must be adjacent to this structure to craft (e.g. refinery). */
  near?: StructureType;
}

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

/**
 * One depth-stratified layer of ore composition, e.g. a shallow band rich in
 * one mineral over a deeper band of rarer ones (topsoil/subsoil/bedrock).
 * `from`/`to` are fractions of the column's own solid depth (0 = surface, 1 =
 * the deepest voxel), so bands stay proportionate across bodies with very
 * different `maxHeight`. Bands need not be contiguous or cover [0,1]; depth
 * outside every band falls back to the default flat mineral split.
 */
export interface OreBand {
  from: number;
  to: number;
  /** Relative weights among materials once a voxel has already rolled "this
   * is ore" (via `terrain.oreRichness`) — bands choose which material wins,
   * not whether a vein exists here at all. Auto-normalised; need not sum to 1. */
  minerals: Record<Material, number>;
  /** Display label for editor/host UI (e.g. "Topsoil"). */
  label?: string;
}

export type BodyType = 'planet' | 'moon' | 'asteroid' | 'gaseous';

export interface BodyDef {
  id: string;
  name: string;
  type: BodyType;
  /**
   * The `world/kinds.js` preset this body was instantiated from (e.g.
   * `'earth-like'`, `'ice-moon'`, `'c-type-asteroid'`) — a specialisation of
   * `type` used for defaulting and to gate which biomes a chunk may roll.
   * Purely informational once a body exists; absent for hand-authored bodies
   * that didn't go through `instantiateBody()`.
   */
  kind?: string;
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
  palette: {
    sky: string;
    skyNight: string;
    /** Per-channel RGB multiplier applied to terrain colours (body identity:
     * grey Moon, rusty Mars, blue-white Europa...). Default [1,1,1]. */
    tint?: [number, number, number];
  };
  /**
   * Real-terrain source: id of an embedded DEM patch (e.g. sampled from
   * NASA MOLA for Mars, LRO LOLA for the Moon). Blended with detail noise;
   * absent = fully procedural.
   */
  dem?: string;
  /**
   * Ore-vein weighting informed by spectroscopy surveys (TES hematite for
   * Mars, Clementine/M3 TiO2 for the lunar maria...). Missing = even split.
   */
  minerals?: { iron?: number; copper?: number; titanium?: number };
  /**
   * Weather event rates: expected events per ~10 game-minutes.
   * Airless bodies get solar storms and meteor showers; Mars gets dust.
   */
  weather?: Partial<Record<WeatherType, number>>;
  /**
   * Environmental data a *host* game owns and hands in — e.g. a solar-system
   * sim's own model of a planet's real temperature — so it can steer a
   * TakeOn scene without re-deriving climate from scratch. Absent = the body
   * generates exactly as it always has (biome selection falls back to the
   * flat regolith/dust/silica skin). `temperature` is a gameplay-scaled mean
   * surface value (loosely °C); `tempVariance` (0..1) is how much it swings
   * pole-to-equator or day-to-night, used to spread biomes across chunks
   * instead of picking one uniform biome for the whole body.
   */
  climate?: { temperature: number; tempVariance?: number };
  terrain: {
    roughness: number; // 0..1 — vertical amplitude (and frequency, unless `noise` is set)
    craters: number; // approx count
    iceCaps: number; // 0..1 fraction of map edge covered by ice
    oreRichness: number; // 0..1
    /** 0..1 coverage of surface sulfur fields (volcanic bodies). */
    sulfurFields?: number;
    /** Irregular island-shaped world (asteroids). */
    irregular?: boolean;
    /**
     * Elevation field. Absent = the original value-fBm terrain (what every
     * shipped body uses); set it to author with perlin/simplex/worley/ridged
     * fields, domain warp and custom octaves. See `util/noise`.
     */
    noise?: NoiseConfig;
    /**
     * Depth-stratified ore composition (topsoil/subsoil/bedrock, or however
     * many layers a host wants). Absent = the original flat iron/copper/
     * titanium split at every depth (what every shipped body uses); set it to
     * author a real strata economy — a shallow band of one mineral, a deeper
     * band of rarer ones. See `world/terrain.js`'s `OreBand`.
     */
    bands?: OreBand[];
    /**
     * Divide the surface into a `CHUNK_SIZE` grid of independently-seeded
     * regions, each rolling one biome from `world/biomes.js` (gated by
     * `climate` and the body's `kind`) instead of the single continuous
     * regolith/dust/silica skin every shipped body uses. Absent/false keeps
     * that original skin byte-identical. See `world/biomes.js`.
     */
    biomes?: boolean;
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

/** Environmental events. Which ones a body rolls comes from BodyDef.weather. */
export type WeatherType =
  | 'dust-devil' // wandering vortex; scours panels, batters the chassis up close
  | 'dust-storm' // global haze; solar drops hard, driving costs more
  | 'solar-storm' // radiation surge; electronics drain, instruments cost double
  | 'meteor-shower' // impacts crater the terrain; dangerous up close
  | 'cryo-fog'; // sublimating ice haze; dims the sun

export interface ActiveWeather {
  type: WeatherType;
  /** Seconds left. */
  remaining: number;
  duration: number;
  /** 0..1 severity. */
  intensity: number;
  /** dust-devil only: current vortex tile position. */
  pos?: Vec2;
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

/**
 * Buildable structure kinds. The built-ins are listed for autocomplete;
 * `(string & {})` keeps the union open so a host can register its own
 * catalog (a settlement core, a research lab, a fuel depot — whatever its
 * economy needs) without extending this type. See `registerStructure` in
 * `sim/structures.js`.
 */
export type StructureType =
  | 'solar-array'
  | 'beacon'
  | 'drill-rig'
  | 'cache'
  | 'refinery'
  | 'habitat-frame'
  | 'habitat'
  | 'launch-pad'
  | 'generator'
  | 'pylon'
  | (string & {});

/**
 * `functional` structures participate in the economy/power grid and are
 * strictly one-per-tile. `decorative` structures (paths, beacons, lights)
 * carry no mechanical function beyond marking/dressing a site, so they may
 * share a tile with one functional structure. Defaults to `functional`.
 */
export type StructureCategory = 'functional' | 'decorative';

export interface StructureDef {
  type: StructureType;
  name: string;
  cost: Partial<Record<ResourceKey, number>>;
  description: string;
  /** Hidden from the build menu (e.g. `habitat`, which is built by upgrading
   * a habitat-frame, not placed directly). Defaults to buildable. */
  buildable?: boolean;
  /** See `StructureCategory`. Defaults to `functional`. */
  category?: StructureCategory;
}

export interface Structure {
  id: string;
  type: StructureType;
  pos: Vec2;
  /** drill-rig / launch-pad: buffered resources awaiting pickup or shipment. */
  buffer: Partial<Record<ResourceKey, number>>;
  /** launch-pad: game-time (s) until the pad can fire the next rocket. */
  cooldownUntil?: number;
  /** habitat-frame: 0..1 construction progress toward a finished habitat. */
  progress?: number;
  /** Orientation in iso space (SE, SW, NW, NE), same convention as rover
   * `facing`. Purely cosmetic today (sprite/render hint) — set at build time
   * from the rover's facing and changeable via `rotateStructure`. Optional
   * for saves predating this field; treated as 0 when absent. */
  facing?: 0 | 1 | 2 | 3;
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

/** In-field upgrades applied on top of a rover's as-built stats. */
export interface RoverUpgrades {
  /** Mobility tier (0..3): each level adds climb, grip and a little speed. */
  mobility: number;
}

export interface RoverState {
  spec: RoverSpec;
  stats: RoverStats;
  /** In-field upgrades bought during the mission (optional for old saves). */
  upgrades?: RoverUpgrades;
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

/**
 * Bumped when the persisted MissionState shape changes. Loads are tolerant of
 * older/absent values (fields added over time are optional and defaulted on
 * resume), so this is a diagnostic marker rather than a hard gate.
 */
export const MISSION_SCHEMA_VERSION = 2;

export interface MissionState {
  /** Schema marker (absent on pre-v2 saves). */
  schemaVersion?: number;
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
  /** Active weather event, if any (added in v0.2 — optional for old saves). */
  weather?: ActiveWeather | null;
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
  rotated: { id: string; facing: 0 | 1 | 2 | 3 };
  rotateFailed: { reason: string };
  demolished: { id: string; type: StructureType; pos: Vec2 };
  demolishFailed: { reason: string };
  crafted: { recipe: string; resource: ResourceKey; amount: number };
  craftFailed: { reason: string };
  blockPlaced: { pos: Vec2 };
  cargoLaunched: { pos: Vec2; manifest: Partial<Record<ResourceKey, number>>; total: number; auto?: boolean };
  launchFailed: { reason: string };
  habitatComplete: { pos: Vec2 };
  upgraded: { kind: 'mobility'; level: number };
  upgradeFailed: { reason: string };
  repaired: { amount: number };
  damaged: { amount: number; reason: 'fall' | 'terrain' | 'impact' | 'storm' };
  weather: { type: WeatherType; phase: 'start' | 'end'; intensity: number };
  meteorImpact: { pos: Vec2; distance: number };
  batteryEmpty: {};
  roverLost: { reason: string };
  stateChanged: {};
  /** The active renderer changed (iso diorama ⇄ flat map). */
  viewChanged: { view: 'iso' | 'flat' };
}

export type GameEventKey = keyof GameEvents;

/**
 * Every event key, at runtime. `GameEvents` is a type, so hosts that want to
 * listen to everything (a debug console, analytics, quest hooks) need this
 * list. Keep it in step with `GameEvents` — `test/engine.test.ts` checks that
 * the emitter and this array agree.
 */
export const GAME_EVENT_KEYS = [
  'tick',
  'moved',
  'blocked',
  'mined',
  'miningStarted',
  'cargoFull',
  'photo',
  'scan',
  'anomalyDocumented',
  'built',
  'buildFailed',
  'rotated',
  'rotateFailed',
  'demolished',
  'demolishFailed',
  'crafted',
  'craftFailed',
  'blockPlaced',
  'cargoLaunched',
  'launchFailed',
  'habitatComplete',
  'upgraded',
  'upgradeFailed',
  'repaired',
  'damaged',
  'weather',
  'meteorImpact',
  'batteryEmpty',
  'roverLost',
  'stateChanged',
  'viewChanged',
] as const satisfies readonly GameEventKey[];

/** Compile-time guard: adding a `GameEvents` key without listing it fails here. */
type UnlistedEventKey = Exclude<GameEventKey, (typeof GAME_EVENT_KEYS)[number]>;
export const GAME_EVENT_KEYS_ARE_EXHAUSTIVE: UnlistedEventKey extends never ? true : never = true;
