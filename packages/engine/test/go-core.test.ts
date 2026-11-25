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
  it('passes a versioned landing identity to Go and rejects non-finite inputs', () => {
    const calls: Record<string, unknown>[] = [];
    const core = connectGoCore(json => {
      const request = JSON.parse(json); calls.push(request);
      if (request.op === 'capabilities') return JSON.stringify({ ok: true, value: { protocolVersion: 1 } });
      if ((request.op === 'solarLanding' || request.op === 'styledSolarSample') && request.solar.styleVersion !== 1)
        return JSON.stringify({ ok: false, error: 'unsupported solar style version' });
      return JSON.stringify({ ok: true, value: request.solar });
    });
    const landing = { id: 'mars', seed: 42, latitude: 0, longitude: 0, styleVersion: 1, step: 0.08, width: 81, height: 81 };
    core.solarLanding(landing);
    expect(calls.at(-1)).toEqual({ op: 'solarLanding', solar: landing });
    core.styledSolarSample(landing);
    expect(calls.at(-1)).toMatchObject({ op: 'styledSolarSample', solar: landing });
    expect(() => core.solarLanding({ ...landing, styleVersion: 2 })).toThrow('unsupported solar style version');
    expect(() => core.styledSolarSample({ ...landing, styleVersion: 2 })).toThrow('unsupported solar style version');
    expect(() => core.styledSolarSample({ ...landing, styleVersion: NaN })).toThrow('invalid solar');
    for (const invalid of [
      { seed: NaN }, { seed: -1 }, { seed: 0x100000000 }, { latitude: Infinity },
      { longitude: NaN }, { step: NaN }, { width: Infinity }, { styleVersion: NaN },
    ]) expect(() => core.solarLanding({ ...landing, ...invalid })).toThrow('invalid solar');
  });
});
