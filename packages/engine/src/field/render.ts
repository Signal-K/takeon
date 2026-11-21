import { hash2, mulberry32 } from '../util/rng.js';
import type { FieldDeposit, FieldTerrain } from './terrain.js';
import type { FieldTrackPoint, FieldVehicle } from './vehicle.js';

/**
 * Top-down field renderer (KES-541).
 *
 * North is always up, so the direction you push is the direction things move
 * on screen. Height reads through light, not projection: a low sun from the
 * north-west shades every slope, crater walls and boulders cast real shadows,
 * and a fine bump texture gives the ground grain. Terrain is baked in 16 m
 * chunks at the device's own pixel density and never scaled up, so it stays
 * sharp on a phone. The rover is drawn from above, so it is the right shape at
 * any heading.
 */

const CHUNK = 16;
/** Sun: from the north-west, 32° above the horizon. */
const SUN_AZ = Math.atan2(-1, -0.8);
const SUN_EL = (24 * Math.PI) / 180;
const SUN: [number, number, number] = [
  Math.cos(SUN_EL) * Math.cos(SUN_AZ),
  Math.cos(SUN_EL) * Math.sin(SUN_AZ),
  Math.sin(SUN_EL),
];
/** Shadows fall away from the sun. */
const SHADOW_DIR: [number, number] = [-Math.cos(SUN_AZ), -Math.sin(SUN_AZ)];
const SHADOW_LEN = 1 / Math.tan(SUN_EL);

const DETAIL_N = 256;
const DETAIL_PERIOD = 5.5;

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export interface FieldRenderOptions {
  /** CSS pixels per metre. 24 puts a 2.8 m rover about 67 px long. */
  scale?: number;
  /** Where the rover sits vertically, 0 top .. 1 bottom. */
  anchorY?: number;
}

export interface FieldStick { ox: number; oy: number; x: number; y: number }

