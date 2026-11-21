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

/** The default Landnam/TakeOn rover: scout chassis, rocker wheels, small solar, scoop and nav camera. */
export const DEFAULT_ROVER_LOOK: FieldRoverLook = {
  color: '#c8d6e5', chassis: 'scout', tracks: false, solar: true, rtg: false, camera: true, scanner: false, tool: true, cargo: false,
};

const shadeRGB = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

/**
 * The Landnam/TakeOn rover in 3D (KES-543), part for part with the iso painter:
 * a rounded hull in the build's colour with a lighter roof, three dark spoked
 * wheels a side (or tracks), blue solar wings out to the sides, the ribbed
 * blue-grey aft tank, a white high-gain dish, a camera mast with a white head
 * and stereo eyes, a scanner whip with a cyan tip, a jointed tool arm, a green
 * charge strip and an amber beacon. No orange: the survey rover has none.
 * Colours are weathered at build time so it reads as painted metal.
 */
export function buildRover(look: FieldRoverLook = DEFAULT_ROVER_LOOK): RoverModel {
  const body = hex(/^#[0-9a-f]{6}$/i.test(look.color) ? look.color : '#c8d6e5');
  const flank = shadeRGB(body, 0.78), roof = shadeRGB(body, 1.18), seam = hex('#3a4a5a');
  const tyre = hex('#23222b'), hub = hex('#6c6a78'), steel = hex('#9aa3ad'), joint = hex('#5f656e');
  const cell = hex('#1d3a6f'), cellTop = hex('#2c569c'), strut = hex('#8a8f98');
  const tank = hex('#8ea6b8'), tankRib = hex('#5e7588'), white = hex('#f2f4f8'), whiteLo = hex('#b9c0cb');
  const eye = hex('#1a1e28'), lens = hex('#8fd0ff'), red = hex('#e05555'), cyan = hex('#7edcec');
  const led = hex('#6fdc8c'), amber = hex('#ffb547'), rtgC = hex('#5a5f69'), dark = hex('#1d1e24');
  const L = look.chassis === 'hauler' ? 1.25 : 1;
  const tall = look.chassis === 'lab' ? 0.16 : 0;
  const hx = 1.3 * L, hz = 0.82;
  const b = new MeshBuilder();
  const R = 0.44;
  const wheels: [number, number, number][] = [];
  const crates: Float32Array[] = [];
  const wz = 0.98;
  if (look.tracks) {
    // Track belts: long dark pods with tread ribs, sprockets at each end spin.
    for (const s of [-1, 1]) {
      b.bevelBox(-hx - 0.05, hx + 0.05, 0.04, 0.78, s * wz - 0.2, s * wz + 0.2, 0.16, tyre, hex('#3a3844'));
      for (let x = -hx; x <= hx; x += 0.28) b.box(x - 0.05, x + 0.05, 0.76, 0.8, s * wz - 0.2, s * wz + 0.2, hex('#3a3844'));
      for (const x of [-hx + 0.25, hx - 0.25]) wheels.push([x, 0.41, s * (wz + 0.21)]);
    }
  } else {
    for (const x of [-1.0 * L, 0, 1.0 * L]) for (const s of [-1, 1]) wheels.push([x, R, s * wz]);
    // Rocker arms down to each hub.
    for (const s of [-1, 1]) {
      b.bevelBox(-1.05 * L, 1.05 * L, 0.66, 0.76, s * 0.86 - 0.05, s * 0.86 + 0.05, 0.03, joint);
      for (const x of [-1.0 * L, 0, 1.0 * L]) b.bevelBox(x - 0.06, x + 0.06, R, 0.72, s * 0.86 - 0.05, s * 0.86 + 0.05, 0.02, joint);
    }
  }
  // Hull: the flank band, then the rounded roof the camera sees.
  b.bevelBox(-hx, hx, 0.58, 1.02 + tall, -hz, hz, 0.14, flank, body);
  b.bevelBox(-hx + 0.08, hx - 0.08, 0.98 + tall, 1.34 + tall, -hz + 0.06, hz - 0.06, 0.24, body, roof);
  const top = 1.34 + tall;
  // Roof seam across the deck, like the painter's line.
  b.box(-hx + 0.2, hx - 0.2, top - 0.01, top + 0.005, -0.02, 0.02, shadeRGB(seam, 1.6));
  // Charge strip: four green pips and an empty one on each flank.
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const x = -0.35 + i * 0.16;
    b.box(x - 0.05, x + 0.05, 0.74, 0.84, s * hz - 0.01, s * hz + 0.012, i < 4 ? led : dark);
  }
  // Aft tank, ribbed, blue-grey (left rear).
  b.disc(-hx + 0.42, top - 0.04, -0.42, 0.26, 0.42, tank, 14, shadeRGB(tank, 1.25));
  for (let i = 1; i < 4; i++) b.disc(-hx + 0.42, top - 0.04 + i * 0.1, -0.42, 0.272, 0.025, tankRib, 14);
  if (look.rtg) {
    // RTG: a dark finned stack off the back.
    b.disc(-hx - 0.18, 0.7, 0, 0.22, 0.62, rtgC, 12, hex('#767c86'));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(-hx - 0.18 + Math.cos(a) * 0.22 - 0.03, -hx - 0.18 + Math.cos(a) * 0.32 + 0.03, 0.72, 1.28, Math.sin(a) * 0.22 - 0.03, Math.sin(a) * 0.32 + 0.03, hex('#767c86'));
    }
  }
  if (look.cargo) {
    // Open cargo bed at the back of the deck.
    b.bevelBox(-hx + 0.15, -0.1, top - 0.02, top + 0.22, -0.05, hz - 0.12, 0.04, hex('#6a7180'), hex('#4a505c'));
    for (let i = 0; i < 4; i++) {
      const c = new MeshBuilder();
      c.bevelBox(-hx + 0.3 + i * 0.3, -hx + 0.52 + i * 0.3, top + 0.1, top + 0.3, 0.1 + (i % 2) * 0.25, 0.32 + (i % 2) * 0.25, 0.03, hex('#b08968'), hex('#c9a27e'));
      crates.push(c.build());
    }
  }
  if (look.solar) {
    // Solar wings out to the sides on struts, like the iso painter.
    for (const s of [-1, 1]) {
      const y = top - 0.06, zi = s * (hz + 0.06), zo = s * (hz + 0.84), x0 = -0.55, x1 = 0.55;
      b.bevelBox(-0.06, 0.06, y - 0.05, y + 0.01, s * (hz - 0.2), s * (hz + 0.1), 0.01, strut);
      b.quad([x0, y, zi], [x1, y, zi], [x1, y + 0.04, zo], [x0, y + 0.04, zo], s > 0 ? cellTop : cell);
      b.quad([x0, y, zi], [x0, y + 0.04, zo], [x1, y + 0.04, zo], [x1, y, zi], s > 0 ? cell : cellTop);
      // Cell grid lines.
      for (let k = 1; k < 4; k++) {
        const x = x0 + ((x1 - x0) * k) / 4;
        b.quad([x - 0.01, y + 0.012, zi], [x + 0.01, y + 0.012, zi], [x + 0.01, y + 0.052, zo], [x - 0.01, y + 0.052, zo], hex('#6f8fd0'));
      }
      b.quad([x0, y + 0.032, (zi + zo) / 2 - 0.01], [x1, y + 0.032, (zi + zo) / 2 - 0.01], [x1, y + 0.032, (zi + zo) / 2 + 0.01], [x0, y + 0.032, (zi + zo) / 2 + 0.01], hex('#6f8fd0'));
    }
  }
  // High-gain dish: white bowl on a short post (right rear).
  b.disc(-0.45 * L, top, 0.42, 0.04, 0.18, steel, 8);
  b.disc(-0.45 * L, top + 0.16, 0.42, 0.3, 0.05, whiteLo, 16, white);
  b.disc(-0.45 * L, top + 0.2, 0.42, 0.05, 0.08, steel, 8);
  // Amber beacon on the deck.
  b.disc(0.05, top, -0.1, 0.07, 0.07, amber, 10);
  let muzzle: [number, number, number] = [hx, top, 0];
  if (look.camera) {
    // Camera mast with a white head, two dark stereo eyes, a blue lens and a red laser dot.
    const mx = hx - 0.45;
    b.bevelBox(mx - 0.05, mx + 0.05, top, top + 0.82, 0.05, 0.15, 0.02, steel);
    b.bevelBox(mx - 0.2, mx + 0.16, top + 0.78, top + 1.02, -0.16, 0.36, 0.06, whiteLo, white);
    for (const [zz, r] of [[0.22, 0.075], [0.02, 0.06]] as const) {
      b.box(mx + 0.16, mx + 0.19, top + 0.9 - r, top + 0.9 + r, zz - r, zz + r, eye);
      b.box(mx + 0.19, mx + 0.2, top + 0.88, top + 0.92, zz - 0.025, zz + 0.025, lens);
    }
    b.box(mx + 0.16, mx + 0.2, top + 0.95, top + 0.98, -0.12, -0.09, red);
    muzzle = [mx + 0.2, top + 0.96, -0.1];
  }
  if (look.scanner) {
    // Scanner whip with a cyan tip.
    b.box(-0.2, -0.17, top, top + 1.05, -hz + 0.18, -hz + 0.21, steel);
    b.bevelBox(-0.24, -0.13, top + 1.02, top + 1.12, -hz + 0.14, -hz + 0.25, 0.03, cyan);
  }
  if (look.tool) {
    // Tool arm off the front right corner: shoulder, elbow, head.
    const sh = [hx - 0.05, 0.86, hz - 0.1], el = [hx + 0.42, 1.12, hz + 0.02], hd = [hx + 0.68, 0.5, hz + 0.02];
    b.beam(sh, el, 0.055, steel);
    b.beam(el, hd, 0.05, steel);
    b.disc(el[0], el[1] - 0.06, el[2], 0.09, 0.12, joint, 10);
    b.disc(hd[0], hd[1] - 0.16, hd[2], 0.11, 0.18, hex('#767d87'), 10, hex('#9fd4e6'));
    muzzle = [hd[0], hd[1] - 0.18, hd[2]];
  }
  b.weather(0.3, 1.5, 0.55, 0.06, 7);
  const w = new MeshBuilder();
  w.wheel(0, 0, 0, look.tracks ? 0.36 : R, look.tracks ? 0.08 : 0.34, tyre, hub, 18);
  // Spokes on the outer face, so the spin reads like the iso wheels.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, r = (look.tracks ? 0.36 : R) * 0.6;
    const z = (look.tracks ? 0.04 : 0.17) + 0.012;
    w.quad([Math.cos(a - 0.18) * 0.06, Math.sin(a - 0.18) * 0.06, z], [Math.cos(a - 0.08) * r, Math.sin(a - 0.08) * r, z], [Math.cos(a + 0.08) * r, Math.sin(a + 0.08) * r, z], [Math.cos(a + 0.18) * 0.06, Math.sin(a + 0.18) * 0.06, z], hex('#9aa0ab'));
  }
  w.weather(-R, R, 0.85, 0.04, 3);
  return { body: b.build(), wheel: w.build(), wheels, wheelRadius: look.tracks ? 0.36 : R, muzzle, crates };
}

