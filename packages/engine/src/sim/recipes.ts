import type { Recipe } from '../types.js';

/**
 * Refining/crafting recipes. Field recipes work anywhere on the rover;
 * recipes marked `near: 'refinery'` need the rover adjacent to a built
 * refinery — the reason to establish a base instead of wandering forever.
 */
export const RECIPES: Recipe[] = [
  {
    id: 'iron-plate',
    name: 'Iron plate',
    description: 'Press raw iron into structural stock for advanced construction.',
    input: { iron: 2 },
    output: { resource: 'iron-plate', amount: 1 },
    energy: 4,
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Fuse silica sand into panes.',
    input: { silica: 2 },
    output: { resource: 'glass', amount: 1 },
    energy: 3,
  },
  {
    id: 'water',
    name: 'Water',
    description: 'Melt and filter surface ice. Valuable cargo everywhere.',
    input: { ice: 2 },
    output: { resource: 'water', amount: 1 },
    energy: 2,
  },
  {
    id: 'alloy',
    name: 'Ti-alloy',
    description: 'Furnace-grade titanium alloy. Requires an adjacent refinery.',
    input: { titanium: 1, 'iron-plate': 1 },
    output: { resource: 'alloy', amount: 1 },
    energy: 8,
    near: 'refinery',
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
