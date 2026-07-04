import type { PartDef, RoverSpec, RoverStats } from '../types.js';
import { PARTS } from './catalog.js';

/** Base fuel every rover carries even without an aux tank. */
const BASE_FUEL = 30;

/**
 * Compute a rover's derived stats from its part list.
 * Pure and deterministic — the customiser, the sim and the backend
 * can all agree on the same numbers.
 */
export function computeStats(spec: RoverSpec, catalog: PartDef[] = PARTS): RoverStats {
  const problems: string[] = [];
  const find = (id: string, category: string): PartDef | null => {
    const p = catalog.find((c) => c.id === id);
    if (!p) {
      problems.push(`Missing ${category} part "${id}"`);
      return null;
    }
    if (p.category !== category) {
      problems.push(`Part "${id}" is not a ${category}`);
      return null;
    }
    return p;
  };

  const chassis = find(spec.chassis, 'chassis');
  const wheels = find(spec.wheels, 'wheels');
  const power = find(spec.power, 'power');
  const battery = find(spec.battery, 'battery');

  const modules: PartDef[] = [];
  for (const id of spec.modules) {
    const p = catalog.find((c) => c.id === id);
    if (!p) {
      problems.push(`Unknown module "${id}"`);
      continue;
    }
    if (!['tool', 'camera', 'scanner', 'cargo', 'fuel'].includes(p.category)) {
      problems.push(`"${p.name}" cannot be fitted as a module`);
      continue;
    }
    modules.push(p);
  }

  const slots = chassis?.stats.slots ?? 0;
  if (modules.length > slots) {
    problems.push(`Chassis has ${slots} slots but ${modules.length} modules fitted`);
  }
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.category)) problems.push(`Duplicate ${m.category} module`);
    seen.add(m.category);
  }

  const all = [chassis, wheels, power, battery, ...modules].filter(Boolean) as PartDef[];
  const mass = all.reduce((s, p) => s + p.mass, 0);
  const cost = all.reduce((s, p) => s + p.cost, 0);
  const sum = (k: keyof PartDef['stats']): number => all.reduce((s, p) => s + (p.stats[k] ?? 0), 0);

  // Heavier rovers are slower and cost more energy per tile.
  const baseSpeed = wheels?.stats.speed ?? 0;
  const massFactor = 1 + Math.max(0, mass - 80) / 220;
  const speed = baseSpeed / massFactor;
  const moveEnergy = 0.55 * massFactor;

  const stats: RoverStats = {
    mass,
    batteryCapacity: sum('batteryCapacity'),
    solarRate: sum('solarRate'),
    rtgRate: sum('rtgRate'),
    speed: Math.round(speed * 100) / 100,
    maxClimb: wheels?.stats.maxClimb ?? 0,
    grip: wheels?.stats.grip ?? 0,
    miningPower: sum('miningPower'),
    miningEnergy: sum('miningEnergy'),
    photoQuality: sum('photoQuality'),
    photoEnergy: sum('photoEnergy'),
    scanRadius: sum('scanRadius'),
    scanEnergy: sum('scanEnergy'),
    cargoCapacity: sum('cargoCapacity'),
    fuelCapacity: BASE_FUEL + sum('fuelCapacity'),
    durabilityMax: chassis?.stats.durability ?? 0,
    moveEnergy: Math.round(moveEnergy * 100) / 100,
    cost,
    valid: false,
    problems,
  };

  if (!chassis) problems.push('A chassis is required');
  if (!wheels) problems.push('Wheels are required');
  if (!power) problems.push('A power source is required');
  if (!battery) problems.push('A battery is required');
  if (stats.solarRate === 0 && stats.rtgRate === 0 && power) {
    problems.push('Power source produces nothing');
  }

  stats.valid = problems.length === 0;
  return stats;
}

/** Can this rover reach the given delta-v with its fuel tank? */
export function canReach(stats: RoverStats, deltaV: number): boolean {
  return stats.fuelCapacity >= deltaV;
}

export function defaultSpec(): RoverSpec {
  return {
    id: '',
    name: 'Rover 1',
    chassis: 'chassis-scout',
    wheels: 'wheels-rocker',
    power: 'power-solar-s',
    battery: 'batt-cell',
    modules: ['tool-scoop', 'cam-nav'],
    color: '#c8d6e5',
  };
}
