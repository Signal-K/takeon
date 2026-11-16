import { describe, expect, it } from 'vitest';
import {
  EventBus,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  RoverGame,
  Simulation,
  createHostRuntime,
  defaultSpec,
  findBridge,
  getBody,
  type HostOutbound,
  type MissionState,
  type RuntimeGame,
} from '../src/index.js';

// RoverGame must satisfy the runtime's game without an adapter.
const _gameIsRuntime: (g: RoverGame) => RuntimeGame = (g) => g;
void _gameIsRuntime;

const v = PROTOCOL_VERSION;

/** A game that records lifecycle calls; `advance` runs whole 0.1 s steps like RoverGame. */
function fakeGame() {
  const log: string[] = [];
  let acc = 0;
  const events = new EventBus();
  const game: RuntimeGame = {
    events,
    start: () => log.push('start'),
    stop: () => log.push('stop'),
    resize: (w, h, dpr) => log.push(`resize ${w}x${h}@${dpr}`),
    advance: (s) => { acc += s; let n = 0; while (acc >= 0.1 - 1e-9) { acc -= 0.1; n++; } log.push(`advance ${n}`); return n; },
    draw: () => log.push('draw'),
    save: () => ({ seed: 7 }) as unknown as MissionState,
    dispose: () => log.push('dispose'),
    move: () => { events.emit('moved', { x: 1, y: 2, dir: 0 } as never); return true; },
    walkTo: () => undefined, planPath: () => true, orderMine: () => undefined, cancelOrder: () => undefined,
    mine: () => false, photo: () => undefined, scan: () => undefined, build: () => true, rotateStructure: () => true,
    demolish: () => true, repair: () => true, deposit: () => 0, launchCargo: () => true, upgradeMobility: () => true,
    craft: () => true, placeBlock: () => true, setView: () => undefined, rotateView: () => undefined,
  };
  return { game, log };
}

function host(clock?: 'frames' | 'host') {
  const { game, log } = fakeGame();
  const out: HostOutbound[] = [];
  const rt = createHostRuntime(game, (m) => out.push(JSON.parse(JSON.stringify(m))), { clock });
  return { rt, out, log };
}

