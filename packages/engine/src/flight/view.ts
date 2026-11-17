import { mulberry32 } from '../util/rng.js';
import { BodyRaster, bodyTexture, parseHex, type BodyTexture, type FlightBodyLook } from './look.js';
import type { FlightDraw, FlightShape } from './sim.js';

/**
 * Paints a `FlightDraw` (laid out by the Go core, `go/flight_draw.go`) on
 * Canvas 2D. Every position, size, fade and draw order comes from Go, so the
 * web, SwiftUI and Android views of a flight are the same picture. The only
 * things painted here from their own data are the three textures the list
 * places: the starfield, the destination globe and its limb from orbit.
 *
 * The view draws the world only. Text, buttons and meters belong to the host.
 */

type Layer = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeLayer(width: number, height: number): Layer {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Half-extent of the corridor in view units at any depth (mirrors Go). */
export const CORRIDOR = { halfWidth: 3.1, halfHeight: 1.75 } as const;
/** How far ahead of the camera the craft's tail sits (mirrors Go). */
export const CRAFT_DEPTH = 5.2;

export interface FlightViewOptions {
  destination: FlightBodyLook;
  /** Seed for the sky. Defaults to the one the draw list carries. */
  skySeed?: number;
}

interface Globe {
  raster: BodyRaster;
  layer: Layer;
  radius: number;
  rotation: number;
}

const rgba = (hex: string | undefined, a: number, k = 1) => {
  const c = parseHex(hex ?? '#808080');
  return `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
};

export class FlightView {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private sky: Layer | null = null;
  private skySeed = 0;
  private texture: BodyTexture | null = null;
  private globe: Globe | null = null;
  private limb: (Globe & { centreY: number }) | null = null;

  constructor(private canvas: HTMLCanvasElement, private opts: FlightViewOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('takeon: flight view needs a 2D canvas');
    this.ctx = ctx;
    this.resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1);
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Size in CSS pixels. */
  resize(width: number, height: number, dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.max(1, Math.min(2, dpr));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.sky = null;
    this.globe = null;
    this.limb = null;
  }

  private paintSky(): Layer {
    const w = this.canvas.width, h = this.canvas.height;
    const layer = makeLayer(w, h);
    const g = layer.getContext('2d') as Ctx2D;
    const rand = mulberry32((this.opts.skySeed ?? this.skySeed) ^ 0x9e37);
    g.fillStyle = '#04060c';
    g.fillRect(0, 0, w, h);
    // Nebula: a few large soft clouds in the destination's atmosphere colour and a cold blue.
    const tint = parseHex(this.opts.destination.atmosphere ?? '#5b7fd6');
    for (let i = 0; i < 5; i++) {
      const x = rand() * w, y = rand() * h, r = (0.25 + rand() * 0.45) * Math.max(w, h);
      const c = i % 2 ? tint : [70, 96, 190];
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.05 + rand() * 0.07})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    // Stars, denser along one tilted band.
    const band = rand() * Math.PI;
    for (let i = 0; i < 520; i++) {
      let x = rand() * w, y = rand() * h;
      if (i % 3 === 0) {
        const t = rand() * 2 - 1, off = (rand() + rand() - 1) * 0.12 * h;
        x = w / 2 + Math.cos(band) * t * w * 0.7 - Math.sin(band) * off;
        y = h / 2 + Math.sin(band) * t * w * 0.7 + Math.cos(band) * off;
      }
      const m = rand();
      const size = (m > 0.97 ? 1.7 : m > 0.8 ? 1.1 : 0.7) * this.dpr;
      const warm = rand();
      g.fillStyle = `rgba(${warm > 0.8 ? 255 : 220},${warm > 0.8 ? 226 : 232},${warm < 0.2 ? 255 : 240},${0.35 + m * 0.6})`;
      g.fillRect(x, y, size, size);
    }
    // The sun, up and to the left: the same direction the globe and craft are lit from.
    const sx = w * 0.12, sy = h * 0.14, sr = Math.max(w, h) * 0.5;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sun.addColorStop(0, 'rgba(255,250,235,0.95)');
    sun.addColorStop(0.03, 'rgba(255,240,205,0.5)');
    sun.addColorStop(0.16, 'rgba(255,214,160,0.1)');
    sun.addColorStop(1, 'rgba(255,214,160,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    return layer;
  }

  private surface(): BodyTexture {
    if (!this.texture) this.texture = bodyTexture(this.opts.destination, 512, 256);
    return this.texture;
  }

  private paintGlobe(globe: Globe, rotation: number): void {
    if (Math.abs(rotation - globe.rotation) < 0.004) return;
    globe.rotation = rotation;
    const g = globe.layer.getContext('2d') as Ctx2D;
    const image = g.createImageData(globe.raster.width, globe.raster.height);
    image.data.set(globe.raster.draw(rotation));
    g.putImageData(image, 0, 0);
  }

  /** The destination ahead: a whole disc at (x, y) with on-screen radius r. */
  private drawDestination(x: number, y: number, r: number, rotation: number): void {
    const ctx = this.ctx;
    // Raster a little under screen size and let the canvas smooth it; rebuild only when it has clearly grown.
    const want = Math.min(190, Math.max(12, Math.round(r * this.dpr * 0.8)));
    if (!this.globe || want > this.globe.radius * 1.35 || want < this.globe.radius * 0.5) {
      const raster = new BodyRaster(this.surface(), this.opts.destination, { radius: want });
      this.globe = { raster, layer: makeLayer(raster.width, raster.height), radius: want, rotation: NaN };
    }
    this.paintGlobe(this.globe, rotation);
    const k = r / this.globe.radius;
    const rings = this.opts.destination.rings;
    const tilt = this.opts.destination.tilt ?? 0.3;
    const ring = (front: boolean) => {
      if (!rings) return;
      const c = parseHex(rings.color);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-tilt);
      for (let i = 0; i < 6; i++) {
        const rr = (rings.inner + ((rings.outer - rings.inner) * (i + 0.5)) / 6) * r;
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.28 + 0.3 * ((i * 7) % 3) / 2})`;
        ctx.lineWidth = Math.max(1, ((rings.outer - rings.inner) * r) / 6.5);
        ctx.beginPath();
        ctx.ellipse(0, 0, rr, rr * 0.26, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };
    ring(false);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.globe.layer as CanvasImageSource, x + this.globe.raster.originX * k, y + this.globe.raster.originY * k, this.globe.raster.width * k, this.globe.raster.height * k);
    ring(true);
  }

  /** The limb from orbit: only the part of a very large disc (centre cx, cy, radius R) that is on screen. */
  private drawLimb(cx: number, cy: number, R: number, angle: number): void {
    const w = this.width, h = this.height;
    const horizonY = cy - R;
    // Keep the raster near 70k pixels whatever the screen.
    const q = Math.min(1, Math.sqrt(70_000 / (w * Math.max(40, h - horizonY + 24))));
    if (!this.limb || this.limb.radius !== Math.round(R * q) || this.limb.centreY !== cy) {
      const radius = Math.round(R * q);
      const raster = new BodyRaster(this.surface(), { ...this.opts.destination, tilt: 0, lumpiness: Math.min(0.03, this.opts.destination.lumpiness ?? 0) }, {
        radius,
        light: [-0.45, 0.75, 0.5],
        window: { x: -Math.ceil((w / 2) * q), y: -Math.ceil(radius * 1.09), width: Math.ceil(w * q), height: Math.ceil((h - horizonY) * q + radius * 0.09) + 2 },
      });
      this.limb = { raster, layer: makeLayer(raster.width, raster.height), radius, rotation: NaN, centreY: cy };
    }
    this.paintGlobe(this.limb, angle);
    const k = R / this.limb.radius;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.limb.layer as CanvasImageSource, cx + this.limb.raster.originX * k, cy + this.limb.raster.originY * k, this.limb.raster.width * k, this.limb.raster.height * k);
  }

  private path(pts: number[], open?: boolean): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i + 1 < pts.length; i += 2) (i ? ctx.lineTo(pts[i]!, pts[i + 1]!) : ctx.moveTo(pts[i]!, pts[i + 1]!));
    if (!open) ctx.closePath();
  }

  private fillStyle(s: FlightShape): string | CanvasGradient {
    if (!s.lit) return rgba(s.fill, 1);
    const x = s.x ?? 0, y = s.y ?? 0;
    const g = this.ctx.createLinearGradient(x + s.lit[0], y + s.lit[1], x - s.lit[0], y - s.lit[1]);
    g.addColorStop(0, rgba(s.fill, 1, 1.12));
    g.addColorStop(0.45, rgba(s.fill, 1, 0.92));
    g.addColorStop(1, rgba(s.fill, 1, 0.42));
    return g;
  }

  private shape(s: FlightShape): void {
    const ctx = this.ctx;
    const x = s.x ?? 0, y = s.y ?? 0;
    ctx.globalAlpha = Math.max(0, Math.min(1, s.a ?? 0));
    switch (s.k) {
      case 'sky':
        if (!this.sky) this.sky = this.paintSky();
        ctx.drawImage(this.sky as CanvasImageSource, x, y, s.rx ?? this.width, s.ry ?? this.height);
        return;
      case 'globe':
        this.drawDestination(x, y, s.rx ?? 1, s.spin ?? 0);
        return;
      case 'limb':
        this.drawLimb(x, y, s.rx ?? 1, s.spin ?? 0);
        return;
      case 'vignette': {
        const w = this.width, h = this.height;
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
        g.addColorStop(0, rgba(s.fill, 0));
        g.addColorStop(1, rgba(s.fill, 1));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        return;
      }
      case 'glow': {
        const r = Math.max(0.5, s.rx ?? 0);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        for (const stop of s.stops ?? []) g.addColorStop(Math.max(0, Math.min(1, stop.at)), rgba(stop.c, stop.a));
        const prev = ctx.globalCompositeOperation;
        if (s.add) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = prev;
        return;
      }
      case 'line':
        ctx.strokeStyle = rgba(s.stroke, 1);
        ctx.lineWidth = s.w ?? 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(s.x2 ?? 0, s.y2 ?? 0);
        ctx.stroke();
        return;
      case 'text':
        ctx.fillStyle = rgba(s.fill, 1);
        ctx.font = `600 ${s.size ?? 14}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.text ?? '', x, y);
        return;
      case 'ellipse':
      case 'poly':
        if (s.k === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(x, y, Math.max(0.01, s.rx ?? 0), Math.max(0.01, s.ry ?? 0), s.rot ?? 0, 0, Math.PI * 2);
        } else this.path(s.pts ?? [], s.open);
        if (s.fill) { ctx.fillStyle = this.fillStyle(s); ctx.fill(); }
        if (s.stroke) { ctx.strokeStyle = rgba(s.stroke, 1); ctx.lineWidth = s.w ?? 1; ctx.stroke(); }
        return;
    }
  }

  /** Paint one frame from the Go draw list. */
  paint(draw: FlightDraw): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (draw.skySeed !== this.skySeed) { this.skySeed = draw.skySeed; this.sky = null; }
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, this.width, this.height);
    for (const s of draw.shapes) this.shape(s);
    ctx.globalAlpha = 1;
  }
}
