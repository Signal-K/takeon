import { Material, type Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { DIRS } from '../sim/simulation.js';
import { Camera } from './camera.js';
import { drawAnomaly, drawRover, drawStructure } from './entities.js';
import { project, SpriteCache, TILE_H, TILE_W, TILE_Z } from './sprites.js';
import { MATERIALS } from '../world/materials.js';
import { hash2 } from '../util/rng.js';

const CHUNK = 16;

interface Chunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Projected-space position of the canvas's top-left corner. */
  originX: number;
  originY: number;
  dirty: boolean;
}

export type ViewRotation = 0 | 1 | 2 | 3;

/**
 * Isometric voxel renderer over Canvas 2D.
 *
 * Terrain is composited from cached per-chunk canvases (rebuilt only when
 * voxels change), so per-frame cost is a handful of drawImage calls plus
 * dynamic entities — fast enough for mid-range phones.
 *
 * The camera can be rotated in 90° steps: the renderer draws a rotated
 * *view* of the world (world coordinates relabelled), so the sim never
 * knows the difference.
 */
export class IsoRenderer {
  readonly camera = new Camera();
  rotation: ViewRotation = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation;
  private sprites = new SpriteCache();
  private chunks: Chunk[] = [];
  private chunksPerSide: number;
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private dpr = 1;

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
  }

  // ── View rotation ─────────────────────────────────────────────────────

  /** World → rotated view coordinates (works for floats). */
  toView(x: number, y: number): Vec2 {
    const s = this.sim.world.size - 1;
    switch (this.rotation) {
      case 0: return { x, y };
      case 1: return { x: y, y: s - x };
      case 2: return { x: s - x, y: s - y };
      case 3: return { x: s - y, y: x };
    }
  }

  /** Rotated view → world coordinates. */
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

  /** Rotate the view by 90° steps; keeps the rover centred. */
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

  // ── Setup ─────────────────────────────────────────────────────────────

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.camera.viewW = cssW;
    this.camera.viewH = cssH;
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
        // Projected-space bounding box of every voxel in this chunk.
        const left = project(x0, y1, 0).sx - TILE_W / 2;
        const right = project(x1, y0, 0).sx + TILE_W / 2;
        const top = project(x0, y0, world.maxHeight).sy - TILE_H / 2;
        const bottom = project(x1, y1, 0).sy + TILE_H / 2 + TILE_Z;
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
    const cx = Math.floor(u / CHUNK);
    const cy = Math.floor(v / CHUNK);
    // Exposure of view-space neighbours can change near chunk borders.
    const marks = [
      [cx, cy],
      [u % CHUNK === 0 ? cx - 1 : cx, cy],
      [cx, v % CHUNK === 0 ? cy - 1 : cy],
    ];
    for (const [mx, my] of marks) {
      if (mx < 0 || my < 0) continue;
      const chunk = this.chunks[my * this.chunksPerSide + mx];
      if (chunk) chunk.dirty = true;
    }
  }

  private rebuildChunk(chunk: Chunk): void {
    const world = this.sim.world;
    const ctx = chunk.canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
    const u0 = chunk.cx * CHUNK;
    const v0 = chunk.cy * CHUNK;
    const uN = Math.min(CHUNK, world.size - u0);
    const vN = Math.min(CHUNK, world.size - v0);

    // Painter order: diagonal rows (u+v ascending), columns bottom-to-top.
    for (let s = 0; s <= uN + vN - 2; s++) {
      for (let lu = Math.max(0, s - vN + 1); lu <= Math.min(s, uN - 1); lu++) {
        const lv = s - lu;
        const u = u0 + lu;
        const v = v0 + lv;
        const h = this.heightV(u, v);
        if (h < 0) continue;
        const w = this.toWorld(u, v);
        const hRight = this.heightV(u + 1, v); // -1 outside => exposed
        const hLeft = this.heightV(u, v + 1);
        for (let z = 0; z <= h; z++) {
          const visible = z === h || z > hRight || z > hLeft;
          if (!visible) continue;
          const m = world.get(w.x, w.y, z);
          if (m === Material.Air) continue;
          const p = project(u, v, z);
          ctx.drawImage(
            this.sprites.tile(m, w.x, w.y, z) as CanvasImageSource,
            Math.round(p.sx - TILE_W / 2 - chunk.originX),
            Math.round(p.sy - TILE_H / 2 - chunk.originY),
          );
        }
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
    ctx.imageSmoothingEnabled = false;

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

    // Camera follow (in view space).
    const rover = sim.rover;
    const rz = this.roverZ();
    const rv = this.toView(rover.renderPos.x, rover.renderPos.y);
    if (camera.follow) {
      const p = project(rv.x, rv.y, rz);
      camera.cx += (p.sx - camera.cx) * 0.15;
      camera.cy += (p.sy - camera.cy) * 0.15;
    }

    // Terrain chunks in painter order (chunk diagonal ascending).
    const sorted = [...this.chunks].sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
    for (const chunk of sorted) {
      if (chunk.dirty) this.rebuildChunk(chunk);
      const s = camera.toScreen(chunk.originX, chunk.originY);
      const w = chunk.canvas.width * camera.zoom;
      const h = chunk.canvas.height * camera.zoom;
      if (s.x > camera.viewW || s.y > camera.viewH || s.x + w < 0 || s.y + h < 0) continue;
      ctx.drawImage(chunk.canvas as CanvasImageSource, s.x, s.y, w, h);
    }

    // Facing-tile highlight.
    const d = DIRS[rover.facing];
    const fx = rover.pos.x + d.x;
    const fy = rover.pos.y + d.y;
    if (world.isSolid(fx, fy)) {
      const fv = this.toView(fx, fy);
      this.strokeTileDiamond(fv.x, fv.y, world.height(fx, fy), 'rgba(255,255,255,0.35)');
    }
    if (rover.mining) {
      const m = rover.mining;
      const mv = this.toView(m.pos.x, m.pos.y);
      const pulse = 0.35 + (Math.sin(sim.time * 10) + 1) * 0.2;
      this.strokeTileDiamond(mv.x, mv.y, world.height(m.pos.x, m.pos.y), `rgba(255,179,71,${pulse})`);
    }

    // Entities in view-space diagonal order.
    type Ent = { s: number; draw: () => void };
    const ents: Ent[] = [];
    for (const a of sim.anomalies) {
      const az = world.height(a.pos.x, a.pos.y);
      if (az < 0) continue;
      const av = this.toView(a.pos.x, a.pos.y);
      const p = camera.toScreen(...projXY(av.x, av.y, az + 1));
      ents.push({
        s: av.x + av.y,
        draw: () => drawAnomaly(ctx, p.x, p.y, camera.zoom, a, sim.time),
      });
    }
    for (const st of sim.structures) {
      const sz = world.height(st.pos.x, st.pos.y);
      const sv = this.toView(st.pos.x, st.pos.y);
      const p = camera.toScreen(...projXY(sv.x, sv.y, sz + 1));
      ents.push({
        s: sv.x + sv.y,
        draw: () => drawStructure(ctx, p.x, p.y, camera.zoom, st, sim.time, daylight),
      });
    }
    {
      const p = camera.toScreen(...projXY(rv.x, rv.y, rz + 1));
      // Facing on screen = world facing minus view rotation.
      const screenFacing = (((rover.facing - this.rotation) % 4) + 4) % 4;
      ents.push({
        s: rv.x + rv.y,
        draw: () => drawRover(ctx, p.x, p.y, camera.zoom, rover, daylight, screenFacing as 0 | 1 | 2 | 3),
      });
    }
    ents.sort((a, b) => a.s - b.s);
    for (const e of ents) e.draw();

    // Re-draw terrain columns that should occlude nearby entities.
    this.redrawOccluders(rv, rz);

    // Night tint.
    if (daylight < 1) {
      ctx.fillStyle = `rgba(10,8,30,${(1 - daylight) * 0.45})`;
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
  }

  private roverZ(): number {
    const r = this.sim.rover;
    const world = this.sim.world;
    if (r.moveFrom) {
      const z0 = world.height(r.moveFrom.x, r.moveFrom.y);
      const z1 = world.height(r.pos.x, r.pos.y);
      return z0 + (z1 - z0) * r.moveT;
    }
    return world.height(r.pos.x, r.pos.y);
  }

  /**
   * View-space columns "in front of" (greater diagonal than) an entity can
   * occlude it. Chunk canvases were already stamped below entities, so
   * re-stamp just those columns above everything. Cheap: a few dozen blits.
   */
  private redrawOccluders(posV: Vec2, z: number): void {
    const world = this.sim.world;
    const { ctx, camera } = this;
    const eu = Math.round(posV.x);
    const ev = Math.round(posV.y);
    const s0 = eu + ev;
    const R = 7;
    for (let s = s0 + 1; s <= s0 + R; s++) {
      for (let u = eu - R; u <= eu + R; u++) {
        const v = s - u;
        if (Math.abs(v - ev) > R) continue;
        const h = this.heightV(u, v);
        if (h <= z) continue; // cannot occlude
        const w = this.toWorld(u, v);
        const hRight = this.heightV(u + 1, v);
        const hLeft = this.heightV(u, v + 1);
        for (let zz = Math.max(0, Math.floor(z)); zz <= h; zz++) {
          const visible = zz === h || zz > hRight || zz > hLeft;
          if (!visible) continue;
          const m = world.get(w.x, w.y, zz);
          if (m === Material.Air) continue;
          const p = project(u, v, zz);
          const sc = camera.toScreen(p.sx - TILE_W / 2, p.sy - TILE_H / 2);
          ctx.drawImage(
            this.sprites.tile(m, w.x, w.y, zz) as CanvasImageSource,
            sc.x,
            sc.y,
            TILE_W * camera.zoom,
            (TILE_H + TILE_Z) * camera.zoom,
          );
        }
      }
    }
  }

  private strokeTileDiamond(u: number, v: number, z: number, style: string): void {
    const { ctx, camera } = this;
    const p = project(u, v, z);
    const c = camera.toScreen(p.sx, p.sy);
    const hw = (TILE_W / 2) * camera.zoom;
    const hh = (TILE_H / 2) * camera.zoom;
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(1, camera.zoom);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - hh);
    ctx.lineTo(c.x + hw, c.y);
    ctx.lineTo(c.x, c.y + hh);
    ctx.lineTo(c.x - hw, c.y);
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * World tile under a canvas-space point (top surfaces considered,
   * front-most wins). Returns world coordinates.
   */
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
      // Vignette + telemetry strip for that mission-photo feel.
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
        const base = MATERIALS[m].colors[0];
        ctx.fillStyle = shadeCss(base, 0.5 + (h / world.maxHeight) * 0.7);
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

function shadeCss(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Darken an rgb(...) css string by factor f. */
function shadeCss2(rgb: string, f: number): string {
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return rgb;
  return `rgb(${Math.round(+m[1] * f)},${Math.round(+m[2] * f)},${Math.round(+m[3] * f)})`;
}
