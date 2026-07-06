import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_CREDITS,
  PHOTO_CREDITS_PER_QUALITY,
  RESOURCE_VALUE,
  STARTING_CREDITS,
} from '../src/index.js';

/**
 * The gameplay economy is deliberately duplicated: the engine owns it in
 * net/sync.ts and the Go spoke re-declares it in pocketbase/routes.go (so the
 * server can score missions without running JS). These MUST agree or the UI
 * and backend will disagree on payouts. This test reads the Go source and
 * fails the moment the two drift.
 */
const goSource = readFileSync(new URL('../../../pocketbase/routes.go', import.meta.url), 'utf8');

function goConst(name: string): number {
  const m = goSource.match(new RegExp(`${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
  if (!m) throw new Error(`could not find Go constant ${name}`);
  return Number(m[1]);
}

function goResourceValues(): Record<string, number> {
  const block = goSource.match(/resourceValue\s*=\s*map\[string\]float64\{([\s\S]*?)\}/);
  if (!block) throw new Error('could not find resourceValue map in routes.go');
  const out: Record<string, number> = {};
  for (const m of block[1].matchAll(/"([\w-]+)"\s*:\s*(\d+(?:\.\d+)?)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

describe('economy parity (engine ⇄ Go spoke)', () => {
  it('scalar constants match routes.go', () => {
    expect(goConst('startingCredits')).toBe(STARTING_CREDITS);
    expect(goConst('discoveryCredits')).toBe(DISCOVERY_CREDITS);
    expect(goConst('photoCreditsPerQuality')).toBe(PHOTO_CREDITS_PER_QUALITY);
  });

  it('resource values match routes.go exactly (same keys, same numbers)', () => {
    const go = goResourceValues();
    // Same set of resource keys on both sides.
    expect(Object.keys(go).sort()).toEqual(Object.keys(RESOURCE_VALUE).sort());
    for (const [res, value] of Object.entries(RESOURCE_VALUE)) {
      expect(go[res]).toBe(value);
    }
  });
});
