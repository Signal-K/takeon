import type { RoverGame } from '../core/game.js';
import { createRoverGame } from '../core/game.js';
import type { BodyDef, ResourceKey, RoverSpec, Structure, Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { MATERIALS } from '../world/materials.js';
import { getBody } from '../world/registry.js';
import { surveySpec } from '../survey/scene.js';
import { setCameraElevation } from '../render/sprites.js';
import { BuildSite, getAsset, lPath } from '../kit/index.js';

/**
 * Minimal scenes: small, read-only dioramas for hosts that need a picture of a
 * place, not a field to drive (Landnam Minimal, KES-530 / SSL-864).
 *
 * - `deposit`: the rover stands a few tiles from one ore deposit, a dashed
 *   route runs to it and a gold ring pulses on it. "This is where you dig."
 * - `outpost`: a small settlement on flat ground (pad, habitat, solar,
 *   beacon, drill rig) with the rover parked beside it. "This is home."
 * - `launch`: the same outpost framed on its pad, a rocket lifting off every
 *   few seconds. "Off you go."
 *
 * The camera holds still at a fixed angle, so up and down on screen always
 * mean the same thing; there are no controls, no HUD, nothing to learn. The
 * ground is drawn calm (one clean tone per tile, biome edges blended) over a
 * display relief that is smoothed and flattened around the frame's subject,
 * so it rolls instead of stepping (KES-532).
 * Outpost buildings and rockets are props (drawn, never simulated), so these
 * frame the existing Go-backed world only: no new rules, generation unchanged.
 */

/** Closer than the survey framing so the rover, route and deposit fill a phone frame. */
export const MINIMAL_ZOOM = 3.4;
/** Drawn-only buildings at about two tiles, so a small outpost reads as places, not marks. */
export const MINIMAL_PROP_SCALE = 1.7;
/** Tiles around the subject that are drawn dead flat, and the ring over which that eases out. */
const FLAT_RADIUS = 5;
const FLAT_EASE = 6;
/**
 * Near-isometric: low enough that ground, cliffs and the three-quarter entity
 * art share one perspective (60° reads as a flat map under 3D sprites), high
 * enough that a route on the ground stays long and rough cliffs stay short.
 */
export const MINIMAL_ELEVATION = 40;
/** The stock rover is drawn about two tiles wide; a diorama wants it one tile wide. */
export const MINIMAL_ROVER_SCALE = 1.35;
/** Tiles between the rover and the deposit, so the route reads at a glance. */
const STAND_OFF = 4;
/** How far under the surface a deposit may sit and still count (ore is shallow, not on top). */
const DEPOSIT_DEPTH = 4;
/** Ores that read as rock, not as something worth flying for. */
const PLAIN = new Set<ResourceKey>(['regolith', 'stone']);

export interface MinimalDeposit {
  pos: Vec2;
  resource: ResourceKey;
}

/** The first non-plain ore in the top few voxels of a column, if any. */
function shallowOre(world: Simulation['world'], x: number, y: number): ResourceKey | null {
  const top = world.height(x, y);
  for (let z = top; z >= Math.max(0, top - DEPOSIT_DEPTH); z--) {
    const resource = MATERIALS[world.get(x, y, z)]?.yields?.resource;
    if (resource && !PLAIN.has(resource)) return resource;
  }
  return null;
}

/** Nearest shallow deposit of a wanted resource, else of any ore that is not plain rock. */
export function findMinimalDeposit(sim: Simulation, wanted: readonly ResourceKey[] = []): MinimalDeposit | null {
  const world = sim.world;
  const origin = sim.rover.pos;
  let bestWanted: (MinimalDeposit & { d: number }) | null = null;
  let bestAny: (MinimalDeposit & { d: number }) | null = null;
  for (let y = 2; y < world.size - 2; y++) {
    for (let x = 2; x < world.size - 2; x++) {
      if (!world.isSolid(x, y)) continue;
      const resource = shallowOre(world, x, y);
      if (!resource) continue;
      const d = Math.hypot(x - origin.x, y - origin.y);
      const hit = { pos: { x, y }, resource, d };
      if (wanted.includes(resource)) {
        if (!bestWanted || d < bestWanted.d) bestWanted = hit;
      } else if (!bestAny || d < bestAny.d) {
        bestAny = hit;
      }
    }
  }
  const best = bestWanted ?? bestAny;
  return best ? { pos: best.pos, resource: best.resource } : null;
}

/** A solid tile about STAND_OFF from the deposit, down-screen first so the route climbs the frame. */
function standFor(sim: Simulation, deposit: Vec2): (Vec2 & { facing: 0 | 1 | 2 | 3 }) | null {
  const dirs: Array<[number, number, 0 | 1 | 2 | 3]> = [
    [1, 1, 3], [0, 1, 3], [1, 0, 2], [-1, 1, 3], [1, -1, 2], [-1, 0, 0], [0, -1, 1], [-1, -1, 0],
  ];
  for (let r = STAND_OFF; r >= 2; r--) {
    for (const [dx, dy, facing] of dirs) {
      const x = deposit.x + dx * r;
      const y = deposit.y + dy * r;
      if (sim.world.inBounds(x, y) && sim.world.isSolid(x, y)) return { x, y, facing };
    }
  }
  return null;
}

export type MinimalSceneKind = 'deposit' | 'outpost' | 'launch';

/** Seconds between drawn rocket launches in the `launch` scene. */
const LAUNCH_EVERY = 5.5;

/** How uneven a 5x5 patch may be (summed height difference) to host the outpost. */
function roughness(sim: Simulation, cx: number, cy: number): number {
  const world = sim.world;
  const h0 = world.height(cx, cy);
  let sum = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!world.inBounds(x, y) || !world.isSolid(x, y)) return Infinity;
      sum += Math.abs(world.height(x, y) - h0);
    }
  return sum;
}

