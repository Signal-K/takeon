/**
 * Kit physics: a small, deterministic rigid-body world for a site's game
 * objects. Every object on a site (rocks, scrub, crates, poles, buildings,
 * machines) has a body here, and one set of rules moves them all:
 *
 * - gravity pulls dynamic bodies down onto the ground the host supplies;
 * - on the ground they slide down slopes, and friction slows them;
 * - bodies collide (circle and axis-aligned box footprints with height), so
 *   a dozer's blade shoves rocks, rocks shove each other and stop against walls;
 * - kinematic bodies (machines) are moved by script and push what they hit;
 *   static bodies (buildings, poles) never move;
 * - bodies at rest sleep, and wake when hit or when the ground under them changes.
 *
 * Units: x and y in tiles, z (height) in tiles, time in seconds. Fixed 60 Hz
 * steps, so the same inputs give the same motion. Pure and DOM-free.
 */

export type BodyType = 'static' | 'kinematic' | 'dynamic';

export type Shape = { kind: 'circle'; r: number } | { kind: 'box'; hx: number; hy: number };

export interface Body {
  id: string;
  type: BodyType;
  shape: Shape;
  x: number;
  y: number;
  /** Height of the body's base. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Height of the body, for vertical overlap. */
  h: number;
  mass: number;
  /** Ground friction coefficient. */
  friction: number;
  /** Bounce on landing, 0..1. */
  restitution: number;
  /** Yaw in radians, drawn only. */
  heading: number;
  /** Distance rolled, for a rolling body's drawn spin. */
  rolled: number;
  sleeping: boolean;
  onGround: boolean;
  /** Snapped to the ground on the next step (a body added before the ground was known). */
  settle: boolean;
  /** Seconds spent slow, toward sleep. */
  idle: number;
}

export type BodyInit = Partial<Body> & Pick<Body, 'id' | 'type' | 'shape' | 'x' | 'y'>;

export const PHYSICS_STEP = 1 / 60;
/** Longest stretch of time a single advance will simulate; the rest is skipped. */
export const PHYSICS_CATCH_UP = 8;

const SLEEP_SPEED = 0.06;
const SLEEP_AFTER = 0.4;

export function makeBody(init: BodyInit): Body {
  return {
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    h: 0.3,
    mass: 1,
    friction: 0.6,
    restitution: 0.2,
    heading: 0,
    rolled: 0,
    sleeping: false,
    onGround: false,
    settle: true,
    idle: 0,
    ...init,
  };
}

/** The footprint's half extents along x and y. */
export function extents(b: Body): [number, number] {
  return b.shape.kind === 'circle' ? [b.shape.r, b.shape.r] : [b.shape.hx, b.shape.hy];
}

export class PhysicsWorld {
  /** Tiles per second squared. */
  gravity = 9;
  /** Ground height (tiles) at a world point. Set by the host. */
  ground: (x: number, y: number) => number = () => 0;
  /** Called before each fixed step with the step's time (move kinematic bodies here). */
  beforeStep: ((t: number) => void) | null = null;
  time = 0;
  readonly bodies: Body[] = [];
  private byId = new Map<string, Body>();

  add(init: BodyInit): Body {
    const b = makeBody(init);
    this.remove(b.id);
    this.bodies.push(b);
    this.byId.set(b.id, b);
    if (b.type !== 'dynamic') this.wakeAround(b);
    return b;
  }

  get(id: string): Body | undefined {
    return this.byId.get(id);
  }

  remove(id: string): void {
    const b = this.byId.get(id);
    if (!b) return;
    this.byId.delete(id);
    this.bodies.splice(this.bodies.indexOf(b), 1);
    this.wakeAround(b);
  }

  /** Wake every dynamic body near another (it appeared, went or moved). */
  wakeAround(b: Body, pad = 0.6): void {
    const [ex, ey] = extents(b);
    for (const o of this.bodies) {
      if (o.type !== 'dynamic' || !o.sleeping) continue;
      if (Math.abs(o.x - b.x) < ex + pad + 1 && Math.abs(o.y - b.y) < ey + pad + 1) o.sleeping = false;
    }
  }

