import { mulberry32 } from '../util/rng.js';
import { BodyRaster, bodyTexture, parseHex, type BodyTexture, type FlightBodyLook } from './look.js';
import { drawCraft, project, type FlightCamera, type FlightCraftLook, type Vec3 } from './craft.js';
import type { FlightEvent, FlightObject, FlightSite, FlightState } from './sim.js';

/**
 * The 3D flight view on Canvas 2D: a perspective corridor with depth-sorted
 * debris and pickups, a lit, turning destination globe that grows with the
 * course, and the craft as a lathe. In orbit the camera drops beside the craft
 * with the body's limb turning underneath. There is no GL dependency.
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

/** Half-extent of the corridor in view units at any depth. */
export const CORRIDOR = { halfWidth: 3.1, halfHeight: 1.75 } as const;
/** How far ahead of the camera the craft's tail sits. */
export const CRAFT_DEPTH = 5.2;

export interface FlightViewOptions {
  destination: FlightBodyLook;
  craft: FlightCraftLook;
  sites?: FlightSite[];
  /** Seed for the sky. Defaults to the destination's. */
  skySeed?: number;
}

interface Globe {
  raster: BodyRaster;
  layer: Layer;
  radius: number;
  rotation: number;
}

export class FlightView {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private sky: Layer | null = null;
  private texture: BodyTexture | null = null;
  private globe: Globe | null = null;
  private limb: (Globe & { centreY: number }) | null = null;
  private orbitMix = 0;
  private shake = 0;
  private flash = 0;
  private sparkle = 0;
  private dust: { x: number; y: number; z: number }[] = [];
  private rocks = new Map<number, { x: number; y: number }[]>();