/** The flattest patch near the landing site: where the outpost goes. */
function outpostSite(sim: Simulation): Vec2 {
  const origin = sim.landingSite;
  let best = { x: origin.x, y: origin.y };
  let bestScore = Infinity;
  for (let r = 0; r <= 12 && bestScore > 0; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const score = roughness(sim, origin.x + dx, origin.y + dy);
        if (score < bestScore) {
          bestScore = score;
          best = { x: origin.x + dx, y: origin.y + dy };
        }
      }
  }
  return best;
}

/**
 * A display heightfield for the diorama: the world's heights blurred twice
 * (5x5 box), kept fractional (whole-voxel rounding drew every gentle rise as
 * a lit or shaded diamond), then pressed flat to the subject's height within
 * FLAT_RADIUS and eased back over FLAT_EASE. Neighbours end up well under a
 * step apart, which the renderer draws as one continuous slope, not cliffs.
 * Drawing only: the sim's voxels, mining and saves never see it.
 */
export function minimalRelief(world: Simulation['world'], subject: Vec2, flatRadius: number | null = FLAT_RADIUS): (x: number, y: number) => number {
  const n = world.size;
  let cur = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cur[y * n + x] = Math.max(0, world.height(x, y));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= n || sy >= n || world.height(sx, sy) < 0) continue;
            sum += cur[sy * n + sx];
            count++;
          }
        next[y * n + x] = count ? sum / count : cur[y * n + x];
      }
    cur = next;
  }
  const base = Math.round(cur[subject.y * n + subject.x]);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - subject.x, y - subject.y);
      const t = flatRadius == null ? 1 : Math.min(1, Math.max(0, (d - flatRadius) / FLAT_EASE));
      const ease = t * t * (3 - 2 * t);
      out[y * n + x] = Math.max(0, Math.min(world.maxHeight - 1, base + (cur[y * n + x] - base) * ease));
    }
  return (x, y) => out[y * n + x];
}

