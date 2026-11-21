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
  dirty: boolean;
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
  draw(context: CanvasRenderingContext2D, camera: Camera): void {
    const sorted = [...this.chunks].sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
    for (const chunk of sorted) {
      if (chunk.dirty) this.rebuildChunk(chunk);
      const screen = camera.toScreen(chunk.originX, chunk.originY);
      const width = chunk.canvas.width * camera.zoom;
      const height = chunk.canvas.height * camera.zoom;
      if (screen.x > camera.viewW || screen.y > camera.viewH || screen.x + width < 0 || screen.y + height < 0) continue;
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
        const canvas = this.makeCanvas(Math.ceil(right - left), Math.ceil(bottom - top));
        this.chunks.push({ cx, cy, canvas, originX: left, originY: top, dirty: true });
      }
    }
  }

  private rebuildChunk(chunk: Chunk): void {
    const world = this.world;
    const context = chunk.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
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
