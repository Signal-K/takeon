import type { RoverState } from '../types.js';
import { project, shade as shadeHex } from './sprites.js';

/** `shade` for any colour the models use: #rrggbb or rgb(r,g,b). */
function shade(color: string, f: number): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return shadeHex(color, f);
  const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  return shadeHex(hex, f);
}

/**
 * Solid art: entities modelled as boxes and discs in world units and drawn
 * through the same projection as the voxel terrain, so they share its
 * perspective at any camera elevation (KES-530). The sprite rover in
 * `rover.ts` is a fixed three-quarter drawing; this one is geometry.
 */

/** Maps a projected point (base-scale) to canvas pixels: the iso camera's `toScreen`. */
export type ToScreen = (px: number, py: number) => { x: number; y: number };

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Light from the upper left of the screen (view space -x, -y), slightly from above. */
const LIGHT = norm({ x: -0.55, y: -0.25, z: 0.8 });

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Brightness factor for a face with outward normal `n`. */
function lit(n: Vec3): number {
  const d = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
  return 0.8 + Math.max(0, d) * 0.32;
}

/** The camera sits toward +x+y (nearer = larger x+y) and above. */
function facesCamera(n: Vec3): boolean {
  return n.x + n.y > 1e-6 || n.z > 1e-6;
}

/** A box in a local frame: centre along heading (`f`), across (`s`), base height `z`. */
export interface SolidBox {
  f: number;
  s: number;
  z: number;
  /** Length along heading, width across, height (z units). */
  l: number;
  w: number;
  h: number;
  color: string;
}

/** A disc standing upright, its axis across the heading (a wheel). */
export interface SolidDisc {
  f: number;
  s: number;
  z: number;
  r: number;
  /** Thickness across. */
  t: number;
  color: string;
  hub?: string;
}

/** An upright frustum (r1 = 0 is a cone; r0 = r1 a cylinder). */
export interface SolidCyl {
  f: number;
  s: number;
  z: number;
  r0: number;
  r1: number;
  h: number;
  color: string;
}

export type SolidPart = ({ kind: 'box' } & SolidBox) | ({ kind: 'disc' } & SolidDisc) | ({ kind: 'cyl' } & SolidCyl);

/** A model placed in the world: origin on the ground, heading in radians (0 = +x). */
export interface SolidPlacement {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** World units per model unit (1 = one tile). */
  scale: number;
  /** Ground z units per horizontal unit, so a model unit cube stays cubic on screen. */
  zPerUnit: number;
}

function frame(pl: SolidPlacement) {
  const c = Math.cos(pl.heading);
  const s = Math.sin(pl.heading);
  // Forward (c, s), across (-s, c): local (f, a, z) -> world.
  const at = (f: number, a: number, z: number): Vec3 => ({
    x: pl.x + (f * c - a * s) * pl.scale,
    y: pl.y + (f * s + a * c) * pl.scale,
    z: pl.z + z * pl.scale * pl.zPerUnit,
  });
  const dir = (f: number, a: number, z: number): Vec3 => norm({ x: f * c - a * s, y: f * s + a * c, z });
  return { at, dir, fwd: { x: c, y: s }, across: { x: -s, y: c } };
}

/** Painter depth of a world point: diagonal, then height. */
function depth(p: Vec3): number {
  return (p.x + p.y) * 4 + p.z * 0.01;
}