/** Outpost layout around its pad, in tile offsets (pad first). */
const OUTPOST: Array<{ type: Structure['type']; dx: number; dy: number; facing?: 0 | 1 | 2 | 3 }> = [
  { type: 'launch-pad', dx: 0, dy: 0 },
  { type: 'habitat', dx: -3, dy: 1 },
  { type: 'solar-array', dx: -2, dy: -2 },
  { type: 'solar-array', dx: -4, dy: -1 },
  { type: 'drill-rig', dx: 3, dy: -1 },
  { type: 'beacon', dx: 1, dy: 3 },
];

/** Props for the outpost at `pad`, each nudged to the nearest solid tile it may stand on. */
export function outpostProps(sim: Simulation, pad: Vec2): Structure[] {
  const taken = new Set<string>();
  const props: Structure[] = [];
  for (const [i, item] of OUTPOST.entries()) {
    let spot: Vec2 | null = null;
    for (let r = 0; r <= 2 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++)
        for (let dx = -r; dx <= r && !spot; dx++) {
          const x = pad.x + item.dx + dx;
          const y = pad.y + item.dy + dy;
          if (taken.has(`${x},${y}`) || !sim.world.inBounds(x, y) || !sim.world.isSolid(x, y)) continue;
          spot = { x, y };
        }
    if (!spot) continue;
    taken.add(`${spot.x},${spot.y}`);
    props.push({ id: `minimal-${item.type}-${i}`, type: item.type, pos: spot, buffer: {}, facing: item.facing ?? 0, progress: 1 });
  }
  return props;
}

/**
 * How far a base has got (KES-533). The story founds it in four steps —
 * clear the ground, flatten it, place the agency, build the launch pad —
 * and every chapter after that adds a building, each joined to the agency
 * by a road.
 */
export type MinimalFoundingStage = 'raw' | 'cleared' | 'flattened' | 'agency' | 'founded';
export const MINIMAL_FOUNDING: readonly MinimalFoundingStage[] = ['raw', 'cleared', 'flattened', 'agency', 'founded'];

export interface MinimalBase {
  stage: MinimalFoundingStage;
  /** Buildings beyond the agency and pad (kit asset ids), standing already. */
  buildings?: readonly string[];
}

/** A step the host can play on a base scene: the founding steps, or a kit asset id to raise. */
export type MinimalBuildStep = 'clear' | 'flatten' | 'agency' | 'pad' | (string & {});

/** Where each building stands, in tiles from the site's centre. */
export const MINIMAL_BASE_LAYOUT: Record<string, { dx: number; dy: number }> = {
  'agency-hq': { dx: -2, dy: 1 },
  'launch-pad': { dx: 2, dy: -1 },
  'solar-farm': { dx: -2, dy: -2 },
  'fuel-depot': { dx: 3, dy: 2 },
  'comms-dish': { dx: 0, dy: 3 },
  warehouse: { dx: -4, dy: 2 },
  hangar: { dx: -4, dy: -1 },
  habitat: { dx: -3, dy: 4 },
  silo: { dx: 1, dy: -3 },
  'assembly-hall': { dx: 4, dy: -3 },
  observatory: { dx: -1, dy: -4 },
  'drill-rig': { dx: 4, dy: 4 },
};
/** Ground the founding clears and grades, in tiles from the centre. */
const SITE_RADIUS = 5.5;

/** A road from the agency to a building, trimmed to run between their footprints. */
function roadBetween(from: Vec2, fromFoot: number, to: Vec2, toFoot: number): Vec2[] {
  const path = lPath(from, to);
  const inside = (p: Vec2, c: Vec2, foot: number) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) < foot / 2;
  return path.filter((p, i) => i === 0 || i === path.length - 1 || (!inside(p, from, fromFoot) && !inside(p, to, toFoot)));
}

