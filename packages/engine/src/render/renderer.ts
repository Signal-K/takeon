import { Material, type Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { DIRS } from '../sim/simulation.js';
import { Camera } from './camera.js';
import { drawAnomaly, drawRover, drawStructure } from './entities.js';
import { project, TILE_H, TILE_W, TILE_Z, shade } from './sprites.js';
import { MATERIALS } from '../world/materials.js';
import { skinBiome } from '../world/terrain.js';
import { hash2, hash3 } from '../util/rng.js';
import { fbm2 } from '../util/noise.js';

interface Particle {
  x: number;
  y: number;
  h: number;
  tw: number;
  alpha: number;
}

interface Critter {
  x: number;
  y: number;
  tx: number;
  ty: number;
  hx: number;
  hy: number;
  wait: number;
  hue: number;
  bob: number;
}

interface AmbientProfile {
  count: number;
  color: string;
  wind: { x: number; y: number };
  size: number;
  sparkle?: boolean;
}

const CHUNK = 16;
/** Height deltas up to this blend into smooth slopes; larger become cliffs. */
const SMOOTH_STEP = 1.01;
/** Sub-tile offsets sampled for scalloped biome-edge blending. */
const BIOME_SAMPLES: [number, number][] = [
  [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3],
  [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22],
];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface Chunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  originX: number;
  originY: number;
  dirty: boolean;
}

export type ViewRotation = 0 | 1 | 2 | 3;

type Proj = (x: number, y: number, z: number) => { x: number; y: number };

/**
 * Isometric renderer over Canvas 2D with a *smoothed* voxel surface:
 * tile tops are polygons whose corner heights blend with neighbours
 * (≤1 voxel apart), so gentle terrain reads as rolling slopes and ramps;
 * bigger height jumps stay as cliffs rendered with geological strata.
 *
 * Terrain is composited from cached per-chunk canvases (rebuilt only when
 * voxels change). The camera rotates in 90° steps via a rotated view layer.
 */
export class IsoRenderer {
  readonly camera = new Camera();
  rotation: ViewRotation = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation;
  private chunks: Chunk[] = [];
  private chunksPerSide: number;
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private dpr = 1;
  /** Body-tinted material colours, cached as hex. Key: material*4 + faceIdx. */
  private tintCache = new Map<number, string>();
  /** Render-only ambient life (not simulated, not saved). */
  private particles: Particle[] = [];
  private critters: Critter[] = [];
  private ambient!: AmbientProfile;
  private lastDrawMs = 0;
  /** Smooth per-frame clock for animation (sim.time only ticks at 10 Hz). */
  private renderTime = 0;
  // ── Adaptive resolution ───────────────────────────────────────────────
  private cssW = 800;
  private cssH = 600;
  private reqDpr = 1;
  /** Backing-store multiplier auto-tuned to hold a smooth frame rate. */
  private renderScale = 1;
  private frameEma = 16;
  private lastQualityMs = 0;

  constructor(canvas: HTMLCanvasElement, sim: Simulation) {
    this.canvas = canvas;
    this.sim = sim;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('takeon: could not acquire 2d context');
    this.ctx = ctx;
    this.chunksPerSide = Math.ceil(sim.world.size / CHUNK);
    this.initChunks();
    this.initStars();
    sim.world.onColumnChange = (x, y) => {
      const v = this.toView(x, y);
      this.invalidateViewColumn(Math.round(v.x), Math.round(v.y));
    };
    const r = sim.rover;
    const v = this.toView(r.pos.x, r.pos.y);
    this.camera.centerOnTile(v.x, v.y, sim.world.height(r.pos.x, r.pos.y));
    this.ambient = this.ambientProfile();
    this.spawnCritters();
    this.lastDrawMs = nowMs();
  }

