import {
  crossSection,
  heightField,
  MATERIALS,
  Material,
  reachableMask,
  slopeField,
  type VoxelWorld,
} from '@takeon/engine';

/**
 * Top-down diagnostic views of a generated world.
 *
 * These are the terrain-planning instruments: elevation, steepness, surface
 * material, ore density and drivability, all sampled from the *same* world the
 * game will run, so what you tune here is what ships. Each painter renders at
 * one pixel per column into an offscreen buffer, then scales it up with
 * smoothing off so individual voxels stay legible.
 */

export type MapKind = 'elevation' | 'slope' | 'surface' | 'ore' | 'reach';

export const MAP_KINDS: { id: MapKind; label: string; help: string }[] = [
  { id: 'elevation', label: 'Elevation', help: 'Column height — the heightmap the generator produced.' },
  { id: 'slope', label: 'Slope', help: 'Worst height step to a neighbour. Red is above the climb limit.' },
  { id: 'surface', label: 'Surface', help: 'Top-voxel material: the biome patches the player sees.' },
  { id: 'ore', label: 'Ore density', help: 'Ore voxels per column, including crystal.' },
  { id: 'reach', label: 'Drivable', help: 'Flood fill from the landing site with the current climb limit.' },
];

export interface PaintOptions {
  /** Drivetrain climb limit for slope/reach views. */
  maxClimb?: number;
  /** Start column for the drivability fill. */
  from?: { x: number; y: number };
  /** Row/column highlighted by the cross-section view. */
  marker?: { axis: 'x' | 'y'; index: number } | null;
  /** Tile to mark (the landing site by default). */
  pin?: { x: number; y: number } | null;
}

type RGB = [number, number, number];

const VOID: RGB = [10, 8, 24];

/** Paint one of the diagnostic maps into a canvas, letterboxed to fit. */
export function paintMap(canvas: HTMLCanvasElement, world: VoxelWorld, kind: MapKind, opts: PaintOptions = {}): void {
  const size = world.size;
  const maxClimb = opts.maxClimb ?? 2;
  const colour = pickPainter(world, kind, maxClimb, opts);
  const buffer = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colour(x, y);
      const i = (y * size + x) * 4;
      buffer[i] = r;
      buffer[i + 1] = g;
      buffer[i + 2] = b;
      buffer[i + 3] = 255;
    }
  }
  blit(canvas, new ImageData(buffer, size, size), (ctx, scale, ox, oy) => {
    if (opts.marker) {
      ctx.fillStyle = 'rgba(69, 224, 196, 0.5)';
      if (opts.marker.axis === 'y') ctx.fillRect(ox, oy + opts.marker.index * scale, size * scale, Math.max(1, scale));
      else ctx.fillRect(ox + opts.marker.index * scale, oy, Math.max(1, scale), size * scale);
    }
    if (opts.pin) {
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + opts.pin.x * scale - 3, oy + opts.pin.y * scale - 3, scale + 6, scale + 6);
    }
  });
}

function pickPainter(world: VoxelWorld, kind: MapKind, maxClimb: number, opts: PaintOptions): (x: number, y: number) => RGB {
  const size = world.size;
  if (kind === 'elevation') {
    const heights = heightField(world);
    let hi = 1;
    for (let i = 0; i < heights.length; i++) if (heights[i] > hi) hi = heights[i];
    return (x, y) => {
      const h = heights[y * size + x];
      return h < 0 ? VOID : terrainRamp(h / hi);
    };
  }
  if (kind === 'slope') {
    const slopes = slopeField(world);
    return (x, y) => {
      const s = slopes[y * size + x];
      if (s < 0) return VOID;
      if (s > maxClimb) return [232, 76, 76];
      const t = maxClimb > 0 ? s / maxClimb : 0;
      return [40 + t * 150, 190 - t * 60, 150 - t * 60];
    };
  }
  if (kind === 'surface') {
    return (x, y) => {
      const h = world.height(x, y);
      if (h < 0) return VOID;
      return hexToRgb(MATERIALS[world.surfaceMaterial(x, y)].colors[0]);
    };
  }
  if (kind === 'ore') {
    return (x, y) => {
      const h = world.height(x, y);
      if (h < 0) return VOID;
      let ore = 0;
      let crystal = 0;
      for (let z = 0; z <= h; z++) {
        const m = world.get(x, y, z);
        if (m === Material.Crystal) crystal++;
        else if (m === Material.IronOre || m === Material.CopperOre || m === Material.TitaniumOre) ore++;
      }
      if (crystal > 0) return [199, 125, 255];
      if (ore === 0) return [26, 22, 54];
      const t = Math.min(1, ore / 6);
      return [60 + t * 190, 50 + t * 90, 40];
    };
  }
  const mask = reachableMask(world, opts.from ?? { x: size >> 1, y: size >> 1 }, maxClimb);
  return (x, y) => {
    const h = world.height(x, y);
    if (h < 0) return VOID;
    return mask[y * size + x] ? [69, 180, 140] : [150, 80, 60];
  };
}

