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

  /** A square-section strut from a to b, `r` half-thick (arms, legs). */
  beam(a: number[], b: number[], r: number, col: RGB): void {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const f = [d[0] / l, d[1] / l, d[2] / l];
    const up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul * r, u[1] / ul * r, u[2] / ul * r];
    const v = [(f[1] * u[2] - f[2] * u[1]), (f[2] * u[0] - f[0] * u[2]), (f[0] * u[1] - f[1] * u[0])];
    const corner = (p: number[], su: number, sv: number) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
    const ring = (p: number[]) => [corner(p, 1, 1), corner(p, -1, 1), corner(p, -1, -1), corner(p, 1, -1)];
    const ra = ring(a), rb = ring(b);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      this.triOut(ra[k], ra[j], rb[j], col, c);
      this.triOut(ra[k], rb[j], rb[k], col, c);
    }
    this.triOut(rb[0], rb[1], rb[2], col, c); this.triOut(rb[0], rb[2], rb[3], col, c);
    this.triOut(ra[0], ra[1], ra[2], col, c); this.triOut(ra[0], ra[2], ra[3], col, c);
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
  /** Where the laser leaves the rover (the tool head, or the camera head). */
  muzzle: [number, number, number];
  /** Ore crates in the cargo bed, drawn one by one as the hold fills (empty without a bed). */
  crates: Float32Array[];
}

/**
 * What the rover is fitted with: the same switches TakeOn's iso painter
 * (`render/rover.ts`) reads, so the field rover and the Landnam/TakeOn rover
 * are one vehicle. `roverLookFromSpec` derives it from a `RoverSpec`.
 */
export interface FieldRoverLook {
  /** Hull colour (css hex), `RoverSpec.color`. */
  color: string;
  chassis: 'scout' | 'hauler' | 'lab';
  tracks: boolean;
  solar: boolean;
  rtg: boolean;
  camera: boolean;
  scanner: boolean;
  tool: boolean;
  cargo: boolean;
}

/** The default Landnam/TakeOn rover: scout frame, four wheels, small solar, scoop and nav camera. */
export const DEFAULT_ROVER_LOOK: FieldRoverLook = {
  color: '#c8d6e5', chassis: 'scout', tracks: false, solar: true, rtg: false, camera: true, scanner: false, tool: true, cargo: false,
};

const shadeRGB = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

/**
 * The Landnam/TakeOn rover in 3D (KES-543), built the way Haphazard Martians
 * builds rovers: from blocks on a 1 m grid. Bolted hex nodes sit on the grid
 * points, thin girders join neighbours with a diagonal in every bay so the
 * frame is braced into triangles, wheels hang off the end nodes on stub axles,
 * and a blue Navcam mast stands on the front node. Each fitted part is one
 * block in one bay: the build's colour is a single avionics box, solar is a
 * flat panel over a bay (not wings), cargo is an open bay with crates. The
 * frame stays open and narrow (1.8 m over the wheels), so it reads as a lean
 * rover from above, never a car body. No orange: the survey rover has none.
 */
