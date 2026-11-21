import { FIELD_DEMS } from './dems.generated.js';

/**
 * Real terrain for fields (KES-543).
 *
 * A patch is a window cut from a real digital terrain model: HiRISE stereo
 * DTMs for Mars (1 m/px), Kaguya Terrain Camera DTMs for the Moon. Heights are
 * real metres above the window's lowest point. `scripts/fetch-field-dems.py`
 * cuts them from the USGS analysis-ready data (CC0) and writes
 * `dems.generated.ts`; hosts can add their own with `registerFieldDem`.
 */

export interface FieldDemPatch {
  id: string;
  /** 'mars', 'moon', ... — which style a recipe should pair it with. */
  body: string;
  /** Short credit for a HUD: place, body and instrument. */
  label: string;
  /** Attribution: instrument, product id, place. */
  source: string;
  /** Grid edge length (square, row-major, row 0 is north). */
  size: number;
  /** Ground sample distance, metres per cell. */
  gsd: number;
  /** Highest point above the lowest, metres. */
  relief: number;
  /** Window centre in the source DTM's projected metres. */
  centre: [number, number];
  /** Heights in decimetres, little-endian int16, base64. */
  dm: string;
}

export interface FieldDem {
  id: string;
  body: string;
  label: string;
  source: string;
  size: number;
  gsd: number;
  /** Side length in metres. */
  extent: number;
  heights: Float32Array;
}

const patches = new Map<string, FieldDemPatch>(FIELD_DEMS.map(p => [p.id, p]));
const decoded = new Map<string, FieldDem>();

export function registerFieldDem(patch: FieldDemPatch): void {
  patches.set(patch.id, patch);
  decoded.delete(patch.id);
}

export function listFieldDems(body?: string): FieldDemPatch[] {
  return [...patches.values()].filter(p => !body || p.body === body);
}

/** The decoded patch, in metres, or undefined if no such id is registered. */
export function getFieldDem(id: string): FieldDem | undefined {
  const hit = decoded.get(id);
  if (hit) return hit;
  const p = patches.get(id);
  if (!p) return undefined;
  const bytes = decodeBase64(p.dm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = p.size * p.size;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = view.getInt16(i * 2, true) / 10;
  const dem: FieldDem = { id: p.id, body: p.body, label: p.label, source: p.source, size: p.size, gsd: p.gsd, extent: (p.size - 1) * p.gsd, heights };
  decoded.set(id, dem);
  return dem;
}

/** Bilinear height in metres at (x, y) metres from the patch's north-west corner. */
export function sampleFieldDem(dem: FieldDem, x: number, y: number): number {
  const s = dem.size;
  const gx = Math.max(0, Math.min(s - 1.0001, x / dem.gsd));
  const gy = Math.max(0, Math.min(s - 1.0001, y / dem.gsd));
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const h = dem.heights, i = iy * s + ix;
  const a = h[i], b = h[i + 1], c = h[i + s], d = h[i + s + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** DOM-free base64 decode (the engine runs in tests without atob). */
function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buf = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out;
}
