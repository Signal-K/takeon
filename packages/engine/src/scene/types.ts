import type { ActiveWeather, Anomaly, BodyDef, RoverState, Structure, Vec2 } from '../types.js';

/**
 * The scene model: a renderer-agnostic description of what is on screen.
 *
 * The simulation owns *state*; a scene is the frame's worth of that state a
 * painter needs, flattened into entities with positions, facings and variants.
 * The built-in isometric and flat views both draw from it, and a host game can
 * take the same scene and draw it with its own technology (Pixi, WebGL, SVG)
 * without reaching into `Simulation`.
 */

/** How a scene is being looked at. `iso` is the voxel diorama; `flat` is the
 * top-down 2D map — the same world, drawn two ways. */
export type ViewKind = 'iso' | 'flat';

export type SceneEntityKind = 'rover' | 'structure' | 'anomaly' | 'marker' | (string & {});

export interface SceneEntity {
  id: string;
  kind: SceneEntityKind;
  /** Tile position; fractional while an entity is between tiles. */
  pos: Vec2;
  /** Surface height in voxels at that tile. */
  z: number;
  /** SE, SW, NW, NE in world space. */
  facing?: 0 | 1 | 2 | 3;
  /** Sub-type the painter switches on (structure type, anomaly type…). */
  variant?: string;
  /** Draw order within a tile; higher paints later. */
  layer?: number;
  label?: string;
  /** Painter hints and gameplay flags (powered, documented, progress…). */
  data?: Record<string, unknown>;
  /** The live simulation object, for painters that want full detail. */
  ref?: RoverState | Structure | Anomaly | unknown;
}

export interface Scene {
  id: string;
  name: string;
  view: ViewKind;
  /** World edge length in tiles. */
  size: number;
  maxHeight: number;
  /** Game seconds since landing. */
  time: number;
  /** 0 = night, 1 = noon. */
  daylight: number;
  palette: BodyDef['palette'];
  weather: ActiveWeather | null;
  entities: SceneEntity[];
  /** Deterministic landing/home tile, for framing and map pins. */
  home: Vec2;
}

/** Entities of one kind, in paint order. */
export function entitiesOfKind(scene: Scene, kind: SceneEntityKind): SceneEntity[] {
  return scene.entities.filter((e) => e.kind === kind);
}
