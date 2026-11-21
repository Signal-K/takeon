import { mulberry32 } from '../util/rng.js';

/**
 * Low-poly models for the field view (KES-543): the rover, the mining ship,
 * boulders and ore crystals. Flat-shaded triangles with vertex colours, built
 * once on the CPU; each vertex is position, normal, colour (9 floats).
 * Model space: +X forward, +Y up, +Z right, metres.
 */

export type RGB = [number, number, number];

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class MeshBuilder {
  private data: number[] = [];

  get vertexCount(): number {
    return this.data.length / 9;
  }

  build(): Float32Array {
    return new Float32Array(this.data);
  }

  /** One flat triangle; the normal comes from the winding (counter-clockwise front). */
  tri(a: number[], b: number[], c: number[], col: RGB): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) this.data.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2]);
  }

  /** A triangle wound so its normal faces away from `centre` (for convex solids). */
  triOut(a: number[], b: number[], c: number[], col: RGB, centre: number[]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * (a[0] - centre[0]) + ny * (a[1] - centre[1]) + nz * (a[2] - centre[2]);
    if (dot >= 0) this.tri(a, b, c, col); else this.tri(a, c, b, col);
  }

  /**
   * A box with chamfered vertical corners and a chamfered top edge, so it
   * catches a highlight along every edge instead of reading as a flat block.
   */
  bevelBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bev: number, col: RGB, top: RGB = col): void {
    const c = Math.min(bev, (x1 - x0) / 3, (z1 - z0) / 3, (y1 - y0) / 2);
    const centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const ring = (y: number, i: number) => [
      [x0 + i + c, y, z0 + i], [x1 - i - c, y, z0 + i], [x1 - i, y, z0 + i + c], [x1 - i, y, z1 - i - c],
      [x1 - i - c, y, z1 - i], [x0 + i + c, y, z1 - i], [x0 + i, y, z1 - i - c], [x0 + i, y, z0 + i + c],
    ];
    const lo = ring(y0, 0), mid = ring(y1 - c, 0), hi = ring(y1, c);
    const edge: RGB = [Math.min(1, top[0] * 1.12), Math.min(1, top[1] * 1.12), Math.min(1, top[2] * 1.12)];
    for (let k = 0; k < 8; k++) {
      const j = (k + 1) % 8;
      this.triOut(lo[k], lo[j], mid[j], col, centre); this.triOut(lo[k], mid[j], mid[k], col, centre);
      this.triOut(mid[k], mid[j], hi[j], edge, centre); this.triOut(mid[k], hi[j], hi[k], edge, centre);
      this.triOut([centre[0], y1, centre[2]], hi[k], hi[j], top, centre);
      this.triOut([centre[0], y0, centre[2]], lo[k], lo[j], col, centre);
    }
  }

  /**
   * Bake volume into the vertex colours: darker low down (ambient occlusion
   * under the body and in the wheel wells) and a small per-face jitter, so
   * large faces read as worn painted metal, not moulded plastic.
   */
  weather(y0: number, y1: number, low = 0.55, jitter = 0.08, seed = 1): this {
    const rnd = mulberry32(seed);
    const d = this.data;
    for (let i = 0; i < d.length; i += 27) {
      const j = 1 + (rnd() - 0.5) * 2 * jitter;
      for (let v = 0; v < 3; v++) {
        const o = i + v * 9;
        const t = Math.max(0, Math.min(1, (d[o + 1] - y0) / (y1 - y0)));
        const k = (low + (1 - low) * t * t * (3 - 2 * t)) * j;
        d[o + 6] *= k; d[o + 7] *= k; d[o + 8] *= k;
      }
    }
    return this;
  }

  quad(a: number[], b: number[], c: number[], d: number[], col: RGB): void {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  /** Axis-aligned box; `top` optionally colours the upper face differently. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, top: RGB = col): void {
    const p = (x: number, y: number, z: number) => [x, y, z];
    const shade = (k: number): RGB => [col[0] * k, col[1] * k, col[2] * k];
    this.quad(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), top);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), shade(0.6));
    this.quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), col);
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), col);
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), col);
    this.quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), col);
  }

  /** Cylinder along local Z (a wheel), centred at (cx, cy, cz). */
  wheel(cx: number, cy: number, cz: number, r: number, w: number, tyre: RGB, hub: RGB, segs = 14): void {
    const z0 = cz - w / 2, z1 = cz + w / 2;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      // Alternate tread blocks so the spin reads.
      const rr = i % 2 ? r : r * 0.86;
      const x0 = cx + Math.cos(a0) * rr, y0 = cy + Math.sin(a0) * rr;
      const x1 = cx + Math.cos(a1) * rr, y1 = cy + Math.sin(a1) * rr;
      this.quad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], tyre);
      const hr = r * 0.55;
      const hx0 = cx + Math.cos(a0) * hr, hy0 = cy + Math.sin(a0) * hr;
      const hx1 = cx + Math.cos(a1) * hr, hy1 = cy + Math.sin(a1) * hr;
      for (const [z, s] of [[z1, 1], [z0, -1]] as const) {
        const c = [cx, cy, z + s * 0.02];
        const tyreA = [x0, y0, z], tyreB = [x1, y1, z];
        const hubA = [hx0, hy0, z + s * 0.01], hubB = [hx1, hy1, z + s * 0.01];
        if (s > 0) {
          this.quad(hubA, tyreA, tyreB, hubB, tyre);
          this.tri(c, hubA, hubB, hub);
        } else {
          this.quad(hubB, tyreB, tyreA, hubA, tyre);
          this.tri(c, hubB, hubA, hub);
        }
      }
    }
  }

  /** Upright cylinder (a dish, a post), along local Y. */
  disc(cx: number, cy: number, cz: number, r: number, h: number, col: RGB, segs = 16, topCol: RGB = col): void {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad([x0, cy, z0], [x0, cy + h, z0], [x1, cy + h, z1], [x1, cy, z1], col);
      this.tri([cx, cy + h, cz], [x1, cy + h, z1], [x0, cy + h, z0], topCol);
      this.tri([cx, cy, cz], [x0, cy, z0], [x1, cy, z1], col);
    }
  }

  /** A lumpy rock: an icosahedron, optionally subdivided once, pushed in and out by a seeded jitter. */
  rock(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: RGB, seed: number, detail = 1): void {
    const rnd = mulberry32(seed);
    const t = (1 + Math.sqrt(5)) / 2;
    let verts: number[][] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
      [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    if (detail > 0) {
      const mid = new Map<string, number>();
      const m = (a: number, b: number) => {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        let i = mid.get(k);
        if (i === undefined) {
          const p = [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2];
          const l = Math.hypot(p[0], p[1], p[2]);
          i = verts.push([p[0] / l, p[1] / l, p[2] / l]) - 1;
          mid.set(k, i);
        }
        return i;
      };
      const next: number[][] = [];
      for (const [a, b, c] of faces) {
        const ab = m(a, b), bc = m(b, c), ca = m(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    verts = verts.map(v => {
      const k = 0.78 + rnd() * 0.4;
      // Flatten the underside so rocks sit rather than balance.
      const y = v[1] < -0.3 ? -0.3 + (v[1] + 0.3) * 0.3 : v[1];
      return [cx + v[0] * rx * k, cy + y * ry * k, cz + v[2] * rz * k];
    });
    for (const [a, b, c] of faces) {
      const k = 0.9 + rnd() * 0.2;
      this.tri(verts[a], verts[b], verts[c], [col[0] * k, col[1] * k, col[2] * k]);
    }
  }

  /** A pointed crystal (hexagonal prism with a tip), tilted by (ax, az). */
  crystal(cx: number, cy: number, cz: number, r: number, h: number, ax: number, az: number, col: RGB): void {
    const segs = 6;
    const tip = [cx + ax * h, cy + h * 1.25, cz + az * h];
    const ring = (y: number, s: number) =>
      Array.from({ length: segs }, (_, i) => {
        const a = (i / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * r * s + ax * y, cy + y, cz + Math.sin(a) * r * s + az * y];
      });
    const lo = ring(0, 1), hi = ring(h, 0.85);
    const lit: RGB = [Math.min(1, col[0] * 1.25), Math.min(1, col[1] * 1.25), Math.min(1, col[2] * 1.25)];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.quad(lo[i], hi[i], hi[j], lo[j], i % 2 ? col : lit);
      this.tri(hi[i], tip, hi[j], i % 2 ? lit : col);
    }
  }
}

/** Parts that move on their own: the rover's wheels spin, so they are drawn separately. */
export interface RoverModel {
  body: Float32Array;
  wheel: Float32Array;
  /** Wheel centres in model space. */
  wheels: [number, number, number][];
  wheelRadius: number;
  /** Where the laser leaves the mast. */
  muzzle: [number, number, number];
}

/**
 * A six-wheeled prospecting rover about 3 m long (KES-543). Built to be read
 * from above and behind on a phone: oversized lugged wheels, a bevelled
 * off-white hull over a gold-foil belly, orange roll bars and nose, a solar
 * deck in two angled wings, an open ore hopper and a mast with a camera head.
 * Colours are weathered at build time so it reads as painted metal.
 */
export function buildRover(): RoverModel {
  const hullC = hex('#e4dccb'), hullTop = hex('#f1ebde'), graphite = hex('#3b3e47'), steel = hex('#7d828c');
  const orange = hex('#ef6a1f'), orangeTop = hex('#ff8a3a'), foil = hex('#d6a23c'), dark = hex('#1d1e24');
  const cell = hex('#1c2340'), cellTop = hex('#2c3f7a'), glass = hex('#8fe3ff'), lamp = hex('#fff2b8');
  const b = new MeshBuilder();
  const R = 0.5;
  const wheels: [number, number, number][] = [];
  for (const x of [-1.15, 0, 1.15]) for (const z of [-1.08, 1.08]) wheels.push([x, R, z]);
  // Suspension: a rocker beam each side and a strut down to every hub.
  for (const s of [-1, 1]) {
    b.bevelBox(-1.3, 1.3, 0.78, 0.9, s * 0.78 - 0.07, s * 0.78 + 0.07, 0.03, steel);
    for (const x of [-1.15, 0, 1.15]) b.bevelBox(x - 0.07, x + 0.07, R, 0.86, s * 0.86 - 0.06, s * 0.86 + 0.06, 0.02, graphite);
  }
  // Gold-foil belly and the bevelled hull over it.
  b.bevelBox(-1.2, 1.15, 0.62, 0.86, -0.66, 0.66, 0.08, foil);
  b.bevelBox(-1.25, 1.1, 0.84, 1.28, -0.72, 0.72, 0.14, hullC, hullTop);
  // Panel seams on the hull sides.
  for (const s of [-1, 1]) for (const x of [-0.45, 0.35]) b.box(x - 0.015, x + 0.015, 0.88, 1.16, s * 0.725 - 0.01, s * 0.725 + 0.01, graphite);
  // Nose: orange wedge with two lamps.
  b.bevelBox(1.05, 1.5, 0.66, 1.12, -0.7, 0.7, 0.12, orange, orangeTop);
  for (const zz of [-0.42, 0.42]) b.bevelBox(1.44, 1.56, 0.84, 1.0, zz - 0.13, zz + 0.13, 0.04, lamp);
  // Roll bars: two orange hoops over the deck.
  for (const x of [-0.95, 0.55]) {
    for (const s of [-1, 1]) b.bevelBox(x - 0.06, x + 0.06, 1.24, 1.62, s * 0.66 - 0.06, s * 0.66 + 0.06, 0.03, orange, orangeTop);
    b.bevelBox(x - 0.06, x + 0.06, 1.56, 1.68, -0.72, 0.72, 0.03, orange, orangeTop);
  }
  // Ore hopper at the back: open graphite bin with ore in it.
  b.bevelBox(-1.2, -0.25, 1.26, 1.5, -0.5, 0.5, 0.05, graphite, dark);
  for (let i = 0; i < 5; i++) b.rock(-0.95 + i * 0.16, 1.5, (i % 2 ? 0.18 : -0.15), 0.13, 0.08, 0.13, hex('#8a7a6a'), 11 + i, 0);
  // Solar wings, tipped a little towards the camera so the cells read.
  for (const s of [-1, 1]) {
    const y = 1.32, zi = s * 0.12, zo = s * 0.86, lift = 0.08;
    const c0 = [-0.15, y, zi], c1 = [1.0, y, zi], c2 = [1.0, y + lift, zo], c3 = [-0.15, y + lift, zo];
    b.quad(c0, c1, c2, c3, cellTop); b.quad(c0, c3, c2, c1, cell);
    for (let k = 1; k < 4; k++) {
      const x = -0.15 + k * 0.2875;
      b.quad([x - 0.012, y + 0.012, zi], [x + 0.012, y + 0.012, zi], [x + 0.012, y + lift + 0.012, zo], [x - 0.012, y + lift + 0.012, zo], hullTop);
    }
    b.quad([-0.15, y + lift * 0.5 + 0.012, (zi + zo) / 2], [1.0, y + lift * 0.5 + 0.012, (zi + zo) / 2], [1.0, y + lift * 0.5 + 0.022, (zi + zo) / 2 + s * 0.02], [-0.15, y + lift * 0.5 + 0.022, (zi + zo) / 2 + s * 0.02], hullTop);
    b.bevelBox(-0.2, 1.05, y - 0.04, y + 0.01, zi - 0.03, zi + 0.03, 0.01, steel);
  }
  // Mast and camera head with two lenses.
  b.bevelBox(0.72, 0.86, 1.28, 2.1, -0.07, 0.07, 0.03, steel);
  b.bevelBox(0.55, 1.02, 2.06, 2.36, -0.3, 0.3, 0.07, hullC, hullTop);
  b.box(1.0, 1.04, 2.12, 2.3, -0.24, 0.24, dark);
  for (const zz of [-0.13, 0.13]) b.disc(1.04, 2.21, zz, 0.06, 0.0, glass, 10);
  for (const zz of [-0.13, 0.13]) b.bevelBox(1.02, 1.08, 2.15, 2.27, zz - 0.06, zz + 0.06, 0.02, glass);
  // Laser emitter under the head, orange-tipped.
  b.bevelBox(0.7, 1.3, 1.78, 1.94, -0.32, -0.16, 0.04, graphite);
  b.bevelBox(1.3, 1.38, 1.8, 1.92, -0.3, -0.18, 0.02, orange);
  // Whip antenna with a tip.
  b.box(-1.08, -1.04, 1.5, 2.6, 0.58, 0.62, steel);
  b.bevelBox(-1.11, -1.01, 2.6, 2.7, 0.55, 0.65, 0.03, orange);
  b.weather(0.4, 1.6, 0.5, 0.07, 7);
  const w = new MeshBuilder();
  w.wheel(0, 0, 0, R, 0.42, dark, hex('#c9c3b6'), 18);
  // Hub cap and lug bolts on the outer face.
  w.weather(-R, R, 0.8, 0.05, 3);
  return { body: b.build(), wheel: w.build(), wheels, wheelRadius: R, muzzle: [1.38, 1.86, -0.24] };
}

/** The mining ship seen from above in orbit: hull, solar wings, engine bells and a ventral laser. About 9 m long. */
export function buildShip(): { mesh: Float32Array; muzzle: [number, number, number]; engines: [number, number, number][] } {
  const hull = hex('#e9e7e1'), trim = hex('#ff8a1f'), dark = hex('#2a2c33'), grey = hex('#8a8d94');
  const panel = hex('#1f3a7a'), panelTop = hex('#2f5bc4');
  const b = new MeshBuilder();
  b.box(-3.6, 3.2, -0.9, 0.9, -1.1, 1.1, hull);
  b.box(3.2, 4.6, -0.7, 0.7, -0.8, 0.8, hull);
  b.box(4.6, 5.0, -0.45, 0.45, -0.5, 0.5, trim);
  b.box(-1.2, 1.4, 0.9, 1.3, -0.7, 0.7, grey);
  b.box(2.6, 3.4, 0.9, 1.2, -0.5, 0.5, hex('#9fe8ff'));
  // Orange stripe so the nose reads.
  b.box(1.6, 2.1, -0.92, 0.92, -1.12, 1.12, trim);
  // Wings.
  for (const s of [-1, 1]) {
    b.box(-0.4, 0.4, -0.12, 0.12, s * 1.1, s * 2.0, grey);
    const z0 = s > 0 ? 2.0 : -6.4, z1 = s > 0 ? 6.4 : -2.0;
    b.box(-1.6, 1.6, -0.06, 0.06, z0, z1, panel, panelTop);
    for (let k = 1; k < 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 4;
      b.box(-1.62, 1.62, 0.061, 0.08, z - 0.03, z + 0.03, hull);
    }
  }
  // Engines.
  const engines: [number, number, number][] = [];
  for (const z of [-0.55, 0.55]) {
    b.box(-4.4, -3.6, -0.45, 0.45, z - 0.4, z + 0.4, dark);
    engines.push([-4.5, 0, z]);
  }
  // Ventral laser turret.
  b.box(2.2, 3.2, -1.3, -0.9, -0.35, 0.35, dark);
  b.box(3.0, 3.6, -1.25, -1.05, -0.12, 0.12, grey);
  return { mesh: b.build(), muzzle: [3.6, -1.15, 0], engines };
}

/** Ore colours, by resource. Bright and distinct from every ground colour. */
export const ORE_COLOURS: Record<string, string> = {
  iron: '#ff7a3d', nickel: '#a8f0ff', cobalt: '#5b8cff', copper: '#ff9f5a', titanium: '#e6e6ff',
  ice: '#c8f4ff', water: '#c8f4ff', silicate: '#ffd86b', platinum: '#f4f0ff', gold: '#ffd23f',
};

export function oreColour(resource: string): RGB {
  return hex(ORE_COLOURS[resource] ?? '#32EA53');
}

/** A cluster of crystals breaking out of the ground at a deposit, in model space around the origin. */
export function buildOre(radius: number, resource: string, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const col = oreColour(resource);
  const b = new MeshBuilder();
  const n = 5 + Math.floor(radius * 2.2);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius * 0.7;
    const h = 0.35 + rnd() * 0.75 * (1 - d / radius);
    b.crystal(Math.cos(a) * d, -0.1, Math.sin(a) * d, 0.09 + rnd() * 0.1, h, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, col);
  }
  return b.build();
}
