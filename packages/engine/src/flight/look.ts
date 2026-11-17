import type { BodyDef } from '../types.js';
import { fbm2 } from '../util/noise/value.js';
import { worley2 } from '../util/noise/worley.js';

/**
 * How a body looks from space. Pure data plus pure pixel maths, so a host can
 * generate the same globe on a canvas, in a worker or in a test.
 */

export type FlightBodyKind = 'rocky' | 'ice' | 'ocean' | 'gas' | 'lava' | 'asteroid';

export interface FlightBodyLook {
  kind: FlightBodyKind;
  seed: number;
  /** Surface ramp, low ground to high ground (or band to band on a gas giant). 2 to 5 CSS hex colours. */
  colors: string[];
  /** Rim glow colour. Omit for an airless body. */
  atmosphere?: string;
  /** Cloud cover, 0..1. */
  clouds?: number;
  /** Polar cap size, 0..1. */
  caps?: number;
  /** Crater density, 0..1. */
  craters?: number;
  /** How far the outline departs from a sphere, 0..0.35. Asteroids. */
  lumpiness?: number;
  /** Ring system, radii as multiples of the body radius. */
  rings?: { inner: number; outer: number; color: string };
  /** Axial tilt in radians. */
  tilt?: number;
}

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function ramp(colors: Rgb[], t: number): Rgb {
  const x = Math.max(0, Math.min(0.9999, t)) * (colors.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = colors[i]!;
  const b = colors[Math.min(colors.length - 1, i + 1)]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Stock looks by kind. A host overrides any field. */
export const FLIGHT_LOOKS: Record<FlightBodyKind, Omit<FlightBodyLook, 'seed'>> = {
  rocky: { kind: 'rocky', colors: ['#5d3a2a', '#9a5a3c', '#c98a5e', '#e2b98f'], craters: 0.45, atmosphere: '#e8a070', caps: 0.12 },
  ice: { kind: 'ice', colors: ['#6f8fa8', '#a9c6d8', '#dcecf4', '#ffffff'], craters: 0.2, caps: 0.3 },
  ocean: { kind: 'ocean', colors: ['#0b2a5a', '#1c5fa0', '#3f8f5a', '#8a9a5c', '#d9d2b8'], atmosphere: '#7cc4ff', clouds: 0.5, caps: 0.2 },
  gas: { kind: 'gas', colors: ['#7a5a3a', '#c9a878', '#e8d9b4', '#b98a5a', '#f1e6cc'], atmosphere: '#f0d9a8' },
  lava: { kind: 'lava', colors: ['#1a0f0c', '#3b1a12', '#8a2a12', '#f0641e'], atmosphere: '#ff7a3a' },
  asteroid: { kind: 'asteroid', colors: ['#3a3632', '#5e5850', '#8a8378', '#b3ab9e'], craters: 0.75, lumpiness: 0.22 },
};

/** A look for a TakeOn body: the kind from its type, the colours pulled toward its palette tint. */
export function flightLookForBody(body: BodyDef): FlightBodyLook {
  const hint = `${body.kind ?? ''} ${body.id}`.toLowerCase();
  const kind: FlightBodyKind =
    body.type === 'asteroid' ? 'asteroid'
    : body.type === 'gaseous' ? 'gas'
    : /ice|europa|enceladus|frozen/.test(hint) ? 'ice'
    : /earth|ocean|terra/.test(hint) ? 'ocean'
    : /lava|io\b|volcan/.test(hint) ? 'lava'
    : 'rocky';
  const base = FLIGHT_LOOKS[kind];
  const tint = body.palette.tint;
  const colors = tint
    ? base.colors.map((c) => {
        const [r, g, b] = parseHex(c);
        const mix = (v: number, t: number) => Math.round(Math.max(0, Math.min(255, v * (0.45 + 0.55 * t))));
        return `#${[mix(r, tint[0]), mix(g, tint[1]), mix(b, tint[2])].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      })
    : base.colors;
  return { ...base, colors, seed: body.seed };
}

/** Seamless noise on the unit sphere, built from the engine's 2D fields. */
function sphereNoise(x: number, y: number, z: number, f: number, seed: number, octaves = 4): number {
  return (
    fbm2(x * f + 11.3, y * f + 3.1, seed, octaves) +
    fbm2(y * f + 5.7, z * f + 17.9, seed + 101, octaves) +
    fbm2(z * f + 23.5, x * f + 7.3, seed + 211, octaves)
  ) / 3;
}

export interface BodyTexture {
  width: number;
  height: number;
  /** RGB, row-major, equirectangular: x is longitude, y is latitude from the north pole. */
  data: Uint8ClampedArray;
}

/** Paint the body's surface map. Deterministic for a look; no DOM. */
export function bodyTexture(look: FlightBodyLook, width = 256, height = 128): BodyTexture {
  const colors = (look.colors.length >= 2 ? look.colors : FLIGHT_LOOKS[look.kind].colors).map(parseHex);
  const data = new Uint8ClampedArray(width * height * 3);
  const seed = look.seed | 0;
  const craters = look.craters ?? 0;
  const clouds = look.clouds ?? 0;
  const caps = look.caps ?? 0;
  for (let j = 0; j < height; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI;
    const cy = Math.sin(lat);
    const cr = Math.cos(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2;
      const x = cr * Math.sin(lon);
      const z = cr * Math.cos(lon);
      let t: number;
      let shade = 1;
      if (look.kind === 'gas') {
        // Latitude bands, sheared by turbulence so they are never ruler-straight.
        const turb = sphereNoise(x, cy, z, 2.2, seed, 3) - 0.5;
        t = 0.5 + 0.5 * Math.sin((cy + turb * 0.35) * 11 + sphereNoise(x, cy, z, 0.9, seed + 7, 2) * 3);
        t = t * 0.8 + sphereNoise(x, cy, z, 6, seed + 3, 3) * 0.2;
      } else {
        t = sphereNoise(x, cy, z, 1.7, seed, 5);
        t = Math.max(0, Math.min(1, (t - 0.28) / 0.44));
        if (look.kind === 'lava') t = Math.pow(1 - Math.abs(2 * t - 1), 3);
        if (look.kind === 'ocean' && t < 0.5) shade = 0.82 + t * 0.36;
      }
      let [r, g, b] = ramp(colors, t);
      if (craters > 0) {
        const c = worley2(x * 7 + cy * 3, z * 7 - cy * 3, seed + 31, 'f1');
        const rim = c > 0.16 && c < 0.24 ? 1.16 : c <= 0.16 ? 0.72 + c * 1.6 : 1;
        shade *= 1 + (rim - 1) * Math.min(1, craters * 1.4) * (sphereNoise(x, cy, z, 3, seed + 41, 2) > 1 - craters ? 1 : 0.25);
      }
      r *= shade; g *= shade; b *= shade;
      if (caps > 0) {
        const edge = 1 - caps * 0.5 + (sphereNoise(x, cy, z, 5, seed + 53, 3) - 0.5) * 0.12;
        const k = Math.max(0, Math.min(1, (Math.abs(cy) - edge) / 0.05));
        r += (244 - r) * k; g += (248 - g) * k; b += (252 - b) * k;
      }
      if (clouds > 0) {
        const c = sphereNoise(x + 3.3, cy, z - 1.7, 3.1, seed + 67, 5);
        const k = Math.max(0, Math.min(1, (c - (0.62 - clouds * 0.2)) / 0.14)) * 0.9;
        r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
      }
      const o = (j * width + i) * 3;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
    }
  }
  return { width, height, data };
}

export interface BodyRasterOptions {
  /** Body radius in output pixels. */
  radius: number;
  /** Unit vector toward the sun in view space (x right, y up, z toward the viewer). */
  light?: [number, number, number];
  /**
   * The part of the disc to draw, in pixels relative to the body centre
   * (y down). Defaults to the whole disc. An orbit view passes just the limb.
   */
  window?: { x: number; y: number; width: number; height: number };
}

/**
 * A lit globe as pixels. The geometry (which surface point each pixel sees and
 * how brightly it is lit) is worked out once; `draw` then only looks the
 * surface up at a new rotation, so the globe can turn every frame.
 */
export class BodyRaster {
  readonly width: number;
  readonly height: number;
  /** Top-left of the drawn window relative to the body centre. */
  readonly originX: number;
  readonly originY: number;
  readonly pixels: Uint8ClampedArray;
  private lonIndex: Float32Array;
  private rowIndex: Float32Array;
  private light: Float32Array;
  private rim: Float32Array;
  private alpha: Uint8ClampedArray;
  private atmosphere: Rgb | null;

  constructor(private texture: BodyTexture, look: FlightBodyLook, opts: BodyRasterOptions) {
    const R = Math.max(2, opts.radius);
    const lump = Math.max(0, Math.min(0.35, look.lumpiness ?? 0));
    const reach = Math.ceil(R * (1 + lump + (look.atmosphere ? 0.09 : 0))) + 2;
    const win = opts.window ?? { x: -reach, y: -reach, width: reach * 2, height: reach * 2 };
    this.width = Math.max(1, Math.round(win.width));
    this.height = Math.max(1, Math.round(win.height));
    this.originX = Math.round(win.x);
    this.originY = Math.round(win.y);
    const n = this.width * this.height;
    this.pixels = new Uint8ClampedArray(n * 4);
    this.lonIndex = new Float32Array(n);
    this.rowIndex = new Float32Array(n).fill(-1);
    this.light = new Float32Array(n);
    this.rim = new Float32Array(n);
    this.alpha = new Uint8ClampedArray(n);
    this.atmosphere = look.atmosphere ? parseHex(look.atmosphere) : null;
    const l = opts.light ?? [-0.55, 0.45, 0.7];
    const ll = Math.hypot(l[0], l[1], l[2]) || 1;
    const lx = l[0] / ll, ly = l[1] / ll, lz = l[2] / ll;
    const tilt = look.tilt ?? 0.3;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const seed = look.seed | 0;
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        const sx = (px + this.originX + 0.5) / R;
        const sy = -(py + this.originY + 0.5) / R;
        let d = Math.hypot(sx, sy);
        // A lumpy body keeps a sphere's shading inside an uneven outline.
        const edge = lump > 0 ? 1 + lump * (fbm2(Math.atan2(sy, sx) * 1.6 + 9, 0.5, seed + 5, 3) * 2 - 1) : 1;
        const i = py * this.width + px;
        if (d >= edge) {
          // Just outside the limb an atmosphere still glows.
          if (this.atmosphere && d < edge + 0.08) {
            const lit = Math.max(0, Math.min(1, ((sx / d) * lx + (sy / d) * ly + 0.12) / 0.5));
            this.rim[i] = Math.pow(1 - (d - edge) / 0.08, 2) * (0.25 + 0.75 * lit);
          }
          continue;
        }
        d /= edge;
        const nx = sx / edge, ny = sy / edge;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        // Undo the axial tilt to find the body-fixed latitude and longitude.
        const bx = nx * ct + ny * st;
        const by = -nx * st + ny * ct;
        this.rowIndex[i] = Math.max(0, Math.min(texture.height - 1.001, (0.5 - Math.asin(Math.max(-1, Math.min(1, by))) / Math.PI) * texture.height - 0.5));
        this.lonIndex[i] = Math.atan2(bx, nz) / (Math.PI * 2);
        const lambert = nx * lx + ny * ly + nz * lz;
        // A soft terminator, a little night-side fill and darker limbs.
        const lit = Math.max(0, Math.min(1, (lambert + 0.12) / 0.5));
        this.light[i] = (0.05 + 0.95 * lit) * (0.72 + 0.28 * nz);
        // The glow reaches full strength exactly at the limb, where the halo outside takes over.
        if (this.atmosphere) this.rim[i] = Math.pow(1 - nz, 3) * (0.25 + 0.75 * lit);
        // Under an atmosphere the limb melts into the glow; an airless limb is a clean edge.
        this.alpha[i] = this.atmosphere ? 255 : Math.round(255 * Math.max(0, Math.min(1, (1 - d) * R * edge)));
      }
    }
  }

  /** Fill `pixels` (RGBA) for the body turned by `rotation` radians about its axis. */
  draw(rotation: number): Uint8ClampedArray {
    const { texture, pixels, lonIndex, rowIndex, light, rim, alpha, atmosphere } = this;
    const tw = texture.width, th = texture.height, td = texture.data;
    const turn = rotation / (Math.PI * 2);
    for (let i = 0, o = 0; i < rowIndex.length; i++, o += 4) {
      const row = rowIndex[i]!;
      const glow = rim[i]!;
      if (row < 0) {
        if (atmosphere && glow > 0) {
          pixels[o] = atmosphere[0]; pixels[o + 1] = atmosphere[1]; pixels[o + 2] = atmosphere[2];
          pixels[o + 3] = Math.round(glow * 255);
        } else pixels[o + 3] = 0;
        continue;
      }
      // Bilinear, so a globe magnified for an orbit view stays smooth.
      let u = lonIndex[i]! + turn;
      u = (u - Math.floor(u)) * tw - 0.5;
      if (u < 0) u += tw;
      const x0 = Math.floor(u), fx = u - x0, x1 = (x0 + 1) % tw;
      const y0 = Math.floor(row), fy = row - y0, y1 = Math.min(th - 1, y0 + 1);
      const a = (y0 * tw + x0) * 3, b2 = (y0 * tw + x1) * 3, c = (y1 * tw + x0) * 3, d = (y1 * tw + x1) * 3;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      const k = light[i]!;
      let r = (td[a]! * wa + td[b2]! * wb + td[c]! * wc + td[d]! * wd) * k;
      let g = (td[a + 1]! * wa + td[b2 + 1]! * wb + td[c + 1]! * wc + td[d + 1]! * wd) * k;
      let b = (td[a + 2]! * wa + td[b2 + 2]! * wb + td[c + 2]! * wc + td[d + 2]! * wd) * k;
      if (atmosphere) {
        r += (atmosphere[0] - r) * glow; g += (atmosphere[1] - g) * glow; b += (atmosphere[2] - b) * glow;
      }
      pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = alpha[i]!;
    }
    return pixels;
  }
}
