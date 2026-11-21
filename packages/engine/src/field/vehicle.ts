import type { Vec2 } from '../types.js';
import type { FieldTerrain } from './terrain.js';

/**
 * A rover driving on a field (KES-541).
 *
 * Input is a direction on screen. The field camera is north-up, so screen
 * direction and world direction are the same thing: push the stick right and
 * the rover drives right. It turns toward the stick first (skid-steer, so it
 * can pivot in place), then drives. Slopes push back in proportion to the
 * body's gravity, grades past `maxGrade` stop it, boulders block it.
 * Fixed-step and seedless, so the same inputs always give the same path.
 *
 * Commands (KES-543): `follow(route)` drives a planned route by itself, leg by
 * leg, slowing for the last waypoint; any manual input takes over and drops
 * the route. If it is held up for more than a second it gives up and calls
 * `onStuck`, so the host can replan.
 */

export interface FieldVehicleSpec {
  /** Body length and width in metres (heading runs along the length). */
  length: number;
  width: number;
  /** Top speed on flat ground, m/s. */
  maxSpeed: number;
  /** Turn rate, rad/s. */
  turnRate: number;
  /** Acceleration, m/s². */
  accel: number;
  /** Steepest rise per metre it can climb. */
  maxGrade: number;
}

export const DEFAULT_ROVER: FieldVehicleSpec = {
  length: 2.8, width: 2.0, maxSpeed: 4.2, turnRate: 3.2, accel: 5, maxGrade: 0.55,
};

export interface FieldInput {
  /** Desired direction on screen/world, any length; magnitude (clamped to 1) is throttle. */
  x: number;
  y: number;
}

export interface FieldTrackPoint { x: number; y: number; heading: number }

export class FieldVehicle {
  readonly spec: FieldVehicleSpec;
  x: number;
  y: number;
  /** Radians, 0 = east, +π/2 = south (screen down). */
  heading: number;
  speed = 0;
  /** Wheel spin phase in metres travelled, for tread animation. */
  odometer = 0;
  /** True while the rover is pushing against a slope or boulder it can't pass. */
  blocked = false;
  /** Body pitch and roll in radians, from the ground under it. */
  pitch = 0;
  roll = 0;
  private input: FieldInput = { x: 0, y: 0 };
  private acc = 0;
  /** Called with each new track stamp (about every 0.25 m). */
  onTrack: ((p: FieldTrackPoint) => void) | null = null;
  private lastTrack = 0;
  /** The waypoints still to drive, or null when idle or under manual control. */
  route: Vec2[] | null = null;
  /** Called when the last waypoint is reached. */
  onArrive: (() => void) | null = null;
  /** Called when a route is abandoned because the rover is held up. */
  onStuck: (() => void) | null = null;
  private heldUp = 0;

  constructor(readonly terrain: FieldTerrain, at = terrain.landing, heading = -Math.PI / 2, spec = DEFAULT_ROVER) {
    this.spec = spec;
    this.x = at.x;
    this.y = at.y;
    this.heading = heading;
    this.settle();
  }

  setInput(input: FieldInput): void {
    if (input.x || input.y) this.route = null;
    this.input = input;
  }

  /** Drive a planned route (from `FieldPlanner.plan`). An empty route is a no-op arrival. */
  follow(route: Vec2[]): void {
    this.route = route.length ? route.map(p => ({ x: p.x, y: p.y })) : null;
    this.heldUp = 0;
    if (!this.route) this.onArrive?.();
  }

  /** Drop any route and roll to a stop. */
  halt(): void {
    this.route = null;
  }