export class FieldRenderer {
  scale: number;
  anchorY: number;
  /** Camera centre in metres. */
  cx: number;
  cy: number;
  /** Deposits the player has scanned. */
  readonly revealed = new Set<string>();
  /** On-screen stick to draw (CSS px), or null. */
  stick: FieldStick | null = null;

  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 390;
  private cssH = 844;
  private chunks = new Map<string, Surface>();
  private chunkPpm = 0;
  private overview: Surface | null = null;
  private shadow: Float32Array;
  private shadowN: number;
  private detail: { dx: Float32Array; dy: Float32Array; h: Float32Array };
  private hMin = 0;
  private hMax = 1;
  private tracks: FieldTrackPoint[] = [];
  private scans: { x: number; y: number; t: number }[] = [];
  private time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    readonly terrain: FieldTerrain,
    readonly vehicle: FieldVehicle | null,
    opts: FieldRenderOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('takeon field: no 2d context');
    this.ctx = ctx;
    this.scale = opts.scale ?? 20;
    this.anchorY = opts.anchorY ?? 0.5;
    this.cx = vehicle?.x ?? terrain.landing.x;
    this.cy = vehicle?.y ?? terrain.landing.y;
    this.measureHeights();
    this.shadowN = terrain.size * 2 + 1;
    this.shadow = this.buildShadows();
    this.detail = buildDetail(terrain.seed);
    if (vehicle) {
      vehicle.onTrack = p => {
        this.tracks.push(p);
        if (this.tracks.length > 2400) this.tracks.splice(0, this.tracks.length - 2400);
      };
    }
  }

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.max(1, Math.min(2, dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  /** Reveal deposits within `radius` metres of a point, with a visible pulse. */
  scan(x: number, y: number, radius = 18): FieldDeposit[] {
    this.scans.push({ x, y, t: 0 });
    const found = this.terrain.deposits.filter(d => Math.hypot(d.x - x, d.y - y) <= radius);
    // Reveal as the ring reaches each deposit, not all at once.
    for (const d of found) {
      const delay = (Math.hypot(d.x - x, d.y - y) / radius) * 1.1;
      setTimeout(() => this.revealed.add(d.id), delay * 1000);
    }
    return found;
  }

  /** CSS pixel → world metres. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.cx + (sx - this.cssW / 2) / this.scale,
      y: this.cy + (sy - this.cssH * this.anchorY) / this.scale,
    };
  }

  /** World metres → CSS pixel. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.cx) * this.scale + this.cssW / 2,
      y: (y - this.cy) * this.scale + this.cssH * this.anchorY,
    };
  }

  draw(dt: number): void {
    this.time += dt;
    const v = this.vehicle;
    if (v) {
      // Follow with a little look-ahead in the driving direction.
      const lead = Math.max(0, v.speed) * 0.6;
      const tx = v.x + Math.cos(v.heading) * lead;
      const ty = v.y + Math.sin(v.heading) * lead;
      const k = 1 - Math.exp(-dt * 4);
      this.cx += (tx - this.cx) * k;
      this.cy += (ty - this.cy) * k;
    }
    const halfW = this.cssW / 2 / this.scale;
    const top = this.cssH * this.anchorY / this.scale;
    const bottom = this.cssH * (1 - this.anchorY) / this.scale;
    this.cx = clamp(this.cx, halfW, this.terrain.size - halfW);
    this.cy = clamp(this.cy, top, this.terrain.size - bottom);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = rgb(this.terrain.style.shade);
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.drawGround(ctx);
    this.drawTracks(ctx);
    this.drawDeposits(ctx);
    this.drawScans(ctx, dt);
    if (v) this.drawRover(ctx, v);
    this.drawPointers(ctx);
    this.drawStick(ctx);
  }

  // ── Ground ────────────────────────────────────────────────────────────

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const ppm = Math.round(this.scale * this.dpr);
    if (ppm !== this.chunkPpm) {
      this.chunks.clear();
      this.chunkPpm = ppm;
    }
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.cssW, this.cssH);
    const c0 = Math.max(0, Math.floor(tl.x / CHUNK)), c1 = Math.floor(br.x / CHUNK);
    const r0 = Math.max(0, Math.floor(tl.y / CHUNK)), r1 = Math.floor(br.y / CHUNK);
    const maxC = Math.ceil(this.terrain.size / CHUNK) - 1;
    let baked = 0;
    const missing: [number, number][] = [];
    for (let r = r0; r <= Math.min(r1, maxC); r++)
      for (let c = c0; c <= Math.min(c1, maxC); c++)
        if (!this.chunks.has(`${c},${r}`)) missing.push([c, r]);
    // Bake nearest-first, a couple per frame, so the first frame is quick.
    missing.sort((a, b) => dist2(a, this.cx, this.cy) - dist2(b, this.cx, this.cy));
    for (const [c, r] of missing) {
      if (baked >= 2 && this.overview) break;
      this.chunks.set(`${c},${r}`, this.bakeChunk(c, r, ppm));
      baked++;
    }
    ctx.imageSmoothingEnabled = true;
    for (let r = r0; r <= Math.min(r1, maxC); r++)
      for (let c = c0; c <= Math.min(c1, maxC); c++) {
        const p = this.worldToScreen(c * CHUNK, r * CHUNK);
        const img = this.chunks.get(`${c},${r}`);
        const size = CHUNK * this.scale;
        if (img) ctx.drawImage(img as CanvasImageSource, p.x, p.y, size + 0.5, size + 0.5);
        else {
          const ov = this.getOverview();
          const opp = 4;
          ctx.drawImage(ov as CanvasImageSource, c * CHUNK * opp, r * CHUNK * opp, CHUNK * opp, CHUNK * opp, p.x, p.y, size + 0.5, size + 0.5);
        }
      }
    // Evict far chunks.
    if (this.chunks.size > 48) {
      for (const k of [...this.chunks.keys()]) {
        const [c, r] = k.split(',').map(Number);
        if (Math.abs(c * CHUNK - this.cx) > CHUNK * 4 || Math.abs(r * CHUNK - this.cy) > CHUNK * 5) this.chunks.delete(k);
      }
    }
  }

  private getOverview(): Surface {
    if (!this.overview) {
      const opp = 4;
      const n = this.terrain.size * opp;
      this.overview = makeSurface(n, n);
      const g = this.overview.getContext('2d') as Ctx2D;
      g.putImageData(this.shadePixels(0, 0, n, n, opp), 0, 0);
    }
    return this.overview;
  }

  private bakeChunk(c: number, r: number, ppm: number): Surface {
    const n = CHUNK * ppm;
    const surf = makeSurface(n, n);
    const g = surf.getContext('2d') as Ctx2D;
    g.putImageData(this.shadePixels(c * CHUNK, r * CHUNK, n, n, ppm), 0, 0);
    this.paintBoulders(g, c * CHUNK, r * CHUNK, ppm);
    return surf;
  }

  /** Per-pixel shading: albedo × (ambient + sun × shadow), with bump detail and grain. */
  private shadePixels(ox: number, oy: number, w: number, h: number, ppm: number): ImageData {
    const t = this.terrain;
    const st = t.style;
    const img = new ImageData(w, h);
    const px = img.data;
    const span = Math.max(0.001, this.hMax - this.hMin);
    const det = this.detail;
    const dScale = DETAIL_N / DETAIL_PERIOD;
    const bump = ppm >= 12 ? 1 : 0.35;
    const seed = t.seed;
    for (let j = 0; j < h; j++) {
      const wy = oy + (j + 0.5) / ppm;
      for (let i = 0; i < w; i++) {
        const wx = ox + (i + 0.5) / ppm;
        const hh = t.height(wx, wy);
        const [gx, gy] = t.gradient(wx, wy);
        // Detail bump: two scales of the tiling texture, the second rotated.
        const u = ((wx * dScale) | 0) & (DETAIL_N - 1);
        const v = ((wy * dScale) | 0) & (DETAIL_N - 1);
        const u2 = ((wy * dScale * 0.31 + 97) | 0) & (DETAIL_N - 1);
        const v2 = ((wx * dScale * 0.31 + 41) | 0) & (DETAIL_N - 1);
        const di = v * DETAIL_N + u, di2 = v2 * DETAIL_N + u2;
        const bx = (det.dx[di] + det.dy[di2] * 0.6) * bump;
        const by = (det.dy[di] + det.dx[di2] * 0.6) * bump;
        let nx = -(gx + bx), ny = -(gy + by), nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const diffuse = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
        const sh = this.shadowAt(wx, wy);
        const light = 0.24 + 1.2 * diffuse * sh;
        // Albedo: height ramp, regional tone, pebbles a touch brighter.
        const ht = (hh - this.hMin) / span;
        const tone = t.tone(wx, wy);
        const pebble = det.h[di] > 0.62 ? (det.h[di] - 0.62) * 1.2 : 0;
        const a = clamp(0.25 + ht * 0.45 + (tone - 0.5) * 0.7, 0, 1);
        let rr = st.low[0] + (st.high[0] - st.low[0]) * a;
        let gg = st.low[1] + (st.high[1] - st.low[1]) * a;
        let bb = st.low[2] + (st.high[2] - st.low[2]) * a;
        const br = Math.max(0, tone - 0.62) * 1.6 + pebble;
        rr += (st.bright[0] - rr) * br; gg += (st.bright[1] - gg) * br; bb += (st.bright[2] - bb) * br;
        // Grain: per-pixel, tiny, so it reads as texture not noise.
        const grain = 1 + (hash2((wx * 64) | 0, (wy * 64) | 0, seed) - 0.5) * 0.07;
        const lit = light * grain;
        const dark = Math.max(0, 1 - light) * 0.5;
        const k = (j * w + i) * 4;
        px[k] = rr * lit + st.shade[0] * dark;
        px[k + 1] = gg * lit + st.shade[1] * dark;
        px[k + 2] = bb * lit + st.shade[2] * dark;
        px[k + 3] = 255;
      }
    }
    return img;
  }

  private paintBoulders(g: Ctx2D, ox: number, oy: number, ppm: number): void {
    const t = this.terrain;
    const st = t.style;
    const list = t.bouldersNear(ox + CHUNK / 2, oy + CHUNK / 2, CHUNK * 0.75 + 3);
    // Shadows first so a boulder never darkens its neighbour's top.
    for (const b of list) {
      const x = (b.x - ox) * ppm, y = (b.y - oy) * ppm;
      const len = b.h * SHADOW_LEN * ppm;
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(SHADOW_DIR[1], SHADOW_DIR[0]));
      g.fillStyle = `rgba(${st.shade[0]},${st.shade[1]},${st.shade[2]},0.55)`;
      g.beginPath();
      g.ellipse(len * 0.5, 0, len * 0.5 + b.r * ppm * 0.9, b.r * ppm * 0.92, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (const b of list) {
      const x = (b.x - ox) * ppm, y = (b.y - oy) * ppm, r = b.r * ppm;
      const rnd = mulberry32(((b.x * 977) ^ (b.y * 131)) | 0);
      // Irregular outline: a lumpy polygon.
      const pts: [number, number][] = [];
      const sides = 9;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const rr = r * (0.78 + rnd() * 0.3);
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.92]);
      }
      const base = st.low.map((c, i) => c + (st.high[i] - c) * (0.35 + b.tone * 0.3));
      const grad = g.createLinearGradient(x + SUN[0] * r, y + SUN[1] * r, x - SUN[0] * r, y - SUN[1] * r);
      grad.addColorStop(0, rgb(base.map(c => Math.min(255, c * 1.35)) as [number, number, number]));
      grad.addColorStop(0.55, rgb(base.map(c => c * 0.85) as [number, number, number]));
      grad.addColorStop(1, rgb(base.map((c, i) => c * 0.32 + st.shade[i] * 0.4) as [number, number, number]));
      g.fillStyle = grad;
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.fill();
      // A facet line and a lit edge, so it reads as a rock not a blob.
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = Math.max(1, ppm * 0.03);
      g.beginPath();
      g.moveTo(pts[2][0], pts[2][1]);
      g.lineTo(x - SUN[0] * r * 0.1, y - SUN[1] * r * 0.1);
      g.lineTo(pts[6][0], pts[6][1]);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(pts[4][0], pts[4][1]);
      g.lineTo(pts[5][0], pts[5][1]);
      g.lineTo(pts[6][0], pts[6][1]);
      g.stroke();
    }
  }

  private measureHeights(): void {
    let lo = Infinity, hi = -Infinity;
    const t = this.terrain;
    for (let y = 0; y <= t.size; y += 2)
      for (let x = 0; x <= t.size; x += 2) {
        const h = t.height(x, y);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    this.hMin = lo;
    this.hMax = hi;
  }

  /** Terrain self-shadowing: march toward the sun; soft edge from how far under the ray we are. */
  private buildShadows(): Float32Array {
    const t = this.terrain;
    const n = this.shadowN;
    const out = new Float32Array(n * n);
    const tanEl = Math.tan(SUN_EL);
    const sx = -SHADOW_DIR[0], sy = -SHADOW_DIR[1];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = i / 2, y = j / 2;
        const h0 = t.height(x, y) + 0.05;
        let lit = 1;
        for (let d = 0.25; d < 26; d += d < 6 ? 0.25 : 0.5) {
          const px = x + sx * d, py = y + sy * d;
          if (px < 0 || py < 0 || px > t.size || py > t.size) break;
          const over = t.height(px, py) - (h0 + d * tanEl);
          if (over > 0) {
            lit = Math.min(lit, Math.max(0, 1 - over * 1.4));
            if (lit === 0) break;
          }
        }
        out[j * n + i] = lit;
      }
    return out;
  }

  private shadowAt(x: number, y: number): number {
    const n = this.shadowN;
    const gx = clamp(x * 2, 0, n - 1.001), gy = clamp(y * 2, 0, n - 1.001);
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
    const i = iy * n + ix;
    const s = this.shadow;
    return s[i] + (s[i + 1] - s[i]) * fx + (s[i + n] - s[i]) * fy + (s[i] - s[i + 1] - s[i + n] + s[i + n + 1]) * fx * fy;
  }

  // ── Overlays ──────────────────────────────────────────────────────────

  private drawTracks(ctx: CanvasRenderingContext2D): void {
    const v = this.vehicle;
    if (!v || this.tracks.length < 2) return;
    const half = v.spec.width * 0.42;
    const tread = Math.max(2, v.spec.width * 0.17 * this.scale);
    ctx.lineCap = 'round';
    ctx.lineWidth = tread;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      let prev: FieldTrackPoint | null = null;
      for (const p of this.tracks) {
        const ox = -Math.sin(p.heading) * half * side, oy = Math.cos(p.heading) * half * side;
        const s = this.worldToScreen(p.x + ox, p.y + oy);
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1.2) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
        prev = p;
      }
      ctx.strokeStyle = "rgba(0,0,0,0.11)";
      ctx.stroke();
    }
  }

  private drawDeposits(ctx: CanvasRenderingContext2D): void {
    for (const d of this.terrain.deposits) {
      if (!this.revealed.has(d.id)) continue;
      const s = this.worldToScreen(d.x, d.y);
      const r = d.r * this.scale;
      if (s.x < -r * 2 || s.y < -r * 2 || s.x > this.cssW + r * 2 || s.y > this.cssH + r * 2) continue;
      const col = depositColour(d.resource);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + d.x);
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.3);
      glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.35 + 0.15 * pulse})`);
      glow.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.3, 0, Math.PI * 2);
      ctx.fill();
      // Ore glints: fixed specks inside the patch.
      const rnd = mulberry32((d.x * 1000) | 0);
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r * 0.9;
        const gx = s.x + Math.cos(a) * rr, gy = s.y + Math.sin(a) * rr;
        const sz = 2.5 + rnd() * 4;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + 0.45 * pulse * rnd()})`;
        ctx.beginPath();
        ctx.moveTo(gx, gy - sz);
        ctx.lineTo(gx + sz * 0.7, gy);
        ctx.lineTo(gx, gy + sz);
        ctx.lineTo(gx - sz * 0.7, gy);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 6 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawScans(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const sc of this.scans) sc.t += dt;
    this.scans = this.scans.filter(s => s.t < 1.4);
    for (const sc of this.scans) {
      const s = this.worldToScreen(sc.x, sc.y);
      const k = sc.t / 1.4;
      const r = (1 - Math.pow(1 - k, 2)) * 18 * this.scale;
      ctx.strokeStyle = `rgba(150,255,190,${(1 - k) * 0.85})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(150,255,190,${(1 - k) * 0.3})`;
      ctx.lineWidth = 14;
      ctx.stroke();
    }
  }

  private drawRover(ctx: CanvasRenderingContext2D, v: FieldVehicle): void {
    const s = this.worldToScreen(v.x, v.y);
    const m = this.scale;
    const L = v.spec.length, W = v.spec.width;
    const st = this.terrain.style;
    // Tilt foreshortens the body a touch and shifts its light.
    const fl = Math.cos(v.pitch), fw = Math.cos(v.roll);
    // Cast shadow: the silhouette pushed away from the sun.
    ctx.save();
    ctx.translate(s.x + SHADOW_DIR[0] * 0.55 * m, s.y + SHADOW_DIR[1] * 0.55 * m);
    ctx.rotate(v.heading);
    ctx.fillStyle = `rgba(${st.shade[0]},${st.shade[1]},${st.shade[2]},0.5)`;
    roundRect(ctx, -L / 2 * m, -W / 2 * m, L * m, W * m, 0.3 * m);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(v.heading);
    ctx.scale(fl, fw);
    // Rocker arms.
    ctx.fillStyle = '#6d6a72';
    for (const side of [-1, 1]) ctx.fillRect(-1.15 * m, side * 0.78 * m - 0.06 * m, 2.3 * m, 0.12 * m);
    // Six wheels with treads that roll with the odometer.
    const wl = 0.62 * m, ww = 0.36 * m;
    for (const side of [-1, 1])
      for (const ax of [-1.0, 0, 1.0]) {
        const x = ax * m, y = side * 0.82 * m;
        ctx.fillStyle = '#1f1e24';
        roundRect(ctx, x - wl / 2, y - ww / 2, wl, ww, 0.08 * m);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = Math.max(1, 0.03 * m);
        const phase = ((v.odometer * 6) % 1 + 1) % 1;
        for (let k = 0; k < 5; k++) {
          const tx = x - wl / 2 + ((k + phase) / 5) * wl;
          ctx.beginPath();
          ctx.moveTo(tx, y - ww / 2 + 1);
          ctx.lineTo(tx, y + ww / 2 - 1);
          ctx.stroke();
        }
      }
    // Chassis: warm white, lit from the north-west in world space.
    const bodyL = 2.1 * m, bodyW = 1.28 * m;
    const lx = Math.cos(SUN_AZ - v.heading), ly = Math.sin(SUN_AZ - v.heading);
    const grad = ctx.createLinearGradient(lx * bodyL / 2, ly * bodyW / 2, -lx * bodyL / 2, -ly * bodyW / 2);
    grad.addColorStop(0, '#fbf7ee');
    grad.addColorStop(1, '#b9b3a8');
    ctx.fillStyle = grad;
    roundRect(ctx, -bodyL / 2, -bodyW / 2, bodyL, bodyW, 0.16 * m);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, 0.04 * m);
    ctx.stroke();
    // Solar deck over the rear two thirds.
    const deckX = -bodyL / 2 + 0.12 * m, deckW = bodyL * 0.6, deckH = bodyW - 0.24 * m;
    ctx.fillStyle = '#1d2a55';
    ctx.fillRect(deckX, -deckH / 2, deckW, deckH);
    ctx.strokeStyle = 'rgba(140,170,255,0.45)';
    ctx.lineWidth = Math.max(1, 0.025 * m);
    for (let k = 1; k < 4; k++) {
      const gx = deckX + (deckW * k) / 4;
      ctx.beginPath(); ctx.moveTo(gx, -deckH / 2); ctx.lineTo(gx, deckH / 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(deckX, 0); ctx.lineTo(deckX + deckW, 0); ctx.stroke();
    // A sun glint across the deck.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(deckX, -deckH / 2, deckW * 0.35, deckH);
    // Orange accent bumper at the front, so heading is obvious.
    ctx.fillStyle = '#f28a2e';
    roundRect(ctx, bodyL / 2 - 0.16 * m, -bodyW / 2 + 0.1 * m, 0.16 * m, bodyW - 0.2 * m, 0.05 * m);
    ctx.fill();
    // Headlights.
    ctx.fillStyle = '#fff6c8';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(bodyL / 2 - 0.05 * m, side * 0.42 * m, 0.07 * m, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mast: post with a camera head looking forward, casting its own shadow.
    const mx = bodyL / 2 - 0.55 * m, my = -0.32 * m;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(mx + 0.35 * m, my + 0.25 * m, 0.2 * m, 0.13 * m, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b3a42';
    roundRect(ctx, mx - 0.1 * m, my - 0.2 * m, 0.34 * m, 0.4 * m, 0.06 * m);
    ctx.fill();
    ctx.fillStyle = '#7fd6ff';
    ctx.fillRect(mx + 0.18 * m, my - 0.12 * m, 0.05 * m, 0.24 * m);
    // Dish.
    ctx.fillStyle = '#e9e5dc';
    ctx.beginPath();
    ctx.arc(0.15 * m, 0.34 * m, 0.2 * m, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.restore();

    if (v.blocked) {
      ctx.strokeStyle = 'rgba(242,24,70,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.9 * m, v.heading - 0.6, v.heading + 0.6);
      ctx.stroke();
    }
  }

  /** Revealed deposits off screen get a chevron on the edge pointing at them, with a distance. */
  private drawPointers(ctx: CanvasRenderingContext2D): void {
    const from = this.vehicle ?? { x: this.cx, y: this.cy };
    const pad = 34;
    const cx = this.cssW / 2, cy = this.cssH * this.anchorY;
    for (const d of this.terrain.deposits) {
      if (!this.revealed.has(d.id)) continue;
      const s = this.worldToScreen(d.x, d.y);
      if (s.x > 0 && s.y > 0 && s.x < this.cssW && s.y < this.cssH) continue;
      const dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((this.cssW / 2 - pad) / Math.abs(dx || 1e-6), (this.cssH / 2 - pad) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k, ey = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const col = depositColour(d.resource);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.fillStyle = 'rgba(10,8,20,0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.rotate(a);
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(18, -6);
      ctx.lineTo(18, 6);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'italic 600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(Math.hypot(d.x - from.x, d.y - from.y))}m`, ex, ey);
    }
  }

  private drawStick(ctx: CanvasRenderingContext2D): void {
    const st = this.stick;
    if (!st) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(st.ox, st.oy, 52, 0, Math.PI * 2);
    ctx.stroke();
    const d = Math.min(52, Math.hypot(st.x - st.ox, st.y - st.oy));
    const a = Math.atan2(st.y - st.oy, st.x - st.ox);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(st.ox + Math.cos(a) * d, st.oy + Math.sin(a) * d, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Tiling micro-relief: periodic value noise, pebbles and tiny pits, with derivatives. */
function buildDetail(seed: number): { dx: Float32Array; dy: Float32Array; h: Float32Array } {
  const N = DETAIL_N;
  const h = new Float32Array(N * N);
  const rnd = mulberry32(seed ^ 0x5eed);
  const octave = (cells: number, amp: number, s: number) => {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = hash2(i % cells, (i / cells) | 0, s);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * cells, gy = (y / N) * cells;
        const ix = gx | 0, iy = gy | 0;
        const fx = gx - ix, fy = gy - iy;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const a = lat[iy * cells + ix], b = lat[iy * cells + ((ix + 1) % cells)];
        const c = lat[((iy + 1) % cells) * cells + ix], d = lat[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
        h[y * N + x] += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
      }
  };
  octave(8, 0.5, seed + 1);
  octave(16, 0.3, seed + 2);
  octave(32, 0.18, seed + 3);
  octave(64, 0.1, seed + 4);
  // Pebbles: small raised domes.
  for (let p = 0; p < 260; p++) {
    const cx = rnd() * N, cy = rnd() * N, r = 1.5 + Math.pow(rnd(), 2) * 5;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y) / r;
        if (d >= 1) continue;
        const ix = (((cx + x) | 0) + N) % N, iy = (((cy + y) | 0) + N) % N;
        h[iy * N + ix] += Math.sqrt(1 - d * d) * 0.55;
      }
  }
  // Tiny pits.
  for (let p = 0; p < 40; p++) {
    const cx = rnd() * N, cy = rnd() * N, r = 3 + rnd() * 7;
    for (let y = -r * 1.4; y <= r * 1.4; y++)
      for (let x = -r * 1.4; x <= r * 1.4; x++) {
        const d = Math.hypot(x, y) / r;
        const ix = (((cx + x) | 0) + N) % N, iy = (((cy + y) | 0) + N) % N;
        h[iy * N + ix] += d < 1 ? (d * d - 1) * 0.35 : 0.12 * Math.exp(-(d - 1) * (d - 1) * 12);
      }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  // Slopes in "metres per metre" for a ~3 cm amplitude relief.
  const dx = new Float32Array(N * N), dy = new Float32Array(N * N);
  const amp = 0.035, texel = DETAIL_PERIOD / N;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x - 1 + N) % N)], r = h[y * N + ((x + 1) % N)];
      const u = h[((y - 1 + N) % N) * N + x], d = h[((y + 1) % N) * N + x];
      dx[y * N + x] = ((r - l) * amp) / (2 * texel);
      dy[y * N + x] = ((d - u) * amp) / (2 * texel);
    }
  return { dx, dy, h };
}

function depositColour(resource: string): [number, number, number] {
  const map: Record<string, [number, number, number]> = {
    iron: [255, 120, 80], nickel: [120, 230, 200], cobalt: [90, 150, 255], gold: [255, 210, 70],
    platinum: [230, 230, 255], ice: [150, 230, 255], carbon: [200, 255, 120], copper: [255, 150, 60],
  };
  return map[resource] ?? [150, 255, 190];
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rgb(c: readonly number[]): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function dist2([c, r]: [number, number], x: number, y: number): number {
  const dx = (c + 0.5) * CHUNK - x, dy = (r + 0.5) * CHUNK - y;
  return dx * dx + dy * dy;
}
