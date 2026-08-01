import { Material } from '../types.js';
import { crossSection } from '../world/analysis.js';
import { MATERIALS } from '../world/materials.js';
import type { VoxelWorld } from '../world/world.js';

/**
 * Vertical slice through a voxel world, one pixel per voxel, painted with the
 * world's real material colours — the "underground" view: not a decorative
 * strata illustration, but the actual generated column, so whatever a body's
 * terrain (and `terrain.bands`, if it authors depth-stratified ore) put down
 * is exactly what shows up here.
 *
 * Split into a pure `crossSectionImage` (an `ImageData`, no canvas required —
 * usable in a worker, or fed into your own texture pipeline) and
 * `renderCrossSection` (blits it into a canvas, scaled to fit with smoothing
 * off, the way the editor and `@takeon/ui`'s `CrossSectionView` both use it).
 */

export interface CrossSectionPaintOptions {
  /** Fill colour for void voxels (air, or outside the world). Default a dark navy. */
  airColor?: [number, number, number];
}

/**
 * Duck-typed `ImageData`: same shape (`data`/`width`/`height`), so it drops
 * straight into `putImageData`, but building one never touches the DOM. The
 * engine must keep working without DOM access for tests; only
 * `renderCrossSection` (which needs a real canvas anyway) requires a browser.
 */
export interface CrossSectionImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Build the raw slice image: `cells[z][i]` painted with `MATERIALS[m].colors[0]`. */
export function crossSectionImage(
  world: VoxelWorld,
  axis: 'x' | 'y',
  index: number,
  opts: CrossSectionPaintOptions = {},
): CrossSectionImage {
  const slice = crossSection(world, axis, index);
  const w = slice.length;
  const h = slice.height;
  const [ar, ag, ab] = opts.airColor ?? [14, 11, 32];
  const buffer = new Uint8ClampedArray(w * h * 4);
  for (let z = 0; z < h; z++) {
    for (let i = 0; i < w; i++) {
      const m = slice.cells[z][i];
      // Rows paint top-down: the highest voxel is the first image row.
      const px = ((h - 1 - z) * w + i) * 4;
      const def = m === Material.Air ? undefined : MATERIALS[m];
      const [r, g, b] = def ? hexToRgb(def.colors[0]) : [ar, ag, ab];
      buffer[px] = r;
      buffer[px + 1] = g;
      buffer[px + 2] = b;
      buffer[px + 3] = 255;
    }
  }
  return typeof ImageData !== 'undefined' ? new ImageData(buffer, w, h) : { data: buffer, width: w, height: h };
}

/**
 * Draw a vertical slice into a canvas, letterboxed to fit its current CSS
 * size (read via `getBoundingClientRect`) with image smoothing off, so
 * individual voxels stay crisp at any zoom.
 */
export function renderCrossSection(
  target: HTMLCanvasElement,
  world: VoxelWorld,
  axis: 'x' | 'y',
  index: number,
  opts: CrossSectionPaintOptions = {},
): void {
  const image = crossSectionImage(world, axis, index, opts);
  const ctx = target.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const rect = target.getBoundingClientRect();
  const w = Math.max(1, Math.round((rect.width || image.width) * dpr));
  const h = Math.max(1, Math.round((rect.height || image.height) * dpr));
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = w / dpr;
  const cssH = h / dpr;
  ctx.clearRect(0, 0, cssW, cssH);

  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  // `renderCrossSection` only runs where a real canvas exists, so `image` is
  // always a genuine `ImageData` here (see `crossSectionImage`'s feature
  // detection) — the cast just reflects that at the type level.
  source.getContext('2d')?.putImageData(image as ImageData, 0, 0);

  const scale = Math.min(cssW / image.width, cssH / image.height);
  const ox = (cssW - image.width * scale) / 2;
  const oy = (cssH - image.height * scale) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, ox, oy, image.width * scale, image.height * scale);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