export interface MinimalSceneOptions {
  canvas: HTMLCanvasElement;
  /** Which picture. Default `deposit`. */
  kind?: MinimalSceneKind;
  /** Host body, or a registered body id. Defaults to the Moon. */
  body?: BodyDef | string;
  seed?: number;
  spec?: RoverSpec;
  /** Resources to highlight, in order of preference (host mineral ids that TakeOn knows). */
  highlight?: readonly ResourceKey[];
  /**
   * Camera elevation in degrees. Default 40 (near-isometric), so the ground,
   * cliffs and three-quarter entity art share one perspective. Module-wide
   * (see `setCameraElevation`); the scene restores the survey default on destroy.
   */
  elevation?: number;
  /** Rover size relative to its stock art. Default 0.62, in proportion with tiles and buildings. */
  roverScale?: number;
  /** Draw the rover. Default true, except `launch` (it would stand in front of the pad). */
  rover?: boolean;
  /** `launch`: fire a rocket every few seconds on its own. Off when the host fires them (`handle.launch()`). Default true. */
  autoLaunch?: boolean;
  /** Animation: in `launch`, the rockets. Off for reduced motion. Default true. (The camera no longer drifts.) */
  drift?: boolean;
  /** Ground look. Default `calm` (smoothed relief, clean tones); `field` keeps the rover game's ground. */
  ground?: 'calm' | 'field';
  /** Drawn building size relative to a tile. Default MINIMAL_PROP_SCALE. */
  propScale?: number;
  /** Where the rover-and-deposit pair sits in the view, as fractions (0..1). Default {x: 0.5, y: 0.36}, above a bottom card. */
  focus?: { x: number; y: number };
  /** Camera zoom. Default MINIMAL_ZOOM. */
  zoom?: number;
  /**
   * `outpost` and `launch`: draw the player's own base with the kit
   * (KES-533) instead of the stock outpost props: the founding stage it has
   * reached and the buildings it has. Play further steps with `handle.step`.
   */
  base?: MinimalBase;
}

export interface MinimalSceneHandle {
  game: RoverGame;
  /** The deposit the route points at, if the body has one. */
  deposit: MinimalDeposit | null;
  /** The outpost's launch pad (`outpost` and `launch` scenes). */
  pad: Vec2 | null;
  /** The outpost's props as placed; a host may restyle them and pass them to `game.showProps`. */
  props: Structure[];
  /** The base's build site, when the scene was given a `base`. */
  site: BuildSite | null;
  /** Where each base building stands (world tiles), when the scene has a base. */
  layout: Record<string, Vec2>;
  /**
   * Play one build step on the base (clear, flatten, agency, pad, or an
   * asset id to raise with its road). Returns milliseconds until it is done.
   */
  step(step: MinimalBuildStep): number;
  /** Fire one rocket from the pad now (drawn only). No-op without a pad. */
  launch(): void;
  start(): void;
  stop(): void;
  resize(width: number, height: number, dpr?: number): void;
  /** Move the pair within the view (a host layout change, e.g. a phone turned sideways). */
  setFocus(focus: { x: number; y: number }, zoom?: number): void;
  destroy(): void;
}

function resolveBody(body: BodyDef | string | undefined): BodyDef {
  if (body && typeof body !== 'string') return body;
  const found = getBody(body ?? 'moon') ?? getBody('moon');
  if (!found) throw new Error('takeon: no body registered for the minimal scene');
  return found;
}

