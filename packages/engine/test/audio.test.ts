import { describe, expect, it } from 'vitest';
import { GameAudio } from '../src/index.js';

// The engine must run without a DOM/Web Audio (Node, SSR, tests). GameAudio
// has to degrade to a silent no-op rather than throw.
describe('GameAudio headless safety', () => {
  it('stays silent and never throws without an AudioContext', () => {
    const a = new GameAudio();
    expect(a.ready).toBe(false);
    expect(() => a.unlock()).not.toThrow(); // no AudioContext in Node
    expect(a.ready).toBe(false);

    expect(() => {
      a.startAmbient('mars');
      a.moveStep();
      a.mine();
      a.build();
      a.place();
      a.deposit();
      a.scan();
      a.photo();
      a.craft();
      a.discovery();
      a.habitat();
      a.upgrade();
      a.launch();
      a.damage();
      a.repair();
      a.weather();
      a.error();
      a.lost();
      a.setVolume(0.4);
      a.setEnabled(false);
      a.toggle();
      a.stopAmbient();
    }).not.toThrow();
  });
});
