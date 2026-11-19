import type { RoverGame } from '../core/game.js';
import { createRoverGame } from '../core/game.js';
import type { BodyDef, ResourceKey, RoverSpec, Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { MATERIALS } from '../world/materials.js';
import { getBody } from '../world/registry.js';
import { surveySpec } from '../survey/scene.js';

/**
 * The minimal scene: a small, read-only diorama for hosts that need a picture
 * of a place, not a field to drive (Landnam Minimal, KES-530 / SSL-864).
 *
 * The rover stands a few tiles from one ore deposit, a dashed route runs from
 * it to the deposit (gold end dot), and the camera drifts slowly over the
 * pair. No controls, no HUD, nothing to learn. It frames the existing Go-backed
 * world only: no new rules, and generation output is unchanged.
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

export interface MinimalSceneOptions {
  canvas: HTMLCanvasElement;
  /** Host body, or a registered body id. Defaults to the Moon. */
  body?: BodyDef | string;
  seed?: number;
  spec?: RoverSpec;
  /** Resources to highlight, in order of preference (host mineral ids that TakeOn knows). */
  highlight?: readonly ResourceKey[];
  /** Slow camera drift. Off for reduced motion. Default true. */
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
  const deposit = findMinimalDeposit(sim, opts.highlight);
  if (deposit) {
    const stand = standFor(sim, deposit.pos);
    if (stand) {
      sim.rover.pos = { x: stand.x, y: stand.y };
      sim.rover.renderPos = { x: stand.x, y: stand.y };
      sim.rover.facing = stand.facing;
      sim.rover.moveFrom = null;
    }
    game.showRoute([deposit.pos]);
  }

  // Frame the midpoint of rover and deposit, then drift gently around it.
  const focus = deposit
    ? { x: Math.round((sim.rover.pos.x + deposit.pos.x) / 2), y: Math.round((sim.rover.pos.y + deposit.pos.y) / 2) }
    : sim.rover.pos;
  const zoom = opts.zoom ?? MINIMAL_ZOOM;
  game.camera.zoom = zoom;
  game.camera.minZoom = zoom;
  game.camera.maxZoom = zoom;
  let frame = opts.focus ?? { x: 0.5, y: 0.36 };
  game.setCameraFollow(false);
  game.iso.fieldGrid = false;
  game.renderer.focusTile(focus);
  const home = { cx: game.camera.cx, cy: game.camera.cy };

  let raf = 0;
  const drift = opts.drift !== false && typeof requestAnimationFrame === 'function';
  const place = (t: number) => {
    const sway = drift ? 1 : 0;
    game.camera.cx = home.cx + (0.5 - frame.x) * game.camera.viewW / game.camera.zoom + Math.sin(t / 5200) * 6 * sway;
    game.camera.cy = home.cy + (0.5 - frame.y) * game.camera.viewH / game.camera.zoom + Math.cos(t / 7100) * 3 * sway;
  };
  const tick = (t: number) => {
    place(t);
    raf = requestAnimationFrame(tick);
  };

  return {
    game,
    deposit,
    start: () => {
      game.start();
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
    setFocus: (focus, nextZoom) => {
      frame = focus;
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