  /** Input that steers toward the next waypoint, advancing past reached ones. */
  private autopilot(): FieldInput {
    const r = this.route!;
    while (r.length) {
      const last = r.length === 1;
      const d = Math.hypot(r[0].x - this.x, r[0].y - this.y);
      if (d > (last ? 0.45 : 1.1)) break;
      r.shift();
    }
    if (!r.length) {
      this.route = null;
      this.onArrive?.();
      return { x: 0, y: 0 };
    }
    let left = Math.hypot(r[0].x - this.x, r[0].y - this.y);
    for (let i = 1; i < r.length; i++) left += Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y);
    const throttle = Math.max(0.3, Math.min(1, left / 3));
    const dx = r[0].x - this.x, dy = r[0].y - this.y, d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * throttle, y: (dy / d) * throttle };
  }

  /** Advance by real time; integrates in fixed 1/60 s steps. */
  update(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.25);
    const step = 1 / 60;
    while (this.acc >= step) {
      this.step(step);
      this.acc -= step;
    }
  }

  step(dt: number): void {
    const { spec, terrain } = this;
    const input = this.route ? this.autopilot() : this.input;
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    let target = 0;
    if (mag > 0.08) {
      const want = Math.atan2(input.y, input.x);
      const diff = wrap(want - this.heading);
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), spec.turnRate * dt);
      this.heading = wrap(this.heading + turn);
      // Only drive once roughly facing the stick: no wide arcs into rocks.
      const facing = Math.cos(diff);
      target = facing > 0.35 ? spec.maxSpeed * mag * facing : 0;
    }
    // Slope along the heading: climbing slows, descending speeds up a little.
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const [gx, gy] = terrain.gradient(this.x, this.y);
    const grade = gx * fx + gy * fy;
    const g = terrain.style.gravity;
    target *= Math.max(0.15, 1 - grade * 1.4);
    const dv = target - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), spec.accel * dt);
    this.speed -= grade * g * 0.25 * dt;
    if (this.speed < 0 && target === 0) this.speed = Math.min(0, this.speed + spec.accel * dt);

    const nx = this.x + fx * this.speed * dt;
    const ny = this.y + fy * this.speed * dt;
    this.blocked = false;
    // Too steep ahead: stop at the foot of it.
    const ahead = (terrain.height(nx + fx * 0.8, ny + fy * 0.8) - terrain.height(this.x, this.y)) / 0.8;
    if (this.speed > 0 && ahead > spec.maxGrade) {
      this.speed = 0;
      this.blocked = true;
      this.holdUp(dt);
      this.settle();
      return;
    }
    let px = nx, py = ny;
    // Boulders: push out of any we overlap, losing speed.
    const reach = spec.width * 0.55;
    for (const b of terrain.bouldersNear(px, py, reach)) {
      const dx = px - b.x, dy = py - b.y;
      const d = Math.hypot(dx, dy);
      const min = b.r + reach;
      if (d < min && d > 1e-6) {
        px = b.x + (dx / d) * min;
        py = b.y + (dy / d) * min;
        this.speed *= 0.6;
        this.blocked = true;
      }
    }
    if (this.blocked) this.holdUp(dt); else this.heldUp = 0;
    const edge = 1.5;
    px = Math.max(edge, Math.min(terrain.size - edge, px));
    py = Math.max(edge, Math.min(terrain.size - edge, py));
    const moved = Math.hypot(px - this.x, py - this.y);
    this.x = px;
    this.y = py;
    this.odometer += moved * Math.sign(this.speed || 1);
    this.lastTrack += moved;
    if (this.lastTrack > 0.25) {
      this.lastTrack = 0;
      this.onTrack?.({ x: this.x, y: this.y, heading: this.heading });
    }
    this.settle();
  }

  private holdUp(dt: number): void {
    if (!this.route) return;
    this.heldUp += dt;
    if (this.heldUp > 1.2) {
      this.route = null;
      this.heldUp = 0;
      this.onStuck?.();
    }
  }

  /** Pitch and roll from the ground under the wheels. */
  private settle(): void {
    const { terrain, spec } = this;
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const hl = spec.length / 2, hw = spec.width / 2;
    const front = terrain.height(this.x + fx * hl, this.y + fy * hl);
    const back = terrain.height(this.x - fx * hl, this.y - fy * hl);
    const left = terrain.height(this.x + fy * hw, this.y - fx * hw);
    const right = terrain.height(this.x - fy * hw, this.y + fx * hw);
    this.pitch = Math.atan2(front - back, spec.length);
    this.roll = Math.atan2(right - left, spec.width);
  }

  get z(): number {
    return this.terrain.height(this.x, this.y);
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
