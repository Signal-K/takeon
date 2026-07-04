/** Deterministic seeded RNG (mulberry32) and hashing helpers. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D integer hash -> [0,1). Stable across runs. */
export function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x * 374761393), 668265263);
  h = Math.imul(h ^ (y * 2246822519), 3266489917);
  h ^= h >>> 15;
  h = Math.imul(h, 2654435761);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x, y * 31 + z * 977, seed ^ 0x9e3779b9);
}

let idCounter = 0;
/** Compact unique-enough id for records created client-side. */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 46656;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(3, '0')}${Math.floor(
    Math.random() * 46656,
  ).toString(36)}`;
}
