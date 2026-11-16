import type { ActiveWeather, Anomaly, BodyDef, RoverState, Structure, Vec2 } from '../types.js';
import type { VoxelWorld } from '../world/world.js';

/**
 * What a renderer or the scene builder reads from a world each frame (KES-212).
 *
 * `Simulation` satisfies it structurally, but nothing here exposes commands,
 * the event bus, persistence or the Go core: a host can drive TakeOn's
 * renderers from its own state (a replay, a server snapshot, a settlement
 * survey with no rover rules) by supplying these fields. Everything is
 * read-only from the renderer's side except `world.onColumnChange`, the
 * terrain cache's invalidation hook.
 */
export interface SceneSource {
  readonly body: BodyDef;
  readonly seed: number;
  readonly missionId: string;
  readonly landingSite: Vec2;
  readonly world: VoxelWorld;
  /** Simulation seconds; renderers interpolate between ticks themselves. */
  readonly time: number;
  /**
   * The rover, or null for a world with no vehicle in it (a settlement
   * survey, a replay of terrain only). Renderers then centre on
   * `landingSite` and skip everything rover-specific.
   */
  readonly rover: RoverState | null;
  readonly structures: readonly Structure[];
  readonly anomalies: readonly Anomaly[];
  readonly weather: ActiveWeather | null;
  readonly launches: readonly { pos: Vec2; t: number }[];
  /** Recent meteor impacts, for the flash/crater effect. */
  readonly impacts: readonly { pos: Vec2; t: number }[];
  /** Ids of structures currently receiving power. */
  readonly powered: ReadonlySet<string>;
  /** 0 (night) to 1 (full day) at the current time. */
  daylight(): number;
}
