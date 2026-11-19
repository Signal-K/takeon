import { beam, bowl, box, cyl, dish, dome, flat, light, panel, prism, ring, truss, type Part } from './mesh.js';

/**
 * The asset catalogue: every structure a base can raise, modelled in tiles
 * (1 model unit = 1 tile) around its anchor tile. A host registers more with
 * `registerAsset`; ids are free strings.
 */
export interface AssetContext {
  /** Seconds, for anything that turns or blinks. */
  time: number;
  /** A pad keeps its rocket unless it is away. Default true. */
  rocket?: boolean;
}

export interface AssetDef {
  id: string;
  /** Player-facing name. */
  name: string;
  /** Tiles it covers across (square), for layout and the graded ground under it. */
  footprint: number;
  /** Seconds a crew takes to raise it, as drawn. */
  buildSeconds: number;
  model(ctx: AssetContext): Part[];
}

const registry = new Map<string, AssetDef>();

export function registerAsset(def: AssetDef): void {
  registry.set(def.id, def);
}

export function getAsset(id: string): AssetDef | undefined {
  return registry.get(id);
}

export function listAssets(): AssetDef[] {
  return [...registry.values()];
}

// ── Palette ─────────────────────────────────────────────────────────────

const CONCRETE = '#b8bbbf';
const CONCRETE_DARK = '#8e9297';
const WHITE = '#eef1f4';
const PANEL = '#dfe4ea';
const STEEL = '#9aa3ad';
const STEEL_DARK = '#5f666f';
const AGENCY = '#e8692e';
const HAZARD = '#e9b93a';
const GLASS = '#5f93bd';
const SOLAR = '#2f5f9e';
const RED = '#d8432f';
const GREEN = '#7ed47e';
const AMBER = '#ffcc66';
const ASPHALT = '#4a4d52';

/** The pad's rocket standing on its deck, base at `z`. */
export function rocketParts(z = 0): Part[] {
  const out: Part[] = [];
  for (const [f, s] of [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]] as const)
    out.push(box(f, s, z + 0.04, f ? 0.12 : 0.03, s ? 0.12 : 0.03, 0.26, AGENCY));
  out.push(cyl(0, 0, z, 0.08, 0.11, 0.08, '#3a3d42'));
  out.push(
    cyl(0, 0, z + 0.08, 0.13, 0.13, 1.05, WHITE, {
      bands: [
        { z: z + 0.32, h: 0.06, color: '#2b2e33' },
        { z: z + 0.78, h: 0.05, color: AGENCY },
      ],
      ports: { count: 6, z: 0.88, size: 0.05 },
      n: 18,
    }),
  );
  out.push(cyl(0, 0, z + 1.13, 0.13, 0.08, 0.14, WHITE, { n: 18 }));
  out.push(cyl(0, 0, z + 1.27, 0.08, 0, 0.2, AGENCY, { n: 18 }));
  return out;
}

