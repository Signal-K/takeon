import { Material, type MaterialDef, type ResourceKey } from '../types.js';

/**
 * Saturated, stylised material palette (Crashlands-adjacent): warm golds and
 * ochres for soils, oxidised teal copper, vivid crystal. Deliberately not
 * grey — side faces darken toward purple rather than desaturating.
 */
export const MATERIALS: Record<Material, MaterialDef> = {
  [Material.Air]: {
    id: Material.Air,
    name: 'Air',
    hardness: 0,
    yields: null,
    colors: ['#000000', '#000000', '#000000'],
    jitter: 0,
  },
  [Material.Regolith]: {
    id: Material.Regolith,
    name: 'Regolith',
    hardness: 2,
    yields: { resource: 'regolith', amount: 1 },
    colors: ['#d99a55', '#a86f38', '#7d5230'],
    jitter: 0.06,
  },
  [Material.Rock]: {
    id: Material.Rock,
    name: 'Rock',
    hardness: 4,
    yields: { resource: 'stone', amount: 1 },
    colors: ['#b08968', '#7d5f47', '#5a4438'],
    jitter: 0.05,
  },
  [Material.Basalt]: {
    id: Material.Basalt,
    name: 'Basalt',
    hardness: 6,
    yields: { resource: 'stone', amount: 2 },
    colors: ['#6b5a72', '#4e4054', '#392f42'],
    jitter: 0.04,
  },
  [Material.Ice]: {
    id: Material.Ice,
    name: 'Water ice',
    hardness: 3,
    yields: { resource: 'ice', amount: 2 },
    colors: ['#a8e8f0', '#6fc3d8', '#4d9fbd'],
    jitter: 0.05,
  },
  [Material.IronOre]: {
    id: Material.IronOre,
    name: 'Iron ore',
    hardness: 5,
    yields: { resource: 'iron', amount: 2 },
    colors: ['#c96f4a', '#96502f', '#703a24'],
    jitter: 0.09,
  },
  [Material.Silica]: {
    id: Material.Silica,
    name: 'Silica sand',
    hardness: 2,
    yields: { resource: 'silica', amount: 2 },
    colors: ['#f2dfa7', '#c9b478', '#9c8a5c'],
    jitter: 0.05,
  },
  [Material.CopperOre]: {
    id: Material.CopperOre,
    name: 'Copper ore',
    hardness: 5,
    yields: { resource: 'copper', amount: 2 },
    colors: ['#4fbf9f', '#37927a', '#27695c'],
    jitter: 0.1,
  },
  [Material.TitaniumOre]: {
    id: Material.TitaniumOre,
    name: 'Titanium ore',
    hardness: 7,
    yields: { resource: 'titanium', amount: 1 },
    colors: ['#b9c7d6', '#8595a8', '#5f7186'],
    jitter: 0.08,
  },
  [Material.Crystal]: {
    id: Material.Crystal,
    name: 'Crystal',
    hardness: 8,
    yields: { resource: 'crystal', amount: 1 },
    colors: ['#c77dff', '#9d4edd', '#7b2cbf'],
    jitter: 0.12,
  },
  [Material.Dust]: {
    id: Material.Dust,
    name: 'Fine dust',
    hardness: 1,
    yields: { resource: 'regolith', amount: 1 },
    colors: ['#eab861', '#c08a3e', '#93672f'],
    jitter: 0.04,
  },
  [Material.Sulfur]: {
    id: Material.Sulfur,
    name: 'Sulfur deposit',
    hardness: 3,
    yields: { resource: 'sulfur', amount: 2 },
    colors: ['#f6d743', '#c9ad2e', '#9c8722'],
    jitter: 0.1,
  },
};

export const RESOURCE_NAMES: Record<ResourceKey, string> = {
  regolith: 'Regolith',
  stone: 'Stone',
  ice: 'Water ice',
  iron: 'Iron',
  silica: 'Silica',
  copper: 'Copper',
  titanium: 'Titanium',
  crystal: 'Crystal',
  sulfur: 'Sulfur',
  'iron-plate': 'Iron plate',
  glass: 'Glass',
  water: 'Water',
  alloy: 'Ti-alloy',
};
