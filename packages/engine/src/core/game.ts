import type { BodyDef, MissionState, RoverSpec, StructureType, Vec2 } from '../types.js';
import { EventBus } from './events.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import { IsoRenderer } from '../render/renderer.js';
import { Controls } from '../input/controls.js';

export interface RoverGameOptions {
  /** Canvas to render into. The game manages its size via `resize()`. */
  canvas: HTMLCanvasElement;
  body: BodyDef;
  spec: RoverSpec;
  seed?: number;
  /** Resume a previously serialised mission. */
  resume?: MissionState;
  /** Attach built-in keyboard/touch controls (default true). */
  controls?: boolean;
  /** Called when a photo is taken, with the rendered image. */
  onPhoto?: (dataUrl: string | null, meta: MissionState['photos'][number]) => void;
}

/**
 * Facade tying sim + renderer + controls together behind one small API.
 * This is the unit that embeds into any host: standalone page, PixiJS
 * stage (via @takeon/pixi), or another engine that can host a canvas.
 */
export class RoverGame {
  readonly events = new EventBus();
  readonly sim: Simulation;
  readonly renderer: IsoRenderer;
  private controls: Controls | null = null;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private walkTarget: Vec2 | null = null;
  private opts: RoverGameOptions;

  constructor(opts: RoverGameOptions) {
    this.opts = opts;
    this.sim = new Simulation({
      body: opts.body,
      spec: opts.spec,
      events: this.events,
      seed: opts.seed,
      resume: opts.resume,
    });
    this.renderer = new IsoRenderer(opts.canvas, this.sim);
    if (opts.controls !== false) {
      this.controls = new Controls(opts.canvas, this.renderer.camera, {
        onMove: (dir) => this.move(dir),
        onAction: (a) => {
          if (a === 'mine') this.mine();
          else if (a === 'photo') this.photo();
          else this.scan();
        },
        onTileTap: (x, y) => {
          const tile = this.renderer.pickTile(x, y);
          if (tile) this.walkTo(tile.x, tile.y);
        },
      });
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = now();
    const frame = () => {
      if (!this.running) return;
      const t = now();
      this.acc += Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      while (this.acc >= TICK_DT) {
        this.sim.tick();
        this.autoWalk();
        this.acc -= TICK_DT;
      }
      this.renderer.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.controls?.dispose();
    this.events.clear();
    this.sim.world.onColumnChange = null;
  }

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.renderer.resize(cssW, cssH, dpr);
  }

  // ── Player API (mirrors what the HUD buttons call) ────────────────────

  move(dir: 0 | 1 | 2 | 3): boolean {
    this.walkTarget = null;
    return this.sim.move(dir);
  }

  /** Tap-to-drive: greedily steps toward the target until reached/blocked. */
  walkTo(x: number, y: number): void {
    this.walkTarget = { x, y };
  }

  mine(): boolean {
    this.walkTarget = null;
    return this.sim.mine();
  }

  photo(): void {
    const meta = this.sim.photo();
    if (!meta) return;
    const dataUrl = this.renderer.capturePhoto();
    this.events.emit('photo', { photo: meta, dataUrl });
    this.opts.onPhoto?.(dataUrl, meta);
  }

  scan(): void {
    this.sim.scan();
  }

  build(type: StructureType): boolean {
    return this.sim.build(type) !== null;
  }

  repair(): boolean {
    return this.sim.repair();
  }

  deposit(): number {
    return this.sim.depositCargo();
  }

  save(): MissionState {
    return this.sim.serialize();
  }

  setCameraFollow(follow: boolean): void {
    this.renderer.camera.follow = follow;
  }

  private lastWalkAttempt = 0;

  private autoWalk(): void {
    const t = this.walkTarget;
    if (!t) return;
    const r = this.sim.rover;
    if (r.moveFrom || r.mining) return;
    const dx = t.x - r.pos.x;
    const dy = t.y - r.pos.y;
    if (dx === 0 && dy === 0) {
      this.walkTarget = null;
      return;
    }
    // Greedy: step along the dominant axis; fall back to the other axis.
    const primary: 0 | 1 | 2 | 3 = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
    const secondary: 0 | 1 | 2 | 3 = Math.abs(dx) >= Math.abs(dy)
      ? dy > 0 ? 1 : dy < 0 ? 3 : (dx > 0 ? 0 : 2)
      : dx > 0 ? 0 : dx < 0 ? 2 : (dy > 0 ? 1 : 3);
    if (!this.sim.move(primary) && !this.sim.move(secondary)) {
      this.lastWalkAttempt++;
      if (this.lastWalkAttempt > 3) {
        this.walkTarget = null; // stuck — give up rather than burn battery
        this.lastWalkAttempt = 0;
      }
    } else {
      this.lastWalkAttempt = 0;
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createRoverGame(opts: RoverGameOptions): RoverGame {
  return new RoverGame(opts);
}
