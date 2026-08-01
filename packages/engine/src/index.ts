/**
 * @takeon/engine — isometric voxel rover game engine.
 *
 * Standalone usage:
 *   const game = createRoverGame({ canvas, body: getBody('mars')!, spec });
 *   game.resize(800, 600, devicePixelRatio);
 *   game.start();
 *
 * Embedding into PixiJS (Landnam etc.): see @takeon/pixi.
 */

export * from './types.js';
export { EventBus } from './util/events.js';
export { RoverGame, createRoverGame, type RoverGameOptions, type RoverOrder } from './core/game.js';
export { GameAudio, type GameAudioOptions } from './audio/audio.js';

export { Simulation, TICK_RATE, TICK_DT, DIRS, type SimOptions } from './sim/simulation.js';
export {
  STRUCTURES,
  registerStructure,
  unregisterStructure,
  listStructures,
  SOLAR_ARRAY_RANGE,
  LAUNCH_COOLDOWN,
  MAX_MOBILITY_UPGRADE,
  MOBILITY_UPGRADE_COST,
  nextMobilityUpgradeCost,
  POWER_RANGE,
  AUTO_LAUNCH_THRESHOLD,
  HABITAT_SERVICE_RANGE,
} from './sim/structures.js';
export { RECIPES, getRecipe } from './sim/recipes.js';
export { WEATHER_INFO } from './sim/weather.js';

export { VoxelWorld } from './world/world.js';
export { generateTerrain, findLandingSite, skinBiome } from './world/terrain.js';
export { generateAnomalies } from './world/anomalies.js';
export {
  MATERIALS,
  RESOURCE_NAMES,
  registerMaterial,
  unregisterMaterial,
  listMaterials,
  registerResource,
} from './world/materials.js';
export { BODIES } from './world/bodies.js';
export {
  getBody,
  listBodies,
  registerBody,
  registerBodies,
  unregisterBody,
  clearRegisteredBodies,
  isRegisteredBody,
  registeredBodies,
} from './world/registry.js';

// Authoring: measure a world, and build/validate destinations from a tool.
export {
  heightField,
  slopeField,
  reachableMask,
  crossSection,
  analyzeTerrain,
  type TerrainAnalysis,
  type AnalyzeTerrainOptions,
} from './world/analysis.js';
export {
  createBodyDraft,
  cloneBody,
  forkBody,
  validateBody,
  builtinBodyIds,
  parseBodyJson,
  bodyToJson,
  bodyToTypeScript,
  getBodyField,
  setBodyField,
  BODY_FIELDS,
  BODY_FIELD_GROUPS,
  BODY_TYPES,
  WEATHER_TYPES,
  MIN_BODY_SIZE,
  MAX_BODY_SIZE,
  MAX_BODY_HEIGHT,
  type BodyField,
  type BodyFieldKind,
  type BodyFieldGroup,
  type BodyValidation,
} from './world/authoring.js';

export { PARTS, getPart } from './parts/catalog.js';
export { computeStats, canReach, defaultSpec } from './parts/assembly.js';

export { IsoRenderer } from './render/renderer.js';
export { FlatRenderer, FLAT_TILE } from './render/flat.js';
export {
  crossSectionImage,
  renderCrossSection,
  type CrossSectionImage,
  type CrossSectionPaintOptions,
} from './render/cross-section.js';
export { type SceneView, type ViewRotation } from './render/view.js';
export {
  registerFlatPainter,
  getFlatPainter,
  listFlatPainterKinds,
  type FlatPainter,
  type FlatPaintContext,
} from './render/flat-painters.js';
export {
  drawRover,
  registerRoverPart,
  unregisterRoverPart,
  listRoverParts,
  roverPaintContext,
  ROVER_SCALE,
  type RoverPart,
  type RoverPaintContext,
} from './render/rover.js';

// Scene model: the renderer-agnostic description of a frame.
export { buildScene, type BuildSceneOptions } from './scene/build.js';
export {
  entitiesOfKind,
  type Scene,
  type SceneEntity,
  type SceneEntityKind,
  type ViewKind,
} from './scene/types.js';
export { registerDem, getDem, sampleDem, type DemPatch } from './world/dem/index.js';
export { Camera } from './render/camera.js';
export { TILE_W, TILE_H, TILE_Z, project } from './render/sprites.js';
export { Controls, type ControlCallbacks } from './input/controls.js';

export {
  type SyncAdapter,
  type TakeonProfile,
  type MissionSummary,
  type PocketBaseSyncOptions,
  LocalSync,
  PocketBaseSync,
  missionCredits,
  RESOURCE_VALUE,
  registerResourceValue,
  DISCOVERY_CREDITS,
  PHOTO_CREDITS_PER_QUALITY,
  STARTING_CREDITS,
} from './net/sync.js';

export { mulberry32, hash2, hash3, makeId } from './util/rng.js';
export {
  valueNoise2,
  fbm2,
  perlin2,
  simplex2,
  worley2,
  poissonDisk,
  scatterPoints,
  blueNoiseMask,
  blueNoise2,
  clearBlueNoiseCache,
  makeNoise,
  fractal2,
  describeNoise,
  DEFAULT_NOISE,
  NOISE_TYPES,
  FRACTAL_KINDS,
  type NoiseConfig,
  type NoiseType,
  type FractalKind,
  type WorleyMode,
} from './util/noise/index.js';

// Framework-agnostic objective/mission module contract (offline-first).
export {
  TAKEON_SCHEMA_VERSION,
  TAKEON_WORLD_KEY,
  type TakeonObjectiveKind,
  type TakeonObjective,
  type TakeonMission,
  type TakeonWorldState,
  type TakeonObjectiveProgress,
  type TakeonMissionProgress,
} from './module/types.js';
export {
  tileKey,
  createDemoMission,
  createWorldState,
  type TakeonGain,
  explore,
  returnToBase,
  resetWorld,
  deriveMissionProgress,
  serializeWorldState,
  parseWorldState,
} from './module/state.js';
