import { parseHex, type Rgb } from './look.js';

/**
 * A craft is a stack of sections along one axis, drawn as a lathe: each
 * section is a run of lit rings, so the same data reads correctly from
 * behind (in flight) and from the side (in orbit). Hosts describe their own
 * vehicle as sections; nothing here knows what a "rocket" is.
 */

export interface CraftSection {
  id: string;
  /** Length along the axis, in craft units. */
  length: number;
  /** Radius at the tail end and at the nose end. */
  r0: number;
  r1: number;
  color: string;
  /** A painted ring around the middle of the section. */
  band?: string;
}

export interface FlightCraftLook {
  /** Tail first, nose last. */
  sections: CraftSection[];
  fins?: { count: number; span: number; length: number; color: string };
  /** Strap-on boosters around the tail. */
  boosters?: { count: number; radius: number; length: number; color: string };
  /** Exhaust colour. */
  plume?: string;
  /** Overall size multiplier. */
  scale?: number;
}

export function defaultCraftLook(): FlightCraftLook {
  return {
    sections: [
      { id: 'engine', length: 0.28, r0: 0.2, r1: 0.26, color: '#3c4658' },
      { id: 'tank', length: 0.9, r0: 0.26, r1: 0.26, color: '#eef2f6', band: '#2f6fd0' },
      { id: 'payload', length: 0.5, r0: 0.26, r1: 0.22, color: '#dfe6ee' },
      { id: 'nose', length: 0.45, r0: 0.22, r1: 0.02, color: '#2f6fd0' },
    ],
    fins: { count: 4, span: 0.24, length: 0.42, color: '#2f6fd0' },
    plume: '#7fd4ff',
    scale: 1.25,
  };
}

export type Vec3 = [number, number, number];

/** Pinhole camera looking along +z. Screen y grows downward. */
export interface FlightCamera {
  cx: number;
  cy: number;
  /** Focal length in pixels. */
  f: number;
}

export function project(cam: FlightCamera, p: Vec3): { x: number; y: number; s: number } {
  const z = Math.max(0.05, p[2]);
  const s = cam.f / z;
  return { x: cam.cx + p[0] * s, y: cam.cy - p[1] * s, s };
}

const css = (c: Rgb, k: number) => `rgb(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))})`;

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

interface Ring { p: Vec3; r: number; color: Rgb }

function lathe(sections: CraftSection[], origin: Vec3, axis: Vec3, scale: number, step: number): Ring[] {
  const rings: Ring[] = [];
  let t = 0;
  for (const sec of sections) {
    const color = parseHex(sec.color);
    const band = sec.band ? parseHex(sec.band) : null;
    const n = Math.max(2, Math.ceil((sec.length * scale) / step));
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const at = (t + sec.length * u) * scale;
      rings.push({
        p: [origin[0] + axis[0] * at, origin[1] + axis[1] * at, origin[2] + axis[2] * at],
        r: (sec.r0 + (sec.r1 - sec.r0) * u) * scale,
        color: band && u > 0.42 && u < 0.58 ? band : color,
      });
    }
    t += sec.length;
  }
  return rings;
}