/** Canvas embed: a read-only diorama. Nothing reacts to keys, taps or drags. */
export function createMinimalScene(opts: MinimalSceneOptions): MinimalSceneHandle {
  const kind = opts.kind ?? 'deposit';
  setCameraElevation(opts.elevation ?? MINIMAL_ELEVATION);
  const game = createRoverGame({
    canvas: opts.canvas,
    body: resolveBody(opts.body),
    spec: opts.spec ?? surveySpec('minimal-rover'),
    seed: opts.seed,
    controls: false,
    audio: false,
    startView: 'iso',
  });
  const sim = game.sim;
  const parkRover = (at: Vec2 & { facing: 0 | 1 | 2 | 3 }) => {
    sim.rover.pos = { x: at.x, y: at.y };
    sim.rover.renderPos = { x: at.x, y: at.y };
    sim.rover.facing = at.facing;
    sim.rover.moveFrom = null;
  };
  // A diorama frames one thing; landmark anomalies elsewhere read as stray marks.
  game.iso.showAnomalies = false;
  game.iso.fieldGrid = false;
  game.iso.facingHint = false;

  let deposit: MinimalDeposit | null = null;
  let pad: Vec2 | null = null;
  let props: Structure[] = [];
  let focus: Vec2 = sim.rover.pos;
  let site: BuildSite | null = null;
  let siteCenter: Vec2 | null = null;
  const layout: Record<string, Vec2> = {};
  if (kind === 'deposit') {
    deposit = findMinimalDeposit(sim, opts.highlight);
    if (deposit) {
      const stand = standFor(sim, deposit.pos);
      if (stand) parkRover(stand);
      game.showRoute([deposit.pos]);
      // Frame the midpoint of rover and deposit.
      focus = { x: Math.round((sim.rover.pos.x + deposit.pos.x) / 2), y: Math.round((sim.rover.pos.y + deposit.pos.y) / 2) };
    }
  } else if (opts.base) {
    // The player's base, built (or being built) with the kit.
    const c = outpostSite(sim);
    for (const [id, at] of Object.entries(MINIMAL_BASE_LAYOUT)) {
      const x = c.x + at.dx, y = c.y + at.dy;
      layout[id] = sim.world.inBounds(x, y) ? { x, y } : { ...c };
    }
    pad = layout['launch-pad'];
    site = new BuildSite(sim.seed);
    focus = kind === 'launch' ? pad : c;
    siteCenter = c;
  } else {
    pad = outpostSite(sim);
    props = outpostProps(sim, pad);
    game.showProps(props);
    const taken = new Set(props.map((p) => `${p.pos.x},${p.pos.y}`));
    const park = [{ x: pad.x + 3, y: pad.y + 2 }, { x: pad.x + 2, y: pad.y + 2 }, { x: pad.x + 3, y: pad.y + 3 }, { x: pad.x - 1, y: pad.y + 3 }]
      .find((p) => sim.world.inBounds(p.x, p.y) && sim.world.isSolid(p.x, p.y) && !taken.has(`${p.x},${p.y}`));
    if (park) parkRover({ ...park, facing: 1 });
    focus = pad;
  }

  if (opts.ground !== 'field') {
    game.iso.ground = 'calm';
    // A base's site does its own flattening; unbroken ground keeps its lumps.
    game.iso.relief = minimalRelief(sim.world, focus, site ? null : FLAT_RADIUS);
  }
  const area = siteCenter ? { center: siteCenter, radius: SITE_RADIUS } : null;
  const level = siteCenter ? Math.round(game.iso.relief ? game.iso.relief(siteCenter.x, siteCenter.y) : sim.world.height(siteCenter.x, siteCenter.y)) : 0;
  const foot = (id: string) => getAsset(id)?.footprint ?? 1;
  const roadTo = (id: string, instant: boolean) => {
    const hq = layout['agency-hq'];
    const at = layout[id];
    if (!site || !hq || !at || id === 'agency-hq') return;
    site.road(roadBetween(hq, foot('agency-hq'), at, foot(id)), { instant });
  };
  const playStep = (step: MinimalBuildStep, instant: boolean): number => {
    if (!site || !area) return 0;
    if (step === 'clear') site.clear(area, { instant });
    else if (step === 'flatten') site.flatten(area, level, { instant });
    else if (step === 'agency') {
      site.remove('survey-flag');
      site.build('agency-hq', layout['agency-hq'], { instant, id: 'agency-hq' });
    } else if (step === 'pad') {
      site.build('launch-pad', layout['launch-pad'], { instant, id: 'launch-pad' });
      roadTo('launch-pad', instant);
    } else if (getAsset(step) && layout[step]) {
      site.build(step, layout[step], { instant, id: step });
      roadTo(step, instant);
    }
    return Math.round(site.remaining() * 1000);
  };
  if (site && area && opts.base) {
    const reached = MINIMAL_FOUNDING.indexOf(opts.base.stage);
    site.roughen(area);
    site.scatter(area, (x, y) => sim.world.inBounds(x, y) && sim.world.isSolid(x, y));
    site.build('survey-flag', area.center, { instant: true, id: 'survey-flag' });
    const steps: MinimalBuildStep[] = ['clear', 'flatten', 'agency', 'pad'];
    for (let i = 0; i < reached; i++) playStep(steps[i], true);
    if (reached >= MINIMAL_FOUNDING.indexOf('founded')) for (const id of opts.base.buildings ?? []) playStep(id, true);
    game.iso.site = site;
  }
  game.iso.propScale = opts.propScale ?? MINIMAL_PROP_SCALE;

  // The launch frames the pad alone; a parked rover would stand in front of it.
  game.iso.showRover = opts.rover ?? (kind !== 'launch' && !opts.base);
  game.iso.roverScale = opts.roverScale ?? MINIMAL_ROVER_SCALE;
  game.iso.art = 'solid';

  const zoom = opts.zoom ?? MINIMAL_ZOOM;
  game.camera.zoom = zoom;
  game.camera.minZoom = zoom;
  game.camera.maxZoom = zoom;
  // The launch scene keeps the pad low so the rocket climbs into the frame.
  let frame = opts.focus ?? (kind === 'launch' ? { x: 0.5, y: 0.62 } : { x: 0.5, y: 0.36 });
  game.setCameraFollow(false);
  game.renderer.focusTile(focus);
  const home = { cx: game.camera.cx, cy: game.camera.cy };

  // A base's pad flies only once it stands finished.
  const padReady = () => {
    if (!pad) return false;
    const built = site?.buildings.find((b) => b.id === 'launch-pad');
    return !site || (!!built && site.buildProgress(built) >= 1);
  };
  let raf = 0;
  const drift = opts.drift !== false && typeof requestAnimationFrame === 'function';
  let nextLaunch = 0.8;
  const autoLaunch = opts.autoLaunch !== false;
  // A fixed camera: a drifting one left nothing to anchor direction to.
  const place = (_t: number) => {
    game.camera.cx = home.cx + (0.5 - frame.x) * game.camera.viewW / game.camera.zoom;
    game.camera.cy = home.cy + (0.5 - frame.y) * game.camera.viewH / game.camera.zoom;
  };
  const tick = (t: number) => {
    place(t);
    if (kind === 'launch' && autoLaunch && padReady() && game.iso.renderTime >= nextLaunch) {
      game.showLaunch(pad as Vec2);
      nextLaunch = game.iso.renderTime + LAUNCH_EVERY;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    game,
    deposit,
    pad,
    props,
    site,
    layout,
    step: (s) => playStep(s, false),
    launch: () => {
      if (pad && padReady()) game.showLaunch(pad as Vec2);
    },
    start: () => {
      game.start();
      // Reduced motion: no rockets; the pad stands ready.
      if (drift && !raf) raf = requestAnimationFrame(tick);
    },
    stop: () => {
      game.stop();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    resize: (width, height, dpr) => {
      game.resize(width, height, dpr);
      place(typeof performance !== 'undefined' ? performance.now() : 0);
    },
    setFocus: (next, nextZoom) => {
      frame = next;
      if (nextZoom) {
        game.camera.minZoom = game.camera.maxZoom = game.camera.zoom = nextZoom;
      }
      place(typeof performance !== 'undefined' ? performance.now() : 0);
    },
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      game.dispose();
      setCameraElevation();
    },
  };
}
