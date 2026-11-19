/**
 * Kit meshes: structures modelled from a few richer primitives (boxes with
 * windows, stripes and doors, frustums with bands and portholes, gable roofs,
 * beams for trusses and scaffolds, tilted panels, dishes, lights and ground
 * decals) and drawn through any projector, so they share the perspective of
 * whatever terrain they stand on.
 *
 * Pure canvas drawing: no world, no sim, no renderer. A host passes a
 * projector (view-space x, y and height z to canvas pixels) and a placement.
 */

/** View-space point (tiles along x and y, height in the terrain's z units) to canvas pixels. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number };

/** A model placed in the world: origin on the ground, heading in radians (0 = +x). */
export interface Placement {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** World tiles per model unit. */
  scale: number;
  /** Terrain z units per model unit of height, so a unit cube stays cubic on screen. */
  zPerUnit: number;
}

export type Face = '+f' | '-f' | '+s' | '-s';

export interface Windows {
  rows: number;
  cols: number;
  /** Faces that carry them. Default all four sides. */
  faces?: Face[];
  /** Band of the wall they sit in, as fractions of its height. Default 0.18..0.9. */
  from?: number;
  to?: number;
}

interface Base {
  /** Centre along heading, across, and base height (model units). */
  f: number;
  s: number;
  z: number;
}

export interface BoxPart extends Base {
  kind: 'box';
  l: number;
  w: number;
  h: number;
  color: string;
  /** Roof colour; default a lit tone of `color`. */
  top?: string;
  windows?: Windows;
  /** A coloured band round the walls. */
  stripe?: { z: number; h: number; color: string };
  /** A door at the foot of one wall. */
  door?: { face: Face; w: number; h: number; color: string };
}

export interface CylPart extends Base {
  kind: 'cyl';
  /** Bottom and top radius: equal for a drum, r1 = 0 for a cone. */
  r0: number;
  r1: number;
  h: number;
  color: string;
  top?: string;
  bands?: { z: number; h: number; color: string }[];
  /** A ring of portholes at height `z` (fraction of h). */
  ports?: { count: number; z: number; size: number };
  /** Segments round. Default 20. */
  n?: number;
}

/** A gable roof (or wedge) whose ridge runs along `axis`. */
export interface PrismPart extends Base {
  kind: 'prism';
  l: number;
  w: number;
  h: number;
  color: string;
  axis?: 'f' | 's';
}

/** A strut between two points (trusses, scaffolds, masts, cables). */
export interface BeamPart {
  kind: 'beam';
  a: [number, number, number];
  b: [number, number, number];
  /** Thickness in model units. */
  t: number;
  color: string;
}

/** A thin board tilted about the across axis (solar panels, signs). */
export interface PanelPart extends Base {
  kind: 'panel';
  l: number;
  w: number;
  /** Radians the board leans back from flat. */
  tilt: number;
  color: string;
  /** Cell grid drawn on the face. */
  grid?: [number, number];
}

/** A round dish facing along (yaw, tilt from straight up). */
export interface DishPart extends Base {
  kind: 'dish';
  r: number;
  tilt: number;
  yaw: number;
  color: string;
}

/** A small emissive lamp with a glow; blinks when `blink` (Hz) is set. */
export interface LightPart extends Base {
  kind: 'light';
  r: number;
  color: string;
  blink?: number;
  phase?: number;
}

/** Paint on the ground: a polygon, or a ring when `ring` is set. */
export interface FlatPart {
  kind: 'flat';
  z: number;
  color: string;
  pts?: [number, number][];
  ring?: { f: number; s: number; r: number; width: number };
}

export type Part = BoxPart | CylPart | PrismPart | BeamPart | PanelPart | DishPart | LightPart | FlatPart;