  /** Wake everything (the ground changed under them). */
  wakeAll(): void {
    for (const b of this.bodies) if (b.type === 'dynamic') b.sleeping = false;
  }

  /** Run fixed steps up to time `t`. Going back in time only moves the clock. */
  advance(t: number): void {
    if (t <= this.time) {
      this.time = t;
      return;
    }
    if (t - this.time > PHYSICS_CATCH_UP) this.time = t - PHYSICS_CATCH_UP;
    while (this.time + PHYSICS_STEP <= t + 1e-9) {
      this.time += PHYSICS_STEP;
      this.beforeStep?.(this.time);
      this.step(PHYSICS_STEP);
    }
  }

  /** Ground slope (dz/dx, dz/dy) at a point. */
  slope(x: number, y: number): [number, number] {
    const e = 0.25;
    return [(this.ground(x + e, y) - this.ground(x - e, y)) / (2 * e), (this.ground(x, y + e) - this.ground(x, y - e)) / (2 * e)];
  }

  step(dt: number): void {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.settle) {
        b.z = this.ground(b.x, b.y);
        b.settle = false;
        b.onGround = true;
      }
      if (b.type === 'static') continue;
      if (b.type === 'kinematic') {
        b.z = this.ground(b.x, b.y);
        continue;
      }
      if (b.sleeping) {
        // A sleeping body wakes if the ground moved from under it.
        if (Math.abs(this.ground(b.x, b.y) - b.z) > 0.01) b.sleeping = false;
        else continue;
      }
      const floor = this.ground(b.x, b.y);
      b.onGround = b.z <= floor + 0.01;
      if (b.onGround) {
        // Down the slope, less what friction holds back.
        const [sx, sy] = this.slope(b.x, b.y);
        const k = 1 / (1 + sx * sx + sy * sy);
        let ax = -g * sx * k, ay = -g * sy * k;
        const speed = Math.hypot(b.vx, b.vy);
        const fr = b.friction * g * Math.sqrt(k);
        if (speed > 1e-4) {
          ax -= (b.vx / speed) * fr;
          ay -= (b.vy / speed) * fr;
          const nvx = b.vx + ax * dt, nvy = b.vy + ay * dt;
          // Friction stops a body; it never turns it round.
          if (nvx * b.vx + nvy * b.vy <= 0 && Math.hypot(-g * sx * k, -g * sy * k) <= fr) {
            b.vx = 0;
            b.vy = 0;
          } else {
            b.vx = nvx;
            b.vy = nvy;
          }
        } else if (Math.hypot(ax, ay) > fr) {
          // Static friction gives way on a steep enough slope.
          const a = Math.hypot(ax, ay);
          b.vx += (ax / a) * (a - fr) * dt;
          b.vy += (ay / a) * (a - fr) * dt;
        }
        if (b.vz < 0) b.vz = 0;
      } else {
        b.vz -= g * dt;
      }
      const ox = b.x, oy = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const under = this.ground(b.x, b.y);
      if (b.z < under) {
        // Landing: bounce a little, or follow the ground.
        b.vz = b.vz < -0.8 ? -b.vz * b.restitution : 0;
        b.z = under;
        b.onGround = true;
      } else if (b.onGround && b.z - under < 0.06 && b.vz <= 0) {
        b.z = under;
      }
      if (b.shape.kind === 'circle') b.rolled += Math.hypot(b.x - ox, b.y - oy);
    }
    this.collide();
    for (const b of this.bodies) {
      if (b.type !== 'dynamic' || b.sleeping) continue;
      const slow = Math.hypot(b.vx, b.vy, b.vz) < SLEEP_SPEED && b.onGround;
      b.idle = slow ? b.idle + dt : 0;
      if (b.idle > SLEEP_AFTER) {
        b.sleeping = true;
        b.vx = b.vy = b.vz = 0;
      }
    }
  }

  private collide(): void {
    const list = this.bodies;
    // A pair matters when one side is dynamic and one side is moving.
    const moving = (x: Body) => x.type === 'kinematic' || (x.type === 'dynamic' && !x.sleeping);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (a.type !== 'dynamic' && b.type !== 'dynamic') continue;
          if (!moving(a) && !moving(b)) continue;
          const [aex, aey] = extents(a), [bex, bey] = extents(b);
          if (Math.abs(a.x - b.x) > aex + bex || Math.abs(a.y - b.y) > aey + bey) continue;
          if (a.z + a.h <= b.z || b.z + b.h <= a.z) continue;
          const hit = contact(a, b);
          if (hit) resolve(a, b, hit[0], hit[1], hit[2]);
        }
      }
    }
  }
}

