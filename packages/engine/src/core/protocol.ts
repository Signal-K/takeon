import { GAME_EVENT_KEYS } from '../types.js';
import type { GameEventKey, GameEvents, StructureType, Vec2 } from '../types.js';
import type { EventBus } from '../util/events.js';

/**
 * The host protocol (KES-212): plain, JSON-safe messages a host sends to a
 * running TakeOn game, and the events it gets back. A native shell talking to
 * the bundle through a WebView bridge, a replay tape, or a test harness speaks
 * only this; none of them needs `RoverGame`'s method surface or the event bus.
 *
 * Messages carry `v` (the protocol version). A breaking change to a message
 * bumps it; adding a command or event does not.
 */
export const PROTOCOL_VERSION = 1;

type Dir = 0 | 1 | 2 | 3;

/** One instruction to the game. `type` names the matching `RoverGame` method. */
export type TakeOnCommand =
  | { type: 'move'; dir: Dir }
  | { type: 'walkTo'; x: number; y: number }
  | { type: 'planPath'; waypoints: Vec2[] }
  | { type: 'orderMine'; x: number; y: number }
  | { type: 'cancelOrder' }
  | { type: 'mine' }
  | { type: 'photo' }
  | { type: 'scan' }
  | { type: 'build'; structure: StructureType }
  | { type: 'rotateStructure'; id: string }
  | { type: 'demolish'; id: string }
  | { type: 'repair' }
  | { type: 'deposit' }
  | { type: 'launchCargo' }
  | { type: 'upgradeMobility' }
  | { type: 'craft'; recipe: string }
  | { type: 'placeBlock' }
  | { type: 'setView'; view: 'iso' | 'flat' }
  | { type: 'rotateView' };

export type TakeOnCommandType = TakeOnCommand['type'];

/** What a command needs from the game. `RoverGame` satisfies it; tests and other hosts can supply their own. */
export interface CommandTarget {
  move(dir: Dir): boolean;
  walkTo(x: number, y: number): void;
  planPath(waypoints: Vec2[]): boolean;
  orderMine(x: number, y: number): void;
  cancelOrder(): void;
  mine(): boolean;
  photo(): void;
  scan(): void;
  build(type: StructureType): boolean;
  rotateStructure(id: string): boolean;
  demolish(id: string): boolean;
  repair(): boolean;
  deposit(): number;
  launchCargo(): boolean;
  upgradeMobility(): boolean;
  craft(recipeId: string): boolean;
  placeBlock(): boolean;
  setView(kind: 'iso' | 'flat'): void;
  rotateView(): void;
}

/**
 * The outcome of one command. `ok` is false when the game refused it (a cliff,
 * no battery, a failed build); the matching `*Failed`/`blocked` event says why.
 * `value` carries a number result (`deposit`'s amount).
 */
export interface CommandResult {
  ok: boolean;
  value?: number;
}

/** Runs one command against the game. */
export function applyCommand(game: CommandTarget, cmd: TakeOnCommand): CommandResult {
  const done = (ok: boolean): CommandResult => ({ ok });
  switch (cmd.type) {
    case 'move': return done(game.move(cmd.dir));
    case 'walkTo': game.walkTo(cmd.x, cmd.y); return done(true);
    case 'planPath': return done(game.planPath(cmd.waypoints));
    case 'orderMine': game.orderMine(cmd.x, cmd.y); return done(true);
    case 'cancelOrder': game.cancelOrder(); return done(true);
    case 'mine': return done(game.mine());
    case 'photo': game.photo(); return done(true);
    case 'scan': game.scan(); return done(true);
    case 'build': return done(game.build(cmd.structure));
    case 'rotateStructure': return done(game.rotateStructure(cmd.id));
    case 'demolish': return done(game.demolish(cmd.id));
    case 'repair': return done(game.repair());
    case 'deposit': {
      const value = game.deposit();
      return { ok: value > 0, value };
    }
    case 'launchCargo': return done(game.launchCargo());
    case 'upgradeMobility': return done(game.upgradeMobility());
    case 'craft': return done(game.craft(cmd.recipe));
    case 'placeBlock': return done(game.placeBlock());
    case 'setView': game.setView(cmd.view); return done(true);
    case 'rotateView': game.rotateView(); return done(true);
  }
}