/** Draw a model; parts are depth-sorted by their centres. */
export function drawSolid(ctx: CanvasRenderingContext2D, toScreen: ToScreen, pl: SolidPlacement, model: SolidPart[]): void {
  const fr = frame(pl);
  const scr = (p: Vec3) => {
    const q = project(p.x, p.y, p.z);
    return toScreen(q.sx, q.sy);
  };
  const sorted = model
    .map((part) => {
      const h = part.kind === 'box' || part.kind === 'cyl' ? part.h / 2 : part.r;
      return { part, d: depth(fr.at(part.f, part.s, part.z + h)) };
    })
    .sort((a, b) => a.d - b.d);

  ctx.save();
  ctx.lineJoin = 'round';
  // Contact shadow: the model's footprint on the ground, nudged away from the light.
  let fMin = Infinity, fMax = -Infinity, aMin = Infinity, aMax = -Infinity;
  for (const part of model) {
    const hl = part.kind === 'box' ? part.l / 2 : part.kind === 'cyl' ? Math.max(part.r0, part.r1) : part.r;
    const hw = part.kind === 'box' ? part.w / 2 : part.kind === 'cyl' ? hl : part.t / 2;
    fMin = Math.min(fMin, part.f - hl); fMax = Math.max(fMax, part.f + hl);
    aMin = Math.min(aMin, part.s - hw); aMax = Math.max(aMax, part.s + hw);
  }
  const g = (f: number, a: number) => scr(fr.at(f, a, 0));
  ctx.globalAlpha = 0.28;
  poly(ctx, [g(fMin - 0.04, aMin - 0.04), g(fMax + 0.04, aMin - 0.04), g(fMax + 0.04, aMax + 0.04), g(fMin - 0.04, aMax + 0.04)], '#10161f');
  ctx.globalAlpha = 1;
  for (const { part } of sorted) {
    if (part.kind === 'box') drawBox(ctx, scr, fr, part);
    else if (part.kind === 'cyl') drawCyl(ctx, scr, fr, part);
    else drawDisc(ctx, scr, fr, part);
  }
  ctx.restore();
}

type Frame = ReturnType<typeof frame>;
type Scr = (p: Vec3) => { x: number; y: number };

function poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], fill: string, edge?: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
}

function drawBox(ctx: CanvasRenderingContext2D, scr: Scr, fr: Frame, b: SolidBox): void {
  const f0 = b.f - b.l / 2;
  const f1 = b.f + b.l / 2;
  const a0 = b.s - b.w / 2;
  const a1 = b.s + b.w / 2;
  const z0 = b.z;
  const z1 = b.z + b.h;
  const P = (f: number, a: number, z: number) => scr(fr.at(f, a, z));
  const faces: { n: Vec3; pts: [number, number, number][] }[] = [
    { n: fr.dir(1, 0, 0), pts: [[f1, a0, z0], [f1, a1, z0], [f1, a1, z1], [f1, a0, z1]] },
    { n: fr.dir(-1, 0, 0), pts: [[f0, a1, z0], [f0, a0, z0], [f0, a0, z1], [f0, a1, z1]] },
    { n: fr.dir(0, 1, 0), pts: [[f1, a1, z0], [f0, a1, z0], [f0, a1, z1], [f1, a1, z1]] },
    { n: fr.dir(0, -1, 0), pts: [[f0, a0, z0], [f1, a0, z0], [f1, a0, z1], [f0, a0, z1]] },
  ];
  const edge = shade(b.color, 0.6);
  for (const face of faces) {
    if (!facesCamera(face.n)) continue;
    poly(ctx, face.pts.map(([f, a, z]) => P(f, a, z)), shade(b.color, lit(face.n) * 0.9), edge);
  }
  poly(ctx, [P(f0, a0, z1), P(f1, a0, z1), P(f1, a1, z1), P(f0, a1, z1)], shade(b.color, lit({ x: 0, y: 0, z: 1 }) * 1.08), edge);
}

function drawCyl(ctx: CanvasRenderingContext2D, scr: Scr, fr: Frame, c: SolidCyl): void {
  const N = 20;
  const ring = (r: number, z: number) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push(scr(fr.at(c.f + Math.cos(t) * r, c.s + Math.sin(t) * r, z)));
    }
    return pts;
  };
  const lo = ring(c.r0, c.z);
  const hi = ring(c.r1, c.z + c.h);
  const edge = shade(c.color, 0.6);
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * Math.PI * 2;
    const n = fr.dir(Math.cos(t), Math.sin(t), (c.r0 - c.r1) / Math.max(0.01, c.h));
    if (!facesCamera({ x: n.x, y: n.y, z: 0 })) continue;
    const j = (i + 1) % N;
    poly(ctx, [lo[i], lo[j], hi[j], hi[i]], shade(c.color, lit(n) * 0.9));
  }
  if (c.r1 > 0.001) poly(ctx, hi, shade(c.color, lit({ x: 0, y: 0, z: 1 }) * 1.08), edge);
}