export function buildRover(look: FieldRoverLook = DEFAULT_ROVER_LOOK): RoverModel {
  const body = hex(/^#[0-9a-f]{6}$/i.test(look.color) ? look.color : '#c8d6e5');
  const roof = shadeRGB(body, 1.15);
  const steel = hex('#c9ced8'), steelLt = hex('#e4e8ef'), iron = hex('#6b717c'), bolt = hex('#3c414b');
  const tyre = hex('#23222b'), hub = hex('#8a909c');
  const mastBlue = hex('#5aaae6'), mastLt = hex('#86c4f0');
  const cell = hex('#1d3a6f'), cellTop = hex('#2c569c'), cellLine = hex('#6f8fd0');
  const tank = hex('#8ea6b8'), tankRib = hex('#5e7588'), white = hex('#f2f4f8'), whiteLo = hex('#b9c0cb');
  const eye = hex('#1a1e28'), lens = hex('#8fd0ff'), red = hex('#e05555'), cyan = hex('#7edcec');
  const led = hex('#6fdc8c'), amber = hex('#ffb547'), dark = hex('#1d1e24'), crate = hex('#b08968'), crateTop = hex('#c9a27e');
  // The grid: one column of nodes per metre along the rover, two rails 0.9 m apart.
  const xs = look.chassis === 'hauler' ? [-1.5, -0.5, 0.5, 1.5] : [-1, 0, 1];
  const zr = 0.45, y = 0.66;
  const front = xs[xs.length - 1], rear = xs[0];
  const b = new MeshBuilder();
  const R = 0.4;
  const wheels: [number, number, number][] = [];
  const crates: Float32Array[] = [];

  const node = (x: number, yy: number, z: number) => {
    b.disc(x, yy - 0.06, z, 0.17, 0.12, iron, 6, steel);
    b.disc(x, yy + 0.06, z, 0.11, 0.015, steelLt, 6);
    b.disc(x, yy + 0.075, z, 0.04, 0.02, bolt, 6);
  };
  // A girder from node to node, trimmed so it meets the plates, not their centres.
  const girder = (a: number[], c: number[]) => {
    const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, t = 0.14 / l;
    b.beam([a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], [c[0] - d[0] * t, c[1] - d[1] * t, c[2] - d[2] * t], 0.04, iron);
  };
  const frame = (yy: number, cols: number[]) => {
    for (const x of cols) for (const z of [-zr, zr]) node(x, yy, z);
    for (let i = 0; i < cols.length; i++) {
      girder([cols[i], yy, -zr], [cols[i], yy, zr]);
      if (i === 0) continue;
      for (const z of [-zr, zr]) girder([cols[i - 1], yy, z], [cols[i], yy, z]);
      // The triangle block: one diagonal per bay locks the shape.
      const s = i % 2 ? 1 : -1;
      girder([cols[i - 1], yy, -s * zr], [cols[i], yy, s * zr]);
    }
  };
  frame(y, xs);

  // Wheels or tracks off the end columns.
  const wz = 0.78;
  if (look.tracks) {
    for (const s of [-1, 1]) {
      b.bevelBox(rear - 0.35, front + 0.35, 0.06, 0.62, s * wz - 0.13, s * wz + 0.13, 0.14, tyre, hex('#3a3844'));
      for (let x = rear - 0.25; x <= front + 0.25; x += 0.25) b.box(x - 0.04, x + 0.04, 0.6, 0.64, s * wz - 0.13, s * wz + 0.13, hex('#3a3844'));
      for (const x of [rear, front]) { girder([x, y, s * zr], [x, 0.36, s * (wz - 0.13)]); wheels.push([x, 0.34, s * (wz + 0.14)]); }
    }
  } else {
    for (const x of [rear, front]) for (const s of [-1, 1]) {
      b.beam([x, y, s * (zr + 0.12)], [x, R, s * (wz - 0.12)], 0.045, iron);
      wheels.push([x, R, s * wz]);
    }
  }

  // Bays between the columns, rear to front. Each fitted part takes one bay.
  const bays = xs.slice(1).map((x, i) => [xs[i], x] as const);
  const deck = y + 0.08;
  const avBay = bays[bays.length - 1];
  const tall = look.chassis === 'lab' ? 0.56 : 0;
  if (tall) {
    // Lab: a second frame tier over the front bay, on uprights.
    for (const x of avBay) for (const z of [-zr, zr]) girder([x, y, z], [x, y + tall, z]);
    girder([avBay[0], y, -zr], [avBay[1], y + tall, -zr]);
    girder([avBay[0], y, zr], [avBay[1], y + tall, zr]);
    frame(y + tall, [...avBay]);
  }
  // Avionics box in the build's colour, the rover's one coloured block.
  const ax0 = avBay[0] + 0.14, ax1 = avBay[1] - 0.22, ay0 = deck + tall, ay1 = ay0 + 0.34;
  b.bevelBox(ax0, ax1, ay0, ay1, -0.32, 0.32, 0.07, body, roof);
  for (let i = 0; i < 5; i++) {
    const x = ax0 + 0.1 + i * 0.1;
    b.box(x - 0.03, x + 0.03, ay0 + 0.14, ay0 + 0.22, 0.32, 0.335, i < 4 ? led : dark);
  }
  b.disc(ax1 - 0.12, ay1, -0.2, 0.06, 0.06, amber, 10);
  // High-gain dish on the box.
  b.disc(ax0 + 0.18, ay1, 0.14, 0.03, 0.12, steel, 8);
  b.disc(ax0 + 0.18, ay1 + 0.11, 0.14, 0.2, 0.04, whiteLo, 14, white);

  const panel = (x0: number, x1: number, py: number) => {
    for (const x of [x0 + 0.12, x1 - 0.12]) b.disc(x, py - 0.18, 0, 0.03, 0.18, steel, 6);
    b.bevelBox(x0 + 0.06, x1 - 0.06, py, py + 0.04, -zr + 0.02, zr - 0.02, 0.015, cell, cellTop);
    for (let k = 1; k < 3; k++) {
      const x = x0 + ((x1 - x0) * k) / 3;
      b.box(x - 0.008, x + 0.008, py + 0.04, py + 0.046, -zr + 0.04, zr - 0.04, cellLine);
    }
    b.box(x0 + 0.08, x1 - 0.08, py + 0.04, py + 0.046, -0.008, 0.008, cellLine);
  };
  const rearBay = bays[0];
  const freeBays = bays.slice(0, -1);
  if (look.cargo) {
    // Open cargo bay: a floor and low rails, crates appear as the hold fills.
    const [c0, c1] = rearBay;
    b.box(c0 + 0.12, c1 - 0.12, deck - 0.02, deck + 0.02, -zr + 0.06, zr - 0.06, hex('#4a505c'));
    for (const z of [-zr + 0.06, zr - 0.06]) b.box(c0 + 0.12, c1 - 0.12, deck, deck + 0.14, z - 0.025, z + 0.025, hex('#8a909c'));
    for (let i = 0; i < 4; i++) {
      const cx = c0 + 0.32 + (i >> 1) * 0.36, cz = (i % 2 ? 0.18 : -0.18);
      const c = new MeshBuilder();
      c.bevelBox(cx - 0.15, cx + 0.15, deck + 0.02, deck + 0.26, cz - 0.15, cz + 0.15, 0.03, crate, crateTop);
      crates.push(c.build());
    }
  }
  if (look.solar) {
    // A flat panel over a free bay; if the cargo bay took it, the panel rides on the avionics box.
    const bay = freeBays.find(bb => !(look.cargo && bb === rearBay));
    if (bay) panel(bay[0], bay[1], deck + 0.3);
    else panel(avBay[0], avBay[1], ay1 + 0.24);
  }
  // Tank on a rear corner node.
  b.disc(rear, y + 0.08, -zr, 0.16, 0.3, tank, 12, shadeRGB(tank, 1.25));
  for (let i = 1; i < 3; i++) b.disc(rear, y + 0.08 + i * 0.1, -zr, 0.168, 0.02, tankRib, 12);
  if (look.rtg) {
    // RTG: a dark finned stack off the rear cross girder.
    b.disc(rear - 0.28, y - 0.2, 0, 0.16, 0.5, hex('#5a5f69'), 12, hex('#767c86'));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(rear - 0.28 + Math.cos(a) * 0.16 - 0.025, rear - 0.28 + Math.cos(a) * 0.25 + 0.025, y - 0.16, y + 0.26, Math.sin(a) * 0.16 - 0.025, Math.sin(a) * 0.25 + 0.025, hex('#767c86'));
    }
    girder([rear, y, 0], [rear - 0.28, y, 0]);
  }
  // The Navcam mast: blue, on the front cross girder; every rover carries one.
  const mx = front - 0.02, top = deck + tall;
  b.bevelBox(mx - 0.05, mx + 0.05, y, top + 0.86, -0.05, 0.05, 0.02, mastBlue, mastLt);
  b.bevelBox(mx - 0.16, mx + 0.14, top + 0.82, top + 1.02, -0.2, 0.2, 0.05, look.camera ? whiteLo : mastBlue, look.camera ? white : mastLt);
  let muzzle: [number, number, number] = [mx + 0.16, top + 0.92, 0];
  if (look.camera) {
    for (const zz of [0.1, -0.1]) {
      b.box(mx + 0.14, mx + 0.17, top + 0.86, top + 0.98, zz - 0.06, zz + 0.06, eye);
      b.box(mx + 0.17, mx + 0.18, top + 0.9, top + 0.94, zz - 0.02, zz + 0.02, lens);
    }
    b.box(mx + 0.14, mx + 0.18, top + 0.99, top + 1.01, -0.02, 0.02, red);
    muzzle = [mx + 0.18, top + 1.0, 0];
  }
  if (look.scanner) {
    // Scanner whip with a cyan tip, on a rear node.
    b.box(rear + 0.02, rear + 0.05, y, y + 1.1, zr - 0.015, zr + 0.015, steel);
    b.bevelBox(rear - 0.03, rear + 0.1, y + 1.06, y + 1.16, zr - 0.06, zr + 0.06, 0.03, cyan);
  }
  if (look.tool) {
    // Tool arm off the front right node: shoulder, elbow, head.
    const sh = [front, y + 0.04, zr], el = [front + 0.42, y + 0.36, zr + 0.06], hd = [front + 0.66, 0.34, zr + 0.06];
    b.beam(sh, el, 0.045, steel);
    b.beam(el, hd, 0.04, steel);
    b.disc(el[0], el[1] - 0.05, el[2], 0.08, 0.1, iron, 6, steel);
    b.disc(hd[0], hd[1] - 0.14, hd[2], 0.09, 0.16, hex('#767d87'), 10, hex('#9fd4e6'));
    muzzle = [hd[0], hd[1] - 0.16, hd[2]];
  }
  b.weather(0.2, 1.6, 0.6, 0.06, 7);

  // The wheel: a knobbly tyre on a spoked rim, as in Haphazard Martians.
  const wr = look.tracks ? 0.3 : R;
  const w = new MeshBuilder();
  w.wheel(0, 0, 0, wr, look.tracks ? 0.08 : 0.24, tyre, hub, 16);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, r = wr * 0.58;
    const z = (look.tracks ? 0.04 : 0.12) + 0.012;
    w.quad([Math.cos(a - 0.2) * 0.05, Math.sin(a - 0.2) * 0.05, z], [Math.cos(a - 0.07) * r, Math.sin(a - 0.07) * r, z], [Math.cos(a + 0.07) * r, Math.sin(a + 0.07) * r, z], [Math.cos(a + 0.2) * 0.05, Math.sin(a + 0.2) * 0.05, z], hex('#b4bac4'));
  }
  w.weather(-wr, wr, 0.85, 0.04, 3);
  return { body: b.build(), wheel: w.build(), wheels, wheelRadius: wr, muzzle, crates };
}