function agencyHq(ctx: AssetContext): Part[] {
  const out: Part[] = [
    box(0, 0, 0, 1.9, 1.9, 0.05, CONCRETE_DARK),
    flat([[0.6, 0.1], [0.95, 0.1], [0.95, 0.6], [0.6, 0.6]], '#c9ccd0', 0.051),
    // Main block: two floors of offices with the agency stripe.
    box(-0.2, -0.05, 0.05, 1.1, 1.35, 0.62, WHITE, { windows: { rows: 2, cols: 5 }, stripe: { z: 0.6, h: 0.06, color: AGENCY } }),
    // Tower wing: mission control on top.
    box(0.45, -0.42, 0.05, 0.55, 0.55, 1.15, PANEL, { windows: { rows: 4, cols: 2, to: 0.82 }, stripe: { z: 1.0, h: 0.06, color: AGENCY } }),
    box(0.45, -0.42, 1.2, 0.62, 0.62, 0.18, '#4d6f8f', { windows: { rows: 1, cols: 3, from: 0.15, to: 0.85 }, top: '#c7ccd2' }),
    // Glass atrium and entrance canopy.
    box(0.45, 0.38, 0.05, 0.5, 0.62, 0.42, GLASS, { top: WHITE, door: { face: '+f', w: 0.24, h: 0.24, color: '#2d3b49' } }),
    box(0.8, 0.38, 0.32, 0.22, 0.5, 0.03, AGENCY),
    beam([0.88, 0.17, 0.05], [0.88, 0.17, 0.32], 0.03, STEEL),
    beam([0.88, 0.59, 0.05], [0.88, 0.59, 0.32], 0.03, STEEL),
    // Roof plant and a dish.
    box(-0.5, -0.35, 0.67, 0.25, 0.2, 0.1, STEEL),
    box(-0.15, -0.45, 0.67, 0.2, 0.2, 0.08, STEEL),
    cyl(-0.45, 0.3, 0.67, 0.05, 0.04, 0.12, STEEL_DARK),
    dish(-0.45, 0.3, 0.85, 0.2, 0.75, 0.6 + Math.sin(ctx.time * 0.25) * 0.4, '#f2f4f6'),
    // Mast with a warning light.
    beam([0.5, -0.5, 1.38], [0.5, -0.5, 1.9], 0.025, STEEL),
    light(0.5, -0.5, 1.92, 0.035, RED, 0.9),
    // Flagpole.
    beam([0.85, 0.85, 0.05], [0.85, 0.85, 0.9], 0.02, '#d0d4d9'),
    box(0.85, 0.72, 0.72, 0.02, 0.24, 0.14, AGENCY),
    light(0.92, 0.12, 0.08, 0.03, AMBER),
    light(0.92, 0.64, 0.08, 0.03, AMBER),
  ];
  return out;
}

function launchPad(ctx: AssetContext): Part[] {
  const out: Part[] = [
    box(0, 0, 0, 2.3, 2.3, 0.06, CONCRETE),
    flat([[-1.1, 0.95], [1.1, 0.95], [1.1, 1.1], [-1.1, 1.1]], HAZARD, 0.061),
    ring(0, 0, 0.78, 0.04, HAZARD, 0.061),
    // Flame trench running out the front.
    box(0.0, 0.62, 0.0, 0.34, 0.66, 0.062, '#2b2d31'),
    cyl(0, 0, 0.06, 0.48, 0.44, 0.08, CONCRETE_DARK, { top: '#55595f', bands: [{ z: 0.1, h: 0.025, color: HAZARD }] }),
    // Service tower: a truss with decks, an umbilical arm and a beacon.
    ...truss(-0.72, -0.72, 0.06, 0.28, 1.75, '#c9452e', 0.29, 0.034),
    box(-0.72, -0.72, 1.81, 0.36, 0.36, 0.06, STEEL_DARK),
    light(-0.72, -0.72, 1.92, 0.04, RED, 0.7),
    box(-0.5, -0.72, 0.7, 0.2, 0.24, 0.03, STEEL),
    box(-0.5, -0.72, 1.22, 0.2, 0.24, 0.03, STEEL),
    // Lightning masts.
    beam([0.95, -0.95, 0.06], [0.95, -0.95, 1.4], 0.03, STEEL),
    light(0.95, -0.95, 1.42, 0.03, RED, 0.7, 0.5),
    beam([-0.95, 0.95, 0.06], [-0.95, 0.95, 1.4], 0.03, STEEL),
    light(-0.95, 0.95, 1.42, 0.03, RED, 0.7, 0.25),
    // Propellant tanks and lines.
    cyl(0.75, -0.55, 0.06, 0.16, 0.16, 0.42, WHITE, { bands: [{ z: 0.36, h: 0.04, color: AGENCY }] }),
    ...dome(0.75, -0.55, 0.48, 0.16, 0.09, WHITE, 3),
    beam([0.6, -0.5, 0.1], [0.25, -0.2, 0.1], 0.03, STEEL_DARK),
    // Floodlights on the apron corners.
    light(1.05, 1.05, 0.12, 0.03, AMBER),
    light(-1.05, -1.05, 0.12, 0.03, AMBER),
    light(1.05, -1.05, 0.12, 0.03, AMBER),
  ];
  if (ctx.rocket !== false) {
    out.push(...rocketParts(0.14));
    out.push(beam([-0.6, -0.6, 1.0], [-0.12, -0.12, 1.0], 0.035, STEEL_DARK));
  }
  return out;
}