export interface DrawOptions {
  /** Seconds, for blinking lights. */
  time?: number;
  /** 0 by day, 1 at night: windows glow as it rises. */
  night?: number;
  /** Outline only, faintly: a blueprint of what will stand here. */
  ghost?: boolean;
  /** Cast a soft shadow away from the light. Default true (never for a ghost). */
  shadow?: boolean;
  /** Whole-model opacity. */
  alpha?: number;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Light from the upper left of the screen, slightly from above (as the terrain). */
const LIGHT = norm({ x: -0.55, y: -0.25, z: 0.8 });
const GHOST_EDGE = 'rgba(150, 232, 255, 0.75)';
const GHOST_FILL = 'rgba(150, 232, 255, 0.07)';
const GLASS_DAY = '#7fb2d6';
const GLASS_NIGHT = '#ffd68a';

function norm(v: V3): V3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function lit(n: V3): number {
  const d = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
  return 0.74 + Math.max(0, d) * 0.4;
}

/** The camera sits toward +x+y and above. */
function facesCamera(n: V3): boolean {
  return n.x + n.y > 1e-6 || n.z > 1e-6;
}

// ── Colour ──────────────────────────────────────────────────────────────

const rgbCache = new Map<string, [number, number, number]>();

export function rgbOf(color: string): [number, number, number] {
  const hit = rgbCache.get(color);
  if (hit) return hit;
  let out: [number, number, number] = [128, 128, 128];
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (m) out = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (/^#[0-9a-f]{3}$/i.test(color)) {
    out = [1, 2, 3].map((i) => parseInt(color[i] + color[i], 16)) as [number, number, number];
  }
  rgbCache.set(color, out);
  return out;
}

/** `color` brightened (f > 1) or darkened (f < 1). */
export function tone(color: string, f: number): string {
  const [r, g, b] = rgbOf(color);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Blend two colours, t = 0 → a. */
export function mix(a: string, b: string, t: number): string {
  const [r0, g0, b0] = rgbOf(a);
  const [r1, g1, b1] = rgbOf(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(r0 + (r1 - r0) * k)},${Math.round(g0 + (g1 - g0) * k)},${Math.round(b0 + (b1 - b0) * k)})`;
}

/** `mix` as #rrggbb, for callers that parse hex. */
export function mixHex(a: string, b: string, t: number): string {
  const [r, g, bl] = rgbOf(mix(a, b, t));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

// ── Frame ───────────────────────────────────────────────────────────────

function frameOf(pl: Placement) {
  const c = Math.cos(pl.heading);
  const s = Math.sin(pl.heading);
  const at = (f: number, a: number, z: number): V3 => ({
    x: pl.x + (f * c - a * s) * pl.scale,
    y: pl.y + (f * s + a * c) * pl.scale,
    z: pl.z + z * pl.scale * pl.zPerUnit,
  });
  const dir = (f: number, a: number, z: number): V3 => norm({ x: f * c - a * s, y: f * s + a * c, z });
  return { at, dir, across: { x: -s, y: c } };
}

type Frame = ReturnType<typeof frameOf>;
type Pt = { x: number; y: number };

/** Local bounds of a part: [f0, f1, s0, s1, z0, z1]. */
export function partBounds(p: Part): [number, number, number, number, number, number] {
  switch (p.kind) {
    case 'box':
    case 'prism':
      return [p.f - p.l / 2, p.f + p.l / 2, p.s - p.w / 2, p.s + p.w / 2, p.z, p.z + p.h];
    case 'cyl': {
      const r = Math.max(p.r0, p.r1);
      return [p.f - r, p.f + r, p.s - r, p.s + r, p.z, p.z + p.h];
    }
    case 'beam': {
      const t = p.t / 2;
      return [Math.min(p.a[0], p.b[0]) - t, Math.max(p.a[0], p.b[0]) + t, Math.min(p.a[1], p.b[1]) - t, Math.max(p.a[1], p.b[1]) + t, Math.min(p.a[2], p.b[2]), Math.max(p.a[2], p.b[2]) + t];
    }
    case 'panel': {
      const hl = (Math.cos(p.tilt) * p.l) / 2;
      const hz = (Math.sin(p.tilt) * p.l) / 2;
      return [p.f - hl, p.f + hl, p.s - p.w / 2, p.s + p.w / 2, p.z - hz, p.z + hz];
    }
    case 'dish':
      return [p.f - p.r, p.f + p.r, p.s - p.r, p.s + p.r, p.z - p.r * 0.5, p.z + p.r];
    case 'light':
      return [p.f - p.r, p.f + p.r, p.s - p.r, p.s + p.r, p.z - p.r, p.z + p.r];
    case 'flat': {
      if (p.ring) return [p.ring.f - p.ring.r, p.ring.f + p.ring.r, p.ring.s - p.ring.r, p.ring.s + p.ring.r, p.z, p.z];
      const fs = (p.pts ?? []).map((q) => q[0]);
      const ss = (p.pts ?? []).map((q) => q[1]);
      return [Math.min(...fs), Math.max(...fs), Math.min(...ss), Math.max(...ss), p.z, p.z];
    }
  }
}

/** Bounds of a whole model (flat paint included). */
export function modelBounds(parts: readonly Part[]): [number, number, number, number, number, number] {
  const out: [number, number, number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const p of parts) {
    const b = partBounds(p);
    out[0] = Math.min(out[0], b[0]);
    out[1] = Math.max(out[1], b[1]);
    out[2] = Math.min(out[2], b[2]);
    out[3] = Math.max(out[3], b[3]);
    out[4] = Math.min(out[4], b[4]);
    out[5] = Math.max(out[5], b[5]);
  }
  return out;
}

interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  depth: number;
}

function worldBox(fr: Frame, b: ReturnType<typeof partBounds>): WorldBox {
  const pts = [fr.at(b[0], b[2], b[4]), fr.at(b[1], b[2], b[4]), fr.at(b[0], b[3], b[4]), fr.at(b[1], b[3], b[4])];
  const zs = [fr.at(0, 0, b[4]).z, fr.at(0, 0, b[5]).z];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: zs[0], z1: zs[1], depth: 0 };
  box.depth = (box.x0 + box.x1 + box.y0 + box.y1) / 2 + (box.z0 + box.z1) * 0.0005;
  return box;
}

/** True when `a` must be painted before `b` (the camera looks from +x+y, above). */
function behind(a: WorldBox, b: WorldBox): boolean {
  const e = 1e-4;
  const ox = a.x0 < b.x1 - e && b.x0 < a.x1 - e;
  const oy = a.y0 < b.y1 - e && b.y0 < a.y1 - e;
  if (ox && oy) return a.z1 <= b.z0 + e && !(b.z1 <= a.z0 + e);
  if (a.x1 <= b.x0 + e && !(b.y1 <= a.y0 + e)) return true;
  if (a.y1 <= b.y0 + e && !(b.x1 <= a.x0 + e)) return true;
  return false;
}

/** Paint order for a model's parts: ground paint first, then a topological sort of their boxes. */
function paintOrder(fr: Frame, parts: readonly Part[]): Part[] {
  const flats = parts.filter((p) => p.kind === 'flat');
  const solids = parts.filter((p) => p.kind !== 'flat');
  const boxes = solids.map((p) => worldBox(fr, partBounds(p)));
  const n = solids.length;
  const indeg = new Array<number>(n).fill(0);
  const after: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j || !behind(boxes[i], boxes[j])) continue;
      after[i].push(j);
      indeg[j]++;
    }
  const done = new Array<boolean>(n).fill(false);
  const out: Part[] = [...flats];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || boxes[i].depth < boxes[pick].depth)) pick = i;
    // A cycle (interlocking parts): fall back to the nearest-depth part left.
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || boxes[i].depth < boxes[pick].depth)) pick = i;
    done[pick] = true;
    out.push(solids[pick]);
    for (const j of after[pick]) indeg[j]--;
  }
  return out;
}

// ── Drawing ─────────────────────────────────────────────────────────────

class Painter {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly scr: (p: V3) => Pt,
    readonly fr: Frame,
    readonly o: Required<Pick<DrawOptions, 'time' | 'night'>> & { ghost: boolean },
  ) {}

  P(f: number, a: number, z: number): Pt {
    return this.scr(this.fr.at(f, a, z));
  }

  poly(pts: Pt[], fill: string, edge?: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (this.o.ghost) {
      ctx.fillStyle = GHOST_FILL;
      ctx.fill();
      ctx.strokeStyle = GHOST_EDGE;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      return;
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }

  glass(): string {
    return mix(GLASS_DAY, GLASS_NIGHT, this.o.night);
  }

  /** A rectangle on a wall: `face` picks the wall of a box spanning f0..f1, a0..a1. */
  wallQuad(face: Face, f0: number, f1: number, a0: number, a1: number, u0: number, u1: number, z0: number, z1: number): Pt[] {
    // u runs along the wall (0..1), from its left edge as seen from outside.
    const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
    const P = (u: number, z: number) => {
      switch (face) {
        case '+f': return this.P(f1, lerp(a0, a1, u), z);
        case '-f': return this.P(f0, lerp(a1, a0, u), z);
        case '+s': return this.P(lerp(f1, f0, u), a1, z);
        case '-s': return this.P(lerp(f0, f1, u), a0, z);
      }
    };
    return [P(u0, z0), P(u1, z0), P(u1, z1), P(u0, z1)];
  }

  box(b: BoxPart): void {
    const f0 = b.f - b.l / 2, f1 = b.f + b.l / 2, a0 = b.s - b.w / 2, a1 = b.s + b.w / 2;
    const z0 = b.z, z1 = b.z + b.h;
    const P = (f: number, a: number, z: number) => this.P(f, a, z);
    const walls: { face: Face; n: V3; pts: Pt[] }[] = [
      { face: '+f', n: this.fr.dir(1, 0, 0), pts: [P(f1, a0, z0), P(f1, a1, z0), P(f1, a1, z1), P(f1, a0, z1)] },
      { face: '-f', n: this.fr.dir(-1, 0, 0), pts: [P(f0, a1, z0), P(f0, a0, z0), P(f0, a0, z1), P(f0, a1, z1)] },
      { face: '+s', n: this.fr.dir(0, 1, 0), pts: [P(f1, a1, z0), P(f0, a1, z0), P(f0, a1, z1), P(f1, a1, z1)] },
      { face: '-s', n: this.fr.dir(0, -1, 0), pts: [P(f0, a0, z0), P(f1, a0, z0), P(f1, a0, z1), P(f0, a0, z1)] },
    ];
    const edge = tone(b.color, 0.58);
    for (const w of walls) {
      if (!facesCamera(w.n)) continue;
      const k = lit(w.n) * 0.92;
      this.poly(w.pts, tone(b.color, k), edge);
      if (this.o.ghost) continue;
      const len = w.face === '+f' || w.face === '-f' ? b.w : b.l;
      if (b.stripe) {
        const sz0 = Math.max(z0, b.stripe.z), sz1 = Math.min(z1, b.stripe.z + b.stripe.h);
        if (sz1 > sz0) this.poly(this.wallQuad(w.face, f0, f1, a0, a1, 0, 1, sz0, sz1), tone(b.stripe.color, k));
      }
      if (b.windows && (b.windows.faces ?? ['+f', '-f', '+s', '-s']).includes(w.face)) {
        const { rows, cols } = b.windows;
        const zA = z0 + b.h * (b.windows.from ?? 0.18), zB = z0 + b.h * (b.windows.to ?? 0.9);
        const cellU = 1 / cols, cellZ = (zB - zA) / rows;
        const padU = Math.min(0.32, 0.05 / Math.max(0.05, len)) + cellU * 0.18;
        const glass = this.glass();
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const lightOn = this.o.night > 0.2 ? ((r * 7 + c * 3 + (b.f * 13) | 0) % 5) !== 0 : true;
            const fill = lightOn ? tone(glass, this.o.night > 0.2 ? 1 : k * 1.05) : tone(GLASS_DAY, 0.55);
            this.poly(this.wallQuad(w.face, f0, f1, a0, a1, c * cellU + padU * 0.5, (c + 1) * cellU - padU * 0.5, zA + r * cellZ + cellZ * 0.16, zA + (r + 1) * cellZ - cellZ * 0.16), fill);
          }
      }
      if (b.door && b.door.face === w.face) {
        const du = Math.min(0.9, b.door.w / Math.max(0.01, len));
        this.poly(this.wallQuad(w.face, f0, f1, a0, a1, 0.5 - du / 2, 0.5 + du / 2, z0, Math.min(z1, z0 + b.door.h)), tone(b.door.color, k), tone(b.door.color, 0.6));
      }
      // Ambient occlusion along the foot of a tall wall.
      if (b.h > 0.14 && b.z < 0.02) {
        const ctx = this.ctx;
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.22;
        this.poly(this.wallQuad(w.face, f0, f1, a0, a1, 0, 1, z0, z0 + Math.min(0.08, b.h * 0.25)), '#0b1018');
        ctx.globalAlpha = a;
      }
    }
    this.poly([P(f0, a0, z1), P(f1, a0, z1), P(f1, a1, z1), P(f0, a1, z1)], b.top ?? tone(b.color, lit({ x: 0, y: 0, z: 1 }) * 1.06), edge);
  }

  cyl(c: CylPart): void {
    const N = c.n ?? 20;
    const ring = (r: number, z: number) => {
      const pts: Pt[] = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pts.push(this.P(c.f + Math.cos(t) * r, c.s + Math.sin(t) * r, z));
      }
      return pts;
    };
    const rAt = (z: number) => c.r0 + (c.r1 - c.r0) * ((z - c.z) / Math.max(1e-6, c.h));
    const lo = ring(c.r0, c.z);
    const hi = ring(c.r1, c.z + c.h);
    const slope = (c.r0 - c.r1) / Math.max(0.01, c.h);
    const visible: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) / N) * Math.PI * 2;
      const n = this.fr.dir(Math.cos(t), Math.sin(t), slope);
      if (!facesCamera({ x: n.x, y: n.y, z: 0 })) continue;
      visible.push(i);
      const j = (i + 1) % N;
      const k = lit(n) * 0.92;
      this.poly([lo[i], lo[j], hi[j], hi[i]], tone(c.color, k), this.o.ghost ? undefined : tone(c.color, k * 0.97));
    }
    if (!this.o.ghost) {
      for (const band of c.bands ?? []) {
        const z0 = Math.max(c.z, band.z), z1 = Math.min(c.z + c.h, band.z + band.h);
        if (z1 <= z0) continue;
        const b0 = ring(rAt(z0) * 1.004, z0), b1 = ring(rAt(z1) * 1.004, z1);
        for (const i of visible) {
          const j = (i + 1) % N;
          const t = ((i + 0.5) / N) * Math.PI * 2;
          this.poly([b0[i], b0[j], b1[j], b1[i]], tone(band.color, lit(this.fr.dir(Math.cos(t), Math.sin(t), slope)) * 0.92));
        }
      }
      if (c.ports) {
        const z = c.z + c.h * c.ports.z;
        const r = rAt(z) * 1.01;
        const glass = this.glass();
        for (let k = 0; k < c.ports.count; k++) {
          const t = ((k + 0.5) / c.ports.count) * Math.PI * 2;
          const n = this.fr.dir(Math.cos(t), Math.sin(t), 0);
          if (n.x + n.y < 0.15) continue;
          const dt = c.ports.size / Math.max(0.05, r) / 2;
          const q = (tt: number, zz: number) => this.P(c.f + Math.cos(tt) * r, c.s + Math.sin(tt) * r, zz);
          const hz = c.ports.size * 0.5;
          this.poly([q(t - dt, z - hz), q(t + dt, z - hz), q(t + dt, z + hz), q(t - dt, z + hz)], glass, tone(c.color, 0.6));
        }
      }
      // Silhouette edge down the two visible sides.
      if (visible.length) {
        const ctx = this.ctx;
        ctx.strokeStyle = tone(c.color, 0.58);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (const i of [visible[0], (visible[visible.length - 1] + 1) % N]) {
          ctx.moveTo(lo[i].x, lo[i].y);
          ctx.lineTo(hi[i].x, hi[i].y);
        }
        ctx.stroke();
      }
    }
    if (c.r1 > 0.001) this.poly(hi, c.top ?? tone(c.color, lit({ x: 0, y: 0, z: 1 }) * 1.06), tone(c.color, 0.6));
  }

  prism(p: PrismPart): void {
    const alongF = (p.axis ?? 'f') === 'f';
    // Local axes: u along the ridge, v across it.
    const hl = (alongF ? p.l : p.w) / 2;
    const hw = (alongF ? p.w : p.l) / 2;
    const P = (u: number, v: number, z: number) => (alongF ? this.P(p.f + u, p.s + v, z) : this.P(p.f + v, p.s + u, z));
    const dirUV = (u: number, v: number, z: number) => (alongF ? this.fr.dir(u, v, z) : this.fr.dir(v, u, z));
    const z0 = p.z, z1 = p.z + p.h;
    const edge = tone(p.color, 0.58);
    const faces: { n: V3; pts: Pt[] }[] = [
      { n: dirUV(0, p.h, hw), pts: [P(-hl, hw, z0), P(hl, hw, z0), P(hl, 0, z1), P(-hl, 0, z1)] },
      { n: dirUV(0, -p.h, hw), pts: [P(hl, -hw, z0), P(-hl, -hw, z0), P(-hl, 0, z1), P(hl, 0, z1)] },
      { n: dirUV(1, 0, 0), pts: [P(hl, -hw, z0), P(hl, hw, z0), P(hl, 0, z1)] },
      { n: dirUV(-1, 0, 0), pts: [P(-hl, hw, z0), P(-hl, -hw, z0), P(-hl, 0, z1)] },
    ];
    for (const face of faces) if (facesCamera(face.n)) this.poly(face.pts, tone(p.color, lit(face.n) * 0.95), edge);
  }

  beam(b: BeamPart): void {
    const A = this.P(b.a[0], b.a[1], b.a[2]);
    const B = this.P(b.b[0], b.b[1], b.b[2]);
    const o = this.P(b.a[0], b.a[1], b.a[2]);
    const t = this.P(b.a[0] + b.t, b.a[1], b.a[2]);
    const wpx = Math.max(0.8, Math.hypot(t.x - o.x, t.y - o.y));
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    if (this.o.ghost) {
      ctx.strokeStyle = GHOST_EDGE;
      ctx.lineWidth = Math.max(0.7, wpx * 0.6);
    } else {
      ctx.strokeStyle = tone(b.color, 0.55);
      ctx.lineWidth = wpx + 1;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      const vertical = Math.abs(b.b[2] - b.a[2]) > Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
      ctx.strokeStyle = tone(b.color, vertical ? 1 : 1.08);
      ctx.lineWidth = wpx;
    }
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  panel(p: PanelPart): void {
    const c = Math.cos(p.tilt), s = Math.sin(p.tilt);
    const hl = p.l / 2, hw = p.w / 2;
    // Leans back toward -f: the +f edge is low.
    const corner = (u: number, v: number) => this.P(p.f + u * c, p.s + v, p.z - u * s);
    const pts = [corner(hl, -hw), corner(hl, hw), corner(-hl, hw), corner(-hl, -hw)];
    const n = this.fr.dir(s, 0, c);
    if (!facesCamera(n)) {
      this.poly(pts, tone('#8a9099', lit(n)), tone('#8a9099', 0.6));
      return;
    }
    const k = lit(n);
    this.poly(pts, tone(p.color, k), tone('#cfd5dc', 0.9));
    if (this.o.ghost || !p.grid) return;
    const ctx = this.ctx;
    ctx.strokeStyle = tone(p.color, k * 1.35);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const [gu, gv] = p.grid;
    for (let i = 1; i < gu; i++) {
      const u = -hl + (p.l * i) / gu;
      const q0 = corner(u, -hw), q1 = corner(u, hw);
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
    }
    for (let j = 1; j < gv; j++) {
      const v = -hw + (p.w * j) / gv;
      const q0 = corner(-hl, v), q1 = corner(hl, v);
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
    }
    ctx.stroke();
    // A glint across the cells.
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.18;
    this.poly([corner(hl * 0.2, -hw), corner(hl * 0.6, -hw), corner(-hl * 0.2, hw), corner(-hl * 0.6, hw)], '#ffffff');
    ctx.globalAlpha = a;
  }

  dish(d: DishPart): void {
    const n = { f: Math.cos(d.yaw) * Math.sin(d.tilt), s: Math.sin(d.yaw) * Math.sin(d.tilt), z: Math.cos(d.tilt) };
    // Two vectors spanning the dish's plane.
    const u = norm({ x: -Math.sin(d.yaw), y: Math.cos(d.yaw), z: 0 });
    const v = norm({ x: n.s * u.z - n.z * u.y, y: n.z * u.x - n.f * u.z, z: n.f * u.y - n.s * u.x });
    const N = 22;
    const ring = (r: number, lift: number) => {
      const pts: Pt[] = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pts.push(this.P(d.f + (u.x * Math.cos(t) + v.x * Math.sin(t)) * r + n.f * lift, d.s + (u.y * Math.cos(t) + v.y * Math.sin(t)) * r + n.s * lift, d.z + (u.z * Math.cos(t) + v.z * Math.sin(t)) * r + n.z * lift));
      }
      return pts;
    };
    const wn = this.fr.dir(n.f, n.s, n.z);
    const front = facesCamera(wn);
    this.poly(ring(d.r, 0), tone(d.color, front ? 1.08 : 0.8), tone(d.color, 0.6));
    if (!front || this.o.ghost) return;
    // The bowl: a shaded inner rim sunk toward the vertex.
    this.poly(ring(d.r * 0.78, -d.r * 0.12), tone(d.color, 0.86));
    this.poly(ring(d.r * 0.42, -d.r * 0.2), tone(d.color, 0.78));
    const vtx = this.P(d.f, d.s, d.z);
    const feed = this.P(d.f + n.f * d.r * 0.75, d.s + n.s * d.r * 0.75, d.z + n.z * d.r * 0.75);
    const ctx = this.ctx;
    ctx.strokeStyle = '#59606a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const k of [0, N / 3, (2 * N) / 3]) {
      const t = (k / N) * Math.PI * 2;
      const rim = this.P(d.f + (u.x * Math.cos(t) + v.x * Math.sin(t)) * d.r * 0.95, d.s + (u.y * Math.cos(t) + v.y * Math.sin(t)) * d.r * 0.95, d.z + (u.z * Math.cos(t) + v.z * Math.sin(t)) * d.r * 0.95);
      ctx.moveTo(rim.x, rim.y);
      ctx.lineTo(feed.x, feed.y);
    }
    ctx.moveTo(vtx.x, vtx.y);
    ctx.lineTo(feed.x, feed.y);
    ctx.stroke();
    ctx.fillStyle = '#e8eaed';
    ctx.beginPath();
    ctx.arc(feed.x, feed.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  light(l: LightPart): void {
    if (this.o.ghost) return;
    const on = l.blink ? Math.sin((this.o.time * l.blink + (l.phase ?? 0)) * Math.PI * 2) > 0.2 : true;
    const c = this.P(l.f, l.s, l.z);
    const e = this.P(l.f + l.r, l.s, l.z);
    const r = Math.max(1.2, Math.hypot(e.x - c.x, e.y - c.y));
    const ctx = this.ctx;
    if (on) {
      const glow = r * (3 + this.o.night * 3);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glow);
      const [R, G, B] = rgbOf(l.color);
      g.addColorStop(0, `rgba(${R},${G},${B},${0.5 + this.o.night * 0.35})`);
      g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, glow, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = on ? l.color : tone(l.color, 0.45);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(c.x - r * 0.25, c.y - r * 0.25, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  flat(p: FlatPart): void {
    const ctx = this.ctx;
    if (p.ring) {
      const N = 32;
      const pts: Pt[] = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pts.push(this.P(p.ring.f + Math.cos(t) * p.ring.r, p.ring.s + Math.sin(t) * p.ring.r, p.z));
      }
      const o = this.P(p.ring.f, p.ring.s, p.z);
      const e = this.P(p.ring.f + p.ring.width, p.ring.s, p.z);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.strokeStyle = this.o.ghost ? GHOST_EDGE : p.color;
      ctx.lineWidth = Math.max(0.8, Math.hypot(e.x - o.x, e.y - o.y));
      ctx.stroke();
      return;
    }
    if (!p.pts || p.pts.length < 3) return;
    this.poly(p.pts.map(([f, a]) => this.P(f, a, p.z)), p.color);
  }
}

/** Soft cast shadow: every part's footprint swept away from the light, filled once. */
function drawShadow(ctx: CanvasRenderingContext2D, scr: (p: V3) => Pt, fr: Frame, pl: Placement, parts: readonly Part[]): void {
  // Offset per unit of height, in model units: away from LIGHT, flattened.
  const kx = (-LIGHT.x / LIGHT.z) * 0.55;
  const ky = (-LIGHT.y / LIGHT.z) * 0.55;
  const c = Math.cos(-pl.heading), s = Math.sin(-pl.heading);
  // The offset is in view space; turn it into the model's local frame.
  const df = kx * c - ky * s;
  const da = kx * s + ky * c;
  ctx.beginPath();
  for (const p of parts) {
    if (p.kind === 'flat' || p.kind === 'light') continue;
    const b = partBounds(p);
    const shrink = p.kind === 'beam' ? 0 : 0.02;
    const corners: [number, number][] = [[b[0] + shrink, b[2] + shrink], [b[1] - shrink, b[2] + shrink], [b[1] - shrink, b[3] - shrink], [b[0] + shrink, b[3] - shrink]];
    const pts: [number, number][] = [];
    for (const zz of [b[4], b[5]]) for (const [f, a] of corners) pts.push([f + df * zz, a + da * zz]);
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const first = scr(fr.at(hull[0][0], hull[0][1], 0));
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < hull.length; i++) {
      const q = scr(fr.at(hull[i][0], hull[i][1], 0));
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
  }
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.24;
  ctx.fillStyle = '#0b1220';
  ctx.fill('nonzero');
  ctx.globalAlpha = a;
}

function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Draw a model at a placement through a projector. */
export function drawModel(ctx: CanvasRenderingContext2D, project: Projector, pl: Placement, parts: readonly Part[], opts: DrawOptions = {}): void {
  if (parts.length === 0) return;
  const fr = frameOf(pl);
  const scr = (p: V3) => project(p.x, p.y, p.z);
  const ghost = !!opts.ghost;
  ctx.save();
  ctx.lineJoin = 'round';
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  if (!ghost && opts.shadow !== false) drawShadow(ctx, scr, fr, pl, parts);
  const painter = new Painter(ctx, scr, fr, { time: opts.time ?? 0, night: opts.night ?? 0, ghost });
  for (const part of paintOrder(fr, parts)) {
    switch (part.kind) {
      case 'box': painter.box(part); break;
      case 'cyl': painter.cyl(part); break;
      case 'prism': painter.prism(part); break;
      case 'beam': painter.beam(part); break;
      case 'panel': painter.panel(part); break;
      case 'dish': painter.dish(part); break;
      case 'light': painter.light(part); break;
      case 'flat': painter.flat(part); break;
    }
  }
  ctx.restore();
}

// ── Builders (terse model authoring) ────────────────────────────────────

export const box = (f: number, s: number, z: number, l: number, w: number, h: number, color: string, extra: Partial<BoxPart> = {}): BoxPart => ({ kind: 'box', f, s, z, l, w, h, color, ...extra });
export const cyl = (f: number, s: number, z: number, r0: number, r1: number, h: number, color: string, extra: Partial<CylPart> = {}): CylPart => ({ kind: 'cyl', f, s, z, r0, r1, h, color, ...extra });
export const prism = (f: number, s: number, z: number, l: number, w: number, h: number, color: string, axis: 'f' | 's' = 'f'): PrismPart => ({ kind: 'prism', f, s, z, l, w, h, color, axis });
export const beam = (a: [number, number, number], b: [number, number, number], t: number, color: string): BeamPart => ({ kind: 'beam', a, b, t, color });
export const panel = (f: number, s: number, z: number, l: number, w: number, tilt: number, color: string, grid?: [number, number]): PanelPart => ({ kind: 'panel', f, s, z, l, w, tilt, color, grid });
export const dish = (f: number, s: number, z: number, r: number, tilt: number, yaw: number, color: string): DishPart => ({ kind: 'dish', f, s, z, r, tilt, yaw, color });
export const light = (f: number, s: number, z: number, r: number, color: string, blink?: number, phase?: number): LightPart => ({ kind: 'light', f, s, z, r, color, blink, phase });
export const flat = (pts: [number, number][], color: string, z = 0.004): FlatPart => ({ kind: 'flat', z, color, pts });
export const ring = (f: number, s: number, r: number, width: number, color: string, z = 0.004): FlatPart => ({ kind: 'flat', z, color, ring: { f, s, r, width } });

/** A dome of stacked frustums (a hemisphere when h = r). */
export function dome(f: number, s: number, z: number, r: number, h: number, color: string, stacks = 5): CylPart[] {
  const out: CylPart[] = [];
  for (let i = 0; i < stacks; i++) {
    const a0 = (i / stacks) * (Math.PI / 2);
    const a1 = ((i + 1) / stacks) * (Math.PI / 2);
    out.push(cyl(f, s, z + Math.sin(a0) * h, Math.cos(a0) * r, Math.cos(a1) * r, (Math.sin(a1) - Math.sin(a0)) * h, color));
  }
  return out;
}

/** The lower half of a sphere: stacked frustums narrowing down from `zTop`. */
export function bowl(f: number, s: number, zTop: number, r: number, h: number, color: string, stacks = 4): CylPart[] {
  const out: CylPart[] = [];
  for (let i = 0; i < stacks; i++) {
    const a0 = (1 - i / stacks) * (Math.PI / 2);
    const a1 = (1 - (i + 1) / stacks) * (Math.PI / 2);
    const z0 = zTop - Math.sin(a0) * h;
    const z1 = zTop - Math.sin(a1) * h;
    out.push(cyl(f, s, z0, Math.cos(a0) * r, Math.cos(a1) * r, z1 - z0, color));
  }
  return out;
}

/** A square lattice tower: four legs with cross bracing and a deck every `step`. */
export function truss(f: number, s: number, z: number, w: number, h: number, color: string, step = 0.3, t = 0.035): BeamPart[] {
  const out: BeamPart[] = [];
  const c: [number, number][] = [[f - w / 2, s - w / 2], [f + w / 2, s - w / 2], [f + w / 2, s + w / 2], [f - w / 2, s + w / 2]];
  for (const [cf, cs] of c) out.push(beam([cf, cs, z], [cf, cs, z + h], t, color));
  const levels = Math.max(1, Math.round(h / step));
  for (let i = 0; i < levels; i++) {
    const z0 = z + (h * i) / levels, z1 = z + (h * (i + 1)) / levels;
    for (let k = 0; k < 4; k++) {
      const [af, as] = c[k];
      const [bf, bs] = c[(k + 1) % 4];
      out.push(beam([af, as, z1], [bf, bs, z1], t * 0.7, color));
      out.push(i % 2 ? beam([af, as, z0], [bf, bs, z1], t * 0.55, color) : beam([bf, bs, z0], [af, as, z1], t * 0.55, color));
    }
  }
  return out;
}
