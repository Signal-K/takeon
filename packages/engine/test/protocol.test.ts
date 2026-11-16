import { describe, expect, it } from 'vitest';
import {
  EventBus,
  PROTOCOL_VERSION,
  Simulation,
  applyCommand,
  defaultSpec,
  getBody,
  handleCommandMessage,
  parseCommand,
  streamEvents,
  type CommandTarget,
  type EventMessage,
  type RoverGame,
  type TakeOnCommand,
} from '../src/index.js';

// RoverGame must satisfy the protocol's target without an adapter.
const _gameIsTarget: (g: RoverGame) => CommandTarget = (g) => g;
void _gameIsTarget;

/** Records every call; returns `true` (or 3 for deposit) unless told otherwise. */
function spyTarget(result = true) {
  const calls: unknown[][] = [];
  const handler: ProxyHandler<object> = {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push([name, ...args]);
      return name === 'deposit' ? (result ? 3 : 0) : result;
    },
  };
  return { target: new Proxy({}, handler) as CommandTarget, calls };
}

const ALL: TakeOnCommand[] = [
  { type: 'move', dir: 2 },
  { type: 'walkTo', x: 4, y: 5 },
  { type: 'planPath', waypoints: [{ x: 1, y: 1 }, { x: 2, y: 3 }] },
  { type: 'orderMine', x: 7, y: 8 },
  { type: 'cancelOrder' },
  { type: 'mine' },
  { type: 'photo' },
  { type: 'scan' },
  { type: 'build', structure: 'solar' as never },
  { type: 'rotateStructure', id: 's1' },
  { type: 'demolish', id: 's1' },
  { type: 'repair' },
  { type: 'deposit' },
  { type: 'launchCargo' },
  { type: 'upgradeMobility' },
  { type: 'craft', recipe: 'bricks' },
  { type: 'placeBlock' },
  { type: 'setView', view: 'flat' },
  { type: 'rotateView' },
];

describe('host protocol (KES-212)', () => {
  it('round-trips every command through JSON and runs the matching method', () => {
    for (const cmd of ALL) {
      const wire = JSON.parse(JSON.stringify(cmd));
      expect(parseCommand(wire)).toEqual(cmd);
      const { target, calls } = spyTarget();
      expect(applyCommand(target, cmd).ok).toBe(true);
      expect(calls.map((c) => c[0])).toEqual([cmd.type]);
    }
  });

  it('passes the arguments through', () => {
    const { target, calls } = spyTarget();
    applyCommand(target, { type: 'walkTo', x: 4, y: 5 });
    applyCommand(target, { type: 'craft', recipe: 'bricks' });
    expect(calls).toEqual([['walkTo', 4, 5], ['craft', 'bricks']]);
  });

  it('reports a refusal and the deposited amount', () => {
    const no = spyTarget(false);
    expect(applyCommand(no.target, { type: 'mine' }).ok).toBe(false);
    expect(applyCommand(no.target, { type: 'deposit' })).toEqual({ ok: false, value: 0 });
    expect(applyCommand(spyTarget().target, { type: 'deposit' })).toEqual({ ok: true, value: 3 });
  });

  it('rejects malformed commands and drops unknown fields', () => {
    for (const bad of [
      null, 3, 'mine', {}, { type: 'fly' }, { type: 'move', dir: 4 }, { type: 'move', dir: 1.5 },
      { type: 'walkTo', x: '1', y: 2 }, { type: 'planPath', waypoints: [] }, { type: 'planPath', waypoints: [{ x: 1 }] },
      { type: 'build', structure: '' }, { type: 'setView', view: 'side' }, { type: 'craft' },
    ]) {
      expect(parseCommand(bad)).toBeNull();
    }
    expect(parseCommand({ type: 'mine', extra: true })).toEqual({ type: 'mine' });
  });

  it('answers bridge messages with the request id, and never throws', () => {
    const { target } = spyTarget();
    expect(handleCommandMessage(target, { v: PROTOCOL_VERSION, id: 'a1', command: { type: 'scan' } }))
      .toEqual({ v: PROTOCOL_VERSION, id: 'a1', ok: true });
    expect(handleCommandMessage(target, { v: 99, id: 'a2', command: { type: 'scan' } }))
      .toEqual({ v: PROTOCOL_VERSION, id: 'a2', ok: false, error: 'version' });
    expect(handleCommandMessage(target, { v: PROTOCOL_VERSION, command: { type: 'fly' } }))
      .toEqual({ v: PROTOCOL_VERSION, ok: false, error: 'invalid' });
    expect(handleCommandMessage(target, undefined)).toMatchObject({ ok: false, error: 'version' });
  });

  it('streams real sim events as JSON-safe messages, without ticks, until stopped', () => {
    const events = new EventBus();
    const sim = new Simulation({ body: getBody('moon')!, spec: { ...defaultSpec(), id: 'r1' }, events });
    const got: EventMessage[] = [];
    const stop = streamEvents(events, (m) => got.push(JSON.parse(JSON.stringify(m))));
    for (let i = 0; i < 20; i++) sim.tick();
    for (let d = 0; d < 4; d++) sim.move(d as 0 | 1 | 2 | 3);
    expect(got.some((m) => m.type === 'tick')).toBe(false);
    // Each drive attempt either moves or is blocked, and says so.
    expect(got.filter((m) => m.type === 'moved' || m.type === 'blocked').length).toBeGreaterThan(0);
    expect(got.every((m) => m.v === PROTOCOL_VERSION)).toBe(true);
    const n = got.length;
    stop();
    for (let d = 0; d < 4; d++) sim.move(d as 0 | 1 | 2 | 3);
    expect(got.length).toBe(n);
  });

  it('forwards only the requested keys', () => {
    const events = new EventBus();
    const got: string[] = [];
    streamEvents(events, (m) => got.push(m.type), { keys: ['tick'] });
    events.emit('tick', { time: 1, daylight: 1 });
    events.emit('cargoFull', {});
    expect(got).toEqual(['tick']);
  });
});
