import type { BodyDef, MissionState, RoverSpec, StructureType, Vec2 } from '../types.js';
import { EventBus } from '../util/events.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import { Camera } from '../render/camera.js';
import { FlatRenderer } from '../render/flat.js';
import { IsoRenderer } from '../render/renderer.js';
import type { SceneView } from '../render/view.js';
import { buildScene } from '../scene/build.js';
import type { Scene, ViewKind } from '../scene/types.js';
import { Controls } from '../input/controls.js';
import { GameAudio } from '../audio/audio.js';

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
  /**
   * Called when the player taps a tile. Return true to consume the tap
   * (e.g. to show a context menu offering "drive here" / "mine this");
   * return false/undefined for the default behaviour (drive there).
   */
  onTileTap?: (tile: Vec2, canvas: { x: number; y: number }) => boolean | void;
  /** Disable the built-in synthesised audio (default enabled but silent
   * until `game.audio.unlock()` is called from a user gesture). */
  audio?: boolean;
  /** Which view to open in: the isometric diorama or the flat 2D map.
   * (Named `startView` because PixiJS hosts already pass a `view` canvas.) */
  startView?: ViewKind;
}

/** A queued player order: drive somewhere, or go mine a specific column. */
export type RoverOrder =
  | { type: 'goto'; pos: Vec2 }
  | { type: 'mine'; pos: Vec2 };

/**
 * Facade tying sim + renderer + controls together behind one small API.
 * This is the unit that embeds into any host: standalone page, PixiJS
 * stage (via @takeon/pixi), or another engine that can host a canvas.
 */
