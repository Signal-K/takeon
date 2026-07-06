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
export { EventBus } from './core/events.js';
export { RoverGame, createRoverGame, type RoverGameOptions, type RoverOrder } from './core/game.js';
export { GameAudio, type GameAudioOptions } from './audio/audio.js';

export { Simulation, TICK_RATE, TICK_DT, DIRS, type SimOptions } from './sim/simulation.js';
export {
  STRUCTURES,
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
export { generateTerrain, findLandingSite } from './world/terrain.js';
export { generateAnomalies } from './world/anomalies.js';
export { MATERIALS, RESOURCE_NAMES } from './world/materials.js';
export { BODIES, getBody } from './world/bodies.js';

export { PARTS, getPart } from './parts/catalog.js';
export { computeStats, canReach, defaultSpec } from './parts/assembly.js';

export { IsoRenderer, type ViewRotation } from './render/renderer.js';
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
  DISCOVERY_CREDITS,
  PHOTO_CREDITS_PER_QUALITY,
  STARTING_CREDITS,
} from './net/sync.js';

export { mulberry32, hash2, hash3, makeId } from './util/rng.js';
export { valueNoise2, fbm2 } from './util/noise.js';

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
