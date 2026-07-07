# Embedding TakeOn

TakeOn's engine is a plain TypeScript library with no framework or asset
dependencies — everything (terrain sprites, rover, structures, anomalies) is
drawn procedurally into a canvas it owns. That makes three integration levels
possible.

## 1. Drop-in canvas (any host)

```ts
import { createRoverGame, getBody, defaultSpec } from '@takeon/engine';

const game = createRoverGame({
  canvas: myCanvasElement,
  body: getBody('moon')!,
  spec: { ...defaultSpec(), id: 'r1' },
  // resume: savedMissionState,   // to continue a mission
});
game.resize(width, height, devicePixelRatio);
game.start();
```

Built-in controls (attached to the canvas): arrows/WASD drive, E/Space mine,
P photo, X scan, drag pans, wheel/pinch zooms, tap = tap-to-drive. Pass
`controls: false` to drive everything through the API instead:
`game.move(dir)`, `game.mine()`, `game.photo()`, `game.scan()`,
`game.build(type)`, `game.craft(id)`, `game.placeBlock()`, `game.repair()`,
`game.deposit()`, `game.launchCargo()`, `game.upgradeMobility()`,
`game.walkTo(x, y)`, `game.orderMine(x, y)`, `game.rotateView()`,
`game.save()`.

Buildable structures include `solar-array`, `beacon`, `drill-rig`, `cache`,
`refinery`, `habitat-frame`, `launch-pad`, `generator` and `pylon`; a powered
`habitat-frame` finishes into a `habitat` on its own (not placed directly).

## 2. Inside PixiJS (Landnam)

`@takeon/pixi` renders the mission into a texture on your stage, so TakeOn can
live inside a Pixi scene (a building interior, a minigame window, a tab):

```ts
import * as PIXI from 'pixi.js';
import { mountRoverGame } from '@takeon/pixi';

const mounted = mountRoverGame({
  pixi: PIXI, stage: app.stage, ticker: app.ticker, view: app.canvas,
  width: 800, height: 600, x: 40, y: 60,
  body: getBody('ceres')!, spec: rover,
});
mounted.game.start();
```

Works against pixi v7 and v8 (structural typing; no hard dependency). `view`
is optional — omit it and drive the game purely through the API (e.g. from
your own Pixi UI buttons).

`mountRoverGame` touches only a tiny structural slice of Pixi —
`Texture.from(canvas)`, `new Sprite(texture)` with mutable `x/y/width/height`,
`stage.addChild/removeChild`, and `ticker.add/remove` (called each frame to
refresh the texture; it handles v7 `texture.update()`, v8
`texture.source.update()` and `baseTexture.update()`). Because that's the
whole contract, the mount is verifiable with a **mock** Pixi namespace — no
WebGL needed: a stub confirms the sprite is added, the texture pumps every
frame, the sim advances, host-canvas input (keyboard + tap) routes into the
game, and `mounted.destroy()` releases the sprite, texture, input and loop.

Returned handle: `{ game, sprite, resize(w, h), destroy() }`.

## Events

`game.events.on(name, handler)` — the full host-integration surface:

