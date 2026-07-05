import { Material, type BodyDef } from '../types.js';
import { fbm2 } from '../util/noise.js';
import { hash2, hash3, mulberry32 } from '../util/rng.js';
import { getDem, sampleDem, type DemPatch } from './dem/index.js';
import { VoxelWorld } from './world.js';

/**
 * Deterministically generate a body's terrain from its def + seed.
 * The same (body, seed) always produces the identical world, so only
 * player edits need to be persisted.
 */
export function generateTerrain(body: BodyDef, seedOverride?: number): VoxelWorld {
  const seed = seedOverride ?? body.seed;
  const { size, maxHeight } = body;
  const world = new VoxelWorld(size, maxHeight);
  const t = body.terrain;
  const rng = mulberry32(seed ^ 0x51ab);
  // Real elevation patch (NASA MOLA/LOLA sample) when available for this body.
  const dem: DemPatch | undefined = body.dem ? getDem(body.dem) : undefined;

  // Crater field: centers, radii and depths, applied to the heightmap.
  // Real DEMs already carry their craters — skip synthetic ones then.
  const craters: { cx: number; cy: number; r: number; depth: number }[] = [];
  for (let i = 0; i < (dem ? 0 : t.craters); i++) {
    craters.push({
      cx: rng() * size,
      cy: rng() * size,
      r: 4 + rng() * (size / 9),
      depth: 2 + rng() * 3,
    });
  }

  const freq = 0.035 + t.roughness * 0.03;
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Irregular asteroid silhouette: keep columns inside a noisy radial mask.
      if (t.irregular) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const rr = Math.sqrt(dx * dx + dy * dy);
        const wobble = fbm2(x * 0.05, y * 0.05, seed + 7, 3) * 0.35;
        if (rr > 0.82 - wobble * 0.5 + wobble) continue; // void column
      }

      let n = fbm2(x * freq, y * freq, seed, 4);
      // Gentle large-scale relief on top of the detail noise.
      n = n * 0.65 + fbm2(x * freq * 0.25, y * freq * 0.25, seed + 55, 2) * 0.35;
      if (dem) {
        // Real topography carries the large-scale relief; procedural noise
        // only adds sub-DEM-resolution detail.
        const real = sampleDem(dem, x / (size - 1), y / (size - 1));
        n = real * 0.78 + n * 0.22;
      }
      let h = 1 + n * (maxHeight - 3) * (0.45 + t.roughness * 0.55);

      for (const c of craters) {
        const d = Math.hypot(x - c.cx, y - c.cy);
        if (d < c.r) {
          const f = d / c.r;
          // Bowl with a raised rim near the edge.
          h += -c.depth * (1 - f * f) + (f > 0.75 ? (f - 0.75) * 4 * c.depth * 0.35 : 0);
        }
      }

      const height = Math.max(1, Math.min(maxHeight - 2, Math.round(h)));

      // Polar ice bands along the north/south map edges.
      const edgeDist = Math.min(y, size - 1 - y) / size;
      const icy = t.iceCaps > 0 && edgeDist < t.iceCaps * 0.5 * (0.7 + fbm2(x * 0.08, y * 0.08, seed + 91, 2) * 0.6);
      const sulfurous =
        (t.sulfurFields ?? 0) > 0 && fbm2(x * 0.07, y * 0.07, seed + 313, 3) > 1 - (t.sulfurFields ?? 0) * 0.55;

      for (let z = 0; z <= height; z++) {
        world.setRaw(x, y, z, pickMaterial(body, x, y, z, height, icy, sulfurous, seed));
      }
    }
  }

  return world;
}

function pickMaterial(
  body: BodyDef,
  x: number,
  y: number,
  z: number,
  surface: number,
  icy: boolean,
  sulfurous: boolean,
  seed: number,
): Material {
  const depth = surface - z;
  const t = body.terrain;

  // Ore veins live in the rocky interior, gated by 3D hash + richness.
  if (depth >= 1) {
    const v = hash3(x >> 1, y >> 1, z, seed + 17);
    const rich = t.oreRichness;
    if (v > 1 - rich * 0.055 && depth >= 3) return Material.Crystal;
    if (v > 1 - rich * 0.16) {
      // Vein composition weighted by the body's spectroscopy profile
      // (e.g. TES/GRS iron for Mars, Clementine/M3 TiO2 for lunar maria).
      const w = body.minerals ?? {};
      const iron = w.iron ?? 0.45;
      const copper = w.copper ?? 0.3;
      const titanium = w.titanium ?? 0.25;
      const total = iron + copper + titanium || 1;
      const pick = hash3(x, y, z, seed + 23) * total;
      if (pick < iron) return Material.IronOre;
      if (pick < iron + copper) return Material.CopperOre;
      return Material.TitaniumOre;
    }
  }

  if (icy && depth <= 2) return Material.Ice;
  if (sulfurous && depth === 0) return Material.Sulfur;

  if (depth === 0) {
    // Surface skin in large organic patches (not per-tile noise): silica
    // flats, dust basins and regolith uplands read as biome-like regions.
    const patch = fbm2(x * 0.055, y * 0.055, seed + 5, 3);
    if (patch > 0.66) return Material.Silica;
    if (patch < 0.38 || z <= 2) return Material.Dust;
    return Material.Regolith;
  }
  if (depth <= 2) return Material.Regolith;
  if (depth <= 5) return Material.Rock;
  return Material.Basalt;
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
