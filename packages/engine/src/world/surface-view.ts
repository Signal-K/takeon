import type { Vec2 } from '../types.js';
import type { VoxelWorld } from './world.js';

/** A quarter-turn view of a square terrain grid. */
export type SurfaceRotation = 0 | 1 | 2 | 3;

/** Convert world-grid coordinates to the terrain's rotated view coordinates. */
export function worldToSurfaceView(point: Vec2, size: number, rotation: SurfaceRotation): Vec2 {
  const edge = size - 1;
  switch (rotation) {
    case 0: return { x: point.x, y: point.y };
    case 1: return { x: point.y, y: edge - point.x };
    case 2: return { x: edge - point.x, y: edge - point.y };
    case 3: return { x: edge - point.y, y: point.x };
  }
}

/** Convert rotated view coordinates back to world-grid coordinates. */
export function surfaceViewToWorld(point: Vec2, size: number, rotation: SurfaceRotation): Vec2 {
  const edge = size - 1;
  switch (rotation) {
    case 0: return { x: point.x, y: point.y };
    case 1: return { x: edge - point.y, y: point.x };
    case 2: return { x: edge - point.x, y: edge - point.y };
    case 3: return { x: point.y, y: edge - point.x };
  }
}

/** Sample a tile height in rotated view coordinates; out-of-bounds is void. */
export function surfaceHeightAtView(world: VoxelWorld, u: number, v: number, rotation: SurfaceRotation): number {
  if (u < 0 || v < 0 || u >= world.size || v >= world.size) return -1;
  const point = surfaceViewToWorld({ x: u, y: v }, world.size, rotation);
  return world.height(point.x, point.y);
}

/** Four shared, seam-free corner heights for a rendered tile. */
export function smoothedSurfaceCorners(
  world: VoxelWorld,
  u: number,
  v: number,
  height: number,
  rotation: SurfaceRotation,
  smoothStep = 1.01,
): [number, number, number, number] {
  const cornerRaw = (x: number, y: number): number => {
    const heights = [
      surfaceHeightAtView(world, x, y, rotation),
      surfaceHeightAtView(world, x + 1, y, rotation),
      surfaceHeightAtView(world, x, y + 1, rotation),
      surfaceHeightAtView(world, x + 1, y + 1, rotation),
    ];
    const valid = heights.filter(h => h >= 0);
    if (!valid.length) return -1;
    const min = Math.min(...valid);
    const neighbours = valid.filter(h => h - min <= smoothStep);
    return neighbours.reduce((sum, h) => sum + h, 0) / neighbours.length;
  };

  const corners: [number, number, number, number] = [
    cornerRaw(u - 1, v - 1), cornerRaw(u, v - 1), cornerRaw(u, v), cornerRaw(u - 1, v),
  ];
  for (let i = 0; i < corners.length; i++) {
    if (corners[i] < 0 || Math.abs(corners[i] - height) > smoothStep) corners[i] = height;
  }
  return corners;
}
