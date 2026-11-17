import { coreCall } from '../go/sync.js';

/**
 * Space flight simulation. Every rule runs in the Go core (`go/flight.go`);
 * this class is the synchronous host handle over it.
 *
 * Control is limited by design: the craft keeps its course, and the player
 * nudges it inside a corridor, spends boost and marks sites from orbit.
 */

export type FlightPhase = 'departure' | 'cruise' | 'approach' | 'orbit';

/** A place on the destination the craft passes over while in orbit. */
export interface FlightSite {
  id: string;
  label?: string;
  /** Radians around the orbit. */
  angle: number;
}

export interface FlightConfig {
  seed: number;
  /** Nominal seconds from departure to orbit (5..3600, default 60). Ignored when `hostPaced`. */
  duration?: number;
  /** The host owns course progress (a persisted trip clock) and reports it with `setProgress`. */
  hostPaced?: boolean;
  /** Chance, 0..1, that a corridor slot holds debris. */
  debris?: number;
  /** Chance, 0..1, that a free corridor slot holds a boost cell or a sample. */
  pickups?: number;
  /** How quickly the craft answers a nudge. 1 is standard. */
  agility?: number;
  /** Boost charges at the start, 0..3. */
  boostCharges?: number;
  /** Mount only part of a flight, e.g. `'orbit'` for an in-orbit scene. */
  startPhase?: FlightPhase;
  /** Seconds per lap in orbit (default 40). */
  orbitPeriod?: number;
  sites?: FlightSite[];
}

export interface FlightObject {
  id: number;
  kind: 'debris' | 'boost' | 'sample';
  /** Corridor units ahead of the craft; negative once passed. */
  z: number;
  /** Corridor position, -1..1. */
  x: number;
  y: number;
  r: number;
  spin: number;
  /** Already hit or collected. */
  done?: boolean;
}

export interface FlightEvent {
  kind: 'phase' | 'hit' | 'pickup' | 'sample' | 'boost' | 'lap' | 'site' | 'overhead';
  detail?: string;
  amount?: number;
}

export interface FlightState {
  phase: FlightPhase;
  time: number;
  /** 0..1 along the course. 1 is orbit. */
  progress: number;
  scroll: number;
  speed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Boost charges held; a boost spends one whole charge. */
  boost: number;
  boosting: boolean;
  slowed: boolean;
  /** 1 is untouched. Never falls below 0.1: a flight cannot be lost. */
  hull: number;
  hits: number;
  pickups: number;
  samples: number;
  /** Orbit: radians around the body, and height as a share of the nominal orbit (0.75..1.35). */
  angle: number;
  altitude: number;
  laps: number;
  /** Site under the craft right now. */
  overhead?: string;
  marked: string[];
  objects: FlightObject[];
}

export class FlightSim {
  private id: number;
  private disposed = false;
  private steerX = 0;
  private steerY = 0;
  private progress: number | undefined;
  private current: FlightState;
  readonly config: FlightConfig;

  constructor(config: FlightConfig, opts: { resume?: string } = {}) {
    if (!Number.isSafeInteger(config.seed)) throw new Error('takeon: flight seed must be a safe integer');
    this.config = { ...config, seed: config.seed >>> 0 };
    this.id = opts.resume
      ? coreCall<number>('flight', { kind: 'restore', snapshot: opts.resume })
      : coreCall<number>('flight', { kind: 'create', flight: this.config });
    this.current = this.call<FlightState>('state');
  }

  private call<T>(kind: string, args: Record<string, unknown> = {}): T {
    if (this.disposed) throw new Error('takeon: flight is disposed');
    return coreCall<T>('flight', { ...args, kind, engineId: this.id });
  }

  /** The state after the last step. */
  get state(): FlightState {
    return this.current;
  }

  /** Hold a nudge, each axis -1..1. Applied on the next step. */
  steer(x: number, y: number): void {
    this.steerX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.steerY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  }

  /** Host-paced flights only: where the trip clock is, 0..1. */
  setProgress(progress: number): void {
    if (Number.isFinite(progress)) this.progress = Math.max(0, Math.min(1, progress));
  }

  /** Spend one boost charge. False when there is none or one is burning. */
  boost(): boolean {
    return this.call<boolean>('boost');
  }

  /** Record the orbit site under the craft. False when nothing is overhead or it is already recorded. */
  mark(): boolean {
    const ok = this.call<boolean>('mark');
    if (ok) this.current = this.call<FlightState>('state');
    return ok;
  }

  /** Advance by `dt` seconds (fixed 1/60 s ticks inside). Returns the events raised. */
  step(dt: number): FlightEvent[] {
    if (!Number.isFinite(dt) || dt < 0 || dt > 60) throw new Error('takeon: dt must be between 0 and 60 seconds');
    const frame = this.call<{ state: FlightState; events: FlightEvent[] }>('step', {
      dt,
      fx: this.steerX,
      fy: this.steerY,
      ...(this.progress === undefined ? {} : { progress: this.progress }),
    });
    this.current = frame.state;
    return frame.events;
  }

  /** Opaque versioned save; pass it back as `resume`. */
  snapshot(): string {
    return this.call<string>('snapshot');
  }

  dispose(): void {
    if (this.disposed) return;
    this.call('dispose');
    this.disposed = true;
  }
}
