import { getAsset } from './assets.js';

/**
 * A build site: the timeline of ground work and construction a base goes
 * through, drawn only. Jobs queue one after another (or stand finished when
 * added `instant`), and every question a renderer asks is answered for the
 * site's current time:
 *
 * - `roughen`: lumps and hollows over an area (unbroken ground).
 * - `scatter`: boulders and scrub over an area.
 * - `clear`: dozers sweep out from the centre and the debris goes.
 * - `flatten`: the lumps are graded away to one level, edges eased.
 * - `build`: a structure rises (see `constructionParts`).
 * - `road`: a road is laid tile by tile along a path, a paver at its tip.
 *
 * Pure and DOM-free: positions are world tiles, time is seconds.
 */

export interface SitePoint {
  x: number;
  y: number;
}

export interface SiteArea {
  center: SitePoint;
  radius: number;
}

interface Timed {
  start: number;
  dur: number;
}

export interface SiteBuilding extends Timed {
  id: string;
  asset: string;
  at: SitePoint;
  /** Quarter turns. */
  facing: 0 | 1 | 2 | 3;
}

export interface SiteRoad extends Timed {
  path: SitePoint[];
}

export interface SiteDebris {
  x: number;
  y: number;
  kind: 'boulder' | 'scrub';
  size: number;
  seed: number;
}

export interface SiteVehicle {
  kind: 'dozer' | 'paver';
  x: number;
  y: number;
  /** Radians, world frame. */
  heading: number;
}

/** Ground work and construction durations, in seconds, when a job names none. */
export const SITE_SECONDS = { clear: 3.2, flatten: 3.4, road: 1.6 };

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = smooth(x - xi), ty = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Tiles from `a` to `b`, along x first and then y: a road's path. */
export function lPath(a: SitePoint, b: SitePoint): SitePoint[] {
  const out: SitePoint[] = [{ x: a.x, y: a.y }];
  let x = a.x, y = a.y;
  while (x !== b.x) {
    x += Math.sign(b.x - x);
    out.push({ x, y });
  }
  while (y !== b.y) {
    y += Math.sign(b.y - y);
    out.push({ x, y });
  }
  return out;
}

export class BuildSite {
  time = 0;
  /** When the queue next frees up. */
  private cursor = 0;
  private roughArea: (SiteArea & { amp: number; seed: number }) | null = null;
  private clearJob: (SiteArea & Timed) | null = null;
  private flattenJob: (SiteArea & Timed & { level: number }) | null = null;
  readonly debris: SiteDebris[] = [];
  readonly buildings: SiteBuilding[] = [];
  readonly roads: SiteRoad[] = [];
  private nextId = 0;

  constructor(readonly seed = 1) {}

  setTime(t: number): void {
    this.time = t;
  }

  /** Book `dur` seconds on the queue; returns the start. Instant jobs finished long ago. */
  private book(dur: number, instant: boolean): number {
    if (instant) return -1e9;
    const start = Math.max(this.time, this.cursor);
    this.cursor = start + dur;
    return start;
  }

  /** Seconds from now until every queued job is done. */
  remaining(): number {
    return Math.max(0, this.cursor - this.time);
  }

  roughen(area: SiteArea, amp = 0.9): this {
    this.roughArea = { ...area, amp, seed: this.seed ^ 0x51e };
    return this;
  }

