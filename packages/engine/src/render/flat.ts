import { buildScene } from '../scene/build.js';
import type { Simulation } from '../sim/simulation.js';
import { Material, type Vec2 } from '../types.js';
import { MATERIALS } from '../world/materials.js';
import { Camera } from './camera.js';
import { getFlatPainter, type FlatPaintContext } from './flat-painters.js';
import type { SceneView, ViewRotation } from './view.js';

/** Base pixels per tile before camera zoom. */
export const FLAT_TILE = 12;

/**
 * Top-down 2D view of the same world the isometric renderer draws.
 *
 * Some scenes read better flat — planning a route, judging how ore veins run,
 * laying out an outpost, or any UI-heavy screen where a diorama is in the way.
 * Terrain is rasterised once per world change into an offscreen image (one
 * pixel per column, with hillshading), then blitted with smoothing off, so a
 * frame costs a single scaled `drawImage` plus the entities on top.
 */
export class FlatRenderer implements SceneView {
  readonly kind = 'flat' as const;
  readonly camera: Camera;
  rotation: ViewRotation = 0;
  /** Contour lines every N voxels; 0 disables them. */
  contourStep = 3;
  showGrid = true;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation;
  private dpr = 1;
  private cssW = 800;
  private cssH = 600;
  private terrain: HTMLCanvasElement | OffscreenCanvas | null = null;
  private terrainVersion = -1;
  private terrainRotation: ViewRotation = 0;
  private active = false;
  private fitted = false;
  private renderTime = 0;
  private lastDrawMs = 0;

  constructor(canvas: HTMLCanvasElement, sim: Simulation, camera: Camera = new Camera()) {
    this.canvas = canvas;
    this.sim = sim;
    this.camera = camera;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('takeon: could not acquire 2d context');
    this.ctx = ctx;
    this.lastDrawMs = nowMs();
  }

  // ── View plumbing ─────────────────────────────────────────────────────

  activate(): void {
    this.active = true;
    this.terrainVersion = -1;
    this.sim.world.onColumnChange = () => {
      this.terrainVersion = -1;
    };
    // Flat tiles are smaller than iso ones, so the useful zoom band differs.
    this.camera.minZoom = 0.25;
    this.camera.maxZoom = 6;
    this.camera.zoom = Math.max(this.camera.minZoom, Math.min(this.camera.maxZoom, this.camera.zoom));
  }

