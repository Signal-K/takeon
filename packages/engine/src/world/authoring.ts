import type { BodyDef, BodyType, WeatherType } from '../types.js';
import { DEFAULT_NOISE, FRACTAL_KINDS, NOISE_TYPES } from '../util/noise/index.js';
import { BODIES } from './bodies.js';

/**
 * Authoring support for destinations: drafts, validation, a field schema and
 * source/JSON export.
 *
 * The engine owns this (rather than the editor) so that *any* host — the
 * built-in editor, a Landnam admin screen, a CLI — builds the same inspector
 * against the same rules, and so the rules stay testable without a DOM.
 */

export const MIN_BODY_SIZE = 16;
export const MAX_BODY_SIZE = 192;
/** Column heights are cached in an Int8Array, so this is a hard ceiling. */
export const MAX_BODY_HEIGHT = 100;

export const WEATHER_TYPES: WeatherType[] = [
  'dust-devil',
  'dust-storm',
  'solar-storm',
  'meteor-shower',
  'cryo-fog',
];

export const BODY_TYPES: BodyType[] = ['planet', 'moon', 'asteroid'];

/** A blank-but-playable destination, ready to be tweaked in an inspector. */
export function createBodyDraft(partial: Partial<BodyDef> = {}): BodyDef {
  const base: BodyDef = {
    id: 'new-world',
    name: 'New World',
    type: 'moon',
    gravity: 1.6,
    solarFlux: 0.8,
    dayLength: 600,
    deltaV: 40,
    size: 96,
    maxHeight: 14,
    seed: 1234,
    palette: { sky: '#2c2650', skyNight: '#0a0920', tint: [1, 1, 1] },
    terrain: { roughness: 0.5, craters: 6, iceCaps: 0.1, oreRichness: 0.4 },
    minerals: { iron: 0.45, copper: 0.3, titanium: 0.25 },
    weather: {},
    description: 'An unnamed world.',
  };
  return mergeBody(base, partial);
}

/** Deep clone of a destination (structures are plain data). */
export function cloneBody(def: BodyDef): BodyDef {
  return {
    ...def,
    palette: { ...def.palette, tint: def.palette.tint ? ([...def.palette.tint] as [number, number, number]) : undefined },
    terrain: { ...def.terrain },
    minerals: def.minerals ? { ...def.minerals } : undefined,
    weather: def.weather ? { ...def.weather } : undefined,
  };
}

/** Start a draft from an existing body — the "duplicate" action. */
export function forkBody(def: BodyDef, id: string, name?: string): BodyDef {
  const copy = cloneBody(def);
  copy.id = id;
  copy.name = name ?? `${def.name} copy`;
  return copy;
}

function mergeBody(base: BodyDef, patch: Partial<BodyDef>): BodyDef {
  const out = cloneBody(base);
  Object.assign(out, patch);
  if (patch.palette) out.palette = { ...base.palette, ...patch.palette };
  if (patch.terrain) out.terrain = { ...base.terrain, ...patch.terrain };
  if (patch.minerals) out.minerals = { ...base.minerals, ...patch.minerals };
  if (patch.weather) out.weather = { ...base.weather, ...patch.weather };
  return out;
}

// ── Inspector schema ───────────────────────────────────────────────────

export type BodyFieldKind = 'number' | 'text' | 'longtext' | 'color' | 'boolean' | 'select';

export type BodyFieldGroup =
  | 'identity'
  | 'physics'
  | 'world'
  | 'terrain'
  | 'noise'
  | 'minerals'
  | 'weather'
  | 'palette';

export interface BodyField {
  /** Dotted path into the BodyDef, e.g. `terrain.roughness`. */
  path: string;
  label: string;
  kind: BodyFieldKind;
  group: BodyFieldGroup;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /**
   * Value an editor should show when the field is absent — the effective
   * default the engine would use. Without it, optional numeric fields read as
   * 0 in an inspector and writing one silently zeroes a real default.
   */
  defaultValue?: number | string | boolean;
  /** True when changing it invalidates a generated world. */
  affectsTerrain?: boolean;
}