/** Contact normal (from a to b) and depth, or null. */
function contact(a: Body, b: Body): [number, number, number] | null {
  if (a.shape.kind === 'circle' && b.shape.kind === 'circle') {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const depth = a.shape.r + b.shape.r - d;
    if (depth <= 0) return null;
    return d > 1e-6 ? [dx / d, dy / d, depth] : [1, 0, depth];
  }
  if (a.shape.kind === 'circle' && b.shape.kind === 'box') {
    const hit = circleBox(a.x, a.y, a.shape.r, b);
    return hit ? [-hit[0], -hit[1], hit[2]] : null;
  }
  if (a.shape.kind === 'box' && b.shape.kind === 'circle') return circleBox(b.x, b.y, b.shape.r, a);
  // Two boxes: push apart along the shallower axis.
  const [aex, aey] = extents(a), [bex, bey] = extents(b);
  const ox = aex + bex - Math.abs(b.x - a.x), oy = aey + bey - Math.abs(b.y - a.y);
  if (ox <= 0 || oy <= 0) return null;
  return ox < oy ? [Math.sign(b.x - a.x) || 1, 0, ox] : [0, Math.sign(b.y - a.y) || 1, oy];
}

/** Normal from the box out to the circle, and depth. */
function circleBox(cx: number, cy: number, r: number, box: Body): [number, number, number] | null {
  const [hx, hy] = extents(box);
  const lx = cx - box.x, ly = cy - box.y;
  const qx = Math.max(-hx, Math.min(hx, lx)), qy = Math.max(-hy, Math.min(hy, ly));
  const dx = lx - qx, dy = ly - qy;
  const d = Math.hypot(dx, dy);
  if (d > 1e-6) return d < r ? [dx / d, dy / d, r - d] : null;
  // Centre inside the box: out through the nearest side.
  const px = hx - Math.abs(lx), py = hy - Math.abs(ly);
  return px < py ? [Math.sign(lx) || 1, 0, px + r] : [0, Math.sign(ly) || 1, py + r];
}

function resolve(a: Body, b: Body, nx: number, ny: number, depth: number): void {
  const ia = a.type === 'dynamic' ? 1 / a.mass : 0;
  const ib = b.type === 'dynamic' ? 1 / b.mass : 0;
  const sum = ia + ib;
  if (sum <= 0) return;
  // Separate.
  a.x -= nx * depth * (ia / sum);
  a.y -= ny * depth * (ia / sum);
  b.x += nx * depth * (ib / sum);
  b.y += ny * depth * (ib / sum);
  // Exchange momentum along the normal (a kinematic body counts as infinitely heavy).
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) {
    const e = Math.min(a.restitution, b.restitution);
    const j = (-(1 + e) * rv) / sum;
    a.vx -= j * ia * nx;
    a.vy -= j * ia * ny;
    b.vx += j * ib * nx;
    b.vy += j * ib * ny;
  }
  if (a.type === 'dynamic') {
    a.sleeping = false;
    a.idle = 0;
  }
  if (b.type === 'dynamic') {
    b.sleeping = false;
    b.idle = 0;
  }
}
