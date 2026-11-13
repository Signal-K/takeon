import type { Recipe } from '../types.js';

/**
 * Refining/crafting recipes. Field recipes work anywhere on the rover;
 * recipes marked `near: 'refinery'` need the rover adjacent to a built
 * refinery — the reason to establish a base instead of wandering forever.
 */
import { rules } from '../data/core-catalog.js';
export const RECIPES = rules.recipes as unknown as Recipe[];

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
