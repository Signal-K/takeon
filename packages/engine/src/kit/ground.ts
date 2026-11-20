import { beam, box, cyl, light, tone, type Part } from './mesh.js';
import { ASPHALT_COLOR } from './assets.js';

/** Things that live on the ground of a site: roads, debris, machines and their dust. */

type Pt = { x: number; y: number };

function partial(pts: readonly Pt[], t: number): Pt[] {
  if (pts.length < 2 || t >= 1) return [...pts];
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lens.push(l);
    total += l;
  }
  let left = total * Math.max(0, t);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const l = lens[i - 1];
    if (left >= l) {
      out.push(pts[i]);
      left -= l;
      continue;
    }
    const k = l > 0 ? left / l : 0;
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k });
    break;
  }
  return out;
}

function stroke(ctx: CanvasRenderingContext2D, pts: readonly Pt[], color: string, width: number, dash?: number[]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
}

/**
 * A road through projected tile centres, laid `progress` (0..1) of the way:
 * graded dirt runs a little ahead of the paving, which carries edge lines
 * and a dashed centre line. `width` is the paved width in pixels.
 */
export function drawRoad(ctx: CanvasRenderingContext2D, pts: readonly Pt[], progress: number, width: number, night = 0): void {
  if (pts.length < 2 || progress <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const graded = partial(pts, Math.min(1, progress * 1.15 + 0.05));
  const paved = partial(pts, progress);
  stroke(ctx, graded, 'rgba(58, 48, 38, 0.28)', width * 1.55);
  stroke(ctx, graded, 'rgba(150, 132, 108, 0.55)', width * 1.2);
  stroke(ctx, paved, tone(ASPHALT_COLOR, 0.8), width * 1.08);
  stroke(ctx, paved, ASPHALT_COLOR, width);
  stroke(ctx, paved, 'rgba(232, 234, 236, 0.55)', Math.max(0.6, width * 0.72));
  stroke(ctx, paved, ASPHALT_COLOR, Math.max(0.6, width * 0.64));
  const dash = Math.max(2, width * 0.5);
  stroke(ctx, paved, night > 0.3 ? 'rgba(255, 214, 120, 0.95)' : 'rgba(240, 200, 90, 0.9)', Math.max(0.6, width * 0.06), [dash, dash * 0.9]);
  ctx.restore();
}

/** A puff of dust behind a working machine. */
export function drawDust(ctx: CanvasRenderingContext2D, at: Pt, size: number, time: number, seed = 0): void {
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const age = (time * 0.9 + i / 5 + seed * 0.13) % 1;
    const r = size * (0.25 + age * 0.75);
    const a = 0.32 * (1 - age);
    const ox = Math.sin(i * 2.1 + seed) * size * 0.6 * age;
    const oy = -size * 0.5 * age;
    ctx.fillStyle = `rgba(196, 180, 150, ${a})`;
    ctx.beginPath();
    ctx.arc(at.x + ox, at.y + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A tracked bulldozer, blade forward (+f). */
export function dozerParts(time = 0): Part[] {
  const bob = Math.sin(time * 14) * 0.004;
  return [
    box(-0.02, -0.15, 0, 0.5, 0.08, 0.09, '#2c2f34'),
    box(-0.02, 0.15, 0, 0.5, 0.08, 0.09, '#2c2f34'),
    box(-0.04, 0, 0.07 + bob, 0.42, 0.26, 0.12, '#f0b429'),
    box(-0.14, 0, 0.19 + bob, 0.2, 0.22, 0.14, '#f0b429', { windows: { rows: 1, cols: 1, from: 0.2, to: 0.85 }, top: '#e2a51e' }),
    box(0.06, 0.07, 0.19 + bob, 0.05, 0.04, 0.08, '#3a3d42'),
    box(0.28, 0, 0.02, 0.05, 0.42, 0.13, '#d49a1c'),
    light(-0.14, 0, 0.35, 0.018, '#ffb347', 1.4),
  ];
}

/** A road paver with a roller drum. */
export function paverParts(time = 0): Part[] {
  const bob = Math.sin(time * 10) * 0.003;
  return [
    cyl(0.2, 0, 0, 0.07, 0.07, 0.04, '#3a3d42'),
    box(0.2, 0, 0.0, 0.14, 0.34, 0.12, '#5b6068'),
    box(-0.08, 0, 0.03 + bob, 0.4, 0.3, 0.12, '#e8692e'),
    box(-0.16, 0, 0.15 + bob, 0.16, 0.2, 0.14, '#e8692e', { windows: { rows: 1, cols: 1, from: 0.25, to: 0.85 } }),
    box(-0.28, -0.12, 0, 0.12, 0.06, 0.08, '#2c2f34'),
    box(-0.28, 0.12, 0, 0.12, 0.06, 0.08, '#2c2f34'),
    light(-0.16, 0, 0.31, 0.018, '#ffb347', 1.4, 0.3),
  ];
}

/** A supply crate: planks with a darker band, its id stencil a stripe. */
export function crateParts(seed = 0): Part[] {
  const wood = ['#b98a52', '#a97c48', '#c49662'][seed % 3];
  return [
    box(0, 0, 0, 0.18, 0.18, 0.17, wood, { stripe: { z: 0.07, h: 0.03, color: tone(wood, 0.72) }, top: tone(wood, 1.12) }),
    box(0, 0, 0.17, 0.12, 0.02, 0.004, tone(wood, 0.7)),
  ];
}

/** A fuel drum with two rolling hoops. */
export function drumParts(seed = 0): Part[] {
  const paint = ['#3f7cc4', '#d8432f', '#e9b93a'][seed % 3];
  return [
    cyl(0, 0, 0, 0.07, 0.07, 0.16, paint, {
      n: 10,
      bands: [
        { z: 0.04, h: 0.012, color: tone(paint, 0.7) },
        { z: 0.11, h: 0.012, color: tone(paint, 0.7) },
      ],
      top: '#b9bec4',
    }),
  ];
}

/** A street lamp: a pole, an arm over the road and its lamp. */
export function lampParts(): Part[] {
  const h = 0.62;
  return [
    cyl(0, 0, 0, 0.035, 0.035, 0.03, '#6b737d', { n: 8 }),
    beam([0, 0, 0], [0, 0, h], 0.018, '#8e979f'),
    beam([0, 0, h], [0, 0.16, h + 0.03], 0.014, '#8e979f'),
    box(0, 0.18, h - 0.005, 0.07, 0.05, 0.03, '#4b5561'),
    light(0, 0.18, h - 0.02, 0.022, '#ffe2a0'),
  ];
}

/** A power pole with a cross-arm and insulators; cable hangs from `POLE_TIP`. */
export function poleParts(): Part[] {
  const h = 0.95;
  return [
    cyl(0, 0, 0, 0.03, 0.022, h, '#7a5a3c', { n: 7 }),
    box(0, 0, h - 0.1, 0.03, 0.32, 0.03, '#6a4c32'),
    cyl(0, -0.13, h - 0.07, 0.012, 0.012, 0.04, '#cfe3e8', { n: 6 }),
    cyl(0, 0.13, h - 0.07, 0.012, 0.012, 0.04, '#cfe3e8', { n: 6 }),
  ];
}

/** Where a pole's two cables leave it, in model units (across, height). */
export const POLE_TIP = { s: 0.13, z: 0.9 };

type P3 = { x: number; y: number; z: number };

/**
 * A sagging cable between two points, as projected screen points: a
 * catenary-like dip of `sag` (height units) at mid-span.
 */
export function wirePoints(a: P3, b: P3, sag: number, project: (x: number, y: number, z: number) => Pt, n = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(project(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t - sag * 4 * t * (1 - t)));
  }
  return out;
}

/** Draw a cable along projected points. */
export function drawWire(ctx: CanvasRenderingContext2D, pts: readonly Pt[], width: number, night = 0): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  stroke(ctx, pts, night > 0.5 ? 'rgba(20, 24, 30, 0.7)' : 'rgba(34, 38, 44, 0.78)', width);
  ctx.restore();
}

/** A boulder (a few rough blocks) or a scrub tuft, coloured from the ground it sits on. */
export function debrisParts(kind: 'boulder' | 'scrub', seed: number, ground: string): Part[] {
  const r = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  if (kind === 'scrub') {
    const leaf = tone(ground, 0.7);
    return [
      cyl(0, 0, 0, 0.12, 0, 0.18 + r(1) * 0.1, leaf, { n: 7 }),
      cyl(0.1, 0.06, 0, 0.08, 0, 0.12 + r(2) * 0.08, tone(leaf, 1.1), { n: 7 }),
      cyl(-0.07, 0.09, 0, 0.07, 0, 0.1, tone(leaf, 0.9), { n: 7 }),
    ];
  }
  const rock = tone(ground, 0.78);
  return [
    cyl(0, 0, 0, 0.2 + r(1) * 0.06, 0.1 + r(2) * 0.05, 0.16 + r(3) * 0.1, rock, { n: 6, top: tone(rock, 1.2) }),
    cyl(0.17, 0.08, 0, 0.1, 0.05, 0.09 + r(4) * 0.05, tone(rock, 0.92), { n: 5, top: tone(rock, 1.15) }),
    cyl(-0.12, 0.13, 0, 0.07, 0.03, 0.06, tone(rock, 1.02), { n: 5 }),
  ];
}