function solarFarm(): Part[] {
  const out: Part[] = [box(0, 0, 0, 1.7, 1.5, 0.025, '#a39d92')];
  for (const f of [-0.5, 0.05, 0.6])
    for (const s of [-0.4, 0.4]) {
      out.push(beam([f, s, 0.025], [f, s, 0.24], 0.04, STEEL));
      out.push(panel(f, s, 0.28, 0.42, 0.66, 0.55, SOLAR, [3, 4]));
    }
  out.push(box(-0.75, 0.62, 0.025, 0.18, 0.16, 0.16, STEEL, { stripe: { z: 0.12, h: 0.025, color: HAZARD } }));
  out.push(light(-0.75, 0.62, 0.2, 0.02, GREEN, 0.5));
  return out;
}

function warehouse(): Part[] {
  return [
    box(0, 0, 0, 1.75, 1.3, 0.04, CONCRETE_DARK),
    box(-0.1, -0.1, 0.04, 1.4, 0.9, 0.46, '#c6b79c', { stripe: { z: 0.38, h: 0.04, color: AGENCY }, door: { face: '+s', w: 0.42, h: 0.34, color: '#7d8590' } }),
    prism(-0.1, -0.1, 0.5, 1.46, 0.96, 0.2, '#8f6d4e', 'f'),
    box(-0.1, 0.42, 0.04, 0.6, 0.16, 0.1, CONCRETE),
    // Crates out front.
    box(0.62, 0.42, 0.04, 0.16, 0.16, 0.14, '#b08a52'),
    box(0.62, 0.42, 0.18, 0.13, 0.13, 0.11, '#c49a5a'),
    box(0.4, 0.5, 0.04, 0.14, 0.14, 0.12, '#9a7b4b'),
    light(0.25, 0.37, 0.4, 0.025, AMBER),
  ];
}

function fuelDepot(): Part[] {
  const out: Part[] = [box(0, 0, 0, 1.6, 1.4, 0.04, CONCRETE_DARK)];
  for (const [f, s] of [[-0.35, -0.3], [0.35, -0.3]] as const) {
    for (const [lf, ls] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) out.push(beam([f + lf, s + ls, 0.04], [f + lf, s + ls, 0.26], 0.03, STEEL_DARK));
    out.push(...bowl(f, s, 0.5, 0.3, 0.24, WHITE, 3));
    out.push(...dome(f, s, 0.5, 0.3, 0.28, WHITE, 4));
    out.push(cyl(f, s, 0.47, 0.305, 0.305, 0.04, AGENCY));
  }
  out.push(cyl(0.3, 0.38, 0.04, 0.16, 0.16, 0.62, PANEL, { bands: [{ z: 0.1, h: 0.05, color: HAZARD }, { z: 0.5, h: 0.04, color: AGENCY }] }));
  out.push(beam([-0.35, -0.3, 0.12], [0.35, -0.3, 0.12], 0.04, STEEL_DARK));
  out.push(beam([0.35, -0.3, 0.12], [0.3, 0.38, 0.12], 0.04, STEEL_DARK));
  out.push(beam([-0.6, 0.45, 0.04], [-0.6, 0.45, 0.4], 0.02, STEEL));
  out.push(light(-0.6, 0.45, 0.42, 0.025, RED, 0.6));
  return out;
}

function commsDish(ctx: AssetContext): Part[] {
  const yaw = 0.7 + Math.sin(ctx.time * 0.18) * 0.9;
  return [
    box(0, 0, 0, 1.5, 1.5, 0.05, CONCRETE_DARK),
    cyl(0, 0, 0.05, 0.3, 0.22, 0.18, CONCRETE),
    cyl(0, 0, 0.23, 0.08, 0.08, 0.38, STEEL),
    box(0, 0, 0.6, 0.18, 0.18, 0.1, STEEL_DARK),
    dish(0, 0, 0.82, 0.58, 0.85, yaw, '#f4f6f8'),
    box(0.5, 0.48, 0.05, 0.36, 0.3, 0.26, PANEL, { door: { face: '+f', w: 0.1, h: 0.18, color: STEEL_DARK }, stripe: { z: 0.22, h: 0.03, color: AGENCY } }),
    light(0.5, 0.48, 0.34, 0.025, GREEN, 0.4),
    beam([-0.6, 0.55, 0.05], [-0.6, 0.55, 0.7], 0.02, STEEL),
    light(-0.6, 0.55, 0.72, 0.025, RED, 0.8),
  ];
}

