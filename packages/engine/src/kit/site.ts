import { getAsset } from './assets.js';
import { modelBounds } from './mesh.js';
import { PhysicsWorld, type Body } from './physics.js';

/**
 * A build site: the timeline of ground work and construction a base goes
 * through. Jobs queue one after another (or stand finished when added
 * `instant`), and every question a renderer asks is answered for the site's
 * current time:
 *
 * - `roughen`: lumps and hollows over an area (unbroken ground).
 * - `scatter`: boulders and scrub over an area.
 * - `clear`: dozers push out from the centre, shoving the debris to the rim.
 * - `flatten`: the lumps are graded away to one level, edges eased.
 * - `build`: a structure rises (see `constructionParts`); finished stores
 *   get their delivery of crates and drums.
 * - `road`: a road is laid tile by tile along a path, a paver at its tip,
 *   street lamps (and, on request, a power line) going up beside it.
 *
 * Everything standing on the site is a game object (`SiteObject`) with a
 * body in one physics world (`physics`): debris, crates and drums are
 * dynamic, machines kinematic, buildings, lamps and poles static. Gravity,
 * slopes, friction and collisions apply to all of them alike, so a dozer
 * shoves rocks, rocks pile against each other, and a dropped crate lands
 * and settles on whatever ground the host reports (`physics.ground`).
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
  /** A power line runs beside it. */
  power: boolean;
}

export interface SiteDebris {
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

export type SiteObjectKind = 'debris' | 'building' | 'vehicle' | 'crate' | 'drum' | 'lamp' | 'pole';

/** Anything standing on the site: what it is, and its body. */
export interface SiteObject {
  id: string;
  kind: SiteObjectKind;
  body: Body;
  /** Variety for its look. */
  seed: number;
  debris?: SiteDebris;
  building?: SiteBuilding;
  vehicle?: SiteVehicle['kind'];
}

/** A power cable between two pole tops. */
export interface SiteWire {
  a: Body;
  b: Body;
}

/** Ground work and construction durations, in seconds, when a job names none. */
export const SITE_SECONDS = { clear: 3.2, flatten: 3.4, road: 1.6 };

/** Heights of the things that stand on a site, in tiles. */
export const SITE_HEIGHTS = { lamp: 0.62, pole: 0.95 };

/** What each finished building has delivered beside it. */
const DELIVERIES: Record<string, { crates: number; drums: number }> = {
  'launch-pad': { crates: 0, drums: 3 },
  warehouse: { crates: 5, drums: 0 },
  'fuel-depot': { crates: 0, drums: 4 },
  hangar: { crates: 3, drums: 0 },
  'assembly-hall': { crates: 4, drums: 1 },
  'drill-rig': { crates: 1, drums: 2 },
  habitat: { crates: 2, drums: 0 },
};

const INSTANT = -1e9;

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

/** A building's footprint in world tiles: centre and half extents (axis-aligned, quarter turns only). */
export function buildingFootprint(b: Pick<SiteBuilding, 'asset' | 'at' | 'facing'>): { x: number; y: number; hx: number; hy: number; h: number } | null {
  const def = getAsset(b.asset);
  if (!def) return null;
  const solids = def.model({ time: 0 }).filter((p) => p.kind !== 'flat' && p.kind !== 'light');
  if (!solids.length) return null;
  const [f0, f1, s0, s1, , top] = modelBounds(solids);
  const cf = (f0 + f1) / 2, cs = (s0 + s1) / 2;
  const hf = (f1 - f0) / 2, hs = (s1 - s0) / 2;
  const turn = b.facing % 4;
  const c = [1, 0, -1, 0][turn], s = [0, 1, 0, -1][turn];
  return { x: b.at.x + cf * c - cs * s, y: b.at.y + cf * s + cs * c, hx: turn % 2 ? hs : hf, hy: turn % 2 ? hf : hs, h: top };
}

export class BuildSite {
  time = 0;
  /** Every body on the site, under one set of rules. */
  readonly physics = new PhysicsWorld();
  /** When the queue next frees up. */
  private cursor = 0;
  private roughArea: (SiteArea & { amp: number; seed: number }) | null = null;
  private clearJob: (SiteArea & Timed) | null = null;
  private flattenJob: (SiteArea & Timed & { level: number }) | null = null;
  readonly buildings: SiteBuilding[] = [];
  readonly roads: SiteRoad[] = [];
  private readonly objectMap = new Map<string, SiteObject>();
  /** Lamps and poles a road puts up as its paver passes: fraction of the road, and where. */
  private readonly fixtures: { road: SiteRoad; at: number; id: string; kind: 'lamp' | 'pole'; x: number; y: number; heading: number; order: number }[] = [];
  private readonly delivered = new Set<string>();
  private nextId = 0;

