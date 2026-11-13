import type { BodyDef, RoverSpec } from '../types.js';
import { PARTS } from '../parts/catalog.js';
import { STRUCTURES, MOBILITY_UPGRADE_COST } from './structures.js';
import { RECIPES } from './recipes.js';
import { MATERIALS } from '../world/materials.js';
import { coreBody } from '../world/core-data.js';
export function coreConfig(body: BodyDef, spec?: RoverSpec) {
  return {
    body: coreBody(body),
    spec,
    parts: PARTS,
    materials: MATERIALS,
    rules: { structures: STRUCTURES, recipes: RECIPES, mobilityCosts: MOBILITY_UPGRADE_COST },
  };
}