  /** Boulders and scrub over an area, on tiles `standable` allows. */
  scatter(area: SiteArea, standable: (x: number, y: number) => boolean, density = 0.22): this {
    const r = Math.ceil(area.radius);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = area.center.x + dx, y = area.center.y + dy;
        if (Math.hypot(dx, dy) > area.radius || !standable(x, y)) continue;
        const roll = hash(x, y, this.seed ^ 0xdeb);
        if (roll > density) continue;
        const jx = (hash(x, y, this.seed ^ 0x1) - 0.5) * 0.6;
        const jy = (hash(x, y, this.seed ^ 0x2) - 0.5) * 0.6;
        this.debris.push({ x: x + jx, y: y + jy, kind: roll < density * 0.55 ? 'boulder' : 'scrub', size: 0.6 + hash(x, y, this.seed ^ 0x3) * 0.7, seed: Math.floor(roll * 1e6) });
      }
    return this;
  }

  /** Sweep the area clear. Returns seconds until done. */
  clear(area: SiteArea, opts: { dur?: number; instant?: boolean } = {}): number {
    const dur = opts.dur ?? SITE_SECONDS.clear;
    this.clearJob = { ...area, start: this.book(dur, !!opts.instant), dur };
    return this.remaining();
  }

  /** Grade the area to `level`. Returns seconds until done. */
  flatten(area: SiteArea, level: number, opts: { dur?: number; instant?: boolean } = {}): number {
    const dur = opts.dur ?? SITE_SECONDS.flatten;
    this.flattenJob = { ...area, level, start: this.book(dur, !!opts.instant), dur };
    return this.remaining();
  }

  /** Raise a structure. Returns seconds until done. */
  build(asset: string, at: SitePoint, opts: { facing?: 0 | 1 | 2 | 3; dur?: number; instant?: boolean; id?: string } = {}): number {
    const dur = opts.dur ?? getAsset(asset)?.buildSeconds ?? 3;
    this.buildings.push({ id: opts.id ?? `${asset}-${this.nextId++}`, asset, at: { ...at }, facing: opts.facing ?? 0, start: this.book(dur, !!opts.instant), dur });
    return this.remaining();
  }

  /** Take a building away at once (a survey flag the agency replaces). */
  remove(id: string): void {
    const i = this.buildings.findIndex((b) => b.id === id);
    if (i >= 0) this.buildings.splice(i, 1);
  }

  /** Lay a road along a path of tiles. Returns seconds until done. */
  road(path: SitePoint[], opts: { dur?: number; instant?: boolean } = {}): number {
    if (path.length < 2) return this.remaining();
    const dur = opts.dur ?? Math.max(0.8, SITE_SECONDS.road * (path.length / 6));
    this.roads.push({ path: path.map((p) => ({ ...p })), start: this.book(dur, !!opts.instant), dur });
    return this.remaining();
  }

  /** 0..1 through a timed job. */
  progress(job: Timed | null): number {
    if (!job) return 0;
    return Math.max(0, Math.min(1, (this.time - job.start) / Math.max(1e-6, job.dur)));
  }

  /** How cleared a tile is (0 untouched, 1 swept). */
  cleared(x: number, y: number): number {
    const j = this.clearJob;
    if (!j) return 0;
    const front = smooth(this.progress(j)) * (j.radius + 1.5);
    return Math.max(0, Math.min(1, front - Math.hypot(x - j.center.x, y - j.center.y)));
  }

  /** How graded a tile is toward the flatten level (0..1), eased at the rim. */
  flattened(x: number, y: number): number {
    const j = this.flattenJob;
    if (!j) return 0;
    const d = Math.hypot(x - j.center.x, y - j.center.y);
    const rim = 1 - smooth((d - j.radius) / 2.5);
    if (rim <= 0) return 0;
    const front = smooth(this.progress(j)) * (j.radius + 4);
    return rim * Math.max(0, Math.min(1, (front - d) / 1.5));
  }

  /** The ground's display height at a tile, given the height it would otherwise draw at. */
  heightAt(x: number, y: number, base: number): number {
    let h = base;
    const r = this.roughArea;
    if (r) {
      const d = Math.hypot(x - r.center.x, y - r.center.y);
      const fall = 1 - smooth((d - r.radius) / 2);
      if (fall > 0) h += ((noise(x * 0.32, y * 0.32, r.seed) - 0.5) * 1.4 + (noise(x * 0.8, y * 0.8, r.seed ^ 7) - 0.5) * 0.5) * 2 * r.amp * fall;
    }
    const j = this.flattenJob;
    if (j) {
      const f = this.flattened(x, y);
      if (f > 0) h += (j.level - h) * f;
    }
    return Math.max(0, h);
  }

  /** Changes whenever the ground would draw differently (a renderer re-caches on change). */
  terrainKey(): string {
    const q = (job: Timed | null) => (job ? Math.round(this.progress(job) * 24) : -1);
    return `${this.roughArea ? 1 : 0}:${q(this.clearJob)}:${q(this.flattenJob)}:${this.flattenJob?.level ?? ''}`;
  }

  /** Debris still standing, with how much of it is left (it shrinks as the sweep reaches it). */
  standingDebris(): (SiteDebris & { left: number })[] {
    const out: (SiteDebris & { left: number })[] = [];
    for (const d of this.debris) {
      const left = 1 - this.cleared(d.x, d.y);
      if (left > 0.02) out.push({ ...d, left });
    }
    return out;
  }

  buildProgress(b: SiteBuilding): number {
    return this.progress(b);
  }

  roadProgress(r: SiteRoad): number {
    return this.progress(r);
  }

  /** Buildings whose work has begun (or that stand finished). */
  shownBuildings(): SiteBuilding[] {
    return this.buildings.filter((b) => this.time >= b.start);
  }

  /** Machines at work right now. */
  vehicles(): SiteVehicle[] {
    const out: SiteVehicle[] = [];
    const sweep = (job: (SiteArea & Timed) | null, outward: boolean) => {
      if (!job) return;
      const p = this.progress(job);
      if (p <= 0 || p >= 1) return;
      for (let i = 0; i < 2; i++) {
        const k = smooth(p);
        const r = job.radius * (outward ? 0.25 + 0.8 * k : 1 - 0.7 * k);
        const a = p * Math.PI * 3.2 + i * Math.PI;
        out.push({ kind: 'dozer', x: job.center.x + Math.cos(a) * r, y: job.center.y + Math.sin(a) * r, heading: a + Math.PI / 2 });
      }
    };
    sweep(this.clearJob, true);
    sweep(this.flattenJob, false);
    for (const road of this.roads) {
      const p = this.progress(road);
      if (p <= 0 || p >= 1) continue;
      const at = pointAlong(road.path, p);
      out.push({ kind: 'paver', x: at.x, y: at.y, heading: at.heading });
    }
    return out;
  }
}

/** A point `t` (0..1) of the way along a tile path, with its heading. */
export function pointAlong(path: readonly SitePoint[], t: number): { x: number; y: number; heading: number } {
  const segs = path.length - 1;
  if (segs < 1) return { x: path[0]?.x ?? 0, y: path[0]?.y ?? 0, heading: 0 };
  const pos = Math.max(0, Math.min(segs - 1e-6, t * segs));
  const i = Math.floor(pos);
  const k = pos - i;
  const a = path[i], b = path[i + 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}