export const BODY_FIELD_GROUPS: { id: BodyFieldGroup; label: string; help: string }[] = [
  { id: 'identity', label: 'Identity', help: 'How the destination is named and described.' },
  { id: 'physics', label: 'Physics & orbit', help: 'Gravity, sunlight, day length and the fuel to get there.' },
  { id: 'world', label: 'World', help: 'Grid size, vertical range and the generation seed.' },
  { id: 'terrain', label: 'Terrain', help: 'Feature parameters fed to the generator.' },
  {
    id: 'noise',
    label: 'Noise field',
    help: 'The elevation field. Leave the type blank to keep the original value-fBm terrain.',
  },
  { id: 'minerals', label: 'Mineralogy', help: 'Relative ore-vein weights (spectroscopy-informed).' },
  { id: 'weather', label: 'Weather', help: 'Expected events per ~10 game-minutes. 0 disables.' },
  { id: 'palette', label: 'Palette', help: 'Sky colours and the per-channel terrain tint.' },
];

export const BODY_FIELDS: BodyField[] = [
  { path: 'id', label: 'Id', kind: 'text', group: 'identity', help: 'Stable key used by saves and the backend.' },
  { path: 'name', label: 'Name', kind: 'text', group: 'identity' },
  {
    path: 'type',
    label: 'Type',
    kind: 'select',
    group: 'identity',
    options: BODY_TYPES.map((t) => ({ value: t, label: t })),
  },
  { path: 'description', label: 'Description', kind: 'longtext', group: 'identity' },

  { path: 'gravity', label: 'Gravity', kind: 'number', group: 'physics', min: 0.01, max: 25, step: 0.01, unit: 'm/s²', help: 'Scales fall damage and landing fuel.' },
  { path: 'solarFlux', label: 'Solar flux', kind: 'number', group: 'physics', min: 0, max: 2, step: 0.01, help: 'Relative to Earth orbit; scales solar charge rate.' },
  { path: 'dayLength', label: 'Day length', kind: 'number', group: 'physics', min: 0, max: 3000, step: 10, unit: 's', help: '0 = permanent daylight.' },
  { path: 'deltaV', label: 'Delta-v', kind: 'number', group: 'physics', min: 0, max: 200, step: 1, help: 'Fuel needed to reach and land here.' },

  { path: 'size', label: 'Map size', kind: 'number', group: 'world', min: MIN_BODY_SIZE, max: MAX_BODY_SIZE, step: 8, unit: 'voxels', affectsTerrain: true },
  { path: 'maxHeight', label: 'Max height', kind: 'number', group: 'world', min: 4, max: 40, step: 1, unit: 'voxels', affectsTerrain: true },
  { path: 'seed', label: 'Seed', kind: 'number', group: 'world', min: 0, max: 999999, step: 1, affectsTerrain: true },
  { path: 'dem', label: 'DEM patch', kind: 'text', group: 'world', affectsTerrain: true, help: 'Embedded real-elevation patch id (mars-jezero, moon-imbrium). Blank = fully procedural.' },

  { path: 'terrain.roughness', label: 'Roughness', kind: 'number', group: 'terrain', min: 0, max: 1, step: 0.01, affectsTerrain: true, help: 'Noise frequency and vertical amplitude.' },
  { path: 'terrain.craters', label: 'Craters', kind: 'number', group: 'terrain', min: 0, max: 40, step: 1, affectsTerrain: true, help: 'Ignored when a DEM patch supplies real relief.' },
  { path: 'terrain.iceCaps', label: 'Ice caps', kind: 'number', group: 'terrain', min: 0, max: 1, step: 0.01, affectsTerrain: true, help: 'Fraction of the north/south edges covered in ice.' },
  { path: 'terrain.oreRichness', label: 'Ore richness', kind: 'number', group: 'terrain', min: 0, max: 1, step: 0.01, affectsTerrain: true },
  { path: 'terrain.sulfurFields', label: 'Sulfur fields', kind: 'number', group: 'terrain', min: 0, max: 1, step: 0.01, affectsTerrain: true },
  { path: 'terrain.irregular', label: 'Irregular (rubble pile)', kind: 'boolean', group: 'terrain', affectsTerrain: true, help: 'Carves a noisy radial silhouette with map-edge cliffs.' },

  {
    path: 'terrain.noise.type',
    label: 'Type',
    kind: 'select',
    group: 'noise',
    affectsTerrain: true,
    options: [{ value: '', label: '— classic (value fBm) —' }, ...NOISE_TYPES.map((t) => ({ value: t.id, label: t.label }))],
    help: NOISE_TYPES.map((t) => `${t.label}: ${t.help}`).join(' '),
  },
  {
    path: 'terrain.noise.fractal',
    label: 'Fractal',
    kind: 'select',
    group: 'noise',
    affectsTerrain: true,
    options: FRACTAL_KINDS.map((f) => ({ value: f.id, label: f.label })),
    defaultValue: DEFAULT_NOISE.fractal,
    help: FRACTAL_KINDS.map((f) => `${f.label}: ${f.help}`).join(' '),
  },
  { path: 'terrain.noise.frequency', label: 'Frequency', kind: 'number', group: 'noise', min: 0.005, max: 0.3, step: 0.005, affectsTerrain: true, defaultValue: DEFAULT_NOISE.frequency, help: 'Cycles per tile — higher means smaller features.' },
  { path: 'terrain.noise.octaves', label: 'Octaves', kind: 'number', group: 'noise', min: 1, max: 8, step: 1, affectsTerrain: true, defaultValue: DEFAULT_NOISE.octaves },
  { path: 'terrain.noise.lacunarity', label: 'Lacunarity', kind: 'number', group: 'noise', min: 1.2, max: 4, step: 0.1, affectsTerrain: true, defaultValue: DEFAULT_NOISE.lacunarity, help: 'Frequency multiplier per octave.' },
  { path: 'terrain.noise.gain', label: 'Gain', kind: 'number', group: 'noise', min: 0.1, max: 0.9, step: 0.05, affectsTerrain: true, defaultValue: DEFAULT_NOISE.gain, help: 'Amplitude multiplier per octave.' },
  { path: 'terrain.noise.warp', label: 'Domain warp', kind: 'number', group: 'noise', min: 0, max: 20, step: 0.5, affectsTerrain: true, defaultValue: DEFAULT_NOISE.warp, help: 'Displaces samples by a second field — erosion-like distortion. 0 = off.' },

  { path: 'minerals.iron', label: 'Iron', kind: 'number', group: 'minerals', min: 0, max: 1, step: 0.01, affectsTerrain: true },
  { path: 'minerals.copper', label: 'Copper', kind: 'number', group: 'minerals', min: 0, max: 1, step: 0.01, affectsTerrain: true },
  { path: 'minerals.titanium', label: 'Titanium', kind: 'number', group: 'minerals', min: 0, max: 1, step: 0.01, affectsTerrain: true },

  ...WEATHER_TYPES.map<BodyField>((t) => ({
    path: `weather.${t}`,
    label: t.replace(/-/g, ' '),
    kind: 'number',
    group: 'weather',
    min: 0,
    max: 4,
    step: 0.1,
  })),

  { path: 'palette.sky', label: 'Sky (day)', kind: 'color', group: 'palette' },
  { path: 'palette.skyNight', label: 'Sky (night)', kind: 'color', group: 'palette' },
  { path: 'palette.tint.0', label: 'Tint R', kind: 'number', group: 'palette', min: 0.4, max: 1.6, step: 0.01 },
  { path: 'palette.tint.1', label: 'Tint G', kind: 'number', group: 'palette', min: 0.4, max: 1.6, step: 0.01 },
  { path: 'palette.tint.2', label: 'Tint B', kind: 'number', group: 'palette', min: 0.4, max: 1.6, step: 0.01 },
];