function drawDisc(ctx: CanvasRenderingContext2D, scr: Scr, fr: Frame, d: SolidDisc): void {
  const N = 18;
  const ring = (a: number) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push(scr(fr.at(d.f + Math.cos(t) * d.r, a, d.z + d.r + Math.sin(t) * d.r)));
    }
    return pts;
  };
  // The face turned toward the camera is drawn last.
  const across = fr.across;
  const outer = across.x + across.y >= 0 ? 1 : -1;
  const far = ring(d.s - (outer * d.t) / 2);
  const near = ring(d.s + (outer * d.t) / 2);
  const tread = shade(d.color, 0.7);
  poly(ctx, far, tread);
  // Tread band between the two rims.
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    poly(ctx, [far[i], far[j], near[j], near[i]], tread);
  }
  poly(ctx, near, d.color, shade(d.color, 0.5));
  if (d.hub) {
    const c = scr(fr.at(d.f, d.s + (outer * d.t) / 2, d.z + d.r));
    const hub = ring(d.s + (outer * d.t) / 2).map((p) => ({ x: c.x + (p.x - c.x) * 0.38, y: c.y + (p.y - c.y) * 0.38 }));
    poly(ctx, hub, d.hub);
  }
}

/**
 * The stock rover as a model, one tile long: a low chassis on six wheels, a
 * flat solar deck and a camera mast at the front. Parts follow the build.
 */
export function roverModel(rover: RoverState): SolidPart[] {
  const body = rover.spec.color || '#c8d6e5';
  const s = rover.stats;
  const parts: SolidPart[] = [];
  const wheel = '#2a2a33';
  for (const f of [-0.32, 0, 0.32]) {
    for (const side of [-1, 1]) parts.push({ kind: 'disc', f, s: side * 0.31, z: 0, r: 0.115, t: 0.1, color: wheel, hub: '#9aa0ab' });
  }
  // Chassis tub, then a slightly narrower deck.
  parts.push({ kind: 'box', f: 0, s: 0, z: 0.14, l: 0.84, w: 0.48, h: 0.16, color: shade(body, 0.86) });
  parts.push({ kind: 'box', f: -0.04, s: 0, z: 0.3, l: 0.76, w: 0.44, h: 0.1, color: body });
  if (s.solarRate > 0) {
    // Two panels with a seam between them, so the deck still shows.
    for (const a of [-0.13, 0.13]) parts.push({ kind: 'box', f: -0.1, s: a, z: 0.4, l: 0.46, w: 0.24, h: 0.02, color: '#3d6fb8' });
  }
  if (s.cargoCapacity > 0) parts.push({ kind: 'box', f: 0.2, s: -0.1, z: 0.4, l: 0.14, w: 0.16, h: 0.08, color: '#b59a62' });
  // Mast and camera head at the front.
  parts.push({ kind: 'box', f: 0.28, s: 0.12, z: 0.4, l: 0.05, w: 0.05, h: 0.32, color: '#b8bec8' });
  parts.push({ kind: 'box', f: 0.29, s: 0.12, z: 0.72, l: 0.1, w: 0.16, h: 0.08, color: '#e9edf2' });
  return parts;
}

type Parts = SolidPart[];
const box = (f: number, a: number, z: number, l: number, w: number, h: number, color: string): SolidPart => ({ kind: 'box', f, s: a, z, l, w, h, color });
const cyl = (f: number, a: number, z: number, r0: number, r1: number, h: number, color: string): SolidPart => ({ kind: 'cyl', f, s: a, z, r0, r1, h, color });

