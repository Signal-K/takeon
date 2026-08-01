import { hash2 } from '../rng.js';

/**
 * Worley (cellular) noise. Each grid cell holds one feature point; the value
 * is the distance to the nearest one, so it reads as cracked plates, basalt
 * columns, dry lakebeds or crater fields depending on how it is combined.
 */

export type WorleyMode =
  /** Distance to the nearest point: bubbles/craters. */
  | 'f1'
  /** F2 − F1: bright seams between cells — cracks and fault lines. */
  | 'f2f1'
  /** 1 − F1: plateaus with sunken joints. */
  | 'cells';

export function worley2(x: number, y: number, seed: number, mode: WorleyMode = 'f1'): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      // Feature point placed inside the cell by two decorrelated hashes.
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 8191);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }

  if (mode === 'f2f1') return clamp01(f2 - f1);
  if (mode === 'cells') return clamp01(1 - f1);
  return clamp01(f1);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