export class RoverGame {
  readonly events = new EventBus();
  readonly sim: Simulation;
  /** The isometric ("3D" diorama) view. Always constructed. */
  readonly iso: IsoRenderer;
  /** Shared by every view, so input and host code keep one camera. */
  readonly camera = new Camera();
  /** Synthesised audio director. Call `game.audio.unlock()` on first tap. */
  readonly audio: GameAudio;
  private flatView: FlatRenderer | null = null;
  private activeView: SceneView;
  private controls: Controls | null = null;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private dpr = 1;
  private order: RoverOrder | null = null;
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
    this.iso = new IsoRenderer(opts.canvas, this.sim, this.camera);
    this.activeView = this.iso;
    if (opts.startView === 'flat') this.setView('flat');
    this.audio = new GameAudio({ enabled: opts.audio !== false });
    this.audio.startAmbient(this.sim.body.id);
    this.wireAudio();
    if (opts.controls !== false) {
      this.controls = new Controls(opts.canvas, this.renderer.camera, {
        onMove: (dir) => this.move(dir),
        onAction: (a) => {
          if (a === 'mine') this.mine();
          else if (a === 'photo') this.photo();
          else if (a === 'scan') this.scan();
          else if (a === 'rotate') this.rotateView();
          else if (a === 'place') this.placeBlock();
        },
        onTileTap: (x, y) => {
          const tile = this.renderer.pickTile(x, y);
          if (!tile) return;
          const consumed = this.opts.onTileTap?.(tile, { x, y });
          if (!consumed) this.walkTo(tile.x, tile.y);
        },
      });
    }
  }

  /** Map simulation events onto synthesised sound effects. */
  private wireAudio(): void {
    const a = this.audio;
    const on = this.events.on.bind(this.events);
    on('moved', () => a.moveStep());
    on('mined', () => a.mine());
    on('built', () => a.build());
    on('blockPlaced', () => a.place());
    on('demolished', () => a.place());
    on('crafted', () => a.craft());
    on('scan', () => a.scan());
    on('photo', () => a.photo());
    on('anomalyDocumented', () => a.discovery());
    on('cargoLaunched', () => a.launch());
    on('upgraded', () => a.upgrade());
    on('habitatComplete', () => a.habitat());
    on('damaged', ({ amount }) => amount >= 1 && a.damage());
    on('repaired', () => a.repair());
    on('weather', ({ phase }) => phase === 'start' && a.weather());
    on('roverLost', () => a.lost());
    on('buildFailed', () => a.error());
    on('rotateFailed', () => a.error());
    on('demolishFailed', () => a.error());
    on('craftFailed', () => a.error());
    on('launchFailed', () => a.error());
    on('upgradeFailed', () => a.error());
    on('blocked', ({ reason }) => reason !== 'busy' && a.error());
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
    this.audio.stopAmbient();
    this.controls?.dispose();
    this.events.clear();
    this.sim.world.onColumnChange = null;
  }

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.dpr = dpr;
    this.renderer.resize(cssW, cssH, dpr);
  }

  // ── Player API (mirrors what the HUD buttons call) ────────────────────

  /**
   * Drive one tile. `dir` is screen-relative (0=SE 1=SW 2=NW 3=NE as seen);
   * the current view rotation maps it onto world axes so "up" always means
   * up on screen regardless of perspective.
   */
  move(dir: 0 | 1 | 2 | 3): boolean {
    this.order = null;
    const worldDir = (((dir + this.renderer.rotation) % 4) + 4) % 4;
    return this.sim.move(worldDir as 0 | 1 | 2 | 3);
  }

  /** Rotate the perspective by 90° (both views understand rotation). */
  rotateView(): void {
    this.renderer.rotateClockwise();
  }

  /** The renderer currently drawing: iso diorama or flat map. */
  get renderer(): SceneView {
    return this.activeView;
  }

  /** Which view is live. */
  get view(): ViewKind {
    return this.activeView.kind;
  }

  /**
   * Switch between the isometric diorama and the top-down 2D map. The camera
   * is shared, so the new view opens on the same tile at a comparable zoom,
   * and anything holding `game.camera` keeps working.
   */
  setView(kind: ViewKind): void {
    if (kind === this.activeView.kind) return;
    const centre = this.activeView.centreTile();
    const follow = this.camera.follow;
    this.activeView.deactivate();
    if (kind === 'flat') {
      if (!this.flatView) this.flatView = new FlatRenderer(this.opts.canvas, this.sim, this.camera);
      this.activeView = this.flatView;
    } else {
      this.activeView = this.iso;
    }
    this.activeView.setRotation(this.iso.rotation);
    this.activeView.activate();
    this.activeView.resize(this.camera.viewW, this.camera.viewH, this.dpr);
    this.activeView.focusTile(centre);
    this.camera.follow = follow;
    this.events.emit('viewChanged', { view: kind });
  }

  /** Toggle between the two built-in views. */
  toggleView(): ViewKind {
    this.setView(this.activeView.kind === 'iso' ? 'flat' : 'iso');
    return this.activeView.kind;
  }

  /**
   * The current frame as a renderer-agnostic scene description — entities,
   * positions, facings and flags. Hosts that want to draw TakeOn with their
   * own technology start here.
   */
  scene(): Scene {
    return buildScene(this.sim, { view: this.view });
  }

  craft(recipeId: string): boolean {
    return this.sim.craft(recipeId);
  }

  placeBlock(): boolean {
    return this.sim.placeBlock();
  }

  /** Tap-to-drive: greedily steps toward the target until reached/blocked. */
  walkTo(x: number, y: number): void {
    this.order = { type: 'goto', pos: { x, y } };
  }

  /**
   * Mining order: drive until adjacent to the target column, face it, then
   * mine it down until it's level with the rover's own ground (or cargo /
   * battery / tool says no). This is the "go mine that" instruction.
   */
  orderMine(x: number, y: number): void {
    this.order = { type: 'mine', pos: { x, y } };
    this.mineOrderStarted = false;
  }

  /** The currently queued order, if any (for HUD display). */
  currentOrder(): RoverOrder | null {
    return this.order;
  }

  cancelOrder(): void {
    this.order = null;
    this.mineOrderStarted = false;
  }

  mine(): boolean {
    this.order = null;
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

  /** Rotate a placed structure's cosmetic facing 90°. */
  rotateStructure(id: string): boolean {
    return this.sim.rotateStructure(id);
  }

  /** Demolish a placed structure (no resource refund). */
  demolish(id: string): boolean {
    return this.sim.demolish(id);
  }

  repair(): boolean {
    return this.sim.repair();
  }

  deposit(): number {
    return this.sim.depositCargo();
  }

  /** Fire the hold home on a cargo rocket from an adjacent launch pad. */
  launchCargo(): boolean {
    return this.sim.launchCargo();
  }

  /** Bolt on a mobility kit (climb/grip/speed) using refined materials. */
  upgradeMobility(): boolean {
    return this.sim.upgradeMobility();
  }

  save(): MissionState {
    return this.sim.serialize();
  }

  setCameraFollow(follow: boolean): void {
    this.renderer.camera.follow = follow;
  }

  private stuckCount = 0;
  private mineOrderStarted = false;

  /** Execute the queued order, one step per idle tick. */
  private autoWalk(): void {
    const o = this.order;
    if (!o) return;
    const r = this.sim.rover;
    if (r.moveFrom || r.mining) return;
    const dx = o.pos.x - r.pos.x;
    const dy = o.pos.y - r.pos.y;
    const manhattan = Math.abs(dx) + Math.abs(dy);

    if (o.type === 'mine') {
      if (manhattan === 0) {
        this.order = null; // standing on it — nothing to mine from here
        return;
      }
      if (manhattan === 1) {
        // Adjacent: face the column and mine it down until it's level
        // with the ground we're standing on.
        r.facing = dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
        const targetH = this.sim.world.height(o.pos.x, o.pos.y);
        const myH = this.sim.world.height(r.pos.x, r.pos.y);
        if (targetH <= 0 || (this.mineOrderStarted && targetH <= Math.max(0, myH))) {
          this.order = null;
          this.mineOrderStarted = false;
          return;
        }
        if (this.sim.mine()) {
          this.mineOrderStarted = true;
        } else {
          this.order = null; // cargo full / battery / unreachable — stop
          this.mineOrderStarted = false;
        }
        return;
      }
      // Not adjacent yet — fall through and drive toward it.
    } else if (manhattan === 0) {
      this.order = null;
      return;
    }

    // Greedy step: dominant axis first, other axis as fallback.
    const primary: 0 | 1 | 2 | 3 = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
    const secondary: 0 | 1 | 2 | 3 = Math.abs(dx) >= Math.abs(dy)
      ? dy > 0 ? 1 : dy < 0 ? 3 : (dx > 0 ? 0 : 2)
      : dx > 0 ? 0 : dx < 0 ? 2 : (dy > 0 ? 1 : 3);
    if (!this.sim.move(primary) && !this.sim.move(secondary)) {
      this.stuckCount++;
      if (this.stuckCount > 3) {
        this.order = null; // stuck — give up rather than burn battery
        this.stuckCount = 0;
        this.mineOrderStarted = false;
      }
    } else {
      this.stuckCount = 0;
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createRoverGame(opts: RoverGameOptions): RoverGame {
  return new RoverGame(opts);
}
