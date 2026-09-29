import { describe, expect, it } from 'vitest';
import { WORLD_EDGE_CUTAWAY_DEPTH, edgeFaceBottom } from '../src/render/renderer.js';

describe('world-edge cutaway', () => {
  it('gives an exposed world perimeter a substantial visual sidewall', () => {
    expect(edgeFaceBottom(-1)).toBe(-WORLD_EDGE_CUTAWAY_DEPTH);
    expect(WORLD_EDGE_CUTAWAY_DEPTH).toBeGreaterThan(1);
  });

  it('does not change the height of an interior geological neighbour', () => {
    expect(edgeFaceBottom(6)).toBe(6);
  });
});
