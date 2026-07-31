import { Material, type ResourceKey, type Vec2 } from '../types.js';
import { MATERIALS } from './materials.js';
import { findLandingSite } from './terrain.js';
import type { VoxelWorld } from './world.js';

/**
 * Read-only measurements over a generated world.
 *
 * These exist so terrain can be *planned* rather than eyeballed: the editor
 * (and any host tooling) can answer "is this map drivable with tier-1 wheels",
 * "how much titanium is actually in here", "how spiky is the relief" without
 * reaching into the renderer. Everything here is pure, DOM-free and
 * deterministic for a given world, so it is unit-testable and safe to run in
 * a worker.
 */

/** Column heights, row-major (y * size + x). -1 marks a void column. */
export function heightField(world: VoxelWorld): Int16Array {
  const { size } = world;
  const out = new Int16Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = world.height(x, y);
  }
  return out;
}

/**
 * Per-column steepness: the largest absolute height step to a 4-neighbour.
 * -1 for void columns; a neighbouring void counts as impassable (`Infinity`
 * would not fit the array, so it is clamped to the world's max height).
 */
export function slopeField(world: VoxelWorld): Int16Array {
  const { size } = world;
  const heights = heightField(world);
  const out = new Int16Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = heights[y * size + x];
      if (h < 0) continue;
      let worst = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nh = heights[ny * size + nx];
        // A void neighbour is a cliff edge, not a gentle slope.
        const step = nh < 0 ? world.maxHeight : Math.abs(nh - h);
        if (step > worst) worst = step;
      }
      out[y * size + x] = worst;
    }
  }
  return out;
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Flood fill of every column a rover with `maxClimb` can reach from `from`,
 * using the same "signed step must be within climb" rule the simulation
 * applies when driving. 1 = reachable.
 */
export function reachableMask(world: VoxelWorld, from: Vec2, maxClimb: number): Uint8Array {
  const { size } = world;
  const heights = heightField(world);
  const mask = new Uint8Array(size * size);
  const start = from.y * size + from.x;
  if (from.x < 0 || from.y < 0 || from.x >= size || from.y >= size) return mask;
  if (heights[start] < 0) return mask;
  const queue: number[] = [start];
  mask[start] = 1;
  while (queue.length > 0) {
    const cur = queue.pop() as number;
    const x = cur % size;
    const y = (cur - x) / size;
    const h = heights[cur];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (mask[ni]) continue;
      const nh = heights[ni];
      if (nh < 0) continue;
      if (Math.abs(nh - h) > maxClimb) continue;
      mask[ni] = 1;
      queue.push(ni);
    }
  }
  return mask;
}

/**
 * A vertical slice through the world for cross-section views.
 * `cells[z][i]` is the material at height `z` along the slice.
 */
export function crossSection(
  world: VoxelWorld,
  axis: 'x' | 'y',
  index: number,
): { axis: 'x' | 'y'; index: number; length: number; height: number; cells: Material[][] } {
  const length = world.size;
  const height = world.maxHeight;
  const cells: Material[][] = [];
  for (let z = 0; z < height; z++) {
    const row: Material[] = new Array(length);
    for (let i = 0; i < length; i++) {
      row[i] = axis === 'y' ? world.get(i, index, z) : world.get(index, i, z);
    }
    cells.push(row);
  }
  return { axis, index, length, height, cells };
}

export interface TerrainAnalysis {
  size: number;
  /** size² — every column, void included. */
  columns: number;
  solidColumns: number;
  voidFraction: number;
  solidVoxels: number;
  minHeight: number;
  maxHeight: number;
  meanHeight: number;
  medianHeight: number;
  /** maxHeight − minHeight over solid columns. */
  relief: number;
  /** Column count per surface height, indexed by z. */
  heightHistogram: number[];
  slope: {
    mean: number;
    max: number;
    /** Fraction of solid columns whose worst neighbour step exceeds `maxClimb`. */
    steepFraction: number;
    /** Column count per steepness step, indexed by voxels of step. */
    histogram: number[];
  };
  /** Voxel counts by material (air excluded). */
  materials: Partial<Record<Material, number>>;
  /** Surface-voxel counts by material — the "biome mix" you actually see. */
  surface: Partial<Record<Material, number>>;
  /** Everything the map would yield if every voxel were mined. */
  resources: Partial<Record<ResourceKey, number>>;
  traversable: {
    maxClimb: number;
    from: Vec2;
    reachableColumns: number;
    /** Reachable / solid columns: 1 means the whole map is drivable. */
    reachableFraction: number;
  };
  landingSite: Vec2;
}

