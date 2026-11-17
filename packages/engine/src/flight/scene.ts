import type { BodyDef } from '../types.js';
import { defaultCraftLook, type FlightCraftLook } from './craft.js';
import { flightLookForBody, type FlightBodyLook } from './look.js';
import { FlightSim, type FlightConfig, type FlightEvent, type FlightPhase, type FlightState } from './sim.js';
import { FlightView } from './view.js';

/**
 * The embeddable space flight scene: one canvas, the Go flight rules, the 3D
 * view and the input. A host supplies where the flight is going and what the
 * craft looks like, and draws its own HUD from `snapshot()`.
 */

export interface FlightSnapshot {
  phase: FlightPhase;
  /** 0..100. */
  percent: number;
  /** Whole boost charges ready to spend. */
  boosts: number;
  /** 0..1 toward the next charge. */
  boostCharge: number;
  boosting: boolean;
  hull: number;
  hits: number;
  pickups: number;
  samples: number;
  laps: number;
  /** Orbit site under the craft that has not been marked yet. */
  canMark: boolean;
  overhead: string | null;
  marked: number;
  sites: number;
  /** One line a host may show. */
  prompt: string;
}

/** Pure read of a flight state. */
export function flightSnapshot(state: FlightState, sites = 0): FlightSnapshot {
  const canMark = state.phase === 'orbit' && !!state.overhead && !state.marked.includes(state.overhead);
  const prompt =
    state.phase === 'departure' ? 'Leaving orbit. Hold your course.'
    : state.phase === 'cruise' ? (state.slowed ? 'Hit. Steer clear of debris.' : 'Steer through the rings. Avoid debris.')
    : state.phase === 'approach' ? 'On approach. Slowing for orbit.'
    : canMark ? 'Over a site. Mark it.'
    : sites > state.marked.length ? 'In orbit. Wait for the next site.'
    : 'In orbit.';
  return {
    phase: state.phase,
    percent: Math.round(state.progress * 100),
    boosts: Math.floor(state.boost + 1e-9),
    boostCharge: state.boost - Math.floor(state.boost + 1e-9),
    boosting: state.boosting,
    hull: state.hull,
    hits: state.hits,
    pickups: state.pickups,
    samples: state.samples,
    laps: state.laps,
    canMark,
    overhead: state.overhead ?? null,
    marked: state.marked.length,
    sites,
    prompt,
  };
}

export interface FlightSceneOptions {
  canvas: HTMLCanvasElement;
  config: FlightConfig;
  /** A TakeOn body, or a look a host built itself. */
  destination: BodyDef | FlightBodyLook;
  craft?: FlightCraftLook;
  /** Keyboard and pointer steering. Pass false when the host has its own controls. Default true. */
  controls?: boolean;
  /** A `snapshot()` string from an earlier flight. */
  resume?: string;
  onEvent?: (event: FlightEvent, state: FlightState) => void;
}

export interface FlightSceneHandle {
  sim: FlightSim;
  view: FlightView;
  start(): void;
  stop(): void;
  resize(width: number, height: number, dpr?: number): void;
  /** Hold a nudge, each axis -1..1 (x right, y up). Stays until changed. */
  steer(x: number, y: number): void;
  boost(): boolean;
  mark(): boolean;
  /** Host-paced flights: where the trip clock is, 0..1. */
  setProgress(progress: number): void;
  setCraft(craft: FlightCraftLook): void;
  /** Advance and draw one frame by hand (tests, a paused host). */
  frame(dt: number): void;
  snapshot(): FlightSnapshot;
  save(): string;
  destroy(): void;
}

const isLook = (d: BodyDef | FlightBodyLook): d is FlightBodyLook => Array.isArray((d as FlightBodyLook).colors);

export function createFlightScene(opts: FlightSceneOptions): FlightSceneHandle {
  const sim = new FlightSim(opts.config, { resume: opts.resume });
  const destination = isLook(opts.destination) ? opts.destination : flightLookForBody(opts.destination);
  const view = new FlightView(opts.canvas, { destination, craft: opts.craft ?? defaultCraftLook(), sites: opts.config.sites });
  const sites = opts.config.sites?.length ?? 0;
  let raf = 0;
  let last = 0;
  let hostX = 0, hostY = 0;
  const keys = new Set<string>();
  let pointer: { x: number; y: number } | null = null;

  const applySteer = () => {
    let x = hostX, y = hostY;
    if (keys.has('ArrowLeft') || keys.has('a')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) x += 1;
    if (keys.has('ArrowUp') || keys.has('w')) y += 1;
    if (keys.has('ArrowDown') || keys.has('s')) y -= 1;
    if (pointer) {
      // Steer toward where the finger is, relative to the middle of the scene.
      const rect = opts.canvas.getBoundingClientRect();
      const tx = ((pointer.x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ty = 1 - ((pointer.y - rect.top) / Math.max(1, rect.height)) * 2;
      const s = sim.state;
      x += sim.state.phase === 'orbit' ? tx : (tx * 1.15 - s.x) * 3;
      y += sim.state.phase === 'orbit' ? ty : (ty * 1.15 - s.y) * 3;
    }
    sim.steer(x, y);
  };

  const frame = (dt: number) => {
    applySteer();
    const events = sim.step(dt);
    view.react(events);
    view.draw(sim.state, dt);
    for (const e of events) opts.onEvent?.(e, sim.state);
  };
  const loop = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    frame(dt);
    raf = requestAnimationFrame(loop);
  };

  const keyName = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const STEER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'];
  const onKeyDown = (e: KeyboardEvent) => {
    const k = keyName(e);
    if (STEER_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
    else if (k === ' ' && !e.repeat) { if (sim.state.phase === 'orbit') sim.mark(); else sim.boost(); e.preventDefault(); }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(keyName(e));
  const onBlur = () => { keys.clear(); pointer = null; };
  const onPointerDown = (e: PointerEvent) => { pointer = { x: e.clientX, y: e.clientY }; };
  const onPointerMove = (e: PointerEvent) => { if (pointer) pointer = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = () => { pointer = null; };
  const controls = opts.controls !== false && typeof window !== 'undefined';
  if (controls) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    opts.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; };
  return {
    sim,
    view,
    start: () => { if (!raf) raf = requestAnimationFrame(loop); },
    stop,
    resize: (width, height, dpr) => view.resize(width, height, dpr),
    steer: (x, y) => { hostX = Number.isFinite(x) ? x : 0; hostY = Number.isFinite(y) ? y : 0; },
    boost: () => sim.boost(),
    mark: () => sim.mark(),
    setProgress: (p) => sim.setProgress(p),
    setCraft: (craft) => view.setCraft(craft),
    frame,
    snapshot: () => flightSnapshot(sim.state, sites),
    save: () => sim.snapshot(),
    destroy: () => {
      stop();
      if (controls) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        opts.canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      }
      sim.dispose();
    },
  };
}
