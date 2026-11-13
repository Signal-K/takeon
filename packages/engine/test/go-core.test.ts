import { describe, expect, it } from 'vitest';
import { connectGoCore } from '../src/go/index.js';

describe('Go boundary adapter', () => {
  it('normalizes seed width, scopes handles, disposes once, and propagates errors', () => {
    const calls: Record<string, unknown>[] = [];
    const core = connectGoCore(json => {
      const request = JSON.parse(json); calls.push(request);
      if (request.op === 'capabilities') return JSON.stringify({ ok: true, value: { protocolVersion: 1 } });
      if (request.op === 'create') return JSON.stringify({ ok: true, value: 7 });
      if (request.op === 'order') return JSON.stringify({ ok: false, error: 'unsupported order' });
      return JSON.stringify({ ok: true, value: [] });
    });
    const engine = core.createEngine(0x10000002a, 'moon');
    expect(calls[1]).toMatchObject({ seed: 42, bodyId: 'moon' });
    expect(() => engine.order('build')).toThrow('unsupported order');
    expect(engine.step(0.1)).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ engineId: 7, dt: 0.1 });
    for (const dt of [NaN, Infinity, -1, 61]) expect(() => engine.step(dt)).toThrow();
    expect(() => engine.seedCargo({ iron: NaN })).toThrow();
    engine.dispose(); engine.dispose();
    expect(calls.filter(c => c.op === 'dispose')).toHaveLength(1);
    expect(() => engine.step(0.1)).toThrow('disposed');
    expect(() => core.createEngine(NaN, 'moon')).toThrow('safe integer');
  });
  it('rejects an incompatible bridge before creating a game', () => {
    expect(() => connectGoCore(() => JSON.stringify({ ok: true, value: { protocolVersion: 2 } }))).toThrow('unsupported bridge protocol');
  });
});