  constructor(readonly seed = 1) {
    this.physics.beforeStep = (t) => {
      this.time = t;
      this.tick(t);
    };
  }

  /** Move the site to time `t`, running its physics up to it. */
  setTime(t: number): void {
    this.physics.advance(t);
    this.time = t;
  }

  /** Book `dur` seconds on the queue; returns the start. Instant jobs finished long ago. */
  private book(dur: number, instant: boolean): number {
    if (instant) return INSTANT;
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
        const kind = roll < density * 0.55 ? 'boulder' : 'scrub';
        const size = 0.6 + hash(x, y, this.seed ^ 0x3) * 0.7;
        const seed = Math.floor(roll * 1e6);
        const id = `debris-${x}-${y}`;
        const boulder = kind === 'boulder';
        const body = this.physics.add({
          id,
          type: 'dynamic',
          shape: { kind: 'circle', r: (boulder ? 0.2 : 0.12) * size },
          x: x + jx,
          y: y + jy,
          h: (boulder ? 0.22 : 0.24) * size,
          mass: boulder ? 3 * size * size * size : 0.4 * size,
          friction: boulder ? 0.55 : 0.95,
          restitution: boulder ? 0.25 : 0.05,
          heading: (seed % 628) / 100,
          sleeping: true,
        });
        this.objectMap.set(id, { id, kind: 'debris', body, seed, debris: { kind, size, seed } });
      }
    return this;
  }

  /** Sweep the area clear. Returns seconds until done. */
  clear(area: SiteArea, opts: { dur?: number; instant?: boolean } = {}): number {
    const dur = opts.dur ?? SITE_SECONDS.clear;
    this.clearJob = { ...area, start: this.book(dur, !!opts.instant), dur };
    if (opts.instant) {
      // Long since cleared: the debris already lies in heaps round the rim.
      const rim = area.radius + 1.5;
      for (const o of this.objectMap.values()) {
        if (o.kind !== 'debris') continue;
        const b = o.body;
        const dx = b.x - area.center.x, dy = b.y - area.center.y;
        const d = Math.hypot(dx, dy);
        if (d >= rim) continue;
        const a = d > 1e-3 ? Math.atan2(dy, dx) : (o.seed % 628) / 100;
        const out = rim + 0.15 + (o.seed % 7) * 0.08;
        b.x = area.center.x + Math.cos(a) * out;
        b.y = area.center.y + Math.sin(a) * out;
        b.settle = true;
        b.sleeping = false;
      }
    }
    return this.remaining();
  }

  /** Grade the area to `level`. Returns seconds until done. */
  flatten(area: SiteArea, level: number, opts: { dur?: number; instant?: boolean } = {}): number {
    const dur = opts.dur ?? SITE_SECONDS.flatten;
    this.flattenJob = { ...area, level, start: this.book(dur, !!opts.instant), dur };
    this.physics.wakeAll();
    return this.remaining();
  }

  /** Raise a structure. Returns seconds until done. */
  build(asset: string, at: SitePoint, opts: { facing?: 0 | 1 | 2 | 3; dur?: number; instant?: boolean; id?: string } = {}): number {
    const dur = opts.dur ?? getAsset(asset)?.buildSeconds ?? 3;
    this.buildings.push({ id: opts.id ?? `${asset}-${this.nextId++}`, asset, at: { ...at }, facing: opts.facing ?? 0, start: this.book(dur, !!opts.instant), dur });
    if (opts.instant) this.tick(this.time);
    return this.remaining();
  }

