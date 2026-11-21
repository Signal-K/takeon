import type { FieldDeposit, FieldTerrain } from './terrain.js';

/**
 * Mining from orbit and from the ground (KES-543). Pure and DOM-free.
 *
 * `FieldOrbiter` is the mining ship on a low pass: it drifts north at orbital
 * speed, the stick slides it east and west and trims the drift, and when it
 * runs off the north edge the next pass starts at the south edge.
 * `FieldMiner` is the laser: it only locks onto a deposit a scan has shown and
 * that is within range of the emitter's ground point, and it cuts at a fixed
 * rate until the deposit is empty.
 */

export interface OrbiterSpec {
  /** Height above the landing site, metres. */
  altitude: number;
  /** Drift north, m/s, and how much the stick can trim it. */
  drift: number;
  trim: number;
  /** Lateral speed at full stick, m/s. */
  slide: number;
}

export const DEFAULT_ORBITER: OrbiterSpec = { altitude: 55, drift: 6, trim: 4, slide: 12 };

export class FieldOrbiter {
  x: number;
  y: number;
  readonly altitude: number;
  /** Bank in radians, from lateral speed; the renderer tilts the ship by it. */
  bank = 0;
  vx = 0;
  vy = 0;
  pass = 1;
  private input = { x: 0, y: 0 };
  private acc = 0;
  /** Called when a pass ends and the ship comes round again. */
  onPass: ((pass: number) => void) | null = null;

  constructor(readonly terrain: FieldTerrain, readonly spec: OrbiterSpec = DEFAULT_ORBITER) {
    this.x = terrain.landing.x;
    this.y = terrain.size - this.margin;
    this.altitude = terrain.height(terrain.landing.x, terrain.landing.y) + spec.altitude;
  }

  get margin(): number {
    return Math.min(30, this.terrain.size * 0.15);
  }

  setInput(input: { x: number; y: number }): void {
    this.input = input;
  }

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
    const ix = Math.max(-1, Math.min(1, this.input.x));
    const iy = Math.max(-1, Math.min(1, this.input.y));
    const wantX = ix * spec.slide;
    // Screen up (negative y) speeds the drift, down slows it; never stops or reverses.
    const wantY = -(spec.drift - iy * spec.trim);
    const k = Math.min(1, dt * 2.5);
    this.vx += (wantX - this.vx) * k;
    this.vy += (wantY - this.vy) * k;
    this.x = Math.max(this.margin * 0.5, Math.min(terrain.size - this.margin * 0.5, this.x + this.vx * dt));
    this.y += this.vy * dt;
    this.bank += (-(this.vx / spec.slide) * 0.45 - this.bank) * k;
    if (this.y < this.margin) {
      this.y = terrain.size - this.margin;
      this.pass++;
      this.onPass?.(this.pass);
    }
  }
}

export interface MinerSpec {
  /** Ground distance from the emitter's footprint the laser reaches, metres. */
  range: number;
  /** Units cut per second. */
  rate: number;
}

export const ORBIT_LASER: MinerSpec = { range: 45, rate: 1.6 };
export const ROVER_LASER: MinerSpec = { range: 7, rate: 1.0 };

export class FieldMiner {
  /** Units left in each deposit. */
  readonly left = new Map<string, number>();
  /** Units cut, by resource. */
  readonly hold = new Map<string, number>();
  target: FieldDeposit | null = null;
  firing = false;

  constructor(readonly terrain: FieldTerrain, readonly revealed: ReadonlySet<string>, readonly spec: MinerSpec) {
    for (const d of terrain.deposits) this.left.set(d.id, Math.round(d.r * 6));
  }

  /** The nearest scanned, unemptied deposit within range of (x, y), or null. */
  nearest(x: number, y: number, prefer?: { x: number; y: number }): FieldDeposit | null {
    let best: FieldDeposit | null = null, bd = Infinity;
    for (const d of this.terrain.deposits) {
      if (!this.revealed.has(d.id) || (this.left.get(d.id) ?? 0) <= 0) continue;
      const reach = Math.hypot(d.x - x, d.y - y);
      if (reach > this.spec.range + d.r) continue;
      const score = prefer ? Math.hypot(d.x - prefer.x, d.y - prefer.y) : reach;
      if (score < bd) { bd = score; best = d; }
    }
    return best;
  }

  /**
   * Advance the laser. `on` is the trigger; (x, y) the emitter's ground point.
   * Returns what was cut this step.
   */
  update(dt: number, on: boolean, x: number, y: number, prefer?: { x: number; y: number }): { resource: string; amount: number } | null {
    if (!on) {
      this.firing = false;
      this.target = null;
      return null;
    }
    const keep = this.target && (this.left.get(this.target.id) ?? 0) > 0 &&
      Math.hypot(this.target.x - x, this.target.y - y) <= this.spec.range + this.target.r && !prefer;
    if (!keep) this.target = this.nearest(x, y, prefer);
    this.firing = !!this.target;
    if (!this.target) return null;
    const left = this.left.get(this.target.id) ?? 0;
    const amount = Math.min(left, this.spec.rate * dt);
    this.left.set(this.target.id, left - amount);
    this.hold.set(this.target.resource, (this.hold.get(this.target.resource) ?? 0) + amount);
    return { resource: this.target.resource, amount };
  }

  get total(): number {
    let t = 0;
    for (const v of this.hold.values()) t += v;
    return t;
  }
}