export interface AnalyzeTerrainOptions {
  /** Drivetrain climb limit used for the traversability flood fill (default 2). */
  maxClimb?: number;
  /** Start column for the flood fill (default: the deterministic landing site). */
  from?: Vec2;
}

/** Summarise a generated world: relief, slopes, material mix, drivability. */
export function analyzeTerrain(world: VoxelWorld, opts: AnalyzeTerrainOptions = {}): TerrainAnalysis {
  const { size, maxHeight } = world;
  const heights = heightField(world);
  const slopes = slopeField(world);
  const landingSite = findLandingSite(world);
  const from = opts.from ?? landingSite;
  const maxClimb = opts.maxClimb ?? 2;

  const heightHistogram = new Array(maxHeight).fill(0);
  const slopeHistogram = new Array(maxHeight + 1).fill(0);
  const materials: Partial<Record<Material, number>> = {};
  const surface: Partial<Record<Material, number>> = {};
  const resources: Partial<Record<ResourceKey, number>> = {};

  let solidColumns = 0;
  let solidVoxels = 0;
  let heightSum = 0;
  let hMin = Infinity;
  let hMax = -Infinity;
  let slopeSum = 0;
  let slopeMax = 0;
  let steep = 0;
  const heightList: number[] = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = heights[i];
      if (h < 0) continue;
      solidColumns++;
      heightSum += h;
      heightList.push(h);
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      if (h < heightHistogram.length) heightHistogram[h]++;

      const s = slopes[i];
      slopeSum += s;
      if (s > slopeMax) slopeMax = s;
      if (s > maxClimb) steep++;
      slopeHistogram[Math.min(slopeHistogram.length - 1, s)]++;

      for (let z = 0; z <= h; z++) {
        const m = world.get(x, y, z);
        if (m === Material.Air) continue;
        solidVoxels++;
        materials[m] = (materials[m] ?? 0) + 1;
        const def = MATERIALS[m];
        if (def?.yields) {
          const { resource, amount } = def.yields;
          resources[resource] = (resources[resource] ?? 0) + amount;
        }
      }
      const top = world.get(x, y, h);
      surface[top] = (surface[top] ?? 0) + 1;
    }
  }

  heightList.sort((a, b) => a - b);
  const median = heightList.length > 0 ? heightList[heightList.length >> 1] : 0;
  const mask = reachableMask(world, from, maxClimb);
  let reachable = 0;
  for (let i = 0; i < mask.length; i++) reachable += mask[i];

  return {
    size,
    columns: size * size,
    solidColumns,
    voidFraction: 1 - solidColumns / (size * size),
    solidVoxels,
    minHeight: solidColumns > 0 ? hMin : 0,
    maxHeight: solidColumns > 0 ? hMax : 0,
    meanHeight: solidColumns > 0 ? heightSum / solidColumns : 0,
    medianHeight: median,
    relief: solidColumns > 0 ? hMax - hMin : 0,
    heightHistogram,
    slope: {
      mean: solidColumns > 0 ? slopeSum / solidColumns : 0,
      max: slopeMax,
      steepFraction: solidColumns > 0 ? steep / solidColumns : 0,
      histogram: slopeHistogram,
    },
    materials,
    surface,
    resources,
    traversable: {
      maxClimb,
      from,
      reachableColumns: reachable,
      reachableFraction: solidColumns > 0 ? reachable / solidColumns : 0,
    },
    landingSite,
  };
}
