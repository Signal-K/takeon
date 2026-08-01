import { Material } from '../types.js';

/**
 * Column-major voxel world. Dense Uint8 storage — worlds are small
 * (<= 128x128x24) so this stays under a few hundred KB.
 * Columns can be entirely empty (void) for irregular asteroid shapes.
 */
export class VoxelWorld {
  readonly size: number;
  readonly maxHeight: number;
  private voxels: Uint8Array;
  /** Cached top surface z per column; -1 for void columns. */
  private heights: Int8Array;
  /** Sparse record of player edits for persistence: "x,y,z" -> material. */
  readonly edits: Record<string, number> = {};
  /**
   * Extension slot for a second "layer" of world data (an underground cave
   * grid, a sky/atmosphere layer, …) that a module built on TakeOn wants to
   * carry alongside this surface world. Core neither writes nor interprets
   * this — see `world/layers.js`'s `registerWorldLayer`. Regenerates with
   * everything else from `(BodyDef, seed)`, so nothing here needs its own
   * persistence as long as a layer generator stays deterministic.
   */
  readonly layers: Record<string, unknown> = {};
  /** Bumped whenever any voxel changes; renderers watch this. */
  version = 0;
  /** Set by the renderer to receive per-column invalidations. */
  onColumnChange: ((x: number, y: number) => void) | null = null;

  constructor(size: number, maxHeight: number) {
    this.size = size;
    this.maxHeight = maxHeight;
    this.voxels = new Uint8Array(size * size * maxHeight);
    this.heights = new Int8Array(size * size).fill(-1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  private idx(x: number, y: number, z: number): number {
    return (y * this.size + x) * this.maxHeight + z;
  }

  get(x: number, y: number, z: number): Material {
    if (!this.inBounds(x, y) || z < 0 || z >= this.maxHeight) return Material.Air;
    return this.voxels[this.idx(x, y, z)] as Material;
  }

  /** Raw set used by the generator — does not record an edit. */
  setRaw(x: number, y: number, z: number, m: Material): void {
    if (!this.inBounds(x, y) || z < 0 || z >= this.maxHeight) return;
    this.voxels[this.idx(x, y, z)] = m;
    const hi = y * this.size + x;
    if (m !== Material.Air && z > this.heights[hi]) this.heights[hi] = z;
    if (m === Material.Air && this.heights[hi] === z) this.recomputeHeight(x, y);
    this.version++;
    this.onColumnChange?.(x, y);
  }

  /** Player-visible set — recorded in `edits` for save/load. */
  set(x: number, y: number, z: number, m: Material): void {
    this.setRaw(x, y, z, m);
    this.edits[`${x},${y},${z}`] = m;
  }

  private recomputeHeight(x: number, y: number): void {
    const hi = y * this.size + x;
    for (let z = this.maxHeight - 1; z >= 0; z--) {
      if (this.voxels[this.idx(x, y, z)] !== Material.Air) {
        this.heights[hi] = z;
        return;
      }
    }
    this.heights[hi] = -1;
  }

  /** Top surface z of a column, or -1 for void. */
  height(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.heights[y * this.size + x];
  }

  surfaceMaterial(x: number, y: number): Material {
    const h = this.height(x, y);
    return h < 0 ? Material.Air : this.get(x, y, h);
  }

  /** Whether a rover can stand on this column. */
  isSolid(x: number, y: number): boolean {
    return this.height(x, y) >= 0;
  }

  /** Remove the top voxel of a column. Returns the material removed, or null. */
  mineTop(x: number, y: number): Material | null {
    const h = this.height(x, y);
    if (h < 0) return null;
    const m = this.get(x, y, h);
    // Never let a column disappear entirely — leave bedrock at z=0.
    if (h === 0) return null;
    this.set(x, y, h, Material.Air);
    return m;
  }

  /** Place a voxel on top of a column. Returns new top z or -1 if full/invalid. */
  placeTop(x: number, y: number, m: Material): number {
    const h = this.height(x, y);
    if (h < 0 || h + 1 >= this.maxHeight) return -1;
    this.set(x, y, h + 1, m);
    return h + 1;
  }

  /** Re-apply persisted edits after regeneration. */
  applyEdits(edits: Record<string, number>): void {
    for (const key of Object.keys(edits)) {
      const [x, y, z] = key.split(',').map(Number);
      this.setRaw(x, y, z, edits[key] as Material);
      this.edits[key] = edits[key];
    }
  }

  /** Signed height step from (x0,y0) to (x1,y1); Infinity if target is void. */
  step(x0: number, y0: number, x1: number, y1: number): number {
    const h0 = this.height(x0, y0);
    const h1 = this.height(x1, y1);
    if (h1 < 0) return Infinity;
    return h1 - h0;
  }
}