/** Built structures as models, one tile each; `null` falls back to the sprite. */
export function structureModel(type: string, progress = 1, rocket = true): Parts | null {
  switch (type) {
    case 'solar-array':
      return [box(0, 0, 0, 0.08, 0.08, 0.5, '#8b929b'), box(0, 0, 0.5, 0.62, 0.86, 0.03, '#3d6fb8')];
    case 'beacon':
      return [box(0, 0, 0, 0.3, 0.3, 0.08, '#6b7079'), box(0, 0, 0.08, 0.06, 0.06, 0.9, '#c4cad3'), cyl(0, 0, 0.98, 0.07, 0.07, 0.07, '#e5533d')];
    case 'drill-rig':
      return [
        box(0, 0, 0, 0.6, 0.6, 0.06, '#5b5f66'),
        box(-0.18, -0.18, 0.06, 0.05, 0.05, 0.8, '#d39a2e'),
        box(0.18, -0.18, 0.06, 0.05, 0.05, 0.8, '#d39a2e'),
        box(-0.18, 0.18, 0.06, 0.05, 0.05, 0.8, '#d39a2e'),
        box(0.18, 0.18, 0.06, 0.05, 0.05, 0.8, '#d39a2e'),
        box(0, 0, 0.82, 0.44, 0.44, 0.06, '#e2ad3a'),
        box(0, 0, 0.06, 0.08, 0.08, 0.7, '#7f8791'),
      ];
    case 'cache':
      return [box(0, 0, 0, 0.5, 0.36, 0.26, '#b59a62'), box(0, 0, 0.26, 0.52, 0.38, 0.04, '#8d7748')];
    case 'refinery':
      return [box(0, 0, 0, 0.7, 0.5, 0.34, '#9aa3ad'), cyl(0.18, 0, 0.34, 0.1, 0.1, 0.4, '#7c858f'), cyl(-0.18, 0.1, 0.34, 0.08, 0.08, 0.26, '#7c858f')];
    case 'generator':
      return [box(0, 0, 0, 0.5, 0.5, 0.3, '#6e7682'), cyl(0, 0, 0.3, 0.14, 0.1, 0.16, '#e8b84a')];
    case 'pylon':
      return [box(0, 0, 0, 0.06, 0.06, 0.8, '#9aa0ab'), box(0, 0, 0.8, 0.06, 0.44, 0.04, '#9aa0ab')];
    case 'habitat':
      return [
        cyl(0, 0, 0, 0.36, 0.36, 0.22, '#e3e8ee'),
        cyl(0, 0, 0.22, 0.36, 0.28, 0.12, '#eef2f6'),
        cyl(0, 0, 0.34, 0.28, 0.14, 0.1, '#f6f8fa'),
        cyl(0, 0, 0.44, 0.14, 0, 0.04, '#f6f8fa'),
        box(0.34, 0, 0, 0.14, 0.16, 0.18, '#9fb7c9'),
      ];
    case 'habitat-frame': {
      const p = Math.max(0, Math.min(1, progress));
      const parts: Parts = [box(0, 0, 0, 0.8, 0.8, 0.05, '#5b5f66')];
      for (const [f, a] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) parts.push(box(f, a, 0.05, 0.05, 0.05, 0.5 * p, '#c4cad3'));
      if (p > 0.15) parts.push(cyl(0, 0, 0.05, 0.36, 0.36, 0.22 * p, '#d5dbe2'));
      return parts;
    }
    case 'launch-pad': {
      const parts: Parts = [box(0, 0, 0, 0.9, 0.9, 0.08, '#5b5f66'), box(0, 0, 0.08, 0.6, 0.6, 0.02, '#3f434a')];
      // Gantry tower on the back corner.
      parts.push(box(-0.3, -0.3, 0.08, 0.1, 0.1, 1.2, '#8a929b'));
      if (rocket) {
        for (const [f, a] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) parts.push(box(f, a, 0.1, f ? 0.1 : 0.03, a ? 0.1 : 0.03, 0.2, '#c1442e'));
        parts.push(cyl(0, 0, 0.1, 0.14, 0.14, 0.86, '#f2f5f8'));
        parts.push(cyl(0, 0, 0.96, 0.14, 0, 0.3, '#c1442e'));
        parts.push(box(-0.15, -0.15, 0.7, 0.2, 0.04, 0.04, '#8a929b'));
      }
      return parts;
    }
    default:
      return null;
  }
}
