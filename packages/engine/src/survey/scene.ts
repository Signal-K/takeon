import type { RoverGame, RoverGameOptions } from '../core/game.js';
import { createRoverGame } from '../core/game.js';
import type { Anomaly, BodyDef, RoverSpec, Vec2 } from '../types.js';
import type { Simulation } from '../sim/simulation.js';
import { getBody } from '../world/registry.js';

/**
 * The rover survey scene — the embeddable field view.
 *
 * Camera elevation lives in `render/sprites.ts` (`CAMERA_ELEVATION_DEG`, 60°).
 * This module is the host API: framing, the survey rover, and a snapshot the
 * web HUD and a native shell can both read. Landnam should call
 * `createSurveyScene` (canvas) or `mountSurveyScene` from `@takeon/pixi`.
 */

/** Closer than the old diorama so the rover fills a phone-width frame. */
export const SURVEY_ZOOM = 3.2;

export interface SurveyFormation {
  id: string;
  name: string;
  distance: number;
}

export interface SurveySnapshot {
  /** Sim seconds since landing. */
  time: number;
  /** `mm:ss` for the corner clock. */
  clock: string;
  fuel: number;
  /** Compact pill, e.g. `F50`. */
  fuelLabel: string;
  /** A crystal spire is inside the fitted scanner's radius. */
  formationInRange: boolean;
  nearestFormation: SurveyFormation | null;
  /** Hosts may show this; the stock chrome uses the ring and the SCAN button. */
  prompt: string;
  scanned: number;
  total: number;
}

/** Primary control is SCAN. SCAN / HUB / LASER stay available as secondary pills. */
export const SURVEY_CHROME = {
  drive: 'dpad' as const,
  primary: { id: 'scan' as const, label: 'SCAN' },
  secondary: [
    { id: 'scan' as const, label: 'SCAN', place: 'top' as const },
    { id: 'hub' as const, label: 'HUB', place: 'top' as const },
    { id: 'laser' as const, label: 'LASER', place: 'corner' as const },
  ],
};

/** Hauler frame so the aux tank, scoop, camera and scanner all fit. Hull is ice white. */
export function surveySpec(id = 'survey-rover'): RoverSpec {
  return {
    id,
    name: 'Surveyor',
    chassis: 'chassis-hauler',
    wheels: 'wheels-rocker',
    power: 'power-solar-s',
    battery: 'batt-cell',
    modules: ['tool-scoop', 'cam-nav', 'scan-short', 'fuel-long'],
    color: '#e7eef4',
  };
}

/** Icy default. Hosts pass their own `BodyDef` to survey somewhere else. */
export function defaultSurveyBody(): BodyDef {
  const body = getBody('europa');
  if (!body) throw new Error('takeon: europa body is not registered');
  return body;
}

export function formatSurveyClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Pure read of the live sim — no canvas required. */
export function surveySnapshot(sim: Simulation): SurveySnapshot {
  const rover = sim.rover;
  let nearest: SurveyFormation | null = null;
  for (const a of sim.anomalies) {
    if (a.type !== 'crystal-formation') continue;
    const distance = Math.hypot(a.pos.x - rover.pos.x, a.pos.y - rover.pos.y);
    if (!nearest || distance < nearest.distance) {
      nearest = { id: a.id, name: a.name, distance };
    }
  }
  const formationInRange =
    nearest != null && rover.stats.scanRadius > 0 && nearest.distance <= rover.stats.scanRadius;
  return {
    time: sim.time,
    clock: formatSurveyClock(sim.time),
    fuel: rover.fuel,
    fuelLabel: `F${Math.round(rover.fuel)}`,
    formationInRange,
    nearestFormation: nearest,
    prompt: formationInRange
      ? 'Formation in range. Scan it.'
      : 'Drive the field. Scan when a formation is in range.',
    scanned: sim.anomalies.filter((a) => a.scanned).length,
    total: sim.anomalies.length,
  };
}