  deactivate(): void {
    this.active = false;
    if (this.sim.world.onColumnChange) this.sim.world.onColumnChange = null;
  }

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.max(1, Math.min(3, dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.camera.viewW = this.cssW;
    this.camera.viewH = this.cssH;
  }

  setRotation(rotation: ViewRotation): void {
    if (rotation === this.rotation) return;
    const centre = this.centreTile();
    this.rotation = rotation;
    this.terrainVersion = -1;
    this.focusTile(centre);
  }

  rotateClockwise(): void {
    this.setRotation((((this.rotation + 1) % 4) as ViewRotation));
  }

  /** World tile → view tile for the current rotation. */
  private toView(x: number, y: number): Vec2 {
    const s = this.sim.world.size - 1;
    switch (this.rotation) {
      case 0: return { x, y };
      case 1: return { x: y, y: s - x };
      case 2: return { x: s - x, y: s - y };
      default: return { x: s - y, y: x };
    }
  }

  private toWorld(u: number, v: number): Vec2 {
    const s = this.sim.world.size - 1;
    switch (this.rotation) {
      case 0: return { x: u, y: v };
      case 1: return { x: s - v, y: u };
      case 2: return { x: s - u, y: s - v };
      default: return { x: v, y: s - u };
    }
  }

  /** Pixels per tile at the current zoom. */
  private tilePx(): number {
    return FLAT_TILE * this.camera.zoom;
  }

  private viewToScreen(u: number, v: number): { x: number; y: number } {
    const t = this.tilePx();
    return {
      x: (u - this.camera.cx) * t + this.cssW / 2,
      y: (v - this.camera.cy) * t + this.cssH / 2,
    };
  }

  pickTile(canvasX: number, canvasY: number): Vec2 | null {
    const t = this.tilePx();
    const u = Math.floor((canvasX - this.cssW / 2) / t + this.camera.cx);
    const v = Math.floor((canvasY - this.cssH / 2) / t + this.camera.cy);
    const size = this.sim.world.size;
    if (u < 0 || v < 0 || u >= size || v >= size) return null;
    const w = this.toWorld(u, v);
    return this.sim.world.isSolid(w.x, w.y) ? w : null;
  }

  centreTile(): Vec2 {
    const centre = this.pickTile(this.cssW / 2, this.cssH / 2);
    if (centre) return centre;
    const clamp = (n: number) => Math.max(0, Math.min(this.sim.world.size - 1, Math.round(n)));
    return this.toWorld(clamp(this.camera.cx), clamp(this.camera.cy));
  }

  focusTile(tile: Vec2): void {
    const v = this.toView(tile.x, tile.y);
    this.camera.cx = v.x + 0.5;
    this.camera.cy = v.y + 0.5;
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  draw(): void {
    const now = nowMs();
    this.renderTime += Math.min(0.1, (now - this.lastDrawMs) / 1000);
    this.lastDrawMs = now;

    const ctx = this.ctx;
    const sim = this.sim;
    const daylight = sim.daylight();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // First frame after opening the map: frame the whole world. A top-down
    // view inherited from the diorama's zoom would otherwise open at a
    // pointless magnification.
    if (!this.fitted) {
      this.fitted = true;
      this.fitToWorld();
    }

    // Backdrop: the body's night sky, so the map still feels like *there*.
    ctx.fillStyle = mix(sim.body.palette.skyNight, '#05070f', 0.45);
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    if (this.camera.follow) {
      const r = sim.rover;
      this.focusTile({ x: Math.round(r.renderPos.x), y: Math.round(r.renderPos.y) });
    }

    this.ensureTerrain();
    const t = this.tilePx();
    const origin = this.viewToScreen(0, 0);
    if (this.terrain) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.35 + daylight * 0.65;
      ctx.drawImage(
        this.terrain as CanvasImageSource,
        origin.x,
        origin.y,
        this.sim.world.size * t,
        this.sim.world.size * t,
      );
      ctx.globalAlpha = 1;
    }

    if (this.showGrid && t >= 7) this.drawGrid(origin, t);

    // Home pin, so the landing site is always findable.
    const home = this.toView(sim.landingSite.x, sim.landingSite.y);
    const hp = this.viewToScreen(home.x + 0.5, home.y + 0.5);
    ctx.strokeStyle = 'rgba(255,200,87,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hp.x - t * 0.5, hp.y);
    ctx.lineTo(hp.x + t * 0.5, hp.y);
    ctx.moveTo(hp.x, hp.y - t * 0.5);
    ctx.lineTo(hp.x, hp.y + t * 0.5);
    ctx.stroke();

    // Scanner reach, when the rover carries one: the flat view is where you
    // plan sweeps, so the radius belongs on it.
    const rover = sim.rover;
    const rv = this.toView(rover.renderPos.x, rover.renderPos.y);
    const rp = this.viewToScreen(rv.x + 0.5, rv.y + 0.5);
    if (rover.stats.scanRadius > 0) {
      ctx.strokeStyle = 'rgba(95,227,216,0.22)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rover.stats.scanRadius * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const scene = buildScene(sim, { view: 'flat' });
    const paint: FlatPaintContext = {
      tile: t,
      daylight,
      time: this.renderTime,
      facing: 0,
    };
    for (const entity of scene.entities) {
      const painter = getFlatPainter(entity.kind);
      if (!painter) continue;
      const view = this.toView(entity.pos.x, entity.pos.y);
      const p = this.viewToScreen(view.x + 0.5, view.y + 0.5);
      if (p.x < -t * 3 || p.y < -t * 3 || p.x > this.cssW + t * 3 || p.y > this.cssH + t * 3) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      painter(ctx, entity, {
        ...paint,
        // Facings rotate with the view so "ahead" stays ahead on screen.
        facing: ((((entity.facing ?? 0) - this.rotation) % 4 + 4) % 4) as 0 | 1 | 2 | 3,
      });
      ctx.restore();
    }
  }

  /** Zoom so the whole world fits the viewport, with a little margin. */
  fitToWorld(): void {
    const span = this.sim.world.size * FLAT_TILE;
    const fit = (Math.min(this.cssW, this.cssH) * 0.94) / span;
    this.camera.zoom = Math.max(this.camera.minZoom, Math.min(this.camera.maxZoom, fit));
  }

  private drawGrid(origin: { x: number; y: number }, t: number): void {
    const ctx = this.ctx;
    const size = this.sim.world.size;
    const step = t < 12 ? 8 : 4;
    ctx.strokeStyle = 'rgba(126,224,226,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= size; i += step) {
      const x = origin.x + i * t;
      const y = origin.y + i * t;
      if (x >= -1 && x <= this.cssW + 1) {
        ctx.moveTo(x, Math.max(0, origin.y));
        ctx.lineTo(x, Math.min(this.cssH, origin.y + size * t));
      }
      if (y >= -1 && y <= this.cssH + 1) {
        ctx.moveTo(Math.max(0, origin.x), y);
        ctx.lineTo(Math.min(this.cssW, origin.x + size * t), y);
      }
    }
    ctx.stroke();
  }

  /**
   * Rasterise the heightfield once per change: material colour, lit by a
   * north-west hillshade so relief reads without any 3D, plus contour lines
   * at fixed height intervals.
   */
  private ensureTerrain(): void {
    const world = this.sim.world;
    if (this.terrain && this.terrainVersion === world.version && this.terrainRotation === this.rotation) return;

    const size = world.size;
    const buffer = new Uint8ClampedArray(size * size * 4);
    const tint = this.sim.body.palette.tint ?? [1, 1, 1];
    const maxH = Math.max(1, world.maxHeight);

    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        const w = this.toWorld(u, v);
        const h = world.height(w.x, w.y);
        const i = (v * size + u) * 4;
        if (h < 0) {
          buffer[i] = 8;
          buffer[i + 1] = 10;
          buffer[i + 2] = 20;
          buffer[i + 3] = 255;
          continue;
        }
        const material = world.surfaceMaterial(w.x, w.y);
        const [r, g, b] = hexRgb(MATERIALS[material].colors[0]);

        // Hillshade from the height gradient (light from the north-west).
        const wl = this.toWorld(u - 1, v);
        const wu = this.toWorld(u, v - 1);
        const hl = world.height(wl.x, wl.y);
        const hu = world.height(wu.x, wu.y);
        const dx = hl < 0 ? 0 : h - hl;
        const dy = hu < 0 ? 0 : h - hu;
        let light = 0.72 + (h / maxH) * 0.4 + (dx + dy) * 0.09;
        if (this.contourStep > 0 && h % this.contourStep === 0 && (dx > 0 || dy > 0)) light *= 0.86;
        light = Math.max(0.25, Math.min(1.45, light));

        buffer[i] = r * tint[0] * light;
        buffer[i + 1] = g * tint[1] * light;
        buffer[i + 2] = b * tint[2] * light;
        buffer[i + 3] = 255;
      }
    }

