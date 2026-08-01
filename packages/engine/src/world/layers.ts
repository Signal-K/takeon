import type { BodyDef } from '../types.js';
import type { VoxelWorld } from './world.js';

/**
 * Extension seam for additional world **layers** — an explorable underground
 * cave grid, a sky/atmosphere layer, whatever a module built on top of
 * TakeOn wants — without forking core generation.
 *
 * TakeOn ships zero registered layers: mining stays exactly what it is today
 * (top-down, deposits and ice via `OreBand`/icy terrain — see
 * `world/terrain.js`), and every body generates unaffected. A layer
 * generator is opaque data as far as core is concerned — it's attached to
 * `VoxelWorld.layers` by id after the surface world finishes generating, and
 * it's the registering module's own job to interpret it (sim state, a
 * renderer, entry/exit rules). Because generation stays a pure function of
 * `(body, seed)`, a deterministic generator needs no persistence of its own
 * — regenerating the world regenerates the layer identically, the same
 * guarantee the surface world already relies on.
 */
export type LayerGenerator<T = unknown> = (body: BodyDef, seed: number, world: VoxelWorld) => T;

const generators = new Map<string, LayerGenerator>();

/** Register a layer generator, run once per `generateTerrain()` call after the surface world is built. */
export function registerWorldLayer<T>(id: string, generate: LayerGenerator<T>): void {
  generators.set(id, generate as LayerGenerator);
}

export function unregisterWorldLayer(id: string): boolean {
  return generators.delete(id);
}

export function listWorldLayerIds(): string[] {
  return [...generators.keys()];
}

/** Run every registered generator against a freshly-built world, attaching results to `world.layers`. Called by `generateTerrain`. */
export function runWorldLayers(body: BodyDef, seed: number, world: VoxelWorld): void {
  for (const [id, generate] of generators) {
    world.layers[id] = generate(body, seed, world);
  }
}
