import { project } from './sprites.js';

/**
 * 2D camera over the projected iso plane.
 * `cx/cy` are the projected-space coordinates at the viewport centre.
 */
export class Camera {
  cx = 0;
  cy = 0;
  /** Crashlands-scale framing: a tile is ~110px wide by default and the
   * camera can't zoom out to ant-scale. */
  zoom = 3.4;
  minZoom = 1.8;
  maxZoom = 6;
  viewW = 800;
  viewH = 600;
  follow = true;

  centerOnTile(x: number, y: number, z: number): void {
    const p = project(x, y, z);
    this.cx = p.sx;
    this.cy = p.sy;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.zoom;
    this.cy -= dyScreen / this.zoom;
    this.follow = false;
  }

  setZoom(z: number, pivotX?: number, pivotY?: number): void {
    const nz = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    if (pivotX !== undefined && pivotY !== undefined) {
      // Keep the world point under the pivot fixed while zooming.
      const wx = this.cx + (pivotX - this.viewW / 2) / this.zoom;
      const wy = this.cy + (pivotY - this.viewH / 2) / this.zoom;
      this.cx = wx - (pivotX - this.viewW / 2) / nz;
      this.cy = wy - (pivotY - this.viewH / 2) / nz;
    }
    this.zoom = nz;
  }

  /** Projected-space -> canvas pixels. */
  toScreen(px: number, py: number): { x: number; y: number } {
    return {
      x: (px - this.cx) * this.zoom + this.viewW / 2,
      y: (py - this.cy) * this.zoom + this.viewH / 2,
    };
  }

  /** Canvas pixels -> projected-space. */
  toProjected(x: number, y: number): { px: number; py: number } {
    return {
      px: this.cx + (x - this.viewW / 2) / this.zoom,
      py: this.cy + (y - this.viewH / 2) / this.zoom,
    };
  }
}
