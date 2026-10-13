import type { Scene, SceneEntity, SceneEntitySnapshot, SceneSnapshot } from './types.js';

/** Input contract any terrain consumer can use without a rover Simulation. */
export type SceneSnapshotInput = Omit<SceneSnapshot, 'entities'> & {
  entities: readonly SceneEntitySnapshot[];
};

/**
 * Build a stable, data-only frame for a renderer or platform bridge.
 * Entity ordering is canonical: lower layers paint first, preserving input
 * order for ties. Positions and top-level data records are copied so later
 * host mutations to those values do not alter the published frame.
 */
export function createSceneSnapshot(input: SceneSnapshotInput): SceneSnapshot {
  const entities = input.entities
    .map((entity) => ({
      ...entity,
      pos: { ...entity.pos },
      ...(entity.data ? { data: { ...entity.data } } : {}),
    }))
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));

  return {
    ...input,
    home: { ...input.home },
    palette: {
      ...input.palette,
      ...(input.palette.tint ? { tint: [...input.palette.tint] as [number, number, number] } : {}),
    },
    weather: input.weather
      ? {
          ...input.weather,
          ...(input.weather.pos ? { pos: { ...input.weather.pos } } : {}),
        }
      : null,
    entities,
  };
}

/**
 * Remove process-local renderer references from a legacy scene. New host
 * adapters should exchange this form rather than a `Scene` containing refs.
 */
export function snapshotScene(scene: Scene): SceneSnapshot {
  const entities: SceneEntitySnapshot[] = scene.entities.map(
    ({ ref: _ref, ...entity }: SceneEntity) => entity,
  );
  return createSceneSnapshot({ ...scene, entities });
}
