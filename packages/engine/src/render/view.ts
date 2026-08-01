import type { Vec2 } from '../types.js';
import type { ViewKind } from '../scene/types.js';
import type { Camera } from './camera.js';

export type ViewRotation = 0 | 1 | 2 | 3;

/**
 * What every renderer must provide so the game can swap between them.
 *
 * A view owns *presentation only*: it draws the simulation, converts pointer
 * coordinates back to tiles, and can produce a photo and a minimap. Two ship
 * with the engine — the isometric voxel diorama (`iso`) and the top-down map
 * (`flat`) — and a host can add its own by implementing this interface.
 *
 * Views share one `Camera` instance, so switching keeps external references
 * (input handling, host UI) valid.
 */
export interface SceneView {
  readonly kind: ViewKind;
  readonly camera: Camera;
  rotation: ViewRotation;
  resize(cssW: number, cssH: number, dpr?: number): void;
  draw(): void;
  /** Canvas pixel → tile, or null when the pointer is off the world. */
  pickTile(canvasX: number, canvasY: number): Vec2 | null;
  setRotation(rotation: ViewRotation): void;
  rotateClockwise(): void;
  renderMinimap(target: HTMLCanvasElement): void;
  capturePhoto(): string | null;
  /** The world tile currently at the centre of the viewport. */
  centreTile(): Vec2;
  /** Point the camera at a tile, in this view's own projection. */
  focusTile(tile: Vec2): void;
  /** Becoming the active view: claim world invalidation, rebuild caches. */
  activate(): void;
  /** No longer the active view: release hooks so it can idle cheaply. */
  deactivate(): void;
}