const NO_ARGS = new Set<TakeOnCommandType>([
  'cancelOrder', 'mine', 'photo', 'scan', 'repair', 'deposit', 'launchCargo', 'upgradeMobility', 'placeBlock', 'rotateView',
]);

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isTile = (v: unknown): v is Vec2 => {
  const t = v as Partial<Vec2> | null;
  return typeof t === 'object' && t !== null && isInt(t.x) && isInt(t.y);
};

/**
 * Validates a command from an untrusted source (a bridge message, a tape file)
 * and returns it in canonical form, or null. Unknown fields are dropped.
 */
export function parseCommand(input: unknown): TakeOnCommand | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  const type = c.type;
  if (typeof type !== 'string') return null;
  if (NO_ARGS.has(type as TakeOnCommandType)) return { type } as TakeOnCommand;
  switch (type) {
    case 'move':
      return isInt(c.dir) && c.dir >= 0 && c.dir <= 3 ? { type, dir: c.dir as Dir } : null;
    case 'walkTo':
    case 'orderMine':
      return isInt(c.x) && isInt(c.y) ? { type, x: c.x, y: c.y } : null;
    case 'planPath':
      return Array.isArray(c.waypoints) && c.waypoints.length > 0 && c.waypoints.length <= 256 && c.waypoints.every(isTile)
        ? { type, waypoints: c.waypoints.map((w) => ({ x: w.x, y: w.y })) }
        : null;
    case 'build':
      return isText(c.structure) ? { type, structure: c.structure as StructureType } : null;
    case 'rotateStructure':
    case 'demolish':
      return isText(c.id) ? { type, id: c.id } : null;
    case 'craft':
      return isText(c.recipe) ? { type, recipe: c.recipe } : null;
    case 'setView':
      return c.view === 'iso' || c.view === 'flat' ? { type, view: c.view } : null;
    default:
      return null;
  }
}

/** A command as it crosses a bridge. `id` comes back on the reply so the host can match them. */
export interface CommandMessage {
  v: number;
  id?: string;
  command: unknown;
}

export type CommandReply =
  | ({ v: number; id?: string } & CommandResult)
  | { v: number; id?: string; ok: false; error: 'version' | 'invalid' };

/** Validates and runs one bridge message, and builds its reply. Never throws on bad input. */
export function handleCommandMessage(game: CommandTarget, msg: unknown): CommandReply {
  const m = (typeof msg === 'object' && msg !== null ? msg : {}) as Partial<CommandMessage>;
  const id = typeof m.id === 'string' ? m.id : undefined;
  const base = id === undefined ? { v: PROTOCOL_VERSION } : { v: PROTOCOL_VERSION, id };
  if (m.v !== PROTOCOL_VERSION) return { ...base, ok: false, error: 'version' };
  const cmd = parseCommand(m.command);
  if (!cmd) return { ...base, ok: false, error: 'invalid' };
  return { ...base, ...applyCommand(game, cmd) };
}

/** An event as it crosses a bridge: the bus key and its payload. */
export interface EventMessage<K extends GameEventKey = GameEventKey> {
  v: number;
  type: K;
  payload: GameEvents[K];
}

export interface StreamEventsOptions {
  /** Which events to forward. Default: all but `tick` (10 per second is noise over a bridge). */
  keys?: readonly GameEventKey[];
}

/**
 * Forwards game events to a host as `EventMessage`s. Returns a function that
 * stops the stream. `send` must not throw; the bus already isolates handlers.
 */
export function streamEvents(bus: EventBus, send: (msg: EventMessage) => void, opts: StreamEventsOptions = {}): () => void {
  const keys = opts.keys ?? GAME_EVENT_KEYS.filter((k) => k !== 'tick');
  const offs = keys.map((type) =>
    bus.on(type, (payload) => send({ v: PROTOCOL_VERSION, type, payload } as EventMessage)),
  );
  return () => {
    for (const off of offs) off();
  };
}
