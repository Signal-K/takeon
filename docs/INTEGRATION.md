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
`game.build('solar-array')`, `game.repair()`, `game.deposit()`,
`game.walkTo(x, y)`, `game.save()`.

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
| `damaged` / `repaired` | `{amount, reason}` / `{amount}` | durability changes |
| `batteryEmpty` | `{}` | an action failed for lack of charge |
| `roverLost` | `{reason}` | mission over: dead battery with no recharge, or chassis destroyed |

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
  `STARTING_CREDITS`) are exported from the engine and mirrored in
  `pocketbase/routes.go` — change both together.