  /** Take a building away at once (a survey flag the agency replaces). */
  remove(id: string): void {
    const i = this.buildings.findIndex((b) => b.id === id);
    if (i >= 0) this.buildings.splice(i, 1);
    this.objectMap.delete(id);
    this.physics.remove(id);
  }

  /**
   * Lay a road along a path of tiles, with street lamps every few tiles on
   * one side and, when `power`, a line of poles carrying cable on the other.
   * Returns seconds until done.
   */
  road(path: SitePoint[], opts: { dur?: number; instant?: boolean; power?: boolean } = {}): number {
    if (path.length < 2) return this.remaining();
    const dur = opts.dur ?? Math.max(0.8, SITE_SECONDS.road * (path.length / 6));
    const road: SiteRoad = { path: path.map((p) => ({ ...p })), power: !!opts.power, start: this.book(dur, !!opts.instant), dur };
    this.roads.push(road);
    const n = road.path.length - 1;
    let order = 0;
    for (let i = 1; i < n; i++) {
      const a = road.path[i - 1], b = road.path[i + 1];
      // Across the road, to its right.
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const p = road.path[i];
      const fixture = (kind: 'lamp' | 'pole', side: number) => {
        const x = p.x + nx * 0.44 * side, y = p.y + ny * 0.44 * side;
        const id = `${kind}-${Math.round(x * 20)}-${Math.round(y * 20)}`;
        if (this.fixtures.some((f) => f.id === id)) return;
        // Lamp arms reach over the road; pole cross-arms stand across it.
        const heading = Math.atan2(dy, dx) + (kind === 'lamp' ? Math.PI : 0);
        this.fixtures.push({ road, at: i / n, id, kind, x, y, heading, order: order++ });
      };
      if (i % 3 === 1) fixture('lamp', 1);
      if (road.power) fixture('pole', -1);
    }
    if (opts.instant) this.tick(this.time);
    return this.remaining();
  }

  /** 0..1 through a timed job. */
  progress(job: Timed | null): number {
    if (!job) return 0;
    return Math.max(0, Math.min(1, (this.time - job.start) / Math.max(1e-6, job.dur)));
  }

  /** How far the clearing blade has pushed out from the centre, in tiles. */
  private clearFront(t = this.time): number {
    const j = this.clearJob;
    if (!j) return 0;
    const p = Math.max(0, Math.min(1, (t - j.start) / Math.max(1e-6, j.dur)));
    return smooth(p) * (j.radius + 1.5);
  }

