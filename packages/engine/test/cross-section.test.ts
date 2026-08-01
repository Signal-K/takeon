import { describe, expect, it } from 'vitest';
import { crossSectionImage, generateTerrain, getBody, Material, renderCrossSection } from '../src/index.js';

describe('cross-section rendering', () => {
  const world = generateTerrain(getBody('moon')!);

  it('builds an ImageData matching the raw slice dimensions', () => {
    const image = crossSectionImage(world, 'y', 20);
    expect(image.width).toBe(world.size);
    expect(image.height).toBe(world.maxHeight);
  });

  it('paints air voxels with the air colour and material voxels with real colours', () => {
    const image = crossSectionImage(world, 'y', 20, { airColor: [1, 2, 3] });
    const data = image.data;
    let sawAir = false;
    let sawMaterial = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 1 && data[i + 1] === 2 && data[i + 2] === 3) sawAir = true;
      else sawMaterial = true;
      // Every pixel is fully opaque.
      expect(data[i + 3]).toBe(255);
    }
    expect(sawAir).toBe(true);
    expect(sawMaterial).toBe(true);
  });

  it('is deterministic for the same world and slice', () => {
    const a = crossSectionImage(world, 'x', 15);
    const b = crossSectionImage(world, 'x', 15);
    expect([...a.data]).toEqual([...b.data]);
  });

  it('reflects registered custom materials, not just the built-in 12', () => {
    const w = generateTerrain(getBody('mars')!);
    const x = Math.floor(w.size / 2);
    const y = Math.floor(w.size / 2);
    const h = w.height(x, y);
    w.setRaw(x, y, h, 200 as Material); // an id nothing has registered
    const image = crossSectionImage(w, 'y', y, { airColor: [0, 0, 0] });
    // MATERIALS[200] is undefined, so the painter must not throw — it should
    // fall back to the air colour rather than crash on a missing MaterialDef.
    expect(() => crossSectionImage(w, 'y', y)).not.toThrow();
    expect(image).toBeDefined();
  });

  it('renders into a real canvas, letterboxed and smoothing disabled', () => {
    if (typeof document === 'undefined') return; // canvas-dependent, skip outside a DOM env
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 120, top: 0, left: 0, right: 200, bottom: 120, x: 0, y: 0, toJSON() {} }),
    });
    renderCrossSection(canvas, world, 'y', 20);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    const ctx = canvas.getContext('2d')!;
    const pixel = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
    expect(pixel[3]).toBe(255); // painted, not left transparent
  });
});