/**
 * The Landnam mining ship from above (KES-543), after `laser/ship.png` and the
 * minimal mine pass: a long cream hull with a pointed nose, a blue stripe down
 * each side and the spine, a blue-framed cockpit near the nose, a small blue
 * dorsal fin, a grey engine nozzle, two landing legs and a ventral laser.
 * About 9 m long.
 */
export function buildShip(): { mesh: Float32Array; muzzle: [number, number, number]; engines: [number, number, number][] } {
  const cream = hex('#efe6d2'), creamLo = hex('#d8cdb5'), blue = hex('#2f6fd6'), blueLo = hex('#2052a8');
  const glass = hex('#8fd3f5'), nozzle = hex('#4f5560'), dark = hex('#1d1e24'), grey = hex('#8a8d94');
  const b = new MeshBuilder();
  // Hull: a lofted capsule along +X with a pointed nose.
  const prof: [number, number][] = [[-4.0, 0.62], [-3.7, 0.95], [-2.8, 1.05], [1.6, 1.05], [2.8, 0.9], [3.7, 0.55], [4.5, 0.12]];
  const sides = 12;
  for (let i = 0; i < prof.length - 1; i++) {
    const [x0, r0] = prof[i], [x1, r1] = prof[i + 1];
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      // Side stripe where the face looks sideways at mid height; spine stripe on top.
      const sy = Math.sin(am), sz = Math.cos(am);
      const stripe = Math.abs(sy) < 0.3 && Math.abs(sz) > 0.9 && x0 < 2.9;
      const col = stripe ? blue : sy < -0.4 ? creamLo : cream;
      const p = (x: number, r: number, a: number) => [x, Math.sin(a) * r * 0.9, Math.cos(a) * r];
      b.triOut(p(x0, r0, a0), p(x1, r1, a0), p(x1, r1, a1), col, [(x0 + x1) / 2, 0, 0]);
      b.triOut(p(x0, r0, a0), p(x1, r1, a1), p(x0, r0, a1), col, [(x0 + x1) / 2, 0, 0]);
    }
  }
  // A narrow blue spine stripe down the back.
  b.bevelBox(-3.4, 1.6, 0.9, 0.97, -0.13, 0.13, 0.03, blue, hex('#3f82e8'));
  // Cockpit near the nose: blue frame, pale glass.
  b.bevelBox(1.5, 2.9, 0.62, 1.08, -0.5, 0.5, 0.12, blue, blueLo);
  b.bevelBox(1.75, 2.85, 0.8, 1.12, -0.36, 0.36, 0.1, glass, hex('#c8ecff'));
  // Dorsal fin.
  b.bevelBox(-2.2, -1.0, 0.85, 1.32, -0.14, 0.14, 0.08, blue, hex('#4a8cf0'));
  // Engine nozzle at the back.
  b.disc(-4.0, 0, 0, 0.55, 0.01, nozzle, 12);
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
    const p = (x: number, r: number, a: number) => [x, Math.sin(a) * r, Math.cos(a) * r];
    b.triOut(p(-4.0, 0.5, a0), p(-4.7, 0.62, a0), p(-4.7, 0.62, a1), nozzle, [-4.35, 0, 0]);
    b.triOut(p(-4.0, 0.5, a0), p(-4.7, 0.62, a1), p(-4.0, 0.5, a1), nozzle, [-4.35, 0, 0]);
  }
  // Landing legs, folded under.
  for (const x of [-2.4, 1.2]) for (const s of [-1, 1]) {
    b.beam([x, -0.6, s * 0.55], [x - 0.3, -1.25, s * 0.85], 0.07, dark);
    b.bevelBox(x - 0.55, x - 0.05, -1.32, -1.22, s * 0.85 - 0.16, s * 0.85 + 0.16, 0.03, grey);
  }
  // Ventral laser.
  b.bevelBox(0.0, 1.2, -1.05, -0.75, -0.28, 0.28, 0.06, dark);
  b.bevelBox(1.2, 1.7, -1.0, -0.82, -0.1, 0.1, 0.03, grey);
  b.weather(-1.2, 1.1, 0.7, 0.05, 5);
  return { mesh: b.build(), muzzle: [1.7, -0.91, 0], engines: [[-4.8, 0, 0]] };
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
