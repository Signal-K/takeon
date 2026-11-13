import { coreCall } from '../go/sync.js';
import { coreBody } from './core-data.js';
import { Material, type BodyDef } from '../types.js';
import { fbm2 } from '../util/noise/index.js';
import { hash2 } from '../util/rng.js';
import { runWorldLayers } from './layers.js';
import { VoxelWorld } from './world.js';

/**
 * Deterministically generate a body's terrain from its def + seed.
 * The same (body, seed) always produces the identical world, so only
 * player edits need to be persisted.
 */
export function generateTerrain(body: BodyDef, seed = body.seed): VoxelWorld {
  const data = coreCall<{ size: number; maxHeight: number; voxels: number[] }>('terrain', {
    seed: seed >>> 0,
    config: { body: coreBody(body) },
  });
  const world = new VoxelWorld(data.size, data.maxHeight);
  for (let y = 0; y < data.size; y++)
    for (let x = 0; x < data.size; x++)
      for (let z = 0; z < data.maxHeight; z++) {
        const m = data.voxels[(y * data.size + x) * data.maxHeight + z];
        if (m) world.setRaw(x, y, z, m);
      }
  runWorldLayers(body, seed, world);
  return world;
}
/**
 * Surface skin biome (silica / dust / regolith) at continuous coords.
 * Mirrors the depth-0 patch thresholds in pickMaterial (minus the elevation
 * basin rule) so the renderer can draw scalloped, organic patch boundaries
 * by sampling the same field at sub-tile resolution.
 */
export function skinBiome(x: number, y: number, seed: number): Material {
  const patch = fbm2(x * 0.055, y * 0.055, seed + 5, 3);
  if (patch > 0.66) return Material.Silica;
  if (patch < 0.38) return Material.Dust;
  return Material.Regolith;
}

/**
 * Find a good landing tile near the map centre: solid, locally flat.
 * Deterministic for a given world.
 */
export function findLandingSite(world: VoxelWorld): { x: number; y: number } {
  const c = Math.floor(world.size / 2);
  let best = { x: c, y: c };
  let bestScore = Infinity;
  for (let r = 0; r < world.size / 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = c + dx;
        const y = c + dy;
        if (!world.isSolid(x, y)) continue;
        const h = world.height(x, y);
        let rough = 0;
        let ok = true;
        for (let oy = -1; oy <= 1 && ok; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const hh = world.height(x + ox, y + oy);
            if (hh < 0) {
              ok = false;
              break;
            }
            rough += Math.abs(hh - h);
          }
        }
        if (!ok) continue;
        if (rough < bestScore) {
          bestScore = rough;
          best = { x, y };
        }
        if (rough === 0) return best;
      }
    }
    if (bestScore <= 2) return best;
  }
  return best;
}