  /** How cleared a tile is (0 untouched, 1 swept). */
  cleared(x: number, y: number): number {
    const j = this.clearJob;
    if (!j) return 0;
    return Math.max(0, Math.min(1, this.clearFront() - Math.hypot(x - j.center.x, y - j.center.y)));
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

  /** Every game object on the site now. */
  objects(): SiteObject[] {
    return [...this.objectMap.values()];
  }

  object(id: string): SiteObject | undefined {
    return this.objectMap.get(id);
  }

  /** Debris still on the site (all of it: it is shoved, never deleted). */
  standingDebris(): SiteObject[] {
    return this.objects().filter((o) => o.kind === 'debris');
  }

  /** Machines at work right now. */
  vehicles(): SiteVehicle[] {
    return this.objects()
      .filter((o) => o.kind === 'vehicle')
      .map((o) => ({ kind: o.vehicle!, x: o.body.x, y: o.body.y, heading: o.body.heading }));
  }

  /**
   * Cable spans between the poles that stand: each pole hangs its cable from
   * the nearest pole put up before it (within a couple of tiles), so the
   * lines along separate roads join into one grid.
   */
  wires(): SiteWire[] {
    const out: SiteWire[] = [];
    const poles: Body[] = [];
    for (const f of this.fixtures) {
      if (f.kind !== 'pole') continue;
      const b = this.physics.get(f.id);
      if (!b) continue;
      let best: Body | null = null, bestD = 2.3;
      for (const q of poles) {
        const d = Math.hypot(q.x - b.x, q.y - b.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      if (best) out.push({ a: best, b });
      poles.push(b);
    }
    return out;
  }

  /** The building whose footprint covers a world point, if any. */
  pick(x: number, y: number): SiteBuilding | null {
    for (const b of this.shownBuildings()) {
      const f = buildingFootprint(b);
      if (f && Math.abs(x - f.x) <= Math.max(f.hx, 0.5) && Math.abs(y - f.y) <= Math.max(f.hy, 0.5)) return b;
    }
    return null;
  }

  /** One fixed step of the timeline: bodies come and go, machines move, the blade pushes. */
  private tick(t: number): void {
    const dt = 1 / 60;
    // Buildings stand as solid footprints from the day their stakes go in.
    for (const b of this.buildings) {
      if (t < b.start || this.objectMap.has(b.id)) continue;
      const f = buildingFootprint(b);
      if (!f) continue;
      const body = this.physics.add({ id: b.id, type: 'static', shape: { kind: 'box', hx: f.hx, hy: f.hy }, x: f.x, y: f.y, h: f.h, heading: (b.facing * Math.PI) / 2 });
      this.objectMap.set(b.id, { id: b.id, kind: 'building', body, seed: 0, building: b });
    }
    // A finished store gets its delivery, dropped beside it.
    for (const b of this.buildings) {
      if (t < b.start + b.dur || this.delivered.has(b.id)) continue;
      this.delivered.add(b.id);
      this.deliver(b, b.start === INSTANT);
    }
    // Lamps and poles go up as the paver passes them, never inside a building.
    const walls = this.buildings.map((b) => this.objectMap.get(b.id)?.body).filter((b): b is Body => !!b && b.shape.kind === 'box');
    for (const f of [...this.fixtures]) {
      const blocked = walls.some((w) => w.shape.kind === 'box' && Math.abs(w.x - f.x) < w.shape.hx + 0.08 && Math.abs(w.y - f.y) < w.shape.hy + 0.08);
      if (blocked) {
        this.fixtures.splice(this.fixtures.indexOf(f), 1);
        if (this.objectMap.delete(f.id)) this.physics.remove(f.id);
        continue;
      }
      if (this.objectMap.has(f.id) || this.progress(f.road) < f.at) continue;
      const body = this.physics.add({ id: f.id, type: 'static', shape: { kind: 'circle', r: 0.05 }, x: f.x, y: f.y, heading: f.heading, h: f.kind === 'lamp' ? SITE_HEIGHTS.lamp : SITE_HEIGHTS.pole });
      this.objectMap.set(f.id, { id: f.id, kind: f.kind, body, seed: f.order });
    }
    // Machines: dozers ride the clearing blade and the grading front, a paver leads each road.
    const want: { id: string; kind: SiteVehicle['kind']; x: number; y: number; heading: number }[] = [];
    const cj = this.clearJob;
    if (cj) {
      const p = this.progress(cj);
      if (p > 0 && p < 1) {
        const front = this.clearFront(t);
        for (let i = 0; i < 2; i++) {
          const a = p * Math.PI * 3.2 + i * Math.PI;
          const r = Math.max(0.3, front - 0.3);
          want.push({ id: `dozer-${i}`, kind: 'dozer', x: cj.center.x + Math.cos(a) * r, y: cj.center.y + Math.sin(a) * r, heading: a + 0.6 });
        }
      }
    }
    const fj = this.flattenJob;
    if (fj) {
      const p = this.progress(fj);
      if (p > 0 && p < 1) {
        for (let i = 0; i < 2; i++) {
          const a = p * Math.PI * 3.2 + i * Math.PI;
          const r = fj.radius * (1 - 0.7 * smooth(p));
          want.push({ id: `dozer-${i}`, kind: 'dozer', x: fj.center.x + Math.cos(a) * r, y: fj.center.y + Math.sin(a) * r, heading: a + Math.PI / 2 });
        }
      }
    }
    this.roads.forEach((road, i) => {
      const p = this.progress(road);
      if (p <= 0 || p >= 1) return;
      const at = pointAlong(road.path, p);
      want.push({ id: `paver-${i}`, kind: 'paver', x: at.x, y: at.y, heading: at.heading });
    });
    const keep = new Set(want.map((w) => w.id));
    for (const o of [...this.objectMap.values()]) {
      if (o.kind === 'vehicle' && !keep.has(o.id)) {
        this.objectMap.delete(o.id);
        this.physics.remove(o.id);
      }
    }
    for (const w of want) {
      const o = this.objectMap.get(w.id);
      if (!o) {
        const body = this.physics.add({ id: w.id, type: 'kinematic', shape: { kind: 'circle', r: w.kind === 'dozer' ? 0.26 : 0.22 }, x: w.x, y: w.y, h: 0.35, heading: w.heading });
        this.objectMap.set(w.id, { id: w.id, kind: 'vehicle', body, seed: 0, vehicle: w.kind });
        continue;
      }
      const b = o.body;
      b.vx = (w.x - b.x) / dt;
      b.vy = (w.y - b.y) / dt;
      b.x = w.x;
      b.y = w.y;
      b.heading = w.heading;
    }
    // The clearing blade: debris inside the front is shoved out ahead of it.
    if (cj && t >= cj.start) {
      const front = this.clearFront(t);
      const speed = Math.max(0, (front - this.clearFront(t - dt)) / dt);
      for (const o of this.objectMap.values()) {
        if (o.kind !== 'debris') continue;
        const b = o.body;
        const dx = b.x - cj.center.x, dy = b.y - cj.center.y;
        const d = Math.hypot(dx, dy);
        const r = b.shape.kind === 'circle' ? b.shape.r : 0.1;
        if (d + r * 0.3 >= front) continue;
        const nx = d > 1e-4 ? dx / d : Math.cos(o.seed), ny = d > 1e-4 ? dy / d : Math.sin(o.seed);
        b.x = cj.center.x + nx * (front - r * 0.3);
        b.y = cj.center.y + ny * (front - r * 0.3);
        const radial = b.vx * nx + b.vy * ny;
        if (radial < speed) {
          b.vx += nx * (speed - radial);
          b.vy += ny * (speed - radial);
        }
        b.sleeping = false;
        b.idle = 0;
      }
    }
  }

  /** Crates and drums beside a finished building, dropped in (or long since settled). */
  private deliver(b: SiteBuilding, settled: boolean): void {
    const plan = DELIVERIES[b.asset];
    const f = buildingFootprint(b);
    if (!plan || !f) return;
    const total = plan.crates + plan.drums;
    for (let i = 0; i < total; i++) {
      const crate = i < plan.crates;
      const id = `${b.id}-${crate ? 'crate' : 'drum'}-${i}`;
      if (this.objectMap.has(id)) continue;
      // In a loose row along the building's front-right wall.
      const x = f.x + f.hx + 0.22 + (i % 2) * 0.22 + (hash(i, 3, this.seed) - 0.5) * 0.05;
      const y = f.y - f.hy + 0.2 + Math.floor(i / 2) * 0.26 + (hash(i, 5, this.seed) - 0.5) * 0.05;
      const body = this.physics.add({
        id,
        type: 'dynamic',
        shape: crate ? { kind: 'box', hx: 0.09, hy: 0.09 } : { kind: 'circle', r: 0.07 },
        x,
        y,
        h: crate ? 0.17 : 0.16,
        mass: crate ? 0.8 : 0.6,
        friction: crate ? 0.75 : 0.5,
        restitution: 0.3,
        heading: crate ? (hash(i, 9, this.seed) - 0.5) * 0.4 : 0,
        settle: true,
      });
      if (!settled) {
        // Dropped from a little height, one after another.
        body.settle = false;
        body.z = this.physics.ground(x, y) + 0.7 + i * 0.25;
      }
      this.objectMap.set(id, { id, kind: crate ? 'crate' : 'drum', body, seed: i });
    }
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