function hangar(): Part[] {
  const out: Part[] = [box(0, 0, 0, 1.9, 1.6, 0.04, CONCRETE)];
  out.push(box(-0.1, -0.05, 0.04, 1.5, 1.2, 0.45, '#aeb6bf', { door: { face: '+f', w: 0.95, h: 0.4, color: '#68717c' }, stripe: { z: 0.37, h: 0.05, color: AGENCY } }));
  // An arched roof as stepped vaults.
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const w = 1.2 * Math.cos(t0 * Math.PI * 0.45);
    out.push(box(-0.1, -0.05, 0.49 + i * 0.06, 1.5, w, 0.06, i === steps - 1 ? '#d5dbe1' : '#c3cad2'));
  }
  out.push(flat([[0.66, -0.45], [0.95, -0.45], [0.95, 0.35], [0.66, 0.35]], HAZARD, 0.041));
  out.push(light(0.66, -0.55, 0.42, 0.03, AMBER));
  out.push(light(0.66, 0.45, 0.42, 0.03, AMBER));
  return out;
}

function habitat(): Part[] {
  return [
    box(0, 0, 0, 1.7, 1.4, 0.04, CONCRETE_DARK),
    cyl(-0.35, -0.2, 0.04, 0.42, 0.42, 0.2, WHITE, { ports: { count: 10, z: 0.55, size: 0.07 }, bands: [{ z: 0.04, h: 0.04, color: AGENCY }] }),
    ...dome(-0.35, -0.2, 0.24, 0.42, 0.34, '#f4f6f8', 5),
    cyl(0.5, 0.3, 0.04, 0.28, 0.28, 0.16, WHITE, { ports: { count: 8, z: 0.55, size: 0.06 } }),
    ...dome(0.5, 0.3, 0.2, 0.28, 0.22, '#f4f6f8', 4),
    box(0.1, 0.06, 0.06, 0.5, 0.16, 0.13, PANEL),
    light(-0.35, -0.2, 0.6, 0.03, GREEN, 0.3),
    // A greenhouse strip.
    box(-0.25, 0.48, 0.04, 0.6, 0.22, 0.14, '#8fc7a2', { top: '#b9e3c4' }),
  ];
}

function silo(): Part[] {
  const out: Part[] = [box(0, 0, 0, 1.5, 1.4, 0.04, CONCRETE_DARK)];
  for (const [f, s, h] of [[-0.35, -0.3, 1.0], [0.25, -0.35, 0.85], [-0.2, 0.35, 0.75]] as const) {
    out.push(cyl(f, s, 0.04, 0.24, 0.24, h, '#d9d4c8', { bands: [{ z: 0.04 + h * 0.3, h: 0.03, color: STEEL_DARK }, { z: 0.04 + h * 0.65, h: 0.03, color: STEEL_DARK }] }));
    out.push(cyl(f, s, 0.04 + h, 0.24, 0.05, 0.16, '#b9b2a2'));
  }
  out.push(beam([-0.35, -0.3, 1.0], [0.25, -0.35, 0.86], 0.03, STEEL));
  out.push(box(0.45, 0.4, 0.04, 0.3, 0.26, 0.2, PANEL, { door: { face: '+s', w: 0.12, h: 0.15, color: STEEL_DARK } }));
  return out;
}

function assemblyHall(): Part[] {
  return [
    box(0, 0, 0, 2.0, 1.7, 0.04, CONCRETE),
    box(-0.2, -0.1, 0.04, 1.2, 1.1, 1.05, '#d7dde3', { door: { face: '+f', w: 0.42, h: 0.95, color: '#56606b' }, stripe: { z: 0.9, h: 0.06, color: AGENCY }, windows: { rows: 1, cols: 4, faces: ['+s'], from: 0.75, to: 0.88 } }),
    box(-0.2, -0.1, 1.09, 1.24, 1.14, 0.05, STEEL),
    // Gantry crane over the yard.
    beam([0.55, -0.6, 0.04], [0.55, -0.6, 0.75], 0.04, HAZARD),
    beam([0.55, 0.55, 0.04], [0.55, 0.55, 0.75], 0.04, HAZARD),
    beam([0.55, -0.6, 0.75], [0.55, 0.55, 0.75], 0.05, HAZARD),
    box(0.55, 0.1, 0.62, 0.1, 0.12, 0.08, STEEL_DARK),
    box(0.75, 0.1, 0.04, 0.3, 0.4, 0.12, '#9aa3ad'),
    light(-0.2, -0.1, 1.2, 0.03, RED, 0.7),
  ];
}