/** Landnam's rocket types, as `ROCKET_MODELS` names them. */
export type FieldShipKind = 'explorer' | 'prospector' | 'surveyor';
export const FIELD_SHIP_KINDS: readonly FieldShipKind[] = ['explorer', 'prospector', 'surveyor'];

/**
 * The player's rocket from above (KES-543), one model per Landnam rocket type,
 * after its art (`ships/ship_sr1.png`, `ship_sr2.png`, `parts/hull_mk3_heavy_t3.png`):
 *
 * - **Explorer:** a pale-blue capsule with a rounded nose cap, two light bands,
 *   a green stripe with three portholes, one long side pod a side, yellow
 *   hazard chevrons by the nose, swept fins and a blue nozzle.
 * - **Prospector:** the same hull with a cyan stripe, four portholes and two
 *   shorter pods a side.
 * - **Surveyor:** the heavy hull, a long dark-grey block with black bumpers at
 *   the corners, two steel bands, a cyan light line and amber running lights,
 *   pushed by two nozzles.
 *
 * Every one carries the mining fit: landing legs folded under and a ventral
 * laser. About 9 m long, nose along +X.
 */
export function buildShip(kind: FieldShipKind = 'explorer'): { mesh: Float32Array; muzzle: [number, number, number]; engines: [number, number, number][] } {
  const b = new MeshBuilder();
  const dark = hex('#1d1e24'), grey = hex('#8a8d94');
  let engines: [number, number, number][];
  const nozzle = (x: number, z: number, r: number, col: RGB, rim: RGB) => {
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
      const p = (xx: number, rr: number, a: number) => [xx, Math.sin(a) * rr, z + Math.cos(a) * rr];
      b.triOut(p(x, r * 0.75, a0), p(x - 0.8, r, a0), p(x - 0.8, r, a1), col, [x - 0.4, 0, z]);
      b.triOut(p(x, r * 0.75, a0), p(x - 0.8, r, a1), p(x, r * 0.75, a1), col, [x - 0.4, 0, z]);
    }
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
      b.tri([x - 0.8, 0, z], [x - 0.8, Math.sin(a1) * r * 0.9, z + Math.cos(a1) * r * 0.9], [x - 0.8, Math.sin(a0) * r * 0.9, z + Math.cos(a0) * r * 0.9], rim);
    }
  };
  if (kind === 'surveyor') {
    const hull = hex('#3e434c'), hullTop = hex('#5a606b'), band = hex('#6b7380'), bandTop = hex('#8d95a2');
    const line = hex('#5fe0f0'), amber = hex('#ffb547'), bumper = hex('#1d1e24');
    b.bevelBox(-4.2, 4.2, -0.8, 0.85, -1.2, 1.2, 0.3, hull, hullTop);
    // Panel seams along the deck.
    for (const z of [-0.6, 0.6]) b.box(-3.9, 3.9, 0.85, 0.862, z - 0.02, z + 0.02, hex('#30343b'));
    // Two steel bands across.
    for (const x of [-1.4, 1.4]) b.bevelBox(x - 0.28, x + 0.28, -0.88, 0.95, -1.28, 1.28, 0.08, band, bandTop);
    // The cyan light line down the middle of each side and along the spine.
    for (const s of [-1, 1]) b.box(-3.9, 3.9, -0.02, 0.08, s * 1.2 - 0.02, s * 1.2 + 0.02, line);
    b.box(-3.9, 3.9, 0.862, 0.875, -0.05, 0.05, line);
    // Amber running lights, three to a section.
    for (const xc of [-2.8, 0, 2.8]) for (let i = -1; i <= 1; i++) b.box(xc + i * 0.3 - 0.08, xc + i * 0.3 + 0.08, 0.862, 0.9, 0.85, 1.0, amber);
    // Black bumpers round the four corners.
    for (const x of [-4.1, 4.1]) for (const s of [-1, 1]) b.bevelBox(x - 0.32, x + 0.32, -0.85, 0.9, s * 1.05 - 0.3, s * 1.05 + 0.3, 0.14, bumper, hex('#2c2d35'));
    nozzle(-4.25, -0.6, 0.45, hex('#4f5560'), hex('#7edcec'));
    nozzle(-4.25, 0.6, 0.45, hex('#4f5560'), hex('#7edcec'));
    engines = [[-5.1, 0, -0.6], [-5.1, 0, 0.6]];
  } else {
    const hull = hex('#a9c9e6'), hullLo = hex('#6f9cc6'), cap = hex('#dce9f5'), band = hex('#d6e6f4');
    const stripe = kind === 'prospector' ? hex('#2aa8c8') : hex('#1e8c78');
    const ink = hex('#16304a'), glass = hex('#4aa6e0'), ring = hex('#f2f6fa'), hazard = hex('#f2c230');
    // Hull: a lofted capsule along +X, blunt rounded nose cap at the front, tapering to the engine.
    const prof: [number, number, RGB][] = [
      [-3.6, 0.55, hull], [-2.9, 1.0, hull], [2.6, 1.05, hull], [3.3, 0.95, cap], [3.9, 0.7, cap], [4.3, 0.25, cap],
    ];
    const sides = 14;
    for (let i = 0; i < prof.length - 1; i++) {
      const [x0, r0, c0] = prof[i], [x1, r1] = prof[i + 1];
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
        const sy = Math.sin(am);
        const col = c0 === hull && sy < -0.3 ? hullLo : c0;
        const p = (x: number, r: number, a: number) => [x, Math.sin(a) * r * 0.92, Math.cos(a) * r];
        b.triOut(p(x0, r0, a0), p(x1, r1, a0), p(x1, r1, a1), col, [(x0 + x1) / 2, 0, 0]);
        b.triOut(p(x0, r0, a0), p(x1, r1, a1), p(x0, r0, a1), col, [(x0 + x1) / 2, 0, 0]);
      }
    }
    // Two pale bands round the hull.
    for (const x of [-0.9, 1.3]) {
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
        const p = (xx: number, a: number) => [xx, Math.sin(a) * 1.08 * 0.92, Math.cos(a) * 1.08];
        b.triOut(p(x - 0.12, a0), p(x + 0.12, a0), p(x + 0.12, a1), band, [x, 0, 0]);
        b.triOut(p(x - 0.12, a0), p(x + 0.12, a1), p(x - 0.12, a1), band, [x, 0, 0]);
      }
    }
    // The stripe along the spine (the side the camera sees) and down both flanks.
    b.bevelBox(-2.8, 2.7, 0.9, 1.0, -0.2, 0.2, 0.03, stripe, stripe);
    for (const s of [-1, 1]) b.box(-2.8, 2.7, -0.12, 0.12, s * 1.04 - 0.03, s * 1.04 + 0.03, stripe);
    // Portholes on the stripe: three on the Explorer, four on the Prospector.
    const ports = kind === 'prospector' ? [-0.15, 0.25, 0.65, 1.05] : [0.05, 0.45, 0.85];
    for (const x of ports) {
      b.disc(x, 0.99, 0, 0.15, 0.04, ring, 12);
      b.disc(x, 1.02, 0, 0.1, 0.03, glass, 12);
    }
    // Hazard chevrons by the nose cap.
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.box(2.75 - i * 0.02, 2.95 - i * 0.02, 0.7 - i * 0.28, 0.78 - i * 0.28, s * (0.55 + i * 0.16) - 0.06, s * (0.55 + i * 0.16) + 0.06, hazard);
    // Vents aft of the stripe.
    for (let i = 0; i < 4; i++) b.box(-2.4 + i * 0.18, -2.34 + i * 0.18, 0.94, 0.97, -0.45, -0.1, ink);
    // Side pods: one long pod a side on the Explorer, two short ones on the Prospector.
    const pods: [number, number][] = kind === 'prospector' ? [[-2.6, -0.6], [-0.3, 1.7]] : [[-2.6, 0.9]];
    for (const [x0, x1] of pods) for (const s of [-1, 1]) {
      b.bevelBox(x0, x1, -0.42, 0.42, s * 1.0 - 0.0, s * 1.55, 0.18, hullLo, hull);
      b.box(x0 + 0.2, x1 - 0.2, 0.42, 0.44, s * 1.22 - 0.05, s * 1.22 + 0.05, cap);
      // A wedge intake at each pod's front.
      b.triOut([x1, 0.25, s * 1.05], [x1 + 0.4, 0, s * 1.05], [x1, -0.25, s * 1.05], cap, [x1, 0, s * 1.3]);
    }
    // Swept fins at the tail, out to the sides and one up.
    for (const s of [-1, 1]) {
      const fin = [[-2.7, 0.05, s * 0.9], [-3.9, 0.05, s * 2.0], [-4.3, 0.05, s * 2.0], [-3.6, 0.05, s * 0.6]];
      b.quad(fin[0], fin[1], fin[2], fin[3], s > 0 ? hull : hullLo);
      b.quad(fin[3], fin[2], fin[1], fin[0], s > 0 ? hullLo : hull);
    }
    b.bevelBox(-3.6, -2.6, 0.7, 1.35, -0.06, 0.06, 0.03, hull, cap);
    nozzle(-3.6, 0, 0.62, glass, hex('#bfe6ff'));
    engines = [[-4.5, 0, 0]];
  }
  // Mining fit: landing legs folded under, ventral laser.
  for (const x of [-2.4, 1.2]) for (const s of [-1, 1]) {
    b.beam([x, -0.6, s * 0.55], [x - 0.3, -1.25, s * 0.85], 0.07, dark);
    b.bevelBox(x - 0.55, x - 0.05, -1.32, -1.22, s * 0.85 - 0.16, s * 0.85 + 0.16, 0.03, grey);
  }
  b.bevelBox(0.0, 1.2, -1.05, -0.75, -0.28, 0.28, 0.06, dark);
  b.bevelBox(1.2, 1.7, -1.0, -0.82, -0.1, 0.1, 0.03, grey);
  b.weather(-1.2, 1.1, 0.7, 0.05, 5);
  return { mesh: b.build(), muzzle: [1.7, -0.91, 0], engines };
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
