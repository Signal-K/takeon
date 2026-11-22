import { Material } from '../types.js';
import { MATERIALS } from '../world/materials.js';
import { hash3 } from '../util/rng.js';

/**
 * Survey camera elevation, degrees above the horizon.
 * 30° is classic 2:1 isometric (tall cliffs, little roof). 60° is the
 * Crashlands-like three-quarter: more of the ground and the rover's deck,
 * shorter cliff faces. Tile metrics are derived from this so every
 * procedural sprite re-projects with the angle.
 */
export const DEFAULT_CAMERA_ELEVATION_DEG = 60;
export let CAMERA_ELEVATION_DEG = DEFAULT_CAMERA_ELEVATION_DEG;

/** Tile metrics at base scale, before camera zoom. */
export const TILE_W = 32;
/** Ground depth scale: TILE_W * sin(elevation). */
export let TILE_H = 0;
/** Cliff height scale: (TILE_W / 2) * cos(elevation). */
export let TILE_Z = 0;

/**
 * Change the camera elevation for every iso view mounted after this call
 * (tile metrics are module-wide, like the material registry). 30 is classic
 * 2:1 isometric, which matches the three-quarter entity art; 60 is the survey
 * default. Set it before mounting and keep one elevation per page; mounted
 * views do not re-project their cached terrain. Presentation only.
 */
export function setCameraElevation(deg = DEFAULT_CAMERA_ELEVATION_DEG): void {
  const rad = (deg * Math.PI) / 180;
  CAMERA_ELEVATION_DEG = deg;
  TILE_H = Math.round(TILE_W * Math.sin(rad));
  TILE_Z = Math.round((TILE_W / 2) * Math.cos(rad));
}
setCameraElevation();

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

/** Channel value where the highlight shoulder starts. */
const KNEE = 186;

/** Rolls a channel above KNEE off toward 255 instead of clipping it. */
function shoulder(v: number): number {
  if (v <= KNEE) return v;
  const room = 255 - KNEE;
  return KNEE + room * (1 - Math.exp(-(v - KNEE) / room));
}

/**
 * `shade` for lit terrain: the same multiply, with a soft highlight shoulder so
 * pale ground (ice, salt, snow) keeps its hue and its relief under the sun
 * instead of clipping to flat white beside dark ground. Dark colours are
 * unchanged, so one light reads the same on every material.
 */
export function exposure(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(shoulder(((n >> s) & 255) * f))));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/**
 * Pre-rendered voxel block sprites: for each material, a few jittered
 * variants of the classic three-face iso cube. Chunk composition then
 * becomes cheap drawImage calls.
 */
export class SpriteCache {
  private tiles = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  readonly variants = 4;

  private makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    return new OffscreenCanvas(w, h);
  }

  /** Sprite for a voxel; variant picked from position hash for texture. */
  tile(material: Material, x: number, y: number, z: number): HTMLCanvasElement | OffscreenCanvas {
    const variant = Math.floor(hash3(x, y, z, 0xf00d) * this.variants);
    const key = `${material}:${variant}`;
    let c = this.tiles.get(key);
    if (!c) {
      c = this.renderTile(material, variant);
      this.tiles.set(key, c);
    }
    return c;
  }

  private renderTile(material: Material, variant: number): HTMLCanvasElement | OffscreenCanvas {
    const def = MATERIALS[material];
    const w = TILE_W;
    const h = TILE_H + TILE_Z;
    const c = this.makeCanvas(w, h);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const jit = 1 + (hash3(variant, material, 7, 0xbeef) - 0.5) * 2 * def.jitter;
    const [top, left, right] = def.colors;

    const hw = w / 2;
    const hh = TILE_H / 2;

    // Top diamond.
    ctx.beginPath();
    ctx.moveTo(hw, 0);
    ctx.lineTo(w, hh);
    ctx.lineTo(hw, TILE_H);
    ctx.lineTo(0, hh);
    ctx.closePath();
    ctx.fillStyle = shade(cssToHex(top), jit);
    ctx.fill();

    // Left face (screen-left, -x side of the diamond bottom edge).
    ctx.beginPath();
    ctx.moveTo(0, hh);
    ctx.lineTo(hw, TILE_H);
    ctx.lineTo(hw, TILE_H + TILE_Z);
    ctx.lineTo(0, hh + TILE_Z);
    ctx.closePath();
    ctx.fillStyle = shade(cssToHex(left), jit);
    ctx.fill();

    // Right face.
    ctx.beginPath();
    ctx.moveTo(w, hh);
    ctx.lineTo(hw, TILE_H);
    ctx.lineTo(hw, TILE_H + TILE_Z);
    ctx.lineTo(w, hh + TILE_Z);
    ctx.closePath();
    ctx.fillStyle = shade(cssToHex(right), jit);
    ctx.fill();

    // Speckle texture on the top face for a semi-realistic surface.
    const speckles = 6 + variant * 2;
    for (let i = 0; i < speckles; i++) {
      const r1 = hash3(i, variant, material, 0xcafe);
      const r2 = hash3(i, variant * 3 + 1, material, 0xdead);
      const px = 4 + r1 * (w - 8);
      const py = 2 + r2 * (TILE_H - 4);
      // Keep speckles inside the diamond.
      if (Math.abs(px - hw) / hw + Math.abs(py - hh) / hh > 0.85) continue;
      ctx.fillStyle = shade(cssToHex(top), r1 > 0.5 ? 1.12 : 0.85);
      ctx.fillRect(px, py, 1.5, 1);
    }

    // Subtle edge highlight along the top-left ridge.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, hh);
    ctx.lineTo(hw, 0);
    ctx.stroke();

    return c;
  }
}

function cssToHex(css: string): string {
  // Material colors are always #rrggbb already.
  return css;
}

/** Project world voxel coords to base-scale screen coords (before camera). */
export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - z * TILE_Z,
  };
}