/** Vertical slice, drawn with the real material palette. */
export function paintCrossSection(
  canvas: HTMLCanvasElement,
  world: VoxelWorld,
  axis: 'x' | 'y',
  index: number,
): void {
  const slice = crossSection(world, axis, index);
  const w = slice.length;
  const h = slice.height;
  const buffer = new Uint8ClampedArray(w * h * 4);
  for (let z = 0; z < h; z++) {
    for (let i = 0; i < w; i++) {
      const m = slice.cells[z][i];
      // Rows are painted top-down: the highest voxel is the first image row.
      const px = ((h - 1 - z) * w + i) * 4;
      const [r, g, b] = m === Material.Air ? [14, 11, 32] : hexToRgb(MATERIALS[m].colors[0]);
      buffer[px] = r;
      buffer[px + 1] = g;
      buffer[px + 2] = b;
      buffer[px + 3] = 255;
    }
  }
  blit(canvas, new ImageData(buffer, w, h));
}

/** Raw 2D noise preview, for tuning frequency/octaves before generating. */
export function paintField(
  canvas: HTMLCanvasElement,
  size: number,
  sample: (x: number, y: number) => number,
  ramp: (t: number) => RGB = grayRamp,
): void {
  const buffer = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = ramp(Math.max(0, Math.min(1, sample(x, y))));
      const i = (y * size + x) * 4;
      buffer[i] = r;
      buffer[i + 1] = g;
      buffer[i + 2] = b;
      buffer[i + 3] = 255;
    }
  }
  blit(canvas, new ImageData(buffer, size, size));
}

/**
 * Canvas pixel → world column for the top-down maps, matching `blit`'s
 * letterboxing so clicks land on the tile under the cursor.
 */
export function mapPointToTile(
  canvas: HTMLCanvasElement,
  world: VoxelWorld,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(0.0001, Math.min(rect.width / world.size, rect.height / world.size));
  const ox = (rect.width - world.size * scale) / 2;
  const oy = (rect.height - world.size * scale) / 2;
  const x = Math.floor((clientX - rect.left - ox) / scale);
  const y = Math.floor((clientY - rect.top - oy) / scale);
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return null;
  return { x, y };
}

function blit(
  canvas: HTMLCanvasElement,
  image: ImageData,
  overlay?: (ctx: CanvasRenderingContext2D, scale: number, ox: number, oy: number) => void,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round((rect.width || image.width) * dpr));
  const h = Math.max(1, Math.round((rect.height || image.height) * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = w / dpr;
  const cssH = h / dpr;
  ctx.clearRect(0, 0, cssW, cssH);

  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  source.getContext('2d')?.putImageData(image, 0, 0);

  const scale = Math.min(cssW / image.width, cssH / image.height);
  const ox = (cssW - image.width * scale) / 2;
  const oy = (cssH - image.height * scale) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, ox, oy, image.width * scale, image.height * scale);
  overlay?.(ctx, scale, ox, oy);
}

/** Low → deep blue-violet, mid → warm ochre, high → pale. */
function terrainRamp(t: number): RGB {
  const stops: [number, RGB][] = [
    [0, [32, 26, 72]],
    [0.35, [92, 62, 120]],
    [0.6, [196, 128, 74]],
    [0.85, [235, 196, 122]],
    [1, [248, 240, 224]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

function grayRamp(t: number): RGB {
  const v = 20 + t * 220;
  return [v, v, v];
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
