// Verifying the mount contract with a MOCK Pixi namespace — no WebGL, no real
// Pixi. Because @takeon/pixi only touches the structural slice below, this is
// all it takes to confirm the adapter mounts, pumps its texture, runs the sim
// and tears down. Run it in a browser (it needs a DOM); bundle with esbuild:
//
//   esbuild example/mock-mount.mjs --bundle --format=iife > /tmp/mount.js
//   # then load an HTML file that inlines /tmp/mount.js
//
// In a real app you'd pass `import * as PIXI from 'pixi.js'` instead of this.

import { mountRoverGame } from '@takeon/pixi';
import { getBody, defaultSpec } from '@takeon/engine';

const PIXI = {
  Texture: {
    from(source) {
      const t = { _updates: 0, source: { update: () => t._updates++ }, destroy() { t._destroyed = true; } };
      return t;
    },
  },
  Sprite: class {
    constructor(texture) { this.texture = texture; this.x = 0; this.y = 0; this.width = 0; this.height = 0; }
    destroy() { this._destroyed = true; }
  },
};

const stage = {
  children: [],
  addChild(c) { this.children.push(c); return c; },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
};

let tickFns = [];
const ticker = { add: (fn) => tickFns.push(fn), remove: (fn) => (tickFns = tickFns.filter((f) => f !== fn)) };

const view = document.createElement('canvas');
view.width = 800;
view.height = 600;
document.body.appendChild(view);

const mounted = mountRoverGame({
  pixi: PIXI, stage, ticker, view,
  width: 800, height: 600,
  body: getBody('mars'), spec: defaultSpec(),
});
mounted.start(); // attaches both the game loop and Pixi presentation

// A real app.ticker fires these once per frame. We pump them by hand so the
// example is deterministic (no reliance on requestAnimationFrame timing).
for (let i = 0; i < 10; i++) for (const fn of tickFns) fn();

const mountOk =
  stage.children.includes(mounted.sprite) &&         // sprite added to the stage
  mounted.sprite.texture._updates >= 1 &&            // first texture upload happened
  tickFns.length === 1 &&                            // ticker attached only while active
  mounted.sprite.width === 800;
console.log(mountOk ? 'MOUNT OK' : 'MOUNT FAILED', { updates: mounted.sprite.texture._updates });

mounted.pause();
const pauseOk = tickFns.length === 0 && !mounted.isRunning();
console.log(pauseOk ? 'PAUSE OK' : 'PAUSE FAILED');
mounted.resume();

mounted.destroy();
const teardownOk = stage.children.length === 0 && tickFns.length === 0 && mounted.sprite._destroyed;
console.log(teardownOk ? 'TEARDOWN OK' : 'TEARDOWN FAILED');