| Event | Payload | Fires when |
|---|---|---|
| `tick` | `{time, daylight}` | every sim tick (10 Hz) |
| `moved` | `{pos, energyUsed}` | a tile move starts |
| `blocked` | `{reason: 'cliff'\|'battery'\|'edge'\|'busy'}` | a move is refused |
| `miningStarted` / `mined` | `{pos, resource, amount}` | mining begins / completes |
| `cargoFull` | `{}` | yield didn't fit |
| `photo` | `{photo, dataUrl}` | photo taken (dataUrl is a JPEG) |
| `scan` | `{found, energyUsed}` | scanner sweep |
| `anomalyDocumented` | `{anomaly}` | first photo of an anomaly — a discovery |
| `built` / `buildFailed` | `{structure}` / `{reason}` | construction |
| `crafted` / `craftFailed` | `{recipe, resource, amount}` / `{reason}` | refining |
| `blockPlaced` | `{pos}` | a stone block was placed |
| `cargoLaunched` / `launchFailed` | `{pos, manifest, total, auto}` / `{reason}` | a cargo rocket ships home (`auto` = a self-shipping pad) |
| `upgraded` / `upgradeFailed` | `{kind, level}` / `{reason}` | field mobility upgrade |
| `habitatComplete` | `{pos}` | a habitat frame finished building |
| `weather` / `meteorImpact` | `{type, phase, intensity}` / `{pos, distance}` | environment events |
| `damaged` / `repaired` | `{amount, reason}` / `{amount}` | durability changes |
| `batteryEmpty` | `{}` | an action failed for lack of charge |
| `roverLost` | `{reason}` | mission over: dead battery with no recharge, or chassis destroyed |
| `stateChanged` | `{}` | banked yield / structure change worth re-persisting |

## Audio

`RoverGame` owns a synthesised `GameAudio` (no asset files — every sound is
generated at runtime). It stays silent until `game.audio.unlock()` is called
**from a user gesture** (browser autoplay policy); after that a per-body
ambient bed and event SFX play automatically.

```ts
hostCanvas.addEventListener('pointerdown', () => game.audio.unlock(), { once: true });
muteButton.onclick = () => game.audio.toggle();   // also setEnabled / setVolume
createRoverGame({ /* … */, audio: false });        // opt out entirely
```

With no Web Audio (SSR/tests) every audio call is a silent no-op.

## Objectives: the module contract

For an objective-driven loop without touching the deep sim, the engine ships a
small, pure, offline-first world model a host can persist and render:

```ts
import {
  createWorldState, explore, returnToBase, resetWorld,
  deriveMissionProgress, serializeWorldState, parseWorldState,
} from '@takeon/engine';

let world = parseWorldState(localStorage.getItem('takeon.world.v2')); // v1-safe, never throws
world = explore(world, { x: 3, y: 1 }, { data: 4, samples: 1 });      // yield is held in the field
world = returnToBase(world);                                          // banks held → counts

const p = deriveMissionProgress(world); // { name, objectives:[{label,current,target,complete}], complete }
localStorage.setItem('takeon.world.v2', serializeWorldState(world));
```

`deriveMissionProgress` is the single source of truth for a progress UI. The
bundled demo mission is *Field Survey* (survey 3 sites, bank 8 data, bank 3
samples); pass your own `TakeonMission` to `createWorldState`. All functions
are pure — trivially unit-testable.

## Persistence: bring your own database

The UI talks to a small `SyncAdapter` interface (profiles, rovers, missions,
photos, discoveries, credits). Two implementations ship:

- `LocalSync` — localStorage; zero setup.
- `PocketBaseSync` — the `pocketbase/` spoke in this repo (hub-and-spoke JWT
  delegation, `/api/takeon/*` routes).

A host game embeds TakeOn against its own storage by implementing the
interface once:

```ts
import type { SyncAdapter } from '@takeon/engine';

class LandnamSync implements SyncAdapter { /* write to Landnam's PB */ }
```

Mission saves are compact: the world regenerates deterministically from
`(bodyId, seed)`, so `MissionState` carries only voxel `edits`, rover state,
structures, anomaly flags and photo metadata.

## Extending content

- **Bodies**: any `BodyDef` renders and simulates — add rows to
  `takeon_bodies` (or pass your own array); gravity/solarFlux/dayLength/
  deltaV/terrain knobs are all data.
- **Parts**: same for `PartDef` via `takeon_parts`; `computeStats` is pure
  data-driven maths.
- **Balance constants** (`RESOURCE_VALUE`, `DISCOVERY_CREDITS`,
  `STARTING_CREDITS`, `PHOTO_CREDITS_PER_QUALITY`) are exported from the engine
  and mirrored in `pocketbase/routes.go` — change both together. A parity test
  (`economy-parity.test.ts`) reads the Go source and fails CI if they drift.