  /** Material colour with the body's identity tint applied (grey Moon,
   * rusty Mars, blue Europa...). */
  private tinted(material: Material, faceIdx: 0 | 1 | 2): string {
    const key = (material as number) * 4 + faceIdx;
    let hex = this.tintCache.get(key);
    if (!hex) {
      const base = MATERIALS[material].colors[faceIdx];
      const t = this.sim.body.palette.tint ?? [1, 1, 1];
      const n = parseInt(base.slice(1), 16);
      const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * t[0])));
      const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * t[1])));
      const b = Math.max(0, Math.min(255, Math.round((n & 255) * t[2])));
      hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      this.tintCache.set(key, hex);
    }
    return hex;
  }

  // ── View rotation ─────────────────────────────────────────────────────

  toView(x: number, y: number): Vec2 {
    const s = this.sim.world.size - 1;
    switch (this.rotation) {
      case 0: return { x, y };
      case 1: return { x: y, y: s - x };
      case 2: return { x: s - x, y: s - y };
      case 3: return { x: s - y, y: x };
    }
  }

  toWorld(u: number, v: number): Vec2 {
    const s = this.sim.world.size - 1;
    switch (this.rotation) {
      case 0: return { x: u, y: v };
      case 1: return { x: s - v, y: u };
      case 2: return { x: s - u, y: s - v };
      case 3: return { x: v, y: s - u };
    }
  }

  private heightV(u: number, v: number): number {
    if (u < 0 || v < 0 || u >= this.sim.world.size || v >= this.sim.world.size) return -1;
    const w = this.toWorld(u, v);
    return this.sim.world.height(w.x, w.y);
  }

  setRotation(rotation: ViewRotation): void {
    if (rotation === this.rotation) return;
    this.rotation = rotation;
    for (const c of this.chunks) c.dirty = true;
    const r = this.sim.rover;
    const v = this.toView(r.renderPos.x, r.renderPos.y);
    this.camera.centerOnTile(v.x, v.y, this.sim.world.height(r.pos.x, r.pos.y));
    this.camera.follow = true;
  }

  rotateClockwise(): void {
    this.setRotation(((this.rotation + 1) % 4) as ViewRotation);
  }

  // ── Smoothed surface geometry ─────────────────────────────────────────

  /**
   * Height of the grid corner at (u+0.5, v+0.5): average of the adjacent
   * columns whose heights sit within one step of the lowest — outliers
   * (cliff tops) don't drag the corner up. Identical for every tile that
   * shares the corner, so slopes are seam-free.
   */
  private cornerRaw(u: number, v: number): number {
    let h0 = this.heightV(u, v);
    let h1 = this.heightV(u + 1, v);
    let h2 = this.heightV(u, v + 1);
    let h3 = this.heightV(u + 1, v + 1);
    let min = Infinity;
    if (h0 >= 0 && h0 < min) min = h0;
    if (h1 >= 0 && h1 < min) min = h1;
    if (h2 >= 0 && h2 < min) min = h2;
    if (h3 >= 0 && h3 < min) min = h3;
    if (min === Infinity) return -1;
    let sum = 0;
    let n = 0;
    if (h0 >= 0 && h0 - min <= SMOOTH_STEP) { sum += h0; n++; }
    if (h1 >= 0 && h1 - min <= SMOOTH_STEP) { sum += h1; n++; }
    if (h2 >= 0 && h2 - min <= SMOOTH_STEP) { sum += h2; n++; }
    if (h3 >= 0 && h3 - min <= SMOOTH_STEP) { sum += h3; n++; }
    return sum / n;
  }

  /**
   * The four smoothed corner heights of tile (u,v) in screen order
   * [top, right, bottom, left] = corners (u-.5,v-.5) (u+.5,v-.5)
   * (u+.5,v+.5) (u-.5,v+.5). Corners that belong to a far-lower
   * neighbourhood clamp back to the tile's own height (cliff edge).
   */
  private tileCorners(u: number, v: number, h: number): [number, number, number, number] {
    const cs: [number, number, number, number] = [
      this.cornerRaw(u - 1, v - 1),
      this.cornerRaw(u, v - 1),
      this.cornerRaw(u, v),
      this.cornerRaw(u - 1, v),
    ];
    for (let i = 0; i < 4; i++) {
      if (cs[i] < 0 || Math.abs(cs[i] - h) > SMOOTH_STEP) cs[i] = h;
    }
    return cs;
  }

  /** Smoothed surface height at a tile centre (world coords), for entities. */
  surfaceZ(x: number, y: number): number {
    const vv = this.toView(Math.round(x), Math.round(y));
    const u = Math.round(vv.x);
    const v = Math.round(vv.y);
    const h = this.heightV(u, v);
    if (h < 0) return 0;
    const cs = this.tileCorners(u, v, h);
    return (cs[0] + cs[1] + cs[2] + cs[3]) / 4;
  }

  // ── Setup ─────────────────────────────────────────────────────────────

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.reqDpr = dpr;
    this.camera.viewW = cssW;
    this.camera.viewH = cssH;
    this.applyBacking();
  }

  /**
   * Set the backing-store size from CSS size × effective DPR. The device
   * pixel ratio is capped at 1.5 (past that the extra pixels cost fill rate
   * with no visible payoff on a smoothed iso scene) and further scaled by
   * `renderScale`, which the frame-rate governor tunes down on slow devices.
   */
  private applyBacking(): void {
    this.dpr = Math.min(this.reqDpr, 1.5) * this.renderScale;
    this.canvas.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
  }

  /**
   * Frame-rate governor: nudge the backing resolution to keep frames smooth.
   * Devices that can't push the pixels drop toward 60% scale; fast ones climb
   * back to full. Adjusts at most ~once a second to avoid thrashing.
   */
  private tuneQuality(frameMs: number, nowMsVal: number): void {
    this.frameEma = this.frameEma * 0.9 + frameMs * 0.1;
    if (nowMsVal - this.lastQualityMs < 900) return;
    let next = this.renderScale;
    if (this.frameEma > 26 && this.renderScale > 0.6) next = Math.max(0.6, this.renderScale - 0.12);
    else if (this.frameEma < 15 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.08);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.applyBacking();
    }
    this.lastQualityMs = nowMsVal;
  }

  private makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    return new OffscreenCanvas(w, h);
  }

  private initChunks(): void {
    const world = this.sim.world;
    for (let cy = 0; cy < this.chunksPerSide; cy++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        const x1 = Math.min(x0 + CHUNK, world.size) - 1;
        const y1 = Math.min(y0 + CHUNK, world.size) - 1;
        const left = project(x0, y1, 0).sx - TILE_W / 2;
        const right = project(x1, y0, 0).sx + TILE_W / 2;
        const top = project(x0, y0, world.maxHeight + 1).sy - TILE_H / 2;
        const bottom = project(x1, y1, 0).sy + TILE_H / 2 + TILE_Z * 1.5;
        const canvas = this.makeCanvas(Math.ceil(right - left), Math.ceil(bottom - top));
        this.chunks.push({ cx, cy, canvas, originX: left, originY: top, dirty: true });
      }
    }
  }

  private initStars(): void {
    const seed = this.sim.seed ^ 0x57a5;
    for (let i = 0; i < 140; i++) {
      this.stars.push({
        x: hash2(i, 1, seed),
        y: hash2(i, 2, seed),
        r: 0.5 + hash2(i, 3, seed) * 1.2,
        a: 0.3 + hash2(i, 4, seed) * 0.7,
      });
    }
  }

  private invalidateViewColumn(u: number, v: number): void {
    // Corner smoothing lets a column influence all 8 neighbours.
    const marked = new Set<number>();
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        const cx = Math.floor((u + du) / CHUNK);
        const cy = Math.floor((v + dv) / CHUNK);
        if (cx < 0 || cy < 0 || cx >= this.chunksPerSide || cy >= this.chunksPerSide) continue;
        marked.add(cy * this.chunksPerSide + cx);
      }
    }
    for (const i of marked) this.chunks[i].dirty = true;
  }

  // ── Column drawing (shared by chunk builds and the occluder pass) ─────

  /**
   * Draw one column: smoothed top polygon + cliff faces with strata.
   * `proj` maps continuous view coords to output pixels; `scale` is the
   * output scale (for line widths and texture density).
   */
  private drawColumnV(g: CanvasRenderingContext2D, u: number, v: number, proj: Proj, scale: number, cheap = false): void {
    const h = this.heightV(u, v);
    if (h < 0) return;
    const w = this.toWorld(u, v);
    const world = this.sim.world;
    const cs = this.tileCorners(u, v, h);

    // Screen-order corner positions: top, right, bottom, left.
    const pT = proj(u - 0.5, v - 0.5, cs[0]);
    const pR = proj(u + 0.5, v - 0.5, cs[1]);
    const pB = proj(u + 0.5, v + 0.5, cs[2]);
    const pL = proj(u - 0.5, v + 0.5, cs[3]);

    // ── Cliff faces first (they sit behind/below the top) ──────────────
    const hSE = this.heightV(u + 1, v);
    const hSW = this.heightV(u, v + 1);
    if (cs[1] > hSE + 0.01 || cs[2] > hSE + 0.01 || hSE < 0) {
      this.drawFace(g, proj, scale, w.x, w.y, u + 0.5, v - 0.5, cs[1], u + 0.5, v + 0.5, cs[2], hSE, 2);
    }
    if (cs[2] > hSW + 0.01 || cs[3] > hSW + 0.01 || hSW < 0) {
      this.drawFace(g, proj, scale, w.x, w.y, u + 0.5, v + 0.5, cs[2], u - 0.5, v + 0.5, cs[3], hSW, 1);
    }

    // ── Top polygon ─────────────────────────────────────────────────────
    const m = world.get(w.x, w.y, h) || Material.Regolith;
    const def = MATERIALS[m];
    const topColor = this.tinted(m, 0);
    // Lighting: sun from screen top-left; slope toward it brightens.
    // Ground tone varies in smooth organic blobs (low-frequency noise) plus
    // a whisper of per-tile grain — no checkerboard, Crashlands-style patches.
    const slope = (cs[0] - cs[2]) * 0.16 + (cs[3] - cs[1]) * 0.07;
    const blob = (fbm2(w.x * 0.11, w.y * 0.11, this.sim.seed ^ 0x600d, 3) - 0.5) * 0.34;
    const grain = (hash2(w.x, w.y, 0xf00d) - 0.5) * def.jitter * 0.6;
    const bright = Math.max(0.62, Math.min(1.36, 1 + slope + blob + grain));

    g.beginPath();
    g.moveTo(pT.x, pT.y);
    g.lineTo(pR.x, pR.y);
    g.lineTo(pB.x, pB.y);
    g.lineTo(pL.x, pL.y);
    g.closePath();
    g.fillStyle = shade(topColor, bright);
    g.fill();

    // Soil texture: clipped speckles, grain streaks and occasional pebbles.
    // The occluder pass re-stamps columns above entities every frame — there,
    // skip the expensive noise-sampled scallops, soil grain and doodads. The
    // sliver of terrain peeking over an entity doesn't need the fine detail,
    // and it keeps per-frame cost flat.
    if (cheap) {
      g.restore();
      return;
    }

    g.save();
    g.clip();

    // Scalloped biome edges: where a neighbouring surface biome's noise
    // reaches into this tile, paint soft intrusions of its colour. Interior
    // tiles (all samples agree) get none and stay clean, so only boundaries
    // pick up the organic, interlocking patch look.
    if (m === Material.Regolith || m === Material.Dust || m === Material.Silica) {
      const cz = (cs[0] + cs[1] + cs[2] + cs[3]) / 4;
      for (const [du, dv] of BIOME_SAMPLES) {
        const ws = this.toWorld(u + du, v + dv);
        const bm = skinBiome(ws.x, ws.y, this.sim.seed);
        if (bm === m) continue;
        const sp = proj(u + du, v + dv, cz);
        g.fillStyle = shade(this.tinted(bm, 0), bright);
        g.beginPath();
        g.ellipse(sp.x, sp.y, 8 * scale, 4.4 * scale, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    const cxm = (pT.x + pB.x) / 2;
    const bilerp = (a: number, b: number): { x: number; y: number } => {
      // a: along T->R / L->B, b: along T->L / R->B (0..1)
      const x1 = pT.x + (pR.x - pT.x) * a;
      const y1 = pT.y + (pR.y - pT.y) * a;
      const x2 = pL.x + (pB.x - pL.x) * a;
      const y2 = pL.y + (pB.y - pL.y) * a;
      return { x: x1 + (x2 - x1) * b, y: y1 + (y2 - y1) * b };
    };
    const n = 9;
    for (let i = 0; i < n; i++) {
      const r1 = hash3(w.x, w.y, i, 0xcafe);
      const r2 = hash3(w.x, w.y, i, 0xdead);
      const r3 = hash3(w.x, w.y, i, 0xbeef);
      const p = bilerp(0.08 + r1 * 0.84, 0.08 + r2 * 0.84);
      if (r3 < 0.16) {
        // Pebble with a hint of shadow.
        const pr = (0.9 + r3 * 4) * scale;
        g.fillStyle = 'rgba(15,10,25,0.18)';
        g.beginPath();
        g.ellipse(p.x + pr * 0.3, p.y + pr * 0.35, pr, pr * 0.55, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = shade(topColor, bright * (r2 > 0.5 ? 1.18 : 0.8));
        g.beginPath();
        g.ellipse(p.x, p.y, pr, pr * 0.6, 0, 0, Math.PI * 2);
        g.fill();
      } else if (r3 < 0.6) {
        // Grain fleck.
        g.fillStyle = shade(topColor, bright * (r1 > 0.5 ? 1.14 : 0.84));
        g.fillRect(p.x, p.y, 1.4 * scale, 0.9 * scale);
      } else {
        // Wind streak along the diamond axis.
        g.strokeStyle = shade(topColor, bright * 0.9);
        g.lineWidth = 0.5 * scale;
        g.beginPath();
        g.moveTo(p.x - 3 * scale, p.y + 1.2 * scale);
        g.lineTo(p.x + 3 * scale, p.y - 0.6 * scale);
        g.stroke();
      }
    }
    // Soft ambient occlusion where a higher neighbour looms (screen-top edges).
    const hNE = this.heightV(u, v - 1);
    const hNW = this.heightV(u - 1, v);
    if (hNE > h + SMOOTH_STEP) {
      const ao = g.createLinearGradient(pR.x, pR.y, cxm, (pT.y + pB.y) / 2);
      ao.addColorStop(0, 'rgba(12,8,26,0.30)');
      ao.addColorStop(1, 'rgba(12,8,26,0)');
      g.fillStyle = ao;
      g.fill();
    }
    if (hNW > h + SMOOTH_STEP) {
      const ao = g.createLinearGradient(pL.x, pL.y, cxm, (pT.y + pB.y) / 2);
      ao.addColorStop(0, 'rgba(12,8,26,0.30)');
      ao.addColorStop(1, 'rgba(12,8,26,0)');
      g.fillStyle = ao;
      g.fill();
    }
    g.restore();

    // Decorative scatter: tufts, rock clusters and shards on ~1 in 14 open
    // tiles. Part of the cached chunk, so it costs nothing per frame.
    const doodadRoll = hash2(w.x, w.y, 0xd00d);
    if (doodadRoll < 0.07 && m !== Material.Basalt && m !== Material.Rock) {
      const cz = (cs[0] + cs[1] + cs[2] + cs[3]) / 4;
      const c = proj(u, v, cz);
      const ox = (hash2(w.x, w.y, 0xa11) - 0.5) * 10 * scale;
      const oy = (hash2(w.x, w.y, 0xb22) - 0.5) * 5 * scale;
      this.drawDoodad(g, c.x + ox, c.y + oy, scale, w.x, w.y, m, bright);
    }
  }

  /** Small hand-placed-looking props with chunky outlines. */
  private drawDoodad(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    wx: number,
    wy: number,
    m: Material,
    bright: number,
  ): void {
    const kind = Math.floor(hash2(wx, wy, 0xdaa) * 3);
    const size = (0.7 + hash2(wx, wy, 0xebb) * 0.6) * s;
    const outline = 'rgba(20,12,32,0.55)';
    g.save();
    g.translate(x, y);
    g.lineJoin = 'round';

    if (m === Material.Ice || kind === 2) {
      // Ice/crystal shards.
      const tint = m === Material.Ice ? this.tinted(Material.Ice, 0) : this.tinted(m, 0);
      for (const [dx, h] of [[-3, 6], [0.5, 9], [3.5, 5]] as [number, number][]) {
        g.fillStyle = shade(tint, 1.15 + h * 0.01);
        g.strokeStyle = outline;
        g.lineWidth = 0.8 * s;
        g.beginPath();
        g.moveTo((dx - 1.6) * size, 1.5 * size);
        g.lineTo(dx * size, (1.5 - h) * size);
        g.lineTo((dx + 1.6) * size, 1.5 * size);
        g.closePath();
        g.fill();
        g.stroke();
      }
    } else if (kind === 0) {
      // Dry tuft: splayed blades.
      g.strokeStyle = outline;
      g.lineWidth = 2.2 * size;
      g.lineCap = 'round';
      const tuft = m === Material.Sulfur ? '#e8cf58' : shade(this.tinted(m, 0), bright * 0.72);
      for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const len = (5 + hash2(wx + a * 10, wy, 0xfcc) * 4) * size;
        g.beginPath();
        g.moveTo(0, 1.5 * size);
        g.lineTo(Math.sin(a) * len, 1.5 * size - Math.cos(a * 0.6) * len);
        g.stroke();
      }
      g.strokeStyle = tuft;
      g.lineWidth = 1.3 * size;
      for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const len = (5 + hash2(wx + a * 10, wy, 0xfcc) * 4) * size;
        g.beginPath();
        g.moveTo(0, 1.5 * size);
        g.lineTo(Math.sin(a) * len, 1.5 * size - Math.cos(a * 0.6) * len);
        g.stroke();
      }
    } else {
      // Rounded rock cluster.
      const rockHex = this.tinted(Material.Rock, 0);
      for (const [dx, dy, r] of [[-2.5, 0.5, 3.2], [2, 1, 2.4], [0.2, -1.2, 2.1]] as [number, number, number][]) {
        g.fillStyle = shade(rockHex, bright * (1.05 - Math.abs(dx) * 0.05));
        g.strokeStyle = outline;
        g.lineWidth = 0.9 * s;
        g.beginPath();
        g.ellipse(dx * size, dy * size, r * size, r * 0.72 * size, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  /** A cliff face between two corners, banded by the strata materials. */
  private drawFace(
    g: CanvasRenderingContext2D,
    proj: Proj,
    scale: number,
    wx: number,
    wy: number,
    ua: number,
    va: number,
    za: number,
    ub: number,
    vb: number,
    zb: number,
    neighbourH: number,
    colorIdx: 1 | 2,
  ): void {
    const world = this.sim.world;
    const bottom = neighbourH < 0 ? -0.6 : Math.min(neighbourH, Math.min(za, zb));
    const top = Math.max(za, zb);
    if (top <= bottom + 0.01) return;

    const pa = proj(ua, va, za);
    const pb = proj(ub, vb, zb);
    const pa0 = proj(ua, va, bottom);
    const pb0 = proj(ub, vb, bottom);

    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.lineTo(pb0.x, pb0.y);
    g.lineTo(pa0.x, pa0.y);
    g.closePath();
    g.save();
    g.clip();

    // Strata bands: each z level filled with that voxel's material colour.
    for (let z = Math.floor(bottom); z <= Math.ceil(top); z++) {
      const mz = world.get(wx, wy, Math.max(0, Math.min(world.maxHeight - 1, z)));
      const band = 1 + (hash3(wx, wy, z, 0x50a1) - 0.5) * 0.12;
      g.fillStyle = shade(this.tinted(mz === Material.Air ? Material.Rock : mz, colorIdx), band);
      const t1 = proj(ua, va, z + 1);
      const t2 = proj(ub, vb, z + 1);
      const b1 = proj(ua, va, z);
      const b2 = proj(ub, vb, z);
      g.beginPath();
      g.moveTo(t1.x, t1.y);
      g.lineTo(t2.x, t2.y);
      g.lineTo(b2.x, b2.y);
      g.lineTo(b1.x, b1.y);
      g.closePath();
      g.fill();
      // Sediment seam.
      g.strokeStyle = 'rgba(12,8,26,0.22)';
      g.lineWidth = 0.6 * scale;
      g.beginPath();
      g.moveTo(b1.x, b1.y);
      g.lineTo(b2.x, b2.y);
      g.stroke();
    }
    // Contact-shadow gradient toward the base of the cliff.
    const gr = g.createLinearGradient(0, Math.min(pa.y, pb.y), 0, Math.max(pa0.y, pb0.y));
    gr.addColorStop(0, 'rgba(12,8,26,0)');
    gr.addColorStop(1, 'rgba(12,8,26,0.38)');
    g.fillStyle = gr;
    g.fillRect(
      Math.min(pa.x, pb.x, pa0.x, pb0.x),
      Math.min(pa.y, pb.y),
      Math.abs(pb.x - pa.x) + 2,
      Math.max(pa0.y, pb0.y) - Math.min(pa.y, pb.y) + 2,
    );
    g.restore();
  }

  private rebuildChunk(chunk: Chunk): void {
    const world = this.sim.world;
    const g = chunk.canvas.getContext('2d') as CanvasRenderingContext2D;
    g.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
    const u0 = chunk.cx * CHUNK;
    const v0 = chunk.cy * CHUNK;
    const uN = Math.min(CHUNK, world.size - u0);
    const vN = Math.min(CHUNK, world.size - v0);
    const proj: Proj = (x, y, z) => {
      const p = project(x, y, z);
      return { x: p.sx - chunk.originX, y: p.sy - chunk.originY };
    };
    for (let s = 0; s <= uN + vN - 2; s++) {
      for (let lu = Math.max(0, s - vN + 1); lu <= Math.min(s, uN - 1); lu++) {
        this.drawColumnV(g, u0 + lu, v0 + (s - lu), proj, 1);
      }
    }
    chunk.dirty = false;
  }

  /** Draw one full frame of the mission scene. */
  draw(): void {
    const { ctx, camera, sim } = this;
    const world = sim.world;
    const daylight = sim.daylight();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // Advance render-only ambient life (particles + critters) and adapt the
    // backing resolution to the real frame interval.
    const _now = nowMs();
    const frameMs = _now - this.lastDrawMs;
    this.updateAmbient(Math.min(0.05, frameMs / 1000));
    if (this.lastDrawMs > 0) this.tuneQuality(frameMs, _now);
    this.lastDrawMs = _now;

    // Sky: vertical gradient from deep space down to the horizon tint.
    const horizon = mixColor(sim.body.palette.skyNight, sim.body.palette.sky, daylight);
    const zenith = shadeCss2(horizon, 0.38);
    const grad = ctx.createLinearGradient(0, 0, 0, camera.viewH);
    grad.addColorStop(0, zenith);
    grad.addColorStop(1, horizon);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    const starAlpha = 0.25 + (1 - daylight) * 0.75;
    for (const st of this.stars) {
      ctx.globalAlpha = st.a * starAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(st.x * camera.viewW, st.y * camera.viewH * 0.9, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // Camera follow (in view space, on the smoothed surface).
    const rover = sim.rover;
    const rz = this.roverZ();
    const rv = this.toView(rover.renderPos.x, rover.renderPos.y);
    if (camera.follow) {
      const p = project(rv.x, rv.y, rz);
      camera.cx += (p.sx - camera.cx) * 0.15;
      camera.cy += (p.sy - camera.cy) * 0.15;
    }

    // Terrain chunks in painter order.
    const sorted = [...this.chunks].sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
    for (const chunk of sorted) {
      if (chunk.dirty) this.rebuildChunk(chunk);
      const s = camera.toScreen(chunk.originX, chunk.originY);
      const w = chunk.canvas.width * camera.zoom;
      const h = chunk.canvas.height * camera.zoom;
      if (s.x > camera.viewW || s.y > camera.viewH || s.x + w < 0 || s.y + h < 0) continue;
      ctx.drawImage(chunk.canvas as CanvasImageSource, s.x, s.y, w, h);
    }

    // Facing-tile / mining highlights on the smoothed surface.
    const d = DIRS[rover.facing];
    const fx = rover.pos.x + d.x;
    const fy = rover.pos.y + d.y;
    if (world.isSolid(fx, fy)) {
      this.strokeTilePolygon(fx, fy, 'rgba(255,255,255,0.35)');
    }
    if (rover.mining) {
      const pulse = 0.35 + (Math.sin(sim.time * 10) + 1) * 0.2;
      this.strokeTilePolygon(rover.mining.pos.x, rover.mining.pos.y, `rgba(255,179,71,${pulse})`);
    }

    // Entities in view-space diagonal order.
    type Ent = { s: number; draw: () => void };
    const ents: Ent[] = [];
    for (const a of sim.anomalies) {
      if (world.height(a.pos.x, a.pos.y) < 0) continue;
      const av = this.toView(a.pos.x, a.pos.y);
      const az = this.surfaceZ(a.pos.x, a.pos.y);
      const p = camera.toScreen(...projXY(av.x, av.y, az + 0.55));
      ents.push({
        s: av.x + av.y,
        draw: () => drawAnomaly(ctx, p.x, p.y, camera.zoom, a, sim.time),
      });
    }
    for (const st of sim.structures) {
      const sv = this.toView(st.pos.x, st.pos.y);
      const sz = this.surfaceZ(st.pos.x, st.pos.y);
      const p = camera.toScreen(...projXY(sv.x, sv.y, sz + 0.55));
      ents.push({
        s: sv.x + sv.y,
        draw: () => drawStructure(ctx, p.x, p.y, camera.zoom, st, sim.time, daylight),
      });
    }
    {
      const p = camera.toScreen(...projXY(rv.x, rv.y, rz + 0.55));
      const screenFacing = (((rover.facing - this.rotation) % 4) + 4) % 4;
      ents.push({
        s: rv.x + rv.y,
        draw: () => drawRover(ctx, p.x, p.y, camera.zoom, rover, daylight, screenFacing as 0 | 1 | 2 | 3, this.renderTime),
      });
    }
    // Ambient critters wander the surface — depth-sorted with everything else.
    for (const c of this.critters) {
      const cv = this.toView(c.x, c.y);
      const cz = this.surfaceZ(c.x, c.y);
      const p = camera.toScreen(...projXY(cv.x, cv.y, cz + 0.5));
      ents.push({ s: cv.x + cv.y, draw: () => this.drawCritter(ctx, p.x, p.y, camera.zoom, c, this.renderTime) });
    }
    ents.sort((a, b) => a.s - b.s);
    for (const e of ents) e.draw();

    // Re-draw terrain columns that should occlude nearby entities.
    this.redrawOccluders(rv, rz);

    // Airborne motes / spores drift above the scene.
    this.drawParticles();

    // Weather effects over the scene.
    this.drawWeather(daylight);

    // Night tint.
    if (daylight < 1) {
      ctx.fillStyle = `rgba(10,8,30,${(1 - daylight) * 0.45})`;
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
  }

  /** Weather rendering: vortices, haze, aurora, meteor strikes, fog. */
  private drawWeather(daylight: number): void {
    const { ctx, camera, sim } = this;
    const t = sim.time;

    // Meteor strike flashes + incoming streaks (recent impacts on the sim).
    for (const imp of sim.impacts) {
      const age = t - imp.t;
      const a = Math.max(0, 1 - age / 1.1);
      const iv = this.toView(imp.pos.x, imp.pos.y);
      const iz = this.surfaceZ(imp.pos.x, imp.pos.y);
      const p = camera.toScreen(...projXY(iv.x, iv.y, iz));
      if (age < 0.35) {
        // Incoming streak from the upper right.
        ctx.strokeStyle = `rgba(255,220,160,${a})`;
        ctx.lineWidth = 2 * camera.zoom * (1 - age * 2);
        ctx.beginPath();
        ctx.moveTo(p.x + 80 * camera.zoom * (0.35 - age) * 4, p.y - 130 * camera.zoom * (0.35 - age) * 4);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // Flash + dust ring.
      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 22 * camera.zoom * (0.4 + age));
      g.addColorStop(0, `rgba(255,240,200,${a * 0.8})`);
      g.addColorStop(0.4, `rgba(255,170,90,${a * 0.35})`);
      g.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 * camera.zoom * (0.4 + age), 0, Math.PI * 2);
      ctx.fill();
    }

    const w = sim.weather;
    if (!w) return;
    const i = w.intensity;

    switch (w.type) {
      case 'dust-devil': {
        if (!w.pos) break;
        const dv = this.toView(w.pos.x, w.pos.y);
        const dz = this.surfaceZ(w.pos.x, w.pos.y);
        const p = camera.toScreen(...projXY(dv.x, dv.y, dz));
        const s = camera.zoom;
        // Swirling stacked ellipses, wider toward the top.
        for (let k = 0; k < 7; k++) {
          const frac = k / 6;
          const wob = Math.sin(t * 7 + k * 1.7) * 3 * s;
          const rx = (5 + frac * 13) * s;
          ctx.strokeStyle = `rgba(226,190,140,${0.5 - frac * 0.32})`;
          ctx.lineWidth = 2.2 * s * (1 - frac * 0.4);
          ctx.beginPath();
          ctx.ellipse(p.x + wob, p.y - (6 + frac * 44) * s, rx, rx * 0.38, 0, t * 5 + k, t * 5 + k + Math.PI * 1.4);
          ctx.stroke();
        }
        // Kicked-up dust at the base.
        ctx.fillStyle = 'rgba(226,190,140,0.30)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 2 * s, 10 * s, 4 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'dust-storm': {
        // Moving haze bands + a global sandy tint.
        ctx.fillStyle = `rgba(214,150,80,${0.16 * i})`;
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
        for (let k = 0; k < 3; k++) {
          const y = ((t * (26 + k * 14) + k * 220) % (camera.viewH + 240)) - 120;
          const g = ctx.createLinearGradient(0, y - 70, 0, y + 70);
          g.addColorStop(0, 'rgba(222,160,92,0)');
          g.addColorStop(0.5, `rgba(222,160,92,${0.14 * i})`);
          g.addColorStop(1, 'rgba(222,160,92,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, y - 70, camera.viewW, 140);
        }
        break;
      }
      case 'solar-storm': {
        // Aurora curtains at the top of the frame + a faint flicker.
        for (let k = 0; k < 3; k++) {
          const x0 = camera.viewW * (0.12 + k * 0.3) + Math.sin(t * 0.8 + k * 2) * 40;
          const flick = 0.5 + Math.sin(t * (6 + k)) * 0.3;
          const g = ctx.createLinearGradient(x0, 0, x0 + 30, camera.viewH * 0.45);
          g.addColorStop(0, `rgba(120,255,200,${0.20 * i * flick})`);
          g.addColorStop(0.6, `rgba(150,120,255,${0.10 * i * flick})`);
          g.addColorStop(1, 'rgba(150,120,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x0 - 45, 0);
          ctx.lineTo(x0 + 65, 0);
          ctx.lineTo(x0 + 25, camera.viewH * 0.45);
          ctx.lineTo(x0 - 15, camera.viewH * 0.45);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'cryo-fog': {
        // Low drifting fog banks.
        for (let k = 0; k < 3; k++) {
          const y = camera.viewH * (0.45 + k * 0.18) + Math.sin(t * 0.5 + k * 2.4) * 14;
          const g = ctx.createLinearGradient(0, y - 40, 0, y + 40);
          g.addColorStop(0, 'rgba(205,230,252,0)');
          g.addColorStop(0.5, `rgba(205,230,252,${0.13 * i})`);
          g.addColorStop(1, 'rgba(205,230,252,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, y - 40, camera.viewW, 80);
        }
        ctx.fillStyle = `rgba(200,225,250,${0.08 * i * (0.5 + daylight * 0.5)})`;
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
        break;
      }
      default:
        break;
    }
  }

  // ── Ambient life (render-only) ────────────────────────────────────────

  private ambientProfile(): AmbientProfile {
    switch (this.sim.body.id) {
      case 'mars':
        return { count: 32, color: '#e6b070', wind: { x: 0.4, y: 0.14 }, size: 1.6 };
      case 'io':
        return { count: 28, color: '#f0d24a', wind: { x: 0.22, y: 0.3 }, size: 1.5 };
      case 'bennu':
        return { count: 20, color: '#b0a898', wind: { x: 0.12, y: 0.06 }, size: 1.3 };
      case 'europa':
        return { count: 26, color: '#dff0ff', wind: { x: 0.06, y: 0.04 }, size: 1.4, sparkle: true };
      case 'ceres':
        return { count: 22, color: '#e6ddff', wind: { x: 0.08, y: 0.05 }, size: 1.3, sparkle: true };
      case 'moon':
        return { count: 14, color: '#d8d2e0', wind: { x: 0.05, y: 0.03 }, size: 1.2 };
      default:
        return { count: 20, color: '#d8ccb0', wind: { x: 0.2, y: 0.1 }, size: 1.4 };
    }
  }

  private spawnCritters(): void {
    const world = this.sim.world;
    const r = this.sim.rover.pos;
    let placed = 0;
    let tries = 0;
    while (placed < 3 && tries < 200) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 8;
      const x = Math.round(r.x + Math.cos(a) * d);
      const y = Math.round(r.y + Math.sin(a) * d);
      if (!world.isSolid(x, y)) continue;
      this.critters.push({
        x, y, tx: x, ty: y, hx: x, hy: y,
        wait: 0.5 + Math.random() * 2,
        hue: 90 + Math.random() * 65,
        bob: Math.random() * 6.28,
      });
      placed++;
    }
  }

  private spawnParticle(rover: { x: number; y: number }, wind: { x: number; y: number }, R: number): Particle {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * R;
    return {
      x: rover.x + Math.cos(a) * d - wind.x * R * 0.35,
      y: rover.y + Math.sin(a) * d - wind.y * R * 0.35,
      h: 0.3 + Math.random() * 2.6,
      tw: Math.random() * 6.28,
      alpha: 0.22 + Math.random() * 0.4,
    };
  }

  private updateAmbient(dt: number): void {
    this.renderTime += dt;
    const world = this.sim.world;
    const rover = this.sim.rover.renderPos;
    const prof = this.ambient;
    const w = this.sim.weather;
    const storm = w != null && (w.type === 'dust-storm' || w.type === 'dust-devil');
    const target = Math.round(prof.count * (storm ? 2 : 1));
    const R = 16;
    const wind = { x: prof.wind.x * (storm ? 2.4 : 1), y: prof.wind.y * (storm ? 2.4 : 1) };

    while (this.particles.length < target) this.particles.push(this.spawnParticle(rover, wind, R));
    if (this.particles.length > target) this.particles.length = target;
    for (const p of this.particles) {
      p.x += wind.x * dt;
      p.y += wind.y * dt;
      p.h += Math.sin((p.tw + this.sim.time) * 1.5) * dt * 0.4;
      if (p.h < 0.2) p.h = 0.2;
      const dx = p.x - rover.x;
      const dy = p.y - rover.y;
      if (dx * dx + dy * dy > (R + 3) * (R + 3)) Object.assign(p, this.spawnParticle(rover, wind, R));
    }

    for (const c of this.critters) {
      const dxx = c.tx - c.x;
      const dyy = c.ty - c.y;
      if (Math.abs(dxx) < 0.03 && Math.abs(dyy) < 0.03) {
        c.x = c.tx;
        c.y = c.ty;
        c.wait -= dt;
        if (c.wait <= 0) {
          const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
          c.wait = 1 + Math.random();
          for (const [ex, ey] of dirs) {
            const nx = c.tx + ex;
            const ny = c.ty + ey;
            if (!world.isSolid(nx, ny)) continue;
            if (Math.abs(nx - c.hx) + Math.abs(ny - c.hy) > 5) continue;
            if (Math.abs(world.height(nx, ny) - world.height(c.tx, c.ty)) > 2) continue;
            c.tx = nx;
            c.ty = ny;
            c.wait = 0.6 + Math.random() * 2.4;
            break;
          }
        }
      } else {
        const sp = 1.7 * dt;
        c.x += Math.sign(dxx) * Math.min(Math.abs(dxx), sp);
        c.y += Math.sign(dyy) * Math.min(Math.abs(dyy), sp);
      }
    }
  }

  private drawParticles(): void {
    const { ctx, camera } = this;
    const prof = this.ambient;
    const t = this.renderTime;
    // Motes are airborne — one surface reference for the whole field is
    // visually indistinguishable from sampling each and far cheaper.
    const rover = this.sim.rover.renderPos;
    const baseZ = this.surfaceZ(rover.x, rover.y);
    for (const p of this.particles) {
      const pv = this.toView(p.x, p.y);
      const s = camera.toScreen(...projXY(pv.x, pv.y, baseZ + p.h));
      if (s.x < -20 || s.y < -20 || s.x > camera.viewW + 20 || s.y > camera.viewH + 20) continue;
      const flick = 0.55 + 0.45 * Math.sin(p.tw + t * 3);
      ctx.globalAlpha = p.alpha * flick;
      ctx.fillStyle = prof.color;
      const r = prof.size * camera.zoom * 0.6;
      if (prof.sparkle) {
        ctx.fillRect(s.x - r, s.y - 0.4 * r, 2 * r, 0.8 * r);
        ctx.fillRect(s.x - 0.4 * r, s.y - r, 0.8 * r, 2 * r);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A small wandering critter: chunky blob with eyes, antennae and a hop. */
  private drawCritter(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: Critter, time: number): void {
    const moving = Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.03;
    const hop = moving ? Math.abs(Math.sin(time * 7 + c.bob)) : 0;
    const hue = c.hue | 0;
    g.save();
    g.translate(x, y - hop * 3 * s);
    g.scale(s, s);
    g.lineJoin = 'round';
    g.fillStyle = 'rgba(10,6,20,0.28)';
    g.beginPath();
    g.ellipse(0, 3.6 + hop * 3, 4.2, 1.8, 0, 0, Math.PI * 2);
    g.fill();
    const body = `hsl(${hue} 55% 58%)`;
    const dark = `hsl(${hue} 55% 40%)`;
    const squash = 1 + hop * 0.14;
    g.strokeStyle = 'rgba(20,12,32,0.5)';
    g.lineWidth = 0.7;
    // Antennae.
    g.strokeStyle = dark;
    g.beginPath();
    g.moveTo(-1.4, -3); g.lineTo(-2.2, -5.4);
    g.moveTo(1.4, -3); g.lineTo(2.2, -5.4);
    g.stroke();
    g.fillStyle = body;
    g.beginPath();
    g.arc(-2.2, -5.6, 0.7, 0, Math.PI * 2);
    g.arc(2.2, -5.6, 0.7, 0, Math.PI * 2);
    g.fill();
    // Body.
    g.fillStyle = body;
    g.strokeStyle = 'rgba(20,12,32,0.5)';
    g.beginPath();
    g.ellipse(0, 0, 4.2, 4.2 / squash, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Feet.
    g.fillStyle = dark;
    g.beginPath();
    g.ellipse(-1.9, 3.4, 1, 0.7, 0, 0, Math.PI * 2);
    g.ellipse(1.9, 3.4, 1, 0.7, 0, 0, Math.PI * 2);
    g.fill();
    // Eyes with a glance toward travel direction.
    const look = moving ? Math.sign(c.tx - c.x) * 0.45 : 0;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(-1.4, -0.4, 1.3, 0, Math.PI * 2);
    g.arc(1.4, -0.4, 1.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#101018';
    g.beginPath();
    g.arc(-1.4 + look, -0.2, 0.6, 0, Math.PI * 2);
    g.arc(1.4 + look, -0.2, 0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Rover z on the smoothed surface, interpolated during tile moves. */
  private roverZ(): number {
    const r = this.sim.rover;
    if (r.moveFrom) {
      const z0 = this.surfaceZ(r.moveFrom.x, r.moveFrom.y);
      const z1 = this.surfaceZ(r.pos.x, r.pos.y);
      return z0 + (z1 - z0) * r.moveT;
    }
    return this.surfaceZ(r.pos.x, r.pos.y);
  }

  private redrawOccluders(posV: Vec2, z: number): void {
    const { ctx, camera } = this;
    const eu = Math.round(posV.x);
    const ev = Math.round(posV.y);
    const s0 = eu + ev;
    const R = 7;
    const proj: Proj = (x, y, zz) => {
      const p = project(x, y, zz);
      return camera.toScreen(p.sx, p.sy);
    };
    for (let s = s0 + 1; s <= s0 + R; s++) {
      for (let u = eu - R; u <= eu + R; u++) {
        const v = s - u;
        if (Math.abs(v - ev) > R) continue;
        const h = this.heightV(u, v);
        if (h <= z + 0.5) continue; // cannot occlude the entity
        this.drawColumnV(ctx, u, v, proj, camera.zoom, true);
      }
    }
  }

  private strokeTilePolygon(x: number, y: number, style: string): void {
    const { ctx, camera } = this;
    const vv = this.toView(x, y);
    const u = Math.round(vv.x);
    const v = Math.round(vv.y);
    const h = this.heightV(u, v);
    if (h < 0) return;
    const cs = this.tileCorners(u, v, h);
    const pts = [
      project(u - 0.5, v - 0.5, cs[0]),
      project(u + 0.5, v - 0.5, cs[1]),
      project(u + 0.5, v + 0.5, cs[2]),
      project(u - 0.5, v + 0.5, cs[3]),
    ].map((p) => camera.toScreen(p.sx, p.sy));
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(1, camera.zoom);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }

  /** World tile under a canvas-space point (front-most surface wins). */
  pickTile(canvasX: number, canvasY: number): Vec2 | null {
    const { camera } = this;
    const world = this.sim.world;
    const pr = camera.toProjected(canvasX, canvasY);
    const bx = pr.px / (TILE_W / 2);
    const by = pr.py / (TILE_H / 2);
    const u0 = Math.round((by + bx) / 2);
    const v0 = Math.round((by - bx) / 2);
    for (let k = world.maxHeight; k >= 0; k--) {
      const shift = (k * TILE_Z) / TILE_H;
      const cand = [
        { u: Math.round(u0 + shift), v: Math.round(v0 + shift) },
        { u: Math.floor(u0 + shift), v: Math.ceil(v0 + shift) },
        { u: Math.ceil(u0 + shift), v: Math.floor(v0 + shift) },
      ];
      for (const c of cand) {
        const h = this.heightV(c.u, c.v);
        if (h < 0) continue;
        const p = project(c.u, c.v, h);
        if (Math.abs(p.sx - pr.px) <= TILE_W / 2 && Math.abs(p.sy - pr.py) <= TILE_H / 2 + 2) {
          return this.toWorld(c.u, c.v);
        }
      }
    }
    return null;
  }

  /** Render a photo of the area around the rover; returns a JPEG data URL. */
  capturePhoto(): string | null {
    if (typeof document === 'undefined') return null;
    const w = 480;
    const h = 320;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const saved = {
      cx: this.camera.cx,
      cy: this.camera.cy,
      zoom: this.camera.zoom,
      vw: this.camera.viewW,
      vh: this.camera.viewH,
      follow: this.camera.follow,
    };
    const savedCanvas = this.canvas;
    const savedCtx = this.ctx;
    const savedDpr = this.dpr;
    try {
      this.canvas = tmp;
      this.ctx = tmp.getContext('2d')!;
      this.dpr = 1;
      this.camera.viewW = w;
      this.camera.viewH = h;
      this.camera.zoom = 2.4;
      this.camera.follow = false;
      const r = this.sim.rover;
      const rv = this.toView(r.pos.x, r.pos.y);
      this.camera.centerOnTile(rv.x, rv.y, this.sim.world.height(r.pos.x, r.pos.y));
      this.draw();
      const c = this.ctx;
      const g = c.createRadialGradient(w / 2, h / 2, h / 3, w / 2, h / 2, h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = '10px monospace';
      c.fillText(
        `${this.sim.body.name.toUpperCase()}  T+${this.sim.time.toFixed(0)}s  [${r.pos.x},${r.pos.y}]`,
        8,
        h - 8,
      );
      return tmp.toDataURL('image/jpeg', 0.85);
    } finally {
      this.canvas = savedCanvas;
      this.ctx = savedCtx;
      this.dpr = savedDpr;
      this.camera.cx = saved.cx;
      this.camera.cy = saved.cy;
      this.camera.zoom = saved.zoom;
      this.camera.viewW = saved.vw;
      this.camera.viewH = saved.vh;
      this.camera.follow = saved.follow;
    }
  }

  /** Paint a minimap of the whole body onto the given canvas (world-north up). */
  renderMinimap(target: HTMLCanvasElement): void {
    const world = this.sim.world;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const scale = Math.max(1, Math.floor(Math.min(target.width, target.height) / world.size));
    ctx.fillStyle = '#100b2c';
    ctx.fillRect(0, 0, target.width, target.height);
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const h = world.height(x, y);
        if (h < 0) continue;
        const m = world.surfaceMaterial(x, y);
        ctx.fillStyle = shade(this.tinted(m, 0), 0.5 + (h / world.maxHeight) * 0.7);
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    for (const a of this.sim.anomalies) {
      if (!a.scanned) continue;
      ctx.fillStyle = a.documented ? '#7bd88f' : '#ffd166';
      ctx.fillRect(a.pos.x * scale - 1, a.pos.y * scale - 1, scale + 2, scale + 2);
    }
    for (const st of this.sim.structures) {
      ctx.fillStyle = '#7ab8ff';
      ctx.fillRect(st.pos.x * scale - 1, st.pos.y * scale - 1, scale + 2, scale + 2);
    }
    const r = this.sim.rover;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.pos.x * scale - 1, r.pos.y * scale - 1, scale + 2, scale + 2);
  }
}

function projXY(x: number, y: number, z: number): [number, number] {
  const p = project(x, y, z);
  return [p.sx, p.sy];
}

function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

function shadeCss2(rgb: string, f: number): string {
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return rgb;
  return `rgb(${Math.round(+m[1] * f)},${Math.round(+m[2] * f)},${Math.round(+m[3] * f)})`;
}
