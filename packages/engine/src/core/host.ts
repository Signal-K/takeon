import type { MissionState } from '../types.js';
import type { EventBus } from '../util/events.js';
import { PROTOCOL_VERSION, handleCommandMessage, streamEvents } from './protocol.js';
import type { CommandReply, CommandTarget, EventMessage, StreamEventsOptions } from './protocol.js';

/**
 * The packaged runtime's host side (KES-212 phase 3). One object a shell talks to with plain JSON messages:
 * commands (protocol v1), lifecycle (pause, resume, resize), a host-driven clock, and save. A WebView bridge,
 * a test harness or a replay tape all speak this; none of them touches `RoverGame` directly.
 *
 * Inbound messages carry `v` and a `kind`; a message with no `kind` is a command (the protocol v1 shape), so
 * existing command senders keep working. Adding a kind keeps the version.
 */
export const RUNTIME_VERSION = '1.0.0';

/** Who drives time. `frames`: the runtime's own animation-frame loop. `host`: only `advance` messages move it. */
export type RuntimeClock = 'frames' | 'host';

export type HostInbound =
  | { v: number; kind?: 'command'; id?: string; command: unknown }
  | { v: number; kind: 'pause' }
  | { v: number; kind: 'resume' }
  | { v: number; kind: 'resize'; width: number; height: number; dpr?: number }
  | { v: number; kind: 'advance'; ms: number }
  | { v: number; kind: 'save'; id?: string };

export type HostOutbound =
  | { v: number; kind: 'ready'; runtime: string; protocol: number; clock: RuntimeClock }
  | ({ kind: 'reply' } & CommandReply)
  | ({ kind: 'event' } & EventMessage)
  | { v: number; kind: 'advanced'; steps: number }
  | { v: number; kind: 'state'; id?: string; state: MissionState }
  | { v: number; kind: 'error'; id?: string; error: 'version' | 'invalid' | 'unknown-kind' };

/** What the runtime needs from a game. `RoverGame` satisfies it. */
export interface RuntimeGame extends CommandTarget {
  readonly events: EventBus;
  start(): void;
  stop(): void;
  resize(cssW: number, cssH: number, dpr?: number): void;
  advance(seconds: number): number;
  draw(): void;
  save(): MissionState;
  dispose(): void;
}

export interface HostRuntimeOptions extends StreamEventsOptions {
  clock?: RuntimeClock;
}

export interface HostRuntime {
  /** Handles one inbound message. Never throws on bad input; problems come back as `error` messages. */
  receive(msg: unknown): void;
  readonly clock: RuntimeClock;
  readonly paused: boolean;
  /** Stops the clock and the event stream and disposes the game. */
  dispose(): void;
}

const MAX_ADVANCE_MS = 60_000;
const MAX_SIDE = 16_384;
const isSize = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_SIDE;

/** Wraps a game in the host bridge and announces `ready`. `send` must not throw. */
export function createHostRuntime(game: RuntimeGame, send: (msg: HostOutbound) => void, opts: HostRuntimeOptions = {}): HostRuntime {
  const clock: RuntimeClock = opts.clock ?? 'frames';
  const v = PROTOCOL_VERSION;
  let paused = false;
  let disposed = false;
  const stopEvents = streamEvents(game.events, (e) => send({ kind: 'event', ...e }), opts);
  if (clock === 'frames') game.start();
  send({ v, kind: 'ready', runtime: RUNTIME_VERSION, protocol: v, clock });

  const receive = (input: unknown): void => {
    if (disposed) return;
    const m = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const id = typeof m.id === 'string' ? m.id : undefined;
    const err = (error: 'version' | 'invalid' | 'unknown-kind') => send(id === undefined ? { v, kind: 'error', error } : { v, kind: 'error', id, error });
    const kind = m.kind ?? 'command';
    if (kind === 'command') {
      send({ kind: 'reply', ...handleCommandMessage(game, m) });
      return;
    }
    if (m.v !== v) return err('version');
    switch (kind) {
      case 'pause':
        if (!paused && clock === 'frames') game.stop();
        paused = true;
        return;
      case 'resume':
        if (paused && clock === 'frames') game.start();
        paused = false;
        return;
      case 'resize': {
        const dpr = m.dpr === undefined ? 1 : m.dpr;
        if (!isSize(m.width) || !isSize(m.height) || !(typeof dpr === 'number' && dpr > 0 && dpr <= 8)) return err('invalid');
        game.resize(m.width, m.height, dpr);
        if (clock === 'host' || paused) game.draw();
        return;
      }
      case 'advance': {
        if (typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0 || m.ms > MAX_ADVANCE_MS) return err('invalid');
        // A paused runtime keeps its time still, whoever owns the clock. A host clock sends one advance per display
        // frame, so each one draws: interpolation and camera easing move per frame, not per 10 Hz step.
        const live = !paused && clock === 'host';
        const steps = live ? game.advance(m.ms / 1000) : 0;
        if (live) game.draw();
        send({ v, kind: 'advanced', steps });
        return;
      }
      case 'save': {
        const state = game.save();
        send(id === undefined ? { v, kind: 'state', state } : { v, kind: 'state', id, state });
        return;
      }
      default:
        return err('unknown-kind');
    }
  };

  return {
    receive,
    clock,
    get paused() { return paused; },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopEvents();
      game.dispose();
    },
  };
}
