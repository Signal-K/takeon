import type { Camera } from './camera.js';
import { project, TILE_H, TILE_W, TILE_Z } from './sprites.js';
import type { VoxelWorld } from '../world/world.js';

export const ISO_TERRAIN_CHUNK_SIZE = 16;
type ProjectedPoint = { x: number; y: number };
export type TerrainProjector = (x: number, y: number, z: number) => ProjectedPoint;
export type TerrainColumnPainter = (
  context: CanvasRenderingContext2D,
  u: number,
  v: number,
  project: TerrainProjector,
) => void;

interface Chunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  originX: number;
  originY: number;
  /** Chunk size in world pixels (scale 1); the canvas is this times `bake`. */
  w: number;
  h: number;
  /** Pixels per world pixel the canvas was painted at. */
  bake: number;
  dirty: boolean;
}

/**
 * Bake resolutions a chunk may be painted at. A chunk is painted at the first
 * step at or above the screen's pixels per world pixel (zoom × device pixel
 * ratio), so it is never stretched up; stepping keeps a pinch zoom from
 * repainting every frame. Painting at 1 and stretching 3–6× was what made the
 * ground look blurred.
 */
const BAKE_STEPS = [1, 1.5, 2, 3, 4, 5, 6];
export function bakeScaleFor(pixelsPerUnit: number): number {
  return BAKE_STEPS.find(s => s >= pixelsPerUnit - 0.01) ?? BAKE_STEPS[BAKE_STEPS.length - 1];
}

/** Cached isometric terrain surface, independent of any game simulation. */
export class IsoTerrainLayer {
  private readonly chunks: Chunk[] = [];
  private readonly chunksPerSide: number;

  constructor(
    private readonly world: VoxelWorld,
    private readonly paintColumn: TerrainColumnPainter,
    private readonly makeCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas = createCanvas,
  ) {
    this.chunksPerSide = Math.ceil(world.size / ISO_TERRAIN_CHUNK_SIZE);
    this.initChunks();
  }

  invalidateAll(): void {
    for (const chunk of this.chunks) chunk.dirty = true;
  }

  /** Mark the view-space tile and its smoothing neighbours dirty. */
  invalidateViewColumn(u: number, v: number): void {
    const marked = new Set<number>();
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        const cx = Math.floor((u + du) / ISO_TERRAIN_CHUNK_SIZE);
        const cy = Math.floor((v + dv) / ISO_TERRAIN_CHUNK_SIZE);
        if (cx < 0 || cy < 0 || cx >= this.chunksPerSide || cy >= this.chunksPerSide) continue;
        marked.add(cy * this.chunksPerSide + cx);
      }
    }
    for (const index of marked) this.chunks[index].dirty = true;
  }

  /** Composite cached chunks in painter order, rebuilding dirty chunks lazily. */
  /**
   * Composite cached chunks in painter order. Only chunks on screen are
   * (re)painted, at `dpr × zoom` so they land on the screen pixel for pixel.
   */
  draw(context: CanvasRenderingContext2D, camera: Camera, dpr = 1): void {
    const bake = bakeScaleFor(camera.zoom * dpr);
    const sorted = [...this.chunks].sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
    for (const chunk of sorted) {
      const screen = camera.toScreen(chunk.originX, chunk.originY);
      const width = chunk.w * camera.zoom;
      const height = chunk.h * camera.zoom;
      if (screen.x > camera.viewW || screen.y > camera.viewH || screen.x + width < 0 || screen.y + height < 0) continue;
      if (chunk.dirty || chunk.bake !== bake) this.rebuildChunk(chunk, bake);
      context.drawImage(chunk.canvas as CanvasImageSource, screen.x, screen.y, width, height);
    }
  }

  private initChunks(): void {
    const { size, maxHeight } = this.world;
    for (let cy = 0; cy < this.chunksPerSide; cy++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        const x0 = cx * ISO_TERRAIN_CHUNK_SIZE;
        const y0 = cy * ISO_TERRAIN_CHUNK_SIZE;
        const x1 = Math.min(x0 + ISO_TERRAIN_CHUNK_SIZE, size) - 1;
        const y1 = Math.min(y0 + ISO_TERRAIN_CHUNK_SIZE, size) - 1;
        const left = project(x0, y1, 0).sx - TILE_W / 2;
        const right = project(x1, y0, 0).sx + TILE_W / 2;
        const top = project(x0, y0, maxHeight + 1).sy - TILE_H / 2;
        const bottom = project(x1, y1, 0).sy + TILE_H / 2 + TILE_Z * 1.5;
        const w = Math.ceil(right - left), h = Math.ceil(bottom - top);
        const canvas = this.makeCanvas(w, h);
        this.chunks.push({ cx, cy, canvas, originX: left, originY: top, w, h, bake: 1, dirty: true });
      }
    }
  }

  private rebuildChunk(chunk: Chunk, bake = chunk.bake): void {
    const world = this.world;
    const cw = Math.ceil(chunk.w * bake), ch = Math.ceil(chunk.h * bake);
    if (chunk.canvas.width !== cw || chunk.canvas.height !== ch) {
      chunk.canvas.width = cw;
      chunk.canvas.height = ch;
    }
    chunk.bake = bake;
    const context = chunk.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, cw, ch);
    context.setTransform(bake, 0, 0, bake, 0, 0);
    const u0 = chunk.cx * ISO_TERRAIN_CHUNK_SIZE;
    const v0 = chunk.cy * ISO_TERRAIN_CHUNK_SIZE;
    const uN = Math.min(ISO_TERRAIN_CHUNK_SIZE, world.size - u0);
    const vN = Math.min(ISO_TERRAIN_CHUNK_SIZE, world.size - v0);
    const projectLocal: TerrainProjector = (x, y, z) => {
      const point = project(x, y, z);
      return { x: point.sx - chunk.originX, y: point.sy - chunk.originY };
    };
    for (let sum = 0; sum <= uN + vN - 2; sum++) {
      for (let localU = Math.max(0, sum - vN + 1); localU <= Math.min(sum, uN - 1); localU++) {
        this.paintColumn(context, u0 + localU, v0 + (sum - localU), projectLocal);
      }
    }
    chunk.dirty = false;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}