describe('host runtime (KES-212 phase 3)', () => {
  it('announces ready with the runtime and protocol versions and starts its own clock by default', () => {
    const { out, log, rt } = host();
    expect(out[0]).toEqual({ v, kind: 'ready', runtime: RUNTIME_VERSION, protocol: v, clock: 'frames' });
    expect(log).toEqual(['start']);
    expect(rt.clock).toBe('frames');
  });

  it('runs commands with or without kind and replies with the request id; events stream back', () => {
    const { rt, out } = host();
    rt.receive({ v, id: 'a', command: { type: 'move', dir: 1 } });
    rt.receive({ v, kind: 'command', id: 'b', command: { type: 'mine' } });
    rt.receive({ v, id: 'c', command: { type: 'nope' } });
    expect(out.filter((m) => m.kind === 'reply')).toEqual([
      { kind: 'reply', v, id: 'a', ok: true },
      { kind: 'reply', v, id: 'b', ok: false },
      { kind: 'reply', v, id: 'c', ok: false, error: 'invalid' },
    ]);
    expect(out.find((m) => m.kind === 'event')).toEqual({ kind: 'event', v, type: 'moved', payload: { x: 1, y: 2, dir: 0 } });
  });

  it('a host clock moves only on advance, and pause holds time still', () => {
    const { rt, out, log } = host('host');
    expect(log).toEqual([]);
    rt.receive({ v, kind: 'advance', ms: 250 });
    rt.receive({ v, kind: 'advance', ms: 50 });
    rt.receive({ v, kind: 'pause' });
    rt.receive({ v, kind: 'advance', ms: 1000 });
    rt.receive({ v, kind: 'resume' });
    rt.receive({ v, kind: 'advance', ms: 100 });
    expect(out.filter((m) => m.kind === 'advanced').map((m) => (m as { steps: number }).steps)).toEqual([2, 1, 0, 1]);
    expect(log).toEqual(['advance 2', 'draw', 'advance 1', 'draw', 'advance 1', 'draw']);
    rt.receive({ v, kind: 'advance', ms: 16 });
    expect(log.slice(-2)).toEqual(['advance 0', 'draw']);
    expect(rt.paused).toBe(false);
  });

  it('pause and resume stop and restart a frames clock once each', () => {
    const { rt, log } = host();
    rt.receive({ v, kind: 'pause' });
    rt.receive({ v, kind: 'pause' });
    rt.receive({ v, kind: 'resume' });
    rt.receive({ v, kind: 'resume' });
    expect(log).toEqual(['start', 'stop', 'start']);
  });

  it('resizes with validation and saves with the id echoed', () => {
    const { rt, out, log } = host('host');
    rt.receive({ v, kind: 'resize', width: 390, height: 844, dpr: 3 });
    rt.receive({ v, kind: 'resize', width: -1, height: 844 });
    rt.receive({ v, kind: 'save', id: 's1' });
    expect(log).toEqual(['resize 390x844@3', 'draw']);
    expect(out.slice(1)).toEqual([
      { v, kind: 'error', error: 'invalid' },
      { v, kind: 'state', id: 's1', state: { seed: 7 } },
    ]);
  });

  it('answers bad versions, unknown kinds and junk without throwing; dispose is final', () => {
    const { rt, out, log } = host('host');
    for (const junk of [null, 3, 'x', { v: 99, kind: 'pause' }, { v, kind: 'explode', id: 'k' }, { v, kind: 'advance', ms: 1e9 }]) {
      expect(() => rt.receive(junk)).not.toThrow();
    }
    expect(out.slice(1).map((m) => (m as { error?: string }).error)).toEqual(['version', 'version', 'version', 'version', 'unknown-kind', 'invalid']);
    rt.dispose();
    rt.dispose();
    rt.receive({ v, kind: 'save' });
    expect(log).toEqual(['dispose']);
    expect(out.at(-1)).toEqual({ v, kind: 'error', error: 'invalid' });
  });
});

describe('RoverGame.advance', () => {
  // The real method on a live Simulation, without a canvas: only the fields `advance` touches.
  function stepper() {
    const sim = new Simulation({ body: getBody('mars')!, spec: defaultSpec(), events: new EventBus(), seed: 11 });
    const self = { acc: 0, sim, autoWalk: () => undefined };
    const advance = (s: number) => RoverGame.prototype.advance.call(self as unknown as RoverGame, s);
    return { sim, advance };
  }

  it('runs the same steps however the time is split', () => {
    const one = stepper();
    const many = stepper();
    expect(one.advance(1)).toBe(10);
    let steps = 0;
    for (let i = 0; i < 100; i++) steps += many.advance(0.01);
    expect(steps).toBe(10);
    // Everything but the save's random id is the same state.
    const strip = (m: MissionState) => JSON.stringify({ ...m, id: undefined });
    expect(strip(many.sim.serialize())).toBe(strip(one.sim.serialize()));
  });

  it('ignores zero, negative and NaN time', () => {
    const s = stepper();
    expect([s.advance(0), s.advance(-1), s.advance(Number.NaN)]).toEqual([0, 0, 0]);
  });
});

describe('findBridge', () => {
  it('prefers WKWebView, then Android, then an embedding page', () => {
    const got: unknown[] = [];
    const ios = findBridge({ webkit: { messageHandlers: { takeon: { postMessage: (m) => got.push(['ios', m]) } } } });
    const android = findBridge({ TakeOnAndroid: { postMessage: (s) => got.push(['android', s]) } });
    const parent = findBridge({ parent: { postMessage: (m: unknown) => got.push(['parent', m]) } });
    const none = findBridge({});
    const msg: HostOutbound = { v, kind: 'advanced', steps: 1 };
    for (const b of [ios, android, parent, none]) b.send(msg);
    expect([ios.name, android.name, parent.name, none.name]).toEqual(['ios', 'android', 'parent', 'none']);
    expect(got).toEqual([['ios', msg], ['android', JSON.stringify(msg)], ['parent', { takeon: msg }]]);
  });
});