/** Read a dotted path out of a body def. */
export function getBodyField(def: BodyDef, path: string): unknown {
  let cur: unknown = def;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Immutably write a dotted path, creating intermediate objects (arrays where
 * the next key is numeric). Returns a new BodyDef; the input is untouched.
 */
export function setBodyField(def: BodyDef, path: string, value: unknown): BodyDef {
  const keys = path.split('.');
  const root = cloneBody(def) as unknown as Record<string, unknown>;
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cur[key];
    if (Array.isArray(next)) cur[key] = [...next];
    else if (next && typeof next === 'object') cur[key] = { ...(next as Record<string, unknown>) };
    else cur[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === undefined || value === '') delete cur[last];
  else cur[last] = value;
  return root as unknown as BodyDef;
}

// ── Validation ─────────────────────────────────────────────────────────

export interface BodyValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Check a draft against what the generator, renderer and sim actually
 * require. Errors block generation; warnings are playability hints.
 */
export function validateBody(def: BodyDef): BodyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  if (!def.id || !/^[a-z0-9][a-z0-9-]*$/.test(def.id)) {
    errors.push('id must be lowercase letters, digits and dashes');
  }
  if (!def.name) errors.push('name is required');
  if (!BODY_TYPES.includes(def.type)) errors.push(`type must be one of ${BODY_TYPES.join(', ')}`);

  if (!num(def.size) || def.size < MIN_BODY_SIZE || def.size > MAX_BODY_SIZE) {
    errors.push(`size must be between ${MIN_BODY_SIZE} and ${MAX_BODY_SIZE}`);
  }
  if (!num(def.maxHeight) || def.maxHeight < 4 || def.maxHeight > MAX_BODY_HEIGHT) {
    errors.push(`maxHeight must be between 4 and ${MAX_BODY_HEIGHT}`);
  }
  if (!num(def.seed) || def.seed < 0) errors.push('seed must be a non-negative number');
  if (!num(def.gravity) || def.gravity <= 0) errors.push('gravity must be greater than 0');
  if (!num(def.solarFlux) || def.solarFlux < 0) errors.push('solarFlux must be 0 or more');
  if (!num(def.dayLength) || def.dayLength < 0) errors.push('dayLength must be 0 or more');
  if (!num(def.deltaV) || def.deltaV < 0) errors.push('deltaV must be 0 or more');

  const t = def.terrain;
  if (!t) errors.push('terrain block is required');
  else {
    for (const key of ['roughness', 'iceCaps', 'oreRichness'] as const) {
      const v = t[key];
      if (!num(v) || v < 0 || v > 1) errors.push(`terrain.${key} must be between 0 and 1`);
    }
    if (t.sulfurFields !== undefined && (!num(t.sulfurFields) || t.sulfurFields < 0 || t.sulfurFields > 1)) {
      errors.push('terrain.sulfurFields must be between 0 and 1');
    }
    if (!num(t.craters) || t.craters < 0) errors.push('terrain.craters must be 0 or more');
    const n = t.noise;
    if (n) {
      if (n.type && !NOISE_TYPES.some((x) => x.id === n.type)) errors.push(`unknown noise type "${n.type}"`);
      if (n.fractal && !FRACTAL_KINDS.some((x) => x.id === n.fractal)) {
        errors.push(`unknown fractal "${n.fractal}"`);
      }
      if (n.frequency !== undefined && (!num(n.frequency) || n.frequency <= 0)) {
        errors.push('terrain.noise.frequency must be greater than 0');
      }
      if (n.octaves !== undefined && (!num(n.octaves) || n.octaves < 1 || n.octaves > 12)) {
        errors.push('terrain.noise.octaves must be between 1 and 12');
      }
      if (n.warp !== undefined && (!num(n.warp) || n.warp < 0)) errors.push('terrain.noise.warp must be 0 or more');
      if (n.type === 'blue' || n.type === 'white') {
        warnings.push(`${n.type} noise has no smooth relief — expect a spiky, dithered heightfield`);
      }
      if ((n.octaves ?? 4) > 6) warnings.push('more than 6 octaves costs generation time for detail you cannot see');
    }
    const bands = t.bands;
    if (bands) {
      bands.forEach((band, i) => {
        const label = band.label ? `"${band.label}"` : `#${i}`;
        if (!num(band.from) || band.from < 0 || band.from > 1) {
          errors.push(`terrain.bands[${label}].from must be between 0 and 1`);
        }
        if (!num(band.to) || band.to < 0 || band.to > 1) {
          errors.push(`terrain.bands[${label}].to must be between 0 and 1`);
        }
        if (num(band.from) && num(band.to) && band.from > band.to) {
          errors.push(`terrain.bands[${label}].from must not be greater than .to`);
        }
        const total = Object.values(band.minerals ?? {}).reduce((sum, w) => sum + (num(w) ? w : 0), 0);
        if (total <= 0) errors.push(`terrain.bands[${label}] needs at least one mineral with a positive weight`);
      });
      for (let i = 1; i < bands.length; i++) {
        if (bands[i].from < bands[i - 1].to) warnings.push('terrain.bands overlap — the earlier band always wins the overlap');
      }
      const covered = bands.reduce((sum, b) => sum + Math.max(0, b.to - b.from), 0);
      if (covered < 0.99) warnings.push('terrain.bands leave depth uncovered — those voxels fall back to the default mineral mix');
    }
  }

  if (!def.palette || !HEX.test(def.palette.sky ?? '')) errors.push('palette.sky must be a hex colour');
  if (!def.palette || !HEX.test(def.palette.skyNight ?? '')) errors.push('palette.skyNight must be a hex colour');
  const tint = def.palette?.tint;
  if (tint && (tint.length !== 3 || tint.some((c) => !num(c) || c < 0))) {
    errors.push('palette.tint must be three non-negative numbers');
  }

  // Warnings — legal, but they make for a poor mission.
  if (def.size > 128) warnings.push('maps above 128 voxels get slow to generate and to drive across');
  if (def.maxHeight > 30) warnings.push('very tall worlds make the isometric view crowded');
  if (t && t.oreRichness === 0) warnings.push('ore richness is 0 — nothing to mine but surface material');
  if (t && t.roughness > 0.9) warnings.push('roughness above 0.9 leaves few drivable routes');
  if (t?.irregular && def.size > 96) warnings.push('irregular worlds read best small (Bennu is 56)');
  const mins = def.minerals;
  if (mins && (mins.iron ?? 0) + (mins.copper ?? 0) + (mins.titanium ?? 0) === 0) {
    warnings.push('all mineral weights are 0 — veins fall back to an even split');
  }
  if (def.dayLength === 0) warnings.push('dayLength 0 means permanent daylight — solar rovers never run dry');
  if (def.weather && Object.values(def.weather).every((v) => !v)) {
    warnings.push('no weather events configured — the surface will feel static');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Ids already taken by the built-in catalog. */
export function builtinBodyIds(): string[] {
  return BODIES.map((b) => b.id);
}

// ── Import / export ────────────────────────────────────────────────────

/**
 * Parse untrusted JSON into a BodyDef, filling defaults for anything absent.
 * Returns the coerced draft plus validation, so an importer can show problems
 * instead of throwing.
 */
export function parseBodyJson(text: string): { body: BodyDef | null; validation: BodyValidation } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { body: null, validation: { ok: false, errors: [`not valid JSON: ${(err as Error).message}`], warnings: [] } };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { body: null, validation: { ok: false, errors: ['expected a JSON object'], warnings: [] } };
  }
  const body = createBodyDraft(raw as Partial<BodyDef>);
  return { body, validation: validateBody(body) };
}