function drawRings(ctx: CanvasRenderingContext2D, cam: FlightCamera, rings: Ring[], axis: Vec3): void {
  // Far rings first, so nearer ones cover them.
  const order = rings.map((ring, i) => i).sort((a, b) => rings[b]!.p[2] - rings[a]!.p[2]);
  for (const i of order) {
    const ring = rings[i]!;
    const c = project(cam, ring.p);
    const ahead = project(cam, [ring.p[0] + axis[0] * 0.05, ring.p[1] + axis[1] * 0.05, ring.p[2] + axis[2] * 0.05]);
    const view = norm(ring.p);
    const facing = Math.abs(axis[0] * view[0] + axis[1] * view[1] + axis[2] * view[2]);
    const major = Math.max(0.5, ring.r * c.s);
    const minor = Math.max(0.5, major * facing);
    const dx = ahead.x - c.x, dy = ahead.y - c.y;
    const rot = Math.hypot(dx, dy) < 1e-4 ? 0 : Math.atan2(dy, dx) + Math.PI / 2;
    // Light from the upper left: shade across the ring, whichever way it lies.
    const gx = Math.cos(rot) * major, gy = Math.sin(rot) * major;
    const flip = gx * -0.7 + gy * -0.7 > 0 ? 1 : -1;
    const grad = ctx.createLinearGradient(c.x + gx * flip, c.y + gy * flip, c.x - gx * flip, c.y - gy * flip);
    grad.addColorStop(0, css(ring.color, 1.12));
    grad.addColorStop(0.45, css(ring.color, 0.92));
    grad.addColorStop(1, css(ring.color, 0.42));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, major, minor, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface CraftPose {
  /** Tail position in view space. */
  position: Vec3;
  /** Direction of travel. */
  axis: Vec3;
  /** Roll about the axis, radians. */
  roll?: number;
  /** 0 idle .. 1 cruise .. 2 boost. */
  thrust: number;
  time: number;
}

/** Draw the craft into a 2D context through `cam`. */
export function drawCraft(ctx: CanvasRenderingContext2D, cam: FlightCamera, look: FlightCraftLook, pose: CraftPose): void {
  const axis = norm(pose.axis);
  const scale = look.scale ?? 1;
  const tail = project(cam, pose.position);
  const length = look.sections.reduce((n, s) => n + s.length, 0) * scale;
  const nose = project(cam, [pose.position[0] + axis[0] * length, pose.position[1] + axis[1] * length, pose.position[2] + axis[2] * length]);
  // Ring spacing in craft units that keeps neighbours about a pixel apart on screen.
  const screenLength = Math.hypot(nose.x - tail.x, nose.y - tail.y) + Math.abs(nose.s - tail.s) * 0.3;
  const step = Math.max(length / 180, length / Math.max(28, screenLength / 1.2));

  // Two directions square to the axis, to place fins and boosters around it.
  const up: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = norm(cross(up, axis));
  const top = cross(axis, side);
  const roll = pose.roll ?? 0;
  const radial = (angle: number): Vec3 => {
    const c = Math.cos(angle + roll), s = Math.sin(angle + roll);
    return [side[0] * c + top[0] * s, side[1] * c + top[1] * s, side[2] * c + top[2] * s];
  };
  const along = (base: Vec3, d: Vec3, k: number): Vec3 => [base[0] + d[0] * k, base[1] + d[1] * k, base[2] + d[2] * k];

  const tailR = (look.sections[0]?.r1 ?? 0.2) * scale;
  const around: { dir: Vec3; draw: () => void }[] = [];
  if (look.fins) {
    const fin = look.fins;
    const color = parseHex(fin.color);
    for (let i = 0; i < fin.count; i++) {
      const dir = radial((i / fin.count) * Math.PI * 2 + Math.PI / fin.count);
      around.push({ dir, draw: () => {
        const root = along(pose.position, dir, tailR * 0.9);
        const pts = [
          root,
          along(root, dir, fin.span * scale),
          along(along(root, dir, fin.span * scale * 0.55), axis, fin.length * scale * 0.5),
          along(root, axis, fin.length * scale),
        ].map((p) => project(cam, p));
        ctx.fillStyle = css(color, 0.55 + 0.5 * Math.max(0, -dir[0] * 0.6 + dir[1] * 0.6 + 0.3));
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
      } });
    }
  }
  if (look.boosters) {
    const b = look.boosters;
    for (let i = 0; i < b.count; i++) {
      const dir = radial((i / b.count) * Math.PI * 2);
      around.push({ dir, draw: () => {
        const base = along(pose.position, dir, tailR + b.radius * scale * 0.9);
        const sections: CraftSection[] = [
          { id: 'b-engine', length: b.length * 0.12, r0: b.radius * 0.7, r1: b.radius, color: '#3c4658' },
          { id: 'b-body', length: b.length * 0.66, r0: b.radius, r1: b.radius, color: b.color },
          { id: 'b-nose', length: b.length * 0.22, r0: b.radius, r1: 0.01, color: b.color },
        ];
        drawRings(ctx, cam, lathe(sections, base, axis, scale, step), axis);
      } });
    }
  }
  // What sits on the far side of the hull is drawn before it, the near side after.
  const far = around.filter((a) => a.dir[2] > 0);
  const near = around.filter((a) => a.dir[2] <= 0);
  const hull = () => drawRings(ctx, cam, lathe(look.sections, pose.position, axis, scale, step), axis);
  const plume = () => {
    if (pose.thrust <= 0) return;
    const color = parseHex(look.plume ?? '#7fd4ff');
    const reach = (0.5 + 0.55 * pose.thrust) * scale;
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const u = i / 13;
      const flicker = 0.85 + 0.15 * Math.sin(pose.time * 31 + i * 1.7);
      const p = project(cam, along(pose.position, axis, -u * reach));
      const r = Math.max(0.5, tailR * (0.8 - 0.62 * u) * flicker * p.s);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.5 * (1 - u)})`);
      g.addColorStop(0.5, `rgba(${color[0]},${color[1]},${color[2]},${0.38 * (1 - u)})`);
      g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = prev;
  };

  // Seen from behind, the exhaust is between the camera and the tail.
  const fromBehind = axis[2] > 0;
  if (!fromBehind) plume();
  far.forEach((a) => a.draw());
  hull();
  near.forEach((a) => a.draw());
  if (fromBehind) plume();
}