/**
 * A solid tile beside the nearest crystal, with the rover facing it.
 * Prefers a stand down-screen of the spire so the ring sits above the rover.
 */
export function formationStand(sim: Simulation): (Vec2 & { facing: 0 | 1 | 2 | 3 }) | null {
  const crystals = sim.anomalies.filter((a) => a.type === 'crystal-formation');
  if (!crystals.length) return null;
  const origin = sim.rover.pos;
  let best = crystals[0]!;
  let bestD = Infinity;
  for (const a of crystals) {
    const d = Math.hypot(a.pos.x - origin.x, a.pos.y - origin.y);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  const options: [number, number][] = [
    [1, 1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];
  for (const [dx, dy] of options) {
    const x = best.pos.x + dx;
    const y = best.pos.y + dy;
    if (!sim.world.isSolid(x, y)) continue;
    const facing: 0 | 1 | 2 | 3 =
      Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 2 : 0) : dy > 0 ? 3 : 1;
    return { x, y, facing };
  }
  return null;
}

export interface SurveyFramingOptions {
  /** Park beside the nearest crystal spire. Skip when resuming a save. */
  moveToFormation?: boolean;
}

/** Zoom in, follow the rover, and optionally open beside a formation. */
export function applySurveyFraming(game: RoverGame, opts: SurveyFramingOptions = {}): void {
  game.camera.zoom = SURVEY_ZOOM;
  game.camera.minZoom = 1.6;
  game.camera.maxZoom = 6.4;
  game.camera.follow = true;
  if (opts.moveToFormation) {
    const stand = formationStand(game.sim);
    if (stand) {
      game.sim.rover.pos = { x: stand.x, y: stand.y };
      game.sim.rover.renderPos = { x: stand.x, y: stand.y };
      game.sim.rover.facing = stand.facing;
      game.sim.rover.moveFrom = null;
    }
  }
  game.renderer.focusTile(game.sim.rover.pos);
}

export interface SurveySceneOptions extends Omit<RoverGameOptions, 'body' | 'spec'> {
  body?: BodyDef;
  spec?: RoverSpec;
  /** Native/web HUB control. The scene does not change route by itself. */
  onHub?: () => void;
}

export interface SurveySceneHandle {
  game: RoverGame;
  start(): void;
  stop(): void;
  resize(width: number, height: number, dpr?: number): void;
  /** Screen-relative: 0 east, 1 south, 2 west, 3 north. */
  move(dir: 0 | 1 | 2 | 3): boolean;
  scan(): Anomaly[];
  /** Secondary tool. The stock binding is the mining laser. */
  laser(): boolean;
  hub(): void;
  snapshot(): SurveySnapshot;
  destroy(): void;
}

/**
 * Canvas embed for web or a native shell that can host a `<canvas>`.
 * Keyboard (WASD / arrows) is attached unless `controls: false`.
 */
export function createSurveyScene(opts: SurveySceneOptions): SurveySceneHandle {
  const body = opts.body ?? defaultSurveyBody();
  const spec = opts.spec ?? surveySpec();
  const game = createRoverGame({
    canvas: opts.canvas,
    body,
    spec,
    seed: opts.seed,
    resume: opts.resume,
    controls: opts.controls,
    audio: opts.audio,
    onPhoto: opts.onPhoto,
    onTileTap: opts.onTileTap,
    startView: 'iso',
  });
  applySurveyFraming(game, { moveToFormation: !opts.resume });

  return {
    game,
    start: () => game.start(),
    stop: () => game.stop(),
    resize: (width, height, dpr) => game.resize(width, height, dpr),
    move: (dir) => game.move(dir),
    scan: () => game.sim.scan(),
    laser: () => game.mine(),
    hub: () => opts.onHub?.(),
    snapshot: () => surveySnapshot(game.sim),
    destroy: () => game.dispose(),
  };
}