/** Stable JSON for saving a draft or pasting into `pocketbase/seed`. */
export function bodyToJson(def: BodyDef): string {
  return JSON.stringify(def, null, 2);
}

/**
 * A TypeScript object literal ready to paste into `world/bodies.ts`.
 * Keys stay in the same order the built-in catalog uses.
 */
export function bodyToTypeScript(def: BodyDef): string {
  const lines: string[] = ['{'];
  const push = (key: string, value: string) => lines.push(`  ${key}: ${value},`);
  const str = (v: string) => JSON.stringify(v);
  push('id', str(def.id));
  push('name', str(def.name));
  push('type', str(def.type));
  push('gravity', String(def.gravity));
  push('solarFlux', String(def.solarFlux));
  push('dayLength', String(def.dayLength));
  push('deltaV', String(def.deltaV));
  push('size', String(def.size));
  push('maxHeight', String(def.maxHeight));
  push('seed', String(def.seed));
  const tint = def.palette.tint ? `, tint: [${def.palette.tint.join(', ')}]` : '';
  push('palette', `{ sky: ${str(def.palette.sky)}, skyNight: ${str(def.palette.skyNight)}${tint} }`);
  push('terrain', `{ ${entries(def.terrain)} }`);
  if (def.dem) push('dem', str(def.dem));
  if (def.minerals && Object.keys(def.minerals).length > 0) push('minerals', `{ ${entries(def.minerals)} }`);
  if (def.weather && Object.keys(def.weather).length > 0) {
    const w = Object.entries(def.weather)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => `${str(k)}: ${v}`)
      .join(', ');
    if (w) push('weather', `{ ${w} }`);
  }
  push('description', str(def.description));
  lines.push('}');
  return lines.join('\n');
}

function entries(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v)}`)
    .join(', ');
}
