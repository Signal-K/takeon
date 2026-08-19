import {
  Controls,
  createRoverGame,
  type RoverGame,
  type RoverGameOptions,
} from '@takeon/engine';

/**
 * Structural typings for the slice of PixiJS we use, so this package
 * compiles against pixi.js v7 or v8 without a hard build-time dependency.
 */
export interface PixiTextureLike {
  update?: () => void;
  source?: { update?: () => void };
  baseTexture?: { update?: () => void };
  destroy?: (destroyBase?: boolean) => void;
}

export interface PixiSpriteLike {
  x: number;
  y: number;
  width: number;
  height: number;
  texture: PixiTextureLike;
  destroy: (opts?: unknown) => void;
}

export interface PixiContainerLike {
  addChild: (child: unknown) => unknown;
  removeChild: (child: unknown) => unknown;
}

export interface PixiTickerLike {
  add: (fn: () => void) => unknown;
  remove: (fn: () => void) => unknown;
}

export interface PixiNamespaceLike {
  Texture: { from: (source: unknown) => PixiTextureLike };
  Sprite: new (texture: PixiTextureLike) => PixiSpriteLike;
}

export interface MountRoverGameOptions extends Omit<RoverGameOptions, 'canvas' | 'controls'> {
  /** The PixiJS namespace (`import * as PIXI from 'pixi.js'`). */
  pixi: PixiNamespaceLike;
  /** Container to add the game sprite to (e.g. app.stage or a window). */
  stage: PixiContainerLike;
  /** Pixi ticker used to refresh the texture (e.g. app.ticker). */
  ticker: PixiTickerLike;
  /** The host app's <canvas> for input, e.g. app.canvas / app.view. */
  view?: HTMLCanvasElement;
  width: number;
  height: number;
  /** Device pixel ratio for the internal render target (default 1). */
  resolution?: number;
  /**
   * Maximum rate at which the internal canvas is uploaded to Pixi's texture.
   * The simulation stays at its fixed 10 Hz; 30 fps keeps the mission smooth
   * without forcing a GPU upload for every host frame.
   */
  presentationFps?: number;
  x?: number;
  y?: number;
}

export interface MountedRoverGame {
  game: RoverGame;
  sprite: PixiSpriteLike;
  /** Resize the embedded viewport (CSS pixels). */
  resize: (width: number, height: number) => void;
  /** Start both the mission loop and Pixi texture presentation. */
  start: () => void;
  /** Stop the mission loop and remove the host ticker callback. */
  stop: () => void;
  /** Alias for `stop`, intended for hidden tabs and panels. */
  pause: () => void;
  /** Alias for `start`, intended when the host panel becomes visible again. */
  resume: () => void;
  /** Whether this mount currently owns an active mission/presentation loop. */
  isRunning: () => boolean;
  /** Remove from stage and release everything. */
  destroy: () => void;
}

/**
 * Mount a TakeOn rover mission inside an existing PixiJS scene graph.
 *
 * The engine renders isometric voxels into an internal canvas; this adapter
 * exposes it as a Pixi sprite and (optionally) wires pointer/keyboard input
 * from the host's canvas, offset by the sprite's stage position.
 *
 *   const mounted = mountRoverGame({
 *     pixi: PIXI, stage: app.stage, ticker: app.ticker, view: app.canvas,
 *     width: 800, height: 600,
 *     body: getBody('mars')!, spec: myRover,
 *   });
 *   mounted.start();
 */
export function mountRoverGame(opts: MountRoverGameOptions): MountedRoverGame {
  const resolution = opts.resolution ?? 1;
  const presentationInterval = 1000 / Math.max(1, opts.presentationFps ?? 30);
  const canvas = document.createElement('canvas');

  const game = createRoverGame({
    canvas,
    body: opts.body,
    spec: opts.spec,
    seed: opts.seed,
    resume: opts.resume,
    onPhoto: opts.onPhoto,
    onTileTap: opts.onTileTap,
    audio: opts.audio,
    startView: opts.startView,
    controls: false,
  });
  game.resize(opts.width, opts.height, resolution);

  const texture = opts.pixi.Texture.from(canvas);
  const sprite = new opts.pixi.Sprite(texture);
  sprite.x = opts.x ?? 0;
  sprite.y = opts.y ?? 0;
  sprite.width = opts.width;
  sprite.height = opts.height;
  opts.stage.addChild(sprite);

  let presenting = false;
  let lastPresentation = -Infinity;

  const refresh = (force = false) => {
    const time = now();
    if (!force && time - lastPresentation < presentationInterval) return;
    lastPresentation = time;
    // v8's Texture.update() only refreshes UV frame data, not GPU pixel
    // content (see its own docstring) — texture.source.update() is the call
    // that actually re-uploads the canvas. texture.update is truthy on every
    // v8 Texture, so it must be checked last or the correct branch below is
    // unreachable and the sprite freezes on its first-mount frame.
    // v7 fallback: baseTexture.update.
    if (texture.source?.update) texture.source.update();
    else if (texture.update) texture.update();
    else texture.baseTexture?.update?.();
  };

  const attachPresentation = () => {
    if (presenting) return;
    presenting = true;
    lastPresentation = -Infinity;
    opts.ticker.add(refresh);
    refresh(true);
  };

  const detachPresentation = () => {
    if (!presenting) return;
    presenting = false;
    opts.ticker.remove(refresh);
  };

  let controls: Controls | null = null;
  if (opts.view) {
    controls = new Controls(opts.view, game.renderer.camera, {
      onMove: (dir) => game.move(dir),
      onAction: (a) => {
        if (a === 'mine') game.mine();
        else if (a === 'photo') game.photo();
        else game.scan();
      },
      onTileTap: (x, y) => {
        const tile = game.renderer.pickTile(x - sprite.x, y - sprite.y);
        if (tile) game.walkTo(tile.x, tile.y);
      },
    });
  }

  return {
    game,
    sprite,
    resize: (width: number, height: number) => {
      game.resize(width, height, resolution);
      sprite.width = width;
      sprite.height = height;
      if (presenting) refresh(true);
    },
    start: () => {
      attachPresentation();
      game.start();
    },
    stop: () => {
      game.stop();
      detachPresentation();
    },
    pause: () => {
      game.stop();
      detachPresentation();
    },
    resume: () => {
      attachPresentation();
      game.start();
    },
    isRunning: () => presenting,
    destroy: () => {
      game.stop();
      detachPresentation();
      controls?.dispose();
      game.dispose();
      opts.stage.removeChild(sprite);
      sprite.destroy();
      texture.destroy?.(true);
    },
  };
}

export type { RoverGame } from '@takeon/engine';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
