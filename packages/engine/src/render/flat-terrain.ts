import type { BodyDef } from '../types.js';
import type { VoxelWorld } from '../world/world.js';
import { MATERIALS } from '../world/materials.js';
import type { ViewRotation } from './view.js';

export interface FlatTerrainPixels {
  width: number;
  height: number;
  /** Row-major RGBA8 pixels, suitable for Canvas ImageData or a native bitmap. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Rasterize TakeOn's canonical flat terrain layer without a DOM or rover sim.
 * Hosts can upload these pixels to their presentation surface; do not
 * duplicate material shading in platform-specific terrain painters.
 */
export function rasterizeFlatTerrain(
  world: VoxelWorld,
  palette: BodyDef['palette'],
  rotation: ViewRotation = 0,
  contourStep = 3,
): FlatTerrainPixels {
  const size = world.size;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const tint = palette.tint ?? [1, 1, 1];
  const maxH = Math.max(1, world.maxHeight);
  const toWorld = (u: number, v: number) => {
    const edge = size - 1;
    switch (rotation) {
      case 0: return { x: u, y: v };
      case 1: return { x: edge - v, y: u };
      case 2: return { x: edge - u, y: edge - v };
      default: return { x: v, y: edge - u };
    }
  };

  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const w = toWorld(u, v);
      const height = world.height(w.x, w.y);
      const i = (v * size + u) * 4;
      if (height < 0) {
        pixels[i] = 8;
        pixels[i + 1] = 10;
        pixels[i + 2] = 20;
        pixels[i + 3] = 255;
        continue;
      }

      const material = world.surfaceMaterial(w.x, w.y);
      const [r, g, b] = hexRgb(MATERIALS[material].colors[0]);
      const left = toWorld(u - 1, v);
      const up = toWorld(u, v - 1);
      const leftHeight = world.height(left.x, left.y);
      const upHeight = world.height(up.x, up.y);
      const dx = leftHeight < 0 ? 0 : height - leftHeight;
      const dy = upHeight < 0 ? 0 : height - upHeight;
      let light = 0.72 + (height / maxH) * 0.4 + (dx + dy) * 0.09;
      if (contourStep > 0 && height % contourStep === 0 && (dx > 0 || dy > 0)) {
        light *= 0.86;
      }
      light = Math.max(0.25, Math.min(1.45, light));

      pixels[i] = r * tint[0] * light;
      pixels[i + 1] = g * tint[1] * light;
      pixels[i + 2] = b * tint[2] * light;
      pixels[i + 3] = 255;
    }
  }

  return { width: size, height: size, pixels };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