    const image = new ImageData(buffer, size, size);
    const target = this.makeCanvas(size, size);
    (target.getContext('2d') as CanvasRenderingContext2D).putImageData(image, 0, 0);
    this.terrain = target;
    this.terrainVersion = world.version;
    this.terrainRotation = this.rotation;
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

  // ── Shared view services ──────────────────────────────────────────────

  renderMinimap(target: HTMLCanvasElement): void {
    const world = this.sim.world;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    this.ensureTerrain();
    ctx.fillStyle = '#0b1424';
    ctx.fillRect(0, 0, target.width, target.height);
    if (this.terrain) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.terrain as CanvasImageSource, 0, 0, target.width, target.height);
    }
    const scale = Math.min(target.width, target.height) / world.size;
    const dot = (x: number, y: number, colour: string) => {
      const v = this.toView(x, y);
      ctx.fillStyle = colour;
      ctx.fillRect(v.x * scale - 1, v.y * scale - 1, scale + 2, scale + 2);
    };
    for (const a of this.sim.anomalies) {
      if (a.scanned) dot(a.pos.x, a.pos.y, a.documented ? '#7bd88f' : '#ffd166');
    }
    for (const s of this.sim.structures) dot(s.pos.x, s.pos.y, '#7ab8ff');
    dot(this.sim.rover.pos.x, this.sim.rover.pos.y, '#ffffff');
  }

  capturePhoto(): string | null {
    if (typeof document === 'undefined') return null;
    const w = 480;
    const h = 320;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const saved = {
      canvas: this.canvas,
      ctx: this.ctx,
      dpr: this.dpr,
      cssW: this.cssW,
      cssH: this.cssH,
      cx: this.camera.cx,
      cy: this.camera.cy,
      zoom: this.camera.zoom,
      follow: this.camera.follow,
    };
    try {
      this.canvas = tmp;
      this.ctx = tmp.getContext('2d')!;
      this.dpr = 1;
      this.cssW = w;
      this.cssH = h;
      this.camera.follow = false;
      this.camera.zoom = 2.2;
      this.focusTile(this.sim.rover.pos);
      this.draw();
      const c = this.ctx;
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = '10px monospace';
      c.fillText(
        `${this.sim.body.name.toUpperCase()}  T+${this.sim.time.toFixed(0)}s  [${this.sim.rover.pos.x},${this.sim.rover.pos.y}]  MAP`,
        8,
        h - 8,
      );
      return tmp.toDataURL('image/jpeg', 0.85);
    } finally {
      this.canvas = saved.canvas;
      this.ctx = saved.ctx;
      this.dpr = saved.dpr;
      this.cssW = saved.cssW;
      this.cssH = saved.cssH;
      this.camera.cx = saved.cx;
      this.camera.cy = saved.cy;
      this.camera.zoom = saved.zoom;
      this.camera.follow = saved.follow;
    }
  }
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