  constructor(private canvas: HTMLCanvasElement, private opts: FlightViewOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('takeon: flight view needs a 2D canvas');
    this.ctx = ctx;
    const rand = mulberry32((opts.skySeed ?? opts.destination.seed) ^ 0x51f1);
    for (let i = 0; i < 70; i++) this.dust.push({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() });
    this.resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1);
  }

  setCraft(craft: FlightCraftLook): void {
    this.opts.craft = craft;
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

  /** Feed the events of a step so hits shake and pickups sparkle. */
  react(events: FlightEvent[]): void {
    for (const e of events) {
      if (e.kind === 'hit') { this.shake = 0.4; this.flash = 0.5; }
      if (e.kind === 'pickup' || e.kind === 'sample' || e.kind === 'site') this.sparkle = 0.45;
    }
  }

  private paintSky(): Layer {
    const w = this.canvas.width, h = this.canvas.height;
    const layer = makeLayer(w, h);
    const g = layer.getContext('2d') as Ctx2D;
    const rand = mulberry32((this.opts.skySeed ?? this.opts.destination.seed) ^ 0x9e37);
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
  private drawDestination(x: number, y: number, r: number, time: number): void {
    const ctx = this.ctx;
    // Raster a little under screen size and let the canvas smooth it; rebuild only when it has clearly grown.
    const want = Math.min(190, Math.max(12, Math.round(r * this.dpr * 0.8)));
    if (!this.globe || want > this.globe.radius * 1.35 || want < this.globe.radius * 0.5) {
      const raster = new BodyRaster(this.surface(), this.opts.destination, { radius: want });
      this.globe = { raster, layer: makeLayer(raster.width, raster.height), radius: want, rotation: NaN };
    }
    this.paintGlobe(this.globe, time * 0.05);
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

  /** The limb from orbit: only the part of a very large disc that is on screen. */
  private drawLimb(horizonY: number, angle: number): { cx: number; cy: number; R: number } {
    const w = this.width, h = this.height;
    const R = Math.max(w, h) * 0.95;
    const cx = w / 2, cy = horizonY + R;
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
    return { cx, cy, R };
  }

  private rock(o: FlightObject): { x: number; y: number }[] {
    let shape = this.rocks.get(o.id);
    if (!shape) {
      const rand = mulberry32(o.id * 2654435761);
      const n = 7 + Math.floor(rand() * 4);
      shape = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2, r = 0.7 + rand() * 0.45;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
      this.rocks.set(o.id, shape);
      if (this.rocks.size > 400) this.rocks.delete(this.rocks.keys().next().value as number);
    }
    return shape;
  }

  private drawObject(cam: FlightCamera, o: FlightObject, time: number, camX: number, camY: number): void {
    const ctx = this.ctx;
    const depth = CRAFT_DEPTH + o.z;
    if (depth < 0.6) return;
    const p = project(cam, [o.x * CORRIDOR.halfWidth - camX, o.y * CORRIDOR.halfHeight - camY, depth]);
    const r = Math.max(1, o.r * CORRIDOR.halfHeight * p.s);
    const fade = Math.max(0, Math.min(1, (245 - depth) / 60)) * (o.done ? 0.25 : 1) * Math.min(1, (depth - 0.6) / 1.5);
    if (fade <= 0 || p.x < -r || p.x > this.width + r || p.y < -r || p.y > this.height + r) return;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    if (o.kind === 'debris') {
      ctx.rotate(o.spin + time * (0.4 + (o.id % 5) * 0.15));
      const shape = this.rock(o);
      const path = () => { ctx.beginPath(); shape.forEach((v, i) => (i ? ctx.lineTo(v.x * r, v.y * r) : ctx.moveTo(v.x * r, v.y * r))); ctx.closePath(); };
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#b9b2a6');
      g.addColorStop(0.5, '#6f685f');
      g.addColorStop(1, '#27231f');
      ctx.fillStyle = g;
      path();
      ctx.fill();
      if (r > 6) {
        // A couple of pits so a rock reads as solid, not a blob.
        ctx.fillStyle = 'rgba(20,18,16,0.45)';
        for (let i = 0; i < 3; i++) {
          const v = shape[(i * 3) % shape.length]!;
          ctx.beginPath();
          ctx.ellipse(v.x * r * 0.4, v.y * r * 0.4, r * 0.16, r * 0.11, i, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (!o.done) {
      const boost = o.kind === 'boost';
      const c = boost ? [110, 220, 255] : [255, 208, 96];
      const pulse = 1 + 0.08 * Math.sin(time * 5 + o.id);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
      halo.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
      halo.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      if (boost) {
        // A ring to fly through.
        ctx.beginPath();
        ctx.ellipse(0, 0, r * pulse, r * pulse * 0.92, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(r * 0.12, -r * 0.5); ctx.lineTo(-r * 0.3, r * 0.08); ctx.lineTo(0, r * 0.08);
        ctx.lineTo(-r * 0.12, r * 0.5); ctx.lineTo(r * 0.3, -r * 0.08); ctx.lineTo(0, -r * 0.08);
        ctx.closePath();
        ctx.fill();
      } else {
        // A sample: a turning crystal.
        ctx.rotate(time * 1.4 + o.spin);
        ctx.fillStyle = 'rgba(255,224,150,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -r * pulse); ctx.lineTo(r * 0.62, 0); ctx.lineTo(0, r * pulse); ctx.lineTo(-r * 0.62, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Draw one frame. `dt` only drives the view's own easing. */
  draw(state: FlightState, dt = 1 / 60): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.orbitMix = Math.max(0, Math.min(1, this.orbitMix + (state.phase === 'orbit' ? dt : -dt) / 1.1));
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.sparkle = Math.max(0, this.sparkle - dt);

    if (!this.sky) this.sky = this.paintSky();
    // The sky is infinitely far: it only slides a few pixels as the craft is nudged.
    const slide = 10;
    ctx.drawImage(this.sky as CanvasImageSource, -slide - state.x * slide * (1 - this.orbitMix) - (this.orbitMix * state.angle * 40) % 1, -slide + state.y * slide * 0.6, w + slide * 2, h + slide * 2);

    if (this.shake > 0) ctx.translate(Math.sin(state.time * 90) * this.shake * 14, Math.cos(state.time * 77) * this.shake * 10);

    if (this.orbitMix < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - this.orbitMix;
      this.drawFlight(state);
      ctx.restore();
    }
    if (this.orbitMix > 0) {
      ctx.save();
      ctx.globalAlpha = this.orbitMix;
      this.drawOrbit(state);
      ctx.restore();
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.flash > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(255,90,70,0)');
      g.addColorStop(1, `rgba(255,90,70,${this.flash * 0.9})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawFlight(state: FlightState): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    const min = Math.min(w, h);
    // The camera rides above and behind the craft and follows most of each nudge.
    const follow = 0.45;
    const cam: FlightCamera = { cx: w / 2, cy: h * 0.3, f: Math.max(w * 0.62, Math.min(h * 0.95, w * 1.1)) };
    const camX = state.x * CORRIDOR.halfWidth * follow;
    // The chase camera rides high enough to see the hull, not just the engine, and keeps the craft in the lower third.
    const cameraHeight = Math.max(1.2, Math.min(2.6, (0.36 * h * CRAFT_DEPTH) / cam.f));
    const camY = state.y * CORRIDOR.halfHeight * follow + cameraHeight;

    // Destination: small for most of the trip, then it fills the view on approach.
    const p = state.progress;
    const grow = Math.pow(p, 2.4);
    const r = min * (0.035 + 0.5 * grow + (state.phase === 'approach' ? 0.5 * Math.pow((p - 0.86) / 0.14, 2) : 0));
    const dx = cam.cx + w * 0.1 * (1 - grow);
    const dy = cam.cy - h * 0.04 * (1 - grow) + r * 0.25 * grow;
    this.drawDestination(dx, dy, r, state.time);

    const toView = (x: number, y: number, z: number): Vec3 => [x - camX, y - camY, z];

    // Corridor frames: faint gates that rush past, so depth and speed are readable.
    const gap = 30;
    const offset = gap - (state.scroll % gap);
    ctx.lineWidth = 1;
    for (let i = 7; i >= 0; i--) {
      const z = offset + i * gap;
      const a = project(cam, toView(-CORRIDOR.halfWidth * 1.08, -CORRIDOR.halfHeight * 1.12, z));
      const b = project(cam, toView(CORRIDOR.halfWidth * 1.08, CORRIDOR.halfHeight * 1.12, z));
      const alpha = Math.min(1, z / 10) * Math.max(0, 1 - z / (gap * 8)) * 0.22;
      ctx.strokeStyle = `rgba(120,200,255,${alpha})`;
      const len = Math.min(b.x - a.x, a.y - b.y) * 0.16;
      for (const [x, y, sx, sy] of [[a.x, a.y, 1, -1], [b.x, a.y, -1, -1], [a.x, b.y, 1, 1], [b.x, b.y, -1, 1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x + sx * len, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * len);
        ctx.stroke();
      }
    }

    // Dust streaks: the nearer, the longer.
    const span = 60;
    const streak = Math.min(2.6, state.speed / 12);
    for (const d of this.dust) {
      const z = ((d.z * span - state.scroll) % span + span) % span + 0.8;
      const a = project(cam, toView(d.x * 9, d.y * 6, z));
      const b = project(cam, toView(d.x * 9, d.y * 6, z + streak));
      ctx.strokeStyle = `rgba(210,230,255,${Math.min(0.5, 2.4 / z) * Math.min(1, z / 3)})`;
      ctx.lineWidth = Math.min(1.6, 5 / z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const objects = [...state.objects].sort((a, b) => b.z - a.z);
    const drawAt = (o: FlightObject) => this.drawObject(cam, o, state.time, camX, camY);
    for (const o of objects) if (o.z > 0) drawAt(o);

    const thrust = state.phase === 'approach' ? 0.45 : state.slowed ? 0.3 : state.boosting ? 2 : 1;
    drawCraft(ctx, cam, this.opts.craft, {
      position: toView(state.x * CORRIDOR.halfWidth, state.y * CORRIDOR.halfHeight, CRAFT_DEPTH),
      axis: [state.vx * 0.22, state.vy * 0.2 + 0.06, 1],
      roll: -state.vx * 0.5,
      thrust,
      time: state.time,
    });
    if (this.sparkle > 0) {
      const c = project(cam, toView(state.x * CORRIDOR.halfWidth, state.y * CORRIDOR.halfHeight, CRAFT_DEPTH));
      const rr = (1 - this.sparkle / 0.45) * 90 + 10;
      ctx.strokeStyle = `rgba(160,235,255,${this.sparkle * 1.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y - 20, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const o of objects) if (o.z <= 0) drawAt(o);
  }

  private drawOrbit(state: FlightState): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    const horizonY = h * 0.6;
    const { cx, cy, R } = this.drawLimb(horizonY, state.angle);
    const craftY = horizonY - h * (0.2 + (state.altitude - 1) * 0.28);
    const cam: FlightCamera = { cx: w / 2, cy: craftY, f: Math.min(w, h) * 0.5 };

    // Sites on the ground ahead and behind, standing on the limb.
    for (const site of this.opts.sites ?? []) {
      let d = site.angle - state.angle;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(d) > 0.55) continue;
      const gx = cx + Math.sin(d) * R, gy = cy - Math.cos(d) * R;
      const over = state.overhead === site.id;
      const done = state.marked.includes(site.id);
      const colour = done ? '160,235,180' : over ? '255,236,170' : '120,210,255';
      if (over && !done) {
        // The instrument looks straight down; the site is marked as it passes through the beam.
        const beam = ctx.createLinearGradient(0, craftY, 0, horizonY);
        beam.addColorStop(0, 'rgba(255,236,170,0.45)');
        beam.addColorStop(1, 'rgba(255,236,170,0.04)');
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 3, craftY + 8); ctx.lineTo(w / 2 + 3, craftY + 8); ctx.lineTo(w / 2 + 44, horizonY + 6); ctx.lineTo(w / 2 - 44, horizonY + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${colour},0.9)`;
      ctx.fillStyle = `rgba(${colour},0.9)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, gy - 40); ctx.lineTo(gx + 8, gy - 32); ctx.lineTo(gx, gy - 24); ctx.lineTo(gx - 8, gy - 32);
      ctx.closePath();
      done ? ctx.fill() : ctx.stroke();
      if (site.label) {
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(site.label, gx, gy - 48);
      }
    }

    drawCraft(ctx, cam, this.opts.craft, {
      position: [-1.05, 0, 6.5],
      axis: [1, 0.04 + state.vy * 0.1, 0.16],
      thrust: 0.25,
      time: state.time,
    });
    if (this.sparkle > 0) {
      ctx.strokeStyle = `rgba(255,236,170,${this.sparkle * 1.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, craftY, (1 - this.sparkle / 0.45) * 70 + 16, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
