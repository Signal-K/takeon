import type { Simulation } from '../sim/simulation.js';
import type { Scene, SceneEntity, ViewKind } from './types.js';

export interface BuildSceneOptions {
  view?: ViewKind;
  /** Include anomalies the scanner has not revealed yet (editor/debug). */
  includeHidden?: boolean;
}

/**
 * Flatten a running simulation into a `Scene`.
 *
 * Pure and DOM-free: no canvas, no camera, no timing. That makes it testable,
 * usable in a worker, and the natural hand-off point for a host game that
 * wants to draw TakeOn's world with its own renderer.
 */
export function buildScene(sim: Simulation, opts: BuildSceneOptions = {}): Scene {
  const { view = 'iso', includeHidden = false } = opts;
  const entities: SceneEntity[] = [];

  for (const anomaly of sim.anomalies) {
    if (!anomaly.scanned && !includeHidden) continue;
    entities.push({
      id: anomaly.id,
      kind: 'anomaly',
      pos: { ...anomaly.pos },
      z: sim.world.height(anomaly.pos.x, anomaly.pos.y),
      variant: anomaly.type,
      label: anomaly.name,
      layer: 10,
      data: { scanned: anomaly.scanned, documented: anomaly.documented },
      ref: anomaly,
    });
  }

  for (const structure of sim.structures) {
    entities.push({
      id: structure.id,
      kind: 'structure',
      pos: { ...structure.pos },
      z: sim.world.height(structure.pos.x, structure.pos.y),
      facing: structure.facing ?? 0,
      variant: structure.type,
      layer: 20,
      data: {
        powered: sim.powered.has(structure.id),
        progress: structure.progress ?? 1,
        buffered: (Object.values(structure.buffer) as (number | undefined)[]).reduce(
          (sum: number, qty) => sum + (qty ?? 0),
          0,
        ),
      },
      ref: structure,
    });
  }

  const rover = sim.rover;
  entities.push({
    id: 'rover',
    kind: 'rover',
    // renderPos is the interpolated position, so the scene matches the frame.
    pos: { ...rover.renderPos },
    z: sim.world.height(rover.pos.x, rover.pos.y),
    facing: rover.facing,
    variant: rover.spec.id || 'rover',
    label: rover.spec.name,
    layer: 30,
    data: {
      battery: rover.battery,
      durability: rover.durability,
      cargoUsed: rover.cargoUsed,
      mining: !!rover.mining,
      moving: rover.moveFrom != null,
    },
    ref: rover,
  });

  if (sim.weather?.pos) {
    entities.push({
      id: 'weather',
      kind: 'marker',
      pos: { ...sim.weather.pos },
      z: sim.world.height(sim.weather.pos.x, sim.weather.pos.y),
      variant: sim.weather.type,
      layer: 40,
      data: { intensity: sim.weather.intensity },
    });
  }

  entities.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));

  return {
    id: sim.missionId,
    name: sim.body.name,
    view,
    size: sim.world.size,
    maxHeight: sim.world.maxHeight,
    time: sim.time,
    daylight: sim.daylight(),
    palette: sim.body.palette,
    weather: sim.weather,
    entities,
    home: { ...sim.landingSite },
  };
}
