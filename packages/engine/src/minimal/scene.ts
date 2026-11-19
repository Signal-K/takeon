import type { RoverGame } from '../core/game.js';
import { createRoverGame } from '../core/game.js';
import type { BodyDef, ResourceKey, RoverSpec, Structure, Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { MATERIALS } from '../world/materials.js';
import { getBody } from '../world/registry.js';
import { surveySpec } from '../survey/scene.js';

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
 * The camera drifts slowly; there are no controls, no HUD, nothing to learn.
 * Outpost buildings and rockets are props (drawn, never simulated), so these
 * frame the existing Go-backed world only: no new rules, generation unchanged.
 */

/** Closer than the survey framing so the rover, route and deposit fill a phone frame. */
export const MINIMAL_ZOOM = 2.6;
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

/** Outpost layout around its pad, in tile offsets (pad first). */
const OUTPOST: Array<{ type: Structure['type']; dx: number; dy: number; facing?: 0 | 1 | 2 | 3 }> = [
  { type: 'launch-pad', dx: 0, dy: 0 },
  { type: 'habitat', dx: -2, dy: 1 },
  { type: 'solar-array', dx: -2, dy: -1 },
  { type: 'solar-array', dx: -3, dy: 0 },
  { type: 'drill-rig', dx: 2, dy: -1 },
  { type: 'beacon', dx: 1, dy: 2 },
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
  /** Draw the rover. Default true, except `launch` (it would stand in front of the pad). */
  rover?: boolean;
  /** Slow camera drift (and, in `launch`, the rockets). Off for reduced motion. Default true. */
  drift?: boolean;
  /** Where the rover-and-deposit pair sits in the view, as fractions (0..1). Default {x: 0.5, y: 0.36}, above a bottom card. */
  focus?: { x: number; y: number };
  /** Camera zoom. Default MINIMAL_ZOOM. */
  zoom?: number;
}

export interface MinimalSceneHandle {
  game: RoverGame;
  /** The deposit the route points at, if the body has one. */
  deposit: MinimalDeposit | null;
  /** The outpost's launch pad (`outpost` and `launch` scenes). */
  pad: Vec2 | null;
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

  let deposit: MinimalDeposit | null = null;
  let pad: Vec2 | null = null;
  let focus: Vec2 = sim.rover.pos;
  if (kind === 'deposit') {
    deposit = findMinimalDeposit(sim, opts.highlight);
    if (deposit) {
      const stand = standFor(sim, deposit.pos);
      if (stand) parkRover(stand);
      game.showRoute([deposit.pos]);
      // Frame the midpoint of rover and deposit.
      focus = { x: Math.round((sim.rover.pos.x + deposit.pos.x) / 2), y: Math.round((sim.rover.pos.y + deposit.pos.y) / 2) };
    }
  } else {
    pad = outpostSite(sim);
    const props = outpostProps(sim, pad);
    game.showProps(props);
    const taken = new Set(props.map((p) => `${p.pos.x},${p.pos.y}`));
    const park = [{ x: pad.x + 2, y: pad.y + 1 }, { x: pad.x + 1, y: pad.y + 1 }, { x: pad.x - 1, y: pad.y + 2 }]
      .find((p) => sim.world.inBounds(p.x, p.y) && sim.world.isSolid(p.x, p.y) && !taken.has(`${p.x},${p.y}`));
    if (park) parkRover({ ...park, facing: 1 });
    focus = pad;
  }

  // The launch frames the pad alone; a parked rover would stand in front of it.
  game.iso.showRover = opts.rover ?? kind !== 'launch';

  const zoom = opts.zoom ?? MINIMAL_ZOOM;
  game.camera.zoom = zoom;
  game.camera.minZoom = zoom;
  game.camera.maxZoom = zoom;
  // The launch scene keeps the pad low so the rocket climbs into the frame.
  let frame = opts.focus ?? (kind === 'launch' ? { x: 0.5, y: 0.62 } : { x: 0.5, y: 0.36 });
  game.setCameraFollow(false);
  game.renderer.focusTile(focus);
  const home = { cx: game.camera.cx, cy: game.camera.cy };

  let raf = 0;
  const drift = opts.drift !== false && typeof requestAnimationFrame === 'function';
  let nextLaunch = 0.8;
  const place = (t: number) => {
    const sway = drift ? 1 : 0;
    game.camera.cx = home.cx + (0.5 - frame.x) * game.camera.viewW / game.camera.zoom + Math.sin(t / 5200) * 6 * sway;
    game.camera.cy = home.cy + (0.5 - frame.y) * game.camera.viewH / game.camera.zoom + Math.cos(t / 7100) * 3 * sway;
  };
  const tick = (t: number) => {
    place(t);
    if (kind === 'launch' && pad && game.iso.renderTime >= nextLaunch) {
      game.showLaunch(pad);
      nextLaunch = game.iso.renderTime + LAUNCH_EVERY;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    game,
    deposit,
    pad,
    start: () => {
      game.start();
      // Reduced motion: no sway and no rockets; the pad stands ready.
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
    },
  };
}
