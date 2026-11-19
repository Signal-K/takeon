/**
 * @takeon/engine/kit — TakeOn's asset and build-site kit (KES-533).
 *
 * A self-contained module for drawing settlements in any projection:
 * - `mesh`: richer solid primitives (windowed boxes, banded drums, gable
 *   roofs, trusses, panels, dishes, lamps, ground paint) with lighting,
 *   outlines, contact shading and soft cast shadows.
 * - `assets`: the structure catalogue (agency HQ, launch pad, solar farm,
 *   warehouse, fuel depot, deep-space dish, hangar, habitat, silos, assembly
 *   hall, observatory…) plus `registerAsset` for a host's own.
 * - `construction`: any model drawn going up — stakes, slab, scaffold,
 *   tower crane, then the finished building.
 * - `site`: the ground work and build timeline (roughen, scatter, clear,
 *   flatten, build, road) a renderer queries each frame.
 * - `ground`: roads, debris, machines and dust.
 *
 * Pure canvas drawing over a host projector: no sim, no world, no DOM
 * beyond the 2D context it is handed. TakeOn's `IsoRenderer` draws a
 * `BuildSite` on its terrain (`renderer.site`).
 */
export * from './mesh.js';
export * from './assets.js';
export * from './construction.js';
export * from './site.js';
export * from './ground.js';