function observatory(): Part[] {
  return [
    box(0, 0, 0, 1.5, 1.5, 0.04, CONCRETE_DARK),
    cyl(0, 0, 0.04, 0.42, 0.42, 0.4, WHITE, { bands: [{ z: 0.36, h: 0.04, color: AGENCY }], n: 24 }),
    ...dome(0, 0, 0.44, 0.44, 0.4, '#e9edf1', 6),
    box(0.22, 0.22, 0.6, 0.12, 0.12, 0.22, '#30363e'),
    box(0.52, -0.42, 0.04, 0.34, 0.3, 0.22, PANEL, { door: { face: '+f', w: 0.1, h: 0.16, color: STEEL_DARK } }),
  ];
}

/** Before the ground is broken: a surveyor's flag on the site. */
function surveyFlag(): Part[] {
  return [
    beam([0, 0, 0], [0, 0, 0.7], 0.025, '#e6e8eb'),
    box(0, 0.11, 0.55, 0.015, 0.22, 0.14, AGENCY),
    flat([[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]], 'rgba(232,105,46,0.5)', 0.003),
  ];
}

/** A drill rig on a deposit. */
function drillRig(): Part[] {
  return [
    box(0, 0, 0, 0.9, 0.9, 0.05, CONCRETE_DARK),
    ...truss(0, 0, 0.05, 0.3, 1.0, HAZARD, 0.25, 0.03),
    box(0, 0, 1.05, 0.38, 0.38, 0.08, STEEL_DARK),
    cyl(0, 0, 0.05, 0.05, 0.05, 0.95, STEEL),
    box(0.32, 0.25, 0.05, 0.26, 0.22, 0.2, PANEL, { stripe: { z: 0.15, h: 0.03, color: AGENCY } }),
    light(0, 0, 1.16, 0.03, RED, 0.8),
  ];
}

export const ASPHALT_COLOR = ASPHALT;
export const AGENCY_COLOR = AGENCY;

const BUILT_IN: AssetDef[] = [
  { id: 'survey-flag', name: 'Survey flag', footprint: 1, buildSeconds: 0.6, model: surveyFlag },
  { id: 'agency-hq', name: 'Agency headquarters', footprint: 2, buildSeconds: 4.2, model: agencyHq },
  { id: 'launch-pad', name: 'Launch pad', footprint: 3, buildSeconds: 4.6, model: launchPad },
  { id: 'solar-farm', name: 'Solar farm', footprint: 2, buildSeconds: 3.2, model: solarFarm },
  { id: 'warehouse', name: 'Warehouse', footprint: 2, buildSeconds: 3.4, model: warehouse },
  { id: 'fuel-depot', name: 'Fuel depot', footprint: 2, buildSeconds: 3.6, model: fuelDepot },
  { id: 'comms-dish', name: 'Deep-space dish', footprint: 2, buildSeconds: 3.6, model: commsDish },
  { id: 'hangar', name: 'Probe hangar', footprint: 2, buildSeconds: 3.8, model: hangar },
  { id: 'habitat', name: 'Crew habitat', footprint: 2, buildSeconds: 3.6, model: habitat },
  { id: 'silo', name: 'Storage silos', footprint: 2, buildSeconds: 3.4, model: silo },
  { id: 'assembly-hall', name: 'Assembly hall', footprint: 2, buildSeconds: 4, model: assemblyHall },
  { id: 'observatory', name: 'Observatory', footprint: 2, buildSeconds: 3.6, model: observatory },
  { id: 'drill-rig', name: 'Drill rig', footprint: 1, buildSeconds: 3, model: drillRig },
];
for (const def of BUILT_IN) registerAsset(def);
