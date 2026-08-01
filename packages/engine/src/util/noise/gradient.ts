import { hash2 } from '../rng.js';

/**
 * Gradient noises: Perlin and simplex.
 *
 * Both return roughly [0,1] like `valueNoise2`, so any of them can be dropped
 * into the same fractal stack. Gradients come from the shared integer hash, so
 * a given seed reproduces exactly — no permutation tables to ship or drift.
 */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Unit gradient vector for a lattice point. */
function grad(ix: number, iy: number, seed: number): [number, number] {
  const a = hash2(ix, iy, seed) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Classic Perlin gradient noise. Smoother and less grid-aligned than value
 * noise: ridges follow the gradients rather than the lattice, which reads as
 * wind-blown dunes and rolling relief rather than lumpy blobs.
 */
export function perlin2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;

  const dot = (ix: number, iy: number): number => {
    const [gx, gy] = grad(ix, iy, seed);
    return gx * (x - ix) + gy * (y - iy);
  };

  const u = fade(xf);
  const v = fade(yf);
  const n00 = dot(x0, y0);
  const n10 = dot(x0 + 1, y0);
  const n01 = dot(x0, y0 + 1);
  const n11 = dot(x0 + 1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  const n = nx0 + (nx1 - nx0) * v;
  // Perlin's range is about ±sqrt(2)/2; normalise into [0,1].
  return Math.max(0, Math.min(1, n * 0.7071 + 0.5));
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Simplex noise on a triangular lattice: no axis-aligned artefacts and a
 * cheaper kernel than Perlin at higher octave counts. Good default for
 * organic, isotropic terrain.
 */
export function simplex2(x: number, y: number, seed: number): number {
  // Skew the input space onto the simplex lattice.
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);

  // Which of the two triangles of the rhombus are we in?
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const corner = (cx: number, cy: number, ii: number, jj: number): number => {
    const t0 = 0.5 - cx * cx - cy * cy;
    if (t0 < 0) return 0;
    const [gx, gy] = grad(ii, jj, seed);
    const t2 = t0 * t0;
    return t2 * t2 * (gx * cx + gy * cy);
  };

  const n =
    corner(x0, y0, i, j) + corner(x1, y1, i + i1, j + j1) + corner(x2, y2, i + 1, j + 1);
  // The 70× scale is the standard normalisation for this kernel.
  return Math.max(0, Math.min(1, n * 35 + 0.5));
}
